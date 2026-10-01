/**
 * DESKTOP OUTER SHELL -- Concept A "RUINS FRAME" (HUMAN APPROVED). The ruined wall the shaft is cut
 * into: a tall broken pier on the left, a lower one on the right, a chipped stone tablet with the
 * expedition record, and one carved tablet of controls. The Concept C game in the middle stays the
 * only thing that is lit; nothing out here is larger, brighter or busier than it.
 *
 * Desktop only (style.css hides all of it at 650px and below, where the mobile layout is unchanged).
 * Decoration is aria-hidden and never takes a pointer. What a player reads -- the record, the
 * controls, the ♪ state, the run status -- is live text, never part of an image.
 *
 * The record keeps `#side-best`, which main.ts already writes (and which a LEVEL SELECT warp never
 * overwrites). The controls describe the game as it plays now: ACTION is SPACE, a jump on the ground
 * and a shot downward in the air; a mouse click also fires.
 */
import pierUrl from '../assets/shell/ruin-pier-native-144x230.png';
import markUrl from '../assets/shell/descent-mark-12x16.png';

/**
 * The Concept A runtime images taken from the Codex asset set. The two tablets are drawn from
 * style.css (`.shell-record`, `.shell-notes`); mock, CLEAN and source artwork are never shipped.
 */
export const SHELL_ASSETS = { pier: pierUrl, mark: markUrl } as const;

/** The small downward mark that heads the brand line and the run-status strip. */
export const shellMark = () => `<img class="shell-mark" src="${SHELL_ASSETS.mark}" alt="" aria-hidden="true" draggable="false">`;

/** Left: the expedition record carved on a stone tablet. `#side-best` is the live PERSONAL BEST. */
export const recordMarkup = () => `<aside class="shell-record" aria-label="探索記録">`
  + `<h2 class="shell-heading">EXPEDITION LOG</h2>`
  + `<p class="shell-label">最深到達記録</p>`
  + `<p class="shell-depth"><span id="side-best">000</span><small>m</small></p>`
  + `<p class="shell-flavor">記録は、石に残る。<br>その先は、まだ知らない。</p>`
  + `<span class="shell-tally" aria-hidden="true"><i></i><i></i><i></i></span>`
  + `</aside>`;

/** Right: one carved tablet of controls. Four things, nothing that has stopped being true. */
export const notesMarkup = () => `<aside class="shell-notes" aria-label="操作">`
  + `<h2 class="shell-heading">DESCENT NOTES</h2>`
  + `<dl>`
  + `<div><dt>MOVE</dt><dd class="shell-keys"><kbd>A</kbd><kbd>D</kbd><span>/</span><kbd>←</kbd><kbd>→</kbd></dd></div>`
  + `<div><dt>SHOOT / BRAKE</dt><dd class="shell-keys"><kbd>SPACE</kbd></dd><dd>空中：下へ撃つ・減速<br>地上：ジャンプ</dd></div>`
  + `<div><dt>LAND / RELOAD</dt><dd>着地・踏みつけで全回復</dd></div>`
  + `<div class="shell-pause"><dt><kbd>ESC</kbd></dt><dd>ポーズ</dd></div>`
  + `</dl>`
  + `<p class="shell-aside">マウスクリックでも射撃</p>`
  + `</aside>`;

/**
 * The two broken piers and the few flat stone blocks that tie them to the shaft. Each side is
 * clipped at the game frame's edge, so no stone ever lies over the game.
 */
export const ruinsMarkup = () => `<div class="shell-ruins" aria-hidden="true">`
  + `<div class="shell-wing shell-wing-left"><img class="shell-pier" src="${SHELL_ASSETS.pier}" alt="" draggable="false"><i></i><i></i><i></i></div>`
  + `<div class="shell-wing shell-wing-right"><img class="shell-pier" src="${SHELL_ASSETS.pier}" alt="" draggable="false"><i></i><i></i><i></i></div>`
  + `</div>`;
