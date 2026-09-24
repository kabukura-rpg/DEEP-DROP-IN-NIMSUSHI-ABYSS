import { WORLD } from './balance';
import type { DwellerRole, Enemy } from './enemies';

/**
 * WELL DWELLERS -- the enemy BEHAVIOURS of Downwell Normal Mode, on DEEP DROP's own bodies.
 *
 * DOWNWELL NORMAL GAMEPLAY CLONE. Until this file DEEP DROP's shaft was full of things that swayed on
 * a sine and never noticed the player, which is why a fall down the middle met almost nothing. The
 * original's roster is the opposite: most of it wakes, turns and comes for you, and what does not
 * guards a ledge in a way that asks for an answer. Each behaviour here is one ROLE from that roster
 * (Downwell Wikia enemy pages; see the reference spec), not a copy of any sprite:
 *
 *   bat      hangs under a ledge until the player reaches its height, then flies straight at them
 *   drift    slow homing float that has to build its speed up and bounces off walls (bad bubble)
 *   eye      chases in an erratic, wobbling line and cannot be stood on (eye / piranha / angry phantom)
 *   hop      sits, winds up, leaps along its ledge; a round calms it and restarts the wait (frog,
 *            ground skull)
 *   wander   ignores the player until shot, then turns hard and chases (flying skull)
 *   throw    stands on a ledge lobbing bones in a fixed arc toward the player (skeleton)
 *   phantom  drifts on a wave and edges toward a player who lingers near it
 *   rise     climbs in pausing zigzags through anything, never downward (jellyfish)
 *   squid    swims up through anything, then darts straight down -- and cannot be stood on while
 *            it darts
 *   column   crosses the screen vertically at a constant speed, in swarms (tapered stuff)
 *   orbit    circles a point, usually in pairs (spherical stuff)
 *   bounce   travels in a straight line and rebounds off the shaft walls (diatomic stuff, swimming
 *            turtle)
 *   crawl    creeps up and down a shaft wall (snail)
 *
 * Every number is DEEP DROP's, in its own pixels; the original's speeds are not published and only
 * the ROLE is taken from it. Each is written so the rules the rest of the game relies on still hold:
 *
 *   NO CHEAP HIT      nothing here can touch the player until it has been in sight -- below the HUD
 *                     and on screen -- for `seenBeforeHit`. GameModel asks `dwellerMayHit`.
 *   ALWAYS OUTRUN     every chaser is slower than the player's fall and than walking, so keeping on
 *                     moving always gets away from it.
 *   DETERMINISTIC     pure functions of their own state, the player and a fixed step: no clock, no
 *                     random numbers, so a seed replays exactly at any frame rate.
 */

export const DWELLER_RULES = {
  /** Seconds a dweller must have been in sight before its body can hurt. */
  seenBeforeHit: 0.3,
  /** A dweller further than this from the player (vertically) holds still: the shaft is long. */
  activeRange: 620,
  /**
   * A bat wakes once the player has gone past it (below its height, within `reach` across), takes
   * `unfurl` seconds to drop off its perch, then flies at the player.
   */
  bat: { reach: 230, unfurl: 0.3, speed: 170, turn: 600 },
  drift: { accel: 110, speed: 80 },
  eye: { speed: 85, wobble: 50, wobbleRate: 5 },
  piranha: { speed: 165, wobble: 0, wobbleRate: 0 },
  phantomChase: { speed: 105, wobble: 0, wobbleRate: 0 },
  frog: { wait: [1.1, 1.9] as const, windup: 0.45, jump: 560, run: 150 },
  groundSkull: { wait: [0.35, 0.9] as const, windup: 0, jump: 300, run: 70 },
  skull: { calmRadius: 34, calmRate: 0.9, speed: 150, turn: 700 },
  skeleton: { range: 330, every: 1.7, windup: 0.35, boneVx: 165, boneVy: -430 },
  phantom: { sway: 1.0, bob: 16, bobRate: 1.7, near: 150, approach: 45 },
  jelly: { pause: 0.5, move: 0.7, dx: 46, dy: 64 },
  squid: { rise: 55, dive: 390, turnLine: 250 },
  column: { speed: 72 },
  orbit: { rate: 1.6 },
  bounce: { speed: 92 },
  swim: { speed: 62 },
  crawl: { rate: 0.4, reach: 80 },
} as const;

/** Gravity on a thrown bone, px/s^2. Lighter than the player's so the arc reads and can be shot. */
export const BONE = { gravity: 900, radius: 9, life: 3.2 } as const;

type Seen = { seen: number; state?: string };
export type DwellerState = Seen & (
  | { kind: 'bat'; state: 'hang' | 'unfurl' | 'chase'; t: number; vx: number; vy: number }
  | { kind: 'drift'; vx: number; vy: number }
  | { kind: 'eye'; role: 'eye' | 'piranha' | 'phantomChase'; vx: number; vy: number; t: number }
  | { kind: 'hop'; role: 'frog' | 'groundSkull'; state: 'sit' | 'windup' | 'air'; t: number; wait: number; vx: number; vy: number; minX: number; maxX: number; floorY: number; turn: number }
  | { kind: 'wander'; state: 'calm' | 'angry'; t: number; vx: number; vy: number }
  | { kind: 'throw'; t: number; windup: number }
  | { kind: 'phantom'; t: number; dx: number; dy: number }
  | { kind: 'rise'; t: number; step: number }
  | { kind: 'squid'; state: 'rise' | 'dive' }
  | { kind: 'column'; vy: number }
  | { kind: 'orbit'; t: number; radius: number }
  | { kind: 'bounce'; vx: number; vy: number; top: number; bottom: number }
  | { kind: 'crawl'; t: number }
);
export type DwellerKind = DwellerState['kind'];

/** What a step asks GameModel to do: a bone thrown, or nothing. */
export type DwellerSignal = { type: 'bone'; x: number; y: number; vx: number; vy: number } | { type: 'wake' } | null;

const LEFT = WORLD.wall + 12, RIGHT = WORLD.width - WORLD.wall - 12;
/** A cheap deterministic "random" from a number: the jitter a frog's wait or a jelly's turn needs. */
const hash = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

export const dwellerFor = {
  bat: (): DwellerState => ({ kind: 'bat', state: 'hang', t: 0, vx: 0, vy: 0, seen: 0 }),
  drift: (): DwellerState => ({ kind: 'drift', vx: 0, vy: 0, seen: 0 }),
  eye: (role: 'eye' | 'piranha' | 'phantomChase' = 'eye'): DwellerState => ({ kind: 'eye', role, vx: 0, vy: 0, t: 0, seen: 0 }),
  hop: (role: 'frog' | 'groundSkull', minX: number, maxX: number, floorY: number, phase: number): DwellerState =>
    ({ kind: 'hop', role, state: 'sit', t: 0, wait: waitFor(role, phase), vx: 0, vy: 0, minX, maxX, floorY, turn: phase, seen: 0 }),
  wander: (): DwellerState => ({ kind: 'wander', state: 'calm', t: 0, vx: 0, vy: 0, seen: 0 }),
  throw: (phase: number): DwellerState => ({ kind: 'throw', t: (phase % 1) * DWELLER_RULES.skeleton.every, windup: 0, seen: 0 }),
  phantom: (phase: number): DwellerState => ({ kind: 'phantom', t: phase, dx: 0, dy: 0, seen: 0 }),
  rise: (phase: number): DwellerState => ({ kind: 'rise', t: (phase % 1) * DWELLER_RULES.jelly.pause, step: Math.floor(phase * 7), seen: 0 }),
  squid: (): DwellerState => ({ kind: 'squid', state: 'rise', seen: 0 }),
  column: (down: boolean): DwellerState => ({ kind: 'column', vy: down ? DWELLER_RULES.column.speed : -DWELLER_RULES.column.speed, seen: 0 }),
  orbit: (phase: number, radius: number): DwellerState => ({ kind: 'orbit', t: phase, radius, seen: 0 }),
  bounce: (vx: number, vy: number, top: number, bottom: number): DwellerState => ({ kind: 'bounce', vx, vy, top, bottom, seen: 0 }),
  crawl: (phase: number): DwellerState => ({ kind: 'crawl', t: phase, seen: 0 }),
};

function waitFor(role: 'frog' | 'groundSkull', n: number) {
  const [lo, hi] = DWELLER_RULES[role].wait;
  return lo + hash(n) * (hi - lo);
}

/** Is a dweller's body where the player can see it: on screen and clear of the HUD. */
export const dwellerInSight = (y: number, view: { top: number; height: number }, hudClear = 190) => y - 16 >= view.top + hudClear && y + 10 < view.top + view.height;

/** NO CHEAP HIT: may this dweller's body hurt the player yet? */
export const dwellerMayHit = (ai: DwellerState) => ai.seen >= DWELLER_RULES.seenBeforeHit;

/** Steer a velocity toward a target velocity, at most `turn` px/s per second. */
function steer(ai: { vx: number; vy: number }, tx: number, ty: number, turn: number, h: number) {
  const dx = tx - ai.vx, dy = ty - ai.vy, d = Math.hypot(dx, dy), max = turn * h;
  if (d <= max) { ai.vx = tx; ai.vy = ty; return; }
  ai.vx += dx / d * max; ai.vy += dy / d * max;
}
const toward = (e: Enemy, p: { x: number; y: number }, speed: number) => {
  const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d * speed, dy / d * speed] as const;
};
const bounceWalls = (e: Enemy, ai: { vx: number }) => {
  if (e.x < LEFT) { e.x = LEFT; ai.vx = Math.abs(ai.vx); }
  if (e.x > RIGHT) { e.x = RIGHT; ai.vx = -Math.abs(ai.vx); }
};

/**
 * Advance one dweller by one fixed step. `ai` is `e.ai`, narrowed.
 */
export function stepDweller(e: Enemy, ai: DwellerState, player: { x: number; y: number; grounded: number }, h: number, view: { top: number; height: number }): DwellerSignal {
  const R = DWELLER_RULES;
  const originY = e.originY ?? e.y;
  if (dwellerInSight(e.y, view)) ai.seen += h;
  // Far off down the shaft (or long gone above it) nothing moves: a shaft is laid well ahead.
  if (Math.abs(e.y - player.y) > R.activeRange && ai.kind !== 'column') return null;
  switch (ai.kind) {
    case 'bat': {
      if (ai.state === 'hang') {
        e.x = e.originX; e.y = originY;
        // Downwell's bat drops once the player reaches its height -- here, once they are past it -- and
        // never from off screen.
        if (player.y < e.y + 8 || Math.abs(player.x - e.x) > R.bat.reach || !dwellerInSight(e.y, view)) return null;
        ai.state = 'unfurl'; ai.t = 0;
        return { type: 'wake' };
      }
      if (ai.state === 'unfurl') {
        ai.t += h;
        if (ai.t >= R.bat.unfurl) ai.state = 'chase';
        return null;
      }
      const [tx, ty] = toward(e, player, R.bat.speed);
      steer(ai, tx, ty, R.bat.turn, h);
      e.x += ai.vx * h; e.y += ai.vy * h;
      e.x = Math.max(LEFT, Math.min(RIGHT, e.x));
      return null;
    }
    case 'drift': {
      if (!dwellerInSight(e.y, view) && ai.vx === 0 && ai.vy === 0) return null;
      const [tx, ty] = toward(e, player, R.drift.speed);
      steer(ai, tx, ty, R.drift.accel, h);
      e.x += ai.vx * h; e.y += ai.vy * h;
      bounceWalls(e, ai);
      return null;
    }
    case 'eye': {
      const rule = R[ai.role];
      if (!dwellerInSight(e.y, view) && ai.t === 0) return null;
      ai.t += h;
      const [tx, ty] = toward(e, player, rule.speed);
      // The wobble is across the line of approach, so the path spirals rather than homing cleanly.
      const w = Math.sin(ai.t * rule.wobbleRate + e.phase) * rule.wobble;
      const d = Math.hypot(tx, ty) || 1;
      ai.vx = tx + (-ty / d) * w; ai.vy = ty + (tx / d) * w;
      e.x += ai.vx * h; e.y += ai.vy * h;
      bounceWalls(e, ai);
      return null;
    }
    case 'hop': {
      const rule = R[ai.role];
      switch (ai.state) {
        case 'sit':
          e.y = ai.floorY; ai.t += h;
          if (ai.t >= ai.wait) { ai.state = rule.windup > 0 ? 'windup' : 'air'; ai.t = 0; if (ai.state === 'air') launch(e, ai, player, rule); }
          return null;
        case 'windup':
          ai.t += h;
          if (ai.t >= rule.windup) { ai.state = 'air'; ai.t = 0; launch(e, ai, player, rule); }
          return null;
        case 'air': {
          ai.vy += 1680 * h;
          e.x += ai.vx * h; e.y += ai.vy * h;
          if (e.x < ai.minX) { e.x = ai.minX; ai.vx = 0; }
          if (e.x > ai.maxX) { e.x = ai.maxX; ai.vx = 0; }
          if (ai.vy > 0 && e.y >= ai.floorY) {
            e.y = ai.floorY; ai.vy = 0; ai.vx = 0; ai.state = 'sit'; ai.t = 0; ai.turn++;
            ai.wait = waitFor(ai.role, e.id + ai.turn);
          }
          return null;
        }
      }
      return null;
    }
    case 'wander': {
      if (ai.state === 'calm') {
        ai.t += h;
        // A lazy loop about where it was laid: it has not noticed anyone.
        e.x = e.originX + Math.sin(ai.t * R.skull.calmRate + e.phase) * R.skull.calmRadius;
        e.y = originY + Math.sin(ai.t * R.skull.calmRate * 1.7 + e.phase) * R.skull.calmRadius * 0.5;
        return null;
      }
      const [tx, ty] = toward(e, player, R.skull.speed);
      steer(ai, tx, ty, R.skull.turn, h);
      e.x += ai.vx * h; e.y += ai.vy * h;
      bounceWalls(e, ai);
      return null;
    }
    case 'throw': {
      e.y = originY;
      const near = Math.hypot(player.x - e.x, player.y - e.y) < R.skeleton.range && dwellerInSight(e.y, view);
      if (ai.windup > 0) {
        ai.windup -= h;
        if (ai.windup > 0) return null;
        ai.windup = 0;
        const dir = Math.sign(player.x - e.x) || 1;
        return { type: 'bone', x: e.x, y: e.y - 14, vx: dir * R.skeleton.boneVx, vy: R.skeleton.boneVy };
      }
      if (!near) return null;
      ai.t += h;
      if (ai.t >= R.skeleton.every) { ai.t = 0; ai.windup = R.skeleton.windup; }
      return null;
    }
    case 'phantom': {
      ai.t += h;
      const d = Math.hypot(player.x - e.x, player.y - e.y);
      if (d < R.phantom.near && d > 1) { ai.dx += (player.x - e.x) / d * R.phantom.approach * h; ai.dy += (player.y - e.y) / d * R.phantom.approach * h; }
      e.x = Math.max(LEFT, Math.min(RIGHT, e.originX + ai.dx + Math.sin(ai.t * R.phantom.sway + e.phase) * e.range));
      e.y = originY + ai.dy + Math.sin(ai.t * R.phantom.bobRate + e.phase * 2) * R.phantom.bob;
      return null;
    }
    case 'rise': {
      const cycle = R.jelly.pause + R.jelly.move;
      if (!dwellerInSight(e.y, view) && ai.t === 0) return null;
      const before = ai.t % cycle;
      ai.t += h;
      const now = ai.t % cycle;
      if (now < before) ai.step++;
      if (now > R.jelly.pause) {
        // Which way this zig goes: fixed per step, flipped against a wall.
        let dir = hash(e.id * 31 + ai.step) < 0.5 ? -1 : 1;
        if (e.x < LEFT + 30) dir = 1; if (e.x > RIGHT - 30) dir = -1;
        const k = h / R.jelly.move;
        e.x += dir * R.jelly.dx * k; e.y -= R.jelly.dy * k;
      }
      return null;
    }
    case 'squid': {
      if (ai.state === 'rise') {
        if (!dwellerInSight(e.y, view) && e.y > view.top + view.height) return null;
        e.y -= R.squid.rise * h;
        if (e.y < view.top + R.squid.turnLine) { ai.state = 'dive'; e.stompable = false; }
        return null;
      }
      e.y += R.squid.dive * h;
      return null;
    }
    case 'column':
      if (Math.abs(e.y - player.y) > R.activeRange * 1.5) return null;
      e.y += ai.vy * h;
      return null;
    case 'orbit':
      ai.t += h;
      e.x = e.originX + Math.cos(ai.t * R.orbit.rate + e.phase) * ai.radius;
      e.y = originY + Math.sin(ai.t * R.orbit.rate + e.phase) * ai.radius;
      return null;
    case 'bounce':
      e.x += ai.vx * h; e.y += ai.vy * h;
      bounceWalls(e, ai);
      if (e.y < ai.top) { e.y = ai.top; ai.vy = Math.abs(ai.vy); }
      if (e.y > ai.bottom) { e.y = ai.bottom; ai.vy = -Math.abs(ai.vy); }
      return null;
    case 'crawl':
      ai.t += h;
      e.y = originY + Math.sin(ai.t * R.crawl.rate + e.phase) * R.crawl.reach;
      return null;
  }
}

function launch(e: Enemy, ai: Extract<DwellerState, { kind: 'hop' }>, player: { x: number }, rule: { jump: number; run: number }) {
  // A frog leaps at the player; a ground skull bounces whichever way its count says.
  const dir = ai.role === 'frog' ? Math.sign(player.x - e.x) || 1 : hash(e.id + ai.turn * 7) < 0.5 ? -1 : 1;
  ai.vx = dir * rule.run; ai.vy = -rule.jump;
}

/**
 * A round that hurts without killing: a frog is calmed and waits again, a skeleton's next throw is
 * put back, and a flying skull that is shot turns on the shooter and can no longer be stood on.
 */
export function dwellerShot(e: Enemy, ai: DwellerState) {
  if (ai.kind === 'hop' && ai.role === 'frog' && ai.state !== 'air') { ai.state = 'sit'; ai.t = 0; }
  if (ai.kind === 'throw') { ai.t = 0; ai.windup = 0; }
  if (ai.kind === 'wander' && ai.state === 'calm') { ai.state = 'angry'; e.stompable = false; }
}

/**
 * Give a freshly spawned enemy the behaviour its type names, from where it was laid: a ledge guard's
 * `range` is the stretch of ledge a hopper may use, an open enemy's is the room it was given.
 */
export function attachDweller(e: Enemy, role: DwellerRole): DwellerState {
  const p = e.phase;
  switch (role) {
    case 'bat': return dwellerFor.bat();
    case 'drift': return dwellerFor.drift();
    case 'eye': case 'piranha': case 'phantomChase': return dwellerFor.eye(role);
    case 'frog': case 'groundSkull': return dwellerFor.hop(role, e.x - e.range, e.x + e.range, e.y, p * 97 + e.id);
    case 'wander': return dwellerFor.wander();
    case 'throw': return dwellerFor.throw(p);
    case 'phantom': return dwellerFor.phantom(p);
    case 'rise': return dwellerFor.rise(p);
    case 'squid': return dwellerFor.squid();
    case 'column': return dwellerFor.column(Math.sin(p * 3.1) > 0);
    case 'orbit': return dwellerFor.orbit(p, Math.max(26, Math.min(56, e.range + 20)));
    case 'bounce': { const s = DWELLER_RULES.bounce.speed; return dwellerFor.bounce(Math.cos(p) > 0 ? s : -s, Math.sin(p) > 0 ? s : -s, e.y - 150, e.y + 150); }
    case 'swim': { const s = DWELLER_RULES.swim.speed; return dwellerFor.bounce(Math.cos(p) > 0 ? s : -s, 0, e.y, e.y); }
    case 'crawl':
      // A creeper lives on the shaft wall, whichever is nearer to where it was laid.
      e.x = e.originX = e.x < WORLD.width / 2 ? WORLD.wall + 13 : WORLD.width - WORLD.wall - 13;
      e.range = 0;
      return dwellerFor.crawl(p);
  }
}
