// api/prices.js — Vercel Serverless Function
// دریافت قیمت real-time از Polygon.io

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY تنظیم نشده' });
  }

  const stockTickers = ['NVDA', 'TSLA', 'AAPL', 'META', 'SPY'];
  const cryptoTickers = ['BTC', 'GOLD'];

  try {
    const results = {};

    // قیمت سهام‌ها
    const stockPromises = stockTickers.map(async (ticker) => {
      try {
        const url = `https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${apiKey}`;
        const r = await fetch(url);
        const data = await r.json();
        if (data.results) {
          results[ticker] = {
            price: data.results.p,
            time: data.results.t,
            type: 'stock',
          };
        }
      } catch (e) {
        results[ticker] = { price: null, error: true, type: 'stock' };
      }
    });

    // قیمت BTC
    const btcPromise = fetch(
      `https://api.polygon.io/v1/last/crypto/BTC/USD?apiKey=${apiKey}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.last) {
          results['BTC'] = { price: data.last.price, type: 'crypto' };
        }
      })
      .catch(() => {
        results['BTC'] = { price: null, error: true, type: 'crypto' };
      });

    // قیمت GOLD (از forex endpoint)
    const goldPromise = fetch(
      `https://api.polygon.io/v1/last_quote/currencies/XAU/USD?apiKey=${apiKey}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.last) {
          results['GOLD'] = {
            price: data.last.ask,
            type: 'commodity',
          };
        }
      })
      .catch(() => {
        results['GOLD'] = { price: null, error: true, type: 'commodity' };
      });

    await Promise.all([...stockPromises, btcPromise, goldPromise]);

    return res.status(200).json({
      success: true,
      timestamp: Date.now(),
      prices: results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
