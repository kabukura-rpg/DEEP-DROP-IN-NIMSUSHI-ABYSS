import type { EnemyThreat } from './enemies';

/**
 * COIN drops. Coins are their own entity rather than another PickupKind: environment pickups are
 * gated by which AREA gimmick is on, and currency must never be. Everything a coin does -- how many
 * a corpse leaves, how hard they scatter, how long they last -- is tuned from here.
 */
export interface CoinRules {
  /** Coins left by one defeated enemy, by how dangerous it was. */
  drop: Record<EnemyThreat, number>;
  /** Wallet and score value of a single coin. */
  value: number;
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
  drop: { basic: 1, armored: 2, heavy: 3 },
  value: 1,
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

/** How many coins a defeated enemy of this threat tier leaves behind. */
export const coinsFor = (threat: EnemyThreat, rules: CoinRules = COIN_RULES) => rules.drop[threat] ?? 1;

export interface Coin {
  id: number; x: number; y: number; vx: number; vy: number;
  /** Seconds left before it disappears. */
  life: number;
  taken: boolean;
}
