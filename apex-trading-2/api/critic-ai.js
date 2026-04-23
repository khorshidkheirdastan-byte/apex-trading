// api/critic-ai.js
// هوش مصنوعی نقاد — بررسی ریسک معاملات MODERATE

import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const AI_TIMEOUT = parseInt(process.env.AI_MODEL_TIMEOUT || '5000');

const SIMILAR_REGIMES = {
  STRONG_BULL: ['WEAK_BULL'],
  WEAK_BULL: ['STRONG_BULL', 'SIDEWAYS'],
  SIDEWAYS: ['WEAK_BULL', 'WEAK_BEAR'],
  WEAK_BEAR: ['SIDEWAYS', 'STRONG_BEAR'],
  STRONG_BEAR: ['WEAK_BEAR'],
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const { decision, portfolio = {} } = req.body;
    const regime = portfolio.regime ?? 'WEAK_BULL';

    // دریافت بدترین معاملات از Supabase
    let worstTrades = [];
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      const { data } = await supabase
        .from('trades')
        .select('*')
        .eq('regime', regime)
        .order('loss_percent', { ascending: true })
        .limit(5);

      worstTrades = data ?? [];

      if (worstTrades.length < 3) {
        const similarRegimes = SIMILAR_REGIMES[regime] ?? [];
        const { data: extraData } = await supabase
          .from('trades')
          .select('*')
          .in('regime', similarRegimes)
          .order('loss_percent', { ascending: true })
          .limit(5 - worstTrades.length);
        worstTrades = [...worstTrades, ...(extraData ?? [])];
      }
    } catch (err) {
      console.error('[critic-ai] خطا در دریافت از Supabase:', err.message);
    }

    // تاریخچه نقدها
    let criticHistory = [];
    try {
      criticHistory = await kv.get('critic:history').catch(() => []) ?? [];
    } catch {}

    // فراخوانی Claude Haiku
    const prompt = `تصمیم معامله:
${JSON.stringify(decision, null, 2)}

بدترین معاملات مشابه:
${JSON.stringify(worstTrades.slice(0, 3), null, 2)}

تاریخچه نقدهای اخیر:
${JSON.stringify(criticHistory.slice(-3), null, 2)}

رژیم فعلی: ${regime}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

    let critique = null;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: 'You are a trading risk manager. Find reasons this trade could be WRONG. Learn from worst historical trades. Return JSON only with fields: red_flags (array), risk_score (0-100), verdict (PROCEED/CAUTION/ABORT), concerns (Persian string), recurring_pattern (Persian string or null)',
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json();
        const text = data?.content?.[0]?.text ?? '{}';
        const clean = text.replace(/```json|```/g, '').trim();
        critique = JSON.parse(clean);
      }
    } catch (err) {
      clearTimeout(timer);
      console.error('[critic-ai] خطای Anthropic:', err.message);
    }

    // پیش‌فرض در صورت خطا
    if (!critique) {
      critique = {
        red_flags: [],
        risk_score: 50,
        verdict: 'CAUTION',
        concerns: 'ارزیابی AI در دسترس نیست — احتیاط توصیه می‌شود',
        recurring_pattern: null,
      };
    }

    const amountMultiplier =
      critique.verdict === 'ABORT' ? 0 :
      critique.verdict === 'CAUTION' ? 0.6 : 1.0;

    const action =
      critique.verdict === 'ABORT' ? 'HOLD' :
      critique.verdict === 'CAUTION' ? 'PROCEED_REDUCED' : 'PROCEED';

    // ذخیره در تاریخچه (FIFO، حداکثر ۱۰۰)
    try {
      const updated = [
        ...criticHistory,
        { ...critique, decision: decision?.signal, ticker: decision?.ticker, ts: Date.now() },
      ].slice(-100);
      await kv.set('critic:history', updated).catch(() => {});
    } catch {}

    return res.status(200).json({
      action,
      amountMultiplier,
      concerns: critique.concerns,
      risk_score: critique.risk_score,
      recurring_pattern: critique.recurring_pattern,
      red_flags: critique.red_flags,
      verdict: critique.verdict,
    });
  } catch (err) {
    console.error('[critic-ai] خطای کلی:', err.message);
    return res.status(200).json({
      action: 'PROCEED_REDUCED',
      amountMultiplier: 0.6,
      concerns: 'خطا در ارزیابی ریسک — موقعیت کاهش یافت',
      risk_score: 60,
      recurring_pattern: null,
      red_flags: [],
      verdict: 'CAUTION',
    });
  }
}
