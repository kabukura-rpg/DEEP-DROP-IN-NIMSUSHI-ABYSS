import { WORLD, JUMP, WALL_JUMP, initialStats } from '../data/balance';
import { StageGenerator, START_PLATFORM, type Enemy, type Platform, type RoutePlatform } from './StageGenerator';
import { OxygenSystem } from './OxygenSystem';
import { HeatSystem } from './HeatSystem';
import { BreakablePlatformSystem, BREAK_RULES } from './BreakablePlatformSystem';
import { NimushiBossSystem, type NimushiSignal, type TapiocaCup } from './NimushiBossSystem';
import { GunModuleSystem } from './GunModuleSystem';
import { CoinSystem } from './CoinSystem';
import { CoinHighSystem } from './CoinHighSystem';
import { ShopSystem } from './ShopSystem';
import { coinsFor, type Coin } from '../data/coins';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES, EXIT_RULES, LIMBO_HAZARD_RULES, PLATFORM_THICKNESS, SHOP_DOOR, SPIKE_PLATFORM_RULES, breakBlockWidth, spikePlatform, type AirBubble, type AirContainer, type StageExit } from '../data/structures';
import { DOODAD_RULES, spawnDoodad, type Doodad } from '../data/doodads';
import { CORPSE_RULES, spawnCorpse, type Corpse } from '../data/corpses';
import { insideSafeZone, SAFE_ZONE_RULES, type SafeZone } from '../data/safeZone';
import { CAVE_RULES, caveRewardSpot, caveVeinBounds, inCaveInterior, insideCave, shapeOf, type SideCave } from '../data/sideCave';
import { BOSS_PHYSICS, GRAVITY_DIRECTION, type BattlePhysics } from '../data/bossPhysics';
import { spawnEnemy } from '../data/enemies';
import { ABYSS_SHOP_AREA, shopItem, type ShopOffer } from '../data/shop';
import { CHARGE_AMMO_BONUS, gunModule, rollGunModule, STARTING_GUN_MODULE, volley, volleyRecoil, type GunModuleId, type ShotBoost } from '../data/gunModules';
import { ABYSS, abyssPhase, ARENA_FLOOR, ARENA_VIEW, TOMATO, type AbyssPhase } from '../data/abyss';
import { BOUNCE_TAPIOCA, NIMUSHI, NIMUSHI_LINES, STRAW_BEAM, TAPIOCA_CUP } from '../data/nimushi';
import { hazardBounds, hazardType, ventStateAt, type Hazard } from '../data/hazards';
import { pickupType, spawnGunModule, spawnPickup, type Pickup } from '../data/pickups';
import { HealthSystem, type DamageCause } from './HealthSystem';
import { comboTierFor } from '../data/combo';
import { UPGRADE_TUNING, type UpgradeId } from '../data/upgrades';
import { UpgradeSystem } from './UpgradeSystem';
import { StageProgressionSystem } from './StageProgressionSystem';
import { FINAL_STAGE, type AreaId, type SectionId } from '../data/areas';
import { enemyPosition, enemyType } from '../data/enemies';
import { defaultTuning, sanitizeTuning, type PhysicsTuning } from './PhysicsTuning';
export type GameEvent = { type: 'shot' | 'empty' | 'land' | 'kill' | 'hurt' | 'upgrade' | 'over' | 'heal' | 'boss' | 'clear' | 'oxygen' | 'section' | 'ice' | 'vent' | 'crack' | 'collapse' | 'bossHit' | 'bossTelegraph' | 'bossFire' | 'bossPhase' | 'bossDown' | 'gunModule' | 'coin' | 'shopOpen' | 'shopBuy' | 'exitReady' | 'exit' | 'containerBreak' | 'blockCrack' | 'blockBreak' | 'jump' | 'wallJump' | 'comboSettle' | 'doodad' | 'timeVoid' | 'coinVein' | 'coinHigh' | 'spikePlatform' | 'explosion' | 'corpse' | 'balloon' | 'jetpack' | 'gravityFlip' | 'bossEye' | 'bossRage' | 'bossStart' | 'tomato' | 'bossLine' | 'seal' | 'abyss'; x: number; y: number; value?: number; stomp?: boolean; lifeUps?: number; overflow?: number; combo?: number; stage?: string; areaCleared?: string | null; bonus?: 'heart' | 'charge'; source?: { id: number; kind: Enemy['kind']; x: number; y: number } };
/**
 * Who fired a round.
 *
 * Four of the twenty upgrades put projectiles in the air that are NOT the gunboots, and several
 * rules have to tell them apart: only the player's own rounds cost CHARGE, only the player's own
 * rounds take the COIN HIGH boost, and a future gravity inversion has to know which way each of
 * them was meant to go. Naming the source is cheaper than inferring it from four different places.
 */
export type BulletSource = 'player' | 'drone' | 'casing' | 'poppingGem' | 'gunpowderBlock';

export interface Bullet {
  source: BulletSource;
  x: number; y: number; previousY: number; previousX: number;
  /** Velocity in px/s. Straight-down weapons simply carry vx = 0. */
  vx: number; vy: number;
  damage: number; size: number;
  /** Enemies this round may pass through beyond the first. */
  pierce: number;
  /** True: a BREAK BLOCK is damaged but does not stop it. */
  pierceBlocks: boolean;
  /** BREAK BLOCK ids already hit, so one round can never hit the same block twice. */
  blocks: Set<number>;
  range: number; travelled: number;
  /**
   * The shooter's own vertical velocity when this round left the gun, or absent for anything fired
   * from a standing start.
   *
   * `range` is the weapon's reach FROM THE GUN, so the distance flown has to be measured the same
   * way: a round thrown out of a terminal-speed fall covers more ground than one fired standing
   * still, and charging it for the fall as well would cut a machine gun's reach from 900px to about
   * 430 and its life from 1.06s to 0.51. Subtracting what it was thrown with leaves the weapon's
   * own speed, so every module keeps the reach and the lifetime its table declares, at any speed.
   *
   * LOCKED with the projectile model in `fireVolley`. Dropping this field and going back to
   * charging range against world travel would keep the player from overtaking their own shot, but
   * it would take weapon identity out the back door instead: every module's reach and lifetime
   * would shrink with how fast the shooter happens to be falling.
   */
  carried?: number;
  /** Drawn as a streak instead of a pellet; damage still uses the ordinary path. */
  beam: boolean;
  hits: Set<number>; alive: boolean;
}
/**
 * Does the segment a projectile swept this step touch the band [lo, hi]?
 *
 * The test this replaces -- "it is past the top NOW and was above the bottom BEFORE" -- is this
 * same question asked of something that can only ever travel downward. Rounds now travel either
 * way, so it is asked of the swept segment instead. For a downward round the two are identical,
 * which is why nothing in the ordinary run moves as a result of the generalisation.
 */
export const sweeps = (previous: number, current: number, lo: number, hi: number) =>
  Math.max(previous, current) >= lo && Math.min(previous, current) <= hi;

/**
 * The id a round records when it has already spent itself on NIMUSHI's eye. Enemy ids are positive,
 * so a negative one cannot collide with an enemy and the ordinary "one hit per target, then check
 * the piercing budget" rule covers the boss without a rule of its own.
 */
const NIMUSHI_TARGET = -1;

/** A plain downward round, exactly as MACHINE GUN fires it. Useful for fixtures and drops. */
export const plainBullet = (x: number, y: number, damage = 1, size = 4): Bullet => ({
  source: 'player',
  x, y, previousY: y, previousX: x, vx: 0, vy: 850, damage, size, pierce: 0,
  pierceBlocks: false, blocks: new Set(),
  range: 900, travelled: 0, beam: false, hits: new Set(), alive: true,
});
/** The shaft's own brickwork, for coins outside any cave. Named so the two readings match. */
const COIN_SHAFT_WALLS = { left: WORLD.wall, right: WORLD.width - WORLD.wall } as const;

export class GameModel {
  stats = initialStats();
  player = { x: 225, y: WORLD.startY, vy: 0, vx: 0, width: 22, height: 30, invincible: 0, grounded: -1 };
  platforms: Platform[] = [{ ...START_PLATFORM }];
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  /** Scenery that reloads CHARGE when bounced off. Never an enemy, never a platform. */
  doodads: Doodad[] = [];
  /** Chambers cut into the shaft wall. Being inside one is what freezes the world outside it. */
  safeZones: SafeZone[] = [];
  /** Bodies left by the fallen. Inert unless the run holds KNIFE AND FORK or REST IN PIECES. */
  corpses: Corpse[] = [];
  /** Bodies eaten so far. Ten pays a heart; the count survives the SECTION, not the run's end. */
  corpsesEaten = 0;
  private nextCorpseId = 1;
  /** SAFETY JETPACK's remaining hover, in seconds. Refilled wherever CHARGE is. */
  jetpackFuel: number = UPGRADE_TUNING.safetyJetpack.fuelSeconds;
  /** True on the frames the jetpack is actually holding the player up, for the view and the tests. */
  jetpackActive = false;
  /** HEART BALLOON, while this SECTION still has one. */
  balloon: { x: number; y: number; alive: boolean } | null = null;
  /** TIMEOUT's bubbles: stopped time left where the player was hit, fixed in place. */
  timeoutBubbles: { id: number; x: number; y: number; radius: number }[] = [];
  private nextBubbleRegionId = 1;
  /** The COIN HIGH meter. Fed by every path that earns money; see `earnCoins`. */
  coinHigh = new CoinHighSystem();
  bullets: Bullet[] = [];
  events: GameEvent[] = [];
  ammo = this.stats.maxAmmo;
  readonly health = new HealthSystem(this.stats.maxHp, () => this.running && !this.victorySealed, () => this.finish());
  readonly upgrades: UpgradeSystem;
  readonly stage: StageProgressionSystem;
  readonly oxygen = new OxygenSystem();
  readonly heat = new HeatSystem();
  readonly collapse = new BreakablePlatformSystem();
  readonly boss = new NimushiBossSystem();
  readonly gun = new GunModuleSystem();
  readonly coins = new CoinSystem();
  readonly shop = new ShopSystem();
  /**
   * Where the run is inside THE ABYSS.
   *
   *   none      -- an ordinary SECTION, or the title screen.
   *   staging   -- the room past 4-3: the final shop, the seal, ordinary downward gravity.
   *   inverting -- the reversal itself. The world is held still for the length of it.
   *   fight     -- NIMUSHI. Gravity pulls up and stays that way until the run ends.
   */
  abyssStage: 'none' | 'staging' | 'inverting' | 'fight' = 'none';
  private inversionTimer = 0;
  private inversionFlipped = false;
  /**
   * How many SAFE ZONE chambers this run has actually stepped into. Counted during ordinary play
   * only, because what it decides is what the ABYSS offers a run that never once took shelter.
   */
  safeZoneVisitCount = 0;
  private insideZone = false;
  /**
   * Metres climbed since the world turned over. Deliberately its OWN number: the fight goes back up
   * the way the run came down, and TOTAL DEPTH must not be given any of it to subtract.
   */
  bossAscent = 0;
  /** What NIMUSHI is saying, and how much longer it hangs there. Any input dismisses it. */
  bossLine: { text: string; timer: number } | null = null;
  private sealY = 0;
  /** The deepest arena row laid so far, measured along the pull. */
  private abyssFrontier = 0;
  private nextAbyssId = -4000;
  /** Which wall the next arena row hangs from. Alternated, so the fall lane swaps sides. */
  private abyssSide: -1 | 1 = -1;
  private shopReturn: 'playing' | 'boss' = 'playing';
  /** SUNKEN RUINS' (AREA 3) sealed air containers, and the bubbles a broken one released. */
  containers: AirContainer[] = [];
  bubbles: AirBubble[] = [];
  /** The way out of this SECTION, once the shaft has bottomed out. Null until then. */
  exit: StageExit | null = null;
  private nextBubbleId = 1;
  paused = false;
  /** True while the world is actually simulating: normal play and the boss fight alike. */
  get running() { return (this.state === 'playing' || this.state === 'boss') && !this.paused && !this.shop.open; }
  /**
   * The run is already won. The moment the king's HP reaches zero the fight is decided, so nothing
   * during the short collapse -- a stray demon, lava, drowning, overheating, a shot already in the
   * air -- may turn that victory into a GAME OVER. Routed through HealthSystem's own damage gate,
   * so every source is covered by this one predicate.
   */
  /** The SAFE ZONE the player is standing in, or null out in the shaft. */
  get safeZone(): SafeZone | null {
    const p = this.player;
    return this.safeZones.find(zone => insideSafeZone(zone, p.x, p.y)) ?? null;
  }
  /**
   * TIMEVOID. True while the player is inside a chamber: the shaft outside stops dead -- enemies,
   * rounds, collapse timers, the oxygen tank, the heat gauge, generation, the descent itself --
   * while the player keeps moving, jumping, wall jumping and firing inside. It is emphatically NOT
   * a pause: `running` stays true and the simulation keeps stepping.
   */
  get timeFrozen() { return this.frozenRegion !== null; }
  /**
   * The pocket of running time the player is standing in, if any.
   *
   * There are two kinds now: a SAFE ZONE chamber, and a TIMEOUT bubble left where a hit landed.
   * They behave identically once you are inside one -- the world outside stops, everything inside
   * keeps going -- so everything that asks "is this point in stopped time?" asks this one shape
   * rather than knowing about either. A chamber wins ties simply because it is checked first;
   * nothing depends on which, because the answer is the same.
   */
  get frozenRegion(): { contains: (x: number, y: number) => boolean } | null {
    const p = this.player;
    const zone = this.safeZones.find(z => insideSafeZone(z, p.x, p.y));
    if (zone) return { contains: (x, y) => insideSafeZone(zone, x, y) };
    // A SIDE CAVE stops the world too, but only once the player is PAST THE THROAT. Standing in the
    // mouth looking in is still the shaft: the decision to go in has not been made yet, and a hole
    // that froze the run just for being looked at would make the choice for the player.
    const cave = this.caves.find(c => inCaveInterior(c, p.x, p.y));
    if (cave) return { contains: (x, y) => insideCave(cave, x, y) };
    const bubble = this.timeoutBubbles.find(b => Math.hypot(p.x - b.x, p.y - b.y) <= b.radius);
    if (bubble) return { contains: (x, y) => Math.hypot(x - bubble.x, y - bubble.y) <= bubble.radius };
    return null;
  }
  /** The last TIMEVOID state announced through an event, so both halves of a move can raise one. */
  private timeVoidOn = false;
  get victorySealed() { return this.state === 'clear' || (this.boss.enabled && this.boss.defeated); }
  get hp() { return this.health.currentHp; }
  set hp(value: number) { this.health.currentHp = value; }
  /** Depth inside the current SECTION; the only value SECTION CLEAR is judged on. */
  sectionDepth = 0;
  /** Metres banked by every SECTION already cleared in this run. */
  completedDepth = 0;
  /**
   * The run depth the game reports. A SECTION is worth exactly its planned length: hunting for
   * the exit below the goal is real descent, but it is never banked, so a cleared run still
   * totals 12 x 200m.
   */
  get bankedSectionDepth() {
    if (this.stage.boss) return 0;
    // Endless has no sections and therefore no cap; a real SECTION is worth its planned length.
    return this.stage.enabled ? Math.min(this.sectionDepth, this.stage.sectionLength) : this.sectionDepth;
  }
  get totalDepth() { return this.completedDepth + this.bankedSectionDepth; }
  get sectionLength() { return this.stage.sectionLength; }
  kills = 0;
  private comboValue = 0;
  get combo() { return this.comboValue; }
  set combo(value: number) { this.comboValue = value; }
  /** Raw ACTION state last step, so a held button jumps once rather than every frame. */
  private actionHeld = false;
  /**
   * Which wall the last WALL JUMP left from, so the same one cannot be ridden forever. Cleared by
   * touching the other wall or by any ordinary landing.
   */
  private wallJumpUsed: -1 | 0 | 1 = 0;
  /** Horizontal shove from a WALL JUMP, decaying. Zero at all other times. */
  private wallKick = 0;
  /** The wall most recently touched and how long ago, so contact survives the step that leaves it. */
  private wallTouchSide: -1 | 0 | 1 = 0;
  private wallTouchAge = Infinity;
  /**
   * WHICH WAY THE WORLD PULLS, as a sign on the screen's own y axis.
   *
   *   +1  the ordinary run: the player falls down the screen, the gunboots fire down, the recoil
   *       throws them up, the view descends.
   *   -1  the ABYSS: every one of those turns over, and nothing else does.
   *
   * A sign rather than a rotation, deliberately. The HUD, the text, the shaft walls and LEFT/RIGHT
   * are all exactly where they were: what is inverted is the physics, not the screen.
   */
  /**
   * The physics the PLAYER obeys right now: the run's, or NIMUSHI's.
   *
   * Controls are shared and identical in both modes; only the response differs. The switch is the
   * ABYSS itself -- from the moment the staging room opens, the player is on NIMUSHI's terms -- so
   * nothing about a normal SECTION can reach the fight and nothing about the fight can reach a
   * SECTION. A new run starts at `abyssStage: 'none'` and is therefore on normal physics with no
   * reset step to forget.
   *
   * `stats` remains the run's own, because upgrades and gun modules are carried into the fight and
   * keep working: only the three movement numbers are mode-specific.
   */
  get physics(): BattlePhysics {
    return this.inBossMode ? BOSS_PHYSICS : this.stats;
  }
  /** True from the moment THE ABYSS opens, through the inversion, to the end of the fight. */
  get inBossMode() { return this.abyssStage !== 'none' || this.state === 'boss'; }
  /**
   * True only inside the ARENA itself -- past the seal, with gravity turned over.
   *
   * Narrower than `inBossMode` on purpose. The staging room is an ordinary descent with ordinary
   * floors and ordinary gravity, and the arena's vertical thrust does not belong there: it launched
   * the player away from the seal they were trying to reach, which is a shaft nobody could get down.
   */
  get inBossArena() { return this.abyssStage === 'fight'; }

  /** Which way the pull runs. Direction only -- the MAGNITUDE comes from `physics`. */
  private gravity: 1 | -1 = GRAVITY_DIRECTION.normal;
  get gravitySign(): 1 | -1 { return this.gravity; }
  /** True while the ABYSS is pulling the player up the screen. */
  get inverted() { return this.gravity === -1; }
  /**
   * Which way "up" is for every impulse the player receives -- a jump, a wall jump, the gunboots'
   * recoil, and the rounds three of the twenty upgrades fire away from the floor. Always the
   * opposite of the pull, whichever way the pull currently points.
   */
  private get up() { return -this.gravity; }
  /** A distance or a velocity measured ALONG the pull: positive is falling, negative is rising. */
  private along(value: number) { return value * this.gravity; }
  /** The player's leading edge: their feet in the shaft, the top of their head in the ABYSS. */
  private get lead() { return 15 * this.gravity; }
  /** The face of a slab that gravity presses the player onto -- its top, or its underside. */
  private surfaceOf(f: Platform) {
    return this.gravity > 0 ? f.y : f.y + (f.breakBlock ? BREAK_BLOCK_RULES.thickness : PLATFORM_THICKNESS);
  }
  /** The edge of a box that trails the view: its bottom in the shaft, its top in the ABYSS. */
  private trailingEdge(y: number, height = 0) { return this.gravity > 0 ? y + height : y; }
  /**
   * True when the player crossed `face` during this step while travelling WITH gravity. One test
   * decides a landing, a stomp and a doodad bounce, whichever way down happens to be.
   */
  private crossedWithGravity(before: number, after: number, face: number) {
    return this.along(after - face) >= 0 && this.along(before - face) <= 0;
  }
  /** Out past the leading edge of the view, along the pull. */
  private aheadOfCamera(y: number, margin: number) {
    const edge = this.gravity > 0 ? this.cameraY + WORLD.height + margin : this.cameraY - margin;
    return this.along(y - edge) >= 0;
  }
  /** Fallen behind the trailing edge of the view, against the pull. */
  private behindCamera(y: number, margin: number) {
    const edge = this.gravity > 0 ? this.cameraY - margin : this.cameraY + WORLD.height + margin;
    return this.along(y - edge) <= 0;
  }
  /**
   * Where the view sits. It only ever travels WITH gravity -- down the shaft, up the ABYSS -- and
   * holds the player 37% of a frame behind its leading edge, which in the ABYSS puts them 37% up
   * from the bottom so NIMUSHI above and the boundary below are both in shot.
   *
   * In the arena it stops following the player at all and follows NIMUSHI instead:
   *
   *   BOSS SCREEN POSITION   fixed, at `ARENA_VIEW.bossAnchor` of the frame
   *   PLAYER SCREEN POSITION free, wherever their own physics has put them
   *
   * That is the opposite way round from the shaft, and it is the fight. NIMUSHI is the thing the
   * arena is measured from -- it climbs at its own pace and the view climbs with it -- so the
   * player's height in the frame IS the gap, read directly off the screen. Rise too far and the
   * top of the frame is the body; sink too far and the bottom of the frame is the drop. The
   * playable space between them is what the player is managing, and it is finally visible.
   *
   * Nothing here touches the player. There is no anchor holding them at a share of the frame, no
   * minimum gap and no correction: they move on physics alone, and the camera only decides where
   * the two of them are drawn. What it costs is the old promise that the view could never run
   * ahead of the player -- it can now, and `ARENA_FLOOR` catching them is exactly the point.
   */
  private leadCamera(py: number) {
    const held = this.bossAnchorCamera();
    // Still monotonic along the pull, and for free: NIMUSHI's own position only ever advances.
    if (held !== null) return this.gravity > 0 ? Math.max(this.cameraY, held) : Math.min(this.cameraY, held);
    const want = py - WORLD.height * (this.gravity > 0 ? 0.37 : 0.63);
    return this.gravity > 0 ? Math.max(this.cameraY, want) : Math.min(this.cameraY, want);
  }
  /**
   * The camera that holds NIMUSHI's leading edge at `ARENA_VIEW.bossAnchor` of the frame, or null
   * when there is no fight to frame.
   *
   * The leading edge is whichever face of the body the pull leads toward -- the top of it while the
   * ABYSS pulls upward -- so the boss is framed the same way round whichever way the world is.
   *
   * It is monotonic along the pull for free, because NIMUSHI's own position is: it ascends, and the
   * one clamp it has only ever moves it forward. So the camera's "only ever travels with the pull"
   * rule is never fighting this one.
   */
  /**
   * Follow the player sideways while they are in a SIDE CAVE, and ease back to the shaft on the way
   * out. Eased every frame rather than set, so there is no snap going in and no jump coming out --
   * the view slides across and slides back, and in the shaft it rests at zero like it always has.
   *
   * The target keeps the player centred but is clamped to the cave's own span plus the shaft, so
   * the view never runs off the end of the rock or loses sight of the way home.
   */
  private trackCaveCamera(dt: number) {
    const cave = this.cave;
    let want = 0;
    if (cave) {
      const span = cave.side === -1
        ? { from: cave.bounds.x - 8, to: WORLD.width }
        : { from: 0, to: cave.bounds.x + cave.bounds.width + 8 };
      want = Math.max(span.from, Math.min(span.to - WORLD.width, this.player.x - WORLD.width / 2));
    }
    const ease = Math.min(1, dt * CAVE_RULES.cameraFollow);
    const limit = CAVE_RULES.cameraMaxSpeed * dt;
    const move = (want - this.cameraX) * ease;
    this.cameraX += Math.max(-limit, Math.min(limit, move));
    if (Math.abs(this.cameraX - want) < 0.2) this.cameraX = want;
  }

  private bossAnchorCamera(): number | null {
    if (!this.inBossArena || !this.boss.enabled) return null;
    // The FRAMED body: NIMUSHI's station, with the hit recoil left out, so shooting the eye jolts
    // the boss against a steady view rather than shaking the whole screen.
    const body = this.boss.framedBody;
    const lead = this.gravity > 0 ? body.y + body.height : body.y;
    return lead - WORLD.height * (this.gravity > 0 ? 1 - ARENA_VIEW.bossAnchor : ARENA_VIEW.bossAnchor);
  }
  /**
   * Turn the world over, or turn it back. Velocity is cleared rather than mirrored: the moment the
   * pull reverses, whatever the player was doing under the old one is finished.
   */
  private setGravity(sign: 1 | -1) {
    if (this.gravity === sign) return false;
    this.gravity = sign;
    this.coins.gravitySign = sign;
    this.player.vy = 0;
    this.player.grounded = -1;
    this.lastAirShot = -Infinity;
    return true;
  }
  /**
   * The world's own clock. It stops while the player is inside a SAFE ZONE, which is what TIMEVOID
   * is: `elapsed` keeps running for the player (recoil recovery, animation), while everything that
   * belongs to the shaft -- patrol sway, vent cycles -- is driven from this instead and simply does
   * not advance. Freezing by skipping updates alone would make the world JUMP on resume.
   */
  private worldElapsed = 0;
  /** The doodad currently underfoot, so one contact cannot reload every frame. */
  private doodadContact: number | null = null;
  maxCombo = 0;
  killScore = 0;
  cameraY = 0;
  /**
   * The camera's horizontal offset. Zero everywhere in the shaft, which is the whole game except
   * inside a SIDE CAVE -- a cave reaches outside the shaft, so following the player into one is the
   * only way to show them. Eased, never snapped, and eased back to zero on the way out.
   */
  cameraX = 0;
  /** The SIDE CAVEs currently loaded. Culled with everything else once they are behind. */
  caves: SideCave[] = [];
  elapsed = 0;
  cooldown = 0;
  state: 'playing' | 'upgrade' | 'boss' | 'over' | 'clear' | 'shop' = 'playing';
  private nextChunk = 0;
  private generator: StageGenerator;
  private random: () => number;
  private lastAirShot = -Infinity;
  constructor(public practice = false, random = Math.random, progression: 'stage' | 'endless' = 'stage') {
    this.random = random;
    this.stage = new StageProgressionSystem(progression === 'stage');
    this.upgrades = new UpgradeSystem(random);
    // Preserve the existing read APIs without duplicating mutable health state.
    Object.defineProperty(this.stats, 'maxHp', { enumerable: true, get: () => this.health.maxHp });
    Object.defineProperty(this.player, 'invincible', { enumerable: true, get: () => this.health.invincibilityRemaining, set: (value: number) => { this.health.invincibilityRemaining = value; } });
    this.generator = new StageGenerator(random);
    if (practice) this.platforms = [{ id: -2, x: 115, y: 520, width: 220 }];
    else this.startSection();
  }
  get multiplier() { return (this.combo >= 8 ? 2 : this.combo >= 5 ? 1.5 : this.combo >= 3 ? 1.2 : 1) + (this.combo ? this.stats.comboBonus : 0); }
  get score() { return Math.floor(this.totalDepth) + this.killScore; }
  setPhysicsTuning(values: PhysicsTuning) {
    if (!this.practice) return;
    const oldMax = this.stats.maxAmmo;
    Object.assign(this.stats, sanitizeTuning(values));
    // Preserve spent rounds when resizing the magazine; no implicit mid-air reload.
    this.ammo = Math.max(0, Math.min(this.stats.maxAmmo, this.ammo + this.stats.maxAmmo - oldMax));
    this.player.vy = Math.min(this.player.vy, this.physics.maxFallSpeed);
  }
  resetPhysicsTuning() { this.setPhysicsTuning(defaultTuning()); }
  /** Present only for submerged areas; undefined restores the ordinary instant movement. */
  get water() { return this.practice ? undefined : this.boss.enabled ? this.boss.phase.water : this.stage.config.water; }
  /**
   * The SIDE CAVE the player is in, or null. A cave reaches outside the shaft, so this is what
   * widens the playable span, moves the camera and stops the world -- and it is checked against the
   * whole cave, including its sill, so walking in off the ledge is never blocked by the shaft wall.
   */
  get cave(): SideCave | null {
    const p = this.player;
    return this.caves.find(c => insideCave(c, p.x, p.y)) ?? null;
  }
  /**
   * The playable span; the player's body stops 12px short of the brickwork on either side -- or of
   * the cave's far wall, while they are inside one. There is no third case: a cave's bounds always
   * overlap the shaft at its mouth, so the span is continuous across the threshold.
   */
  private get leftEdge() {
    const cave = this.cave;
    return cave && cave.side === -1 ? cave.bounds.x + 12 : WORLD.wall + 12;
  }
  private get rightEdge() {
    const cave = this.cave;
    return cave && cave.side === 1 ? cave.bounds.x + cave.bounds.width - 12 : WORLD.width - WORLD.wall - 12;
  }
  /** -1 pressed against the left wall, 1 against the right, 0 in open air. */
  get wallSide(): -1 | 0 | 1 {
    const p = this.player;
    if (p.x <= this.leftEdge + 0.5) return -1;
    if (p.x >= this.rightEdge - 0.5) return 1;
    return 0;
  }
  /**
   * The wall a WALL JUMP may leave from this frame, or 0 for none. It needs all of: being in the
   * air, touching a wall, steering AWAY from it, and not having just left that same wall. The last
   * condition is what stops a player climbing one wall forever; it clears on the other wall or on
   * any landing.
   */
  wallJumpSide(direction: number): -1 | 0 | 1 {
    if (this.player.grounded !== -1) return 0;
    // Live contact first, then contact remembered from the last fraction of a second. The grace is
    // not a nicety: steering away from a wall IS what breaks contact, so without it the move could
    // never be performed at all.
    const side = this.wallSide !== 0 ? this.wallSide
      : this.wallTouchAge <= WALL_JUMP.grace ? this.wallTouchSide : 0;
    if (side === 0 || side === this.wallJumpUsed) return 0;
    return Math.sign(direction) === -side ? side : 0;
  }
  /** Remember the wall under the player's shoulder right now, if there is one. */
  private noteWallTouch() {
    const side = this.wallSide;
    if (side !== 0) { this.wallTouchSide = side; this.wallTouchAge = 0; }
  }
  moveHorizontal(dt: number, direction: number) {
    if (!this.running) return;
    const p = this.player, input = Math.max(-1, Math.min(1, direction)), water = this.water;
    // Sampled before AND after the move: entering the frame against the wall counts, and so does
    // being pushed into it during the frame.
    this.noteWallTouch();
    // Touching the opposite wall re-arms the one already used, so a shaft can be zig-zagged down.
    if (this.wallJumpUsed !== 0 && this.wallSide === -this.wallJumpUsed) this.wallJumpUsed = 0;
    if (!water) {
      p.vx = 0;
      p.x = Math.max(this.leftEdge, Math.min(this.rightEdge, p.x + (input * this.physics.moveSpeed + this.wallKick) * dt));
      this.decayWallKick(dt);
      this.noteWallTouch();
      return;
    }
    // Submerged: steer towards the input speed instead of snapping to it, and drift on release.
    p.vx += (input * this.physics.moveSpeed - p.vx) * Math.min(1, water.responsiveness * dt);
    const next = Math.max(this.leftEdge, Math.min(this.rightEdge, p.x + (p.vx + this.wallKick) * dt));
    if (next === p.x) p.vx = 0;
    p.x = next;
    this.decayWallKick(dt);
    this.noteWallTouch();
  }
  /** The shove fades over WALL_JUMP.kickTime and is then exactly zero again. */
  private decayWallKick(dt: number) {
    if (this.wallKick === 0) return;
    this.wallKick *= Math.max(0, 1 - dt / WALL_JUMP.kickTime);
    if (Math.abs(this.wallKick) < 1) this.wallKick = 0;
  }
  /**
   * Fire one volley immediately, bypassing the module's trigger rules. Direct callers (and the
   * legacy single-shot path) use this; the held trigger goes through fireGun below.
   */
  shoot() {
    if (!this.running || this.cooldown > 0) return;
    const def = this.gun.module;
    this.cooldown = def.fireInterval;
    const p = this.player;
    // The last round always fires. A volley costs what it costs, but a magazine with anything left
    // in it can pay for one more shot; only an empty one refuses. Spending is clamped at zero.
    if (this.ammo <= 0) { this.emit('empty', p.x, p.y); return; }
    this.fireVolley(def.ammoCost, 0);
  }
  /** One trigger frame. The equipped module decides whether anything leaves the barrel. */
  private fireGun(dt: number, direction: number, firing: boolean) {
    const request = this.gun.update(dt, firing, this.ammo);
    // SAFETY JETPACK lives exactly where the gunboots give up: airborne, dry, and still holding
    // ACTION. It fires nothing and pays no CHARGE -- it only stops the fall while fuel lasts.
    this.jetpackActive = false;
    if (firing && this.ammo <= 0 && this.player.grounded === -1 && this.upgrades.has('safetyJetpack') && this.jetpackFuel > 0) {
      this.jetpackFuel = Math.max(0, this.jetpackFuel - dt);
      this.jetpackActive = true;
      const p = this.player;
      const drift = this.physics.maxFallSpeed * UPGRADE_TUNING.safetyJetpack.fallMultiplier;
      // Measured along the pull: in the ABYSS "too fast" is climbing the screen too fast.
      if (this.along(p.vy) > drift) p.vy = drift * this.gravity;
      this.events.push({ type: 'jetpack', x: p.x, y: p.y, value: this.jetpackFuel });
      return;
    }
    if (request.kind === 'idle') return;
    if (request.kind === 'empty') { this.emit('empty', this.player.x, this.player.y); return; }
    this.fireVolley(request.cost, direction);
  }
  /**
   * Spend the rounds, kick the player and spawn the projectiles the module describes.
   *
   * The gunboots are boots: a heavy weapon genuinely throws the player upward rather than merely
   * slowing a fall. What stops that becoming flight is the existing recovery curve -- full recoil
   * returns only after 0.34s, so held fire pays 0.65x -- and each module's own fire interval. At
   * every module's rate, gravity over one interval outweighs the recoil that interval buys, so no
   * weapon climbs on its own trigger even though any of them can lift once.
   *
   * Rise is capped at the same speed as a fall, which is the natural symmetry and needs no number
   * of its own.
   */
  private fireVolley(cost: number, aim: number) {
    const p = this.player;
    const def = this.gun.module;
    this.ammo = Math.max(0, this.ammo - cost);
    const recovery = Math.max(0.65, Math.min(1, 0.65 + (this.elapsed - this.lastAirShot - def.fireInterval) / 0.18 * 0.35));
    const kick = volleyRecoil(def, this.stats) * recovery;
    /**
     * RECOIL IS A BRAKE, NEVER A THRUSTER.
     *
     * The gunboots slow a descent and can hold it at a standstill while CHARGE lasts. They cannot
     * add height. Firing while already moving against the pull does nothing to the velocity at all,
     * so a jump's apex is the jump's alone and no weapon can raise it.
     *
     * This used to be `p.vy + up * kick`, added unconditionally. Because a jump leaves the floor at
     * -330 and every shot pushed further the same way, holding ACTION after a jump stacked recoil on
     * top of the launch and peaked at 497px instead of 59px -- a machine gun magazine was worth
     * eight jumps. That made the gunboots a jetpack, and made vertical position something the player
     * could buy with CHARGE rather than something the descent took away.
     *
     * Weapon-by-weapon recoil differences survive this intact: `kick` still comes from the module,
     * so LASER at 420 takes four fifths off a terminal fall where NOPPY at 95 barely leans on it.
     * Nothing in the roster stops a 520 fall in one shot -- the surplus is only ever discarded, and
     * what no module can do any more is climb.
     */
    /**
     * Recoil stops at a standstill, in the arena as in the shaft.
     *
     * GUNBOOTS = BRAKE, NOT THRUSTER, and the reversed pull does not change the rule -- it only
     * changes what it means: down the shaft it kills a fall, up the arena it weakens the climb.
     * A boss-only negative floor once let the player fly the gunboots downward at will, which
     * replaced everything AREA 1-4 taught about them with a different control scheme for one fight.
     */
    const floor = 0;
    /**
     * GUNBOOTS PROJECTILE MODEL -- HUMAN APPROVED / LOCKED.
     *
     *   projectile world velocity = PRE-SHOT player velocity + muzzle-relative velocity
     *
     * The contract, in full: the inherited velocity is read BEFORE the gunboots brake; range is
     * spent on muzzle-relative travel rather than world travel (see `carried` on Bullet); every
     * module's muzzle speed, spread, damage, range and CHARGE cost is identity and does not move;
     * and the same rule holds with the pull reversed in the arena. HOT CASING is outside it -- a
     * casing is debris thrown sideways, not a round fired along the pull.
     *
     * WHAT BREAKS IF THIS GOES BACK TO A FIXED WORLD VELOCITY: the player overtakes their own
     * downward shot. Measured at terminal speed before this was fixed, five of the seven modules
     * were overtaken by the player who fired them -- machine at 0.38s, burst 0.90s, shotgun 0.23s,
     * triple 0.17s, and PUNCHER at 0.07s, its 520px/s muzzle being slower than the 930px/s fall it
     * leaves, so its rounds started behind the player and stayed there. Raising projectileSpeed
     * instead does not fix it: it re-breaks the moment maxFallSpeed changes, and it moves weapon
     * identity and enemy combat timing to pay for something that is not a speed problem.
     *
     * WHAT THE ROUND IS THROWN FROM.
     *
     * A projectile's speed is the weapon's, measured FROM THE GUN -- so it has to be added to
     * whatever the gun is already doing, not used as a world velocity on its own. Taken as a world
     * velocity it meant a falling player closed on their own shot, and once OPEN DROP made long
     * falls real they caught it: measured at terminal speed, five of the seven modules were
     * overtaken by the player who fired them, PUNCHER (muzzle 520) within 0.07s of leaving the
     * barrel because the player was already falling faster than it flies.
     *
     * Read BEFORE the brake below. The recoil is the reaction to the shot, so it cannot have
     * happened yet when the round leaves: the round inherits the descent that was actually under
     * way, and the brake then answers it.
     */
    const inherited = p.vy;
    const descent = this.along(p.vy);
    const braked = descent <= floor ? descent : Math.max(descent - kick, floor);
    p.vy = Math.max(-this.physics.maxFallSpeed, Math.min(this.physics.maxFallSpeed, braked * this.gravity));
    this.lastAirShot = this.elapsed;
    // The muzzle is at the boots, which is the gravity-facing end of the player, and the volley
    // leaves it along the pull. Only the y half turns over: `vx` is untouched, so NOPPY's tilt,
    // PUNCHER's parallel lanes, TRIPLE's fan and SHOTGUN's spread are the same shapes mirrored.
    const muzzle = p.y + 21 * this.gravity;
    for (const shot of volley(def, this.stats, aim, this.shotBoost)) {
      const x = p.x + shot.offsetX;
      this.bullets.push({
        source: 'player',
        x, y: muzzle, previousY: muzzle, previousX: x,
        // The weapon's own speed, along the pull, ON TOP of the fall it was fired out of. Only the
        // vertical half inherits: the shaft moves the player horizontally by position rather than
        // by velocity, so there is no sideways world velocity to carry, and the fire direction is
        // vertical anyway. `vx` therefore stays the module's own fan, unchanged.
        vx: shot.vx, vy: inherited + shot.vy * this.gravity, carried: inherited,
        damage: shot.damage, size: shot.size, pierce: shot.pierce,
        pierceBlocks: shot.blockPiercing, blocks: new Set(),
        range: shot.range, travelled: 0, beam: shot.beam, hits: new Set(), alive: true,
      });
    }
    // Both of these ride the FIRE EVENT, not the volley. A SHOTGUN pellet is not a trigger pull, so
    // a spread weapon puts out one casing and one drone round exactly as a single-shot weapon does.
    if (this.upgrades.has('hotCasing')) this.ejectCasing();
    if (this.upgrades.has('drone')) this.droneFire();
    this.emit('shot', p.x, p.y + 20);
  }
  /**
   * HOT CASING. A spent case thrown out to one side, worth about half a machine gun round -- so an
   * HP 1 enemy takes two of them. It costs no CHARGE and is not the player's own fire, which is why
   * it carries its own source and never takes the COIN HIGH boost.
   */
  private ejectCasing() {
    // Outside the LOCKED projectile model on purpose: a casing is debris thrown out sideways, not a
    // round fired along the pull, so it inherits nothing and the overtaking rule does not apply.

    const p = this.player, tuning = UPGRADE_TUNING.hotCasing;
    const side = this.random() < 0.5 ? -1 : 1;
    this.bullets.push({
      source: 'casing',
      x: p.x, y: p.y, previousX: p.x, previousY: p.y,
      vx: side * tuning.spread, vy: this.up * tuning.speed * 0.2,
      damage: gunModule('machine').projectileDamage * tuning.damageShare,
      size: tuning.size, pierce: 0, pierceBlocks: false, blocks: new Set(),
      range: tuning.range, travelled: 0, beam: false, hits: new Set(), alive: true,
    });
  }
  /**
   * DRONE. The companion fires with the player, always a machine gun round whatever the player is
   * carrying, and never spends CHARGE. Its kills are ordinary kills, so a chain counts them.
   */
  private droneFire() {
    const def = gunModule('machine');
    const from = this.dronePosition;
    this.bullets.push({
      source: 'drone',
      x: from.x, y: from.y, previousX: from.x, previousY: from.y,
      // Thrown from a companion that travels with the player, so it inherits the same descent the
      // player's own rounds do -- otherwise a fast fall outruns the drone's fire as well. Same
      // LOCKED model as the player's volley; see `fireVolley`.
      vx: 0, vy: this.player.vy - this.up * def.projectileSpeed, carried: this.player.vy,
      // Machine baseline on purpose: the companion is not the player's gun and does not inherit a
      // COIN HIGH, a LASER SIGHT, or the module the player happens to be holding.
      damage: def.projectileDamage, size: def.projectileSize,
      pierce: def.piercing, pierceBlocks: false, blocks: new Set(),
      range: def.range, travelled: 0, beam: false, hits: new Set(), alive: true,
    });
  }
  /** Where the companion rides. It has no body and is never a target. */
  get dronePosition() {
    const p = this.player, tuning = UPGRADE_TUNING.drone;
    return { x: p.x + tuning.offsetX, y: p.y + tuning.offsetY };
  }
  /**
   * The ground half of ACTION. A jump leaves the floor at a fixed impulse -- see JUMP in
   * data/balance, which is a placeholder until the original is measured -- and deliberately peaks
   * well short of one row, so it repositions the player and starts a fall without ever undoing
   * descent already made.
   */
  jump() {
    const p = this.player;
    if (!this.running || p.grounded === -1) return false;
    // ROCKET JUMP belongs to THIS jump and no other. A stomp, a doodad bounce and a wall kick all
    // leave the ground too, and none of them is a jump off a floor -- so none of them fires it.
    const rocket = this.upgrades.has('rocketJump');
    const boost = rocket ? UPGRADE_TUNING.rocketJump.impulseMultiplier : 1;
    p.vy = this.up * JUMP.impulse * boost;
    p.grounded = -1;
    this.lastAirShot = -Infinity;
    this.emit('jump', p.x, p.y);
    if (rocket) {
      const tuning = UPGRADE_TUNING.rocketJump;
      // Under the feet that just left the floor, which is down whichever way down currently is.
      this.spawnExplosion({ x: p.x, y: p.y - this.up * tuning.blastOffsetY, radius: tuning.blastRadius, damage: tuning.blastDamage });
    }
    return true;
  }
  /**
   * The wall half of ACTION. It costs no CHARGE, fires nothing, and leaves the chain alone -- it is
   * movement, not an attack. The shove away from the wall is a decaying horizontal push rather than
   * a velocity the player fights against, so steering back in still works once it has faded.
   */
  wallJump(side: -1 | 0 | 1 = this.wallJumpSide(0)) {
    if (!this.running || side === 0 || this.player.grounded !== -1) return false;
    const p = this.player;
    p.vy = this.up * WALL_JUMP.impulse;
    this.wallKick = -side * WALL_JUMP.kick;
    this.wallJumpUsed = side;
    this.lastAirShot = -Infinity;
    this.emit('wallJump', p.x, p.y);
    return true;
  }
  /** Swap the equipped weapon and hand out the crate's bonus through the ordinary systems. */
  equipGunModule(id: GunModuleId, bonus: 'heart' | 'charge') {
    this.gun.equip(id);
    this.applyModuleBonus(bonus);
  }
  /**
   * The bonus half of a gun module, on its own. HEART goes through HealthSystem so a full tank
   * still rolls into the existing overflow and LIFE UP; CHARGE is the same +2 magazine as ever.
   */
  private applyModuleBonus(bonus: 'heart' | 'charge') {
    if (bonus === 'heart') this.health.heal(1);
    else this.growMaxCharge(CHARGE_AMMO_BONUS);
  }
  step(dt: number, direction: number, firing: boolean) {
    if (!this.running) return;
    if (this.bossLine) {
      this.bossLine.timer -= dt;
      if (this.bossLine.timer <= 0) this.bossLine = null;
    }
    // GRAVITY REVERSED is the one beat the fight is allowed to hold. Nothing simulates through it:
    // no falling, no firing, no attacks -- the world is being turned over underneath the player.
    if (this.abyssStage === 'inverting') { this.tickInversion(dt); return; }
    // The fight can end part-way through this step, so remember what we entered it as.
    const fighting = this.state === 'boss';
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.player;
    this.health.tick(dt);
    this.wallTouchAge += dt;
    const oldY = p.y;
    this.moveHorizontal(dt, direction);
    // Decided after the move, so stepping into a chamber takes effect on the very frame it happens.
    const frozen = this.timeFrozen;
    // Compared against what was last announced rather than against this step's own starting value:
    // the vertical half of the move lands at the END of a step, so reading the flag twice around
    // moveHorizontal only ever catches a player crossing the mouth sideways and silently misses one
    // dropping in through the top.
    if (frozen !== this.timeVoidOn) {
      this.timeVoidOn = frozen;
      this.events.push({ type: 'timeVoid', x: p.x, y: p.y, value: frozen ? 1 : 0 });
    }
    if (!frozen) this.worldElapsed += dt;
    // Counted on ORDINARY play only. What it decides is what a run that never once took shelter is
    // offered at the bottom, so a chamber met inside the ABYSS itself must not pay for it.
    const sheltering = this.safeZone !== null;
    if (sheltering && !this.insideZone && this.abyssStage === 'none') this.safeZoneVisitCount++;
    this.insideZone = sheltering;
    // The meter drains on WORLD time. Standing in a chamber stops the shaft, so it stops the drain
    // too -- but collecting in there still credits it, because picking a coin up is the player's
    // own action and those never stop. Decay frozen, pickup live.
    if (!frozen && this.coinHigh.tick(dt)) this.events.push({ type: 'coinHigh', x: p.x, y: p.y, value: 0 });
    // LIMBO's barbs are excluded everywhere ground is resolved. They are not a floor, so there is
    // no state in which the player is standing on one and no path by which one reloads anything.
    const ground = this.platforms.find(f => f.id === p.grounded && !f.limboHazard);
    if (ground && p.x + 9 > ground.x && p.x - 9 < ground.x + ground.width) p.vy = 0;
    else {
      p.grounded = -1;
      // A live HEART BALLOON slows the descent. It multiplies the terminal speed rather than the
      // gravity, so the fall is gentler without the controls feeling different.
      const lift = this.balloon?.alive ? UPGRADE_TUNING.heartBalloon.fallMultiplier : 1;
      // Accumulated along the pull and written back with its sign, so HEART BALLOON still softens
      // "falling" in the ABYSS even though falling there means climbing the screen.
      const fall = Math.min(this.physics.maxFallSpeed * lift, this.along(p.vy) + this.physics.gravity * (this.water?.gravity ?? 1) * dt);
      p.vy = fall * this.gravity;
    }
    // Nothing special is needed to keep a gate row openable. A row is several blocks edge to edge,
    // so stepping off one onto its neighbour is an ordinary landing and reloads in full, exactly as
    // stepping between ledges does everywhere else. A player who runs dry against a block walks one
    // block over and comes back with a full magazine; the block keeps the hits it has already taken.
    //
    // ONE ACTION, read by where the player is standing: on the ground it jumps, in the air it fires
    // the gunboots. Every input route -- keyboard, the FIRE button, a tap anywhere on the frame --
    // arrives here as `firing`, so there is no second path that could shoot from the ground.
    const pressed = firing && !this.actionHeld;
    this.actionHeld = firing;
    // NIMUSHI's dialogue is skippable, and ACTION is what skips it: a line must never be something
    // the player has to wait out with their thumb on the button.
    if (pressed && this.bossLine) this.bossLine = null;
    const wall = this.wallJumpSide(direction);
    if (p.grounded !== -1) {
      // Standing: the gunboots are not in use. The gun is still ticked with the trigger released so
      // its timers keep running and the next press in the air reads as a fresh one; any request it
      // returns is dropped, which is what makes "grounded ACTION never shoots" true without
      // exception -- including for the tail of a burst that was paid for before landing.
      this.gun.update(dt, false, this.ammo);
      if (pressed) this.jump();
    } else if (wall !== 0) {
      // Pressed against a wall and steering away from it: ACTION kicks off the wall and fires
      // nothing. Unlike standing, the gunboots are still live here -- they are simply not being
      // pressed -- so a BURST already paid for keeps unspooling rather than being swallowed.
      if (pressed) this.wallJump(wall);
      if (this.gun.bursting) this.fireGun(dt, direction, false);
      else this.gun.update(dt, false, this.ammo);
    } else {
      this.fireGun(dt, direction, firing);
    }
    p.y += p.vy * dt;
    // `frozen` is sampled before the vertical move, which is exactly the question the roof asks:
    // someone already in the chamber is held under it, someone still falling toward it is not.
    this.holdInsideSafeZone(frozen);
    // Where each enemy that MOVED this step stood before it moved, for the stomp test below. Only
    // movers are recorded: an enemy whose y did not change is not in here, and the stomp test then
    // reads the same single crown it always has -- the same numbers, the same comparisons.
    const yBeforeMove = new Map<Enemy, number>();
    if (!frozen) for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.hurtFlash = Math.max(0, (e.hurtFlash || 0) - dt);
      // Position is a function of world time, never an accumulation of steps: `enemyPosition` is the
      // shared sway for every enemy without a `motion`, and the water enemies' own movement for the
      // four that have one. An enemy fixture built without `originY` adopts where it stands.
      e.originY ??= e.y;
      const at = enemyPosition(e, this.worldElapsed);
      if (at.y !== e.y) yBeforeMove.set(e, e.y);
      e.x = at.x; e.y = at.y;
    }
    // Swept bullet collisions prevent fast projectiles tunneling through enemies.
    //
    // TIMEVOID stops the world OUTSIDE the chamber, and a round is part of whichever side of the
    // mouth it is on. So this is decided per round rather than for the whole list: one already in
    // flight out in the shaft hangs exactly where it was, while one fired inside keeps flying and
    // keeps colliding, because time has never stopped in there. A round that leaves the chamber
    // crosses into stopped time and holds there until the player steps back out.
    const stoppedWorld = frozen ? this.frozenRegion : null;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      if (stoppedWorld && !stoppedWorld.contains(b.x, b.y)) continue;
      b.previousY = b.y; b.previousX = b.x;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // Reach is a weapon trait: PUNCHER dies quickly, LASER runs the length of the shaft.
      // Flown FROM THE GUN, not through the world: see `carried`, and the LOCKED projectile model
      // in `fireVolley`. `b.vy` on its own here is the bug this replaced.

      b.travelled += Math.hypot(b.vx, b.vy - (b.carried ?? 0)) * dt;
      if (b.travelled > b.range) { b.alive = false; continue; }
      // Angled rounds stop at the shaft walls rather than leaving the world.
      // The shaft's brickwork stops a round -- unless it is flying inside a SIDE CAVE, which is
      // hollowed out of that brickwork and has its own walls further out.
      if (b.x < WORLD.wall || b.x > WORLD.width - WORLD.wall) {
        if (!this.caves.some(c => insideCave(c, b.x, b.y))) { b.alive = false; continue; }
      }
      // A COIN VEIN is mined by shooting it. Checked before the shaft's own obstacles because a
      // vein only ever stands inside a chamber, where none of them are.
      const vein = this.veinAt(b.x, b.y);
      if (vein) { this.mineCoinVein(vein); b.alive = false; continue; }
      // REVERSE ENGINEERING. A round into a waiting GUN MODULE draws its contents again -- weapon
      // AND bonus, so a HEART can become a CHARGE. Once per crate: the flag is on the crate, not on
      // the upgrade, so a second shot finds it already turned. The crate is never destroyed.
      if (this.upgrades.has('reverseEngineering')) {
        const crate = this.pickups.find(item => !item.taken && item.kind === 'gunModule'
          && Math.abs(b.x - item.x) < 20 && Math.abs(b.y - item.y) < 22);
        if (crate) {
          if (!crate.rerolled) {
            crate.rerolled = true;
            const roll = rollGunModule(this.random);
            crate.module = roll.module; crate.bonus = roll.bonus;
            this.events.push({ type: 'gunModule', x: crate.x, y: crate.y, stage: gunModule(roll.module).name, bonus: roll.bonus, value: 0 });
          }
          b.alive = false;
          continue;
        }
      }
      // REST IN PIECES. A body the player shoots goes off; one they already ate cannot, because it
      // was claimed the moment it was eaten. Any round will do it -- a casing, a popping coin, the
      // drone's -- which is deliberate: the upgrade is about the corpse, not about the gun.
      if (this.upgrades.has('restInPieces')) {
        const corpse = this.corpses.find(c => !c.claimed
          && Math.abs(b.x - c.x) < CORPSE_RULES.width && Math.abs(b.y - c.y) < CORPSE_RULES.height + 8);
        if (corpse) {
          corpse.claimed = true;
          const tuning = UPGRADE_TUNING.restInPieces;
          this.spawnExplosion({ x: corpse.x, y: corpse.y, radius: tuning.blastRadius, damage: tuning.blastDamage });
          b.alive = false;
          continue;
        }
      }
      if (this.boss.active) {
        /**
         * SHOOTING A PEARL OUT OF THE AIR -- the emergency exit, not the answer.
         *
         * The corridor is still guaranteed, still three lanes wide, and still walks one lane per
         * wave: a player who reads the pattern dodges it and keeps their CHARGE. This is for the
         * player who did not read it in time, and it costs them the magazine they were going to
         * counterattack with.
         *
         * ONE ROUND, ONE PEARL, whatever the weapon. The round dies here even if it had piercing
         * left, because a LASER that wipes a whole row would not be a safety valve -- it would be
         * the answer, and the pattern would stop mattering. That rule lives here, in the arena, and
         * the run's own piercing is untouched.
         */
        const pearl = this.boss.tapiocas.find(t => t.life > 0
          && Math.abs(b.x - t.x) < t.size + b.size
          && sweeps(b.previousY, b.y, t.y - t.size, t.y + t.size));
        if (pearl) {
          pearl.life = 0;
          this.events.push({ type: 'kill', x: pearl.x, y: pearl.y, value: 0, stomp: false });
          b.alive = false;
          continue;
        }
        // A cup is the one thing in the fight that is NOT the weak-point rule: it is an object in
        // the world with HP, and shooting it down is the answer to being caught between the two.
        const cup = this.boss.cups.find(c => c.alive
          && Math.abs(b.x - c.x) < TAPIOCA_CUP.width / 2 + b.size
          && sweeps(b.previousY, b.y, c.y - TAPIOCA_CUP.height / 2, c.y + TAPIOCA_CUP.height / 2));
        if (cup) {
          if (this.boss.hitCup(cup, b.damage)) this.events.push({ type: 'kill', x: cup.x, y: cup.y, value: 0, stomp: false });
          b.alive = false;
          continue;
        }
        // The body is armour and the eye is the fight. EVERY player-side source -- the gunboots,
        // the drone, a hot casing, a popping gem, a gunpowder round -- arrives here and is asked
        // the same question, so there is no source that gets a different answer. A round that
        // meets a shut eye is a round that met an eyelid: absorbed, worth nothing.
        // Never the same round twice, however many frames it spends inside NIMUSHI. This is what
        // keeps a piercing LASER to ONE hit on the weak point rather than grinding it down while
        // it passes through -- the same rule an ordinary enemy gets, through the same set.
        const part = b.hits.has(NIMUSHI_TARGET) ? null : this.boss.hitTest(b);
        if (part) {
          const landed = part === 'eye' ? this.boss.hitEye(b.damage) : [];
          if (landed.length) {
            for (const signal of landed) this.onBossSignal(signal);
            this.events.push({ type: 'bossHit', x: b.x, y: this.boss.eye.y, value: this.boss.ratio });
            // Counted against the round's own piercing exactly as an enemy is, so a LASER behaves
            // like a LASER here too rather than getting a boss-specific rule.
            b.hits.add(NIMUSHI_TARGET);
            if (b.hits.size > b.pierce) b.alive = false;
          } else {
            // Armour, or an eyelid. The round is stopped and nothing is credited.
            b.hits.add(NIMUSHI_TARGET);
            this.events.push({ type: 'bossHit', x: b.x, y: b.y, value: -1 });
            b.alive = false;
          }
          if (!b.alive) continue;
        }
      }
      // A block is a wall: it stops the round and takes one hit off its own durability. Checked
      // before anything else in the shaft, so nothing is shot through a block still standing. Which
      // block a round meets is decided by its width, so a wide or angled weapon covers more of the
      // row per volley and a narrow one picks a single slot.
      for (const block of this.platforms) {
        if (!block.breakBlock || block.state === 'broken') continue;
        if (b.x + b.size < block.x || b.x - b.size > block.x + block.width) continue;
        if (!sweeps(b.previousY, b.y, block.y, block.y + BREAK_BLOCK_RULES.thickness)) continue;
        // Never the same block twice, however many frames a round spends inside one. This is what
        // lets a LASER cross a row without grinding a single block down on its own.
        if (b.blocks.has(block.id)) continue;
        b.blocks.add(block.id);
        this.hitBreakBlock(block);
        if (!b.pierceBlocks) { b.alive = false; break; }
      }
      if (!b.alive) continue;
      for (const box of this.containers) {
        if (box.broken) continue;
        if (b.x > box.x - b.size && b.x < box.x + box.width + b.size && sweeps(b.previousY, b.y, box.y, box.y + box.height)) {
          this.breakContainer(box); b.alive = false; break;
        }
      }
      if (!b.alive) continue;
      // `shootable: false` is a real answer, not a miss: the round passes over such an enemy and
      // carries on to whatever is behind it. Landing on one is then the only way through.
      const targets = this.enemies.filter(e => e.alive && e.shootable !== false && !b.hits.has(e.id) && Math.abs(b.x - e.x) < 15 + b.size && sweeps(b.previousY, b.y, e.y - 15, e.y + 15)).sort((a, z) => this.along(a.y - z.y));
      for (const e of targets) {
        b.hits.add(e.id); e.hp -= b.damage; e.flash = 0.1;
        if (e.hp <= 0) this.kill(e, false);
        if (b.hits.size > b.pierce) { b.alive = false; break; }
      }
    }
    // Contact with the shaft's inhabitants is part of the shaft: inside a chamber they cannot
    // reach the player, which is what makes it safe.
    if (!frozen) for (const e of this.enemies) {
      if (!e.alive || Math.abs(p.x - e.x) > 24) continue;
      // The face gravity brings the player down onto: an enemy's head in the shaft, its underside
      // in the ABYSS. The same crossing, the same stomp, mirrored -- nothing here knows which.
      const crown = e.y - 10 * this.gravity;
      /**
       * A STOMP IS THE FEET MEETING THE HEAD, WHICHEVER OF THE TWO WAS MOVING.
       *
       * The test used to ask whether the feet crossed the crown's CURRENT position during the step.
       * That is the whole question while an enemy holds its height. It is not once one bobs: the
       * enemy has already moved by the time this runs, so a head rising into feet that were above
       * it a moment ago could pass them from below and never be "crossed" -- and a player who came
       * down squarely on a fish took contact damage instead. Measured, 2 in 400 runs.
       *
       * So the question is asked of the RELATIVE motion across the step: at its start the feet were
       * level with or above where the head WAS, and at its end they are level with or past where the
       * head IS. Both halves matter:
       *
       *   - "above where the head WAS" is what keeps a side contact a side contact. Feet already
       *     below the head before the step can never qualify, however the two moved, so brushing
       *     the flank of a rising fish still costs a heart.
       *   - "past where the head IS" is the crossing itself, with the head's own movement included.
       *
       * An enemy that did not move this step has one crown, and this is then exactly the old test --
       * `crossedWithGravity` against that crown, number for number. That is every enemy outside
       * SUNKEN RUINS, every urchin, and a water enemy on any step its height happens not to change.
       * The side-contact band below is untouched, as are the bounce, the kill and the damage.
       */
      const before = yBeforeMove.get(e);
      const topCrossing = this.along(p.vy) > 0 && (before === undefined
        ? this.crossedWithGravity(oldY + this.lead, p.y + this.lead, crown)
        : this.along(p.y + this.lead - crown) >= 0 && this.along(oldY + this.lead - (before - 10 * this.gravity)) <= 0);

      if (topCrossing && e.stompable) {
        this.kill(e, true); p.y = e.y - 28 * this.gravity; p.vy = this.up * this.stats.bounce; p.grounded = -1;
        // BLAST MODULE rides a STOMP and nothing else: not a doodad bounce, not a chamber floor.
        // The stomped enemy is excluded because it is already dead -- killing it twice would count
        // its COMBO twice and drop its COIN twice.
        if (this.upgrades.has('blastModule')) {
          const tuning = UPGRADE_TUNING.blastModule;
          this.spawnExplosion({ x: p.x, y: p.y - this.up * tuning.offsetY, radius: tuning.radius, damage: tuning.damage, exclude: e });
        }
      } else if ((topCrossing || Math.abs(p.y - e.y) < 25) && p.invincible <= 0) this.hurt(e);
    }
    if (this.along(p.vy) >= 0 && p.grounded === -1) {
      // The first slab met ALONG the pull, which is the shallowest one in the shaft and the
      // highest one in the ABYSS. `surfaceOf` picks the face the player actually arrives on.
      const land = this.platforms.filter(f => !f.limboHazard && f.state !== 'broken' && p.x + 9 > f.x && p.x - 9 < f.x + f.width
        && this.crossedWithGravity(oldY + this.lead, p.y + this.lead, this.surfaceOf(f))).sort((a, b) => this.along(a.y - b.y))[0];
      if (land) {
        const face = this.surfaceOf(land);
        p.y = face - this.lead; p.vy = 0; p.grounded = land.id; this.lastAirShot = -Infinity;
        this.emit('land', p.x, face);
        this.settleLanding(land);
        // A collapsing ledge still reloads in full; it just starts counting from this moment.
        if (this.collapse.land(land)) this.events.push({ type: 'crack', x: p.x, y: land.y, value: this.collapse.delay });
      }
    }
    for (const gone of frozen ? [] : this.collapse.tick(dt, this.platforms)) {
      this.events.push({ type: 'collapse', x: gone.x + gone.width / 2, y: gone.y, value: gone.width });
      if (p.grounded === gone.id) p.grounded = -1;
    }
    if (this.platforms.some(f => f.state === 'broken')) this.platforms = this.platforms.filter(f => f.state !== 'broken');
    if (this.boss.enabled && !frozen) this.tickNimushi(dt);
    if (!frozen) {
      this.tickContainers(dt);
      this.tickBubbles(dt);
    }
    // Money runs on the same rule as rounds: a coin out in the shaft hangs in stopped time, while
    // one inside the chamber falls, ages and can be swept up. That is what makes a mined COIN VEIN
    // something the player collects rather than a pile frozen in mid-air -- and it is why a coin
    // taken in a chamber still feeds the COIN HIGH meter even though the meter's decay is stopped.
    const held = stoppedWorld ? (coin: { x: number; y: number }) => !stoppedWorld.contains(coin.x, coin.y) : undefined;
    // What a coin bounces off. A SIDE CAVE is hollowed out BEYOND the shaft's brickwork, so a coin
    // spilled from a vein inside one lives at an x the shaft would reject -- and the shaft clamp
    // used to snap the whole payout onto the main shaft's wall, out of the cave the player mined it
    // in. The coin's OWN world position decides which walls apply, for either wall of the shaft and
    // for a chamber or a cave alike; there is no per-archetype case here and no offset anywhere.
    const walls = this.caves.length ? (coin: { x: number; y: number }) => {
      const cave = this.caves.find(c => insideCave(c, coin.x, coin.y));
      return cave ? { left: cave.bounds.x, right: cave.bounds.x + cave.bounds.width } : COIN_SHAFT_WALLS;
    } : undefined;
    const picked = this.coins.tick(dt, p, this.cameraY, held, walls);
    if (picked.collected > 0) {
      this.earnCoins(picked.earned, p.x, p.y);
      this.events.push({ type: 'coin', x: p.x, y: p.y, value: this.coins.walletCoins });
      // The order a physical coin is processed in, once, in one place: the money lands, then the
      // meter, then the upgrades that ride a pickup. A settled COMBO is awarded rather than picked
      // up and deliberately reaches none of these -- there is no gem to power anything with.
      for (const coin of picked.taken) this.onCoinPickup(coin);
    }
    // Picking things up and touching a chamber's own content are the player's doing, not the
    // world's, so they keep working inside: the gun module waiting in a chamber has to be takeable.
    this.collectPickups();

    this.tickDoodads(oldY);
    if (this.heat.enabled && !frozen) this.tickHeat(dt);
    // A contact check rather than a timer, and no chamber is cut where anything lethal stands, so
    // this stays live: nothing about stopped time should make walking into lava survivable.
    this.tickLethalTerrain();
    if (!frozen) this.tickSpikePlatforms(dt);
    if (!frozen) this.tickLimboHazards();
    if (!frozen) this.tickCorpses(dt);
    this.tickBalloon(dt, frozen);
    // WORLD TIME AND BREATH TIME ARE TWO DIFFERENT CLOCKS.
    //
    // `frozen` above is TIMEVOID -- a SAFE ZONE chamber or a TIMEOUT bubble -- and it stops the
    // WORLD: enemies, hazards, collapsing ledges, containers, released bubbles. It is not a pause,
    // and it never was meant to reach the player's own lungs. It did, because one boolean was
    // answering both questions, and the result was that standing in a chamber at 0 air was safe
    // forever: 30s inside cost 0.000s of tank and 0 HP. A chamber is shelter from the shaft; it is
    // not, and must not be, shelter from drowning.
    //
    // What DOES stop the tank is the run not being in play: ESC, the mobile PAUSE button, a hidden
    // tab, a backgrounded window, the REST screen, any non-playing state, and every AREA that is
    // not submerged. The first six are all `running`, which makes `step` return long before this
    // line, and the last is `oxygen.enabled`. So there is deliberately no gate written here -- the
    // absence of one is the statement that TIMEVOID is not a pause.
    //
    // Invulnerability delays a drowning hit but can never cancel it: the debt is only cleared once
    // HealthSystem actually accepts the damage.
    if (this.oxygen.tick(dt) && this.damage(1, 'oxygen')) this.oxygen.consumeDamage();
    if (this.practice) {
      if (p.y > 840) { p.x = 225; p.y = 120; p.vy = 0; p.grounded = -1; this.ammo = this.stats.maxAmmo; this.lastAirShot = -Infinity; }
    } else {
      // The FINAL BOSS descends too, but it is won on the king's HP, not on metres. Banking that
      // descent would push TOTAL DEPTH past the planned 12 x 200m, and there is no section left to
      // complete, so depth accounting stops for the duration of the fight.
      if (!fighting && !frozen) {
        this.sectionDepth = Math.max(this.sectionDepth, (p.y - WORLD.startY) / WORLD.pixelsPerMeter);
        // Reaching the goal opens the way out; it never ends the SECTION by itself, so a fight,
        // a coin spray or a chase after a bubble is never cut short mid-action.
        if (!this.exit && this.stage.enabled && this.sectionDepth >= this.stage.sectionLength) this.openExit();
        this.enterExit();
      }
      // The doorway is reachable inside a chamber too, so this is the player's business rather than
      // the world's and runs either way.
      // The doorway is the player's business rather than the world's, so it runs inside stopped
      // time -- and inside the ABYSS staging room, which is the one place a 'boss' state shops.
      if (!fighting || this.abyssStage === 'staging') this.enterShop();
      // The horizontal camera runs INSIDE stopped time too: the player is still walking around in
      // there, and a view that froze with them would leave the far end of the cave off screen.
      this.trackCaveCamera(dt);
      if (!frozen) {
        this.cameraY = this.leadCamera(p.y);
        this.generate();
        this.generateAbyss();
        if (this.abyssStage === 'staging') this.tickSeal();
        if (this.abyssStage === 'fight') this.bossAscent = Math.max(this.bossAscent, (this.sealY - p.y) / ABYSS.pixelsPerMeter);
        // Left behind by the view, whichever way the view is travelling. Deliberately NOT the same
        // thing as the ABYSS boundary catching up: that is its own death with its own cause.
        if (this.aheadOfCamera(p.y, 50)) this.killInstantly('fall');
      }
    }
    // Spent rounds are dropped even in stopped time: a player bouncing on a doodad and firing would
    // otherwise grow the list for as long as they stay in there. Culling live rounds by camera band
    // is the world's job, so that half waits until time runs again.
    this.bullets = this.bullets.filter(b => b.alive && (frozen || !this.aheadOfCamera(b.y, 150)));
    if (frozen) return;
    this.platforms = this.platforms.filter(f => !this.behindCamera(f.y, 180));
    this.enemies = this.enemies.filter(e => e.alive && !this.behindCamera(e.y, 180));
    this.pickups = this.pickups.filter(item => !item.taken && !this.behindCamera(item.y, 180));
    this.hazards = this.hazards.filter(h => !this.behindCamera(this.trailingEdge(h.y, h.height), 180));
    this.doodads = this.doodads.filter(d => !this.behindCamera(this.trailingEdge(d.y, d.height), 180));
    this.safeZones = this.safeZones.filter(z => !this.behindCamera(this.trailingEdge(z.y, z.height), 240));
    // A cave is never culled while the player is inside it, however far the view has travelled.
    this.caves = this.caves.filter(c => c === this.cave || !this.behindCamera(this.trailingEdge(c.bounds.y, c.bounds.height), 240));
  }
  /**
   * AREA 3's heat pass. Only hazards near the player are considered -- the run's whole hazard list
   * is already pruned to the camera band, and this narrows it again to what can actually radiate.
   */
  private tickHeat(dt: number) {
    const p = this.player;
    for (const hazard of this.hazards) {
      if (hazard.kind !== 'vent') continue;
      const next = ventStateAt(hazard, this.worldElapsed);
      if (next !== hazard.state) {
        hazard.state = next;
        if (next !== 'idle') this.events.push({ type: 'vent', x: hazard.x + hazard.width / 2, y: hazard.y, value: next === 'warning' ? 0 : 1 });
      }
    }
    const nearby = this.hazards.filter(h => Math.abs(h.y + h.height / 2 - p.y) < 320);
    if (this.heat.tick(dt, p.x, p.y, nearby) && this.damage(1, 'heat')) this.heat.consumeDamage();
  }
  /**
   * Terrain that kills on touch, run through in every AREA. Lava belongs to AREA 3's heat gimmick,
   * but SPIKE belongs to AREA 1 and AREA 2, which run no gauge at all -- so this pass deliberately
   * sits outside tickHeat, where it used to live and where a spike in a cold shaft would simply
   * never have been looked at. The cause comes from the hazard table, so the result screen names
   * what actually ended the run rather than guessing lava.
   */
  /**
   * SPIKE PLATFORMS: ground that turns on the player.
   *
   * The whole point is that it is fair. Landing arms it and nothing else does, the warning always
   * runs before the spikes, and what they cost is ordinary damage through HealthSystem -- the same
   * hearts, the same invulnerability window, the same COMBO-preserving rules as any other hit.
   * There is no path here that ends a run outright.
   *
   * Nothing is ticked while the player is in a chamber: the cycle belongs to the shaft, so a warning
   * the player walked away from is exactly where they left it when they come back.
   */
  private tickSpikePlatforms(dt: number) {
    const p = this.player;
    for (const platform of this.platforms) {
      const spikes = platform.spikePlatform;
      if (!spikes) continue;
      // Landing is the only trigger. Reading `grounded` rather than a contact box means a player
      // falling past the edge of one never sets it off.
      if (spikes.state === 'safe' && p.grounded === platform.id) {
        spikes.state = 'warning';
        spikes.timer = SPIKE_PLATFORM_RULES.warning;
        this.events.push({ type: 'spikePlatform', x: platform.x + platform.width / 2, y: platform.y, value: 0 });
        continue;
      }
      if (spikes.state === 'safe') continue;
      spikes.timer -= dt;
      if (spikes.state === 'active') {
        // Standing in the teeth, or brushing them on the way past. The teeth stand out of the face
        // the player lands on, so in the ABYSS they point down the screen with everything else.
        const face = this.surfaceOf(platform);
        const tip = face - SPIKE_PLATFORM_RULES.reach * this.gravity, root = face + 6 * this.gravity;
        const lo = Math.min(tip, root), hi = Math.max(tip, root);
        if (p.x + 9 > platform.x && p.x - 9 < platform.x + platform.width && p.y + 15 > lo && p.y - 15 < hi) {
          this.damage(SPIKE_PLATFORM_RULES.damage, 'spike');
        }
      }
      if (spikes.timer > 0) continue;
      if (spikes.state === 'warning') {
        spikes.state = 'active';
        spikes.timer = SPIKE_PLATFORM_RULES.active;
        this.events.push({ type: 'spikePlatform', x: platform.x + platform.width / 2, y: platform.y, value: 1 });
      } else if (spikes.state === 'active') {
        spikes.state = 'cooldown';
        spikes.timer = SPIKE_PLATFORM_RULES.cooldown;
        this.events.push({ type: 'spikePlatform', x: platform.x + platform.width / 2, y: platform.y, value: 2 });
      } else {
        spikes.state = 'safe';
        spikes.timer = 0;
      }
    }
  }
  /**
   * LIMBO's dangerous ground. Touching it costs a heart and changes nothing else.
   *
   * This is deliberately its own pass rather than a branch inside the landing code, because it is
   * not a landing: `reloadCharge` and `settleCombo` are never reachable from here, CHARGE is left
   * exactly where it was, and the chain runs on through the hit the way it runs through any other
   * ordinary damage. Falling through one is the normal way past it.
   */
  private tickLimboHazards() {
    const p = this.player;
    if (p.invincible > 0) return;
    for (const row of this.platforms) {
      if (!row.limboHazard) continue;
      if (p.x + 9 < row.x || p.x - 9 > row.x + row.width) continue;
      const face = this.surfaceOf(row);
      const tip = face - LIMBO_HAZARD_RULES.reach * this.gravity, root = face + 12 * this.gravity;
      if (p.y + 15 < Math.min(tip, root) || p.y - 15 > Math.max(tip, root)) continue;
      if (this.damage(LIMBO_HAZARD_RULES.damage, 'spike')) {
        this.events.push({ type: 'spikePlatform', x: p.x, y: row.y, value: 1 });
      }
      return;
    }
  }
  /**
   * Bodies: they fall, they rot, and KNIFE AND FORK eats them.
   *
   * Eating is the player walking into one, so it happens on the player's own clock rather than the
   * world's -- but the falling and the rotting belong to the shaft, which is why the whole pass sits
   * behind the TIMEVOID gate with everything else the world does.
   */
  private tickCorpses(dt: number) {
    const p = this.player;
    const eats = this.upgrades.has('knifeAndFork');
    for (const corpse of this.corpses) {
      if (corpse.claimed) continue;
      corpse.life -= dt;
      const drop = Math.min(CORPSE_RULES.maxFallSpeed, this.along(corpse.vy) + CORPSE_RULES.gravity * dt);
      corpse.vy = drop * this.gravity;
      corpse.y += corpse.vy * dt;
      if (!eats) continue;
      if (Math.abs(p.x - corpse.x) > CORPSE_RULES.radius || Math.abs(p.y - corpse.y) > CORPSE_RULES.radius + 12) continue;
      // Claimed the moment it is eaten, so REST IN PIECES can never also blow up the same body.
      corpse.claimed = true;
      this.corpsesEaten++;
      this.events.push({ type: 'corpse', x: corpse.x, y: corpse.y, value: this.corpsesEaten % UPGRADE_TUNING.knifeAndFork.corpsesPerHeart });
      if (this.corpsesEaten % UPGRADE_TUNING.knifeAndFork.corpsesPerHeart === 0) {
        // Through HealthSystem, so a full tank banks it as overflow exactly like every other heal.
        this.heal(UPGRADE_TUNING.knifeAndFork.heal);
      }
    }
    this.corpses = this.corpses.filter(c => !c.claimed && c.life > 0 && !this.behindCamera(c.y, 120) && !this.aheadOfCamera(c.y, 200));
  }
  /**
   * HEART BALLOON. It rides above the player, softening the fall, until something walks into it.
   *
   * Following the player is the player's own doing, so it keeps up even inside stopped time; what
   * belongs to the shaft is whether an enemy reaches it, and that is gated with everything else the
   * world does. The blast is the shared one, so its kills count once and drop COIN once -- and the
   * player is not in it, which is the whole point of the balloon being above them.
   */
  private tickBalloon(dt: number, frozen: boolean) {
    if (!this.upgrades.has('heartBalloon')) { this.balloon = null; return; }
    const balloon = this.balloon;
    if (!balloon || !balloon.alive) return;
    const p = this.player, tuning = UPGRADE_TUNING.heartBalloon;
    // Above the player's head, which is the side gravity is NOT pulling them towards.
    const want = { x: p.x, y: p.y + tuning.offsetY * this.gravity };
    const ease = Math.min(1, tuning.follow * dt);
    balloon.x += (want.x - balloon.x) * ease;
    balloon.y += (want.y - balloon.y) * ease;
    if (frozen) return;
    const touched = this.enemies.find(e => e.alive && Math.hypot(e.x - balloon.x, e.y - balloon.y) < tuning.radius + 16);
    if (!touched) return;
    balloon.alive = false;
    this.events.push({ type: 'balloon', x: balloon.x, y: balloon.y, value: 0 });
    // Centred on the balloon, above the player's head: they are outside it and take nothing.
    this.spawnExplosion({ x: balloon.x, y: balloon.y, radius: tuning.blastRadius, damage: tuning.blastDamage });
  }
  private tickLethalTerrain() {
    const p = this.player;
    for (const hazard of this.hazards) {
      if (!hazard.lethal) continue;
      const box = hazardBounds(hazard);
      if (p.x + 9 > box.x && p.x - 9 < box.x + box.width && p.y + 15 > box.y && p.y - 15 < box.y + box.height) {
        this.killInstantly(hazardType(hazard.kind).damageCause);
        return;
      }
    }
  }
  /**
   * One round into one BREAK BLOCK. Opening a block is terrain work, not a kill: it adds nothing to
   * COMBO, counts as no defeated enemy, raises no kill event, and never calls gun.rearm() --
   * forgetting a shot in progress belongs to a SECTION boundary and to nothing else.
   *
   * It may leave money, and that goes out through CoinSystem exactly as a corpse's does, so the
   * coins behave identically on the way to the wallet: they scatter, they can be missed, and
   * catching one is what raises walletCoins and scoreCoins.
   */
  private hitBreakBlock(block: Platform) {
    const state = block.breakBlock;
    if (!state || block.state === 'broken') return;
    state.hits++;
    const centre = block.x + block.width / 2;
    if (state.hits < state.durability) {
      this.events.push({ type: 'blockCrack', x: centre, y: block.y, value: state.durability - state.hits });
      return;
    }
    block.state = 'broken';
    if (this.player.grounded === block.id) this.player.grounded = -1;
    // No roll: the block said what it was when the row appeared, and breaking it pays exactly that.
    // A REWARD BLOCK pays the same whether a round opened it or a chain reaction did.
    if (state.reward) this.coins.burst(centre, block.y, BREAK_BLOCK_RULES.rewardCoins, this.random, BREAK_BLOCK_RULES.rewardDenomination);
    this.events.push({ type: 'blockBreak', x: centre, y: block.y, value: block.width });
    if (this.upgrades.has('gunpowderBlocks')) this.gunpowderChain(block);
  }
  /**
   * NIMUSHI, inside the ordinary simulation step.
   *
   * The boss owns its own machine and its own entities; this is only the collision half. Every way
   * the fight can hurt the player goes through HealthSystem exactly as a slime or a spike does, so
   * invulnerability, COMBO and death accounting need no boss-specific rules -- and the ONE thing
   * that does not is being overtaken by the boundary, which is not damage but the end of the run.
   */
  private tickNimushi(dt: number) {
    const p = this.player;
    for (const signal of this.boss.update(dt, p, this.random, this.cameraY)) this.onBossSignal(signal);
    if (!this.boss.active) return;
    /**
     * Contact with the body -- which costs a heart and then hands back a stomp.
     *
     * Reachable on purpose: NIMUSHI hangs directly ahead along the pull, so a player who keeps
     * falling into it pays for it. What it is NOT any more is the end of the run by itself. Missing
     * one stomp used to mean arriving with no bounce and no CHARGE and nothing to do about either,
     * and the fight was over several seconds before the player died in it.
     *
     * So a contact buys back exactly what a missed stomp cost, at the price of a heart:
     *
     *   SUCCESSFUL STOMP        bounce + full CHARGE
     *   BODY CONTACT            one heart + bounce + full CHARGE
     *
     * Same `bounce`, same `reloadCharge`, same direction rule -- there is no boss-only physics
     * here, only the ordinary stomp reward reached through the expensive door. It is an IMPULSE and
     * never a teleport: the 210px/s throws the player about 25px clear over 0.47s, well inside the
     * second of invulnerability the hit already grants, so the window is real but running out.
     *
     * It fires only on a hit that actually landed, because `damage` refuses during invulnerability
     * -- so leaning on NIMUSHI cannot farm bounces or magazines -- and only on a hit that was
     * survived, because a killing blow is a killing blow.
     *
     * `contactBox` rather than `body`: the fringe the player arrives into is drawn but does not
     * bite, which is what leaves a short-range weapon room to fire and get out again.
     */
    const body = this.boss.contactBox;
    if (p.x + 9 > body.x && p.x - 9 < body.x + body.width && p.y + 15 > body.y && p.y - 15 < body.y + body.height) {
      if (this.damage(NIMUSHI.contactDamage, 'bossContact') && this.hp > 0) {
        p.vy = this.up * this.stats.bounce;
        p.grounded = -1;
        this.reloadCharge();
      }
    }
    for (const pearl of this.boss.tapiocas) {
      if (Math.abs(pearl.x - p.x) > pearl.size + 12 || Math.abs(pearl.y - p.y) > pearl.size + 17) continue;
      if (this.damage(pearl.damage, 'bossShot')) pearl.life = 0;
    }
    for (const cup of this.boss.cups) {
      if (!cup.alive) continue;
      if (Math.abs(cup.x - p.x) > TAPIOCA_CUP.width / 2 + 9 || Math.abs(cup.y - p.y) > TAPIOCA_CUP.height / 2 + 15) continue;
      this.damage(TAPIOCA_CUP.damage, 'bossContact');
    }
    for (const beam of this.boss.beams) {
      // The warning line cannot hurt. That is the whole contract of the attack: the player is shown
      // the column, at full length, before anything in it is dangerous.
      if (beam.state !== 'live') continue;
      if (Math.abs(beam.x - p.x) > beam.width / 2 + 9) continue;
      this.damage(STRAW_BEAM.damage, 'bossSweep');
    }
    // Overtaken. Not damage and not an out-of-bounds fall: a separate ending with its own cause.
    /**
     * The arena's lower edge: fall too far behind the view and the run ends.
     *
     * A fixed rule rather than a chasing boundary. Bouncing downward is how the player buys room
     * from NIMUSHI, and this is what stops that being free -- the fight is a height to manage
     * between a boss at the top and a drop at the bottom, which is the shape AREA 1-4 already uses
     * with the roles the other way up.
     */
    if (this.inBossArena && this.player.y - this.cameraY > WORLD.height + ARENA_FLOOR.margin) {
      this.killInstantly('crush');
    }
  }

  /** Everything the fight reports, turned into world changes and events in one place. */
  private onBossSignal(signal: NimushiSignal) {
    const p = this.player;
    if (signal.kind === 'started') {
      // BOSS TIME starts HERE and nowhere else: not at 4-3 CLEAR, not at the shop, not at the
      // reversal, and not when the arena opened. The first round into the eye is the start.
      this.events.push({ type: 'bossStart', x: p.x, y: p.y, stage: NIMUSHI.name });
    } else if (signal.kind === 'phase') {
      this.enterAbyssPhase(signal.phase);
      this.events.push({ type: 'bossPhase', x: p.x, y: p.y, value: signal.phase.id, stage: signal.phase.name });
    } else if (signal.kind === 'eye') {
      this.events.push({ type: 'bossEye', x: this.boss.x, y: this.boss.eye.y, value: signal.open ? 1 : 0 });
    } else if (signal.kind === 'prep') {
      this.events.push({ type: 'bossTelegraph', x: this.boss.x, y: this.boss.y, stage: signal.attack });
    } else if (signal.kind === 'attack') {
      this.events.push({ type: 'bossFire', x: this.boss.x, y: this.boss.y, stage: signal.attack });
    } else if (signal.kind === 'clones') {
      this.summonClones(signal.count, signal.y);

    } else if (signal.kind === 'rage') {
      this.events.push({ type: 'bossRage', x: this.boss.x, y: this.boss.y, value: this.boss.ratio });
    } else if (signal.kind === 'line') {
      this.bossLine = { text: signal.text, timer: NIMUSHI_LINES.hold };
      this.events.push({ type: 'bossLine', x: this.boss.x, y: this.boss.y, stage: signal.text });
    } else if (signal.kind === 'defeated') {
      this.events.push({ type: 'bossDown', x: this.boss.x, y: this.boss.y });
    } else if (signal.kind === 'cleared') {
      this.clearBoss();
    }
  }

  /**
   * にむし分身. They are spawned into the ORDINARY enemy list, which is the point: a clone dies to
   * the same round, pays the same COMBO, drops the same COIN and leaves the same body for KNIFE AND
   * FORK. Which kind is used is the stretch's business -- LIMBO's are declared unstompable on the
   * type, so nothing here has to remember that LIMBO has no footholds.
   */
  private summonClones(count: number, y: number) {
    const pool = this.boss.phase.clonePool;
    const span = WORLD.width - WORLD.wall * 2 - 60;
    for (let i = 0; i < count; i++) {
      const kind = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
      const x = WORLD.wall + 30 + span * ((i + 0.5) / count);
      const enemy = spawnEnemy(kind, this.nextAbyssId--, x, y + (this.random() - 0.5) * 90, 34, this.random() * Math.PI * 2, 'open');
      this.enemies.push(enemy);
    }
  }

  /**
   * A stretch of the ABYSS gives way to the next one, mid-ascent.
   *
   * Everything AHEAD of the view is cut and rebuilt from the recipe the new stretch names, so the
   * player is not left climbing twelve seconds of the previous environment while the new one's
   * gauge is already running. It is also where the fight sheds anything it no longer needs, which
   * is what keeps a long battle from accumulating entities it will never show again.
   */
  private enterAbyssPhase(phase: AbyssPhase) {
    this.oxygen.reset(phase.gimmicks?.oxygen === true);
    this.heat.reset(false);
    if (!this.oxygen.enabled) {
      this.containers = []; this.bubbles = [];
      this.pickups = this.pickups.filter(item => item.kind !== 'oxygenBubble');
    }
    this.hazards = [];
    const edge = this.gravity > 0 ? this.cameraY + WORLD.height : this.cameraY;
    const behind = (y: number) => this.along(y - edge) <= 0;
    this.platforms = this.platforms.filter(row => behind(row.y));
    this.enemies = this.enemies.filter(e => behind(e.y));
    this.pickups = this.pickups.filter(item => behind(item.y));
    this.doodads = this.doodads.filter(d => behind(d.y));
    this.containers = this.containers.filter(box => behind(box.y));
    this.abyssFrontier = edge;
    this.abyssSide = -1;
    this.layAbyssBatch(phase, true);
  }

  /**
   * A chamber has a roof. Nothing else in the shaft does -- there has never been a ceiling to hit --
   * but a room that the gunboots fire you out through the top of is not a room. LASER's recoil alone
   * clears the chamber height, so without this, shooting inside one launches the player back into
   * the shaft and out of the stopped time they just walked into.
   *
   * Only applies to a player who was ALREADY inside at the start of the step, so falling in through
   * the opening from above still works; the way out is the way in, sideways.
   */
  private holdInsideSafeZone(wasInside: boolean) {
    if (!wasInside) return;
    const p = this.player;
    const zone = this.safeZones.find(z => p.x > z.x && p.x < z.x + z.width);
    if (!zone) return;
    const roof = zone.y + 6;
    if (p.y >= roof) return;
    p.y = roof;
    if (p.vy < 0) p.vy = 0;
  }

  /**
   * DOODADS. Landing on one from above fills CHARGE and bounces, and that is all it does: it is
   * scenery, not an enemy, so nothing here touches COMBO, the kill count, COIN, or damage. The
   * chain carries on, which is the point -- it is somewhere to reload when nothing is alive nearby.
   *
   * One contact fires once. The bounce alone would usually see to that, but the guard is explicit
   * so a small bounce could never turn into a free hover.
   */
  private tickDoodads(oldY: number) {
    const p = this.player;
    const touching = this.doodads.find(d => d.active && p.x + 9 > d.x && p.x - 9 < d.x + d.width && p.y + 15 > d.y - 2 && p.y - 15 < d.y + d.height);
    if (!touching) { this.doodadContact = null; return; }
    if (this.doodadContact === touching.id) return;
    // Only from above, and only while falling: brushing one sideways or clipping it from below is
    // just scenery, exactly as it is for an enemy.
    // The gravity-facing face of the doodad: its top in the shaft, its underside in the ABYSS.
    // The 2px tolerance the old test carried is kept, measured along the pull.
    const face = this.gravity > 0 ? touching.y : touching.y + touching.height;
    const fromAbove = this.along(p.vy) > 0
      && this.crossedWithGravity(oldY + this.lead - 2 * this.gravity, p.y + this.lead, face);
    if (!fromAbove) return;
    this.doodadContact = touching.id;
    p.y = face - this.lead;
    p.vy = this.up * DOODAD_RULES.bounce;
    p.grounded = -1;
    this.reloadCharge();
    this.lastAirShot = -Infinity;
    // Spent by the bounce, where the doodad says so. Only THE ABYSS's are.
    if (touching.consumable) { touching.active = false; this.doodadContact = null; }
    this.events.push({ type: 'doodad', x: touching.x + touching.width / 2, y: touching.y, value: this.combo });
  }
  /**
   * Mine a COIN VEIN. It is shot open with the gunboots, not walked into: a chamber is where time
   * has stopped and the player is free to aim, so the vein is the one thing in there worth spending
   * rounds on -- and the chamber floor reloads, so it can never cost a run its ammunition.
   *
   * The payout is a spill of real coins rather than a credit, which means mining one is worth what
   * the player actually sweeps up, and every coin of it reaches the COIN HIGH meter on the ordinary
   * collection path. A big enough haul can therefore tip a run straight into a HIGH.
   */
  private mineCoinVein(zone: SafeZone | SideCave) {
    if (zone.taken || zone.content?.kind !== 'coinVein') return false;
    zone.taken = true;
    const vein = this.veinBounds(zone);
    const centre = vein.x + vein.width / 2;
    const dropped = this.coins.spill(centre, vein.y + vein.height / 2, SAFE_ZONE_RULES.coinVein.payout, this.random);
    this.events.push({ type: 'coinVein', x: centre, y: vein.y, value: dropped });
    return true;
  }
  /**
   * True when this point is inside an unmined vein's face, so a round can be tested against it.
   *
   * A vein waits in a CAVE now and used to wait in a chamber; AREAs that still cut chambers still
   * have theirs. Both are searched, because what a round hits is a vein either way.
   */
  private veinAt(x: number, y: number) {
    const hit = (v: { x: number; y: number; width: number; height: number }) =>
      x > v.x && x < v.x + v.width && y > v.y && y < v.y + v.height;
    for (const cave of this.caves) {
      if (cave.taken || cave.content?.kind !== 'coinVein') continue;
      if (hit(this.veinBounds(cave))) return cave;
    }
    for (const zone of this.safeZones) {
      if (zone.taken || zone.content?.kind !== 'coinVein') continue;
      if (hit(this.veinBounds(zone))) return zone;
    }
    return null;
  }
  /**
   * Where a COIN VEIN stands. In a cave it stands on whatever the content spot sits on, deep
   * inside; in a chamber it stands against the back wall, where it always has.
   */
  veinBounds(host: SafeZone | SideCave) {
    const size = SAFE_ZONE_RULES.coinVein;
    if ('opening' in host) return caveVeinBounds(host, shapeOf(host), size);
    const x = host.side === -1 ? host.x + 16 : host.x + host.width - 16 - size.width;
    return { x, y: host.y + host.height - size.height, width: size.width, height: size.height };
  }
  /** Kept for the chamber renderer and its tests, which ask about chambers specifically. */
  coinVeinBounds(zone: SafeZone) { return this.veinBounds(zone); }
  /** Contact breaks a container too, so a stomp and a shot are equally valid keys. */
  private tickContainers(dt: number) {
    const p = this.player;
    for (const box of this.containers) {
      if (box.broken) { box.debris = Math.max(0, box.debris - dt); continue; }
      // THE ABYSS's containers are shot open and nothing else: swimming into one does not break
      // it, so air in the arena always costs a round.
      if (box.shotOnly) continue;
      if (p.x + 9 > box.x && p.x - 9 < box.x + box.width && p.y + 15 > box.y && p.y - 15 < box.y + box.height) this.breakContainer(box);
    }
    this.containers = this.containers.filter(box => (!box.broken || box.debris > 0) && !this.behindCamera(this.trailingEdge(box.y, box.height), 180));
  }
  /**
   * Break one container. It restores nothing by itself: what it does is release bubbles, and only
   * touching a bubble is worth air. The bubbles climb, so they have to be chased.
   */
  private breakContainer(box: AirContainer) {
    if (box.broken) return;
    box.broken = true; box.debris = AIR_CONTAINER_RULES.debrisTime;
    const span = AIR_CONTAINER_RULES.bubblesMax - AIR_CONTAINER_RULES.bubblesMin;
    const count = AIR_CONTAINER_RULES.bubblesMin + Math.round(this.random() * span);
    for (let i = 0; i < count; i++) {
      this.bubbles.push({
        id: this.nextBubbleId++,
        x: box.x + box.width / 2, y: box.y + box.height / 2,
        vx: (this.random() * 2 - 1) * AIR_CONTAINER_RULES.riseSpread,
        vy: -AIR_CONTAINER_RULES.riseSpeed * (0.35 + this.random() * 0.35),
        life: AIR_CONTAINER_RULES.bubbleLife, taken: false,
        // Not catchable yet. A container broken by contact releases its burst around the player,
        // so without this the whole thing was collected on the frame that broke it.
        arm: AIR_CONTAINER_RULES.collectArm,
      });
    }
    this.events.push({ type: 'containerBreak', x: box.x + box.width / 2, y: box.y + box.height / 2, value: count });
  }
  /** Released bubbles climb away and expire. Catching one is the only thing that restores air. */
  private tickBubbles(dt: number) {
    const p = this.player;
    for (const bubble of this.bubbles) {
      if (bubble.taken) continue;
      bubble.life -= dt;
      bubble.arm = Math.max(0, bubble.arm - dt);
      bubble.vy = Math.max(-AIR_CONTAINER_RULES.riseSpeed, bubble.vy - AIR_CONTAINER_RULES.riseAccel * dt);
      bubble.vx *= 0.985;
      bubble.x = Math.max(WORLD.wall, Math.min(WORLD.width - WORLD.wall, bubble.x + bubble.vx * dt));
      bubble.y += bubble.vy * dt;
      if (bubble.arm > 0) continue;
      if (this.oxygen.enabled && Math.abs(bubble.x - p.x) < 24 && Math.abs(bubble.y - p.y) < 28) {
        // A FULL TANK TAKES NOTHING. Air is only spent when it is actually breathed, so swimming
        // through a burst at 12/12 leaves every bubble hanging exactly where it was, to be caught
        // on the way back down or left to pop. A container is one-shot and the whole AREA is built
        // on where the air is -- destroying a supply by brushing past it while full was a cost the
        // player could not see coming and could not undo.
        const restored = this.oxygen.add(AIR_CONTAINER_RULES.recovery);
        if (restored <= 0) continue;
        bubble.taken = true;
        this.events.push({ type: 'oxygen', x: bubble.x, y: bubble.y, value: restored });
      }
    }
    this.bubbles = this.bubbles.filter(b => !b.taken && b.life > 0 && !this.behindCamera(b.y, 90));
  }
  /**
   * The goal has been reached: cut the unseen shaft below and lay the exit floor just past the
   * camera, so the way out appears a little further on rather than having been visible all along.
   */
  private openExit() {
    const cut = Math.max(this.player.y + 240, this.cameraY + WORLD.height);
    this.platforms = this.platforms.filter(row => row.y <= cut);
    this.enemies = this.enemies.filter(e => e.y <= cut);
    this.pickups = this.pickups.filter(item => item.y <= cut);
    this.hazards = this.hazards.filter(h => h.y <= cut);
    this.containers = this.containers.filter(box => box.y <= cut);
    this.doodads = this.doodads.filter(d => d.y <= cut);
    this.safeZones = this.safeZones.filter(z => z.y <= cut);
    this.caves = this.caves.filter(c => c.bounds.y <= cut);
    const rows = this.platforms.filter((row): row is RoutePlatform => 'safeX' in row);
    const deepest = rows.reduce((low, row) => (row.y > low.y ? row : low), rows[0] ?? this.generator.frontierRow);
    const laid = this.generator.layExit(Math.max(cut, deepest.y + EXIT_RULES.depthMargin * WORLD.pixelsPerMeter), deepest);
    this.platforms.push(laid.floor);
    this.exit = laid.exit;
    this.events.push({ type: 'exitReady', x: laid.exit.x + laid.exit.width / 2, y: laid.exit.y });
  }
  /** Walking into the gate is what clears the SECTION. */
  private enterExit() {
    const e = this.exit, p = this.player;
    if (!e) return;
    if (p.x + 9 > e.x && p.x - 9 < e.x + e.width && p.y + 15 > e.y && p.y - 15 < e.y + e.height) {
      this.events.push({ type: 'exit', x: p.x, y: p.y });
      this.completeSection();
    }
  }
  /** Walking into the doorway opens the SHOP, which stops the world while it is open. */
  /**
   * Where a SHOP CAVE's doorway stands. Derived from the cave rather than stored, so every shop
   * cave has one and no two can overwrite each other.
   */
  shopDoor(cave: SideCave) {
    const spot = caveRewardSpot(cave, shapeOf(cave));
    return {
      x: Math.round(spot.x - SHOP_DOOR.width / 2), y: Math.round(spot.y - SHOP_DOOR.height),
      width: SHOP_DOOR.width, height: SHOP_DOOR.height,
    };
  }
  /** True when the player is standing in THIS cave's doorway and has not used it yet. */
  private atShopDoor(cave: SideCave, x: number, y: number) {
    if (cave.content?.kind !== 'shop' || cave.taken) return false;
    const d = this.shopDoor(cave);
    return x + 9 > d.x && x - 9 < d.x + d.width && y + 15 > d.y && y - 15 < d.y + d.height;
  }
  private enterShop() {
    const p = this.player;
    // Each SHOP CAVE is its own door with its own used flag: walking into one never disarms
    // another. "A shop is worth entering once" means EACH shop, not one shop per SECTION.
    const cave = this.caves.find(c => this.atShopDoor(c, p.x, p.y));
    if (cave && !this.shop.open) {
      cave.taken = true;
      if (!this.shop.openShelf()) return;
      this.shopReturn = this.state === 'boss' ? 'boss' : 'playing';
      this.state = 'shop';
      this.events.push({ type: 'shopOpen', x: p.x, y: p.y, value: this.coins.walletCoins });
      return;
    }
    if (!this.shop.touches(p.x, p.y) || !this.shop.enter()) return;
    // Remembered rather than assumed: the ABYSS staging room shops from the 'boss' state, and
    // closing the shelf there must not drop the run back into an ordinary SECTION.
    this.shopReturn = this.state === 'boss' ? 'boss' : 'playing';
    this.state = 'shop';
    this.events.push({ type: 'shopOpen', x: p.x, y: p.y, value: this.coins.walletCoins });
  }
  /** Leave the SHOP and carry on falling. */
  closeShop() {
    if (this.state !== 'shop') return false;
    this.shop.close();
    this.state = this.shopReturn;
    return true;
  }
  /**
   * Buy one item. Coins leave the wallet only -- the score total is never touched, and neither is
   * the COIN HIGH meter: spending is not earning. The goods are applied through exactly the same
   * calls a field pickup uses, so a bought heart and a found one can never behave differently.
   */
  buyShopItem(index: number) {
    if (this.state !== 'shop') return 'closed' as const;
    const result = this.shop.buy(index, this.coins, (offer: ShopOffer) => {
      // Every effect goes through the system that owns it: hearts through HealthSystem so a full
      // tank still overflows into LIFE UP, a bigger maximum through its own LIFE UP, and the
      // magazine through the same growth call a module bonus and a settled chain use.
      const item = shopItem(offer.item);
      if (item.hearts > 0) this.heal(item.hearts);
      if (item.maxCharge > 0) this.growMaxCharge(item.maxCharge);
      if (item.maxHp > 0) this.health.lifeUp(item.maxHp);
    });
    if (result === 'bought') this.events.push({ type: 'shopBuy', x: this.player.x, y: this.player.y, value: this.coins.walletCoins });
    return result;
  }
  /** One collision path for every pickup; the effect comes from the table, never from the kind. */
  private collectPickups() {
    const p = this.player;
    for (const item of this.pickups) {
      if (item.taken) continue;
      const type = pickupType(item.kind);
      if (Math.abs(item.x - p.x) > type.radius + 12 || Math.abs(item.y - p.y) > type.radius + 17) continue;
      // An AREA's own pickup only exists while that gimmick is on. Gun modules are run-wide, so
      // they are never gated by which AREA the player happens to be in.
      if (type.category === 'environment' && (type.effect === 'oxygen' ? !this.oxygen.enabled : !this.heat.enabled)) continue;
      // AIR IS ONLY SPENT WHEN IT IS BREATHED. The same rule as a released bubble, applied to the
      // one a BUBBLE FISH leaves behind, so the two air sources cannot disagree about what walking
      // over air at 12/12 costs: nothing. Deliberately scoped to oxygen -- ICE, hearts, the TOMATO
      // and weapon crates keep the semantics they have, where touching one is taking one.
      if (type.effect === 'oxygen') {
        const gained = this.oxygen.add(type.value);
        if (gained <= 0) continue;
        item.taken = true;
        this.events.push({ type: 'oxygen', x: item.x, y: item.y, value: gained });
        continue;
      }
      item.taken = true;
      if (type.effect === 'gunModule') {
        const id = item.module ?? STARTING_GUN_MODULE;
        const bonus = item.bonus ?? 'heart';
        this.equipGunModule(id, bonus);
        this.events.push({ type: 'gunModule', x: item.x, y: item.y, stage: gunModule(id).name, bonus, value: bonus === 'charge' ? CHARGE_AMMO_BONUS : 1 });
        continue;
      }
      if (type.effect === 'heal') { this.heal(type.value); continue; }
      if (type.effect === 'tomato') { this.takeTomato(item.x, item.y); continue; }
      // Everything else the table can carry. Oxygen has already returned above, so this is ICE.
      this.events.push({ type: 'ice', x: item.x, y: item.y, value: this.heat.relieve(type.value) });
    }
  }
  /** SECTION CLEAR: opens the rest point. No healing, no reload, no stage advance until NEXT. */
  completeSection(sectionId = this.stage.id) {
    if (this.practice || this.state !== 'playing' || this.paused || !this.upgrades.begin(sectionId)) return false;
    this.state = 'upgrade';
    this.events.push({ type: 'upgrade', x: this.player.x, y: this.player.y, stage: this.stage.label, areaCleared: this.stage.isAreaFinale ? this.stage.areaName : null });
    return true;
  }
  selectUpgrade(id: string) { return this.state === 'upgrade' && this.upgrades.select(id); }
  /** NEXT: applies the one chosen card, then starts the next SECTION (or hands off to the boss). */
  confirmUpgrade() {
    if (this.state !== 'upgrade') return false;
    const taken = this.upgrades.confirm();
    if (!taken) return false;
    // What an upgrade does the instant it is taken. Everything else about the twenty is a rule the
    // systems read later through `upgrades.has`, so this stays the only acquisition branch.
    if (taken.id === 'apple') this.heal(UPGRADE_TUNING.apple.heal);
    if (taken.id === 'youth') this.heal(UPGRADE_TUNING.youth.heal);
    this.syncUpgrades();
    // Bank the planned section length, never the frame that overshot the goal, so a cleared run
    // totals exactly 12 x 200m. A death mid-section still reports completedDepth + sectionDepth.
    this.completedDepth += this.stage.sectionLength;
    const advance = this.stage.advance();
    // The boss has no section of its own, so the banked metres must not be counted twice.
    // 4-3 CLEAR does NOT open the fight. It opens the staging room: a shop, a seal, and then the
    // reversal. NIMUSHI is not met until the player has broken their own way down to it.
    if (advance.boss) { this.startAbyss(); return true; }
    this.state = 'playing'; this.startSection();
    return true;
  }
  /**
   * THE ABYSS opens. Ordinary downward gravity, a hand-laid room, and no depth goal: the run is at
   * the bottom of the well and everything from here is preparation for what is under it.
   */
  private startAbyss() {
    this.sectionDepth = 0;
    this.state = 'boss';
    this.abyssStage = 'staging';
    this.startSection();
    this.buildStaging();
    // THE ABYSS has to ANNOUNCE itself, exactly as a SECTION and the fight do.
    //
    // The rest panel comes down when the UI is told play has resumed. Before Phase 6 that signal
    // was the `boss` event, raised here because 4-3 CLEAR opened the fight directly. It now opens
    // the staging room instead and `boss` belongs to NIMUSHI's arrival, which left NEXT at 4-3
    // raising nothing the UI could act on: the panel stayed up and the run could not continue.
    this.events.push({ type: 'abyss', x: this.player.x, y: this.player.y, stage: FINAL_STAGE.label });
  }
  /**
   * The staging room, laid by hand rather than rolled.
   *
   * Everything in it is GUARANTEED, which is exactly why it is not generated: a shop that might not
   * appear and a seal that might not be reachable are not acceptable at the last moment before the
   * FINAL BOSS. Three ledges to fall down, a chamber, and a sealed floor.
   */
  private buildStaging() {
    const top = START_PLATFORM.y;
    this.platforms = [{ ...START_PLATFORM }];
    for (let i = 1; i <= 2; i++) {
      const left = i % 2 === 1;
      const x = left ? WORLD.wall + 22 : WORLD.width - WORLD.wall - 22 - ABYSS.ledgeWidth;
      this.platforms.push({ id: this.nextAbyssId--, x, y: top + ABYSS.ledgeGap * i, width: ABYSS.ledgeWidth });
    }
    // The chamber. A SAFE ZONE like any other, so its floor reloads without banking a chain and
    // the world outside it stops while the player is deciding what to spend their last COIN on.
    const width = SAFE_ZONE_RULES.width, height = SAFE_ZONE_RULES.height;
    const zoneY = top + ABYSS.shopDepth;
    const zone: SafeZone = {
      id: this.nextAbyssId--, side: 1, x: WORLD.width - WORLD.wall - width,
      y: zoneY, width, height, content: null, taken: false,
    };
    this.safeZones.push(zone);
    const floor = zoneY + height;
    this.platforms.push({ id: this.nextAbyssId--, x: zone.x, y: floor, width, safeZone: zone.id });
    // A ledge under the mouth, so the chamber is stepped into rather than dropped past.
    this.platforms.push({ id: this.nextAbyssId--, x: WORLD.wall + 20, y: floor + 30, width: 120 });
    const centre = Math.round(zone.x + width / 2);
    if (this.safeZoneVisitCount > 0) {
      this.shop.stockForSection(this.random, ABYSS_SHOP_AREA);
      this.shop.placeEntrance(Math.round(centre - SHOP_DOOR.width / 2), Math.round(floor - SHOP_DOOR.height), SHOP_DOOR.width, SHOP_DOOR.height);
    } else {
      // A run that never once stepped into a chamber is handed the TOMATO instead of the shelf.
      // There is nothing to buy it with and nothing to choose: it is simply there, on the floor.
      this.pickups.push(spawnPickup('tomato', this.nextAbyssId--, centre, floor - 26));
    }
    // The seal. An ordinary BREAK BLOCK row, so it is opened with the gunboots exactly as a gate
    // row is, GUNPOWDER BLOCKS chains through it, and a REWARD BLOCK still pays.
    this.sealY = top + ABYSS.sealDepth;
    const slot = breakBlockWidth();
    for (let i = 0; i < BREAK_BLOCK_RULES.count; i++) {
      const x = Math.round(WORLD.wall + slot * i);
      const right = i === BREAK_BLOCK_RULES.count - 1 ? WORLD.width - WORLD.wall : Math.round(WORLD.wall + slot * (i + 1));
      this.platforms.push({
        id: this.nextAbyssId--, x, y: this.sealY, width: right - x,
        breakBlock: { hits: 0, durability: BREAK_BLOCK_RULES.durability, slot: i, reward: this.random() < BREAK_BLOCK_RULES.rewardChance },
      });
    }
    this.events.push({ type: 'seal', x: WORLD.width / 2, y: this.sealY, value: BREAK_BLOCK_RULES.count });
  }
  /** TOMATO: through the very same LIFE UP and magazine growth every other source uses. */
  private takeTomato(x: number, y: number) {
    const before = this.health.maxHp;
    this.health.lifeUp(TOMATO.maxHp);
    this.growMaxCharge(TOMATO.maxCharge);
    this.events.push({ type: 'tomato', x, y, value: TOMATO.maxCharge, lifeUps: this.health.maxHp - before });
  }
  /** Falling far enough past the broken seal is what turns the world over. */
  private tickSeal() {
    if (this.abyssStage !== 'staging') return;
    if (this.player.y < this.sealY + ABYSS.inversionDrop) return;
    this.abyssStage = 'inverting';
    this.inversionTimer = ABYSS.hold + ABYSS.reverse;
    this.inversionFlipped = false;
    this.player.vy = 0;
    this.events.push({ type: 'gravityFlip', x: this.player.x, y: this.player.y, value: 0 });
  }
  /**
   * GRAVITY REVERSED. A held beat while the shaft realises what has happened, then the flip itself,
   * and only then does NIMUSHI's arena open. Nothing simulates during it.
   */
  private tickInversion(dt: number) {
    this.inversionTimer -= dt;
    if (!this.inversionFlipped && this.inversionTimer <= ABYSS.reverse) {
      this.inversionFlipped = true;
      this.setGravity(GRAVITY_DIRECTION.boss);
      this.events.push({ type: 'gravityFlip', x: this.player.x, y: this.player.y, value: 1 });
    }
    if (this.inversionTimer > 0) return;
    this.abyssStage = 'fight';
    this.openArena();
  }
  /** The arena opens: the staging room is cleared, NIMUSHI hangs above, and the ascent begins. */
  private openArena() {
    const p = this.player;
    this.platforms = []; this.enemies = []; this.bullets = []; this.doodads = [];
    this.safeZones = []; this.caves = []; this.cameraX = 0; this.hazards = []; this.containers = []; this.bubbles = [];
    this.pickups = this.pickups.filter(item => !item.taken && item.kind === 'gunModule');
    this.shop.reset();
    this.exit = null;
    // Set outright rather than eased: `leadCamera` only ever travels WITH the pull, and the pull
    // has just reversed, so asking it to follow would leave the view where the descent left it.
    // The arena opening is the one moment the camera is allowed to jump.
    //
    // NIMUSHI is placed FIRST so the view can open on its anchor. Opening on the player instead
    // and letting the anchor take over would drop the whole frame 142px on the first step.
    this.bossAscent = 0;
    this.boss.start(p.y, this.gravity);
    this.cameraY = this.bossAnchorCamera() ?? p.y - WORLD.height * (this.gravity > 0 ? 0.37 : 0.63);
    const phase = abyssPhase(1);
    this.oxygen.reset(phase.gimmicks?.oxygen === true);
    this.heat.reset(false);
    this.abyssFrontier = this.gravity > 0 ? this.cameraY + WORLD.height : this.cameraY;
    this.layAbyssBatch(phase, true);
    // One target within reach on the first frame. The opening rows are laid ahead of the player and
    // take about half a second to matter, and a player who does nothing is inside NIMUSHI in 1.5 --
    // so the fight would start with its own answer briefly missing.
    this.layBounceTarget(phase, p.y + NIMUSHI.restGap * 0.5 * this.gravity, this.random);
    this.events.push({ type: 'boss', x: p.x, y: p.y, stage: NIMUSHI.name });
    this.events.push({ type: 'bossPhase', x: p.x, y: p.y, value: phase.id, stage: phase.name });
  }
  /**
   * The arena's own terrain, laid AGAINST the pull as the player climbs into it.
   *
   * Deliberately not the SECTION generator: an ABYSS stretch is four or five lines of recipe rather
   * than a whole area, because the fight's content is NIMUSHI and the terrain is only the stage it
   * happens on. What each stretch is FOR is the one mechanic it names.
   */
  private generateAbyss() {
    if (this.abyssStage !== 'fight' || !this.boss.enabled) return;
    const phase = this.boss.phase;
    const edge = this.gravity > 0 ? this.cameraY + WORLD.height : this.cameraY;
    const ahead = edge + WORLD.height * this.gravity;
    while (this.along(ahead - this.abyssFrontier) > 0) {
      this.abyssFrontier += phase.rowGap * this.gravity;
      this.layAbyssRow(phase, this.abyssFrontier);
    }
  }
  /** A stretch's opening rows, including the heart the first three are guaranteed. */
  private layAbyssBatch(phase: AbyssPhase, opening: boolean) {
    for (let i = 0; i < 4; i++) {
      this.abyssFrontier += phase.rowGap * this.gravity;
      this.layAbyssRow(phase, this.abyssFrontier);
    }
    if (!opening || !phase.heart) return;
    // One guaranteed heart per stretch, in reach of the opening rows. LIMBO has none, on purpose.
    const x = Math.round(WORLD.wall + 40 + this.random() * (WORLD.width - WORLD.wall * 2 - 80));
    const y = this.abyssFrontier - phase.rowGap * 1.5 * this.gravity;
    this.pickups.push(spawnPickup('heart', this.nextAbyssId--, x, y, this.random() * Math.PI * 2));
  }
  /**
   * One arena row.
   *
   * Everything on a row hangs from ONE wall and the other side is left open, alternating as the
   * rows go by. That is not decoration: a doodad the player cannot get off is a trampoline, and a
   * trampoline in an arena with a boundary closing behind it is a death sentence -- the player
   * bounces in place while NIMUSHI hauls the fight away from them. AREA 4 learned the same lesson
   * about LIMBO, and this is the same answer: always leave a lane to fall through.
   */
  private layAbyssRow(phase: AbyssPhase, y: number) {
    const roll = this.random;
    const span = WORLD.width - WORLD.wall * 2;
    const side = this.abyssSide;
    this.abyssSide = side === -1 ? 1 : -1;
    /** Anchor a box of this width against the row's own wall, clear of the open lane. */
    const anchor = (boxWidth: number) => Math.round(side === -1
      ? WORLD.wall + 10 + roll() * Math.max(1, span / 2 - 20 - boxWidth)
      : WORLD.width - WORLD.wall - 10 - boxWidth - roll() * Math.max(1, span / 2 - 20 - boxWidth));
    if (!phase.groundless) {
      const [minWidth, maxWidth] = phase.ledgeWidth;
      const width = Math.round(minWidth + roll() * (maxWidth - minWidth));
      const x = anchor(width);
      if (roll() < phase.breakBlockChance) {
        // A short run of blocks rather than a full gate: an obstacle in the arena, not a wall.
        const slot = breakBlockWidth();
        const first = side === -1 ? 0 : BREAK_BLOCK_RULES.count - 2;
        for (let i = first; i < first + 2; i++) {
          const bx = Math.round(WORLD.wall + slot * i);
          this.platforms.push({
            id: this.nextAbyssId--, x: bx, y, width: Math.round(slot),
            breakBlock: { hits: 0, durability: BREAK_BLOCK_RULES.durability, slot: i, reward: roll() < BREAK_BLOCK_RULES.rewardChance },
          });
        }
      } else {
        const row: Platform = { id: this.nextAbyssId--, x, y, width };
        // CATACOMB's delayed spikes, under inverted gravity: the face that arms them and the face
        // the teeth come out of are both `surfaceOf`, so the mechanic needs no mirrored copy.
        if (roll() < phase.spikeChance) row.spikePlatform = spikePlatform();
        this.platforms.push(row);
      }
    }
    // Every row carries something to stand on. Without it the arena has no reload and no way to
    // buy height, and the fight becomes a slow fall into the body.
    this.layBounceTarget(phase, y, roll);
    if (roll() < phase.doodadChance) {
      const dx = anchor(DOODAD_RULES.width);
      this.doodads.push(spawnDoodad(this.nextAbyssId--, dx, y - phase.rowGap * 0.45 * this.gravity, roll() < 0.5 ? 'lamp' : 'bracket', true));
    }
    if (roll() < phase.containerChance) {
      const cx = anchor(AIR_CONTAINER_RULES.size);
      this.containers.push({
        id: this.nextAbyssId--, x: cx, y: y - phase.rowGap * 0.6 * this.gravity,
        width: AIR_CONTAINER_RULES.size, height: AIR_CONTAINER_RULES.size,
        broken: false, debris: 0, shotOnly: true,
      });
    }
  }
  /**
   * The arena's standing supply of things to stand on.
   *
   * One per row, placed where the row's own generator would put anything else. This is the fight:
   * the player is pulled upward faster than NIMUSHI climbs, so the gap shuts unless they keep
   * finding something to stomp -- and a stomp is a kill, a full magazine and a throw back down the
   * shaft, exactly as it is in AREA 1-4.
   *
   * It is laid per ROW rather than per attack. A target that arrived with an attack made the reload
   * a feature of the attack; a target on every row makes it a feature of the arena, which is what
   * the shaft does and what keeps the loop going with no attacks running at all.
   *
   * The x varies with the row and the kind is the stretch's own, so this is a supply with variation
   * rather than a ladder of identical rungs.
   */
  private layBounceTarget(phase: AbyssPhase, y: number, roll: () => number) {
    const span = WORLD.width - WORLD.wall * 2;
    const x = Math.round(WORLD.wall + 40 + roll() * (span - 80));
    this.enemies.push(spawnEnemy('bounceTapioca', this.nextAbyssId--, x, y, 0, roll() * Math.PI * 2, 'open'));
    void phase;
  }
  /** Ends the run as GAME CLEAR. Called by the fight once the king has finished collapsing. */
  clearBoss() {
    if (this.state !== 'boss') return false;
    this.abyssStage = 'none';
    // Capture the fight length before the system is torn down; the result screen reads it after.
    this.bossClearTime = this.boss.elapsed;
    this.boss.reset();
    this.state = 'clear'; this.emit('clear', this.player.x, this.player.y);
    return true;
  }
  private bossClearTime = 0;
  /** Seconds the fight lasted, for the result screen. */
  get bossTime() { return this.boss.enabled ? this.boss.elapsed : this.bossClearTime; }
  /**
   * Development only: jump straight to a SECTION for gimmick testing. The production UI never calls
   * this; the dev entry at /tests/browser.html does.
   */
  jumpToStage(area: AreaId, section: SectionId) {
    if (this.practice) return false;
    this.stage.jumpTo(area, section);
    this.completedDepth = this.stage.plannedDepthBefore();
    this.paused = false; this.state = 'playing'; this.startSection();
    return true;
  }
  /** Development only: straight to the ABYSS staging room, shop, seal and all. */
  jumpToBoss() {
    if (this.practice) return false;
    this.stage.jumpToBoss();
    this.completedDepth = this.stage.plannedDepthBefore();
    this.paused = false;
    this.startAbyss();
    return true;
  }
  /**
   * Development only: straight into the arena with NIMUSHI dormant and at full HP. It skips the
   * staging room and the reversal, and NOTHING else -- the fight starts where it always starts,
   * asleep, with the first weak-point hit still to be earned.
   */
  jumpToNimushi() {
    if (this.practice) return false;
    if (!this.jumpToBoss()) return false;
    this.sealY = START_PLATFORM.y + ABYSS.sealDepth;
    this.player.y = this.sealY + ABYSS.inversionDrop + 10;
    this.player.vy = 0;
    this.abyssStage = 'fight';
    this.setGravity(GRAVITY_DIRECTION.boss);
    this.openArena();
    return true;
  }
  /**
   * Rebuilds the world for a SECTION. HP, MAX HP, overflow healing, upgrades and stacks are run
   * state and survive untouched; ammo is refilled because the rest point cannot reload.
   */
  private startSection() {
    const p = this.player;
    p.x = 225; p.y = WORLD.startY; p.vy = 0; p.grounded = -1;
    this.sectionDepth = 0; this.cameraY = 0; this.cooldown = 0; this.lastAirShot = -Infinity;
    this.platforms = [{ ...START_PLATFORM }]; this.enemies = []; this.bullets = []; this.nextChunk = 0;
    this.wallJumpUsed = 0; this.wallKick = 0; this.wallTouchSide = 0; this.wallTouchAge = Infinity;
    this.pickups = []; this.hazards = []; this.doodads = []; this.safeZones = []; this.caves = []; this.cameraX = 0; p.vx = 0;
    // Bodies, blasts and stopped time all belong to the SECTION that made them. TIMEOUT bubbles in
    // particular are cleared here: a bubble surviving into the next SECTION is not something the
    // original suggests, and leaving them would accumulate stopped time across a whole run.
    // MEASUREMENT REQUIRED.
    this.corpses = []; this.timeoutBubbles = [];
    // A HEART BALLOON is one per SECTION: gone when something pops it, back at the next opening.
    this.balloon = this.upgrades.has('heartBalloon')
      ? { x: p.x, y: p.y + UPGRADE_TUNING.heartBalloon.offsetY * this.gravity, alive: true }
      : null;
    this.jetpackFuel = UPGRADE_TUNING.safetyJetpack.fuelSeconds;
    this.doodadContact = null; this.worldElapsed = 0;
    this.containers = []; this.bubbles = []; this.exit = null;
    // Coins already banked stay banked; only the ones still lying on the floor are swept up.
    this.coins.clearLoose();
    // Whether this SECTION has a shop at all is decided once, here.
    this.shop.reset();
    // The shelf is stocked for every SECTION and priced for the AREA; whether the run ever sees it
    // is decided by the chamber content roll, which is the only thing that opens a door onto it.
    // The run's upgrades are pushed in first, so a discounted shelf is priced correctly the moment
    // it is built rather than after somebody notices.
    this.syncUpgrades();
    if (!this.practice && this.state !== 'boss') this.shop.stockForSection(this.random, this.stage.progress.area);
    // A full tank and a cold gauge at every SECTION start. Both are environment, not health: HP
    // carries over untouched. The gun keeps its module and its grown magazine, but forgets the
    // shot it was in the middle of -- a burst owes its remaining rounds to the SECTION that paid
    // for them, not to the next one.
    this.gun.rearm();
    if (this.state !== 'boss') this.boss.reset();
    this.oxygen.reset(!this.practice && this.stage.config.gimmicks?.oxygen === true);
    this.heat.reset(!this.practice && this.stage.config.gimmicks?.heat === true);
    this.collapse.reset(this.stage.sectionPlan?.breakDelay ?? BREAK_RULES.delay);
    this.generator = new StageGenerator(this.random, { depthOffset: this.completedDepth, plan: this.stage.sectionPlan, enemyPool: this.stage.enemyPool, water: this.stage.config.water, oxygen: this.oxygen.enabled, heat: this.heat.enabled, breakable: !this.practice && this.stage.config.gimmicks?.breakablePlatforms === true, sectionLength: this.practice || this.state === 'boss' || !this.stage.enabled ? undefined : this.stage.sectionLength,
      // MEMBER'S CARD: a shop near the top of every SECTION from the one after it was taken.
      guaranteedShopDepth: this.upgrades.has('membersCard') && !this.practice && this.state !== 'boss'
        ? UPGRADE_TUNING.membersCard.shopDepth : undefined });
    this.reloadCharge();
    // COMBO deliberately survives: a SECTION boundary is not a landing, and the rest point banks
    // nothing. A chain carried out of 1-1 is still live at the top of 1-2.
    this.generate();
    // One signal for every way a SECTION can begin: run start, NEXT, or a development jump.
    this.events.push({ type: 'section', x: p.x, y: p.y, stage: this.stage.label });
  }
  heal(amount: number) {
    const result = this.health.heal(amount);
    if (result.restored || result.overflow || result.lifeUps) this.events.push({ type: 'heal', x: this.player.x, y: this.player.y, value: result.restored, overflow: result.overflow, lifeUps: result.lifeUps });
    return result;
  }
  damage(amount: number, cause: DamageCause = 'enemy', source?: Enemy) {
    if (!this.health.damage(amount, cause)) return false;
    // TIMEOUT. A hit that did not end the run leaves stopped time behind it, exactly where it
    // landed: fixed in place, never following the player, and one per hit. A killing blow leaves
    // nothing, because there is nobody left to stand in it.
    if (this.upgrades.has('timeout') && this.hp > 0) {
      this.timeoutBubbles.push({ id: this.nextBubbleRegionId++, x: this.player.x, y: this.player.y, radius: UPGRADE_TUNING.timeout.radius });
    }
    // Being hit costs HP and nothing else: only a landing ends a chain. Losing a long chain to one
    // unlucky contact is what made holding a combo feel arbitrary rather than risky.
    if (source) source.hurtFlash = 0.3;
    // No generic knockback. A hit costs a heart and leaves the player's movement alone, in the
    // arena exactly as in the shaft -- a pearl, a spike and a slime all behave the same way here.
    // NIMUSHI's BODY is the one exception and it is handled at its own call site in `tickNimushi`,
    // where it can be tied to this function having returned true.
    this.events.push({ type: 'hurt', x: this.player.x, y: this.player.y, source: source ? { id: source.id, kind: source.kind, x: source.x, y: source.y } : undefined });
    return true;
  }
  killInstantly(cause: DamageCause) { return this.health.killInstantly(cause); }
  hurt(source?: Enemy) { this.damage(1, source ? enemyType(source.kind).damageCause : 'enemy', source); }
  /**
   * One blast, wherever it came from.
   *
   * Four upgrades put explosions in the world -- BLAST MODULE under a stomp, ROCKET JUMP under a
   * jump, HEART BALLOON when something touches it, REST IN PIECES when a corpse is shot -- and they
   * differ only in where, how big, and how hard. Sharing the collision pass is what keeps them
   * honest: every kill goes through `kill`, so a COMBO is counted once and a corpse drops its COIN
   * once, and there is no second place for a blast to quietly do it differently.
   *
   * `exclude` is the enemy the blast was caused BY, where there is one: a stomped enemy is already
   * dead by the time its own explosion goes off and must not be killed a second time.
   */
  spawnExplosion(blast: { x: number; y: number; radius: number; damage: number; destroysBlocks?: boolean; exclude?: Enemy }) {
    const { x, y, radius, damage } = blast;
    this.events.push({ type: 'explosion', x, y, value: radius });
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy === blast.exclude) continue;
      if (Math.hypot(enemy.x - x, enemy.y - y) > radius) continue;
      enemy.hp -= damage; enemy.flash = 0.1;
      // Not a stomp: a blast kill refills nothing, it only ends the enemy and extends the chain.
      if (enemy.hp <= 0) this.kill(enemy, false);
    }
    if (blast.destroysBlocks !== false) {
      for (const block of this.platforms) {
        if (!block.breakBlock || block.state === 'broken') continue;
        const nearest = Math.max(block.x, Math.min(x, block.x + block.width));
        if (Math.hypot(nearest - x, block.y - y) > radius) continue;
        // Opened outright rather than chipped: a blast is not a round, and counting it in hits would
        // make an explosion mean different things to a one-hit block and a three-hit one.
        this.breakBlockOutright(block);
      }
    }
  }
  /**
   * GUNPOWDER BLOCKS. A block that gives way fires a round upward and sets off its neighbours.
   *
   * Each block that goes fires exactly ONE round and then lights whatever it is touching. Lighting
   * a neighbour goes through the ordinary break path, which calls straight back into here for that
   * block -- so the chain is the recursion and needs no queue of its own. What bounds it is that a
   * block is marked broken BEFORE the chain runs, so nothing is ever reached twice and a row cannot
   * walk back into itself. A REWARD BLOCK caught in a chain still pays its LARGE COIN, and none of
   * it counts as a kill or touches the chain.
   */
  private gunpowderChain(from: Platform) {
    const def = gunModule('machine');
    const x = from.x + from.width / 2;
    // Upward through the model's own sign, so a later gravity inversion turns the whole chain.
    this.bullets.push({
      source: 'gunpowderBlock',
      x, y: from.y, previousX: x, previousY: from.y,
      vx: 0, vy: this.up * def.projectileSpeed,
      damage: def.projectileDamage, size: def.projectileSize,
      pierce: def.piercing, pierceBlocks: false, blocks: new Set(),
      range: def.range, travelled: 0, beam: false, hits: new Set(), alive: true,
    });
    const reach = UPGRADE_TUNING.gunpowderBlocks.chainRadius;
    // A snapshot: the list is walked while blocks inside it are being broken by the recursion.
    for (const neighbour of [...this.platforms]) {
      if (!neighbour.breakBlock || neighbour.state === 'broken') continue;
      const gap = Math.max(from.x - (neighbour.x + neighbour.width), neighbour.x - (from.x + from.width));
      if (gap > reach || Math.abs(neighbour.y - from.y) > reach) continue;
      this.breakBlockOutright(neighbour);
    }
  }
  /**
   * Take a block out in one go, through the ordinary break path so its COIN, its event and any chain
   * it sets off all still happen. Used by explosions and by GUNPOWDER BLOCKS, neither of which chips
   * a block down -- counting a blast in hits would make it mean different things to a one-hit block
   * and a three-hit one.
   */
  private breakBlockOutright(block: Platform) {
    const state = block.breakBlock;
    if (!state || block.state === 'broken') return;
    state.hits = state.durability - 1;
    this.hitBreakBlock(block);
  }
  private kill(enemy: Enemy, stomp: boolean) {
    enemy.alive = false; this.kills++; this.combo++; this.maxCombo = Math.max(this.combo, this.maxCombo);
    // Landing on a head is not landing on the ground: it refills CHARGE and the chain carries on,
    // which is the whole reason a stomp is worth going out of the way for.
    if (stomp) this.reloadCharge();
    const type = enemyType(enemy.kind);
    if (type.onDefeat === 'shatterNearby') {
      const hit = this.collapse.shatter(this.platforms, enemy.x, enemy.y);
      for (const platform of hit) this.events.push({ type: 'crack', x: platform.x + platform.width / 2, y: platform.y, value: 0 });
    }
    const drop = enemyType(enemy.kind).drop;
    if (drop && this.random() < (drop.chance ?? 1)) this.pickups.push(spawnPickup(drop.pickup, 900000 + enemy.id, enemy.x, enemy.y, this.random() * Math.PI * 2, true));
    // Every defeated enemy leaves money. The boss is not an Enemy and never reaches this path,
    // so the CLEAR sequence is untouched.
    const money = coinsFor(type.threat);
    this.coins.burst(enemy.x, enemy.y, money.count, this.random, money.denomination);
    // A body, for the two upgrades that care. Laid whether or not the run holds either: whether it
    // is worth anything is their question, not the kill's.
    if (type.leavesCorpse) this.corpses.push(spawnCorpse(this.nextCorpseId++, enemy.x, enemy.y, this.gravity));
    const points = Math.round(100 * this.multiplier * (stomp ? 1.5 : 1));
    this.killScore += points; this.events.push({ type: 'kill', x: enemy.x, y: enemy.y, value: points, stomp, combo: this.combo });
  }
  /**
   * The single door money comes through. Every earning path -- a collected coin, a settled chain --
   * ends here, so there is exactly one place that decides what feeds the COIN HIGH meter and the
   * meter can never disagree with the wallet. Spending is deliberately NOT routed through it: buying
   * something takes from the wallet alone and must never touch the meter or the score.
   */
  private earnCoins(value: number, x: number, y: number) {
    if (value <= 0) return 0;
    if (this.coinHigh.earn(value)) this.events.push({ type: 'coinHigh', x, y, value: 1 });
    return value;
  }
  /**
   * What picking up one physical COIN does, beyond the money itself.
   *
   * COIN POWERED pays CHARGE by the gem's own value, and POPPING COINS fires a round upward for it.
   * Both are per-gem, so a mined COIN VEIN pays out once for every coin swept up rather than once
   * for the haul -- and neither can be triggered by a settled chain, which is credited directly and
   * never becomes a coin on the floor.
   */
  private onCoinPickup(coin: Coin) {
    if (this.upgrades.has('gemPowered')) {
      // Small (2) pays 1, large (10) pays 5: the original's per-gem figures, expressed against
      // DEEP DROP's own denominations so the two line up exactly.
      const gain = coin.value * UPGRADE_TUNING.gemPowered.chargePerValue;
      this.ammo = Math.min(this.stats.maxAmmo, this.ammo + gain);
    }
    if (this.upgrades.has('poppingGems')) {
      const p = this.player, tuning = UPGRADE_TUNING.poppingGems;
      // Upward through the model's own sign, so a later gravity inversion turns these with it.
      // MEASUREMENT REQUIRED: whether a LARGE gem fires something stronger is not documented, so
      // both sizes fire the same machine-class round for now.
      this.bullets.push({
        source: 'poppingGem',
        x: p.x, y: p.y, previousX: p.x, previousY: p.y,
        vx: 0, vy: this.up * tuning.speed,
        damage: tuning.damage, size: tuning.size, pierce: 0, pierceBlocks: false, blocks: new Set(),
        range: tuning.range, travelled: 0, beam: false, hits: new Set(), alive: true,
      });
    }
  }
  /** What a round currently does, after any temporary boost. Nothing writes to the weapon table. */
  get shotBoost(): ShotBoost {
    // Reach is a product, not winner-takes-all: LASER SIGHT and a COIN HIGH both stretch it, and
    // neither may overwrite the other or the module's own figure.
    const sight = this.upgrades.has('laserSight') ? UPGRADE_TUNING.laserSight.rangeMultiplier : 1;
    return { damage: this.coinHigh.damageMultiplier, range: this.coinHigh.rangeMultiplier * sight };
  }
  /**
   * Grow the magazine permanently. Shared by a gun module's CHARGE bonus, a settled chain's reward
   * and the SHOP's batteries, so every route to a bigger magazine tops it up the same way -- the
   * player is never left a round short of a maximum they just paid for.
   */
  growMaxCharge(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.stats.maxAmmo += amount;
    this.ammo = this.stats.maxAmmo;
  }
  /**
   * Push the upgrades that are simple multipliers into the systems that own the value.
   *
   * Each belongs to a system that already had the number: HealthSystem's invulnerability window,
   * CoinSystem's magnet, CoinHighSystem's duration, the SHOP's prices. The upgrade scales what is
   * there rather than replacing it, so the tuned figure stays the tuned figure. Called on
   * acquisition and at every SECTION start, because systems rebuilt between SECTIONs must not
   * forget what the run is holding.
   */
  private syncUpgrades() {
    this.health.invincibilityMultiplier = this.upgrades.has('candle') ? UPGRADE_TUNING.candle.invincibilityMultiplier : 1;
    this.coins.attractMultiplier = this.upgrades.has('gemAttractor') ? UPGRADE_TUNING.gemAttractor.radiusMultiplier : 1;
    this.coinHigh.durationMultiplier = this.upgrades.has('gemSick') ? UPGRADE_TUNING.gemSick.durationMultiplier : 1;
    this.shop.discount = this.upgrades.has('membersCard') ? UPGRADE_TUNING.membersCard.discount : 1;
  }
  /**
   * Fill the magazine. This is ONE of the two things a landing does, and it is deliberately its own
   * call: a stomp reloads without banking a chain, and a future Safe Zone will need the same.
   * Reloading must never imply settling.
   */
  reloadCharge() {
    this.ammo = this.stats.maxAmmo;
    // The jetpack refills wherever CHARGE does -- a landing, a stomp, a doodad, a chamber floor --
    // so it is available in LIMBO, where a doodad is the only one of those that exists.
    // MEASUREMENT REQUIRED: the original's own reset sources are not documented.
    this.jetpackFuel = UPGRADE_TUNING.safetyJetpack.fuelSeconds;
  }
  /**
   * Bank the chain. The tier table decides what a landing at this COMBO is worth; the DEEPEST tier
   * it qualifies for is paid once, never the shallower ones as well. Every tier pays the same flat
   * COIN -- what deepens is what comes with it -- and it is paid straight into the wallet rather
   * than scattered, so a banked chain cannot be dropped. A heart goes through HealthSystem so
   * overflow and LIFE UP behave as they always have.
   *
   * Nothing here interrupts the run: no screen, no choice, just the payout and a label in the shaft.
   */
  settleCombo() {
    const combo = this.combo;
    const tier = comboTierFor(combo);
    this.combo = 0;
    if (!tier) return undefined;
    const p = this.player;
    // Awarded, not dropped: a chain the player has already earned must not then be lost on the floor.
    if (tier.coins > 0) this.earnCoins(this.coins.award(tier.coins), p.x, p.y);
    if (tier.maxCharge > 0) this.growMaxCharge(tier.maxCharge);
    if (tier.hearts > 0) this.heal(tier.hearts);
    this.events.push({ type: 'comboSettle', x: p.x, y: p.y, value: combo, combo, stage: tier.label });
    return tier;
  }
  /**
   * What touching down does, in one place: every kind of floor -- a plain ledge, a BREAK BLOCK, an
   * AREA 4 collapsing ledge, a SAFE ZONE chamber -- goes through this rather than repeating it.
   *
   * Reloading and settling stay two separate jobs, and this is the reason they have to be: a
   * chamber floor fills CHARGE and leaves the chain running, because shelter is not the ground a
   * chain is banked on. "Reloaded, therefore settled" would collapse the two and make a SAFE ZONE
   * the most expensive place in the game to stand.
   */
  private settleLanding(platform: Platform) {
    this.reloadCharge();
    if (platform.safeZone === undefined) this.settleCombo();
    // Touching down re-arms both walls: the lockout only ever stops riding ONE wall in mid-air.
    this.wallJumpUsed = 0;
    this.wallTouchAge = Infinity;
  }
  private finish() { if (this.state === 'over' || this.state === 'clear') return; this.state = 'over'; this.emit('over', this.player.x, this.player.y); }
  private generate() {
    // THE ABYSS lays its own terrain, by hand in the staging room and from the stretch recipe in
    // the arena. The SECTION generator has no business in either.
    if (this.abyssStage !== 'none') return;
    while (!this.generator.finished && this.nextChunk * WORLD.chunkHeight < this.cameraY + WORLD.height + WORLD.chunkHeight) {
      const chunk = this.generator.chunk(this.nextChunk++);
      this.platforms.push(...chunk.platforms); this.enemies.push(...chunk.enemies);
      this.pickups.push(...chunk.pickups); this.hazards.push(...chunk.hazards);
      this.doodads.push(...chunk.doodads);
      for (const cave of chunk.caves) this.addCave(cave);
      for (const zone of chunk.safeZones) {
        this.safeZones.push(zone);
        // Content is materialised through the systems that already own it, so a module found in a
        // chamber and one found on a ledge are the same object taking the same path.
        const content = zone.content;
        if (!content) continue;
        const centre = Math.round(zone.x + zone.width / 2), floor = zone.y + zone.height;
        if (content.kind === 'gunModule') {
          this.pickups.push(spawnGunModule(zone.id + 1, centre, floor - 34, content.module ?? STARTING_GUN_MODULE, content.bonus ?? 'heart'));
        } else if (content.kind === 'shop') {
          this.shop.placeEntrance(Math.round(centre - SHOP_DOOR.width / 2), Math.round(floor - SHOP_DOOR.height), SHOP_DOOR.width, SHOP_DOOR.height);
        }
      }
      this.containers.push(...chunk.containers);
    }
  }
  /**
   * Take a SIDE CAVE into the world.
   *
   * Content is materialised through the systems that already own it, so a module, a shelf or a vein
   * found in a cave is the same object on the same path as one found anywhere else -- only WHERE it
   * goes is the cave's business, and that is one call for all three archetypes. The development
   * preview fixture comes through here too, so what it shows is what the generator builds.
   */
  private addCave(cave: SideCave) {
    this.caves.push(cave);
    const spot = caveRewardSpot(cave, shapeOf(cave));
    if (cave.content?.kind === 'gunModule') {
      this.pickups.push(spawnGunModule(cave.id + 1, Math.round(spot.x), Math.round(spot.y - 34),
        cave.content.module ?? STARTING_GUN_MODULE, cave.content.bonus ?? 'heart'));
    }
    // A SHOP CAVE reports no doorway: it carries its own, from `shopDoor`. ShopSystem holds ONE
    // entrance, so when a SECTION generated two shop caves the second one's `placeEntrance`
    // overwrote the first and left the shallower shop dead -- measured at 19% of AREA 1 runs.
    // A COIN VEIN needs nothing here either: it is a face on the rock, drawn and shot where it is.
  }

  private emit(type: GameEvent['type'], x: number, y: number) { this.events.push({ type, x, y }); }
}
