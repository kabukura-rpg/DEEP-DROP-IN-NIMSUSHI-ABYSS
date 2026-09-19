import type { GameModel } from '../src/systems/GameModel';
import { WORLD } from '../src/data/balance';

/**
 * Reach the goal so the exit is laid, then walk into the gate. Reaching 200m no longer ends a
 * SECTION by itself, so tests have to use the way out like a player does.
 */
export function reachExit(game: GameModel) {
  for (let i = 0; i < 40 && !game.exit; i++) {
    game.player.y = WORLD.startY + (game.sectionLength + 1 + i * 3) * WORLD.pixelsPerMeter;
    game.player.invincible = 99;
    game.step(1 / 120, 0, false);
  }
  const gate = game.exit;
  if (!gate) throw new Error('no exit was laid after reaching the section goal');
  game.player.x = gate.x + gate.width / 2;
  game.player.y = gate.y + gate.height / 2;
  game.player.invincible = 99;
  game.step(1 / 120, 0, false);
  return gate;
}
/** Reach the gate and take the rest point's first card, landing in the next SECTION. */
export function clearViaExit(game: GameModel) {
  reachExit(game);
  const choice = game.upgrades.choices[0];
  game.selectUpgrade(choice.id);
  game.confirmUpgrade();
  return choice.id;
}
