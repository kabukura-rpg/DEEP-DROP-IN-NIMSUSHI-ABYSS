import { COIN_RULES, coinValue, type Coin, type CoinDenomination, type CoinRules } from '../data/coins';
import { WORLD } from '../data/balance';

/**
 * The run's money. It owns two separate totals on purpose:
 *
 *   scoreCoins  -- everything ever collected this run. It only ever goes up, so spending in the
 *                  SHOP can never cost the player their score.
 *   walletCoins -- what is actually left to spend.
 *
 * Collecting one coin raises both by that coin's own value; buying something lowers only the wallet.
 *
 * It knows nothing about the COIN HIGH meter. Every path that earns money returns the value it
 * earned and the caller feeds the meter, so there is exactly one place that decides what counts.
 */
export class CoinSystem {
  coins: Coin[] = [];
  scoreCoins = 0;
  walletCoins = 0;
  /** COIN MAGNET widens the pull. The tuned radius itself is left alone. */
  attractMultiplier = 1;
  private get attractRadius() { return this.rules.magnetRadius * this.attractMultiplier; }
  private nextId = 1;

  constructor(private readonly rules: CoinRules = COIN_RULES) {}

  /**
   * Pop `count` coins of one size out of a corpse or a broken block, scattered so they do not land
   * in one stack. Returns the value put on the floor -- which is not yet earned: a coin has to be
   * caught before it is worth anything, and it can time out or fall away first.
   */
  burst(x: number, y: number, count: number, random: () => number, denomination: CoinDenomination = 'small') {
    const each = coinValue(denomination);
    const made = Math.max(0, Math.round(count));
    for (let i = 0; i < made; i++) {
      this.coins.push({
        id: this.nextId++,
        x, y,
        vx: (random() * 2 - 1) * this.rules.burstSpread,
        vy: -this.rules.burstSpeed * (0.6 + random() * 0.6),
        denomination, value: each,
        life: this.rules.lifetime,
        taken: false,
      });
    }
    return made * each;
  }
  /** A mixed spill -- a COIN VEIN's payout, which is deliberately both sizes so it reads as a haul. */
  spill(x: number, y: number, payout: Record<CoinDenomination, number>, random: () => number) {
    let total = 0;
    for (const denomination of Object.keys(payout) as CoinDenomination[]) {
      total += this.burst(x, y, payout[denomination], random, denomination);
    }
    return total;
  }

  /**
   * Move every loose coin, drop the ones that timed out or fell behind the camera, and collect the
   * ones the player touched. Returns how many were picked up and what they were worth, so the caller
   * can make noise about it and feed the COIN HIGH meter; the totals are already updated.
   *
   * `stopped` marks a coin as being in stopped time -- out in the shaft while the player stands in
   * a SAFE ZONE. Such a coin does not move, does not age and cannot be swept up, and it is not culled
   * either: it is waiting for the world to start again, exactly as a round in flight is. A coin in
   * the chamber with the player carries on as normal, which is what makes a mined COIN VEIN
   * collectable rather than a pile hanging in the air.
   */
  tick(dt: number, player: { x: number; y: number }, cameraY: number, stopped?: (coin: Coin) => boolean) {
    let collected = 0, earned = 0;
    // The coins themselves, not just the total: COIN POWERED pays charge per gem and POPPING COINS
    // fires per gem, and both need to know which size each one was.
    const taken: Coin[] = [];
    for (const coin of this.coins) {
      if (coin.taken || stopped?.(coin)) continue;
      coin.life -= dt;
      // Close enough and the coin comes to the player: a spray left behind by a fight should not
      // be lost simply because the player is falling faster than it is.
      const dx = player.x - coin.x, dy = player.y - coin.y;
      const distance = Math.hypot(dx, dy);
      if (distance < this.attractRadius && distance > 0.001) {
        const pull = this.rules.magnetPull * (1 - distance / this.attractRadius) * dt;
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
        this.scoreCoins += coin.value;
        this.walletCoins += coin.value;
        earned += coin.value;
        collected++;
        taken.push(coin);
      }
    }
    // A coin that timed out or slid above the view is simply gone: no second chance. One in stopped
    // time is exempt -- its clock is not running, so it cannot have run out.
    this.coins = this.coins.filter(c => !c.taken && (stopped?.(c) || (c.life > 0 && c.y > cameraY - 120 && c.y < cameraY + WORLD.height + 200)));
    return { collected, earned, taken };
  }

  /**
   * Pay value straight in, with nothing to catch. This is for money that is awarded rather than
   * dropped -- a settled COMBO, which the original pays out directly -- so it can never be missed.
   * Anything that lands in the shaft goes through `burst`/`spill` instead and has to be collected.
   */
  award(value: number) {
    const paid = Math.max(0, Math.round(value));
    this.scoreCoins += paid;
    this.walletCoins += paid;
    return paid;
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
