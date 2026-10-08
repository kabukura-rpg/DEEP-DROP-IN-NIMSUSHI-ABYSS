/**
 * COIN + SIDE CAVE CONTENT ART -- drawing only.
 *
 * Eleven images from output/coin-side-cave-content-v1 (runtime/, byte for byte), shared by every AREA:
 *
 *   coin      small 14x14 and large 26x25, the coin's face. Used wherever a loose coin is drawn --
 *             AREA 1-4, the ABYSS staging room and the fight alike. The spin is the procedural one it
 *             always was: the same |cos| squeezes the face horizontally (see `coinFace`), and the
 *             expiry blink is the same alpha. A coin's size, value, pickup and motion are the model's.
 *   module    one 34x26 crate per GUN MODULE id, the procedural box's exact footprint. The bonus pip
 *             (heart / charge) is not in the image: the scene still draws it, over the crate.
 *   vein      34x40, a SIDE CAVE's COIN VEIN, laid on `veinBounds` -- the rectangle rounds are tested
 *             against. A chamber's vein (development `legacy` side rooms only) keeps its drawing.
 *   shopDoor  66x66, a SIDE CAVE's SHOP doorway, laid on `shopDoor(cave)`. The ABYSS staging room's
 *             doorway (ShopSystem.entrance) is NOT a cave's and keeps its procedural drawing.
 *
 * Each group falls back to the procedural drawing when its images did not load. A module falls back
 * on its own: a missing crate is drawn the old way, never as some other module's crate.
 */
import coinSmallUrl from '../assets/content/coin-small.png?url';
import coinLargeUrl from '../assets/content/coin-large.png?url';
import moduleMachineUrl from '../assets/content/module-machine.png?url';
import moduleBurstUrl from '../assets/content/module-burst.png?url';
import moduleLaserUrl from '../assets/content/module-laser.png?url';
import moduleNoppyUrl from '../assets/content/module-noppy.png?url';
import modulePuncherUrl from '../assets/content/module-puncher.png?url';
import moduleShotgunUrl from '../assets/content/module-shotgun.png?url';
import moduleTripleUrl from '../assets/content/module-triple.png?url';
import coinVeinUrl from '../assets/content/coin-vein.png?url';
import shopCaveDoorUrl from '../assets/content/shop-cave-door.png?url';
import type { CoinDenomination } from '../data/coins';
import type { GunModuleId } from '../data/gunModules';

export const CONTENT_ART = {
  coin: { small: coinSmallUrl, large: coinLargeUrl } as Record<CoinDenomination, string>,
  module: {
    machine: moduleMachineUrl, burst: moduleBurstUrl, laser: moduleLaserUrl, noppy: moduleNoppyUrl,
    puncher: modulePuncherUrl, shotgun: moduleShotgunUrl, triple: moduleTripleUrl,
  } as Record<GunModuleId, string>,
  vein: coinVeinUrl,
  shopDoor: shopCaveDoorUrl,
} as const;

/** Each image's canvas, as delivered. Every one is the footprint the procedural drawing had. */
export const CONTENT_GEOMETRY = {
  coin: { small: { width: 14, height: 14 }, large: { width: 26, height: 25 } } as Record<CoinDenomination, { width: number; height: number }>,
  module: { width: 34, height: 26 },
  vein: { width: 34, height: 40 },
  shopDoor: { width: 66, height: 66 },
} as const;

export const CONTENT_KEYS = {
  coin: { small: 'content-coin-small', large: 'content-coin-large' } as Record<CoinDenomination, string>,
  module: Object.fromEntries(Object.keys(CONTENT_ART.module).map(id => [id, `content-module-${id}`])) as Record<GunModuleId, string>,
  vein: 'content-coin-vein',
  shopDoor: 'content-shop-cave-door',
} as const;

/** What the scene loads: [texture key, url], one per image. */
export function contentLoads(): [string, string][] {
  return [
    ...(Object.keys(CONTENT_ART.coin) as CoinDenomination[]).map(d => [CONTENT_KEYS.coin[d], CONTENT_ART.coin[d]] as [string, string]),
    ...(Object.keys(CONTENT_ART.module) as GunModuleId[]).map(id => [CONTENT_KEYS.module[id], CONTENT_ART.module[id]] as [string, string]),
    [CONTENT_KEYS.vein, CONTENT_ART.vein],
    [CONTENT_KEYS.shopDoor, CONTENT_ART.shopDoor],
  ];
}

/** Both coin faces' keys when both loaded; otherwise null, and every coin keeps its procedural drawing. */
export const coinArt = (exists: (key: string) => boolean) =>
  exists(CONTENT_KEYS.coin.small) && exists(CONTENT_KEYS.coin.large) ? CONTENT_KEYS.coin : null;
/** This module's own crate, or null: never another module's image in its place. */
export const moduleArt = (id: GunModuleId | undefined, exists: (key: string) => boolean) => {
  const key = id ? CONTENT_KEYS.module[id] : undefined;
  return key && exists(key) ? key : null;
};
export const veinArt = (exists: (key: string) => boolean) => exists(CONTENT_KEYS.vein) ? CONTENT_KEYS.vein : null;
export const shopDoorArt = (exists: (key: string) => boolean) => exists(CONTENT_KEYS.shopDoor) ? CONTENT_KEYS.shopDoor : null;

/**
 * Where a coin's face goes and how far the spin squeezes it.
 *
 * The procedural coin was a column `2 + 2*half*spin` wide (small) and, on a large coin, a rim
 * `4 + 2*(half+2)*spin` wide, both centred on the coin -- so at full face the small coin is 14 wide
 * and the large one 26, exactly the two images. The face is drawn at that same width for the same
 * `spin`, so the coin turns exactly as it did: never thinner than the old edge-on sliver.
 */
export function coinFace(denomination: CoinDenomination, x: number, y: number, spin: number) {
  const { width, height } = CONTENT_GEOMETRY.coin[denomination];
  const shown = denomination === 'large' ? 4 + 22 * spin : 2 + 12 * spin;
  return { x, y: Math.round(y - height / 2), scaleX: shown / width };
}
/** The crate's top-left: the procedural box's own `x - 17, y - 13`. */
export const modulePlacement = (x: number, y: number) => ({ x: x - CONTENT_GEOMETRY.module.width / 2, y: Math.round(y - CONTENT_GEOMETRY.module.height / 2) });
