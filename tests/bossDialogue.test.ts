import { describe, expect, it } from 'vitest';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import mainSource from '../src/main.ts?raw';
import dialogueSource from '../src/render/bossDialogue.ts?raw';
import { ABYSS_PHASES } from '../src/data/abyss';
import { FULL_SCREEN_TAPIOCA, NIMUSHI_LINES, TAPIOCA_CUP } from '../src/data/nimushi';
import { GameModel } from '../src/systems/GameModel';
import {
  BOSS_DIALOGUE, BOSS_DIALOGUE_CSS, BOSS_DIALOGUE_FONT, BOSS_DIALOGUE_WEIGHT,
  bossDialogueMetrics, bossDialogueShell,
} from '../src/render/bossDialogue';
import { STEP, atNimushi, fighting, inWindow, pin, round, seeded, shootEye, tick } from './nimushi';
import { entered, replaySignature } from './regressionSignature';

// Read as a file: Vitest hands a CSS import back empty, whatever the query. (No Node types here.)
const fs = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL, encoding: 'utf8') => string };
const styleSource = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/**
 * BOSS DIALOGUE VFX V1. NIMUSHI's three lines are drawn in the scene now instead of in a rounded
 * pink DOM panel over the whole canvas: same words, same conditions, same 3.2 seconds, same ACTION
 * skip, same place on the screen -- but in the arena's own palette and UNDER everything that can
 * hurt, so a bubble can no longer stand in front of a pearl, a tell or the player.
 *
 * Nothing in the fight moves: the CUP attack stays unreachable in every phase, the attack tables,
 * the projectiles, the HP and the clear flow are 61bcbd9's, and no PNG is added.
 */

/** The four viewports the audit measured, and what it measured on each (output/.../validation.json). */
const VIEWS = [
  { id: 'd1440', page: [1440, 1000], canvas: 448, font: 13.937777777777777, height: 50.7733 },
  { id: 'd1280', page: [1280, 680], canvas: 324.25, font: 13.690555555555555, height: 49.7183 },
  { id: 'm390', page: [390, 844], canvas: 388, font: 13.795555555555556, height: 50.0089 },
  { id: 'm360', page: [360, 640], canvas: 314.125, font: 13.96111111111111, height: 50.26 },
] as const;

/**
 * The shell as the scene builds it, for a line of `lines` lines.
 *
 * Phaser measures a rasterised line at the font's own ascent + descent and adds `lineSpacing`
 * between lines; the scene then pads that and pins the bottom edge. Worked out here so a geometry
 * test needs no canvas -- the real measurement differs by at most a pixel, which the CSS heights
 * below are allowed.
 */
function shellOf(canvasCssWidth: number, lines = 2) {
  const at = bossDialogueMetrics(canvasCssWidth);
  const glyphs = at.font * lines + at.lineSpacing * (lines - 1);
  const height = Math.ceil(glyphs + at.pad * 2);
  return { at, height, top: BOSS_DIALOGUE.bottom - height, rects: bossDialogueShell(at.left, BOSS_DIALOGUE.bottom - height, at.width, height) };
}

describe('NIMUSHI speaks exactly when and what it always did', () => {
  it('says the three lines, word for word, with the original line breaks', () => {
    expect(NIMUSHI_LINES.wake).toBe('もっと……\nもっとタピオカを……');
    expect(NIMUSHI_LINES.rage).toBe('みんなタピオカになればいいのに……');
    expect(NIMUSHI_LINES.dying).toBe('逃げてもムダだよ……\nぜーんぶ、タピオカにしてあげる……♡');
    expect(NIMUSHI_LINES.hold).toBe(3.2);
    // The renderer never touches the words: no translation, no shortening, no typewriter.
    for (const line of [NIMUSHI_LINES.wake, NIMUSHI_LINES.rage, NIMUSHI_LINES.dying]) {
      expect(dialogueSource).not.toContain(line);
      expect(sceneSource).not.toContain(line);
    }
    expect(sceneSource).toContain('this.speechText.setText(line.text);');
    for (const banned of ['substring', 'slice(0,', 'typewriter', 'setTimeout', 'setInterval', 'toUpperCase']) {
      expect(dialogueSource, banned).not.toContain(banned);
    }
  });

  it('shows a line only while the model holds one, and for exactly its own 3.2 seconds', () => {
    const game = atNimushi(111);
    expect(game.bossLine).toBeNull();
    shootEye(game, 1);
    expect(game.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    // The hold is the model's, to the step: 3.2s of simulation, quantised to 1/120.
    let held = 0;
    while (game.bossLine) { game.step(STEP, 0, false); held += STEP; }
    expect(held).toBeGreaterThanOrEqual(NIMUSHI_LINES.hold);
    expect(held).toBeLessThan(NIMUSHI_LINES.hold + STEP * 2);
  });

  it('is skipped by the ACTION edge, and by nothing else -- not by moving, not by a held button', () => {
    const game = atNimushi(112);
    shootEye(game, 1);
    expect(game.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    // Moving left and right does not dismiss it.
    for (let i = 0; i < 40; i++) game.step(STEP, i % 2 ? -1 : 1, false);
    expect(game.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    // The rising edge of ACTION does.
    game.step(STEP, 0, true);
    expect(game.bossLine).toBeNull();

    // A line raised while FIRE is ALREADY down is not eaten by that hold -- the dismissal is the
    // rising edge, never the held state -- and the next genuine press is what skips it. 61bcbd9's
    // behaviour exactly: this change reads the flag and never touches it.
    const held = atNimushi(113);
    held.step(STEP, 0, true);
    const eye = held.boss.eye;
    held.bullets.push(round(held.boss.x, eye.y + eye.height / 2, 1));
    held.step(STEP, 0, true);
    expect(held.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    for (let i = 0; i < 20; i++) held.step(STEP, 0, true);
    expect(held.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    held.step(STEP, 0, false);
    held.step(STEP, 0, true);
    expect(held.bossLine).toBeNull();
  });

  it('speaks at the wake, the rage and the dying, once each, at the phases it always did', () => {
    const game = fighting(111);
    const lines: string[] = [];
    const phases: number[] = [];
    for (let i = 0; i < 400 / STEP && !game.boss.defeated; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (inWindow(game) && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      for (const e of game.events) {
        if (e.type === 'bossLine') { lines.push(String(e.stage)); phases.push(game.boss.phaseId); }
      }
      game.events.length = 0;
      if (game.state !== 'boss') break;
    }
    expect(lines.filter(l => l === NIMUSHI_LINES.rage)).toHaveLength(1);
    expect(lines.filter(l => l === NIMUSHI_LINES.dying)).toHaveLength(1);
    // The rage line is a phase signal, not decoration: it still arrives in the fight's last quarter.
    expect(phases[lines.indexOf(NIMUSHI_LINES.rage)]).toBeGreaterThanOrEqual(3);
  });

  it('never leaks into STAGING: the approach is silent until the fight starts', () => {
    const game = new GameModel(false, seeded(21));
    game.jumpToBoss();
    expect(game.abyssStage).toBe('staging');
    // Played, not teleported: moving and shooting the seal open, exactly as a run does.
    let spokeInStaging = false, steps = 0;
    for (let i = 0; i < 60 / STEP && game.abyssStage === 'staging'; i++) {
      game.step(STEP, Math.sin(i / 90) > 0 ? 1 : -1, i % 30 === 0);
      if (game.state === 'shop') game.closeShop();
      if (game.bossLine) spokeInStaging = true;
      steps = i;
    }
    expect(steps).toBeGreaterThan(100);
    expect(spokeInStaging).toBe(false);
    // And a run that never reaches THE ABYSS has no line and no way to get one.
    const run = new GameModel(false, seeded(22));
    tick(run, 5, 0, false);
    expect(run.bossLine).toBeNull();
  });
});

describe('the shell sits where the panel sat, at the size the audit measured', () => {
  it('lands on about 14 CSS px and keeps the baseline bottom on every viewport', () => {
    expect(BOSS_DIALOGUE.bottom).toBe(Math.round(800 * 0.73));
    for (const view of VIEWS) {
      const { at, height, top } = shellOf(view.canvas);
      expect(at.font * at.scale, view.id).toBeCloseTo(view.font, 6);
      // The dying line's two lines, padded: the audit's CSS height, within the font metrics' own pixel.
      expect(Math.abs(height * at.scale - view.height), `${view.id} height ${height * at.scale}`).toBeLessThanOrEqual(1);
      // It grows upwards. The bottom edge never moves, so the gap to the touch controls is fixed.
      expect(top + height).toBe(BOSS_DIALOGUE.bottom);
      // Clear of the HUD above and the controls below, on the shortest viewport as on the tallest.
      expect(top).toBeGreaterThan(400);
    }
  });

  it('is the audit\'s geometry: min(340px, canvas - 32px) wide, centred, in whole logical pixels', () => {
    expect([BOSS_DIALOGUE_CSS.font, BOSS_DIALOGUE_CSS.lineHeight, BOSS_DIALOGUE_CSS.width, BOSS_DIALOGUE_CSS.margin]).toEqual([14, 1.5, 340, 32]);
    expect([BOSS_DIALOGUE_CSS.padY, BOSS_DIALOGUE_CSS.padX]).toEqual([8, 10]);
    for (const view of VIEWS) {
      const at = bossDialogueMetrics(view.canvas);
      // Rounded to whole logical pixels, so it lands within a CSS pixel of the CSS width it targets.
      expect(Math.abs(at.width * at.scale - Math.min(340, view.canvas - 32)), view.id).toBeLessThanOrEqual(1);
      expect(at.left).toBe(Math.round((450 - at.width) / 2));
      expect(at.left + at.width, view.id).toBeLessThanOrEqual(450);
      for (const v of [at.width, at.left, at.font, at.lineSpacing, at.pad, at.wrap]) expect(Number.isInteger(v)).toBe(true);
      // The dying line's longest line -- 18 original characters -- still fits on one line.
      expect(at.wrap, view.id).toBeGreaterThanOrEqual(18 * at.font);
    }
    // A canvas that has not been laid out yet draws at 1:1 rather than at infinity.
    expect(bossDialogueMetrics(0)).toMatchObject({ scale: 1, font: 14, width: 340, left: 55 });
  });

  it('draws six hard-edged rectangles in three opaque tones, and nothing else', () => {
    const { at, height, top, rects } = shellOf(388);
    expect(rects).toHaveLength(6);
    expect(new Set(rects.map(r => r[4]))).toEqual(new Set([BOSS_DIALOGUE.outer, BOSS_DIALOGUE.rim, BOSS_DIALOGUE.fill]));
    expect([BOSS_DIALOGUE.outer, BOSS_DIALOGUE.rim, BOSS_DIALOGUE.fill]).toEqual([0x2b1b23, 0x8d6667, 0x19131a]);
    expect(BOSS_DIALOGUE.ink).toBe('#efe4cf');
    for (const [x, y, w, h] of rects) expect([x, y, w, h].every(Number.isInteger), `${x},${y},${w},${h}`).toBe(true);
    // The body: a 2px outer ring stepped back at the corners, a 2px rim, then the slab.
    const body = rects.slice(0, 4);
    expect(body).toEqual([
      [at.left + 2, top, at.width - 4, height, BOSS_DIALOGUE.outer],
      [at.left, top + 2, at.width, height - 4, BOSS_DIALOGUE.outer],
      [at.left + 2, top + 2, at.width - 4, height - 4, BOSS_DIALOGUE.rim],
      [at.left + 4, top + 4, at.width - 8, height - 8, BOSS_DIALOGUE.fill],
    ]);
    // The tail: 8x4 at the top edge, centred on the screen, pointing back at the king above.
    const tail = rects.slice(4);
    expect(tail.map(r => [r[0], r[0] + r[2]])).toEqual([[221, 229], [223, 227]]);
    for (const [, y, , h] of tail) expect(y + h).toBeLessThanOrEqual(top + 4);
    expect(BOSS_DIALOGUE.centre).toBe(225);
    // Nothing fades, blurs, glows or moves: the shell is fills at alpha 1 and has no clock.
    expect(dialogueSource).toContain('g.fillStyle(color, 1).fillRect(x, y, w, h)');
    for (const banned of ['strokeRoundedRect', 'fillRoundedRect', 'setBlendMode', 'postFX', 'preFX', 'Math.sin', 'Math.cos', 'Math.random', 'elapsed', 'tweens', 'alpha:']) {
      expect(dialogueSource, banned).not.toContain(banned);
    }
  });

  it('keeps the Japanese as Japanese: Noto Sans JP, weight 500, antialiased, never a pixel font', () => {
    expect(BOSS_DIALOGUE_FONT).toBe("'Noto Sans JP', sans-serif");
    expect(BOSS_DIALOGUE_WEIGHT).toBe('500');
    expect(styleSource).toContain('Noto+Sans+JP:wght@400;500;600;700;800');
    // The pixel font is the floating labels' and stays theirs: a kana on an 8px grid is not readable.
    expect(dialogueSource).not.toContain('FLOATING_TEXT_FONT');
    expect(sceneSource).toContain('fontFamily: BOSS_DIALOGUE_FONT, fontStyle: BOSS_DIALOGUE_WEIGHT');
    expect(sceneSource).toContain('this.speechText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);');
  });
});

describe('the line is drawn under everything that can hurt', () => {
  it('is made once, between the deep\'s image and the world Graphics, and never given a depth', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.coinLayer = this.add.container(0, 0);'), sceneSource.indexOf('this.playerArt = new PlayerArt('));
    const order = [
      'this.underAbyss = this.add.graphics();', 'this.abyssArt =',
      'this.speechShell = this.add.graphics();', 'this.speechText = this.add.text(',
      'this.graphics = this.add.graphics();', 'this.bossArt = this.add.image(',
      'this.afterBoss = this.add.graphics();', 'this.enemyLayer =', 'this.afterEnemies =',
    ];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Creation order IS the draw order here, as everywhere else in the scene.
    expect(sceneSource).not.toMatch(/(speechShell|speechText)[^;\n]*setDepth/);
    // Exactly one of each, made in create() and reused for every line of the fight.
    expect(sceneSource.match(/this\.speechShell = /g)).toHaveLength(1);
    expect(sceneSource.match(/this\.speechText = /g)).toHaveLength(1);
    expect(sceneSource.match(/this\.add\.text\(/g)).toHaveLength(1);
  });

  it('is screen-space: never moved by the camera, the shake or the king', () => {
    const body = sceneSource.slice(sceneSource.indexOf('  private bossSpeech() {'), sceneSource.indexOf('  private boss(cam: number) {'));
    expect(body).toContain('this.speechShell.clear();');
    // The shell is cleared and refilled at a fixed origin; only the glyphs are ever positioned.
    expect(body).not.toContain('speechShell.setPosition');
    expect(body).not.toMatch(/cam|cameraY|cameraX|this\.shake|boss\.x|boss\.y/);
    expect(body).toContain('BOSS_DIALOGUE.bottom - height');
    expect(sceneSource).not.toMatch(/speech(Shell|Text)[^;\n]*setScrollFactor/);
  });

  it('reads the model and writes nothing back: no clock, no queue, no second copy of a line', () => {
    const body = sceneSource.slice(sceneSource.indexOf('  private bossSpeech() {'), sceneSource.indexOf('  private boss(cam: number) {'));
    expect(body).toContain('const line = this.model.bossLine;');
    for (const banned of ['this.model.bossLine =', 'bossLine.timer', 'setTimeout', 'setInterval', 'Date.now', 'this.model.step']) {
      expect(body, banned).not.toContain(banned);
    }
    // One raster per line, not one per frame: the key covers the words, the scale and the font.
    expect(body).toContain('if (key !== this.speechKey) {');
    expect(body).toContain('bossDialogueFontReady()');
  });

  it('leaves nothing frozen on the arena once the run ends', () => {
    // The model has always frozen a line's timer the moment a run stops stepping, and the DOM panel
    // went invisible with the HUD that the GAME OVER / GAME CLEAR card hides. The scene has to do
    // the same, or a line caught by a death inside its 3.2 seconds would sit there for good.
    const game = atNimushi(114);
    shootEye(game, 1);
    expect(game.bossLine?.text).toBe(NIMUSHI_LINES.wake);
    game.state = 'over';
    const held = game.bossLine?.timer ?? 0;
    for (let i = 0; i < 10 / STEP; i++) game.step(STEP, 0, false);
    // The model keeps it -- that is 61bcbd9's behaviour and this change does not touch it.
    expect(game.bossLine?.timer).toBe(held);
    const body = sceneSource.slice(sceneSource.indexOf('  private bossSpeech() {'), sceneSource.indexOf('  private boss(cam: number) {'));
    expect(body).toContain("if (!line || this.model.state !== 'boss') { this.speechText.setVisible(false); return; }");
  });

  it('leaves the DOM panel as the screen reader\'s copy only -- hidden, live, and off the cache', () => {
    expect(mainSource).toContain('<div id="boss-line" class="boss-line" hidden aria-live="polite"></div>');
    expect(styleSource).toContain('.boss-line{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none}');
    // That one line is the whole rule: no box, no border, no colour, no z-index over the canvas.
    expect(styleSource.match(/\.boss-line/g)).toHaveLength(1);
    for (const gone of ['rgba(255, 143, 168', '#ffd7e2']) expect(styleSource, gone).not.toContain(gone);
    // Updated BEFORE `if (key === lastHud) return;`: the numbers' cache key has no bossLine in it,
    // so leaving the line behind it announced a line late and kept announcing a dropped one.
    const hud = mainSource.slice(mainSource.indexOf('function updateHud(model: GameModel) {'));
    expect(hud.indexOf("const spoken = model.bossLine?.text ?? '';")).toBeLessThan(hud.indexOf('if (key === lastHud) return;'));
    expect(hud).toContain('line.hidden = !spoken;');
    // No visible duplicate, and nothing that could swallow a tap.
    expect(mainSource).not.toContain('line.textContent = model.bossLine.text');
  });
});

describe('the fight itself is 61bcbd9\'s, to the byte and to the frame', () => {
  it('leaves the CUP attack disabled in every phase, and adds no way to reach it', () => {
    expect(ABYSS_PHASES).toHaveLength(4);
    for (const phase of ABYSS_PHASES) expect([...phase.attacks], `phase ${phase.id}`).toEqual(['tripleShot', 'enemySummon']);
    expect(ABYSS_PHASES.some(p => p.attacks.some(a => a === 'cupSummon'))).toBe(false);
    expect(FULL_SCREEN_TAPIOCA.enabled).toBe(false);
    // Nothing this change touches knows the word, nor summons, draws or loads a cup.
    for (const source of [dialogueSource]) {
      for (const banned of ['cup', 'Cup', 'tapioca', 'Tapioca', 'beam', 'Beam']) expect(source, banned).not.toContain(banned);
    }
    expect(sceneSource.slice(sceneSource.indexOf('  private bossSpeech() {'), sceneSource.indexOf('  private boss(cam: number) {'))).not.toMatch(/cup|Cup/);
  });

  it('puts no cup in the air across a whole played-out fight', () => {
    const game = fighting(7);
    let cups = 0, beams = 0;
    for (let i = 0; i < 400 / STEP && !game.boss.defeated; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (inWindow(game) && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      cups = Math.max(cups, game.boss.cups.length);
      beams = Math.max(beams, game.boss.beams.length);
      if (game.state !== 'boss') break;
    }
    expect(game.boss.defeated).toBe(true);
    expect([cups, beams]).toEqual([0, 0]);
    // The legacy definition is untouched: this change neither revives it nor edits its numbers.
    expect([TAPIOCA_CUP.width, TAPIOCA_CUP.height]).toEqual([46, 64]);
  });

  it('plays THE ABYSS and NIMUSHI exactly as 61bcbd9 did (the replay goldens)', () => {
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });

  it('adds no PNG: the shipped image set is 61bcbd9\'s', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    expect(pngs).toHaveLength(164);
    expect(pngs.some(p => /dialogue|speech|bubble|line/i.test(p))).toBe(false);
    // The shell is drawn, the glyphs are rasterised from the live string: no atlas, no image, no file.
    for (const banned of ['.png', 'load.image', 'addCanvas', 'generateTexture', 'setDepth']) {
      expect(dialogueSource, banned).not.toContain(banned);
    }
  });
});
