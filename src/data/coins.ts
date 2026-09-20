import type { EnemyThreat } from './enemies';

/**
 * COIN drops. Coins are their own entity rather than another PickupKind: environment pickups are
 * gated by which AREA gimmick is on, and currency must never be. Everything a coin does -- what a
 * corpse leaves, how hard they scatter, how long they last -- is tuned from here.
 *
 * A coin carries its own value. The original's gems come in two sizes and so do these: picking one
 * up is worth what that coin says it is worth, never "one". Everything downstream -- the wallet, the
 * score, the COIN HIGH meter -- counts value, so adding a third size later changes nothing but this
 * table.
 */
export type CoinDenomination = 'small' | 'large';

/** What each size is worth. Matches the original's Small Gem 2G / Large Gem 10G. */
export const COIN_VALUES: Record<CoinDenomination, number> = { small: 2, large: 10 };
export const coinValue = (denomination: CoinDenomination) => COIN_VALUES[denomination];

/** What one defeated enemy leaves: how many coins, and of which size. */
export interface CoinDrop { count: number; denomination: CoinDenomination }

export interface CoinRules {
  /** Coins left by one defeated enemy, by how dangerous it was. */
  drop: Record<EnemyThreat, CoinDrop>;
  /** Seconds a loose coin lasts before it is gone for good. */
  lifetime: number;
  /** Seconds left when it starts blinking, so leaving is visible rather than sudden. */
  blinkAt: number;
  /** Speed of the pop out of the corpse, and how much of it goes sideways. */
  burstSpeed: number;
  burstSpread: number;
  /** Gravity on a loose coin. Lighter than the player, so coins hang for a moment. */
  gravity: number;
  /** Terminal speed, so a coin never outruns the player falling after it. */
  maxFallSpeed: number;
  /** Pickup radius, generous enough to sweep up a spray while falling past. */
  radius: number;
  /** Distance at which a coin starts drifting toward the player, and how hard it pulls. */
  magnetRadius: number;
  magnetPull: number;
}

export const COIN_RULES: CoinRules = {
  // Quantities are unchanged from before denominations existed -- a tougher enemy still leaves more
  // than a basic one. What changed is that each of those coins is now a SMALL COIN worth 2 rather
  // than an unnamed 1. The original's per-enemy gem counts are not documented, so these stay as they
  // were rather than being invented; MEASUREMENT REQUIRED.
  drop: {
    basic: { count: 1, denomination: 'small' },
    armored: { count: 2, denomination: 'small' },
    heavy: { count: 3, denomination: 'small' },
  },
  lifetime: 9,
  blinkAt: 2.5,
  burstSpeed: 150,
  burstSpread: 110,
  gravity: 420,
  maxFallSpeed: 300,
  radius: 17,
  magnetRadius: 86,
  magnetPull: 900,
};

/** What a defeated enemy of this threat tier leaves behind. */
export const coinsFor = (threat: EnemyThreat, rules: CoinRules = COIN_RULES): CoinDrop =>
  rules.drop[threat] ?? rules.drop.basic;
/** What that drop is worth in total, which is what actually reaches the wallet. */
export const coinDropValue = (threat: EnemyThreat, rules: CoinRules = COIN_RULES) => {
  const drop = coinsFor(threat, rules);
  return drop.count * coinValue(drop.denomination);
};

export interface Coin {
  id: number; x: number; y: number; vx: number; vy: number;
  denomination: CoinDenomination;
  /** What picking this one up is worth. Read from the denomination at spawn, never recomputed. */
  value: number;
  /** Seconds left before it disappears. */
  life: number;
  taken: boolean;
}
