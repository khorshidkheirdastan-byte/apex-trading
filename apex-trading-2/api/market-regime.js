export default async function handler(req, res) {
  res.status(200).json({ regime: "WEAK_BULL", updatedAt: Date.now(), settings: { kellyFraction: 0.25, maxPos: 30, breakout: true, pullback: true, inverse: false, sizeMultiplier: 0.8 } });
}
