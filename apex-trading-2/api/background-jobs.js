// api/background-jobs.js
// جاب‌های پس‌زمینه — هر ۳۰ دقیقه از طریق Vercel Cron

import { kv } from '@vercel/kv';
import { sendTelegram } from '../lib/telegram.js';
import { getCurrentPrice } from '../lib/helpers.js';

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

const WATCHED_TICKERS = ['NVDA', 'SPY', 'TSLA', 'META', 'AMD', 'AAPL', 'PLTR'];

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

async function fetchBars(ticker, days = 30) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=35&apiKey=${POLYGON_KEY}`;
  return fetchWithTimeout(url);
}

// ۱. پروفایل حجم
async function jobVolumeProfile() {
  for (const ticker of WATCHED_TICKERS) {
    try {
      const data = await fetchBars(ticker, 30);
      if (!data?.results?.length) continue;
      const vols = data.results.map((b) => b.v);
      const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
      await kv.set(`vp:${ticker}`, { avgVolume: avgVol, updatedAt: Date.now() }, { ex: 3600 }).catch(() => {});
    } catch (err) {
      console.error(`[bg-jobs] volumeProfile خطا برای ${ticker}:`, err.message);
    }
  }
  return 'پروفایل حجم به‌روز شد';
}

// ۲. تحلیل بین‌بازاری
async function jobIntermarket() {
  const interTickers = { DXY: 'UUP', TLT: 'TLT', GLD: 'GLD' };
  const prices = {};

  for (const [name, ticker] of Object.entries(interTickers)) {
    try {
      const p = await getCurrentPrice(ticker);
      prices[name] = p;
    } catch {}
  }

  // اگر TLT بالا و DXY پایین → RISK_ON، در غیر این صورت → RISK_OFF
  let sentiment = 'NEUTRAL';
  try {
    const tltData = await fetchBars('TLT', 5);
    const dxyData = await fetchBars('UUP', 5);
    if (tltData?.results?.length >= 2 && dxyData?.results?.length >= 2) {
      const tltChange = (tltData.results.at(-1).c - tltData.results[0].c) / tltData.results[0].c;
      const dxyChange = (dxyData.results.at(-1).c - dxyData.results[0].c) / dxyData.results[0].c;
      sentiment = tltChange > 0 && dxyChange < 0 ? 'RISK_ON' : 'RISK_OFF';
    }
  } catch {}

  await kv.set('intermarket:latest', { sentiment, prices, updatedAt: Date.now() }, { ex: 7200 }).catch(() => {});
  return `تحلیل بین‌بازاری: ${sentiment}`;
}

// ۳. تشخیص قوی‌ترین خطر (Black Swan)
async function jobBlackSwan() {
  let score = 0;
  const signals = [];

  try {
    // SPY -۳٪
    const spyData = await fetchBars('SPY', 2);
    if (spyData?.results?.length >= 2) {
      const spyChange = (spyData.results.at(-1).c - spyData.results.at(-2).c) / spyData.results.at(-2).c * 100;
      if (spyChange <= -3) { score += 30; signals.push(`SPY: ${spyChange.toFixed(1)}%`); }
    }

    // VIX
    const vixData = await fetchBars('VIXY', 2); // VIXY به عنوان پروکسی VIX
    if (vixData?.results?.length >= 2) {
      const vixChange = (vixData.results.at(-1).c - vixData.results.at(-2).c) / vixData.results.at(-2).c * 100;
      if (vixChange >= 30) { score += 30; signals.push(`VIX اسپایک: ${vixChange.toFixed(1)}%`); }
      if (vixData.results.at(-1).c > 35) { score += 20; signals.push('VIX > 35'); }
    }

    // ۵+ سهام در حال افت
    let fallingCount = 0;
    for (const ticker of ['NVDA', 'TSLA', 'META', 'AMD', 'AAPL', 'PLTR', 'MSFT']) {
      try {
        const d = await fetchBars(ticker, 2);
        if (d?.results?.length >= 2) {
          const chg = (d.results.at(-1).c - d.results.at(-2).c) / d.results.at(-2).c * 100;
          if (chg < -2) fallingCount++;
        }
      } catch {}
    }
    if (fallingCount >= 5) { score += 20; signals.push(`${fallingCount} سهام در حال افت`); }
  } catch (err) {
    console.error('[bg-jobs] blackSwan خطا:', err.message);
  }

  const level = score < 30 ? 'NORMAL' : score <= 50 ? 'WARNING' : 'CRITICAL';
  await kv.set('blackswan:status', { level, score, signals, updatedAt: Date.now() }, { ex: 7200 }).catch(() => {});

  if (level === 'WARNING' || level === 'CRITICAL') {
    await sendTelegram(
      `🚨 <b>APEX هشدار Black Swan</b>\nسطح: ${level}\nامتیاز: ${score}\nسیگنال‌ها: ${signals.join(' | ')}`
    );
  }

  return `Black Swan: ${level} (${score})`;
}

// ۴. ریست روزانه ساعت ۱۳:۳۰ UTC = ۹:۳۰ AM ET
async function jobDailyReset() {
  const now = new Date();
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();

  if (hour === 13 && min < 30) {
    const today = now.toISOString().split('T')[0];
    await kv.del(`daily:loss:${today}`).catch(() => {});
    await kv.set('stops:streak', 0, { ex: 300 }).catch(() => {});
    return 'ریست روزانه انجام شد';
  }
  return 'زمان ریست نرسیده';
}

// ۵. تشخیص سقوط آنی (Flash Crash)
async function jobFlashCrash() {
  try {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/minute/${from}/${to}?adjusted=true&sort=asc&limit=10&apiKey=${POLYGON_KEY}`;
    const data = await fetchWithTimeout(url);

    if (!data?.results?.length || data.results.length < 2) return 'داده کافی نیست';

    const first = data.results[0].o;
    const last = data.results.at(-1).c;
    const drop = (last - first) / first * 100;

    if (drop <= -2) {
      await kv.set('flashCrash:mode', { ts: Date.now(), drop }, { ex: 1800 }).catch(() => {});
      await sendTelegram(`⚡ <b>APEX سقوط آنی</b>\nSPY: ${drop.toFixed(2)}% در ۵ دقیقه\nمعاملات متوقف شد.`);
      return `سقوط آنی شناسایی شد: ${drop.toFixed(2)}%`;
    }
    return `SPY پایدار: ${drop.toFixed(2)}%`;
  } catch (err) {
    return `خطا: ${err.message}`;
  }
}

// ۶. به‌روزرسانی اکسپوژر بخش‌ها
async function jobSectorExposure() {
  try {
    const holdings = await kv.get('portfolio:holdings').catch(() => []) || [];
    const sectorMap = {};
    let total = 0;

    for (const h of holdings) {
      const val = h.value ?? 0;
      total += val;
      const sector = h.sector ?? 'نامشخص';
      sectorMap[sector] = (sectorMap[sector] ?? 0) + val;
    }

    const exposure = {};
    for (const [sector, val] of Object.entries(sectorMap)) {
      exposure[sector] = total > 0 ? (val / total) * 100 : 0;
    }

    await kv.set('sectors:exposure', { exposure, updatedAt: Date.now() }, { ex: 3600 }).catch(() => {});
    return 'اکسپوژر بخش‌ها به‌روز شد';
  } catch (err) {
    return `خطا: ${err.message}`;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  const jobs_completed = [];
  const errors = [];

  const run = async (name, fn) => {
    try {
      const result = await fn();
      jobs_completed.push({ name, result });
    } catch (err) {
      errors.push({ name, error: err.message });
    }
  };

  await run('volumeProfile', jobVolumeProfile);
  await run('intermarket', jobIntermarket);
  await run('blackSwan', jobBlackSwan);
  await run('dailyReset', jobDailyReset);
  await run('flashCrash', jobFlashCrash);
  await run('sectorExposure', jobSectorExposure);

  return res.status(200).json({
    jobs_completed,
    errors,
    next_run: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
}
