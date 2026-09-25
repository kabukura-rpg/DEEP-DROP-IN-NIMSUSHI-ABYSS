import { describe, expect, it } from 'vitest';
// Read as files: Vitest hands a CSS import back empty, whatever the query. (No Node types here.)
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL, encoding: 'utf8') => string };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/style.css'), html = read('../index.html'), main = read('../src/main.ts');

/**
 * MOBILE TOUCH GESTURE FIX: the browser's own gestures are taken away inside the game and nowhere else.
 */
describe('browser gestures in the play area', () => {
  const rule = css.split('\n').find((l: string) => l.startsWith('#game-frame,#game canvas,#touch-controls'))!;

  it('turns off pan/zoom, selection and the callout on the frame, the canvas and every control', () => {
    expect(rule).toBeDefined();
    for (const selector of ['#game-frame', '#game canvas', '#touch-controls', '#move-pad', '#fire-pad', '#touch-controls button', '#pause']) {
      expect(rule.split('{')[0].split(','), selector).toContain(selector);
    }
    for (const declaration of ['touch-action:none', 'user-select:none', '-webkit-user-select:none', '-webkit-touch-callout:none']) {
      expect(rule, declaration).toContain(declaration);
    }
  });

  it('leaves the page itself zoomable', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)![1];
    expect(viewport).not.toMatch(/user-scalable|maximum-scale/);
  });

  it('cancels the touch default on the two pads only, with non-passive listeners', () => {
    expect(main).toContain(`for (const pad of [movePad, $('fire-pad')])`);
    expect(main).toContain(`pad.addEventListener('touchstart', holdGesture, { passive: false });`);
    expect(main).toContain(`pad.addEventListener('touchend', holdGesture, { passive: false });`);
    expect(main.match(/addEventListener\('touch(start|end)'/g)).toHaveLength(2);
    // Held state still comes from pointer events, keyed by pointerId, released on cancel.
    expect(main).toContain(`movePad.addEventListener('pointercancel', releaseMove);`);
    expect(main).toContain(`fireButton.addEventListener('pointercancel', releaseFire);`);
  });
});
