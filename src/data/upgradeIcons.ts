import type { Upgrade, UpgradeId } from './upgrades';

/**
 * EXTERNAL TEST BUILD: which image each upgrade shows on the choice screen.
 *
 * ASSET MISSING, all twenty. The asset inventory for this pass found no upgrade or item artwork in
 * the repository or its history, and no image is generated or borrowed for one. Each entry falls
 * back to the upgrade's own glyph (`Upgrade.icon`) until artwork is supplied: filling in a path here
 * is the whole change needed then.
 */
export const UPGRADE_ICON_ASSETS: Record<UpgradeId, string | null> = {
  apple: null, blastModule: null, candle: null, drone: null, gemAttractor: null,
  gemPowered: null, gemSick: null, gunpowderBlocks: null, heartBalloon: null, hotCasing: null,
  knifeAndFork: null, laserSight: null, membersCard: null, poppingGems: null, restInPieces: null,
  reverseEngineering: null, rocketJump: null, safetyJetpack: null, timeout: null, youth: null,
};

export type UpgradeIcon = { kind: 'image'; src: string } | { kind: 'glyph'; text: string };

/** The image when there is one, the upgrade's own glyph when there is not. */
export function upgradeIcon(upgrade: Upgrade, assets: Partial<Record<UpgradeId, string | null>> = UPGRADE_ICON_ASSETS): UpgradeIcon {
  const src = assets[upgrade.id];
  return src ? { kind: 'image', src } : { kind: 'glyph', text: upgrade.icon };
}
