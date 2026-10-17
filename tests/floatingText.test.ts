import { afterEach, describe, expect, it, vi } from 'vitest';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import {
  FLOATING_TEXT_CJK_FONT, FLOATING_TEXT_CJK_SIZE, FLOATING_TEXT_COLORS, FLOATING_TEXT_FONT, FLOATING_TEXT_FONT_PROBE, FLOATING_TEXT_OUTLINE, FLOATING_TEXT_SIZES,
  addFloatingText, floatingTextStyle, inkFloatingText, usesPixelFont, type FloatingTextKind,
} from '../src/render/floatingText';

// Node built-ins by dynamic import (no Node types here); the stylesheet from disk, as Vitest hands a CSS import back empty.
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: string) => { digest: (e: string) => string } } };
const styleSource = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Every floating label in 1784c3e, line for line as it stood (GameScene.effect), with the style arguments
 * it passed then and the kind it passes now. Everything else on the line -- the trigger, the burst, the
 * shake, the spawn x / y, the message -- must still be there byte for byte.
 */
const INVENTORY: [string, string, string][] = [
  ["if (event.type === 'land') { this.burst(event.x, event.y, 0xb9ef70, 9); this.label(event.x, event.y - 20, 'RELOADED', '#b9ef70', 12); }", "'#b9ef70', 12", "'system'"],
  ["if (event.type === 'heal') this.label(event.x, event.y - 48, event.lifeUps ? `LIFE UP! MAX HP +${event.lifeUps}` : event.value ? `HP +${event.value}` : `LIFE +${event.overflow}`, '#b9ef70', 13);", "'#b9ef70', 13", "'system'"],
  ["if (event.type === 'empty') this.label(event.x, event.y - 30, '弾切れ / 足場へ', '#f99bae', 11);", "'#f99bae', 11", "'warning'"],
  ["if (event.type === 'crack') { this.burst(event.x, event.y, 0xe8d48a, 7); if (event.value) this.label(event.x, event.y - 22, 'CRACK!', '#e8d48a', 11); }", "'#e8d48a', 11", "'warning'"],
  ["if (event.type === 'blockCrack') { this.shake = Math.max(this.shake, 1.4); this.burst(event.x, event.y, 0xffc27a, 8); this.label(event.x, event.y - 24, `あと${event.value}発`, '#ffc27a', 12); }", "'#ffc27a', 12", "'system'"],
  ["if (event.type === 'blockBreak') { this.shake = Math.max(this.shake, 2.8); this.burst(event.x, event.y, 0xffd2a0, 22); this.label(event.x, event.y - 24, 'OPEN!', '#ffd2a0', 15); }", "'#ffd2a0', 15", "'impact'"],
  ["if (event.type === 'doodad') { this.burst(event.x, event.y, 0xb9ef70, 10); this.label(event.x, event.y - 20, 'RELOADED', '#b9ef70', 12); }", "'#b9ef70', 12", "'system'"],
  ["if (event.type === 'coinVein') { this.burst(event.x, event.y, 0xffd479, 20); this.label(event.x, event.y - 24, `COIN +${event.value}`, '#ffd479', 14); }", "'#ffd479', 14", "'reward'"],
  ["if (event.type === 'timeVoid' && event.value) this.label(event.x, event.y - 54, 'TIME VOID', '#9fe8f5', 15);", "'#9fe8f5', 15", "'system'"],
  ["if (event.type === 'coinHigh' && event.value) { this.burst(event.x, event.y, 0xffe9a8, 26); this.label(event.x, event.y - 46, 'COIN HIGH', '#ffe9a8', 17); }", "'#ffe9a8', 17", "'reward'"],
  ["if (event.type === 'corpse') this.label(event.x, event.y - 20, `OMNOM ${event.value}/10`, '#d8c8d4', 12);", "'#d8c8d4', 12", "'system'"],
  ["if (event.type === 'comboSettle') { this.flash = Math.max(this.flash, 0.08); this.burst(event.x, event.y, 0xf4e9ad, 24); this.label(event.x, event.y - 62, `${event.value} COMBO · ${event.stage ?? ''}`, '#f4e9ad', 16); }", "'#f4e9ad', 16", "'reward'"],
  ["if (event.type === 'bossDown') { this.shake = 6; this.flash = 0.16; this.burst(event.x, event.y, 0xffd2a0, 40); this.label(event.x, event.y - 40, 'BOSS DEFEATED', '#ffd2a0', 18); }", "'#ffd2a0', 18", "'impact'"],
  ["this.label(event.x, event.y, event.stomp ? `BAM! +${event.value}` : `+${event.value}`, feedback.tier >= 8 ? '#f4e9ad' : '#f9acbf', event.stomp ? 20 : 15);", "feedback.tier >= 8 ? '#f4e9ad' : '#f9acbf', event.stomp ? 20 : 15", "event.stomp ? 'impact' : 'reward', feedback.tier >= 8"],
  ["if (event.source) this.label(event.source.x, event.source.y - 35, enemyType(event.source.kind).contactHint, '#ffc4cf', 12);", "'#ffc4cf', 12", "'warning'"],
];

const effectBody = sceneSource.slice(sceneSource.indexOf('  private effect(event: GameEvent) {'), sceneSource.indexOf('  private label('));

describe('floating text: inventory and timing are the baseline', () => {
  it('keeps every label line of 1784c3e, only its style arguments swapped for a kind', () => {
    for (const [line, before, after] of INVENTORY) {
      expect(line).toContain(before);
      expect(effectBody).toContain(line.replace(before, after));
    }
    // ...and there are no others.
    expect(effectBody.split('this.label(').length - 1).toBe(INVENTORY.length);
    expect(sceneSource.split('this.label(').length - 1).toBe(INVENTORY.length);
  });

  it('spawns at the same screen point, origin and depth, with the same 0.85s life', () => {
    expect(sceneSource).toContain('  private label(x: number, y: number, value: string, kind: FloatingTextKind, hot = false) {\n'
      + '    const text = addFloatingText(this, x, y - this.model.cameraY, value, kind, hot).setOrigin(0.5).setDepth(3);\n'
      + '    this.labels.push({ text, y, life: 0.85 });\n  }');
  });

  it('rises, fades and dies exactly as before (28px/s, alpha min(1, life * 3), only while the scene is live)', () => {
    expect(sceneSource).toContain('    if (this.bridge.active) {\n'
      + '      for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.life -= dt; }\n'
      + '      this.particles = this.particles.filter(p => p.life > 0);\n'
      + '      for (const label of this.labels) { label.life -= dt; label.y -= dt * 28; label.text.setPosition(label.text.x, label.y - this.model.cameraY).setAlpha(Math.min(1, label.life * 3)); if (label.life <= 0) label.text.destroy(); }\n'
      + '      this.labels = this.labels.filter(label => label.life > 0);');
    expect(sceneSource).toContain('    for (const label of this.labels) label.text.destroy();\n    this.labels = [];');
  });

  it('leaves the values the labels show where they were made: model, combo, enemies untouched', async () => {
    const SOURCES = import.meta.glob(['../src/systems/GameModel.ts', '../src/systems/ComboFeedback.ts', '../src/data/combo.ts', '../src/data/enemies.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]))).toEqual({
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'systems/ComboFeedback.ts': '1e2f0fb4f8a25e0aaed8a771e59a153fadfbea586d9d8949ced15b946a08a5fc',
      'data/combo.ts': '5f557d18b5115ac28dc763a5bf378940e1dde73b9fb950c237db4f56f1782c7c',
      'data/enemies.ts': '9f5b8c0f5bfbdfe5e6ec7bc589a55abad4ccf063bc7e72072777ec37415a88e1',
    });
    expect(SOURCES['../src/systems/GameModel.ts']).toContain('const points = Math.round(100 * this.multiplier * (stomp ? 1.5 : 1));');
  });
});

describe('floating text: style mapping', () => {
  const kinds: FloatingTextKind[] = ['system', 'warning', 'reward', 'impact'];

  it('draws Latin labels in Silkscreen on its 8px grid, with no synthesised bold', () => {
    expect(FLOATING_TEXT_FONT.split(',')[0]).toBe('Silkscreen');
    for (const kind of kinds) {
      const style = floatingTextStyle(kind, 'RELOADED');
      expect(style).toMatchObject({ fontFamily: FLOATING_TEXT_FONT, fontStyle: 'normal', color: FLOATING_TEXT_COLORS[kind], hard: true, padding: { x: 1, y: 1 } });
      expect(parseInt(style.fontSize) % 8).toBe(0);
    }
    expect(FLOATING_TEXT_SIZES).toEqual({ system: 8, warning: 8, reward: 16, impact: 16 });
  });

  it('maps the meanings: utility small and mint, warnings rose, rewards gold, impacts warm white; heat for combo tier 8+', () => {
    expect(FLOATING_TEXT_COLORS).toEqual({ system: '#a8d8c0', warning: '#e0949f', reward: '#d6b46a', impact: '#efe4cf', hot: '#f4d67a' });
    expect(floatingTextStyle('reward', '+300', true).color).toBe(FLOATING_TEXT_COLORS.hot);
    expect(floatingTextStyle('impact', 'BAM! +450', true).color).toBe(FLOATING_TEXT_COLORS.hot);
    expect(floatingTextStyle('impact', 'BAM! +150').fontSize).toBe('16px');
    expect(floatingTextStyle('system', 'RELOADED').fontSize).toBe('8px');
  });

  it('keeps the Japanese hints in their own family (Silkscreen has no CJK), bold, outlined, antialiased', () => {
    for (const hint of ['弾切れ / 足場へ', 'あと2発', '甲羅は踏めない', '踏めない・撃て']) {
      expect(usesPixelFont(hint)).toBe(false);
      expect(floatingTextStyle('warning', hint)).toMatchObject({ fontFamily: FLOATING_TEXT_CJK_FONT, fontSize: `${FLOATING_TEXT_CJK_SIZE}px`, fontStyle: 'bold', hard: false });
    }
    expect(FLOATING_TEXT_CJK_FONT).toBe('monospace');
    for (const latin of ['RELOADED', 'BAM! +150', '15 COMBO · +100 + CHARGE', 'LIFE UP! MAX HP +1', 'OMNOM 3/10', 'CRACK!']) expect(usesPixelFont(latin)).toBe(true);
  });

  it('relies on the Silkscreen face style.css already imports', () => {
    expect(styleSource).toContain('family=Silkscreen&');
    expect(FLOATING_TEXT_FONT_PROBE).toBe('8px Silkscreen');
  });
});

describe('floating text: pixel ink', () => {
  /** w x h RGBA with the given alphas, white. */
  const canvas = (w: number, h: number, alpha: Record<number, number>) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255; data[i * 4 + 3] = alpha[i] ?? 0; }
    return data;
  };
  const px = (d: Uint8ClampedArray, i: number) => Array.from(d.subarray(i * 4, i * 4 + 4));

  it('snaps glyph coverage to opaque fill and rings it with a 1px dark outline (8-neighbourhood)', () => {
    // 5x5, centre glyph pixel at 200/255 coverage, a faint 60/255 fringe right of it.
    const d = canvas(5, 5, { 12: 200, 13: 60 });
    inkFloatingText(d, 5, 5, '#d6b46a', FLOATING_TEXT_OUTLINE, true);
    expect(px(d, 12)).toEqual([0xd6, 0xb4, 0x6a, 255]);
    for (const i of [6, 7, 8, 11, 13, 16, 17, 18]) expect(px(d, i)).toEqual([0x0d, 0x0b, 0x0f, 255]);
    for (const i of [0, 4, 10, 14, 20, 24, 2, 22]) expect(px(d, i)[3]).toBe(0);
    // Only fill, outline or clear survives: no partial alpha anywhere.
    for (let i = 0; i < 25; i++) expect([0, 255]).toContain(px(d, i)[3]);
  });

  it('keeps antialiasing for the soft (CJK) path, laid over the same outline', () => {
    const d = canvas(5, 5, { 12: 255, 13: 100, 0: 40 });
    inkFloatingText(d, 5, 5, '#e0949f', FLOATING_TEXT_OUTLINE, false);
    expect(px(d, 12)).toEqual([0xe0, 0x94, 0x9f, 255]);
    // A soft edge next to a solid pixel blends into the outline; one far from any stays translucent fill.
    expect(px(d, 13)[3]).toBe(255);
    expect(px(d, 13)[0]).toBeGreaterThan(0x0d); expect(px(d, 13)[0]).toBeLessThan(0xe0);
    expect(px(d, 0)).toEqual([0xe0, 0x94, 0x9f, 40]);
    expect(px(d, 24)[3]).toBe(0);
  });
});

describe('floating text: cold font', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A Phaser-shaped stub: what addFloatingText touches of scene.add.text and the Text it returns. */
  const fakeScene = () => {
    const made: { style: Record<string, unknown>; update: ReturnType<typeof vi.fn>; inked: number }[] = [];
    const scene = { add: { text: (_x: number, _y: number, _v: string, style: Record<string, unknown>) => {
      const rec = { style, update: vi.fn(), inked: 0 };
      made.push(rec);
      return { scene: {}, canvas: { width: 1, height: 1 }, context: { getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => { rec.inked++; } }, renderer: undefined, frame: { source: {} }, style: { update: rec.update } };
    } } };
    return { scene: scene as never, made };
  };

  it('passes the style to Phaser without the ink flag, and inks once', () => {
    const { scene, made } = fakeScene();
    addFloatingText(scene, 10, 20, 'RELOADED', 'system');
    expect(made[0].style).toEqual({ fontFamily: FLOATING_TEXT_FONT, fontSize: '8px', fontStyle: 'normal', color: FLOATING_TEXT_COLORS.system, padding: { x: 1, y: 1 } });
    expect(made[0].inked).toBe(1);
  });

  it('redraws a label made before Silkscreen arrived, once it has', async () => {
    let arrive: () => void = () => {};
    const load = vi.fn(() => new Promise<void>(r => { arrive = r; }));
    vi.stubGlobal('document', { fonts: { check: () => false, load } });
    vi.resetModules();
    const fresh = await import('../src/render/floatingText');
    const { scene, made } = fakeScene();
    fresh.addFloatingText(scene, 0, 0, 'BAM! +150', 'impact');
    expect(load).toHaveBeenCalledWith(FLOATING_TEXT_FONT_PROBE, expect.any(String));
    expect(made[0].update).not.toHaveBeenCalled();
    arrive(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(made[0].update).toHaveBeenCalledWith(true);
    expect(made[0].inked).toBe(2);
    // A Japanese hint never waits on Silkscreen.
    fresh.addFloatingText(scene, 0, 0, '弾切れ / 足場へ', 'warning');
    arrive(); await Promise.resolve(); await Promise.resolve();
    expect(made[1].update).not.toHaveBeenCalled();
  });

  it('draws with the fallback and never throws where there is no font loading API', async () => {
    vi.stubGlobal('document', undefined);
    vi.resetModules();
    const fresh = await import('../src/render/floatingText');
    expect(fresh.loadFloatingTextFont()).toBeUndefined();
    const { scene, made } = fakeScene();
    expect(() => fresh.addFloatingText(scene, 0, 0, '+100', 'reward')).not.toThrow();
    expect(made[0].update).not.toHaveBeenCalled();
  });
});
