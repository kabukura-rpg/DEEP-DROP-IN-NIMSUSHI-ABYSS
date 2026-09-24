/**
 * BOSS BATTLE PHYSICS — NIMUSHI's own layer, independent of the normal run.
 *
 * WHY THIS EXISTS
 * The normal run is being pulled toward Downwell Normal Mode; NIMUSHI is DEEP DROP's own final
 * fight and is not. While the two shared one set of constants, every fidelity change to the run
 * silently re-tuned the boss -- and when the measured speeds landed (gravity 900 -> 1680, terminal
 * 520 -> 930) the fight stopped working outright: the player was dragged into NIMUSHI at 930px/s
 * while it retreated at 240, and died in 3.94 seconds.
 *
 * That was not a difficulty problem. It was a COUPLING problem, and this layer is the fix. The
 * contract is symmetric and is asserted in tests/bossPhysics.test.ts:
 *
 *   a change to normal physics must not change boss behaviour
 *   a change to boss physics must not change normal behaviour
 *
 * WHAT THIS IS NOT
 * It is not "the run's old physics". The values below happen to equal the pre-fidelity normal ones
 * because that is the scale NIMUSHI was designed and approved at, and starting anywhere else would
 * throw away a working fight for no reason. They are the BOSS's numbers now, tuned against the boss
 * and nothing else. Normal physics moving again will not move these.
 *
 * It is also not a rescaling of the run. Every px value here is NOT the run's multiplied by
 * 930/520: that was considered and rejected, because it would re-couple the two through a ratio and
 * put us back where we started.
 *
 * STATUS: LEGACY BOSS BASELINE. The separation is the deliverable; the values are the starting
 * point for a boss balance pass that has not happened yet, and none of them is measured.
 */
export interface BattlePhysics {
  /** Acceleration MAGNITUDE. The direction is carried separately -- see `gravityDirection`. */
  gravity: number;
  /** Terminal speed along the pull, whichever way the pull runs. */
  maxFallSpeed: number;
  /** Horizontal speed. Shared controls, mode-specific response. */
  moveSpeed: number;
}

/**
 * Which way the pull runs in each mode.
 *
 * Kept apart from magnitude on purpose. The old model derived NIMUSHI's gravity by flipping the
 * sign of the run's, so the two could never differ in strength; now direction and magnitude are
 * independent and the run's gravity can change without touching the arena.
 *
 *   normal  +1  down the shaft
 *   boss    -1  up, toward NIMUSHI -- "ここからは私のルールね"
 */
export const GRAVITY_DIRECTION = { normal: 1, boss: -1 } as const;

/**
 * NIMUSHI's arena. See the header: boss numbers, not the run's old ones.
 *
 * Three numbers, and only three. The arena briefly carried its own vertical thrust, its own flat
 * dodge force and its own knockback; all of them are gone, because each one replaced something the
 * player had already learned in AREA 1-4 with a rule that applied to one fight.
 */
export const BOSS_PHYSICS: BattlePhysics = {
  gravity: 900,
  maxFallSpeed: 520,
  moveSpeed: 180,
};

/**
 * THE GUNBOOTS THE FIGHT WAS BALANCED WITH.
 *
 * DOWNWELL NORMAL GAMEPLAY CLONE re-measured the machine gun's interval (0.16s -> 0.10s) and every
 * module's recoil (x510/190) for the twelve SECTIONs. The FINAL BOSS is not part of that clone and is
 * not being rebalanced, so from the moment THE ABYSS opens -- staging room, inversion, arena -- the gunboots keep exactly the numbers the fight was built
 * and approved with: the machine gun at its old interval, and every module's recoil back at its old
 * strength.
 */
export const BOSS_GUNBOOTS = { machineInterval: 0.16, recoilScale: 190 / 510 } as const;
