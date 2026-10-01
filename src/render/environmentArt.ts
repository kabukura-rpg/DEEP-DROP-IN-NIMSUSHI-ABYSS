/**
 * ENVIRONMENT ART -- image-based terrain, one AREA at a time. Drawing only: nothing here reads or
 * changes collision; every piece is placed on the geometry the model already has.
 *
 * An AREA listed in ENVIRONMENT_ART draws its ordinary ledges and its shaft walls from these images;
 * an AREA that is not listed keeps the procedural look it has always had. AREA 1 and AREA 2 are
 * listed. A set may also carry the AREA's special surfaces (AREA 2: BREAK BLOCK, spike floor, belt);
 * a piece it does not carry, or whose images did not load, keeps its procedural drawing.
 *
 *   platform  a 3-slice, 24px tall: left cap 8, center 16 (repeated, the last one cropped), right cap
 *             8. The image's row 3 is the ledge's landing line `y` (SURFACE_ROW).
 *   wall      a 32x96 rock fill tiled across the wall and down the shaft, cropped to the wall's 28px
 *             on screen with its inner column against the shaft; plus a 4x96 inner-edge strip on the
 *             wall side of the boundary. The right wall is the same images mirrored.
 *   block     an 80x16 BREAK BLOCK, row 0 on the block's top, narrowed to the block's 78/79px by
 *             dropping columns from a flat run (BLOCK_DROP_FROM); crack overlays drawn over it.
 *   spike     a 17x8 socket and a 9x18 tooth (warning 1-4, active) per procedural tooth position,
 *             and a 6x8 hazard mark at each end. The tooth's bottom row is y+1, as the procedural
 *             tooth's base is y+2: its full 16px is the collision reach, SPIKE_PLATFORM_RULES.reach.
 *   belt      a 14x8 tile repeated along the ledge's center under the sockets, scrolling the way
 *             the belt carries; a 10x12 arrow at the end it carries toward. Drawn for rightward,
 *             mirrored for leftward.
 */
import area1PlatformLeftUrl from '../assets/environment/area1/platform-left-cap.png?url';
import area1PlatformCenterUrl from '../assets/environment/area1/platform-center.png?url';
import area1PlatformRightUrl from '../assets/environment/area1/platform-right-cap.png?url';
import area1WallFillUrl from '../assets/environment/area1/wall-fill.png?url';
import area1WallEdgeUrl from '../assets/environment/area1/wall-inner-edge.png?url';
import area2PlatformLeftUrl from '../assets/environment/area2/area2-platform-left-cap.png?url';
import area2PlatformCenterUrl from '../assets/environment/area2/area2-platform-center.png?url';
import area2PlatformRightUrl from '../assets/environment/area2/area2-platform-right-cap.png?url';
import area2WallFillUrl from '../assets/environment/area2/area2-wall-fill.png?url';
import area2WallEdgeUrl from '../assets/environment/area2/area2-wall-inner-edge.png?url';
import area2BlockNormalUrl from '../assets/environment/area2/area2-break-block-normal.png?url';
import area2BlockRewardUrl from '../assets/environment/area2/area2-break-block-reward.png?url';
import area2BlockCrack1Url from '../assets/environment/area2/area2-break-block-crack-1.png?url';
import area2BlockCrack2Url from '../assets/environment/area2/area2-break-block-crack-2.png?url';
import area2BeltTileUrl from '../assets/environment/area2/area2-conveyor-tile.png?url';
import area2BeltArrowUrl from '../assets/environment/area2/area2-conveyor-arrow.png?url';
import area2SpikeSocketUrl from '../assets/environment/area2/area2-spike-socket.png?url';
import area2SpikeWarning1Url from '../assets/environment/area2/area2-spike-warning-1.png?url';
import area2SpikeWarning2Url from '../assets/environment/area2/area2-spike-warning-2.png?url';
import area2SpikeWarning3Url from '../assets/environment/area2/area2-spike-warning-3.png?url';
import area2SpikeWarning4Url from '../assets/environment/area2/area2-spike-warning-4.png?url';
import area2SpikeActiveUrl from '../assets/environment/area2/area2-spike-active.png?url';
import area2SpikeEdgeUrl from '../assets/environment/area2/area2-spike-edge-mark.png?url';
import type { Platform } from '../systems/StageGenerator';
import type { SpikePlatform } from '../data/structures';

export interface EnvironmentArtSet {
  platform: { left: string; center: string; right: string };
  wall: { fill: string; edge: string };
  breakBlock?: { normal: string; reward: string; crack1: string; crack2: string };
  spike?: { socket: string; warning1: string; warning2: string; warning3: string; warning4: string; active: string; edge: string };
  conveyor?: { tile: string; arrow: string };
}
export const ENVIRONMENT_ART: Partial<Record<number, EnvironmentArtSet>> = {
  1: {
    platform: { left: area1PlatformLeftUrl, center: area1PlatformCenterUrl, right: area1PlatformRightUrl },
    wall: { fill: area1WallFillUrl, edge: area1WallEdgeUrl },
  },
  2: {
    platform: { left: area2PlatformLeftUrl, center: area2PlatformCenterUrl, right: area2PlatformRightUrl },
    wall: { fill: area2WallFillUrl, edge: area2WallEdgeUrl },
    breakBlock: { normal: area2BlockNormalUrl, reward: area2BlockRewardUrl, crack1: area2BlockCrack1Url, crack2: area2BlockCrack2Url },
    spike: {
      socket: area2SpikeSocketUrl, warning1: area2SpikeWarning1Url, warning2: area2SpikeWarning2Url, warning3: area2SpikeWarning3Url,
      warning4: area2SpikeWarning4Url, active: area2SpikeActiveUrl, edge: area2SpikeEdgeUrl,
    },
    conveyor: { tile: area2BeltTileUrl, arrow: area2BeltArrowUrl },
  },
};

/** The fixed geometry every AREA's set is drawn to (ENVIRONMENT ART ASSET AUDIT). */
export const ENVIRONMENT_GEOMETRY = {
  platform: { height: 24, cap: 8, center: 16, surfaceRow: 3 },
  wall: { fillWidth: 32, fillHeight: 96, edgeWidth: 4, shaftLeft: 28, shaftRight: 422 },
  block: { width: 80, height: 16 },
  spike: { socketWidth: 17, socketHeight: 8, toothWidth: 9, toothHeight: 18, edgeWidth: 6, edgeHeight: 8 },
  belt: { tileWidth: 14, tileHeight: 8, arrowWidth: 10, arrowHeight: 12 },
} as const;

/** Texture keys for an AREA's set. */
export const environmentKeys = (area: number) => ({
  left: `env-${area}-platform-left`, center: `env-${area}-platform-center`, right: `env-${area}-platform-right`,
  fill: `env-${area}-wall-fill`, edge: `env-${area}-wall-edge`,
  block: {
    normal: `env-${area}-block-normal`, reward: `env-${area}-block-reward`,
    crack1: `env-${area}-block-crack1`, crack2: `env-${area}-block-crack2`,
  },
  spike: {
    socket: `env-${area}-spike-socket`, warning1: `env-${area}-spike-warning1`, warning2: `env-${area}-spike-warning2`,
    warning3: `env-${area}-spike-warning3`, warning4: `env-${area}-spike-warning4`, active: `env-${area}-spike-active`,
    edge: `env-${area}-spike-edge`,
  },
  belt: { tile: `env-${area}-belt-tile`, arrow: `env-${area}-belt-arrow` },
});
export type EnvironmentKeys = ReturnType<typeof environmentKeys>;

/** Every [texture key, url] an AREA's set loads. */
export function environmentLoads(area: number, set: EnvironmentArtSet): [string, string][] {
  const keys = environmentKeys(area);
  const loads: [string, string][] = [
    [keys.left, set.platform.left], [keys.center, set.platform.center], [keys.right, set.platform.right],
    [keys.fill, set.wall.fill], [keys.edge, set.wall.edge],
  ];
  if (set.breakBlock) for (const k of ['normal', 'reward', 'crack1', 'crack2'] as const) loads.push([keys.block[k], set.breakBlock[k]]);
  if (set.spike) for (const k of ['socket', 'warning1', 'warning2', 'warning3', 'warning4', 'active', 'edge'] as const) loads.push([keys.spike[k], set.spike[k]]);
  if (set.conveyor) loads.push([keys.belt.tile, set.conveyor.tile], [keys.belt.arrow, set.conveyor.arrow]);
  return loads;
}

/**
 * Which parts of an AREA's set can be drawn from images this frame: a part is used only when its
 * set carries it AND every one of its textures loaded. Anything else -- no set (AREA 3, AREA 4, the
 * boss), a part the set does not carry, an image that failed to load -- is procedural.
 */
export function environmentParts(area: number, exists: (key: string) => boolean) {
  const set = ENVIRONMENT_ART[area];
  const keys = environmentKeys(area);
  const all = (list: string[]) => list.every(exists);
  const platform = !!set && all([keys.left, keys.center, keys.right]);
  return {
    keys,
    wall: !!set && all([keys.fill, keys.edge]),
    platform,
    breakBlock: !!set?.breakBlock && all(Object.values(keys.block)),
    // A spike floor or a belt is drawn on top of the ledge's 3-slice, so each needs that too.
    spike: platform && !!set?.spike && all(Object.values(keys.spike)),
    conveyor: platform && !!set?.conveyor && all(Object.values(keys.belt)),
  };
}
export type EnvironmentParts = ReturnType<typeof environmentParts>;

/**
 * Whether a ledge takes the image 3-slice: an ORDINARY ledge, plus -- only where `parts` says the
 * set has their images (AREA 2) -- a CATACOMB spike floor and its belt, which are then drawn over
 * the 3-slice. Every other special surface -- a BREAK BLOCK (drawn by its own images or
 * procedurally), a LIMBO row, the ABYSS arena's spike floors, a collapsing ledge in any state --
 * keeps its own procedural drawing, because its look carries its rules.
 */
export function usesPlatformArt(
  f: Partial<Pick<Platform, 'breakBlock' | 'limboHazard' | 'spikePlatform' | 'conveyor' | 'breakable' | 'state'>> & { width: number },
  parts?: Pick<EnvironmentParts, 'spike' | 'conveyor'>,
) {
  const { cap } = ENVIRONMENT_GEOMETRY.platform;
  // A CATACOMB spike floor (one with its own warning) and its belt take the image look only where
  // the set has images for them; the ABYSS arena's spike floors (no own warning) never do.
  const spikeOk = !f.spikePlatform || (!!parts?.spike && f.spikePlatform.warning !== undefined);
  const beltOk = !f.conveyor || (!!parts?.conveyor && !!f.spikePlatform);
  return !f.breakBlock && !f.limboHazard && spikeOk && beltOk && !f.breakable
    && (f.state === undefined || f.state === 'stable') && f.width >= cap * 2;
}

/**
 * Where the three slices of a ledge go. `x` and `surface` are the ledge's own (collision) x and
 * landing line; the slices are placed so the image's surface row lands exactly on it.
 */
export function platformSlices(x: number, surface: number, width: number) {
  const { cap, surfaceRow } = ENVIRONMENT_GEOMETRY.platform;
  const top = surface - surfaceRow;
  return { top, left: { x, width: cap }, center: { x: x + cap, width: width - cap * 2 }, right: { x: x + width - cap, width: cap } };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The tile offset that puts the fill's INNER column (the last one, 31) against the shaft, for a
 * wall `width` pixels wide whose inner side is its right edge (left wall) or, mirrored, its left
 * edge (right wall). The same offset serves both, because the right wall is the left one flipped.
 */
export const wallTileX = (width: number) => mod(ENVIRONMENT_GEOMETRY.wall.fillWidth - mod(width, ENVIRONMENT_GEOMETRY.wall.fillWidth), ENVIRONMENT_GEOMETRY.wall.fillWidth);
/** The vertical tile offset: the rock is fixed to the world, so it scrolls with the camera. */
export const wallTileY = (cam: number) => mod(Math.round(cam), ENVIRONMENT_GEOMETRY.wall.fillHeight);

/**
 * A BREAK BLOCK's images for its state, read straight off the model: the stone it was built as
 * (REWARD or not, decided at generation), and one crack overlay per round it has taken -- the
 * procedural drawing opens one fracture per hit the same way. Two overlays exist; a stone that has
 * taken more keeps the second.
 */
export function breakBlockFrame(hits: number, reward: boolean) {
  const base = reward ? 'reward' as const : 'normal' as const;
  const crack = hits <= 0 ? null : hits === 1 ? 'crack1' as const : 'crack2' as const;
  return { base, crack };
}

/**
 * The 80px block image fitted to the block's own collision span, which is not a whole number of
 * pixels (shaft / 5 = 78.8). The span is rounded at both ends, and the image is narrowed by leaving
 * out columns from BLOCK_DROP_FROM on: columns 69-72 of every block image (and both cracks, which
 * are clear there) are one identical flat run, so dropping one or two of them changes nothing
 * else. Columns 0..70 go at the left, the image's last columns at the right; neither end is cut.
 * Null outside 72..80px: that block keeps its procedural drawing.
 */
export const BLOCK_DROP_FROM = 71;
export function breakBlockSlices(x: number, width: number) {
  const x0 = Math.round(x), x1 = Math.round(x + width), w = x1 - x0;
  const full = ENVIRONMENT_GEOMETRY.block.width;
  if (w > full || w <= BLOCK_DROP_FROM) return null;
  const rightWidth = w - BLOCK_DROP_FROM;
  return {
    x: x0, width: w,
    left: { x: x0, srcX: 0, width: BLOCK_DROP_FROM },
    right: { x: x0 + BLOCK_DROP_FROM, srcX: full - rightWidth, width: rightWidth },
  };
}

/**
 * Which tooth image a spike floor shows. Gameplay has one warning and one active state, and this
 * reads them -- it never adds one. The warning's own timer is split into four equal quarters for
 * the four warning images (visual only); safe and cooldown show the socket alone.
 */
export function spikeFrame(spikes: Pick<SpikePlatform, 'state' | 'timer' | 'warning'>, globalWarning: number) {
  if (spikes.state === 'active') return 'active' as const;
  if (spikes.state !== 'warning') return null;
  const total = spikes.warning ?? globalWarning;
  const grown = 1 - Math.max(0, Math.min(1, spikes.timer / total));
  return (['warning1', 'warning2', 'warning3', 'warning4'] as const)[Math.min(3, Math.floor(grown * 4))];
}

/**
 * Where the sockets, teeth and end marks of a spike floor go: one per procedural tooth, at the
 * same places (i = x + 9, every 17px, while i < x + width - 8). The tooth's bottom row sits at
 * y + 1, so it stands 16px over the landing line exactly like the procedural tooth and the
 * collision reach. The socket is cropped to the ledge's own width.
 */
export function spikeLayout(x: number, surface: number, width: number) {
  const { socketWidth, toothHeight, edgeWidth } = ENVIRONMENT_GEOMETRY.spike;
  const teeth: { socket: { x: number; cropX: number; width: number }; tooth: { x: number } }[] = [];
  for (let i = x + 9; i < x + width - 8; i += 17) {
    const sx = i - 5, from = Math.max(sx, x), to = Math.min(sx + socketWidth, x + width);
    teeth.push({ socket: { x: sx, cropX: from - sx, width: to - from }, tooth: { x: i - 1 } });
  }
  return {
    teeth,
    socketTop: surface,
    toothTop: surface + 2 - toothHeight,
    edges: [{ x, flip: false }, { x: x + width - edgeWidth, flip: true }],
    edgeTop: surface + 3,
  };
}

/**
 * A belt along the ledge's face, under the sockets: the tile repeated across the ledge's center
 * (between the caps), and the arrow just inside the cap at the end it carries toward. `shift` is the
 * same scroll the procedural chevrons have (elapsed x speed), in whole pixels. Mirrored for a
 * leftward belt, so the tile is always scrolled the same way and the mirror turns it round.
 */
export function beltLayout(x: number, surface: number, width: number, dir: -1 | 1, elapsed: number, speed: number, still: boolean) {
  const { cap } = ENVIRONMENT_GEOMETRY.platform;
  const { tileWidth, arrowWidth } = ENVIRONMENT_GEOMETRY.belt;
  const shift = still ? 0 : mod(Math.floor(elapsed * speed), tileWidth);
  return {
    belt: { x: x + cap, y: surface + 8, width: Math.max(0, width - cap * 2), tileX: -shift || 0 },
    arrow: { x: dir === 1 ? x + width - cap - arrowWidth : x + cap, y: surface + 6 },
    flip: dir === -1,
  };
}
