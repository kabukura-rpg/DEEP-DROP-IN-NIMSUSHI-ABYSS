import { describe, expect, it } from 'vitest';
import mainSource from '../src/main.ts?raw';
import animationMap from '../output/player-sprites-v1/animation-map.json';
import { PLAYER_ART_ASSETS } from '../src/render/playerArtAssets';
import { BUILD, buildIdentifier } from '../src/ui/branding';
import { TITLE_ASSETS, TITLE_PLAYER, soundLabel, titleMarkup, watchTitleLogo } from '../src/ui/titleScreen';
import { installLevelSelectGesture } from '../src/ui/touchGuards';
import { LEVEL_SELECT_GESTURE } from '../src/data/levelSelect';
// Read as files: Vitest hands a CSS import back empty, whatever the query. (No Node types here.)
const fs = await import(/* @vite-ignore */ 'node:' + 'fs') as {
  readFileSync: { (path: URL, encoding: 'utf8'): string; (path: URL): Uint8Array };
  readdirSync: (path: URL) => string[];
};
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const titleDir = new URL('../src/assets/title/', import.meta.url);
/** Width and height from a PNG's IHDR. */
const pngSize = (file: string) => {
  const b = fs.readFileSync(new URL(file, titleDir));
  const u32 = (at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
};
/** One function's source out of main.ts, from its declaration to the next top-level one. */
const fn = (name: string) => {
  const at = mainSource.indexOf(`function ${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  const end = mainSource.indexOf('\nfunction ', at + 1);
  return mainSource.slice(at, end < 0 ? undefined : end);
};

/**
 * TITLE SCREEN -- Concept C "QUIET RUINS". The look is new; what a tester can do from it is not.
 */
describe('Concept C layers', () => {
  it('ships exactly the two Concept C runtime images -- no CLEAN, UI MOCK or review picture', () => {
    expect(fs.readdirSync(titleDir).sort()).toEqual(['title-background.png', 'title-logo.png']);
    expect(pngSize('title-background.png')).toEqual({ width: 450, height: 800 });
    expect(pngSize('title-logo.png')).toEqual({ width: 450, height: 224 });
  });

  it('draws the title from those images, never from output/', () => {
    const html = titleMarkup(false);
    expect(html).toContain(`--title-bg:url('${TITLE_ASSETS.background}')`);
    expect(html).toContain(`<img src="${TITLE_ASSETS.logo}"`);
    expect(mainSource).toContain('setOverlay(titleMarkup(audio.muted));');
    for (const source of [html, mainSource]) {
      expect(source).not.toMatch(/title-screen-redesign|ui-mock|clean-450|ui-layout-reference/);
    }
  });

  it('keeps the logo in text for when the image does not load', () => {
    const fake = (complete: boolean, naturalWidth: number) => {
      const classes = new Set<string>(); let onError: (() => void) | undefined;
      const img = { complete, naturalWidth, getAttribute: () => 'logo.png', parentElement: { classList: { add: (c: string) => classes.add(c) } },
        addEventListener: (_: string, f: () => void) => { onError = f; } };
      return { root: { querySelector: () => img } as unknown as ParentNode, classes, fail: () => onError?.() };
    };
    const loading = fake(false, 0);
    watchTitleLogo(loading.root);
    expect(loading.classes.has('logo-missing')).toBe(false);
    loading.fail();
    expect(loading.classes.has('logo-missing')).toBe(true);
    const broken = fake(true, 0);
    watchTitleLogo(broken.root);
    expect(broken.classes.has('logo-missing')).toBe(true);
    expect(titleMarkup(false)).toContain('<span>DEEP DROP<small>NIMUSHI ABYSS</small></span>');
    expect(css).toContain('.title-logo.logo-missing img{display:none}');
  });

  it('places the existing PLAYER idle frames at scale 1 -- no new PLAYER art', () => {
    expect(TITLE_PLAYER.sheet).toBe(PLAYER_ART_ASSETS.sheets.shared);
    expect(TITLE_PLAYER.cell).toBe(48);
    const idle = animationMap.animations.idle;
    expect({ frames: idle.frames.length, fps: idle.fps }).toEqual({ frames: TITLE_PLAYER.frames, fps: TITLE_PLAYER.fps });
    // idle_00 / idle_01 are the first two cells of the shared sheet's top row: 0% and 33.3% of a 4x2 sheet.
    const frames = animationMap.frames as Record<string, { group: string; x?: number; y?: number }>;
    expect(idle.frames.map(f => [frames[f].group, frames[f].x, frames[f].y])).toEqual([['shared', 0, 0], ['shared', 48, 0]]);
    expect(css).toContain('background:var(--title-player) 0 0/400% 200% no-repeat');
    expect(css).toContain('animation:title-idle .3333s steps(2) infinite');
    expect(css).toContain('@keyframes title-idle{to{background-position:66.6667% 0}}');
    expect(css).toContain('width:calc(var(--u) * 48);height:calc(var(--u) * 48)');
    expect({ x: TITLE_PLAYER.x, y: TITLE_PLAYER.y }).toEqual({ x: 111, y: 368 });
    expect(css).toContain('left:calc(var(--u) * 111);top:calc(var(--u) * 368)');
  });

  it('lays out in the 450x800 logical frame and keeps still for reduced motion', () => {
    expect(css).toContain('--u:calc(100cqw / 450)');
    expect(css).toContain('center/cover no-repeat');
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.title-player{animation:none}}');
    expect(fn('fadeOutTitle')).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches) return;");
  });
});

describe('what the title does is unchanged', () => {
  it('START and CONTROL LAB still call start() exactly as before', () => {
    expect(mainSource).toContain("$('start').onclick = () => start(); $('practice').onclick = () => start(true);");
    const html = titleMarkup(false);
    expect(html).toContain('<button id="start"');
    expect(html).toContain('<button id="practice"');
  });

  it('LEVEL SELECT stays hidden until five taps on the title PLAYER or ?levels, and then sits above CONTROL LAB', () => {
    const html = titleMarkup(false);
    expect(html).not.toContain('level-select');
    // The old arrow is gone entirely.
    expect(html).not.toContain('title-symbol');
    expect(html).not.toContain('↓');
    expect(css).not.toContain('.title-symbol');
    expect(html).toContain('<div class="title-player-hit" aria-hidden="true"></div>');
    expect(mainSource).toContain("if (new URLSearchParams(location.search).has('levels')) revealLevelSelect();");
    expect(mainSource).toContain("const player = $('overlay').querySelector<HTMLElement>('.title-player-hit');");
    expect(mainSource).toContain('installLevelSelectGesture(player, revealLevelSelect, LEVEL_SELECT_GESTURE)');
    expect(mainSource).toContain("if (document.getElementById('level-select')) return;");
    expect(mainSource).toContain('button.onclick = showLevelSelect;');
    expect(mainSource).toContain("$('practice').insertAdjacentElement('beforebegin', button);");
  });

  it('♪ is one switch: the title button and the header button run the same toggle', () => {
    expect(mainSource).toContain("$('sound').onclick = toggleSound;");
    expect(mainSource).toContain("$('title-sound').onclick = toggleSound;");
    expect(fn('toggleSound')).toContain('audio.unlock(); audio.muted = !audio.muted;');
    expect(soundLabel(false)).toBe('♪ ON');
    expect(soundLabel(true)).toBe('♪ OFF');
    expect(titleMarkup(true)).toContain('aria-pressed="true">♪ OFF</button>');
    expect(titleMarkup(false)).toContain('aria-pressed="false">♪ ON</button>');
  });

  it('shows the build hash it is given at runtime, not one written into an image', () => {
    expect(titleMarkup(false, { label: 'TEST BUILD', version: 'v0.1', hash: 'abc1234' }))
      .toContain('<span class="build-tag" id="build-tag">TEST BUILD v0.1 • abc1234</span>');
    expect(titleMarkup(false)).toContain(buildIdentifier(BUILD));
  });

  it('hides the HUD only while the title is up, and gives it back to the run', () => {
    expect(css).toContain('#game-frame.title-screen .hud{visibility:hidden}');
    expect(fn('showTitle')).toContain("$('game-frame').classList.add('title-screen');");
    // Every other screen, and the run itself, goes through setOverlay, which clears it.
    expect(fn('setOverlay')).toContain("$('overlay').classList.remove('title-overlay'); $('game-frame').classList.remove('title-screen');");
  });

  it('START -> AREA 1: the fade is a look laid over a run that has already started', () => {
    const start = fn('start');
    expect(start.indexOf('scene.startRun(practice)')).toBeLessThan(start.indexOf('fadeOutTitle()'));
    expect(start).toContain("if ($('overlay').classList.contains('title-overlay')) fadeOutTitle();");
    const fade = fn('fadeOutTitle');
    for (const touched of ['scene', 'bridge', 'audio', 'music', 'model', 'mode', 'clearInput', 'resumeInput']) {
      expect(fade, touched).not.toMatch(new RegExp(`\\b${touched}\\b`));
    }
    expect(css).toContain('.title-fade{position:absolute;inset:0;z-index:1;pointer-events:none;');
  });

  it('START -> AREA 1: the whole title layer fades as one, and the HUD waits for it', () => {
    const fade = fn('fadeOutTitle');
    // Background, logo, PLAYER, buttons and footer: one copy of the whole .title-screen, not just the ruins.
    expect(fade).toContain('const copy = screen.cloneNode(true) as HTMLElement;');
    expect(fade).toContain("copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));");
    expect(fade).toContain('veil.inert = true;');
    expect(fade).toContain("{ duration: TITLE_FADE_MS, easing: 'ease-in' }");
    expect(mainSource).toContain('const TITLE_FADE_MS = 420;');
    // The copy lays itself out in the same 450x800 units as the live title.
    expect(css).toContain('.title-fade{position:absolute;inset:0;z-index:1;pointer-events:none;container-type:size}');
    // HUD hidden from the first frame of the fade until it ends (or is cancelled).
    expect(fade).toContain("$('game-frame').classList.add('title-fading');");
    expect(fade).toContain("fade.onfinish = fade.oncancel = () => { veil.remove(); if (!document.querySelector('.title-fade')) $('game-frame').classList.remove('title-fading'); };");
    expect(css).toContain('#game-frame.title-fading .hud{visibility:hidden}');
  });

  it('START -> AREA 1: the touch controls are see-through during the fade, and still take touches', () => {
    // Opacity only: visibility or display would stop a touch landing on them during the fade.
    expect(css).toContain('#game-frame.title-fading #touch-controls{opacity:0}');
    expect(css).not.toMatch(/title-fading #touch-controls\{[^}]*(visibility|display|pointer-events)/);
    // Back on the same frame the HUD is: when the fade ends or is cancelled.
    expect(fn('fadeOutTitle')).toContain("$('game-frame').classList.remove('title-fading')");
    // Purely a look: the controls, and the pointers they track, are never touched by the fade.
    for (const touched of ['touch-controls', 'movementPointers', 'firePointers', 'syncPointers', 'touchAccepted']) {
      expect(fn('fadeOutTitle'), touched).not.toContain(touched);
    }
  });
});

describe('hidden LEVEL SELECT on the title PLAYER', () => {
  const event = (type: string, extra: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true, bubbles: true });
    for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
    return e;
  };
  const setup = () => {
    let clock = 0, revealed = 0;
    const player = new EventTarget();
    installLevelSelectGesture(player, () => { revealed++; }, LEVEL_SELECT_GESTURE, () => clock);
    const mouse = (id: number) => {
      player.dispatchEvent(event('pointerdown', { pointerId: id, pointerType: 'mouse' }));
      player.dispatchEvent(event('pointerup', { pointerId: id, pointerType: 'mouse' }));
      player.dispatchEvent(event('click'));
      clock += 200;
    };
    const touch = (id: number) => {
      player.dispatchEvent(event('pointerdown', { pointerId: id, pointerType: 'touch' }));
      player.dispatchEvent(event('touchstart'));
      player.dispatchEvent(event('pointerup', { pointerId: id, pointerType: 'touch' }));
      player.dispatchEvent(event('touchend'));
      clock += 200;
    };
    return { mouse, touch, revealed: () => revealed };
  };

  it('opens on the fifth mouse click, and not on the first four', () => {
    const g = setup();
    for (let i = 0; i < 4; i++) g.mouse(1);
    expect(g.revealed()).toBe(0);
    g.mouse(1);
    expect(g.revealed()).toBe(1);
  });

  it('opens on the fifth touch tap, and not on the first four', () => {
    const g = setup();
    for (let i = 1; i <= 4; i++) g.touch(i);
    expect(g.revealed()).toBe(0);
    g.touch(5);
    expect(g.revealed()).toBe(1);
  });

  it('is an invisible target over the PLAYER, which itself looks exactly as before', () => {
    const rule = css.split('\n').find(l => l.startsWith('.title-player-hit{position'))!;
    // 68 logical px square, centred on the PLAYER at (135,392).
    expect(rule).toContain('left:calc(var(--u) * 101);top:calc(var(--u) * 358);width:calc(var(--u) * 68);height:calc(var(--u) * 68)');
    expect(rule).toContain('background:transparent;cursor:default');
    expect(css).not.toMatch(/\.title-player-hit:(hover|focus|active)/);
    expect(rule).not.toMatch(/border|outline|shadow|opacity/);
    expect(titleMarkup(false)).toContain('<div class="title-player" aria-hidden="true"></div>');
    expect(css).toContain('pointer-events:none}');
    expect(titleMarkup(false)).not.toMatch(/title-player-hit[^>]*title=/);
    // Not a button, so menu keys and START never see it; and it lies clear of every button.
    expect(titleMarkup(false)).not.toMatch(/<button[^>]*title-player-hit/);
    expect(358 + 68).toBeLessThan(551);
  });
});
