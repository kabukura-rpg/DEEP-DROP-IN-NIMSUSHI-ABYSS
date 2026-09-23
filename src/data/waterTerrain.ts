import { BALANCE, WORLD } from './balance';
import { horizontalReach } from './difficulty';
import type { WaterPhysics } from './areas';
import type { PieceGrammar, PieceSpec, RowIntent } from './pieces';

/**
 * SUNKEN RUINS TERRAIN.
 *
 * AREA 3 used to be AREA 2 with water in it. Measured against CATACOMB RUINS, its plan was the same
 * plan: identical platformWidth, gap, enemyChance, flyChance, toughChance, comboBias, breakBlockRows
 * and safeZoneCount, section for section. The only things that differed were the air containers and
 * the water physics -- so the AREA read as "the catacombs, but blue", and a player could not tell
 * which world they were in from the shaft alone.
 *
 * What the two AREAs are FOR is not the same, and the terrain now says so:
 *
 *   CATACOMBS    the ground is the threat. Narrow ledges close together, spike platforms arming
 *                under the player's feet, a local dodge every couple of seconds.
 *   SUNKEN RUINS the BREATH is the threat, and the route is decided by where the air is. That only
 *                works if the player can SEE where the air is, early enough to change their mind --
 *                which means open water, long sightlines, and a small number of large decisions
 *                instead of a large number of small ones.
 *
 * So AREA 3 is built out of open lanes and big alternating shelves. Nothing here touches the water
 * numbers, the enemies, the air supply or the oxygen rules: this is the shape of the shaft and
 * nothing else.
 */

/**
 * THE PLAYER'S OWN WIDTH, taken from the one rule that decides a landing rather than from a sprite:
 *
 *     p.x + 9 > f.x && p.x - 9 < f.x + f.width
 *
 * Nine pixels each side of centre, so the body is 18px across and a ledge holds the player while
 * any part of that box is over it.
 */
export const PLAYER_BODY = 18;

/**
 * HOW FAR A SUBMERGED PLAYER CARRIES AFTER LETTING GO.
 *
 * Underwater the horizontal move is `vx += (target - vx) * responsiveness * dt`, so releasing the
 * input leaves `vx' = -k*vx` with k = responsiveness. That decay integrates to exactly v/k, and at
 * moveSpeed 350 with responsiveness 11 it is 31.8px. It is the same term `horizontalReach` already
 * subtracts for water, which is the point: this is not a new estimate of anything, it is the number
 * the route maths is already using, read for what it means.
 */
export const waterDrift = (water: WaterPhysics) => BALANCE.moveSpeed / water.responsiveness;

/**
 * THE NARROWEST LEDGE SUNKEN RUINS IS ALLOWED TO PUT THE ROUTE ON.
 *
 * A player aiming at a landing releases the input somewhere, and the drift above is how wrong that
 * moment can be in either direction while the body still ends up over the slab. Body plus drift on
 * each side:
 *
 *     18 + 2 * 31.8 = 81.6  ->  82px
 *
 * Below this a landing stops being a decision and becomes an input-timing test, which is the one
 * thing water inertia makes unfair. Every AREA 3 ledge width in `areas.ts` is above it, and the
 * terrain audit asserts that rather than trusting it.
 */
export const minSafeLanding = (water: WaterPhysics) => Math.ceil(PLAYER_BODY + 2 * waterDrift(water));

/**
 * THE LONGEST OPEN SPAN A SECTION MAY ASK FOR.
 *
 * Not a feel number. Air is placed at most once per row, at the middle of the band between two
 * rows, so two consecutive spans of length s put their air sources s apart -- and the SECTION's own
 * `maxOxygenGap` is a hard ceiling on exactly that distance. A span longer than the ceiling would
 * build a stretch the generator has promised cannot exist.
 *
 * This is why the AREA opens up as it goes rather than all at once: 3-1 is capped at 30m, 3-2 at
 * 40m, 3-3 at 50m, because those are the air ceilings those SECTIONs already declared. The oxygen
 * rules are untouched -- the terrain is what bends around them.
 */
export const spanCeiling = (maxOxygenGapMetres: number) => Math.floor(maxOxygenGapMetres * WORLD.pixelsPerMeter);

const between = (random: () => number, lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
const count = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

export interface WaterTerrain {
  /** Longest open span this SECTION may ask for, in pixels. From `spanCeiling`, never invented. */
  maxSpan: number;
  /** Shortest ordinary step. Well above CATACOMB's 236-248 -- that ladder is what this replaces. */
  step: readonly [number, number];
  /**
   * The shortest OPEN LANE this SECTION draws, as a share of its own `maxSpan`.
   *
   * It is what decides whether a SECTION's lanes are uniform or varied: at 0.8 every lane is close
   * to the cap and they all read alike, at 0.4 they run from half a screen to the full ceiling and
   * no two falls are the same length. 3-1 sits high because a SECTION teaching open water should
   * make the same promise every time; the later SECTIONs sit lower because by then the length of
   * the fall is itself information.
   */
  laneShare: number;
  weights: { openLane: number; crossShelf: number; shelfPair: number; normal: number };
}

/**
 * The five shapes SUNKEN RUINS is made of. Three of them are new and are the AREA's identity; the
 * other two exist because the planner forces them by name -- `normal` when a SAFE ZONE needs room
 * and `breakableDrop` when the SECTION owes a gate row -- and both are rebuilt at AREA 3's scale
 * rather than borrowed from AREA 1.
 *
 *   OPEN LANE     a long drop with nothing in it, read from the top. The AREA's signature.
 *   CROSS SHELF   big shelves jutting alternately from each wall. The lateral decision.
 *   SHELF PAIR    two landings at the SAME height, one each side. The route branch.
 *   NORMAL        one wide ledge, at AREA 3's spacing. Deliberately the least common piece here.
 *   BREAKABLE     the gate row the SECTION already owed, with open water under it.
 */
export function waterPieces(t: WaterTerrain): readonly PieceSpec[] {
  const [stepLow, stepHigh] = t.step;
  /** A span is at least two ordinary steps -- otherwise it reads as a gap -- and never over the cap. */
  const span = (random: () => number, share: number) =>
    Math.min(t.maxSpan, between(random, Math.min(t.maxSpan, Math.max(stepHigh * 1.6, t.maxSpan * share)), t.maxSpan));
  return [
    {
      id: 'normal', weight: t.weights.normal,
      // One or two rows, never the four AREA 1 runs: a ladder is the thing this AREA is not.
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'normal' as const, step: between(r, stepLow, stepHigh), widthBias: [0.4, 1] as const,
        extras: 0, openSpan: false,
      })),
    },
    {
      /**
       * OPEN LANE. A wide lip, then open water, then a wide catch.
       *
       * The lip is wide on purpose. AREA 1's OPEN DROP narrows its lip to make the edge a moment;
       * here the moment is the fall itself and the lip is just where it starts, so putting a
       * precision problem in front of a long drop would be two questions stacked on one another.
       */
      id: 'openLane', weight: t.weights.openLane,
      rows: r => [
        { piece: 'openLane', step: span(r, t.laneShare), widthBias: [0.45, 1], extras: 0, openSpan: true },
        { piece: 'openLane', step: between(r, stepLow, stepHigh), widthBias: [0.7, 1], extras: 0, openSpan: false },
      ],
    },
    {
      /**
       * CROSS SHELF. Three or four shelves, each held against a wall, alternating side by side.
       *
       * A wall-hugging shelf has only one legal exit -- the generator rejects the candidate whose
       * exit would fall inside the brickwork -- so the player always leaves it by its INNER edge,
       * and the next shelf is against the other wall. That is the whole shape: leave right, cross,
       * land left, leave left, cross back.
       *
       * The steps are long because the crossing is the point. With water inertia the player reaches
       * full speed in 0.27s and carries 32px after letting go, so a crossing decided at the last
       * moment cannot be made; decided from the top of the fall, it is easy. Long steps are what
       * turn "react" into "commit", which is the difference between this AREA and the catacombs.
       *
       * WHY THE SHELF STATES ITS OWN WIDTH, AND WHY IT IS NARROWER THAN THE SECTION'S.
       *
       * Both shelves reach inward from opposite walls, so the distance the player actually crosses
       * is what is LEFT between their inner edges:
       *
       *     crossing = 408 - width(left) - width(right)
       *
       * Built at the SECTION's own 168-214px that comes out at 38px, measured -- two shelves nearly
       * touching in the middle, and a "crossing" the player makes by drifting. The piece is a
       * different object from a row, exactly as AREA 1's cluster is, so it names a width that leaves
       * water in the middle: at 126-158 the crossing is 92-156px, which is a real traverse.
       *
       * It is still far above the 82px `minSafeLanding`, and the step range is chosen so the fall
       * always buys more reach than the widest crossing needs -- 380px of fall is worth 163px of
       * steering underwater, against a 156px worst case -- so the alternation can never ask for a
       * ledge `canReachPlatform` would reject and quietly collapse back into an ordinary row.
       */
      id: 'crossShelf', weight: t.weights.crossShelf,
      rows: (r, side) => {
        const rows = count(r, 3, 4);
        return Array.from({ length: rows }, (_, i) => ({
          piece: 'crossShelf' as const,
          step: between(r, 380, 470),
          widthBias: [0, 1] as const,
          ledgeWidth: [126, 158] as const,
          hug: (i % 2 === 0 ? side : -side) as -1 | 1,
          extras: 0, openSpan: false,
        }));
      },
    },
    {
      /**
       * SHELF PAIR. Two landings at one height, one on each side of the shaft, with open water
       * between them -- so the question is not "can I reach the ledge" but "which side of the AREA
       * do I want to be on", which is the question an air container two rows down is asking.
       *
       * Both ledges are drawn from `ledgeWidth` rather than the SECTION envelope, because two
       * SECTION-width shelves do not fit side by side with room to stand between them. The floor of
       * that range is checked against `minSafeLanding` by the terrain audit.
       */
      id: 'shelfPair', weight: t.weights.shelfPair,
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'shelfPair' as const,
        step: between(r, Math.round(stepHigh * 1.1), Math.round(stepHigh * 1.5)),
        widthBias: [0, 1] as const, ledgeWidth: [124, 156] as const,
        extras: 1, openSpan: false,
      })),
    },
    {
      // Drawn only when a gate row is already due, exactly as AREA 1's is: it adds no gates and
      // removes none, it gives the one the SECTION owed some open water to fall into.
      id: 'breakableDrop', weight: 0.1,
      rows: r => [
        { piece: 'breakableDrop', step: span(r, t.laneShare * 0.6), widthBias: [0.4, 1], extras: 0, openSpan: true },
        { piece: 'breakableDrop', step: between(r, stepLow, stepHigh), widthBias: [0.65, 1], extras: 0, openSpan: false },
      ],
    },
  ];
}

export const waterGrammar = (t: WaterTerrain): PieceGrammar => {
  const pieces = waterPieces(t);
  // Every lookahead that has to stay conservative asks for this. Derived from the grammar rather
  // than written down, so a SECTION cannot quietly out-step the air-gap check.
  return { pieces, maxStep: Math.round(t.maxSpan) };
};

/**
 * 3-1 OPEN WATER. The widest ledges and the fewest of them: the SECTION where the controls meet the
 * water. Its 30m air ceiling is the tightest in the AREA, so its lanes are the shortest -- openness
 * here is carried by ledge width and by how little there is between one landing and the next.
 */
export const AREA3_OPEN_WATER = waterGrammar({
  maxSpan: spanCeiling(30), step: [300, 360], laneShare: 0.80,
  weights: { openLane: 0.50, crossShelf: 0.18, shelfPair: 0.10, normal: 0.22 },
});

/**
 * 3-2 CROSS CURRENT. The alternating shelf takes over. Route choices arrive more often and have to
 * be committed to earlier, without one number of the water physics moving.
 */
export const AREA3_CROSS_CURRENT = waterGrammar({
  maxSpan: spanCeiling(40), step: [310, 372], laneShare: 0.55,
  weights: { openLane: 0.24, crossShelf: 0.44, shelfPair: 0.20, normal: 0.12 },
});

/**
 * 3-3 DROWNED RUINS. All of it at once -- long lanes, alternating shelves, branches, gates and
 * scenery to bounce from -- at the AREA's widest spacing. Never the catacombs' density.
 */
export const AREA3_DROWNED_RUINS = waterGrammar({
  maxSpan: spanCeiling(50), step: [316, 384], laneShare: 0.38,
  weights: { openLane: 0.30, crossShelf: 0.32, shelfPair: 0.26, normal: 0.12 },
});

/**
 * OPEN LANE RATE, the one number that says whether this AREA reads as open water.
 *
 * Defined as: the share of a SECTION's vertical extent that a player could descend through without
 * meeting any ledge, measured in bands. A band between two rows counts as open lane when it is at
 * least `openLaneSpan` tall -- long enough that the fall is a fall rather than a gap -- and it is
 * counted for its whole height. Reported as that height over the SECTION's own height.
 *
 * `openLaneSpan` is the camera, not a preference: GameModel frames the player at 0.37 of the
 * viewport, so 504px of shaft is visible below them at all times. A band shorter than that is
 * entirely on screen the moment it begins and is read as one picture; a band longer than it has a
 * part the player falls into before seeing, which is what makes it a lane rather than a gap.
 */
export const OPEN_LANE_SPAN = Math.round(WORLD.height * 0.63);

/** The widest reach a fall of `drop` buys underwater. Re-exported so audits use the route's maths. */
export const waterReach = (drop: number, water: WaterPhysics) => horizontalReach(drop, water);
