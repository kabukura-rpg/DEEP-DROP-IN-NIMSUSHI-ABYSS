import Phaser from 'phaser';
import { GameModel, type GameEvent } from '../systems/GameModel';
import type { Enemy, Platform } from '../systems/StageGenerator';
import { WORLD, JUMP } from '../data/balance';
import { comboFeedback } from '../systems/ComboFeedback';
import { InputBuffer } from '../systems/InputBuffer';
import { enemyType } from '../data/enemies';
import { pickupType } from '../data/pickups';
import { gunModule } from '../data/gunModules';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES, LIMBO_HAZARD_RULES, SPIKE_PLATFORM_RULES } from '../data/structures';
import { SAFE_ZONE_RULES } from '../data/safeZone';
import { TAPIOCA_BARRIER } from '../data/nimushi';
import type { SideCave } from '../data/sideCave';
import type { AreaTheme } from '../data/areas';
import { hazardBounds, hazardType, type Hazard } from '../data/hazards';
import { TerrainWatch } from '../dev/TerrainWatch';
import { SPEED_PROFILES } from '../data/speedProfiles';
import { PlayerArt } from '../render/PlayerArt';
import { NIMUSHI_ART, nimushiArtBarrierOrbit, nimushiArtPlacement, nimushiArtShade } from '../render/NimushiArt';
import area1BackgroundUrl from '../../output/game-backgrounds-v1/area1.png?url';
import area2BackgroundUrl from '../../output/game-backgrounds-v1/area2.png?url';
import area3BackgroundUrl from '../../output/game-backgrounds-v1/area3.png?url';
import area4BackgroundUrl from '../../output/game-backgrounds-v1/area4.png?url';
import bossBackgroundUrl from '../../output/game-backgrounds-v1/boss.png?url';

const BACKGROUND_URLS = {
  1: area1BackgroundUrl, 2: area2BackgroundUrl, 3: area3BackgroundUrl,
  4: area4BackgroundUrl, boss: bossBackgroundUrl,
} as const;
// AREA4 sits lower than its neighbours: its drawn rock shelves read as ledges at full strength.
const BACKGROUND_ALPHA = { 1: 0.77, 2: 0.72, 3: 0.68, 4: 0.52, boss: 0.62 } as const;
export interface GameBridge {
  direction: number; firing: boolean; active: boolean;
  /**
   * `performance.now()` before which keyboard input is not the run's.
   *
   * A menu is confirmed with ENTER or SPACE, and the key that confirmed it is usually still down
   * when the overlay disappears -- the operating system's auto-repeat then fires another keydown
   * into a run that has just become live, and SPACE is the gunboots. Closing a menu holds the
   * keyboard off for a moment so the press that dismissed it cannot also be played.
   */
  suppressUntil: number;
  onFrame: (model: GameModel) => void;
  onEvent: (event: GameEvent, model: GameModel) => void;
}
/**
 * The keys the RUN takes from the page: SPACE must not scroll and the arrows must not pan. They are
 * given back whenever a menu is open -- see `captureKeys`.
 */
const CAPTURED_KEYS = ['SPACE', 'LEFT', 'RIGHT'];
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: number; size: number }
export class GameScene extends Phaser.Scene {
  model = new GameModel();
  private graphics!: Phaser.GameObjects.Graphics;
  private backgroundArt!: Phaser.GameObjects.Image;
  private backgroundId: keyof typeof BACKGROUND_URLS = 1;
  private playerArt?: PlayerArt;
  private artForeground?: Phaser.GameObjects.Graphics;
  /** NIMUSHI's image, and the layer everything drawn after the body goes on so it stays above it. */
  private bossArt?: Phaser.GameObjects.Image;
  private afterBoss?: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private particles: Particle[] = [];
  /**
   * DEVELOPMENT ONLY. Null in a production build, where the guarded call site is dropped too.
   * Reachable from the console as `__terrainWatch` -- play until the terrain misbehaves, then run
   * `__terrainWatch.dump()` and paste what it prints.
   */
  private terrainWatch = import.meta.env.DEV ? new TerrainWatch() : null;
  private accumulator = 0;
  private freeze = 0;
  private flash = 0;
  private shake = 0;
  private inputBuffer = new InputBuffer();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private damageSource?: GameEvent['source'];
  private damageTime = 0;
  private labels: { text: Phaser.GameObjects.Text; y: number; life: number }[] = [];
  constructor(private bridge: GameBridge) { super('Game'); }
  preload() {
    for (const [id, url] of Object.entries(BACKGROUND_URLS)) this.load.image(`background-${id}`, url);
    PlayerArt.preload(this);
    this.load.image('nimushi-art', NIMUSHI_ART.url);
  }
  create() {
    // Expose the recorder so a human who sees the terrain misbehave can dump the history at once.
    // DEV only; in a production build `terrainWatch` is null and this never runs.
    if (import.meta.env.DEV && this.terrainWatch) {
      (window as unknown as { __terrainWatch: unknown }).__terrainWatch = this.terrainWatch;
    }
    // DEV only: the live model, so `__speed`, `__bossTest` and a human at the console can all see
    // what the run is actually doing. A getter rather than a snapshot, because `startRun` replaces
    // the model and a captured reference would quietly go stale.
    if (import.meta.env.DEV) {
      Object.defineProperty(window, '__model', { configurable: true, get: () => this.model });
    }
    // DEV only: swap the SPEED PROFILE of the run in progress, so the shipped physics and the old
    // pre-fidelity ones can be felt back to back in a real AREA. `__speed('legacy')` / `('video')`.
    if (import.meta.env.DEV) {
      (window as unknown as { __speed: (id: 'legacy' | 'video') => string }).__speed = (id) => {
        const profile = SPEED_PROFILES[id];
        if (!profile) return `unknown profile -- try ${Object.keys(SPEED_PROFILES).join(' or ')}`;
        Object.assign(this.model.stats, {
          gravity: profile.gravity, maxFallSpeed: profile.maxFallSpeed, moveSpeed: profile.moveSpeed,
        });
        const jump = Math.round((JUMP.impulse * JUMP.impulse) / (2 * profile.gravity));
        return `${profile.label}: gravity ${profile.gravity}, fall ${profile.maxFallSpeed}, move ${profile.moveSpeed}`
          + ` | ground jump is now ${jump}px (JUMP.impulse ${JUMP.impulse} is unchanged;`
          + ` ${profile.jumpImpulseForSameArc} would restore the original arc)`;
      };
    }
    this.backgroundArt = this.add.image(225, 400, 'background-1').setAlpha(BACKGROUND_ALPHA[1]).setDepth(-1);
    this.graphics = this.add.graphics();
    // Ordering: world -> NIMUSHI's image -> everything drawn after its body -> the player's image ->
    // particles, damage flash and scanlines. Created in that order, so Phaser draws them in it.
    if (this.textures.exists('nimushi-art')) {
      this.textures.get('nimushi-art').setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.bossArt = this.add.image(0, 0, 'nimushi-art').setOrigin(0).setVisible(false);
    }
    this.afterBoss = this.add.graphics();
    this.playerArt = new PlayerArt(this, () => this.draw());
    this.artForeground = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D', space: 'SPACE' }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.applyCapture();
    this.input.keyboard!.on('keydown-SPACE', () => this.requestShot());
    for (const key of ['LEFT', 'A']) this.input.keyboard!.on(`keydown-${key}`, () => { if (this.acceptsKeys) this.inputBuffer.move(-1); });
    for (const key of ['RIGHT', 'D']) this.input.keyboard!.on(`keydown-${key}`, () => { if (this.acceptsKeys) this.inputBuffer.move(1); });
    this.draw();
  }
  startRun(practice = false) {
    this.playerArt?.reset();
    this.model = new GameModel(practice); this.accumulator = 0; this.particles = []; this.freeze = 0;
    for (const label of this.labels) label.text.destroy();
    this.labels = []; this.flash = 0; this.shake = 0; this.damageTime = 0; this.damageSource = undefined; this.inputBuffer.clear();
  }
  /**
   * Hand SPACE and the arrows back to the page while a menu is up, and take them again after.
   *
   * HUMAN APPROVED / LOCKED: capture ON during play, RELEASED while an overlay is open, ON again
   * once it closes. See src/ui/menuKeys.ts for the scheme this belongs to.
   *
   * Capturing a key means calling `preventDefault` on it for the whole document, which is right
   * during a run -- SPACE must fire the gunboots rather than scroll the page. It is wrong the
   * moment a menu opens: a focused `<button>` answers to SPACE by ITSELF, and a captured SPACE
   * never reaches it, so "press SPACE to confirm" silently did nothing on every overlay. The run
   * does not need the capture while it is not being played.
   */
  captureKeys(on: boolean) {
    this.wantCapture = on;
    this.applyCapture();
  }
  /**
   * Remembered rather than applied straight away, because the first overlay is put up before the
   * scene has booted: `create` asks for the state that was wanted by then instead of assuming the
   * run has the keys.
   */
  private wantCapture = true;
  private applyCapture() {
    const keyboard = this.input?.keyboard;
    if (!keyboard) return;
    if (this.wantCapture) keyboard.addCapture(CAPTURED_KEYS);
    else keyboard.removeCapture(CAPTURED_KEYS);
  }
  /** True when a key press belongs to the run rather than to a menu that just closed. */
  private get acceptsKeys() { return this.bridge.active && performance.now() >= this.bridge.suppressUntil; }
  requestShot() { if (this.acceptsKeys) this.inputBuffer.shoot(); }
  resetKeys() { this.input.keyboard?.resetKeys(); this.bridge.firing = false; this.bridge.direction = 0; this.inputBuffer.clear(); }
  update(_time: number, delta: number) {
    if (!this.graphics) return;
    const dt = Math.min(delta / 1000, 0.05);
    // Clear/death signals can arrive from a stage controller outside the simulation step.
    this.dispatchEvents();
    if (this.bridge.active && this.model.running) {
      const held = Math.max(-1, Math.min(1, this.bridge.direction + (this.keys.right.isDown || this.keys.d.isDown ? 1 : 0) - (this.keys.left.isDown || this.keys.a.isDown ? 1 : 0)));
      const direction = this.inputBuffer.resolveDirection(held);
      this.freeze = Math.max(0, this.freeze - dt);
      if (this.freeze > 0) this.model.moveHorizontal(dt, direction);
      if (this.freeze === 0) {
        this.accumulator += dt;
        while (this.accumulator >= 1 / 120 && this.bridge.active && this.model.running) {
          this.model.step(1 / 120, direction, this.bridge.firing || this.keys.space.isDown || this.inputBuffer.firing);
          this.accumulator -= 1 / 120;
          this.dispatchEvents();
          if (this.freeze > 0) { this.accumulator = 0; break; }
        }
      }
      this.inputBuffer.tick(dt);
      this.bridge.onFrame(this.model);
    }
    if (this.bridge.active) {
      for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.life -= dt; }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const label of this.labels) { label.life -= dt; label.y -= dt * 28; label.text.setPosition(label.text.x, label.y - this.model.cameraY).setAlpha(Math.min(1, label.life * 3)); if (label.life <= 0) label.text.destroy(); }
      this.labels = this.labels.filter(label => label.life > 0);
      this.damageTime = Math.max(0, this.damageTime - dt);
    }
    this.flash = Math.max(0, this.flash - dt); this.shake = Math.max(0, this.shake - dt * 30);
    this.draw();
  }
  private dispatchEvents() {
    for (const event of this.model.events.splice(0)) {
      this.playerArt?.event(event, this.model);
      if (event.type === 'shot' || event.type === 'empty' || event.type === 'jump' || event.type === 'wallJump') this.inputBuffer.consumeShot();
      this.effect(event); this.bridge.onEvent(event, this.model);
    }
  }
  private effect(event: GameEvent) {
    if (event.type === 'shot') { this.shake = Math.max(this.shake, 1.2); this.burst(event.x, event.y, 0xf6ffc2, 5); }
    if (event.type === 'land') { this.burst(event.x, event.y, 0xb9ef70, 9); this.label(event.x, event.y - 20, 'RELOADED', '#b9ef70', 12); }
    if (event.type === 'heal') this.label(event.x, event.y - 48, event.lifeUps ? `LIFE UP! MAX HP +${event.lifeUps}` : event.value ? `HP +${event.value}` : `LIFE +${event.overflow}`, '#b9ef70', 13);
    if (event.type === 'empty') this.label(event.x, event.y - 30, '弾切れ / 足場へ', '#f99bae', 11);
    if (event.type === 'crack') { this.burst(event.x, event.y, 0xe8d48a, 7); if (event.value) this.label(event.x, event.y - 22, 'CRACK!', '#e8d48a', 11); }
    if (event.type === 'collapse') { this.shake = Math.max(this.shake, 2.4); this.burst(event.x, event.y, 0x8f7ac4, 16); }
    // A block that held: say how many more rounds THIS one needs, so durability is never a guess.
    if (event.type === 'blockCrack') { this.shake = Math.max(this.shake, 1.4); this.burst(event.x, event.y, 0xffc27a, 8); this.label(event.x, event.y - 24, `あと${event.value}発`, '#ffc27a', 12); }
    if (event.type === 'blockBreak') { this.shake = Math.max(this.shake, 2.8); this.burst(event.x, event.y, 0xffd2a0, 22); this.label(event.x, event.y - 24, 'OPEN!', '#ffd2a0', 15); }
    // A ground jump: a small puff, no screen shake, nothing that reads as a shot.
    if (event.type === 'jump') this.burst(event.x, event.y + 15, 0xb9ef70, 6);
    // A wall kick: the puff comes off the wall itself, so the push reads even at a glance.
    if (event.type === 'wallJump') { this.shake = Math.max(this.shake, 1.2); this.burst(event.x, event.y, 0xdff7a8, 10); }
    // Bouncing off scenery: the same RELOADED note a landing gets, because that is what it is.
    if (event.type === 'doodad') { this.burst(event.x, event.y, 0xb9ef70, 10); this.label(event.x, event.y - 20, 'RELOADED', '#b9ef70', 12); }
    if (event.type === 'coinVein') { this.burst(event.x, event.y, 0xffd479, 20); this.label(event.x, event.y - 24, `COIN +${event.value}`, '#ffd479', 14); }
    if (event.type === 'timeVoid' && event.value) this.label(event.x, event.y - 54, 'TIME VOID', '#9fe8f5', 15);
    if (event.type === 'coinHigh' && event.value) { this.burst(event.x, event.y, 0xffe9a8, 26); this.label(event.x, event.y - 46, 'COIN HIGH', '#ffe9a8', 17); }
    if (event.type === 'explosion') this.burst(event.x, event.y, 0xffb066, 22);
    if (event.type === 'balloon') this.burst(event.x, event.y, 0xf497ab, 24);
    if (event.type === 'corpse') this.label(event.x, event.y - 20, `OMNOM ${event.value}/10`, '#d8c8d4', 12);
    // The chain being banked. It never opens a screen, so the shaft itself has to carry it.
    if (event.type === 'comboSettle') { this.flash = Math.max(this.flash, 0.08); this.burst(event.x, event.y, 0xf4e9ad, 24); this.label(event.x, event.y - 62, `${event.value} COMBO · ${event.stage ?? ''}`, '#f4e9ad', 16); }
    // A round the TAPIOCA BARRIER stopped reads differently from one that landed: a spray of brown
    // pearl chips and a white glint, no shake -- "blocked", at the point it was blocked.
    if (event.type === 'bossHit' && (event.value ?? 0) < 0) { this.burst(event.x, event.y, 0x5a3b2a, 5); this.burst(event.x, event.y, 0xfff4e0, 2); }
    else if (event.type === 'bossHit') { this.burst(event.x, event.y, 0xd9a0ff, 6); this.shake = Math.max(this.shake, 1.4); }
    if (event.type === 'bossFire') this.shake = Math.max(this.shake, 2.2);
    if (event.type === 'bossDown') { this.shake = 6; this.flash = 0.16; this.burst(event.x, event.y, 0xffd2a0, 40); this.label(event.x, event.y - 40, 'BOSS DEFEATED', '#ffd2a0', 18); }
    if (event.type === 'kill') {
      const feedback = comboFeedback(event.combo || 0);
      this.shake = Math.max(this.shake, Math.min(6, (event.stomp ? 3.2 : 1.8) + feedback.shake));
      this.freeze = Math.max(this.freeze, event.stomp ? 0.042 : 0.025);
      this.burst(event.x, event.y, feedback.tier >= 8 ? 0xf4e9ad : 0xf99bae, (event.stomp ? 20 : 12) + feedback.particles);
      this.label(event.x, event.y, event.stomp ? `BAM! +${event.value}` : `+${event.value}`, feedback.tier >= 8 ? '#f4e9ad' : '#f9acbf', event.stomp ? 20 : 15);
    }
    if (event.type === 'hurt') {
      this.flash = 0.1; this.shake = 4; this.burst(event.x, event.y, 0xfc6e8c, 12);
      this.damageSource = event.source; this.damageTime = 0.3;
      if (event.source) this.label(event.source.x, event.source.y - 35, enemyType(event.source.kind).contactHint, '#ffc4cf', 12);
    }
  }
  private label(x: number, y: number, value: string, color: string, fontSize: number) {
    const text = this.add.text(x, y - this.model.cameraY, value, { fontFamily: 'monospace', fontSize, color, fontStyle: 'bold' }).setOrigin(0.5).setDepth(3);
    this.labels.push({ text, y, life: 0.85 });
  }
  private burst(x: number, y: number, color: number, count: number) {
    for (let i = 0; i < count && this.particles.length < 140; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5) * 190, vy: (Math.random() - 0.5) * 180, life: 0.18 + Math.random() * 0.22, color, size: 2 + Math.random() * 3 });
  }
  /**
   * GHOST. A sheet with a ragged hem and two hollow eyes, drawn see-through: the one enemy that goes
   * through stone should look like it could. Waiting in the wall it is only a faint face in the
   * brickwork -- visible if you look, easy to miss if you are falling -- and it only takes its full
   * shape once it has woken and left the wall.
   */
  private ghost(e: Enemy, x: number, y: number, hurt: boolean) {
    const t = this.model.elapsed;
    if (e.ai?.state === 'dormant') {
      // Brighter than v1, where it was all but invisible: a face pressed into the stone, pulsing.
      const glow = 0.45 + Math.sin(t * 2 + e.phase) * 0.15;
      this.rect(x - 7, y - 6, 5, 5, 0xdfe8ff, glow); this.rect(x + 2, y - 6, 5, 5, 0xdfe8ff, glow);
      this.rect(x - 4, y + 2, 8, 3, 0xdfe8ff, glow * 0.7);
      return;
    }
    // WAKING: for its first half second it tears out of the wall in a burst, so the moment it comes
    // for the player is the moment the player sees it.
    if (e.ai?.kind === 'ghost' && e.ai.t < 0.5) {
      const k = e.ai.t / 0.5;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r = 10 + k * 26;
        this.rect(x + Math.cos(a) * r - 2, y + Math.sin(a) * r - 2, 4, 4, 0xdfe8ff, 0.8 * (1 - k));
      }
    }
    const colour = hurt ? 0xffffff : 0xdfe8ff, alpha = hurt ? 0.9 : 0.62;
    const sway = Math.sin(t * 3 + e.phase) * 2;
    this.rect(x - 9 + sway, y - 16, 18, 4, colour, alpha);
    this.rect(x - 12 + sway, y - 12, 24, 18, colour, alpha);
    // A ragged hem that ripples, so it reads as cloth drifting rather than a body standing.
    for (let i = 0; i < 4; i++) this.rect(x - 12 + i * 6 + sway, y + 6, 5, 4 + Math.round((Math.sin(t * 8 + i * 1.7) + 1) * 2), colour, alpha * 0.85);
    this.rect(x - 7 + sway, y - 7, 5, 7, 0x1a1624, 0.95); this.rect(x + 2 + sway, y - 7, 5, 7, 0x1a1624, 0.95);
    this.rect(x - 2 + sway, y + 1, 4, 3, 0x1a1624, 0.8);
    // A trail it leaves behind while it hunts.
    for (let i = 1; i <= 3; i++) this.rect(x - 3 + sway, y - 16 - i * 7, 6, 4, colour, alpha * (0.3 - i * 0.07));
  }
  /**
   * FLYING SKULL. Bone white, jaw and sockets. At rest it bobs; when it notices the player the sockets
   * light red and it shakes -- the warning -- and while it lunges it leaves streaks, so a charge is
   * obvious even at the edge of the screen.
   */
  private skull(e: Enemy, x: number, y: number, hurt: boolean) {
    // A FLYING SKULL now runs the original's rule (dwellers.ts): calm until shot, then red and hunting.
    const angry = e.ai?.kind === 'wander' && e.ai.state === 'angry';
    const state = e.ai?.kind === 'skull' ? e.ai.state : angry ? 'charge' : 'idle';
    const shake = state === 'warn' ? Math.round(Math.sin(this.model.elapsed * 60) * 2) : 0;
    const bone = hurt ? 0xffffff : state === 'cool' || state === 'return' ? 0xbdb3a2 : 0xefe6d2;
    const cx = x + shake;
    if (angry) this.rect(cx - 13, y - 17, 26, 29, 0xff4a4a, 0.35);
    if (state === 'charge' && e.ai?.kind === 'skull') {
      const len = Math.hypot(e.ai.vx, e.ai.vy) || 1, ux = e.ai.vx / len, uy = e.ai.vy / len;
      for (let i = 1; i <= 3; i++) this.rect(cx - ux * i * 9 - 5, y - uy * i * 9 - 5, 10, 10, 0xefe6d2, 0.35 - i * 0.09);
    }
    this.rect(cx - 11, y - 12, 22, 16, bone);
    this.rect(cx - 9, y - 15, 18, 4, bone);
    this.rect(cx - 7, y + 4, 14, 6, bone);
    const eye = state === 'warn' || state === 'charge' ? 0xff4a4a : 0x241c24;
    this.rect(cx - 8, y - 7, 6, 6, eye); this.rect(cx + 2, y - 7, 6, 6, eye);
    this.rect(cx - 1, y + 1, 2, 3, 0x241c24);
    for (let i = 0; i < 3; i++) this.rect(cx - 5 + i * 4, y + 6, 2, 4, 0x241c24);
  }
  private rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) { this.graphics.fillStyle(color, alpha).fillRect(Math.round(x), Math.round(y), w, h); }
  private draw() {
    const g = this.graphics, m = this.model, cam = m.cameraY;
    // The whole scene slides with the camera's horizontal offset, which is zero everywhere except
    // inside a SIDE CAVE. One setPosition rather than an offset threaded through every draw call:
    // the cave is the only thing that ever leaves the shaft, and the shaft is drawn in world x.
    const backgroundId = m.inBossArena ? 'boss' : m.stage.config.id;
    if (backgroundId !== this.backgroundId) {
      this.backgroundId = backgroundId;
      this.backgroundArt.setTexture(`background-${backgroundId}`).setAlpha(BACKGROUND_ALPHA[backgroundId]);
    }
    g.clear(); g.setPosition((this.shake && !this.reducedMotion ? (Math.random() - 0.5) * this.shake : 0) - m.cameraX, 0);
    this.bossArt?.setVisible(false);
    this.afterBoss?.clear().setPosition(g.x, g.y);
    const theme = m.stage.config.theme;
    // Wide enough to still cover the view when it has slid sideways into a cave.
    // Keep the authored distance layer subdued so collision surfaces and attack tells stay foremost.
    this.rect(m.cameraX - 8, 0, 466 + Math.abs(m.cameraX) * 2, 800, 0x10191c, 0.16);
    this.surface(theme, cam);
    this.submerged(theme, cam);
    this.volcanic(theme, cam);
    this.collapsed(theme, cam);
    // The brickwork, extended outward far enough to back whatever the camera can see: in a cave the
    // view is outside the shaft, and the rock a cave is cut from has to be there behind it.
    const reach = Math.ceil(Math.abs(m.cameraX)) + 40;
    this.rect(-reach, 0, 28 + reach, 800, theme.wall); this.rect(422, 0, 28 + reach, 800, theme.wall);
    this.sideCaves(m, cam, theme);
    this.rect(27, 0, 2, 800, theme.wallEdge); this.rect(421, 0, 2, 800, theme.wallEdge);
    for (let i = 0; i < 19; i++) {
      const y = i * 48 - (cam % 48);
      for (const x of [0, 423]) { this.rect(x, y, 27, 2, theme.brick); this.rect(x + (i % 2 ? 8 : 19), y, 2, 48, theme.brick, 0.75); }
    }
    for (let i = 0; i < 7; i++) {
      const y = ((i * 157 - cam * 0.65) % 1099 + 1099) % 1099 - 40;
      this.rect(i % 2 ? 19 : 425, y, 5, 17, theme.accent, 0.6);
      this.rect(i % 2 ? 11 : 422, y - 10, 18, 38, theme.accent, 0.025);
    }
    for (let i = 0; i < 30; i++) { const x = 40 + (i * 97) % 370, y = ((i * 137 - cam * 0.4) % 850 + 850) % 850; this.rect(x, y, 2, 2, theme.dust, theme.water ? 0.3 : 0.17); }
    if (theme.water) for (let i = 0; i < 14; i++) {
      // Motes drifting upward read as water without covering the play area.
      const x = 26 + (i * 131) % 398, y = ((i * 97 - this.model.elapsed * 26 - cam * 0.5) % 860 + 860) % 860;
      this.rect(x, y, 2, 3, theme.water.light, 0.22);
    }
    // SAFE ZONE chambers, drawn before the platforms so their own floor slab sits on top.
    //
    // A chamber has to read as a HOLE at a glance, from the middle of the shaft, at falling speed.
    // It used to be a slightly darker rectangle laid against an unbroken wall, which read as
    // decoration. Three things fix that without a single UI marker:
    //
    //   the recess is carried THROUGH the wall strip, so the wall's own silhouette is interrupted
    //   a lintel and a sill jut out past the mouth, so the opening has a frame that is not flat
    //   light spills out of the mouth into the shaft, so it registers before it is looked at
    for (const zone of m.safeZones) {
      const zy = zone.y - cam;
      if (zy > 900 || zy + zone.height < -90) continue;
      const left = zone.side === -1;
      // The cut runs from the outside of the shaft wall to the mouth.
      const cutX = left ? 0 : zone.x, cutW = zone.width + 28;
      const mouthX = left ? zone.x + zone.width : zone.x;
      this.rect(cutX, zy, cutW, zone.height, 0x070d11, 0.98);
      // A back wall, lit, so the recess has depth rather than being a flat hole.
      this.rect(left ? 0 : cutX + cutW - 10, zy + 3, 10, zone.height - 3, 0x15303a, 0.9);
      for (let i = 0; i < 4; i++) this.rect(zone.x + 10 + i * (zone.width - 20) / 4, zy + 8, 2, zone.height - 16, 0x9fe8f5, 0.06);
      // The frame: a lintel above and a sill below, both reaching past the mouth into the shaft.
      const frameX = left ? cutX : cutX - 22, frameW = cutW + 22;
      this.rect(frameX, zy - 8, frameW, 8, 0x3c7a84);
      this.rect(frameX, zy - 8, frameW, 2, 0x9fe8f5, 0.7);
      this.rect(frameX, zy + zone.height, frameW, 7, 0x3c7a84);
      this.rect(frameX, zy + zone.height, frameW, 2, 0x9fe8f5, 0.5);
      // The jambs: short marks at the mouth, top and bottom, pointing into the shaft. Together with
      // the frame they make a bracket shape that is not a ledge and not an enemy.
      for (const dy of [0, zone.height - 10]) this.rect(left ? mouthX : mouthX - 22, zy + dy + 1, 22, 9, 0x3c7a84, 0.85);
      // Light out of the mouth, fading into the shaft. This is what a falling player sees first,
      // from the middle of the shaft, without looking at it.
      for (let i = 0; i < 8; i++) {
        const w = 8 + i * 6;
        this.rect(left ? mouthX : mouthX - w, zy + 8 + i * 2, w, zone.height - 16 - i * 4, 0x9fe8f5, 0.085 - i * 0.010);
      }
      this.rect(left ? mouthX - 3 : mouthX, zy + 3, 3, zone.height - 6, 0x9fe8f5, 0.5);
      this.rect(zone.x + 8, zy + zone.height - 3, zone.width - 16, 3, 0x9fe8f5, 0.22);
      // A COIN VEIN is the one content the chamber draws itself; a module and a doorway are their
      // own objects and are drawn by the code that already owns them.
      if (zone.content?.kind === 'coinVein' && !zone.taken) {
        const v = m.coinVeinBounds(zone), vy = v.y - cam;
        this.rect(v.x, vy, v.width, v.height, 0x3a2f14, 0.95);
        this.graphics.lineStyle(2, 0xffd479, 0.9).strokeRect(v.x, vy, v.width, v.height);
        for (let i = 0; i < 5; i++) this.rect(v.x + 6 + (i % 3) * 9, vy + 6 + Math.floor(i / 3) * 13, 6, 6, 0xffd479, 0.85);
      }
    }
    // DOODADS: small fixtures on the shaft wall, unmistakably not enemies and not ledges.
    for (const d of m.doodads) {
      const dy = d.y - cam;
      if (dy < -30 || dy > 830) continue;
      const glow = 0.5 + Math.abs(Math.sin(this.model.elapsed * 1.8 + d.x)) * 0.25;
      this.rect(d.x, dy, d.width, d.height, 0x4a4232);
      this.rect(d.x, dy, d.width, 3, 0xd8c88a);
      if (d.variant === 'lamp') {
        this.rect(d.x + d.width / 2 - 5, dy - 9, 10, 9, 0x6b5f45);
        this.rect(d.x + d.width / 2 - 3, dy - 6, 6, 5, 0xffe9a8, glow);
        this.rect(d.x - 4, dy + 3, d.width + 8, 5, 0xffe9a8, 0.1 * glow);
      } else {
        for (let i = 4; i < d.width - 3; i += 10) this.rect(d.x + i, dy + 4, 5, d.height - 6, 0x2b271d);
      }
    }
    // DEVELOPMENT ONLY: record what this frame is about to draw, so the "blocks sometimes all
    // change" report has evidence the next time it happens. The guard is a compile-time constant,
    // so the watcher and this block are dropped entirely from a production build.
    if (import.meta.env.DEV && this.terrainWatch) {
      this.terrainWatch.observe(
        m.platforms.filter(f => f.y - cam >= -20 && f.y - cam <= 820),
        cam, m.stage.label, m.elapsed,
      );
    }
    for (const f of m.platforms) {
      const y = f.y - cam;
      if (y < -20 || y > 820) continue;
      if (f.breakBlock) { this.breakBlock(f.x, y, f.width, f.breakBlock.hits, f.breakBlock.durability, f.breakBlock.reward); continue; }
      if (f.limboHazard) { this.limboHazard(f.x, y, f.width); continue; }
      const cracking = f.state === 'cracking', critical = f.state === 'critical';
      // Shape carries the warning: a doomed ledge loses its top rail and splits into shards.
      const top = critical ? 0xf0a0b4 : cracking ? 0xe8d48a : f.breakable ? 0x9ad6c0 : 0xb9ef70;
      const shake = critical && !this.reducedMotion ? Math.round(Math.sin(this.model.elapsed * 34) * 1.5) : 0;
      this.rect(f.x + shake, y + 4, f.width, critical ? 7 : cracking ? 10 : 12, 0x344441);
      if (critical) {
        // Broken into pieces with gaps between them.
        for (let i = 0; i < f.width; i += 15) this.rect(f.x + i + shake + (i % 30 ? 2 : -2), y + (i % 30 ? 1 : 3), 11, 4, top);
      } else if (cracking) {
        for (let i = 0; i < f.width; i += 22) this.rect(f.x + i, y, 18, 4, top);
        for (let i = 12; i < f.width; i += 22) this.graphics.fillStyle(0x1b2420).fillTriangle(f.x + i, y, f.x + i + 5, y + 11, f.x + i - 3, y + 11);
      } else {
        this.rect(f.x, y, f.width, 4, top);
        this.rect(f.x, y - 3, f.width, 3, top, 0.08);
      }
      if (f.breakable && !cracking && !critical) {
        // A ledge that will go: dashed rail, so it reads differently before it is ever touched.
        for (let i = 6; i < f.width - 6; i += 16) this.rect(f.x + i, y - 3, 8, 2, top, 0.55);
      }
      for (let x = f.x + 5; x < f.x + f.width - 4; x += 14) this.rect(x + shake, y + 7, 6, critical ? 2 : 3, 0x718266);
      if (!critical) { this.rect(f.x + 8, y + 16, 6, 5, 0x253331); this.rect(f.x + f.width - 14, y + 16, 6, 5, 0x253331); }
      if (f.spikePlatform) this.spikePlatform(f.x, y, f.width, f.spikePlatform);
      if (f.conveyor) this.conveyor(f.x, y, f.width, f.conveyor);
    }
    for (const hazard of m.hazards) this.hazard(hazard, cam);
    for (const item of m.pickups) {
      if (item.taken) continue;
      const type = pickupType(item.kind), y = item.y - cam;
      if (y < -30 || y > 830) continue;
      const bob = Math.sin(this.model.elapsed * 2.2 + item.phase) * 3;
      const x = Math.round(item.x);
      if (type.silhouette === 'module') {
        const label = item.module ? gunModule(item.module).short : '';
        this.rect(x - 17, y + bob - 13, 34, 26, 0x2a2438, 0.95);
        this.rect(x - 17, y + bob - 13, 34, 26, type.color, 0.22);
        this.graphics.lineStyle(2, type.color, 0.95).strokeRect(x - 17, y + bob - 13, 34, 26);
        // A pip in the corner says which bonus rides along: a heart or a charge.
        this.rect(x + 10, y + bob - 16, 6, 6, item.bonus === 'charge' ? 0x9fe8f5 : 0xff8fa8, 0.95);
        this.label2(x, y + bob, label);
        continue;
      }
      if (type.silhouette === 'heart' || type.silhouette === 'tomato') {
        const big = type.silhouette === 'tomato';
        const r = big ? 15 : 11;
        this.graphics.fillStyle(type.color, 0.95).fillCircle(x - r * 0.45, y + bob - r * 0.2, r * 0.7);
        this.graphics.fillStyle(type.color, 0.95).fillCircle(x + r * 0.45, y + bob - r * 0.2, r * 0.7);
        this.graphics.fillStyle(type.color, 0.95).fillTriangle(x - r, y + bob, x + r, y + bob, x, y + bob + r * 1.2);
        if (big) { this.rect(x - 3, y + bob - r - 6, 6, 8, 0x6fbf5f); this.rect(x - 10, y + bob - r - 3, 20, 4, 0x6fbf5f); }
        else this.rect(x - r * 0.5, y + bob - r * 0.5, 4, 4, 0xffffff, 0.85);
        continue;
      }
      if (type.silhouette === 'shard') {
        this.graphics.fillStyle(type.color, 0.95).fillTriangle(x, y + bob - 15, x - 10, y + bob + 4, x + 10, y + bob + 4);
        this.graphics.fillStyle(0xe8fbff, 0.95).fillTriangle(x, y + bob - 8, x - 5, y + bob + 3, x + 5, y + bob + 3);
        this.rect(x - 12, y + bob + 5, 24, 3, type.color, 0.7);
        this.rect(x - 14, y + bob - 4, 4, 4, type.color, 0.5); this.rect(x + 11, y + bob - 9, 3, 3, type.color, 0.45);
      } else {
        this.graphics.lineStyle(2, type.color, 0.9).strokeCircle(x, y + bob, type.radius - 4);
        this.rect(x - 4, y + bob - 7, 4, 4, 0xffffff, 0.8);
        this.rect(x - 9, y + bob + 9, 4, 4, type.color, 0.5); this.rect(x + 7, y + bob - 12, 3, 3, type.color, 0.45);
      }
    }
    // The way out: a gate standing on the floor that ends the shaft.
    if (m.exit) {
      const e = m.exit, ey = e.y - cam;
      if (ey > -120 && ey < 860) {
        const pulse = 0.5 + Math.abs(Math.sin(this.model.elapsed * 2.4)) * 0.3;
        this.rect(e.x - 6, ey - 6, e.width + 12, e.height + 12, 0x7de8b0, 0.12 * pulse);
        this.rect(e.x, ey, e.width, e.height, 0x0e1a16, 0.96);
        this.graphics.lineStyle(3, 0x7de8b0, 0.95).strokeRect(e.x, ey, e.width, e.height);
        for (let i = 0; i < 5; i++) this.rect(e.x + 10, ey + 12 + i * 12, e.width - 20, 3, 0x7de8b0, 0.16 + i * 0.07);
        this.label2(e.x + e.width / 2, ey + e.height / 2, 'EXIT');
      }
    }
    // The shop doorway, when this SECTION happens to have one.
    this.timeVoid(m, cam);
    // Every doorway this SECTION has: the chamber's, where an AREA still cuts chambers, and one
    // for EACH shop cave -- a SECTION can hold more than one, and each is its own door.
    const doors = [
      ...(m.shop.entrance ? [m.shop.entrance] : []),
      ...m.caves.filter(c => c.content?.kind === 'shop' && !c.taken).map(c => m.shopDoor(c)),
    ];
    for (const door of doors) {
      const dy = door.y - cam;
      if (dy > -120 && dy < 860) {
        this.rect(door.x, dy, door.width, door.height, 0x1e1830, 0.95);
        this.graphics.lineStyle(3, 0xffd479, 0.9).strokeRect(door.x, dy, door.width, door.height);
        this.rect(door.x + 8, dy + 10, door.width - 16, 4, 0xffd479, 0.5);
        this.label2(door.x + door.width / 2, dy + door.height / 2 + 4, 'SHOP');
      }
    }
    // AREA 2 air containers. Sealed they read as cargo; broken they burst and fade.
    for (const box of m.containers) {
      const by = box.y - cam;
      if (by < -60 || by > 850) continue;
      if (box.broken) {
        const t = box.debris / AIR_CONTAINER_RULES.debrisTime;
        for (let i = 0; i < 6; i++) this.rect(box.x + (i % 3) * 12 - 6 + (1 - t) * (i - 3) * 6, by + Math.floor(i / 3) * 14 - (1 - t) * 10, 7, 7, 0x9fe8f5, 0.5 * t);
        continue;
      }
      this.rect(box.x, by, box.width, box.height, 0x17323a, 0.95);
      this.graphics.lineStyle(2, 0x70d8ef, 0.95).strokeRect(box.x, by, box.width, box.height);
      this.rect(box.x + 5, by + 5, box.width - 10, 5, 0x9fe8f5, 0.55);
      this.graphics.lineStyle(2, 0x9fe8f5, 0.5).strokeCircle(box.x + box.width / 2, by + box.height / 2 + 3, 7);
    }
    // Released bubbles, climbing away. They blink as their life runs out.
    for (const bubble of m.bubbles) {
      const by = bubble.y - cam;
      if (by < -40 || by > 850) continue;
      const fade = bubble.life < 1 ? 0.35 + Math.abs(Math.sin(this.model.elapsed * 18)) * 0.5 : 0.92;
      this.graphics.lineStyle(2, 0x9fe8f5, fade).strokeCircle(bubble.x, by, 9);
      this.rect(bubble.x - 4, by - 5, 3, 3, 0xffffff, fade * 0.8);
    }
    // Loose coins.
    for (const coin of m.coins.coins) {
      const cy = coin.y - cam;
      if (cy < -40 || cy > 850) continue;
      const fade = m.coins.expiring(coin) ? 0.3 + Math.abs(Math.sin(this.model.elapsed * 16)) * 0.6 : 1;
      const spin = Math.abs(Math.cos(this.model.elapsed * 5 + coin.id));
      // A LARGE COIN is drawn half again as big and with a bright rim, so which one is worth
      // chasing is a read at a glance rather than something only the wallet finds out about.
      const large = coin.denomination === 'large';
      const half = large ? 9 : 6, tall = large ? 21 : 14;
      if (large) this.rect(coin.x - 2 - (half + 2) * spin, cy - tall / 2 - 2, 4 + (half + 2) * 2 * spin, tall + 4, 0x8a6520, fade * 0.7);
      this.rect(coin.x - 1 - half * spin, cy - tall / 2, 2 + half * 2 * spin, tall, 0xffd479, fade);
      this.rect(coin.x - 1 - (half / 2) * spin, cy - tall / 4, 1 + half * spin, tall / 2, 0xfff0c0, fade * 0.9);
    }
    // TIMEOUT: stopped time left behind where a hit landed. Drawn under everything so the world it
    // is holding still reads normally through it.
    for (const bubble of m.timeoutBubbles) {
      const by = bubble.y - cam;
      if (by < -bubble.radius || by > 820 + bubble.radius) continue;
      const pulse = 0.1 + Math.abs(Math.sin(this.model.elapsed * 1.4 + bubble.id)) * 0.06;
      this.graphics.fillStyle(0x9fe8f5, pulse).fillCircle(bubble.x, by, bubble.radius);
      this.graphics.lineStyle(2, 0x9fe8f5, 0.5).strokeCircle(bubble.x, by, bubble.radius);
    }
    // Bodies. Inert scenery -- what they are worth is KNIFE AND FORK's and REST IN PIECES' business.
    for (const corpse of m.corpses) {
      const cy = corpse.y - cam;
      if (cy < -20 || cy > 820) continue;
      const fade = corpse.life < 2 ? 0.3 + Math.abs(Math.sin(this.model.elapsed * 14)) * 0.5 : 0.9;
      this.rect(corpse.x - 10, cy - 4, 20, 8, 0x6b5f6a, fade);
      this.rect(corpse.x - 7, cy - 7, 14, 4, 0x9b8a99, fade);
      this.rect(corpse.x - 3, cy - 9, 6, 3, 0xd8c8d4, fade * 0.8);
    }
    this.boss(cam);
    for (const enemy of m.enemies) if (enemy.alive) this.enemy(enemy, cam);
    // BONES: a short spinning shaft with a knob at each end.
    for (const bone of m.bones) {
      const a = m.elapsed * 14 + bone.id, bx = bone.x, by = bone.y - cam, dx = Math.cos(a) * 8, dy = Math.sin(a) * 8;
      this.graphics.lineStyle(4, 0xefe6d2, 1).lineBetween(bx - dx, by - dy, bx + dx, by + dy);
      this.rect(bx - dx - 3, by - dy - 3, 6, 6, 0xefe6d2); this.rect(bx + dx - 3, by + dy - 3, 6, 6, 0xefe6d2);
    }
    const p0 = m.player;
    // Under a COIN HIGH the rounds themselves change: hotter, wider and with a longer tail, which
    // is the same thing the numbers did. The shape of each weapon is untouched -- a PUNCHER still
    // fires three parallel rounds -- so a boosted gun is recognisably the gun the player picked up.
    const high = m.coinHigh.active;
    const core = high ? 0xffe9a8 : 0xeaffaf, trail = high ? 0xffd479 : 0xb9ef70;
    for (const b of m.bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / speed, uy = b.vy / speed;
      // A beam reads as one long streak; an ordinary round gets a short tail behind its heading.
      const steps = b.beam ? 10 : high ? 6 : 3, stride = b.beam ? 18 : 8;
      for (let i = steps; i >= 1; i--) {
        this.rect(b.x - b.size - ux * stride * i, b.y - cam - 5 - uy * stride * i, b.size * 2, 10, trail, 0.08 + (steps - i) / steps * 0.14);
      }
      const swell = high ? 1.6 : 1;
      this.rect(b.x - (b.size * swell) / 2, b.y - cam - 7, b.size * swell, b.beam ? 18 : 12, core);
    }
    // HEART BALLOON, above the player's head, holding the fall back until something pops it.
    if (m.balloon?.alive) {
      const by = m.balloon.y - cam;
      this.graphics.lineStyle(1, 0xfba4b9, 0.5).lineBetween(m.balloon.x, by + 12, p0.x, p0.y - cam - 18);
      this.graphics.fillStyle(0xf497ab, 0.92).fillCircle(m.balloon.x, by, 13);
      this.graphics.fillStyle(0xffd2dd, 0.9).fillCircle(m.balloon.x - 4, by - 4, 4);
    }
    // DRONE: a companion, never a target, that fires when the player does.
    if (m.upgrades.has('drone')) {
      const spot = m.dronePosition, dy = spot.y - cam;
      const bob = Math.sin(this.model.elapsed * 5) * 2;
      this.rect(spot.x - 9, dy + bob, 18, 6, 0x8fb8d8);
      this.rect(spot.x - 5, dy + bob + 6, 10, 3, 0x4a6b85);
      this.rect(spot.x - 2, dy + bob - 3, 4, 3, 0xdff0ff);
    }
    const p = m.player, x = Math.round(p.x), y = Math.round(p.y - cam);
    // A halo while the HIGH runs, so the state is visible on the player and not only on the HUD.
    if (high) {
      const beat = 0.35 + Math.abs(Math.sin(this.model.elapsed * 7)) * 0.3;
      g.lineStyle(2, 0xffe9a8, beat).strokeRoundedRect(x - 23, y - 28, 46, 56, 7);
    }
    if (m.upgrades.has('laserSight')) {
      // Down the line the next round would take, so a weapon that leans with the input leans too.
      const tilt = m.gun.module.horizontalAimFactor * Math.max(-1, Math.min(1, this.bridge.direction));
      const reach = m.gun.module.range * m.shotBoost.range;
      this.graphics.lineStyle(1, 0xff6b7a, 0.45)
        .lineBetween(x, y + 16, x + Math.sin(tilt) * reach, y + 16 + Math.cos(tilt) * reach);
    }
    if (p.invincible > 0) {
      g.lineStyle(1.5, 0xfba4b9, 0.55).strokeRoundedRect(x - 20, y - 25, 40, 50, 5);
      this.rect(x - 16, y - 30, 32, 3, 0x563744);
      this.rect(x - 16, y - 30, 32 * p.invincible, 3, 0xffb5c7);
    }
    if (m.jetpackActive) {
      const flare = 0.5 + Math.abs(Math.sin(this.model.elapsed * 22)) * 0.5;
      for (let i = 0; i < 3; i++) this.rect(x - 6 + i * 5, y + 18 + i, 4, 8 + i * 3, i === 1 ? 0xffe6ae : 0xffa85c, flare);
    }
    const art = this.playerArt?.render(m, g.x, Math.max(-1, Math.min(1, this.bridge.direction + (this.keys?.right.isDown || this.keys?.d.isDown ? 1 : 0) - (this.keys?.left.isDown || this.keys?.a.isDown ? 1 : 0))));
    if (!art && !(p.invincible > 0 && Math.floor(p.invincible * 16) % 2)) {
      this.rect(x - 19, y - 21, 38, 43, 0xb9ef70, 0.035);
      this.rect(x - 13, y - 14, 26, 21, 0xc8f58b); this.rect(x - 9, y - 19, 18, 5, 0xc8f58b);
      this.rect(x - 10, y - 10, 20, 10, 0x243632); this.rect(x - 7, y - 8, 5, 4, 0xf2ffdb); this.rect(x + 3, y - 8, 5, 4, 0xf2ffdb);
      this.rect(x - 8, y + 7, 6, 8, 0x88af63); this.rect(x + 3, y + 7, 6, 8, 0x88af63); this.rect(x - 3, y + 3, 6, 17, 0xe9eedc);
      this.rect(x - 17, y, 5, 9, 0x85ac65); this.rect(x + 12, y, 5, 9, 0x85ac65);
    }
    // In production this is still the original single Graphics object.
    const foreground = this.artForeground ?? g;
    if (foreground !== g) { foreground.clear().setPosition(g.x, g.y); this.graphics = foreground; }
    for (const particle of this.particles) this.rect(particle.x, particle.y - cam, particle.size, particle.size, particle.color, Math.min(1, particle.life * 4));
    if (this.damageTime > 0 && this.damageSource) {
      const source = m.enemies.find(e => e.id === this.damageSource!.id) || this.damageSource;
      foreground.lineStyle(2, 0xffb2c6, this.damageTime / 0.3).strokeCircle(source.x, source.y - cam, 29 + (0.3 - this.damageTime) * 30);
      foreground.lineStyle(1, 0xffb2c6, this.damageTime / 0.6).lineBetween(x, y, source.x, source.y - cam);
    }
    this.heatHaze(cam);
    if (this.flash > 0) this.rect(0, 0, 450, 800, 0xfa5277, this.flash);
    // Subtle scanlines keep the whole world at the same visual texture.
    for (let y = 0; y < WORLD.height; y += 4) this.rect(0, y, 450, 1, 0x050b0d, 0.13);
    this.graphics = g;
  }
  /** Sky, horizon and grass above the AREA 1 entrance; other areas simply omit the colours. */
  private surface(theme: { sky?: number; horizon?: number; grass?: number }, cam: number) {
    if (theme.sky === undefined) return;
    const ground = 196 - cam;
    if (ground < -60) return;
    this.rect(-8, 0, 466, Math.min(800, ground + 60), theme.sky);
    this.rect(-8, Math.max(0, ground - 74), 466, 40, theme.horizon!, 0.35);
    for (let i = 0; i < 9; i++) this.rect(24 + i * 48, ground - 46 - (i % 3) * 14, 26, 46 + (i % 3) * 14, theme.horizon!, 0.5);
    this.rect(-8, ground, 466, 14, theme.grass!);
    this.rect(-8, ground + 12, 466, 48, 0x3c4a30);
    for (let i = 0; i < 40; i++) this.rect(-4 + i * 12, ground - 5 + (i % 3), 2, 6, theme.grass!);
  }
  /** Tint, surface light and weed for a submerged area. Areas without water skip it entirely. */
  private submerged(theme: { water?: { tint: number; light: number; weed: number } }, cam: number) {
    if (!theme.water) return;
    this.rect(-8, 0, 466, 800, theme.water.tint, 0.3);
    for (let i = 0; i < 4; i++) {
      const x = 52 + i * 104 + Math.sin(this.model.elapsed * 0.3 + i) * 10;
      this.rect(x, 0, 30, 800, theme.water.light, 0.035);
    }
    for (let i = 0; i < 10; i++) {
      const y = ((i * 163 - cam * 0.9) % 1630 + 1630) % 1630 - 60;
      for (const [x, dir] of [[30, 1], [416, -1]] as const) {
        for (let k = 0; k < 4; k++) this.rect(x + dir * (2 + Math.round(Math.sin(this.model.elapsed * 1.1 + i + k * 0.7) * 3)), y + k * 11, 3, 11, theme.water.weed, 0.5);
      }
    }
  }
  private label2(x: number, y: number, text: string) {
    this.graphics.fillStyle(0x9fe8f5, 0.85);
    // Tiny block lettering keeps the pocket readable without a text object per frame.
    const glyphs: Record<string, number[]> = { A: [0b010, 0b101, 0b111, 0b101, 0b101], I: [0b111, 0b010, 0b010, 0b010, 0b111], R: [0b110, 0b101, 0b110, 0b101, 0b101] };
    const left = x - (text.length * 9) / 2;
    text.split('').forEach((ch, index) => {
      const rows = glyphs[ch]; if (!rows) return;
      rows.forEach((bits, row) => { for (let col = 0; col < 3; col++) if (bits & (1 << (2 - col))) this.graphics.fillRect(Math.round(left + index * 9 + col * 2), Math.round(y - 5 + row * 2), 2, 2); });
    });
  }
  private volcanic(theme: { ember?: { glow: number; ash: number } }, cam: number) {
    if (!theme.ember) return;
    for (let i = 0; i < 16; i++) {
      const x = 30 + (i * 149) % 390, y = ((i * 113 - this.model.elapsed * 34 - cam * 0.55) % 880 + 880) % 880;
      this.rect(x, y, 2, 2 + (i % 2), theme.ember.ash, 0.4);
    }
    for (const side of [0, 422]) this.rect(side, 0, 28, 800, theme.ember.glow, 0.05);
  }
  /**
   * Heat warning kept to the frame edges. Even at the top of the gauge the shaft, the platforms and
   * the enemies stay fully readable; only the border pulses.
   */
  private heatHaze(cam: number) {
    const heat = this.model.heat;
    if (!heat.enabled || heat.ratio < 0.5) return;
    const intensity = (heat.ratio - 0.5) / 0.5;
    const pulse = heat.stage === 'overheat' ? 0.55 + Math.sin(this.model.elapsed * 9) * 0.2 : 0.3 + Math.sin(this.model.elapsed * 4) * 0.12;
    const alpha = Math.min(0.3, intensity * pulse);
    for (let i = 0; i < 22; i++) {
      const fade = alpha * (1 - i / 22);
      this.rect(0, i * 2, 450, 2, 0xff6a2a, fade);
      this.rect(0, 798 - i * 2, 450, 2, 0xff6a2a, fade);
      this.rect(i * 2, 0, 2, 800, 0xff6a2a, fade * 0.8);
      this.rect(448 - i * 2, 0, 2, 800, 0xff6a2a, fade * 0.8);
    }
    if (this.reducedMotion) return;
    for (let i = 0; i < 12; i++) {
      const x = 24 + (i * 173) % 402, y = ((i * 131 - this.model.elapsed * 90 - cam * 0.4) % 820 + 820) % 820;
      this.rect(x, y, 2, 3, 0xffb066, alpha * 2.2);
    }
  }
  /**
   * One BREAK BLOCK. The row reads as masonry rather than as a ledge -- separate stones with a
   * visible seam between them, so it is obvious that they come apart one at a time and that a
   * single gap is a way through. Every round taken opens another fracture across that one stone,
   * so its remaining durability is readable without looking at the HUD. Deliberately nothing like
   * an AREA 4 collapsing ledge, which keeps its rail and shakes.
   */
  private breakBlock(x: number, y: number, width: number, hits: number, durability: number, reward = false) {
    const wear = Math.min(1, hits / Math.max(1, durability));
    const thickness = BREAK_BLOCK_RULES.thickness;
    // A REWARD BLOCK is a different stone, not the same stone with a badge: darker rock shot through
    // with a gold seam, and a coin sitting in the middle of it. Three separate cues -- body colour,
    // the seam, and the coin shape -- so it is still obvious in a small window or without colour.
    const body = reward ? 0x6a4f20 : 0x5d4a3a;
    const cap = reward ? 0xffd479 : hits ? 0xffb066 : 0xc8a882;
    // The seam: one pixel of shadow either side so neighbours never read as one long slab.
    this.rect(x, y, width, thickness, 0x241b14);
    this.rect(x + 1, y, width - 2, thickness, body);
    this.rect(x + 1, y, width - 2, 4, cap);
    this.rect(x + 1, y + thickness - 3, width - 2, 3, reward ? 0x4a3517 : 0x3a2c22);
    // A rivet at each end marks the stone as built rather than grown.
    this.rect(x + 5, y + 6, 4, 4, 0x2b211a);
    this.rect(x + width - 9, y + 6, 4, 4, 0x2b211a);
    // Fractures: one more opens for every round this stone has taken. Drawn on both kinds, so a
    // reward block still shows how close it is to giving way.
    for (let i = 0; i < hits; i++) {
      const at = x + ((i + 1) * width) / (durability + 1);
      this.graphics.fillStyle(0x1b1410, 0.9).fillTriangle(at, y, at + 6, y + thickness, at - 5, y + thickness);
    }
    const cx = x + width / 2;
    if (reward) {
      // Gold running through the rock, and the coin it is worth, over the top of the fractures.
      const glint = 0.66 + Math.abs(Math.sin(this.model.elapsed * 2.4 + x)) * 0.34;
      this.rect(x + 8, y + thickness - 6, width - 16, 2, 0xffe9a8, glint * 0.8);
      this.rect(cx - 5, y + 5, 10, 8, 0x2b211a);
      this.rect(cx - 4, y + 6, 8, 6, 0xffd479, glint);
      this.rect(cx - 1, y + 7, 2, 4, 0x8a6520, glint);
      return;
    }
    // A downward chevron rather than a word: label2 only carries the glyphs A, I and R, so any
    // caption here would have drawn nothing at all, and an arrow says the same in every language.
    const top = y + 4;
    this.graphics.fillStyle(0xffd2a0, 0.8 - wear * 0.45);
    this.graphics.fillTriangle(cx - 6, top, cx + 6, top, cx, top + 7);
  }
  /**
   * LIMBO's dangerous ground.
   *
   * Drawn as barbs with nothing under them -- no rail, no slab, no surface -- because it is not a
   * floor and must never read as one. A CATACOMBS spike platform has a solid top the player lands
   * on and spikes that come and go; this has neither. What is on screen is what it is: a row of
   * points the fall goes through.
   */
  private limboHazard(x: number, y: number, width: number) {
    const reach = LIMBO_HAZARD_RULES.reach;
    // The barbs, up and down: nothing about it offers a side to stand on.
    for (let i = x + 4; i < x + width - 6; i += 13) {
      const cx = i + 4;
      this.graphics.fillStyle(0xb49ae0, 0.95).fillTriangle(cx - 5, y + 2, cx + 5, y + 2, cx, y + 2 - reach);
      this.graphics.fillStyle(0xe8dcff, 0.9).fillTriangle(cx - 1.8, y + 2, cx + 1.8, y + 2, cx, y + 2 - reach);
      this.graphics.fillStyle(0x6a5a92, 0.7).fillTriangle(cx - 4, y + 2, cx + 4, y + 2, cx, y + 2 + reach * 0.5);
    }
    // A thin seam of void rather than a surface, so there is visibly nothing to touch down on.
    this.rect(x, y + 1, width, 2, 0x2d2740, 0.85);
    const glow = 0.25 + Math.abs(Math.sin(this.model.elapsed * 2.6 + x)) * 0.2;
    this.rect(x, y - 1, width, 1, 0xc0a7ed, glow);
  }
  /**
   * A SPIKE PLATFORM, through its cycle.
   *
   * Shape carries the state, never colour alone: sockets in the surface while it is safe, teeth
   * growing out of them through the warning, full teeth while it is live. The warning is the whole
   * fairness of the mechanic, so it is the loudest of the three -- the spikes visibly rise, and a
   * bar drains across the ledge so how long is left is readable without counting frames.
   */
  /**
   * CATACOMB CONVEYOR: a belt band along the ledge's face with chevrons running the way it carries,
   * at the speed it carries, and a solid arrowhead at the end it carries toward -- readable at a
   * glance as "this pushes me to the wall". Paint only; the push is GameModel.beltPush.
   */
  private conveyor(x: number, y: number, width: number, belt: NonNullable<Platform['conveyor']>) {
    const band = 0x1d3a44, mark = 0x7fd6e8;
    this.rect(x, y + 7, width, 7, band, 0.95);
    this.rect(x, y + 7, width, 1, mark, 0.45);
    const spacing = 14;
    const shift = this.reducedMotion ? 0 : ((this.model.elapsed * belt.speed) % spacing + spacing) % spacing;
    const g = this.graphics.fillStyle(mark, 0.85);
    for (let i = -spacing; i < width + spacing; i += spacing) {
      const cx = belt.dir === 1 ? x + i + shift : x + width - i - shift;
      if (cx < x + 4 || cx > x + width - 4) continue;
      // A chevron pointing along the belt.
      g.fillTriangle(cx + belt.dir * 4, y + 10.5, cx - belt.dir * 2, y + 7.5, cx - belt.dir * 2, y + 13.5);
    }
    // The end it carries toward: a bold arrowhead, so the direction reads even with the belt still.
    const tip = belt.dir === 1 ? x + width : x;
    this.graphics.fillStyle(0xbff0fa, 0.95).fillTriangle(tip + belt.dir * 2, y + 10.5, tip - belt.dir * 8, y + 5, tip - belt.dir * 8, y + 16);
  }
  private spikePlatform(x: number, y: number, width: number, spikes: NonNullable<Platform['spikePlatform']>) {
    const { state, timer } = spikes;
    // A platform's own warning, where it has one (the CATACOMBS'); otherwise the global one.
    const warningTime = spikes.warning ?? SPIKE_PLATFORM_RULES.warning;
    /**
     * CATACOMB spike ground reads as a MACHINE before it is ever touched (Human Review, v2): a
     * recessed channel along the face, deep sockets with the bone tips of the teeth showing, and
     * hazard marks at both ends. It is all paint -- nothing here is a hitbox; the teeth only hurt once
     * they are up, exactly as before. Platforms without their own warning (the ABYSS arena's) keep
     * the look they have always had.
     */
    if (spikes.warning !== undefined) {
      this.rect(x, y + 3, width, 4, 0x24181f, 0.95);
      for (let i = x + 9; i < x + width - 8; i += 17) {
        this.rect(i - 1, y, 9, 5, 0x0f090e);
        this.rect(i + 2, y + 1, 3, 2, 0xcbb293, state === 'safe' ? 0.75 : 0.95);
      }
      for (const end of [x, x + width - 6]) for (let k = 0; k < 2; k++) this.rect(end, y + 3 + k * 3, 6, 1.5, 0xe8c98a, 0.75);
    } else {
      // Sockets: always visible, so a platform announces what it is before it is ever landed on.
      for (let i = x + 9; i < x + width - 8; i += 17) this.rect(i, y + 1, 7, 3, 0x1b1420);
    }
    if (state === 'safe' || state === 'cooldown') {
      // Resting: the teeth are withdrawn and only their tips show in the sockets.
      if (spikes.warning === undefined) for (let i = x + 9; i < x + width - 8; i += 17) this.rect(i + 1, y, 5, 2, 0x6e5a86, state === 'cooldown' ? 0.75 : 0.45);
      return;
    }

    const warning = state === 'warning';
    // Through the warning the teeth grow out of the sockets; live, they stand at full reach.
    const grown = warning ? 1 - Math.max(0, Math.min(1, timer / warningTime)) : 1;
    const reach = Math.max(2, SPIKE_PLATFORM_RULES.reach * grown);
    const body = warning ? 0xf4c46a : 0xff8f9f, tip = warning ? 0xffe6ae : 0xffd9e0;
    for (let i = x + 9; i < x + width - 8; i += 17) {
      const cx = i + 3.5;
      this.graphics.fillStyle(body, warning ? 0.85 : 1).fillTriangle(cx - 4.5, y + 2, cx + 4.5, y + 2, cx, y + 2 - reach);
      this.graphics.fillStyle(tip, warning ? 0.7 : 1).fillTriangle(cx - 1.6, y + 2, cx + 1.6, y + 2, cx, y + 2 - reach);
    }
    if (warning) {
      // A bar that drains across the ledge: how long is left, not just that something is coming.
      const left = Math.max(0, Math.min(1, timer / warningTime));
      this.rect(x, y - 2, width, 2, 0x4a3a20, 0.9);
      this.rect(x, y - 2, width * left, 2, 0xffe6ae);
    }
  }
  /**
   * TIMEVOID. Standing in a chamber stops the shaft outside it, and the player has to be able to
   * see that at a glance -- so everything outside the chamber is dimmed behind a cold veil while
   * the chamber itself stays lit. Deliberately an overlay rather than a panel: the run has not
   * paused and must not look as though it has.
   */
  private timeVoid(m: GameModel, cam: number) {
    const zone = m.safeZone;
    if (!zone) return;
    const top = zone.y - cam, bottom = top + zone.height;
    const bandTop = Math.max(0, Math.min(800, top)), bandBottom = Math.max(0, Math.min(800, bottom));
    const bandHeight = Math.max(0, bandBottom - bandTop);
    // Four bands around the chamber, so the chamber itself is never covered.
    this.rect(0, 0, WORLD.width, bandTop, 0x081016, 0.62);
    this.rect(0, bandBottom, WORLD.width, Math.max(0, 800 - bandBottom), 0x081016, 0.62);
    this.rect(0, bandTop, Math.max(0, zone.x), bandHeight, 0x081016, 0.62);
    const right = zone.x + zone.width;
    this.rect(right, bandTop, Math.max(0, WORLD.width - right), bandHeight, 0x081016, 0.62);
    // A cold rim around the opening, and a still, unblinking marker.
    this.graphics.lineStyle(2, 0x9fe8f5, 0.45).strokeRect(zone.x, top, zone.width, zone.height);
    // Still, evenly spaced marks beside the opening: stopped time, drawn as something that is not
    // moving. label2 is deliberately not used here -- it only carries the glyphs A, I and R.
    for (let i = 0; i < 3; i++) {
      const y = top + 14 + i * 6;
      this.rect(zone.side === -1 ? right + 6 : zone.x - 26, y, 20, 2, 0x9fe8f5, 0.3 - i * 0.08);
    }
  }
  /**
   * SIDE CAVES: hollowed out of the rock beside the shaft, not stuck onto it.
   *
   * Drawn before the platforms, so the cave's own floor slabs -- which are ordinary platforms --
   * land on top of the hollow and read as its ground. The order is: cut the hollow, line it, then
   * break the shaft wall where the mouth is, so the opening is a hole through the brickwork rather
   * than a panel laid over it.
   */
  private sideCaves(m: GameModel, cam: number, theme: AreaTheme) {
    // AREA 1 has no `cave` entry and keeps the look it was reviewed with; the others line the same
    // shell with their own rock. Only colours and the dressing below differ -- the shape is shared.
    const look = theme.cave ?? { style: undefined, hollow: 0x070d11, lining: 0x15303a, frame: 0x3c7a84, light: 0x9fe8f5 };
    for (const cave of m.caves) {
      const b = cave.bounds, top = b.y - cam;
      if (top > 900 || top + b.height < -90) continue;
      const left = cave.side === -1;
      // The hollow stops at the MOUTH. `bounds` reaches back into the shaft because the sill does,
      // and the player's own bounds follow it -- but the shaft is not part of the cave and painting
      // it black put a hole in the middle of the fall corridor.
      const mouth = left ? cave.opening.x + cave.opening.width : cave.opening.x;
      const hollowX = left ? b.x : mouth, hollowW = left ? mouth - b.x : b.x + b.width - mouth;
      this.rect(hollowX, top, hollowW, b.height, look.hollow, 0.99);
      this.rect(left ? hollowX : hollowX + hollowW - 8, top, 8, b.height, look.lining, 0.85);
      if (!look.style) for (let i = 0; i < 7; i++) {
        const x = left ? hollowX + 12 + i * 15 : hollowX + hollowW - 14 - i * 15;
        this.rect(x, top + 6, 2, b.height - 12, look.light, 0.05);
      }
      else this.caveDressing(cave, look, hollowX, hollowW, top, b.height, cam);
      // The roof slabs, so the cave has a ceiling to read against rather than open black.
      for (const slab of cave.roof) {
        this.rect(slab.x, slab.y - cam, slab.width, slab.height, theme.brick);
        this.rect(slab.x, slab.y - cam + slab.height - 2, slab.width, 2, theme.wallEdge, 0.8);
      }
      // A COIN VEIN is the one content a cave draws itself; a module crate and a shop doorway are
      // their own objects and are drawn by the code that already owns them.
      if (cave.content?.kind === 'coinVein' && !cave.taken) {
        const v = m.veinBounds(cave), vy = v.y - cam;
        this.rect(v.x, vy, v.width, v.height, 0x3a2f14, 0.95);
        this.graphics.lineStyle(2, 0xffd479, 0.9).strokeRect(v.x, vy, v.width, v.height);
        for (let i = 0; i < 5; i++) this.rect(v.x + 6 + (i % 3) * 9, vy + 6 + Math.floor(i / 3) * 13, 6, 6, 0xffd479, 0.85);
      }
      // The mouth, broken through the brickwork: a lintel and a sill that jut into the shaft, and
      // light spilling out of it, so it is read from the middle of the shaft at falling speed.
      const o = cave.opening, oy = o.y - cam;
      const mouthX = left ? o.x + o.width : o.x;
      const frameX = left ? mouthX - 30 : mouthX - 22, frameW = 52;
      this.rect(frameX, oy - 8, frameW, 8, look.frame);
      this.rect(frameX, oy - 8, frameW, 2, look.light, 0.7);
      for (let i = 0; i < 8; i++) {
        const w = 8 + i * 6;
        this.rect(left ? mouthX : mouthX - w, oy + 8 + i * 2, w, o.height - 16 - i * 4, look.light, 0.085 - i * 0.01);
      }
      this.rect(left ? mouthX - 3 : mouthX, oy + 3, 3, o.height - 6, look.light, 0.5);
      if (look.style === 'rubble') {
        // LIMBO's wall is broken, not cut: ragged teeth of rock hang over the mouth and jut under it.
        for (let i = 0; i < 4; i++) {
          const w = 5 + ((cave.id + i) * 7) % 7, h = 4 + ((cave.id * 3 + i) * 5) % 9;
          this.rect(left ? mouthX - 30 + i * 13 : mouthX - 22 + i * 13, oy - 8 - h, w, h, look.frame, 0.9);
        }
      }
    }
  }
  /**
   * What makes an AREA 2-4 cave read as that AREA's rock. Drawn inside the hollow only -- none of it
   * reaches the shaft -- and none of it is solid: the floors, ledges and roof are the shared shell.
   */
  private caveDressing(cave: SideCave, look: NonNullable<AreaTheme['cave']>, x: number, w: number, top: number, h: number, cam: number) {
    const left = cave.side === -1, far = left ? x : x + w;       // the back wall of the room
    const into = (d: number, width: number) => left ? far + d : far - d - width;
    const floorY = cave.floors[0].y - cam;
    if (look.style === 'tomb') {
      // Burial niches in rows along the back half, each a dark arch with a stone sill.
      for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
        const nx = into(18 + i * 34, 22), ny = top + 18 + row * 42;
        if (ny + 30 > floorY - 30) continue;
        this.rect(nx, ny, 22, 28, look.lining, 0.9);
        this.rect(nx + 3, ny + 4, 16, 22, 0x050403, 0.95);
        this.rect(nx - 2, ny + 28, 26, 3, look.frame, 0.9);
      }
      // A candle on the floor by the back wall, its light pooled around it.
      const cx = into(10, 4);
      this.rect(cx, floorY - 12, 4, 12, 0xe8dcc0, 0.9);
      this.rect(cx - 10, floorY - 34, 24, 24, look.light, 0.06);
      this.rect(cx + 1, floorY - 16, 2, 4, look.light, 0.9);
    } else if (look.style === 'ruin') {
      // Standing water over the floor, broken column stubs, and water running down from the roof.
      this.rect(x, floorY - 10, w, 10, 0x123844, 0.55);
      this.rect(x, floorY - 10, w, 1, look.light, 0.35);
      for (let i = 0; i < 3; i++) {
        const cx = into(24 + i * 62, 12), ch = 26 + ((cave.id + i) * 13) % 30;
        this.rect(cx, floorY - ch, 12, ch, look.lining, 0.95);
        this.rect(cx - 2, floorY - ch, 16, 3, look.frame, 0.9);
      }
      for (let i = 0; i < 5; i++) {
        const dx = into(14 + i * 37, 2), len = 10 + ((cave.id * 5 + i * 11) % 18);
        const drop = ((this.model.elapsed * 40 + i * 23) % (h - len - 20));
        this.rect(dx, top + 6, 2, len, look.light, 0.25);
        this.rect(dx, top + 10 + len + drop, 2, 3, look.light, 0.4);
      }
    } else if (look.style === 'rubble') {
      // Ragged edges on the roof and the floor, and debris hanging in the dark between them.
      for (let i = 0; i * 14 < w; i++) {
        const tx = x + i * 14, th = 3 + ((cave.id * 7 + i * 5) % 11);
        this.rect(tx, top, 10, th, look.lining, 0.95);
        this.rect(tx + 4, floorY - 2 - ((cave.id + i * 3) % 6), 8, 2 + ((cave.id + i * 3) % 6), look.lining, 0.9);
      }
      for (let i = 0; i < 6; i++) {
        const bob = Math.sin(this.model.elapsed * 1.3 + i * 1.7) * 3;
        const dx = into(16 + i * 30, 6), dy = top + 24 + ((cave.id * 11 + i * 29) % Math.max(20, h - 60)) + bob;
        this.rect(dx, dy, 6 + (i % 3) * 2, 4 + (i % 2) * 3, look.frame, 0.8);
      }
      this.rect(x, top, w, h, look.light, 0.03);
    }
  }

  /** Lava reads as a solid bright slab; a vent shows its warning before it ever fires. */
  private hazard(h: Hazard, cam: number) {
    const box = hazardBounds(h), y = box.y - cam;
    if (y > 820 || y + box.height < -20) return;
    const type = hazardType(h.kind);
    if (type.palette) { this.spikes(h, type.silhouette === 'stakes', type.palette, y); return; }
    if (h.kind === 'vent') {
      this.rect(h.x - 3, h.y - cam, h.width + 6, h.height, 0x4a3026);
      this.rect(h.x, h.y - cam - 3, h.width, 4, 0x7a4a33);
      if (h.state === 'warning') {
        // Telegraph: a growing glow inside the mouth and a marker column above it.
        const beat = 0.35 + Math.abs(Math.sin(this.model.elapsed * 12)) * 0.5;
        this.rect(h.x + 4, h.y - cam - 2, h.width - 8, 6, 0xffb066, beat);
        for (let i = 0; i < 7; i++) this.rect(h.x + h.width / 2 - 1, h.y - cam - 14 - i * 18, 2, 8, 0xff8a3c, beat * (1 - i / 9));
      }
      if (h.state === 'erupting') {
        for (let i = 0; i < 9; i++) {
          const width = h.width + 8 - i;
          this.rect(h.x + h.width / 2 - width / 2, h.y - cam - (i + 1) * (h.plume / 9), width, h.plume / 9 + 1, i % 2 ? 0xff8a3c : 0xffc27a, 0.85 - i * 0.06);
        }
      }
      return;
    }
    this.rect(box.x, y, box.width, box.height, 0xff5a1e);
    this.rect(box.x, y, box.width, Math.min(4, box.height), 0xffd08a);
    for (let i = 0; i < box.width; i += 11) this.rect(box.x + i + 2, y + 2 + Math.round(Math.sin(this.model.elapsed * 3 + i) * 2), 6, 3, 0xffefc0, 0.8);
    this.rect(box.x - 3, y - 3, box.width + 6, box.height + 6, 0xff7a3c, 0.16);
  }
  /**
   * SPIKE. It kills outright, so it has to be unmistakable from above while falling: a bright base
   * line, a dark shadow under it, and points that catch the eye. The two silhouettes -- a close row
   * of teeth and a sparser set of tall stakes -- are what tell the AREA 1 and AREA 2 variants apart,
   * and the colours come from the hazard table, so a new variant needs no new code here.
   */
  private spikes(h: Hazard, tall: boolean, palette: { body: number; tip: number; base: number }, y: number) {
    if (h.face === 'left' || h.face === 'right') {
      // Barbs on a wall, pointing into the shaft: a base plate on the wall, teeth down its length.
      const out = h.face === 'right' ? 1 : -1, base = out === 1 ? h.x : h.x + h.width, tipX = base + out * h.width;
      this.rect(out === 1 ? h.x - 2 : h.x + h.width - 2, y - 2, 4, h.height + 4, palette.base, 0.95);
      this.rect(h.x - 4, y - 3, h.width + 8, h.height + 6, palette.tip, 0.1);
      for (let i = 0; i + 5 <= h.height; i += 9) {
        const top = y + i, bottom = y + Math.min(i + 8, h.height), mid = (top + bottom) / 2;
        this.graphics.fillStyle(palette.body, 0.98).fillTriangle(tipX, mid, base, top, base, bottom);
        this.graphics.fillStyle(palette.tip, 0.95).fillTriangle(tipX - out, mid, base + out * h.width * 0.45, mid - 2, base + out * h.width * 0.45, mid + 2);
      }
      return;
    }
    const step = tall ? 14 : 9, height = h.height;
    // A warning band beneath the points, so the patch reads as lethal even at a glance.
    this.rect(h.x - 2, y + height - 2, h.width + 4, 4, palette.base, 0.95);
    this.rect(h.x - 3, y - 4, h.width + 6, height + 8, palette.tip, 0.1);
    for (let i = 0; i + 5 <= h.width; i += step) {
      const left = h.x + i, right = left + Math.min(step - 1, h.width - i), mid = (left + right) / 2;
      this.graphics.fillStyle(palette.body, 0.98).fillTriangle(mid, y, left, y + height, right, y + height);
      this.graphics.fillStyle(palette.tip, 0.95).fillTriangle(mid, y + (tall ? 1 : 0), mid - 2, y + height * 0.55, mid + 2, y + height * 0.55);
    }
  }
  /** Void below, drifting rubble and a cracked sky for the collapsing realm. */
  private collapsed(theme: { rift?: { glow: number; void: number; debris: number } }, cam: number) {
    if (!theme.rift) return;
    for (let i = 0; i < 5; i++) {
      const y = ((i * 214 - cam * 0.18) % 1070 + 1070) % 1070 - 120;
      this.rect(40 + (i % 3) * 120, y, 2, 120, theme.rift.glow, 0.16);
      this.rect(30 + (i % 3) * 120, y + 40, 22, 2, theme.rift.glow, 0.12);
    }
    // Rubble drifts downward well behind the play layer, dim enough never to read as a platform.
    for (let i = 0; i < 12; i++) {
      const x = 44 + (i * 167) % 360;
      const y = ((i * 129 + this.model.elapsed * 16 - cam * 0.3) % 900 + 900) % 900;
      const size = 3 + (i % 3) * 2;
      this.rect(x, y, size, size, theme.rift.debris, 0.3);
    }
    this.rect(-8, 760, 466, 40, theme.rift.void, 0.35);
  }
  /**
   * NIMUSHI, everything it has put in the air, and the deep closing in underneath.
   *
   * The pose comes from the state machine rather than from timers read a second time here, so the
   * sprite can never disagree with what the fight actually is. Nothing in this method is flipped
   * for inverted gravity: the world is drawn in world coordinates and the CAMERA is what turned
   * over, which is the whole reason the HUD stays the right way up.
   */
  private boss(cam: number) {
    const fight = this.model.boss;
    if (!fight.enabled) return;
    // The rising deep. Drawn first and across the whole shaft: it is the floor of the arena and
    // the thing the player is being pushed away from.
    const edge = fight.boundaryY - cam;
    if (edge < 830 && edge > -200) {
      const depth = Math.max(0, 820 - edge);
      this.rect(-8, edge, 466, depth + 40, 0x2a0d18, 0.92);
      this.rect(-8, edge, 466, 5, 0xff4d7a, 0.8);
      for (let i = 0; i < 18; i++) {
        const x = 18 + i * 24;
        const bob = Math.sin(this.model.elapsed * 3 + i) * 4;
        this.graphics.fillStyle(0xff4d7a, 0.55).fillTriangle(x, edge + 2, x + 10, edge - 18 - bob, x + 20, edge + 2);
      }
    }

    // Cups: the half of the pincer that comes from below.
    for (const cup of fight.cups) {
      const cy = cup.y - cam;
      if (cy < -80 || cy > 880) continue;
      const w = 46, h = 64;
      const warning = cup.state === 'warning';
      const beat = warning ? 0.35 + Math.abs(Math.sin(this.model.elapsed * 14)) * 0.5 : 0.9;
      this.rect(cup.x - w / 2, cy - h / 2, w, h, 0x3a2b33, 0.95);
      this.rect(cup.x - w / 2 + 4, cy - h / 2 + 8, w - 8, h - 14, 0xc79a6b, 0.8);
      for (let i = 0; i < 5; i++) this.rect(cup.x - 14 + (i % 3) * 12, cy + 4 + Math.floor(i / 3) * 10, 8, 8, 0x2a1b20);
      // The straw, and the flare that says it is about to fire.
      this.rect(cup.x + 10, cy - h / 2 - 22, 6, 30, 0xf0e6ef, beat);
      if (warning || cup.state === 'firing') {
        for (let i = 0; i < 9; i++) this.rect(cup.x + 11, cy - h / 2 - 28 - i * 18, 4, 10, 0xff9ab4, beat * (1 - i / 10));
      }
    }

    // The straw beam. The warning line is drawn at FULL length and is unmistakably not the beam.
    for (const beam of fight.beams) {
      if (beam.state === 'warning') {
        const beat = 0.25 + Math.abs(Math.sin(this.model.elapsed * 16)) * 0.55;
        this.rect(beam.x - 2, 0, 4, 800, 0xffe9a8, beat);
        this.rect(beam.x - beam.width / 2, 0, beam.width, 800, 0xffe9a8, beat * 0.12);
      } else {
        this.rect(beam.x - beam.width / 2, 0, beam.width, 800, 0xf0e6ef, 0.9);
        this.rect(beam.x - beam.width / 2 + 6, 0, beam.width - 12, 800, 0xffffff, 0.7);
        this.rect(beam.x - 4, 0, 8, 800, 0xffc4cf, 0.95);
      }
    }

    // Pearls.
    for (const pearl of fight.tapiocas) {
      const py = pearl.y - cam;
      if (py < -30 || py > 840) continue;
      // A pale rim first: a dark pearl on a dark shaft has to read as a THING coming at the player.
      this.graphics.fillStyle(0xffe9c4, 0.85).fillCircle(pearl.x, py, pearl.size + 2);
      this.graphics.fillStyle(0x1b1016, 0.95).fillCircle(pearl.x, py, pearl.size);
      this.graphics.fillStyle(0x6b4a58, 0.8).fillCircle(pearl.x - pearl.size * 0.3, py - pearl.size * 0.3, pearl.size * 0.4);
    }

    this.bossBody(cam);
    this.bossBarrier(cam);
    this.bossTells(cam);
    const body = fight.body, y = body.y - cam;
    if (y > 860 || y + body.height < -220) return;
    const pose = fight.pose;
    // Casting: the cup-hand is raised and the air around it lights up.
    if (pose === 'cast') {
      const beat = 0.2 + Math.abs(Math.sin(this.model.elapsed * 13)) * 0.5;
      for (let i = 0; i < 10; i++) this.rect(fight.x - 3 + (i % 3 - 1) * 26, y + body.height + 10 + i * 16, 6, 10, 0xffe9a8, beat * (1 - i / 12));
    }
    if (pose === 'dead') for (let i = 0; i < 8; i++) this.rect(body.x + i * 21, y + body.height, 10, 12 + (i % 3) * 8, 0x4a3f45, 0.4);
  }

  /**
   * THE TAPIOCA BARRIER, and its absence.
   *
   * Up: `TAPIOCA_BARRIER.pearls` dark tapioca pearls circle the body, closing in from further out as
   * it forms. Down (the damage window): the pearls burst outward and fall away, and the body's rim
   * pulses gold for as long as it can be hurt. One glance answers "can I hurt it now".
   */
  private bossBarrier(cam: number) {
    const fight = this.model.boss;
    if (!fight.started || fight.defeated) return;
    const body = fight.body;
    // Around the DRAWING when NIMUSHI's image is up -- its silhouette's centre, not the collision box
    // high on the hood -- and around the body only for the procedural fallback.
    const orbit = this.bossArt?.visible
      ? nimushiArtBarrierOrbit(body, cam, TAPIOCA_BARRIER)
      : { x: fight.x, y: body.y + body.height / 2 - cam, radiusX: TAPIOCA_BARRIER.radiusX, radiusY: TAPIOCA_BARRIER.radiusY };
    const cx = orbit.x, cy = orbit.y, rx = orbit.radiusX, ry = orbit.radiusY;
    const n = TAPIOCA_BARRIER.pearls, spin = this.reducedMotion ? 0 : this.model.elapsed * TAPIOCA_BARRIER.spin;
    const pearl = (x: number, y: number, r: number, alpha: number) => {
      this.graphics.fillStyle(0x1b1016, 0.95 * alpha).fillCircle(x, y, r);
      this.graphics.fillStyle(0x4a2e22, 0.9 * alpha).fillCircle(x, y, r * 0.78);
      this.graphics.fillStyle(0xb58a6a, 0.75 * alpha).fillCircle(x - r * 0.32, y - r * 0.32, r * 0.3);
    };
    if (fight.barrier) {
      const t = Math.min(1, fight.barrierAge / TAPIOCA_BARRIER.form);
      const spread = 1 + (1 - t) * 1.3;
      // A faint shell joining them, so the ring reads as one closed thing rather than loose pearls.
      this.graphics.lineStyle(3, 0x3a2418, 0.35 * t).strokeEllipse(cx, cy, rx * 2, ry * 2);
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2;
        pearl(cx + Math.cos(a) * rx * spread, cy + Math.sin(a) * ry * spread, TAPIOCA_BARRIER.pearlSize, t);
      }
      return;
    }
    if (!fight.eyeOpen) return;
    // Just dropped: the ring bursts outward and falls away.
    const t = fight.barrierAge / TAPIOCA_BARRIER.burst;
    if (t < 1) {
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * Math.PI * 2;
        const out = 1 + t * 1.6, fall = t * t * 90;
        pearl(cx + Math.cos(a) * rx * out, cy + Math.sin(a) * ry * out + fall, TAPIOCA_BARRIER.pearlSize * (1 - t * 0.5), 1 - t);
      }
    }
    // Exposed: gold that breathes for as long as the window lasts. Over NIMUSHI's image a full box
    // would sit across the face, so there it is four lock-on corners instead -- the same gold, the same
    // beat, framing the body rather than covering it.
    const beat = 0.35 + Math.abs(Math.sin(this.model.elapsed * 5)) * 0.4;
    const bx = body.x - 8, by = body.y - cam - 8, bw = body.width + 16, bh = body.height + 16;
    if (this.bossArt?.visible) {
      const arm = 22;
      this.graphics.lineStyle(4, 0xffd66b, beat);
      for (const [cx, cy, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
        this.graphics.lineBetween(cx, cy, cx + dx * arm, cy);
        this.graphics.lineBetween(cx, cy, cx, cy + dy * arm);
      }
    } else this.graphics.lineStyle(3, 0xffd66b, beat).strokeRect(bx, by, bw, bh);
  }
  /** TRIPLE SHOT's three lines, and the rings a SUMMON is about to come through. */
  private bossTells(cam: number) {
    const fight = this.model.boss;
    const tell = fight.tripleTelegraph;
    if (tell) {
      const beat = 0.35 + Math.abs(Math.sin(this.model.elapsed * 14)) * 0.45;
      for (const a of tell.angles) {
        for (let d = 24; d < 420; d += 22) {
          const x = tell.origin.x + Math.cos(a) * d, y = tell.origin.y + Math.sin(a) * d - cam;
          this.graphics.fillStyle(0xffe9a8, beat * (1 - d / 460)).fillCircle(x, y, 3);
        }
      }
    }
    if (fight.summonTelegraph) {
      const grow = (this.model.elapsed * 2) % 1;
      const y = fight.face - fight.reach(this.model.player.y) * 0.45 - cam;
      for (const x of [110, 225, 340]) this.graphics.lineStyle(2, 0xc9a7ed, 0.7 * (1 - grow)).strokeCircle(x, y, 10 + grow * 22);
    }
  }
  /** Body/face rendering only. Kept separate from hazards for isolated art review. */
  private bossBody(cam: number) {
    const m = this.model, fight = m.boss;
    const body = fight.body, y = body.y - cam;
    if (y > 860 || y + body.height < -220) return;
    if (this.bossArt && this.afterBoss) {
      // NIMUSHI's approved image, on the body the model reports. Everything drawn from here on --
      // the barrier, the tells, enemies, the player -- goes on the layer above it.
      const at = nimushiArtPlacement(body, cam);
      const shade = nimushiArtShade(fight);
      this.bossArt.setPosition(at.x + this.graphics.x, at.y + this.graphics.y).setAlpha(shade.alpha).setVisible(true);
      if (shade.fill) this.bossArt.setTintFill(shade.tint); else this.bossArt.setTint(shade.tint);
      this.graphics = this.afterBoss;
      return;
    }
    const pose = fight.pose;
    const dead = pose === 'dead';
    const rage = pose === 'rage' || fight.rageActive;
    /**
     * The hit reaction.
     *
     * NIMUSHI's body has already been knocked back a few pixels by `HIT_REACTION.recoil` -- the box
     * being drawn here IS the recoiled one, so the sprite, the eye and the hitbox jolt together.
     * What this adds is the part that costs no distance: the whole silhouette whitens and its rim
     * light flares, so a landed shot reads instantly even though it no longer moves the fight.
     */
    const struck = dead ? 0 : fight.hitFlash;
    const whiten = (color: number) => {
      if (struck <= 0) return color;
      const mix = (shift: number) => Math.round(((color >> shift) & 0xff) + (0xff - ((color >> shift) & 0xff)) * struck * 0.75);
      return (mix(16) << 16) | (mix(8) << 8) | mix(0);
    };
    // Hood and hair: brown under a dog hood, which is what makes the thing recognisable at all.
    const hood = whiten(dead ? 0x4a3f45 : rage ? 0x7a2038 : 0x5d4a6b);
    const hair = whiten(dead ? 0x5a4a3a : 0x9a6b3f);
    this.rect(body.x - 6 - struck * 4, y - 6 - struck * 4, body.width + 12 + struck * 8, body.height + 12 + struck * 8,
      struck > 0 ? 0xffffff : rage ? 0xff4d7a : 0x9d7bd8, dead ? 0.08 : 0.16 + struck * 0.5);
    // Ears, one each side, flopping a little.
    const flop = this.reducedMotion ? 0 : Math.sin(this.model.elapsed * 2.2) * 3;
    this.rect(body.x - 4, y + 6 + flop, 30, 52, hood);
    this.rect(body.x + body.width - 26, y + 6 - flop, 30, 52, hood);
    this.rect(body.x, y, body.width, body.height, hood);
    this.rect(body.x + 16, y + 14, body.width - 32, body.height - 30, hair, 0.85);
    // The huge hands, one holding the cup it will never put down.
    this.rect(body.x - 22, y + body.height - 26, 34, 30, hood);
    this.rect(body.x + body.width - 12, y + body.height - 26, 34, 30, hood);
    this.rect(body.x + body.width + 2, y + body.height - 54, 22, 30, 0xc79a6b, 0.9);
    this.rect(body.x + body.width + 10, y + body.height - 74, 5, 24, 0xf0e6ef, 0.9);

    // The eye, on the face that looks down at the player. This is the fight.
    const eye = fight.eye, ey = eye.y - cam;
    if (fight.eyeOpen) {
      const glow = pose === 'damage' || struck > 0 ? 0xffffff : rage ? 0xff4d7a : 0xffe9a8;
      // The weak point flares widest at the moment of the hit: it is what was hit.
      const ring = 4 + struck * 10;
      this.rect(eye.x - ring, ey - ring, eye.width + ring * 2, eye.height + ring * 2, glow, 0.25 + struck * 0.55);
      this.graphics.fillStyle(0xf7f2f7, 0.97).fillEllipse(fight.x, ey + eye.height / 2, eye.width, eye.height);
      const look = Math.max(-12, Math.min(12, (m.player.x - fight.x) * 0.12));
      this.graphics.fillStyle(rage ? 0xff2e5c : 0x2a1b20, 1).fillEllipse(fight.x + look, ey + eye.height / 2, 22, eye.height * 0.8);
      this.rect(fight.x + look - 3, ey + 6, 5, 5, 0xffffff, 0.9);
    } else {
      // Shut: a hard seam, so "invulnerable" is legible without reading a bar.
      this.rect(eye.x, ey + eye.height / 2 - 3, eye.width, 6, 0x2a1b20);
      this.rect(eye.x + 4, ey + eye.height / 2 - 6, eye.width - 8, 4, hair, 0.7);
    }

  }

  private enemy(e: Enemy, cam: number) {
    const x = Math.round(e.x), y = Math.round(e.y - cam);
    if (y < -30 || y > 830) return;
    const type = enemyType(e.kind);
    const hurt = e.flash || (e.hurtFlash || 0) > 0.08;
    // Stompable enemies are soft and round; armoured ones carry a shell you can see from above.
    const color = hurt ? 0xffffff : type.stompable ? 0xf497ab : type.silhouette === 'brute' ? 0xc0a7ed : 0xd8b48c;
    const width = type.bodyWidth;
    if (type.silhouette === 'ghost') { this.ghost(e, x, y, !!hurt); return; }
    if (type.silhouette === 'skull') { this.skull(e, x, y, !!hurt); return; }
    if (type.silhouette === 'wing' && type.id === 'caveBat' && e.ai?.kind === 'bat' && e.ai.state !== 'chase') {
      // Hanging: wings folded, upside down under the ledge. Nothing about it moves until you pass.
      this.rect(x - 9, y - 12, 18, 22, color); this.rect(x - 5, y - 16, 3, 5, color); this.rect(x + 2, y - 16, 3, 5, color);
      this.rect(x - 6, y + 2, 4, 4, 0x29252e); this.rect(x + 2, y + 2, 4, 4, 0x29252e);
      return;
    }
    if (type.silhouette === 'wing' && (type.id === 'bat' || type.id === 'caveBat')) {

      const flap = Math.sin(this.model.elapsed * 15) * 5;
      this.rect(x - 26, y - 4 + flap, 13, 5, color); this.rect(x + 13, y - 4 + flap, 13, 5, color);
      this.rect(x - 18, y - 8 + flap, 6, 10, color); this.rect(x + 12, y - 8 + flap, 6, 10, color);
      this.rect(x - 7, y - 18, 4, 6, color); this.rect(x + 3, y - 18, 4, 6, color);
    }
    if (type.silhouette === 'shell') {
      // Spiked carapace: a hard, angular top that reads as "do not land here" at any colour.
      for (let i = -1; i <= 1; i++) this.graphics.fillStyle(0xfbe3da).fillTriangle(x + i * 9 - 5, y - 11, x + i * 9, y - 25, x + i * 9 + 5, y - 11);
      this.rect(x - 15, y - 13, 30, 6, 0x8a6a52);
      this.rect(x - 13, y - 17, 26, 5, 0xa9846a);
    }
    if (type.silhouette === 'brute') {
      this.rect(x - 20, y - 17, 40, 7, 0x5b4a76);
      for (let i = -1; i <= 1; i++) this.rect(x + i * 12 - 3, y - 23, 6, 7, 0x8a76ad);
    }
    if (type.silhouette === 'fin') {
      // Streamlined body with a tail fin: soft, no hard top.
      const swim = Math.sin(this.model.elapsed * 6 + e.phase) * 3;
      this.rect(x + 14, y - 8 + swim, 10, 16, color);
      this.rect(x - 6, y - 15, 12, 5, color);
      this.rect(x - 16, y - 3, 6, 7, color, 0.85);
    }
    if (type.silhouette === 'orb') {
      // Round and carrying air: three bubbles above it say what it drops.
      const rise = Math.sin(this.model.elapsed * 3 + e.phase) * 2;
      for (let i = 0; i < 3; i++) this.rect(x - 8 + i * 7, y - 20 - i * 4 + rise, 4, 4, 0xdff7fc, 0.8);
      this.rect(x + 12, y - 6, 9, 12, color);
    }
    if (type.silhouette === 'bell') {
      // Dome plus trailing tentacles: nothing flat to land on.
      const drift = Math.sin(this.model.elapsed * 1.6 + e.phase) * 2;
      this.rect(x - 13, y - 18 + drift, 26, 6, 0xc9a7ed);
      this.rect(x - 16, y - 12 + drift, 32, 6, 0xc9a7ed);
      for (let i = -2; i <= 2; i++) this.rect(x + i * 6 - 1, y + 4 + drift, 2, 14 + (i % 2 ? 6 : 0), 0xc9a7ed, 0.8);
    }
    if (type.silhouette === 'lizard') {
      const step = Math.sin(this.model.elapsed * 7 + e.phase) * 2;
      this.rect(x + 13, y - 4 + step, 12, 5, color);
      this.rect(x - 16, y - 12, 9, 7, color);
      this.rect(x - 6, y - 17, 4, 5, color, 0.9); this.rect(x + 2, y - 17, 4, 5, color, 0.9);
    }
    if (type.silhouette === 'ember') {
      const flap = Math.sin(this.model.elapsed * 18 + e.phase) * 5;
      this.rect(x - 26, y - 4 + flap, 13, 5, color); this.rect(x + 13, y - 4 + flap, 13, 5, color);
      this.rect(x - 18, y - 8 + flap, 6, 10, color); this.rect(x + 12, y - 8 + flap, 6, 10, color);
      for (let i = 0; i < 3; i++) this.rect(x - 6 + i * 6, y + 14 + i * 4, 2, 4, 0xffb066, 0.7 - i * 0.2);
    }
    if (type.silhouette === 'flame') {
      // A burning crown: nothing flat to land on, and it reads as heat at a glance.
      const lick = Math.sin(this.model.elapsed * 9 + e.phase) * 3;
      for (let i = -1; i <= 1; i++) {
        this.graphics.fillStyle(0xff8a3c).fillTriangle(x + i * 9 - 5, y - 10, x + i * 9, y - 26 - (i === 0 ? 5 : 0) + lick, x + i * 9 + 5, y - 10);
        this.graphics.fillStyle(0xffd08a).fillTriangle(x + i * 9 - 2, y - 11, x + i * 9, y - 19 + lick, x + i * 9 + 2, y - 11);
      }
    }
    if (type.silhouette === 'plated') {
      this.rect(x - 19, y - 18, 38, 8, 0x6b4636);
      this.rect(x - 15, y - 24, 30, 6, 0x9a6a4a);
      for (let i = -1; i <= 1; i++) this.rect(x + i * 11 - 2, y - 29, 5, 6, 0xc98a5a);
    }
    if (type.silhouette === 'crystal') {
      const drift = Math.sin(this.model.elapsed * 3 + e.phase) * 2;
      for (let i = -1; i <= 1; i++) this.graphics.fillStyle(0x8fdcff, 0.9).fillTriangle(x + i * 9 - 4, y - 12 + drift, x + i * 9, y - 24 + drift, x + i * 9 + 4, y - 12 + drift);
      this.rect(x - 22, y - 3 + drift, 9, 4, color); this.rect(x + 13, y - 3 + drift, 9, 4, color);
    }
    if (type.silhouette === 'horned') {
      const beat = Math.sin(this.model.elapsed * 6 + e.phase) * 2;
      this.graphics.fillStyle(color).fillTriangle(x - 13, y - 12, x - 9, y - 26 + beat, x - 4, y - 12);
      this.graphics.fillStyle(color).fillTriangle(x + 4, y - 12, x + 9, y - 26 + beat, x + 13, y - 12);
      this.rect(x - 22, y - 2, 8, 6, color, 0.85); this.rect(x + 14, y - 2, 8, 6, color, 0.85);
    }
    if (type.silhouette === 'shade') {
      const drift = Math.sin(this.model.elapsed * 1.3 + e.phase) * 3;
      this.rect(x - 12, y - 20 + drift, 24, 8, color, 0.55);
      for (let i = -2; i <= 2; i++) this.rect(x + i * 6 - 1, y + 6 + drift, 3, 12 + Math.abs(i) * 4, color, 0.4);
    }
    if (type.silhouette === 'wisp') {
      // A ring of cold fire with nothing in the middle: there is no top to land on, and it reads
      // that way at a glance -- the centre is visibly empty rather than a body.
      const pulse = 0.7 + Math.abs(Math.sin(this.model.elapsed * 3.4 + e.phase)) * 0.3;
      this.graphics.lineStyle(3, color, pulse).strokeCircle(x, y - 2, 13);
      this.graphics.lineStyle(1.5, 0xe6d8ff, pulse * 0.8).strokeCircle(x, y - 2, 7);
      for (let i = 0; i < 4; i++) {
        const a = this.model.elapsed * 2.2 + e.phase + (i * Math.PI) / 2;
        this.rect(x + Math.cos(a) * 17 - 1.5, y - 2 + Math.sin(a) * 17 - 1.5, 3, 3, 0xe6d8ff, pulse);
      }
    }
    if (type.silhouette === 'hollow') {
      // A hooded shell, open at the crown. Same message as the wisp: nothing here holds weight.
      const drift = Math.sin(this.model.elapsed * 1.1 + e.phase) * 3;
      this.graphics.lineStyle(2.5, color, 0.85).strokeRoundedRect(x - 12, y - 18 + drift, 24, 26, 9);
      this.rect(x - 8, y - 20 + drift, 16, 4, 0x0b0710);
      for (let i = -1; i <= 1; i += 2) this.rect(x + i * 5 - 1.5, y - 8 + drift, 3, 5, 0xe6d8ff, 0.9);
      for (let i = -2; i <= 2; i++) this.rect(x + i * 5 - 1, y + 8 + drift, 2, 7 + Math.abs(i) * 3, color, 0.35);
    }
    if (type.silhouette === 'bouncePearl') {
      // A big pearl with a flat, banded crown. Deliberately NOT the hooded clone shape: one of
      // these is a thing to land on and the other is a thing to shoot, and in LIMBO they share the
      // screen with a barbed clone that must never be stood on. Shape carries that, never colour.
      const bob = Math.sin(this.model.elapsed * 2.2 + e.phase) * 2;
      this.graphics.fillStyle(0x2a1d2e).fillCircle(x, y + bob, 15);
      this.graphics.fillStyle(0x6b4a7a).fillCircle(x, y + bob, 13);
      this.graphics.fillStyle(0xd8b6f0, 0.9).fillCircle(x - 4, y - 4 + bob, 4);
      // The flat crown is the face the pull brings the player onto: the part you land on.
      this.rect(x - 13, y - 16 + bob, 26, 5, 0xf3e2ff);
      this.rect(x - 9, y - 19 + bob, 18, 3, 0xd8b6f0, 0.8);
    }
    if (type.silhouette === 'nimushi' || type.silhouette === 'nimushiBarbed') {
      // A little hooded thing: NIMUSHI in miniature, so where it came from is never in doubt.
      // The LIMBO variant wears the same hood with a crown of barbs, because the shape -- never
      // the colour -- is what says whether a thing can be stood on.
      const barbed = type.silhouette === 'nimushiBarbed';
      const bob = Math.sin(this.model.elapsed * 4 + e.phase) * 3;
      const hood = barbed ? 0x7a2038 : 0x9a7bc8;
      if (barbed) for (let i = -1; i <= 1; i++) this.graphics.fillStyle(0xfbe3da).fillTriangle(x + i * 9 - 5, y - 15 + bob, x + i * 9, y - 28 + bob, x + i * 9 + 5, y - 15 + bob);
      this.rect(x - 13, y - 16 + bob, 26, 24, hood);
      this.rect(x - 15, y - 12 + bob, 6, 13, hood); this.rect(x + 9, y - 12 + bob, 6, 13, hood);
      this.rect(x - 9, y - 10 + bob, 18, 11, 0x9a6b3f, 0.9);
      for (let i = -1; i <= 1; i += 2) this.rect(x + i * 5 - 1.5, y - 6 + bob, 3, 4, 0x1b1016);
      this.rect(x - 5, y + 8 + bob, 10, 7, 0xc79a6b, 0.9);
    }
    if (type.silhouette === 'bulwark') {
      this.rect(x - 20, y - 19, 40, 9, 0x4a3f63);
      this.rect(x - 16, y - 26, 32, 7, 0x7a68a5);
      for (let i = -1; i <= 1; i++) this.rect(x + i * 12 - 2, y - 31, 5, 6, 0xa38fd4);
    }
    if (type.silhouette === 'barb') {
      for (let i = -2; i <= 2; i++) {
        this.graphics.fillStyle(0xf0dcc8).fillTriangle(x + i * 8 - 4, y - 10, x + i * 8, y - 25, x + i * 8 + 4, y - 10);
        this.rect(x + i * 8 - 1, y + 9, 2, 8, 0xf0dcc8);
      }
      for (const side of [-1, 1]) this.rect(x + side * 16, y - 5, 11, 2, 0xf0dcc8);
    }
    if (type.silhouette === 'breaker') {
      // Carries the hammer that ends a ledge: a heavy head above a soft, stompable body.
      const swing = Math.sin(this.model.elapsed * 4 + e.phase) * 3;
      this.rect(x - 14, y - 26 + swing, 28, 9, 0x8f7ac4);
      this.rect(x - 3, y - 17 + swing, 6, 7, 0x6a5a92);
      for (let i = 0; i < 3; i++) this.rect(x - 10 + i * 9, y - 30 + swing, 5, 4, 0xc2acf0);
    }
    if (type.silhouette === 'spore') {
      // A soft translucent bulb: big, slow, obviously something to land on.
      const wob = Math.sin(this.model.elapsed * 3 + e.phase) * 2;
      this.graphics.fillStyle(hurt ? 0xffffff : 0xb7e4a8, 0.55).fillCircle(x, y + wob, 16);
      this.graphics.lineStyle(2, 0xe4ffd8, 0.9).strokeCircle(x, y + wob, 16);
      this.rect(x - 6, y - 4 + wob, 4, 4, 0x29252e); this.rect(x + 3, y - 4 + wob, 4, 4, 0x29252e);
      return;
    }
    if (type.silhouette === 'toad') {
      // Squat, wide-mouthed; swells red while it winds up to leap.
      const winding = e.ai?.kind === 'hop' && e.ai.state === 'windup';
      const body = hurt ? 0xffffff : winding ? 0xff7a6a : 0x9fd07a;
      this.rect(x - 15, y - 8, 30, 18, body); this.rect(x - 11, y - 14, 8, 7, body); this.rect(x + 3, y - 14, 8, 7, body);
      this.rect(x - 9, y - 12, 4, 4, 0x29252e); this.rect(x + 5, y - 12, 4, 4, 0x29252e);
      this.rect(x - 10, y + 2, 20, 2, 0x4a6b3a); this.rect(x - 18, y + 8, 7, 4, body); this.rect(x + 11, y + 8, 7, 4, body);
      return;
    }
    if (type.silhouette === 'turtle') {
      // A domed shell with a flat top: rounds glance off it, feet do not.
      const body = hurt ? 0xffffff : 0x8fbf8a;
      this.rect(x - 16, y - 6, 32, 14, 0x5f7f5a); this.rect(x - 12, y - 12, 24, 7, body); this.rect(x - 14, y - 14, 28, 3, 0xd8f0c8);
      this.rect(x + 14, y - 2, 7, 6, body); this.rect(x + 17, y - 3, 2, 2, 0x29252e);
      this.rect(x - 13, y + 8, 6, 4, body); this.rect(x + 7, y + 8, 6, 4, body);
      return;
    }
    if (type.silhouette === 'creeper') {
      // A spiral shell stuck to the wall, spines outward.
      const body = hurt ? 0xffffff : 0xd8b48c;
      this.graphics.fillStyle(body).fillCircle(x, y, 12);
      this.graphics.lineStyle(2, 0x6b4e36).strokeCircle(x, y, 7);
      for (let i = -1; i <= 1; i++) this.graphics.fillStyle(0xf0dcc8).fillTriangle(x - 12, y + i * 8 - 3, x - 20, y + i * 8, x - 12, y + i * 8 + 3);
      for (let i = -1; i <= 1; i++) this.graphics.fillStyle(0xf0dcc8).fillTriangle(x + 12, y + i * 8 - 3, x + 20, y + i * 8, x + 12, y + i * 8 + 3);
      return;
    }
    if (type.silhouette === 'watcher') {
      // One big eye in a spiked lid: it looks at you, and it cannot be stood on.
      const body = hurt ? 0xffffff : 0xe7d6c8;
      this.graphics.fillStyle(body).fillCircle(x, y, 13);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + this.model.elapsed; this.graphics.fillStyle(0xf0dcc8).fillTriangle(x + Math.cos(a) * 12, y + Math.sin(a) * 12, x + Math.cos(a + 0.25) * 19, y + Math.sin(a + 0.25) * 19, x + Math.cos(a + 0.5) * 12, y + Math.sin(a + 0.5) * 12); }
      const p = this.model.player, d = Math.hypot(p.x - x, p.y - e.y) || 1;
      this.graphics.fillStyle(0xd23b3b).fillCircle(x + (p.x - x) / d * 5, y + (p.y - e.y) / d * 5, 5);
      return;
    }
    if (type.silhouette === 'bones') {
      // A standing skeleton; the arm goes up while it winds up a throw.
      const body = hurt ? 0xffffff : 0xefe6d2;
      const winding = e.ai?.kind === 'throw' && e.ai.windup > 0;
      this.rect(x - 8, y - 22, 16, 12, body); this.rect(x - 5, y - 18, 4, 4, 0x241c24); this.rect(x + 1, y - 18, 4, 4, 0x241c24);
      this.rect(x - 2, y - 10, 4, 16, body); for (let i = 0; i < 3; i++) this.rect(x - 7, y - 8 + i * 4, 14, 2, body);
      this.rect(x - 6, y + 6, 3, 9, body); this.rect(x + 3, y + 6, 3, 9, body);
      if (winding) this.rect(x + 6, y - 30, 3, 14, body); else this.rect(x + 7, y - 8, 3, 12, body);
      return;
    }
    if (type.silhouette === 'boneSkull') {
      const body = hurt ? 0xffffff : 0xefe6d2;
      this.rect(x - 10, y - 10, 20, 14, body); this.rect(x - 7, y + 4, 14, 5, body);
      this.rect(x - 7, y - 6, 5, 5, 0x241c24); this.rect(x + 2, y - 6, 5, 5, 0x241c24);
      return;
    }
    if (type.silhouette === 'orbShade') {
      // A dark orb with a pale rim; the angry kind glares red.
      const angry = type.id === 'angryOrb';
      this.graphics.fillStyle(0x1b1426, 0.85).fillCircle(x, y, 12);
      this.graphics.lineStyle(2, hurt ? 0xffffff : angry ? 0xff6a6a : 0xc0a7ed, 0.9).strokeCircle(x, y, 12);
      this.rect(x - 6, y - 3, 4, 3, angry ? 0xff4a4a : 0xe6d8ff); this.rect(x + 2, y - 3, 4, 3, angry ? 0xff4a4a : 0xe6d8ff);
      return;
    }
    if (type.silhouette === 'biter') {
      // Jaws first: a wedge of teeth that cannot be stood on.
      const body = hurt ? 0xffffff : 0xe89a7a;
      const face = e.ai?.kind === 'eye' && e.ai.vx < 0 ? -1 : 1;
      this.rect(x - 12, y - 7, 24, 14, body); this.rect(x - 12 * face - (face < 0 ? 0 : 6), y - 4, 6, 8, body);
      for (let i = 0; i < 3; i++) this.graphics.fillStyle(0xfbe3da).fillTriangle(x + face * 12, y - 6 + i * 4, x + face * 17, y - 4 + i * 4, x + face * 12, y - 2 + i * 4);
      this.rect(x + face * 5 - 2, y - 4, 3, 3, 0x29252e);
      return;
    }
    if (type.silhouette === 'squid') {
      // A mantle and trailing arms; the arms flare red while it darts down, when it cannot be stood on.
      const diving = e.ai?.kind === 'squid' && e.ai.state !== 'rise';
      const body = hurt ? 0xffffff : diving ? 0xff8a7a : 0xf497ab;
      this.graphics.fillStyle(body).fillTriangle(x - 10, y + 2, x, y - 16, x + 10, y + 2);
      for (let i = -2; i <= 2; i++) this.rect(x + i * 4 - 1, y + 2, 2, diving ? 6 : 12, body);
      this.rect(x - 5, y - 4, 3, 3, 0x29252e); this.rect(x + 2, y - 4, 3, 3, 0x29252e);
      return;
    }
    if (type.silhouette === 'shard') {
      // Two barbed nuclei joined on a bond: the diagonal bouncer.
      const c = hurt ? 0xffffff : 0xc0a7ed;
      this.graphics.lineStyle(3, c, 0.9).lineBetween(x - 9, y - 9, x + 9, y + 9);
      for (const k of [-1, 1]) { this.graphics.fillStyle(c).fillCircle(x + k * 9, y + k * 9, 7); this.graphics.lineStyle(2, 0xf0dcc8).strokeCircle(x + k * 9, y + k * 9, 9); }
      return;
    }
    if (type.silhouette === 'spiked') {
      // Spikes on every side: the clearest "do not land here" in the game.
      for (let i = -2; i <= 2; i++) {
        this.graphics.fillStyle(0xf0dcc8).fillTriangle(x + i * 7 - 4, y - 9, x + i * 7, y - 24, x + i * 7 + 4, y - 9);
        this.rect(x + i * 7 - 1, y + 8, 2, 9, 0xf0dcc8);
      }
      for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) this.rect(x + side * 15, y - 6 + i * 7, 10, 2, 0xf0dcc8);
    }
    this.rect(x - width / 2, y - 10, width, 20, color);
    this.rect(x - width / 2 + 4, y - 14, width - 8, 5, color);
    if (type.stompable) { this.rect(x - width / 2 - 2, y - 6, 2, 10, color); this.rect(x + width / 2, y - 6, 2, 10, color); }
    this.rect(x - 8, y - 5, 5, 6, 0x29252e); this.rect(x + 4, y - 5, 5, 6, 0x29252e);
    this.rect(x - 12, y + 10, 7, 5, color); this.rect(x + 5, y + 10, 7, 5, color);
    if (!type.stompable) for (let i = 0; i < e.hp; i++) this.rect(x - 10 + i * 8, y + 4, 5, 3, 0x433355);
  }
}
