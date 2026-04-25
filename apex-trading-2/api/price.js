// api/price.js
// Returns current price for a given ticker symbol
// Usage: /api/price?symbol=NVDA  or  /price/NVDA (via vercel.json rewrite)

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const FETCH_TIMEOUT = 5000;

async function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export default async function handler(req, res) {
  // Support both /api/price?symbol=NVDA and /price/NVDA (via rewrite)
  const url = req.url || "";
  let symbol = req.query?.symbol;

  // Extract from path if not in query: /price/NVDA → NVDA
  if (!symbol) {
    const match = url.match(/\/price\/([A-Z0-9]+)/i);
    if (match) symbol = match[1].toUpperCase();
  }

  if (!symbol) {
    return res.status(400).json({ error: "نماد مشخص نشده است. مثال: /api/price?symbol=NVDA" });
  }

  symbol = symbol.toUpperCase();

  // Map BTC and GOLD to Polygon-compatible tickers
  const tickerMap = {
    BTC: "X:BTCUSD",
    GOLD: "C:XAUUSD",
  };
  const polygonTicker = tickerMap[symbol] || symbol;

  try {
    if (!POLYGON_KEY) {
      // Fallback: try Yahoo Finance unofficial endpoint
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
      const r = await fetchWithTimeout(yahooUrl);
      const data = await r.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price == null) throw new Error("قیمت یافت نشد");
      return res.status(200).json({ symbol, price, source: "yahoo" });
    }

    // Use Polygon last trade
    const polyUrl = `https://api.polygon.io/v2/last/trade/${polygonTicker}?apiKey=${POLYGON_KEY}`;
    const r = await fetchWithTimeout(polyUrl);
    const data = await r.json();
    const price = data?.results?.p ?? data?.last?.price ?? null;

    if (price == null) {
      // Fallback to previous close
      const today = new Date().toISOString().split("T")[0];
      const aggUrl = `https://api.polygon.io/v2/aggs/ticker/${polygonTicker}/range/1/day/${today}/${today}?adjusted=true&apiKey=${POLYGON_KEY}`;
      const r2 = await fetchWithTimeout(aggUrl);
      const d2 = await r2.json();
      const closePrice = d2?.results?.[0]?.c ?? null;
      if (closePrice == null) throw new Error("قیمت از Polygon دریافت نشد");
      return res.status(200).json({ symbol, price: closePrice, source: "polygon_agg" });
    }

    return res.status(200).json({ symbol, price, source: "polygon" });

  } catch (err) {
    console.error(`[price] خطا برای ${symbol}:`, err.message);
    return res.status(500).json({ error: `خطا در دریافت قیمت ${symbol}: ${err.message}` });
  }
}
