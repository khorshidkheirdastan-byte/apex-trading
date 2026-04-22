// lib/helpers.js
// توابع کمکی برای دریافت داده‌های بازار

import { kv } from '@vercel/kv';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

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

// بررسی ثبات SPY در بازه زمانی مشخص
export async function checkSPYStable(minutes = 3, threshold = 0.5) {
  try {
    const to = Date.now();
    const from = to - minutes * 60 * 1000;
    const fromStr = new Date(from).toISOString();
    const toStr = new Date(to).toISOString();

    const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);

    if (!data?.results?.length) return true; // در صورت عدم دریافت داده، فرض بر ثبات
    const prices = data.results.map((r) => r.c);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = ((max - min) / min) * 100;
    return range < threshold;
  } catch (err) {
    console.error('[helpers] checkSPYStable خطا:', err.message);
    return true; // خطا = فرض بر ثبات
  }
}

// دریافت قیمت فعلی یک سهم
export async function getCurrentPrice(ticker) {
  try {
    const url = `https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);
    return data?.results?.p ?? null;
  } catch (err) {
    console.error(`[helpers] getCurrentPrice خطا برای ${ticker}:`, err.message);
    return null;
  }
}

// دریافت قیمت تاریخی بر اساس ثانیه‌های گذشته
export async function getHistoricalPrice(ticker, secondsAgo) {
  try {
    const date = new Date(Date.now() - secondsAgo * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${dateStr}/${dateStr}?adjusted=true&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);
    return data?.results?.[0]?.c ?? null;
  } catch (err) {
    console.error(`[helpers] getHistoricalPrice خطا برای ${ticker}:`, err.message);
    return null;
  }
}

// محاسبه بازده ۳۰ روزه SPY با کش
export async function getSpyReturn30d() {
  try {
    const cacheKey = 'spy:return:30d';
    const cached = await kv.get(cacheKey).catch(() => null);
    if (cached !== null && cached !== undefined) return cached;

    const to = new Date();
    const from = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=40&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);

    if (!data?.results?.length || data.results.length < 2) return 0;

    const results = data.results;
    const startPrice = results[0].c;
    const endPrice = results[results.length - 1].c;
    const returnPct = ((endPrice - startPrice) / startPrice) * 100;

    await kv.set(cacheKey, returnPct, { ex: 3600 }).catch(() => {});
    return returnPct;
  } catch (err) {
    console.error('[helpers] getSpyReturn30d خطا:', err.message);
    return 0;
  }
}

// محاسبه ریسک کل پرتفولیو
export function calculateTotalRisk(holdings = []) {
  try {
    return holdings.reduce((sum, h) => {
      const risk = typeof h.riskPercent === 'number' ? h.riskPercent : 0.02;
      return sum + risk;
    }, 0);
  } catch (err) {
    console.error('[helpers] calculateTotalRisk خطا:', err.message);
    return 0;
  }
}

// انتخاب پوزیشن‌هایی که باید بسته شوند تا ریسک کاهش یابد
export function selectPositionsToClose(holdings = [], currentRisk, targetRisk) {
  try {
    if (currentRisk <= targetRisk) return [];
    const sorted = [...holdings].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    const toClose = [];
    let risk = currentRisk;

    for (const h of sorted) {
      if (risk <= targetRisk) break;
      toClose.push(h);
      risk -= typeof h.riskPercent === 'number' ? h.riskPercent : 0.02;
    }

    return toClose;
  } catch (err) {
    console.error('[helpers] selectPositionsToClose خطا:', err.message);
    return [];
  }
}

// محاسبه درصد پرتفولیو در یک بخش خاص
export function getSectorExposure(portfolio = [], sector) {
  try {
    const total = portfolio.reduce((s, h) => s + (h.value ?? 0), 0);
    if (total === 0) return 0;
    const sectorVal = portfolio
      .filter((h) => h.sector === sector)
      .reduce((s, h) => s + (h.value ?? 0), 0);
    return (sectorVal / total) * 100;
  } catch (err) {
    console.error('[helpers] getSectorExposure خطا:', err.message);
    return 0;
  }
}
