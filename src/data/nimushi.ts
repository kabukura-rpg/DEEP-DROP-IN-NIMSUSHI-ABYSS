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
  /**
   * How far the weak point stands out from the face, toward the player.
   *
   * MEASURED, and it is a RANGE number rather than an art one. A round has to reach the eye's near
   * edge, so the furthest a weapon can fire from is `21 + eyeHeight + range * (1 - ascent/speed)`:
   * the muzzle offset, this, and whatever the round itself can close against a face climbing away
   * at `ascentSpeed`. For the long weapons that last term dominates and this barely registers. For
   * the short ones it is most of what they have.
   *
   * At 36 the two shortest weapons were unusable by hand -- not because they could not land (a bot
   * gets 7.3 and 19.5 hits a fight with them) but because the window was too brief to line up in:
   *
   *   weapon    firing band    window at 240px/s of closing    by hand
   *   MACHINE      645px          2.69s                        comfortable
   *   TRIPLE       501px          2.09s                        comfortable
   *   NOPPY        477px          1.99s                        comfortable
   *   SHOTGUN      209px          0.87s                        unusable
   *   PUNCHER      193px          0.80s                        unusable
   *
   * Crossing a quarter of the shaft takes 0.55s at `BOSS_PHYSICS.moveSpeed`, and the eye is 60px
   * wide, so a window under a second cannot absorb a line-up. Measured after the change, with
   * `contactInset`:
   *
   *   SHOTGUN   0.87s -> 1.15s      PUNCHER   0.80s -> 1.08s      MACHINE   2.69s -> 2.85s
   *
   * About 40% of what MACHINE gets rather than 32%, which keeps SHORT RANGE = HIGH RISK while
   * stopping HIGH RISK from meaning UNUSABLE. MACHINE's own reach moves 8px, and the 0.16s it
   * gains is `contactInset`, which every weapon gets.
   */
  eyeHeight: 72,
  /**
   * How far the box that COSTS A HEART is set inside the drawn silhouette, on the side the player
   * arrives from. The other three sides are the sprite exactly.
   *
   * Only that side, because only that side was measured. The fight is a vertical approach and it is
   * the vertical margin that was short; NIMUSHI's left and right have never been reported as a
   * problem, so they are left alone rather than changed on a guess.
   *
   * What it takes off the box is hood, ears and hair -- decoration that reads as NIMUSHI and not as
   * NIMUSHI's body. It is 30 of `bodyHeight` 112, so a player can be a little way into the fringe
   * and not yet into the thing wearing it. Rounds still stop on the drawn silhouette: the forgiving
   * half of "visual is not collision" is the half that protects the player.
   */
  contactInset: 30,

  /**
   * How it holds station. It hangs `restGap` ahead of the player along the pull and will neither
   * close inside `minGap` nor let the player fall more than `maxGap` behind, so the eye is always
   * a shot away and the body is never unavoidable. MEASUREMENT REQUIRED.
   */
  restGap: 430,
  minGap: 220,
  maxGap: 610,
  /**
   * The pace NIMUSHI climbs away at. The one number the whole fight balances on.
   *
   * MEASURED, over 12 seeds x 60s per candidate. Nothing corrects the distance any more, so this
   * is the entire other half of it: the player is pulled in at up to `BOSS_PHYSICS.maxFallSpeed`
   * and buys the ground back with stomps, bounces and the gunboots brake. Whether GOOD PLAY is
   * distance-neutral is decided here and nowhere else.
   *
   *   ascent   gap drift   30s held (12 seeds)   NIMUSHI off the top   gap band
   *   150      -46.1px/s   0/12                   0.0%                 -56..415
   *   190      -15.0       2/12                   1.0%                 -44..498
   *   210      -13.2       0/12                   2.3%                 -56..553
   *   250       -2.1       0/12                  14.5%                 -39..747
   *   270       +2.3       8/12                  24.4%                  17..837
   *   280       -0.9      12/12                   7.5%                 160..557
   *   290       +8.3      12/12                  64.4%                 260..942
   *
   * 280 is the only value that holds under BOTH braking styles the bot plays -- at 260 and 270 the
   * run lives or dies on which one the player happens to use (10/12 vs 0/12, 8/12 vs 1/12). It is
   * also the narrowest gap band, which is what "the distance oscillates rather than drifts" means
   * in numbers: the gap reverses direction 1.7 times a second and never trends.
   *
   * It is not arbitrary. The player's own mechanics cap their sustainable speed along the pull at
   * 218-282px/s: between two stomps they must cover one `rowGap`, and the gunboots brake only
   * slows a 520px/s fall to a measured 447px/s mean, for the 1.18s a magazine lasts -- the
   * `recovery` floor in `fireVolley` deliberately weakens held-down fire. 280 is that ceiling.
   */
  ascentSpeed: 280,
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
   * THE BOSS BANDS -- two of them, because the fight has two halves.
   *
   * NIMUSHI holds a fraction of the VIEWPORT rather than a distance from the player: the camera
   * already follows the player and the player cannot climb above their own camera anchor, so this
   * puts a floor under the separation by construction instead of by correction.
   *
   * One fixed band could not serve both halves. Close enough for SHOTGUN's 260px reach is close
   * enough that a tapioca pattern arrives before it can be read; far enough to read the pattern is
   * far enough that the shortest modules cannot touch the eye. So the boss moves:
   *
   *   ATTACK   far, while winding up and attacking -- the pattern is the thing to look at
   *   DAMAGE   near, through recovery and the open eye -- the weak point is the thing to shoot
   *
   * FAR to dodge, CLOSE to counterattack. Derived from the player's own camera anchor (63% of the
   * viewport) and the roster's shortest reach, not picked:
   *
   *   reach = anchor - band*height - bodyHeight/2, and a round leaves the muzzle 21px nearer again.
   *   attack 0.12 -> 352px, and the whole body sits at 40px from the top of the screen.
   *   damage 0.28 -> 224px, 203px from the muzzle, which leaves SHOTGUN 57px of margin.
   */
  attackBand: 0.12,
  damageBand: 0.28,
  /**
   * How fast NIMUSHI converges on its band, in px/s.
   *
   * Comfortably above the arena's terminal speed so the band is held rather than chased -- the
   * camera can move at the player's full pace and the boss still sits where it belongs.
   */
  bandSpeed: 1100,
  /**
   * How much of the player's pace NIMUSHI matches WHILE AN ATTACK IS RUNNING.
   *
   * Kept from the previous design and now only a small drift: during an attack NIMUSHI stops
   * correcting toward its band, so a pattern can pull it a little out of frame and settle back
   * afterwards. It is what stops the band looking painted on.
   */
  attackFollow: 0.45,
  /**
   * Seconds the extra room from a weak-point hit lasts before the band settles back.
   *
   * A hit still shoves NIMUSHI up and off its band for a moment, which is the visible reward for
   * finding the eye; `bandSpeed` then walks it home.
   */
  pushbackDecay: 1.8,
  /**
   * Extra ascent while a stretch gives way to the next, which is what hauls the arena up.
   *
   * GAMEPLAY DISABLED -- see TRANSITION_HAUL. Kept because the number is still the right one for
   * the mechanic it belongs to; what changed is that the mechanic is no longer wanted.
   */
  transitionSpeed: 260,
} as const;

/**
 * The burst of extra ascent NIMUSHI used to take on while a stretch gave way to the next.
 *
 * GAMEPLAY DISABLED. The definition, the state and the `phaseTransition` beat are all intact; what
 * is switched off is the speed bonus.
 *
 * Two reasons, and the first is arithmetic. `ascentSpeed` is now 280, so the bonus would put
 * NIMUSHI at 540px/s against a player whose terminal in the arena is 520 -- for 1.6 seconds the
 * boss would be literally uncatchable, whatever the player did. The second is that the fight no
 * longer has anything for it to do: there is no rising boundary to haul the player clear of, so a
 * stretch change hauling the arena upward is a rule left over from a design that is gone.
 */
export const TRANSITION_HAUL = { enabled: false } as const;

/**
 * What a weak-point hit does to NIMUSHI in SPACE, as opposed to what it does to its HP.
 *
 * The fight is NORMAL GAMEPLAY WITH GRAVITY REVERSED, and in that fight the distance between the
 * player and the boss is the player's to manage -- with stomps and bounces, the same two verbs
 * AREA 1-4 spends twelve SECTIONs teaching. `pushback` was the last thing left that managed it FOR
 * them, from the other end: every point of damage threw NIMUSHI `pushPerHit` pixels along the pull
 * and topped up a decaying shove on top of that, so a good damage window bought hundreds of pixels
 * of separation outright.
 *
 * Measured, that was also why the boss kept leaving the frame. It is switched off here, and what
 * replaces it is a HIT REACTION: a short recoil that moves the body and the eye TOGETHER, so the
 * silhouette jolts, the collision jolts with it, and nothing about the fight's geometry changes.
 *
 * `pushback` is the one switch, and `NIMUSHI.pushPerHit`, `maxGap` and `pushbackDecay` are all
 * still there: turn it back on and the old mechanic works exactly as it did.
 */
export const HIT_REACTION = {
  pushback: false,
  /**
   * How far the recoil throws NIMUSHI along the pull, in pixels.
   *
   * Small ON PURPOSE. It is about a tenth of `bodyHeight`, which is enough to see as a jolt on a
   * 168x112 silhouette and far too little to change where anything is. It moves the real body, not
   * a drawing of it, so the eye, the hitbox and the sprite can never disagree.
   */
  recoil: 12,
  /** Seconds for the recoil to settle back. Short enough to read as an impact, not a shove. */
  settle: 0.14,
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
  /**
   * `active` is the FLOOR under the sequence, not its length. Each column lives
   * `STRAW_BEAM.warning + live` = 1.85s and the first is already 0.35s old when the state starts,
   * so 3 x 1.85 - 0.35 = 5.2 is what the three of them need. The state then waits for the last one
   * to finish burning before it hands over, because raising each column the frame after the last
   * one cleared drifts the real sequence a few frames past any number written here.
   */
  strawBeam: { id: 'strawBeam', name: 'ストロービーム', prep: 0.35, active: 5.2 },
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
  /**
   * How many ADJACENT lanes are left open. Three of seven, so the corridor is 169px of a 394px
   * shaft -- wide enough to see from across the arena and to stand in without pixel-perfect placing.
   *
   * It was two. With the gap also moving every 0.4s, answering a shower meant walking continuously
   * and correctly from the first wave, with no margin for reading it at all. A human playtest called
   * the attack unavoidable, and it very nearly was: not because any single wave was unfair, but
   * because the pattern never gave a moment to look at it.
   */
  safeLanes: 3,
  /**
   * Seconds between waves.
   *
   * This is the READING time, not just a rate. The corridor moves at most one lane per wave and a
   * lane is 56px, which the player crosses in about 0.31s at the arena's move speed -- so an
   * interval of 0.75s leaves well over twice the time needed to follow it, rather than exactly
   * enough. At the attack's 2.4s that is three or four waves: a pattern to read, not a barrage to
   * survive. MEASUREMENT REQUIRED, like everything else here.
   */
  waveInterval: 0.75,
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
  /**
   * How wide the column is. The one number that decides how much the attack ASKS for.
   *
   * The beam is aimed at the player's own column at the wind-up, so what it costs them is half this
   * plus their own half-width, walked at `BOSS_PHYSICS.moveSpeed`. 56 made that 37px and 0.21s
   * against 0.85s of warning -- four times more time than the move needs, which a human playtest
   * called easy to the point of not registering.
   *
   *   width   escape needed   time to do it   vs the warning   share of the shaft
   *   56px         37px           0.206s          4.1x               14%
   *   80px         49px           0.272s          3.1x               20%
   *
   * 80 keeps the attack what it is for -- read it, commit, get out -- while making the commitment
   * cost something. Measured over eight two-minute fights at both widths, nothing structural moved:
   * every stomp route was closed at once for a single 0.08s frame-batch at BOTH widths, the next
   * thing to stand on was inside the column 33% -> 39% of live frames with a clear one 50px away,
   * and a beam and a pearl were in the air together for 0.00s.
   *
   * Nothing else about the beam changed with it: warning, damage, live, prep, active and cadence
   * are all as they were.
   */
  width: 80,
  /** Hearts it costs. High, but survivable from full on a first sighting rather than lethal. */
  damage: 2,
  /**
   * How many columns one attack fires, ONE AT A TIME.
   *
   * A single beam is answered by stepping aside once, and a human playtest found that too little to
   * think about: read it, move, done, and the rest of the attack is free. Three of them, each aimed
   * at wherever the player is when ITS OWN warning starts, asks the question again twice -- so the
   * answer is a sequence of decisions rather than one, and it has to be made while still watching
   * for the next thing to stand on.
   *
   * They never overlap. The next warning begins only once the previous column has finished burning,
   * so there is never more than one to be out of and the attack cannot pincer anybody. Widening the
   * beam or shortening its warning would have made it harder to READ; this makes it longer to
   * ANSWER, which is the part that was too easy.
   */
  count: 3,
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
/**
 * GAMEPLAY DISABLED. The definition, the state, the signals and the hooks are all intact.
 *
 * The prototype is answering one question -- is reversed gravity plus the run's own stomp, bounce,
 * reload and gunboots a fight? -- and a curtain of pearls below 25% HP puts a bullet-hell mechanic
 * back into the answer. NIMUSHI is played on the shaft's rules from full HP to zero.
 *
 * `enabled` is the one switch. Turn it back on once the core loop has been judged, and everything
 * below works exactly as it did.
 */
export const FULL_SCREEN_TAPIOCA = {
  /** Whether the curtain pours at all. See the note above. */
  enabled: false,
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

/**
 * BOUNCE TAPIOCA placement.
 *
 * One per attack, laid INSIDE the shower's own safe corridor. That position is the whole point: a
 * reload the player has to leave the safe route to reach is not a rescue, it is a second hazard
 * charging for the first one. The corridor and the bounce target are one attack route.
 */
export const BOUNCE_TAPIOCA = {
  /**
   * How far ahead along the pull it sits, in px.
   *
   * Far enough that the player has to travel to it deliberately, near enough that it arrives inside
   * the attack it belongs to. MEASUREMENT REQUIRED, like everything else in this fight.
   */
  lead: 240,
} as const;
