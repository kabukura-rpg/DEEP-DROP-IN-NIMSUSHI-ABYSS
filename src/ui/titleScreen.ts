/**
 * TITLE SCREEN -- Concept C "QUIET RUINS" (HUMAN APPROVED). The moment before the drop: a small
 * PLAYER on the ledge of a ruined entrance, and the ABYSS opening below.
 *
 * Built in layers, never as one picture: the background (ruins and abyss only), the logo, the
 * existing PLAYER idle frames, and the live buttons on top. Nothing a tester reads or presses --
 * START, LEVEL SELECT, CONTROL LAB, ♪, the TEST BUILD tag and its commit hash -- is in an image.
 *
 * Positions are in the game's 450x800 logical frame (see `.title-screen` in style.css), so the
 * composition scales with the frame exactly as the canvas does under Phaser's Scale.FIT.
 *
 * VISUAL ONLY. The title owns no game state: the run behind it is the ordinary one `showTitle`
 * starts, and START/CONTROL LAB still call `start()` exactly as before.
 */
import backgroundUrl from '../assets/title/title-background.png';
import logoUrl from '../assets/title/title-logo.png';
import { PLAYER_ART_ASSETS } from '../render/playerArtAssets';
import { BUILD, TITLE, buildIdentifier } from './branding';

/** The two Concept C runtime images. The CLEAN / UI MOCK review images are never shipped. */
export const TITLE_ASSETS = { background: backgroundUrl, logo: logoUrl } as const;

/**
 * The PLAYER on the ledge: the shipped PLAYER ART v1 shared sheet, its idle_00 / idle_01 cells, at
 * the idle animation's own 6fps. No new pose, no outline, no enlargement -- scale 1 in the logical
 * frame, so the PLAYER stays small against the ABYSS as Concept C intends.
 */
export const TITLE_PLAYER = {
  sheet: PLAYER_ART_ASSETS.sheets.shared,
  cell: PLAYER_ART_ASSETS.cell,
  /** Cell top-left in the 450x800 frame (centre 135,392), standing on the lit ledge. */
  x: 111, y: 368,
  frames: 2, fps: 6,
} as const;

/** `♪ ON` / `♪ OFF` for the title's sound switch; the state itself is `audio.muted`, as ever. */
export const soundLabel = (muted: boolean) => muted ? '♪ OFF' : '♪ ON';

/**
 * The title's markup. The ids are the ones the rest of main.ts already answers to (`start`,
 * `practice`, `build-tag`, and `.title-player-hit` for the hidden LEVEL SELECT gesture), so every
 * existing handler attaches unchanged. LEVEL SELECT is not here: it is only ever added by
 * `revealLevelSelect` (five taps on the title PLAYER, or `?levels`).
 */
export function titleMarkup(muted: boolean, build = BUILD) {
  return `<div class="title-screen" style="--title-bg:url('${TITLE_ASSETS.background}');--title-player:url('${TITLE_PLAYER.sheet}')">`
    + `<h2 class="title-logo"><img src="${TITLE_ASSETS.logo}" alt="" draggable="false"><span>${TITLE.main}<small>${TITLE.sub}</small></span></h2>`
    + `<div class="title-player" aria-hidden="true"></div>`
    // The hidden LEVEL SELECT gesture's target: invisible, a little larger than the 48px PLAYER cell.
    + `<div class="title-player-hit" aria-hidden="true"></div>`
    + `<div class="title-menu"><button id="start" class="title-button title-primary">START<span>潜降開始</span></button><button id="practice" class="title-button">CONTROL LAB<span>操作を試す</span></button></div>`
    + `<div class="title-footer"><button id="title-sound" class="title-sound" aria-pressed="${muted}">${soundLabel(muted)}</button><span class="build-tag" id="build-tag">${buildIdentifier(build)}</span></div>`
    + `</div>`;
}

/**
 * TITLE AUDIO ENTRY GATE, Codex design A "Minimal Overlay": the veil a fresh page opens under. Two
 * parts, both laid over the unchanged title above: a flat #03080b at 40% between the art and the menu,
 * and one full-frame button carrying the prompt, which is the only thing that can be pressed. A phone
 * (pointer:coarse) is told to tap, anything with a keyboard to press a key. The input rules are in
 * ui/entryGate.ts; the title itself is not redrawn.
 */
export const ENTRY_GATE = { keyboard: 'PRESS ANY KEY', touch: 'TAP TO ENTER', note: 'ENTER THE ABYSS' } as const;
export const entryPrompt = (coarse: boolean) => coarse ? ENTRY_GATE.touch : ENTRY_GATE.keyboard;
export function entryGateMarkup(coarse: boolean) {
  return {
    shade: `<div class="title-shade" aria-hidden="true"></div>`,
    gate: `<button id="title-gate" class="title-gate" aria-label="タイトルメニューに入る。最初の操作ではゲームは開始しません。"><span class="title-gate-prompt"><span>${entryPrompt(coarse)}</span><small>${ENTRY_GATE.note}</small></span></button>`,
  };
}

/**
 * A logo that fails to load falls back to the same words in text, so the title never shows a broken
 * image. The background and PLAYER need no such care: a missing one simply leaves the dark frame.
 */
export function watchTitleLogo(root: ParentNode) {
  const img = root.querySelector<HTMLImageElement>('.title-logo img');
  if (!img) return;
  const fallBack = () => img.parentElement?.classList.add('logo-missing');
  if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) fallBack();
  else img.addEventListener('error', fallBack, { once: true });
}
