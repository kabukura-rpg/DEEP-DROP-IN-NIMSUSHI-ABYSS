import type { Upgrade, UpgradeId } from '../data/upgrades';
import { UPGRADE_ICON_ASSETS, upgradeIcon } from '../data/upgradeIcons';

/**
 * What an upgrade is about, for one small accent colour on its card and its held chip. Display
 * only: the catalogue has no category or rarity, and nothing in the game reads this.
 */
export type RestKind = 'life' | 'coin' | 'fire' | 'move';
export const REST_KIND: Record<UpgradeId, RestKind> = {
  apple: 'life', youth: 'life', knifeAndFork: 'life', candle: 'life', timeout: 'life',
  gemAttractor: 'coin', gemPowered: 'coin', gemSick: 'coin', poppingGems: 'coin', membersCard: 'coin',
  blastModule: 'fire', gunpowderBlocks: 'fire', hotCasing: 'fire', restInPieces: 'fire', drone: 'fire', laserSight: 'fire', reverseEngineering: 'fire',
  heartBalloon: 'move', rocketJump: 'move', safetyJetpack: 'move',
};

/** The images the REST draws with. Only a test passes anything but the shipped ones. */
export type UpgradeIconArt = Partial<Record<UpgradeId, string | null>>;

/** An upgrade's icon as a decorative image; one that is missing or fails to load leaves its frame empty, never a glyph. */
export function upgradeIconImg(upgrade: Upgrade, icons: UpgradeIconArt = UPGRADE_ICON_ASSETS) {
  const icon = upgradeIcon(upgrade, icons);
  return icon.kind === 'image' ? `<img src="${icon.src}" alt="" width="64" height="64" draggable="false" onerror="this.remove()">` : '';
}

/**
 * One card of the upgrade choice: [ICON] / NAME / one short line. Nothing longer -- the full
 * description and the original's name are the tester's to discover in play, not to read at a rest.
 *
 * The whole card is the button. Its mark on the right is drawn by CSS from `aria-pressed`, so the
 * chosen card never depends on a font having a glyph.
 */
export function upgradeCardHtml(upgrade: Upgrade, index: number, icons: UpgradeIconArt = UPGRADE_ICON_ASSETS) {
  return `<button class="upgrade-card" id="upgrade-${index}" aria-pressed="false" data-kind="${REST_KIND[upgrade.id]}"><span class="upgrade-icon">${upgradeIconImg(upgrade, icons)}</span>`
    + `<span class="upgrade-text"><strong>${upgrade.name}</strong><small>${upgrade.short}</small></span><span class="upgrade-mark" aria-hidden="true"></span></button>`;
}
