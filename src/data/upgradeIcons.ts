import type { Upgrade, UpgradeId } from './upgrades';

/**
 * Which image each upgrade shows on the choice screen.
 *
 * The artwork is Codex's UPGRADE ICONS v1 (output/upgrade-icons-v1: 256px masters, the 64px runtime
 * cut, contact sheets and mapping.json). The 64px files are copied into src/assets/upgrades and
 * imported, so Vite ships them hashed and a missing file fails the build rather than a tester's run.
 * The file for each id is exactly the one mapping.json names.
 */
export const UPGRADE_ICON_FILES: Record<UpgradeId, string> = {
  safetyJetpack: 'safety-jetpack.png', rocketJump: 'rocket-jump.png', drone: 'drone.png',
  heartBalloon: 'heart-balloon.png', blastModule: 'blast-module.png', laserSight: 'laser-sight.png',
  gemPowered: 'gem-powered.png', gemAttractor: 'gem-attractor.png', poppingGems: 'popping-gems.png',
  gunpowderBlocks: 'gunpowder-blocks.png', hotCasing: 'hot-casing.png', knifeAndFork: 'knife-and-fork.png',
  restInPieces: 'rest-in-pieces.png', reverseEngineering: 'reverse-engineering.png', timeout: 'timeout.png',
  apple: 'apple.png', youth: 'youth.png', candle: 'candle.png', membersCard: 'members-card.png', gemSick: 'gem-sick.png',
};

/** Every shipped icon, by file name, as the URL Vite gives it. */
const SHIPPED = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/upgrades/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
    .map(([path, url]) => [path.split('/').pop()!, url]),
);

/** The runtime image for each upgrade, or null where its file is not shipped (then the glyph shows). */
export const UPGRADE_ICON_ASSETS: Record<UpgradeId, string | null> = Object.fromEntries(
  (Object.entries(UPGRADE_ICON_FILES) as [UpgradeId, string][]).map(([id, file]) => [id, SHIPPED[file] ?? null]),
) as Record<UpgradeId, string | null>;

export type UpgradeIcon = { kind: 'image'; src: string; fallback: string } | { kind: 'glyph'; text: string };

/** The image when there is one, the upgrade's own glyph when there is not. */
export function upgradeIcon(upgrade: Upgrade, assets: Partial<Record<UpgradeId, string | null>> = UPGRADE_ICON_ASSETS): UpgradeIcon {
  const src = assets[upgrade.id];
  return src ? { kind: 'image', src, fallback: upgrade.icon } : { kind: 'glyph', text: upgrade.icon };
}
