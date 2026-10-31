/**
 * JETPACK PIXEL VFX V1, put back out. It added one source (render/jetpackArt.ts) and touched GameScene.ts in two
 * places: one import line, and the inside of the `if (m.jetpackActive)` block. Reversing both gives dc51d0b's
 * GameScene.ts byte for byte (tests/jetpackArt.test.ts).
 *
 * So the older "nothing else changed" pins keep their own digests: they are checked against the source with
 * the exhaust taken out, rather than re-pinned to whatever the source is now.
 */
export const JETPACK_ART_NEW_FILES = ['render/jetpackArt.ts'] as const;

export const JETPACK_IMPORT_LINE = "import { drawJetpackExhaust } from '../render/jetpackArt';\n";
/** dc51d0b's jetpack block, byte for byte. */
export const JETPACK_BASELINE_BLOCK = `    if (m.jetpackActive) {
      const flare = 0.5 + Math.abs(Math.sin(this.model.elapsed * 22)) * 0.5;
      for (let i = 0; i < 3; i++) this.rect(x - 6 + i * 5, y + 18 + i, 4, 8 + i * 3, i === 1 ? 0xffe6ae : 0xffa85c, flare);
    }
`;
/** The block as it is now. */
export const JETPACK_BLOCK = `    if (m.jetpackActive) {
      // JETPACK PIXEL VFX V1 (render/jetpackArt): 12 rectangles a frame inside the old three strips, same flicker.
      drawJetpackExhaust(this.graphics, x, y, this.model.elapsed);
    }
`;

/** `path` as any test spells it: '../src/scenes/GameScene.ts', 'src/scenes/GameScene.ts' or 'scenes/GameScene.ts'. */
export function withoutJetpackArt(path: string, source: string) {
  if (path.replace(/^(\.\.\/)?(src\/)?/, '') !== 'scenes/GameScene.ts') return source;
  for (const now of [JETPACK_IMPORT_LINE, JETPACK_BLOCK]) {
    if (source.split(now).length !== 2) throw new Error(`jetpack art hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
  }
  return source.replace(JETPACK_IMPORT_LINE, '').replace(JETPACK_BLOCK, () => JETPACK_BASELINE_BLOCK);
}

/** Whether a glob key ('../src/render/jetpackArt.ts') is the exhaust's own new file. */
export const isJetpackArtFile = (path: string) => (JETPACK_ART_NEW_FILES as readonly string[]).includes(path.replace(/^(\.\.\/)?(src\/)?/, ''));
