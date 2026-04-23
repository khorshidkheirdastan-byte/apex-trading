// api/weekly-report.js
// گزارش هفتگی عملکرد — هر ۲۰۱۶ چرخه پایپلاین

import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { sendTelegram } from '../lib/telegram.js';
import { Resend } from 'resend';

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const AI_TIMEOUT = parseInt(process.env.AI_MODEL_TIMEOUT || '5000');

async function askClaude(prompt) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await response.json();
    return data?.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'متد مجاز نیست' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // دریافت معاملات ۷ روز اخیر
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .gte('created_at', since);

    if (error) throw new Error(error.message);
    const tradeList = trades ?? [];

    if (tradeList.length === 0) {
      return res.status(200).json({ success: false, message: 'هیچ معامله‌ای در هفته گذشته ثبت نشده', winRate: 0, trades: 0 });
    }

    // محاسبه آمار
    const winners = tradeList.filter((t) => (t.pnl ?? 0) > 0);
    const winRate = Math.round((winners.length / tradeList.length) * 100);
    const totalPnl = tradeList.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const bestTrade = tradeList.reduce((a, b) => ((a.pnl ?? 0) > (b.pnl ?? 0) ? a : b), tradeList[0]);
    const worstTrade = tradeList.reduce((a, b) => ((a.pnl ?? 0) < (b.pnl ?? 0) ? a : b), tradeList[0]);

    // درخواست پیشنهاد بهبود از Claude
    const suggestion = await askClaude(
      `بر اساس داده‌های معاملاتی هفته گذشته:\n- تعداد کل: ${tradeList.length}\n- نرخ برد: ${winRate}%\n- سود/زیان کل: $${totalPnl.toFixed(2)}\n- بهترین معامله: ${bestTrade.ticker ?? '?'} ($${(bestTrade.pnl ?? 0).toFixed(2)})\n- بدترین معامله: ${worstTrade.ticker ?? '?'} ($${(worstTrade.pnl ?? 0).toFixed(2)})\n\nیک پیشنهاد بهبود مشخص برای هفته آینده در یک جمله فارسی بنویس.`
    ) ?? 'بهبود مدیریت ریسک و کاهش موقعیت‌های ضعیف';

    // ذخیره در KV
    await kv.set('weekly:improvement', { suggestion, updatedAt: Date.now() }).catch(() => {});

    // ارسال ایمیل با Resend
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'APEX Trading <noreply@apex-trading-zeta.vercel.app>',
        to: process.env.NOTIFY_EMAIL,
        subject: `📊 گزارش هفتگی APEX`,
        html: `
          <div dir="rtl" style="font-family: Tahoma, sans-serif; padding: 20px;">
            <h2>📊 گزارش هفتگی APEX</h2>
            <table style="width:100%; border-collapse:collapse;">
              <tr><td>تعداد معاملات</td><td>${tradeList.length}</td></tr>
              <tr><td>نرخ برد</td><td>${winRate}%</td></tr>
              <tr><td>سود/زیان کل</td><td>$${totalPnl.toFixed(2)}</td></tr>
              <tr><td>بهترین معامله</td><td>${bestTrade.ticker ?? '?'}: $${(bestTrade.pnl ?? 0).toFixed(2)}</td></tr>
              <tr><td>بدترین معامله</td><td>${worstTrade.ticker ?? '?'}: $${(worstTrade.pnl ?? 0).toFixed(2)}</td></tr>
            </table>
            <h3>💡 پیشنهاد هفته آینده</h3>
            <p>${suggestion}</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[weekly-report] خطای ایمیل:', emailErr.message);
    }

    // ارسال پیام تلگرام
    await sendTelegram(
      `📊 <b>گزارش هفتگی APEX</b>\n` +
      `معاملات: ${tradeList.length} | برد: ${winRate}%\n` +
      `P&L: $${totalPnl.toFixed(2)}\n` +
      `💡 ${suggestion}`
    );

    return res.status(200).json({ success: true, winRate, trades: tradeList.length, totalPnl, suggestion });
  } catch (err) {
    console.error('[weekly-report] خطا:', err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
}
