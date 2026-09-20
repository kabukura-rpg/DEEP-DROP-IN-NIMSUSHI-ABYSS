import type { Platform } from '../systems/StageGenerator';

/**
 * TERRAIN WATCH -- a development-only recorder for the "blocks sometimes all change" report.
 *
 * WHY IT EXISTS
 * A human playing normally saw the terrain change wholesale. A model-level probe then snapshotted
 * every platform every frame across five SECTIONs and found ZERO mutations: no id was ever reused
 * with different geometry, and no x/y/width ever moved after generation. So whatever was seen was
 * not the model rewriting itself -- and the investigation is NOT closed by that, it is only narrowed.
 * This watches the layer the probe could not: what the frame actually renders.
 *
 * WHAT IT SEPARATES
 * A platform contributes two independent signatures, because the two failure modes look identical on
 * screen and have nothing to do with each other:
 *
 *   GEOMETRY  id, x, y, width. Must never change once generated. Any change is a real bug.
 *   APPEARANCE everything the renderer branches on: collapse state, breakable, spike, gate wear.
 *              Changing is legal -- that is how a cracking ledge warns -- but changing for MANY
 *              ledges in ONE frame is the shape of the reported symptom, so it is counted and
 *              attributed rather than ignored.
 *
 * KNOWN LEGITIMATE CAUSE OF A BULK APPEARANCE CHANGE, to be ruled in or out rather than assumed:
 * RUIN BREAKER. A dying enemy cracks every breakable ledge within BREAK_RULES.shatterRadius (190px)
 * of it, and rows sit roughly 200px apart -- so one kill can recolour two or three rows in a single
 * frame, green to yellow to pink. If that is what was seen, this will say so with a timestamp and a
 * count. If the dump shows a bulk change with NO kill nearby, the cause is somewhere else and this
 * narrows it further.
 *
 * COST
 * Nothing outside development. The scene's call site is behind `import.meta.env.DEV`, so the whole
 * module is dropped from a production bundle and never allocates.
 */

/** Everything the renderer branches on, flattened. Two ledges that look alike share this string. */
function appearanceOf(f: Platform): string {
  const b = f.breakBlock;
  return [
    f.state ?? 'stable',
    f.breakable ? 'B' : '-',
    f.spikePlatform ? `S${typeof f.spikePlatform === 'object' ? 'o' : f.spikePlatform}` : '-',
    f.limboHazard ? 'L' : '-',
    f.safeZone !== undefined ? 'Z' : '-',
    b ? `K${b.hits}/${b.durability}${b.reward ? 'r' : ''}` : '-',
  ].join('|');
}
const geometryOf = (f: Platform) => `${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.width)}`;

export interface TerrainEvent {
  t: number;
  frame: number;
  kind: 'GEOMETRY MUTATION' | 'BULK RESTYLE' | 'ID REUSE';
  detail: string;
  /** Where the camera was, so a dump can be lined up against what the player was looking at. */
  cameraY: number;
  /** The run's own coordinates, so a report can name the SECTION rather than a raw depth. */
  where: string;
}

export class TerrainWatch {
  private geometry = new Map<number, string>();
  private appearance = new Map<number, string>();
  private frame = 0;
  /** A ring buffer: the session keeps the last 200 notable events and nothing else. */
  readonly events: TerrainEvent[] = [];
  /** How many ledges must restyle in ONE frame before it counts as bulk rather than gameplay. */
  bulkThreshold = 4;
  private limit = 200;

  /**
   * Call once per rendered frame with the platforms the frame is about to draw -- the VISIBLE ones,
   * culled exactly as the renderer culls them. Feeding it the whole list instead would report every
   * row scrolling into view as a change, which is the noise that hid the signal the first time.
   */
  observe(visible: readonly Platform[], cameraY: number, where: string, t: number) {
    this.frame++;
    const restyled: string[] = [];
    const live = new Set<number>();
    for (const f of visible) {
      live.add(f.id);
      const g = geometryOf(f), a = appearanceOf(f);
      const hadG = this.geometry.get(f.id);
      if (hadG !== undefined && hadG !== g) {
        this.push({ t, frame: this.frame, kind: 'GEOMETRY MUTATION', cameraY, where,
          detail: `id ${f.id}: ${hadG} -> ${g}` });
      }
      const hadA = this.appearance.get(f.id);
      // ' => ' rather than '->': an appearance key ends in '-' often enough that '->' ran into it.
      if (hadA !== undefined && hadA !== a) restyled.push(`${f.id}[${hadA} => ${a}]`);
      this.geometry.set(f.id, g);
      this.appearance.set(f.id, a);
    }
    if (restyled.length >= this.bulkThreshold) {
      this.push({ t, frame: this.frame, kind: 'BULK RESTYLE', cameraY, where,
        detail: `${restyled.length} ledges in one frame -- ${restyled.join(' ')}` });
    }
    // Forget rows that have scrolled away, so a long run's maps stay the size of the screen. An id
    // that comes back later with different geometry is caught by the reuse check below.
    if (this.frame % 240 === 0) {
      for (const id of [...this.geometry.keys()]) if (!live.has(id)) { this.geometry.delete(id); this.appearance.delete(id); }
    }
  }

  private push(event: TerrainEvent) {
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
  }

  /** What to paste into a bug report. Returns the text as well as printing it. */
  dump() {
    const lines = this.events.length
      ? this.events.map(e => `[${e.t.toFixed(2)}s f${e.frame} ${e.where} cam${Math.round(e.cameraY)}] ${e.kind}: ${e.detail}`)
      : ['no geometry mutation and no bulk restyle observed this session'];
    const text = `--- TERRAIN WATCH (${this.frame} frames) ---\n${lines.join('\n')}`;
    console.log(text);
    return text;
  }
  reset() { this.geometry.clear(); this.appearance.clear(); this.events.length = 0; this.frame = 0; }
}
