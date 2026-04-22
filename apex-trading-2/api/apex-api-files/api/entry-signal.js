// api/entry-signal.js
// بررسی سیگنال ورود بر اساس استراتژی و رژیم بازار

import { getSpyReturn30d, getSectorExposure } from '../lib/helpers.js';

const INVERSE_TICKERS = new Set(['SH', 'PSQ', 'SQQQ', 'SDS', 'SPXU']);

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  const s = arr.slice(arr.length - period);
  return s.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const slice = closes.slice(closes.length - period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function stockReturn5d(hist) {
  if (!hist || hist.length < 5) return 0;
  const recent = hist[hist.length - 1].close;
  const old = hist[hist.length - 5].close;
  return ((recent - old) / old) * 100;
}

function stockReturn30d(hist) {
  if (!hist || hist.length < 30) return 0;
  const recent = hist[hist.length - 1].close;
  const old = hist[hist.length - 30].close;
  return ((recent - old) / old) * 100;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const {
      ticker,
      prices = {},
      hist = [],
      regime = 'WEAK_BULL',
      holdings = [],
      daysOpen = 0,
      unrealizedPnl = 0,
    } = req.body;

    const currentPrice = prices[ticker];
    if (!currentPrice || hist.length < 20) {
      return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'داده کافی نیست' });
    }

    const closes = hist.map((b) => b.close);
    const volumes = hist.map((b) => b.volume);

    // خروج زمانی در رژیم SIDEWAYS
    if (regime === 'SIDEWAYS') {
      if (daysOpen > 3 && unrealizedPnl < 1) {
        return res.status(200).json({ signal: 'EXIT', strategy: null, reason: 'خروج زمانی در رژیم SIDEWAYS' });
      }
      return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'رژیم SIDEWAYS — بدون معامله' });
    }

    // رژیم STRONG_BEAR: فقط ETF معکوس
    if (regime === 'STRONG_BEAR') {
      if (INVERSE_TICKERS.has(ticker)) {
        return res.status(200).json({ signal: 'STRONG', strategy: 'INVERSE', reason: 'بازار نزولی — ETF معکوس' });
      }
      return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'رژیم STRONG_BEAR — فقط معکوس' });
    }

    // بررسی ریسک همبستگی
    const droppingToday = holdings.filter((h) => {
      const hp = prices[h.ticker];
      return hp && h.prevPrice && (hp - h.prevPrice) / h.prevPrice < -0.02;
    });

    if (droppingToday.length >= 5) {
      return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'بیش از ۵ سهام در حال افت' });
    }

    let correlationPenalty = 1.0;
    if (droppingToday.length >= 3) {
      correlationPenalty = 0.5;
    }

    // بررسی قدرت نسبی
    let spyReturn30 = 0;
    try {
      spyReturn30 = await getSpyReturn30d();
    } catch {}

    const stock30d = stockReturn30d(hist);
    const stock5d = stockReturn5d(hist);
    const sma10val = sma(closes, 10);

    const rsCheck1 = stock30d > spyReturn30 + 5;
    const rsCheck2 = stock5d > -3;
    const rsCheck3 = sma10val && currentPrice > sma10val;

    if (!rsCheck1 || !rsCheck2 || !rsCheck3) {
      return res.status(200).json({
        signal: 'NONE',
        strategy: null,
        reason: `قدرت نسبی ضعیف: 30d=${stock30d.toFixed(1)}% spy=${spyReturn30.toFixed(1)}% 5d=${stock5d.toFixed(1)}% sma10=${rsCheck3}`,
      });
    }

    // جریمه بخش
    let sectorPenalty = 1.0;
    try {
      const portfolio = holdings.map((h) => ({ ...h, value: (prices[h.ticker] ?? 0) * (h.shares ?? 0) }));
      const exposure = getSectorExposure(portfolio, ticker);
      if (exposure > 35) {
        const overshoot = exposure - 35;
        sectorPenalty = 1 - Math.min(0.5, (overshoot / 35) * 1.0);
      }
    } catch {}

    const sma20val = sma(closes, 20);
    const sma50val = sma(closes, 50);
    const rsi = calcRSI(closes, 14);

    // استراتژی Pullback (فقط در بازارهای صعودی)
    if (regime === 'STRONG_BULL' || regime === 'WEAK_BULL') {
      const pb1 = sma50val && currentPrice > sma50val;
      const pb2 = sma20val && sma50val &&
        (Math.abs(currentPrice - sma20val) / sma20val < 0.02 ||
         Math.abs(currentPrice - sma50val) / sma50val < 0.02);
      const pb3 = rsi !== null && rsi >= 35 && rsi <= 50;
      const pb4 = volumes.length >= 5 &&
        volumes[volumes.length - 1] < volumes[volumes.length - 2] &&
        volumes[volumes.length - 2] < volumes[volumes.length - 3] &&
        volumes[volumes.length - 3] < volumes[volumes.length - 4] &&
        volumes[volumes.length - 4] < volumes[volumes.length - 5];

      if (pb1 && pb2 && pb3 && pb4) {
        return res.status(200).json({
          signal: 'STRONG',
          strategy: 'PULLBACK',
          reason: `پول‌بک قوی: RSI=${rsi?.toFixed(0)} حجم نزولی`,
          correlationPenalty,
          sectorPenalty,
        });
      }
    }

    // استراتژی Breakout
    if (regime === 'STRONG_BULL' || regime === 'WEAK_BULL') {
      const high20 = Math.max(...hist.slice(-20).map((b) => b.high));
      const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const todayVol = volumes[volumes.length - 1];

      const bo1 = currentPrice > high20;
      const bo2 = todayVol > avgVol20 * 1.3;
      const bo3 = currentPrice < high20 * 1.015;

      // Runaway breakout: حجم بیش از ۳ برابر — شرط اول نادیده گرفته می‌شود
      const runaway = todayVol > avgVol20 * 3;

      if ((runaway || bo1) && bo2 && (runaway || bo3)) {
        return res.status(200).json({
          signal: 'STRONG',
          strategy: 'BREAKOUT',
          reason: `شکست ${runaway ? 'انفجاری' : 'معتبر'}: حجم=${(todayVol / avgVol20).toFixed(1)}x`,
          correlationPenalty,
          sectorPenalty,
        });
      }

      // سیگنال‌های ضعیف‌تر
      if (bo1 && bo2) {
        return res.status(200).json({
          signal: 'MODERATE',
          strategy: 'BREAKOUT',
          reason: 'شکست متوسط',
          correlationPenalty,
          sectorPenalty,
        });
      }
    }

    return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'هیچ سیگنالی یافت نشد' });
  } catch (err) {
    console.error('[entry-signal] خطا:', err.message);
    return res.status(200).json({ signal: 'NONE', strategy: null, reason: 'خطای سیستم', error: err.message });
  }
}
