import { SHOP_RULES, rollShopStock, type ShopOffer, type ShopRules } from '../data/shop';
import type { CoinSystem } from './CoinSystem';

/** Why a purchase did not happen, so the UI can say something useful. */
export type PurchaseResult = 'bought' | 'tooPoor' | 'soldOut' | 'closed';

/**
 * Owns the shop's stock and whether it is open. It deliberately owns no effects: paying is a
 * CoinSystem operation and the goods are applied by GameModel through the very same calls a
 * field pickup uses, so buying a weapon and finding one cannot drift apart.
 */
export class ShopSystem {
  /** True once this SECTION's roll decided there is a shop somewhere in it. */
  available = false;
  open = false;
  offers: ShopOffer[] = [];
  /** Where the entrance stands, once the generator has placed it. */
  entrance: { x: number; y: number; width: number; height: number } | null = null;
  /** A shop is worth entering once; re-entering the same doorway does not restock it. */
  private visited = false;

  constructor(private readonly rules: ShopRules = SHOP_RULES) {}

  /** Decide whether the SECTION being built contains a shop, and stock it if so. */
  rollForSection(random: () => number) {
    this.open = false; this.visited = false; this.entrance = null; this.offers = [];
    this.available = random() < this.rules.chancePerSection;
    if (this.available) this.offers = rollShopStock(random, this.rules);
    return this.available;
  }
  /** The generator reports where it put the doorway. */
  placeEntrance(x: number, y: number, width: number, height: number) {
    this.entrance = { x, y, width, height };
  }
  /** True when the player is standing in the doorway and has not used it yet. */
  touches(px: number, py: number) {
    const e = this.entrance;
    return !!e && !this.visited && !this.open
      && px + 9 > e.x && px - 9 < e.x + e.width && py + 15 > e.y && py - 15 < e.y + e.height;
  }
  enter() {
    if (!this.entrance || this.visited) return false;
    this.open = true; this.visited = true;
    return true;
  }
  close() { this.open = false; }

  get soldOut() { return this.offers.every(o => o.sold); }

  /**
   * Buy one item. The coins leave the wallet (never the score) and `apply` hands the actual effect
   * back to the caller, which runs it through the existing gun/health/ammo systems.
   */
  buy(index: number, coins: CoinSystem, apply: (offer: ShopOffer) => void): PurchaseResult {
    if (!this.open) return 'closed';
    const offer = this.offers[index];
    if (!offer || offer.sold) return 'soldOut';
    if (!coins.canAfford(offer.price)) return 'tooPoor';
    coins.spend(offer.price);
    offer.sold = true;
    apply(offer);
    return 'bought';
  }

  reset() { this.available = false; this.open = false; this.offers = []; this.entrance = null; this.visited = false; }
}
