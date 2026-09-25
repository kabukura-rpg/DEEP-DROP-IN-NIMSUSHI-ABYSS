/**
 * PLAYER ART v1's shipped files and the one rule about them that needs no renderer. Kept apart from
 * PlayerArt.ts so it can be read (and tested) without Phaser.
 */
import animationMapUrl from '../../output/player-sprites-v1/animation-map.json?url';
import sharedSheetUrl from '../../output/player-sprites-v1/sheets/player_shared_v1.png?url';
import normalSheetUrl from '../../output/player-sprites-v1/sheets/player_normal_v1.png?url';
import bossSheetUrl from '../../output/player-sprites-v1/sheets/player_boss_v1.png?url';

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
  sheets: { shared: sharedSheetUrl, normal: normalSheetUrl, boss: bossSheetUrl },
  cell: 48,
} as const;

/** Whether a frame can be drawn: its map entry exists AND its sheet actually loaded. */
export function artFrameUsable(map: ArtMap | undefined, key: string, sheetLoaded: (group: string) => boolean) {
  const frame = map?.frames[key];
  return frame && sheetLoaded(frame.group) ? frame : undefined;
}

