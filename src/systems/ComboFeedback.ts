/** Presentation tiers are separate from the existing score multiplier. */
export function comboFeedback(combo: number) {
  const tier = combo >= 10 ? 10 : combo >= 8 ? 8 : combo >= 5 ? 5 : combo >= 3 ? 3 : 0;
  const extra = tier === 10 ? Math.min(10, Math.max(0, combo - 10)) : 0;
  return {
    tier,
    scale: (tier === 10 ? 1.28 : tier === 8 ? 1.22 : tier === 5 ? 1.16 : tier === 3 ? 1.08 : 1) + extra * 0.007,
    particles: (tier === 10 ? 18 : tier === 8 ? 13 : tier === 5 ? 8 : tier === 3 ? 3 : 0) + extra,
    shake: (tier === 10 ? 2.1 : tier === 8 ? 1.5 : tier === 5 ? 0.9 : 0) + extra * 0.06,
    pitch: (tier === 10 ? 1.55 : tier === 8 ? 1.4 : tier === 5 ? 1.23 : tier === 3 ? 1.1 : 1) + extra * 0.015,
    duration: 220,
  };
}
