import type { GameModel } from '../systems/GameModel';
import { ABYSS_PHASES, abyssPhase, type AbyssPhase } from '../data/abyss';
import { NIMUSHI, FINAL_RAGE_RATIO } from '../data/nimushi';

/**
 * BOSS TEST — a development-only way into the NIMUSHI fight, for human playtesting.
 *
 * Playing AREA 1 through 4-3 before every attempt makes tuning the fight impractical, so this drops
 * straight into the arena. It is a DEBUG UTILITY and nothing else:
 *
 *   - it is not an acceptance test, and it does not stand in for one. The ordinary route --
 *     4-3 -> FINAL REST -> NEXT -> THE ABYSS -> seal -> GRAVITY REVERSED -> NIMUSHI -- keeps its own
 *     browser check, which still runs the whole hand-off end to end;
 *   - it changes no production logic. Everything below either calls a method the game already has,
 *     or writes a debug fixture value into the boss's own public state and lets the real systems
 *     react to it on the next step;
 *   - it is dropped from a production build. Every call site is behind `import.meta.env.DEV`.
 */
export type BossTestTarget = 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'rage';

/**
 * Where each shortcut starts: the HP ratio, and the stretch that ratio belongs to.
 *
 * Ratios are read from the phase table rather than restated, so moving a threshold moves the
 * shortcuts with it. RAGE sits just INSIDE its trigger rather than on it, so FINAL RAGE actually
 * fires instead of waiting one point of damage away from it.
 */
const TARGETS: Record<BossTestTarget, { ratio: number; phase: 1 | 2 | 3 | 4 }> = {
  phase1: { ratio: ABYSS_PHASES[0].from, phase: 1 },
  phase2: { ratio: ABYSS_PHASES[1].from, phase: 2 },
  phase3: { ratio: ABYSS_PHASES[2].from, phase: 3 },
  phase4: { ratio: ABYSS_PHASES[3].from, phase: 4 },
  rage: { ratio: FINAL_RAGE_RATIO - 0.01, phase: 4 },
};

/**
 * Put a freshly started run into the arena.
 *
 * The caller is responsible for having started a run already (main.ts's `start()`), because that is
 * what clears the overlay, unlocks audio and hands the controls over. What this adds is the jump and
 * the fixture.
 *
 * The state the fight begins in is deliberately a REALISTIC one rather than a convenient one: full
 * HP at the ordinary maximum, a full magazine, MACHINE GUN, and no upgrades -- which is simply what
 * a fresh run already carries, so nothing has to be faked. Boss physics, the reversed gravity, the
 * camera and BOSS TIME all come from `jumpToNimushi` and the ordinary boss reset.
 */
export function enterBossTest(model: GameModel, target: BossTestTarget = 'phase1'): string {
  if (!(target in TARGETS)) {
    return `unknown target "${target}" -- try ${Object.keys(TARGETS).join(', ')}`;
  }
  if (!model.jumpToNimushi()) return 'could not enter the arena (practice mode?)';
  model.reloadCharge();

  const { ratio, phase } = TARGETS[target];
  if (ratio < 1) {
    /**
     * A DEBUG FIXTURE: HP and stretch are written directly into the boss's own public state.
     *
     * Setting HP alone is not enough and it is worth saying why. A stretch change is driven by
     * DAMAGE -- `enterPhaseTransition` runs when a weak-point hit lands -- so a boss that starts at
     * 50% HP without ever being hit stays in stretch 1 and plays stretch 1's attacks. That is
     * correct production behaviour and is not touched here; the fixture simply states both facts.
     *
     * The per-stretch setup then goes through the model's OWN `enterAbyssPhase`, the same call the
     * real transition makes, so the stretch's gimmicks (the aquifer's oxygen, and so on) are
     * whatever production says they are rather than a second copy of that logic living in here.
     */
    model.boss.hp = Math.max(1, Math.round(NIMUSHI.maxHp * ratio));
    model.boss.phaseId = phase;
    (model as unknown as { enterAbyssPhase(p: AbyssPhase): void }).enterAbyssPhase(abyssPhase(phase));
  }
  return [
    `BOSS TEST -> ${target}`,
    `NIMUSHI ${model.boss.hp}/${NIMUSHI.maxHp} (${Math.round((model.boss.hp / NIMUSHI.maxHp) * 100)}%) · stretch ${model.boss.phaseId} ${model.boss.phase.name}`,
    `HP ${model.hp}/${model.stats.maxHp} · CHARGE ${model.ammo}/${model.stats.maxAmmo} · ${model.gun.module.short}`,
    `physics ${model.physics.gravity}/${model.physics.maxFallSpeed}/${model.physics.moveSpeed}`,
    `gravity ${model.gravitySign < 0 ? 'UP (reversed)' : 'DOWN'} · BOSS TIME ${model.bossTime.toFixed(1)}s`,
  ].join(' | ');
}

/** The names the console hook accepts, for its own error message and for the dev button. */
export const BOSS_TEST_TARGETS = Object.keys(TARGETS) as BossTestTarget[];
