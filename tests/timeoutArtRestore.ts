/**
 * TIMEOUT AREA PIXEL ART V1, put back out. It added one source (render/timeoutArt.ts) and touched GameScene.ts in two
 * places: one import line, and the two fill/stroke lines of the TIMEOUT bubble loop in `draw()`. Every hunk is listed
 * here as [the text now, the text at e9b0e2a]; reversing them gives e9b0e2a's GameScene.ts byte for byte
 * (tests/timeoutArt.test.ts).
 *
 * `withoutAirBubbleArt` (tests/airBubbleArtRestore.ts) is reversed before these.
 *
 * `withoutTapiocaProjectileArt` (tests/tapiocaProjectileArtRestore.ts) reverses these first, so every older "nothing
 * else changed" pin keeps its own digest and still proves the earlier changes touched nothing they cover.
 */
import { withoutAirBubbleArt } from './airBubbleArtRestore';

export const TIMEOUT_ART_NEW_FILES = ['render/timeoutArt.ts'] as const;

export const TIMEOUT_ART_HUNKS: Record<string, [string, string][]> = {
  'scenes/GameScene.ts': [
    [`import { TAPIOCA_PROJECTILE_ART, drawTapiocaProjectile } from '../render/tapiocaProjectileArt';
import { drawTimeoutArt } from '../render/timeoutArt';
`, `import { TAPIOCA_PROJECTILE_ART, drawTapiocaProjectile } from '../render/tapiocaProjectileArt';
`],
    [`      // TIMEOUT AREA PIXEL ART V1 (render/timeoutArt): the same cyan disc and rim as 2px steps, rim at .5 + .5 * pulse.
      drawTimeoutArt(this.graphics, bubble.x, by, pulse);
`, `      this.graphics.fillStyle(0x9fe8f5, pulse).fillCircle(bubble.x, by, bubble.radius);
      this.graphics.lineStyle(2, 0x9fe8f5, 0.5).strokeCircle(bubble.x, by, bubble.radius);
`],
  ],
};

/** `path` as any test spells it: '../src/scenes/GameScene.ts', 'src/scenes/GameScene.ts' or 'scenes/GameScene.ts'. */
export function withoutTimeoutArt(path: string, source: string) {
  source = withoutAirBubbleArt(path, source);
  const pairs = TIMEOUT_ART_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`timeout art hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}

/** Whether a glob key ('../src/render/timeoutArt.ts') is the TIMEOUT art's own new file. */
export const isTimeoutArtFile = (path: string) => (TIMEOUT_ART_NEW_FILES as readonly string[]).includes(path.replace(/^(\.\.\/)?(src\/)?/, ''));
