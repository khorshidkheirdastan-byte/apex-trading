export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'ANTHROPIC_KEY تنظیم نشده' });

  try {
    const { prices, portfolio } = req.body;

    const prompt = `قیمت‌های فعلی:
${Object.entries(prices || {}).map(([s, d]) => `${s}: $${d.price || '?'}`).join('\n')}

یک تصمیم بگیر. فقط JSON:
{"asset":"NVDA","action":"BUY","reasoning":"توضیح فارسی"}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ success: false, error: data.error?.message });

    const text = data.content?.[0]?.text?.trim() || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const decision = JSON.parse(clean);

    return res.status(200).json({ success: true, decision });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
