import type { GameModel } from '../src/systems/GameModel';

/**
 * Proof that a check did not cheat.
 *
 * "Did HP go up?" is the wrong question: picking up a HEART crate the shaft generated is ordinary
 * play, and so is any in-game reward. What makes a run assisted is the TEST calling an API that
 * hands the player something the game would not have. So each of those APIs is wrapped for the
 * duration of the watch and only records a violation when the call came from the harness itself.
 *
 * It lives in its own file, away from the Phaser entry point, for one reason: a watchdog nobody can
 * unit-test is a watchdog nobody should trust. `tests/assistWatch.test.ts` drives it directly.
 */
export interface AssistWatch {
  /** Labels of the watched APIs the caller used, in the order they were used. */
  readonly used: string[];
  /** Undo every wrapper and put the model back exactly as it was found. */
  stop(): void;
}

/**
 * Only a DIRECT call from the watching file counts. Scanning the whole stack does not work: long
 * checks call game.loop.wake() to keep a headless pane running and Phaser steps the scene inside
 * that call, so an ordinary round of the player's hitting the king arrives with
 *
 *     [1] the wrapper  [2] GameModel.step  [3] GameScene.update  ...  [n] the harness
 *
 * and a whole-stack search reports the player's own shooting as assistance. The caller is frame 2:
 * frame 0 is the Error line and frame 1 is the wrapper that captured it.
 */
const callerFrame = (stack: string | undefined) => (stack ?? '').split('\n')[2] ?? '';

/**
 * Watch `model` for assistance coming from `caller` -- a fragment of the file name that counts as
 * cheating, e.g. 'browser.playtest'.
 */
export function watchForAssists(model: GameModel, caller = 'browser.playtest'): AssistWatch {
  const used: string[] = [];
  const fromCaller = (stack: string | undefined) => callerFrame(stack).includes(caller);
  const undo: (() => void)[] = [];

  const patch = (owner: object, key: string, label: string) => {
    const target = owner as Record<string, unknown>;
    const original = target[key] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    const had = Object.prototype.hasOwnProperty.call(target, key);
    target[key] = function (this: unknown, ...args: unknown[]) {
      // Captured here rather than in a helper, so the frame layout stays fixed and readable:
      // [0] the Error line, [1] this wrapper, [2] whoever called the API.
      if (fromCaller(new Error().stack)) used.push(label);
      return original.apply(this ?? owner, args);
    };
    // A method inherited from the prototype must be deleted again, not pinned onto the instance.
    undo.push(() => { if (had) target[key] = original; else delete target[key]; });
  };

  patch(model, 'heal', 'model.heal');
  patch(model.health, 'heal', 'health.heal');
  patch(model.health, 'lifeUp', 'health.lifeUp');
  patch(model.health, 'killInstantly', 'health.killInstantly');
  patch(model, 'killInstantly', 'model.killInstantly');
  patch(model.boss, 'hitEye', 'boss.hitEye');
  patch(model.boss, 'start', 'boss.start');
  patch(model, 'clearBoss', 'clearBoss');

  /**
   * A plain data field, turned into an accessor pair for the duration of the watch.
   *
   * NIMUSHI's HP is not behind a method the way the old king's was -- there is no `damage` call to
   * wrap, because the only legitimate way HP moves is a round reaching an open eye. So the FIELD
   * itself is watched: writing `boss.hp`, skipping a phase by assigning `phaseId`, declaring it
   * `defeated`, or handing the run room by setting `slack` are all assistance, and all of them are
   * a write this catches. Reading is untouched.
   */
  const guardField = (owner: object, key: string, label: string) => {
    const target = owner as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !('value' in descriptor)) return;
    let held = descriptor.value;
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: () => held,
      set(value: unknown) {
        if (fromCaller(new Error().stack)) used.push(label);
        held = value;
      },
    });
    undo.push(() => { Object.defineProperty(target, key, { ...descriptor, value: held }); });
  };
  guardField(model.boss, 'hp', 'boss.hp');
  guardField(model.boss, 'phaseId', 'boss.phaseId');
  guardField(model.boss, 'defeated', 'boss.defeated');
  guardField(model.boss, 'state', 'boss.state');
  guardField(model.boss, 'deepY', 'boss.deepY');
  guardField(model.boss, 'mark', 'boss.mark');

  /**
   * `player.invincible` is not a field: GameModel defines it as an accessor pair onto
   * HealthSystem.invincibilityRemaining, which is what makes invulnerability one value rather than
   * two that can drift. So this wraps the EXISTING setter and calls through to it -- it never
   * shadows the pair with a local number, which would silently unhook the player from the health
   * system for the whole watch -- and restores the original descriptor verbatim on stop.
   */
  const player = model.player as unknown as Record<string, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(player, 'invincible');
  if (descriptor?.get && descriptor.set) {
    const { get, set } = descriptor;
    Object.defineProperty(player, 'invincible', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get,
      set(this: unknown, value: number) {
        if (fromCaller(new Error().stack)) used.push('player.invincible');
        set.call(this, value);
      },
    });
    undo.push(() => { Object.defineProperty(player, 'invincible', descriptor); });
  }

  return {
    used,
    stop() { for (const restore of undo.splice(0).reverse()) restore(); },
  };
}
