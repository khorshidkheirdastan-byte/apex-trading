// api/atr-stop.js
// محاسبه ATR و تعیین حد ضرر متحرک

import { kv } from '@vercel/kv';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

const MULTIPLIER_MAP = {
  STRONG_BULL: 2.0,
  WEAK_BULL: 1.75,
  SIDEWAYS: 1.5,
  WEAK_BEAR: 1.25,
  STRONG_BEAR: 1.0,
};

const INVERSE_ETFS = new Set(['SH', 'PSQ', 'SQQQ', 'SDS', 'SPXU']);

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

function calcATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  const recent = trs.slice(trs.length - period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

async function fetchOHLCV(ticker, days = 20) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=30&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);
    return data?.results ?? [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const { holdings = [], prices = {}, regime = 'WEAK_BULL' } = req.body;
    const baseMultiplier = Math.min(2.5, MULTIPLIER_MAP[regime] ?? 1.75);
    const stops = [];

    await Promise.all(
      holdings.map(async (holding) => {
        try {
          const { ticker } = holding;
          const currentPrice = prices[ticker];
          if (!currentPrice) return;

          const bars = await fetchOHLCV(ticker, 20);
          if (bars.length < 15) return;

          const atrToday = calcATR(bars, 14);
          if (!atrToday) return;

          // بررسی انقباض نوسان
          const atr5dAgo = calcATR(bars.slice(0, -5), 14);
          let multiplier = baseMultiplier;
          if (atr5dAgo && atrToday < atr5dAgo * 0.5) {
            multiplier *= 0.8;
          }
          multiplier = Math.min(2.5, multiplier); // HARD CAP

          const isInverse = INVERSE_ETFS.has(ticker);
          let stopPrice, peakPrice, triggered;

          if (isInverse) {
            // ETF معکوس: پیگیری پایین‌ترین نقطه (Low-Water Mark)
            const storedLwm = await kv.get(`lwm:${ticker}`).catch(() => null);
            const nadirPrice = storedLwm
              ? Math.min(storedLwm, currentPrice)
              : currentPrice;

            if (!storedLwm || currentPrice < storedLwm) {
              await kv.set(`lwm:${ticker}`, currentPrice).catch(() => {});
            }

            stopPrice = nadirPrice + atrToday * multiplier;
            peakPrice = nadirPrice;
            triggered = currentPrice > stopPrice;
          } else {
            // سهام عادی: پیگیری بالاترین نقطه (High-Water Mark)
            const storedHwm = await kv.get(`hwm:${ticker}`).catch(() => null);
            const peak = storedHwm
              ? Math.max(storedHwm, currentPrice)
              : currentPrice;

            if (!storedHwm || currentPrice > storedHwm) {
              await kv.set(`hwm:${ticker}`, peak).catch(() => {});
            }

            // کاهش ضریب در صورت افت زیاد
            const drawdown = (peak - currentPrice) / peak;
            if (drawdown > 0.05) {
              multiplier *= 0.7;
              multiplier = Math.min(2.5, multiplier);
            }

            stopPrice = peak - atrToday * multiplier;
            peakPrice = peak;
            triggered = currentPrice < stopPrice;
          }

          if (triggered) {
            const coolingHours = Math.min(96, Math.max(24, multiplier * 24));
            await kv.set(`cooling:${ticker}`, true, { ex: Math.round(coolingHours * 3600) }).catch(() => {});

            // شمارش رشته توقف‌ها
            const streak = await kv.get('stops:streak').catch(() => 0) || 0;
            await kv.set('stops:streak', streak + 1, { ex: 300 }).catch(() => {});
          }

          stops.push({
            ticker,
            stopPrice: Math.round(stopPrice * 100) / 100,
            peakPrice: Math.round(peakPrice * 100) / 100,
            atr: Math.round(atrToday * 100) / 100,
            multiplier: Math.round(multiplier * 100) / 100,
            triggered,
            isInverse,
          });
        } catch (err) {
          console.error(`[atr-stop] خطا برای ${holding.ticker}:`, err.message);
        }
      })
    );

    return res.status(200).json({ stops });
  } catch (err) {
    console.error('[atr-stop] خطای کلی:', err.message);
    return res.status(200).json({ stops: [], error: err.message });
  }
}
