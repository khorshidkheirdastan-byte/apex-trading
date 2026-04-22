// api/pipeline.js
// خط لوله اصلی ۶ مرحله‌ای APEX

import { kv } from '@vercel/kv';
import { sendTelegram } from '../lib/telegram.js';
import { checkSPYStable, calculateTotalRisk, selectPositionsToClose } from '../lib/helpers.js';

const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const MAX_DAILY_LOSS = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '2') / 100;
const WATCHED_TICKERS = ['NVDA', 'SPY', 'TSLA', 'META', 'AMD', 'AAPL', 'PLTR'];

let cycleCount = 0;

function baseUrl() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  return base;
}

async function callApi(path, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${baseUrl()}${path}`, opts);
    return await r.json();
  } catch (err) {
    console.error(`[pipeline] خطا در فراخوانی ${path}:`, err.message);
    return null;
  }
}

function holdNow(reason, startTime) {
  return {
    action: 'HOLD',
    reason,
    pipeline_ms: Date.now() - startTime,
    cycle: cycleCount,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  // احراز هویت
  if (PIPELINE_SECRET && req.headers['x-pipeline-secret'] !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'احراز هویت ناموفق' });
  }

  cycleCount++;
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];

  try {
    const { holdings = [], portfolio = {} } = req.body ?? {};

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۱: اعتبارسنجی داده
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let prices = {};
    let safeMode = false;

    try {
      const validation = await callApi('/api/data-validator', 'POST', { tickers: WATCHED_TICKERS });
      if (validation?.safeMode) {
        return res.status(200).json(holdNow('حالت امن — داده‌های قیمتی غیرمعتبر', startTime));
      }
      prices = validation?.prices ?? {};
      safeMode = validation?.safeMode ?? false;
    } catch (err) {
      return res.status(200).json(holdNow(`خطا در اعتبارسنجی: ${err.message}`, startTime));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۲: بررسی ریسک
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Flash Crash
    const flashCrash = await kv.get('flashCrash:mode').catch(() => null);
    if (flashCrash) {
      const minutesSince = flashCrash.ts ? (Date.now() - flashCrash.ts) / 60000 : 0;
      const spyStable = await checkSPYStable(3, 0.5).catch(() => true);
      if (minutesSince > 5 && spyStable) {
        await kv.del('flashCrash:mode').catch(() => {});
        await sendTelegram('✅ <b>APEX</b>: حالت سقوط آنی برطرف شد. معاملات از سر گرفته می‌شود.');
      } else {
        return res.status(200).json(holdNow('سقوط آنی فعال است', startTime));
      }
    }

    // بررسی سقوط آنی جدید (از background jobs)
    // (تشخیص در job مجزا انجام می‌شود)

    // ریسک پرتفولیو
    const totalRisk = calculateTotalRisk(holdings);
    if (totalRisk > 0.08) {
      const toClose = selectPositionsToClose(holdings, totalRisk, 0.06);
      if (toClose.length > 0) {
        return res.status(200).json({
          action: 'CLOSE_POSITIONS',
          positionsToClose: toClose.map((h) => h.ticker),
          reason: 'ریسک پرتفولیو بیش از ۸٪',
          pipeline_ms: Date.now() - startTime,
          cycle: cycleCount,
        });
      }
    }

    if (totalRisk > 0.06 || holdings.length > 8) {
      return res.status(200).json(holdNow('ریسک یا تعداد موقعیت بالا — بدون معامله جدید', startTime));
    }

    // رشته توقف‌ها
    const stopsStreak = await kv.get('stops:streak').catch(() => 0) || 0;
    if (stopsStreak >= 3) {
      const paused = await kv.get('circuitBreaker:pause').catch(() => null);
      if (!paused) {
        await kv.set('circuitBreaker:pause', true, { ex: 900 }).catch(() => {});
        await sendTelegram('⚡ <b>APEX</b>: قطع‌کننده مدار فعال — مکث ۱۵ دقیقه');
      }
      return res.status(200).json(holdNow('قطع‌کننده مدار فعال است', startTime));
    }

    // Black Swan
    const blackSwan = await kv.get('blackswan:status').catch(() => null);
    if (blackSwan?.level === 'CRITICAL') {
      await sendTelegram('🚨 <b>APEX</b>: رویداد نادر! بستن تمام موقعیت‌ها...');
      return res.status(200).json({
        action: 'CLOSE_ALL',
        reason: 'رویداد Black Swan بحرانی',
        pipeline_ms: Date.now() - startTime,
        cycle: cycleCount,
      });
    }

    // ضرر روزانه
    const dailyLoss = await kv.get(`daily:loss:${today}`).catch(() => 0) || 0;
    if (dailyLoss >= MAX_DAILY_LOSS) {
      return res.status(200).json(holdNow(`ضرر روزانه به حداکثر رسید: ${(dailyLoss * 100).toFixed(1)}%`, startTime));
    }

    // ATR Stops
    let atrStops = [];
    try {
      const atrResult = await callApi('/api/atr-stop', 'POST', { holdings, prices, regime: 'WEAK_BULL' });
      atrStops = atrResult?.stops ?? [];
      for (const stop of atrStops) {
        if (stop.triggered) {
          const cooling = await kv.get(`cooling:${stop.ticker}`).catch(() => null);
          if (!cooling) {
            return res.status(200).json({
              action: 'SELL',
              asset: stop.ticker,
              limitPrice: stop.stopPrice * 0.999,
              reason: `ATR stop فعال شد: ${stop.ticker}`,
              pipeline_ms: Date.now() - startTime,
              cycle: cycleCount,
            });
          }
        }
      }
    } catch (err) {
      console.error('[pipeline] خطا در ATR stop:', err.message);
    }

    // بررسی خروج زمانی و تغییر فرصت (از holding‌ها)
    for (const h of holdings) {
      try {
        if (h.daysOpen > 7 && h.rangePercent < 3 && h.volumeDeclining) {
          return res.status(200).json({
            action: 'SELL',
            asset: h.ticker,
            limitPrice: (prices[h.ticker] ?? h.currentPrice) * 0.999,
            reason: `تغییر فرصت: ${h.ticker} — ۷+ روز راکد`,
            pipeline_ms: Date.now() - startTime,
            cycle: cycleCount,
          });
        }
      } catch {}
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۳: رژیم بازار
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let regime = 'WEAK_BULL';
    let kellyFraction = 0.25;
    let sizeMultiplier = 0.8;
    let maxPos = 30;
    let regimeSettings = {};

    try {
      const regimeResult = await callApi('/api/market-regime');
      if (regimeResult?.regime) {
        regime = regimeResult.regime;
        kellyFraction = regimeResult.settings?.kellyFraction ?? 0.25;
        sizeMultiplier = regimeResult.settings?.sizeMultiplier ?? 0.8;
        maxPos = regimeResult.settings?.maxPos ?? 30;
        regimeSettings = regimeResult.settings ?? {};
      }
    } catch (err) {
      console.error('[pipeline] خطا در regime:', err.message);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۴: سیگنال ورود
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let bestSignal = null;
    let bestTicker = null;

    for (const ticker of WATCHED_TICKERS.filter((t) => t !== 'SPY')) {
      try {
        const signalResult = await callApi('/api/entry-signal', 'POST', {
          ticker,
          prices,
          hist: [], // در پیاده‌سازی واقعی تاریخچه ارسال می‌شود
          regime,
          holdings,
          daysOpen: 0,
          unrealizedPnl: 0,
        });

        if (signalResult?.signal === 'STRONG' || signalResult?.signal === 'INVERSE') {
          bestSignal = signalResult;
          bestTicker = ticker;
          break;
        }

        if (signalResult?.signal === 'MODERATE' && !bestSignal) {
          bestSignal = signalResult;
          bestTicker = ticker;
        }
      } catch {}
    }

    if (!bestSignal || bestSignal.signal === 'NONE') {
      return res.status(200).json(holdNow('بدون سیگنال معتبر', startTime));
    }

    if (bestSignal.signal === 'EXIT') {
      return res.status(200).json({
        action: 'SELL',
        asset: bestTicker,
        limitPrice: (prices[bestTicker] ?? 0) * 0.999,
        reason: bestSignal.reason,
        pipeline_ms: Date.now() - startTime,
        cycle: cycleCount,
      });
    }

    // MODERATE → نقاد AI
    let amountMultiplier = 1.0;
    if (bestSignal.signal === 'MODERATE') {
      try {
        const critic = await callApi('/api/critic-ai', 'POST', { decision: bestSignal, portfolio: { ...portfolio, regime } });
        if (critic?.action === 'HOLD') {
          return res.status(200).json(holdNow(`نقاد AI: متوقف — ${critic.concerns}`, startTime));
        }
        amountMultiplier = critic?.amountMultiplier ?? 1.0;
      } catch {}
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۵: اجرا
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const currentPrice = prices[bestTicker];
    if (!currentPrice) {
      return res.status(200).json(holdNow(`قیمت برای ${bestTicker} موجود نیست`, startTime));
    }

    const execution = await callApi('/api/smart-execution', 'POST', {
      safeMode: false,
      ticker: bestTicker,
      currentPrice,
      holdings,
      regime,
      signal: bestSignal,
      portfolio: { ...portfolio, regime },
      kellyFraction,
      maxPos,
      atrStops,
    });

    const action = execution?.action ?? 'HOLD';

    // به‌روزرسانی ضرر روزانه در صورت SELL با ضرر
    if (action === 'SELL') {
      try {
        const h = holdings.find((x) => x.ticker === bestTicker);
        if (h && currentPrice < h.avgPrice) {
          const loss = (h.avgPrice - currentPrice) / h.avgPrice;
          const current = await kv.get(`daily:loss:${today}`).catch(() => 0) || 0;
          await kv.set(`daily:loss:${today}`, current + loss, { ex: 86400 }).catch(() => {});
        }
      } catch {}
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // مرحله ۶: حافظه (غیرمسدودکننده)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Promise.resolve().then(async () => {
      try {
        // ذخیره تصمیم
        await kv.set(`decision:latest`, {
          action,
          ticker: bestTicker,
          regime,
          signal: bestSignal.signal,
          cycle: cycleCount,
          ts: Date.now(),
        }).catch(() => {});

        // گزارش‌های دوره‌ای
        if (cycleCount % 360 === 0) {
          await callApi('/api/self-audit', 'GET');
        }
        if (cycleCount % 100 === 0) {
          await callApi('/api/ab-test', 'POST');
        }
        if (cycleCount % 2016 === 0) {
          await callApi('/api/weekly-report', 'POST');
        }
      } catch {}
    });

    return res.status(200).json({
      ...(execution ?? {}),
      regime,
      cycle: cycleCount,
      pipeline_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[pipeline] خطای کلی:', err.message);
    return res.status(200).json(holdNow(`خطای سیستم: ${err.message}`, startTime));
  }
}
