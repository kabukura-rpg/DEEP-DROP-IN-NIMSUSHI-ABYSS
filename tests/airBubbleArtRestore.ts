/**
 * AIR BUBBLES VISUAL DESIGN V1, put back out. It added one source (render/airBubbleArt.ts) and touched GameScene.ts in
 * two places: one import line, and the stroke + glint lines of the released-bubble loop in `draw()`. Every hunk is
 * listed here as [the text now, the text at 5969f37]; reversing them gives 5969f37's GameScene.ts byte for byte
 * (tests/airBubbleArt.test.ts).
 *
 * `withoutTimeoutArt` (tests/timeoutArtRestore.ts) reverses these first, so every older "nothing else changed" pin
 * keeps its own digest and still proves the earlier changes touched nothing they cover.
 */
export const AIR_BUBBLE_ART_NEW_FILES = ['render/airBubbleArt.ts'] as const;

export const AIR_BUBBLE_ART_HUNKS: Record<string, [string, string][]> = {
  'scenes/GameScene.ts': [
    [`import { drawTimeoutArt } from '../render/timeoutArt';
import { drawAirBubbleArt } from '../render/airBubbleArt';
`, `import { drawTimeoutArt } from '../render/timeoutArt';
`],
    [`      // AIR BUBBLES VISUAL DESIGN V1 (render/airBubbleArt): the same cyan ring and glint as 2px steps, at the same fade.
      drawAirBubbleArt(this.graphics, bubble.x, by, fade);
`, `      this.graphics.lineStyle(2, 0x9fe8f5, fade).strokeCircle(bubble.x, by, 9);
      this.rect(bubble.x - 4, by - 5, 3, 3, 0xffffff, fade * 0.8);
`],
  ],
};

/** `path` as any test spells it: '../src/scenes/GameScene.ts', 'src/scenes/GameScene.ts' or 'scenes/GameScene.ts'. */
export function withoutAirBubbleArt(path: string, source: string) {
  const pairs = AIR_BUBBLE_ART_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`air bubble art hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}

/** Whether a glob key ('../src/render/airBubbleArt.ts') is the AIR bubble art's own new file. */
export const isAirBubbleArtFile = (path: string) => (AIR_BUBBLE_ART_NEW_FILES as readonly string[]).includes(path.replace(/^(\.\.\/)?(src\/)?/, ''));
