import { afterEach, describe, expect, it } from 'vitest';
import { clearPanelHtml, gameOverPanelHtml, pausePanelHtml, type ClearView, type GameOverView } from '../src/ui/runPanel';
import { damageLabel } from '../src/data/damage';
import mainSource from '../src/main.ts?raw';

/**
 * GAME OVER / GAME CLEAR / PAUSE UI V1 -- the three run screens rebuilt in the REST / SHOP pixel family.
 *
 * Look only. These tests hold what the rebuild must not move: each screen says what it said, from the
 * same model values; the buttons keep their ids, their order and their onclicks; the keyboard starts
 * on the first one (RETRY, PLAY AGAIN, RESUME); main.ts is f94f678 byte for byte apart from the three
 * markup lines; REST and SHOP are untouched. And what it must change: no lime web-app buttons, no
 * Barlow, no emoji, nothing under 10px, nothing that moves by itself, and the run's HUD out of the
 * way while a run panel is up -- hidden under GAME OVER / GAME CLEAR, held back under PAUSE.
 */

const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
// Read from disk: Vitest hands a stylesheet import back empty.
const styleSource = new TextDecoder().decode(readFileSync(new URL('../src/style.css', import.meta.url)));
const RUN_START = styleSource.lastIndexOf('/*', styleSource.indexOf('THE RUN PANELS --'));
// Its own block, which ends where THE REST PANEL's begins.
const runCss = styleSource.slice(RUN_START, styleSource.lastIndexOf('/*', styleSource.indexOf('THE REST PANEL --')));

const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
const ids = (html: string) => buttons(html).map(b => /\sid="([^"]*)"/.exec(b)?.[1]);
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** Emoji and other pictographs whose look depends on the OS font. */
const PICTOGRAPH = /\p{Extended_Pictographic}|️/u;
/** Every [selector, declarations] pair, comments and @media/@container wrappers stripped. */
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|container)[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => [m[1].trim(), m[2].trim()] as const);

const OVER: GameOverView = { depth: 539, newBest: false, kills: 12, maxCombo: 7, score: 12345, reached: '2-3', cause: damageLabel('enemy') };
const CLEAR: ClearView = { depth: 5940, kills: 210, maxCombo: 31, upgrades: 9, score: 1234567, clearTime: '18:04', bossTime: '2:59' };

describe('GAME OVER panel', () => {
  const html = gameOverPanelHtml(OVER);

  it('reads GAME OVER, the depth, the run\'s numbers, what ended it, then RETRY', () => {
    const text = words(html);
    const order = ['GAME OVER', 'DEPTH REACHED 539 m', 'REACHED 2-3', 'SCORE 12,345', 'KILLS 12', 'MAX COMBO 7', 'DEFEATED BY A CREATURE', 'RETRY', '結果をシェア', 'タイトルへ'];
    let at = -1;
    for (const part of order) { const next = text.indexOf(part, at + 1); expect({ part, found: next > at }).toEqual({ part, found: true }); at = next; }
    expect(html).toContain('<h2 id="rp-title" class="rp-title">GAME OVER</h2>');
  });

  it('shows NEW PERSONAL BEST only when the run set one, and no other made-up line', () => {
    expect(html).not.toContain('PERSONAL BEST');
    expect(gameOverPanelHtml({ ...OVER, newBest: true })).toContain('<b class="rp-best">NEW PERSONAL BEST</b>');
    // Exactly the four numbers the old screen had, and the cause.
    expect([...html.matchAll(/<small>([^<]+)<\/small><b>/g)].map(m => m[1])).toEqual(['REACHED', 'SCORE', 'KILLS', 'MAX COMBO', 'DEFEATED BY']);
  });

  it('keeps the old buttons, ids and order: RETRY, SHARE, TITLE -- and RETRY is the brass one', () => {
    expect(ids(html)).toEqual(['retry', 'share', 'home']);
    expect(buttons(html).map(b => /class="([^"]+)"/.exec(b)![1])).toEqual(['rp-primary', 'rp-secondary', 'rp-secondary']);
    expect(html.match(/tabindex|<a\b|<input|<select/g)).toBeNull();
  });

  it('is a labelled dialog, with no emoji', () => {
    expect(html.startsWith('<div class="run-panel run-result run-over" role="dialog" aria-modal="true" aria-labelledby="rp-title">')).toBe(true);
    expect(PICTOGRAPH.test(html)).toBe(false);
    expect(PICTOGRAPH.test(gameOverPanelHtml({ ...OVER, newBest: true }))).toBe(false);
  });
});

describe('GAME CLEAR panel', () => {
  const html = clearPanelHtml(CLEAR);

  it('reads GAME CLEAR, NIMUSHI DEFEATED, the total, the six numbers, then PLAY AGAIN', () => {
    const text = words(html);
    expect(text).toBe('RUN COMPLETE GAME CLEAR NIMUSHI DEFEATED TOTAL DEPTH 5940 m TOTAL KILLS 210 MAX COMBO 31 UPGRADES 9 SCORE 1,234,567 CLEAR TIME 18:04 BOSS TIME 2:59 PLAY AGAIN タイトルへ');
    // The FULL RUN browser check reads `CLEAR TIME m:ss` straight off the page.
    expect(/CLEAR TIME\s*\d+:[0-5]\d/.test(text)).toBe(true);
  });

  it('keeps PLAY AGAIN then the way out, by the same ids', () => {
    expect(ids(html)).toEqual(['play-again', 'clear-home']);
    expect(buttons(html).map(b => /class="([^"]+)"/.exec(b)![1])).toEqual(['rp-primary', 'rp-secondary']);
    expect(html.startsWith('<div class="run-panel run-result run-clear" role="dialog"')).toBe(true);
    expect(PICTOGRAPH.test(html)).toBe(false);
  });
});

describe('PAUSE panel', () => {
  const html = pausePanelHtml();

  it('is the smallest: a heading, a line, RESUME, and the two ways out that already existed', () => {
    expect(words(html)).toBe('TAKE A BREATH PAUSED ひと休み。深淵は、逃げない。 RESUME つづける 最初から タイトルへ');
    expect(ids(html)).toEqual(['resume', 'restart', 'home']);
    expect(buttons(html).map(b => /class="([^"]+)"/.exec(b)![1])).toEqual(['rp-primary', 'rp-secondary', 'rp-secondary']);
    expect(html.startsWith('<div class="run-panel run-pause" role="dialog"')).toBe(true);
    expect(html).not.toContain('run-result');
    expect(PICTOGRAPH.test(html)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// main.ts: the logic is f94f678's, line for line.

describe('gameplay semantics are unchanged', () => {
  it('main.ts is f94f678 apart from the RUN PANEL markup and NIMUSHI line relay', () => {
    // BOSS DIALOGUE VFX V1: the line is drawn in the scene now (src/render/bossDialogue.ts) and
    // main.ts keeps only the screen reader's copy of it, moved ahead of the numbers' cache whose key
    // never carried bossLine. Reversed here, so the rest of main.ts is still f94f678 byte for byte.
    const bossLineV0 = "  // NIMUSHI's own voice. Screen-space, dismissable, and never in the way of the controls.\n"
      + "  const line = $('boss-line');\n  line.hidden = !model.bossLine;\n  if (model.bossLine) line.textContent = model.bossLine.text;\n";
    const normalised = mainSource
      .replace(/^import \{ clearPanelHtml, gameOverPanelHtml, pausePanelHtml \} from '.\/ui\/runPanel';\n/m, '')
      .replace(/^ {2}setOverlay\((pausePanelHtml\(|clearPanelHtml\(|gameOverPanelHtml\().*$/gm, '  setOverlay(RUN_PANEL);')
      .replace(/^\/\*\* The line the screen reader[^\n]*\nlet lastBossLine = '';\n/m, '')
      .replace(/^ {2}\/\/ NIMUSHI's own voice\. The line itself is drawn in the scene now[\s\S]*?\n {2}\}\n/m, '')
      .replace(/^ {2}const heat = \$\('heat'\);$/m, bossLineV0 + "  const heat = $('heat');");
    expect(normalised.match(/RUN_PANEL/g)).toHaveLength(3);
    // The same normalisation applied to f94f678's main.ts (its three inline template lines).
    expect(sha256(normalised)).toBe('b8dd11a76441b44936add3cc4571c2cd7667babfa6ba1210eabc408752312af7');
  });

  it('passes the screens the same model values the old templates read', () => {
    expect(mainSource).toContain('  setOverlay(pausePanelHtml());');
    expect(mainSource).toContain('  setOverlay(clearPanelHtml({ depth, kills: model.kills, maxCombo: model.maxCombo, upgrades, score: model.score, clearTime, bossTime }));');
    expect(mainSource).toContain('  setOverlay(gameOverPanelHtml({ depth, newBest, kills: model.kills, maxCombo: model.maxCombo, score: model.score, reached: model.stage.label, cause: damageLabel(model.health.deathCause?.cause) }));');
  });

  it('leaves the SHOP / REST markup and the overlay plumbing alone', () => {
    const SOURCES = import.meta.glob(['../src/ui/shopPanel.ts', '../src/ui/restPanel.ts', '../src/ui/upgradeCard.ts', '../src/ui/menuKeys.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]))).toEqual({
      'ui/shopPanel.ts': '34be9d695b4fe6eae2b219d2a41eb7b6f1e501dabb9cfa1babba13c1f08337da',
      'ui/restPanel.ts': 'e38baa02e2994002c9b35617149e2ad3a2a71db0044d0a38709ea804e90592f4',
      'ui/upgradeCard.ts': 'dce7b12c96765ebbf3670b41afefc670a5969b9674999cdfd90e4c060264a523',
      'ui/menuKeys.ts': 'e7701ab8bc56ace0638cab2b229b27b724a6046e7b28d81c0b0981c474833ff4',
    });
  });
});

// main.ts's pause / resume / showClear / showResult, executed against a fake page.
interface FakeButton { id: string; onclick: null | (() => unknown); textContent: string }
const slice = (from: string, to: string) => {
  const start = mainSource.indexOf(from), end = mainSource.indexOf(to, start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
};
const strip = (ts: string) => ts.replace(/\(model: GameModel\)/g, '(model)').replace(/: 'playing' \| 'boss'/, '').replace(/\(seconds: number\)/, '(seconds)');
const RUN_JS = strip(slice('let pausedFrom', '/** A short, skippable SECTION CLEAR card') + slice('function showClear(', 'function updateHud('));
// The overlay's focus timer, as main.ts schedules it. The fake below runs this same expression.
const FOCUS_TIMER = "if (content) window.setTimeout(() => (focus ? focus() : $('overlay').querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }), 60);";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

function page() {
  expect(mainSource).toContain(FOCUS_TIMER);
  let html = '', overlayButtons: FakeButton[] = [], focused = 'BODY', timers: (() => void)[] = [];
  const calls: string[] = [];
  const els: Record<string, { textContent: string }> = { 'run-status': { textContent: '' } };
  const setOverlay = (content: string) => {
    html = content;
    overlayButtons = ids(content).map(id => ({ id: id!, onclick: null, textContent: '' }));
    if (content) timers.push(() => { focused = overlayButtons[0]?.id ?? 'BODY'; });
  };
  const $ = (id: string) => overlayButtons.find(b => b.id === id) ?? els[id];
  const model = { paused: false, practice: false, totalDepth: 539.9, kills: 4, maxCombo: 3, score: 900, elapsed: 75, bossTime: 12, stage: { label: '1-3' }, upgrades: { acquired: ['a', 'b'] }, health: { deathCause: { cause: 'spike' } } };
  const scene = { model };
  const g = globalThis as unknown as { window?: unknown };
  const saved = g.window;
  g.window = { setTimeout: (f: () => void) => { timers.push(f); return 0; } };
  restore = () => { g.window = saved; };
  const main = new Function('setOverlay', '$', 'scene', 'calls', 'damageLabel', 'clearPanelHtml', 'gameOverPanelHtml', 'pausePanelHtml', `
    let mode = 'playing', warpedRun = false, best = 100;
    const bridge = { active: true };
    const isPlayMode = m => m === 'playing' || m === 'boss';
    const clearInput = () => calls.push('clearInput');
    const resumeInput = () => calls.push('resumeInput');
    const recordBest = d => calls.push('recordBest ' + d);
    const start = practice => calls.push('start ' + !!practice);
    const showTitle = () => calls.push('showTitle');
    const location = { href: 'x' };
    ${RUN_JS}
    return { pause, resume, showClear, showResult, get mode() { return mode; }, set mode(m) { mode = m; }, bridge };
  `)(setOverlay, $, scene, calls, damageLabel, clearPanelHtml, gameOverPanelHtml, pausePanelHtml) as {
    pause: () => void; resume: () => void; showClear: (m: unknown) => void; showResult: (m: unknown) => void; mode: string; bridge: { active: boolean };
  };
  const flush = () => { const run = timers; timers = []; run.forEach(t => t()); return focused; };
  const press = (id: string) => overlayButtons.find(b => b.id === id)!.onclick!();
  return { main, model, calls, flush, press, get html() { return html; }, els };
}

describe('main.ts wiring, executed', () => {
  it('PAUSE: stops the run, opens on RESUME, and each button does what it did', () => {
    const p = page();
    p.main.mode = 'boss';
    p.main.pause();
    expect([p.main.mode, p.model.paused, p.main.bridge.active]).toEqual(['paused', true, false]);
    expect(p.html).toBe(pausePanelHtml());
    expect(p.flush()).toBe('resume');
    p.press('resume');
    expect([p.main.mode, p.model.paused, p.html]).toEqual(['boss', false, '']);
    p.main.pause(); p.press('restart'); p.main.pause(); p.press('home');
    expect(p.calls.filter(c => /start|showTitle/.test(c))).toEqual(['start false', 'showTitle']);
  });

  it('GAME OVER: records the depth, opens on RETRY, RETRY restarts and TITLE goes home', () => {
    const p = page();
    p.main.showResult(p.model);
    expect(p.main.mode).toBe('over');
    expect(p.els['run-status'].textContent).toBe('SIGNAL LOST');
    expect(p.html).toBe(gameOverPanelHtml({ depth: 539, newBest: true, kills: 4, maxCombo: 3, score: 900, reached: '1-3', cause: 'SPIKES' }));
    expect(p.flush()).toBe('retry');
    p.press('retry'); p.press('home');
    expect(p.calls.filter(c => /recordBest|start|showTitle/.test(c))).toEqual(['recordBest 539', 'start false', 'showTitle']);
  });

  it('GAME CLEAR: records the depth, opens on PLAY AGAIN, both buttons wired', () => {
    const p = page();
    p.main.showClear(p.model);
    expect(p.main.mode).toBe('clear');
    expect(p.html).toBe(clearPanelHtml({ depth: 539, kills: 4, maxCombo: 3, upgrades: 2, score: 900, clearTime: '1:15', bossTime: '0:12' }));
    expect(p.flush()).toBe('play-again');
    p.press('play-again'); p.press('clear-home');
    expect(p.calls.filter(c => /recordBest|start|showTitle/.test(c))).toEqual(['recordBest 539', 'start false', 'showTitle']);
  });
});

// ---------------------------------------------------------------------------------------------
// The CSS.

describe('run panel CSS', () => {
  const runRules = rules(runCss);

  it('is the REST / SHOP family: Silkscreen headings, no lime, no Barlow, no image', () => {
    expect(runCss).not.toMatch(/--lime|#b9ef70|#d2ff94|Barlow|url\(/);
    expect(runCss).toMatch(/\.run-panel \.rp-title\{font-family:'Silkscreen'/);
    expect(runCss).toMatch(/\.rp-depth strong\{font-family:'Silkscreen'/);
    expect(runCss).toMatch(/\.rp-primary\{[^}]*font-family:'Silkscreen'/);
    // Hard edges: no rounded corners, no glow (no blurred shadow), gradients only as the 4px corner studs.
    expect(runCss).not.toMatch(/border-radius|text-shadow/);
    for (const [, decl] of runRules) for (const shadow of decl.matchAll(/box-shadow:([^;]+)/g)) for (const part of shadow[1].split(/,(?![^(]*\))/)) {
      const lengths = part.trim().replace(/^inset /, '').split(' ').filter(t => /^-?\d/.test(t));
      expect({ part, blur: lengths[2] ?? '0' }).toEqual({ part, blur: '0' });
    }
    expect([...runCss.matchAll(/linear-gradient\(([^)]*)\) [^,;]*/g)].every(m => /4px 4px no-repeat/.test(m[0]))).toBe(true);
  });

  it('the old lime buttons and the old result blocks are gone from the whole sheet', () => {
    expect(styleSource).not.toMatch(/\.primary-button|\.secondary-button|\.result-depth|\.result-stats|\.death-cause|\.clear-content|\.result-content/);
  });

  it('has no text under 10px', () => {
    const sizes = [...runCss.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(8);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
  });

  it('moves nothing on its own, and a press sinks the contents 1px inside a box that keeps its size', () => {
    expect(runCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/animation|@keyframes|transition|transform|scale\(|filter:/);
    const px = (decl: string, prop: string) => Number(new RegExp(`${prop}:(\\d+)px`).exec(decl)?.[1]);
    const pressed = runRules.filter(([sel, decl]) => /^\.rp-(primary|secondary):active$/.test(sel) && decl.includes('padding-top'));
    expect(pressed.length).toBe(3);
    for (const [, decl] of pressed) expect(px(decl, 'padding-top') - px(decl, 'padding-bottom')).toBe(2);
  });

  it('shows a focus frame for the keyboard only, and hover only on a pointer that can hover', () => {
    expect(runCss).toContain('.run-panel button:focus-visible{outline:none}');
    for (const sel of ['.rp-primary:focus-visible', '.rp-secondary:focus-visible']) expect(runRules.some(([s, d]) => s === sel && /box-shadow:0 0 0 2px #04080a,0 0 0 4px var\(--rp-brass-hi\)/.test(d))).toBe(true);
    expect(runRules.some(([sel]) => /:focus(?!-visible)/.test(sel))).toBe(false);
    const hoverStart = runCss.indexOf('@media(hover:hover){'), hoverEnd = runCss.indexOf('\n}', hoverStart);
    expect(hoverStart).toBeGreaterThan(0);
    expect(runCss.slice(0, hoverStart) + runCss.slice(hoverEnd)).not.toMatch(/:hover/);
  });

  it('hides the HUD under GAME OVER / GAME CLEAR and holds it back under PAUSE -- keyed on the panel, so it comes back by itself', () => {
    const hud = runRules.filter(([sel]) => /\.hud\b/.test(sel));
    expect(hud).toEqual([
      ['#game-frame:has(>.overlay>.run-result)>.hud', 'visibility:hidden'],
      ['#game-frame:has(>.overlay>.run-pause)>.hud', 'opacity:.35'],
    ]);
    // REST and SHOP keep their own HUD rule, as they were.
    expect(styleSource).toContain('#game-frame:has(>.overlay>.shop-content)>.hud{opacity:.35}');
    expect(styleSource).toContain('#game-frame:has(>.overlay>.rest-panel)>.hud{opacity:.35}');
  });

  it('dims the run behind each panel by its own flat amount -- PAUSE the least -- and sizes to the game frame', () => {
    const alpha = (sel: string) => parseInt(/background:#[0-9a-f]{6}([0-9a-f]{2})/.exec(runRules.find(([s]) => s === sel)![1])![1], 16);
    expect(alpha('.overlay:has(>.run-pause)')).toBeLessThan(alpha('.overlay:has(>.run-clear)'));
    expect(alpha('.overlay:has(>.run-clear)')).toBeLessThan(alpha('.overlay:has(>.run-panel)'));
    expect(alpha('.overlay:has(>.run-pause)')).toBeLessThanOrEqual(0x8c);
    expect(runCss).toContain('.overlay:has(>.run-panel){container:runpanel/size;');
    expect(runCss).toContain('@container runpanel (max-height:620px){');
    expect(runCss).toContain('@container runpanel (max-width:359px){');
    expect(runCss).toMatch(/\.run-pause\{max-width:280px;/);
  });

  it('touches nothing outside its own panels', () => {
    for (const [sel] of runRules) expect({ sel, own: /\.run-|\.rp-|^\.overlay:has\(>\.run-|^#game-frame:has\(>\.overlay>\.run-/.test(sel) }).toEqual({ sel, own: true });
  });
});
