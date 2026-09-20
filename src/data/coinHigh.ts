/**
 * COIN HIGH -- the original's Gem High.
 *
 * Collecting enough value in a short space of time turns the gunboots up: rounds hit harder and
 * reach further, and keeping the coins coming keeps it going. It is the reward for playing fast,
 * and it is what ties the whole economy to the descent rather than to a shop screen.
 *
 * What is actually confirmed about the original is only the SHAPE of it: 100 gems collected quickly
 * grants a temporary damage and range increase. The numbers below -- how fast the meter drains, how
 * long a HIGH lasts without more coins, and by how much damage and range go up -- are NOT measured
 * values from the original and must not be reported as such.
 */
export interface CoinHighRules {
  /** Meter value that turns it on, and the meter's ceiling. The original's figure is 100 gems. */
  threshold: number;
  /** Seconds without a coin before an inactive meter starts falling. MEASUREMENT REQUIRED. */
  idleGrace: number;
  /** Meter lost per second once an inactive meter is falling. MEASUREMENT REQUIRED. */
  decayPerSecond: number;
  /**
   * Seconds a HIGH lasts on a full meter with no further coins. The meter drains from full to
   * empty over exactly this long, which is what lets more coins extend it. MEASUREMENT REQUIRED.
   */
  activeSeconds: number;
  /** Round damage multiplier while active. MEASUREMENT REQUIRED. */
  damageMultiplier: number;
  /** Round range multiplier while active. MEASUREMENT REQUIRED. */
  rangeMultiplier: number;
}

export const COIN_HIGH_RULES: CoinHighRules = {
  threshold: 100,
  idleGrace: 0.9,
  decayPerSecond: 26,
  activeSeconds: 6,
  damageMultiplier: 2,
  rangeMultiplier: 1.6,
};

/** How fast a live HIGH drains, derived so `activeSeconds` is the only number to tune. */
export const activeDecayPerSecond = (rules: CoinHighRules = COIN_HIGH_RULES) =>
  rules.threshold / Math.max(0.0001, rules.activeSeconds);
