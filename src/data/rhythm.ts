/**
 * VERTICAL RHYTHM GRAMMAR.
 *
 * The row generator used to advance by one number: `plan.gap` plus a 0-28px jitter. Measured over
 * 10 seeds x 3 SECTIONS of AREA 1 that put 60.7% of every gap in the single band 240-259px and
 * 92% inside 220-279px, with a longest single fall of 264px -- a third of a viewport. The shaft
 * was a ladder with evenly spaced rungs, and a descent down it had no shape.
 *
 * A grammar replaces that one number with a small set of BANDS. A band holds for a few rows and
 * then gives way to a different one, so the descent reads as a wave -- somewhere tight, somewhere
 * open, somewhere ordinary -- instead of a constant. The bands are drawn by weight and never
 * repeat back to back, so the order is the seed's to decide: this is deliberately NOT a fixed
 * DENSE -> NORMAL -> OPEN cycle, which would be just as predictable as the constant it replaces.
 *
 * What a band does NOT do: it never changes what the player is. Gravity, terminal speed and move
 * speed are untouched, and every row is still placed through `canReachPlatform`, so a band can
 * only ask for a gap the existing physics already crosses.
 */
import type { RoutePlatform } from '../systems/StageGenerator';

export interface RhythmBand {
  id: 'dense' | 'normal' | 'open';
  /** Row step in pixels, drawn uniformly. The generator adds nothing on top. */
  gap: readonly [number, number];
  /** Consecutive rows this band holds for, drawn uniformly and inclusive. */
  rows: readonly [number, number];
  /** Relative chance of being chosen as the NEXT band. Never chosen twice in a row. */
  weight: number;
  /**
   * Which slice of the SECTION's own `platformWidth` range this band draws from, as fractions.
   * A tight band lands on wider ledges and an open one on narrower ones, so the width sequence
   * stops being an independent coin flip. The AREA's declared width envelope is never exceeded.
   */
  widthBias: readonly [number, number];
}

export interface RhythmGrammar {
  bands: readonly RhythmBand[];
}

/**
 * AREA 1's grammar. The AREA is where the controls are learned, so the shape here is about giving
 * the descent a pulse rather than about danger: no band is lethal, and OPEN is a fall the player
 * accelerates through, not a drop that ends a run.
 *
 * The numbers are bounded by two measured limits, not by taste:
 *
 *   DENSE floor 168px -- an air enemy is laid at `y - 115`, so a shorter step would stack it into
 *                        the row above. 168 leaves 53px of clearance and a 101px horizontal reach,
 *                        against the ~38px the worst-case wall-to-wall transfer actually needs.
 *   OPEN  ceiling 420px -- terminal speed arrives after 257px of fall, so anything past that is
 *                        already a full-speed fall; 420px is 0.52 of a viewport and 0.73s, which
 *                        is a fall the player feels without being a plunge.
 *
 * The weights are set so the MEAN step stays near the 250px the legacy generator produced. That is
 * deliberate: rows per SECTION, and therefore enemies per SECTION, must not move because the
 * rhythm changed. The rhythm is the variable under test; density is not.
 */
export const AREA1_RHYTHM: RhythmGrammar = {
  bands: [
    { id: 'dense', gap: [168, 208], rows: [2, 4], weight: 0.26, widthBias: [0.45, 1.0] },
    { id: 'normal', gap: [232, 276], rows: [2, 4], weight: 0.48, widthBias: [0, 1] },
    { id: 'open', gap: [320, 420], rows: [1, 2], weight: 0.26, widthBias: [0, 0.55] },
  ],
};

/**
 * DEVELOPMENT A/B ONLY.
 *
 * `legacy` makes the generator ignore every grammar and fall back to the single `plan.gap` number,
 * so the same seed can be played both ways and the difference attributed. Production never calls
 * this: the only call site is behind `import.meta.env.DEV` in main.ts, and the default is the
 * shipping behaviour.
 */
export type TerrainMode = 'rhythm-v1' | 'legacy';
let terrainMode: TerrainMode = 'rhythm-v1';
export const setTerrainMode = (mode: TerrainMode) => { terrainMode = mode; };
export const getTerrainMode = () => terrainMode;

/**
 * Walks one SECTION's bands. Holds the current band and how many rows it has left, and draws its
 * randomness from the generator's own seeded source so a seed still produces one fixed SECTION.
 */
export class RhythmWalker {
  private band: RhythmBand;
  private left: number;
  constructor(private grammar: RhythmGrammar, private random: () => number) {
    this.band = grammar.bands.find(b => b.id === 'normal') ?? grammar.bands[0];
    this.left = this.draw(this.band.rows);
  }
  private draw(range: readonly [number, number]) { return range[0] + Math.floor(this.random() * (range[1] - range[0] + 1)); }
  /**
   * The band this row belongs to. Advances to a new band once the current one runs out.
   *
   * `minGap` is a floor the CALLER needs this row to clear -- a SAFE ZONE chamber is cut into the
   * space between two rows, so a row that is due one cannot be handed a band too tight to hold it.
   * A run is cut short rather than a chamber lost: the guaranteed chamber outranks the rhythm.
   */
  current(minGap = 0): RhythmBand {
    if (this.left <= 0 || this.band.gap[0] < minGap) {
      // Never the same band twice running: a repeat would be indistinguishable from a longer run,
      // and the run length is already the thing that varies.
      const roomy = this.grammar.bands.filter(b => b.gap[0] >= minGap);
      const options = roomy.filter(b => b.id !== this.band.id);
      // If nothing is roomy enough the caller's own fit test still decides; never strand the walker.
      const pool = options.length ? options : roomy.length ? roomy : this.grammar.bands.filter(b => b.id !== this.band.id);
      const total = pool.reduce((sum, b) => sum + b.weight, 0);
      let roll = this.random() * total;
      let next = pool[pool.length - 1];
      for (const b of pool) { roll -= b.weight; if (roll <= 0) { next = b; break; } }
      this.band = next;
      this.left = this.draw(next.rows);
    }
    this.left--;
    return this.band;
  }
  /** The step to the next row, in pixels. */
  step(band: RhythmBand) { return Math.round(band.gap[0] + this.random() * (band.gap[1] - band.gap[0])); }
}

/**
 * Which horizontal answer a row asks the player for. Left and right are the SAME question mirrored,
 * so they fold together: what varies is how far across the shaft the landing is, not which hand it
 * is under. Used to stop the generator asking for the same answer row after row.
 */
export function laneOf(platform: RoutePlatform, shaftLeft: number, shaftWidth: number): 'wall' | 'near' | 'mid' {
  const fromLeft = platform.x - shaftLeft;
  const fromRight = shaftLeft + shaftWidth - (platform.x + platform.width);
  if (Math.min(fromLeft, fromRight) <= 2) return 'wall';
  const t = (platform.safeX - shaftLeft) / shaftWidth;
  return t < 0.34 || t > 0.66 ? 'near' : 'mid';
}
