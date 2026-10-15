/**
 * PLAYER ART v1's shipped files and the one rule about them that needs no renderer. Kept apart from
 * PlayerArt.ts so it can be read (and tested) without Phaser.
 */
import animationMapUrl from '../../output/player-sprites-v1/animation-map.json?url';
import sharedSheetUrl from '../../output/player-sprites-v1/sheets/player_shared_v1.png?url';
import normalSheetUrl from '../../output/player-sprites-v1/sheets/player_normal_v1.png?url';
import bossSheetUrl from '../../output/player-sprites-v1/sheets/player_boss_v1.png?url';
// PLAYER BOSS CONTACT REBOUND v1 (ART LOCKED 2026-09-23): one 48px frame, its own one-cell sheet.
import contactSheetUrl from '../../output/player-boss-contact-rebound-v1/boss_contact_rebound_00.png?url';
// PLAYER BOSS ENEMY STOMP REBOUND v1: one 48px frame, its own one-cell sheet.
import stompSheetUrl from '../../output/player-boss-enemy-stomp-rebound-v1/boss_enemy_stomp_rebound_00.png?url';

export interface ArtFrame { anchor: { x: number; y: number }; group: string; index: number }
export interface ArtMap { frames: Record<string, ArtFrame> }

/**
 * PLAYER ART v1 (HUMAN APPROVED, docs/PLAYER-ART-v1-APPROVED.md) -- in the shipped game.
 *
 * It was a DEV-only preview whose sheets were fetched from `output/` and never reached `dist/`. The
 * EXTERNAL TEST BUILD imports the same files, byte for byte, so Vite ships them. Nothing about the
 * art changed: the 48x48 cells, the frame map, the anchors and the pose logic are the ones approved.
 *
 * VISUAL ONLY. The image is placed on the physics body by each frame's own anchor and never feeds
 * back: collision, physics and the model are untouched. If a sheet or the map fails to load the
 * image stays hidden and the scene draws the original procedural body instead.
 */
export const PLAYER_ART_ASSETS = {
  map: animationMapUrl,
  sheets: { shared: sharedSheetUrl, normal: normalSheetUrl, boss: bossSheetUrl, contact: contactSheetUrl, stomp: stompSheetUrl },
  cell: 48,
} as const;

/** Whether a frame can be drawn: its map entry exists AND its sheet actually loaded. */
export function artFrameUsable(map: ArtMap | undefined, key: string, sheetLoaded: (group: string) => boolean) {
  const frame = map?.frames[key];
  return frame && sheetLoaded(frame.group) ? frame : undefined;
}


/**
 * The pose the image shows. The selector (dev/playerAnimationState) answers null wherever it has no
 * pose of its own: a REST, a SHOP, the clear, an arena bounce with no approved frame. None of those is
 * a missing image, so the PLAYER keeps the pose it was last drawn in instead of dropping to the
 * procedural body -- held still while an overlay has stopped the run's clock, and timed by the same
 * clock when it has not. The procedural body is left for what it is for: a sheet or map that did not
 * load, and a run not yet drawn once.
 */
export function shownPose<P>(selected: P | null, previous: P | null): P | null {
  return selected ?? previous;
}
