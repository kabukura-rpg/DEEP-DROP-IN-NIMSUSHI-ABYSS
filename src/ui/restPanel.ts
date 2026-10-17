import { UPGRADES, type Upgrade, type UpgradeId } from '../data/upgrades';
import { UPGRADE_ICON_ASSETS } from '../data/upgradeIcons';
import { REST_KIND, upgradeCardHtml, upgradeIconImg, type UpgradeIconArt } from './upgradeCard';

/**
 * THE REST PANEL, as markup. The REST POINT's choice -- the cards the run offers, the upgrades it
 * already holds, where NEXT goes -- drawn in the SHOP's pixel family: charcoal and deep blue-green,
 * worn stone, a muted brass edge.
 *
 * Markup only. Which cards are offered, how many, what choosing and confirming do and where the
 * focus goes all stay where they were: the model draws the cards, main.ts wires the same `onclick`
 * to each `upgrade-N` and to `upgrade-confirm`, and the overlay focuses the first card. The panel's
 * buttons are the cards in offer order and then NEXT, and nothing else is focusable, so the menu
 * keys and TAB walk exactly the list they did.
 *
 * No emoji and no other font-dependent glyph: an upgrade is shown by its own icon. Images are
 * decoration (`alt=""`); every upgrade keeps its name in words (the card's text, a held chip's
 * accessible name), and an image that fails to load takes itself out and leaves an empty frame.
 */

/** One held upgrade: its icon in a small chip, named for a screen reader and a mouse hover. */
export function heldChipHtml(upgrade: Upgrade, icons: UpgradeIconArt = UPGRADE_ICON_ASSETS) {
  return `<span class="rest-held" data-kind="${REST_KIND[upgrade.id]}" role="img" aria-label="${upgrade.name}" title="${upgrade.name} · ${upgrade.label}">${upgradeIconImg(upgrade, icons)}</span>`;
}

export interface RestPanelView {
  /** The cards on offer, in the model's order. */
  choices: readonly Upgrade[];
  /** What the run already holds. One of each per run, so a set: never a count. */
  held: readonly UpgradeId[];
  /** `SECTION 1-2` or `FINAL`. */
  cleared: string;
  hp: number;
  maxHp: number;
  lifeUp: number;
  lifeUpPer: number;
  maxAmmo: number;
  /** Where NEXT goes. */
  destination: string;
  /** This REST's SECTION, 1-based, and how many there are. */
  section: number;
  sections: number;
}

/** The whole panel: heading, the run's numbers, what it holds, the cards, the line, NEXT. */
export function restPanelHtml(view: RestPanelView, icons: UpgradeIconArt = UPGRADE_ICON_ASSETS) {
  // Catalogue order, as before: the shelf of held upgrades does not reshuffle from one REST to the next.
  const held = UPGRADES.filter(u => view.held.includes(u.id));
  const stat = (label: string, value: string | number) => `<span><small>${label}</small><b>${value}</b></span>`;
  return `<div class="rest-panel" role="dialog" aria-modal="true" aria-labelledby="rest-title">` +
    `<div class="rest-head"><div class="rest-eyebrow">${view.cleared} CLEAR / REST POINT</div>` +
    `<h2 id="rest-title" class="rest-title">REST<i> / </i>CHOOSE ONE</h2>` +
    `<p class="rest-sub">安全地帯 · HPの自動回復はありません</p></div>` +
    `<div class="rest-stats">${stat('HP', `${view.hp} / ${view.maxHp}`)}${stat('MAX HP', view.maxHp)}${stat('LIFE UP', `${view.lifeUp} / ${view.lifeUpPer}`)}` +
    `${stat('弾数上限', view.maxAmmo)}${stat('NEXT', view.destination)}${stat('SECTION', `${view.section} / ${view.sections}`)}</div>` +
    `<div class="owned-upgrades" role="group" aria-label="取得済み強化"${held.length ? ` data-count="${held.length}"` : ''}>` +
    (held.length ? `<small class="rest-held-label">取得済み</small>${held.map(u => heldChipHtml(u, icons)).join('')}` : '<small class="rest-held-none">取得済み強化：なし</small>') +
    `</div>` +
    `<div class="upgrade-list" data-count="${view.choices.length}">${view.choices.map((u, i) => upgradeCardHtml(u, i, icons)).join('')}</div>` +
    `<p id="selection-summary" class="upgrade-note" aria-live="polite">1つ選んでNEXTで確定。選択中は時間が停止します。</p>` +
    `<button id="upgrade-confirm" class="rest-next" disabled>NEXT · 選択してください</button></div>`;
}
