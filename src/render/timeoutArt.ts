import type Phaser from 'phaser';

/**
 * TIMEOUT AREA PIXEL ART V1 -- candidate A of output/timeout-area-visual-design-v1 (candidate-A-spec.md,
 * claude-integration-spec.md, timeout-art.mjs).
 *
 * PRESENTATION ONLY. The TIMEOUT bubble's pale cyan disc and its rim as hard-edged 2x2-pixel steps instead of a
 * smooth fill and stroke: the same one colour, the same pulsing field alpha, the rim at the alpha the old stroke
 * composited to over the fill. Where a bubble is, how big it is, what it stops and when it goes are GameModel's,
 * untouched (the hit test is still the closed circle r96). No new texture, glow, gradient or animation. All sizes
 * are native 450x800 world pixels.
 */
export const TIMEOUT_ART = {
  /** The circle the cells are cut from: UPGRADE_TUNING.timeout.radius. */
  radius: 96,
  /** The step: every rect edge is a multiple of it from the rounded centre. */
  grid: 2,
  color: 0x9fe8f5,
} as const;

/** How far either side of the centre a 2px row starting at `y` reaches: only cells whose farthest corner fits. */
function halfSpan(y: number, radius: number) {
  const farY = Math.max(Math.abs(y), Math.abs(y + TIMEOUT_ART.grid));
  return TIMEOUT_ART.grid * Math.floor(Math.sqrt(Math.max(0, radius ** 2 - farY ** 2)) / TIMEOUT_ART.grid);
}

type Rect = [dx: number, dy: number, w: number, h: number];

/** The disc's inside (`field`) and the 2px band around it (`rim`), as [dx, dy, w, h] from the rounded centre. Built once. */
function buildGeometry() {
  const field: Rect[] = [], rim: Rect[] = [];
  const active = new Map<string, Rect>();
  const { radius, grid } = TIMEOUT_ART;
  for (let y = -radius; y < radius; y += grid) {
    const outer = halfSpan(y, radius), inner = halfSpan(y, radius - 2);
    const row: [Rect[], number, number][] = [
      [field, -inner, inner],
      [rim, -outer, -inner],
      [rim, inner, outer],
    ];
    // Combine a solid cap before merging identical runs vertically.
    if (inner === 0) row.splice(1, 2, [rim, -outer, outer]);
    for (const [layer, left, right] of row) {
      if (right <= left) continue;
      const key = (layer === rim ? 'rim' : 'field') + ':' + left + ':' + right;
      const last = active.get(key);
      if (last && last[1] + last[3] === y) last[3] += grid;
      else {
        const rect: Rect = [left, y, right - left, grid];
        layer.push(rect);
        active.set(key, rect);
      }
    }
  }
  return { field, rim };
}

export const TIMEOUT_GEOMETRY: { readonly field: readonly Readonly<Rect>[]; readonly rim: readonly Readonly<Rect>[] } = buildGeometry();

function paint(g: Phaser.GameObjects.Graphics, x: number, y: number, rects: readonly Readonly<Rect>[], alpha: number) {
  g.fillStyle(TIMEOUT_ART.color, alpha);
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    g.fillRect(x + r[0], y + r[1], r[2], r[3]);
  }
}

/**
 * One bubble centred on `cx`/`cy` (layer space: the caller has already taken the camera's scroll off), with the
 * field at `pulse` and the rim at .5 + .5 * pulse. Only the centre is snapped, to the pixel the Graphics' own
 * translation (`g.x`/`g.y`: shake and cameraX, often fractional) puts it on screen, without touching that translation.
 */
export function drawTimeoutArt(g: Phaser.GameObjects.Graphics, cx: number, cy: number, pulse: number) {
  const x = Math.round(cx + g.x) - g.x;
  const y = Math.round(cy + g.y) - g.y;
  paint(g, x, y, TIMEOUT_GEOMETRY.field, pulse);
  paint(g, x, y, TIMEOUT_GEOMETRY.rim, 0.5 + 0.5 * pulse);
}
