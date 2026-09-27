/**
 * ENVIRONMENT ART -- image-based terrain, one AREA at a time. Drawing only: nothing here reads or
 * changes collision; every piece is placed on the geometry the model already has.
 *
 * An AREA listed in ENVIRONMENT_ART draws its ordinary ledges and its shaft walls from these images;
 * an AREA that is not listed keeps the procedural look it has always had. Only AREA 1 is listed.
 *
 *   platform  a 3-slice, 24px tall: left cap 8, center 16 (repeated, the last one cropped), right cap
 *             8. The image's row 3 is the ledge's landing line `y` (SURFACE_ROW).
 *   wall      a 32x96 rock fill tiled across the wall and down the shaft, cropped to the wall's 28px
 *             on screen with its inner column against the shaft; plus a 4x96 inner-edge strip on the
 *             wall side of the boundary. The right wall is the same images mirrored.
 */
import area1PlatformLeftUrl from '../assets/environment/area1/platform-left-cap.png?url';
import area1PlatformCenterUrl from '../assets/environment/area1/platform-center.png?url';
import area1PlatformRightUrl from '../assets/environment/area1/platform-right-cap.png?url';
import area1WallFillUrl from '../assets/environment/area1/wall-fill.png?url';
import area1WallEdgeUrl from '../assets/environment/area1/wall-inner-edge.png?url';
import type { Platform } from '../systems/StageGenerator';

export interface EnvironmentArtSet {
  platform: { left: string; center: string; right: string };
  wall: { fill: string; edge: string };
}
export const ENVIRONMENT_ART: Partial<Record<number, EnvironmentArtSet>> = {
  1: {
    platform: { left: area1PlatformLeftUrl, center: area1PlatformCenterUrl, right: area1PlatformRightUrl },
    wall: { fill: area1WallFillUrl, edge: area1WallEdgeUrl },
  },
};

/** The fixed geometry every AREA's set is drawn to (ENVIRONMENT ART ASSET AUDIT). */
export const ENVIRONMENT_GEOMETRY = {
  platform: { height: 24, cap: 8, center: 16, surfaceRow: 3 },
  wall: { fillWidth: 32, fillHeight: 96, edgeWidth: 4, shaftLeft: 28, shaftRight: 422 },
} as const;

/** Texture keys for an AREA's set. */
export const environmentKeys = (area: number) => ({
  left: `env-${area}-platform-left`, center: `env-${area}-platform-center`, right: `env-${area}-platform-right`,
  fill: `env-${area}-wall-fill`, edge: `env-${area}-wall-edge`,
});

/**
 * Whether a ledge takes the image look: an ORDINARY ledge only. Every special surface -- a BREAK
 * BLOCK, a LIMBO row, a spike floor, a conveyor, a collapsing ledge in any state -- keeps its own
 * procedural drawing, because its look carries its rules.
 */
export function usesPlatformArt(f: Partial<Pick<Platform, 'breakBlock' | 'limboHazard' | 'spikePlatform' | 'conveyor' | 'breakable' | 'state'>> & { width: number }) {
  const { cap } = ENVIRONMENT_GEOMETRY.platform;
  return !f.breakBlock && !f.limboHazard && !f.spikePlatform && !f.conveyor && !f.breakable
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
