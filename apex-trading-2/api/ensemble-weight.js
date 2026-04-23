// api/ensemble-weight.js
// وزن‌دهی به مدل‌های AI بر اساس عملکرد تاریخی

import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

function calcProfitFactor(trades) {
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) grossProfit += t.pnl;
    else grossLoss += Math.abs(t.pnl);
  }
  if (grossLoss === 0) return grossProfit > 0 ? 2.0 : 1.0;
  return grossProfit / grossLoss;
}

function pfToWeight(pf) {
  if (pf > 2.0) return 2.0;
  if (pf >= 1.5) return 1.5;
  if (pf >= 1.0) return 1.0;
  return 0.5;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    // بررسی کش
    const cached = await kv.get('ensemble:weights').catch(() => null);
    if (cached?.updatedAt && Date.now() - cached.updatedAt < 3600 * 1000) {
      return res.status(200).json(cached);
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { data: trades, error } = await supabase
      .from('trades')
      .select('ai_model, pnl')
      .not('ai_model', 'is', null)
      .not('pnl', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const equalWeights = { claude: 1, deepseek: 1, grok: 1, gpt4o: 1 };

    if (!trades || trades.length < 50) {
      return res.status(200).json({
        weights: equalWeights,
        profitFactor_by_model: {},
        tradesAnalyzed: trades?.length ?? 0,
        message: 'داده کافی نیست — وزن‌های برابر استفاده می‌شود',
      });
    }

    // گروه‌بندی بر اساس مدل
    const byModel = {};
    for (const t of trades) {
      const model = t.ai_model?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'unknown';
      if (!byModel[model]) byModel[model] = [];
      byModel[model].push(t);
    }

    const weights = {};
    const pfByModel = {};

    for (const [model, modelTrades] of Object.entries(byModel)) {
      const pf = calcProfitFactor(modelTrades);
      pfByModel[model] = Math.round(pf * 100) / 100;
      weights[model] = pfToWeight(pf);
    }

    // اطمینان از وجود همه مدل‌های اصلی
    for (const m of ['claude', 'deepseek', 'grok', 'gpt4o']) {
      if (!(m in weights)) weights[m] = 1.0;
    }

    const result = {
      weights,
      profitFactor_by_model: pfByModel,
      tradesAnalyzed: trades.length,
      updatedAt: Date.now(),
    };

    await kv.set('ensemble:weights', result, { ex: 3600 }).catch(() => {});

    return res.status(200).json(result);
  } catch (err) {
    console.error('[ensemble-weight] خطا:', err.message);
    return res.status(200).json({
      weights: { claude: 1, deepseek: 1, grok: 1, gpt4o: 1 },
      profitFactor_by_model: {},
      tradesAnalyzed: 0,
      error: err.message,
    });
  }
}
