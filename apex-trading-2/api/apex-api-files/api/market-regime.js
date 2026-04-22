// api/market-regime.js
// تشخیص رژیم بازار بر اساس SPY و SMA

import { kv } from '@vercel/kv';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

const REGIME_SETTINGS = {
  STRONG_BULL: { kellyFraction: 0.35, maxPos: 40, breakout: true,  pullback: true,  inverse: false, sizeMultiplier: 1.0 },
  WEAK_BULL:   { kellyFraction: 0.25, maxPos: 30, breakout: true,  pullback: true,  inverse: false, sizeMultiplier: 0.8 },
  SIDEWAYS:    { kellyFraction: 0.15, maxPos: 20, breakout: false, pullback: false, inverse: false, sizeMultiplier: 0.3 },
  WEAK_BEAR:   { kellyFraction: 0.10, maxPos: 15, breakout: false, pullback: false, inverse: false, sizeMultiplier: 0.2 },
  STRONG_BEAR: { kellyFraction: 0.05, maxPos: 10, breakout: false, pullback: false, inverse: true,  sizeMultiplier: 0.1 },
};

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function sma(arr, period) {
  if (arr.length < period) return null;
  const slice = arr.slice(arr.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    // بررسی کش
    const cached = await kv.get('regime:current').catch(() => null);
    if (cached?.updatedAt && Date.now() - cached.updatedAt < 3600 * 1000) {
      return res.status(200).json(cached);
    }

    // دریافت ۲۱۰ روز داده SPY
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 220 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=250&apiKey=${POLYGON_KEY}`;

    const data = await fetchWithTimeout(url);

    if (!data?.results?.length || data.results.length < 210) {
      throw new Error('داده کافی برای محاسبه رژیم وجود ندارد');
    }

    const closes = data.results.map((r) => r.c);
    const currentPrice = closes[closes.length - 1];

    const sma200val = sma(closes, 200);
    const sma50val = sma(closes, 50);

    if (!sma200val || !sma50val) {
      throw new Error('محاسبه SMA ممکن نشد');
    }

    // محاسبه شیب SMA50 (تغییر ۵ روزه)
    const sma50_5dAgo = sma(closes.slice(0, -5), 50);
    const slope = sma50_5dAgo ? ((sma50val - sma50_5dAgo) / sma50_5dAgo) * 100 : 0;

    let regime;
    if (currentPrice > sma200val * 1.02 && slope > 0.5) {
      regime = 'STRONG_BULL';
    } else if (currentPrice > sma200val && slope >= -0.2) {
      regime = 'WEAK_BULL';
    } else if (Math.abs((currentPrice - sma200val) / sma200val) < 0.02) {
      regime = 'SIDEWAYS';
    } else if (currentPrice < sma200val && slope < -0.2) {
      regime = 'WEAK_BEAR';
    } else if (currentPrice < sma200val * 0.97 && slope < -1.0) {
      regime = 'STRONG_BEAR';
    } else {
      regime = 'WEAK_BULL';
    }

    const result = {
      regime,
      spyPrice: currentPrice,
      sma200: sma200val,
      sma50: sma50val,
      slope,
      settings: REGIME_SETTINGS[regime],
      updatedAt: Date.now(),
    };

    await kv.set('regime:current', result, { ex: 3600 }).catch(() => {});

    return res.status(200).json(result);
  } catch (err) {
    console.error('[market-regime] خطا:', err.message);

    // برگشت به کش یا پیش‌فرض WEAK_BULL
    try {
      const fallback = await kv.get('regime:current').catch(() => null);
      if (fallback) return res.status(200).json({ ...fallback, fromCache: true });
    } catch {}

    return res.status(200).json({
      regime: 'WEAK_BULL',
      settings: REGIME_SETTINGS.WEAK_BULL,
      updatedAt: Date.now(),
      isDefault: true,
      error: err.message,
    });
  }
}
