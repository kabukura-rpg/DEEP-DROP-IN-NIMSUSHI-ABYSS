import type { EnemyKind } from './enemies';

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
  /** Per-row chance of an air bubble and of an air pocket. Only meaningful where oxygen is on. */
  bubbleChance?: number;
  airPocketChance?: number;
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
 * AREA 1 teaches the whole ruleset with no extra systems: fall, shoot, land, stomp, read an enemy.
 * 1-1 is wide and quiet, 1-2 introduces air enemies to bounce from, 1-3 mixes stompable and armoured.
 */
export const AREAS: readonly AreaConfig[] = [
  {
    id: 1, name: 'SURFACE RUINS', sections: 3, sectionLength: 200,
    enemyPool: ['slime', 'bat', 'armoredSlime'],
    theme: { wall: 0x2b3228, wallEdge: 0x44523a, brick: 0x222a20, pillar: 0x33402c, accent: 0xb9ef70, dust: 0x9db98a, sky: 0x2d4a52, horizon: 0x47707a, grass: 0x6d9c4a },
    plans: [
      { platformWidth: [176, 196], gap: 232, enemyChance: 0.30, flyChance: 0.08, toughChance: 0.17, heavyChance: 0, comboBias: 0.20, graceDepth: 25 },
      { platformWidth: [152, 178], gap: 238, enemyChance: 0.38, flyChance: 0.20, toughChance: 0.22, heavyChance: 0, comboBias: 0.22 },
      { platformWidth: [132, 158], gap: 244, enemyChance: 0.52, flyChance: 0.30, toughChance: 0.30, heavyChance: 0, comboBias: 0.30 },
    ],
  },
  {
    id: 2, name: 'SUNKEN RUINS', sections: 3, sectionLength: 200,
    enemyPool: ['fish', 'bubbleFish', 'jellyfish', 'urchin'],
    theme: { wall: 0x1c2a2c, wallEdge: 0x324245, brick: 0x111c1f, pillar: 0x24484f, accent: 0x70d8ef, dust: 0x8fd5e0, water: { tint: 0x123844, light: 0x9fe8f5, weed: 0x2f7361 } },
    gimmicks: { oxygen: true },
    water: { gravity: 0.90, responsiveness: 11 },
    plans: [
      { platformWidth: [150, 174], gap: 236, enemyChance: 0.34, flyChance: 0.26, toughChance: 0.22, heavyChance: 0, comboBias: 0.18, graceDepth: 12, bubbleChance: 0.40, airPocketChance: 0.14, maxOxygenGap: 30, bubbleOffside: 0.35 },
      { platformWidth: [138, 162], gap: 242, enemyChance: 0.46, flyChance: 0.32, toughChance: 0.30, heavyChance: 0, comboBias: 0.24, bubbleChance: 0.30, airPocketChance: 0.07, maxOxygenGap: 40, bubbleOffside: 0.62 },
      { platformWidth: [126, 150], gap: 248, enemyChance: 0.56, flyChance: 0.38, toughChance: 0.38, heavyChance: 0, comboBias: 0.28, bubbleChance: 0.22, airPocketChance: 0.04, maxOxygenGap: 50, bubbleOffside: 0.85 },
    ],
  },
  {
    id: 3, name: 'MAGMA DEPTHS', sections: 3, sectionLength: 200,
    enemyPool: ['fireLizard', 'fireBat', 'magmaSlime', 'fireArmor', 'frostBeetle'],
    theme: { wall: 0x2e1f1f, wallEdge: 0x4a2f2a, brick: 0x1d1414, pillar: 0x3a2622, accent: 0xef9b70, dust: 0xd8a074, ember: { glow: 0xff8a3c, ash: 0xffc27a } },
    gimmicks: { heat: true, lava: true },
    plans: [
      { platformWidth: [146, 170], gap: 238, enemyChance: 0.34, flyChance: 0.24, toughChance: 0.18, heavyChance: 0, comboBias: 0.20, graceDepth: 14,
        lavaPoolChance: 0.22, lavaWallChance: 0, ventChance: 0.10, iceChance: 0.52, iceOffside: 0.25 },
      { platformWidth: [136, 158], gap: 244, enemyChance: 0.46, flyChance: 0.30, toughChance: 0.28, heavyChance: 0.10, comboBias: 0.24,
        lavaPoolChance: 0.34, lavaWallChance: 0.12, ventChance: 0.20, iceChance: 0.40, iceOffside: 0.60 },
      { platformWidth: [124, 146], gap: 250, enemyChance: 0.56, flyChance: 0.36, toughChance: 0.36, heavyChance: 0.16, comboBias: 0.28,
        lavaPoolChance: 0.44, lavaWallChance: 0.20, ventChance: 0.28, iceChance: 0.30, iceOffside: 0.85 },
    ],
  },
  {
    id: 4, name: 'COLLAPSED REALM', sections: 3, sectionLength: 200,
    enemyPool: ['demon', 'wraith', 'armorGuard', 'spikeDemon', 'ruinBreaker'],
    theme: { wall: 0x241f2e, wallEdge: 0x3c3350, pillar: 0x2d2740, brick: 0x171422, accent: 0xc0a7ed, dust: 0x8c82a5, rift: { glow: 0x9d7bd8, void: 0x0b0710, debris: 0x4a3f63 } },
    gimmicks: { breakablePlatforms: true },
    plans: [
      { platformWidth: [128, 150], gap: 236, enemyChance: 0.30, flyChance: 0.26, toughChance: 0.16, heavyChance: 0.06, comboBias: 0.24, graceDepth: 26,
        breakableChance: 0.45, breakDelay: 0.85, maxBreakableRun: 4, enemyExclude: ['ruinBreaker'] },
      { platformWidth: [118, 138], gap: 242, enemyChance: 0.46, flyChance: 0.40, toughChance: 0.28, heavyChance: 0.12, comboBias: 0.34,
        breakableChance: 0.76, breakDelay: 0.65, maxBreakableRun: 8 },
      { platformWidth: [108, 128], gap: 248, enemyChance: 0.58, flyChance: 0.50, toughChance: 0.34, heavyChance: 0.16, comboBias: 0.40,
        breakableChance: 0.92, breakDelay: 0.55, maxBreakableRun: 14 },
    ],
  },
];
export const FINAL_STAGE = { id: 'boss', label: 'FINAL BOSS', name: 'DEMON KING' } as const;

export const areaConfig = (id: AreaId, areas: readonly AreaConfig[] = AREAS) => areas.find(a => a.id === id) ?? areas[0];
export const TOTAL_SECTIONS = AREAS.reduce((count, area) => count + area.sections, 0);
