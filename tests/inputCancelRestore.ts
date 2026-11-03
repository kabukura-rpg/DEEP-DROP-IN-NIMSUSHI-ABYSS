/**
 * JETPACK REMAINING BEHAVIOR FIX V1 (input cancellation), put back out. Every hunk it changed in an existing source is
 * listed here as [the text now, the text at dae7a93]; reversing them gives dae7a93 byte for byte (tests/inputCancel.test.ts).
 *
 * `withoutJetpackBehaviorFix` (tests/jetpackBehaviorRestore.ts) reverses these first, so every older "nothing else
 * changed" pin keeps its own digest and still proves the earlier changes touched nothing they cover.
 *
 * BOSS TAPIOCA PROJECTILE PIXEL ART V1 came after the fix, so its hunks (tests/tapiocaProjectileArtRestore.ts) are
 * reversed first here.
 */
import { withoutTapiocaProjectileArt } from './tapiocaProjectileArtRestore';

export const INPUT_CANCEL_HUNKS: Record<string, [string, string][]> = {
  'systems/GameModel.ts': [
    [`  private actionHeld = false;
  /**
   * The page took ACTION away (PAUSE, a menu, a screen change: main.ts \`clearInput\`). Whatever was held is
   * over, so the next press the run sees is a fresh one -- even one made before the first step after it.
   * Only the press history moves: nothing is stepped, fired, refilled or timed. A key still physically held
   * is kept from coming back as a press by the scene (GameScene, keydown-SPACE), not here.
   */
  cancelAction() { this.actionHeld = false; }
`, `  private actionHeld = false;
`],
  ],
  'scenes/GameScene.ts': [
    [`    // Phaser re-arms a key that \`resetKeys\` let go of on its next keydown, and a SPACE held through PAUSE or a
    // menu keeps sending the browser's auto-repeat -- which would come back as a brand-new press (a jump, a
    // skipped line). A repeat can only reach here after a reset, never in ordinary play (Phaser swallows repeats
    // of a key it still has down), so it is the cancelled hold: kept up until the key is really let go.
    this.input.keyboard!.on('keydown-SPACE', (event: KeyboardEvent) => {
      if (event.repeat) { this.keys.space.reset(); return; }
      this.requestShot();
    });`, `    this.input.keyboard!.on('keydown-SPACE', () => this.requestShot());`],
    [`this.inputBuffer.clear(); this.model.cancelAction(); }`, `this.inputBuffer.clear(); }`],
  ],
};

export const INPUT_CANCEL_FILES = Object.keys(INPUT_CANCEL_HUNKS);

/** `path` as any test spells it: '../src/main.ts', 'src/main.ts' or 'main.ts'. */
export function withoutInputCancelFix(path: string, source: string) {
  source = withoutTapiocaProjectileArt(path, source);
  const pairs = INPUT_CANCEL_HUNKS[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`input cancel hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}
