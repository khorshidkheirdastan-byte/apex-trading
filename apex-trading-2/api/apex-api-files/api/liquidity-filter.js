// api/liquidity-filter.js
// فیلتر نقدینگی برای تایید معامله‌پذیری سهام

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const { ticker, prices = {} } = req.body;
    const price = prices[ticker];

    if (!price) {
      return res.status(200).json({
        approved: false,
        reason: `قیمتی برای ${ticker} یافت نشد`,
        positionMultiplier: 0,
        volume: 0,
        spread: 0,
      });
    }

    // دریافت حجم ۲۰ روزه از Polygon
    const POLYGON_KEY = process.env.POLYGON_API_KEY;
    const FETCH_TIMEOUT = parseInt(process.env.DATA_FETCH_TIMEOUT || '2000');

    let avgVolume20 = 0;
    let spread = 0.001; // پیش‌فرض ۰.۱٪

    try {
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=25&apiKey=${POLYGON_KEY}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (r.ok) {
        const data = await r.json();
        if (data?.results?.length) {
          const vols = data.results.map((b) => b.v).slice(-20);
          avgVolume20 = vols.reduce((a, b) => a + b, 0) / vols.length;

          // برآورد اسپرد از OHLC
          const last = data.results[data.results.length - 1];
          if (last) {
            spread = ((last.h - last.l) / last.c) * 0.1; // تخمین محافظه‌کارانه
          }
        }
      }
    } catch (err) {
      console.error(`[liquidity-filter] خطا در دریافت حجم ${ticker}:`, err.message);
    }

    // بررسی حجم
    if (avgVolume20 < 500000) {
      return res.status(200).json({
        approved: false,
        reason: `حجم معاملات ناکافی: ${Math.round(avgVolume20).toLocaleString()} (حداقل ۵۰۰,۰۰۰)`,
        positionMultiplier: 0,
        volume: avgVolume20,
        spread,
      });
    }

    // بررسی قیمت پایین
    if (price < 2) {
      return res.status(200).json({
        approved: false,
        reason: `قیمت خیلی پایین: $${price} (حداقل $۲)`,
        positionMultiplier: 0,
        volume: avgVolume20,
        spread,
      });
    }

    // بررسی اسپرد
    if (spread > 0.003) {
      return res.status(200).json({
        approved: false,
        reason: `اسپرد بسیار بالا: ${(spread * 100).toFixed(2)}% (حداکثر ۰.۳٪)`,
        positionMultiplier: 0,
        volume: avgVolume20,
        spread,
      });
    }

    // قیمت بالا: ضریب کاهش موقعیت
    let positionMultiplier = 1.0;
    let reason = 'تایید شد';

    if (price > 500) {
      positionMultiplier = 0.5;
      reason = `تایید با ضریب ۰.۵ (قیمت بالا: $${price})`;
    }

    return res.status(200).json({
      approved: true,
      reason,
      positionMultiplier,
      volume: avgVolume20,
      spread,
    });
  } catch (err) {
    console.error('[liquidity-filter] خطای کلی:', err.message);
    return res.status(200).json({
      approved: false,
      reason: 'خطای سیستم در فیلتر نقدینگی',
      positionMultiplier: 0,
      volume: 0,
      spread: 0,
    });
  }
}
