import type { PieceGrammar, PieceSpec } from './pieces';

/**
 * CATACOMB RUINS TERRAIN.
 *
 * AREA 2 was a ladder. Measured before this existed, a body dropped straight down the best column
 * of a CATACOMB SECTION fell 2,493-2,715px -- over a third of the SECTION, more than 100m -- before
 * anything caught it, and the rows it did meet were 236-262px apart with nothing in the way of the
 * fall between them. The ground was the AREA's idea (spike platforms that turn under your feet), but
 * nothing about the SHAPE of the shaft asked the player to be on the ground at all.
 *
 * So the CATACOMBS are now built to be walked, not fallen through:
 *
 *   BAFFLE          a shelf from one wall that covers where the last one let you off. You land on it
 *                   whether you meant to or not, and the only way down is its far end.
 *   SLOT            two shelves from both walls with a gap between: land on one and walk to the
 *                   gap, or steer for the gap and drop straight through.
 *   NORMAL          one wide ledge. Where a SAFE ZONE needs room, this is what makes it.
 *   BREAKABLE DROP  the gate row the SECTION owed, with a short fall under it -- never a long one.
 *
 * What pushes the player along those shelves is the chase: see `chasers.ts`. The terrain is the half
 * that makes being chased mean something -- in open water a ghost is simply outrun by falling.
 *
 * WHAT A PIECE MAY NOT DO is unchanged: it states intent, and every ledge still comes out of the same
 * reachability rule. A BAFFLE is only ever laid where it covers the exit above it, which is a stronger
 * guarantee than reach -- the landing is directly underneath, with no steering at all.
 */

const between = (random: () => number, lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
const count = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

/**
 * The narrowest step a CATACOMB row may take. Not a feel number: an air enemy is laid 115px above
 * its row, and below ~170px it would sit inside the row above. AREA 1's clusters live by the same
 * floor, for the same reason.
 */
export const CATACOMB_MIN_STEP = 172;
/**
 * The widest. A gate's drop is the longest fall the AREA asks for, and it stays under the 504px the
 * camera always shows below the player.
 *
 * STAGE GENERATION v2 spaces every CATACOMB piece further apart -- 2.3 rows a screen instead of 3.8 --
 * rather than adding a long-drop piece: measured, a long drop took the best straight column of a
 * SECTION back to the old ladder's 2,300px; spacing alone keeps it at ~2,000px, under the ladder the
 * AREA 2 rework replaced (2,507-2,648px median), with the same density.
 */
export const CATACOMB_MAX_STEP = 400;

export interface CatacombTerrain {
  /** Width of a BAFFLE shelf. Two consecutive ones must sum past 403px to cover each other's exit. */
  baffleWidth: readonly [number, number];
  /** The gap a SLOT leaves to drop through. Never under three bodies (54px). */
  slotGap: readonly [number, number];
  /** Spike chance on each SLOT shelf. Every CATACOMB ledge is spiked since Human Review v2, so 1. */
  slotSpike: number;
  weights: { baffle: number; slot: number; normal: number };
}

export function catacombPieces(t: CatacombTerrain): readonly PieceSpec[] {
  return [
    {
      id: 'normal', weight: t.weights.normal,
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'normal' as const, step: between(r, 330, 390), widthBias: [0.4, 1] as const,
        extras: 0, openSpan: false,
      })),
    },
    {
      /**
       * BAFFLE. Two or three shelves (STAGE GENERATION v2; it was three to five), each from the wall
       * opposite the last.
       *
       * Every one is a spike platform (Human Review, v2). The walk across one is up to 260px, more than
       * the old fixed 0.65s warning covered, so a CATACOMB spike platform's warning is its OWN, sized
       * to the walk off it from anywhere plus a reaction (`spikeReaction` in areas.ts): crossing is
       * always safe, stopping to think is not.
       */
      id: 'baffle', weight: t.weights.baffle,
      rows: r => Array.from({ length: count(r, 2, 3) }, () => ({
        piece: 'baffle' as const, step: between(r, 320, 370), widthBias: [0, 1] as const,
        ledgeWidth: t.baffleWidth, baffle: true, spikeChance: 1, extras: 0, openSpan: false,
      })),
    },
    {
      /** SLOT. One or two bands with a gap to find. */
      id: 'slot', weight: t.weights.slot,
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'slot' as const, step: between(r, 330, 380), widthBias: [0, 1] as const,
        slot: t.slotGap, spikeChance: t.slotSpike, extras: 0, openSpan: false,
      })),
    },
    {
      // The gate row the SECTION owed, then a short drop, then a wide catch.
      id: 'breakableDrop', weight: 0.1,
      rows: r => [
        { piece: 'breakableDrop', step: between(r, 300, 380), widthBias: [0, 1], extras: 0, openSpan: true },
        { piece: 'breakableDrop', step: between(r, 270, 310), widthBias: [0.6, 1], extras: 0, openSpan: false },
      ],
    },
  ];
}

export const catacombGrammar = (t: CatacombTerrain): PieceGrammar => ({ pieces: catacombPieces(t), maxStep: CATACOMB_MAX_STEP });

/** 2-1: learn the shelves. Mostly baffles, few slots; every ledge a spike platform to keep moving on. */
export const AREA2_INTRO = catacombGrammar({
  baffleWidth: [228, 256], slotGap: [70, 84], slotSpike: 1,
  weights: { baffle: 0.5, slot: 0.25, normal: 0.25 },
});
/** 2-2: more slots and narrower gaps. */
export const AREA2_PURSUIT = catacombGrammar({
  baffleWidth: [238, 266], slotGap: [62, 78], slotSpike: 1,
  weights: { baffle: 0.45, slot: 0.35, normal: 0.2 },
});
/** 2-3: the finished AREA. The tightest gaps and the widest shelves, never a denser roster. */
export const AREA2_OSSUARY = catacombGrammar({
  baffleWidth: [246, 274], slotGap: [56, 72], slotSpike: 1,
  weights: { baffle: 0.45, slot: 0.4, normal: 0.15 },
});
