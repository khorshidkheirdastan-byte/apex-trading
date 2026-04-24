export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { tickers = [] } = req.body;
    const prices = {};
    const staleTickers = [];
    await Promise.all(tickers.map(async (t) => {
      try {
        const r = await fetch(`https://data.alpaca.markets/v2/stocks/${t}/trades/latest`, {
          headers: { 'APCA-API-KEY-ID': process.env.ALPACA_KEY, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET },
          signal: AbortSignal.timeout(2000)
        });
        const d = await r.json();
        if (d.trade?.p) prices[t] = { price: d.trade.p, timestamp: Date.now() };
        else staleTickers.push(t);
      } catch(e) { staleTickers.push(t); }
    }));
    const safeMode = staleTickers.length > tickers.length * 0.5;
    res.status(200).json({ valid: !safeMode, prices, safeMode, staleTickers, partialOperation: staleTickers.length > 0 && !safeMode });
  } catch(e) {
    res.status(200).json({ valid: false, prices: {}, safeMode: true, staleTickers: [], partialOperation: false });
  }
}
