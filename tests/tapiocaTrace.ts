import type { GameModel } from '../src/systems/GameModel';
import { fighting, round, seeded, STEP } from './nimushi';

/**
 * A fingerprint of everything the BOSS's TRIPLE SHOT pearls touch in play: scripted fights through the real
 * GameModel (player physics, rounds, the boss system, contact and shoot-down), with every pearl (id, position,
 * velocity, size, life, damage), the boss (state, phase, HP, position), the player (position, velocity, HP) and
 * every kill / hurt / bossFire / bossPhase / bossDown event hashed each tick. Model-only -- nothing from the
 * scene -- so the values computed at 959a5f4 and at the candidate can be compared directly. The golden values in
 * tests/tapiocaProjectileArt.test.ts were produced by this same file on a git archive of 959a5f4.
 *
 * FIXTURE, not natural play: the fight is opened at its own distance (tests/nimushi.ts `fighting`), a real round
 * is put into the eye every tenth of a second while it is open, and HP is topped up below 2 so one run can see
 * all four phases. Pearls still spawn, fly, hit the player and get shot down only by the model's own code.
 */
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

export interface TapiocaTrace {
  digest: string;
  /** Distinct pearls seen, and per boss phase. */
  pearls: number; byPhase: number[];
  /** Most pearls alive on one tick. */
  maxLive: number;
  /** Pearls that left the list with life to spare (shot down, hit the player, or left 1.4 screens behind), and player hits by a pearl. */
  removedEarly: number; playerHits: number;
  phases: number[]; defeated: boolean; ticks: number;
}

const EVENTS = new Set<string>(['kill', 'hurt', 'bossHit', 'bossFire', 'bossPhase', 'bossDown', 'bossShot']);

export function tapiocaTrace(seed: number, seconds = 150, start: (seed: number) => GameModel = fighting): TapiocaTrace {
  const hash = fnv();
  const g = start(seed);
  const input = seeded(seed * 31 + 9);
  const seen = new Map<number, number>();
  const byPhase = [0, 0, 0, 0];
  let maxLive = 0, removedEarly = 0, playerHits = 0, dir = 0, fire = false, ticks = 0;
  let live = new Map<number, number>();
  const phases = new Set<number>();
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    if (g.state === 'over' || g.state === 'clear' || g.boss.defeated) break;
    if (i % 12 === 0) {
      const r = input();
      dir = r < 0.3 ? -1 : r < 0.6 ? 1 : 0;
      fire = input() < 0.6;
    }
    if (g.boss.eyeOpen && g.boss.started && i % 12 === 6) g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
    if (g.hp < 2) g.health.heal(g.stats.maxHp);
    const hpBefore = g.hp;
    g.step(STEP, dir, fire);
    ticks++;
    const boss = g.boss;
    phases.add(boss.phaseId);
    const now = new Map<number, number>();
    let line = `${boss.state}|${boss.phaseId}|${r3(boss.hp)}|${r3(boss.x)}|${r3(boss.y)}|${r3(g.player.x)}|${r3(g.player.y)}|${r3(g.player.vy)}|${g.hp}`;
    for (const p of boss.tapiocas) {
      now.set(p.id, p.life);
      if (!seen.has(p.id)) { seen.set(p.id, boss.phaseId); byPhase[boss.phaseId - 1]++; }
      line += `|${p.id}:${r3(p.x)},${r3(p.y)},${r3(p.vx)},${r3(p.vy)},${p.size},${r3(p.life)},${p.damage}`;
    }
    for (const [id, life] of live) if (!now.has(id) && life > STEP * 2) removedEarly++;
    live = now;
    maxLive = Math.max(maxLive, boss.tapiocas.length);
    for (const e of g.events) {
      if (!EVENTS.has(e.type)) continue;
      line += `|${e.type}:${r3(e.x)},${r3(e.y)},${e.value}`;
    }
    if (g.hp < hpBefore && g.health.lastDamage?.cause === 'bossShot') playerHits++;
    hash.update(line + '\n');
  }
  return {
    digest: hash.digest(), pearls: seen.size, byPhase, maxLive, removedEarly, playerHits,
    phases: [...phases].sort(), defeated: g.boss.defeated, ticks,
  };
}
