import { WORLD } from '../data/balance';
import { difficultyAt, horizontalReach } from '../data/difficulty';
import { ENEMY_TYPES, enemyType, spawnEnemy, type Enemy, type EnemyKind } from '../data/enemies';
import { spawnPickup, type Pickup, type PickupKind } from '../data/pickups';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES, breakBlockWidth, EXIT_RULES, spikePlatform, type AirContainer, type SpikePlatform, type StageExit } from '../data/structures';
import { spawnHazard, type Hazard, type SpikeKind } from '../data/hazards';
import { spawnDoodad, DOODAD_RULES, type Doodad } from '../data/doodads';
import { rollSafeZoneContent, safeZoneDepths, safeZoneRowClearance, SAFE_ZONE_RULES, type SafeZone } from '../data/safeZone';
import { rollGunModule as rollModuleForZone } from '../data/gunModules';
import type { SectionPlan, WaterPhysics } from '../data/areas';
import { RhythmWalker, getTerrainMode, laneOf, type RhythmBand } from '../data/rhythm';
import { PiecePlanner, type RowIntent } from '../data/pieces';

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
export interface RoutePlatform extends Platform { safeX: number; exitX: number; safeSide: -1 | 1 }
export const START_PLATFORM: RoutePlatform = { id: -2, x: 155, y: 250, width: 140, safeX: 225, exitX: 307, safeSide: 1, breakable: false, state: 'stable' };
export const canReachPlatform = (from: RoutePlatform, to: RoutePlatform, water?: WaterPhysics) => to.y > from.y && Math.abs(to.safeX - from.exitX) <= horizontalReach(to.y - from.y, water);

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
  /** The widest step any band can ask for. Lookaheads that must stay conservative use this. */
  private maxRowStep = 0;
  /** The horizontal answer the previous row asked for, folded so left and right are one question. */
  private lastLane: 'wall' | 'near' | 'mid' | null = null;
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
      this.maxRowStep = 860;
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
    this.chambers.push(...safeZoneDepths(context.plan?.safeZoneCount ?? 0, context.sectionLength));
    // MEMBER'S CARD guarantees a shop near the top of every later SECTION. It is an EXTRA chamber
    // in front of the ordinary schedule rather than a replacement for one, so the minimum a SECTION
    // already promises is untouched and its content roll still decides what that one holds.
    if (context.guaranteedShopDepth !== undefined && context.sectionLength) {
      this.chambers.unshift(context.guaranteedShopDepth);
      this.forcedShopChambers = 1;
    }
    this.chambers.sort((a, b) => a - b);
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
      const [lo, hi] = intent.ledgeWidth ?? [tuning.minWidth * 0.45, tuning.minWidth * 0.75];
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

  chunk(index: number): { platforms: RoutePlatform[]; enemies: Enemy[]; pickups: Pickup[]; hazards: Hazard[]; containers: AirContainer[]; doodads: Doodad[]; safeZones: SafeZone[]; exit?: StageExit } {
    const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], pickups: Pickup[] = [], hazards: Hazard[] = [], containers: AirContainer[] = [], doodads: Doodad[] = [], safeZones: SafeZone[] = [];
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
      // A gate row takes the whole row: no ledge, no enemies, no hazards, nothing to collect. It is
      // a wall across the shaft and the pause it creates is the point.
      if (gateDue) {
        this.gates.shift();
        const blocks = this.breakBlockRow(y);
        if (y >= start) platforms.push(...blocks);
        // Any block will do as the route anchor: they all share the landing spot by construction.
        this.previous = blocks[0];
        this.previousBand = [blocks[0]];
        // A gate row spans the shaft, so it asks no horizontal question: the row after it is free.
        this.lastLane = null;
        this.nextY += this.rowStep(tuning, band, intent);
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
      const platform = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
      this.lastLane = laneOf(platform, WORLD.wall, WORLD.width - WORLD.wall * 2);
      this.rowsSinceWall++;
      const wallGap = this.wallToCover === -1 ? platform.x - WORLD.wall : WORLD.width - WORLD.wall - platform.x - platform.width;
      if (this.rowsSinceWall >= 3 && wallGap <= 8) { this.rowsSinceWall = 0; this.wallToCover = this.wallToCover === -1 ? 1 : -1; }
      this.id++;
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
      else if (this.random() < tuning.spikePlatformChance) platform.spikePlatform = spikePlatform();
      if (y >= start) platforms.push(platform);
      // More than one ledge in this band, when the piece asked for it. Laid before the chamber and
      // the doodad are placed, so both see them and keep clear the way they keep clear of any ledge.
      const extras = intent ? this.layExtras(intent, platform, y, tuning) : [];
      if (y >= start) platforms.push(...extras);

      let guard: Enemy | undefined;
      if (this.random() < tuning.enemyChance) {
        // Reserve 60px at the landing/exit side for the player's body and movement.
        const min = platform.safeSide === -1 ? platform.x + 78 : platform.x + 20;
        const max = platform.safeSide === -1 ? platform.x + width - 20 : platform.x + width - 78;
        const kind = max >= min ? this.kindFor('guard', tuning, width) : undefined;
        if (kind) {
          guard = this.enemy(kind, (min + max) / 2, y - 15, Math.min(22, (max - min) / 2), 'guard');
          if (y >= start) enemies.push(guard);
        }
      }

      // A row that already has a ground enemy is more likely to get an air enemy, on the same side:
      // stomping the pair is a route the player can choose, never one forced on the safe path.
      if (this.openKinds && this.random() < tuning.flyChance + (guard ? tuning.comboBias : 0)) {
        // Patrol outside the entire envelope of this safe transfer, including the wing span.
        const corridorLeft = Math.min(this.previous.exitX, platform.safeX) - 48;
        const corridorRight = Math.max(this.previous.exitX, platform.safeX) + 48;
        const regions = [[62, corridorLeft - 26], [corridorRight + 26, 388]].filter(([a, b]) => b - a >= 20);
        if (regions.length) {
          const nearGuard = guard ? regions.reduce((best, region) => Math.abs((region[0] + region[1]) / 2 - guard!.originX) < Math.abs((best[0] + best[1]) / 2 - guard!.originX) ? region : best) : undefined;
          const [left, right] = nearGuard ?? regions[Math.floor(this.random() * regions.length)];
          const range = Math.min(32, (right - left) / 2);
          const kind = this.kindFor('open', tuning);
          if (kind) {
            const e = this.enemy(kind, (left + right) / 2, y - 115, range, 'open');
            if (y >= start) enemies.push(e);
          }
        }
      }
      if (this.context.oxygen) this.placeAir(tuning, platform, y, start, containers, enemies);
      if (this.context.heat) this.placeHeat(tuning, platform, y, width, start, pickups, hazards, enemies);
      this.placeSpikes(tuning, platform, y, width, start, hazards, enemies, containers);
      this.placeDoodad(tuning, platform, y, start, doodads, hazards, enemies);
      this.placeSafeZone(platform, y, localDepth, start, safeZones, platforms, hazards, enemies, containers);
      // No weapon crate and no shop doorway are laid in the shaft. Both are SAFE ZONE content and
      // nothing else, so a run is re-armed and re-supplied by finding a chamber -- which is what
      // makes stepping off the fall line to reach one worth doing.
      this.previous = platform;
      this.previousBand = [platform, ...extras];
      this.nextY += this.rowStep(tuning, band, intent);
    }
    return { platforms, enemies, pickups, hazards, containers, doodads, safeZones, exit };
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
    if (y >= start) doodads.push(spawnDoodad(this.id++, x, bandY, this.random() < 0.5 ? 'lamp' : 'bracket'));
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
  private placeSafeZone(platform: RoutePlatform, y: number, localDepth: number, start: number, zones: SafeZone[], platforms: RoutePlatform[], hazards: Hazard[], enemies: Enemy[], containers: AirContainer[]) {
    if (!this.chambers.length || localDepth < this.chambers[0]) return;
    // Past the clearance kept for the exit, the chance has gone: drop it rather than cut a chamber
    // where the way out has to be. Blocking the exit is the one failure worse than going without.
    const ceiling = (this.context.sectionLength ?? Infinity) - SAFE_ZONE_RULES.depthMargin;
    if (localDepth > ceiling) { this.chambers.shift(); return; }
    const bandTop = this.previous.y + 40, bandBottom = y - 30;
    const height = SAFE_ZONE_RULES.height, floorHeight = SAFE_ZONE_RULES.floorHeight;
    if (bandBottom - bandTop < height + floorHeight + 20) return;
    const width = SAFE_ZONE_RULES.width;
    // Sit the chamber so its floor is comfortably inside the band.
    const floorY = Math.round(bandBottom - floorHeight);
    const top = floorY - height;
    const fits = (candidate: -1 | 1) => {
      const x = candidate === -1 ? WORLD.wall : WORLD.width - WORLD.wall - width;
      const overlaps = (ox: number, ow: number, oy: number, oh: number) =>
        ox < x + width + 12 && ox + ow > x - 12 && oy < top + height + floorHeight + 12 && oy + oh > top - 12;
      if (hazards.some(h => overlaps(h.x, h.width, h.y, h.height))) return false;
      if (containers.some(c => overlaps(c.x, c.width, c.y, c.height))) return false;
      if (enemies.some(e => overlaps(e.originX - e.range - 16, e.range * 2 + 32, e.y - 20, 40))) return false;
      if (platforms.some(f => overlaps(f.x, f.width, f.y - 4, 20))) return false;
      // The row's own ledge must not stick into the mouth either.
      return !overlaps(platform.x, platform.width, platform.y - 4, 20);
    };
    const preferred: -1 | 1 = this.nextChamberSide !== 0 ? this.nextChamberSide : (this.random() < 0.5 ? -1 : 1);
    const other: -1 | 1 = preferred === -1 ? 1 : -1;
    const side = fits(preferred) ? preferred : fits(other) ? other : 0;
    if (side === 0) return;
    const x = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall - width;
    this.chambers.shift();
    this.nextChamberSide = side === -1 ? 1 : -1;
    if (y < start) return;
    // The first chamber of a MEMBER'S CARD section is a shop by fiat; every other one still rolls.
    const forced = this.forcedShopChambers > 0;
    if (forced) this.forcedShopChambers--;
    const roll = forced ? 'shop' as const : rollSafeZoneContent(this.random);
    const module = roll === 'gunModule' ? rollModuleForZone(this.random) : undefined;
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
   *   - in AREA 2 a patch is dropped outright when it would sit in the column an AIR CONTAINER is
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
    // AREA 2's guarantee. An air source anywhere near this column means no SPIKE here at all,
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
   * AREA 2 air, and all of it. There is one kind of source now: a sealed container that has to be
   * broken, releasing bubbles that climb away and have to be chased. The wide sheltering alcove is
   * gone -- nowhere in the shaft refills a tank simply by being stood in -- so the ceiling below is
   * the whole safety net, and it is what stops a seed building a stretch nobody could survive.
   */
  private placeAir(tuning: RowTuning, platform: RoutePlatform, y: number, start: number, containers: AirContainer[], enemies: Enemy[]) {
    const bandTop = this.previous.y + 46, bandBottom = y - 54;
    if (bandBottom - bandTop < 30) return;
    const bandY = (bandTop + bandBottom) / 2;
    // Place now if skipping this band could push the next one past the ceiling. Measured against
    // the last source's real position and the widest the next row can be, so the cap always holds.
    //
    // A gate row lays no air at all, so when one is due next the following band is TWO row-gaps
    // away rather than one. Looking only one row ahead there is what let a seed run past the plan's
    // ceiling by a whole row -- invisible until the shaft was built the way the game builds it,
    // with a SECTION length and therefore with gate rows in it.
    const rowStep = this.maxRowStep || tuning.gap + 28;
    const nextRowDepth = (y + rowStep - WORLD.startY) / WORLD.pixelsPerMeter;
    const gateNext = this.gates.length > 0 && this.gates[0] <= nextRowDepth;
    const overdue = (bandY + rowStep * (gateNext ? 2 : 1) - this.lastAirY) / WORLD.pixelsPerMeter >= tuning.maxOxygenGap;
    if (!overdue && this.random() >= tuning.containerChance) return;

    // Everything an air source needs: a spot the fall from the previous exit can actually steer to,
    // leaning away from the safe landing by the plan's offside share so taking it costs a detour.
    const reach = horizontalReach(bandBottom - this.previous.y, this.context.water);
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

  private enemy(kind: EnemyKind, x: number, y: number, range: number, slot: 'guard' | 'open'): Enemy {
    return spawnEnemy(kind, this.id++, x, y, range, this.random() * Math.PI * 2, slot);
  }
}
export { enemyType, spawnEnemy };
