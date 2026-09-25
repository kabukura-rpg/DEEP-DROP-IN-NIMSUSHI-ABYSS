import { GameModel, type Bullet } from '../src/systems/GameModel';
import { TAPIOCA_SHOWER, approachExtra } from '../src/data/nimushi';

/** A deterministic RNG, so every ABYSS fixture is repeatable. */
export const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

export const STEP = 1 / 120;
export const tick = (game: GameModel, seconds: number, direction = 0, firing = false) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) game.step(STEP, direction, firing);
};

/**
 * A round placed exactly where a test wants it, with no velocity.
 *
 * It is a REAL bullet on the real bullet list and goes through the real collision pass -- it is not
 * a damage call. That is the point: every weak-point rule is asserted through the path a fired
 * round actually takes, so a test cannot pass by reaching round the back of it.
 */
export function round(x: number, y: number, damage = 1, source: Bullet['source'] = 'player', extra: Partial<Bullet> = {}): Bullet {
  return {
    source, x, y, previousY: y, previousX: x, vx: 0, vy: 0,
    damage, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(),
    range: 900, travelled: 0, beam: false, hits: new Set(), alive: true, ...extra,
  };
}

/** Put a round into the eye and let the model resolve it. */
export function shootEye(game: GameModel, damage = 1, source: Bullet['source'] = 'player') {
  const eye = game.boss.eye;
  game.bullets.push(round(game.boss.x, eye.y + eye.height / 2, damage, source));
  game.step(STEP, 0, false);
}
/** Put a round into the armoured body, well clear of the eye. */
export function shootBody(game: GameModel, damage = 1, source: Bullet['source'] = 'player') {
  const body = game.boss.body;
  game.bullets.push(round(body.x + 14, body.y + 8, damage, source));
  game.step(STEP, 0, false);
}

/**
 * Straight into the arena at the fight's own distance -- the ABYSS as it opened before the BOSS PARITY
 * PASS added the approach. For tests whose subject is the fight; the approach has tests of its own.
 */
export function atFightDistance(game: GameModel) {
  const extra = approachExtra.views;
  approachExtra.views = 0;
  try { return game.jumpToNimushi(); } finally { approachExtra.views = extra; }
}
/** In the arena, dormant, at full HP, with nothing underfoot -- the clean slate for a fight test. */
export function atNimushi(seed = 5) {
  const game = new GameModel(false, seeded(seed));
  // Re-seeded at the fight's entry (as regressionSignature's `entered` does): what 1-1's setup draws
  // before the jump must never decide a boss fixture. Every AREA 1 change used to re-flip these.
  (game as unknown as { random: () => number }).random = seeded(seed);
  // BOSS PARITY PASS: the arena now opens with an APPROACH -- NIMUSHI asleep a viewport further off.
  // These fixtures are about the fight, so they open it at the fight's own distance, as it always
  // did; the approach has its own tests, which open it exactly as a run does.
  atFightDistance(game);
  game.platforms = []; game.doodads = []; game.containers = []; game.enemies = [];
  return game;
}
/** The same, with the fight actually started: one legitimate round into the eye. */
export function fighting(seed = 5) {
  const game = atNimushi(seed);
  shootEye(game, 1);
  return game;
}

/**
 * The ORDINARY damage window: dormant, or the eye's own open state.
 *
 * `boss.eyeOpen` is now true during TAPIOCA SHOWER as well, which is the point of the attack -- but
 * a fixture that injects `shootEye` on a frame counter has no CHARGE and no dodging to do, so
 * following the eye into a shower pours four times the damage a player could and finishes the
 * fight before whatever the test is actually about has happened. Fixtures whose subject is
 * something else use this and keep the cadence they always had.
 *
 * Measured, for the record: a real weapon does LESS damage in a shower than in an ordinary window
 * (1.7-6.0 against 4.5-7.5), because the player is busy. The uncapped window is a fixture problem.
 */
export const inWindow = (game: GameModel) => game.boss.state === 'dormant' || game.boss.state === 'eyeOpen';

/** Hold the player still at a fixed distance behind NIMUSHI's face, so geometry tests are stable. */
export function pin(game: GameModel, reach = 300) {
  game.player.vy = 0;
  game.player.y = game.boss.face + reach * -game.gravitySign;
}

/**
 * Clear whatever NIMUSHI has split off.
 *
 * Clones and shades go into the ORDINARY enemy list, which is the point of them -- so they are
 * stomped, shot and counted like anything else. That also means a fixture testing something else
 * can have a round absorbed by one, or bank a kill it never meant to. Anything whose subject is not
 * the clones clears them first.
 */
export const clearSummoned = (game: GameModel) => {
  game.enemies = game.enemies.filter(e => e.kind !== 'nimushiClone' && e.kind !== 'nimushiShade');
};

/**
 * Take NIMUSHI down the legitimate way: wait for the eye, put rounds in it, never write HP.
 *
 * Used by fixtures that need a WON fight to test something else (the clear screen, TOTAL DEPTH).
 * It holds the player still and immortal because what it is standing in for is a player who dodged
 * everything -- but the damage itself is only ever real rounds through the real collision pass.
 */
export function defeatNimushi(game: GameModel, limit = 400) {
  for (let i = 0; i < limit / STEP && !game.boss.defeated && game.state === 'boss'; i++) {
    game.player.invincible = 9;
    pin(game, 300);
    // The arena guarantees a heart in the first three stretches and the pinned player sweeps it up,
    // which would quietly change the HP a caller set on purpose. This helper is for WINNING the
    // fight; anything that wants to test healing does it deliberately somewhere else.
    if (game.pickups.some(k => k.kind === 'heart')) game.pickups = game.pickups.filter(k => k.kind !== 'heart');
    // ...and nothing to stand on, for the same reason. A pinned player drifts through whatever the
    // arena lays and banks stomps the caller never asked for -- a bounce target or a clone alike.
    // This helper is for WINNING the fight; anything that wants to count kills does it elsewhere.
    game.enemies = [];
    if (inWindow(game) && i % 8 === 0) {
      const eye = game.boss.eye;
      game.bullets.push(round(game.boss.x, eye.y + eye.height / 2, 3));
    }
    game.step(STEP, 0, false);
  }
  return game.boss.defeated;
}

/** Which shower lane a given x sits in. */
export const laneOf = (x: number, lanes: number = TAPIOCA_SHOWER.lanes, left = 28, span = 394) =>
  Math.max(0, Math.min(lanes - 1, Math.floor(((x - left) / span) * lanes)));

/**
 * Drive a whole run from 4-3 CLEAR into the ABYSS staging room and down to the broken seal.
 *
 * It plays: alternating movement so the player actually leaves each ledge, and ACTION often enough
 * to shoot the seal open. Nothing is teleported and no flag is set by hand.
 */
export function intoTheAbyss(game: GameModel, seconds = 40) {
  for (let i = 0; i < seconds / STEP && game.abyssStage === 'staging'; i++) {
    game.step(STEP, Math.sin(i / 90) > 0 ? 1 : -1, i % 30 === 0);
    if (game.state === 'shop') game.closeShop();
  }
}

/**
 * BOSS PARITY PASS: the damage window no longer times out -- it shuts on damage alone, as the
 * original's eye does -- so a fixture that stands still and waits for an attack now has to earn it.
 * One real round of 3 into the weak point every tenth of a second while it is exposed: the window
 * closes within a few frames and the barrier's sequence runs, exactly as a player who shoots it.
 */
export function feedWindow(game: GameModel, frame: number) {
  if (game.boss.state !== 'eyeOpen' || frame % 12 !== 0) return;
  const eye = game.boss.eye;
  game.bullets.push(round(game.boss.x, eye.y + eye.height / 2, 3));
}
