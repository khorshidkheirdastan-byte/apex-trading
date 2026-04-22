// api/data-validator.js
// اعتبارسنجی قیمت‌ها از چندین منبع

import { kv } from '@vercel/kv';
import { sendTelegram } from '../lib/telegram.js';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const ALPACA_DATA_URL = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

// ذخیره ۱۰ قیمت آخر برای هر سهم (شناسایی اسپایک)
const priceHistory = new Map();

function recordPrice(ticker, price) {
  if (!priceHistory.has(ticker)) priceHistory.set(ticker, []);
  const hist = priceHistory.get(ticker);
  hist.push({ price, ts: Date.now() });
  if (hist.length > 10) hist.shift();
}

function isSpike(ticker, price) {
  const hist = priceHistory.get(ticker);
  if (!hist || hist.length < 2) return false;
  const last = hist[hist.length - 1].price;
  if (!last) return false;
  return Math.abs((price - last) / last) > 0.20;
}

async function fetchWithTimeout(url, headers = {}, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchPolygon(ticker) {
  try {
    const url = `https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);
    const price = data?.results?.p;
    const ts = data?.results?.t ? data.results.t / 1000000 : Date.now(); // nanoseconds to ms
    return price ? { price, ts, source: 'polygon' } : null;
  } catch {
    return null;
  }
}

async function fetchAlpaca(ticker) {
  try {
    const url = `${ALPACA_DATA_URL}/v2/stocks/${ticker}/trades/latest`;
    const data = await fetchWithTimeout(url, {
      'APCA-API-KEY-ID': ALPACA_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET,
    });
    const price = data?.trade?.p;
    const ts = data?.trade?.t ? new Date(data.trade.t).getTime() : Date.now();
    return price ? { price, ts, source: 'alpaca' } : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const { tickers = [] } = req.body;
    if (!tickers.length) {
      return res.status(400).json({ error: 'لیست سهام خالی است' });
    }

    const now = Date.now();
    const prices = {};
    const staleTickers = [];
    let safeMode = false;

    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const [polygonResult, alpacaResult] = await Promise.allSettled([
            fetchPolygon(ticker),
            fetchAlpaca(ticker),
          ]);

          const poly = polygonResult.status === 'fulfilled' ? polygonResult.value : null;
          const alpa = alpacaResult.status === 'fulfilled' ? alpacaResult.value : null;

          let finalPrice = null;
          let finalTs = null;

          if (poly && alpa) {
            const diff = Math.abs((poly.price - alpa.price) / poly.price);
            if (diff < 0.01) {
              finalPrice = poly.price * 0.6 + alpa.price * 0.4;
              finalTs = Math.max(poly.ts, alpa.ts);
            } else {
              // اختلاف بیش از ۱٪ — استفاده از کش
              const cached = await kv.get(`price:${ticker}`).catch(() => null);
              if (cached && now - cached.ts < 5 * 60 * 1000) {
                finalPrice = cached.price;
                finalTs = cached.ts;
              } else {
                staleTickers.push(ticker);
                return;
              }
            }
          } else if (poly) {
            finalPrice = poly.price;
            finalTs = poly.ts;
          } else if (alpa) {
            finalPrice = alpa.price;
            finalTs = alpa.ts;
          } else {
            const cached = await kv.get(`price:${ticker}`).catch(() => null);
            if (cached && now - cached.ts < 5 * 60 * 1000) {
              finalPrice = cached.price;
              finalTs = cached.ts;
            } else {
              staleTickers.push(ticker);
              return;
            }
          }

          // بررسی تازگی: باید کمتر از ۱۰ ثانیه قدیمی باشد
          if (now - finalTs > 10000) {
            staleTickers.push(ticker);
            return;
          }

          // بررسی اسپایک
          if (isSpike(ticker, finalPrice)) {
            staleTickers.push(ticker);
            return;
          }

          recordPrice(ticker, finalPrice);
          prices[ticker] = finalPrice;

          // به‌روزرسانی کش
          await kv.set(`price:${ticker}`, { price: finalPrice, ts: now }, { ex: 300 }).catch(() => {});
        } catch (err) {
          console.error(`[data-validator] خطا برای ${ticker}:`, err.message);
          staleTickers.push(ticker);
        }
      })
    );

    // حالت امن: بیش از ۵۰٪ سهام قدیمی
    if (staleTickers.length > tickers.length * 0.5) {
      safeMode = true;
      await sendTelegram(
        `⚠️ <b>هشدار APEX</b>\nحالت امن فعال شد!\nسهام قدیمی: ${staleTickers.join(', ')}\nتعداد: ${staleTickers.length}/${tickers.length}`
      );
    }

    return res.status(200).json({
      valid: !safeMode,
      prices,
      safeMode,
      staleTickers,
      partialOperation: staleTickers.length > 0 && !safeMode,
    });
  } catch (err) {
    console.error('[data-validator] خطای کلی:', err.message);
    return res.status(200).json({
      valid: false,
      prices: {},
      safeMode: true,
      staleTickers: [],
      partialOperation: false,
      error: err.message,
    });
  }
}
