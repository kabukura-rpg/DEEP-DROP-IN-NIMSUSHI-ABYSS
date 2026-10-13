import { shopItem, type ShopItemId, type ShopOffer } from '../data/shop';
import { SHOP_COIN_ASSET, SHOP_ICON_ASSETS, shopIcon } from '../data/shopIcons';

/**
 * THE SHOP PANEL, as markup. One panel for every SHOP the run has -- a SIDE CAVE's in AREA 1-4 and
 * THE ABYSS staging doorway's -- because it is one overlay.
 *
 * Markup only: what is on the shelf, what it costs and whether it can be bought all come from the
 * model as before, and main.ts wires the very same `onclick` to each `shop-buy-N`. Every good is
 * still a real `<button>`, in shelf order, followed by `shop-close` and nothing else focusable, so
 * the menu keys, the initial focus and the browser's ENTER/SPACE see exactly the list they did.
 *
 * Images are decoration (`alt=""`) and none of them carries meaning on its own: an image that does
 * not arrive is removed, the good keeps its name, effect and price, and the price says COIN in words.
 */

/** What a good does, in one word, so a shelf can be read before any of it is priced. */
export function shopKind(offer: ShopOffer) {
  const item = shopItem(offer.item);
  if (item.maxHp > 0) return 'MAX LIFE';
  if (item.hearts > 0 && item.maxCharge > 0) return 'LIFE + CHARGE';
  if (item.hearts > 0) return 'LIFE';
  return 'CHARGE';
}

/** The kind as tags: pink for LIFE, lime for CHARGE, both for a good that does both. Same words. */
function kindHtml(kind: ReturnType<typeof shopKind>) {
  if (kind === 'MAX LIFE') return '<i class="k-max">MAX LIFE</i>';
  if (kind === 'LIFE + CHARGE') return '<i class="k-life">LIFE</i> + <i class="k-charge">CHARGE</i>';
  return kind === 'LIFE' ? '<i class="k-life">LIFE</i>' : '<i class="k-charge">CHARGE</i>';
}

/** A decorative image that takes itself out if it cannot load, leaving its slot to the fallback. */
const image = (src: string | null, size: number) =>
  src ? `<img src="${src}" alt="" width="${size}" height="${size}" draggable="false" onerror="this.remove()">` : '';

/** The images a panel is drawn with. Only a test passes anything but the shipped ones. */
export interface ShopArt { icons: Partial<Record<ShopItemId, string | null>>; coin: string | null }
const SHIPPED_ART: ShopArt = { icons: SHOP_ICON_ASSETS, coin: SHOP_COIN_ASSET };

/** The SHOP coin. The word it stands for follows the amount, and only shows when the coin is missing. */
const coin = (art: ShopArt, size: 12 | 24) => `<span class="shop-coin shop-coin-${size}">${image(art.coin, size)}</span>`;
const UNIT = `<span class="shop-unit"> COIN</span>`;

export type ShopCardState = 'ready' | 'short' | 'sold';

/** One good: [ICON] / KIND / NAME / EFFECT / PRICE. */
export function shopCardHtml(offer: ShopOffer, index: number, walletCoins: number, art: ShopArt = SHIPPED_ART) {
  const affordable = walletCoins >= offer.price;
  const state: ShopCardState = offer.sold ? 'sold' : affordable ? 'ready' : 'short';
  const kind = shopKind(offer);
  const note = state === 'short' ? '<em class="shop-short">不足</em>' : '';
  const stamp = state === 'sold' ? '<i class="shop-stamp">SOLD OUT</i>' : '';
  return `<button class="shop-item" id="shop-buy-${index}" data-kind="${kind.toLowerCase().replace(/[^a-z]+/g, '-')}" data-state="${state}" ${offer.sold || !affordable ? 'disabled' : ''}>` +
    `<span class="shop-icon">${image(shopIcon(offer.item, art.icons), 48)}</span>` +
    `<span class="shop-text"><span class="shop-kind">${kindHtml(kind)}</span><strong>${offer.name}</strong><small>${offer.effect}</small>` +
    `<span class="shop-price-row"><b class="shop-price">${coin(art, 12)}<span class="shop-amount">${offer.price}</span>${UNIT}</b>${note}</span></span>` +
    `${stamp}<span class="shop-go" aria-hidden="true">›</span></button>`;
}

export interface ShopPanelView {
  offers: readonly ShopOffer[];
  walletCoins: number;
  scoreCoins: number;
}

/** The whole panel: one heading, the purse, the shelf, the way out. */
export function shopPanelHtml({ offers, walletCoins, scoreCoins }: ShopPanelView, art: ShopArt = SHIPPED_ART) {
  return `<div class="panel-content shop-content">` +
    `<h2 class="shop-title">SHOP<span>コインを使って装備を整える</span></h2>` +
    `<div class="shop-purse"><span class="shop-purse-label">所持</span>${coin(art, 24)}<b>${walletCoins}</b>${UNIT}` +
    `<small>SCORE ${scoreCoins}（購入しても減りません）</small></div>` +
    `<div class="shop-list">${offers.map((offer, index) => shopCardHtml(offer, index, walletCoins, art)).join('')}</div>` +
    `<button id="shop-close" class="shop-leave">立ち去る <span>↓</span></button></div>`;
}

/**
 * WHERE THE KEYBOARD STARTS on a freshly drawn shelf, as a slot. Opening: the first good that can
 * be bought. After buying slot `bought`: the next one after it that can, wrapping round to the
 * front. -1 when none can, so the focus goes to `shop-close` rather than being left on BODY.
 *
 * By slot index only -- never by name, price or text -- and `buyable` is each button's own
 * `disabled`, so this follows exactly what the panel drew and the menu keys step through.
 */
export function shopFocusSlot(buyable: readonly boolean[], bought = -1) {
  for (let step = 1; step <= buyable.length; step++) {
    const slot = (bought + step) % buyable.length;
    if (buyable[slot]) return slot;
  }
  return -1;
}

/** The button that slot means: `shop-buy-N`, or `shop-close` when no good can be bought. */
export function shopFocusTarget(root: ParentNode, slots: number, bought = -1) {
  const buyable = Array.from({ length: slots }, (_, slot) => root.querySelector<HTMLButtonElement>(`#shop-buy-${slot}`)?.disabled === false);
  const slot = shopFocusSlot(buyable, bought);
  return root.querySelector<HTMLElement>(slot < 0 ? '#shop-close' : `#shop-buy-${slot}`);
}
