// api/ab-test.js
// مقایسه عملکرد استراتژی‌های Breakout و Pullback

import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { sendTelegram } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const { data: trades, error } = await supabase
      .from('trades')
      .select('strategy, pnl')
      .in('strategy', ['BREAKOUT', 'PULLBACK']);

    if (error) throw new Error(error.message);

    const breakoutTrades = (trades ?? []).filter((t) => t.strategy === 'BREAKOUT');
    const pullbackTrades = (trades ?? []).filter((t) => t.strategy === 'PULLBACK');

    if (breakoutTrades.length < 20 || pullbackTrades.length < 20) {
      return res.status(200).json({ message: 'تعداد معاملات کافی نیست' });
    }

    const winRate = (list) => {
      const wins = list.filter((t) => (t.pnl ?? 0) > 0).length;
      return Math.round((wins / list.length) * 100);
    };

    const breakoutWR = winRate(breakoutTrades);
    const pullbackWR = winRate(pullbackTrades);
    const diff = Math.abs(breakoutWR - pullbackWR);
    const winner = breakoutWR > pullbackWR ? 'BREAKOUT' : 'PULLBACK';

    const result = {
      breakoutWR,
      pullbackWR,
      winner: diff > 15 ? winner : null,
      diff,
      breakoutCount: breakoutTrades.length,
      pullbackCount: pullbackTrades.length,
      updatedAt: Date.now(),
    };

    await kv.set('abtest:results', result).catch(() => {});

    if (diff > 15) {
      const winnerFa = winner === 'BREAKOUT' ? 'شکست (Breakout)' : 'بازگشت (Pullback)';
      await sendTelegram(
        `🔬 <b>آزمایش A/B APEX</b>\n` +
        `شکست: ${breakoutWR}% | بازگشت: ${pullbackWR}%\n` +
        `برنده: ${winnerFa} (اختلاف ${diff}%)`
      );
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[ab-test] خطا:', err.message);
    return res.status(200).json({
      breakoutWR: 0,
      pullbackWR: 0,
      winner: null,
      diff: 0,
      error: err.message,
    });
  }
}
