import { describe, expect, it, vi } from 'vitest';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import playerArtSource from '../src/render/PlayerArt.ts?raw';
import vfxSource from '../src/render/playerFeedbackVfx.ts?raw';
import { GameModel } from '../src/systems/GameModel';
import { CoinHighSystem } from '../src/systems/CoinHighSystem';
import {
  PLAYER_VFX, drawCoinHighChips, drawHurtImpact, drawInvulShimmer, invulPhaseOdd, playerTreatment, tintColor,
} from '../src/render/playerFeedbackVfx';

// PlayerArt imports Phaser for two enum values; nothing else of it runs here.
vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { NEAREST: 0 } }, Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }));
const { PlayerArt } = await import('../src/render/PlayerArt');

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: string) => { digest: (e: string) => string } } };
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The d712b67 PlayerArt line this replaces, kept here as the reference predicate. */
const legacyHidden = (hp: number, inv: number) => hp > 0 && inv > 0 && Math.floor(inv * 16) % 2 !== 0;

type Fill = { x: number; y: number; w: number; h: number; color: number };
/** A Graphics that only records what it was asked to fill. */
function recorder() {
  const fills: Fill[] = [];
  let color = -1;
  const g = {
    fillStyle(c: number, a: number) { expect(a).toBe(1); color = c; return g; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, color }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, fills };
}
const colored = (fills: Fill[]) => fills.filter(f => f.color !== PLAYER_VFX.key);

/** A stand-in Phaser Image that keeps the state PlayerArt sets on it. */
function fakeImage() {
  const image = {
    visible: false, alpha: 1, tint: null as number | null, x: 0, y: 0, scale: 1, flipX: false, texture: '', frame: 0,
    setOrigin() { return image; },
    setVisible(v: boolean) { image.visible = v; return image; },
    setAlpha(a: number) { image.alpha = a; return image; },
    setTint(t: number) { image.tint = t; return image; },
    clearTint() { image.tint = null; return image; },
    setTexture(t: string, f: number) { image.texture = t; image.frame = f; return image; },
    setPosition(x: number, y: number) { image.x = x; image.y = y; return image; },
    setScale(s: number) { image.scale = s; return image; },
    setFlipX(f: boolean) { image.flipX = f; return image; },
  };
  return image;
}
function playerArt() {
  const image = fakeImage();
  const frames = new Proxy({}, { get: () => ({ group: 'core', index: 0, anchor: { x: 24, y: 24 } }) });
  const scene = {
    add: { image: () => image },
    textures: { exists: () => true, get: () => ({ setFilter() {} }) },
    cache: { json: { get: () => ({ frames }) } },
    game: { loop: { time: 0 } },
    events: { once() {} },
  };
  (globalThis as { window?: object }).window ??= {};
  return { art: new PlayerArt(scene as unknown as Phaser.Scene, () => {}), image };
}
const STEP = 1 / 120;
const run = (candle = false) => { const g = new GameModel(false); if (candle) g.upgrades.grant('candle'); g.jumpToStage(1, 1); g.step(STEP, 0, false); g.events.splice(0); return g; };

describe('player feedback VFX: state mapping', () => {
  it('keeps the legacy blink phase exactly, at every boundary the audit listed', () => {
    for (const inv of [1, 0.999, 0.9375, 0.93749, 0.875, 0.0625, 0.00001, 0, 1.5, 1.49, 1.4375, -0.1]) {
      for (const hp of [4, 1, 0]) expect(invulPhaseOdd(hp, inv), `${hp}/${inv}`).toBe(legacyHidden(hp, inv));
    }
    // ...and on a dense sweep of the base and CANDLE windows.
    for (let i = 0; i <= 18000; i++) expect(invulPhaseOdd(3, i / 12000)).toBe(legacyHidden(3, i / 12000));
    expect([invulPhaseOdd(3, 1), invulPhaseOdd(3, 0.99999), invulPhaseOdd(3, 0.9375), invulPhaseOdd(3, 0.93749)]).toEqual([false, true, true, false]);
  });

  it('maps gameplay state to a body treatment: hurt tint first 50ms, pale odd phase, neutral otherwise', () => {
    const { hurt, invul } = PLAYER_VFX;
    expect(playerTreatment(3, 0, Infinity)).toEqual({ alpha: 1, tint: null });
    expect(playerTreatment(3, 0.99, Infinity)).toEqual({ alpha: invul.alpha, tint: invul.tint });
    expect(playerTreatment(3, 0.9, Infinity)).toEqual({ alpha: 1, tint: null });
    // HURT wins the first 50ms even on an odd phase, which is where the first hit frame always lands.
    expect(playerTreatment(3, 1 - STEP, 0)).toEqual({ alpha: 1, tint: hurt.tint });
    expect(playerTreatment(3, 0.99, 0.049)).toEqual({ alpha: 1, tint: hurt.tint });
    expect(playerTreatment(3, 0.99, 0.05)).toEqual({ alpha: invul.alpha, tint: invul.tint });
    // Dead: no tint, no alpha -- the approved death art is shown as it is.
    expect(playerTreatment(0, 0.99, 0)).toEqual({ alpha: 1, tint: null });
    expect([hurt.tint, invul.tint, invul.alpha, hurt.tintEnd, hurt.end]).toEqual([0xffd3c5, 0xd5e3d0, 0.68, 0.05, 0.1]);
  });

  it('multiplies a plain colour exactly as an image tint does, for the procedural fallback body', () => {
    expect(tintColor(0xc8f58b, null)).toBe(0xc8f58b);
    expect(tintColor(0xffffff, 0xd5e3d0)).toBe(0xd5e3d0);
    expect(tintColor(0x000000, 0xd5e3d0)).toBe(0);
    expect(tintColor(0x808080, 0xffd3c5)).toBe((0x80 << 16) | (Math.round(0x80 * 0xd3 / 255) << 8) | Math.round(0x80 * 0xc5 / 255));
  });
});

describe('player feedback VFX: HURT', () => {
  it('draws four separated elbows on dark keys, radius 22 then 25, and nothing at 100ms', () => {
    const at = (age: number) => { const r = recorder(); drawHurtImpact(r.g, 100, 200, age); return r.fills; };
    const near = at(0), far = at(0.05);
    expect(near).toHaveLength(16);
    expect(colored(near).filter(f => f.color === PLAYER_VFX.hurt.rose).map(f => [f.x - 100, f.y - 200, f.w, f.h])).toEqual([
      [-24, -18, 4, 2], [20, -18, 4, 2], [-24, 16, 4, 2], [20, 16, 4, 2],
    ]);
    expect(colored(near).filter(f => f.color === PLAYER_VFX.hurt.pale).map(f => [f.x - 100, f.y - 200, f.w, f.h])).toEqual([
      [-20, -15, 2, 4], [18, -15, 2, 4], [-20, 13, 2, 4], [18, 13, 2, 4],
    ]);
    expect(colored(far).filter(f => f.color === PLAYER_VFX.hurt.rose).map(f => [f.x - 100, f.y - 200])).toEqual([[-27, -21], [23, -21], [-27, 19], [23, 19]]);
    expect(at(0.0499)).toEqual(near);
    expect(at(0.0999)).toEqual(far);
    for (const age of [0.1, 0.2, Infinity, -0.01, NaN]) expect(at(age), String(age)).toEqual([]);
    // Integer pixels only, and every piece sits outside the body's own 32px-wide core.
    for (const f of [...near, ...far]) {
      expect([f.x, f.y, f.w, f.h].every(Number.isInteger)).toBe(true);
      expect(Math.min(Math.abs(f.x - 100), Math.abs(f.x + f.w - 1 - 100))).toBeGreaterThanOrEqual(17);
    }
  });

  it('is started by the accepted hurt event only, on the render clock, before the frame that shows it', () => {
    const effect = sceneSource.slice(sceneSource.indexOf('  private effect(event: GameEvent) {'), sceneSource.indexOf('  private label('));
    expect(effect.split('this.hurtAge = 0').length - 1).toBe(1);
    expect(effect).toContain("if (event.type === 'hurt') {\n      // The impact is the player's own (drawHurtImpact): no screen flash, no square burst, no tether.\n      this.shake = 4; this.hurtAge = 0;\n");
    // The source warning stays exactly where and what it was.
    expect(effect).toContain("if (event.source) this.label(event.source.x, event.source.y - 35, enemyType(event.source.kind).contactHint, 'warning');");
    const update = sceneSource.slice(sceneSource.indexOf('    const dt = Math.min(delta / 1000, 0.05);'), sceneSource.indexOf('  private dispatchEvents() {'));
    expect(update.indexOf('this.hurtAge += dt;')).toBeGreaterThan(-1);
    expect(update.indexOf('this.hurtAge += dt;')).toBeLessThan(update.indexOf('this.dispatchEvents();'));
    expect(sceneSource).toContain('this.flash = 0; this.shake = 0; this.hurtAge = Number.POSITIVE_INFINITY;');
    // Shake 4, decay 30/s, no hitstop on a hit -- unchanged. The shared flash is still combo's and the boss's.
    expect(sceneSource).toContain('this.flash = Math.max(0, this.flash - dt); this.shake = Math.max(0, this.shake - dt * 30);');
    expect(effect).toContain('this.flash = Math.max(this.flash, 0.08);');
    expect(effect).toContain('this.flash = 0.16;');
    expect(effect).not.toContain('0xfc6e8c');
    expect(sceneSource).not.toContain('damageSource');
    expect(sceneSource).not.toContain('strokeCircle(source.x');
  });
});

describe('player feedback VFX: INVUL', () => {
  it('draws two 2x5 side strokes that swap height with the phase, alive and protected only', () => {
    const at = (hp: number, inv: number) => { const r = recorder(); drawInvulShimmer(r.g, 100, 200, hp, inv); return r.fills; };
    const odd = colored(at(3, 0.99)).map(f => [f.x - 100, f.y - 200, f.w, f.h]), even = colored(at(3, 0.9)).map(f => [f.x - 100, f.y - 200, f.w, f.h]);
    expect(odd).toEqual([[-20, 0, 2, 5], [18, -3, 2, 5]]);
    expect(even).toEqual([[-20, -10, 2, 5], [18, 7, 2, 5]]);
    expect(at(3, 0.99)).toHaveLength(4);
    expect(at(0, 0.99)).toEqual([]);
    expect(at(3, 0)).toEqual([]);
  });

  it('never hides the alive player: same phase transitions, zero invisible frames, base 1s and CANDLE 1.5s', () => {
    for (const candle of [false, true]) {
      const g = run(candle);
      const { art, image } = playerArt();
      expect(g.damage(1)).toBe(true);
      expect(g.player.invincible).toBe(candle ? 1.5 : 1);
      let hidden = 0, legacyHiddenFrames = 0, frames = 0;
      while (g.player.invincible > 0) {
        g.step(STEP, 0, false);
        for (const e of g.events.splice(0)) art.event(e, g);
        art.render(g, 0, 0);
        frames++;
        if (!image.visible) hidden++;
        if (legacyHidden(g.hp, g.player.invincible)) legacyHiddenFrames++;
        // The pale frame is exactly the frame the old renderer hid.
        expect(image.alpha === PLAYER_VFX.invul.alpha, `${g.player.invincible}`).toBe(legacyHidden(g.hp, g.player.invincible));
      }
      expect(hidden).toBe(0);
      expect(legacyHiddenFrames).toBeGreaterThan(0);
      // 1s / 1.5s of 1/120 steps (plus the float remainder the countdown has always left on its last step).
      expect(Math.abs(frames - (candle ? 180 : 120))).toBeLessThanOrEqual(1);
      // Protection over: neutral again.
      art.render(g, 0, 0);
      expect([image.visible, image.alpha, image.tint]).toEqual([true, 1, null]);
    }
  });

  it('replaces the 40x50 frame and the 32x3 rail, and the fallback body no longer vanishes', () => {
    expect(sceneSource).not.toContain('strokeRoundedRect(x - 20, y - 25, 40, 50, 5)');
    expect(sceneSource).not.toContain('32 * p.invincible');
    expect(sceneSource).not.toContain('Math.floor(p.invincible * 16)');
    expect(playerArtSource).not.toContain('use && !blink');
    expect(playerArtSource).toContain('this.image.setVisible(use).setAlpha(treatment.alpha);');
    expect(sceneSource).toContain('const { alpha, tint } = playerTreatment(m.hp, p.invincible, this.hurtAge);');
  });
});

describe('player feedback VFX: COIN HIGH', () => {
  it('moves two opposite brass chips through six positions, one every 125ms of model time, below the head', () => {
    const at = (elapsed: number) => { const r = recorder(); drawCoinHighChips(r.g, 100, 200, elapsed); return r.fills; };
    const brass = (elapsed: number) => at(elapsed).filter(f => f.color === PLAYER_VFX.high.brass).map(f => [f.x - 100, f.y - 200]);
    expect(at(0)).toHaveLength(6);
    expect(brass(0)).toEqual([[19, 12], [-23, 12]]);
    expect(brass(0.124)).toEqual(brass(0));
    expect(brass(0.125)).not.toEqual(brass(0));
    expect(brass(0.75)).toEqual(brass(0));
    const seen = new Set<string>();
    for (let s = 0; s < 6; s++) {
      const [a, b] = brass(s * 0.125 + 0.01);
      seen.add(JSON.stringify(a));
      // Opposing phase: the pair is point-symmetric about (-2, 12).
      expect([a[0] + b[0], a[1] + b[1]]).toEqual([-4, 24]);
    }
    expect(seen.size).toBe(6);
    for (let t = 0; t < 1; t += 0.01) for (const f of at(t)) {
      expect([f.x, f.y].every(Number.isInteger)).toBe(true);
      expect(f.x - 100).toBeGreaterThanOrEqual(-24); expect(f.x + f.w - 100).toBeLessThanOrEqual(25);
      expect(f.y - 200).toBeGreaterThanOrEqual(4); expect(f.y + f.h - 200).toBeLessThanOrEqual(21);
    }
  });

  it('lives exactly as long as the active flag: no linger, no onset burst, label untouched', () => {
    expect(sceneSource).toContain('    if (high) drawCoinHighChips(this.graphics, x, y, m.elapsed);');
    expect(sceneSource).toContain('const high = m.coinHigh.active;');
    expect(sceneSource).not.toContain('strokeRoundedRect(x - 23, y - 28, 46, 56, 7)');
    expect(sceneSource).toContain("if (event.type === 'coinHigh' && event.value) this.label(event.x, event.y - 46, 'COIN HIGH', 'reward');");
    // The HIGH's own clock, as before: 6s from full, 12s under COIN SICK.
    for (const [sick, seconds] of [[1, 6], [2, 12]]) {
      const high = new CoinHighSystem();
      high.durationMultiplier = sick;
      expect(high.earn(100)).toBe(true);
      let t = 0;
      while (high.active) { high.tick(STEP); t += STEP; }
      expect(t).toBeCloseTo(seconds, 1);
      expect([high.damageMultiplier, high.rangeMultiplier]).toEqual([1, 1]);
    }
  });
});

describe('player feedback VFX: overlap, layers, restoration', () => {
  it('keeps the three motifs in their own zones: hurt and invul at the sides, HIGH low', () => {
    const r = recorder();
    drawInvulShimmer(r.g, 0, 0, 3, 0.99); drawCoinHighChips(r.g, 0, 0, 0); drawHurtImpact(r.g, 0, 0, 0);
    // Nothing covers the head and face (y < -10 at |x| <= 16), whatever is running.
    for (const f of r.fills) expect(f.y + f.h <= -10 && Math.abs(f.x) <= 16 && Math.abs(f.x + f.w) <= 16).toBe(false);
  });

  it('draws behind the body on the after-enemies layer, the impact over it, under particles, flash and scanlines', () => {
    const draw = sceneSource.slice(sceneSource.indexOf('    this.graphics = this.afterEnemies;\n    // BONES'), sceneSource.indexOf('    this.graphics = g;\n  }\n'));
    const i = (s: string) => { const k = draw.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    expect(i('drawInvulShimmer(this.graphics, x, y, m.hp, p.invincible);')).toBeLessThan(i('if (high) drawCoinHighChips('));
    expect(i('if (high) drawCoinHighChips(')).toBeLessThan(i("if (m.upgrades.has('laserSight')) {"));
    expect(i("if (m.upgrades.has('laserSight')) {")).toBeLessThan(i('const art = this.playerArt?.render('));
    expect(i('const art = this.playerArt?.render(')).toBeLessThan(i('drawHurtImpact(foreground, x, y, this.hurtAge);'));
    expect(i('drawHurtImpact(foreground, x, y, this.hurtAge);')).toBeLessThan(i('for (const particle of this.particles)'));
    expect(i('for (const particle of this.particles)')).toBeLessThan(i('if (this.flash > 0)'));
    // No new Graphics, texture or image for the PLAYER's feedback: the twelve layers of d712b67, plus
    // the one NIMUSHI's speech shell added after 61bcbd9 -- tests/bossDialogue.test.ts pins where it sits.
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    for (const banned of ['.add.', 'generateTexture', '.textures', '.load.', 'new Phaser', 'postFX', 'preFX', 'setBlendMode', 'Math.random']) expect(vfxSource).not.toContain(banned);
  });

  it('restores the image to neutral on reset, on death and after every treatment', () => {
    const g = run();
    const { art, image } = playerArt();
    g.damage(1);
    g.step(STEP, 0, false);
    for (const e of g.events.splice(0)) art.event(e, g);
    art.render(g, 0, 0, 0);
    expect([image.alpha, image.tint]).toEqual([1, PLAYER_VFX.hurt.tint]);
    art.render(g, 0, 0, 0.06);
    expect([image.alpha, image.tint]).toEqual([PLAYER_VFX.invul.alpha, PLAYER_VFX.invul.tint]);
    art.reset();
    expect([image.visible, image.alpha, image.tint]).toEqual([false, 1, null]);
    // A killing blow during the tint: the death frame is neutral.
    g.health.invincibilityRemaining = 0;
    while (g.hp > 0) { g.health.invincibilityRemaining = 0; g.damage(1); }
    art.render(g, 0, 0, 0);
    expect([image.alpha, image.tint]).toEqual([1, null]);
  });

  it('leaves a normal frame exactly as d712b67 drew it', () => {
    const g = run();
    const { art, image } = playerArt();
    art.render(g, 0, 0);
    expect([image.visible, image.alpha, image.tint]).toEqual([true, 1, null]);
    for (const f of [drawInvulShimmer, drawHurtImpact]) { const r = recorder(); f(r.g, 0, 0, 3 as never, 0 as never); expect(r.fills).toEqual([]); }
    const r = recorder(); drawHurtImpact(r.g, 0, 0, Infinity); expect(r.fills).toEqual([]);
  });
});

describe('player feedback VFX: gameplay and assets untouched', () => {
  it('changes no gameplay, animation, floating-text or player-asset source', async () => {
    const SOURCES = import.meta.glob(['../src/systems/HealthSystem.ts', '../src/systems/CoinHighSystem.ts', '../src/data/coinHigh.ts', '../src/systems/GameModel.ts', '../src/dev/playerAnimationState.ts', '../src/render/playerArtAssets.ts', '../src/render/floatingText.ts', '../src/systems/ComboFeedback.ts', '../src/systems/UpgradeSystem.ts', '../src/data/upgrades.ts', '../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]))).toEqual({
      'systems/HealthSystem.ts': '5ec6789c4129bd379a1bd1cba7a3f0d329e44e2388dd1ceb7d7e4fc15fd478fd',
      'systems/CoinHighSystem.ts': 'c450f07056e74bae63eef975bddf3452c4cf1883c480628fadead473703f4476',
      'data/coinHigh.ts': '0ce32008f92bac78eb3925602bd6539fd42af0615412616af034e35bbad7561b',
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'dev/playerAnimationState.ts': 'd06a0a7d54a008677799bb06a23560ea6b51d53b87129f946d5f9b02d57bb317',
      'render/playerArtAssets.ts': '4362d50dea9e34682156bb6e54abc997765c19c5d2acd51bb5b0a9a5d5b27eeb',
      'render/floatingText.ts': '86cc69beee9dcedce6d7f44029b342ec796e0daacc37c523913b50b3dcc1bdd1',
      'systems/ComboFeedback.ts': '1e2f0fb4f8a25e0aaed8a771e59a153fadfbea586d9d8949ced15b946a08a5fc',
      'systems/UpgradeSystem.ts': '1bd63f6652e12af2c232864d8c45026a500104d7bd01fe740f0e3ec617d843c3',
      'data/upgrades.ts': '60cb529a5fbb0de2455d5d49898cd221d8860bf9dce8f4173e88f198c79f373e',
      // Changed after d712b67 only by the RUN PANEL markup move (tests/runPanelUi.test.ts) and by
      // NIMUSHI's line moving into the scene, which leaves main.ts holding only the screen reader's
      // copy of it -- tests/bossDialogue.test.ts. Nothing the player's own feedback reads or drives.
      'main.ts': 'ab6f9da4e17a0b26e5d1cac8f1d48508eb7da57f778f7ea831d7c8f034ccc258',
    });
  });

  it('adds no PNG: the shipped image set is the d712b67 one', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    // The one image added since is the bodies' (after e948ece, tests/corpseArt.test.ts); none of this change's.
    expect(pngs.filter(p => p !== '../src/assets/world/corpse-common-v1.png')).toHaveLength(164);
    expect(pngs.some(p => /feedback|vfx|hurt|invul/i.test(p))).toBe(false);
  });

  it('damage, invul timing and repeated-hit protection are what the model always did', () => {
    const g = run();
    const hp = g.hp;
    expect(g.damage(1)).toBe(true);
    expect([g.hp, g.player.invincible]).toEqual([hp - 1, 1]);
    expect(g.events.filter(e => e.type === 'hurt')).toHaveLength(1);
    expect(g.damage(1)).toBe(false);
    for (let i = 0; i < 119; i++) g.step(STEP, 0, false);
    expect(g.damage(1)).toBe(false);
    while (g.player.invincible > 0) g.step(STEP, 0, false);
    expect(g.damage(1)).toBe(true);
    expect(g.hp).toBe(hp - 2);
  });
});
