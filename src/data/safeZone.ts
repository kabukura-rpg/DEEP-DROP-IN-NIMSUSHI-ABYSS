import { COIN_VALUES } from './coins';
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
   * later is one line. PROVISIONAL: the original's rates are not measured. These three are the only
   * places a run finds a weapon, a shop or a vein, so the split decides how a run is supplied --
   * MEASUREMENT REQUIRED.
   */
  contentWeights: { gunModule: 3, shop: 2, coinVein: 3 } as Record<SafeZoneContentKind, number>,
  /**
   * What a COIN VEIN pays, and in what. Sources on the original disagree between roughly 120 and
   * 100 gems, so 120 is taken as the working figure -- MEASUREMENT REQUIRED, and it must not be
   * reported as a confirmed original value.
   *
   * It is paid as a spill of real coins rather than credited to the wallet, so mining one is worth
   * exactly as much as the player manages to sweep up. Both sizes are in the mix so the haul reads
   * as a haul; `coinVeinTotal` checks the split still adds up to `value`.
   */
  coinVein: { value: 120, payout: { large: 10, small: 10 }, width: 34, height: 40 },
  /** Metres of clearance kept between a chamber and the SECTION's opening or its exit. */
  depthMargin: 30,
  /**
   * Seconds of THINKING time a chamber's mouth must still offer after the steering it takes to
   * reach it, counted only from the moment the mouth is on screen.
   *
   * A chamber that is geometrically reachable is not the same as one a player can decide to enter.
   * The camera shows 504px below the player, so a mouth is visible for part of the fall and no
   * longer; if all of that is spent steering, the only way in is to have known it was there. This
   * is the reserve that keeps "I saw it, so I went" possible, and it is checked against the real
   * fall curve rather than terminal speed, because the fall is still accelerating.
   */
  reactionReserve: 0.15,
} as const;

/**
 * DEVELOPMENT A/B ONLY.
 *
 *   `legacy`  one chamber per SECTION -- the single guaranteed minimum every AREA shipped with
 *   `v1`      the SECTION's own `sideRooms` count, where it declares one
 *
 * Measured before this existed: a 240m SECTION is 7-11 screens and held exactly ONE chamber, whose
 * single content slot was contested three ways. A SECTION therefore showed a SHOP 27% of the time
 * and a GUN MODULE 35%, so across all of AREA 1 a run expected 0.81 shops and 39% of runs saw none
 * at all. That is what makes side content feel absent: not where the rooms are, but how few.
 *
 * Production never calls this. The only call site is behind `import.meta.env.DEV` in main.ts and the
 * default is the shipping behaviour.
 */
export type SideRoomMode = 'v1' | 'legacy';
let sideRoomMode: SideRoomMode = 'v1';
export const setSideRoomMode = (mode: SideRoomMode) => { sideRoomMode = mode; };
export const getSideRoomMode = () => sideRoomMode;

/**
 * DEVELOPMENT A/B/C ONLY: how often a SIDE CAVE turns up.
 *
 *   `low`       one per SECTION  -- three across AREA 1
 *   `variable`  one or two, 50/50, drawn per SECTION -- a mean of 1.5, so 4.5 across AREA 1
 *   `high`      two per SECTION  -- six across AREA 1, which is what the caves were built at
 *
 * The question this exists to answer is not how many there should be but whether finding one still
 * means anything. Too many and a cave is scenery; too few and the detour never comes up. Nothing
 * else moves with it: the shapes, the contents and the weights are the same in all three.
 *
 * Production never calls this -- the only call site is behind `import.meta.env.DEV` in main.ts.
 */
export type CaveFrequency = 'low' | 'variable' | 'high';
let caveFrequency: CaveFrequency = 'high';
export const setCaveFrequency = (mode: CaveFrequency) => { caveFrequency = mode; };
export const getCaveFrequency = () => caveFrequency;

/**
 * How many side rooms this SECTION is owed.
 *
 * An AREA that declares `sideRooms` is running caves, and its count comes from the frequency mode.
 * `roll` is a number the CALLER has already drawn from the cave's own stream: it is drawn in every
 * frequency and only read by `variable`, so all three consume the stream identically and a SECTION
 * puts the same cave in the same place whichever of them is running. Choosing a frequency changes
 * how many caves there are and nothing else at all.
 *
 * Everywhere else `safeZoneCount` is the floor it has always been, and `legacy` puts an AREA that
 * has caves back on the single chamber it had before them.
 */
export const sideRoomCount = (plan?: { safeZoneCount?: number; sideRooms?: number }, roll = 1) => {
  const floor = plan?.safeZoneCount ?? 0;
  if (sideRoomMode === 'legacy' || plan?.sideRooms === undefined) return floor;
  if (caveFrequency === 'low') return 1;
  if (caveFrequency === 'high') return Math.max(floor, plan.sideRooms);
  return roll < 0.5 ? 1 : Math.max(floor, plan.sideRooms);
};

/**
 * Where a SECTION's chambers may start. `count` is a GUARANTEED MINIMUM, not a quota: each depth is
 * the earliest metre a chamber may be cut at, and the generator keeps retrying rows past it until one
 * fits, so a SECTION cannot end up with none. They are spread evenly through the SECTION and kept
 * clear of both the opening and the exit.
 *
 * PROVISIONAL / MEASUREMENT REQUIRED: the original places chambers randomly down the well and its
 * real rate is not measured. One per SECTION is a floor that makes the supply loop work, and must
 * NOT be read as "the original always has exactly one". Optional extra chambers are a matter of
 * pushing further depths in here and changing nothing else.
 */
export function safeZoneDepths(count: number, sectionLength?: number): number[] {
  if (!sectionLength || count <= 0) return [];
  const usable = sectionLength - SAFE_ZONE_RULES.depthMargin * 2;
  if (usable <= 0) return [];
  return Array.from({ length: count }, (_, i) => SAFE_ZONE_RULES.depthMargin + usable * (i + 1) / (count + 1));
}

/**
 * The vertical room a chamber needs BETWEEN two route rows, in pixels: its own height and floor
 * slab, the 20px of slack the fit test keeps, and the margins the generator holds off the row above
 * (40px) and the row below (30px).
 *
 * The VERTICAL RHYTHM reads this so it never lays a row gap too tight to hold a chamber where one
 * is due. `safeZoneCount` is a guaranteed minimum, not a chance, and a rhythm that could squeeze
 * every candidate row would quietly turn it back into one -- a SECTION with no chamber is a SECTION
 * a run cannot be re-armed or re-supplied in.
 */
export const safeZoneRowClearance = (rules = SAFE_ZONE_RULES) => rules.height + rules.floorHeight + 20 + 40 + 30;

/** Pick the one thing waiting in a chamber. */
export function rollSafeZoneContent(random: () => number): SafeZoneContentKind {
  const kinds = Object.keys(SAFE_ZONE_RULES.contentWeights) as SafeZoneContentKind[];
  const total = kinds.reduce((sum, kind) => sum + SAFE_ZONE_RULES.contentWeights[kind], 0);
  let roll = random() * total;
  for (const kind of kinds) { roll -= SAFE_ZONE_RULES.contentWeights[kind]; if (roll <= 0) return kind; }
  return kinds[kinds.length - 1];
}

/** What a COIN VEIN's payout split is actually worth, so the two numbers cannot drift apart. */
export const coinVeinTotal = (rules = SAFE_ZONE_RULES) =>
  rules.coinVein.payout.large * COIN_VALUES.large + rules.coinVein.payout.small * COIN_VALUES.small;

/** The floor slab a chamber stands on, as a rectangle. */
export const safeZoneFloor = (zone: SafeZone) => ({
  x: zone.x, y: zone.y + zone.height, width: zone.width, height: SAFE_ZONE_RULES.floorHeight,
});
/** True when a point (the player's centre) is inside the chamber. */
export const insideSafeZone = (zone: SafeZone, x: number, y: number) =>
  x > zone.x && x < zone.x + zone.width && y > zone.y - 4 && y < zone.y + zone.height + 2;
