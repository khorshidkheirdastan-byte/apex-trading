// api/trade.js — Vercel Serverless Function
// اتصال به Alpaca Paper Trading

const ALPACA_BASE = 'https://paper-api.alpaca.markets/v2';

async function alpacaFetch(path, options = {}) {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;

  if (!key || !secret) {
    throw new Error('ALPACA_KEY یا ALPACA_SECRET تنظیم نشده');
  }

  const response = await fetch(`${ALPACA_BASE}${path}`, {
    ...options,
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Alpaca Error: ${err}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // GET /api/trade?action=portfolio
    if (req.method === 'GET' && action === 'portfolio') {
      const [account, positions] = await Promise.all([
        alpacaFetch('/account'),
        alpacaFetch('/positions'),
      ]);

      return res.status(200).json({
        cash: parseFloat(account.cash),
        equity: parseFloat(account.equity),
        buyingPower: parseFloat(account.buying_power),
        positions: positions.map((p) => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty),
          avgEntry: parseFloat(p.avg_entry_price),
          currentPrice: parseFloat(p.current_price),
          marketValue: parseFloat(p.market_value),
          unrealizedPL: parseFloat(p.unrealized_pl),
          unrealizedPLPercent: parseFloat(p.unrealized_plpc) * 100,
        })),
      });
    }

    // GET /api/trade?action=history
    if (req.method === 'GET' && action === 'history') {
      const orders = await alpacaFetch('/orders?status=filled&limit=50');
      return res.status(200).json(
        orders.map((o) => ({
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          qty: parseFloat(o.qty),
          filledPrice: parseFloat(o.filled_avg_price),
          filledAt: o.filled_at,
          status: o.status,
        }))
      );
    }

    // POST /api/trade?action=buy
    if (req.method === 'POST' && action === 'buy') {
      const { symbol, qty, type = 'market' } = req.body;
      if (!symbol || !qty) return res.status(400).json({ error: 'symbol و qty الزامی هستند' });

      const order = await alpacaFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          qty: String(qty),
          side: 'buy',
          type,
          time_in_force: 'day',
        }),
      });

      return res.status(200).json({ success: true, order });
    }

    // POST /api/trade?action=sell
    if (req.method === 'POST' && action === 'sell') {
      const { symbol, qty } = req.body;
      if (!symbol || !qty) return res.status(400).json({ error: 'symbol و qty الزامی هستند' });

      const order = await alpacaFetch('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          qty: String(qty),
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        }),
      });

      return res.status(200).json({ success: true, order });
    }

    return res.status(404).json({ error: 'action نامعتبر است' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
