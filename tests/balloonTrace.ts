import { GameModel } from '../src/systems/GameModel';
import type { UpgradeId } from '../src/data/upgrades';
import type { AreaId, SectionId } from '../src/data/areas';

/**
 * A fingerprint of everything HEART BALLOON touches in play: scripted runs through the real GameModel, with
 * the balloon (position, alive), the player's fall (position, velocity, grounded) and the tether's two model
 * ends hashed EVERY step, and the run's kills, HP, score, chain, CHARGE, camera, gravity and state, every
 * pop / explosion / kill / hit / section event as it happens. Runs can roll through SECTION CLEAR -> REST ->
 * NEXT, so the balloon's return at the next opening is in it. Model-only -- nothing from the scene -- so the
 * value computed at the baseline and at the candidate can be compared directly. The golden values in
 * tests/balloonArt.test.ts were produced by this same file on a git archive of 6d83590.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** FNV-1a over two lanes, as in tests/droneTrace.ts. */
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

export interface BalloonTrace { digest: string; pops: number; revivals: number; explosions: number; kills: number; hits: number; sections: number; aliveSteps: number }

const EVENTS = new Set<string>(['balloon', 'explosion', 'kill', 'hurt', 'heal', 'land', 'section', 'upgrade', 'shot', 'jetpack', 'coinHigh', 'bossHit', 'bossFire', 'bossPhase', 'gravityFlip', 'exit']);

/** `enter` moves a fresh model (upgrades already granted) to where the run starts: the balloon is made at a SECTION's opening. */
export interface BalloonRun { enter: (g: GameModel) => void; held: UpgradeId[]; seconds?: number; sections?: number; invincible?: boolean; seeds?: number }

export function balloonTrace({ enter, held, seconds = 10, sections = 1, invincible = true, seeds = 3 }: BalloonRun): BalloonTrace {
  const hash = fnv();
  let pops = 0, revivals = 0, explosions = 0, kills = 0, hits = 0, sectionsPlayed = 0, aliveSteps = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const g = new GameModel(false, seeded(seed * 389));
    for (const id of held) g.upgrades.grant(id);
    (g as unknown as { syncUpgrades: () => void }).syncUpgrades();
    enter(g);
    (g as unknown as { random: () => number }).random = seeded(seed * 4099 + 11);
    const input = seeded(seed * 13 + 5); let dir = 0, fire = false, wasAlive = !!g.balloon?.alive;
    for (let section = 0; section < sections; section++) {
      if (section > 0) {
        // SECTION CLEAR -> REST -> NEXT through the model's own path; the balloon comes back at the opening.
        if (!g.completeSection()) break;
        g.selectUpgrade(g.upgrades.choices[0].id); g.confirmUpgrade();
        hash.update(`next|${g.stage.label}|${g.state}|${JSON.stringify(g.balloon)}|`);
      }
      sectionsPlayed++;
      for (let i = 0; i < 120 * seconds; i++) {
        if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
        // Chase the nearest live enemy most of the time, so enemies actually reach the balloon.
        if (i % 12 === 0) {
          const p = g.player, target = g.enemies.filter(e => e.alive).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
          const r = input();
          dir = target && r < 0.75 ? Math.sign(target.x - p.x) : r < 0.85 ? -1 : r < 0.95 ? 1 : 0;
          fire = input() < 0.5;
        }
        if (invincible) g.player.invincible = 99;
        g.step(1 / 120, dir, fire);
        const b = g.balloon, p = g.player;
        if (b?.alive) aliveSteps++;
        if (b?.alive && !wasAlive) revivals++;
        wasAlive = !!b?.alive;
        // The balloon, the fall it softens and the tether's model ends (balloon centre, player), every step.
        hash.update(`${i}|b${b ? `${r3(b.x)},${r3(b.y)},${b.alive ? 1 : 0}` : '-'}|p${r3(p.x)},${r3(p.y)},${r3(p.vy)},${p.grounded}|g${g.gravitySign}|`);
        for (const ev of g.events) {
          if (!EVENTS.has(ev.type)) continue;
          if (ev.type === 'balloon') pops++;
          if (ev.type === 'explosion') explosions++;
          if (ev.type === 'kill') kills++;
          if (ev.type === 'hurt' || ev.type === 'bossHit') hits++;
          hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
        }
        g.events.length = 0;
        if (i % 12 === 0) {
          hash.update(`${i}|${g.kills}|${g.hp}|${g.score}|${g.combo}|${g.ammo}|${g.state}|${g.cameraY}|${g.stage.label}|`);
          for (const e of g.enemies) if (e.alive) hash.update(`${e.kind}:${r3(e.x)}:${r3(e.y)}:${e.hp};`);
        }
      }
    }
  }
  return { digest: hash.digest(), pops, revivals, explosions, kills, hits, sections: sectionsPlayed, aliveSteps };
}

const stage = (area: AreaId, section: SectionId) => (g: GameModel) => { g.jumpToStage(area, section); };
/** Straight into the arena under the reversed pull (GRAVITY_DIRECTION.boss): the balloon now rides below. */
const boss = (g: GameModel) => { g.jumpToNimushi(); };
const ATTACHMENTS: UpgradeId[] = ['drone', 'heartBalloon', 'laserSight', 'safetyJetpack', 'timeout', 'hotCasing'];

/** The runs the golden values cover: HEART BALLOON in every AREA and the fight, alone and stacked, across SECTIONs; without it too. */
export const BALLOON_TRACE_SCENARIOS: Record<string, BalloonRun> = {
  'area1 balloon': { enter: stage(1, 1), held: ['heartBalloon'] },
  'area1 balloon mortal': { enter: stage(1, 2), held: ['heartBalloon'], invincible: false },
  'area1 plain': { enter: stage(1, 1), held: [] },
  'area1 revival x3': { enter: stage(1, 1), held: ['heartBalloon'], seconds: 8, sections: 3 },
  'area2 balloon': { enter: stage(2, 1), held: ['heartBalloon'] },
  'area2 balloon+drone': { enter: stage(2, 2), held: ['heartBalloon', 'drone'] },
  'area3 balloon': { enter: stage(3, 1), held: ['heartBalloon'] },
  'area3 stacked hurt': { enter: stage(3, 2), held: ATTACHMENTS, invincible: false },
  'area4 balloon': { enter: stage(4, 1), held: ['heartBalloon'] },
  'area4 revival x2': { enter: stage(4, 2), held: ['heartBalloon', 'drone'], seconds: 8, sections: 2 },
  'boss reversed balloon': { enter: boss, held: ['heartBalloon'], seconds: 20 },
  'boss reversed stacked': { enter: boss, held: ATTACHMENTS, seconds: 20, invincible: false },
};
