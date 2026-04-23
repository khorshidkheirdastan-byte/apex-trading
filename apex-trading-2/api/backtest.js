// api/backtest.js
// بک‌تست استراتژی‌های Breakout و Pullback روی داده‌های ۲+ ساله

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');
const COMMISSION = 0.005; // $0.005 per share
const SLIPPAGE = 0.001;   // 0.1%
const SPREAD = 0.001;     // 0.1%

const TICKERS = ['NVDA', 'SPY', 'TSLA', 'META', 'AMD', 'AAPL', 'PLTR'];

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchTwoYearBars(ticker) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 2.5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=800&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);
    return data?.results ?? [];
  } catch {
    return [];
  }
}

function sma(closes, period, idx) {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += closes[i];
  return sum / period;
}

function calcRSI(closes, period, idx) {
  if (idx < period) return null;
  let gains = 0, losses = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function determineRegime(spyBars, idx) {
  if (idx < 200) return 'UNKNOWN';
  const closes = spyBars.map((b) => b.c);
  const sma200val = sma(closes, 200, idx);
  const sma50val = sma(closes, 50, idx);
  if (!sma200val || !sma50val) return 'SIDEWAYS';
  const sma50_5 = sma(closes, 50, idx - 5);
  const slope = sma50_5 ? ((sma50val - sma50_5) / sma50_5) * 100 : 0;
  const price = closes[idx];

  if (price > sma200val * 1.02 && slope > 0.5) return 'STRONG_BULL';
  if (price > sma200val && slope >= -0.2) return 'WEAK_BULL';
  if (Math.abs((price - sma200val) / sma200val) < 0.02) return 'SIDEWAYS';
  if (price < sma200val && slope < -0.2) return 'WEAK_BEAR';
  if (price < sma200val * 0.97 && slope < -1.0) return 'STRONG_BEAR';
  return 'SIDEWAYS';
}

function runStrategy(bars, strategy, spyBars) {
  const closes = bars.map((b) => b.c);
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const vols = bars.map((b) => b.v);

  const trades = [];
  let position = null;
  let equity = 10000;
  const equityCurve = [equity];

  for (let i = 50; i < bars.length; i++) {
    const price = closes[i];
    const spyIdx = Math.min(i, (spyBars?.length ?? 1) - 1);
    const regime = spyBars ? determineRegime(spyBars, spyIdx) : 'WEAK_BULL';

    if (position) {
      // ATR stop basit
      const holdDays = i - position.entryIdx;
      const gain = (price - position.entryPrice) / position.entryPrice;
      const shouldExit = holdDays > 10 || gain < -0.08 || gain > 0.15;

      if (shouldExit) {
        const exitPrice = price * (1 - SLIPPAGE - SPREAD);
        const shares = position.shares;
        const pnl = (exitPrice - position.entryPrice) * shares - COMMISSION * shares * 2;
        equity += pnl;
        trades.push({ entryPrice: position.entryPrice, exitPrice, pnl, strategy, regime: position.regime, gain });
        position = null;
      }
    }

    if (!position && (regime === 'STRONG_BULL' || regime === 'WEAK_BULL')) {
      const sma20val = sma(closes, 20, i);
      const sma50val = sma(closes, 50, i);
      const rsi = calcRSI(closes, 14, i);
      const avgVol20 = vols.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;

      let signal = false;

      if (strategy === 'BREAKOUT') {
        const high20 = Math.max(...highs.slice(i - 20, i));
        signal = price > high20 && vols[i] > avgVol20 * 1.3 && price < high20 * 1.015;
      } else if (strategy === 'PULLBACK') {
        signal = sma50val && price > sma50val &&
          sma20val && Math.abs(price - sma20val) / sma20val < 0.02 &&
          rsi !== null && rsi >= 35 && rsi <= 50;
      }

      if (signal) {
        const entryPrice = price * (1 + SLIPPAGE + SPREAD);
        const shares = Math.floor((equity * 0.1) / entryPrice);
        if (shares > 0) {
          position = { entryPrice, shares, entryIdx: i, regime };
        }
      }
    }

    equityCurve.push(equity);
  }

  if (!trades.length) return { winRate: 0, sharpe: 0, maxDrawdown: 0, finalValue: equity, trades: 0 };

  const wins = trades.filter((t) => t.pnl > 0);
  const winRate = Math.round((wins.length / trades.length) * 100);

  // Max Drawdown
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe ساده
  const returns = trades.map((t) => t.pnl / 10000);
  const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length;
  const sharpe = variance > 0 ? (avgRet / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  // بر اساس رژیم
  const byRegime = {};
  for (const t of trades) {
    if (!byRegime[t.regime]) byRegime[t.regime] = { wins: 0, total: 0 };
    byRegime[t.regime].total++;
    if (t.pnl > 0) byRegime[t.regime].wins++;
  }

  return {
    winRate,
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDD * 10000) / 100,
    finalValue: Math.round(equity),
    trades: trades.length,
    byRegime,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    // دریافت داده‌های SPY برای تعیین رژیم
    const spyBars = await fetchTwoYearBars('SPY');

    const results = {};
    const breakoutByRegime = {};
    const pullbackByRegime = {};

    for (const ticker of TICKERS) {
      try {
        const bars = ticker === 'SPY' ? spyBars : await fetchTwoYearBars(ticker);
        if (bars.length < 250) continue;

        const bo = runStrategy(bars, 'BREAKOUT', spyBars);
        const pb = runStrategy(bars, 'PULLBACK', spyBars);

        results[ticker] = { breakout: bo, pullback: pb };

        // تجمیع رژیم
        for (const [regime, data] of Object.entries(bo.byRegime ?? {})) {
          if (!breakoutByRegime[regime]) breakoutByRegime[regime] = { wins: 0, total: 0 };
          breakoutByRegime[regime].wins += data.wins;
          breakoutByRegime[regime].total += data.total;
        }
        for (const [regime, data] of Object.entries(pb.byRegime ?? {})) {
          if (!pullbackByRegime[regime]) pullbackByRegime[regime] = { wins: 0, total: 0 };
          pullbackByRegime[regime].wins += data.wins;
          pullbackByRegime[regime].total += data.total;
        }
      } catch (err) {
        console.error(`[backtest] خطا برای ${ticker}:`, err.message);
      }
    }

    // آمار کلی
    const allBreakout = Object.values(results).map((r) => r.breakout).filter(Boolean);
    const allPullback = Object.values(results).map((r) => r.pullback).filter(Boolean);

    const avg = (arr, key) => arr.length ? Math.round(arr.reduce((s, x) => s + (x[key] ?? 0), 0) / arr.length * 10) / 10 : 0;

    return res.status(200).json({
      overall: {
        breakout: {
          winRate: avg(allBreakout, 'winRate'),
          sharpe: avg(allBreakout, 'sharpe'),
          maxDrawdown: avg(allBreakout, 'maxDrawdown'),
          finalValue: avg(allBreakout, 'finalValue'),
        },
        pullback: {
          winRate: avg(allPullback, 'winRate'),
          sharpe: avg(allPullback, 'sharpe'),
          maxDrawdown: avg(allPullback, 'maxDrawdown'),
          finalValue: avg(allPullback, 'finalValue'),
        },
      },
      byStrategy: {
        breakout: Object.fromEntries(
          Object.entries(breakoutByRegime).map(([r, d]) => [r, { winRate: d.total > 0 ? Math.round(d.wins / d.total * 100) : 0, trades: d.total }])
        ),
        pullback: Object.fromEntries(
          Object.entries(pullbackByRegime).map(([r, d]) => [r, { winRate: d.total > 0 ? Math.round(d.wins / d.total * 100) : 0, trades: d.total }])
        ),
      },
      byTicker: results,
      message: `بک‌تست روی ${TICKERS.length} سهم با ۲+ سال داده انجام شد. کمیسیون: $۰.۰۰۵/سهم، اسلیپج: ۰.۱٪`,
    });
  } catch (err) {
    console.error('[backtest] خطا:', err.message);
    return res.status(200).json({
      error: err.message,
      message: 'خطا در اجرای بک‌تست',
      overall: {}, byStrategy: {}, byRegime: {},
    });
  }
}
