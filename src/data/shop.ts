import { GUN_MODULE_IDS, gunModule, type GunModuleId } from './gunModules';

/**
 * The SHOP's whole configuration. Rates, stock size and prices all live here so none of it ends up
 * as a number buried in gameplay code.
 */
export interface ShopRules {
  /** Chance that a SECTION contains a shop at all. Deliberately uncommon. */
  chancePerSection: number;
  /** How many goods are offered when one does appear. */
  stock: number;
  /** Metres into the SECTION before the entrance may be placed, so it never blocks the opening. */
  minDepth: number;
  /** Metres before the EXIT depth after which no shop is placed, so it cannot crowd the exit. */
  exitClearance: number;
  prices: { gunModule: number; heart: number; charge: number };
  /** Relative chance of each kind of good appearing in the stock list. */
  weights: { gunModule: number; heart: number; charge: number };
}

export const SHOP_RULES: ShopRules = {
  chancePerSection: 0.34,
  stock: 3,
  minDepth: 45,
  exitClearance: 25,
  prices: { gunModule: 45, heart: 30, charge: 35 },
  weights: { gunModule: 3, heart: 2, charge: 2 },
};

export type ShopItemKind = 'gunModule' | 'heart' | 'charge';

export interface ShopOffer {
  id: string;
  kind: ShopItemKind;
  /** Only for a gunModule offer: which weapon is on the shelf. */
  module?: GunModuleId;
  name: string;
  effect: string;
  price: number;
  sold: boolean;
}

/** One shelf of goods. Nothing here applies an effect; ShopSystem routes that to the real systems. */
export function rollShopStock(random: () => number, rules: ShopRules = SHOP_RULES): ShopOffer[] {
  const kinds: ShopItemKind[] = ['gunModule', 'heart', 'charge'];
  const total = kinds.reduce((sum, k) => sum + rules.weights[k], 0);
  const offers: ShopOffer[] = [];
  for (let i = 0; i < Math.max(1, rules.stock); i++) {
    let roll = random() * total;
    let kind: ShopItemKind = kinds[0];
    for (const k of kinds) { roll -= rules.weights[k]; if (roll <= 0) { kind = k; break; } }
    if (kind === 'gunModule') {
      const module = GUN_MODULE_IDS[Math.floor(random() * GUN_MODULE_IDS.length)] ?? GUN_MODULE_IDS[0];
      const def = gunModule(module);
      offers.push({ id: `shop-${i}`, kind, module, name: def.name, effect: def.description, price: rules.prices.gunModule, sold: false });
    } else if (kind === 'heart') {
      offers.push({ id: `shop-${i}`, kind, name: 'HEART', effect: 'HPを1回復。満タンなら余剰回復（LIFE UP）へ。', price: rules.prices.heart, sold: false });
    } else {
      offers.push({ id: `shop-${i}`, kind, name: 'CHARGE', effect: '最大弾数 +2。弾倉も満タンになる。', price: rules.prices.charge, sold: false });
    }
  }
  return offers;
}
