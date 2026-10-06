import type { PieceGrammar, PieceSpec } from './pieces';
import { BALANCE } from './balance';
import { fallTime } from './difficulty';

/**
 * COLLAPSED REALM TERRAIN (AREA 4, LIMBO role) -- STAGE GENERATION v2. RETIRED by the LIMBO GAMEPLAY
 * REBUILD below (no SECTION plays it any more); kept, as disabled designs are, for comparison.
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

/* ------------------------------------------------------------------------------------------------
 * COLLAPSED REALM, REBUILT ON THE LIMBO REFERENCE (AREA 4 / LIMBO GAMEPLAY REBUILD).
 *
 * WHY THE GRAMMAR ABOVE IS RETIRED. Human review of `ab49ed2` found the AREA easier than AREA 1: wide
 * ledges (64-112px), wide safe air beside them, 2-8 barbs a SECTION, and a straight drop down the
 * shaft that worked. Measured over 40 seeds a SECTION: a straight fall's longest stretch without a
 * hazard was the WHOLE SECTION in every column (12,980px), hazards met 3-8% of the columns a screen,
 * a player who never pressed left or right but shot what was under them cleared 40-61%, and a
 * steering player cleared 100% for 0.3-1.0 hearts. Collapse alone (`breakableChance: 1`) changed
 * none of that: the ledges went, the shape stayed AREA 1's.
 *
 * WHAT THE REFERENCE SAYS LIMBO IS (DOWNWELL NORMAL REFERENCE SPEC, wiki + frame analysis of video D,
 * recovered from the clone pass): no solid ground; floating rubble, *mostly topped with spikes*, in
 * clusters rather than rows; floating doodads as the main reload; every enemy unstompable -- phantoms,
 * tapered "stuff" crossing in swarms, orbiting pairs, diagonal bouncers; ~2.4 enemies a screen; the
 * busiest shooting of the run (129-218 shots/min) with the most landings (1.0-1.3 a screen); hits a
 * level no higher than elsewhere for a player who plays it. The numbers that are UNKNOWN stay unknown;
 * none of the widths, spacings or rates below is the original's -- they are DEEP DROP's, measured
 * against the reference's SHAPE with the play bots in tests/limboBot.ts.
 *
 * WHAT A SECTION IS NOW. A chain of small collapsing rubble ledges, one per BAND, each band dressed by
 * a MOTIF that decides what the fall between two ledges asks for:
 *
 *   rest      a quiet band: a ledge, a little debris. Openings, and the bands a side cave is cut in.
 *   rubble    the route ledge is barbed on its far end, more barbed rubble around it
 *   undercut  barbs right under the ledge just left: ride it down when it gives way and you are hit
 *   stagger   barbed rubble left-high, right-low (or the mirror): the open side changes on the way down
 *   gate      barbed rubble in from both walls around one opening, at uneven heights
 *   guarded   a body on the way down, barbs either side of it: shoot it, or pay to go round
 *   crossfire VOID WISP columns drift through the air the route does not use: the open side moves
 *   voidDrop  a long fall to a ledge far across, past staggered barbs: brake with the recoil or steer early
 *
 * Under every motif, two rules the shaft as a whole keeps:
 *
 *   THE WAY DOWN EXISTS. Every route ledge is reached from the ledge above (and from any debris or
 *   cave sill a fall can leave from) by a fall that only steers: `limboCanReach`, from rest, after a
 *   human reaction, at 90% of walking speed. The line that fall takes -- `tubeX` -- is kept clear of
 *   every barb by a body and a margin. Nothing on it needs a shot except, in a `guarded` band, one
 *   shootable body, and the ledge above has just filled the magazine. No band is barbs alone.
 *
 *   NO COLUMN IS A WAY DOWN. A ledger keeps, per 4px column, how far down the last barb was. A column
 *   that has gone `maxClearRun` without one gets barbed rubble in the next band it can take it -- off
 *   the line, never on it. So a player who holds still (or holds one direction) is hit again and again,
 *   by rubble that sits where rubble sits, and the open side keeps moving because the line does.
 *
 * Enemies are laid by ROLE, not sprinkled: a guard on the line, columns in the air beside it, an
 * orbiting pair by a ledge, something under a barb on the side the line does not take. A SECTION has
 * about the bodies the old AREA had; what changed is where they are.
 * ---------------------------------------------------------------------------------------------- */
export type LimboMotif = 'rest' | 'rubble' | 'undercut' | 'stagger' | 'gate' | 'guarded' | 'crossfire' | 'voidDrop';

export interface LimboSpec {
  /** Width of a route ledge, px. A landing needs the body (18px) over it, so the window is width + 18. */
  ledgeWidth: readonly [number, number];
  /** Landable debris beside the route: its width, and the chance a band has one. */
  debrisWidth: readonly [number, number];
  debrisChance: number;
  /** Width of one piece of barbed rubble, px. */
  barbWidth: readonly [number, number];
  /** Height of an ordinary band (ledge to ledge), and of a void drop. */
  step: readonly [number, number];
  voidStep: readonly [number, number];
  /** How far across the shaft the route moves from one ledge's way off to the next landing, px. */
  shift: readonly [number, number];
  /** The ledger's promise: no column of the shaft goes further than this without barbed rubble, px. */
  maxClearRun: number;
  /** Share of the columns off the line each band tries to barb, on top of the ledger. */
  coverage: number;
  /**
   * Two barbs less than `STACK_REACH` apart across are at least this far apart down, px. A fall at full
   * speed covers 0.38px across for every 1px down, so a tighter stack is a pocket nothing steers out of.
   */
  stackGap: number;
  motifs: Readonly<Record<LimboMotif, number>>;
  /**
   * Bodies per band, by role. `loose` is an expected count (whole part always, fraction a chance) of
   * bodies in the air beside the line; the rest are chances: one under a barb on the side the line does
   * not take, an orbiting pair by the route ledge, and a body ON the line in a `gate`'s opening or
   * part-way down a `voidDrop` -- shot to open the way (a `guarded` band always has one).
   */
  enemies: { loose: number; underBarb: number; orbitLedge: number; gateGuard: number; dropGuard: number };
}

export const LIMBO_RULES = {
  /** Seconds before a fall starts to steer, and the share of walking speed it steers at. */
  reaction: 0.15, steer: 0.9,
  /** Px of reach a route may never ask for: the last of the steering envelope is slack. */
  slack: 10,
  /** Px kept between the line's body and any barb's hit band. */
  margin: 16,
  /** A barb is never this close above a landable ledge's top, over its width. */
  landingClear: 70,
  /** How far across two barbs count as one stack (see `stackGap`), px between their ends. */
  stackReach: 46,
} as const;

/** Sideways distance a fall from rest has covered by `depth` px, for a human who reacts and then steers. */
export const limboSteer = (depth: number) => Math.max(0, LIMBO_RULES.steer * BALANCE.moveSpeed * (fallTime(depth) - LIMBO_RULES.reaction));

/** Can a fall from `from`'s way off make `to`'s landing by steering alone? Both are surfaces (ledge tops). */
export const limboCanReach = (from: { exitX: number; y: number }, to: { safeX: number; y: number }) =>
  to.y > from.y && Math.abs(to.safeX - from.exitX) <= limboSteer(to.y - from.y) - LIMBO_RULES.slack;

/**
 * THE LINE. A fall that leaves `x0` at surface height `y0` and steers straight for `x1`, landing at
 * `y1`: where its centre is at world height `y` (centre coordinates -- a standing body's centre is 15px
 * above the surface). Before it leaves it walks the surface; after it lands it is on the ledge.
 */
export interface LimboTube {
  x0: number; y0: number; x1: number; y1: number; walkFrom: number;
  /**
   * What the line lands on: the band's route ledge, a piece of debris, or a side cave's sill. Read only
   * by tests -- the way into a cave is the side room's own rule (placeSafeZone), not `limboCanReach`.
   */
  to?: 'route' | 'debris' | 'cave';
}
export function tubeX(t: LimboTube, y: number) {
  const top = t.y0 - 15;
  if (y <= top) return t.x0;
  const dx = t.x1 - t.x0;
  return t.x0 + Math.sign(dx) * Math.min(Math.abs(dx), limboSteer(y - top));
}

/** The box, in centre coordinates, in which a body touches a barb row laid at (x, y, width). */
export const barbHitBox = (x: number, y: number, width: number, reach: number) =>
  ({ minX: x - 9, maxX: x + width + 9, minY: y - reach - 15, maxY: y + 12 + 15 });

/** Does a barb laid at (x, y, width) touch the line, or the walk along the ledge to it? */
export function tubeTouches(t: LimboTube, x: number, y: number, width: number, reach: number) {
  return tubeHits(t, barbHitBox(x, y, width, reach));
}
/** Does a body anywhere in `box` (centre coordinates) meet the line, or the walk along the ledge to it? */
export function tubeHits(t: LimboTube, box: { minX: number; maxX: number; minY: number; maxY: number }, m: number = LIMBO_RULES.margin) {
  const top = t.y0 - 15, bottom = t.y1 - 15;
  // The walk off the ledge above, along its surface.
  if (box.minY <= top && box.maxY >= top) {
    const lo = Math.min(t.walkFrom, t.x0) - m, hi = Math.max(t.walkFrom, t.x0) + m;
    if (box.maxX >= lo && box.minX <= hi) return true;
  }
  const a = Math.max(top, box.minY), b = Math.min(bottom, box.maxY);
  for (let cy = a; cy <= b; cy = cy < b ? Math.min(b, cy + 4) : b + 1) {
    const cx = tubeX(t, cy);
    if (box.maxX >= cx - m && box.minX <= cx + m) return true;
  }
  return false;
}

/**
 * 4-1 THE WAY IN. Every rule of the AREA, one at a time: barbed rubble beside the ledge, barbs under
 * the ledge just left, the open side switching, a body on the way down. Already more than AREA 1-3
 * asks -- nothing here can be fallen straight through -- but each band asks one thing.
 */
export const LIMBO_WAY_IN: LimboSpec = {
  ledgeWidth: [44, 66], debrisWidth: [30, 44], debrisChance: 0.25, barbWidth: [36, 96],
  step: [270, 380], voidStep: [470, 540], shift: [50, 150],
  maxClearRun: 1800, coverage: 0.08, stackGap: 170,
  motifs: { rest: 0.12, rubble: 0.24, undercut: 0.22, stagger: 0.18, gate: 0, guarded: 0.12, crossfire: 0.06, voidDrop: 0.06 },
  enemies: { loose: 0.6, underBarb: 0.15, orbitLedge: 0.12, gateGuard: 0, dropGuard: 0.3 },
};
/** 4-2 THE FALLING CITY. The rules start arriving together: enemy + barb + collapsing ledge in one band. */
export const LIMBO_FALLING_CITY: LimboSpec = {
  ledgeWidth: [38, 60], debrisWidth: [28, 42], debrisChance: 0.3, barbWidth: [40, 110],
  step: [280, 420], voidStep: [500, 590], shift: [70, 180],
  maxClearRun: 1500, coverage: 0.12, stackGap: 150,
  motifs: { rest: 0.06, rubble: 0.16, undercut: 0.16, stagger: 0.16, gate: 0.1, guarded: 0.16, crossfire: 0.1, voidDrop: 0.1 },
  enemies: { loose: 0.85, underBarb: 0.3, orbitLedge: 0.22, gateGuard: 0.5, dropGuard: 0.5 },
};
/** 4-3 THE VOID. The AREA complete: every band a decision, the longest falls, the smallest rubble. */
export const LIMBO_VOID: LimboSpec = {
  ledgeWidth: [34, 54], debrisWidth: [26, 40], debrisChance: 0.3, barbWidth: [44, 120],
  step: [290, 430], voidStep: [500, 580], shift: [75, 180],
  maxClearRun: 1400, coverage: 0.12, stackGap: 160,
  motifs: { rest: 0.04, rubble: 0.12, undercut: 0.14, stagger: 0.16, gate: 0.12, guarded: 0.16, crossfire: 0.12, voidDrop: 0.14 },
  enemies: { loose: 1.1, underBarb: 0.45, orbitLedge: 0.3, gateGuard: 0.7, dropGuard: 0.7 },
};

/**
 * Picks each band's motif: weighted, never the same twice running (a repeat reads as one long band),
 * and `rest` -- roomy enough for a side cave -- whenever the caller needs the clearance.
 */
export class LimboPlanner {
  private last: LimboMotif | null = null;
  readonly history: { motif: LimboMotif; y: number }[] = [];
  constructor(private spec: LimboSpec, private random: () => number) {}
  next(y: number, quiet: boolean, minStep: number): { motif: LimboMotif; step: number } {
    let motif: LimboMotif;
    if (quiet || minStep > 0) motif = 'rest';
    else {
      const pool = (Object.keys(this.spec.motifs) as LimboMotif[]).filter(m => m !== this.last && this.spec.motifs[m] > 0);
      const total = pool.reduce((s, m) => s + this.spec.motifs[m], 0);
      let roll = this.random() * total;
      motif = pool[pool.length - 1];
      for (const m of pool) { roll -= this.spec.motifs[m]; if (roll <= 0) { motif = m; break; } }
    }
    this.last = motif;
    this.history.push({ motif, y });
    const [lo, hi] = motif === 'voidDrop' ? this.spec.voidStep : this.spec.step;
    const step = Math.max(minStep, Math.round(lo + this.random() * (hi - lo)));
    return { motif, step };
  }
}
