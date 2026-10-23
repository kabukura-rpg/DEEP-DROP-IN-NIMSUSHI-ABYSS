import { GameModel } from '../src/systems/GameModel';
import type { UpgradeId } from '../src/data/upgrades';
import type { AreaId, SectionId } from '../src/data/areas';
import type { Bullet } from '../src/systems/GameModel';
import { fighting } from './nimushi';

/**
 * A fingerprint of everything DRONE touches in play: scripted runs through the real GameModel, with
 * every round (source, position, velocity, carried descent, damage, size, range, travel) and the run's
 * kills, score, chain, HP, CHARGE, player position and state hashed every tenth of a second, and every
 * shot / kill / hit / explosion / section event hashed as it happens. Model-only -- nothing from the
 * scene -- so the value computed at the baseline and at the candidate can be compared directly. The
 * golden values in tests/droneArt.test.ts were produced by this same file at 7e4c59d.
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

export interface DroneTrace { digest: string; droneRounds: number; playerRounds: number; kills: number; hits: number }

const EVENTS = new Set<string>(['shot', 'kill', 'hurt', 'heal', 'land', 'explosion', 'section', 'balloon', 'jetpack', 'coinHigh', 'comboSettle', 'bossHit', 'bossFire', 'bossPhase', 'bossDown', 'exit']);

export function droneTrace(start: (seed: number) => GameModel, held: UpgradeId[], { seeds = 3, seconds = 12, invincible = true } = {}): DroneTrace {
  const hash = fnv();
  let droneRounds = 0, playerRounds = 0, kills = 0, hits = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const g = start(seed);
    for (const id of held) g.upgrades.grant(id);
    (g as unknown as { syncUpgrades: () => void }).syncUpgrades();
    (g as unknown as { random: () => number }).random = seeded(seed * 4099 + 7);
    const seen = new WeakSet<Bullet>();
    const input = seeded(seed * 11 + 3); let dir = 0, fire = false;
    for (let i = 0; i < 120 * seconds; i++) {
      if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
      // Chase the nearest live enemy most of the time, so the drone's rounds actually meet targets.
      if (i % 12 === 0) {
        const p = g.player, target = g.enemies.filter(e => e.alive).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        const r = input();
        dir = target && r < 0.75 ? Math.sign(target.x - p.x) : r < 0.85 ? -1 : r < 0.95 ? 1 : 0;
        fire = input() < 0.7;
      }
      if (invincible) g.player.invincible = 99;
      g.step(1 / 120, dir, fire);
      for (const b of g.bullets) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (b.source === 'drone') droneRounds++; else if (b.source === 'player') playerRounds++;
        hash.update(`${i}|+${b.source}@${r3(b.x)},${r3(b.y)}v${r3(b.vx)},${r3(b.vy)}c${r3(b.carried ?? 0)}d${b.damage}s${b.size}r${b.range}p${b.pierce};`);
      }
      for (const ev of g.events) {
        if (!EVENTS.has(ev.type)) continue;
        if (ev.type === 'kill') kills++;
        if (ev.type === 'hurt' || ev.type === 'bossHit') hits++;
        hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
      }
      g.events.length = 0;
      if (i % 12 === 0) {
        const p = g.player;
        hash.update(`${i}|${g.kills}|${g.hp}|${g.score}|${g.combo}|${g.ammo}|${r3(p.x)},${r3(p.y)},${r3(p.vy)},${p.grounded}|${g.state}|${g.cameraY}|`);
        for (const b of g.bullets) hash.update(`${b.source}:${r3(b.x)}:${r3(b.y)}:${r3(b.travelled)}:${b.alive};`);
      }
    }
  }
  return { digest: hash.digest(), droneRounds, playerRounds, kills, hits };
}

const stage = (area: AreaId, section: SectionId) => (seed: number) => { const g = new GameModel(false, seeded(seed * 389)); g.jumpToStage(area, section); return g; };
/** The ATTACHMENT upgrades the audit names (drone, heartBalloon, laserSight, safetyJetpack, timeout) plus the fire-event companion hotCasing. */
const ATTACHMENTS: UpgradeId[] = ['drone', 'heartBalloon', 'laserSight', 'safetyJetpack', 'timeout', 'hotCasing'];

/** The runs the golden values cover: DRONE in every AREA and the fight, alone and stacked; the other attachments without it. */
export const DRONE_TRACE_SCENARIOS: Record<string, { start: (seed: number) => GameModel; held: UpgradeId[]; seconds?: number; invincible?: boolean }> = {
  'area1 drone': { start: stage(1, 1), held: ['drone'] },
  'area1 drone mortal': { start: stage(1, 2), held: ['drone'], invincible: false },
  'area1 plain': { start: stage(1, 1), held: [] },
  'area2 drone': { start: stage(2, 1), held: ['drone'] },
  'area2 stacked': { start: stage(2, 2), held: ATTACHMENTS },
  'area3 drone': { start: stage(3, 1), held: ['drone'] },
  'area3 stacked hurt': { start: stage(3, 2), held: ATTACHMENTS, invincible: false },
  'area4 drone': { start: stage(4, 1), held: ['drone'] },
  'area4 stacked': { start: stage(4, 3), held: ATTACHMENTS },
  'area2 others': { start: stage(2, 2), held: ATTACHMENTS.filter(id => id !== 'drone') },
  'boss drone': { start: seed => fighting(seed + 4), held: ['drone'], seconds: 30 },
  'boss stacked': { start: seed => fighting(seed + 4), held: ATTACHMENTS, seconds: 30, invincible: false },
};
