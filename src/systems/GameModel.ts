import { WORLD, JUMP, WALL_JUMP, initialStats } from '../data/balance';
import { StageGenerator, START_PLATFORM, type Enemy, type Platform, type RoutePlatform } from './StageGenerator';
import { OxygenSystem } from './OxygenSystem';
import { HeatSystem } from './HeatSystem';
import { BreakablePlatformSystem, BREAK_RULES } from './BreakablePlatformSystem';
import { BossFightSystem } from './BossFightSystem';
import { GunModuleSystem } from './GunModuleSystem';
import { CoinSystem } from './CoinSystem';
import { ShopSystem } from './ShopSystem';
import { coinsFor } from '../data/coins';
import { AIR_CONTAINER_RULES, BREAK_BLOCK_RULES, EXIT_RULES, SHOP_DOOR, type AirBubble, type AirContainer, type StageExit } from '../data/structures';
import { DOODAD_RULES, type Doodad } from '../data/doodads';
import { insideSafeZone, SAFE_ZONE_RULES, type SafeZone } from '../data/safeZone';
import type { ShopOffer } from '../data/shop';
import { CHARGE_AMMO_BONUS, gunModule, STARTING_GUN_MODULE, volley, volleyRecoil, type GunModuleId } from '../data/gunModules';
import { BOSS, type BossPhase } from '../data/boss';
import { hazardBounds, hazardType, ventStateAt, type Hazard } from '../data/hazards';
import { pickupType, spawnGunModule, spawnPickup, type Pickup } from '../data/pickups';
import { HealthSystem, type DamageCause } from './HealthSystem';
import { comboTierFor } from '../data/combo';
import { UpgradeSystem } from './UpgradeSystem';
import { StageProgressionSystem } from './StageProgressionSystem';
import type { AreaId, SectionId } from '../data/areas';
import { enemyType } from '../data/enemies';
import { defaultTuning, sanitizeTuning, type PhysicsTuning } from './PhysicsTuning';
export type GameEvent = { type: 'shot' | 'empty' | 'land' | 'kill' | 'hurt' | 'upgrade' | 'over' | 'heal' | 'boss' | 'clear' | 'oxygen' | 'section' | 'ice' | 'vent' | 'crack' | 'collapse' | 'bossHit' | 'bossTelegraph' | 'bossFire' | 'bossPhase' | 'bossDown' | 'gunModule' | 'coin' | 'shopOpen' | 'shopBuy' | 'exitReady' | 'exit' | 'containerBreak' | 'blockCrack' | 'blockBreak' | 'jump' | 'wallJump' | 'comboSettle' | 'doodad' | 'timeVoid' | 'coinVein'; x: number; y: number; value?: number; stomp?: boolean; lifeUps?: number; overflow?: number; combo?: number; stage?: string; areaCleared?: string | null; bonus?: 'heart' | 'charge'; source?: { id: number; kind: Enemy['kind']; x: number; y: number } };
export interface Bullet {
  x: number; y: number; previousY: number; previousX: number;
  /** Velocity in px/s. Straight-down weapons simply carry vx = 0. */
  vx: number; vy: number;
  damage: number; size: number;
  /** Enemies this round may pass through beyond the first. */
  pierce: number;
  /** True: a BREAK BLOCK is damaged but does not stop it. */
  pierceBlocks: boolean;
  /** BREAK BLOCK ids already hit, so one round can never hit the same block twice. */
  blocks: Set<number>;
  range: number; travelled: number;
  /** Drawn as a streak instead of a pellet; damage still uses the ordinary path. */
  beam: boolean;
  hits: Set<number>; alive: boolean;
}
/** A plain downward round, exactly as MACHINE GUN fires it. Useful for fixtures and drops. */
export const plainBullet = (x: number, y: number, damage = 1, size = 4): Bullet => ({
  x, y, previousY: y, previousX: x, vx: 0, vy: 850, damage, size, pierce: 0,
  pierceBlocks: false, blocks: new Set(),
  range: 900, travelled: 0, beam: false, hits: new Set(), alive: true,
});
export class GameModel {
  stats = initialStats();
  player = { x: 225, y: WORLD.startY, vy: 0, vx: 0, width: 22, height: 30, invincible: 0, grounded: -1 };
  platforms: Platform[] = [{ ...START_PLATFORM }];
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  /** Scenery that reloads CHARGE when bounced off. Never an enemy, never a platform. */
  doodads: Doodad[] = [];
  /** Chambers cut into the shaft wall. Being inside one is what freezes the world outside it. */
  safeZones: SafeZone[] = [];
  bullets: Bullet[] = [];
  events: GameEvent[] = [];
  ammo = this.stats.maxAmmo;
  readonly health = new HealthSystem(this.stats.maxHp, () => this.running && !this.victorySealed, () => this.finish());
  readonly upgrades: UpgradeSystem;
  readonly stage: StageProgressionSystem;
  readonly oxygen = new OxygenSystem();
  readonly heat = new HeatSystem();
  readonly collapse = new BreakablePlatformSystem();
  readonly boss = new BossFightSystem();
  readonly gun = new GunModuleSystem();
  readonly coins = new CoinSystem();
  readonly shop = new ShopSystem();
  /** AREA 2's sealed air containers, and the bubbles a broken one released. */
  containers: AirContainer[] = [];
  bubbles: AirBubble[] = [];
  /** The way out of this SECTION, once the shaft has bottomed out. Null until then. */
  exit: StageExit | null = null;
  private nextBubbleId = 1;
  paused = false;
  /** True while the world is actually simulating: normal play and the boss fight alike. */
  get running() { return (this.state === 'playing' || this.state === 'boss') && !this.paused && !this.shop.open; }
  /**
   * The run is already won. The moment the king's HP reaches zero the fight is decided, so nothing
   * during the short collapse -- a stray demon, lava, drowning, overheating, a shot already in the
   * air -- may turn that victory into a GAME OVER. Routed through HealthSystem's own damage gate,
   * so every source is covered by this one predicate.
   */
  /** The SAFE ZONE the player is standing in, or null out in the shaft. */
  get safeZone(): SafeZone | null {
    const p = this.player;
    return this.safeZones.find(zone => insideSafeZone(zone, p.x, p.y)) ?? null;
  }
  /**
   * TIMEVOID. True while the player is inside a chamber: the shaft outside stops dead -- enemies,
   * rounds, collapse timers, the oxygen tank, the heat gauge, generation, the descent itself --
   * while the player keeps moving, jumping, wall jumping and firing inside. It is emphatically NOT
   * a pause: `running` stays true and the simulation keeps stepping.
   */
  get timeFrozen() { return this.safeZone !== null; }
  get victorySealed() { return this.state === 'clear' || (this.boss.enabled && this.boss.defeated); }
  get hp() { return this.health.currentHp; }
  set hp(value: number) { this.health.currentHp = value; }
  /** Depth inside the current SECTION; the only value SECTION CLEAR is judged on. */
  sectionDepth = 0;
  /** Metres banked by every SECTION already cleared in this run. */
  completedDepth = 0;
  /**
   * The run depth the game reports. A SECTION is worth exactly its planned length: hunting for
   * the exit below the goal is real descent, but it is never banked, so a cleared run still
   * totals 12 x 200m.
   */
  get bankedSectionDepth() {
    if (this.stage.boss) return 0;
    // Endless has no sections and therefore no cap; a real SECTION is worth its planned length.
    return this.stage.enabled ? Math.min(this.sectionDepth, this.stage.sectionLength) : this.sectionDepth;
  }
  get totalDepth() { return this.completedDepth + this.bankedSectionDepth; }
  get sectionLength() { return this.stage.sectionLength; }
  kills = 0;
  private comboValue = 0;
  get combo() { return this.comboValue; }
  set combo(value: number) { this.comboValue = value; }
  /** Raw ACTION state last step, so a held button jumps once rather than every frame. */
  private actionHeld = false;
  /**
   * Which wall the last WALL JUMP left from, so the same one cannot be ridden forever. Cleared by
   * touching the other wall or by any ordinary landing.
   */
  private wallJumpUsed: -1 | 0 | 1 = 0;
  /** Horizontal shove from a WALL JUMP, decaying. Zero at all other times. */
  private wallKick = 0;
  /** The wall most recently touched and how long ago, so contact survives the step that leaves it. */
  private wallTouchSide: -1 | 0 | 1 = 0;
  private wallTouchAge = Infinity;
  /**
   * Which way "up" is for every impulse the player receives -- a jump, a wall jump, and the
   * gunboots' recoil all go through this one value. The FINAL BOSS is planned to invert gravity
   * later; this exists so that becomes a change here rather than a hunt through the model. It is
   * NOT inverted anywhere yet, and projectile direction is deliberately still its own thing.
   */
  private readonly up = -1;
  /**
   * The world's own clock. It stops while the player is inside a SAFE ZONE, which is what TIMEVOID
   * is: `elapsed` keeps running for the player (recoil recovery, animation), while everything that
   * belongs to the shaft -- patrol sway, vent cycles -- is driven from this instead and simply does
   * not advance. Freezing by skipping updates alone would make the world JUMP on resume.
   */
  private worldElapsed = 0;
  /** The doodad currently underfoot, so one contact cannot reload every frame. */
  private doodadContact: number | null = null;
  maxCombo = 0;
  killScore = 0;
  cameraY = 0;
  elapsed = 0;
  cooldown = 0;
  state: 'playing' | 'upgrade' | 'boss' | 'over' | 'clear' | 'shop' = 'playing';
  private nextChunk = 0;
  private generator: StageGenerator;
  private random: () => number;
  private lastAirShot = -Infinity;
  constructor(public practice = false, random = Math.random, progression: 'stage' | 'endless' = 'stage') {
    this.random = random;
    this.stage = new StageProgressionSystem(progression === 'stage');
    this.upgrades = new UpgradeSystem(this.stats, this.health, random);
    // Preserve the existing read APIs without duplicating mutable health state.
    Object.defineProperty(this.stats, 'maxHp', { enumerable: true, get: () => this.health.maxHp });
    Object.defineProperty(this.player, 'invincible', { enumerable: true, get: () => this.health.invincibilityRemaining, set: (value: number) => { this.health.invincibilityRemaining = value; } });
    this.generator = new StageGenerator(random);
    if (practice) this.platforms = [{ id: -2, x: 115, y: 520, width: 220 }];
    else this.startSection();
  }
  get multiplier() { return (this.combo >= 8 ? 2 : this.combo >= 5 ? 1.5 : this.combo >= 3 ? 1.2 : 1) + (this.combo ? this.stats.comboBonus : 0); }
  get score() { return Math.floor(this.totalDepth) + this.killScore; }
  setPhysicsTuning(values: PhysicsTuning) {
    if (!this.practice) return;
    const oldMax = this.stats.maxAmmo;
    Object.assign(this.stats, sanitizeTuning(values));
    // Preserve spent rounds when resizing the magazine; no implicit mid-air reload.
    this.ammo = Math.max(0, Math.min(this.stats.maxAmmo, this.ammo + this.stats.maxAmmo - oldMax));
    this.player.vy = Math.min(this.player.vy, this.stats.maxFallSpeed);
  }
  resetPhysicsTuning() { this.setPhysicsTuning(defaultTuning()); }
  /** Present only for submerged areas; undefined restores the ordinary instant movement. */
  get water() { return this.practice ? undefined : this.boss.enabled ? this.boss.phase.water : this.stage.config.water; }
  /** The playable span; the player's body stops 12px short of the brickwork on either side. */
  private get leftEdge() { return WORLD.wall + 12; }
  private get rightEdge() { return WORLD.width - WORLD.wall - 12; }
  /** -1 pressed against the left wall, 1 against the right, 0 in open air. */
  get wallSide(): -1 | 0 | 1 {
    const p = this.player;
    if (p.x <= this.leftEdge + 0.5) return -1;
    if (p.x >= this.rightEdge - 0.5) return 1;
    return 0;
  }
  /**
   * The wall a WALL JUMP may leave from this frame, or 0 for none. It needs all of: being in the
   * air, touching a wall, steering AWAY from it, and not having just left that same wall. The last
   * condition is what stops a player climbing one wall forever; it clears on the other wall or on
   * any landing.
   */
  wallJumpSide(direction: number): -1 | 0 | 1 {
    if (this.player.grounded !== -1) return 0;
    // Live contact first, then contact remembered from the last fraction of a second. The grace is
    // not a nicety: steering away from a wall IS what breaks contact, so without it the move could
    // never be performed at all.
    const side = this.wallSide !== 0 ? this.wallSide
      : this.wallTouchAge <= WALL_JUMP.grace ? this.wallTouchSide : 0;
    if (side === 0 || side === this.wallJumpUsed) return 0;
    return Math.sign(direction) === -side ? side : 0;
  }
  /** Remember the wall under the player's shoulder right now, if there is one. */
  private noteWallTouch() {
    const side = this.wallSide;
    if (side !== 0) { this.wallTouchSide = side; this.wallTouchAge = 0; }
  }
  moveHorizontal(dt: number, direction: number) {
    if (!this.running) return;
    const p = this.player, input = Math.max(-1, Math.min(1, direction)), water = this.water;
    // Sampled before AND after the move: entering the frame against the wall counts, and so does
    // being pushed into it during the frame.
    this.noteWallTouch();
    // Touching the opposite wall re-arms the one already used, so a shaft can be zig-zagged down.
    if (this.wallJumpUsed !== 0 && this.wallSide === -this.wallJumpUsed) this.wallJumpUsed = 0;
    if (!water) {
      p.vx = 0;
      p.x = Math.max(this.leftEdge, Math.min(this.rightEdge, p.x + (input * this.stats.moveSpeed + this.wallKick) * dt));
      this.decayWallKick(dt);
      this.noteWallTouch();
      return;
    }
    // Submerged: steer towards the input speed instead of snapping to it, and drift on release.
    p.vx += (input * this.stats.moveSpeed - p.vx) * Math.min(1, water.responsiveness * dt);
    const next = Math.max(this.leftEdge, Math.min(this.rightEdge, p.x + (p.vx + this.wallKick) * dt));
    if (next === p.x) p.vx = 0;
    p.x = next;
    this.decayWallKick(dt);
    this.noteWallTouch();
  }
  /** The shove fades over WALL_JUMP.kickTime and is then exactly zero again. */
  private decayWallKick(dt: number) {
    if (this.wallKick === 0) return;
    this.wallKick *= Math.max(0, 1 - dt / WALL_JUMP.kickTime);
    if (Math.abs(this.wallKick) < 1) this.wallKick = 0;
  }
  /**
   * Fire one volley immediately, bypassing the module's trigger rules. Direct callers (and the
   * legacy single-shot path) use this; the held trigger goes through fireGun below.
   */
  shoot() {
    if (!this.running || this.cooldown > 0) return;
    const def = this.gun.module;
    this.cooldown = def.fireInterval;
    const p = this.player;
    // The last round always fires. A volley costs what it costs, but a magazine with anything left
    // in it can pay for one more shot; only an empty one refuses. Spending is clamped at zero.
    if (this.ammo <= 0) { this.emit('empty', p.x, p.y); return; }
    this.fireVolley(def.ammoCost, 0);
  }
  /** One trigger frame. The equipped module decides whether anything leaves the barrel. */
  private fireGun(dt: number, direction: number, firing: boolean) {
    const request = this.gun.update(dt, firing, this.ammo);
    if (request.kind === 'idle') return;
    if (request.kind === 'empty') { this.emit('empty', this.player.x, this.player.y); return; }
    this.fireVolley(request.cost, direction);
  }
  /**
   * Spend the rounds, kick the player and spawn the projectiles the module describes.
   *
   * The gunboots are boots: a heavy weapon genuinely throws the player upward rather than merely
   * slowing a fall. What stops that becoming flight is the existing recovery curve -- full recoil
   * returns only after 0.34s, so held fire pays 0.65x -- and each module's own fire interval. At
   * every module's rate, gravity over one interval outweighs the recoil that interval buys, so no
   * weapon climbs on its own trigger even though any of them can lift once.
   *
   * Rise is capped at the same speed as a fall, which is the natural symmetry and needs no number
   * of its own.
   */
  private fireVolley(cost: number, aim: number) {
    const p = this.player;
    const def = this.gun.module;
    this.ammo = Math.max(0, this.ammo - cost);
    const recovery = Math.max(0.65, Math.min(1, 0.65 + (this.elapsed - this.lastAirShot - def.fireInterval) / 0.18 * 0.35));
    const kick = volleyRecoil(def, this.stats) * recovery;
    p.vy = Math.max(-this.stats.maxFallSpeed, Math.min(this.stats.maxFallSpeed, p.vy + this.up * kick));
    this.lastAirShot = this.elapsed;
    for (const shot of volley(def, this.stats, aim)) {
      const x = p.x + shot.offsetX;
      this.bullets.push({
        x, y: p.y + 21, previousY: p.y + 21, previousX: x,
        vx: shot.vx, vy: shot.vy, damage: shot.damage, size: shot.size, pierce: shot.pierce,
        pierceBlocks: shot.blockPiercing, blocks: new Set(),
        range: shot.range, travelled: 0, beam: shot.beam, hits: new Set(), alive: true,
      });
    }
    this.emit('shot', p.x, p.y + 20);
  }
  /**
   * The ground half of ACTION. A jump leaves the floor at a fixed impulse -- see JUMP in
   * data/balance, which is a placeholder until the original is measured -- and deliberately peaks
   * well short of one row, so it repositions the player and starts a fall without ever undoing
   * descent already made.
   */
  jump() {
    const p = this.player;
    if (!this.running || p.grounded === -1) return false;
    p.vy = this.up * JUMP.impulse;
    p.grounded = -1;
    this.lastAirShot = -Infinity;
    this.emit('jump', p.x, p.y);
    return true;
  }
  /**
   * The wall half of ACTION. It costs no CHARGE, fires nothing, and leaves the chain alone -- it is
   * movement, not an attack. The shove away from the wall is a decaying horizontal push rather than
   * a velocity the player fights against, so steering back in still works once it has faded.
   */
  wallJump(side: -1 | 0 | 1 = this.wallJumpSide(0)) {
    if (!this.running || side === 0 || this.player.grounded !== -1) return false;
    const p = this.player;
    p.vy = this.up * WALL_JUMP.impulse;
    this.wallKick = -side * WALL_JUMP.kick;
    this.wallJumpUsed = side;
    this.lastAirShot = -Infinity;
    this.emit('wallJump', p.x, p.y);
    return true;
  }
  /** Swap the equipped weapon and hand out the crate's bonus through the ordinary systems. */
  equipGunModule(id: GunModuleId, bonus: 'heart' | 'charge') {
    this.gun.equip(id);
    this.applyModuleBonus(bonus);
  }
  /**
   * The bonus half of a gun module, on its own. HEART goes through HealthSystem so a full tank
   * still rolls into the existing overflow and LIFE UP; CHARGE is the same +2 magazine as ever.
   */
  private applyModuleBonus(bonus: 'heart' | 'charge') {
    if (bonus === 'heart') this.health.heal(1);
    else { this.stats.maxAmmo += CHARGE_AMMO_BONUS; this.ammo = this.stats.maxAmmo; }
  }
  step(dt: number, direction: number, firing: boolean) {
    if (!this.running) return;
    // The fight can end part-way through this step, so remember what we entered it as.
    const fighting = this.state === 'boss';
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.player;
    this.health.tick(dt);
    this.wallTouchAge += dt;
    const oldY = p.y;
    const wasFrozen = this.timeFrozen;
    this.moveHorizontal(dt, direction);
    // Decided after the move, so stepping into a chamber takes effect on the very frame it happens.
    const frozen = this.timeFrozen;
    if (frozen !== wasFrozen) this.events.push({ type: 'timeVoid', x: p.x, y: p.y, value: frozen ? 1 : 0 });
    if (!frozen) this.worldElapsed += dt;
    const ground = this.platforms.find(f => f.id === p.grounded);
    if (ground && p.x + 9 > ground.x && p.x - 9 < ground.x + ground.width) p.vy = 0;
    else { p.grounded = -1; p.vy = Math.min(this.stats.maxFallSpeed, p.vy + this.stats.gravity * (this.water?.gravity ?? 1) * dt); }
    // Nothing special is needed to keep a gate row openable. A row is several blocks edge to edge,
    // so stepping off one onto its neighbour is an ordinary landing and reloads in full, exactly as
    // stepping between ledges does everywhere else. A player who runs dry against a block walks one
    // block over and comes back with a full magazine; the block keeps the hits it has already taken.
    //
    // ONE ACTION, read by where the player is standing: on the ground it jumps, in the air it fires
    // the gunboots. Every input route -- keyboard, the FIRE button, a tap anywhere on the frame --
    // arrives here as `firing`, so there is no second path that could shoot from the ground.
    const pressed = firing && !this.actionHeld;
    this.actionHeld = firing;
    const wall = this.wallJumpSide(direction);
    if (p.grounded !== -1) {
      // Standing: the gunboots are not in use. The gun is still ticked with the trigger released so
      // its timers keep running and the next press in the air reads as a fresh one; any request it
      // returns is dropped, which is what makes "grounded ACTION never shoots" true without
      // exception -- including for the tail of a burst that was paid for before landing.
      this.gun.update(dt, false, this.ammo);
      if (pressed) this.jump();
    } else if (wall !== 0) {
      // Pressed against a wall and steering away from it: ACTION kicks off the wall and fires
      // nothing. Unlike standing, the gunboots are still live here -- they are simply not being
      // pressed -- so a BURST already paid for keeps unspooling rather than being swallowed.
      if (pressed) this.wallJump(wall);
      if (this.gun.bursting) this.fireGun(dt, direction, false);
      else this.gun.update(dt, false, this.ammo);
    } else {
      this.fireGun(dt, direction, firing);
    }
    p.y += p.vy * dt;
    this.holdInsideSafeZone(wasFrozen);
    if (!frozen) for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.hurtFlash = Math.max(0, (e.hurtFlash || 0) - dt);
      e.x = e.originX + Math.sin(this.worldElapsed * enemyType(e.kind).swaySpeed + e.phase) * e.range;
    }
    // Swept bullet collisions prevent fast projectiles tunneling through enemies. Rounds belong to
    // the shaft, so inside a chamber they hang exactly where they were -- including any fired from
    // in there, which is the whole idea of standing in stopped time.
    if (!frozen) for (const b of this.bullets) {
      if (!b.alive) continue;
      b.previousY = b.y; b.previousX = b.x;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // Reach is a weapon trait: PUNCHER dies quickly, LASER runs the length of the shaft.
      b.travelled += Math.hypot(b.vx, b.vy) * dt;
      if (b.travelled > b.range) { b.alive = false; continue; }
      // Angled rounds stop at the shaft walls rather than leaving the world.
      if (b.x < WORLD.wall || b.x > WORLD.width - WORLD.wall) { b.alive = false; continue; }
      if (this.boss.enabled && !this.boss.defeated) {
        const body = this.boss.body;
        // Measured against the round's real width, the same way enemies are: a wide PUNCHER or a
        // BIG BULLET that visibly overlaps the king must not read as a miss.
        if (b.x + b.size > body.x && b.x - b.size < body.x + body.width && b.y >= body.y && b.previousY <= body.y + body.height) {
          if (this.boss.damage(b.damage)) this.events.push({ type: 'bossDown', x: this.boss.x, y: this.boss.y });
          this.events.push({ type: 'bossHit', x: b.x, y: body.y, value: this.boss.ratio });
          // One hit per round, so a piercing LASER can never multi-hit the king.
          b.alive = false;
          continue;
        }
      }
      // A block is a wall: it stops the round and takes one hit off its own durability. Checked
      // before anything else in the shaft, so nothing is shot through a block still standing. Which
      // block a round meets is decided by its width, so a wide or angled weapon covers more of the
      // row per volley and a narrow one picks a single slot.
      for (const block of this.platforms) {
        if (!block.breakBlock || block.state === 'broken') continue;
        if (b.x + b.size < block.x || b.x - b.size > block.x + block.width) continue;
        if (b.y < block.y || b.previousY > block.y + BREAK_BLOCK_RULES.thickness) continue;
        // Never the same block twice, however many frames a round spends inside one. This is what
        // lets a LASER cross a row without grinding a single block down on its own.
        if (b.blocks.has(block.id)) continue;
        b.blocks.add(block.id);
        this.hitBreakBlock(block);
        if (!b.pierceBlocks) { b.alive = false; break; }
      }
      if (!b.alive) continue;
      for (const box of this.containers) {
        if (box.broken) continue;
        if (b.x > box.x - b.size && b.x < box.x + box.width + b.size && b.y >= box.y && b.previousY <= box.y + box.height) {
          this.breakContainer(box); b.alive = false; break;
        }
      }
      if (!b.alive) continue;
      // `shootable: false` is a real answer, not a miss: the round passes over such an enemy and
      // carries on to whatever is behind it. Landing on one is then the only way through.
      const targets = this.enemies.filter(e => e.alive && e.shootable !== false && !b.hits.has(e.id) && Math.abs(b.x - e.x) < 15 + b.size && b.previousY <= e.y + 15 && b.y >= e.y - 15).sort((a, z) => a.y - z.y);
      for (const e of targets) {
        b.hits.add(e.id); e.hp -= b.damage; e.flash = 0.1;
        if (e.hp <= 0) this.kill(e, false);
        if (b.hits.size > b.pierce) { b.alive = false; break; }
      }
    }
    // Contact with the shaft's inhabitants is part of the shaft: inside a chamber they cannot
    // reach the player, which is what makes it safe.
    if (!frozen) for (const e of this.enemies) {
      if (!e.alive || Math.abs(p.x - e.x) > 24) continue;
      const topCrossing = p.vy > 0 && oldY + 15 <= e.y - 10 && p.y + 15 >= e.y - 10;
      if (topCrossing && e.stompable) {
        this.kill(e, true); p.y = e.y - 28; p.vy = -this.stats.bounce; p.grounded = -1;
      } else if ((topCrossing || Math.abs(p.y - e.y) < 25) && p.invincible <= 0) this.hurt(e);
    }
    if (p.vy >= 0 && p.grounded === -1) {
      const land = this.platforms.filter(f => f.state !== 'broken' && p.x + 9 > f.x && p.x - 9 < f.x + f.width && oldY + 15 <= f.y && p.y + 15 >= f.y).sort((a, b) => a.y - b.y)[0];
      if (land) {
        p.y = land.y - 15; p.vy = 0; p.grounded = land.id; this.lastAirShot = -Infinity;
        this.emit('land', p.x, land.y);
        this.settleLanding(land);
        // A collapsing ledge still reloads in full; it just starts counting from this moment.
        if (this.collapse.land(land)) this.events.push({ type: 'crack', x: p.x, y: land.y, value: this.collapse.delay });
      }
    }
    for (const gone of frozen ? [] : this.collapse.tick(dt, this.platforms)) {
      this.events.push({ type: 'collapse', x: gone.x + gone.width / 2, y: gone.y, value: gone.width });
      if (p.grounded === gone.id) p.grounded = -1;
    }
    if (this.platforms.some(f => f.state === 'broken')) this.platforms = this.platforms.filter(f => f.state !== 'broken');
    if (this.boss.enabled && !frozen) this.tickBoss(dt);
    if (!frozen) {
      this.tickContainers(dt);
      this.tickBubbles(dt);
      if (this.coins.tick(dt, p, this.cameraY) > 0) this.events.push({ type: 'coin', x: p.x, y: p.y, value: this.coins.walletCoins });
    }
    // Picking things up and touching a chamber's own content are the player's doing, not the
    // world's, so they keep working inside: the gun module waiting in a chamber has to be takeable.
    this.collectPickups();
    this.tickSafeZones();
    this.tickDoodads(oldY);
    if (this.heat.enabled && !frozen) this.tickHeat(dt);
    // A contact check rather than a timer, and no chamber is cut where anything lethal stands, so
    // this stays live: nothing about stopped time should make walking into lava survivable.
    this.tickLethalTerrain();
    // Invulnerability delays a drowning hit but can never cancel it: the debt is only cleared once
    // HealthSystem actually accepts the damage.
    if (!frozen && this.oxygen.tick(dt) && this.damage(1, 'oxygen')) this.oxygen.consumeDamage();
    if (this.practice) {
      if (p.y > 840) { p.x = 225; p.y = 120; p.vy = 0; p.grounded = -1; this.ammo = this.stats.maxAmmo; this.lastAirShot = -Infinity; }
    } else {
      // The FINAL BOSS descends too, but it is won on the king's HP, not on metres. Banking that
      // descent would push TOTAL DEPTH past the planned 12 x 200m, and there is no section left to
      // complete, so depth accounting stops for the duration of the fight.
      if (!fighting && !frozen) {
        this.sectionDepth = Math.max(this.sectionDepth, (p.y - WORLD.startY) / WORLD.pixelsPerMeter);
        // Reaching the goal opens the way out; it never ends the SECTION by itself, so a fight,
        // a coin spray or a chase after a bubble is never cut short mid-action.
        if (!this.exit && this.stage.enabled && this.sectionDepth >= this.stage.sectionLength) this.openExit();
        this.enterExit();
      }
      // The doorway is reachable inside a chamber too, so this is the player's business rather than
      // the world's and runs either way.
      if (!fighting) this.enterShop();
      if (!frozen) {
        this.cameraY = Math.max(this.cameraY, p.y - WORLD.height * 0.37);
        this.generate();
        if (p.y > this.cameraY + WORLD.height + 50) this.killInstantly('fall');
      }
    }
    if (frozen) return;
    this.bullets = this.bullets.filter(b => b.alive && b.y < this.cameraY + WORLD.height + 150);
    this.platforms = this.platforms.filter(f => f.y > this.cameraY - 180);
    this.enemies = this.enemies.filter(e => e.alive && e.y > this.cameraY - 180);
    this.pickups = this.pickups.filter(item => !item.taken && item.y > this.cameraY - 180);
    this.hazards = this.hazards.filter(h => h.y + h.height > this.cameraY - 180);
    this.doodads = this.doodads.filter(d => d.y + d.height > this.cameraY - 180);
    this.safeZones = this.safeZones.filter(z => z.y + z.height > this.cameraY - 240);
  }
  /**
   * AREA 3's heat pass. Only hazards near the player are considered -- the run's whole hazard list
   * is already pruned to the camera band, and this narrows it again to what can actually radiate.
   */
  private tickHeat(dt: number) {
    const p = this.player;
    for (const hazard of this.hazards) {
      if (hazard.kind !== 'vent') continue;
      const next = ventStateAt(hazard, this.worldElapsed);
      if (next !== hazard.state) {
        hazard.state = next;
        if (next !== 'idle') this.events.push({ type: 'vent', x: hazard.x + hazard.width / 2, y: hazard.y, value: next === 'warning' ? 0 : 1 });
      }
    }
    const nearby = this.hazards.filter(h => Math.abs(h.y + h.height / 2 - p.y) < 320);
    if (this.heat.tick(dt, p.x, p.y, nearby) && this.damage(1, 'heat')) this.heat.consumeDamage();
  }
  /**
   * Terrain that kills on touch, run through in every AREA. Lava belongs to AREA 3's heat gimmick,
   * but SPIKE belongs to AREA 1 and AREA 2, which run no gauge at all -- so this pass deliberately
   * sits outside tickHeat, where it used to live and where a spike in a cold shaft would simply
   * never have been looked at. The cause comes from the hazard table, so the result screen names
   * what actually ended the run rather than guessing lava.
   */
  private tickLethalTerrain() {
    const p = this.player;
    for (const hazard of this.hazards) {
      if (!hazard.lethal) continue;
      const box = hazardBounds(hazard);
      if (p.x + 9 > box.x && p.x - 9 < box.x + box.width && p.y + 15 > box.y && p.y - 15 < box.y + box.height) {
        this.killInstantly(hazardType(hazard.kind).damageCause);
        return;
      }
    }
  }
  /**
   * One round into one BREAK BLOCK. Opening a block is terrain work, not a kill: it adds nothing to
   * COMBO, counts as no defeated enemy, raises no kill event, and never calls gun.rearm() --
   * forgetting a shot in progress belongs to a SECTION boundary and to nothing else.
   *
   * It may leave money, and that goes out through CoinSystem exactly as a corpse's does, so the
   * coins behave identically on the way to the wallet: they scatter, they can be missed, and
   * catching one is what raises walletCoins and scoreCoins.
   */
  private hitBreakBlock(block: Platform) {
    const state = block.breakBlock;
    if (!state || block.state === 'broken') return;
    state.hits++;
    const centre = block.x + block.width / 2;
    if (state.hits < state.durability) {
      this.events.push({ type: 'blockCrack', x: centre, y: block.y, value: state.durability - state.hits });
      return;
    }
    block.state = 'broken';
    if (this.player.grounded === block.id) this.player.grounded = -1;
    if (this.random() < BREAK_BLOCK_RULES.coinChance) this.coins.burst(centre, block.y, BREAK_BLOCK_RULES.coins, this.random);
    this.events.push({ type: 'blockBreak', x: centre, y: block.y, value: block.width });
  }
  /**
   * The FINAL BOSS, inside the ordinary simulation step. Its attacks only ever reach the player
   * through the same HealthSystem path as anything else, so invulnerability and death accounting
   * behave exactly as they do in the areas.
   */
  private tickBoss(dt: number) {
    const p = this.player;
    for (const signal of this.boss.update(dt, p)) {
      if (signal.kind === 'phase') { this.enterBossPhase(signal.phase); this.events.push({ type: 'bossPhase', x: p.x, y: p.y, value: signal.phase.id, stage: signal.phase.name }); }
      if (signal.kind === 'telegraph') this.events.push({ type: 'bossTelegraph', x: this.boss.x, y: this.boss.y, value: signal.side, stage: signal.attack });
      if (signal.kind === 'fire') this.events.push({ type: 'bossFire', x: this.boss.x, y: this.boss.y, value: signal.side, stage: signal.attack });
      if (signal.kind === 'cleared') { this.clearBoss(); return; }
    }
    if (this.boss.defeated) return;
    // Contact with the king costs a heart; it is never stompable and never lethal on its own.
    const body = this.boss.body;
    if (p.x + 9 > body.x && p.x - 9 < body.x + body.width && p.y + 15 > body.y && p.y - 15 < body.y + body.height) this.damage(1, 'bossContact');
    for (const shot of this.boss.shots) {
      if (Math.abs(shot.x - p.x) < 14 && Math.abs(shot.y - p.y) < 20) { this.damage(1, 'bossShot'); shot.y = -Infinity; }
    }
    if (this.boss.danger !== null && this.boss.dangerousAt(p.x)) this.damage(1, 'bossSweep');
    this.boss.shots = this.boss.shots.filter(shot => Number.isFinite(shot.y));
  }
  /**
   * A phase change swaps the generation recipe and hands the area systems over, mid-descent. The
   * previous phase's leftovers are cleared so nothing from AREA 2 lingers into AREA 3's fire.
   */
  private enterBossPhase(phase: BossPhase) {
    const p = this.player;
    this.oxygen.reset(phase.gimmicks?.oxygen === true);
    this.heat.reset(phase.gimmicks?.heat === true);
    this.collapse.reset(phase.plan.breakDelay ?? BREAK_RULES.delay);
    if (!this.oxygen.enabled) { this.containers = []; this.bubbles = []; this.pickups = this.pickups.filter(item => item.kind !== 'oxygenBubble'); }
    if (!this.heat.enabled) { this.hazards = []; this.pickups = this.pickups.filter(item => item.kind !== 'ice'); }
    if (!phase.gimmicks?.breakablePlatforms) for (const platform of this.platforms) { platform.breakable = false; platform.state = 'stable'; }
    p.vx = 0;
    // The shaft is generated a screen and a half ahead, so simply switching recipes would leave the
    // player falling through ~12s of the OLD phase's terrain while the NEW phase's gauge is already
    // draining -- long enough that PHASE 2 could strand them with no air in reach at all. Cut the
    // unseen tail off and restart the recipe just past the camera, carrying the deepest row that
    // stays so reachability across the seam is still guaranteed.
    const cut = Math.max(p.y + 240, this.cameraY + WORLD.height);
    this.platforms = this.platforms.filter(row => row.y <= cut);
    this.enemies = this.enemies.filter(e => e.y <= cut);
    this.pickups = this.pickups.filter(item => item.y <= cut);
    this.hazards = this.hazards.filter(h => h.y <= cut);
    this.doodads = this.doodads.filter(d => d.y <= cut);
    this.safeZones = this.safeZones.filter(z => z.y <= cut);
    const rows = this.platforms.filter((row): row is RoutePlatform => 'safeX' in row);
    const deepest = rows.reduce((low, row) => (row.y > low.y ? row : low), rows[0] ?? this.generator.lastRow);
    // Resume exactly one ordinary row-gap below the deepest row that survived, so the first new row
    // is as reachable as any other. Anything else can hand the generator an impossible jump.
    const resume = deepest.y + phase.plan.gap;
    this.generator = new StageGenerator(this.random, {
      plan: phase.plan, enemyPool: phase.enemyPool, water: phase.water,
      oxygen: this.oxygen.enabled, heat: this.heat.enabled, breakable: phase.gimmicks?.breakablePlatforms === true,
      startY: resume, previous: deepest,
    });
    this.nextChunk = Math.floor(resume / WORLD.chunkHeight);
  }
  /**
   * A chamber has a roof. Nothing else in the shaft does -- there has never been a ceiling to hit --
   * but a room that the gunboots fire you out through the top of is not a room. LASER's recoil alone
   * clears the chamber height, so without this, shooting inside one launches the player back into
   * the shaft and out of the stopped time they just walked into.
   *
   * Only applies to a player who was ALREADY inside at the start of the step, so falling in through
   * the opening from above still works; the way out is the way in, sideways.
   */
  private holdInsideSafeZone(wasInside: boolean) {
    if (!wasInside) return;
    const p = this.player;
    const zone = this.safeZones.find(z => p.x > z.x && p.x < z.x + z.width);
    if (!zone) return;
    const roof = zone.y + 6;
    if (p.y >= roof) return;
    p.y = roof;
    if (p.vy < 0) p.vy = 0;
  }

  /**
   * DOODADS. Landing on one from above fills CHARGE and bounces, and that is all it does: it is
   * scenery, not an enemy, so nothing here touches COMBO, the kill count, COIN, or damage. The
   * chain carries on, which is the point -- it is somewhere to reload when nothing is alive nearby.
   *
   * One contact fires once. The bounce alone would usually see to that, but the guard is explicit
   * so a small bounce could never turn into a free hover.
   */
  private tickDoodads(oldY: number) {
    const p = this.player;
    const touching = this.doodads.find(d => d.active && p.x + 9 > d.x && p.x - 9 < d.x + d.width && p.y + 15 > d.y - 2 && p.y - 15 < d.y + d.height);
    if (!touching) { this.doodadContact = null; return; }
    if (this.doodadContact === touching.id) return;
    // Only from above, and only while falling: brushing one sideways or clipping it from below is
    // just scenery, exactly as it is for an enemy.
    const fromAbove = p.vy > 0 && oldY + 15 <= touching.y + 2 && p.y + 15 >= touching.y;
    if (!fromAbove) return;
    this.doodadContact = touching.id;
    p.y = touching.y - 15;
    p.vy = this.up * DOODAD_RULES.bounce;
    p.grounded = -1;
    this.reloadCharge();
    this.lastAirShot = -Infinity;
    this.events.push({ type: 'doodad', x: touching.x + touching.width / 2, y: touching.y, value: this.combo });
  }
  /**
   * A chamber's own content. A COIN VEIN pays straight into the wallet through CoinSystem, once;
   * the gun module and the shop are the existing systems, reached by the existing paths, so nothing
   * about a weapon or a purchase can behave differently for being found in here.
   */
  private tickSafeZones() {
    const p = this.player;
    for (const zone of this.safeZones) {
      if (zone.taken || zone.content?.kind !== 'coinVein') continue;
      const vein = this.coinVeinBounds(zone);
      if (p.x + 9 < vein.x || p.x - 9 > vein.x + vein.width) continue;
      if (p.y + 15 < vein.y || p.y - 15 > vein.y + vein.height) continue;
      zone.taken = true;
      const paid = this.coins.grant(SAFE_ZONE_RULES.coinVein.coins);
      this.events.push({ type: 'coinVein', x: vein.x + vein.width / 2, y: vein.y, value: paid });
    }
  }
  /** Where a chamber's COIN VEIN stands: against the back wall, on the floor. */
  coinVeinBounds(zone: SafeZone) {
    const { width, height } = SAFE_ZONE_RULES.coinVein;
    const x = zone.side === -1 ? zone.x + 16 : zone.x + zone.width - 16 - width;
    return { x, y: zone.y + zone.height - height, width, height };
  }
  /** Contact breaks a container too, so a stomp and a shot are equally valid keys. */
  private tickContainers(dt: number) {
    const p = this.player;
    for (const box of this.containers) {
      if (box.broken) { box.debris = Math.max(0, box.debris - dt); continue; }
      if (p.x + 9 > box.x && p.x - 9 < box.x + box.width && p.y + 15 > box.y && p.y - 15 < box.y + box.height) this.breakContainer(box);
    }
    this.containers = this.containers.filter(box => (!box.broken || box.debris > 0) && box.y > this.cameraY - 180);
  }
  /**
   * Break one container. It restores nothing by itself: what it does is release bubbles, and only
   * touching a bubble is worth air. The bubbles climb, so they have to be chased.
   */
  private breakContainer(box: AirContainer) {
    if (box.broken) return;
    box.broken = true; box.debris = AIR_CONTAINER_RULES.debrisTime;
    const span = AIR_CONTAINER_RULES.bubblesMax - AIR_CONTAINER_RULES.bubblesMin;
    const count = AIR_CONTAINER_RULES.bubblesMin + Math.round(this.random() * span);
    for (let i = 0; i < count; i++) {
      this.bubbles.push({
        id: this.nextBubbleId++,
        x: box.x + box.width / 2, y: box.y + box.height / 2,
        vx: (this.random() * 2 - 1) * AIR_CONTAINER_RULES.riseSpread,
        vy: -AIR_CONTAINER_RULES.riseSpeed * (0.35 + this.random() * 0.35),
        life: AIR_CONTAINER_RULES.bubbleLife, taken: false,
      });
    }
    this.events.push({ type: 'containerBreak', x: box.x + box.width / 2, y: box.y + box.height / 2, value: count });
  }
  /** Released bubbles climb away and expire. Catching one is the only thing that restores air. */
  private tickBubbles(dt: number) {
    const p = this.player;
    for (const bubble of this.bubbles) {
      if (bubble.taken) continue;
      bubble.life -= dt;
      bubble.vy = Math.max(-AIR_CONTAINER_RULES.riseSpeed, bubble.vy - AIR_CONTAINER_RULES.riseAccel * dt);
      bubble.vx *= 0.985;
      bubble.x = Math.max(WORLD.wall, Math.min(WORLD.width - WORLD.wall, bubble.x + bubble.vx * dt));
      bubble.y += bubble.vy * dt;
      if (this.oxygen.enabled && Math.abs(bubble.x - p.x) < 24 && Math.abs(bubble.y - p.y) < 28) {
        bubble.taken = true;
        const restored = this.oxygen.add(AIR_CONTAINER_RULES.recovery);
        this.events.push({ type: 'oxygen', x: bubble.x, y: bubble.y, value: restored });
      }
    }
    this.bubbles = this.bubbles.filter(b => !b.taken && b.life > 0 && b.y > this.cameraY - 90);
  }
  /**
   * The goal has been reached: cut the unseen shaft below and lay the exit floor just past the
   * camera, so the way out appears a little further on rather than having been visible all along.
   */
  private openExit() {
    const cut = Math.max(this.player.y + 240, this.cameraY + WORLD.height);
    this.platforms = this.platforms.filter(row => row.y <= cut);
    this.enemies = this.enemies.filter(e => e.y <= cut);
    this.pickups = this.pickups.filter(item => item.y <= cut);
    this.hazards = this.hazards.filter(h => h.y <= cut);
    this.containers = this.containers.filter(box => box.y <= cut);
    this.doodads = this.doodads.filter(d => d.y <= cut);
    this.safeZones = this.safeZones.filter(z => z.y <= cut);
    const rows = this.platforms.filter((row): row is RoutePlatform => 'safeX' in row);
    const deepest = rows.reduce((low, row) => (row.y > low.y ? row : low), rows[0] ?? this.generator.frontierRow);
    const laid = this.generator.layExit(Math.max(cut, deepest.y + EXIT_RULES.depthMargin * WORLD.pixelsPerMeter), deepest);
    this.platforms.push(laid.floor);
    this.exit = laid.exit;
    this.events.push({ type: 'exitReady', x: laid.exit.x + laid.exit.width / 2, y: laid.exit.y });
  }
  /** Walking into the gate is what clears the SECTION. */
  private enterExit() {
    const e = this.exit, p = this.player;
    if (!e) return;
    if (p.x + 9 > e.x && p.x - 9 < e.x + e.width && p.y + 15 > e.y && p.y - 15 < e.y + e.height) {
      this.events.push({ type: 'exit', x: p.x, y: p.y });
      this.completeSection();
    }
  }
  /** Walking into the doorway opens the SHOP, which stops the world while it is open. */
  private enterShop() {
    const p = this.player;
    if (!this.shop.touches(p.x, p.y) || !this.shop.enter()) return;
    this.state = 'shop';
    this.events.push({ type: 'shopOpen', x: p.x, y: p.y, value: this.coins.walletCoins });
  }
  /** Leave the SHOP and carry on falling. */
  closeShop() {
    if (this.state !== 'shop') return false;
    this.shop.close();
    this.state = 'playing';
    return true;
  }
  /**
   * Buy one item. Coins leave the wallet only -- the score total is never touched -- and the
   * goods are applied through exactly the same calls a field pickup uses, so a bought weapon and
   * a found one can never behave differently.
   */
  buyShopItem(index: number) {
    if (this.state !== 'shop') return 'closed' as const;
    const result = this.shop.buy(index, this.coins, (offer: ShopOffer) => {
      if (offer.kind === 'gunModule' && offer.module) this.gun.equip(offer.module);
      else if (offer.kind === 'heart') this.applyModuleBonus('heart');
      else this.applyModuleBonus('charge');
    });
    if (result === 'bought') this.events.push({ type: 'shopBuy', x: this.player.x, y: this.player.y, value: this.coins.walletCoins });
    return result;
  }
  /** One collision path for every pickup; the effect comes from the table, never from the kind. */
  private collectPickups() {
    const p = this.player;
    for (const item of this.pickups) {
      if (item.taken) continue;
      const type = pickupType(item.kind);
      if (Math.abs(item.x - p.x) > type.radius + 12 || Math.abs(item.y - p.y) > type.radius + 17) continue;
      // An AREA's own pickup only exists while that gimmick is on. Gun modules are run-wide, so
      // they are never gated by which AREA the player happens to be in.
      if (type.category === 'environment' && (type.effect === 'oxygen' ? !this.oxygen.enabled : !this.heat.enabled)) continue;
      item.taken = true;
      if (type.effect === 'gunModule') {
        const id = item.module ?? STARTING_GUN_MODULE;
        const bonus = item.bonus ?? 'heart';
        this.equipGunModule(id, bonus);
        this.events.push({ type: 'gunModule', x: item.x, y: item.y, stage: gunModule(id).name, bonus, value: bonus === 'charge' ? CHARGE_AMMO_BONUS : 1 });
        continue;
      }
      const restored = type.effect === 'oxygen' ? this.oxygen.add(type.value) : this.heat.relieve(type.value);
      this.events.push({ type: type.effect === 'oxygen' ? 'oxygen' : 'ice', x: item.x, y: item.y, value: restored });
    }
  }
  /** SECTION CLEAR: opens the rest point. No healing, no reload, no stage advance until NEXT. */
  completeSection(sectionId = this.stage.id) {
    if (this.practice || this.state !== 'playing' || this.paused || !this.upgrades.begin(sectionId)) return false;
    this.state = 'upgrade';
    this.events.push({ type: 'upgrade', x: this.player.x, y: this.player.y, stage: this.stage.label, areaCleared: this.stage.isAreaFinale ? this.stage.areaName : null });
    return true;
  }
  selectUpgrade(id: string) { return this.state === 'upgrade' && this.upgrades.select(id); }
  /** NEXT: applies the one chosen card, then starts the next SECTION (or hands off to the boss). */
  confirmUpgrade() {
    if (this.state !== 'upgrade' || !this.upgrades.confirm()) return false;
    // Bank the planned section length, never the frame that overshot the goal, so a cleared run
    // totals exactly 12 x 200m. A death mid-section still reports completedDepth + sectionDepth.
    this.completedDepth += this.stage.sectionLength;
    const advance = this.stage.advance();
    // The boss has no section of its own, so the banked metres must not be counted twice.
    if (advance.boss) { this.startBossFight(); return true; }
    this.state = 'playing'; this.startSection();
    return true;
  }
  /** Opens the FINAL BOSS: the descent carries on, with the king holding station below. */
  private startBossFight() {
    this.sectionDepth = 0;
    this.state = 'boss';
    this.startSection();
    const phase = this.boss.phase;
    this.boss.start(this.player.y);
    this.enterBossPhase(phase);
    this.events.push({ type: 'boss', x: this.player.x, y: this.player.y, stage: this.stage.label });
  }
  /** Ends the run as GAME CLEAR. Called by the fight once the king has finished collapsing. */
  clearBoss() {
    if (this.state !== 'boss') return false;
    // Capture the fight length before the system is torn down; the result screen reads it after.
    this.bossClearTime = this.boss.elapsed;
    this.boss.reset();
    this.state = 'clear'; this.emit('clear', this.player.x, this.player.y);
    return true;
  }
  private bossClearTime = 0;
  /** Seconds the fight lasted, for the result screen. */
  get bossTime() { return this.boss.enabled ? this.boss.elapsed : this.bossClearTime; }
  /**
   * Development only: jump straight to a SECTION for gimmick testing. The production UI never calls
   * this; the dev entry at /tests/browser.html does.
   */
  jumpToStage(area: AreaId, section: SectionId) {
    if (this.practice) return false;
    this.stage.jumpTo(area, section);
    this.completedDepth = this.stage.plannedDepthBefore();
    this.paused = false; this.state = 'playing'; this.startSection();
    return true;
  }
  jumpToBoss() {
    if (this.practice) return false;
    this.stage.jumpToBoss();
    this.completedDepth = this.stage.plannedDepthBefore();
    this.paused = false;
    this.startBossFight();
    return true;
  }
  /**
   * Rebuilds the world for a SECTION. HP, MAX HP, overflow healing, upgrades and stacks are run
   * state and survive untouched; ammo is refilled because the rest point cannot reload.
   */
  private startSection() {
    const p = this.player;
    p.x = 225; p.y = WORLD.startY; p.vy = 0; p.grounded = -1;
    this.sectionDepth = 0; this.cameraY = 0; this.cooldown = 0; this.lastAirShot = -Infinity;
    this.platforms = [{ ...START_PLATFORM }]; this.enemies = []; this.bullets = []; this.nextChunk = 0;
    this.wallJumpUsed = 0; this.wallKick = 0; this.wallTouchSide = 0; this.wallTouchAge = Infinity;
    this.pickups = []; this.hazards = []; this.doodads = []; this.safeZones = []; p.vx = 0;
    this.doodadContact = null; this.worldElapsed = 0;
    this.containers = []; this.bubbles = []; this.exit = null;
    // Coins already banked stay banked; only the ones still lying on the floor are swept up.
    this.coins.clearLoose();
    // Whether this SECTION has a shop at all is decided once, here.
    this.shop.reset();
    if (!this.practice && this.state !== 'boss') this.shop.rollForSection(this.random);
    // A full tank and a cold gauge at every SECTION start. Both are environment, not health: HP
    // carries over untouched. The gun keeps its module and its grown magazine, but forgets the
    // shot it was in the middle of -- a burst owes its remaining rounds to the SECTION that paid
    // for them, not to the next one.
    this.gun.rearm();
    if (this.state !== 'boss') this.boss.reset();
    this.oxygen.reset(!this.practice && this.stage.config.gimmicks?.oxygen === true);
    this.heat.reset(!this.practice && this.stage.config.gimmicks?.heat === true);
    this.collapse.reset(this.stage.sectionPlan?.breakDelay ?? BREAK_RULES.delay);
    this.generator = new StageGenerator(this.random, { depthOffset: this.completedDepth, plan: this.stage.sectionPlan, enemyPool: this.stage.enemyPool, water: this.stage.config.water, oxygen: this.oxygen.enabled, heat: this.heat.enabled, breakable: !this.practice && this.stage.config.gimmicks?.breakablePlatforms === true, sectionLength: this.practice || this.state === 'boss' || !this.stage.enabled ? undefined : this.stage.sectionLength, shop: this.shop.available });
    this.reloadCharge();
    // COMBO deliberately survives: a SECTION boundary is not a landing, and the rest point banks
    // nothing. A chain carried out of 1-1 is still live at the top of 1-2.
    this.generate();
    // One signal for every way a SECTION can begin: run start, NEXT, or a development jump.
    this.events.push({ type: 'section', x: p.x, y: p.y, stage: this.stage.label });
  }
  heal(amount: number) {
    const result = this.health.heal(amount);
    if (result.restored || result.overflow || result.lifeUps) this.events.push({ type: 'heal', x: this.player.x, y: this.player.y, value: result.restored, overflow: result.overflow, lifeUps: result.lifeUps });
    return result;
  }
  damage(amount: number, cause: DamageCause = 'enemy', source?: Enemy) {
    if (!this.health.damage(amount, cause)) return false;
    // Being hit costs HP and nothing else: only a landing ends a chain. Losing a long chain to one
    // unlucky contact is what made holding a combo feel arbitrary rather than risky.
    if (source) source.hurtFlash = 0.3;
    this.events.push({ type: 'hurt', x: this.player.x, y: this.player.y, source: source ? { id: source.id, kind: source.kind, x: source.x, y: source.y } : undefined });
    return true;
  }
  killInstantly(cause: DamageCause) { return this.health.killInstantly(cause); }
  hurt(source?: Enemy) { this.damage(1, source ? enemyType(source.kind).damageCause : 'enemy', source); }
  private kill(enemy: Enemy, stomp: boolean) {
    enemy.alive = false; this.kills++; this.combo++; this.maxCombo = Math.max(this.combo, this.maxCombo);
    // Landing on a head is not landing on the ground: it refills CHARGE and the chain carries on,
    // which is the whole reason a stomp is worth going out of the way for.
    if (stomp) this.reloadCharge();
    const type = enemyType(enemy.kind);
    if (type.onDefeat === 'shatterNearby') {
      const hit = this.collapse.shatter(this.platforms, enemy.x, enemy.y);
      for (const platform of hit) this.events.push({ type: 'crack', x: platform.x + platform.width / 2, y: platform.y, value: 0 });
    }
    const drop = enemyType(enemy.kind).drop;
    if (drop && this.random() < (drop.chance ?? 1)) this.pickups.push(spawnPickup(drop.pickup, 900000 + enemy.id, enemy.x, enemy.y, this.random() * Math.PI * 2, true));
    // Every defeated enemy leaves money. The boss is not an Enemy and never reaches this path,
    // so the CLEAR sequence is untouched.
    this.coins.burst(enemy.x, enemy.y, coinsFor(type.threat), this.random);
    const points = Math.round(100 * this.multiplier * (stomp ? 1.5 : 1));
    this.killScore += points; this.events.push({ type: 'kill', x: enemy.x, y: enemy.y, value: points, stomp, combo: this.combo });
  }
  /**
   * Fill the magazine. This is ONE of the two things a landing does, and it is deliberately its own
   * call: a stomp reloads without banking a chain, and a future Safe Zone will need the same.
   * Reloading must never imply settling.
   */
  reloadCharge() { this.ammo = this.stats.maxAmmo; }
  /**
   * Bank the chain. The tier table decides what a landing at this COMBO is worth; the DEEPEST tier
   * it qualifies for is paid once, never the shallower ones as well. COIN goes out through the
   * ordinary CoinSystem drop, so it scatters and is collected exactly as a corpse's money is, and
   * a heart goes through HealthSystem so overflow and LIFE UP behave as they always have.
   *
   * Nothing here interrupts the run: no screen, no choice, just the payout and a label in the shaft.
   */
  settleCombo() {
    const combo = this.combo;
    const tier = comboTierFor(combo);
    this.combo = 0;
    if (!tier) return undefined;
    const p = this.player;
    if (tier.coins > 0) this.coins.burst(p.x, p.y, tier.coins, this.random);
    if (tier.maxCharge > 0) {
      this.stats.maxAmmo += tier.maxCharge;
      // The chain's own reward should not leave the player a round short of their new maximum.
      this.ammo = this.stats.maxAmmo;
    }
    if (tier.hearts > 0) this.heal(tier.hearts);
    this.events.push({ type: 'comboSettle', x: p.x, y: p.y, value: combo, combo, stage: tier.label });
    return tier;
  }
  /**
   * What touching down does, in one place: every kind of floor -- a plain ledge, a BREAK BLOCK, an
   * AREA 4 collapsing ledge, a SAFE ZONE chamber -- goes through this rather than repeating it.
   *
   * Reloading and settling stay two separate jobs, and this is the reason they have to be: a
   * chamber floor fills CHARGE and leaves the chain running, because shelter is not the ground a
   * chain is banked on. "Reloaded, therefore settled" would collapse the two and make a SAFE ZONE
   * the most expensive place in the game to stand.
   */
  private settleLanding(platform: Platform) {
    this.reloadCharge();
    if (platform.safeZone === undefined) this.settleCombo();
    // Touching down re-arms both walls: the lockout only ever stops riding ONE wall in mid-air.
    this.wallJumpUsed = 0;
    this.wallTouchAge = Infinity;
  }
  private finish() { if (this.state === 'over' || this.state === 'clear') return; this.state = 'over'; this.emit('over', this.player.x, this.player.y); }
  private generate() {
    while (!this.generator.finished && this.nextChunk * WORLD.chunkHeight < this.cameraY + WORLD.height + WORLD.chunkHeight) {
      const chunk = this.generator.chunk(this.nextChunk++);
      this.platforms.push(...chunk.platforms); this.enemies.push(...chunk.enemies);
      this.pickups.push(...chunk.pickups); this.hazards.push(...chunk.hazards);
      this.doodads.push(...chunk.doodads);
      for (const zone of chunk.safeZones) {
        this.safeZones.push(zone);
        // Content is materialised through the systems that already own it, so a module found in a
        // chamber and one found on a ledge are the same object taking the same path.
        const content = zone.content;
        if (!content) continue;
        const centre = Math.round(zone.x + zone.width / 2), floor = zone.y + zone.height;
        if (content.kind === 'gunModule') {
          this.pickups.push(spawnGunModule(zone.id + 1, centre, floor - 34, content.module ?? STARTING_GUN_MODULE, content.bonus ?? 'heart'));
        } else if (content.kind === 'shop') {
          this.shop.placeEntrance(Math.round(centre - SHOP_DOOR.width / 2), Math.round(floor - SHOP_DOOR.height), SHOP_DOOR.width, SHOP_DOOR.height);
        }
      }
      this.containers.push(...chunk.containers);
      if (chunk.shopDoor) this.shop.placeEntrance(chunk.shopDoor.x, chunk.shopDoor.y, chunk.shopDoor.width, chunk.shopDoor.height);
    }
  }
  private emit(type: GameEvent['type'], x: number, y: number) { this.events.push({ type, x, y }); }
}
