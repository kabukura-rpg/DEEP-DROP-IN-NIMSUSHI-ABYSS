/**
 * BOSS ABYSS ART -- drawing only.
 *
 * One image from output/boss-abyss-floor-art-v1/assets (byte for byte): B / COLLAPSED SEAL, 466x1082,
 * one static state, shown in place of the procedural rising deep (dark band, pink seam, teeth) during
 * the NIMUSHI fight. No phase variant, no animation, no runtime tint, no stretch.
 *
 * The canvas is the procedural band's own width (x -8..458, 8px overscan each side of the 450 canvas)
 * with the torn top drawn in rows 0..21 -- the room the procedural teeth stood up into -- and the body
 * opaque from row 22. So row 22 is laid on the band's top, `round(boundaryY - cameraY)`, the same
 * whole pixel `rect()` puts it on, and the image rises, sinks and leaves the screen exactly as the band did.
 *
 * Nothing about the deep is read from here: where it is, how fast it climbs, and the instant death --
 * which is NOT at this edge but at the player's centre passing 140px below the view (ARENA_FLOOR.margin)
 * -- are the model's. The image has no collision.
 *
 * The arena only (`abyssStage === 'fight'`): any other place the band can show (a debug warp back
 * into the staging room) keeps the procedural drawing, as does a missing image; never some other image.
 */
import bossAbyssUrl from '../assets/boss-abyss/boss-abyss-collapsed-seal.png?url';
import type { GameModel } from '../systems/GameModel';

export const BOSS_ABYSS_ART = bossAbyssUrl;
/** The image's canvas, as delivered, and where its body starts: the band's top edge. */
export const BOSS_ABYSS_GEOMETRY = { width: 466, height: 1082, x: -8, anchorRow: 22 } as const;
export const BOSS_ABYSS_KEY = 'boss-abyss-collapsed-seal';

/** What the scene loads: [texture key, url]. */
export const bossAbyssLoads = (): [string, string][] => [[BOSS_ABYSS_KEY, BOSS_ABYSS_ART]];

/** The image's key in the arena when it loaded; otherwise null, and the deep keeps its procedural drawing. */
export const bossAbyssArt = (stage: GameModel['abyssStage'], exists: (key: string) => boolean) =>
  stage === 'fight' && exists(BOSS_ABYSS_KEY) ? BOSS_ABYSS_KEY : null;

/**
 * The image's top-left on screen for the band's top at `edge` (`boundaryY - cameraY`): row 22 on the
 * procedural band's `rect(-8, edge)`, rounded as it rounds.
 *
 * The band below was `max(0, 820 - edge) + 40` tall, so it always ended at y 860 or lower, past the
 * 800px canvas; the image reaches `edge + 1060` (>= 860 inside the draw guard, edge > -200), so no
 * crop is needed for it to cover what the band covered, and none is applied.
 */
export const bossAbyssPlacement = (edge: number) => ({ x: BOSS_ABYSS_GEOMETRY.x, y: Math.round(edge) - BOSS_ABYSS_GEOMETRY.anchorRow });
