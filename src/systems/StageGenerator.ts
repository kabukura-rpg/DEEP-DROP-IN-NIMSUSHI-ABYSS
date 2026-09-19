import { WORLD } from '../data/balance';
import { difficultyAt, horizontalReach } from '../data/difficulty';
import { ENEMY_TYPES, enemyType, spawnEnemy, type Enemy, type EnemyKind } from '../data/enemies';
import { spawnGunModule, spawnPickup, type Pickup, type PickupKind } from '../data/pickups';
import { GUN_MODULE_SPAWN_CHANCE, rollGunModule } from '../data/gunModules';
import { AIR_CONTAINER_RULES, EXIT_RULES, SHOP_DOOR, type AirContainer, type ShopDoor, type StageExit } from '../data/structures';
import { SHOP_RULES } from '../data/shop';
import { spawnHazard, type Hazard } from '../data/hazards';
import type { SectionPlan, WaterPhysics } from '../data/areas';

export type { Enemy, EnemyKind } from '../data/enemies';
export type { Pickup } from '../data/pickups';
export type { Hazard } from '../data/hazards';
/** A pocket of trapped air. Standing inside it refills the tank and stops the drain. */
export interface AirPocket { id: number; x: number; y: number; width: number; height: number }
import type { PlatformState } from './BreakablePlatformSystem';
export interface Platform {
  id: number; x: number; y: number; width: number;
  /** AREA 4: this ledge gives way once the player has landed on it. */
  breakable?: boolean;
  /** Owned by BreakablePlatformSystem; every other reader treats it as read-only. */
  state?: PlatformState;
}
export interface RoutePlatform extends Platform { safeX: number; exitX: number; safeSide: -1 | 1 }
export const START_PLATFORM: RoutePlatform = { id: -2, x: 155, y: 250, width: 140, safeX: 225, exitX: 307, safeSide: 1, breakable: false, state: 'stable' };
export const canReachPlatform = (from: RoutePlatform, to: RoutePlatform, water?: WaterPhysics) => to.y > from.y && Math.abs(to.safeX - from.exitX) <= horizontalReach(to.y - from.y, water);

/** Everything one row needs, whether it came from a SECTION plan or the shared depth curve. */
interface RowTuning { minWidth: number; maxWidth: number; gap: number; enemyChance: number; flyChance: number; toughChance: number; heavyChance: number; comboBias: number; containerChance: number; airPocketChance: number; maxOxygenGap: number; bubbleOffside: number; lavaPoolChance: number; lavaWallChance: number; ventChance: number; iceChance: number; iceOffside: number; breakableChance: number; maxBreakableRun: number }
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
  /** This SECTION rolled a shop, so the generator should find a ledge to put the doorway on. */
  shop?: boolean;
}
const DEFAULT_POOL: readonly EnemyKind[] = ['slime', 'bat', 'armoredSlime', 'tank'];

export class StageGenerator {
  private id = 0;
  private nextY: number;
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
  private shopPlaced = false;
  constructor(private random: () => number = Math.random, private context: GenerationContext = {}) {
    this.nextY = context.startY ?? 465;
    this.previous = context.previous ? { ...context.previous } : { ...START_PLATFORM };
    // Keep ids clear of whatever the previous generator already handed out.
    this.id = Math.max(0, Math.round((this.nextY - 465) / 4));
    const roster = context.enemyPool?.length ? context.enemyPool : DEFAULT_POOL;
    const held = context.plan?.enemyExclude ?? [];
    this.pool = held.length ? roster.filter(kind => !held.includes(kind)) : roster;
    this.openKinds = this.pool.some(kind => ENEMY_TYPES[kind].spawnSlot !== 'guard');
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
        containerChance: plan.containerChance ?? 0, airPocketChance: plan.airPocketChance ?? 0,
        maxOxygenGap: plan.maxOxygenGap ?? Infinity, bubbleOffside: plan.bubbleOffside ?? 0,
        lavaPoolChance: quiet ? 0 : plan.lavaPoolChance ?? 0, lavaWallChance: quiet ? 0 : plan.lavaWallChance ?? 0,
        ventChance: quiet ? 0 : plan.ventChance ?? 0, iceChance: plan.iceChance ?? 0, iceOffside: plan.iceOffside ?? 0,
        breakableChance: quiet ? 0 : plan.breakableChance ?? 0, maxBreakableRun: plan.maxBreakableRun ?? Infinity,
      };
    }
    const curve = difficultyAt((this.context.depthOffset ?? 0) + localDepth);
    return { minWidth: curve.minWidth, maxWidth: curve.maxWidth, gap: curve.gap, enemyChance: curve.enemyChance, flyChance: curve.flyChance, toughChance: curve.spikeChance, heavyChance: curve.tankChance, comboBias: 0, containerChance: 0, airPocketChance: 0, maxOxygenGap: Infinity, bubbleOffside: 0, lavaPoolChance: 0, lavaWallChance: 0, ventChance: 0, iceChance: 0, iceOffside: 0, breakableChance: 0, maxBreakableRun: Infinity };
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

  chunk(index: number): { platforms: RoutePlatform[]; enemies: Enemy[]; pickups: Pickup[]; airPockets: AirPocket[]; hazards: Hazard[]; containers: AirContainer[]; exit?: StageExit; shopDoor?: ShopDoor } {
    const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], pickups: Pickup[] = [], airPockets: AirPocket[] = [], hazards: Hazard[] = [], containers: AirContainer[] = [];
    let exit: StageExit | undefined, shopDoor: ShopDoor | undefined;
    const start = index * WORLD.chunkHeight, end = start + WORLD.chunkHeight;
    // Carry nextY and the previous safe exit across chunk boundaries: no compressed seams.
    while (this.nextY < end && !this.done) {
      const y = this.nextY, localDepth = Math.max(0, (y - WORLD.startY) / WORLD.pixelsPerMeter);

      const tuning = this.tuningAt(localDepth);
      const width = Math.round(tuning.minWidth + this.random() * (tuning.maxWidth - tuning.minWidth));
      const candidates: RoutePlatform[] = [];
      // A finite set always includes both extremes. Random ordering cannot defeat safety.
      for (let x = WORLD.wall; x <= WORLD.width - WORLD.wall - width; x += 2) {
        for (const side of [-1, 1] as const) {
          const p = { id: this.id, x, y, width, safeSide: side, safeX: side === -1 ? x + 26 : x + width - 26, exitX: side === -1 ? x - 12 : x + width + 12 };
          if (p.exitX >= WORLD.wall + 12 && p.exitX <= WORLD.width - WORLD.wall - 12 && canReachPlatform(this.previous, p, this.context.water)) candidates.push(p);
        }
      }
      // Bounded widths/gaps leave candidates even when departing beside either wall.
      if (!candidates.length) throw new Error(`No reachable platform at ${y}`);
      let choices = candidates;
      if (this.rowsSinceWall >= 3) {
        // Periodically close each wall lane; don't let a single held direction bypass a run.
        // If the wall is too far, choose the nearest reachable stepping stone first.
        const distance = (p: RoutePlatform) => this.wallToCover === -1 ? p.x - WORLD.wall : WORLD.width - WORLD.wall - p.x - p.width;
        const touching = candidates.filter(p => distance(p) <= 2);
        const targetLanding = this.wallToCover === -1 ? WORLD.wall + width - 26 : WORLD.width - WORLD.wall - width + 26;
        const preparation = (p: RoutePlatform) => Math.abs(p.exitX - targetLanding);
        const nearest = Math.min(...candidates.map(preparation));
        choices = touching.length ? touching : candidates.filter(p => preparation(p) <= nearest + 2);
      }
      const platform = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
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
      if (y >= start) platforms.push(platform);

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
      if (this.context.oxygen) this.placeAir(tuning, platform, y, start, containers, airPockets, enemies);
      if (this.context.heat) this.placeHeat(tuning, platform, y, width, start, pickups, hazards, enemies);
      this.placeGunModule(platform, y, start, pickups, enemies, hazards);
      // One doorway per SECTION, on an ordinary ledge, clear of the opening and of the exit.
      if (this.context.shop && !this.shopPlaced && y >= start && !platform.breakable
        && localDepth >= SHOP_RULES.minDepth
        && (this.context.sectionLength === undefined || localDepth <= this.context.sectionLength - SHOP_RULES.exitClearance)
        && !enemies.some(e => Math.abs(e.x - platform.safeX) < 46 && Math.abs(e.y - (y - 30)) < 46)) {
        this.shopPlaced = true;
        shopDoor = { x: Math.round(platform.safeX - SHOP_DOOR.width / 2), y: Math.round(y - SHOP_DOOR.height), width: SHOP_DOOR.width, height: SHOP_DOOR.height };
      }
      this.previous = platform;
      this.nextY += tuning.gap + this.random() * 28;
    }
    return { platforms, enemies, pickups, airPockets, hazards, containers, exit, shopDoor };
  }

  /**
   * AREA 3's hazards and relief. Every lava shape is kept clear of the landing lane and of the
   * corridor the safe transfer flies through, so a seed can never wall the route off or force a
   * lethal touch; ice is clamped to a spot the same fall can steer to, leaning towards the hot side.
   */
  /**
   * A weapon crate sits on an ordinary ledge's landing spot, so reaching it is exactly as hard as
   * reaching that ledge -- never a detour into a hazard. Collapsing ledges, occupied space and
   * anything lethal are skipped outright rather than worked around, which also leaves the door
   * open for a dedicated weapon room later without changing this contract.
   */
  private placeGunModule(platform: RoutePlatform, y: number, start: number, pickups: Pickup[], enemies: Enemy[], hazards: Hazard[]) {
    if (y < start || this.random() >= GUN_MODULE_SPAWN_CHANCE) return;
    // A collapsing ledge is still a fine place for a crate: it sits just above the landing spot, so
    // it is collected on the way down, before the ledge has even begun to crack. Skipping them
    // entirely is what left AREA 4 -- where every ledge collapses -- with no weapons at all.
    const x = platform.safeX, cy = y - 34;
    if (enemies.some(e => Math.abs(e.x - x) < 36 && Math.abs(e.y - cy) < 36)) return;
    if (hazards.some(h => x > h.x - 22 && x < h.x + h.width + 22 && cy > h.y - 22 && cy < h.y + h.height + 22)) return;
    const roll = rollGunModule(this.random);
    pickups.push(spawnGunModule(this.id++, Math.round(x), Math.round(cy), roll.module, roll.bonus));
  }
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
   * AREA 2 air. Free-floating bubbles are gone: the shaft now offers a sealed container that has
   * to be broken, and the bubbles it releases climb away. The wide alcove stays, because it is
   * shelter rather than a pickup and OxygenSystem depends on that sheltered state.
   */
  private placeAir(tuning: RowTuning, platform: RoutePlatform, y: number, start: number, containers: AirContainer[], airPockets: AirPocket[], enemies: Enemy[]) {
    const bandTop = this.previous.y + 46, bandBottom = y - 54;
    if (bandBottom - bandTop < 30) return;
    const bandY = (bandTop + bandBottom) / 2;
    // Place now if skipping this band could push the next one past the ceiling. Measured against
    // the last source's real position and the widest the next row can be, so the cap always holds.
    const overdue = (bandY + tuning.gap + 28 - this.lastAirY) / WORLD.pixelsPerMeter >= tuning.maxOxygenGap;
    if (!overdue && this.random() >= tuning.containerChance + tuning.airPocketChance) return;

    // Everything an air source needs: a spot the fall from the previous exit can actually steer to,
    // leaning away from the safe landing by the plan's offside share so taking it costs a detour.
    const reach = horizontalReach(bandBottom - this.previous.y, this.context.water);
    const exit = this.previous.exitX;
    const lean = Math.sign(exit - platform.safeX) || (exit < WORLD.width / 2 ? 1 : -1);
    const clamp = (value: number, margin: number) =>
      Math.max(WORLD.wall + margin, Math.min(WORLD.width - WORLD.wall - margin, Math.max(exit - reach, Math.min(exit + reach, value))));

    // The rare full refill is a wide alcove: easy to see, easy to enter, and a real waypoint.
    if (this.random() < tuning.airPocketChance / (tuning.containerChance + tuning.airPocketChance)) {
      const width = 104, height = Math.min(66, bandBottom - bandTop);
      // Round before the final clamp, so the alcove centre stays inside the reach envelope.
      const centre = clamp(Math.round(clamp(exit + lean * tuning.bubbleOffside * 0.5 * reach, width / 2 + 2)), width / 2 + 2);
      if (y >= start) airPockets.push({ id: this.id++, x: centre - width / 2, y: Math.round(bandY - height / 2), width, height });
      this.lastAirY = bandY;
      return;
    }
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
