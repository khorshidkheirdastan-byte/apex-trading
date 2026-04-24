export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { initialCapital = 10000 } = req.body;
    res.status(200).json({ success: true, message: "ACE با موفقیت راه‌اندازی شد", initialCapital });
  } catch(e) {
    res.status(200).json({ success: false, error: e.message });
  }
}
