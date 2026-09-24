import { WORLD, BALANCE } from '../data/balance';
import { difficultyAt, fallTime, horizontalReach } from '../data/difficulty';
import { ENEMY_TYPES, enemyType, motionEnvelope, spawnEnemy, type Enemy, type EnemyKind } from '../data/enemies';
import { spawnPickup, type Pickup, type PickupKind } from '../data/pickups';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES, breakBlockWidth, EXIT_RULES, spikePlatform, type AirContainer, type SpikePlatform, type StageExit } from '../data/structures';
import { spawnHazard, type Hazard, type SpikeKind } from '../data/hazards';
import { spawnDoodad, doodadBounceZone, DOODAD_RULES, type Doodad } from '../data/doodads';
import { getSideRoomMode, rollSafeZoneContent, safeZoneDepths, safeZoneRowClearance, sideRoomCount, SAFE_ZONE_RULES, type SafeZone } from '../data/safeZone';
import { CAVE_RULES, caveShape, placeCave, type CaveArchetype, type SideCave } from '../data/sideCave';
import { rollGunModule as rollModuleForZone } from '../data/gunModules';
import type { SectionPlan, WaterPhysics } from '../data/areas';
import { RhythmWalker, getTerrainMode, laneOf, type RhythmBand } from '../data/rhythm';
import { PiecePlanner, type RowIntent } from '../data/pieces';
import { dormantGhost, GHOST_RULES } from '../data/chasers';
import type { StageFlowProfile } from '../data/stageFlow';

export type { Enemy, EnemyKind } from '../data/enemies';
export type { Pickup } from '../data/pickups';
export type { Hazard } from '../data/hazards';
export type { Doodad } from '../data/doodads';
export type { SafeZone } from '../data/safeZone';
import type { PlatformState } from './BreakablePlatformSystem';
/**
 * One BREAK BLOCK, tracked on the platform that is the block. Present only on blocks, so
 * `breakBlock` is also the test for "is this a block" -- it is deliberately independent of
 * `breakable`, which belongs to AREA 4's collapsing ledges and behaves nothing like this.
 */
export interface BreakBlock {
  /** Rounds that have connected with THIS block so far. Neighbours keep their own count. */
  hits: number;
  /** Rounds it takes. Counted in hits, not damage, so every gun module can open one. */
  durability: number;
  /** Which slot in its row this is, so the view can shade a row without measuring positions. */
  slot: number;
  /**
   * A REWARD BLOCK. Set when the row is built and visible on the block itself, so choosing which
   * stone to spend a round on is a read rather than a gamble. Breaking it pays a LARGE COIN with no
   * roll of any kind; an ordinary block pays nothing.
   */
  reward: boolean;
}
export interface Platform {
  id: number; x: number; y: number; width: number;
  /** AREA 4: this ledge gives way once the player has landed on it. */
  breakable?: boolean;
  /** Owned by BreakablePlatformSystem; every other reader treats it as read-only. */
  state?: PlatformState;
  /** A block in a gate row that has to be shot open. Landing on it is an ordinary landing. */
  breakBlock?: BreakBlock;
  /**
   * Ground that turns on the player. Landing is ordinary -- CHARGE fills, a chain settles -- and
   * then a warning runs and the spikes come up for ordinary damage. Nothing about it is instant
   * death, and nothing about it changes what a landing is worth. CATACOMBS only.
   */
  spikePlatform?: SpikePlatform;
  /**
   * LIMBO's dangerous ground: a row of barbs that is not a floor. Nothing lands on it, so it never
   * reloads and never settles a chain -- it is passed through, at the cost of a heart.
   */
  limboHazard?: boolean;
  /**
   * The SAFE ZONE this slab is the floor of. Landing on it reloads but does NOT settle the chain,
   * which is the one thing that makes a chamber shelter rather than ground.
   */
  safeZone?: number;
}
export interface RoutePlatform extends Platform {
  safeX: number; exitX: number; safeSide: -1 | 1;
  /**
   * Which CATACOMB shape built this row, when one did. Read only by tests: a baffle's geometry can
   * coincide exactly with an ordinary row's, so only the generator can say which one it laid.
   */
  shaped?: 'baffle' | 'slot';
}
export const START_PLATFORM: RoutePlatform = { id: -2, x: 155, y: 250, width: 140, safeX: 225, exitX: 307, safeSide: 1, breakable: false, state: 'stable' };
/**
 * Can a fall from `from`'s way off reach `to`'s landing without ever touching this movement box?
 *
 * The body must be clear of the box (13px either side: 9 of body, 4 of margin) for the whole time it
 * is level with it (15px above to 15px below). It may pass on either side. Going round on the left
 * means being left of the box by the time the fall reaches its top -- `horizontalReach` of the drop so
 * far -- and getting from there to the landing in the drop that is left; the right mirrors it. Both
 * legs are measured from rest, which is the conservative reading of a steering envelope.
 */
export function canPassEnemy(box: { minX: number; maxX: number; minY: number; maxY: number }, from: RoutePlatform, to: RoutePlatform, water?: WaterPhysics) {
  const y1 = box.minY - 15, y2 = box.maxY + 15;
  if (y1 <= from.y || y2 >= to.y) return false;
  const reachIn = horizontalReach(y1 - from.y, water), reachOut = horizontalReach(to.y - y2, water);
  const inner = WORLD.wall + 9, outer = WORLD.width - WORLD.wall - 9;
  const left = box.minX - 13, right = box.maxX + 13;
  const viaLeft = left >= inner && (from.exitX <= left || from.exitX - left <= reachIn) && (to.safeX <= left || to.safeX - left <= reachOut);
  const viaRight = right <= outer && (from.exitX >= right || right - from.exitX <= reachIn) && (to.safeX >= right || right - to.safeX <= reachOut);
  return viaLeft || viaRight;
}
/** Kinds whose behaviour takes them anywhere (dwellers.ts): chasers, risers, darters, bouncers. */
export const roams = (kind: EnemyKind) => {
  const b = ENEMY_TYPES[kind].behaviour;
  return b !== undefined && b !== 'frog' && b !== 'groundSkull' && b !== 'throw' && b !== 'phantom' && b !== 'orbit' && b !== 'crawl';
};
export const canReachPlatform = 
(from: RoutePlatform, to: RoutePlatform, water?: WaterPhysics) => to.y > from.y && Math.abs(to.safeX - from.exitX) <= horizontalReach(to.y - from.y, water);

/** Everything one row needs, whether it came from a SECTION plan or the shared depth curve. */
interface RowTuning { minWidth: number; maxWidth: number; gap: number; enemyChance: number; flyChance: number; toughChance: number; heavyChance: number; comboBias: number; containerChance: number; maxOxygenGap: number; bubbleOffside: number; lavaPoolChance: number; lavaWallChance: number; ventChance: number; iceChance: number; iceOffside: number; breakableChance: number; maxBreakableRun: number; spikeChance: number; spikeKinds: readonly SpikeKind[]; spikePlatformChance: number; limboHazardChance: number; groundless: boolean; doodadChance: number }
export interface GenerationContext {
  /** Metres already descended this run; only used when no SECTION plan is supplied. */
  depthOffset?: number;
  plan?: SectionPlan;
  enemyPool?: readonly EnemyKind[];
  /** Submerged handling. Present only for areas whose air supply matters. */
  water?: WaterPhysics;
  /** Oxygen sources are generated only when the area actually drains air. */
  oxygen?: boolean;
  /** Lava, vents and ice are generated only when the area actually runs a heat gauge. */
  heat?: boolean;
  /** Collapsing ledges are generated only where the area asks for them. */
  breakable?: boolean;
  /** Resume from a descent already in progress, so a boss phase can swap recipes mid-fall. */
  startY?: number;
  previous?: RoutePlatform;
  /**
   * Metres at which this SECTION's exit floor is laid. Reaching it no longer ends the SECTION --
   * the generator simply stops building past the floor, which is what bounds the shaft and stops
   * the player farming below the goal. Absent for the FINAL BOSS, which never ends this way.
   */
  sectionLength?: number;
  /**
   * Metres at which this SECTION must offer a SHOP chamber, over and above its ordinary schedule.
   * Set only while the run holds MEMBER'S CARD. MEASUREMENT REQUIRED: the original's own depth for
   * this is not documented, so it is simply "near the top".
   */
  guaranteedShopDepth?: number;
}
/**
 * Width of the clear fall lane LIMBO keeps open through each band. Wide enough for the player plus
 * room to steer into it, narrow enough that the rest of the row still carries doodads.
 * PROVISIONAL / MEASUREMENT REQUIRED.
 */
const LIMBO_FALL_LANE = 124;
/**
 * How far a COLLAPSED REALM barb block must stay from the route ledge's way off. The body is 9px
 * either side of centre and leaves 12px past the edge; 30px keeps a clean fall beside the block even
 * for a player who walks off without steering away from it.
 */
const LIMBO_BARB_CLEARANCE = 30;
/**
 * How far below the player the camera shows, in pixels. GameModel frames the player at 0.37 of the
 * viewport, so this is the rest of it -- and therefore how much of a fall a mouth is visible for.
 */
const CAMERA_LEAD = Math.round(WORLD.height * 0.63);
const DEFAULT_POOL: readonly EnemyKind[] = ['slime', 'bat', 'armoredSlime', 'tank'];

export class StageGenerator {
  private id = 0;
  private nextY: number;
  /**
   * The SECTION's vertical rhythm, or null when it has none -- either because the AREA does not
   * declare one yet, or because the dev A/B has been put back to `legacy`. Null is the old
   * behaviour EXACTLY: the walker is never consulted, so not one extra number is drawn from the
   * seed and a legacy SECTION generates bit for bit as it did before the grammar existed.
   */
  private rhythm: RhythmWalker | null = null;
  /**
   * The SECTION's terrain pieces, or null when it has none. A piece spans several rows and states
   * what that stretch of shaft IS, which is the thing a gap grammar on its own could not change.
   * When this is set the rhythm walker is not consulted at all -- the piece owns the step too.
   */
  private planner: PiecePlanner | null = null;
  /**
   * EVERY ledge in the row just laid: the route one first, then any extras beside it.
   *
   * This is what makes more than one ledge per band safe. The next row is chosen from candidates
   * reachable from ALL of these, not just from the route ledge, so whichever one the player lands
   * on, the way down is the same way down. A band of one -- every row outside a cluster -- reduces
   * to exactly the old single-platform rule and draws nothing extra from the seed.
   */
  private previousBand: RoutePlatform[] = [];
  /**
   * True when this SECTION is running the SIDE ROOM pilot: it declares `sideRooms` AND the dev A/B
   * has not been put back to `legacy`. Only then do the measured entry rules apply.
   */
  private sideRoomPilot = false;
  /**
   * The SIDE CAVEs' own randomness, separate from the run's.
   *
   * Everything about a cave -- how many, which wall, what is in it -- is drawn from here, and the
   * run's stream pays for it exactly once, at construction, whatever the answers turn out to be.
   * That is what lets the frequency A/B mean anything: choosing `low` or `high` used to move every
   * draw after it and hand the player a completely different shaft, so the two could not be
   * compared. Measured before this existed, terrain differed in 120 of 120 SECTIONs.
   *
   * Only an AREA that declares `sideRooms` pays the draw, so the AREAs that still cut chambers are
   * untouched down to the bit.
   */
  private caveRandom: (() => number) | null = null;
  /**
   * How many of the scheduled slots this SECTION may actually cut a cave into. Below the number
   * scheduled, the extra slots are searched for exactly as they would be and then passed over --
   * the terrain has already been shaped around them, which is the point.
   */
  private caveBudget = 0;
  /** The widest step any band can ask for. Lookaheads that must stay conservative use this. */
  private maxRowStep = 0;
  /** The horizontal answer the previous row asked for, folded so left and right are one question. */
  private lastLane: 'wall' | 'near' | 'mid' | null = null;
  /** Which wall the next CATACOMB BAFFLE is held against; 0 until a baffle run starts. */
  private baffleSide: -1 | 1 | 0 = 0;
  /** Section-local metres at which a GHOST is laid in the wall, shallowest first. */
  private ghostDepths: number[] = [];
  /** Which wall the next GHOST waits in. Alternates, starting left; never drawn. */
  private ghostSide: -1 | 1 = -1;
  private previous: RoutePlatform;
  private wallToCover: -1 | 1 = -1;
  private rowsSinceWall = 0;
  private readonly pool: readonly EnemyKind[];
  private readonly openKinds: boolean;
  /** World y of the last air source, so the plan's ceiling is measured, not accumulated. */
  private lastAirY = START_PLATFORM.y;
  /** Consecutive collapsing rows, capped so a seed always offers somewhere to regroup. */
  private breakableRun = 0;
  /** Set once the exit floor is down: nothing is generated below it, ever. */
  private done = false;
  /**
   * Section-local metres at which a row of BREAK BLOCK is laid, shallowest first. Spaced evenly
   * through the SECTION so the rows divide it into fall zones rather than clustering, and derived
   * from the SECTION's own length so they can never land on the opening or on the exit floor. The
   * FINAL BOSS passes no sectionLength, which is why the arena has no gate rows at all.
   */
  private gates: number[] = [];
  /** Section-local metres at which a SAFE ZONE chamber is cut, shallowest first. */
  private chambers: number[] = [];
  /**
   * Which wall the next chamber is cut into. It alternates so a SECTION with several never puts
   * them all down one side, and the FIRST one is drawn rather than fixed -- otherwise every SECTION
   * with a single chamber would put it in the same wall, every seed, forever.
   */
  private nextChamberSide: -1 | 1 | 0 = 0;
  /** Which side LIMBO's clear fall lane sits on next. Alternates so a descent always has a way past. */
  private doodadLane = 0;
  /** Chambers still owed a SHOP outright, rather than a rolled content. MEMBER'S CARD's doing. */
  private forcedShopChambers = 0;
  constructor(private random: () => number = Math.random, private context: GenerationContext = {}) {
    this.nextY = context.startY ?? 465;
    const mode = getTerrainMode();
    const pieces = mode === 'grammar-v2' ? context.plan?.pieces : undefined;
    if (pieces) {
      this.planner = new PiecePlanner(pieces, random);
      // The widest span any piece can ask for, for the lookaheads that must stay conservative.
      // The GRAMMAR states it. It used to be a literal 860 -- AREA 1's number, written into the
      // generator -- so a grammar that opened further would have had its air ceiling checked
      // against a step shorter than the one it was about to take.
      this.maxRowStep = pieces.maxStep;
    } else {
      const grammar = mode === 'legacy' ? undefined : context.plan?.rhythm;
      if (grammar) {
        this.rhythm = new RhythmWalker(grammar, random);
        this.maxRowStep = Math.max(...grammar.bands.map(b => b.gap[1]));
      }
    }
    this.previous = context.previous ? { ...context.previous } : { ...START_PLATFORM };
    this.previousBand = [this.previous];
    // Keep ids clear of whatever the previous generator already handed out.
    this.id = Math.max(0, Math.round((this.nextY - 465) / 4));
    const roster = context.enemyPool?.length ? context.enemyPool : DEFAULT_POOL;
    const held = context.plan?.enemyExclude ?? [];
    this.pool = held.length ? roster.filter(kind => !held.includes(kind)) : roster;
    this.openKinds = this.pool.some(kind => ENEMY_TYPES[kind].spawnSlot !== 'guard');
    const gateCount = context.sectionLength ? context.plan?.breakBlockRows ?? 0 : 0;
    for (let i = 1; i <= gateCount; i++) this.gates.push(context.sectionLength! * i / (gateCount + 1));
    // Chambers are spaced the same way, and kept clear of the opening and of the exit so one can
    // never be cut where the way out has to be. `safeZoneCount` is a GUARANTEED MINIMUM rather than
    // a quota: each of these depths is the earliest a chamber may appear, and the row keeps being
    // retried until one fits. Adding optional extra chambers later means pushing more depths in
    // here and nothing else.
    // An AREA that declares `sideRooms` is running caves. How MANY is the frequency mode's answer
    // and is drawn below; that it uses caves at all is not a frequency question.
    this.sideRoomPilot = context.plan?.sideRooms !== undefined && getSideRoomMode() !== 'legacy';
    if (this.sideRoomPilot) {
      // One draw from the run, spent here, to seed a stream of the caves' own. Every frequency
      // costs the same one draw, so the shaft that comes out is the same shaft.
      let seed = Math.floor(random() * 4294967296) >>> 0;
      this.caveRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    }
    // THE SCHEDULE IS THE SAME IN EVERY FREQUENCY; only how many of its slots are actually cut
    // changes. A cave needs 220px of clearance, and the terrain grammar yields a NORMAL stretch to
    // give it -- so a SECTION that reserved fewer slots would come out a different shaft, and the
    // A/B would be comparing two things at once. Reserving both and cutting one is what makes
    // `low` and `high` the same descent with a different number of caves in it.
    const scheduled = this.sideRoomPilot
      ? Math.max(context.plan?.safeZoneCount ?? 0, context.plan?.sideRooms ?? 0)
      : sideRoomCount(context.plan);
    // Drawn in EVERY frequency and read only by `variable`, so the cave stream runs the same way
    // in all three and the caves a SECTION does cut are the same caves in the same places.
    const countRoll = this.caveRandom ? this.caveRandom() : 1;
    this.caveBudget = this.sideRoomPilot ? sideRoomCount(context.plan, countRoll) : scheduled;
    this.chambers.push(...safeZoneDepths(scheduled, context.sectionLength));
    // MEMBER'S CARD guarantees a shop near the top of every later SECTION. It is an EXTRA chamber
    // in front of the ordinary schedule rather than a replacement for one, so the minimum a SECTION
    // already promises is untouched and its content roll still decides what that one holds.
    if (context.guaranteedShopDepth !== undefined && context.sectionLength) {
      this.chambers.unshift(context.guaranteedShopDepth);
      this.forcedShopChambers = 1;
    }
    this.chambers.sort((a, b) => a - b);
    // GHOSTS, spread evenly through the SECTION after its quiet opening and clear of the exit.
    const ghosts = context.sectionLength ? context.plan?.ghosts : undefined;
    if (ghosts && ghosts.count > 0) {
      const from = (context.plan?.graceDepth ?? 0) + 20, to = context.sectionLength! - 30;
      for (let i = 0; i < ghosts.count; i++) this.ghostDepths.push(from + (to - from) * (i + 0.5) / ghosts.count);
    }
  }


  /**
   * One row of BREAK BLOCK, edge to edge across the shaft. Together they stop the fall; separately
   * each is its own platform with its own durability, so the player picks where to open a hole
   * rather than grinding the row down. One block wide is already more than the player needs to fall
   * through, which is what makes a precise weapon and a wide one both worth carrying.
   *
   * Every block carries the same safeX/exitX -- the spot the fall from above actually arrives at --
   * because the drop out of the row happens wherever the player is standing when a hole opens, not
   * off a ledge edge. That is the conservative reading; walking along the row first is free.
   */
  private breakBlockRow(y: number): RoutePlatform[] {
    const width = breakBlockWidth();
    const durability = this.context.plan?.breakBlockDurability ?? BREAK_BLOCK_RULES.durability;
    const landing = Math.max(WORLD.wall + 26, Math.min(WORLD.width - WORLD.wall - 26, this.previous.exitX));
    // One rounded edge list shared by every block, so a block's right edge IS its neighbour's left
    // edge. Rounding each block on its own leaves sub-pixel seams -- either a hole nobody opened or
    // an overlap -- and the row has to be exactly airtight until the player makes it otherwise.
    const edge = (slot: number) => Math.round(WORLD.wall + slot * width);
    return Array.from({ length: BREAK_BLOCK_RULES.count }, (_, slot) => {
      const left = edge(slot), right = slot === BREAK_BLOCK_RULES.count - 1 ? WORLD.width - WORLD.wall : edge(slot + 1);
      return {
        id: this.id++, x: left, y, width: right - left,
        safeSide: 1 as const, safeX: landing, exitX: landing,
        breakable: false, state: 'stable' as const,
        // Decided here, once, so the stone that pays looks different from the moment it appears.
        breakBlock: { hits: 0, durability, slot, reward: this.random() < BREAK_BLOCK_RULES.rewardChance },
      };
    });
  }

  /**
   * A SECTION plan replaces the depth curve outright, so area tuning and run progression never
   * stack. Areas without a plan keep the endless curve, offset by the metres already descended.
   */
  private tuningAt(localDepth: number): RowTuning {
    const plan = this.context.plan;
    if (plan) {
      const quiet = localDepth < (plan.graceDepth ?? 0);
      return {
        minWidth: plan.platformWidth[0], maxWidth: plan.platformWidth[1], gap: plan.gap,
        enemyChance: quiet ? 0 : plan.enemyChance, flyChance: quiet ? 0 : plan.flyChance,
        toughChance: plan.toughChance, heavyChance: plan.heavyChance, comboBias: plan.comboBias,
        containerChance: plan.containerChance ?? 0,
        maxOxygenGap: plan.maxOxygenGap ?? Infinity, bubbleOffside: plan.bubbleOffside ?? 0,
        lavaPoolChance: quiet ? 0 : plan.lavaPoolChance ?? 0, lavaWallChance: quiet ? 0 : plan.lavaWallChance ?? 0,
        ventChance: quiet ? 0 : plan.ventChance ?? 0, iceChance: plan.iceChance ?? 0, iceOffside: plan.iceOffside ?? 0,
        breakableChance: quiet ? 0 : plan.breakableChance ?? 0, maxBreakableRun: plan.maxBreakableRun ?? Infinity,
        // SPIKE is instant death, so the opening grace period holds it back like everything lethal.
        spikeChance: quiet ? 0 : plan.spikeChance ?? 0, spikeKinds: plan.spikeKinds ?? [],
        // A SPIKE PLATFORM only ever deals ordinary damage, but the grace period still holds it
        // back: the opening metres are where the controls are learned, not where they are tested.
        spikePlatformChance: quiet ? 0 : plan.spikePlatformChance ?? 0,
        // LIMBO's barbs are held back by the opening grace too: the first metres of a SECTION are
        // where a player gets their bearings, not where the floor is taken away from them.
        limboHazardChance: quiet ? 0 : plan.limboHazardChance ?? 0,
        // Every row a barb row means no landing to keep a lane clear for -- see placeDoodad.
        groundless: (plan.limboHazardChance ?? 0) >= 1,
        doodadChance: quiet ? 0 : plan.doodadChance ?? 0,
      };
    }
    const curve = difficultyAt((this.context.depthOffset ?? 0) + localDepth);
    return { minWidth: curve.minWidth, maxWidth: curve.maxWidth, gap: curve.gap, enemyChance: curve.enemyChance, flyChance: curve.flyChance, toughChance: curve.spikeChance, heavyChance: curve.tankChance, comboBias: 0, containerChance: 0, maxOxygenGap: Infinity, bubbleOffside: 0, lavaPoolChance: 0, lavaWallChance: 0, ventChance: 0, iceChance: 0, iceOffside: 0, breakableChance: 0, maxBreakableRun: Infinity, spikeChance: 0, spikeKinds: [], spikePlatformChance: 0, limboHazardChance: 0, groundless: false, doodadChance: 0 };
  }

  /**
   * How far down the next row goes. A band names its own range outright; without one this is the
   * SECTION's single `gap` plus the jitter it has always had.
   */
  private rowStep(tuning: RowTuning, band: RhythmBand | null, intent: RowIntent | null) {
    if (intent) return intent.step;
    return band && this.rhythm ? this.rhythm.step(band) : tuning.gap + this.random() * 28;
  }

  /**
   * The extra ledges of a LEDGE CLUSTER band: more than one place to land at the same height.
   *
   * They are laid beside the route ledge, never instead of it, and they are bounded by the one
   * thing that makes a multi-ledge band safe -- the next row has to be reachable from all of them.
   * That intersection is open only while the band's exit points lie within twice the horizontal
   * reach of each other, so the spread is held to 1.5x the reach of the step this band is about to
   * take. A ledge that will not fit inside that window is simply not laid; a cluster with one
   * fewer ledge is a cluster, a cluster that closes the route is a dead end.
   *
   * Extras carry no enemies. They are a choice of landing, and loading them would quietly raise the
   * AREA's enemy count every time a cluster appeared -- which is the terrain being propped up by
   * something that is not terrain.
   */
  private layExtras(intent: RowIntent, route: RoutePlatform, y: number, tuning: RowTuning): RoutePlatform[] {
    const out: RoutePlatform[] = [];
    if (!intent.extras) return out;
    const window = horizontalReach(intent.step, this.context.water) * 1.5;
    for (let n = 0; n < intent.extras; n++) {
      const [lo, hi] = intent.extraWidth ?? intent.ledgeWidth ?? [tuning.minWidth * 0.45, tuning.minWidth * 0.75];
      const width = Math.round(lo + this.random() * (hi - lo));
      const taken = [route, ...out];
      const options: RoutePlatform[] = [];
      for (let x = WORLD.wall; x <= WORLD.width - WORLD.wall - width; x += 2) {
        // Clear of every ledge already in this band, with room to stand between them.
        if (taken.some(p => x < p.x + p.width + 24 && x + width + 24 > p.x)) continue;
        for (const side of [-1, 1] as const) {
          const p: RoutePlatform = {
            id: this.id, x, y, width, safeSide: side,
            safeX: side === -1 ? x + 26 : x + width - 26,
            exitX: side === -1 ? x - 12 : x + width + 12,
            breakable: false, state: 'stable',
          };
          if (p.exitX < WORLD.wall + 12 || p.exitX > WORLD.width - WORLD.wall - 12) continue;
          // Reachable from the band above, and close enough to the rest of this band that the row
          // below can still be reached from every one of them.
          if (!this.previousBand.every(from => canReachPlatform(from, p, this.context.water))) continue;
          if (taken.some(q => Math.abs(q.exitX - p.exitX) > window)) continue;
          options.push(p);
        }
      }
      if (!options.length) break;
      const chosen = options[Math.min(options.length - 1, Math.floor(this.random() * options.length))];
      this.id++;
      out.push(chosen);
    }
    return out;
  }

  /**
   * A CATACOMB row whose SHAPE is the point: a BAFFLE or a SLOT. Built directly, not searched for.
   *
   * Both are defined by where the band above lets the player off -- its exits, `lo`..`hi` -- because
   * that is where a fall arrives:
   *
   *   BAFFLE  one shelf from a wall, wide enough to COVER every exit above it with a body and a margin
   *           to spare. The landing (`safeX`) is directly under the exits and the way off is the far
   *           end, so reaching the landing needs no steering at all -- a stronger guarantee than
   *           reach -- and leaving it means walking across. Consecutive baffles alternate walls, and
   *           two shelves of the grammar's widths always overlap, so every straight line down meets
   *           one of any two in a row.
   *   SLOT    two shelves from both walls with a gap between. The gap is put on the far side of the
   *           exits, so the fall lands on a shelf (the route) and the gap is somewhere to walk to --
   *           or to steer for. Both shelves' exits open onto the gap, so the band below is reached
   *           from either.
   *
   * Returns null when the shape cannot be laid here safely -- a baffle that would not cover the
   * exits, a slot with no room -- and the row falls back to the ordinary candidate search. A shape is
   * never forced; the route is.
   */
  private shapeRow(intent: RowIntent, y: number, width: number): { route: RoutePlatform; others: RoutePlatform[] } | null {
    const exits = this.previousBand.map(p => p.exitX);
    const lo = Math.min(...exits), hi = Math.max(...exits), mid = Math.round((lo + hi) / 2);
    const right = WORLD.width - WORLD.wall;
    const reachable = (p: RoutePlatform) => this.previousBand.every(from => canReachPlatform(from, p, this.context.water));
    // A body is 9px either side of centre; 12 more is room for the fall to wander.
    const MARGIN = 21;
    if (intent.baffle) {
      const preferred: -1 | 1 = this.baffleSide !== 0 ? this.baffleSide : mid < WORLD.width / 2 ? -1 : 1;
      for (const side of [preferred, -preferred as -1 | 1]) {
        const x = side === -1 ? WORLD.wall : right - width;
        if (x + MARGIN > lo || hi > x + width - MARGIN) continue;
        const p: RoutePlatform = {
          id: this.id, x, y, width, safeSide: side === -1 ? 1 : -1, safeX: mid,
          exitX: side === -1 ? x + width + 12 : x - 12, breakable: false, state: 'stable', shaped: 'baffle',
        };
        if (p.exitX < WORLD.wall + 12 || p.exitX > right - 12 || !reachable(p)) continue;
        this.baffleSide = side === -1 ? 1 : -1;
        this.id++;
        return { route: p, others: [] };
      }
      this.baffleSide = 0;
      return null;
    }
    if (intent.slot) {
      this.baffleSide = 0;
      const [g0, g1] = intent.slot;
      const gap = Math.round(g0 + this.random() * (g1 - g0));
      const total = right - WORLD.wall - gap;
      const SHELF = 70;
      const leftCovers = mid < WORLD.width / 2;
      // The left shelf's width decides where the gap is. Keep the covering shelf over the exits.
      const [wMin, wMax] = leftCovers
        ? [Math.max(SHELF, hi + MARGIN - WORLD.wall), total - SHELF]
        : [SHELF, Math.min(total - SHELF, lo - MARGIN - gap - WORLD.wall)];
      if (wMax < wMin) return null;
      const wl = Math.round(wMin + this.random() * (wMax - wMin)), wr = total - wl;
      const gapLeft = WORLD.wall + wl, gapRight = gapLeft + gap;
      const left: RoutePlatform = { id: 0, x: WORLD.wall, y, width: wl, safeSide: 1, safeX: 0, exitX: gapLeft + 12, breakable: false, state: 'stable' };
      const rightShelf: RoutePlatform = { id: 0, x: gapRight, y, width: wr, safeSide: -1, safeX: 0, exitX: gapRight - 12, breakable: false, state: 'stable' };
      const [route, other] = leftCovers ? [left, rightShelf] : [rightShelf, left];
      route.safeX = mid;
      // The other shelf's landing is its near end, by the gap: somewhere a player could steer to.
      other.safeX = other === left ? gapLeft - 26 : gapRight + 26;
      if (!reachable(route)) return null;
      route.id = this.id++; other.id = this.id++;
      return { route, others: [other] };
    }
    return null;
  }

  /** A spike platform for this ledge, with its own warning when the SECTION asks for one. */
  private spikeFor(p: RoutePlatform) {
    const fixed = this.context.plan?.spikeWarning;
    if (fixed !== undefined) {
      // The fixed warning, unless this ledge needs longer to leave: from the worst place a fall can land
      // on it, the walk to the nearest edge that is not against a wall, plus 0.15s to react. A
      // free-standing ledge up to ~230px is left in the fixed time; one held against a wall
      // must be walked its whole width. Nobody is ever caught who moves at once.
      const leftOpen = p.x > WORLD.wall + 4, rightOpen = p.x + p.width < WORLD.width - WORLD.wall - 4;
      const walk = leftOpen && rightOpen ? p.width / 2 + 9 : p.width + 9;
      return spikePlatform(Math.max(fixed, walk / BALANCE.moveSpeed + 0.15));
    }
    const reaction = this.context.plan?.spikeReaction;
    return spikePlatform(reaction === undefined ? undefined : (p.width + 18) / BALANCE.moveSpeed + reaction);
  }

  private pick<T>(items: readonly T[]) { return items[Math.min(items.length - 1, Math.floor(this.random() * items.length))]; }
  /** Draw inside a tier by spawnWeight, so a rewarding enemy can stay uncommon without a special case. */
  private weighted(kinds: readonly EnemyKind[]): EnemyKind {
    const total = kinds.reduce((sum, kind) => sum + ENEMY_TYPES[kind].spawnWeight, 0);
    let roll = this.random() * total;
    for (const kind of kinds) { roll -= ENEMY_TYPES[kind].spawnWeight; if (roll <= 0) return kind; }
    return kinds[kinds.length - 1];
  }
  /** Weight class first, then any enemy of that class that fits the slot and the ledge. */
  private kindFor(slot: 'guard' | 'open', tuning: RowTuning, platformWidth = Infinity): EnemyKind | undefined {
    const roll = this.random();
    const threat = roll < tuning.heavyChance ? 'heavy' : roll < tuning.heavyChance + tuning.toughChance ? 'armored' : 'basic';
    const usable = (kind: EnemyKind) => {
      const type = ENEMY_TYPES[kind];
      return (type.spawnSlot === slot || type.spawnSlot === 'any') && (type.minPlatformWidth ?? 0) <= platformWidth;
    };
    const wanted = this.pool.filter(kind => usable(kind) && ENEMY_TYPES[kind].threat === threat);
    if (wanted.length) return this.weighted(wanted);
    const fallback = this.pool.filter(kind => usable(kind) && ENEMY_TYPES[kind].threat === 'basic');
    return fallback.length ? this.weighted(fallback) : undefined;
  }

  /** Where this generator has built up to, so another one can carry on from the same place. */
  get frontier() { return this.nextY; }
  get lastRow(): RoutePlatform { return this.previous; }

  /** True once the exit floor has been laid. The shaft has a bottom and nothing follows it. */
  get finished() { return this.done; }
  get frontierRow() { return this.previous; }

  /**
   * Lay the way out: a floor spanning the whole shaft with the gate standing on it. Because it
   * is a floor, nothing falls past it and there is nothing below it to farm -- which is what
   * bounds the SECTION now that 200m no longer ends it. Called once, when the player has
   * actually earned it, so the exit is never visible from far above.
   */
  layExit(y: number, previous: RoutePlatform): { floor: RoutePlatform; exit: StageExit } {
    const floor: RoutePlatform = {
      id: this.id++, x: WORLD.wall, y, width: WORLD.width - WORLD.wall * 2,
      safeSide: 1,
      safeX: Math.max(WORLD.wall + 26, Math.min(WORLD.width - WORLD.wall - 26, previous.exitX)),
      exitX: WORLD.width - WORLD.wall - 26, breakable: false, state: 'stable',
    };
    const gateX = Math.max(WORLD.wall + 8, Math.min(WORLD.width - WORLD.wall - EXIT_RULES.width - 8, Math.round(floor.safeX - EXIT_RULES.width / 2)));
    this.previous = floor;
    this.done = true;
    return { floor, exit: { x: gateX, y: y - EXIT_RULES.height, width: EXIT_RULES.width, height: EXIT_RULES.height } };
  }

  chunk(index: number): { platforms: RoutePlatform[]; enemies: Enemy[]; pickups: Pickup[]; hazards: Hazard[]; containers: AirContainer[]; doodads: Doodad[]; safeZones: SafeZone[]; caves: SideCave[]; exit?: StageExit } {
    const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], pickups: Pickup[] = [], hazards: Hazard[] = [], containers: AirContainer[] = [], doodads: Doodad[] = [], safeZones: SafeZone[] = [], caves: SideCave[] = [];
    let exit: StageExit | undefined;
    const start = index * WORLD.chunkHeight, end = start + WORLD.chunkHeight;
    // Carry nextY and the previous safe exit across chunk boundaries: no compressed seams.
    while (this.nextY < end && !this.done) {
      const y = this.nextY, localDepth = Math.max(0, (y - WORLD.startY) / WORLD.pixelsPerMeter);

      const tuning = this.tuningAt(localDepth);
      // One band per row, drawn before anything else the row needs, so the step and the ledge width
      // come from the same decision. Null outside a rhythm, and then nothing below behaves anew.
      //
      // A row with a chamber due on it asks for a band roomy enough to cut one into: `safeZoneCount`
      // is a guaranteed minimum, and a tight band would have silently demoted it to a chance.
      const chamberDue = this.chambers.length > 0 && localDepth >= this.chambers[0];
      const clearance = chamberDue ? safeZoneRowClearance() : 0;
      const gateDue = this.gates.length > 0 && localDepth >= this.gates[0];
      // A piece owns the whole row -- step, width, where the ledge sits and how many there are --
      // so the rhythm walker is not consulted when one is running. Null leaves both off and the row
      // behaves exactly as it did before either existed.
      const intent = this.planner ? this.planner.next(y, clearance, gateDue) : null;
      const band = this.rhythm && !intent ? this.rhythm.current(clearance) : null;
      // The air lookahead needs the step this row is ABOUT to take, so it is settled here and
      // then used for `nextY` as well -- one decision, read twice. Computed only where air is
      // generated, so every AREA that draws its step from `random()` still draws it at exactly the
      // point in the stream it always has.
      const plannedStep = this.context.oxygen ? this.rowStep(tuning, band, intent) : undefined;
      // A gate row takes the whole row: no ledge, no enemies, no hazards, nothing to collect. It is
      // a wall across the shaft and the pause it creates is the point.
      if (gateDue) {
        this.gates.shift();
        const blocks = this.breakBlockRow(y);
        if (y >= start) platforms.push(...blocks);
        /**
         * AIR STILL BELONGS IN THE WATER ABOVE A GATE.
         *
         * A gate row carries no furniture of its own, and until now that included the air check --
         * so the band above every gate was the one place in the SECTION where `maxOxygenGap` had no
         * enforcement point at all. The band below it is the next row's business, which makes a gate
         * a TWO-band blind spot, and the lookahead in `placeAir` can only widen its threshold: it
         * cannot put a source in a band it is never called for.
         *
         * At CATACOMB spacing two bands came to ~500px and the ceiling was never troubled. In open
         * water they come to 1080px, and measured before this line existed, 300 of 300 3-1 SECTIONs
         * breached their own 30m ceiling, the worst by 24m. The source goes in the open water ABOVE
         * the stone, which is where the fall actually passes -- `placeAir` centres it in the band and
         * the band stops 54px short of the row, so it can never be buried in the gate itself.
         *
         * Only an AREA whose air drains ever reaches this: `context.oxygen` is false everywhere else,
         * so no other AREA's gate rows draw so much as a random number differently.
         */
        if (this.context.oxygen) this.placeAir(tuning, blocks[0], y, start, containers, enemies, plannedStep!);
        // Any block will do as the route anchor: they all share the landing spot by construction.
        this.previous = blocks[0];
        this.previousBand = [blocks[0]];
        // A gate row spans the shaft, so it asks no horizontal question: the row after it is free.
        this.lastLane = null;
        this.nextY += plannedStep ?? this.rowStep(tuning, band, intent);
        continue;
      }
      // A band draws from its own slice of the SECTION's width range -- tight rows land wider,
      // open rows narrower -- so width stops being a coin flip independent of the descent's shape.
      // The AREA's declared envelope is never exceeded, and without a band the slice is the whole
      // range, which is the single roll this has always been.
      const [widthLow, widthHigh] = intent ? intent.widthBias : band ? band.widthBias : [0, 1] as const;
      const width = intent?.ledgeWidth
        ? Math.round(intent.ledgeWidth[0] + this.random() * (intent.ledgeWidth[1] - intent.ledgeWidth[0]))
        : Math.round(tuning.minWidth + (widthLow + this.random() * (widthHigh - widthLow)) * (tuning.maxWidth - tuning.minWidth));
      // A CATACOMB BAFFLE or SLOT is built directly rather than searched for: see `shapeRow`. Every
      // other row, in every AREA, goes through the candidate search below exactly as it always has.
      const shaped = intent && (intent.baffle || intent.slot) ? this.shapeRow(intent, y, width) : null;
      let platform!: RoutePlatform;
      if (shaped) {
        platform = shaped.route;
        this.lastLane = laneOf(platform, WORLD.wall, WORLD.width - WORLD.wall * 2);
      } else {
      const candidates: RoutePlatform[] = [];
      // A finite set always includes both extremes. Random ordering cannot defeat safety.
      for (let x = WORLD.wall; x <= WORLD.width - WORLD.wall - width; x += 2) {
        for (const side of [-1, 1] as const) {
          const p = { id: this.id, x, y, width, safeSide: side, safeX: side === -1 ? x + 26 : x + width - 26, exitX: side === -1 ? x - 12 : x + width + 12 };
          // Reachable from every ledge of the band above, not just from the route one. Outside a
          // cluster the band is a single ledge and this is the rule it has always been.
          if (p.exitX >= WORLD.wall + 12 && p.exitX <= WORLD.width - WORLD.wall - 12
            && this.previousBand.every(from => canReachPlatform(from, p, this.context.water))) candidates.push(p);
        }
      }
      // Bounded widths/gaps leave candidates even when departing beside either wall.
      if (!candidates.length) throw new Error(`No reachable platform at ${y}`);
      let choices = candidates;
      if (intent?.hug) {
        // Hold the route against the channel's wall. When nothing there is reachable yet, take the
        // candidate that best prepares for it instead -- a channel is walked into, not jumped to.
        const distance = (p: RoutePlatform) => intent.hug === -1 ? p.x - WORLD.wall : WORLD.width - WORLD.wall - p.x - p.width;
        const touching = candidates.filter(p => distance(p) <= 2);
        const target = intent.hug === -1 ? WORLD.wall + width - 26 : WORLD.width - WORLD.wall - width + 26;
        const preparation = (p: RoutePlatform) => Math.abs(p.exitX - target);
        const nearest = Math.min(...candidates.map(preparation));
        choices = touching.length ? touching : candidates.filter(p => preparation(p) <= nearest + 2);
      } else if (this.rowsSinceWall >= 3) {
        // Periodically close each wall lane; don't let a single held direction bypass a run.
        // If the wall is too far, choose the nearest reachable stepping stone first.
        const distance = (p: RoutePlatform) => this.wallToCover === -1 ? p.x - WORLD.wall : WORLD.width - WORLD.wall - p.x - p.width;
        const touching = candidates.filter(p => distance(p) <= 2);
        const targetLanding = this.wallToCover === -1 ? WORLD.wall + width - 26 : WORLD.width - WORLD.wall - width + 26;
        const preparation = (p: RoutePlatform) => Math.abs(p.exitX - targetLanding);
        const nearest = Math.min(...candidates.map(preparation));
        choices = touching.length ? touching : candidates.filter(p => preparation(p) <= nearest + 2);
      } else if (this.rhythm && this.lastLane) {
        // Don't ask for the same horizontal answer twice running. Left and right are the same
        // question mirrored, so they fold together and only the distance across the shaft counts.
        // Applied ONLY when the row is otherwise free: the wall-alternation rule above outranks it,
        // because that one is what stops a single held direction walking past a whole SECTION.
        const fresh = choices.filter(p => laneOf(p, WORLD.wall, WORLD.width - WORLD.wall * 2) !== this.lastLane);
        if (fresh.length) choices = fresh;
      }
      platform = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
      this.baffleSide = 0;
      this.lastLane = laneOf(platform, WORLD.wall, WORLD.width - WORLD.wall * 2);
      this.rowsSinceWall++;
      const wallGap = this.wallToCover === -1 ? platform.x - WORLD.wall : WORLD.width - WORLD.wall - platform.x - platform.width;
      if (this.rowsSinceWall >= 3 && wallGap <= 8) { this.rowsSinceWall = 0; this.wallToCover = this.wallToCover === -1 ? 1 : -1; }
      this.id++;
      }
      if (this.context.breakable) {
        // The run cap is the safety net: however unlucky the rolls, a stable ledge always arrives.
        const forced = this.breakableRun >= tuning.maxBreakableRun;
        const breakable = !forced && this.random() < tuning.breakableChance;
        platform.breakable = breakable;
        platform.state = 'stable';
        this.breakableRun = breakable ? this.breakableRun + 1 : 0;
      }
      // Ground that turns on the player, and ground that was never a floor. Both are rolled here
      // rather than laid as separate furniture, so each IS the row: a row cannot be both a rest and
      // a trap, and the route's own maths are untouched either way. A gate row carries neither -- a
      // BREAK BLOCK is already its own problem.
      if (this.random() < tuning.limboHazardChance) platform.limboHazard = true;
      // A row's own `spikeChance` overrides the SECTION's; rows that state none use the SECTION's. On a
      // SLOT it applies to both shelves -- the other one is rolled just below.
      else if (this.random() < (intent?.spikeChance ?? tuning.spikePlatformChance)) platform.spikePlatform = this.spikeFor(platform);
      if (y >= start) platforms.push(platform);
      // More than one ledge in this band, when the piece asked for it. Laid before the chamber and
      // the doodad are placed, so both see them and keep clear the way they keep clear of any ledge.
      const extras = shaped ? shaped.others : intent ? this.layExtras(intent, platform, y, tuning) : [];
      if (shaped && intent?.slot) for (const other of extras) if (this.random() < (intent.spikeChance ?? tuning.spikePlatformChance)) other.spikePlatform = this.spikeFor(other);
      // COLLAPSED REALM: some of a band's extra ledges are barbs. Only debris clear of BOTH ends of the
      // route may be: the way in -- every line from the band above's exits to this landing, which a
      // fall at full speed finishes only as it arrives -- and the way off, which starts beside it.
      if (intent?.barbChance) {
        const exits = this.previousBand.map(p => p.exitX);
        const inLeft = Math.min(...exits, platform.safeX) - LIMBO_BARB_CLEARANCE, inRight = Math.max(...exits, platform.safeX) + LIMBO_BARB_CLEARANCE;
        for (const other of extras) {
          if (this.random() >= intent.barbChance) continue;
          const near = Math.min(Math.abs(other.x - platform.exitX), Math.abs(other.x + other.width - platform.exitX));
          const covers = platform.exitX > other.x && platform.exitX < other.x + other.width;
          const onTheWayIn = other.x < inRight && other.x + other.width > inLeft;
          if (!covers && !onTheWayIn && near >= LIMBO_BARB_CLEARANCE) other.limboHazard = true;
        }
      }
      if (y >= start) platforms.push(...extras);

      let guard: Enemy | undefined;
      if (this.random() < tuning.enemyChance) {
        // Reserve 60px at the landing/exit side for the player's body and movement.
        //
        // A shaped row is walked from where the fall lands to its far end, so that whole stretch is
        // the route: a guard may only stand in the dead end on the other side of the landing, 40px
        // clear of it, where the player walks AWAY from it. Nothing is ever between a landing and
        // the way on.
        const deadEnd = shaped
          ? (platform.safeSide === -1 ? [platform.safeX + 40, platform.x + platform.width - 20] : [platform.x + 20, platform.safeX - 40])
          : null;
        const min = deadEnd ? deadEnd[0] : platform.safeSide === -1 ? platform.x + 78 : platform.x + 20;
        const max = deadEnd ? deadEnd[1] : platform.safeSide === -1 ? platform.x + width - 20 : platform.x + width - 78;
        // STAGE FLOW v2: this row's guard may stand beside the landing instead of at the far end.
        const beside = !shaped && max >= min && this.flow && this.random() < this.flow.landingGuards ? this.landingGuard(platform, tuning) : null;
        if (beside) {
          guard = beside;
          if (y >= start) enemies.push(guard);
        } else {
          const kind = max >= min ? this.kindFor('guard', tuning, width) : undefined;
          if (kind) {
            // A hopper (TOAD, BONE HOPPER) may use the whole stretch a guard is allowed; anything else
            // patrols the short sway it always has.
            const hops = ENEMY_TYPES[kind].behaviour === 'frog' || ENEMY_TYPES[kind].behaviour === 'groundSkull';
            guard = this.enemy(kind, (min + max) / 2, y - 15, hops ? (max - min) / 2 : Math.min(22, (max - min) / 2), 'guard');
            if (y >= start) enemies.push(guard);
            // The original's ground skulls come in twos and threes: the rest of the group shares the
            // guard's stretch of ledge, spread across it, and never the landing side of it.
            if (kind === 'boneHopper' && max - min >= 60) {
              const more = 1 + (this.random() < 0.4 ? 1 : 0);
              for (let k = 1; k <= more; k++) {
                const x = min + (max - min) * (k / (more + 1));
                if (Math.abs(x - guard.originX) < 22) continue;
                const mate: Enemy = { ...this.enemy(kind, x, y - 15, Math.min(x - min, max - x), 'guard'), placed: 'group' };
                if (y >= start) enemies.push(mate);
              }
            }
          }
        }
      }

      // A row that already has a ground enemy is more likely to get an air enemy, on the same side:
      // stomping the pair is a route the player can choose, never one forced on the safe path.
      // STAGE FLOW v2: this row's flyer may be laid across the fall itself, where it has to be answered.
      // The roll that decides WHETHER there is a flyer is the one it always was; only where it goes can
      // change, and when no line across the fall passes the checks it goes where it always went.
      const onPath = this.openKinds && this.flow ? this.random() < this.flow.pathFlyers : false;
      const flies = this.openKinds && this.random() < tuning.flyChance + (guard ? tuning.comboBias : 0);
      // The kind is rolled ONCE per flyer and then placed. It used to be rolled inside the path rule and
      // again by the fallback, so a row whose path placement came up empty got a second chance at a
      // flyer -- invisible while every AREA had a basic flyer, +70% flyers in a roster without one.
      const flyKind = flies ? this.kindFor('open', tuning) : undefined;
      const pathFlyer = flyKind && onPath ? this.pathFlyer(flyKind, platform, y) : undefined;
      if (pathFlyer) { if (y >= start) enemies.push(pathFlyer, ...this.companions(pathFlyer, enemies.filter(o => Math.abs(o.y - pathFlyer.y) < 200))); }
      else if (flyKind) {
        // Patrol outside the entire envelope of this safe transfer, including the wing span.
        const corridorLeft = Math.min(this.previous.exitX, platform.safeX) - 48;
        const corridorRight = Math.max(this.previous.exitX, platform.safeX) + 48;
        const regions = [[62, corridorLeft - 26], [corridorRight + 26, 388]].filter(([a, b]) => b - a >= 20);
        if (regions.length) {
          const nearGuard = guard ? regions.reduce((best, region) => Math.abs((region[0] + region[1]) / 2 - guard!.originX) < Math.abs((best[0] + best[1]) / 2 - guard!.originX) ? region : best) : undefined;
          const [left, right] = nearGuard ?? regions[Math.floor(this.random() * regions.length)];
          const range = Math.min(32, (right - left) / 2);
          const kind = flyKind;
          const e = ENEMY_TYPES[kind].behaviour === 'bat' ? this.hangingBat(kind, y) : this.enemy(kind, (left + right) / 2, y - 115, range, 'open');
          if (e && y >= start) enemies.push(e, ...this.companions(e, enemies.filter(o => Math.abs(o.y - e.y) < 200)));
        }
      }
      // A GHOST due at this depth waits inside a wall just above this row. It is in the brickwork, so
      // it can never sit on a ledge, block a landing or share a band with anything; it only becomes
      // part of the shaft when the player has gone 200px past it.
      if (this.ghostDepths.length && localDepth >= this.ghostDepths[0]) {
        this.ghostDepths.shift();
        const ghost = spawnEnemy('ghost', this.id++, this.ghostSide === -1 ? GHOST_RULES.wallDepth : WORLD.width - GHOST_RULES.wallDepth, y - 90, 0, 0, 'open');
        ghost.ai = dormantGhost(this.context.plan!.ghosts!.speed);
        this.ghostSide = this.ghostSide === -1 ? 1 : -1;
        if (y >= start) enemies.push(ghost);
      }

      if (this.context.oxygen) this.placeAir(tuning, platform, y, start, containers, enemies, plannedStep!);
      if (this.context.heat) this.placeHeat(tuning, platform, y, width, start, pickups, hazards, enemies);
      this.placeSpikes(tuning, platform, y, width, start, hazards, enemies, containers);
      this.placeDoodad(tuning, platform, y, start, doodads, hazards, enemies);
      const laneBand = this.context.plan?.laneDoodadBand;
      if (laneBand !== undefined && y - this.previous.y >= laneBand) this.placeLaneDoodad(platform, y, start, doodads, hazards, enemies);
      this.placeSafeZone(platform, y, localDepth, start, safeZones, caves, platforms, hazards, enemies, containers);
      // (Laid AFTER the row's air, doodad and chamber, so it can keep clear of them.)
      // DOWNWELL NORMAL GAMEPLAY CLONE: more of the shaft's inhabitants, loose in the band above this
      // row. The original's wells are full of things that come for you; one guard and one flyer per
      // row was never that. Each is a roaming kind -- it will not stay where it was put -- so where it
      // starts matters only for being seen: it is kept off the line the fall takes into this landing.
      const swarm = this.context.plan?.swarm ?? 0;
      // Quiet rows (a SECTION's opening grace) have their flyer chance zeroed, and lay no swarm either.
      if (swarm > 0 && tuning.flyChance > 0 && this.openKinds && y - this.previous.y >= 170) {
        const extra = Math.floor(swarm) + (this.random() < swarm % 1 ? 1 : 0);
        for (let i = 0; i < extra; i++) {
          const kind = this.kindFor('open', tuning);
          if (!kind) break;
          const band = enemies.filter(o => o.y > this.previous.y - 40 && o.y < y + 10);
          const e = ENEMY_TYPES[kind].behaviour === 'bat' ? this.hangingBat(kind, y) : this.looseEnemy(kind, platform, y, band, [
            ...containers.map(c => ({ x: c.x - 24, y: c.y - 24, width: c.width + 48, height: c.height + 48 })),
            ...doodads.map(d => { const z = doodadBounceZone(d, this.context.water?.gravity ?? 1); return { x: z.minX, y: z.minY, width: z.maxX - z.minX, height: z.maxY - z.minY }; }),
            ...safeZones.map(z => ({ x: z.x - 20, y: z.y - 20, width: z.width + 40, height: z.height + 40 })),
            ...platforms.filter(q => Math.abs(q.y - y) < 400).map(q => ({ x: q.x - 16, y: q.y - 30, width: q.width + 32, height: 50 })),
          ]);
          if (e && !band.some(o => Math.hypot(o.x - e.x, o.y - e.y) < 40) && y >= start) enemies.push(e, ...this.companions(e, band));
        }
      }
      // No weapon crate and no shop doorway are laid in the shaft. Both are SAFE ZONE content and
      // nothing else, so a run is re-armed and re-supplied by finding a chamber -- which is what
      // makes stepping off the fall line to reach one worth doing.
      this.previous = platform;
      // A barb block is not somewhere a fall can leave from, so the next row answers only to landings.
      this.previousBand = [platform, ...extras.filter(p => !p.limboHazard)];
      this.nextY += plannedStep ?? this.rowStep(tuning, band, intent);
    }
    return { platforms, enemies, pickups, hazards, containers, doodads, safeZones, caves, exit };
  }

  /**
   * A DOODAD hangs in the open band between two rows.
   *
   * Where ground exists it is kept out of the lane the safe transfer flies through, so bouncing off
   * one is a choice rather than something a fall blunders into.
   *
   * Where there is NO ground -- LIMBO, whose rows are barbs the fall passes through -- that lane is
   * not a route between ledges any more, but something still has to be kept clear. Doodads are the
   * AREA's only reload, so they are dense; dense enough, left unchecked, to carpet the shaft and
   * turn a descent into an endless trampoline with no way down. LIMBO therefore reserves a fall lane
   * of its own, alternating from row to row, so a way past is always open and finding it is a matter
   * of steering rather than luck.
   */
  private placeDoodad(tuning: RowTuning, platform: RoutePlatform, y: number, start: number, doodads: Doodad[], hazards: Hazard[], enemies: Enemy[]) {
    if (this.random() >= tuning.doodadChance) return;
    const bandTop = this.previous.y + 70, bandBottom = y - 70;
    if (bandBottom - bandTop < 20) return;
    const bandY = Math.round(bandTop + (bandBottom - bandTop) * (0.3 + this.random() * 0.4));
    const w = DOODAD_RULES.width;
    // Outside the corridor the route actually falls through, with the same slack lava gets --
    // unless the SECTION has no landable ground at all, in which case the whole shaft is fair game.
    // The lane to keep open. Where a route exists it is that route. Where none does it is a band of
    // the shaft that walks across from row to row, so consecutive bands never close the same side and
    // a descent always has somewhere to go.
    let laneLeft: number, laneRight: number;
    if (tuning.groundless) {
      const inner = WORLD.width - WORLD.wall * 2;
      const centre = WORLD.wall + inner * (this.doodadLane % 2 ? 0.28 : 0.72);
      this.doodadLane++;
      laneLeft = centre - LIMBO_FALL_LANE / 2;
      laneRight = centre + LIMBO_FALL_LANE / 2;
    } else {
      laneLeft = Math.min(this.previous.exitX, platform.safeX) - 54;
      laneRight = Math.max(this.previous.exitX, platform.safeX) + 54;
    }
    const regions = [[WORLD.wall + 6, laneLeft - 8], [laneRight + 8, WORLD.width - WORLD.wall - 6]]
      .filter(([from, to]) => to - from >= w + 8);
    if (!regions.length) return;
    const [left, right] = regions[Math.floor(this.random() * regions.length)];
    const x = Math.round(left + this.random() * (right - left - w));
    // Never inside anything lethal, and never buried in a patrol.
    if (hazards.some(h => x < h.x + h.width + 10 && x + w > h.x - 10 && bandY < h.y + h.height + 14 && bandY + DOODAD_RULES.height > h.y - 14)) return;
    if (enemies.some(e => Math.abs(e.y - bandY) < 40 && e.originX + e.range > x - 20 && e.originX - e.range < x + w + 20)) return;
    if (y < start) return;
    // The id and the variant are drawn exactly where they always were -- see below for why.
    const id = this.id++;
    const variant = this.random() < 0.5 ? 'lamp' : 'bracket';
    /**
     * NEVER WHERE A BOUNCE WOULD MEET AN ENEMY, anywhere in that enemy's movement.
     *
     * The check above only knows where an enemy stood plus how far it slides sideways; it ignores the
     * body's own width and the room a bounce takes. That left 3 of every 15,000 enemies able to reach
     * a doodad's bounce (L-1) -- and once SUNKEN RUINS' enemies started to rise and fall, 242 of
     * 19,478 could. This asks the two real questions, `motionEnvelope` against `doodadBounceZone`,
     * and drops the doodad when they meet.
     *
     * It runs AFTER the id and the variant are spent, on purpose. Everything the SECTION lays after
     * this doodad -- ledges, shelves, air, the next doodad -- comes from the same seeded stream, so a
     * doodad dropped before its draw would move every one of them. Dropped here, the only thing that
     * changes is that this one doodad is not there.
     *
     * ONLY ENEMIES WITH A `motion` ARE ASKED. The same overlap exists elsewhere -- measured, the
     * shared sideways sway reaches 6 doodads' bounces in AREA 1's 240 sample SECTIONs, 25 in AREA 2's
     * and 91 in AREA 4's -- but those AREAs are frozen, and an enemy that has only ever slid sideways
     * is not what this pass changed. Their doodads generate exactly as they did.
     */
    const zone = doodadBounceZone({ x, y: bandY, width: w, height: DOODAD_RULES.height }, this.context.water?.gravity);
    const inTheWay = enemies.some(e => {
      // Anything that moves on its own -- a water motion, or a Downwell behaviour (dwellers.ts) -- is
      // asked the real question; a plain side-to-side patrol keeps the old check above.
      if (!ENEMY_TYPES[e.kind].motion && !ENEMY_TYPES[e.kind].behaviour) return false;
      const env = motionEnvelope(e);
      return env.minX < zone.maxX && env.maxX > zone.minX && env.minY < zone.maxY && env.maxY > zone.minY;
    });
    // Spent by the bounce that uses it, as the original's are (DOWNWELL NORMAL GAMEPLAY CLONE).
    if (!inTheWay) doodads.push(spawnDoodad(id, x, bandY, variant, true));
  }

  /**
   * LIMBO's second doodad in a tall band: ON the line the fall takes, in the band's upper middle, so a
   * long drop offers a bounce -- a reload that keeps the chain -- to a player who does nothing but fall.
   * Same refusals as any doodad: never in a hazard, never where a bounce meets an enemy's movement.
   * Its draws are always spent, whether or not it is laid, so a refusal moves nothing after it.
   */
  private placeLaneDoodad(platform: RoutePlatform, y: number, start: number, doodads: Doodad[], hazards: Hazard[], enemies: Enemy[]) {
    const top = this.previous.y, band = y - top;
    const bandY = Math.round(top + band * (0.3 + this.random() * 0.2));
    const t = (bandY - top) / band, lineX = this.previous.exitX + (platform.safeX - this.previous.exitX) * t;
    const w = DOODAD_RULES.width;
    const x = Math.round(Math.max(WORLD.wall + 6, Math.min(WORLD.width - WORLD.wall - 6 - w, lineX - w / 2 + (this.random() - 0.5) * 30)));
    const id = this.id++;
    const variant = this.random() < 0.5 ? 'lamp' : 'bracket';
    if (y < start) return;
    if (hazards.some(h => x < h.x + h.width + 10 && x + w > h.x - 10 && bandY < h.y + h.height + 14 && bandY + DOODAD_RULES.height > h.y - 14)) return;
    if (doodads.some(d => Math.abs(d.y - bandY) < 90 && Math.abs(d.x - x) < 60)) return;
    const zone = doodadBounceZone({ x, y: bandY, width: w, height: DOODAD_RULES.height }, this.context.water?.gravity);
    if (enemies.some(e => { const env = motionEnvelope(e); return env.minX < zone.maxX && env.maxX > zone.minX && env.minY < zone.maxY && env.maxY > zone.minY; })) return;
    doodads.push(spawnDoodad(id, x, bandY, variant, true));
  }

  /**
   * A SAFE ZONE chamber, cut into one wall in the band above this row. It brings its own floor, and
   * that floor is an EXTRA landing surface rather than a replacement for the row's own -- so a
   * chamber can never make the route unreachable, only offer somewhere else to put your feet.
   *
   * Everything that could make the way in unfair is refused outright rather than worked around: a
   * chamber is skipped when its mouth would sit on SPIKE, on a BREAK BLOCK, on an air container, on
   * a patrol, or on top of the row's own ledge. Skipping costs nothing; a chamber nobody can enter
   * without dying costs the player a run.
   */
  /**
   * A chamber cut into one wall of the shaft, in the open band between two rows.
   *
   * It is a SIDE CHAMBER and deliberately owes nothing to the ledge it happens to sit beside: it
   * brings its own floor, so it needs no ordinary platform to stand on and imposes no "must be a
   * solid ledge" condition of the kind the old shaft SHOP had. That is what lets AREA 4 -- where
   * every ledge collapses -- have chambers at all.
   *
   * Both walls are tried before a row is given up. Which wall a chamber goes into is alternation
   * for variety, not balance, so when the preferred side is blocked by this AREA's own furniture the
   * other side is taken rather than the whole row abandoned. With weapons, shops and veins now
   * living only in here, a SECTION that failed to cut one would be a SECTION with no supply at all.
   */
  private placeSafeZone(platform: RoutePlatform, y: number, localDepth: number, start: number, zones: SafeZone[], caves: SideCave[], platforms: RoutePlatform[], hazards: Hazard[], enemies: Enemy[], containers: AirContainer[]) {
    if (!this.chambers.length || localDepth < this.chambers[0]) return;
    // Past the clearance kept for the exit, the chance has gone: drop it rather than cut a chamber
    // where the way out has to be. Blocking the exit is the one failure worse than going without.
    const ceiling = (this.context.sectionLength ?? Infinity) - SAFE_ZONE_RULES.depthMargin;
    if (localDepth > ceiling) { this.chambers.shift(); return; }
    const bandTop = this.previous.y + 40, bandBottom = y - 30;
    const height = SAFE_ZONE_RULES.height, floorHeight = SAFE_ZONE_RULES.floorHeight;
    if (bandBottom - bandTop < height + floorHeight + 20) return;
    const width = SAFE_ZONE_RULES.width;
    /**
     * HOW FAR THE SIDE ROOM REACHES INTO THE SHAFT, and where its landing spot is.
     *
     * A chamber IS the 150px rectangle it occupies, so its own width answers both. A SIDE CAVE is
     * not: the cave is out in the rock and the only part of it inside the shaft is its SILL, which
     * comes `sillOverhang` in and no further. Reusing the chamber's width for a cave was the bug --
     * it put the landing spot at x=152/298 when the sill stops at 98/352, so placement was being
     * validated against a ledge 80px further in than exists.
     *
     * WHERE THE LANDING SPOT IS comes from the collision rule rather than from a convention. A
     * player lands while their box overlaps the slab -- `p.x + 9 > f.x && p.x - 9 < f.x + width` --
     * so the deepest point in the shaft at which the sill still holds them is its own edge, with
     * half the body over it and nine pixels to spare. A chamber keeps the 26px inset it has always
     * used, because a chamber is the rectangle and its far side is a wall to stand against.
     *
     * LEFT and RIGHT come out of one expression; neither is a special case and there is no offset
     * here that is not either the sill's own reach or the player's own width.
     */
    const footprint = this.sideRoomPilot ? CAVE_RULES.sillOverhang : width;
    const inset = this.sideRoomPilot ? 0 : 26;
    const landingX = (candidate: -1 | 1) => candidate === -1
      ? WORLD.wall + footprint - inset
      : WORLD.width - WORLD.wall - footprint + inset;
    // Sit the chamber so its floor is comfortably inside the band.
    const floorY = Math.round(bandBottom - floorHeight);
    const top = floorY - height;
    const fits = (candidate: -1 | 1) => {
      const x = candidate === -1 ? WORLD.wall : WORLD.width - WORLD.wall - footprint;
      const overlaps = (ox: number, ow: number, oy: number, oh: number) =>
        ox < x + footprint + 12 && ox + ow > x - 12 && oy < top + height + floorHeight + 12 && oy + oh > top - 12;
      if (hazards.some(h => overlaps(h.x, h.width, h.y, h.height))) return false;
      if (containers.some(c => overlaps(c.x, c.width, c.y, c.height))) return false;
      if (enemies.some(e => overlaps(e.originX - e.range - 16, e.range * 2 + 32, e.y - 20, 40))) return false;
      if (platforms.some(f => overlaps(f.x, f.width, f.y - 4, 20))) return false;
      // The row's own ledge must not stick into the mouth either.
      return !overlaps(platform.x, platform.width, platform.y - 4, 20);
    };
    /**
     * Can the fall the player is ALREADY making reach this mouth?
     *
     * `fits` only says the mouth is unobstructed. That is not the same as being able to get into
     * it: the player is falling from the row above, and steering is bounded by how long that fall
     * lasts. Measured before this check existed, 14% of chambers sat on the wall the fall could not
     * cross in time -- visible, unobstructed, and enterable only by climbing back up, which is
     * exactly the unnatural detour a side room must never ask for.
     */
    const drop = floorY - this.previous.y;
    const steering = (candidate: -1 | 1) => Math.abs(landingX(candidate) - this.previous.exitX);
    /** A. PHYSICALLY REACHABLE: can the fall that is already happening cross to the sill at all? */
    const physicallyReachable = (candidate: -1 | 1) =>
      drop > 0 && steering(candidate) <= horizontalReach(drop, this.context.water);
    /**
     * B. HUMAN-REACTABLE: can it be crossed by someone who only learns the mouth is there when it
     * appears? The camera shows CAMERA_LEAD pixels below the player, so the mouth is on screen for
     * the last part of the fall and no longer. What is left of that window once the steering is
     * paid for is thinking time, and `reactionReserve` is how much of it there has to be.
     */
    const humanReactable = (candidate: -1 | 1) => {
      if (!physicallyReachable(candidate)) return false;
      const visible = Math.min(drop, CAMERA_LEAD);
      const onScreen = fallTime(drop, this.context.water?.gravity) - fallTime(drop - visible, this.context.water?.gravity);
      return onScreen - steering(candidate) / BALANCE.moveSpeed >= SAFE_ZONE_RULES.reactionReserve;
    };
    const roomRandom = this.caveRandom ?? this.random;
    const preferred: -1 | 1 = this.nextChamberSide !== 0 ? this.nextChamberSide : (roomRandom() < 0.5 ? -1 : 1);
    const other: -1 | 1 = preferred === -1 ? 1 : -1;
    const order: (-1 | 1)[] = [preferred, other];
    /**
     * The entry rule belongs to the SIDE ROOM pilot, and only the AREA that declares `sideRooms`
     * has been measured for it. Everywhere else -- and on the `legacy` side of the A/B -- the
     * original rule runs untouched, so AREAs 2, 3 and 4 generate bit for bit as they always have.
     */
    if (!this.sideRoomPilot) {
      const plain = fits(preferred) ? preferred : fits(other) ? other : 0;
      if (plain === 0) return;
      this.cutChamber(plain, width, floorY, top, y, start, zones, caves, platforms);
      return;
    }
    // Reachable first, alternation second, unobstructed last. A chamber on the wrong wall is worse
    // than a chamber on the same wall twice, and both are better than no chamber at all.
    /**
     * Which wall, in order of how good the way in is.
     *
     * A room's depth is the EARLIEST it may appear, not where it must, so while the SECTION has
     * depth left the answer to a poor band is to wait for a better one. What the last stretch
     * settles for is the whole question, and it is graded rather than all-or-nothing:
     *
     *   1. HUMAN-REACTABLE   the mouth can be crossed to after it is seen, with thinking time left
     *   2. PHYSICALLY REACHABLE  the fall can cross to it, but only for someone already going that
     *                            way -- accepted near the exit, because a SECTION with no side room
     *                            at all is one a run cannot be supplied in
     *   3. merely unobstructed   a CHAMBER may still take this; a CAVE never does. This was how
     *                            rooms ended up on a wall the fall could not cross at all, and a
     *                            cave nobody can enter is worse than one fewer cave.
     */
    const roomToWait = localDepth < ceiling - SAFE_ZONE_RULES.depthMargin;
    const side = order.find(c => fits(c) && humanReactable(c))
      ?? (roomToWait ? 0 : order.find(c => fits(c) && physicallyReachable(c)))
      ?? (roomToWait || this.sideRoomPilot ? 0 : order.find(fits) ?? 0);
    if (side === 0) return;
    this.cutChamber(side, width, floorY, top, y, start, zones, caves, platforms);
  }

  /** Lay the chamber, once a wall has been chosen. Shared by both entry rules. */
  private cutChamber(side: -1 | 1, width: number, floorY: number, top: number, y: number, start: number, zones: SafeZone[], caves: SideCave[], platforms: RoutePlatform[]) {
    const height = SAFE_ZONE_RULES.height;
    const x = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall - width;
    this.chambers.shift();
    this.nextChamberSide = side === -1 ? 1 : -1;
    // Out of budget: the slot was scheduled and searched so the shaft is shaped the same way, and
    // then simply not cut. Nothing is drawn for a cave that is not made, on either stream.
    if (this.caveBudget <= 0) return;
    this.caveBudget--;
    if (y < start) return;
    // The first chamber of a MEMBER'S CARD section is a shop by fiat; every other one still rolls.
    const forced = this.forcedShopChambers > 0;
    if (forced) this.forcedShopChambers--;
    const roomRandom = this.caveRandom ?? this.random;
    const roll = forced ? 'shop' as const : rollSafeZoneContent(roomRandom);
    const module = roll === 'gunModule' ? rollModuleForZone(roomRandom) : undefined;
    // ALL THREE are found in a CAVE now. The shell reaches outside the shaft and brings its own
    // floor, roof and ledges, so nothing else here applies -- a cave wants no chamber rectangle,
    // and whatever it holds sits deep inside rather than against the wall.
    //
    // The archetypes differ in shape, not only in contents: a module cave is a climb, a shop is a
    // room to stand and read in, a coin cave is a two-second detour. One shell, three fixtures.
    if (this.sideRoomPilot) {
      const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
      const cave = placeCave(this.id++, side, mouthX, floorY, caveShape(roll as CaveArchetype, side),
        { kind: roll, module: module?.module, bonus: module?.bonus });
      caves.push(cave);
      // Every slab is a real platform, so landing, CHARGE and the chain behave exactly as they do
      // on any other ground. `safeZone` marks them as shelter: a cave reloads but banks no chain.
      for (const slab of cave.floors) {
        platforms.push({
          id: this.id++, x: slab.x, y: slab.y, width: slab.width,
          safeSide: side === -1 ? 1 : -1,
          safeX: side === -1 ? slab.x + slab.width - 26 : slab.x + 26,
          exitX: side === -1 ? slab.x + slab.width + 12 : slab.x - 12,
          breakable: false, state: 'stable', safeZone: cave.id,
        });
      }
      return;
    }
    const zone: SafeZone = {
      id: this.id++, side, x, y: top, width, height,
      content: { kind: roll, module: module?.module, bonus: module?.bonus },
      taken: false,
    };
    zones.push(zone);
    // The floor is a real platform so all the ordinary landing code applies unchanged; only the
    // `safeZone` marker tells GameModel not to bank a chain on it.
    platforms.push({
      id: this.id++, x, y: floorY, width,
      safeSide: side === -1 ? 1 : -1,
      safeX: side === -1 ? x + width - 26 : x + 26,
      exitX: side === -1 ? x + width + 12 : x - 12,
      breakable: false, state: 'stable', safeZone: zone.id,
    });
  }
  /**
   * SPIKE. It kills outright, so every one of these rules is a safety rule rather than a flavour:
   *
   *   - a patch only ever sits on the FAR end of a ledge from `safeX`, which is the one spot the
   *     generator guarantees the previous fall can reach, with the player's body and room to turn
   *     around reserved on top of that. Landing safely is therefore always possible;
   *   - nothing is ever laid in the fall corridor itself, because a patch lives on a ledge surface
   *     and the corridor is open water;
   *   - where air is generated, a patch is dropped outright when it would sit in the column an AIR CONTAINER is
   *     reached through, so reaching air never requires touching SPIKE. With the sheltering alcove
   *     gone, containers are the whole air supply, which makes this the rule the AREA rests on.
   */
  private placeSpikes(tuning: RowTuning, platform: RoutePlatform, y: number, width: number, start: number, hazards: Hazard[], enemies: Enemy[], containers: AirContainer[]) {
    if (!tuning.spikeKinds.length || this.random() >= tuning.spikeChance) return;
    // The landing lane that stays clear: the guaranteed touchdown spot, the player's body, and
    // enough room either side that arriving fast is never an instant death.
    const clearance = 62, patchMin = 26, patchMax = 54;
    const side: -1 | 1 = platform.safeSide === -1 ? 1 : -1;
    const from = side === 1 ? platform.safeX + clearance : platform.x + 6;
    const to = side === 1 ? platform.x + width - 6 : platform.safeX - clearance;
    if (to - from < patchMin) return;
    const patch = Math.round(Math.min(patchMax, to - from));
    const x = Math.round(side === 1 ? to - patch : from);
    const kind = this.pick(tuning.spikeKinds);
    const height = kind === 'ancientStake' || kind === 'urchinSpike' ? 18 : 12;
    // Never under an enemy's patrol: a guard standing in the teeth reads as a bug, not a threat.
    if (enemies.some(e => e.y > y - 40 && e.y <= y + 4 && e.originX + e.range > x - 14 && e.originX - e.range < x + patch + 14)) return;
    // The air AREA's guarantee (SUNKEN RUINS, AREA 3). An air source anywhere near this column means no SPIKE here at all,
    // so the route to a container or an alcove is never a route through instant death.
    const overlapsAir = (ax: number, awidth: number, ay: number, aheight: number) =>
      ax < x + patch + 26 && ax + awidth > x - 26 && ay < y + 24 && ay + aheight > y - 300;
    if (containers.some(box => overlapsAir(box.x, box.width, box.y, box.height))) return;
    if (y >= start) hazards.push(spawnHazard(kind, this.id++, x, y - height, patch, height));
  }
  /**
   * AREA 3's hazards and relief. Every lava shape is kept clear of the landing lane and of the
   * corridor the safe transfer flies through, so a seed can never wall the route off or force a
   * lethal touch; ice is clamped to a spot the same fall can steer to, leaning towards the hot side.
   */
  private placeHeat(tuning: RowTuning, platform: RoutePlatform, y: number, width: number, start: number, pickups: Pickup[], hazards: Hazard[], enemies: Enemy[]) {
    const emit = <T extends Hazard | Pickup>(list: T[], item: T) => { if (y >= start) list.push(item); };
    // The band the player actually falls through on the safe route, widened for their body.
    const corridorLeft = Math.min(this.previous.exitX, platform.safeX) - 54;
    const corridorRight = Math.max(this.previous.exitX, platform.safeX) + 54;

    const bandTop = this.previous.y + 52, bandBottom = y - 58;
    // Everything lethal lives outside the corridor the safe transfer flies through, with a further
    // 30px of slack. Lava is never on the landing ledge, so no landing can ever be fatal.
    const openRegions = () => [[WORLD.wall + 8, corridorLeft - 30], [corridorRight + 30, WORLD.width - WORLD.wall - 8]]
      .filter(([a, b]) => b - a >= 34);

    // A pool lies along the shaft floor beside the route: visible from above, and only reached by
    // deliberately steering into it.
    if (bandBottom - bandTop >= 40 && this.random() < tuning.lavaPoolChance) {
      const regions = openRegions();
      if (regions.length) {
        const [left, right] = regions[Math.floor(this.random() * regions.length)];
        const poolWidth = Math.min(right - left, 62 + Math.round(this.random() * 46));
        const poolX = left < WORLD.width / 2 ? left : right - poolWidth;
        emit(hazards, spawnHazard('lavaPool', this.id++, Math.round(poolX), Math.round(bandBottom - 14), poolWidth, 12));
      }
    }

    // A wall narrows the gap from one side, never from inside the corridor.
    if (bandBottom - bandTop >= 70 && this.random() < tuning.lavaWallChance) {
      const regions = openRegions();
      if (regions.length) {
        const [left, right] = regions[Math.floor(this.random() * regions.length)];
        const wallWidth = Math.min(30, right - left);
        const wallX = left < WORLD.width / 2 ? left : right - wallWidth;
        emit(hazards, spawnHazard('lavaWall', this.id++, Math.round(wallX), Math.round(bandTop), wallWidth, Math.round(bandBottom - bandTop)));
      }
    }

    // A vent stands on the far end of the ledge and fires upward. Its plume is checked against the
    // corridor too, so the safe line never has to thread an eruption.
    if (this.random() < tuning.ventChance) {
      const regions = openRegions();
      if (regions.length) {
        const [left, right] = regions[Math.floor(this.random() * regions.length)];
        const ventX = Math.round(left + (right - left) / 2 - 13);
        emit(hazards, spawnHazard('vent', this.id++, ventX, y - 16, 26, 16, this.random() * 4.4));
      }
    }

    // Ice: reachable from the previous exit, leaning towards the hot side by the plan's share, and
    // never buried inside lava or an enemy patrol.
    if (bandBottom - bandTop < 30 || this.random() >= tuning.iceChance) return;
    const bandY = (bandTop + bandBottom) / 2;
    const reach = horizontalReach(bandBottom - this.previous.y, this.context.water);
    const exit = this.previous.exitX;
    const clamp = (value: number) => Math.max(WORLD.wall + 22, Math.min(WORLD.width - WORLD.wall - 22, Math.max(exit - reach, Math.min(exit + reach, value))));
    // Ice is the reward for going near the heat. When this band has a hazard and the plan leans
    // risky, the shard sits inside its field and low in the band, so the detour is a descent along
    // the hot side rather than a quick clip across its edge: attack, heat up, then reset with ice.
    // Prefer a tall source: a wall or a vent keeps the player in the field for the whole descent,
    // where a flat pool is over in a moment. That is what turns the detour into a real heat cost.
    const exposure = (h: Hazard) => (h.kind === 'lavaPool' ? 0 : 1);
    const hot = hazards.filter(h => Math.abs(h.y + h.height / 2 - bandY) < 200)
      .sort((p, q) => exposure(q) - exposure(p) || Math.abs(p.y - bandY) - Math.abs(q.y - bandY))[0];
    let x: number, iceY = bandY;
    const nextToHazard = !!hot && this.random() < tuning.iceOffside;
    if (hot && nextToHazard) {
      const side = hot.x + hot.width / 2 < WORLD.width / 2 ? 1 : -1;
      const edge = side === 1 ? hot.x + hot.width : hot.x;
      x = clamp(edge + side * (18 + this.random() * 22));
      // Dropping it towards the hazard keeps the player in the field on the way in and on the way
      // out, while leaving a clear run-out above the lethal slab itself.
      iceY = Math.min(bandBottom - 22, bandY + (bandBottom - bandY) * 0.5);
    } else {
      const lean = Math.sign(exit - platform.safeX) || 1;
      x = clamp(exit + lean * tuning.iceOffside * 0.5 * reach);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const blocked = hazards.some(h => Math.abs(h.y + h.height / 2 - iceY) < h.height / 2 + 24 && x > h.x - 12 && x < h.x + h.width + 12)
        || enemies.some(e => Math.abs(e.y - iceY) < 40 && Math.abs(e.originX - x) < e.range + 30);
      if (!blocked) break;
      x = clamp(x + (attempt % 2 ? -1 : 1) * 26 * (attempt + 1));
    }
    emit(pickups, spawnPickup('ice' as PickupKind, this.id++, Math.round(x), Math.round(iceY), this.random() * Math.PI * 2));
  }

  /**
   * Air sources sit in the open water between two rows, offset from the safe landing so taking one
   * is a choice. Every candidate position is clamped to what a fall from the previous exit can
   * actually reach, and a dry run longer than the plan's ceiling forces a bubble, so no seed can
   * build a stretch the player cannot survive.
   */
  /**
   * SUNKEN RUINS (AREA 3) air, and all of it. There is one kind of source now: a sealed container that has to be
   * broken, releasing bubbles that climb away and have to be chased. The wide sheltering alcove is
   * gone -- nowhere in the shaft refills a tank simply by being stood in -- so the ceiling below is
   * the whole safety net, and it is what stops a seed building a stretch nobody could survive.
   */
  private placeAir(tuning: RowTuning, platform: RoutePlatform, y: number, start: number, containers: AirContainer[], enemies: Enemy[], nextStep: number) {
    const bandTop = this.previous.y + 46, bandBottom = y - 54;
    if (bandBottom - bandTop < 30) return;
    const bandY = (bandTop + bandBottom) / 2;
    /**
     * Place now if skipping this band would push the NEXT chance past the plan's ceiling.
     *
     * The next chance is the middle of the band this row is about to open, and `nextStep` is how
     * tall that band will be -- the step the generator has already decided on and is about to take,
     * handed in rather than guessed at.
     *
     * It used to be guessed at, as `maxRowStep`: the widest step the SECTION could possibly ask for,
     * doubled when a gate row was due next because a gate laid no air. Both of those were worked
     * around rather than fixed, and in open water the workaround ate the AREA. SUNKEN RUINS caps its
     * own lanes at the air ceiling, so `maxRowStep / pixelsPerMeter` IS `maxOxygenGap` -- which made
     * the test `bandY + ceiling - lastAirY >= ceiling` true on literally every row, and the ceiling,
     * not the plan, decided how much air the AREA had. Measured: 3-3 laid 16.2 containers where its
     * own `containerChance` asks for 3.1, and the AREA's air curve -- one source every 16.9m in 3-1
     * falling to every 33.8m in 3-3 -- flattened to 18m throughout.
     *
     * With the real step, the forcing is what it was always described as: a floor nobody reaches
     * except where the terrain genuinely outruns the plan. Gate rows now lay air of their own, so
     * there is no two-band blind spot left to double for either.
     */
    const nextChance = y + nextStep / 2;
    const overdue = (nextChance - this.lastAirY) / WORLD.pixelsPerMeter >= tuning.maxOxygenGap;
    if (!overdue && this.random() >= tuning.containerChance) return;

    // Everything an air source needs: a spot the fall from the previous exit can actually steer to,
    // leaning away from the safe landing by the plan's offside share so taking it costs a detour.
    //
    // MEASURED AT THE SOURCE'S OWN HEIGHT, not at the bottom of the band.
    //
    // A container hangs at `bandY`, the middle of the band -- but this used to be clamped against
    // the reach a fall to `bandBottom` buys, which is a longer fall and therefore more steering than
    // the player has actually had when they arrive level with the box. Measured on the old terrain
    // that was worth up to 41px of over-reach on 74% of 3-2's containers; it went unnoticed because
    // a 250px band hides the difference. Open water does not: with bands running to 1200px the same
    // optimism reached 101px, which is a container placed where the fall cannot get to it.
    //
    // The fix is to ask the question at the height the answer is needed. Nothing about how OFTEN a
    // source appears changes -- `containerChance` and the `maxOxygenGap` force are both decided
    // above this line, and no draw happens below it.
    const reach = horizontalReach(bandY - this.previous.y, this.context.water);
    const exit = this.previous.exitX;
    const lean = Math.sign(exit - platform.safeX) || (exit < WORLD.width / 2 ? 1 : -1);
    const clamp = (value: number, margin: number) =>
      Math.max(WORLD.wall + margin, Math.min(WORLD.width - WORLD.wall - margin, Math.max(exit - reach, Math.min(exit + reach, value))));

    const size = AIR_CONTAINER_RULES.size;
    let x = clamp(exit + lean * tuning.bubbleOffside * reach, size / 2 + 6);
    // Never bury a container inside an enemy's patrol.
    for (const e of enemies) if (Math.abs(e.y - bandY) < 40 && Math.abs(e.originX - x) < e.range + 30) x = clamp(x + (e.originX > x ? -1 : 1) * (e.range + 34), size / 2 + 6);
    // Round first, then clamp again: clamping and then rounding can push the source half a pixel
    // past the reach the fall actually has.
    x = clamp(Math.round(x), size / 2 + 6);
    if (y >= start) containers.push({ id: this.id++, x: x - size / 2, y: Math.round(bandY - size / 2), width: size, height: size, broken: false, debris: 0 });
    this.lastAirY = bandY;
  }

  /** This SECTION's flow profile, if it runs STAGE GENERATION v2. */
  private get flow(): StageFlowProfile | undefined { return this.context.plan?.flow; }

  /**
   * A guard standing BESIDE the landing: on the ledge interior, clear of the spot a fall arrives at
   * by the player's half-body, a margin and the guard's whole patrol. Null when the ledge has no room
   * for that, and the row falls back to the far-end guard it always had.
   */
  private landingGuard(platform: RoutePlatform, tuning: RowTuning): Enemy | null {
    const kind = this.kindFor('guard', tuning, platform.width);
    if (!kind) return null;
    const dir = platform.safeSide === -1 ? 1 : -1;          // away from the way off
    const half = ENEMY_TYPES[kind].bodyWidth / 2, range = 12, clear = 9 + 8;
    const originX = platform.safeX + dir * (clear + half + range);
    const far = originX + dir * (range + half);
    if (far < platform.x + 4 || far > platform.x + platform.width - 4) return null;
    const e = this.enemy(kind, originX, platform.y - 15, range, 'guard');
    const env = motionEnvelope(e);
    // Belt and braces: whatever the kind's own movement, the landing spot is outside all of it.
    if (env.minX < platform.safeX + 9 + 4 && env.maxX > platform.safeX - 9 - 4) return null;
    e.placed = 'landing';
    return e;
  }

  /**
   * A flyer across the fall between the band above and this row, on the line from the previous exit
   * to this landing. Laid only where the fall can still go round its WHOLE movement and make the
   * landing afterwards -- checked against `horizontalReach`, the real steering envelope -- so it is a
   * question with three answers (shoot, stomp, go round), never a wall.
   */
  private pathFlyer(kind: EnemyKind, platform: RoutePlatform, y: number): Enemy | undefined {
    // A bat hangs under a ledge, never across a fall. Every other kind -- roamers included -- STARTS on
    // the line with the same way round it, checked at the spot it is laid: a roamer that then comes
    // for the player is an answer to shoot or stomp, and it starts where a straight fall meets it.
    if (ENEMY_TYPES[kind].behaviour === 'bat') return undefined;
    const top = this.previous.y, band = y - top, exit = this.previous.exitX;
    if (band < 170) return undefined;
    const water = this.context.water;
    // Where the air goes, when the AREA has any: the middle of this same band (see `placeAir`). A
    // flyer across the fall keeps well clear of that height, so taking the air is never also meeting
    // the flyer -- the two are different answers to the same band.
    const airMiddle = this.context.oxygen ? top + 46 + ((y - 54) - (top + 46)) / 2 : null;
    const heights = airMiddle === null ? [0.5, 0.42, 0.58, 0.36, 0.64] : [0.3, 0.7, 0.25, 0.75];
    for (const t of heights) {
      const ey = Math.round(top + band * t), ex = Math.round(exit + (platform.safeX - exit) * t);
      if (airMiddle !== null && Math.abs(ey - airMiddle) < 56) continue;
      const probe = spawnEnemy(kind, -1, ex, ey, 14, 0, 'open');
      const env = motionEnvelope(probe);
      if (env.minX < WORLD.wall + 4 || env.maxX > WORLD.width - WORLD.wall - 4) continue;
      if (env.minY < top + 40 || env.maxY > y - 60) continue;
      // From EVERY ledge of the band above -- a fall can start from any of them -- there has to be a
      // way past its whole movement that still makes this landing.
      if (this.previousBand.every(from => canPassEnemy(env, from, platform, water))) return { ...this.enemy(kind, ex, ey, 14, 'open'), placed: 'path' as const };
    }
    return undefined;
  }

  /**
   * A CAVE BAT hangs under the ledge above this band, at the end away from where the fall leaves it,
   * so it drops on a player who passes rather than one standing on top of it.
   */
  private hangingBat(kind: EnemyKind, y: number): Enemy | null {
    const from = this.previous;
    if (y - from.y < 150 || from.width < 40) return null;
    let x = from.x + 16 + this.random() * (from.width - 32);
    if (Math.abs(x - from.exitX) < 44) x = from.safeSide === 1 ? from.x + 18 : from.x + from.width - 18;
    return this.enemy(kind, Math.max(WORLD.wall + 14, Math.min(WORLD.width - WORLD.wall - 14, x)), from.y + 24, 0, 'open');
  }
  /** A roaming enemy loose in the band above this row, started clear of the fall into its landing. */
  private looseEnemy(kind: EnemyKind, platform: RoutePlatform, y: number, taken: readonly Enemy[], clear: readonly { x: number; y: number; width: number; height: number }[] = []): Enemy | null {
    const top = this.previous.y, band = y - top;
    // Four candidate starts, ALWAYS all drawn, then the first clear of everything already in the band
    // (a crowded band simply gets none). Drawing a fixed number keeps the random stream the same
    // whatever was rejected -- so, e.g., a different number of side caves never changes the shaft.
    const tries = Array.from({ length: 4 }, () => [this.random(), this.random()] as const);
    for (const [ry, rx] of tries) {
      const ey = Math.round(top + 70 + ry * (band - 140));
      const t = (ey - top) / band, lineX = this.previous.exitX + (platform.safeX - this.previous.exitX) * t;
      let ex = WORLD.wall + 30 + rx * (WORLD.width - WORLD.wall * 2 - 60);
      if (Math.abs(ex - lineX) < 48) ex = lineX + (ex < lineX ? -48 : 48);
      // Its whole patrol and body inside the shaft: 24px of range and half the widest body.
      ex = Math.round(Math.max(WORLD.wall + 40, Math.min(WORLD.width - WORLD.wall - 40, ex)));
      if (taken.some(o => Math.hypot(o.x - ex, o.y - ey) < 40)) continue;
      // Its starting body clear of air, doodads, chambers and ledges (what it does next is its own).
      if (clear.some(r => ex + 16 > r.x && ex - 16 < r.x + r.width && ey + 16 > r.y && ey - 16 < r.y + r.height)) continue;
      return this.enemy(kind, ex, ey, 24, 'open');
    }
    return null;
  }
  /**
   * The original's "stuff" comes in company: a TAPERED column (VOID WISP) is one of a swarm crossing the
   * screen together, a SPHERICAL one (HOLLOW SHADE) one of a pair on the same orbit. The rest of the
   * group is laid with it, clear of what is already in the band and of the walls; a crowded band
   * simply gets a smaller group. Every other kind comes alone.
   */
  private companions(e: Enemy, band: readonly Enemy[]): Enemy[] {
    const b = ENEMY_TYPES[e.kind].behaviour;
    const out: Enemy[] = [];
    const fits = (x: number, y: number) => x > WORLD.wall + 40 && x < WORLD.width - WORLD.wall - 40
      && ![...band, e, ...out].some(o => Math.hypot(o.x - x, o.y - y) < 40);
    if (b === 'column') {
      const n = this.random() < 0.5 ? 1 : 0;
      for (let k = 1; k <= n; k++) {
        const x = e.originX + (k % 2 ? 46 : -46) * Math.ceil(k / 2), y = (e.originY ?? e.y) + (k % 2 ? -34 : 34);
        // Same phase, so the same direction: a column crosses together.
        if (fits(x, y)) out.push({ ...spawnEnemy(e.kind, this.id++, x, y, e.range, e.phase, 'open'), placed: 'group' });
      }
    } else if (b === 'orbit') {
      const mate = spawnEnemy(e.kind, this.id++, e.originX, e.originY ?? e.y, e.range, e.phase + Math.PI, 'open');
      out.push({ ...mate, placed: 'group' });
    }
    return out;
  }
  private enemy(kind: EnemyKind, x: number, y: number, range: number, slot: 'guard' | 'open'): Enemy {

    return spawnEnemy(kind, this.id++, x, y, range, this.random() * Math.PI * 2, slot);
  }
}
export { enemyType, spawnEnemy };
