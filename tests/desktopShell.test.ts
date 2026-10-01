import { describe, expect, it } from 'vitest';
import mainSource from '../src/main.ts?raw';
import shellSource from '../src/ui/desktopShell.ts?raw';
import { SHELL_ASSETS, notesMarkup, recordMarkup, ruinsMarkup, shellMark } from '../src/ui/desktopShell';
import { titleMarkup } from '../src/ui/titleScreen';
// Read as files: Vitest hands a CSS import back empty, whatever the query. (No Node types here.)
const fs = await import(/* @vite-ignore */ 'node:' + 'fs') as {
  readFileSync: { (path: URL, encoding: 'utf8'): string; (path: URL): Uint8Array };
  readdirSync: (path: URL) => string[];
};
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const shellDir = new URL('../src/assets/shell/', import.meta.url);
const pngSize = (file: string) => {
  const b = fs.readFileSync(new URL(file, shellDir));
  const u32 = (at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
};
/** The page markup main.ts writes once at start-up. */
const page = mainSource.slice(mainSource.indexOf('app.innerHTML = `'), mainSource.indexOf('</main>`;'));
/** Everything style.css applies to the desktop shell, from its header comment to the end. */
const desktopCss = css.slice(css.indexOf('/* DESKTOP OUTER SHELL'));
/** The same rules without comments, and without the `:has()` test that only reads the title state. */
const desktopRules = desktopCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:has\([^)]*\)/g, '');
/** The mobile block (max-width:650px) that sizes the header and hides the desktop-only pieces. */
const mobileCss = css.split('\n').find(l => l.startsWith('@media(max-width:650px){.site-header'))!;

/**
 * DESKTOP OUTER SHELL -- Concept A "RUINS FRAME". The website around the game is gone; the ruins
 * that replace it carry the same live record, controls, ♪ and run status, and stop at 650px.
 */
describe('Concept A desktop shell', () => {
  it('ships only the four separated Concept A runtime assets -- no mock, CLEAN or source artwork', () => {
    expect(fs.readdirSync(shellDir).sort()).toEqual([
      'descent-mark-12x16.png', 'instruction-tablet-120x232.png', 'ruin-pier-native-144x230.png', 'stone-tablet-120x144.png',
    ]);
    expect(pngSize('ruin-pier-native-144x230.png')).toEqual({ width: 144, height: 230 });
    expect(pngSize('stone-tablet-120x144.png')).toEqual({ width: 120, height: 144 });
    expect(pngSize('instruction-tablet-120x232.png')).toEqual({ width: 120, height: 232 });
    expect(pngSize('descent-mark-12x16.png')).toEqual({ width: 12, height: 16 });
    for (const source of [mainSource, shellSource, css]) expect(source).not.toMatch(/output\/|desktop-shell-redesign|clean-\d|mock-\d|ruin-pier-source/);
  });

  it('replaces the marketing page: no slogan, no FIELD GUIDE chapters, no prototype footer', () => {
    for (const gone of ['THE ONLY', 'DOWN.', 'A DESCENT INTO THE UNKNOWN', '撃って、落ちて', 'NO JUMP', 'FIELD GUIDE', '01—03', 'guide-index',
      'KEEP IN MIND', 'EXPERIMENTAL ARCADE', 'site-footer', 'A SMALL GAME', 'PROTOTYPE', '4 AREAS', 'CHARGEは8', 'PERSONAL BEST</span>']) {
      expect(page, gone).not.toContain(gone);
    }
    expect(page).toContain('${recordMarkup()}');
    expect(page).toContain('${notesMarkup()}');
    expect(page).toContain('${ruinsMarkup()}');
  });

  it('keeps PERSONAL BEST live in the record: #side-best, floored and padded, never baked into art', () => {
    expect(recordMarkup()).toContain('<span id="side-best">000</span>');
    expect(recordMarkup()).toContain('最深到達記録');
    expect(mainSource).toContain("$('side-best').textContent = String(best).padStart(3, '0');");
    expect(mainSource).toContain("$('side-best').textContent = String(Math.floor(best)).padStart(3, '0');");
    // A LEVEL SELECT warp still never writes the record.
    expect(mainSource).toContain('if (warpedRun) return;');
  });

  it('carves the four controls as they play now -- SPACE jumps on the ground and fires in the air', () => {
    const notes = notesMarkup();
    for (const text of ['MOVE', '<kbd>A</kbd><kbd>D</kbd>', '<kbd>←</kbd><kbd>→</kbd>', 'SHOOT / BRAKE', '<kbd>SPACE</kbd>', '空中：下へ撃つ・減速', '地上：ジャンプ',
      'LAND / RELOAD', '着地・踏みつけで全回復', '<kbd>ESC</kbd>', 'ポーズ', 'マウスクリックでも射撃']) {
      expect(notes, text).toContain(text);
    }
    expect(notes).not.toMatch(/NO JUMP|CHARGE|8\/15\/25|0[1-3]</);
    // ESC still pauses, and a mouse click still fires.
    expect(mainSource).toContain("if (e.code === 'Escape') { e.preventDefault(); if (inPlay()) pause(); else if (mode === 'paused') resume(); }");
    expect(mainSource).toContain("if (e.pointerType !== 'mouse' || !inPlay()");
  });

  it('keeps ♪ one switch, showing ON / OFF from aria-pressed on desktop and the icon on mobile', () => {
    expect(page).toContain('<button id="sound" class="icon-button" aria-label="サウンドをオフにする" aria-pressed="false" title="サウンド切り替え">♪</button>');
    expect(mainSource).toContain("$('sound').onclick = toggleSound;");
    expect(mainSource).toContain("$('sound').setAttribute('aria-pressed', String(audio.muted));");
    expect(desktopCss).toContain(".icon-button::before{content:'♪ ON';");
    expect(desktopCss).toContain(".icon-button[aria-pressed=true]::before{content:'♪ OFF';");
  });

  it('keeps every id the game writes to: zone, run status, frame, practice panel', () => {
    for (const id of ['zone', 'run-status', 'game-frame', 'game', 'hud', 'overlay', 'touch-controls', 'physics-tuning', 'sound']) {
      expect(page, id).toContain(`id="${id}"`);
    }
    expect(page).toContain('<div class="cabinet-bottom">${shellMark()}<span id="run-status">READY TO DESCEND</span></div>');
  });

  it('leaves the central game alone: 450x800 logical, Phaser FIT, the Concept C title untouched', () => {
    expect(mainSource).toContain("parent: 'game', width: 450, height: 800");
    expect(mainSource).toContain('scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }');
    expect(shellSource).not.toMatch(/import .*(titleScreen|GameModel|GameScene|phaser)/);
    expect(titleMarkup(false)).not.toContain('shell-');
    // Desktop shows the game at its logical size, scaled down only to fit a short window, 9:16 always.
    expect(desktopCss).toContain('--gh:min(800px,calc(100vh - 100px));--gw:calc(var(--gh) * 9 / 16)');
    expect(desktopRules).not.toMatch(/#game-frame|#game |\.title-|\.hud|\.overlay|#touch-controls/);
  });

  it('decorates without taking input or light: aria-hidden art, no pointer, no glow, gradient or motion', () => {
    expect(ruinsMarkup()).toMatch(/^<div class="shell-ruins" aria-hidden="true">/);
    expect(shellMark()).toContain('aria-hidden="true"');
    expect(ruinsMarkup().match(/src="([^"]+)"/g)).toEqual([`src="${SHELL_ASSETS.pier}"`, `src="${SHELL_ASSETS.pier}"`]);
    expect(desktopCss).toContain('pointer-events:none');
    expect(desktopRules).not.toMatch(/gradient|text-shadow|blur|backdrop|animation|@keyframes|transition|border-radius|filter/);
    // The one shadow is the keycap's flat 2px lower lip, not a glow.
    expect(desktopRules.match(/box-shadow:[^;}]*/g)).toEqual(['box-shadow:none', 'box-shadow:inset 0 -2px 0 #303f36']);
  });

  it('is desktop only: hidden by default, drawn from 651px, and the mobile block is as it was', () => {
    expect(css).toContain('.shell-mark,.shell-record,.shell-notes,.shell-ruins{display:none}');
    const rules = desktopCss.slice(desktopCss.indexOf('{display:none}') + '{display:none}'.length);
    for (const query of rules.match(/@media[^{]*/g)!) expect(query, query).toContain('min-width:651px');
    expect(mobileCss).toContain('.cabinet-bottom{display:none}');
    expect(mobileCss).toContain('.layout{display:block;margin:0 auto;padding:0;max-width:min(100vw,calc((100svh - 78px)*9/16))}');
    expect(mobileCss).toContain('.header-right>span{display:none}');
    // The practice panel takes the right tablet's place rather than sitting on it.
    expect(css).toContain('.practice-active .shell-notes,.practice-active .shell-wing-right{visibility:hidden}');
  });
});
