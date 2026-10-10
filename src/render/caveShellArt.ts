/**
 * SIDE CAVE SHELL ART -- drawing only.
 *
 * Eight images from output/side-cave-shell-v1 (runtime/, byte for byte), two per AREA 1-4:
 *
 *   entrance  52x128, the mouth's frame: the rock lip over the opening and the broken face of the
 *             cut beside it. Authored for a RIGHT cave; a LEFT cave shows it mirrored. Rows 0-23 (the
 *             lip) are shown as they are, rows 24-119 (the face) are stretched nearest-neighbour to the
 *             cave's own opening height, and rows 120-127 are empty and not drawn. The image's mouth
 *             anchor is (22, 24) -- (30, 24) mirrored -- on the opening's top at the mouth, so it covers
 *             exactly the 52px the procedural lintel did. It has no floor or sill: the cave's floor is
 *             the cave's own platform.
 *   backwall  96x96, opaque, seamless both ways: the rock at the back of the cave, tiled over the same
 *             rectangle the procedural hollow filled (mouth to far end, the cave's full bounds height)
 *             and anchored to the WORLD, so its seams scroll with the rock rather than with the view.
 *
 * Nothing here is solid. The opening, throat, chamber, floors, roof and bounds are sideCave.ts's; the
 * roof slabs keep their procedural drawing. An AREA uses its own pair or, if either image is missing,
 * keeps the whole procedural shell: never another AREA's images. THE ABYSS has no pair.
 */
import area1EntranceUrl from '../assets/cave-shell/area1-cave-entrance.png?url';
import area1BackwallUrl from '../assets/cave-shell/area1-cave-backwall.png?url';
import area2EntranceUrl from '../assets/cave-shell/area2-cave-entrance.png?url';
import area2BackwallUrl from '../assets/cave-shell/area2-cave-backwall.png?url';
import area3EntranceUrl from '../assets/cave-shell/area3-cave-entrance.png?url';
import area3BackwallUrl from '../assets/cave-shell/area3-cave-backwall.png?url';
import area4EntranceUrl from '../assets/cave-shell/area4-cave-entrance.png?url';
import area4BackwallUrl from '../assets/cave-shell/area4-cave-backwall.png?url';
import area1CeilingUrl from '../assets/cave-ceiling/area1-cave-ceiling-strip.png?url';
import area2CeilingUrl from '../assets/cave-ceiling/area2-cave-ceiling-strip.png?url';
import area3CeilingUrl from '../assets/cave-ceiling/area3-cave-ceiling-strip.png?url';
import area4CeilingUrl from '../assets/cave-ceiling/area4-cave-ceiling-strip.png?url';
import type { SideCave } from '../data/sideCave';
import type { EnvironmentArtId } from './environmentArt';

export type CaveShellArea = 1 | 2 | 3 | 4;
export const CAVE_SHELL_AREAS: readonly CaveShellArea[] = [1, 2, 3, 4];

export const CAVE_SHELL_ART: Record<CaveShellArea, { entrance: string; backwall: string }> = {
  1: { entrance: area1EntranceUrl, backwall: area1BackwallUrl },
  2: { entrance: area2EntranceUrl, backwall: area2BackwallUrl },
  3: { entrance: area3EntranceUrl, backwall: area3BackwallUrl },
  4: { entrance: area4EntranceUrl, backwall: area4BackwallUrl },
};

/** The two canvases and the entrance's anchor, as delivered (README / validation.json). */
export const CAVE_SHELL_GEOMETRY = {
  entrance: {
    width: 52, height: 128,
    /** The mouth's x in the image, for the right cave as authored and for the left one mirrored. */
    mouth: { right: 22, left: 30 },
    /** The lip, kept at 1:1, and the face, stretched to the opening. The opening's top is row 24. */
    top: { y: 0, height: 24 },
    face: { y: 24, height: 96 },
  },
  backwall: { width: 96, height: 96 },
} as const;

export const CAVE_SHELL_KEYS: Record<CaveShellArea, { entrance: string; backwall: string }> = {
  1: { entrance: 'cave-shell-area1-entrance', backwall: 'cave-shell-area1-backwall' },
  2: { entrance: 'cave-shell-area2-entrance', backwall: 'cave-shell-area2-backwall' },
  3: { entrance: 'cave-shell-area3-entrance', backwall: 'cave-shell-area3-backwall' },
  4: { entrance: 'cave-shell-area4-entrance', backwall: 'cave-shell-area4-backwall' },
};
/** The entrance texture's two frames, added once it has loaded. */
export const CAVE_ENTRANCE_FRAMES = { top: 'top', face: 'face' } as const;

/** What the scene loads: [texture key, url], one per image. */
export function caveShellLoads(): [string, string][] {
  return CAVE_SHELL_AREAS.flatMap(a => [
    [CAVE_SHELL_KEYS[a].entrance, CAVE_SHELL_ART[a].entrance] as [string, string],
    [CAVE_SHELL_KEYS[a].backwall, CAVE_SHELL_ART[a].backwall] as [string, string],
  ]);
}

/**
 * This AREA's pair when both loaded; otherwise null, and its caves keep the procedural shell.
 * Only AREA 1-4 have one -- 'staging' and 'boss' never fall through to an AREA's.
 */
export function caveShellArt(area: EnvironmentArtId, exists: (key: string) => boolean) {
  if (area !== 1 && area !== 2 && area !== 3 && area !== 4) return null;
  const keys = CAVE_SHELL_KEYS[area];
  return exists(keys.entrance) && exists(keys.backwall) ? keys : null;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Where the entrance goes, in world x and screen y: the lip's top-left, the face's top-left and the
 * face's shown height (the opening's), and whether it is mirrored. Covers x mouth-22..mouth+30 on a
 * right cave and mouth-30..mouth+22 on a left one -- the procedural lintel's 52px either way.
 */
export function caveEntrancePlacement(cave: Pick<SideCave, 'side' | 'opening'>, cam: number) {
  const { mouth, top } = CAVE_SHELL_GEOMETRY.entrance;
  const left = cave.side === -1, o = cave.opening;
  const mouthX = left ? o.x + o.width : o.x;
  const oy = Math.round(o.y - cam);
  return {
    x: mouthX - (left ? mouth.left : mouth.right),
    topY: oy - top.height,
    faceY: oy,
    faceHeight: o.height,
    flipX: left,
  };
}

/**
 * The backwall's rectangle -- the procedural hollow's: from the mouth to the far end of the bounds,
 * over the bounds' full height -- in world x and screen y, and the tile offset that pins the texture
 * to world (0, 0). The vertical offset follows the same rounded camera the rectangle's top does, so a
 * rock stays on the same screen row as the cave around it at every camera position.
 */
export function caveBackwallPlacement(cave: Pick<SideCave, 'side' | 'opening' | 'bounds'>, cam: number) {
  const { width: tw, height: th } = CAVE_SHELL_GEOMETRY.backwall;
  const left = cave.side === -1, b = cave.bounds;
  const mouthX = left ? cave.opening.x + cave.opening.width : cave.opening.x;
  const x = left ? b.x : mouthX, width = left ? mouthX - b.x : b.x + b.width - mouthX;
  const y = Math.round(b.y - cam);
  return { x, y, width, height: b.height, tileX: mod(x, tw), tileY: mod(y + Math.round(cam), th) };
}

/**
 * The light out of the mouth, under an entrance image: the procedural eight-step leak and the line at
 * the mouth, in the AREA's own colour and shape, with every alpha multiplied by this. 1 = ea3de3a's.
 */
export const CAVE_SHELL_LIGHT = 0.25;

/**
 * The CEILING STRIP, optional on top of the shell: one 96x14 image per AREA from
 * output/side-cave-ceiling-v1 (runtime/, byte for byte), drawn on each roof slab in place of the
 * procedural brick and its edge line. Row 0 on the slab's top, row 13 on its last row; repeated 1:1
 * along the slab and cropped at its far end, never stretched. The sequence starts at the slab's
 * shaft-side end and grows into the rock: as authored on a right cave, mirrored whole on a left one.
 * The slab is the model's and stops nothing -- the strip is a picture of it, nothing more.
 *
 * Only with the AREA's shell pair; without its own strip an AREA keeps the procedural roof alone.
 */
export const CAVE_CEILING_ART: Record<CaveShellArea, string> = { 1: area1CeilingUrl, 2: area2CeilingUrl, 3: area3CeilingUrl, 4: area4CeilingUrl };
export const CAVE_CEILING_GEOMETRY = { width: 96, height: 14 } as const;
export const CAVE_CEILING_KEYS: Record<CaveShellArea, string> = {
  1: 'cave-ceiling-area1', 2: 'cave-ceiling-area2', 3: 'cave-ceiling-area3', 4: 'cave-ceiling-area4',
};

/** What the scene loads for the strips: [texture key, url], one per AREA. */
export const caveCeilingLoads = (): [string, string][] => CAVE_SHELL_AREAS.map(a => [CAVE_CEILING_KEYS[a], CAVE_CEILING_ART[a]]);

/** This AREA's strip if it loaded, else null (that AREA's roof stays procedural). Never another AREA's. */
export function caveCeilingArt(area: EnvironmentArtId, exists: (key: string) => boolean) {
  if (area !== 1 && area !== 2 && area !== 3 && area !== 4) return null;
  return exists(CAVE_CEILING_KEYS[area]) ? CAVE_CEILING_KEYS[area] : null;
}

/**
 * Where one roof slab's strip goes: the slab's own rectangle, in world x and screen y, with the
 * texture's column 0 on the slab's shaft-side end -- the left end of a right cave's slab and, mirrored,
 * the right end of a left cave's. Both ends are the slab's in the world, so the tiles never move
 * against the rock as the view slides.
 */
export function caveCeilingPlacement(cave: Pick<SideCave, 'side'>, slab: { x: number; y: number; width: number; height: number }, cam: number) {
  return { x: slab.x, y: Math.round(slab.y - cam), width: slab.width, height: slab.height, tileX: 0, flipX: cave.side === -1 };
}
