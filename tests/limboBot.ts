import { GameModel } from '../src/systems/GameModel';
import { WORLD, BALANCE } from '../src/data/balance';
import { ENEMY_TYPES, type Enemy } from '../src/data/enemies';
import { DOODAD_RULES } from '../src/data/doodads';
import { LIMBO_HAZARD_RULES } from '../src/data/structures';
import type { Platform } from '../src/systems/StageGenerator';
import type { AreaId, SectionId } from '../src/data/areas';

/**
 * AREA 4 PLAY BOTS. Two players that only ever touch the game through `step(dt, direction, firing)`:
 *
 *   PASSIVE  no left/right, no shot, nothing. Dropped into the shaft at a fixed x and left to fall --
 *            landing where the fall lands and riding a collapsing ledge down when it goes. The
 *            question it answers is whether a column of the shaft can be fallen straight down.
 *
 *   ACTIVE   a human-like player on ordinary HP. It sees only what the camera shows, re-plans a few
 *            times a frame-tenth, steers with the left/right input, shoots what is under it, brakes
 *            with the recoil when the way down is shut, and lands on rubble to reload. It knows
 *            nothing the screen does not show and never moves faster than the input allows.
 *
 * The ACTIVE plan is a small search over the shaft that is on screen: rows 16px tall, columns 6px
 * wide, each row reachable from the one above within the sideways distance the fall leaves time for.
 * Barbs and bodies cost a heart; ledges and doodads end the fall (a reload); the exit floor ends the
 * SECTION. It is deliberately not clairvoyant -- enemies are extrapolated from where they are now.
 */
const STEP = 1 / 120;
const LEFT = WORLD.wall + 12, RIGHT = WORLD.width - WORLD.wall - 12;
const COL = 3, ROW = 8;
const COLS = Math.floor((RIGHT - LEFT) / COL) + 1;
const colX = (c: number) => LEFT + c * COL;
const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.round((x - LEFT) / COL)));

export const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

export type HitSource = 'barb' | 'enemy' | 'other';
export interface RunResult {
  outcome: 'clear' | 'dead' | 'stuck' | 'timeout' | 'exitFloor';
  seconds: number;
  hits: Record<HitSource, number>;
  /** What took the last heart, when the run ended in death. */
  deathBy?: HitSource;
  deathKind?: string;
  shots: number; landings: number; kills: number; doodads: number;
  /** World y the run ended at, section-local metres. */
  depth: number;
}

function newRun(area: AreaId, section: SectionId, seed: number) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToStage(area, section);
  return game;
}

/** Tally the events this step produced. Damage is attributed by whether a body caused it. */
function tally(game: GameModel, r: RunResult, lastHit: { by?: HitSource; kind?: string }) {
  for (const e of game.events) {
    if (e.type === 'hurt') {
      const by: HitSource = e.source ? 'enemy' : e.cause === 'spike' ? 'barb' : 'other';
      r.hits[by]++; lastHit.by = by; lastHit.kind = e.source?.kind ?? e.cause;
    } else if (e.type === 'shot') r.shots++;
    else if (e.type === 'land') r.landings++;
    else if (e.type === 'kill') r.kills++;
    else if (e.type === 'doodad') r.doodads++;
  }
  game.events.length = 0;
}

const emptyResult = (): RunResult => ({ outcome: 'timeout', seconds: 0, hits: { barb: 0, enemy: 0, other: 0 }, shots: 0, landings: 0, kills: 0, doodads: 0, depth: 0 });
const localDepth = (game: GameModel) => Math.max(0, (game.player.y - WORLD.startY) / WORLD.pixelsPerMeter);
const exitFloorOf = (game: GameModel) => game.exit ? game.platforms.find(f => f.width >= WORLD.width - WORLD.wall * 2 - 1 && Math.abs(f.y - (game.exit!.y + game.exit!.height)) < 2) : undefined;

/**
 * PASSIVE: placed in the air at `x`, just under the SECTION's opening slab, and never touched again.
 * On the exit floor it is given the walk to the gate, which is not part of the descent.
 */
export function passiveRun(area: AreaId, section: SectionId, seed: number, x: number, maxSeconds = 150): RunResult {
  const game = newRun(area, section, seed);
  const r = emptyResult(), last: { by?: HitSource; kind?: string } = {};
  game.player.x = x; game.player.y = 300; game.player.vy = 0; game.player.grounded = -1;
  game.events.length = 0;
  let still = 0, lastY = game.player.y;
  for (let i = 0; i < maxSeconds * 120; i++) {
    const floor = exitFloorOf(game);
    let dir = 0;
    if (floor && game.player.grounded === floor.id && game.exit) dir = Math.sign(game.exit.x + game.exit.width / 2 - game.player.x);
    game.step(STEP, dir, false);
    tally(game, r, last);
    r.seconds = i * STEP;
    if (game.state === 'upgrade') { r.outcome = 'clear'; break; }
    if (game.state === 'over') { r.outcome = 'dead'; r.deathBy = last.by; r.deathKind = last.kind; break; }
    // Standing for good on something that never goes (a cave floor): the passive player has stopped.
    if (Math.abs(game.player.y - lastY) < 0.01 && !floor) { if (++still > 600) { r.outcome = 'stuck'; break; } } else still = 0;
    lastY = game.player.y;
  }
  r.depth = localDepth(game);
  return r;
}

/**
 * STRAIGHT SHOOTER: the lazy line a human actually takes -- never left or right, but the trigger
 * held on anything that could reach the body from below, and whatever ledge the fall meets is taken
 * for its reload. No steering at all; a straight column of the shaft plus the gunboots.
 */
export function straightRun(area: AreaId, section: SectionId, seed: number, x: number, maxSeconds = 150): RunResult {
  const game = newRun(area, section, seed);
  const r = emptyResult(), last: { by?: HitSource; kind?: string } = {};
  game.player.x = x; game.player.y = 300; game.player.vy = 0; game.player.grounded = -1;
  game.events.length = 0;
  let still = 0, lastY = game.player.y;
  for (let i = 0; i < maxSeconds * 120; i++) {
    const p = game.player, floor = exitFloorOf(game);
    let dir = 0;
    if (floor && p.grounded === floor.id && game.exit) dir = Math.sign(game.exit.x + game.exit.width / 2 - p.x);
    const fire = game.ammo > 0 && game.enemies.some(e => e.alive && e.shootable && e.y > p.y + 8 && e.y < p.y + 420 && Math.abs(e.x - p.x) < 26 && e.y < game.cameraY + WORLD.height);
    game.step(STEP, dir, fire);
    tally(game, r, last);
    r.seconds = i * STEP;
    if (game.state === 'upgrade') { r.outcome = 'clear'; break; }
    if (game.state === 'over') { r.outcome = 'dead'; r.deathBy = last.by; r.deathKind = last.kind; break; }
    if (Math.abs(game.player.y - lastY) < 0.01 && !floor) { if (++still > 600) { r.outcome = 'stuck'; break; } } else still = 0;
    lastY = game.player.y;
  }
  r.depth = localDepth(game);
  return r;
}

/** The hit band of a LIMBO barb row, in player-centre coordinates. */
const barbBand = (f: Platform) => ({ minX: f.x - 13, maxX: f.x + f.width + 13, minY: f.y - LIMBO_HAZARD_RULES.reach - 15, maxY: f.y + 12 + 15 });

interface Plan { cost: number; dir: number; fire: boolean; target: number }

/**
 * Where an enemy's body may be `t` seconds from now, widened to the player's contact reach (24px
 * across, 25px up and down). Movers are given their own room: a column's vertical run, an orbit's
 * circle, a bouncer's diagonal, a phantom's wave.
 */
function enemyBox(e: Enemy, t: number) {
  const ai = e.ai as { kind?: string; vy?: number; vx?: number; radius?: number } | undefined;
  let x = e.x, y = e.y, rx = 24, ry = 25;
  switch (ai?.kind) {
    case 'column': y += (ai.vy ?? 0) * t; ry += 6; break;
    case 'orbit': x = e.originX; y = e.originY ?? e.y; rx += ai.radius ?? 40; ry += ai.radius ?? 40; break;
    case 'bounce': x += (ai.vx ?? 0) * t; y += (ai.vy ?? 0) * t; rx += 10; ry += 10; break;
    case 'phantom': rx += 18; ry += 16; break;
    case 'eye': rx += Math.min(60, 90 * t); ry += Math.min(60, 90 * t); break;
    default: rx += 8; ry += 8;
  }
  return { minX: x - rx, maxX: x + rx, minY: y - ry, maxY: y + ry };
}

/**
 * The search. From (x, y, vy) down to the bottom of the view: the cheapest way through, and which way
 * to press now. `brake` models holding the trigger: the fall is held to the recoil's hover speed while
 * there is CHARGE to spend.
 */
function plan(game: GameModel, fromX: number, fromY: number, fromVy: number, brake: boolean, reaction = 0, hidden = 0): Plan {
  // A player reacts to what appeared at the bottom of the screen `reaction` seconds ago: whatever the
  // fall has brought into view since is not acted on yet.
  const view = game.cameraY + WORLD.height - hidden - Math.max(0, game.player.vy) * reaction;
  const rows = Math.max(1, Math.floor((view - fromY) / ROW));
  if (rows < 2) return { cost: 0, dir: 0, fire: false, target: fromX };
  // Speeds row by row, and how far across each row allows.
  const speed: number[] = [], reach: number[] = [], time: number[] = [];
  let v = Math.max(60, fromVy), t = 0;
  const brakeRows = brake ? Math.floor((game.ammo * BALANCE.shotDelay * 230) / ROW) + 4 : 0;
  for (let i = 0; i < rows; i++) {
    const cap = i < brakeRows ? 230 : game.stats.maxFallSpeed;
    v = Math.min(cap, Math.sqrt(v * v + 2 * BALANCE.gravity * ROW));
    const dt = ROW / v;
    speed.push(v); time.push(t); t += dt;
    reach.push(Math.floor(BALANCE.moveSpeed * dt / COL + 0.0001));
  }
  // Cost of being in each cell, and which cells end the fall.
  const danger: Float32Array[] = [], stop: Int8Array[] = [];
  const barbs = game.platforms.filter(f => f.limboHazard && f.y > fromY - 40 && f.y < view + 40).map(barbBand);
  const solids = game.platforms.filter(f => !f.limboHazard && f.state !== 'broken' && f.y > fromY && f.y < view + 30);
  const doodads = game.doodads.filter(d => d.active && d.y > fromY && d.y < view);
  const enemies = game.enemies.filter(e => e.alive && Math.abs(e.y - fromY) < 900);
  const ammoLow = game.ammo <= 2;
  for (let i = 0; i < rows; i++) {
    const yTop = fromY + i * ROW, yBot = yTop + ROW;
    const d = new Float32Array(COLS), s = new Int8Array(COLS);
    for (const b of barbs) if (b.maxY >= yTop && b.minY <= yBot) for (let c = colOf(b.minX); c <= colOf(b.maxX); c++) if (colX(c) >= b.minX && colX(c) <= b.maxX) d[c] += 100;
    for (const e of enemies) {
      const box = enemyBox(e, time[i]);
      if (box.maxY < yTop || box.minY > yBot) continue;
      for (let c = colOf(box.minX); c <= colOf(box.maxX); c++) if (colX(c) >= box.minX && colX(c) <= box.maxX) d[c] += 90;
    }
    for (const f of solids) {
      const surface = f.y - 15;
      if (surface < yTop || surface >= yBot) continue;
      // A ledge that will give way is a reload, not a resting place; the exit floor ends the SECTION.
      const exitFloor = f.width >= WORLD.width - WORLD.wall * 2 - 1;
      for (let c = 0; c < COLS; c++) if (colX(c) + 9 > f.x && colX(c) - 9 < f.x + f.width) s[c] = exitFloor ? 2 : 1;
    }
    for (const dd of doodads) {
      const surface = dd.y - 15;
      if (surface < yTop || surface >= yBot) continue;
      for (let c = 0; c < COLS; c++) if (colX(c) + 9 > dd.x && colX(c) - 9 < dd.x + DOODAD_RULES.width) s[c] = s[c] || 3;
    }
    danger.push(d); stop.push(s);
  }
  // Backwards: best[i][c] is the cheapest way on from cell (i, c).
  let next = new Float32Array(COLS);
  const choice: Int16Array[] = new Array(rows);
  for (let i = rows - 1; i >= 0; i--) {
    const cur = new Float32Array(COLS), pick = new Int16Array(COLS);
    for (let c = 0; c < COLS; c++) {
      if (stop[i][c]) {
        // Landing: a reload, worth more when the magazine is low. The exit floor is the goal.
        cur[c] = danger[i][c] + (stop[i][c] === 2 ? -50 : ammoLow ? -6 : -1);
        pick[c] = c;
        continue;
      }
      let best = Infinity, at = c;
      const k = i + 1 < rows ? reach[i] : 0;
      for (let dc = -k; dc <= k; dc++) {
        const n = c + dc;
        if (n < 0 || n >= COLS) continue;
        // A small price on moving, so the plan does not dither between equal lanes.
        const v2 = (i + 1 < rows ? next[n] : 0) + Math.abs(dc) * 0.01;
        if (v2 < best) { best = v2; at = n; }
      }
      cur[c] = danger[i][c] + best;
      pick[c] = at;
    }
    choice[i] = pick; next = cur;
  }
  const c0 = colOf(fromX);
  // `next` now holds row 0. Steer toward where the plan goes in the first few rows.
  let c = c0;
  for (let i = 0; i < Math.min(rows, 3); i++) c = choice[i][c];
  const target = colX(c);
  const dir = Math.abs(target - fromX) < 2 ? 0 : Math.sign(target - fromX);
  return { cost: next[c0], dir, fire: brake, target };
}

/** Is a live enemy straight under the player, close enough that a round fired now reaches it first? */
function targetBelow(game: GameModel) {
  const p = game.player;
  return game.enemies.some(e => e.alive && e.shootable && e.y > p.y + 10 && e.y < p.y + 380 && Math.abs(e.x - p.x) < 15 && e.y < game.cameraY + WORLD.height);
}

/**
 * ACTIVE: a human-like run on ordinary HP from the SECTION's opening slab.
 * `react` is how many steps pass between decisions (2 = every 1/60s).
 */
export interface BotSkill {
  /** Steps between decisions. */ react: number;
  /** Seconds before something new on screen is acted on. */ reaction: number;
  /** Px of the bottom of the view the player cannot see (the phone's on-screen buttons). */ hidden?: number;
  /**
   * Holds the trigger to slow a fast fall whenever barbs are close below and CHARGE is to spare -- the
   * way the reference's players run Limbo ("always shooting", 129-218 shots/min). Off: brakes only
   * when the plan says it must.
   */
  cautious?: boolean;
}
/** A precise player: decides every 1/40s, acts on everything on screen at once. */
export const EXPERT: BotSkill = { react: 3, reaction: 0 };
/** A human-like player: decides every 1/20s and acts on what it saw 0.2s ago. */
export const HUMAN: BotSkill = { react: 6, reaction: 0.2, cautious: true };
/**
 * HUMAN on a phone: at 390x844 the three buttons cover the lowest ~119px of the 800px view (measured
 * on the running build: canvas 155-1535, buttons from 1330, at 2x), so less of the fall is seen.
 */
export const HUMAN_MOBILE: BotSkill = { react: 6, reaction: 0.2, hidden: 119, cautious: true };
export function activeRun(area: AreaId, section: SectionId, seed: number, maxSeconds = 200, skill: BotSkill = HUMAN, debug = false): RunResult {
  const react = skill.react;
  const game = newRun(area, section, seed);
  const r = emptyResult(), last: { by?: HitSource; kind?: string } = {};
  game.events.length = 0;
  // In the air the player steers for a spot and lets go of the key on arriving there, between decisions.
  let dir = 0, fire = false, still = 0, lastY = game.player.y, groundedSince = 0, targetX: number | null = null;
  for (let i = 0; i < maxSeconds * 120; i++) {
    const p = game.player;
    if (i % react === 0) {
      const floor = exitFloorOf(game);
      const ground = game.platforms.find(f => f.id === p.grounded);
      if (floor && p.grounded === floor.id && game.exit) {
        dir = Math.sign(game.exit.x + game.exit.width / 2 - p.x); fire = false; targetX = null;
      } else if (ground) {
        targetX = null;
        // On a ledge: it reloaded on contact. Leave by whichever edge has the better way down -- or
        // stay put, when what is under the ledge itself is the best way on.
        groundedSince += react;
        const options = [
          { dir: -1, x: ground.x - 12 },
          { dir: 1, x: ground.x + ground.width + 12 },
          { dir: 0, x: p.x },
        ].filter(o => o.x >= LEFT && o.x <= RIGHT);
        let best = { dir: 0, cost: Infinity };
        for (const o of options) {
          const walk = Math.abs(o.x - p.x) / BALANCE.moveSpeed;
          const breaks = ground.breakable ? 0.65 : Infinity;
          if (o.dir === 0 && !Number.isFinite(breaks)) continue;
          // The walk to that edge, at standing height, counts as much as the fall after it.
          const lo = Math.min(o.x, p.x), hi = Math.max(o.x, p.x), cy = ground.y - 15;
          const walkHurts = game.platforms.some(f => { if (!f.limboHazard) return false; const b = barbBand(f); return b.minY <= cy && b.maxY >= cy && b.maxX >= lo && b.minX <= hi; });
          const cost = plan(game, o.x, ground.y - 15 + 2, 0, false, skill.reaction, skill.hidden).cost + walk * 2 + (walkHurts ? 100 : 0);
          if (cost < best.cost) best = { dir: o.dir, cost };
        }
        dir = best.dir; fire = false;
        // A gate row (AREA 1-3) is opened from on top of it.
        if (ground.breakBlock) { dir = 0; fire = game.ammo > 0; }
        // Something coming at the ledge: shoot it.
        if (targetBelow(game) && game.ammo > 0) fire = true;
      } else {
        groundedSince = 0;
        const free = plan(game, p.x, p.y, p.vy, false, skill.reaction, skill.hidden);
        let chosen = free;
        if (free.cost > 0 && game.ammo > 0) {
          const braked = plan(game, p.x, p.y, p.vy, true, skill.reaction, skill.hidden);
          if (braked.cost < free.cost - 5) chosen = braked;
        }
        dir = chosen.dir;
        targetX = chosen.target;
        fire = chosen.fire || (targetBelow(game) && game.ammo > 0);
        if (skill.cautious && !fire && p.vy > 520 && game.ammo > 2
          && game.platforms.some(f => f.limboHazard && f.y > p.y && f.y < p.y + 350 && Math.abs(f.x + f.width / 2 - p.x) < f.width / 2 + 80)) fire = true;
      }
    }
    if (targetX !== null && p.grounded === -1) dir = Math.abs(targetX - p.x) < 1.5 ? 0 : Math.sign(targetX - p.x);
    const before = { x: p.x, y: p.y, vy: p.vy, g: p.grounded, ammo: game.ammo, dir, fire };
    game.step(STEP, dir, fire);
    if (debug) for (const e of game.events) if (e.type === 'hurt') {
      const near = game.platforms.filter(f => Math.abs(f.y - p.y) < 160).map(f => `${f.limboHazard ? 'B' : f.breakable ? 'L' : 'S'}[${Math.round(f.x)}..${Math.round(f.x + f.width)}@${Math.round(f.y)}]`).join(' ');
      const en = game.enemies.filter(e2 => e2.alive && Math.abs(e2.y - p.y) < 200).map(e2 => `${e2.kind}(${Math.round(e2.x)},${Math.round(e2.y)})`).join(' ');
      console.log(`HIT t=${(i * STEP).toFixed(2)} cause=${e.cause} src=${e.source?.kind ?? '-'} before=${JSON.stringify(before)} now=(${p.x.toFixed(0)},${p.y.toFixed(0)}) cam=${game.cameraY.toFixed(0)} | ${near} | ${en}`);
    }
    tally(game, r, last);
    r.seconds = i * STEP;
    if (game.state === 'upgrade') { r.outcome = 'clear'; break; }
    if (game.state === 'over') { r.outcome = 'dead'; r.deathBy = last.by; r.deathKind = last.kind; break; }
    if (Math.abs(game.player.y - lastY) < 0.01 && p.grounded !== -1) { if (++still > 1200) { r.outcome = 'stuck'; break; } } else still = 0;
    lastY = game.player.y;
  }
  r.depth = localDepth(game);
  return r;
}

export const isLimboEnemy = (kind: Enemy['kind']) => !ENEMY_TYPES[kind].stompable;

/**
 * LINE ORACLE: follows exactly the lines the generator promised (`limboLines`, read by cast), with
 * every body and doodad taken out, and counts each time its body enters a barb's hit band. The
 * generator's own guarantee is that this count is zero. Invulnerable, so one bad band cannot hide
 * the rest of the SECTION.
 */
export function lineRun(section: SectionId, seed: number, maxSeconds = 150) {
  const game = newRun(4, section, seed);
  const lines = (game as unknown as { generator: { limboLines: { x0: number; y0: number; x1: number; y1: number; walkFrom: number }[] } }).generator.limboLines;
  let line: (typeof lines)[number] | undefined, touches = 0, inside = new Set<number>(), lost = 0;
  const touched: { x: number; y: number; barb: number; line?: typeof line }[] = [];
  for (let i = 0; i < maxSeconds * 120; i++) {
    const p = game.player;
    p.invincible = 99;
    game.enemies = []; game.doodads = [];
    const floor = exitFloorOf(game);
    let dir = 0;
    const ground = game.platforms.find(f => f.id === p.grounded);
    if (floor && p.grounded === floor.id && game.exit) dir = Math.sign(game.exit.x + game.exit.width / 2 - p.x);
    else if (ground && 'exitX' in ground) {
      const g = ground as Platform & { exitX: number; safeX: number };
      line = lines.find(t => Math.abs(t.x0 - g.exitX) < 1 && Math.abs(t.y0 - g.y) < 1);
      if (!line) { lost++; dir = Math.sign(g.exitX - p.x) || 1; }
      else dir = Math.sign(line.x0 - p.x) || (line.x0 > g.x + g.width / 2 ? 1 : -1);
    } else if (line && p.y < line.y1) {
      const top = line.y0 - 15, d = p.y - top, dx = line.x1 - line.x0;
      const steer = 0.9 * BALANCE.moveSpeed * Math.max(0, fallFrom(d) - 0.15);
      const target = line.x0 + Math.sign(dx) * Math.min(Math.abs(dx), steer);
      dir = Math.abs(target - p.x) < 1.5 ? 0 : Math.sign(target - p.x);
    }
    game.step(STEP, dir, false);
    game.events.length = 0;
    for (const f of game.platforms) {
      if (!f.limboHazard) continue;
      const hit = p.x + 9 >= f.x && p.x - 9 <= f.x + f.width && p.y + 15 >= f.y - LIMBO_HAZARD_RULES.reach && p.y - 15 <= f.y + 12;
      if (hit && !inside.has(f.id)) { touches++; touched.push({ x: p.x, y: p.y, barb: f.id, line }); }
      if (hit) inside.add(f.id); else inside.delete(f.id);
    }
    if (game.state !== 'playing') break;
  }
  return { cleared: game.state === 'upgrade', touches, touched, lost };
}
import { fallTime as fallFrom } from '../src/data/difficulty';
