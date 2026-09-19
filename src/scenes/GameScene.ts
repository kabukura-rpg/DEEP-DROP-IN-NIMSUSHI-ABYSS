import Phaser from 'phaser';
import { GameModel, type GameEvent } from '../systems/GameModel';
import type { Enemy } from '../systems/StageGenerator';
import { WORLD } from '../data/balance';
import { comboFeedback } from '../systems/ComboFeedback';
import { InputBuffer } from '../systems/InputBuffer';
import { enemyType } from '../data/enemies';
import { pickupType } from '../data/pickups';
import { gunModule } from '../data/gunModules';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES } from '../data/structures';
import { hazardBounds, hazardType, type Hazard } from '../data/hazards';
export interface GameBridge {
  direction: number; firing: boolean; active: boolean;
  onFrame: (model: GameModel) => void;
  onEvent: (event: GameEvent, model: GameModel) => void;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: number; size: number }
export class GameScene extends Phaser.Scene {
  model = new GameModel();
  private graphics!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private particles: Particle[] = [];
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
  create() {
    this.graphics = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys({ left: 'LEFT', right: 'RIGHT', a: 'A', d: 'D', space: 'SPACE' }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.addCapture(['SPACE', 'LEFT', 'RIGHT']);
    this.input.keyboard!.on('keydown-SPACE', () => this.requestShot());
    for (const key of ['LEFT', 'A']) this.input.keyboard!.on(`keydown-${key}`, () => { if (this.bridge.active) this.inputBuffer.move(-1); });
    for (const key of ['RIGHT', 'D']) this.input.keyboard!.on(`keydown-${key}`, () => { if (this.bridge.active) this.inputBuffer.move(1); });
    this.draw();
  }
  startRun(practice = false) {
    this.model = new GameModel(practice); this.accumulator = 0; this.particles = []; this.freeze = 0;
    for (const label of this.labels) label.text.destroy();
    this.labels = []; this.flash = 0; this.shake = 0; this.damageTime = 0; this.damageSource = undefined; this.inputBuffer.clear();
  }
  requestShot() { if (this.bridge.active) this.inputBuffer.shoot(); }
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
      if (event.type === 'shot' || event.type === 'empty' || event.type === 'jump') this.inputBuffer.consumeShot();
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
    // The chain being banked. It never opens a screen, so the shaft itself has to carry it.
    if (event.type === 'comboSettle') { this.flash = Math.max(this.flash, 0.08); this.burst(event.x, event.y, 0xf4e9ad, 24); this.label(event.x, event.y - 62, `${event.value} COMBO · ${event.stage ?? ''}`, '#f4e9ad', 16); }
    if (event.type === 'bossHit') { this.burst(event.x, event.y, 0xd9a0ff, 6); this.shake = Math.max(this.shake, 1.4); }
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
  private rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) { this.graphics.fillStyle(color, alpha).fillRect(Math.round(x), Math.round(y), w, h); }
  private draw() {
    const g = this.graphics, m = this.model, cam = m.cameraY;
    g.clear(); g.setPosition(this.shake && !this.reducedMotion ? (Math.random() - 0.5) * this.shake : 0, 0);
    const theme = m.stage.config.theme;
    this.rect(-8, 0, 466, 800, 0x10191c);
    this.surface(theme, cam);
    this.submerged(theme, cam);
    this.volcanic(theme, cam);
    this.collapsed(theme, cam);
    // Ancient pillars drift more slowly than the playable walls.
    for (let i = 0; i < 10; i++) {
      const y = ((i * 112 - cam * 0.24) % 1120 + 1120) % 1120 - 112;
      this.rect(55, y, 340, 1, theme.pillar, 0.42);
      for (const x of [86, 196, 306]) {
        this.rect(x, y, 1, 112, theme.pillar, 0.35);
        this.rect(x - 7, y + 6, 15, 4, theme.pillar, 0.3);
        this.rect(x - 5, y + 74, 11, 3, theme.pillar, 0.22);
      }
    }
    this.rect(0, 0, 28, 800, theme.wall); this.rect(422, 0, 28, 800, theme.wall);
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
    for (const f of m.platforms) {
      const y = f.y - cam;
      if (y < -20 || y > 820) continue;
      if (f.breakBlock) { this.breakBlock(f.x, y, f.width, f.breakBlock.hits, f.breakBlock.durability); continue; }
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
    const door = m.shop.entrance;
    if (door) {
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
      this.rect(coin.x - 1 - 6 * spin, cy - 7, 2 + 12 * spin, 14, 0xffd479, fade);
      this.rect(coin.x - 1 - 3 * spin, cy - 4, 1 + 6 * spin, 8, 0xfff0c0, fade * 0.9);
    }
    this.boss(cam);
    for (const enemy of m.enemies) if (enemy.alive) this.enemy(enemy, cam);
    for (const b of m.bullets) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / speed, uy = b.vy / speed;
      // A beam reads as one long streak; an ordinary round gets a short tail behind its heading.
      const steps = b.beam ? 10 : 3, stride = b.beam ? 18 : 8;
      for (let i = steps; i >= 1; i--) {
        this.rect(b.x - b.size - ux * stride * i, b.y - cam - 5 - uy * stride * i, b.size * 2, 10, 0xb9ef70, 0.08 + (steps - i) / steps * 0.14);
      }
      this.rect(b.x - b.size / 2, b.y - cam - 7, b.size, b.beam ? 18 : 12, 0xeaffaf);
    }
    const p = m.player, x = Math.round(p.x), y = Math.round(p.y - cam);
    if (p.invincible > 0) {
      g.lineStyle(1.5, 0xfba4b9, 0.55).strokeRoundedRect(x - 20, y - 25, 40, 50, 5);
      this.rect(x - 16, y - 30, 32, 3, 0x563744);
      this.rect(x - 16, y - 30, 32 * p.invincible, 3, 0xffb5c7);
    }
    if (!(p.invincible > 0 && Math.floor(p.invincible * 16) % 2)) {
      this.rect(x - 19, y - 21, 38, 43, 0xb9ef70, 0.035);
      this.rect(x - 13, y - 14, 26, 21, 0xc8f58b); this.rect(x - 9, y - 19, 18, 5, 0xc8f58b);
      this.rect(x - 10, y - 10, 20, 10, 0x243632); this.rect(x - 7, y - 8, 5, 4, 0xf2ffdb); this.rect(x + 3, y - 8, 5, 4, 0xf2ffdb);
      this.rect(x - 8, y + 7, 6, 8, 0x88af63); this.rect(x + 3, y + 7, 6, 8, 0x88af63); this.rect(x - 3, y + 3, 6, 17, 0xe9eedc);
      this.rect(x - 17, y, 5, 9, 0x85ac65); this.rect(x + 12, y, 5, 9, 0x85ac65);
    }
    for (const particle of this.particles) this.rect(particle.x, particle.y - cam, particle.size, particle.size, particle.color, Math.min(1, particle.life * 4));
    if (this.damageTime > 0 && this.damageSource) {
      const source = m.enemies.find(e => e.id === this.damageSource!.id) || this.damageSource;
      g.lineStyle(2, 0xffb2c6, this.damageTime / 0.3).strokeCircle(source.x, source.y - cam, 29 + (0.3 - this.damageTime) * 30);
      g.lineStyle(1, 0xffb2c6, this.damageTime / 0.6).lineBetween(x, y, source.x, source.y - cam);
    }
    this.heatHaze(cam);
    if (this.flash > 0) this.rect(0, 0, 450, 800, 0xfa5277, this.flash);
    // Subtle scanlines keep the whole world at the same visual texture.
    for (let y = 0; y < WORLD.height; y += 4) this.rect(0, y, 450, 1, 0x050b0d, 0.13);
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
  private breakBlock(x: number, y: number, width: number, hits: number, durability: number) {
    const wear = Math.min(1, hits / Math.max(1, durability));
    const thickness = BREAK_BLOCK_RULES.thickness;
    // The seam: one pixel of shadow either side so neighbours never read as one long slab.
    this.rect(x, y, width, thickness, 0x241b14);
    this.rect(x + 1, y, width - 2, thickness, 0x5d4a3a);
    this.rect(x + 1, y, width - 2, 4, hits ? 0xffb066 : 0xc8a882);
    this.rect(x + 1, y + thickness - 3, width - 2, 3, 0x3a2c22);
    // A rivet at each end marks the stone as built rather than grown.
    this.rect(x + 5, y + 6, 4, 4, 0x2b211a);
    this.rect(x + width - 9, y + 6, 4, 4, 0x2b211a);
    // Fractures: one more opens for every round this stone has taken.
    for (let i = 0; i < hits; i++) {
      const at = x + ((i + 1) * width) / (durability + 1);
      this.graphics.fillStyle(0x1b1410, 0.9).fillTriangle(at, y, at + 6, y + thickness, at - 5, y + thickness);
    }
    // A downward chevron rather than a word: label2 only carries the glyphs A, I and R, so any
    // caption here would have drawn nothing at all, and an arrow says the same in every language.
    const cx = x + width / 2, top = y + 4;
    this.graphics.fillStyle(0xffd2a0, 0.8 - wear * 0.45);
    this.graphics.fillTriangle(cx - 6, top, cx + 6, top, cx, top + 7);
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
  /** The king, its wind-ups and its shots. Telegraphs are always the loudest thing on screen. */
  private boss(cam: number) {
    const fight = this.model.boss;
    if (!fight.enabled) return;
    const body = fight.body, y = body.y - cam;
    const winding = fight.action?.state === 'telegraph';
    const live = fight.action?.state === 'active';

    // A sweep marks the exact band it will scour, before it ever hurts, and stays marked while
    // live. Drawing anything wider than fight.sweepBand would teach the player that the warning
    // lies -- they would flee a stripe that never actually hurts them.
    const band = fight.sweepBand;
    if (band && (winding || live)) {
      const side = fight.action?.side ?? fight.danger ?? -1;
      const beat = winding ? 0.1 + Math.abs(Math.sin(this.model.elapsed * 11)) * 0.18 : 0.34;
      this.rect(band.x, 0, band.width, 800, 0xff4d7a, beat);
      const edge = side === -1 ? band.x + band.width : band.x;
      for (let i = 0; i < 26; i++) this.rect(edge + (side === -1 ? -6 - i : 4 + i), 0, 2, 800, 0xff9ab4, beat * (1 - i / 26));
    }
    if (y > 830 || y + body.height < -40) return;

    if (winding && fight.action?.attack.id === 'magicShot') {
      // Three columns light up exactly where the shots will rise.
      const beat = 0.2 + Math.abs(Math.sin(this.model.elapsed * 13)) * 0.5;
      for (const offset of [-26, 0, 26]) for (let i = 0; i < 12; i++) this.rect(fight.x + offset - 2, y - 16 - i * 22, 4, 12, 0xd9a0ff, beat * (1 - i / 14));
    }
    const glow = winding ? 0xffd2a0 : 0xc0a7ed;
    this.rect(body.x - 4, y - 4, body.width + 8, body.height + 8, 0x9d7bd8, fight.defeated ? 0.1 : 0.18);
    this.rect(body.x, y, body.width, body.height, fight.defeated ? 0x4a3f63 : 0x2c2140);
    this.rect(body.x + 6, y + 6, body.width - 12, body.height - 20, glow, fight.defeated ? 0.25 : 0.55);
    // Horns and eyes: a silhouette that reads as the source of the attacks.
    this.graphics.fillStyle(glow).fillTriangle(body.x + 8, y, body.x + 16, y - 26, body.x + 26, y);
    this.graphics.fillStyle(glow).fillTriangle(body.x + body.width - 26, y, body.x + body.width - 16, y - 26, body.x + body.width - 8, y);
    if (!fight.defeated) {
      this.rect(fight.x - 22, y + 20, 13, 9, 0xff4d7a); this.rect(fight.x + 9, y + 20, 13, 9, 0xff4d7a);
      for (let i = 0; i < 5; i++) this.rect(body.x + 10 + i * 17, y + body.height, 8, 10 + (i % 2) * 6, 0x2c2140);
    }
    for (const shot of fight.shots) {
      const sy = shot.y - cam;
      if (sy < -20 || sy > 820) continue;
      this.rect(shot.x - 5, sy - 9, 10, 18, 0xd9a0ff);
      this.rect(shot.x - 2, sy - 15, 4, 8, 0xffffff, 0.8);
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
    if (type.silhouette === 'wing' && type.id === 'bat') {
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
