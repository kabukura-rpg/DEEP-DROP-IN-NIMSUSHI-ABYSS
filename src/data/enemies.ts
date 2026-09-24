import type { DamageCause } from '../systems/HealthSystem';
import type { PickupKind } from './pickups';
import type { ChaseState } from './chasers';
import { attachDweller } from './dwellers';

export type EnemyKind = 'slime' | 'bat' | 'armoredSlime' | 'tank' | 'fish' | 'bubbleFish' | 'jellyfish' | 'urchin'
  | 'fireLizard' | 'fireBat' | 'magmaSlime' | 'fireArmor' | 'frostBeetle'
  | 'demon' | 'wraith' | 'armorGuard' | 'spikeDemon' | 'ruinBreaker'
  | 'voidWisp' | 'hollowShade'
  | 'nimushiClone' | 'nimushiShade' | 'bounceTapioca'
  | 'ghost' | 'flyingSkull'
  // DOWNWELL NORMAL GAMEPLAY CLONE: the roles the original's roster has and DEEP DROP's did not.
  | 'spore' | 'toad' | 'shellback' | 'creeper' | 'watcher'
  | 'boneHopper' | 'boneThrower' | 'shadeOrb' | 'angryOrb'
  | 'shellSwimmer' | 'biter' | 'caveBat' | 'riserJelly' | 'squid' | 'voidShard';
/** Shape family GameScene draws. Silhouette, never colour alone, tells the player what is stompable. */
export type EnemySilhouette = 'blob' | 'wing' | 'shell' | 'brute' | 'fin' | 'orb' | 'bell' | 'spiked'
  | 'lizard' | 'ember' | 'flame' | 'plated' | 'crystal'
  | 'horned' | 'shade' | 'bulwark' | 'barb' | 'breaker' | 'wisp' | 'hollow' | 'nimushi' | 'nimushiBarbed' | 'bouncePearl'
  | 'ghost' | 'skull'
  | 'spore' | 'toad' | 'turtle' | 'creeper' | 'watcher' | 'bones' | 'boneSkull' | 'orbShade' | 'biter' | 'squid' | 'shard';
/** Spawn weight class. Independent of `stompable`: it only decides how often a row rolls this tier. */
export type EnemyThreat = 'basic' | 'armored' | 'heavy';
/** Where the generator may place it: guarding a ledge, loose in open water/air, or either. */
export type EnemySlot = 'guard' | 'open' | 'any';

export interface EnemyType {
  id: EnemyKind;
  name: string;
  /**
   * The two ways a player can answer an enemy, as two INDEPENDENT attributes. The original's roster
   * uses all three useful combinations:
   *
   *   ordinary   shootable, stompable        -- shoot it or land on it
   *   dangerous  shootable, NOT stompable    -- shoot it; landing on it hurts
   *   turtle     NOT shootable, stompable    -- rounds bounce off; the only answer is to land on it
   *
   * Nothing in DEEP DROP is a turtle yet and this phase deliberately does not make one. What exists
   * now is the attribute: `shootable: false` is honoured by the projectile path, so a later World
   * pass can introduce one as a data row rather than as a new branch.
   */
  shootable: boolean;
  /** The single source of truth for "can I land on this?". No gameplay code branches on the kind. */
  stompable: boolean;
  /** Air enemies patrol above the row instead of standing on the platform. */
  flying: boolean;
  threat: EnemyThreat;
  spawnSlot: EnemySlot;
  /** Relative draw weight inside its threat tier, so a rewarding enemy can stay uncommon. */
  spawnWeight: number;
  hp: number;
  silhouette: EnemySilhouette;
  bodyWidth: number;
  /** Patrol speed multiplier applied to the shared sway motion. */
  swaySpeed: number;
  /** Contact damage cause, so a hit records what actually hurt the player. */
  damageCause: DamageCause;
  /** Short on-hit hint shown next to the enemy. */
  contactHint: string;
  /** Wide bodies need a wide ledge; the generator skips them on narrow platforms. */
  minPlatformWidth?: number;
  /** What the corpse leaves behind. Generic on purpose: later areas drop other pickups the same way. */
  drop?: { pickup: PickupKind; chance?: number };
  /** A world effect the death triggers. Kept as data so GameModel routes on it, not on the kind. */
  onDefeat?: 'shatterNearby';
  /**
   * Leaves a body when it dies, for KNIFE AND FORK to eat and REST IN PIECES to blow up.
   *
   * Deliberately NOT every enemy. The original's roster is not reproduced here, so the rule used is
   * the one that reads on screen: a creature of flesh leaves a corpse, and something armoured,
   * elemental or barely there does not. Set per kind rather than inferred, so it stays a decision.
   */
  leavesCorpse?: boolean;
  /**
   * How the body moves, when it is not the shared sideways sway. Absent means exactly that sway --
   * `originX + sin(t * swaySpeed + phase) * range`, with y never touched -- so every AREA whose
   * roster sets none of these moves bit for bit as it always has. Only SUNKEN RUINS sets it.
   */
  motion?: EnemyMotion;
  /**
   * DOWNWELL NORMAL GAMEPLAY CLONE: the behaviour this body runs (dwellers.ts). Absent means it moves
   * by `motion` / the shared sway exactly as before.
   */
  behaviour?: DwellerRole;
  /**
   * Gems the original's counterpart drops (Downwell Wikia), paid as LARGE (10) and SMALL (2) coins.
   * Absent means the old per-threat drop in coins.ts.
   */
  gems?: number;
}

/** Which dweller behaviour an enemy kind runs, including the variants that share one state machine. */
export type DwellerRole = 'bat' | 'drift' | 'eye' | 'piranha' | 'phantomChase' | 'frog' | 'groundSkull' | 'wander' | 'throw' | 'phantom' | 'rise' | 'squid' | 'column' | 'orbit' | 'bounce' | 'swim' | 'crawl';

/**
 * A water enemy's movement, as a pure function of world time.
 *
 * SUNKEN RUINS had four enemies and one motion. Every one slid sideways on the same sine and none
 * moved vertically at all -- in the AREA whose premise is that everything is suspended in water --
 * so they were told apart by colour and outline alone. Measured, the enemy the player is meant to
 * chase was the FASTEST of the four at the median (bubble fish 33.6px/s against fish 27.5), because
 * open-water slots get the widest patrol and it only ever spawns in open water.
 *
 * Each now moves the way it is:
 *
 *   FISH         the ordinary swimmer. Sideways, with a rise and fall woven through each sweep.
 *   BUBBLE FISH  the one worth chasing. Slow, short and floaty, so it can be lined up and shot.
 *   JELLYFISH    hardly drifts. It pulses up and down and lingers at each end.
 *   URCHIN       does not swim. It is a spine stuck to a shelf.
 *
 * Nothing here decides anything. There is no tracking, no fleeing, no reaction to the player:
 * every position is `origin + f(worldElapsed)`, which makes it deterministic, independent of the
 * frame rate, and means its whole reach -- `motionEnvelope` -- is known the moment it is placed.
 */
export interface EnemyMotion {
  /** Share of the generator's `range` the body actually swims. 0 anchors it where it was placed. */
  swim: number;
  /** Horizontal angular speed, radians per second of world time. */
  swimSpeed: number;
  /** Vertical travel from the origin, in pixels. 0 keeps it on its line. */
  bob: number;
  /** Vertical angular speed, radians per second of world time. */
  bobSpeed: number;
  /**
   * The vertical curve for an enemy loose in open water:
   *   wave   a plain sine about the origin
   *   pulse  about the origin too, but it lingers at the top and bottom and moves through the middle
   * An enemy GUARDING a ledge ignores this and only ever rises from its origin. Its origin is the
   * ledge, and a bob that went below it would put the body inside the slab.
   */
  bobShape: 'wave' | 'pulse';
}

/**
 * AREA 1 uses slime / bat / armoredSlime. `tank` stays available for the later areas that still run
 * on the shared difficulty curve. New areas add entries here and list them in their `enemyPool`.
 */
export const ENEMY_TYPES: Record<EnemyKind, EnemyType> = {
  slime: { id: 'slime', name: 'SLIME', shootable: true, stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'blob', bodyWidth: 26, swaySpeed: 0.95, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  bat: { id: 'bat', name: 'BAT', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'wing', bodyWidth: 26, swaySpeed: 1.5, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  armoredSlime: { id: 'armoredSlime', name: 'ARMORED SLIME', shootable: true, stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'shell', bodyWidth: 26, swaySpeed: 0.95, damageCause: 'spike', contactHint: '甲羅は踏めない' },
  tank: { id: 'tank', name: 'ARMORED BRUTE', shootable: true, stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'brute', bodyWidth: 34, swaySpeed: 0.95, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 118 },
  // SUNKEN RUINS (AREA 3). Fish swim, bubble fish float, jellyfish pulse, urchins hold a shelf.
  // `swaySpeed` is left as it was: `motion` supersedes it for these four, and nothing else reads it.
  fish: { id: 'fish', name: 'FISH', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'fin', bodyWidth: 26, swaySpeed: 1.25, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true,
    // The sweep it always had, with a rise and fall at twice its rate: one crest and one trough per
    // pass, so the path reads as swimming rather than sliding.
    motion: { swim: 1, swimSpeed: 1.25, bob: 10, bobSpeed: 2.5, bobShape: 'wave' } },
  bubbleFish: { id: 'bubbleFish', name: 'BUBBLE FISH', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.45, hp: 1, silhouette: 'orb', bodyWidth: 24, swaySpeed: 1.05, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true, drop: { pickup: 'oxygenBubble' },
    // Half the patrol at little more than half the rate: it drifts rather than darts, so seeing it
    // and lining up a shot on it is the same few seconds.
    motion: { swim: 0.5, swimSpeed: 0.7, bob: 6, bobSpeed: 1.4, bobShape: 'wave' } },
  jellyfish: { id: 'jellyfish', name: 'JELLYFISH', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'bell', bodyWidth: 24, swaySpeed: 0.6, damageCause: 'spike', contactHint: '触手は踏めない',
    // Up and down is the whole motion. The sideways share is small enough to read as current, not
    // as patrol.
    motion: { swim: 0.12, swimSpeed: 0.45, bob: 16, bobSpeed: 1.2, bobShape: 'pulse' } },
  urchin: { id: 'urchin', name: 'URCHIN', shootable: true, stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'spiked', bodyWidth: 24, swaySpeed: 0.35, damageCause: 'spike', contactHint: 'トゲは踏めない',
    // Anchored. A hazard fixed to the shelf it was placed on, exactly where it was placed.
    motion: { swim: 0, swimSpeed: 0, bob: 0, bobSpeed: 0, bobShape: 'wave' } },
  // AREA 3. Two soft targets to bounce from, two hard ones to shoot, one that carries ice.
  fireLizard: { id: 'fireLizard', name: 'FIRE LIZARD', shootable: true, stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'lizard', bodyWidth: 28, swaySpeed: 1.1, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  fireBat: { id: 'fireBat', name: 'FIRE BAT', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'ember', bodyWidth: 26, swaySpeed: 1.75, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  magmaSlime: { id: 'magmaSlime', name: 'MAGMA SLIME', shootable: true, stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'flame', bodyWidth: 26, swaySpeed: 0.85, damageCause: 'heat', contactHint: '炎の上は踏めない' },
  fireArmor: { id: 'fireArmor', name: 'FIRE ARMOR', shootable: true, stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'plated', bodyWidth: 32, swaySpeed: 0.7, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 112 },
  frostBeetle: { id: 'frostBeetle', name: 'FROST BEETLE', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.4, hp: 1, silhouette: 'crystal', bodyWidth: 26, swaySpeed: 0.9, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true, drop: { pickup: 'ice' } },
  // AREA 4. Stompable ones double as footholds once the ledges stop being trustworthy.
  demon: { id: 'demon', name: 'DEMON', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'horned', bodyWidth: 28, swaySpeed: 1.15, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  wraith: { id: 'wraith', name: 'WRAITH', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.8, hp: 1, silhouette: 'shade', bodyWidth: 26, swaySpeed: 0.45, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  // LIMBO's own roster. Nothing here can be stood on -- that is the AREA's rule, so it is declared
  // on the type rather than overridden at spawn -- and all of it flies, because LIMBO has no ground
  // worth guarding. They are separate kinds from DEMON and WRAITH on purpose: those two are also
  // in the FINAL BOSS's roster, and the fight is not being changed to follow the AREAs.
  voidWisp: { id: 'voidWisp', name: 'VOID WISP', shootable: true, stompable: false, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 2, silhouette: 'wisp', bodyWidth: 26, swaySpeed: 1.2, damageCause: 'enemy', contactHint: '踏めない・撃て', behaviour: 'column' },
  hollowShade: { id: 'hollowShade', name: 'HOLLOW SHADE', shootable: true, stompable: false, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.6, hp: 2, silhouette: 'hollow', bodyWidth: 26, swaySpeed: 0.5, damageCause: 'enemy', contactHint: '踏めない・撃て', behaviour: 'orbit' },
  armorGuard: { id: 'armorGuard', name: 'ARMOR GUARD', shootable: true, stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'bulwark', bodyWidth: 32, swaySpeed: 0.6, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 108 },
  spikeDemon: { id: 'spikeDemon', name: 'SPIKE DEMON', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'barb', bodyWidth: 26, swaySpeed: 1.0, damageCause: 'spike', contactHint: 'トゲは踏めない' },
  // THE ABYSS. NIMUSHI splits pieces of itself off: little hooded things that behave like any
  // other enemy, because that is the point -- a clone dies to the same round, pays the same COMBO,
  // drops the same COIN and leaves the same body for KNIFE AND FORK. The shade is the LIMBO-phase
  // variant and declares `stompable: false` on the type, exactly as the LIMBO roster does, rather
  // than having it overridden at spawn.
  /**
   * BOUNCE TAPIOCA -- the arena's reload, and its vertical dodge.
   *
   * Not a platform and not a boss-only verb: an ordinary stompable enemy, answered with the exact
   * bargain AREA 1-4 teaches. Stomp it and you kill it, bounce off it against the pull and refill
   * CHARGE; shoot it and it dies quietly, with no bounce and no reload; brush it from the side and
   * it costs a heart like anything else. Risk buys movement and ammunition, safety buys neither.
   *
   * It exists because the arena has no floor, so it carries the landing's job. Every one of those
   * consequences already lives in the stomp path, which is gravity-relative -- in here that reads
   * as rising into its underside and being thrown back down the screen.
   */
  bounceTapioca: { id: 'bounceTapioca', name: 'BOUNCE TAPIOCA', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'bouncePearl', bodyWidth: 30, swaySpeed: 0.5, damageCause: 'enemy', contactHint: '踏める', leavesCorpse: false },
  nimushiClone: { id: 'nimushiClone', name: 'NIMUSHI CLONE', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'nimushi', bodyWidth: 26, swaySpeed: 1.35, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true },
  nimushiShade: { id: 'nimushiShade', name: 'NIMUSHI SHADE', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'nimushiBarbed', bodyWidth: 26, swaySpeed: 0.9, damageCause: 'spike', contactHint: '踏めない・撃て', leavesCorpse: true },
  // CATACOMB CHASERS (AREA 2). Neither is in a roll's `enemyPool` by accident: ghosts are laid on a
  // schedule of their own, and the skull is listed in the AREA's pool from 2-2 on. What they DO is in
  // chasers.ts; this is only what they ARE, on the same terms as every other row here.
  //
  // GHOST: shootable and stompable like any ordinary soft enemy -- it is simply almost never below
  // you, because it comes from behind. It leaves no body; there is nothing there to leave.
  ghost: { id: 'ghost', name: 'GHOST', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0, hp: 2, silhouette: 'ghost', bodyWidth: 26, swaySpeed: 0, damageCause: 'enemy', contactHint: '止まるな', gems: 20 },
  // FLYING SKULL: rattles, then lunges. One round or one stomp; a lunge into the player is one heart.
  flyingSkull: { id: 'flyingSkull', name: 'FLYING SKULL', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.8, hp: 3, silhouette: 'skull', bodyWidth: 24, swaySpeed: 0, damageCause: 'enemy', contactHint: '撃つと怒る', behaviour: 'wander', gems: 20 },
  // ---------------------------------------------------------------------------------------------
  // DOWNWELL NORMAL GAMEPLAY CLONE. One row per ROLE in the original's Normal Mode roster that DEEP
  // DROP did not have. The body, the name and the look are DEEP DROP's; `hp` (in machine-gun rounds),
  // the stomp / shoot answers and `gems` are the original counterpart's, from its Downwell Wikia page.
  // The boss's roster (slime, bat, fish, jellyfish, demon, spikeDemon ...) is deliberately left alone:
  // where a role needed a new behaviour, it got a new kind rather than changing one the fight uses.
  //
  // CAVERNS: bad bubble -> SPORE, bat -> CAVE BAT, frog -> TOAD, turtle -> SHELLBACK,
  //          snail -> CREEPER, eye -> WATCHER. (worm -> SLIME and crawler -> ARMORED SLIME as before.)
  spore: { id: 'spore', name: 'SPORE', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 3, silhouette: 'spore', bodyWidth: 28, swaySpeed: 0, damageCause: 'enemy', contactHint: '踏める', behaviour: 'drift', gems: 6 },
  caveBat: { id: 'caveBat', name: 'CAVE BAT', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 2, silhouette: 'wing', bodyWidth: 24, swaySpeed: 0, damageCause: 'enemy', contactHint: '向かってくる', leavesCorpse: true, behaviour: 'bat', gems: 12 },
  toad: { id: 'toad', name: 'TOAD', shootable: true, stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 0.8, hp: 4, silhouette: 'toad', bodyWidth: 28, swaySpeed: 0, damageCause: 'enemy', contactHint: '跳ねる', leavesCorpse: true, behaviour: 'frog', gems: 20 },
  shellback: { id: 'shellback', name: 'SHELLBACK', shootable: false, stompable: true, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 0.6, hp: 1, silhouette: 'turtle', bodyWidth: 30, swaySpeed: 0.8, damageCause: 'enemy', contactHint: '弾が効かない・踏め', leavesCorpse: true, gems: 14 },
  creeper: { id: 'creeper', name: 'CREEPER', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.5, hp: 3, silhouette: 'creeper', bodyWidth: 26, swaySpeed: 0, damageCause: 'spike', contactHint: '踏めない', leavesCorpse: true, behaviour: 'crawl', gems: 24 },
  watcher: { id: 'watcher', name: 'WATCHER', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.25, hp: 4, silhouette: 'watcher', bodyWidth: 26, swaySpeed: 0, damageCause: 'spike', contactHint: '踏めない・撃て', behaviour: 'eye', gems: 20 },
  // CATACOMBS: ground skull -> BONE HOPPER, skeleton -> BONE THROWER, phantom -> SHADE ORB. (GHOST and
  // FLYING SKULL are the existing kinds; the skull now behaves as the original's does.)
  boneHopper: { id: 'boneHopper', name: 'BONE HOPPER', shootable: true, stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 1, hp: 2, silhouette: 'boneSkull', bodyWidth: 22, swaySpeed: 0, damageCause: 'enemy', contactHint: '接触', behaviour: 'groundSkull', gems: 4 },
  boneThrower: { id: 'boneThrower', name: 'BONE THROWER', shootable: true, stompable: true, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 0.8, hp: 5, silhouette: 'bones', bodyWidth: 26, swaySpeed: 0, damageCause: 'enemy', contactHint: '骨を投げる', leavesCorpse: true, behaviour: 'throw', gems: 10 },
  shadeOrb: { id: 'shadeOrb', name: 'SHADE ORB', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 1, hp: 2, silhouette: 'orbShade', bodyWidth: 24, swaySpeed: 0, damageCause: 'spike', contactHint: '踏めない・撃て', behaviour: 'phantom', gems: 8 },
  angryOrb: { id: 'angryOrb', name: 'ANGRY ORB', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.3, hp: 2, silhouette: 'orbShade', bodyWidth: 24, swaySpeed: 0, damageCause: 'spike', contactHint: '追ってくる・撃て', behaviour: 'phantomChase', gems: 8 },
  // AQUIFER: swimming turtle -> SHELL SWIMMER, jellyfish -> RISER JELLY, squid -> SQUID, piranha -> BITER.
  shellSwimmer: { id: 'shellSwimmer', name: 'SHELL SWIMMER', shootable: false, stompable: true, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.7, hp: 1, silhouette: 'turtle', bodyWidth: 30, swaySpeed: 0, damageCause: 'enemy', contactHint: '弾が効かない・踏め', leavesCorpse: true, behaviour: 'swim', gems: 14 },
  riserJelly: { id: 'riserJelly', name: 'RISER JELLY', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 1, hp: 3, silhouette: 'bell', bodyWidth: 24, swaySpeed: 0, damageCause: 'spike', contactHint: '昇ってくる・踏めない', behaviour: 'rise', gems: 6 },
  squid: { id: 'squid', name: 'SQUID', shootable: true, stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'squid', bodyWidth: 22, swaySpeed: 0, damageCause: 'enemy', contactHint: '突っ込んでくる', leavesCorpse: true, behaviour: 'squid', gems: 10 },
  biter: { id: 'biter', name: 'BITER', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.5, hp: 2, silhouette: 'biter', bodyWidth: 24, swaySpeed: 0, damageCause: 'spike', contactHint: '踏めない・撃て', behaviour: 'piranha', gems: 14 },
  // LIMBO: phantoms (SHADE ORB / ANGRY ORB above) and the three kinds of "stuff". VOID WISP and HOLLOW
  // SHADE are LIMBO's own existing bodies and now carry the tapered and spherical roles; the diatomic
  // role is a new VOID SHARD rather than SPIKE DEMON, which the boss still uses as it always has.
  voidShard: { id: 'voidShard', name: 'VOID SHARD', shootable: true, stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 0.5, hp: 2, silhouette: 'shard', bodyWidth: 24, swaySpeed: 0, damageCause: 'spike', contactHint: '跳ね回る・撃て', behaviour: 'bounce', gems: 8 },
  ruinBreaker: { id: 'ruinBreaker', name: 'RUIN BREAKER', shootable: true, stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 0.45, hp: 1, silhouette: 'breaker', bodyWidth: 30, swaySpeed: 0.8, damageCause: 'enemy', contactHint: '接触', leavesCorpse: true, onDefeat: 'shatterNearby' },
};
export const enemyType = (kind: EnemyKind) => ENEMY_TYPES[kind];

export interface Enemy {
  id: number; kind: EnemyKind; x: number; y: number; originX: number; range: number; phase: number;
  hp: number; alive: boolean; flash: number; hurtFlash?: number;
  /** Copied from the type so collision code reads one flag instead of matching kinds. */
  shootable: boolean; stompable: boolean; flying: boolean;
  /** Which generator slot placed it: a ledge guard or loose in open water. */
  slot: 'guard' | 'open';
  /**
   * The height it was placed at. Only an enemy with a `motion` moves vertically, and it does so
   * about this line; every other enemy leaves `y` exactly where it was put. Optional so a fixture
   * built by hand without it still works -- GameModel adopts the current `y` on first use.
   */
  originY?: number;
  /**
   * A chaser's own state (GHOST, FLYING SKULL). Present only on those two; every other enemy moves by
   * `enemyPosition` and never has one.
   */
  ai?: ChaseState;
  /**
   * STAGE GENERATION v2: laid by a flow rule rather than the ordinary one -- `path` across a fall,
   * `landing` beside a landing, `group` the rest of a ground-skull group beside its guard (DOWNWELL
   * NORMAL GAMEPLAY CLONE). Absent for every enemy placed the v1 way. Read only by tests and the
   * development measurements; nothing in play depends on it.
   */
  placed?: 'path' | 'landing' | 'group';
}
export function spawnEnemy(kind: EnemyKind, id: number, x: number, y: number, range = 0, phase = 0, slot: 'guard' | 'open' = 'guard'): Enemy {
  const type = ENEMY_TYPES[kind];
  const e: Enemy = { id, kind, x, y, originX: x, originY: y, range, phase, hp: type.hp, alive: true, flash: 0, hurtFlash: 0, shootable: type.shootable, stompable: type.stompable, flying: type.flying, slot };
  // A kind with a BEHAVIOUR (dwellers.ts) gets its state machine here, from where it was laid. A GHOST's
  // state is the generator's to give (it needs the SECTION's speed), so it is set where ghosts are laid.
  if (type.behaviour) e.ai = attachDweller(e, type.behaviour);
  return e;
}

/** Half the collision box's height. The contact tests in GameModel all use `e.y +- 15`. */
export const ENEMY_HALF_HEIGHT = 15;

/**
 * The PULSE curve: `sin(a) + sin(3a) / 6`, scaled so its peak is exactly 1.
 *
 * The third harmonic flattens both ends, so the body slows into the top of its rise, lingers, and
 * moves through the middle -- the "rise, hang, sink" of something drifting on its own buoyancy --
 * while staying a smooth periodic function with a finite speed everywhere. Its peak is worked out
 * once here rather than written down, so the envelope below is exact rather than approximately so.
 */
const pulseRaw = (a: number) => Math.sin(a) + Math.sin(3 * a) / 6;
const PULSE_PEAK = (() => {
  let peak = 0;
  for (let i = 0; i <= 20000; i++) peak = Math.max(peak, Math.abs(pulseRaw(i / 20000 * Math.PI * 2)));
  return peak;
})();
export const pulse = (a: number) => pulseRaw(a) / PULSE_PEAK;

/**
 * Where an enemy is at world time `t`. Pure: the same enemy at the same `t` is always in the same
 * place, whatever the frame rate that got there and however many steps it took.
 *
 * Without a `motion` this is the shared sway every enemy has always used, and `y` is returned
 * untouched. That branch is the whole of AREA 1, 2 and 4 and the FINAL BOSS.
 */
export function enemyPosition(e: Enemy, t: number): { x: number; y: number } {
  const motion = ENEMY_TYPES[e.kind].motion;
  if (!motion) return { x: e.originX + Math.sin(t * ENEMY_TYPES[e.kind].swaySpeed + e.phase) * e.range, y: e.y };
  const originY = e.originY ?? e.y;
  const x = e.originX + Math.sin(t * motion.swimSpeed + e.phase) * e.range * motion.swim;
  // Twice the phase, so a fish's crest and trough stay locked to its own sweep when bobSpeed is
  // twice swimSpeed, and two neighbours placed with different phases never bob in step.
  const a = t * motion.bobSpeed + e.phase * 2;
  if (motion.bob === 0) return { x, y: originY };
  if (e.slot === 'guard') return { x, y: originY - motion.bob * (1 - Math.cos(a)) / 2 };
  return { x, y: originY + (motion.bobShape === 'pulse' ? pulse(a) : Math.sin(a)) * motion.bob };
}

/**
 * EVERYWHERE THIS ENEMY'S BODY CAN EVER BE, as a box.
 *
 * Placement used to be judged against where an enemy stood when it was placed plus its sideways
 * range, which was the whole truth while nothing moved vertically. It is not any more, so anything
 * that must stay clear of an enemy -- a doodad's bounce, an air container, a chamber mouth -- asks
 * this instead. It is exact rather than sampled: every motion is a bounded periodic function about
 * a known origin, so the extremes are the origin plus the amplitude plus half the body.
 */
export function motionEnvelope(e: Enemy): { minX: number; maxX: number; minY: number; maxY: number } {
  const type = ENEMY_TYPES[e.kind];
  const motion = type.motion;
  const half = type.bodyWidth / 2;
  const originY = e.originY ?? e.y;
  const reach = motion ? e.range * motion.swim : e.range;
  const bob = motion?.bob ?? 0;
  // A hopper's leap is part of where its body can be: the original's frog clears several of its own
  // heights (dwellers.ts: 560px/s up at gravity 1680 is 93px; a bone hopper's 300 is 27px).
  const leap = type.behaviour === 'frog' ? 94 : type.behaviour === 'groundSkull' ? 28 : 0;
  const up = bob + leap, down = motion && e.slot !== 'guard' ? bob : 0;
  return {
    minX: e.originX - reach - half, maxX: e.originX + reach + half,
    minY: originY - up - ENEMY_HALF_HEIGHT, maxY: originY + down + ENEMY_HALF_HEIGHT,
  };
}
