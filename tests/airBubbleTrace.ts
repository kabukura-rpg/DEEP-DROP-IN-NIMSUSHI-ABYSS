import { GameModel } from '../src/systems/GameModel';
import type { UpgradeId } from '../src/data/upgrades';
import type { AreaId, SectionId } from '../src/data/areas';

/**
 * A fingerprint of everything a released AIR bubble touches in play, through the real GameModel. Hashed EVERY step:
 * the player (position, velocity), HP, oxygen, whether time is frozen, every bubble (id, centre, velocity, life, arm,
 * taken), every container's broken / debris, and every containerBreak / oxygen / section / timeVoid / hurt event;
 * every 12th step the state, camera and SECTION. Model-only -- nothing from the scene -- so the values computed at the
 * baseline and at the candidate can be compared directly. The golden values in tests/airBubbleArt.test.ts were
 * produced by this same file on a git archive of 5969f37.
 *
 * The input bot swims toward the nearest armed bubble when one is in reach and otherwise drifts on a seeded pattern,
 * so the runs break containers (contact and shot), chase and catch air, let bubbles expire, leave some behind the
 * camera, and cross SECTIONs.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** FNV-1a over two lanes, as in tests/timeoutTrace.ts. */
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

export interface AirBubbleTrace {
  digest: string;
  /** Bubbles the model made (distinct ids), the most alive at once, containers broken, oxygen events (catches and any other air), air they restored. */
  bubbles: number; maxLive: number; breaks: number; oxygenEvents: number; restored: number;
  sections: number; ticks: number; final: string;
}

const EVENTS = new Set<string>(['containerBreak', 'oxygen', 'section', 'timeVoid', 'hurt', 'over']);

class Recorder {
  hash = fnv(); seen = new Set<number>(); maxLive = 0; breaks = 0; oxygenEvents = 0; restored = 0; sections = 0; ticks = 0;
  step(g: GameModel, i: number) {
    const p = g.player;
    this.ticks++;
    this.maxLive = Math.max(this.maxLive, g.bubbles.length);
    let s = `${i}|p${r3(p.x)},${r3(p.y)},${r3(p.vy)}|h${g.hp}|o${r3(g.oxygen.remaining)}|f${g.timeFrozen ? 1 : 0}|`;
    for (const b of g.bubbles) { this.seen.add(b.id); s += `a${b.id}:${r3(b.x)},${r3(b.y)},${r3(b.vx)},${r3(b.vy)},${r3(b.life)},${r3(b.arm)},${b.taken ? 1 : 0};`; }
    for (const c of g.containers) s += `c${c.id}:${c.broken ? 1 : 0},${r3(c.debris)};`;
    this.hash.update(s);
    for (const ev of g.events) {
      if (!EVENTS.has(ev.type)) continue;
      if (ev.type === 'containerBreak') this.breaks++;
      if (ev.type === 'oxygen') { this.oxygenEvents++; this.restored = r3(this.restored + (ev.value ?? 0)); }
      if (ev.type === 'section') this.sections++;
      this.hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
    }
    g.events.length = 0;
    if (i % 12 === 0) this.hash.update(`${i}|${g.state}|${r3(g.cameraY)}|${g.stage.label}|`);
  }
  result(g: GameModel): AirBubbleTrace {
    return { digest: this.hash.digest(), bubbles: this.seen.size, maxLive: this.maxLive, breaks: this.breaks, oxygenEvents: this.oxygenEvents, restored: this.restored, sections: this.sections, ticks: this.ticks, final: `${g.state}@${g.stage.label}` };
  }
}

/** `enter` moves a fresh model to where the run starts. `low` empties the tank first so every catch restores air. */
export interface AirBubbleRun { enter: (g: GameModel) => void; held?: UpgradeId[]; seconds?: number; sections?: number; seeds?: number; low?: boolean }

export function airBubbleTrace({ enter, held = [], seconds = 20, sections = 1, seeds = 3, low = true }: AirBubbleRun): AirBubbleTrace {
  const rec = new Recorder();
  let g!: GameModel;
  for (let seed = 1; seed <= seeds; seed++) {
    g = new GameModel(false, seeded(seed * 733));
    for (const id of held) g.upgrades.grant(id);
    (g as unknown as { syncUpgrades: () => void }).syncUpgrades();
    enter(g);
    if (low) g.oxygen.remaining = Math.min(g.oxygen.remaining, 3);
    const input = seeded(seed * 37 + 11);
    let dir = 0, fire = false;
    for (let section = 0; section < sections; section++) {
      if (section > 0) {
        if (!g.completeSection()) break;
        g.selectUpgrade(g.upgrades.choices[0].id); g.confirmUpgrade();
      }
      for (let i = 0; i < 120 * seconds; i++) {
        if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
        const p = g.player;
        const near = g.bubbles.filter(b => !b.taken && b.arm <= 0 && Math.abs(b.y - p.y) < 90).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        if (near) { dir = Math.abs(near.x - p.x) < 6 ? 0 : Math.sign(near.x - p.x); fire = false; }
        else if (i % 18 === 0) {
          const r = input();
          dir = r < 0.35 ? -1 : r < 0.7 ? 1 : 0;
          fire = input() < 0.5;
        }
        // Kept alive and breathing so a run sees several bursts; a top-up of HP is not a catch.
        if (g.hp < 2) g.health.heal(2);
        if (g.oxygen.enabled && g.oxygen.remaining < 0.5) g.oxygen.remaining = 0.5;
        g.step(1 / 120, dir, fire);
        rec.step(g, i + section * 100000 + seed * 10000000);
      }
    }
  }
  return rec.result(g);
}

const stage = (area: AreaId, section: SectionId) => (g: GameModel) => { g.jumpToStage(area, section); };

/** The fixture runs the golden values cover. */
export const AIR_BUBBLE_TRACE_SCENARIOS: Record<string, AirBubbleRun> = {
  'area3 1': { enter: stage(3, 1) },
  'area3 2': { enter: stage(3, 2) },
  'area3 3': { enter: stage(3, 3) },
  'area3 full tank': { enter: stage(3, 1), low: false },
  'area3 sections x3': { enter: stage(3, 1), seconds: 12, sections: 3 },
  'area3 timeout': { enter: stage(3, 1), held: ['timeout'] },
  'area1 no air': { enter: stage(1, 1), seconds: 10 },
};
