/**
 * JETPACK BEHAVIOR FIX V1, put back out. Every hunk it changed in an existing source is listed here as
 * [the text now, the text at 19adbd4]; reversing them gives 19adbd4 byte for byte (tests/jetpackBehavior.test.ts).
 *
 * `withoutJetpackArt` (tests/jetpackArtRestore.ts) reverses these first, so the older "nothing else changed"
 * pins keep their own digests and still prove the fix touched nothing they cover.
 */
import { withoutInputCancelFix } from './inputCancelRestore';

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
    // ISSUE 2: the gate refuses a stopped world. ISSUE 1: the pull's sign reaches the art.
    [`    // The model already takes the flag down when the world stops; the scene only refuses to draw a hover there.
    if (m.jetpackActive && m.running && m.abyssStage !== 'inverting') {
      // JETPACK PIXEL VFX V1 (render/jetpackArt): 12 rectangles a frame inside the old three strips, same flicker,
      // pointing along the pull it brakes against -- above the player once the ABYSS has turned the world over.
      drawJetpackExhaust(this.graphics, x, y, this.model.elapsed, m.gravitySign);`,
    `    if (m.jetpackActive) {
      // JETPACK PIXEL VFX V1 (render/jetpackArt): 12 rectangles a frame inside the old three strips, same flicker.
      drawJetpackExhaust(this.graphics, x, y, this.model.elapsed);`],
  ],
  // ISSUE 2: the flag's lifecycle. Nothing but assignments of `jetpackActive` and their comments.
  'systems/GameModel.ts': [
    [`  /**
   * True when the last simulation step ran the jetpack's fuel branch and it still applies at the end of that
   * step: airborne, CHARGE dry, the world running. For the view and the tests; nothing simulates off it. It is
   * the hover being paid for, not a force on every frame -- below the cap the fuel burns with nothing to brake.
   * Anything that ends the hover (landing, a reload, a stop of the world) takes it down at once.
   */
  jetpackActive = false;`, `  /** True on the frames the jetpack is actually holding the player up, for the view and the tests. */
  jetpackActive = false;`],
    [`  step(dt: number, direction: number, firing: boolean) {
    // Every step decides the jetpack afresh: only \`fireGun\` raises it, and a step that never reaches that
    // branch -- standing, kicking off a wall, the world held still -- must not carry the last one's.
    this.jetpackActive = false;
`, `  step(dt: number, direction: number, firing: boolean) {
`],
    [`    // The hover raised early in this step only stands if the step ended still dry, in the air and in play: a
    // landing, a CHARGE refill or a door into the REST point or a shop has ended it since. (The seal clears it
    // itself as the reversal begins.)
    if (this.jetpackActive && (p.grounded !== -1 || this.ammo > 0 || !this.running)) this.jetpackActive = false;
`, ''],
    [`    this.state = 'upgrade';
    this.jetpackActive = false;
`, `    this.state = 'upgrade';
`],
    [`    this.player.vy = 0;
    this.jetpackActive = false;
    this.events.push({ type: 'gravityFlip'`, `    this.player.vy = 0;
    this.events.push({ type: 'gravityFlip'`],
    [`this.state = 'clear'; this.jetpackActive = false; this.emit('clear'`, `this.state = 'clear'; this.emit('clear'`],
    [`    // A full magazine is the gunboots back in business: whatever was hovering has stopped.
    this.jetpackActive = false;
`, ''],
    [`this.state = 'over'; this.jetpackActive = false; this.emit('over'`, `this.state = 'over'; this.emit('over'`],
  ],
  'main.ts': [
    [`  // The scene stops stepping the model, so the jetpack's flag is taken down here; resuming never restores it.
  mode = 'paused'; scene.model.paused = true; scene.model.jetpackActive = false; bridge.active = false;`,
    `  mode = 'paused'; scene.model.paused = true; bridge.active = false;`],
  ],
};

export const JETPACK_BEHAVIOR_FILES = Object.keys(JETPACK_BEHAVIOR_HUNKS);

/** `path` as any test spells it: '../src/main.ts', 'src/main.ts' or 'main.ts'. */
export function withoutJetpackBehaviorFix(path: string, source: string) {
  // The input-cancellation fix (tests/inputCancelRestore.ts) came after this one, so it goes back out first.
  source = withoutInputCancelFix(path, source);
  const pairs = JETPACK_BEHAVIOR_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`jetpack behavior hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}
