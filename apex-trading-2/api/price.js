// api/price.js - دریافت قیمت از Yahoo Finance (بدون نیاز به API key)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbol = (req.query?.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  // Map to Yahoo Finance symbols
  const yahooMap = { BTC: 'BTC-USD', GOLD: 'GC=F' };
  const yahooSymbol = yahooMap[symbol] || symbol;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price == null) throw new Error('price not found');
    return res.status(200).json({ symbol, price });
  } catch (err) {
    // Fallback: query2
    try {
      const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
      const r2 = await fetch(url2, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      const d2 = await r2.json();
      const price2 = d2?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price2 == null) throw new Error('price not found');
      return res.status(200).json({ symbol, price: price2 });
    } catch {
      return res.status(500).json({ error: `خطا در دریافت قیمت ${symbol}` });
    }
  }
}
