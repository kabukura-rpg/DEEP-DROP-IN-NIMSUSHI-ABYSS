/**
 * GAME OVER, GAME CLEAR and PAUSE, as markup. The three run screens drawn in the REST / SHOP pixel
 * family: a charcoal panel with a hard metal edge and muted brass corner studs, Silkscreen for the
 * headings and the big number, and one brass button for the thing a player most likely wants next.
 *
 * Markup only. What each screen says comes from the run exactly as before -- main.ts reads the model
 * and passes the numbers in -- and the buttons keep their ids (`retry` / `share` / `home`,
 * `play-again` / `clear-home`, `resume` / `restart` / `home`) and their order, so the `onclick`s main.ts
 * wires, the overlay's first-button focus, the menu keys and TAB all see the list they always did.
 * Nothing here is focusable but those buttons.
 *
 * No emoji and no font-dependent arrow: the primary button's chevron is drawn by CSS.
 */

export interface GameOverView {
  depth: number;
  /** True only when this run beat the stored PERSONAL BEST (never for a LEVEL SELECT run). */
  newBest: boolean;
  kills: number;
  maxCombo: number;
  score: number;
  /** The SECTION the run ended in, e.g. `2-3` or `FINAL BOSS`. */
  reached: string;
  /** What ended the run, already in words (data/damage.ts). */
  cause: string;
}

export interface ClearView {
  depth: number;
  kills: number;
  maxCombo: number;
  upgrades: number;
  score: number;
  /** m:ss */
  clearTime: string;
  /** m:ss */
  bossTime: string;
}

const stat = (label: string, value: string | number) => `<span><small>${label}</small><b>${value}</b></span>`;
const head = (eyebrow: string, title: string, sub: string) =>
  `<div class="rp-head"><div class="rp-eyebrow">${eyebrow}</div><h2 id="rp-title" class="rp-title">${title}</h2><p class="rp-sub">${sub}</p></div>`;
const open = (kind: string) => `<div class="run-panel ${kind}" role="dialog" aria-modal="true" aria-labelledby="rp-title">`;

/** GAME OVER: the heading, how deep, the run's numbers, what ended it, then RETRY above the rest. */
export function gameOverPanelHtml(view: GameOverView) {
  return open('run-result run-over') +
    head('SIGNAL LOST', 'GAME OVER', 'まだ、深くへ行ける。') +
    `<div class="rp-depth"><small>DEPTH REACHED</small><strong>${view.depth}<span>m</span></strong>` +
    (view.newBest ? '<b class="rp-best">NEW PERSONAL BEST</b>' : '') + `</div>` +
    `<div class="rp-stats">${stat('REACHED', view.reached)}${stat('SCORE', view.score.toLocaleString())}${stat('KILLS', view.kills)}${stat('MAX COMBO', view.maxCombo)}</div>` +
    `<div class="rp-cause"><small>DEFEATED BY</small><b>${view.cause}</b></div>` +
    `<button id="retry" class="rp-primary">RETRY<small>もう一度潜る</small></button>` +
    `<div class="rp-row"><button id="share" class="rp-secondary">結果をシェア</button><button id="home" class="rp-secondary">タイトルへ</button></div>` +
    `</div>`;
}

/** GAME CLEAR: the heading, the run's total, its six numbers, then PLAY AGAIN above the way out. */
export function clearPanelHtml(view: ClearView) {
  return open('run-result run-clear') +
    head('RUN COMPLETE', 'GAME CLEAR', 'NIMUSHI DEFEATED') +
    `<div class="rp-depth"><small>TOTAL DEPTH</small><strong>${view.depth}<span>m</span></strong></div>` +
    `<div class="rp-stats rp-stats-3">${stat('TOTAL KILLS', view.kills)}${stat('MAX COMBO', view.maxCombo)}${stat('UPGRADES', view.upgrades)}` +
    `${stat('SCORE', view.score.toLocaleString())}${stat('CLEAR TIME', view.clearTime)}${stat('BOSS TIME', view.bossTime)}</div>` +
    `<button id="play-again" class="rp-primary">PLAY AGAIN</button>` +
    `<button id="clear-home" class="rp-secondary">タイトルへ</button>` +
    `</div>`;
}

/** PAUSE: as small as it can be. RESUME first, then the two ways out side by side. */
export function pausePanelHtml() {
  return open('run-pause') +
    head('TAKE A BREATH', 'PAUSED', 'ひと休み。深淵は、逃げない。') +
    `<button id="resume" class="rp-primary">RESUME<small>つづける</small></button>` +
    `<div class="rp-row"><button id="restart" class="rp-secondary">最初から</button><button id="home" class="rp-secondary">タイトルへ</button></div>` +
    `</div>`;
}
