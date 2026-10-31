/**
 * JETPACK BEHAVIOR FIX V1, put back out. Every hunk it changed in an existing source is listed here as
 * [the text now, the text at 19adbd4]; reversing them gives 19adbd4 byte for byte (tests/jetpackBehavior.test.ts).
 *
 * `withoutJetpackArt` (tests/jetpackArtRestore.ts) reverses these first, so the older "nothing else changed"
 * pins keep their own digests and still prove the fix touched nothing they cover.
 */
export const JETPACK_BEHAVIOR_HUNKS: Record<string, [string, string][]> = {
  'render/jetpackArt.ts': [
    [` * no glow, no fade. All sizes are native 450x800 world pixels.
 *
 * Under the ABYSS's reversed pull the jetpack brakes a climb instead of a fall, so the exhaust points the
 * other way: every rectangle is mirrored about the player's centre line (output/jetpack-behavior-audit-v1,
 * boss-direction-audit.md plan A). Same strips, colours, frames and flicker; nothing else moves.
 */`, ` * no glow, no fade. All sizes are native 450x800 world pixels.
 */`],
    [`/**
 * The exhaust on the rounded player position \`x\`/\`y\` (screen space), with dc51d0b's flicker alpha: below the
 * player under the ordinary pull, above it when \`gravitySign\` is -1 (a rectangle at offset o, height h, lands at
 * y-o-h instead of y+o).
 */
export function drawJetpackExhaust(g: Phaser.GameObjects.Graphics, x: number, y: number, elapsed: number, gravitySign: 1 | -1 = 1) {`,
    `/** The exhaust under the rounded player position \`x\`/\`y\` (screen space), with dc51d0b's flicker alpha. */
export function drawJetpackExhaust(g: Phaser.GameObjects.Graphics, x: number, y: number, elapsed: number) {`],
    [`    const o = JETPACK_ART.originY + r[1];
    g.fillStyle(r[4], alpha).fillRect(x + JETPACK_ART.originX + r[0], gravitySign < 0 ? y - o - r[3] : y + o, r[2], r[3]);`,
    `    g.fillStyle(r[4], alpha).fillRect(x + JETPACK_ART.originX + r[0], y + JETPACK_ART.originY + r[1], r[2], r[3]);`],
  ],
  'scenes/GameScene.ts': [
    [`      // JETPACK PIXEL VFX V1 (render/jetpackArt): 12 rectangles a frame inside the old three strips, same flicker,
      // pointing along the pull it brakes against -- above the player once the ABYSS has turned the world over.
      drawJetpackExhaust(this.graphics, x, y, this.model.elapsed, m.gravitySign);`,
    `      // JETPACK PIXEL VFX V1 (render/jetpackArt): 12 rectangles a frame inside the old three strips, same flicker.
      drawJetpackExhaust(this.graphics, x, y, this.model.elapsed);`],
  ],
};

export const JETPACK_BEHAVIOR_FILES = Object.keys(JETPACK_BEHAVIOR_HUNKS);

/** `path` as any test spells it: '../src/main.ts', 'src/main.ts' or 'main.ts'. */
export function withoutJetpackBehaviorFix(path: string, source: string) {
  const pairs = JETPACK_BEHAVIOR_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`jetpack behavior hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}
