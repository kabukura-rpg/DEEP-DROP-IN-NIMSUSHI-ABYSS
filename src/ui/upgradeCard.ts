import type { Upgrade } from '../data/upgrades';
import { upgradeIcon } from '../data/upgradeIcons';

/**
 * One card of the upgrade choice: [ICON] / NAME / one short line. Nothing longer -- the full
 * description and the original's name are the tester's to discover in play, not to read at a rest.
 */
export function upgradeCardHtml(upgrade: Upgrade, index: number) {
  const icon = upgradeIcon(upgrade);
  // An image that fails to load puts the upgrade's own glyph back in its place.
  const art = icon.kind === 'image'
    ? `<img src="${icon.src}" alt="" width="32" height="32" data-fallback="${icon.fallback}" onerror="this.replaceWith(document.createTextNode(this.dataset.fallback))">`
    : icon.text;
  return `<button class="upgrade-card" id="upgrade-${index}" aria-pressed="false"><span class="upgrade-icon">${art}</span>`
    + `<span class="upgrade-text"><strong>${upgrade.name}</strong><small>${upgrade.short}</small></span><span class="upgrade-arrow">○</span></button>`;
}
