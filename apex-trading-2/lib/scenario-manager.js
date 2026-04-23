// lib/scenario-manager.js
// مدیریت تقسیم هوشمند سناریو (Smart Split)

import { kv } from '@vercel/kv';

export async function smartSplit(sA, sB, currentPrices = {}) {
  const lockKey = `split:lock:${sA.id}`;

  // قفل توزیع‌شده با NX
  let lockAcquired = false;
  try {
    const result = await kv.set(lockKey, Date.now(), { nx: true, ex: 30 });
    lockAcquired = !!result;
  } catch (err) {
    console.error('[scenario-manager] خطا در قفل:', err.message);
  }

  if (!lockAcquired) {
    // انتظار ۵ ثانیه و بررسی مجدد
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const stillActive =
        sA.status === 'ACTIVE' &&
        sA.value >= sA.splitTarget;
      if (!stillActive) {
        return { skipped: true, reason: 'تقسیم دیگر لازم نیست' };
      }
    } catch {}
    return { skipped: true, reason: 'قفل در دسترس نیست' };
  }

  try {
    const holdings = sA.holdings ?? [];

    // جداسازی سودده و زیان‌ده
    const profitable = [];
    const losing = [];

    for (const h of holdings) {
      const currentPrice = currentPrices[h.ticker] ?? h.currentPrice ?? h.avgPrice;
      if (currentPrice > h.avgPrice) {
        profitable.push({ ...h, currentPrice });
      } else {
        losing.push({ ...h, currentPrice });
      }
    }

    // سیگنال‌های فروش برای پوزیشن‌های ضرردهنده
    const sellSignals = losing.map((h) => ({
      action: 'SELL',
      ticker: h.ticker,
      reason: 'تقسیم هوشمند — بستن موقعیت ضرردهنده',
      limitPrice: (h.currentPrice ?? h.avgPrice) * 0.999,
    }));

    const totalCash = sA.cash ?? 0;
    const halfCash = totalCash / 2;

    // سناریو A: موقعیت‌های سودده + نیمی از نقدینگی
    const updatedSA = {
      ...sA,
      holdings: profitable,
      cash: halfCash,
    };

    // سناریو B: بدون موقعیت + نیمی از نقدینگی (شروع تازه، بخش متفاوت)
    const updatedSB = {
      ...sB,
      holdings: [],
      cash: halfCash,
    };

    // ذخیره موقعیت‌های A در KV تا B دوباره نخرد
    const sAAvoid = profitable.map((h) => h.ticker);
    await kv.set(`scenario:${sA.id}:avoid`, sAAvoid, { ex: 86400 }).catch(() => {});

    return {
      sA: updatedSA,
      sB: updatedSB,
      sellSignals,
      splitType: 'smart',
      profitableCount: profitable.length,
      losingCount: losing.length,
    };
  } catch (err) {
    console.error('[scenario-manager] خطا در تقسیم:', err.message);
    return { skipped: true, error: err.message };
  } finally {
    // آزاد کردن قفل
    await kv.del(lockKey).catch(() => {});
  }
}
