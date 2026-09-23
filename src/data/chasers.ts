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
   * How far the player must be BELOW a dormant ghost before it wakes. It is the ghost's head start
   * given to the player: at the fastest ghost (88px/s) that is 2.3s before it could possibly touch
   * anyone, which is what "no instant hit on appearance" is measured against.
   */
  wakeLead: 200,
  /** Where a dormant ghost waits: this far into the wall, so it emerges FROM the brickwork. */
  wallDepth: 14,
  /**
   * THE TETHER. Beyond this distance a hunting ghost is off the top of the view, and there it closes
   * at `catchUp` instead of its own speed until it is back at the edge.
   *
   * Measured without it, a ghost was felt by nobody: the player descends at ~260px/s, a ghost drifts
   * at 70-88, and on the median landing the nearest hunting ghost was 10.7 seconds away -- standing
   * still for three seconds got caught on 1% of landings, and a whole run took 0.00 ghost hits. The
   * AREA's premise, that you cannot stay put, was not there.
   *
   * With it, a ghost waits just out of sight while you keep moving and arrives in 3.4-4.2s if you
   * stop. It never speeds up where it can be seen, so on screen it is always slower than walking,
   * and it cannot reach anyone sooner than its wake head start allows: the tether only ever acts
   * beyond 320px, and the head start is 200.
   */
  tether: 320,
  catchUp: 260,
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

export type ChaseState =
  | { kind: 'ghost'; state: 'dormant' | 'hunt'; speed: number }
  | { kind: 'skull'; state: 'idle' | 'warn' | 'charge' | 'cool' | 'return'; t: number; dx: number; dy: number; vx: number; vy: number };

/** A dormant ghost, placed by the generator. `speed` is the SECTION's, fixed at placement. */
export const dormantGhost = (speed: number): ChaseState => ({ kind: 'ghost', state: 'dormant', speed });
export const idleSkull = (): ChaseState => ({ kind: 'skull', state: 'idle', t: 0, dx: 0, dy: 0, vx: 0, vy: 0 });

export type ChaseSignal = 'ghostWake' | 'skullWarn' | 'skullCharge';

/**
 * Advance one chaser by exactly one fixed step. Returns a signal when the step changed what the
 * player should be told (a ghost waking, a skull rattling, a skull launching), otherwise null.
 *
 * `view` is the camera's top edge and height, so a skull only notices a player it is on screen with.
 */
export function stepChaser(e: Enemy & { ai: ChaseState }, player: { x: number; y: number }, h: number, worldTime: number, view: { top: number; height: number }): ChaseSignal | null {
  const ai = e.ai;
  const originY = e.originY ?? e.y;
  if (ai.kind === 'ghost') {
    if (ai.state === 'dormant') {
      if (player.y - e.y < GHOST_RULES.wakeLead) return null;
      ai.state = 'hunt';
      return 'ghostWake';
    }
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      // Off the top of the view it closes fast, but never past the tether line: the last stretch is
      // always covered at its own, visible, walking-beaten speed.
      const speed = d > GHOST_RULES.tether ? GHOST_RULES.catchUp : ai.speed;
      const move = Math.min(d, speed * h, d > GHOST_RULES.tether ? d - GHOST_RULES.tether + ai.speed * h : Infinity);
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
