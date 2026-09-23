/**
 * TERRAIN PIECE GRAMMAR.
 *
 * STEP 3A gave AREA 1 a vertical rhythm: the row step stopped being one number and became a set of
 * bands. Measured, that worked -- 65.7% of gaps in one 20px bin became 24.1%, the spread went 40px
 * to 252px. Played, it did not: a human A/B could barely tell the two apart. The reason is that the
 * DECISION never changed. Whatever the gap was, every row asked the same question:
 *
 *     see the next ledge -> line up left/right -> fall
 *
 * because every row WAS one ledge. A grammar of gaps cannot change that; only a grammar of shapes
 * can. So a PIECE spans several rows and states an intent for all of them at once, and each piece
 * is chosen for the question it makes the player answer rather than for how it looks:
 *
 *   NORMAL          read the next ledge            (the old grammar, kept -- see below)
 *   OPEN DROP       read a long fall               a span with no ledge in it at all
 *   LEDGE CLUSTER   choose between landings        several ledges in ONE band
 *   WALL CHANNEL    commit to a side              a route that hugs one wall for a few rows
 *   BREAKABLE DROP  open the floor, then fall      a gate row with a real drop under it
 *
 * NORMAL is deliberately still in the mix and still the most common piece. An AREA where every
 * few seconds something structural happens is not more readable than a ladder, it is just busier,
 * and AREA 1 is where the controls are learned.
 *
 * WHAT A PIECE MAY NOT DO. A piece states intent; it never places anything. The generator still
 * chooses every platform out of the candidate set that `canReachPlatform` admits, so a piece can
 * only ask for shapes the existing physics already crosses. There is no piece-shaped bypass of the
 * route's own safety, and no piece can produce an unreachable row by asking for the wrong thing --
 * the generator would throw instead, which the tests rely on.
 */
/**
 * The first five are AREA 1's, below. The last three are SUNKEN RUINS' and live in waterTerrain.ts,
 * because a piece is only ever a request to this same generator -- a second AREA wanting different
 * shapes needs new entries here and a grammar of its own, not a second terrain system.
 *
 * `normal` and `breakableDrop` are shared names rather than shared shapes: the planner forces those
 * two by id when a chamber or a gate row is due, so every grammar has to provide something under
 * each, built at its own AREA's scale.
 */
export type PieceId = 'normal' | 'openDrop' | 'ledgeCluster' | 'wallChannel' | 'breakableDrop'
  | 'openLane' | 'crossShelf' | 'shelfPair';

/** What one row of a piece asks the generator for. Everything here is a request, not a placement. */
export interface RowIntent {
  piece: PieceId;
  /** Distance to the next row, in pixels. The generator adds nothing on top. */
  step: number;
  /** Which slice of the SECTION's own `platformWidth` range this row's ledge is drawn from. */
  widthBias: readonly [number, number];
  /**
   * Hold the route against this wall. The generator prefers candidates touching it and, when none
   * is reachable yet, the candidate that best prepares for one -- the same two-step approach the
   * wall-alternation rule has always used, so a channel is entered rather than teleported into.
   */
  hug?: -1 | 1;
  /** Extra ledges to lay in THIS row's band, beside the route one. 0 keeps one row = one ledge. */
  extras: number;
  /**
   * Absolute ledge width for this row, overriding the SECTION's `platformWidth` envelope.
   *
   * Only a cluster sets it, and it has to. That envelope describes the ONE ledge a row used to
   * carry -- 176-196px in AREA 1-1, in a 394px shaft -- and two of those do not fit beside each
   * other with anywhere to stand between them. A cluster is a different object from a row, so it
   * states its own ledge size rather than being squeezed out of a number written for something else.
   */
  ledgeWidth?: readonly [number, number];
  /** True when this row's step is meant to read as a fall rather than as a gap. */
  openSpan: boolean;
}

export interface PieceSpec {
  id: PieceId;
  weight: number;
  /** Builds the piece's rows. `random` is the generator's own seeded source. */
  rows(random: () => number, side: -1 | 1): RowIntent[];
}

const between = (random: () => number, lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
const count = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

/**
 * AREA 1's pieces.
 *
 * Every number here is bounded by something measured rather than chosen for feel:
 *
 *   OPEN DROP span 600-820px. The camera holds the player at 37% of the viewport, so 504px of shaft
 *     below them is always on screen. However long the span, the last 504px of it -- 0.54s at
 *     terminal speed -- is visible before the landing, and only the part above that is unsighted.
 *     820px is just over one viewport, which is the top of the range this AREA should be asking for.
 *   LEDGE CLUSTER step 176-216px. An air enemy is laid at `y - 115`; below ~166px it would stack
 *     into the row above. Two ledges in one band need the band to still be short enough to read.
 *   Cluster ledge width 100-140px. A ground enemy needs 98px of ledge, with the landing end and
 *     the exit end both kept clear, so a narrower cluster quietly empties half the AREA of enemies
 *     -- measured, 66-112px ledges took a SECTION from 13.3 enemies to 9.9. Still well under the
 *     176-196px a normal AREA 1-1 row carries, which is what makes a cluster read as small ledges
 *     rather than as ordinary rows laid closer together.
 *   Cluster extras spread. Candidates for the NEXT row must be reachable from EVERY ledge in this
 *     band, and that intersection is non-empty only while the band's exit points lie within twice
 *     the horizontal reach of each other. At a 176-216px step the reach is 104-120px, so the spread
 *     is held to 1.5x it and the intersection can never close.
 */
export const AREA1_PIECES: readonly PieceSpec[] = [
  {
    id: 'normal', weight: 0.24,
    rows: r => Array.from({ length: count(r, 2, 4) }, () => ({
      piece: 'normal' as const, step: between(r, 232, 276), widthBias: [0, 1] as const, extras: 0, openSpan: false,
    })),
  },
  {
    // The lip, then the catch. The span sits between them, and the catch is wide because a landing
    // at terminal speed after a full screen of fall should not also be a precision problem.
    id: 'openDrop', weight: 0.18,
    rows: r => [
      { piece: 'openDrop', step: between(r, 540, 740), widthBias: [0.1, 0.6], extras: 0, openSpan: true },
      { piece: 'openDrop', step: between(r, 236, 272), widthBias: [0.72, 1], extras: 0, openSpan: false },
    ],
  },
  {
    // Several small ledges per band, close together vertically: land, pick the next one, land again.
    // This is the piece that breaks "one row = one ledge", and the only one that needs to.
    id: 'ledgeCluster', weight: 0.36,
    rows: r => Array.from({ length: count(r, 4, 6) }, () => ({
      piece: 'ledgeCluster' as const, step: between(r, 172, 206), widthBias: [0, 0.4] as const,
      ledgeWidth: [100, 140] as const, extras: count(r, 1, 2), openSpan: false,
    })),
  },
  {
    // Three rows down one wall. The other side is left open, so taking the channel is a choice about
    // where to be rather than a corridor with one way through.
    id: 'wallChannel', weight: 0.17,
    rows: (r, side) => Array.from({ length: count(r, 3, 4) }, () => ({
      piece: 'wallChannel' as const, step: between(r, 218, 268), widthBias: [0.15, 0.65] as const,
      hug: side, extras: 0, openSpan: false,
    })),
  },
  {
    // Chosen only when a BREAK BLOCK row is already due, so this adds no gates and removes none: it
    // gives the one the SECTION was going to lay anyway somewhere to fall to. The first intent is
    // the gate row itself -- the generator lays that row and takes this step from it.
    id: 'breakableDrop', weight: 0.12,
    rows: r => [
      { piece: 'breakableDrop', step: between(r, 340, 470), widthBias: [0, 1], extras: 0, openSpan: true },
      { piece: 'breakableDrop', step: between(r, 232, 268), widthBias: [0.6, 1], extras: 0, openSpan: false },
    ],
  },
];

export interface PieceGrammar {
  pieces: readonly PieceSpec[];
  /**
   * The widest step any piece in this grammar can ask for, in pixels.
   *
   * The generator's air-gap lookahead has to assume the worst case, and it used to assume a
   * literal 860 -- AREA 1's number, written into the generator. A grammar that opens further than
   * that would have had its air ceiling checked against a step shorter than the one it was about
   * to take. Declared per grammar so the check is always measured against the shaft being built.
   */
  maxStep: number;
}
export const AREA1_GRAMMAR: PieceGrammar = { pieces: AREA1_PIECES, maxStep: 860 };

/**
 * Walks a SECTION's pieces, handing out one row intent at a time.
 *
 * Two things outrank the grammar, and both cut the current piece short rather than bend it:
 *
 *   A CHAMBER IS DUE. A SAFE ZONE is cut into the space BETWEEN two rows and needs a clearance the
 *     tight pieces cannot give it. `safeZoneCount` is a guaranteed minimum, so the piece yields to
 *     a NORMAL row that can hold one -- the same rule the vertical rhythm already follows.
 *   A GATE IS DUE. A BREAK BLOCK row is laid by the SECTION's own schedule whatever the piece
 *     wanted, so the planner hands over to BREAKABLE DROP and lets that piece own the moment.
 */
export class PiecePlanner {
  private queue: RowIntent[] = [];
  private last: PieceId | null = null;
  /** Which wall the next channel hugs. Alternates so a SECTION never runs every channel one side. */
  private channelSide: -1 | 1;
  /**
   * Every piece this planner has started, and where. This is the planner's own record of what it
   * decided -- the generator grows no accessor for it, because nothing in the game asks. The
   * development read-out and the tests reach in by cast, which is how this project has always got
   * at internals it does not want in a production API.
   */
  readonly history: { piece: PieceId; y: number }[] = [];
  constructor(private grammar: PieceGrammar, private random: () => number) {
    this.channelSide = random() < 0.5 ? -1 : 1;
  }

  /**
   * The intent for the row about to be laid at `y`.
   *
   * `minStep` is a floor the CALLER needs -- a chamber's clearance. `gateDue` says the generator is
   * about to lay a BREAK BLOCK row whatever anyone wants.
   */
  next(y: number, minStep: number, gateDue: boolean): RowIntent {
    const forced: PieceId | null = gateDue ? 'breakableDrop' : minStep > 0 ? 'normal' : null;
    if (forced && this.queue[0]?.piece !== forced) this.queue = [];
    if (!this.queue.length) this.start(forced, y);
    const intent = this.queue.shift()!;
    // A chamber's clearance is not negotiable; widen this one step rather than lose the chamber.
    return minStep > 0 && intent.step < minStep ? { ...intent, step: Math.max(minStep, intent.step), openSpan: false } : intent;
  }

  private start(forced: PieceId | null, y: number) {
    const spec = forced
      ? this.grammar.pieces.find(p => p.id === forced)!
      : this.draw();
    this.last = spec.id;
    this.history.push({ piece: spec.id, y });
    if (spec.id === 'wallChannel') this.channelSide = this.channelSide === -1 ? 1 : -1;
    this.queue = spec.rows(this.random, this.channelSide);
  }

  /** Weighted, and never the same piece twice running: a repeat just reads as a longer piece. */
  private draw(): PieceSpec {
    // BREAKABLE DROP is never drawn on its own -- it exists to wrap a gate the SECTION already owes.
    const pool = this.grammar.pieces.filter(p => p.id !== this.last && p.id !== 'breakableDrop');
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = this.random() * total;
    for (const p of pool) { roll -= p.weight; if (roll <= 0) return p; }
    return pool[pool.length - 1];
  }
}
