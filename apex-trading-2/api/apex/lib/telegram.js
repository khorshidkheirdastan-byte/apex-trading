// lib/telegram.js
// ارسال پیام از طریق تلگرام

export async function sendTelegram(msg) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.error('[Telegram] متغیرهای محیطی تنظیم نشده‌اند: TELEGRAM_BOT_TOKEN یا TELEGRAM_CHAT_ID');
      return { ok: false, error: 'متغیرهای محیطی یافت نشد' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: 'HTML',
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text().catch(() => 'خطای ناشناخته');
      console.error('[Telegram] خطا در ارسال پیام:', err);
      return { ok: false, error: err };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[Telegram] تایم‌اوت ارسال پیام');
      return { ok: false, error: 'تایم‌اوت' };
    }
    console.error('[Telegram] خطای غیرمنتظره:', err.message);
    return { ok: false, error: err.message };
  }
}
