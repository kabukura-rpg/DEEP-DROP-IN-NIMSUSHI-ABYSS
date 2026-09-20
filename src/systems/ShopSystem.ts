import { SHOP_RULES, rollShopStock, type ShopOffer, type ShopRules } from '../data/shop';
import type { AreaId } from '../data/areas';
import type { CoinSystem } from './CoinSystem';

/** Why a purchase did not happen, so the UI can say something useful. */
export type PurchaseResult = 'bought' | 'tooPoor' | 'soldOut' | 'closed';

/**
 * Owns the shop's stock and whether it is open. It deliberately owns no effects: paying is a
 * CoinSystem operation and the goods are applied by GameModel through the very same calls a field
 * pickup uses, so a bought heart and a found one cannot drift apart.
 *
 * A shop exists where a SAFE ZONE puts one and nowhere else. The shelf is stocked at the start of
 * every SECTION so a chamber can simply open a door onto it; whether a run meets one is decided by
 * the chamber's content roll, which is why `available` asks about the doorway rather than about a
 * chance of its own.
 */
export class ShopSystem {
  open = false;
  offers: ShopOffer[] = [];
  /** Where the entrance stands, once the generator has placed it. */
  entrance: { x: number; y: number; width: number; height: number } | null = null;
  /** A shop is worth entering once; re-entering the same doorway does not restock it. */
  private visited = false;

  constructor(private readonly rules: ShopRules = SHOP_RULES) {}

  /** True once a chamber has actually put a doorway in this SECTION. */
  get available() { return this.entrance !== null; }

  /** Stock the shelf for the SECTION being built, priced for the AREA the run has reached. */
  stockForSection(random: () => number, area: AreaId | number) {
    this.open = false; this.visited = false; this.entrance = null;
    this.offers = rollShopStock(random, area, this.rules);
    return this.offers;
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

  reset() { this.open = false; this.offers = []; this.entrance = null; this.visited = false; }
}
