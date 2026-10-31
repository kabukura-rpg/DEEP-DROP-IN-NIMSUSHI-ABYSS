import { GameModel } from '../src/systems/GameModel';
import type { UpgradeId } from '../src/data/upgrades';
import type { AreaId, SectionId } from '../src/data/areas';

/**
 * A fingerprint of everything SAFETY JETPACK touches in play: scripted runs through the real GameModel with the
 * trigger held in long bursts, so CHARGE runs dry in the air and the jetpack takes over, then lets go, lands,
 * refills. Hashed EVERY step: the player's fall (position, velocity, grounded), gravity, CHARGE, fuel and the
 * active flag the view reads; every jetpack / shot / land / hurt / kill / section event as it happens; and the
 * run's HP, score, combo, bullets, upgrades, state and camera. Runs can roll through SECTION CLEAR -> REST ->
 * NEXT, so the refill at the opening is in it. Model-only -- nothing from the scene -- so the value computed at
 * the baseline and at the candidate can be compared directly. The golden values in tests/jetpackArt.test.ts
 * were produced by this same file on a git archive of dc51d0b.
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

export interface JetpackTrace { digest: string; activeSteps: number; starts: number; stops: number; refills: number; emptyActive: number; groundedActive: number; kills: number; hits: number; sections: number }

const EVENTS = new Set<string>(['jetpack', 'shot', 'empty', 'land', 'kill', 'hurt', 'heal', 'section', 'upgrade', 'balloon', 'explosion', 'coinHigh', 'bossHit', 'bossFire', 'bossPhase', 'gravityFlip', 'exit', 'jump', 'wallJump']);

/** `enter` moves a fresh model (upgrades already granted) to where the run starts. `fuel` overrides the tank after entering (low-fuel runs). */
export interface JetpackRun { enter: (g: GameModel) => void; held: UpgradeId[]; seconds?: number; sections?: number; invincible?: boolean; seeds?: number; fuel?: number }

/**
 * `flag: false` leaves the active flag out of the digest (JETPACK BEHAVIOR FIX V1 changes that flag and nothing else,
 * so the rest is compared against 19adbd4 on its own). `observe` sees the model after every step, with that step's events.
 */
export interface TraceOptions { flag?: boolean; observe?: (g: GameModel, events: readonly { type: string }[]) => void }

export function jetpackTrace({ enter, held, seconds = 10, sections = 1, invincible = true, seeds = 3, fuel }: JetpackRun, { flag = true, observe }: TraceOptions = {}): JetpackTrace {
  const hash = fnv();
  let activeSteps = 0, starts = 0, stops = 0, refills = 0, emptyActive = 0, groundedActive = 0, kills = 0, hits = 0, sectionsPlayed = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const g = new GameModel(false, seeded(seed * 577));
    for (const id of held) g.upgrades.grant(id);
    (g as unknown as { syncUpgrades: () => void }).syncUpgrades();
    enter(g);
    if (fuel !== undefined) g.jetpackFuel = fuel;
    (g as unknown as { random: () => number }).random = seeded(seed * 4099 + 17);
    const input = seeded(seed * 29 + 3); let dir = 0, fire = false, wasActive = g.jetpackActive, lastFuel = g.jetpackFuel, burst = 0;
    for (let section = 0; section < sections; section++) {
      if (section > 0) {
        // SECTION CLEAR -> REST -> NEXT through the model's own path; the tank refills at the opening.
        if (!g.completeSection()) break;
        g.selectUpgrade(g.upgrades.choices[0].id); g.confirmUpgrade();
        hash.update(`next|${g.stage.label}|${g.state}|${g.jetpackFuel}|${flag ? g.jetpackActive : ''}|`);
      }
      sectionsPlayed++;
      for (let i = 0; i < 120 * seconds; i++) {
        if (g.state === 'over' || g.state === 'upgrade' || g.state === 'clear') break;
        // Long trigger bursts (so CHARGE runs dry mid-air and the jetpack takes over), short releases, a drift.
        if (burst <= 0) {
          fire = !fire;
          burst = fire ? 90 + Math.floor(input() * 240) : 20 + Math.floor(input() * 60);
          const r = input();
          dir = r < 0.3 ? -1 : r < 0.6 ? 1 : 0;
        }
        burst--;
        if (invincible) g.player.invincible = 99;
        g.step(1 / 120, dir, fire);
        const p = g.player, active = g.jetpackActive;
        if (active) activeSteps++;
        if (active && !wasActive) starts++;
        if (!active && wasActive) stops++;
        if (g.jetpackFuel > lastFuel) refills++;
        if (active && g.jetpackFuel <= 0) emptyActive++;
        if (active && p.grounded !== -1) groundedActive++;
        wasActive = active; lastFuel = g.jetpackFuel;
        hash.update(`${i}|p${r3(p.x)},${r3(p.y)},${r3(p.vy)},${p.grounded}|g${g.gravitySign}|a${g.ammo}|j${r3(g.jetpackFuel)},${flag ? (active ? 1 : 0) : ''}|`);
        observe?.(g, g.events);
        for (const ev of g.events) {
          if (!EVENTS.has(ev.type)) continue;
          if (ev.type === 'kill') kills++;
          if (ev.type === 'hurt' || ev.type === 'bossHit') hits++;
          hash.update(`${i}|${ev.type}@${r3(ev.x)},${r3(ev.y)}=${ev.value ?? ''};`);
        }
        g.events.length = 0;
        if (i % 12 === 0) {
          hash.update(`${i}|${g.kills}|${g.hp}|${g.score}|${g.combo}|${g.state}|${g.cameraY}|${g.stage.label}|${g.upgrades.acquired.join(',')}|`);
          for (const b of g.bullets) hash.update(`b${r3(b.x)},${r3(b.y)};`);
          for (const e of g.enemies) if (e.alive) hash.update(`${e.kind}:${r3(e.x)}:${r3(e.y)}:${e.hp};`);
        }
      }
    }
  }
  return { digest: hash.digest(), activeSteps, starts, stops, refills, emptyActive, groundedActive, kills, hits, sections: sectionsPlayed };
}

const stage = (area: AreaId, section: SectionId) => (g: GameModel) => { g.jumpToStage(area, section); };
/** Straight into the arena under the reversed pull (GRAVITY_DIRECTION.boss). */
const boss = (g: GameModel) => { g.jumpToNimushi(); };
const ATTACHMENTS: UpgradeId[] = ['drone', 'heartBalloon', 'laserSight', 'safetyJetpack', 'timeout', 'hotCasing'];

/** The runs the golden values cover: the jetpack in every AREA and the fight, alone and stacked, low on fuel, across SECTIONs; without it too. */
export const JETPACK_TRACE_SCENARIOS: Record<string, JetpackRun> = {
  'area1 plain': { enter: stage(1, 1), held: [] },
  'area1 jetpack': { enter: stage(1, 1), held: ['safetyJetpack'] },
  'area1 jetpack mortal': { enter: stage(1, 2), held: ['safetyJetpack'], invincible: false },
  'area1 low fuel': { enter: stage(1, 1), held: ['safetyJetpack'], fuel: 0.25 },
  'area1 no fuel': { enter: stage(1, 1), held: ['safetyJetpack'], fuel: 0 },
  'area1 sections x3': { enter: stage(1, 1), held: ['safetyJetpack'], seconds: 8, sections: 3 },
  'area2 jetpack': { enter: stage(2, 1), held: ['safetyJetpack'] },
  'area2 jetpack+drone': { enter: stage(2, 2), held: ['safetyJetpack', 'drone'] },
  'area3 jetpack': { enter: stage(3, 1), held: ['safetyJetpack'] },
  'area3 jetpack+balloon': { enter: stage(3, 2), held: ['safetyJetpack', 'heartBalloon'] },
  'area4 jetpack': { enter: stage(4, 1), held: ['safetyJetpack'] },
  'area4 stacked hurt': { enter: stage(4, 2), held: ATTACHMENTS, invincible: false },
  'boss reversed jetpack': { enter: boss, held: ['safetyJetpack'], seconds: 20 },
  'boss reversed stacked': { enter: boss, held: ATTACHMENTS, seconds: 20, invincible: false },
};
