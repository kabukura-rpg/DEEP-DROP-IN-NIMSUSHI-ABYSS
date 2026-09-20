/**
 * Bodies left behind, and the two upgrades that care about them.
 *
 * A corpse is inert scenery on its own: it does not hurt, it does not block, and a run without
 * KNIFE AND FORK or REST IN PIECES never touches one. What it exists for is that those two
 * upgrades disagree about what a body is for -- one eats it, the other detonates it -- and the
 * same body can only be used once, which is the whole interaction between them.
 */
export interface Corpse {
  id: number;
  x: number; y: number;
  /** Falls and settles like anything else dropped in the shaft. */
  vy: number;
  /** Seconds left before it is gone, so a long run does not accumulate bodies forever. */
  life: number;
  /** Set the moment it is eaten or blown up, so the other upgrade can never also claim it. */
  claimed: boolean;
}

export const CORPSE_RULES = {
  /** Seconds a body lasts. MEASUREMENT REQUIRED. */
  lifetime: 12,
  /** How close the player has to be to eat one. */
  radius: 18,
  /** It falls like debris rather than hanging where the enemy died. */
  gravity: 520,
  maxFallSpeed: 340,
  width: 20,
  height: 12,
} as const;

/**
 * `gravitySign` is which way the world is pulling when the body drops: +1 down the shaft, -1 in
 * the ABYSS. A corpse is thrown clear of the kill against the pull and then falls with it, so an
 * inverted fight leaves bodies drifting up the screen rather than raining the wrong way.
 */
export const spawnCorpse = (id: number, x: number, y: number, gravitySign: 1 | -1 = 1): Corpse =>
  ({ id, x, y, vy: -60 * gravitySign, life: CORPSE_RULES.lifetime, claimed: false });
