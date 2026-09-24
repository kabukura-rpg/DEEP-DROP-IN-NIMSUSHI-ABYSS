import type { PieceGrammar, PieceSpec } from './pieces';

/**
 * COLLAPSED REALM TERRAIN (AREA 4, LIMBO role) -- STAGE GENERATION v2.
 *
 * WHAT IT REPLACES. AREA 4 was a column of barbs: every row past 4-1's opening was one LIMBO barb
 * block that nothing could land on, laid by the ordinary route search -- which means reachable from
 * the row above, which means on the natural fall line. Measured over 500 seeds x 3 SECTIONs at
 * c9a0a63: 34-36 barb rows a SECTION, 2 / 0 / 0 landable ledges, 21.5% of 4-1's rows asking for more
 * sideways travel at terminal speed than walking gives. Bots that clear AREA 1-3 at 0.03-0.5 hearts
 * a SECTION lost 2.9 in 4-1 alone, 75-86% of it to the barbs, and the AREA's introduction was the
 * hardest of its three SECTIONs. PHASE 7C-1's footage showed Downwell's Limbo as landable rubble with
 * local hazards and floating enemies; no row of barbs across the shaft appeared in any of three runs.
 *
 * WHAT IT IS NOW. A collapsed space descended with every tool the run has learned: land on broken
 * rubble and reload, shoot what floats between the ledges, brake with the recoil, choose a landing.
 * Built out of pieces the generator already lays and hazards the AREAs already have:
 *
 *   RUBBLE STEP   one narrow ledge per row: the plain row, and what a chamber is cut beside.
 *   RUBBLE FIELD  debris around the route ledge in one band: pick a landing. Some debris is BARBS --
 *                 the LIMBO hazard kept as a local obstacle beside the route, never as the route.
 *   RUBBLE STAIR  a few rows down one wall: the broken slope, taken or left.
 *   VOID DROP     a lip, a long unbroken fall, a catch with barbed debris around it. The catch is
 *                 reachable by steering alone from the lip; coming down at full speed leaves ~0.6s to
 *                 line up, and braking with the gunboots buys the time. That is the recoil's place.
 *
 * On top of the pieces, per SECTION (areas.ts): collapsing ledges (the existing BREAK system: a ledge
 * gives way 0.65s after it is first landed on) and, from 4-2, spike platforms whose own warning
 * outlasts the walk off them. Neither ever damages on the landing itself.
 *
 * WHAT A PIECE MAY NOT DO is unchanged: it states intent. Every route ledge still comes out of the
 * candidate search `canReachPlatform` admits, at walking speed -- nothing here requires a shot.
 */
const between = (random: () => number, lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
const count = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

export interface LimboTerrain {
  /** Chance that each piece of debris in a RUBBLE FIELD is a barb block rather than a landing. */
  fieldBarbs: number;
  /** Debris ledges in a RUBBLE FIELD band. */
  fieldExtras: readonly [number, number];
  /** The long fall of a VOID DROP, in pixels. At most 600: the camera always shows 504px below. */
  voidSpan: readonly [number, number];
  /** Chance that each piece of debris around a VOID DROP's catch is a barb block. */
  catchBarbs: number;
  weights: { step: number; field: number; stair: number; drop: number };
}

/** Debris is 64-90px: over three bodies to stand on, and plainly not a ledge of the route's width. */
const DEBRIS = [64, 90] as const;

export function limboPieces(t: LimboTerrain): readonly PieceSpec[] {
  return [
    {
      id: 'normal', weight: t.weights.step,
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'normal' as const, step: between(r, 320, 390), widthBias: [0, 1] as const, extras: 0, openSpan: false,
      })),
    },
    {
      id: 'rubbleField', weight: t.weights.field,
      rows: r => Array.from({ length: count(r, 1, 2) }, () => ({
        piece: 'rubbleField' as const, step: between(r, 250, 300), widthBias: [0, 1] as const,
        extraWidth: DEBRIS, extras: count(r, t.fieldExtras[0], t.fieldExtras[1]), openSpan: false,
        barbChance: t.fieldBarbs,
      })),
    },
    {
      // Down one wall for a few rows; staircases alternate walls, so a SECTION never holds one side.
      id: 'rubbleStair', weight: t.weights.stair,
      rows: (r, side) => Array.from({ length: count(r, 2, 3) }, () => ({
        piece: 'rubbleStair' as const, step: between(r, 290, 340), widthBias: [0.2, 0.8] as const,
        hug: side, extras: 0, openSpan: false,
      })),
    },
    {
      id: 'voidDrop', weight: t.weights.drop,
      rows: r => [
        { piece: 'voidDrop' as const, step: between(r, t.voidSpan[0], t.voidSpan[1]), widthBias: [0, 0.6] as const, extras: 0, openSpan: true },
        { piece: 'voidDrop' as const, step: between(r, 280, 330), widthBias: [0.7, 1] as const, extras: count(r, 1, 2), openSpan: false,
          extraWidth: DEBRIS, barbChance: t.catchBarbs },
      ],
    },
  ];
}

export const limboGrammar = (t: LimboTerrain): PieceGrammar => ({ pieces: limboPieces(t), maxStep: t.voidSpan[1] });

/** 4-1 THE WAY IN. Steps and stairs between the first void drops; barbed rubble already common, as in the original. */
export const AREA4_RUBBLE = limboGrammar({
  fieldBarbs: 0.45, fieldExtras: [1, 2], voidSpan: [460, 540], catchBarbs: 0.4,
  weights: { step: 0.25, field: 0.3, stair: 0.15, drop: 0.3 },
});
/** 4-2 THE FALLING CITY. More debris fields and more barbs in them; longer drops onto barbed catches. */
export const AREA4_RUINFALL = limboGrammar({
  fieldBarbs: 0.55, fieldExtras: [1, 2], voidSpan: [500, 580], catchBarbs: 0.5,
  weights: { step: 0.15, field: 0.3, stair: 0.1, drop: 0.45 },
});
/** 4-3 THE VOID. Every tool at once: the longest drops, the most barbed catches, the fewest steps. */
export const AREA4_VOID = limboGrammar({
  fieldBarbs: 0.65, fieldExtras: [1, 2], voidSpan: [520, 600], catchBarbs: 0.6,
  weights: { step: 0.1, field: 0.25, stair: 0.1, drop: 0.55 },
});
