import { GameModel } from '../src/systems/GameModel';
import type { UpgradeId } from '../src/data/upgrades';

/**
 * A fingerprint of everything a body does in play: scripted runs through the real GameModel, with
 * every corpse (id, position, velocity, life, claim) and the run's kills, OMNOM count, HP, score,
 * chain and coins hashed every tenth of a second, and every kill / corpse / heal / explosion /
 * section event hashed as it happens. Model-only -- nothing from the scene -- so the value computed
 * at the baseline and at the candidate can be compared directly. The golden values in
 * tests/corpseArt.test.ts were produced by this same file at e948ece.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** FNV-1a over two lanes, as in tests/regressionSignature.ts. */
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

export interface CorpseTrace { digest: string; spawned: number; eaten: number; explosions: number; heals: number; most: number }

export function corpseTrace(start: (g: GameModel) => void, held: UpgradeId[], seeds = 4, seconds = 16): CorpseTrace {
  const hash = fnv();
  let spawned = 0, eaten = 0, explosions = 0, heals = 0, most = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const g = new GameModel(false, seeded(seed * 389));
    for (const id of held) g.upgrades.grant(id);
    start(g);
    (g as unknown as { random: () => number }).random = seeded(seed * 4099 + 7);
    const input = seeded(seed * 11 + 3); let dir = 0, fire = false;
    for (let i = 0; i < 120 * seconds; i++) {
      if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
      // Chase the nearest live enemy most of the time, so bodies are actually laid, eaten and shot.
      if (i % 12 === 0) {
        const p = g.player, target = g.enemies.filter(e => e.alive).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        const r = input();
        dir = target && r < 0.75 ? Math.sign(target.x - p.x) : r < 0.85 ? -1 : r < 0.95 ? 1 : 0;
        fire = input() < 0.7;
      }
      g.player.invincible = 99;
      g.step(1 / 120, dir, fire);
      for (const ev of g.events) {
        if (ev.type === 'kill' || ev.type === 'corpse' || ev.type === 'heal' || ev.type === 'explosion' || ev.type === 'section') {
          hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
        }
        if (ev.type === 'corpse') eaten++;
        if (ev.type === 'explosion') explosions++;
        if (ev.type === 'heal') heals++;
      }
      g.events.length = 0;
      most = Math.max(most, g.corpses.length);
      if (i % 12 === 0) {
        hash.update(`${i}|${g.kills}|${g.corpsesEaten}|${g.hp}|${g.score}|${g.combo}|${g.coins.coins.length}|${g.state}|`);
        for (const c of g.corpses) hash.update(`${c.id}:${r3(c.x)}:${r3(c.y)}:${r3(c.vy)}:${r3(c.life)}:${c.claimed};`);
      }
    }
    // Every body the run laid, including any eaten on the tick it fell.
    spawned += (g as unknown as { nextCorpseId: number }).nextCorpseId - 1;
  }
  return { digest: hash.digest(), spawned, eaten, explosions, heals, most };
}

/** The runs the golden values cover: every place a body can be laid, with and without the two upgrades. */
export const CORPSE_TRACE_SCENARIOS: Record<string, { start: (g: GameModel) => void; held: UpgradeId[]; seconds?: number }> = {
  'area1 plain': { start: g => g.jumpToStage(1, 1), held: [] },
  'area1 knife': { start: g => g.jumpToStage(1, 1), held: ['knifeAndFork'] },
  'area1 knife+rest': { start: g => g.jumpToStage(1, 2), held: ['knifeAndFork', 'restInPieces'] },
  'area2 knife': { start: g => g.jumpToStage(2, 1), held: ['knifeAndFork'] },
  'area2 rest': { start: g => g.jumpToStage(2, 2), held: ['restInPieces'] },
  'area3 knife': { start: g => g.jumpToStage(3, 1), held: ['knifeAndFork'] },
  'area3 knife+rest': { start: g => g.jumpToStage(3, 2), held: ['knifeAndFork', 'restInPieces'] },
  'area4 knife+rest': { start: g => g.jumpToStage(4, 1), held: ['knifeAndFork', 'restInPieces'] },
  'area4-3 knife+rest': { start: g => g.jumpToStage(4, 3), held: ['knifeAndFork', 'restInPieces'] },
  'boss knife+rest': { start: g => { g.jumpToNimushi(); }, held: ['knifeAndFork', 'restInPieces'], seconds: 40 },
};
