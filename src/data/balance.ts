export const WORLD = { width: 450, height: 800, wall: 28, startY: 180, pixelsPerMeter: 24, chunkHeight: 960 };
// Charge starts at 8, as in the original. Every other number here is DEEP DROP's own.
export const BALANCE = { gravity: 900, moveSpeed: 180, maxFallSpeed: 520, shotRecoil: 190, maxAmmo: 8, maxHp: 4, shotDelay: 0.16, bounce: 210 };

/**
 * The ground jump ACTION performs while standing.
 *
 * MEASUREMENT REQUIRED. This is NOT the original's jump: Downwell's impulse has not been measured
 * yet, and this value is chosen to sit sensibly inside DEEP DROP's own physics rather than to
 * imitate a number nobody has taken. It is here, on its own, so that swapping in a measured value
 * is a one-line change with nothing else to find.
 *
 * What it is chosen for: at gravity 900 an impulse of 330px/s peaks about 60px up, which is well
 * under the ~232px between two rows. A jump therefore repositions the player and starts a fall --
 * it can never climb back to the row above, so nothing about the descent can be undone by jumping.
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
