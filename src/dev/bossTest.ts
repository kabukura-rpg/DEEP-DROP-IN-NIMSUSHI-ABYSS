import type { GameModel } from '../systems/GameModel';
import { ABYSS_PHASES, abyssPhase, type AbyssAttackId, type AbyssPhase } from '../data/abyss';
import { GUN_MODULES, GUN_MODULE_IDS, STARTING_GUN_MODULE, type GunModuleId } from '../data/gunModules';
import { NIMUSHI, NIMUSHI_ATTACKS, FINAL_RAGE_RATIO, type NimushiState } from '../data/nimushi';

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

/** What a BOSS TEST can be asked for. The bare string form is the stretch, as it always was. */
export interface BossTestRequest {
  target?: BossTestTarget;
  /** Which module to start the fight holding. Id, name or HUD short, in any case. */
  weapon?: string;
  /** Skip the cycle straight to an attack's wind-up, so it can be watched without waiting. */
  attack?: string;
}

/** The attacks a BOSS TEST will jump to, by the names a person would type. */
const ATTACKS: Record<string, AbyssAttackId> = {
  SHOWER: 'tapiocaShower', TAPIOCASHOWER: 'tapiocaShower',
  BEAM: 'strawBeam', STRAWBEAM: 'strawBeam',
  CUP: 'cupSummon', CUPSUMMON: 'cupSummon',
  CLONES: 'nimushiClones', NIMUSHICLONES: 'nimushiClones',
};

/**
 * Resolve whatever the console was given to a module id: `shotgun`, `SHOTGUN`, `SHOT`, `MACHINE`,
 * `MACHINE GUN` all land on the right weapon.
 *
 * Three spellings rather than one because the three are what is actually on screen -- the id is in
 * the code, the name is in the pickup toast and the short is in the HUD -- and a debug utility
 * nobody can remember the spelling for gets used once.
 */
export function bossTestWeapon(value: string): GunModuleId | null {
  const want = value.trim().toUpperCase();
  return GUN_MODULE_IDS.find(id => {
    const def = GUN_MODULES[id];
    return id.toUpperCase() === want || def.name.toUpperCase() === want || def.short.toUpperCase() === want;
  }) ?? null;
}

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
export function enterBossTest(model: GameModel, request: BossTestTarget | BossTestRequest = 'phase1'): string {
  const { target = 'phase1', weapon, attack } = typeof request === 'string'
    ? { target: request, weapon: undefined, attack: undefined }
    : request;
  if (!(target in TARGETS)) {
    return `unknown target "${target}" -- try ${Object.keys(TARGETS).join(', ')}`;
  }
  /**
   * The weapon is resolved BEFORE anything is entered, so a typo leaves the title screen alone
   * instead of dropping the tester into the arena holding the wrong gun.
   */
  const module = weapon === undefined ? STARTING_GUN_MODULE : bossTestWeapon(weapon);
  if (module === null) {
    return `unknown weapon "${weapon}" -- try ${GUN_MODULE_IDS.join(', ')}`;
  }
  const jumpTo = attack === undefined ? null : ATTACKS[attack.trim().toUpperCase().replace(/[\s_-]/g, '')] ?? null;
  if (attack !== undefined && jumpTo === null) {
    return `unknown attack "${attack}" -- try ${[...new Set(Object.values(ATTACKS))].join(', ')}`;
  }
  if (!model.jumpToNimushi()) return 'could not enter the arena (practice mode?)';
  /**
   * A DEBUG FIXTURE, exactly like the HP one below: the module is swapped through the game's own
   * `equip`, which is the same call a GUN MODULE crate makes. Nothing about the weapon is altered
   * -- rate of fire, recoil, spread, range and damage are whatever `GUN_MODULES` says they are, so
   * what the fight shows is that weapon and not a test build of it.
   *
   * It is a starting loadout and nothing more. A run reaching NIMUSHI by the ordinary route still
   * arrives holding whatever it picked up on the way.
   */
  model.gun.equip(module);
  // CHARGE is filled AFTER the swap, so the fight opens on a full magazine either way.
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
  if (jumpTo !== null) {
    /**
     * Another DEBUG FIXTURE, and the same shape as the HP one: the cycle is set to the wind-up and
     * the boss's OWN machine takes it from there -- `prepare`, `launch`, the active state and the
     * recovery all run exactly as they do when the fight reaches an attack by itself. Nothing here
     * spawns a pearl or shortens a telegraph.
     *
     * Reached by cast rather than by widening the class, so watching an attack early costs the
     * production API nothing. It is the same way this file already reaches `enterAbyssPhase`.
     */
    const machine = model.boss as unknown as { state: NimushiState; timer: number; pendingAttack: AbyssAttackId; started: boolean; waveTimer: number };
    machine.started = true;
    machine.pendingAttack = jumpTo;
    machine.state = 'attackPrep';
    machine.timer = NIMUSHI_ATTACKS[jumpTo].prep;
    machine.waveTimer = 0;
  }
  return [
    `BOSS TEST -> ${target}${weapon === undefined ? '' : ` / ${GUN_MODULES[module].name}`}${jumpTo === null ? '' : ` / ${NIMUSHI_ATTACKS[jumpTo].name}`}`,
    `NIMUSHI ${model.boss.hp}/${NIMUSHI.maxHp} (${Math.round((model.boss.hp / NIMUSHI.maxHp) * 100)}%) · stretch ${model.boss.phaseId} ${model.boss.phase.name}`,
    `HP ${model.hp}/${model.stats.maxHp} · CHARGE ${model.ammo}/${model.stats.maxAmmo} · ${model.gun.module.short}`,
    `physics ${model.physics.gravity}/${model.physics.maxFallSpeed}/${model.physics.moveSpeed}`,
    `gravity ${model.gravitySign < 0 ? 'UP (reversed)' : 'DOWN'} · BOSS TIME ${model.bossTime.toFixed(1)}s`,
  ].join(' | ');
}

/** The names the console hook accepts, for its own error message and for the dev button. */
export const BOSS_TEST_TARGETS = Object.keys(TARGETS) as BossTestTarget[];
/** The weapons the dev selector offers: all seven, in roster order. */
export const BOSS_TEST_WEAPONS = GUN_MODULE_IDS;
