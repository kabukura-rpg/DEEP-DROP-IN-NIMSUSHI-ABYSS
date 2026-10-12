import type { ShopItemId } from './shop';

/**
 * Which image each SHOP good shows on its card, and the coin the SHOP prices in.
 *
 * The artwork is Codex's MINIMAL PIXEL SHOP icons v1 (output/shop-ui-icons-v1: runtime/, the review
 * mocks and validation.json). The seven runtime PNGs are copied into src/assets/shop byte for byte
 * and imported, so Vite ships them and a missing file fails the build rather than a tester's run.
 * Goods are 24px drawn at 48px, the coin 12px drawn at 12px (price) and 24px (purse) -- whole
 * multiples, so nearest-neighbour keeps every pixel square.
 *
 * This is the SHOP panel's own coin. The one lying in the shaft is contentArt's coin-small /
 * coin-large and is not touched here.
 */
export const SHOP_ICON_FILES: Record<ShopItemId, string> = {
  riceBall: 'shop-rice-ball.png', sushi: 'shop-sushi.png', battery: 'shop-battery.png',
  carBattery: 'shop-car-battery.png', energyDrink: 'shop-energy-drink.png', curry: 'shop-curry.png',
};
export const SHOP_COIN_FILE = 'shop-coin.png';

/** Every shipped SHOP image, by file name, as the URL Vite gives it. */
const SHIPPED = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/shop/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
    .map(([path, url]) => [path.split('/').pop()!, url]),
);

/** The runtime image for each good, or null where its file is not shipped (then the slot stays empty). */
export const SHOP_ICON_ASSETS: Record<ShopItemId, string | null> = Object.fromEntries(
  (Object.entries(SHOP_ICON_FILES) as [ShopItemId, string][]).map(([id, file]) => [id, SHIPPED[file] ?? null]),
) as Record<ShopItemId, string | null>;

/** The SHOP coin, or null where it is not shipped (then the word COIN shows instead). */
export const SHOP_COIN_ASSET: string | null = SHIPPED[SHOP_COIN_FILE] ?? null;

/** This good's own image -- never another good's, so a missing file shows nothing rather than a lie. */
export const shopIcon = (id: ShopItemId, assets: Partial<Record<ShopItemId, string | null>> = SHOP_ICON_ASSETS) => assets[id] ?? null;
