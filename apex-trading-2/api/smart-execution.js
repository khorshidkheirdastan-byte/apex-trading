// api/smart-execution.js
// موتور اجرای هوشمند معاملات — خط لوله اولویت‌بندی‌شده

import { kv } from '@vercel/kv';
import { sendTelegram } from '../lib/telegram.js';
import { calculateTotalRisk, selectPositionsToClose, checkSPYStable } from '../lib/helpers.js';

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const ALPACA_BASE = process.env.ALPACA_PAPER === 'true'
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';
const MAX_DAILY_LOSS = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '2') / 100;
const AI_TIMEOUT = parseInt(process.env.AI_MODEL_TIMEOUT || '5000');

async function placeAlpacaOrder(ticker, side, qty, limitPrice) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${ALPACA_BASE}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': ALPACA_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: ticker,
        qty,
        side,
        type: 'limit',
        limit_price: limitPrice.toFixed(2),
        time_in_force: 'day',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function holdResponse(reason, triggered_by, pipeline_ms) {
  return { action: 'HOLD', asset: null, limitPrice: null, amount_pct: 0, confidence: 0, triggered_by, pipeline_ms, reason };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  const startTime = Date.now();

  try {
    const {
      safeMode = false,
      ticker,
      currentPrice,
      holdings = [],
      regime = 'WEAK_BULL',
      signal = {},
      portfolio = {},
      winRate = 0.5,
      avgGain = 0.05,
      lossRate = 0.5,
      avgLoss = 0.03,
      assetATR = null,
      marketAvgATR = null,
      latencyMs = 0,
      sectorPenalty = 1.0,
      kellyFraction = 0.25,
      maxPos = 30,
    } = req.body;

    const ms = () => Date.now() - startTime;

    // ۱. حالت امن
    if (safeMode) {
      return res.status(200).json(holdResponse('حالت امن فعال است', 'safe_mode', ms()));
    }

    // ۲. بررسی Flash Crash
    const flashCrash = await kv.get('flashCrash:mode').catch(() => null);
    if (flashCrash) {
      const minutesSince = flashCrash.ts ? (Date.now() - flashCrash.ts) / 60000 : 0;
      const spyStable = await checkSPYStable(3, 0.5);
      if (minutesSince > 5 && spyStable) {
        await kv.del('flashCrash:mode').catch(() => {});
        await sendTelegram('✅ <b>APEX</b>: حالت سقوط آنی برطرف شد. معاملات از سر گرفته می‌شود.');
      } else {
        return res.status(200).json(holdResponse('سقوط آنی فعال', 'flash_crash', ms()));
      }
    }

    // بررسی ریسک پرتفولیو
    const totalRisk = calculateTotalRisk(holdings);
    if (totalRisk > 0.08) {
      const toClose = selectPositionsToClose(holdings, totalRisk, 0.06);
      if (toClose.length > 0) {
        return res.status(200).json({
          action: 'CLOSE_POSITIONS',
          positionsToClose: toClose.map((h) => h.ticker),
          triggered_by: 'risk_cap_exceeded',
          pipeline_ms: ms(),
        });
      }
    }

    if (totalRisk > 0.06 || holdings.length > 8) {
      return res.status(200).json(holdResponse('ریسک پرتفولیو بالا یا تعداد موقعیت زیاد', 'portfolio_risk', ms()));
    }

    // بررسی رشته توقف‌ها
    const stopsStreak = await kv.get('stops:streak').catch(() => 0) || 0;
    if (stopsStreak >= 3) {
      const circuitPause = await kv.get('circuitBreaker:pause').catch(() => null);
      if (!circuitPause) {
        await kv.set('circuitBreaker:pause', true, { ex: 900 }).catch(() => {});
        await sendTelegram('⚡ <b>APEX</b>: قطع‌کننده مدار فعال شد. مکث ۱۵ دقیقه‌ای.');
      }
      return res.status(200).json(holdResponse('قطع‌کننده مدار فعال', 'circuit_breaker', ms()));
    }

    // Black Swan
    const blackSwan = await kv.get('blackswan:status').catch(() => null);
    if (blackSwan?.level === 'CRITICAL') {
      return res.status(200).json({
        action: 'CLOSE_ALL',
        triggered_by: 'black_swan_critical',
        pipeline_ms: ms(),
      });
    }

    // ضرر روزانه
    const today = new Date().toISOString().split('T')[0];
    const dailyLoss = await kv.get(`daily:loss:${today}`).catch(() => 0) || 0;
    if (dailyLoss >= MAX_DAILY_LOSS) {
      return res.status(200).json(holdResponse(`حداکثر ضرر روزانه: ${(dailyLoss * 100).toFixed(1)}%`, 'daily_loss_limit', ms()));
    }

    // بررسی حد ضرر ATR (فراخوانی باید از بیرون انجام شود و نتیجه ارسال شود)
    const atrStops = req.body.atrStops ?? [];
    for (const stop of atrStops) {
      if (stop.triggered) {
        const cooling = await kv.get(`cooling:${stop.ticker}`).catch(() => null);
        if (!cooling) {
          return res.status(200).json({
            action: 'SELL',
            asset: stop.ticker,
            limitPrice: stop.stopPrice * 0.999,
            amount_pct: 100,
            confidence: 1.0,
            triggered_by: 'atr_stop',
            pipeline_ms: ms(),
          });
        }
      }
    }

    // سیگنال ورود
    const { signal: signalType, strategy, correlationPenalty = 1.0 } = signal;

    if (!signalType || signalType === 'NONE') {
      return res.status(200).json(holdResponse('بدون سیگنال', 'no_signal', ms()));
    }

    if (signalType === 'EXIT') {
      return res.status(200).json({
        action: 'SELL', asset: ticker,
        limitPrice: currentPrice * 0.999,
        amount_pct: 100, confidence: 0.9,
        triggered_by: 'time_exit', pipeline_ms: ms(),
      });
    }

    // فیلتر نقدینگی (فراخوانی داخلی)
    let liquidityMultiplier = 1.0;
    try {
      const liqRes = await fetch(`${process.env.VERCEL_URL || ''}/api/liquidity-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, prices: { [ticker]: currentPrice } }),
      });
      const liq = await liqRes.json().catch(() => ({}));
      if (!liq.approved) {
        return res.status(200).json(holdResponse(`نقدینگی ناکافی: ${liq.reason}`, 'liquidity_filter', ms()));
      }
      liquidityMultiplier = liq.positionMultiplier ?? 1.0;
    } catch {}

    // تایید AI برای MODERATE
    let amountMultiplier = 1.0;
    if (signalType === 'MODERATE') {
      try {
        const criticRes = await fetch(`${process.env.VERCEL_URL || ''}/api/critic-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: signal, portfolio }),
          signal: AbortSignal.timeout(AI_TIMEOUT),
        });
        const critic = await criticRes.json().catch(() => ({}));
        if (critic.action === 'ABORT') {
          return res.status(200).json(holdResponse(`AI نقاد: متوقف — ${critic.concerns}`, 'critic_abort', ms()));
        }
        amountMultiplier = critic.amountMultiplier ?? 1.0;
      } catch {}
    }

    // محاسبه اندازه موقعیت با Kelly
    let f = (winRate * avgGain - lossRate * avgLoss) / (avgGain || 0.001);
    f = Math.max(0, Math.min(f, 1));
    let amountPct = Math.min(maxPos, f * kellyFraction * 100);

    // تنظیم نوسان
    if (assetATR && marketAvgATR && marketAvgATR > 0) {
      const ratio = assetATR / marketAvgATR;
      if (ratio > 2) amountPct *= 0.5;
      else if (ratio > 1.5) amountPct *= 0.7;
    }

    // تنظیم تاخیر
    if (latencyMs > 15000) {
      return res.status(200).json(holdResponse(`تاخیر خیلی زیاد: ${latencyMs}ms`, 'latency_too_high', ms()));
    }
    if (latencyMs > 8000) amountPct *= 0.5;

    // اعمال ضرایب
    amountPct *= correlationPenalty * sectorPenalty * liquidityMultiplier * amountMultiplier;
    amountPct = Math.max(0, Math.round(amountPct * 100) / 100);

    if (amountPct < 0.5) {
      return res.status(200).json(holdResponse('اندازه موقعیت خیلی کوچک', 'position_too_small', ms()));
    }

    const limitPrice = currentPrice * 1.001;
    const orderResult = await placeAlpacaOrder(ticker, 'buy', null, limitPrice).catch(() => ({ ok: false }));

    return res.status(200).json({
      action: orderResult.ok ? 'BUY' : 'HOLD',
      asset: ticker,
      limitPrice: Math.round(limitPrice * 100) / 100,
      amount_pct: amountPct,
      confidence: signalType === 'STRONG' ? 0.9 : 0.7,
      triggered_by: strategy ?? 'signal',
      pipeline_ms: ms(),
      orderResult: orderResult.ok ? 'سفارش ثبت شد' : 'خطا در ثبت سفارش',
    });
  } catch (err) {
    console.error('[smart-execution] خطای کلی:', err.message);
    return res.status(200).json(holdResponse(`خطای سیستم: ${err.message}`, 'system_error', Date.now() - startTime));
  }
}
