import { safeKVGet, safeKVSet } from '../lib/safe-kv.js';

export default async function handler(req, res) {
  try {
    const cached = await safeKVGet('regime:current', null);
    if (cached && cached.updatedAt > Date.now() - 3600000) return res.status(200).json(cached);
    const result = { regime: 'WEAK_BULL', updatedAt: Date.now(), settings: { kellyFraction: 0.25, maxPos: 30, breakout: true, pullback: true, inverse: false, sizeMultiplier: 0.8 } };
    await safeKVSet('regime:current', result);
    res.status(200).json(result);
  } catch(e) {
    res.status(200).json({ regime: 'WEAK_BULL', settings: { kellyFraction: 0.25, maxPos: 30, breakout: true, pullback: true, inverse: false, sizeMultiplier: 0.8 } });
  }
}
