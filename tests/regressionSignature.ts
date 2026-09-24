import { GameModel } from '../src/systems/GameModel';
import { StageGenerator } from '../src/systems/StageGenerator';
import { areaConfig, type AreaId } from '../src/data/areas';

/**
 * Stable fingerprints of what an AREA generates and how a run through it plays, so a change meant for
 * one AREA can be proved to have left the others exactly as they were. The golden values these are
 * compared with in the tests were produced by this same file at the commit named there.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** FNV-1a over two independent 32-bit lanes: plain JS, stable, and 64 bits of fingerprint. */
function createHash(_algorithm: 'fnv') {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  return {
    update(text: string) {
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
      }
    },
    digest(_enc: 'hex') { return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + ((a ^ b) >>> 0).toString(16).padStart(8, '0'); },
  };
}

/** Everything a SECTION's generator lays, for `seeds` seeds of every SECTION of one AREA. */
export function generationSignature(areaId: AreaId, seeds = 20) {
  const area = areaConfig(areaId);
  const hash = createHash('fnv');
  for (let n = 1; n <= area.sections; n++) {
    for (let s = 1; s <= seeds; s++) {
      const g = new StageGenerator(seeded(s * 7919 + n * 101 + areaId), {
        plan: area.plans?.[n - 1], enemyPool: area.enemyPool, water: area.water,
        oxygen: area.gimmicks?.oxygen === true, heat: area.gimmicks?.heat === true,
        breakable: area.gimmicks?.breakablePlatforms === true, sectionLength: area.sectionLength,
      });
      for (let c = 0; c < 24; c++) {
        const k = g.chunk(c);
        for (const p of k.platforms) hash.update(`P${p.id}|${r3(p.x)}|${r3(p.y)}|${r3(p.width)}|${p.safeSide}|${r3(p.safeX)}|${r3(p.exitX)}|${p.breakBlock?.reward ?? ''}|${p.spikePlatform ? 1 : 0}|${p.limboHazard ? 1 : 0}|${p.safeZone ?? ''};`);
        for (const e of k.enemies) hash.update(`E${e.id}|${e.kind}|${r3(e.originX)}|${r3(e.y)}|${r3(e.range)}|${r3(e.phase)}|${e.slot};`);
        for (const b of k.containers) hash.update(`C${b.id}|${r3(b.x)}|${r3(b.y)};`);
        for (const d of k.doodads) hash.update(`D${d.id}|${r3(d.x)}|${r3(d.y)}|${d.variant};`);
        for (const z of k.safeZones) hash.update(`Z${z.id}|${z.side}|${r3(z.x)}|${r3(z.y)}|${z.content?.kind ?? ''};`);
        for (const v of k.caves) hash.update(`V${v.id}|${v.side}|${r3(v.bounds.x)}|${r3(v.bounds.y)}|${r3(v.bounds.width)}|${r3(v.bounds.height)};`);
        for (const h of k.hazards) hash.update(`H${h.id}|${h.kind}|${r3(h.x)}|${r3(h.y)};`);
      }
    }
  }
  return hash.digest('hex').slice(0, 24);
}

/**
 * A scripted run: the same inputs, seed for seed, through the real GameModel, with the whole visible
 * state hashed every half second -- player, HP, score, chain, every enemy and every event. Identical
 * values mean identical play, down to each hit and each stomp.
 */
export function replaySignature(start: (g: GameModel) => void, seeds = 6, seconds = 12) {
  const hash = createHash('fnv');
  for (let seed = 1; seed <= seeds; seed++) {
    const g = new GameModel(false, seeded(seed * 613));
    start(g);
    const input = seeded(seed * 7 + 1); let dir = 0, fire = false;
    for (let i = 0; i < 120 * seconds; i++) {
      if (g.state === 'over' || g.state === 'upgrade') break;
      if (i % 24 === 0) { const r = input(); dir = r < 0.33 ? -1 : r < 0.66 ? 1 : 0; fire = input() < 0.45; }
      g.step(1 / 120, dir, fire);
      if (i % 60 === 0) {
        const p = g.player;
        hash.update(`${i}|${r3(p.x)}|${r3(p.y)}|${r3(p.vy)}|${g.hp}|${g.combo}|${g.state}|`);
        for (const e of g.enemies) hash.update(`${e.id}:${r3(e.x)}:${r3(e.y)}:${e.alive};`);
        for (const ev of g.events) hash.update(`${ev.type}@${r3(ev.x)},${r3(ev.y)};`);
      }
      g.events.length = 0;
    }
  }
  return hash.digest('hex').slice(0, 24);
}

/**
 * Start a replay the moment the run ENTERS the AREA (or the fight), with the run's random stream
 * replaced there. A fresh GameModel first sets up 1-1, and how many numbers that draws depends on
 * AREA 1's own terrain -- so without this, re-shaping AREA 1 would move every other AREA's replay
 * and the boss's with it, and the fingerprint would stop saying anything about the AREA it names.
 */
export function entered(go: (g: GameModel) => void) {
  let k = 0;
  return (g: GameModel) => { (g as unknown as { random: () => number }).random = seeded(9001 + ++k * 37); go(g); };
}
