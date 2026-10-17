/**
 * FLOATING TEXT -- glyph rendering only.
 *
 * The short labels the shaft throws up at the point something happened (RELOADED, +100, BAM!, COIN +n,
 * N COMBO, ...). Where a label appears, how long it lives, how fast it rises and how it fades are the
 * scene's (`GameScene.label` and its update loop) and are not read from here; this file only decides how
 * the glyphs are drawn.
 *
 * Pixel typography: Silkscreen (already loaded by style.css for the SHOP / REST titles and the desktop
 * shell). Its glyphs sit on a 1/8-em grid, so 8px is one canvas pixel per font pixel -- the same density
 * as the scale-1 sprite art -- and 16px is exactly two. No other size is used, so no glyph edge lands
 * between pixels. Canvas text is still antialiased by the browser (and differently per platform), so the
 * rasterised label is snapped back to hard pixels and given a 1px dark outline here, which is what keeps
 * it legible over every AREA's background without a box or a glow.
 *
 * Silkscreen has no kana / kanji: a label carrying any (the Japanese hints) keeps the family it always
 * had and only gains the outline, its glyphs left antialiased.
 *
 * A web font that has not arrived yet would be baked into the label's texture as the fallback (Phaser
 * rasterises a Text once). The scene asks for Silkscreen when it starts, and a label made before it has
 * arrived is redrawn, in place, once it has.
 */
import type Phaser from 'phaser';

/** The meanings the shaft's labels actually carry; every label in GameScene is one of these. */
export type FloatingTextKind = 'system' | 'warning' | 'reward' | 'impact';

export const FLOATING_TEXT_FONT = "Silkscreen, 'IBM Plex Mono', monospace";
/** The baseline's own family, kept for the Japanese hints (Silkscreen has no CJK glyphs). */
export const FLOATING_TEXT_CJK_FONT = 'monospace';
/** What the scene waits on: Silkscreen's Latin face, at its native size. */
export const FLOATING_TEXT_FONT_PROBE = '8px Silkscreen';
export const FLOATING_TEXT_OUTLINE = '#0d0b0f';

/**
 * system: refills (ammo and health), counters and status -- quiet, small, pale mint. warning: what is
 * about to hurt -- muted rose. reward: points and coin -- muted gold. impact: the stomp, a block opening,
 * the boss falling -- pale warm white. `hot` is the chain's heat (combo tier 8+), which the kill labels
 * have always shown by colour. (Health stays small: a LIFE / HP label spawns 2px from COIN HIGH, and two
 * gold 16px lines there would read as one.)
 */
export const FLOATING_TEXT_COLORS = { system: '#a8d8c0', warning: '#e0949f', reward: '#d6b46a', impact: '#efe4cf', hot: '#f4d67a' } as const;
/** Pixel-font sizes: whole multiples of Silkscreen's 8px grid only. */
export const FLOATING_TEXT_SIZES: Record<FloatingTextKind, 8 | 16> = { system: 8, warning: 8, reward: 16, impact: 16 };
/** The Japanese hints' size: the largest the baseline gave them (11 / 12px). */
export const FLOATING_TEXT_CJK_SIZE = 12;

export interface FloatingTextStyle {
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  color: string;
  padding: { x: number; y: number };
  /** Snap the glyphs to opaque pixels (pixel font) or keep their antialiasing (CJK fallback). */
  hard: boolean;
}

/** Silkscreen covers printable ASCII and Latin-1 (the combo label's middle dot among it). */
export const usesPixelFont = (value: string) => /^[\x20-\x7e -ÿ]*$/.test(value);

export function floatingTextStyle(kind: FloatingTextKind, value: string, hot = false): FloatingTextStyle {
  const pixel = usesPixelFont(value);
  return {
    fontFamily: pixel ? FLOATING_TEXT_FONT : FLOATING_TEXT_CJK_FONT,
    fontSize: `${pixel ? FLOATING_TEXT_SIZES[kind] : FLOATING_TEXT_CJK_SIZE}px`,
    fontStyle: pixel ? 'normal' : 'bold',
    color: hot ? FLOATING_TEXT_COLORS.hot : FLOATING_TEXT_COLORS[kind],
    // Room for the outline on every side; the label is centred on its origin, so this moves nothing.
    padding: { x: 1, y: 1 },
    hard: pixel,
  };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};

/**
 * Re-ink a rasterised label in place (RGBA, unpremultiplied as getImageData gives it): every pixel the
 * glyphs cover at least half becomes a glyph pixel, every pixel touching one (8-neighbourhood) becomes
 * the outline, everything else clears. `hard` makes the glyph pixels fully opaque in the fill colour;
 * otherwise their coverage is kept and laid over the outline.
 */
export function inkFloatingText(data: Uint8ClampedArray, width: number, height: number, fill: string, outline: string, hard: boolean) {
  const [fr, fg, fb] = rgb(fill), [or, og, ob] = rgb(outline);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] >= 128;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * 4, a = alpha[i];
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1 && !edge; dx++) edge = (dx || dy) ? solid(x + dx, y + dy) : false;
    if (hard ? a >= 128 : a === 255) { data[o] = fr; data[o + 1] = fg; data[o + 2] = fb; data[o + 3] = 255; continue; }
    if (!edge && (hard || a === 0)) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; continue; }
    if (hard) { data[o] = or; data[o + 1] = og; data[o + 2] = ob; data[o + 3] = 255; continue; }
    // Soft glyph edge: its coverage over the outline where the outline runs, over nothing elsewhere.
    const k = a / 255;
    if (edge) { data[o] = Math.round(or + (fr - or) * k); data[o + 1] = Math.round(og + (fg - og) * k); data[o + 2] = Math.round(ob + (fb - ob) * k); data[o + 3] = 255; }
    else { data[o] = fr; data[o + 1] = fg; data[o + 2] = fb; data[o + 3] = a; }
  }
}

/** Re-ink a Text's canvas and hand the result to the GPU, as Text.updateText itself does. */
function ink(text: Phaser.GameObjects.Text, style: FloatingTextStyle) {
  const { canvas, context } = text;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  inkFloatingText(image.data, canvas.width, canvas.height, style.color, FLOATING_TEXT_OUTLINE, style.hard);
  context.putImageData(image, 0, 0);
  const renderer = text.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (renderer && renderer.gl) text.frame.source.glTexture = renderer.canvasToTexture(canvas, text.frame.source.glTexture ?? undefined, true);
}

const fonts = () => (typeof document === 'undefined' ? undefined : document.fonts);
let fontLoad: Promise<unknown> | undefined;

/** Ask for Silkscreen up front (without the desktop shell it is otherwise only fetched when a SHOP / REST title first shows). */
export function loadFloatingTextFont() {
  try { fontLoad ??= fonts()?.load(FLOATING_TEXT_FONT_PROBE, 'RELOADED+0123456789').catch(() => undefined); } catch { /* no font loading API: the fallback family draws */ }
  return fontLoad;
}

/** A floating label at (x, y) on screen, drawn in its kind's style. Origin, depth and life stay the caller's. */
export function addFloatingText(scene: Phaser.Scene, x: number, y: number, value: string, kind: FloatingTextKind, hot = false) {
  const style = floatingTextStyle(kind, value, hot);
  const { hard: _hard, ...textStyle } = style;
  const text = scene.add.text(x, y, value, textStyle);
  ink(text, style);
  let ready = true;
  try { ready = !style.hard || (fonts()?.check(FLOATING_TEXT_FONT_PROBE) ?? true); } catch { /* treat as ready */ }
  if (!ready) loadFloatingTextFont()?.then(() => { if (text.scene) { text.style.update(true); ink(text, style); } });
  return text;
}
