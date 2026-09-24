import type { EnemyKind } from './enemies';
import type { StageFlowProfile } from './stageFlow';
import type { SpikeKind } from './hazards';
import { AREA1_RHYTHM, type RhythmGrammar } from './rhythm';
import { AREA1_GRAMMAR, type PieceGrammar } from './pieces';
import { AREA3_CROSS_CURRENT, AREA3_DROWNED_RUINS, AREA3_OPEN_WATER } from './waterTerrain';
import { AREA2_INTRO, AREA2_OSSUARY, AREA2_PURSUIT } from './catacombTerrain';
import { AREA4_RUBBLE, AREA4_RUINFALL, AREA4_VOID } from './limboTerrain';

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
  /** STAGE GENERATION v2: where this SECTION's enemies go relative to the fall. See stageFlow.ts. */
  flow?: StageFlowProfile;
  /** Platform width range, in pixels, inside the 394px playable shaft. */
  platformWidth: [number, number];
  /** Vertical distance to the next row before the random 0-28px jitter. */
  gap: number;
  /**
   * VERTICAL RHYTHM. When present, the single `gap` number above is replaced by a grammar of bands
   * -- tight, ordinary, open -- that hold for a few rows each and then change. `gap` stays as the
   * fallback the dev A/B switches back to, so the same seed can be played both ways.
   *
   * AREA 1 only for now. The other AREAs keep the single number until each has been measured on
   * its own terms; a rhythm that suits the AREA where the controls are learned is not automatically
   * the rhythm for the AREA where the floor turns on you.
   */
  rhythm?: RhythmGrammar;
  /**
   * TERRAIN PIECES. Where `rhythm` varies how far apart rows are, this varies what a stretch of
   * shaft IS -- an open fall, a cluster of ledges to choose between, a route down one wall -- and
   * so what the player has to decide. It supersedes `rhythm` when both are present and the terrain
   * mode asks for it; `rhythm` is kept as the A/B control rather than deleted.
   *
   * AREA 1 only. The others keep the single-gap row generator until each is measured on its own.
   */
  pieces?: PieceGrammar;
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
   * CATACOMBS: give each spike platform its OWN warning, long enough to walk off it from anywhere.
   *
   *     warning = (platform width + 18px) / moveSpeed + spikeReaction
   *
   * The first term is the walk from the far end of the ledge to the body being clear of the near one
   * (9px of body each side) -- the longest walk any landing on it can ask for, not just the route's.
   * `spikeReaction` is on top of that: the time to see the warning and start moving. So no landing
   * anywhere can be forced into the teeth, and a player who stays put is always caught. Measured over
   * 600 seeds x 3 SECTIONs, the longest walk a route actually required was 260px (0.743s), which the
   * old fixed 0.65s would not have covered. Absent, every spike platform uses the global warning.
   */
  spikeReaction?: number;
  /**
   * DOWNWELL NORMAL GAMEPLAY CLONE: a FIXED warning, in seconds, for this SECTION's spike platforms --
   * the original's traps fire "shortly after" a landing, the same for every trap, and Human Review
   * found DEEP DROP's slower than the original's. Wins over `spikeReaction`. DESIGN VALUE: the
   * original's delay could not be measured from the footage (see the reference spec).
   */
  spikeWarning?: number;
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
   * SIDE ROOMS this SECTION is raised to, above the `safeZoneCount` floor. A chamber is the only
   * place a run finds a weapon, a shop or a vein, and at one per SECTION the three contest a single
   * slot -- so a whole AREA 1 run expected 0.81 shops and 39% of runs saw none.
   *
   * AREA 1 only for now, and only measured for AREA 1: a 240m SECTION offers 13.5 band gaps roomy
   * enough to cut a chamber into, so two is asking for a sixth of what is available rather than
   * straining the SECTION. The other AREAs keep the floor until each is measured on its own terms.
   */
  sideRooms?: number;
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
  /**
   * CATACOMB GHOSTS: how many wait in the walls of this SECTION, and how fast they drift once woken.
   * Laid on the SECTION's own depth schedule, not rolled, so the count is exact and no other draw in
   * the SECTION moves because of them. Only AREA 2 sets it.
   */
  ghosts?: { count: number; speed: number };
  /**
   * DOWNWELL NORMAL GAMEPLAY CLONE: extra roaming enemies per row, loose in the band above it (a
   * fraction is a chance of one more). See StageGenerator's swarm.
   */
  swarm?: number;
  /**
   * DOWNWELL NORMAL GAMEPLAY CLONE (Limbo): a band this tall or taller also gets a doodad IN the fall
   * lane -- the original's limbo scatters its reload boxes through the space the player falls
   * through, which is what lets a chain run on through a long drop. A bounce never hurts, so a doodad
   * in the way is a reload offered, not an obstacle. Absent: every doodad stays off the route.
   */
  laneDoodadBand?: number;
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
 *   AREA 4  Limbo role     -- a collapsed space. Broken rubble to land on, much of it giving way or
 *                             turning; nothing can be stomped, so the gunboots clear the way, and
 *                             floating scenery reloads them between landings.
 *
 * Magma -- heat, lava, ice -- is no longer part of a normal run. The systems stay because the FINAL
 * BOSS replays them, and they are available for later bonus content.
 */
export const AREAS: readonly AreaConfig[] = [
  {
    // CAVERNS ROLE. Fall, shoot, land, stomp, chain, open a block. No gauge, no timer on the ground,
    // and deliberately nothing lethal on touch: AREA 1 is where the controls are learned, so a run
    // ends here because the player ran out of hearts, never because they brushed a wall.
    id: 1, name: 'SURFACE RUINS', sections: 3, sectionLength: 450,
    // DOWNWELL NORMAL GAMEPLAY CLONE: the Caverns roster, role for role (enemies.ts): worm SLIME, bat
    // CAVE BAT, bad bubble SPORE, frog TOAD, turtle SHELLBACK, crawler ARMORED SLIME, snail CREEPER,
    // eye WATCHER. As in the original, the eye is held back until the second level.
    enemyPool: ['slime', 'caveBat', 'spore', 'toad', 'armoredSlime', 'shellback', 'creeper', 'watcher'],
    theme: { wall: 0x2b3228, wallEdge: 0x44523a, brick: 0x222a20, pillar: 0x33402c, accent: 0xb9ef70, dust: 0x9db98a, sky: 0x2d4a52, horizon: 0x47707a, grass: 0x6d9c4a },
    plans: [
      // The most breakable-rich AREA of the four: gate rows every SECTION, opened with one round.
      // BREAK BLOCK rows are deliberately untouched by the rhythm pilot. 1-1 having two where its
      // neighbours have three is the obvious next thing to try, but changing the gate cadence and
      // the vertical rhythm in the same step would leave a Human A/B unable to say which one it
      // was reacting to -- the same reason SAFE ZONE frequency is being held back to a later step.
      // STAGE GENERATION v2: fewer, further-apart rows (pieces.ts), so the per-row enemy chances are
      // raised by the rows lost -- enemies per 100m are what they were -- and the flow profile puts
      // them into the fall the player makes. 1-1 keeps the most breathing space of the three.
      { platformWidth: [176, 196], gap: 232, rhythm: AREA1_RHYTHM, pieces: AREA1_GRAMMAR, enemyChance: 0.55, flyChance: 0.35, swarm: 0.15, toughChance: 0.2, heavyChance: 0, comboBias: 0.20, graceDepth: 12, enemyExclude: ['watcher'],
        flow: { pathFlyers: 0.5, landingGuards: 0.3 },
        breakBlockRows: 2, breakBlockDurability: 1,
        doodadChance: 0.12, safeZoneCount: 1, sideRooms: 2 },
      { platformWidth: [152, 178], gap: 238, rhythm: AREA1_RHYTHM, pieces: AREA1_GRAMMAR, enemyChance: 0.60, flyChance: 0.45, swarm: 0.3, toughChance: 0.28, heavyChance: 0, comboBias: 0.22,
        flow: { pathFlyers: 0.6, landingGuards: 0.35 },
        breakBlockRows: 3, breakBlockDurability: 2,
        doodadChance: 0.12, safeZoneCount: 1, sideRooms: 2 },
      { platformWidth: [132, 158], gap: 244, rhythm: AREA1_RHYTHM, pieces: AREA1_GRAMMAR, enemyChance: 0.70, flyChance: 0.50, swarm: 0.45, toughChance: 0.34, heavyChance: 0, comboBias: 0.30,
        flow: { pathFlyers: 0.7, landingGuards: 0.4 },
        breakBlockRows: 3, breakBlockDurability: 2,
        doodadChance: 0.12, safeZoneCount: 1, sideRooms: 2 },
    ],
  },
  {
    // CATACOMBS ROLE, REWORKED. The AREA used to be a ladder a player could fall straight down --
    // 2,500px and more of uninterrupted drop in its best column -- with the danger in the floor alone.
    // Now the shaft is built to be WALKED (catacombTerrain.ts: shelves that cover the exit above and
    // gaps to find), and something follows the player down it (chasers.ts: ghosts from the walls,
    // skulls that rattle and lunge). And the ground itself is the AREA's rule: EVERY ordinary ledge is
    // a spike platform (Human Review, v2), each with a warning long enough to walk off it from
    // anywhere -- so moving is always safe, and standing still never is.
    id: 2, name: 'CATACOMB RUINS', sections: 3, sectionLength: 525,
    // DOWNWELL NORMAL GAMEPLAY CLONE: the Catacombs roster -- ghost (scheduled below), ground skull
    // BONE HOPPER (in twos and threes), flying skull (calm until shot), skeleton BONE THROWER, phantom
    // SHADE ORB. Normal Mode's catacombs have no bats and no worms, so AREA 1's bodies are gone; as in
    // the original the flying skull joins from the second level. Spike traps are what the original's
    // are -- a minority of differently coloured ledges that fire shortly after a landing -- rather than
    // every ledge on a walk-off timer.
    enemyPool: ['boneHopper', 'boneThrower', 'flyingSkull', 'shadeOrb'],
    theme: { wall: 0x2a2620, wallEdge: 0x463f33, brick: 0x1a1713, pillar: 0x3b3428, accent: 0xe8c98a, dust: 0xb6a888 },
    plans: [
      // 2-1 LEARN THE SHELVES. Four ghosts (two out at most), no skulls, spikes on every ledge.
      // STAGE GENERATION v2: the shelves are spaced ~1.75x further apart (catacombTerrain.ts), so the
      // per-row chances are raised by the same factor -- enemies and skulls per 100m are unchanged --
      // and the flow profile puts them across the fall and beside the shelves.
      { platformWidth: [168, 198], gap: 220, pieces: AREA2_INTRO, enemyChance: 0.72, flyChance: 0.3, swarm: 0.05, flow: { pathFlyers: 0.5, landingGuards: 0.35 }, toughChance: 0.3, heavyChance: 0, comboBias: 0.18, graceDepth: 12,
        spikePlatformChance: 0.3, spikeWarning: 0.4, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.24, safeZoneCount: 1, enemyExclude: ['flyingSkull'], ghosts: { count: 4, speed: 70 } },
      // 2-2 PURSUIT. Six ghosts, skulls join, slots narrow.
      { platformWidth: [160, 190], gap: 220, pieces: AREA2_PURSUIT, enemyChance: 0.72, flyChance: 0.3, swarm: 0.1, flow: { pathFlyers: 0.6, landingGuards: 0.4 }, toughChance: 0.35, heavyChance: 0, comboBias: 0.24,
        spikePlatformChance: 0.35, spikeWarning: 0.4, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.26, safeZoneCount: 1, ghosts: { count: 6, speed: 80 } },
      // 2-3 OSSUARY. Everything at once -- carried by the shape of the shaft, not by a longer roster.
      { platformWidth: [148, 178], gap: 220, pieces: AREA2_OSSUARY, enemyChance: 0.8, flyChance: 0.35, swarm: 0.15, flow: { pathFlyers: 0.7, landingGuards: 0.45 }, toughChance: 0.4, heavyChance: 0, comboBias: 0.28,
        spikePlatformChance: 0.4, spikeWarning: 0.4, breakBlockRows: 2, breakBlockDurability: 2,
        doodadChance: 0.28, safeZoneCount: 1, ghosts: { count: 8, speed: 88 } },
    ],
  },
  {
    // AQUIFER ROLE. The breath gauge replaces the floor as the thing that is running out. Air comes
    // only from containers that have to be broken and then chased, so the route is decided by where
    // the air is rather than by where the ledges are. Nothing in here is lethal on touch.
    // DOWNWELL NORMAL GAMEPLAY CLONE: the Aquifer roster, role for role -- swimming turtle SHELL SWIMMER
    // (rounds glance off, stomp it), jellyfish RISER JELLY (climbs in zigzags through anything, cannot
    // be stood on), SQUID (swims up, then darts down and cannot be stood on while it darts), piranha
    // BITER (chases; from 3-2, as in Normal). Nothing guards a ledge in the original's aquifer, so no
    // kind here takes the guard slot. Air is what the original's is: only what the player breaks open
    // (containers), no longer also dropped by a fish. Depth 510 -> 435m (original median 15.1
    // screens -- its aquifer is shorter than its catacombs).
    id: 3, name: 'SUNKEN RUINS', sections: 3, sectionLength: 435,
    enemyPool: ['squid', 'shellSwimmer', 'riserJelly', 'biter'],
    theme: { wall: 0x1c2a2c, wallEdge: 0x324245, brick: 0x111c1f, pillar: 0x24484f, accent: 0x70d8ef, dust: 0x8fd5e0, water: { tint: 0x123844, light: 0x9fe8f5, weed: 0x2f7361 } },
    gimmicks: { oxygen: true },
    water: { gravity: 0.90, responsiveness: 11 },
    plans: [
      // SUNKEN RUINS TERRAIN, per SECTION. The three grammars are in waterTerrain.ts and are what
      // makes this AREA read as water rather than as the catacombs painted blue; the numbers here
      // are the envelope they work inside.
      //
      // WHAT MOVED, AND WHY, AGAINST THE CATACOMB PLAN THESE USED TO BE A COPY OF:
      //
      //   platformWidth  UP. A ledge in open water is a SHELF -- something arrived on from a long
      //                  fall, with drift still in the controls. Every floor here is above the 82px
      //                  `minSafeLanding` derived from the player's body plus the water's own drift.
      //   gap            UP, and now only the fallback: the pieces own the spacing. Far fewer rows
      //                  over the same SECTION, which is what opens the shaft up.
      //   doodadChance   UP. Open water needs something to bounce from, or a long lane is a stretch
      //                  with no way to keep a chain or reload alive.
      //   breakBlockRows 1 / 2 / 2 rather than 2 / 2 / 2. Measured: with far fewer rows in a SECTION
      //                  a gate row is a much larger share of what the player meets: three of them
      //                  made BREAKABLE DROP 32 per cent of every piece in 3-3, so the gates rather
      //                  than the water became the AREA. One in 3-1 leaves open water uninterrupted.
      //
      // WHAT DID NOT MOVE: every oxygen number (containerChance, maxOxygenGap, bubbleOffside), every
      // enemy number, the water physics, and safeZoneCount. The air ceilings in particular are load
      // bearing here -- they are what caps how long an open lane may be.
      // 3-1 OPEN WATER. The widest shelves and the fewest of them.
      // STAGE GENERATION v2: open water already lands 1-1.6 times a screen, so the terrain is kept;
      // what changes is where the enemies are -- across the fall and beside the shelves -- which is
      // what turns air into a route choice: the straight line has something in it, the air is off it.
      { platformWidth: [182, 214], gap: 330, pieces: AREA3_OPEN_WATER, enemyChance: 0.34, flyChance: 0.55, swarm: 0.45, flow: { pathFlyers: 0.5, landingGuards: 0.35 }, toughChance: 0.4, enemyExclude: ['biter'], heavyChance: 0, comboBias: 0.18, graceDepth: 12, containerChance: 0.44, maxOxygenGap: 30, bubbleOffside: 0.35,
        breakBlockRows: 1, breakBlockDurability: 2, doodadChance: 0.34, safeZoneCount: 1 },
      // 3-2 CROSS CURRENT. Alternating shelves take over; the lateral decision arrives earlier.
      { platformWidth: [168, 198], gap: 336, pieces: AREA3_CROSS_CURRENT, enemyChance: 0.46, flyChance: 0.65, swarm: 0.7, flow: { pathFlyers: 0.6, landingGuards: 0.4 }, toughChance: 0.45, heavyChance: 0, comboBias: 0.24, containerChance: 0.29, maxOxygenGap: 40, bubbleOffside: 0.62,
        breakBlockRows: 2, breakBlockDurability: 2, doodadChance: 0.40, safeZoneCount: 1 },
      // 3-3 DROWNED RUINS. Lanes, shelves, branches, gates and scenery at the AREA's widest spacing.
      { platformWidth: [152, 182], gap: 342, pieces: AREA3_DROWNED_RUINS, enemyChance: 0.56, flyChance: 0.75, swarm: 0.95, flow: { pathFlyers: 0.7, landingGuards: 0.45 }, toughChance: 0.5, heavyChance: 0, comboBias: 0.28, containerChance: 0.21, maxOxygenGap: 50, bubbleOffside: 0.85,
        breakBlockRows: 2, breakBlockDurability: 2, doodadChance: 0.46, safeZoneCount: 1 },
    ],
  },
  {
    // LIMBO ROLE, REBUILT (STAGE GENERATION v2, limboTerrain.ts). Rows are ~30% further apart than the barb
    // column was, so the per-row enemy chances are raised to keep enemies per 100m where they were. This was a column of barb blocks on
    // the fall line with nowhere to land past 4-1's opening: the AREA's whole difficulty was one
    // mechanic and its introduction was its hardest SECTION. Now it is broken rubble to land on and
    // reload from, some of it collapsing under the feet (BREAK: 0.65s after landing) and, from 4-2,
    // some of it turning (SPIKE PLATFORMS whose warning outlasts the walk off them). Barbs survive as
    // debris beside the route, never on it. Nothing in the pool can be stomped, so the gunboots clear
    // the way; floating scenery still reloads them between landings.
    // DOWNWELL NORMAL GAMEPLAY CLONE (reference spec, Limbo): the original's limbo has no blocks at all
    // -- no breakables, no traps -- only floating rubble, most of it topped with spikes, floating
    // doodads to reload on, and enemies none of which can be stood on: phantoms (SHADE ORB, ANGRY ORB)
    // and three kinds of "stuff" -- tapered columns crossing the screen in swarms (VOID WISP), orbiting
    // pairs (HOLLOW SHADE), diagonal bouncers (VOID SHARD). So the collapsing ledges and catacomb traps
    // this AREA carried are gone, barbed rubble becomes the common case beside the route, the long void
    // drops (where a chain is built on shots and doodad bounces) come more often, and nothing guards a
    // ledge. Depth stays 570m (~19.9 original screens; original median 18.8, D 20-23).
    id: 4, name: 'COLLAPSED REALM', sections: 3, sectionLength: 570,
    enemyPool: ['voidWisp', 'hollowShade', 'voidShard', 'shadeOrb', 'angryOrb'],
    theme: { wall: 0x241f2e, wallEdge: 0x3c3350, pillar: 0x2d2740, brick: 0x171422, accent: 0xc0a7ed, dust: 0x8c82a5, rift: { glow: 0x9d7bd8, void: 0x0b0710, debris: 0x4a3f63 } },
    plans: [
      // 4-1 THE WAY IN. Rubble to land on, barbed debris beside it, the first void drops and swarms.
      { platformWidth: [92, 112], gap: 232, pieces: AREA4_RUBBLE, enemyChance: 0, flyChance: 0.55, swarm: 0.3, toughChance: 0.3, heavyChance: 0, comboBias: 0, graceDepth: 20,
        flow: { pathFlyers: 0.4, landingGuards: 0 }, doodadChance: 0.95, laneDoodadBand: 420, safeZoneCount: 1 },
      // 4-2 THE FALLING CITY. More barbed rubble, longer and more frequent void drops.
      { platformWidth: [84, 102], gap: 238, pieces: AREA4_RUINFALL, enemyChance: 0, flyChance: 0.6, swarm: 0.45, toughChance: 0.35, heavyChance: 0, comboBias: 0,
        flow: { pathFlyers: 0.5, landingGuards: 0 }, doodadChance: 0.95, laneDoodadBand: 400, safeZoneCount: 1 },
      // 4-3 THE VOID. The longest drops, the most barbs, the thickest swarms; the route still lands.
      { platformWidth: [76, 94], gap: 244, pieces: AREA4_VOID, enemyChance: 0, flyChance: 0.65, swarm: 0.6, toughChance: 0.4, heavyChance: 0, comboBias: 0,
        flow: { pathFlyers: 0.6, landingGuards: 0 }, doodadChance: 0.95, laneDoodadBand: 380, safeZoneCount: 1 },
    ],
  },
];

export const FINAL_STAGE = { id: 'boss', label: 'FINAL BOSS', name: 'NIMUSHI' } as const;

export const areaConfig = (id: AreaId, areas: readonly AreaConfig[] = AREAS) => areas.find(a => a.id === id) ?? areas[0];
export const TOTAL_SECTIONS = AREAS.reduce((count, area) => count + area.sections, 0);
/**
 * The metres a completed run is worth. Derived from the AREA table rather than written down, so
 * changing a SECTION length moves the run total, the FINAL BOSS read-out and the tests together.
 */
export const PLANNED_TOTAL_DEPTH = AREAS.reduce((total, area) => total + area.sectionLength * area.sections, 0);
