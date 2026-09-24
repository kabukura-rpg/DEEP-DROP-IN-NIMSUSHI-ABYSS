import { WORLD } from './balance';
import type { Enemy } from './enemies';

/**
 * CATACOMB CHASERS.
 *
 * The CATACOMBS are shaped to be walked (see `catacombTerrain.ts`); these are what make walking
 * them urgent. Two pressures, deliberately different in shape:
 *
 *   GHOST          PERSISTENT. It waits inside the wall until the player has gone past, then drifts
 *                  after them through stone and ledges alike, never faster than someone who keeps
 *                  moving. Stand still on a shelf and it arrives. It spends itself on the hit it lands,
 *                  so one ghost is one heart at most -- pressure, never a trap.
 *   FLYING SKULL   MOMENTARY. It hovers where it was placed. Come within reach and it rattles -- the
 *                  warning -- then flies at where the player WAS when it began to rattle, cools off,
 *                  and drifts home. Moving during the warning is the whole answer, and so is a round.
 *
 * Both are pure functions of their own state, the player's position and a fixed step. Nothing here
 * reads a clock or a random number, so a seed replays exactly; and GameModel runs them on fixed
 * 1/120s sub-steps, so 30, 60 and 120 frames per second produce the same chase.
 */

/** The fixed step every chaser advances by, whatever the frame rate. */
export const CHASE_STEP = 1 / 120;

export const GHOST_RULES = {
  /**
   * WHAT THE PLAYER CAN ACTUALLY SEE. The HUD (depth, hearts, coins, ammo) is drawn over the top of
   * the shaft, and measured in a real browser its text reaches 164-183px of world below the view's
   * top edge (1280x800, 1440x900, 390x844, 375x667). Anything above this line is behind the HUD or
   * off the screen -- and the walls a ghost comes out of are exactly where the hearts and the ammo
   * sit. v2 counted that band as "on screen"; Human Review still saw no ghost. Now nothing about a
   * ghost counts as seen until it is below this line.
   */
  hudClear: 190,
  /**
   * How far the player must be BELOW a dormant ghost before it wakes. The player stands 296px below
   * the view's top, so 90px puts the waking ghost just under the HUD: it comes out of the wall where
   * it can be seen, never behind the hearts.
   */
  wakeLead: 90,
  /** Where a dormant ghost waits: this far into the wall, so it emerges FROM the brickwork. */
  wallDepth: 14,
  /**
   * THE SIGHT LINE. A hunting ghost left above it -- behind the HUD or off the top after a fall --
   * comes straight down to it at `catchUp`: a visible swoop back into the picture, never a teleport.
   * Below the line it moves only at its own speed, which is always slower than walking. So a player
   * who keeps moving has it hanging just under the HUD, following; one who stops is reached from
   * there in a few seconds.
   */
  catchUp: 420,
  /**
   * NO CHEAP HIT. A ghost can only touch the player while it is in sight, and only once it has been
   * in sight this long in total since it woke. Being hit by something never seen is ruled out by
   * construction, not by tuning.
   */
  seenBeforeHit: 1.0,
  /** At most this many ghosts hunt at once; the rest wait in the walls for a turn. */
  activeCap: 2,
  /**
   * Seconds a ghost hunts before it gives up and fades. Without it the first two woken would hold
   * both turns for the whole SECTION and the rest would never come out.
   */
  huntTime: 7,
} as const;


export const SKULL_RULES = {
  /** Distance at which a hovering skull notices the player. */
  range: 230,
  /** Seconds it rattles before it flies. The aim is fixed at the START of this, so moving dodges it. */
  warn: 0.55,
  /** Charge speed and duration: 360px/s for 0.6s is a 216px lunge. */
  chargeSpeed: 360,
  chargeTime: 0.6,
  /** Seconds it drifts to a stop after a charge, and how fast it then goes home. */
  cool: 1.0,
  returnSpeed: 50,
  /** Gentle hover while idle, so a skull at rest still reads as alive. */
  bob: 4,
} as const;

import type { DwellerState } from './dwellers';

export type ChaseState =
  | DwellerState
  | { kind: 'ghost'; state: 'dormant' | 'hunt'; speed: number; t: number; seen: number }
  | { kind: 'skull'; state: 'idle' | 'warn' | 'charge' | 'cool' | 'return'; t: number; dx: number; dy: number; vx: number; vy: number };

/** A dormant ghost, placed by the generator. `speed` is the SECTION's, fixed at placement. */
export const dormantGhost = (speed: number): ChaseState => ({ kind: 'ghost', state: 'dormant', speed, t: 0, seen: 0 });
export const idleSkull = (): ChaseState => ({ kind: 'skull', state: 'idle', t: 0, dx: 0, dy: 0, vx: 0, vy: 0 });

export type ChaseSignal = 'ghostWake' | 'ghostFade' | 'skullWarn' | 'skullCharge';

/** Is this body where the player can see it: its whole sprite inside the view, and clear of the HUD. */
export const inSight = (y: number, view: { top: number; height: number }) => y - 16 >= view.top + GHOST_RULES.hudClear - 1e-6 && y + 10 < view.top + view.height;

/**
 * Advance one chaser by exactly one fixed step. Returns a signal when the step changed what the
 * player should be told (a ghost waking, a skull rattling, a skull launching), otherwise null.
 *
 * `view` is the camera's top edge and height, so a skull only notices a player it is on screen with.
 */
export function stepChaser(e: Enemy & { ai: ChaseState }, player: { x: number; y: number }, h: number, worldTime: number, view: { top: number; height: number }, mayWake = true): ChaseSignal | null {
  const ai = e.ai;
  if (ai.kind !== 'ghost' && ai.kind !== 'skull') return null;
  const originY = e.originY ?? e.y;
  if (ai.kind === 'ghost') {
    if (ai.state === 'dormant') {
      // Waits its turn when enough ghosts are already out.
      if (!mayWake || player.y - e.y < GHOST_RULES.wakeLead) return null;
      ai.state = 'hunt'; ai.t = 0; ai.seen = 0;
      return 'ghostWake';
    }
    ai.t += h;
    if (inSight(e.y, view)) ai.seen += h;
    if (ai.t >= GHOST_RULES.huntTime) return 'ghostFade';
    // Out of sight above: straight down to the sight line (or the player, if they are above it), fast,
    // while drifting across at its own speed. Never further than the line, so the rest is seen.
    const line = Math.min(view.top + GHOST_RULES.hudClear + 16, player.y);
    if (e.y < line) {
      e.y = Math.min(line, e.y + GHOST_RULES.catchUp * h);
      const dx = player.x - e.x;
      e.x += Math.sign(dx) * Math.min(Math.abs(dx), ai.speed * h);
      return null;
    }
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      const move = Math.min(d, ai.speed * h);
      e.x += dx / d * move; e.y += dy / d * move;
    }
    return null;
  }
  // SKULL
  switch (ai.state) {
    case 'idle': {
      e.x = e.originX;
      e.y = originY + Math.sin(worldTime * 2 + e.phase) * SKULL_RULES.bob;
      const onScreen = e.y > view.top && e.y < view.top + view.height;
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
      if (!onScreen || d > SKULL_RULES.range || d < 1e-6) return null;
      ai.state = 'warn'; ai.t = 0; ai.dx = dx / d; ai.dy = dy / d;
      return 'skullWarn';
    }
    case 'warn':
      ai.t += h;
      if (ai.t < SKULL_RULES.warn) return null;
      ai.state = 'charge'; ai.t = 0; ai.vx = ai.dx * SKULL_RULES.chargeSpeed; ai.vy = ai.dy * SKULL_RULES.chargeSpeed;
      return 'skullCharge';
    case 'charge':
      ai.t += h;
      e.x += ai.vx * h; e.y += ai.vy * h;
      clampToShaft(e);
      if (ai.t >= SKULL_RULES.chargeTime) { ai.state = 'cool'; ai.t = 0; }
      return null;
    case 'cool': {
      ai.t += h;
      // Exponential braking: a fixed factor per fixed step, so it is identical at any frame rate.
      const keep = Math.exp(-6 * h);
      ai.vx *= keep; ai.vy *= keep;
      e.x += ai.vx * h; e.y += ai.vy * h;
      clampToShaft(e);
      if (ai.t >= SKULL_RULES.cool) { ai.state = 'return'; ai.t = 0; ai.vx = 0; ai.vy = 0; }
      return null;
    }
    case 'return': {
      const dx = e.originX - e.x, dy = originY - e.y, d = Math.hypot(dx, dy);
      const move = SKULL_RULES.returnSpeed * h;
      if (d <= move) { e.x = e.originX; e.y = originY; ai.state = 'idle'; return null; }
      e.x += dx / d * move; e.y += dy / d * move;
      return null;
    }
  }
}

/** A skull's lunge never leaves the shaft; a ghost is the one thing allowed in the walls. */
function clampToShaft(e: Enemy) {
  e.x = Math.max(WORLD.wall + 12, Math.min(WORLD.width - WORLD.wall - 12, e.x));
}
