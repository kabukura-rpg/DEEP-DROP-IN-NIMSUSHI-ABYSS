/**
 * CORPSE ART -- drawing only.
 *
 * One image from output/corpse-art-audit-v1/candidates/corpse-common-B.png (byte for byte): B / COMMON
 * CORPSE, 20x12, one static frame shared by every body. Shown in place of the three procedural
 * rectangles; no per-enemy variant, no AREA variant, no rotation, flip, tint or animation.
 *
 * The canvas is the body's nominal 20x12 (CORPSE_RULES.width/height) with its pivot at (10, 8): the
 * corpse's x/y lands on that texel, so the image's top-left is `round(x - 10), round(cy - 8)` -- whole
 * pixels, like `rect()` puts the procedural rectangles on. Its opaque bounds [0,1,19,11) sit inside the
 * procedural drawing's own 20x13 footprint (x-10..x+10, cy-9..cy+4).
 *
 * Nothing about a body is read from here: where it is, how it falls, how long it lasts, what eats or
 * detonates it (KNIFE AND FORK's 18/30 reach, REST IN PIECES' 20/20 round test) are the model's. The
 * image has no collision, and its transparent outline is never a hitbox.
 *
 * Drawn wherever a body is drawn -- the same visibility guard and the same alpha (0.9, or the blink in
 * its last two seconds) -- and the procedural rectangles stay as the fallback when the image is missing.
 */
import corpseCommonUrl from '../assets/world/corpse-common-v1.png?url';

export const CORPSE_ART = corpseCommonUrl;
/** The image's canvas, as delivered, and the texel a body's x/y lands on. */
export const CORPSE_ART_GEOMETRY = { width: 20, height: 12, pivotX: 10, pivotY: 8 } as const;
export const CORPSE_ART_KEY = 'corpse-common-v1';

/** What the scene loads: [texture key, url]. */
export const corpseArtLoads = (): [string, string][] => [[CORPSE_ART_KEY, CORPSE_ART]];

/** The image's key when it loaded; otherwise null, and every body keeps its procedural drawing. */
export const corpseArt = (exists: (key: string) => boolean) => exists(CORPSE_ART_KEY) ? CORPSE_ART_KEY : null;

/** The image's top-left on screen for a body at world x and screen y `cy` (`corpse.y - cameraY`). */
export const corpsePlacement = (x: number, cy: number) => ({
  x: Math.round(x - CORPSE_ART_GEOMETRY.pivotX),
  y: Math.round(cy - CORPSE_ART_GEOMETRY.pivotY),
});
