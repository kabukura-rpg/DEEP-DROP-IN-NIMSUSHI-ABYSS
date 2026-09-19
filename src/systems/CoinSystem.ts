import { COIN_RULES, type Coin, type CoinRules } from '../data/coins';
import { WORLD } from '../data/balance';

/**
 * The run's money. It owns two separate totals on purpose:
 *
 *   scoreCoins  -- everything ever collected this run. It only ever goes up, so spending in the
 *                  SHOP can never cost the player their score.
 *   walletCoins -- what is actually left to spend.
 *
 * Collecting one coin raises both; buying something lowers only the wallet.
 */
export class CoinSystem {
  coins: Coin[] = [];
  scoreCoins = 0;
  walletCoins = 0;
  private nextId = 1;

  constructor(private readonly rules: CoinRules = COIN_RULES) {}

  /** Pop `count` coins out of a corpse, scattered so they do not land in one stack. */
  burst(x: number, y: number, count: number, random: () => number) {
    for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
      this.coins.push({
        id: this.nextId++,
        x, y,
        vx: (random() * 2 - 1) * this.rules.burstSpread,
        vy: -this.rules.burstSpeed * (0.6 + random() * 0.6),
        life: this.rules.lifetime,
        taken: false,
      });
    }
  }

  /**
   * Move every loose coin, drop the ones that timed out or fell behind the camera, and collect the
   * ones the player touched. Returns how many were picked up this step so the caller can make noise
   * about it; the totals are already updated.
   */
  tick(dt: number, player: { x: number; y: number }, cameraY: number) {
    let collected = 0;
    for (const coin of this.coins) {
      if (coin.taken) continue;
      coin.life -= dt;
      // Close enough and the coin comes to the player: a spray left behind by a fight should not
      // be lost simply because the player is falling faster than it is.
      const dx = player.x - coin.x, dy = player.y - coin.y;
      const distance = Math.hypot(dx, dy);
      if (distance < this.rules.magnetRadius && distance > 0.001) {
        const pull = this.rules.magnetPull * (1 - distance / this.rules.magnetRadius) * dt;
        coin.vx += (dx / distance) * pull;
        coin.vy += (dy / distance) * pull;
      }
      coin.vy = Math.min(this.rules.maxFallSpeed, coin.vy + this.rules.gravity * dt);
      coin.x += coin.vx * dt;
      coin.y += coin.vy * dt;
      // Coins bounce off the shaft walls instead of sliding out of the world.
      if (coin.x < WORLD.wall) { coin.x = WORLD.wall; coin.vx = Math.abs(coin.vx) * 0.6; }
      if (coin.x > WORLD.width - WORLD.wall) { coin.x = WORLD.width - WORLD.wall; coin.vx = -Math.abs(coin.vx) * 0.6; }
      if (Math.abs(coin.x - player.x) < this.rules.radius + 10 && Math.abs(coin.y - player.y) < this.rules.radius + 16) {
        coin.taken = true;
        this.scoreCoins += this.rules.value;
        this.walletCoins += this.rules.value;
        collected++;
      }
    }
    // A coin that timed out or slid above the view is simply gone: no second chance.
    this.coins = this.coins.filter(c => !c.taken && c.life > 0 && c.y > cameraY - 120 && c.y < cameraY + WORLD.height + 200);
    return collected;
  }

  /** True once a coin is close enough to expiry that the view should blink it. */
  expiring(coin: Coin) { return coin.life <= this.rules.blinkAt; }

  /** Spend from the wallet. Returns false and changes nothing when it cannot be afforded. */
  spend(amount: number) {
    if (!Number.isFinite(amount) || amount < 0 || amount > this.walletCoins) return false;
    this.walletCoins -= amount;
    return true;
  }
  canAfford(amount: number) { return Number.isFinite(amount) && amount >= 0 && amount <= this.walletCoins; }

  /** A new run starts broke. Both totals reset together; nothing survives a RETRY. */
  reset() { this.coins = []; this.scoreCoins = 0; this.walletCoins = 0; }
  /** A new SECTION only clears the coins lying on the floor, never the totals. */
  clearLoose() { this.coins = []; }
}
