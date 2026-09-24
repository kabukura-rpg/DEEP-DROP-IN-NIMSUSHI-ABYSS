export const WORLD = { width: 450, height: 800, wall: 28, startY: 180, pixelsPerMeter: 24, chunkHeight: 960 };
/**
 * Charge starts at 8, as in the original.
 *
 * `gravity`, `moveSpeed` and `maxFallSpeed` are VIDEO-MEASURED SCALE-EQUIVALENT + HUMAN PLAYTEST
 * APPROVED -- the only three numbers in this file with that standing. They come from frame
 * measurement of a ~58.9fps recording of the original, normalised against shaft width so the figure
 * transfers between two games at different resolutions, then multiplied into DEEP DROP's 394px
 * shaft. They reproduce the measured targets almost exactly:
 *
 *   quantity      original      DEEP DROP now              was (legacy)
 *   terminal      2.36 sw/s     2.36 sw/s   (930 px/s)     1.32 sw/s (520)
 *   acceleration  4.2  sw/s2    4.26 sw/s2  (1680 px/s2)   2.28 sw/s2 (900)
 *   horizontal    0.88-0.91     0.89 sw/s   (350 px/s)     0.457 sw/s (180)
 *
 * They were then played side by side against the original and confirmed by hand. The old
 * 900/520/180 is kept as `SPEED_PROFILES.legacy` for comparison and is not a target.
 *
 * `gravity` is NOT only a fall constant: jump, wall jump, stomp and doodad bounce heights are all
 * `impulse^2 / 2g`, so all four shrank to ~54% when it rose. That was checked by hand and kept --
 * see JUMP below. Changing gravity again silently re-scales every one of them.
 *
 * DOWNWELL NORMAL GAMEPLAY CLONE -- two more are now VIDEO-MEASURED, from the frame analysis of a
 * Normal Mode run (Dzumeister, youtube -qsLdDehni4, 1-1 before any weapon pickup, ~0.1s samples),
 * with the same shaft-width normalisation (the original's shaft is 413px of that 1280px frame):
 *
 *   quantity        original                           DEEP DROP now        was
 *   shot interval   0.08-0.11s between rapid shots      0.10s               0.16s
 *   recoil          a terminal fall (~1.9 sw/s) is cut  510 px/s (1.29 sw/s) 190 px/s (0.48 sw/s)
 *                   to ~0.6 sw/s by one shot and to
 *                   ~0.25 sw/s by three; held fire
 *                   descends at 0.27-0.48 sw/s
 *
 * At the old pair, holding the trigger from terminal speed never got the fall below 740px/s: the
 * gunboots could not hover, so a player could not hang in the air over what they were shooting.
 * At the new pair a held magazine descends at ~0.49 sw/s, inside the measured range. The rule that
 * recoil is a BRAKE and never lifts is unchanged. Confidence MEDIUM-LOW (one player, a few bursts).
 *
 * Every other number here is DEEP DROP's own and unmeasured.
 */
export const BALANCE = { gravity: 1680, moveSpeed: 350, maxFallSpeed: 930, shotRecoil: 510, maxAmmo: 8, maxHp: 4, shotDelay: 0.10, bounce: 210 };
/**
 * How much stronger every module's recoil is than it was, so that re-measuring the machine gun keeps
 * every other module where it stood relative to it: 510 / 190.
 */
export const RECOIL_SCALE = 510 / 190;

/**
 * The ground jump ACTION performs while standing.
 *
 * The impulse itself is still unmeasured, but the ARC it now produces is human-approved: at the
 * measured gravity of 1680 an impulse of 330 peaks about 32px, or 1.08 player-heights, and side-by-
 * side play confirmed the original's ground jump is low like this.
 *
 * It peaked at 60px while gravity was 900. Restoring that arc under the new gravity would take an
 * impulse of 451, and that was deliberately NOT done -- the taller jump was a symptom of the slow
 * physics, not something worth preserving through the fix. The 2H jump is not coming back.
 *
 * Still well under the ~245px between two rows, so the original property holds: a jump repositions
 * the player and starts a fall, and can never climb back to the row above.
 */
export const JUMP = { impulse: 330 } as const;

/**
 * WALL JUMP: pressed against a shaft wall in mid-air, ACTION kicks off it instead of firing.
 *
 * MEASUREMENT REQUIRED, exactly as JUMP above is. None of these three numbers is the original's;
 * they are picked to feel like a kick rather than a hop inside DEEP DROP's own physics, and they
 * sit here on their own so a measured set replaces them in one edit.
 *
 *   impulse  -- upward launch. A shade under the ground jump, so a wall is a worse floor.
 *   kick     -- horizontal shove away from the wall, in px/s. Well above moveSpeed (180) so it
 *               reads as being thrown clear rather than as walking.
 *   kickTime -- seconds the shove decays over. kick * kickTime / 2 is roughly how far it carries.
 *   grace    -- how long contact is remembered for. Without it the move is impossible to perform:
 *               the input that steers AWAY from the wall is the same input that leaves it, so by
 *               the time ACTION is read the player is already a pixel clear of the brickwork.
 */
export const WALL_JUMP = { impulse: 300, kick: 320, kickTime: 0.45, grace: 0.1 } as const;
export type Stats = typeof BALANCE & { power: number; bulletSize: number; piercing: boolean; comboBonus: number };
export const initialStats = (): Stats => ({ ...BALANCE, power: 1, bulletSize: 4, piercing: false, comboBonus: 0 });
