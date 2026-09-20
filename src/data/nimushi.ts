import type { AbyssAttackId } from './abyss';

/**
 * NIMUSHI -- タピオカの深淵に堕ちし者.
 *
 * The FINAL BOSS hangs above the player in an inverted world: gravity pulls up, the gunboots fire
 * up, and NIMUSHI looks down into the shaft with one eye. The body is armour. The eye is the fight.
 *
 * Everything below is data because none of it is measured. The original's own boss is not the
 * reference for the attacks -- these are NIMUSHI's -- but the SKELETON is: a window where the weak
 * point is open, a window where it is shut and something is coming, and a beat of recovery in
 * between. Every number here is PROVISIONAL / MEASUREMENT REQUIRED unless it says otherwise.
 */

/**
 * Every state the fight can be in. A real machine rather than a pile of timers: exactly one of
 * these is true at a time, each names its own exit, and an attack can never start while another
 * is running because starting one IS the transition into its state.
 */
export type NimushiState =
  | 'dormant'
  | 'eyeOpen'
  | 'eyeClosing'
  | 'attackPrep'
  | 'tapiocaShower'
  | 'cupSummon'
  | 'strawBeam'
  | 'nimushiClones'
  | 'recovery'
  | 'phaseTransition'
  | 'finalRage'
  | 'dead';

/** The four attack states, so "is an attack running" is a lookup rather than a list of ors. */
export const ATTACK_STATES: Record<AbyssAttackId, NimushiState> = {
  tapiocaShower: 'tapiocaShower',
  cupSummon: 'cupSummon',
  strawBeam: 'strawBeam',
  nimushiClones: 'nimushiClones',
};

/** What the view draws. Derived from the state, so a sprite can never disagree with the machine. */
export type NimushiPose = 'dormant' | 'idle' | 'closed' | 'cast' | 'attack' | 'damage' | 'rage' | 'dead';

export const NIMUSHI = {
  name: 'NIMUSHI',
  title: 'タピオカの深淵に堕ちし者',
  /**
   * HP, in the same damage units a round deals.
   *
   * This is NOT the old DEMON KING's 450. That number was whole-body HP on a boss any round could
   * chip from any angle; this one is only ever spent through an eye that is open for part of the
   * time, and a single OPEN window is capped at `eyeWindow.damage` however strong the weapon is.
   * The cap is what makes the figure hold across all seven modules: a LASER fills a window faster
   * than a MACHINE GUN and therefore gets more windows per minute, but it cannot delete a phase.
   * MEASUREMENT REQUIRED -- the original's units do not convert to DEEP DROP's.
   */
  maxHp: 120,
  /**
   * The damage window. It shuts on whichever comes first: enough damage, or long enough. The
   * timeout exists so a run that cannot reach the eye still sees the fight move, and the cap so a
   * run that can reach it easily does not skip it. Deliberately its own pair of numbers, entirely
   * separate from the phase thresholds. MEASUREMENT REQUIRED.
   */
  eyeWindow: { damage: 8, timeout: 6 },
  /** Seconds the eye takes to shut once the window is spent -- still invulnerable throughout. */
  closing: 0.45,
  /** Seconds after an attack before the eye reopens. */
  recovery: 1.1,
  /** The transition between stretches: eye shut, invulnerable, the whole arena hauled upward. */
  transition: 1.6,
  /** The rage cut-in: eye shut, a line of dialogue, then straight back to an open eye. */
  rageIntro: 1.8,
  /** Seconds of collapse before GAME CLEAR. */
  defeatDelay: 1.1,

  /** The body. Armour: bullet-immune from every source, and never stompable. */
  bodyWidth: 168,
  bodyHeight: 112,
  /** Hearts a body contact costs, through the ordinary HealthSystem path. */
  contactDamage: 1,
  /**
   * The eye, on the face that looks at the player -- the underside of the body in screen terms,
   * because NIMUSHI is above and the player below. Small on purpose: it has to be aimed at.
   */
  eyeWidth: 60,
  eyeHeight: 36,

  /**
   * How it holds station. It hangs `restGap` ahead of the player along the pull and will neither
   * close inside `minGap` nor let the player fall more than `maxGap` behind, so the eye is always
   * a shot away and the body is never unavoidable. MEASUREMENT REQUIRED.
   */
  restGap: 430,
  minGap: 220,
  maxGap: 610,
  /**
   * The pace NIMUSHI keeps when the player is not moving along the pull at all.
   *
   * It is NO LONGER the whole story of how NIMUSHI moves -- see `gapGain` below. It used to be, and
   * that was the bug: a flat 150px/s against a player being pulled in at 520 closed the gap at
   * 370px/s, so an untouched controller put the player inside the body in 2.28 seconds. NIMUSHI now
   * MATCHES the player and corrects for distance; this is only the floor under that.
   */
  ascentSpeed: 150,
  /**
   * How fast it backs away when the player closes inside `minGap`.
   *
   * Deliberately SLOWER than a fall. NIMUSHI never charges the player -- but the player may dive at
   * it, all the way into the body, and pay a heart for doing so. Snapping to `minGap` instead would
   * make body contact unreachable, which is the same dead branch the old king had.
   */
  retreatSpeed: 240,
  /** How fast it slides across the shaft to follow the player, between attacks only. */
  drift: 88,
  /**
   * Pixels one point of weak-point damage shoves NIMUSHI along the pull. Per damage rather than
   * per hit, for the same reason the boundary's relief is. The ordinary gap clamp still applies,
   * so the shove can never throw it out of reach. MEASUREMENT REQUIRED.
   */
  pushPerHit: 24,

  /**
   * THE GAP CONTROLLER.
   *
   * NIMUSHI holds a distance rather than running away at a fixed speed. Its pace along the pull is
   * the PLAYER's pace plus a correction proportional to how far the gap is from where it should be:
   *
   *   speed = playerSpeedAlongThePull + correction(gap)
   *
   * Matching the player is what makes the fight possible at all. A fixed speed cannot: whatever it
   * is set to, a player falling faster closes on it every second until they are inside the body, and
   * a player falling slower is left behind. Matching means ordinary movement holds the distance, and
   * the correction is only there to recover from a gap that has already gone wrong.
   *
   * The correction is a DEADBAND between `minGap` and `maxGap`, not a pull toward one ideal
   * distance: inside the band NIMUSHI leaves the gap where the player put it, so closing in to use
   * SHOTGUN's 260px reach is a decision the fight respects rather than one it undoes. `gapGain` is
   * per second, so being 100px inside the band's edge asks for 220px/s back. `maxCorrection` keeps
   * a recovery firm rather than a teleport and `maxTrackSpeed` caps the total. All MEASUREMENT
   * REQUIRED -- these are the first values that make the geometry work, not tuned ones.
   */
  gapGain: 2.2,
  maxCorrection: 260,
  /**
   * How much of the player's pace NIMUSHI matches in the ordinary case.
   *
   * A FULL match, and it has to be. The player's speed toward NIMUSHI is capped at the arena's
   * terminal speed whether they are charging or doing nothing, so anything under 1 makes the gap
   * close on a player who is not even playing -- which is the bug this controller exists to fix.
   * Matching exactly means ordinary movement changes nothing about the distance, and the ways the
   * distance DOES change are the interesting ones: NIMUSHI's attacks, and the player's own brake.
   *
   * It is a named constant rather than an implicit 1 so that the choice is visible, and so that a
   * future boss balance pass can see what it would be trading away by lowering it.
   */
  matchRatio: 1,
  maxTrackSpeed: 780,
  /**
   * How much of the player's pace NIMUSHI matches WHILE AN ATTACK IS RUNNING.
   *
   * Below 1 on purpose. Station-keeping that never lapses would put the body permanently out of
   * reach, and body contact is supposed to be something a player can choose -- so the one window
   * where NIMUSHI is busy is the window where a player who wants to close can. Charging it during
   * an attack is exactly when being near it should be dangerous.
   */
  attackFollow: 0.45,
  /**
   * Seconds the extra room from a weak-point hit lasts before the gap settles back to `restGap`.
   *
   * Without this the controller would erase its own pushback: the shove opens the gap, the gap is
   * then "too big", and the correction closes it again within a frame or two. The hit therefore
   * raises the TARGET for a moment as well as moving the body.
   */
  pushbackDecay: 1.8,
  /** Extra ascent while a stretch gives way to the next, which is what hauls the arena up. */
  transitionSpeed: 260,
} as const;

export interface NimushiAttackDef {
  id: AbyssAttackId;
  name: string;
  /** Seconds of visible wind-up. NOTHING may hurt during this; the beam's line is drawn here. */
  prep: number;
  /** Seconds the attack itself runs. */
  active: number;
}

/**
 * The five attacks. Four are in the rotation; FULL SCREEN TAPIOCA is not -- it belongs to FINAL
 * RAGE, runs underneath whatever else is happening, and is described separately below.
 */
export const NIMUSHI_ATTACKS: Record<AbyssAttackId, NimushiAttackDef> = {
  tapiocaShower: { id: 'tapiocaShower', name: 'タピオカシャワー', prep: 0.7, active: 2.4 },
  cupSummon: { id: 'cupSummon', name: 'タピオカカップ', prep: 0.8, active: 1.6 },
  strawBeam: { id: 'strawBeam', name: 'ストロービーム', prep: 0.35, active: 2.4 },
  nimushiClones: { id: 'nimushiClones', name: 'にむし分身', prep: 0.6, active: 0.4 },
};

/**
 * TAPIOCA SHOWER. Columns of pearls poured down the shaft at the player.
 *
 * The shaft is cut into `lanes` columns and `safeLanes` ADJACENT ones are left empty in every wave,
 * so there is always somewhere to be. That is a hard guarantee rather than a tuning: a wave with no
 * gap is not a harder wave, it is a wave that cannot be answered.
 *
 * The gap WALKS rather than jumping: it moves at most one lane per wave, turning at the walls. A
 * gap that teleported across the shaft every 0.4s would be a gap nobody can reach at walking speed,
 * which is the same thing as no gap at all -- the player has to be able to follow it.
 */
export const TAPIOCA_SHOWER = {
  lanes: 7,
  safeLanes: 2,
  /** Seconds between waves. MEASUREMENT REQUIRED. */
  waveInterval: 0.4,
  speed: 265,
  size: 9,
  damage: 1,
  /** Seconds a loose pearl lasts if it hits nothing, so a long fight cannot fill the list. */
  life: 6,
} as const;

/**
 * TAPIOCA CUP. Two or three cups dropped past the player, which then turn and fire back up the
 * shaft -- so the player is caught between NIMUSHI's shower from above and the straws below.
 *
 * A cup can be shot down. That is the answer to the pincer, and it is why the cup has HP at all.
 */
export const TAPIOCA_CUP = {
  minCount: 2,
  maxCount: 3,
  width: 46,
  height: 64,
  fallSpeed: 210,
/**
   * How far PAST the player a cup travels before it plants itself and turns around. Measured from
   * the player rather than from the boundary: what the attack is for is catching them between
   * NIMUSHI above and a straw below, and that only works if the straw ends up within reach.
   */
  standoff: 210,
  /** Seconds of visible warning before the straw fires. Nothing may hurt during it. */
  warning: 0.7,
  /** Rounds it spits back, and how far apart. */
  shots: 4,
  shotInterval: 0.42,
  shotSpeed: 300,
  /** Hits it takes before it is destroyed -- counted in damage, like an enemy. */
  hp: 3,
  /** Seconds a cup lasts once it has finished firing. */
  life: 9,
  damage: 1,
} as const;

/**
 * STRAW BEAM. The attack the inverted world is really for: a column the player has to be out of,
 * answered with LEFT/RIGHT and with the gunboots' own recoil.
 *
 * The warning line is mandatory and is drawn at full length before anything can hurt. It locks
 * onto the player's column at the moment the wind-up starts, so moving always works and the
 * telegraph never lies.
 */
export const STRAW_BEAM = {
  /** Seconds the thin line is shown before the beam lands. MEASUREMENT REQUIRED (0.7-1.0s). */
  warning: 0.85,
  /** Seconds the beam itself is live. */
  live: 1.0,
  width: 56,
  /** Hearts it costs. High, but survivable from full on a first sighting rather than lethal. */
  damage: 2,
} as const;

/** にむし分身: how many split off, by stretch. */
export const NIMUSHI_CLONES = { minCount: 2, maxCount: 4, spread: 150 } as const;

/**
 * FULL SCREEN TAPIOCA -- FINAL RAGE only, below 25% HP, once per fight.
 *
 * It runs UNDERNEATH the ordinary cycle rather than replacing it, so the eye still opens and the
 * fight can still be won: a long invulnerable bullet-hell is not a boss, it is a wait. The
 * corridor is two adjacent lanes wide and walks one lane per wave, turning at the walls -- so the
 * screen is never sealed, and the gap is somewhere the player has to travel to rather than stand in.
 */
export const FULL_SCREEN_TAPIOCA = {
  lanes: 9,
  /** Adjacent lanes left open in every wave. Never zero, by construction. */
  corridor: 2,
  waveInterval: 0.62,
  speed: 235,
  size: 9,
  damage: 1,
  life: 6,
} as const;

/** Below this share of HP, FINAL RAGE triggers -- once, and never again. */
export const FINAL_RAGE_RATIO = 0.25;

/**
 * What it says. Short, skippable, and never long enough to take the controls away: a line is shown
 * over live play except for the rage cut-in, which is the one beat the fight is allowed to hold.
 */
export const NIMUSHI_LINES = {
  wake: 'もっと……\nもっとタピオカを……',
  rage: 'みんなタピオカになればいいのに……',
  dying: '逃げてもムダだよ……\nぜーんぶ、タピオカにしてあげる……♡',
  /** Seconds a line stays up on its own. Any input dismisses it sooner. */
  hold: 3.2,
} as const;

/** Below this share of HP it starts taunting. */
export const NIMUSHI_DYING_RATIO = 0.12;
