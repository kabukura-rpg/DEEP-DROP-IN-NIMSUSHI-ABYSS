/**
 * NIMUSHI'S VOICE -- the speech shell and its glyphs, drawing only.
 *
 * WHEN a line appears, WHAT it says, how long it holds and what dismisses it are the model's
 * (`GameModel.bossLine`, `NIMUSHI_LINES` in data/nimushi) and are never read a second time here:
 * this file only decides what a line looks like and where on the screen it sits. There is no clock,
 * no queue and no second copy of a line in this module, so nothing drawn can outlive the model's
 * own 3.2 seconds or survive the ACTION that skips it.
 *
 * The baseline drew the line as a rounded pink DOM panel over the whole canvas, which put a box in
 * front of the pearls, the player and the floating labels at the one moment the shaft is busiest.
 * It is drawn in the scene now, under everything that can hurt (GameScene: between the deep's image
 * and `graphics`) and in the arena's own palette: a plum-black slab with two-pixel steps at the
 * corners, a dim rose rim, and a small tail at the top edge pointing back at the king. No glow, no
 * drop shadow, no particles, no entrance animation -- the shell is four rectangles and the tail is
 * two, and a line either is up or is not.
 *
 * Screen-space, upright, and in logical 450x800 coordinates like the rest of the HUD: THE ABYSS
 * turns the physics over, never the interface. The shell is not moved by the screen shake and does
 * not follow the king.
 *
 * Japanese is the one thing here that is NOT pixel art. The glyphs keep Noto Sans JP and their
 * antialiasing -- Silkscreen has no kana, and a kana forced onto a 1px grid at this size stops being
 * readable, which is the whole point of the line. Sizes are worked out from the canvas's CSS width
 * so the text lands at about 14 CSS px on every viewport, which is what keeps the two-line dying
 * line two lines on a 360px phone.
 */
import type Phaser from 'phaser';

/**
 * The shell's palette and its place on the screen.
 *
 * `bottom` is the baseline's `bottom: 27%` of the 800px screen, kept exactly: round(800 * .73). The
 * shell grows UPWARDS from it as a line gets taller, so the gap to the touch controls never changes.
 */
export const BOSS_DIALOGUE = {
  /** The outer ring, stepped 2px in at every corner. */
  outer: 0x2b1b23,
  /** The 2px rim inside it -- dim rose, well under the BOSS wall's reds. */
  rim: 0x8d6667,
  /** The slab the glyphs sit on. */
  fill: 0x19131a,
  /** Warm ivory: the same ink the shaft's own `impact` labels use (render/floatingText). */
  ink: '#efe4cf',
  /** The shell's bottom edge in logical screen pixels. */
  bottom: 584,
  /** Screen centre: the shell and its tail are centred on it, whatever the line says. */
  centre: 225,
} as const;

export const BOSS_DIALOGUE_FONT = "'Noto Sans JP', sans-serif";
/** Weight 500: the SHOP and REST panels' own Japanese weight, already loaded by style.css. */
export const BOSS_DIALOGUE_WEIGHT = '500';
/** What the scene waits on, at the size the metrics are built around. */
export const BOSS_DIALOGUE_FONT_PROBE = "500 14px 'Noto Sans JP'";
/** The line's size in CSS pixels, and the padding around it, before the logical conversion. */
export const BOSS_DIALOGUE_CSS = { font: 14, lineHeight: 1.5, padY: 8, padX: 10, width: 340, margin: 32 } as const;

export interface BossDialogueMetrics {
  /** CSS pixels per logical pixel: the canvas's own scale, which FIT keeps equal on both axes. */
  scale: number;
  /** The shell's width and left edge, in logical pixels. */
  width: number;
  left: number;
  /** The logical font size that lands closest to 14 CSS px, and the gap added between lines. */
  font: number;
  lineSpacing: number;
  /** Vertical padding inside the shell, and the width the glyphs are allowed. */
  pad: number;
  wrap: number;
}

/**
 * The shell's measurements for a canvas that is `canvasCssWidth` CSS pixels wide.
 *
 * Everything is rounded to whole logical pixels so the shell's edges land on pixel boundaries at the
 * scale the canvas is actually drawn at. The glyphs are not: CJK keeps its antialiasing.
 */
export function bossDialogueMetrics(canvasCssWidth: number): BossDialogueMetrics {
  // Before the first layout the canvas can measure 0; drawing at 1:1 is the honest fallback.
  const scale = canvasCssWidth > 0 ? canvasCssWidth / 450 : 1;
  const css = BOSS_DIALOGUE_CSS;
  const width = Math.round(Math.min(css.width, canvasCssWidth > 0 ? canvasCssWidth - css.margin : 450 - css.margin) / scale);
  const font = Math.round(css.font / scale);
  return {
    scale, width, font,
    left: Math.round((450 - width) / 2),
    lineSpacing: Math.round(font * css.lineHeight) - font,
    pad: Math.round(css.padY / scale),
    wrap: width - 2 * Math.round(css.padX / scale),
  };
}

/** One filled rectangle of the shell: x, y, width, height, colour. */
export type BossDialogueRect = readonly [x: number, y: number, w: number, h: number, color: number];

/**
 * The shell itself, bottom to top: the outer ring as two overlapping bars (which is what cuts the
 * corners back 2px), the rim, the slab, then the tail's rim and its slab. Six rectangles, no state.
 */
export function bossDialogueShell(left: number, top: number, width: number, height: number): BossDialogueRect[] {
  const { outer, rim, fill, centre } = BOSS_DIALOGUE;
  return [
    [left + 2, top, width - 4, height, outer],
    [left, top + 2, width, height - 4, outer],
    [left + 2, top + 2, width - 4, height - 4, rim],
    [left + 4, top + 4, width - 8, height - 8, fill],
    [centre - 4, top - 4, 8, 4, rim],
    [centre - 2, top - 2, 4, 6, fill],
  ];
}

/** Paint the shell. Opaque throughout: nothing here fades, pulses or bleeds into the arena. */
export function drawBossDialogueShell(g: Phaser.GameObjects.Graphics, left: number, top: number, width: number, height: number) {
  for (const [x, y, w, h, color] of bossDialogueShell(left, top, width, height)) g.fillStyle(color, 1).fillRect(x, y, w, h);
}

const fonts = () => (typeof document === 'undefined' ? undefined : document.fonts);
let fontLoad: Promise<unknown> | undefined;

/**
 * Ask for Noto Sans JP's kana up front. style.css imports the family with `display=swap`, so a line
 * raised before it arrives would otherwise bake the fallback into its texture; `sample` is the text
 * the fight can actually say, which is what picks the right subsets off Google Fonts.
 */
export function loadBossDialogueFont(sample: string) {
  try { fontLoad ??= fonts()?.load(BOSS_DIALOGUE_FONT_PROBE, sample).catch(() => undefined); } catch { /* no font loading API: the fallback family draws */ }
  return fontLoad;
}

/** Whether the real family is in: part of the raster's key, so a late arrival redraws the line in place. */
export function bossDialogueFontReady() {
  try { return fonts()?.check(BOSS_DIALOGUE_FONT_PROBE) ?? true; } catch { return true; }
}
