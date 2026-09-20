import type { EnemyKind } from './enemies';
import type { SpikeKind } from './hazards';

export type AreaId = 1 | 2 | 3 | 4;
export type SectionId = 1 | 2 | 3;

/**
 * Per-area gimmicks land after AREA 1. The flags exist so an area can opt in without touching
 * GameModel: AREA 2 oxygen, AREA 3 heat/ice/lava, AREA 4 collapsing platforms.
 */
export interface AreaGimmicks { oxygen?: boolean; heat?: boolean; ice?: boolean; lava?: boolean; breakablePlatforms?: boolean }

/**
 * Submerged handling. Gravity is scaled and horizontal input becomes a target the player eases into
 * instead of instant movement, so the shaft feels like water without changing the shooting core.
 * Areas without this entry use the ordinary instant movement and full gravity.
 */
export interface WaterPhysics {
  /** Multiplier on gravity while submerged. */
  gravity: number;
  /** How fast horizontal velocity converges on the input, per second. Lower = more drift. */
  responsiveness: number;
}

/**
 * One SECTION's generation recipe. When an area supplies these, the shared depth curve is bypassed
 * entirely for that section, so AREA tuning and run progression never stack on top of each other.
 */
export interface SectionPlan {
  /** Platform width range, in pixels, inside the 394px playable shaft. */
  platformWidth: [number, number];
  /** Vertical distance to the next row before the random 0-28px jitter. */
  gap: number;
  /** Per-row chance of a ground enemy and of an air enemy. */
  enemyChance: number;
  flyChance: number;
  /** Share of ground rolls that produce a non-stompable enemy, and a wide heavy one. */
  toughChance: number;
  heavyChance: number;
  /**
   * Extra air-enemy chance when the row already has a ground enemy, plus side alignment with it.
   * Short stomp chains become available by choosing that side, instead of by lining enemies up.
   */
  comboBias: number;
  /** Metres at the top of the SECTION left empty so the opening reads calmly. */
  graceDepth?: number;

  // --- SPIKE (AREA 1 / AREA 2) ----------------------------------------------------------------
  /**
   * Per-row chance that the ledge carries a patch of SPIKE. SPIKE is instant death, so it is only
   * ever laid on the far end of a ledge from the landing spot the route is guaranteed to reach,
   * never in the fall corridor and never in front of an air source.
   */
  spikeChance?: number;
  /** Which SPIKE variants this SECTION draws from. One is picked per patch. */
  spikeKinds?: readonly SpikeKind[];

  // --- SPIKE PLATFORM (AREA 2 / AREA 4) --------------------------------------------------------
  /**
   * Per-row chance that the ledge IS a SPIKE PLATFORM: ground that is safe to land on and then
   * turns, after a visible warning, for ordinary damage. Nothing about it is instant death.
   *
   * CATACOMBS only. MEASUREMENT REQUIRED.
   */
  spikePlatformChance?: number;
  /**
   * Per-row chance that the row is LIMBO's dangerous ground: barbs that are not a floor at all.
   * Nothing lands on one, so it neither reloads nor settles -- it is fallen through for a heart.
   *
   * At 1 the SECTION has no landable ground outside its SAFE ZONE, which is the point of the AREA:
   * the only thing that refills the gunboots out there is a floating doodad. MEASUREMENT REQUIRED.
   */
  limboHazardChance?: number;

  // --- BREAK FLOOR ----------------------------------------------------------------------------
  /**
   * Rows of BREAK BLOCK laid across the SECTION, dividing it into that many + 1 fall zones. They
   * are spaced evenly through the SECTION's own length, so a row is never near the opening or the
   * exit. How many blocks make up a row is shared tuning, in BREAK_BLOCK_RULES.
   */
  breakBlockRows?: number;
  /** Rounds ONE block takes before it gives way. Counted in hits, so every module can open one. */
  breakBlockDurability?: number;

  // --- DOODAD / SAFE ZONE ----------------------------------------------------------------------
  /**
   * Per-row chance of a DOODAD: scenery to bounce off for a reload, keeping a chain alive where
   * there is nothing to stomp. Deliberately sparse while the mechanic is being proven out.
   */
  doodadChance?: number;
  /**
   * SAFE ZONE chambers cut into the shaft wall in this SECTION, as a GUARANTEED MINIMUM: the
   * generator retries rows until this many have been cut, rather than rolling for them.
   *
   * Every SECTION sets 1. PROVISIONAL / MEASUREMENT REQUIRED -- the original scatters chambers down
   * the well and its real rate and count are NOT measured, so this must not be read as "the original
   * always has exactly one". One is the floor that makes the supply loop work: weapons, shops and
   * veins live only in chambers, so a SECTION with none is a SECTION a run cannot be supplied in.
   * Optional extra chambers on top of the minimum are a later change to `safeZoneDepths` alone.
   */
  safeZoneCount?: number;
  /**
   * Per-row chance of an AIR CONTAINER, where oxygen is on. A container holds no air by itself:
   * breaking it releases bubbles that climb away and have to be chased. It is the only air there
   * is -- the sheltering alcove that used to stand beside it is gone, so nowhere in the shaft
   * refills a tank simply by being stood in.
   */
  containerChance?: number;
  /**
   * Hard ceiling on the metres between two air sources. The generator forces a bubble when the run
   * of dry rows would exceed it, so a seed can never build an unsurvivable stretch.
   */
  maxOxygenGap?: number;
  /** How far outside the safe landing lane a bubble is placed, as a share of the reachable span. */
  bubbleOffside?: number;

  // --- AREA 3 -------------------------------------------------------------------------------
  /** Per-row chance of a lava pool on the unsafe end of the ledge, and of a lava wall in the gap. */
  lavaPoolChance?: number;
  lavaWallChance?: number;
  /** Per-row chance of a volcanic vent. Vents always telegraph before they fire. */
  ventChance?: number;
  /** Per-row chance of an ice shard, and how far it leans towards the hot side of the shaft. */
  iceChance?: number;
  iceOffside?: number;

  // --- AREA 4 -------------------------------------------------------------------------------
  /** Share of ledges that give way after the player lands on them. */
  breakableChance?: number;
  /** Seconds from the first landing to that collapse. */
  breakDelay?: number;
  /** Hard cap on consecutive collapsing rows, so a seed always offers a foothold to regroup on. */
  maxBreakableRun?: number;
  /** Enemies the area owns but this SECTION holds back, so a roster can be introduced gradually. */
  enemyExclude?: readonly EnemyKind[];
}

/** Colours GameScene paints the shaft with. Each area gets its own without new draw code. */
export interface AreaTheme {
  wall: number; wallEdge: number; brick: number; pillar: number; accent: number; dust: number;
  /** AREA 1 only: daylight above the entrance, seen while the run is still near the surface. */
  sky?: number; horizon?: number; grass?: number;
  /** Submerged areas tint the shaft and drift motes, light shafts and weed through it. */
  water?: { tint: number; light: number; weed: number };
  /** Volcanic areas drift embers upward and glow along the walls. */
  ember?: { glow: number; ash: number };
  /** The collapsing realm shows a void below and drifting rubble across the shaft. */
  rift?: { glow: number; void: number; debris: number };
}

export interface AreaConfig {
  id: AreaId;
  name: string;
  sections: number;
  /** Section-local metres the player must descend before SECTION CLEAR. */
  sectionLength: number;
  enemyPool: readonly EnemyKind[];
  theme: AreaTheme;
  /** One entry per SECTION. Areas without plans fall back to the shared depth curve. */
  plans?: readonly SectionPlan[];
  music?: string;
  gimmicks?: AreaGimmicks;
  water?: WaterPhysics;
}

const LATER_AREA_POOL: readonly EnemyKind[] = ['slime', 'bat', 'armoredSlime', 'tank'];

/**
 * The four AREAs of a normal run, each carrying one of Downwell's world ROLES. Presentation is
 * DEEP DROP's own -- names, palettes and creatures -- while the mechanics each AREA runs are the
 * original's:
 *
 *   AREA 1  Caverns role   -- the whole ruleset and nothing else. Breakables everywhere, ordinary
 *                             ground to land on, basic enemies, and nothing that ends a run outright.
 *   AREA 2  Catacombs role -- ground that turns: SPIKE PLATFORMS arm on landing and come up after a
 *                             warning, for ordinary damage. Wall candles to bounce from. No water.
 *   AREA 3  Aquifer role   -- submerged. The breath gauge is the clock, air containers are the only
 *                             supply, and everything moves through water.
 *   AREA 4  Limbo role     -- nowhere safe to stand. Every ledge is a spike platform, nothing can be
 *                             stomped, and floating scenery is what reloads the gunboots.
 *
 * Magma -- heat, lava, ice -- is no longer part of a normal run. The systems stay because the FINAL
 * BOSS replays them, and they are available for later bonus content.
 */
export const AREAS: readonly AreaConfig[] = [
  {
    // CAVERNS ROLE. Fall, shoot, land, stomp, chain, open a block. No gauge, no timer on the ground,
    // and deliberately nothing lethal on touch: AREA 1 is where the controls are learned, so a run
    // ends here because the player ran out of hearts, never because they brushed a wall.
    id: 1, name: 'SURFACE RUINS', sections: 3, sectionLength: 240,
    enemyPool: ['slime', 'bat', 'armoredSlime'],
    theme: { wall: 0x2b3228, wallEdge: 0x44523a, brick: 0x222a20, pillar: 0x33402c, accent: 0xb9ef70, dust: 0x9db98a, sky: 0x2d4a52, horizon: 0x47707a, grass: 0x6d9c4a },
    plans: [
      // The most breakable-rich AREA of the four: gate rows every SECTION, opened with one round.
      { platformWidth: [176, 196], gap: 232, enemyChance: 0.30, flyChance: 0.08, toughChance: 0.17, heavyChance: 0, comboBias: 0.20, graceDepth: 25,
        breakBlockRows: 2, breakBlockDurability: 1,
        doodadChance: 0.12, safeZoneCount: 1 },
      { platformWidth: [152, 178], gap: 238, enemyChance: 0.38, flyChance: 0.20, toughChance: 0.22, heavyChance: 0, comboBias: 0.22,
        breakBlockRows: 3, breakBlockDurability: 2,
        doodadChance: 0.12, safeZoneCount: 1 },
      { platformWidth: [132, 158], gap: 244, enemyChance: 0.52, flyChance: 0.30, toughChance: 0.30, heavyChance: 0, comboBias: 0.30,
        breakBlockRows: 3, breakBlockDurability: 2,
        doodadChance: 0.12, safeZoneCount: 1 },
    ],
  },
  {
    // CATACOMBS ROLE. The ground is the threat. A ledge is safe to arrive on and stops being safe a
    // moment later, so the AREA is about not staying still -- and every one of those hits is
    // ordinary damage, so it costs a heart rather than the run. Candles on the walls are the way to
    // keep a chain alive without touching the floor at all.
    id: 2, name: 'CATACOMB RUINS', sections: 3, sectionLength: 300,
    enemyPool: ['slime', 'bat', 'armoredSlime', 'tank'],
    theme: { wall: 0x2a2620, wallEdge: 0x463f33, brick: 0x1a1713, pillar: 0x3b3428, accent: 0xe8c98a, dust: 0xb6a888 },
    plans: [
      { platformWidth: [150, 174], gap: 236, enemyChance: 0.34, flyChance: 0.26, toughChance: 0.22, heavyChance: 0, comboBias: 0.18, graceDepth: 12,
        spikePlatformChance: 0.30, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.24, safeZoneCount: 1 },
      { platformWidth: [138, 162], gap: 242, enemyChance: 0.46, flyChance: 0.32, toughChance: 0.30, heavyChance: 0.08, comboBias: 0.24,
        spikePlatformChance: 0.42, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.26, safeZoneCount: 1 },
      { platformWidth: [126, 150], gap: 248, enemyChance: 0.56, flyChance: 0.38, toughChance: 0.38, heavyChance: 0.14, comboBias: 0.28,
        spikePlatformChance: 0.55, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.28, safeZoneCount: 1 },
    ],
  },
  {
    // AQUIFER ROLE. The breath gauge replaces the floor as the thing that is running out. Air comes
    // only from containers that have to be broken and then chased, so the route is decided by where
    // the air is rather than by where the ledges are. Nothing in here is lethal on touch.
    id: 3, name: 'SUNKEN RUINS', sections: 3, sectionLength: 340,
    enemyPool: ['fish', 'bubbleFish', 'jellyfish', 'urchin'],
    theme: { wall: 0x1c2a2c, wallEdge: 0x324245, brick: 0x111c1f, pillar: 0x24484f, accent: 0x70d8ef, dust: 0x8fd5e0, water: { tint: 0x123844, light: 0x9fe8f5, weed: 0x2f7361 } },
    gimmicks: { oxygen: true },
    water: { gravity: 0.90, responsiveness: 11 },
    plans: [
      // The gaps are the AREA's difficulty curve. They are held below what one tank can cross, and
      // the generator forces a source whenever a dry run would exceed them.
      { platformWidth: [150, 174], gap: 236, enemyChance: 0.34, flyChance: 0.26, toughChance: 0.22, heavyChance: 0, comboBias: 0.18, graceDepth: 12, containerChance: 0.44, maxOxygenGap: 30, bubbleOffside: 0.35,
        breakBlockRows: 2, breakBlockDurability: 2, doodadChance: 0.10, safeZoneCount: 1 },
      { platformWidth: [138, 162], gap: 242, enemyChance: 0.46, flyChance: 0.32, toughChance: 0.30, heavyChance: 0, comboBias: 0.24, containerChance: 0.29, maxOxygenGap: 40, bubbleOffside: 0.62,
        breakBlockRows: 2, breakBlockDurability: 2, doodadChance: 0.10, safeZoneCount: 1 },
      { platformWidth: [126, 150], gap: 248, enemyChance: 0.56, flyChance: 0.38, toughChance: 0.38, heavyChance: 0, comboBias: 0.28, containerChance: 0.21, maxOxygenGap: 50, bubbleOffside: 0.85,
        breakBlockRows: 2, breakBlockDurability: 2, doodadChance: 0.10, safeZoneCount: 1 },
    ],
  },
  {
    // LIMBO ROLE. There is no resting here. Every ledge is a SPIKE PLATFORM, so touching down buys a
    // reload and a settled chain at the cost of having to leave immediately; nothing in the enemy
    // pool can be stomped, so the gunboots are the only way through them; and floating scenery is
    // what refills CHARGE, which makes the AREA a loop of shoot, bounce, shoot.
    id: 4, name: 'COLLAPSED REALM', sections: 3, sectionLength: 380,
    enemyPool: ['voidWisp', 'hollowShade', 'spikeDemon'],
    theme: { wall: 0x241f2e, wallEdge: 0x3c3350, pillar: 0x2d2740, brick: 0x171422, accent: 0xc0a7ed, dust: 0x8c82a5, rift: { glow: 0x9d7bd8, void: 0x0b0710, debris: 0x4a3f63 } },
    plans: [
      { platformWidth: [92, 112], gap: 232, enemyChance: 0.30, flyChance: 0.26, toughChance: 0.16, heavyChance: 0, comboBias: 0.24, graceDepth: 26,
        limboHazardChance: 1, doodadChance: 0.95, safeZoneCount: 1 },
      { platformWidth: [84, 102], gap: 238, enemyChance: 0.46, flyChance: 0.40, toughChance: 0.28, heavyChance: 0, comboBias: 0.34,
        limboHazardChance: 1, doodadChance: 0.95, safeZoneCount: 1 },
      { platformWidth: [76, 94], gap: 244, enemyChance: 0.58, flyChance: 0.50, toughChance: 0.34, heavyChance: 0, comboBias: 0.40,
        limboHazardChance: 1, doodadChance: 0.95, safeZoneCount: 1 },
    ],
  },
];

export const FINAL_STAGE = { id: 'boss', label: 'FINAL BOSS', name: 'DEMON KING' } as const;

export const areaConfig = (id: AreaId, areas: readonly AreaConfig[] = AREAS) => areas.find(a => a.id === id) ?? areas[0];
export const TOTAL_SECTIONS = AREAS.reduce((count, area) => count + area.sections, 0);
/**
 * The metres a completed run is worth. Derived from the AREA table rather than written down, so
 * changing a SECTION length moves the run total, the FINAL BOSS read-out and the tests together.
 */
export const PLANNED_TOTAL_DEPTH = AREAS.reduce((total, area) => total + area.sectionLength * area.sections, 0);
