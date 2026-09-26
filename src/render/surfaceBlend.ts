/**
 * AREA 1's surface backdrop -- sky, horizon and ruins above the shaft -- and how it hands over to
 * the underground painting as the run goes down. Measured on the run's TOTAL depth, so a SECTION
 * change never brings the sky back: full surface to 120m, a smoothstep crossfade over 120-220m,
 * underground from 220m. AREA 1 only.
 */
export const SURFACE_BLEND = { holdTo: 120, fadeTo: 220, alpha: 0.77 } as const;

/** 1 = all surface, 0 = all underground. */
export function surfaceWeight(totalDepth: number, area: number | 'boss') {
  if (area !== 1) return 0;
  const t = Math.min(1, Math.max(0, (totalDepth - SURFACE_BLEND.holdTo) / (SURFACE_BLEND.fadeTo - SURFACE_BLEND.holdTo)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The two layers' alphas for a weight. The surface is drawn OVER the underground, so the lower
 * layer's alpha is compensated for what the upper one already covers -- otherwise the crossfade
 * sinks darker at its midpoint than at either end.
 */
export function surfaceLayerAlphas(weight: number, undergroundAlpha: number) {
  const surface = SURFACE_BLEND.alpha * weight;
  const underground = surface >= 1 ? 0 : undergroundAlpha * (1 - weight) / (1 - surface);
  return { surface, underground };
}
