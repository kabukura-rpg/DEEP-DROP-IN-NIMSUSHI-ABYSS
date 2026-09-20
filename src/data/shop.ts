import type { AreaId } from './areas';

/**
 * The SHOP's whole catalogue. The original sells six things and no weapons: food restores health,
 * batteries grow the magazine, and one dish raises the maximum itself. Nothing here applies an
 * effect -- an offer only describes what it does, and ShopSystem hands that to the real systems, so
 * a bought heart and a found one can never drift apart.
 *
 * A shop lives in a SAFE ZONE and nowhere else, so its prices are the run's, not a shelf's: the
 * deeper the AREA, the dearer everything is.
 */
export type ShopItemId = 'riceBall' | 'sushi' | 'battery' | 'carBattery' | 'energyDrink' | 'curry';

export interface ShopItemDef {
  id: ShopItemId;
  name: string;
  effect: string;
  /** Hearts handed to HealthSystem, so overflow and LIFE UP behave exactly as they always do. */
  hearts: number;
  /** Permanent Max Charge added, through the same growth path as a module's CHARGE bonus. */
  maxCharge: number;
  /** Permanent Max HP added, through HealthSystem's own LIFE UP. */
  maxHp: number;
  /** Price by AREA index 1..4. The original's Normal Mode table; Hard Mode is not modelled. */
  prices: readonly [number, number, number, number];
}

export const SHOP_ITEMS: readonly ShopItemDef[] = [
  { id: 'riceBall', name: 'おにぎり', effect: 'HPを1回復。満タンなら余剰回復（LIFE UP）へ。', hearts: 1, maxCharge: 0, maxHp: 0, prices: [300, 500, 700, 900] },
  { id: 'sushi', name: 'すし', effect: 'HPを2回復。満タンなら余剰回復（LIFE UP）へ。', hearts: 2, maxCharge: 0, maxHp: 0, prices: [500, 700, 900, 1100] },
  { id: 'battery', name: 'バッテリー', effect: '最大CHARGE +1。弾倉も満タンになる。', hearts: 0, maxCharge: 1, maxHp: 0, prices: [150, 350, 550, 750] },
  { id: 'carBattery', name: 'カーバッテリー', effect: '最大CHARGE +2。弾倉も満タンになる。', hearts: 0, maxCharge: 2, maxHp: 0, prices: [250, 450, 650, 850] },
  { id: 'energyDrink', name: 'エナジードリンク', effect: 'HPを1回復し、最大CHARGE +1。', hearts: 1, maxCharge: 1, maxHp: 0, prices: [400, 600, 800, 1000] },
  { id: 'curry', name: 'カレー', effect: '最大HP +1。新しいハートは満タンで増える。', hearts: 0, maxCharge: 0, maxHp: 1, prices: [1000, 1200, 1400, 1600] },
];

export const shopItem = (id: ShopItemId) => SHOP_ITEMS.find(item => item.id === id) ?? SHOP_ITEMS[0];

/** What this good costs in that AREA. Clamped, so an index outside 1..4 still has a price. */
export const shopPrice = (item: ShopItemDef, area: AreaId | number) =>
  item.prices[Math.max(0, Math.min(item.prices.length - 1, Math.round(area) - 1))];

export interface ShopRules {
  /** How many goods are offered. Three of the six, never the same one twice. */
  stock: number;
}

export const SHOP_RULES: ShopRules = { stock: 3 };

export interface ShopOffer {
  id: string;
  item: ShopItemId;
  name: string;
  effect: string;
  price: number;
  sold: boolean;
}

/**
 * One shelf: `stock` distinct goods drawn from the six, priced for the AREA the run is in. Drawing
 * without replacement is the point -- a shop offering the same battery twice would waste a slot.
 */
export function rollShopStock(random: () => number, area: AreaId | number = 1, rules: ShopRules = SHOP_RULES, discount = 1): ShopOffer[] {
  const pool = [...SHOP_ITEMS];
  const offers: ShopOffer[] = [];
  const wanted = Math.max(1, Math.min(pool.length, rules.stock));
  for (let i = 0; i < wanted; i++) {
    const pick = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
    const [item] = pool.splice(pick, 1);
    // MEMBER'S CARD is applied where the price is quoted, so the shelf, the panel and the wallet
    // all see the same number and none of them can disagree about what something costs.
    offers.push({ id: `shop-${i}`, item: item.id, name: item.name, effect: item.effect, price: Math.round(shopPrice(item, area) * discount), sold: false });
  }
  return offers;
}
