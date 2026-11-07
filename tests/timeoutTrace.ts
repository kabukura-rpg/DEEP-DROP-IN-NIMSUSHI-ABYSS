import { GameModel } from '../src/systems/GameModel';
import { WORLD } from '../src/data/balance';
import type { UpgradeId } from '../src/data/upgrades';
import type { AreaId, SectionId } from '../src/data/areas';

/**
 * A fingerprint of everything a TIMEOUT bubble touches in play, through the real GameModel. Hashed EVERY step: the
 * player (position, velocity, grounded), HP, oxygen, whether time is frozen, every bubble (id, centre, radius) and
 * every hurt / timeVoid / section / upgrade / kill event; every 12th step the score, combo, kills, state, camera,
 * SECTION, rounds and live enemies. Model-only -- nothing from the scene -- so the values computed at the baseline
 * and at the candidate can be compared directly. The golden values in tests/timeoutArt.test.ts were produced by this
 * same file on a git archive of e9b0e2a.
 *
 * Two kinds of run, recorded apart:
 * - NATURAL (`naturalTimeoutRun`): output/timeout-area-visual-design-v1/harness/natural.ts's input bot, from a fresh
 *   model -- no grant, warp, placement, HP change or direct damage. It plays 1-1, takes TIMEOUT at the REST, and is
 *   hit by a caveBat in 1-2 (seed 813); it then keeps playing past the bubble (out, in, out again) into 1-3.
 * - FIXTURE (`timeoutTrace`): TIMEOUT granted, jumped to an AREA or the fight, hits left to the model (mortal runs),
 *   optionally with `bubbles` pushed in around the player (2 / 6 / 12 overlapping), and rolled across SECTIONs.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** FNV-1a over two lanes, as in tests/jetpackTrace.ts. */
function fnv() {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  return {
    update(text: string) {
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
      }
    },
    digest() { return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); },
  };
}

export interface TimeoutTrace {
  digest: string;
  /** Bubbles the model made (distinct ids), the most alive at once, steps spent frozen, TIME VOID entries / exits. */
  bubbles: number; maxLive: number; frozenSteps: number; entries: number; exits: number;
  hits: number; sections: number; ticks: number; final: string;
}

const EVENTS = new Set<string>(['hurt', 'timeVoid', 'section', 'upgrade', 'kill', 'oxygen', 'exit', 'bossHit', 'bossPhase', 'over']);

class Recorder {
  hash = fnv(); seen = new Set<number>(); maxLive = 0; frozenSteps = 0; entries = 0; exits = 0; hits = 0; sections = 0; ticks = 0;
  step(g: GameModel, i: number) {
    const p = g.player;
    this.ticks++;
    if (g.timeFrozen) this.frozenSteps++;
    this.maxLive = Math.max(this.maxLive, g.timeoutBubbles.length);
    let s = `${i}|p${r3(p.x)},${r3(p.y)},${r3((p as { vx?: number }).vx ?? 0)},${r3(p.vy)},${p.grounded}|h${g.hp}|o${r3(g.oxygen.remaining)}|f${g.timeFrozen ? 1 : 0}|`;
    for (const b of g.timeoutBubbles) { this.seen.add(b.id); s += `t${b.id}:${r3(b.x)},${r3(b.y)},${b.radius};`; }
    this.hash.update(s);
    for (const ev of g.events) {
      if (!EVENTS.has(ev.type)) continue;
      if (ev.type === 'hurt') this.hits++;
      if (ev.type === 'section') this.sections++;
      if (ev.type === 'timeVoid') { if (ev.value === 1) this.entries++; else this.exits++; }
      this.hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
    }
    g.events.length = 0;
    if (i % 12 === 0) {
      this.hash.update(`${i}|${g.kills}|${g.score}|${g.combo}|${g.state}|${r3(g.cameraY)}|${g.stage.label}|${g.upgrades.acquired.join(',')}|`);
      for (const b of g.bullets) this.hash.update(`b${r3(b.x)},${r3(b.y)};`);
      for (const e of g.enemies) if (e.alive) this.hash.update(`${e.kind}:${r3(e.x)}:${r3(e.y)}:${e.hp};`);
      if (g.boss.enabled) this.hash.update(`B${g.boss.state}|${g.boss.phase}|${g.boss.hp}|${g.boss.tapiocas.length}|`);
    }
  }
  result(g: GameModel): TimeoutTrace {
    return { digest: this.hash.digest(), bubbles: this.seen.size, maxLive: this.maxLive, frozenSteps: this.frozenSteps, entries: this.entries, exits: this.exits, hits: this.hits, sections: this.sections, ticks: this.ticks, final: `${g.state}@${g.stage.label}` };
  }
}

/**
 * The NATURAL run. Until the first bubble the bot is natural.ts's; afterwards the same rules keep steering (so it
 * walks out of the bubble, falls on, and the camera leaves it behind) for `after` more seconds.
 */
export function naturalTimeoutRun(seed = 813, after = 30): TimeoutTrace & { reached: boolean; bubbleTick: number } {
  const model = new GameModel(false, seeded(seed));
  const p = model.player;
  const rec = new Recorder();
  let dir = 0, fire = false, previousGround = -1, bubbleTick = -1;
  const limit = 120 * 70;
  for (let tick = 0; tick < limit + 120 * after; tick++) {
    if (bubbleTick < 0 && tick >= limit) break;
    if (bubbleTick >= 0 && tick >= bubbleTick + 120 * after) break;
    const ground = model.platforms.find(f => f.id === p.grounded);
    const gate = model.exit;
    if (ground) {
      if (gate && Math.abs(ground.y - gate.y - gate.height) < 3) {
        dir = Math.sign(gate.x + gate.width / 2 - p.x);
      } else if (previousGround !== ground.id || !dir) {
        const left = ground.x - 12, right = ground.x + ground.width + 12;
        dir = left < WORLD.wall + 10 ? 1 : right > WORLD.width - WORLD.wall - 10 ? -1 :
          p.x - left < right - p.x ? -1 : 1;
      }
      fire = !!ground.breakBlock && ground.width < 100 && tick % 42 < 22;
    } else {
      fire = false;
      if (model.upgrades.has('timeout')) {
        const target = model.enemies.filter(e => e.alive && e.y > p.y - 10 && e.y < p.y + 140).sort((a, b) => a.y - b.y)[0];
        if (target) {
          const offset = target.x - p.x;
          dir = Math.abs(offset) > 18 ? Math.sign(offset) : 0;
        }
      }
      if (gate && p.y > gate.y - 280) dir = Math.abs(gate.x + gate.width / 2 - p.x) < 7 ? 0 : Math.sign(gate.x + gate.width / 2 - p.x);
      if (p.x < WORLD.wall + 16 && dir < 0 || p.x > WORLD.width - WORLD.wall - 16 && dir > 0) dir = 0;
    }
    previousGround = p.grounded;
    model.step(1 / 120, dir, fire);
    rec.step(model, tick);
    if (model.state === 'upgrade') {
      const choices = model.upgrades.choices.map(u => u.id);
      const pick = choices.includes('timeout') && !model.upgrades.has('timeout') ? 'timeout' : choices[0];
      if (!model.selectUpgrade(pick) || !model.confirmUpgrade()) break;
    }
    if (bubbleTick < 0 && model.timeoutBubbles.length) bubbleTick = tick;
    if (model.state === 'over' || model.state === 'shop' || model.state === 'clear') break;
  }
  return { ...rec.result(model), reached: bubbleTick >= 0, bubbleTick };
}

/** `enter` moves a fresh model (TIMEOUT already granted) to where the run starts; `bubbles` are pushed in on the first step. */
export interface TimeoutRun { enter: (g: GameModel) => void; held?: UpgradeId[]; seconds?: number; sections?: number; bubbles?: number; seeds?: number }

export function timeoutTrace({ enter, held = ['timeout'], seconds = 12, sections = 1, bubbles = 0, seeds = 2 }: TimeoutRun): TimeoutTrace {
  const rec = new Recorder();
  let g!: GameModel;
  for (let seed = 1; seed <= seeds; seed++) {
    g = new GameModel(false, seeded(seed * 911));
    for (const id of held) g.upgrades.grant(id);
    (g as unknown as { syncUpgrades: () => void }).syncUpgrades();
    enter(g);
    (g as unknown as { random: () => number }).random = seeded(seed * 4099 + 23);
    // Overlapping stress bubbles, as the model would make them (one id each, radius 96), around and below the player.
    for (let k = 0; k < bubbles; k++) {
      const a = k * 2.399;
      g.timeoutBubbles.push({ id: 1000 + k, x: Math.max(60, Math.min(390, g.player.x + Math.cos(a) * 18 * Math.sqrt(k))), y: g.player.y + 60 + Math.sin(a) * 18 * Math.sqrt(k) + k * 14, radius: 96 });
    }
    const input = seeded(seed * 29 + 5);
    let dir = 0, fire = false;
    for (let section = 0; section < sections; section++) {
      if (section > 0) {
        if (!g.completeSection()) break;
        g.selectUpgrade(g.upgrades.choices[0].id); g.confirmUpgrade();
      }
      for (let i = 0; i < 120 * seconds; i++) {
        if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
        if (i % 18 === 0) {
          const r = input();
          dir = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
          fire = input() < 0.5;
        }
        // Mortal, but kept alive so a run sees several hits (and several bubbles); a top-up is not a hit.
        if (g.hp < 2) g.health.heal(2);
        g.step(1 / 120, dir, fire);
        rec.step(g, i + section * 100000 + seed * 10000000);
      }
    }
  }
  return rec.result(g);
}

const stage = (area: AreaId, section: SectionId) => (g: GameModel) => { g.jumpToStage(area, section); };
const boss = (g: GameModel) => { g.jumpToNimushi(); };

/** The fixture runs the golden values cover. */
export const TIMEOUT_TRACE_SCENARIOS: Record<string, TimeoutRun> = {
  'area1 no timeout': { enter: stage(1, 1), held: [] },
  'area1 timeout': { enter: stage(1, 1) },
  'area1 timeout x2': { enter: stage(1, 2), bubbles: 2 },
  'area1 timeout x6': { enter: stage(1, 2), bubbles: 6 },
  'area1 timeout x12': { enter: stage(1, 3), bubbles: 12 },
  'area1 sections x3': { enter: stage(1, 1), seconds: 8, sections: 3, bubbles: 3 },
  'area2 timeout': { enter: stage(2, 1), bubbles: 1 },
  'area3 timeout': { enter: stage(3, 1), bubbles: 3 },
  'area4 timeout': { enter: stage(4, 1), bubbles: 6 },
  'area4 stacked': { enter: stage(4, 2), held: ['timeout', 'drone', 'heartBalloon', 'safetyJetpack'], bubbles: 2 },
  'boss timeout': { enter: boss, seconds: 20 },
  'boss timeout x12': { enter: boss, seconds: 20, bubbles: 12 },
};
