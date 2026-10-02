/**
 * ENVIRONMENT ART -- image-based terrain, one AREA at a time. Drawing only: nothing here reads or
 * changes collision; every piece is placed on the geometry the model already has.
 *
 * An AREA listed in ENVIRONMENT_ART draws its ordinary ledges and its shaft walls from these images;
 * an AREA that is not listed keeps the procedural look it has always had. AREA 1, AREA 2, AREA 3 and
 * AREA 4 are listed, and so is THE ABYSS's staging room ('staging': from the room's opening until the arena
 * takes over), which has ledges and walls only -- the seal stays procedural -- and the FINAL BOSS's arena
 * ('boss': the fight itself), which has walls only: the arena lays no ledge to draw. A set may also carry the AREA's special surfaces (AREA 2: BREAK BLOCK, spike floor, belt);
 * a piece it does not carry, or whose images did not load, keeps its procedural drawing. AREA 3
 * carries its barbed reef (reefBarb); AREA 4 its LIMBO barbs (limboHazard).
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
 *   reef      a 9x12 barb per procedural tooth of a shelf-end patch (every 9px), its bottom row on the
 *             patch's bottom; an 18x9 barb every other 9px down a wall patch over a 4x9 base strip
 *             along its whole height, against the wall. The right wall is mirrored. Every image is
 *             cropped to the patch's collision box: nothing is drawn outside it.
 *   limbo     a 13x24 barb repeated at the procedural barbs' 13px pitch across the row's whole width:
 *             as many whole ones as fit, centred, and the leftover split evenly between a cropped barb
 *             at each end, so the barbs reach both ends of the row and never past them. Row 14 (the
 *             dark seam) on y+1, so the opaque rows run y-13..y+9, inside the hit band y-14..y+12.
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
import area3PlatformLeftUrl from '../assets/environment/area3/area3-platform-left-cap.png?url';
import area3PlatformCenterUrl from '../assets/environment/area3/area3-platform-center.png?url';
import area3PlatformRightUrl from '../assets/environment/area3/area3-platform-right-cap.png?url';
import area3WallFillUrl from '../assets/environment/area3/area3-wall-fill.png?url';
import area3WallEdgeUrl from '../assets/environment/area3/area3-wall-inner-edge.png?url';
import area3ReefUpUrl from '../assets/environment/area3/area3-reef-up.png?url';
import area3ReefSideUrl from '../assets/environment/area3/area3-reef-side.png?url';
import area3ReefBaseUrl from '../assets/environment/area3/area3-reef-base.png?url';
import area4PlatformLeftUrl from '../assets/environment/area4/area4-platform-left-cap.png?url';
import area4PlatformCenterUrl from '../assets/environment/area4/area4-platform-center.png?url';
import area4PlatformRightUrl from '../assets/environment/area4/area4-platform-right-cap.png?url';
import area4WallFillUrl from '../assets/environment/area4/area4-wall-fill.png?url';
import area4WallEdgeUrl from '../assets/environment/area4/area4-wall-inner-edge.png?url';
import area4LimboBarbUrl from '../assets/environment/area4/area4-limbo-hazard.png?url';
import stagingPlatformLeftUrl from '../assets/environment/staging/area4-platform-left-cap.png?url';
import stagingPlatformCenterUrl from '../assets/environment/staging/area4-platform-center.png?url';
import stagingPlatformRightUrl from '../assets/environment/staging/area4-platform-right-cap.png?url';
import stagingWallFillUrl from '../assets/environment/staging/boss-wall-fill.png?url';
import stagingWallEdgeUrl from '../assets/environment/staging/boss-wall-inner-edge.png?url';
import bossWallFillUrl from '../assets/environment/boss/boss-wall-fill.png?url';
import bossWallEdgeUrl from '../assets/environment/boss/boss-wall-inner-edge.png?url';
import type { Platform } from '../systems/StageGenerator';
import type { SpikePlatform } from '../data/structures';
import type { Hazard } from '../data/hazards';

export interface EnvironmentArtSet {
  /** Absent for a set with no ledges to draw (the boss arena): every ledge then stays procedural. */
  platform?: { left: string; center: string; right: string };
  wall: { fill: string; edge: string };
  breakBlock?: { normal: string; reward: string; crack1: string; crack2: string };
  spike?: { socket: string; warning1: string; warning2: string; warning3: string; warning4: string; active: string; edge: string };
  conveyor?: { tile: string; arrow: string };
  reef?: { up: string; side: string; base: string };
  limbo?: { barb: string };
}
/** An AREA's number, THE ABYSS's staging room, or the FINAL BOSS's arena. */
export type EnvironmentArtId = number | 'staging' | 'boss';
/** The id of an ENVIRONMENT_ART entry, from its object key. */
export const environmentArtId = (key: string): EnvironmentArtId => key === 'staging' || key === 'boss' ? key : Number(key);
/**
 * The set a frame is drawn from. In the descent, the AREA's own. In THE ABYSS the run's AREA is still
 * 4, so the state is read first: the staging room's set from the moment the room opens until the
 * arena does (the reversal included), and the arena's own set for the fight. Nothing falls through
 * from one to another. Outside 'boss' (a death or the clear) it is the AREA's, as it always was.
 */
export const environmentArtArea = (m: { state: string; inBossArena: boolean; stage: { config: { id: number } } }): EnvironmentArtId =>
  m.state !== 'boss' ? m.stage.config.id : m.inBossArena ? 'boss' : 'staging';
export const ENVIRONMENT_ART: Partial<Record<EnvironmentArtId, EnvironmentArtSet>> = {
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
  3: {
    platform: { left: area3PlatformLeftUrl, center: area3PlatformCenterUrl, right: area3PlatformRightUrl },
    wall: { fill: area3WallFillUrl, edge: area3WallEdgeUrl },
    reef: { up: area3ReefUpUrl, side: area3ReefSideUrl, base: area3ReefBaseUrl },
  },
  // AREA 4's own copies of the fractured masonry. THE ABYSS's staging room keeps its separate set
  // below, so nothing about AREA 4 can change the room.
  4: {
    platform: { left: area4PlatformLeftUrl, center: area4PlatformCenterUrl, right: area4PlatformRightUrl },
    wall: { fill: area4WallFillUrl, edge: area4WallEdgeUrl },
    limbo: { barb: area4LimboBarbUrl },
  },
  // The last room before NIMUSHI: the ABYSS's vertical seal stone for the walls (the BOSS set) and
  // AREA 4's fractured masonry for the ledges, which is the ledge the BOSS set was drawn to go with.
  staging: {
    platform: { left: stagingPlatformLeftUrl, center: stagingPlatformCenterUrl, right: stagingPlatformRightUrl },
    wall: { fill: stagingWallFillUrl, edge: stagingWallEdgeUrl },
  },
  // NIMUSHI's arena: the staging room's vertical seal stone, from its own copies, so the walls run on
  // unbroken when the fight opens. Walls only -- every stretch is groundless and the arena lays no
  // ledge -- so it carries no ledge images, and nothing of AREA 4's or the staging room's.
  boss: {
    wall: { fill: bossWallFillUrl, edge: bossWallEdgeUrl },
  },
};

/** The fixed geometry every AREA's set is drawn to (ENVIRONMENT ART ASSET AUDIT). */
export const ENVIRONMENT_GEOMETRY = {
  platform: { height: 24, cap: 8, center: 16, surfaceRow: 3 },
  wall: { fillWidth: 32, fillHeight: 96, edgeWidth: 4, shaftLeft: 28, shaftRight: 422 },
  block: { width: 80, height: 16 },
  spike: { socketWidth: 17, socketHeight: 8, toothWidth: 9, toothHeight: 18, edgeWidth: 6, edgeHeight: 8 },
  belt: { tileWidth: 14, tileHeight: 8, arrowWidth: 10, arrowHeight: 12 },
  reef: { step: 9, upWidth: 9, upHeight: 12, sideWidth: 18, sideHeight: 9, baseWidth: 4 },
  limbo: { width: 13, height: 24, pitch: 13, seamRow: 14 },
} as const;

/** Texture keys for an AREA's set. */
export const environmentKeys = (area: EnvironmentArtId) => ({
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
  reef: { up: `env-${area}-reef-up`, side: `env-${area}-reef-side`, base: `env-${area}-reef-base` },
  limbo: { barb: `env-${area}-limbo-barb` },
});
export type EnvironmentKeys = ReturnType<typeof environmentKeys>;

/** Every [texture key, url] an AREA's set loads. */
export function environmentLoads(area: EnvironmentArtId, set: EnvironmentArtSet): [string, string][] {
  const keys = environmentKeys(area);
  const loads: [string, string][] = [];
  if (set.platform) loads.push([keys.left, set.platform.left], [keys.center, set.platform.center], [keys.right, set.platform.right]);
  loads.push([keys.fill, set.wall.fill], [keys.edge, set.wall.edge]);
  if (set.breakBlock) for (const k of ['normal', 'reward', 'crack1', 'crack2'] as const) loads.push([keys.block[k], set.breakBlock[k]]);
  if (set.spike) for (const k of ['socket', 'warning1', 'warning2', 'warning3', 'warning4', 'active', 'edge'] as const) loads.push([keys.spike[k], set.spike[k]]);
  if (set.conveyor) loads.push([keys.belt.tile, set.conveyor.tile], [keys.belt.arrow, set.conveyor.arrow]);
  if (set.reef) for (const k of ['up', 'side', 'base'] as const) loads.push([keys.reef[k], set.reef[k]]);
  if (set.limbo) loads.push([keys.limbo.barb, set.limbo.barb]);
  return loads;
}

/**
 * Which parts of an AREA's set can be drawn from images this frame: a part is used only when its
 * set carries it AND every one of its textures loaded. Anything else -- no set, a part the set does
 * not carry (the boss arena's ledges), an image that failed to load -- is procedural.
 */
export function environmentParts(area: EnvironmentArtId, exists: (key: string) => boolean) {
  const set = ENVIRONMENT_ART[area];
  const keys = environmentKeys(area);
  const all = (list: string[]) => list.every(exists);
  const platform = !!set?.platform && all([keys.left, keys.center, keys.right]);
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
 * The reef's texture keys when this set carries the reef and all three images loaded; otherwise null,
 * and every barb is drawn procedurally. Kept out of environmentParts, whose parts are ledges and walls.
 */
export function reefArt(area: EnvironmentArtId, exists: (key: string) => boolean) {
  const keys = environmentKeys(area).reef;
  return ENVIRONMENT_ART[area]?.reef && Object.values(keys).every(exists) ? keys : null;
}
export type ReefKeys = NonNullable<ReturnType<typeof reefArt>>;

/** The LIMBO barb's texture key when this set carries it and it loaded; otherwise null (procedural). */
export function limboArt(area: EnvironmentArtId, exists: (key: string) => boolean) {
  const key = environmentKeys(area).limbo.barb;
  return ENVIRONMENT_ART[area]?.limbo && exists(key) ? key : null;
}

/**
 * Where a LIMBO row's barbs go, covering the row's collision width (x..x+width) end to end: as many
 * whole 13px barbs as fit, at the procedural 13px pitch and centred, and the leftover (0-12px) split
 * between the two ends -- the left end shows the right part of a barb, the right end the left part,
 * so the repeat runs on unbroken and the two ends differ by at most 1px. Each piece is a source
 * column `srcX` and `width` of the image drawn at `x`; together they tile x..x+width exactly. The
 * image's seam row goes on y+1, inside the hit band y-14..y+12. Null for a row narrower than one
 * barb: drawn procedurally.
 */
export function limboLayout(x: number, y: number, width: number) {
  const { width: w, seamRow } = ENVIRONMENT_GEOMETRY.limbo;
  const count = Math.floor(width / w);
  if (count < 1) return null;
  const rest = width - count * w, leftEnd = Math.floor(rest / 2), rightEnd = rest - leftEnd;
  const pieces: { x: number; srcX: number; width: number }[] = [];
  if (leftEnd > 0) pieces.push({ x, srcX: w - leftEnd, width: leftEnd });
  for (let i = 0; i < count; i++) pieces.push({ x: x + leftEnd + i * w, srcX: 0, width: w });
  if (rightEnd > 0) pieces.push({ x: x + leftEnd + count * w, srcX: 0, width: rightEnd });
  return { top: y + 1 - seamRow, pieces };
}

/**
 * Where a reef patch's images go, read off its collision box and never past it.
 *
 *   up (a shelf end)  one barb at every procedural tooth (x + i, i += 9 while i + 5 <= width), its
 *                     bottom row on the box's bottom row; the last is cropped to the box's width.
 *   left / right      the base strip down the whole box against the wall, and a barb in every other
 *   (a wall)          9px slot from the top; the last is cropped to the box's height. A wall facing
 *                     left (the right wall) is the left one mirrored.
 *
 * Null for a box the images do not fit (narrower or shorter than one image): it is drawn procedurally.
 */
export function reefLayout(h: Pick<Hazard, 'x' | 'y' | 'width' | 'height' | 'face'>) {
  const { step, upWidth, upHeight, sideWidth, sideHeight, baseWidth } = ENVIRONMENT_GEOMETRY.reef;
  if (h.face === 'left' || h.face === 'right') {
    if (h.width < sideWidth || h.height < 1) return null;
    const flip = h.face === 'left';
    const side = flip ? h.x + h.width - sideWidth : h.x;
    const barbs: { x: number; y: number; height: number }[] = [];
    for (let i = 0; i + 5 <= h.height; i += step * 2) barbs.push({ x: side, y: h.y + i, height: Math.min(sideHeight, h.height - i) });
    return { kind: 'wall' as const, flip, base: { x: flip ? h.x + h.width - baseWidth : h.x, y: h.y, height: h.height }, barbs };
  }
  if (h.height < upHeight) return null;
  const barbs: { x: number; y: number; width: number }[] = [];
  for (let i = 0; i + 5 <= h.width; i += step) barbs.push({ x: h.x + i, y: h.y + h.height - upHeight, width: Math.min(upWidth, h.width - i) });
  return { kind: 'floor' as const, barbs };
}

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

/**
 * Whether a SAFE ZONE chamber is drawn -- its recess cut through the wall, the lit frame and the
 * light out of its mouth. Every chamber in the descent is; THE ABYSS's (the run's 'boss' state, where
 * the staging room's TOMATO chamber is the only one) is not. Drawing only: the room's containment is
 * the model's and does not depend on this.
 */
export const chamberDrawn = (state: string) => state !== 'boss';
