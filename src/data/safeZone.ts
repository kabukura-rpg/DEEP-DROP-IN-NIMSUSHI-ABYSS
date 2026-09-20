import type { GunModuleBonus, GunModuleId } from './gunModules';

/**
 * A SAFE ZONE is a chamber cut into the side of the shaft -- a real place inside the SECTION, not a
 * screen. Standing in one stops the world outside it (see TIMEVOID in GameModel) while the player
 * keeps moving, jumping and shooting normally.
 *
 * Landing on its floor fills CHARGE and deliberately does NOT settle the chain: a chamber is
 * shelter, not the ground a chain is banked on. That distinction is the whole reason `reloadCharge`
 * and `settleCombo` are separate calls.
 */
export type SafeZoneContentKind = 'gunModule' | 'shop' | 'coinVein';

export interface SafeZoneContent {
  kind: SafeZoneContentKind;
  /** Only for `gunModule`: which weapon is waiting, and what rides along with it. */
  module?: GunModuleId;
  bonus?: GunModuleBonus;
}

export interface SafeZone {
  id: number;
  /** Which wall it is cut into: -1 the left, 1 the right. */
  side: -1 | 1;
  /** The chamber itself. Its bottom edge is the floor the player lands on. */
  x: number; y: number; width: number; height: number;
  content: SafeZoneContent | null;
  /** True once the content has been used up; a SHOP is never "taken" and stays usable. */
  taken: boolean;
}

export const SAFE_ZONE_RULES = {
  /** Chamber footprint. Wide enough to move and jump in, far short of blocking the shaft. */
  width: 150,
  height: 116,
  /** Thickness of the floor slab the chamber stands on. */
  floorHeight: 14,
  /**
   * How the single content slot is filled. Weights, not probabilities, so adding a fourth kind
   * later is one line. PROVISIONAL: the original's rates are not measured, and this phase is about
   * the slot existing rather than about how often each thing shows up.
   */
  contentWeights: { gunModule: 3, shop: 2, coinVein: 3 } as Record<SafeZoneContentKind, number>,
  /**
   * What a COIN VEIN pays. PROVISIONAL: the original pays Gems and DEEP DROP's COIN is a different
   * currency, so this is set to "a useful but not run-defining handful" and re-tuned in the Phase
   * that aligns the economy.
   */
  coinVein: { coins: 12, width: 34, height: 40 },
  /** Metres of clearance kept between a chamber and the SECTION's opening or its exit. */
  depthMargin: 30,
} as const;

/** Pick the one thing waiting in a chamber. */
export function rollSafeZoneContent(random: () => number): SafeZoneContentKind {
  const kinds = Object.keys(SAFE_ZONE_RULES.contentWeights) as SafeZoneContentKind[];
  const total = kinds.reduce((sum, kind) => sum + SAFE_ZONE_RULES.contentWeights[kind], 0);
  let roll = random() * total;
  for (const kind of kinds) { roll -= SAFE_ZONE_RULES.contentWeights[kind]; if (roll <= 0) return kind; }
  return kinds[kinds.length - 1];
}

/** The floor slab a chamber stands on, as a rectangle. */
export const safeZoneFloor = (zone: SafeZone) => ({
  x: zone.x, y: zone.y + zone.height, width: zone.width, height: SAFE_ZONE_RULES.floorHeight,
});
/** True when a point (the player's centre) is inside the chamber. */
export const insideSafeZone = (zone: SafeZone, x: number, y: number) =>
  x > zone.x && x < zone.x + zone.width && y > zone.y - 4 && y < zone.y + zone.height + 2;
