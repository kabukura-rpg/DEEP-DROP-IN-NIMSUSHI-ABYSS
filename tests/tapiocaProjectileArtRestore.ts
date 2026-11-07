/**
 * BOSS TAPIOCA PROJECTILE PIXEL ART V1, put back out. It added one source (render/tapiocaProjectileArt.ts) and touched
 * GameScene.ts in two places: one import line, and three lines in the pearl loop of `boss()`. Every hunk is listed here
 * as [the text now, the text at 959a5f4]; reversing them gives 959a5f4's GameScene.ts byte for byte
 * (tests/tapiocaProjectileArt.test.ts).
 *
 * `withoutInputCancelFix` (tests/inputCancelRestore.ts) reverses these first, so every older "nothing else changed" pin
 * keeps its own digest and still proves the earlier changes touched nothing they cover.
 *
 * TIMEOUT AREA PIXEL ART V1 came after the pearl art, so its hunks (tests/timeoutArtRestore.ts) are reversed first here.
 */
import { withoutTimeoutArt } from './timeoutArtRestore';

export const TAPIOCA_ART_NEW_FILES = ['render/tapiocaProjectileArt.ts'] as const;

export const TAPIOCA_ART_HUNKS: Record<string, [string, string][]> = {
  'scenes/GameScene.ts': [
    [`import { drawJetpackExhaust } from '../render/jetpackArt';
import { TAPIOCA_PROJECTILE_ART, drawTapiocaProjectile } from '../render/tapiocaProjectileArt';
`, `import { drawJetpackExhaust } from '../render/jetpackArt';
`],
    [`      // A pale rim first: a dark pearl on a dark shaft has to read as a THING coming at the player.
      // BOSS TAPIOCA PROJECTILE PIXEL ART V1 (render/tapiocaProjectileArt): the TRIPLE SHOT pearl as 17 rectangles
      // inside the old rim's 22x22, same three colours. Any other size keeps the three circles.
      if (pearl.size === TAPIOCA_PROJECTILE_ART.size) { drawTapiocaProjectile(this.graphics, pearl.x, py); continue; }
`, `      // A pale rim first: a dark pearl on a dark shaft has to read as a THING coming at the player.
`],
  ],
};

/** `path` as any test spells it: '../src/scenes/GameScene.ts', 'src/scenes/GameScene.ts' or 'scenes/GameScene.ts'. */
export function withoutTapiocaProjectileArt(path: string, source: string) {
  source = withoutTimeoutArt(path, source);
  const pairs = TAPIOCA_ART_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`tapioca art hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}

/** Whether a glob key ('../src/render/tapiocaProjectileArt.ts') is the pearl art's own new file. */
export const isTapiocaProjectileArtFile = (path: string) => (TAPIOCA_ART_NEW_FILES as readonly string[]).includes(path.replace(/^(\.\.\/)?(src\/)?/, ''));
