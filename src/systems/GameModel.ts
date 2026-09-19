import { WORLD, initialStats } from '../data/balance';
import { StageGenerator, START_PLATFORM, type AirPocket, type Enemy, type Platform, type RoutePlatform } from './StageGenerator';
import { OxygenSystem } from './OxygenSystem';
import { HeatSystem } from './HeatSystem';
import { BreakablePlatformSystem, BREAK_RULES } from './BreakablePlatformSystem';
import { BossFightSystem } from './BossFightSystem';
import { GunModuleSystem } from './GunModuleSystem';
import { CoinSystem } from './CoinSystem';
import { ShopSystem } from './ShopSystem';
import { coinsFor } from '../data/coins';
import { AIR_CONTAINER_RULES, BREAK_FLOOR_RULES, EXIT_RULES, type AirBubble, type AirContainer, type StageExit } from '../data/structures';
import type { ShopOffer } from '../data/shop';
import { CHARGE_AMMO_BONUS, gunModule, STARTING_GUN_MODULE, volley, volleyRecoil, type GunModuleId } from '../data/gunModules';
import { BOSS, type BossPhase } from '../data/boss';
import { hazardBounds, hazardType, ventStateAt, type Hazard } from '../data/hazards';
import { pickupType, spawnPickup, type Pickup } from '../data/pickups';
import { HealthSystem, type DamageCause } from './HealthSystem';
import { COMBO_RULES, comboRewardFor } from '../data/combo';
import { UpgradeSystem } from './UpgradeSystem';
import { StageProgressionSystem } from './StageProgressionSystem';
import type { AreaId, SectionId } from '../data/areas';
import { enemyType } from '../data/enemies';
import { defaultTuning, sanitizeTuning, type PhysicsTuning } from './PhysicsTuning';
export type GameEvent = { type: 'shot' | 'empty' | 'land' | 'kill' | 'hurt' | 'upgrade' | 'over' | 'heal' | 'boss' | 'clear' | 'oxygen' | 'airPocket' | 'section' | 'ice' | 'vent' | 'crack' | 'collapse' | 'bossHit' | 'bossTelegraph' | 'bossFire' | 'bossPhase' | 'bossDown' | 'gunModule' | 'coin' | 'shopOpen' | 'shopBuy' | 'exitReady' | 'exit' | 'containerBreak' | 'floorCrack' | 'floorBreak' | 'comboReward'; x: number; y: number; value?: number; stomp?: boolean; lifeUps?: number; overflow?: number; combo?: number; stage?: string; areaCleared?: string | null; bonus?: 'heart' | 'charge'; source?: { id: number; kind: Enemy['kind']; x: number; y: number } };
export interface Bullet {
  x: number; y: number; previousY: number; previousX: number;
  /** Velocity in px/s. Straight-down weapons simply carry vx = 0. */
  vx: number; vy: number;
  damage: number; size: number;
  /** Enemies this round may pass through beyond the first. */
  pierce: number;
  range: number; travelled: number;
  /** Drawn as a streak instead of a pellet; damage still uses the ordinary path. */
  beam: boolean;
  hits: Set<number>; alive: boolean;
}
/** A plain downward round, exactly as MACHINE GUN fires it. Useful for fixtures and drops. */
export const plainBullet = (x: number, y: number, damage = 1, size = 4): Bullet => ({
  x, y, previousY: y, previousX: x, vx: 0, vy: 850, damage, size, pierce: 0,
  range: 900, travelled: 0, beam: false, hits: new Set(), alive: true,
});
export class GameModel {
  stats = initialStats();
  player = { x: 225, y: WORLD.startY, vy: 0, vx: 0, width: 22, height: 30, invincible: 0, grounded: -1 };
  platforms: Platform[] = [{ ...START_PLATFORM }];
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  airPockets: AirPocket[] = [];
  hazards: Hazard[] = [];
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
  /** True while the player is inside an air pocket: the tank refills and nothing drains. */
  sheltered = false;
  paused = false;
  /** True while the world is actually simulating: normal play and the boss fight alike. */
  get running() { return (this.state === 'playing' || this.state === 'boss') && !this.paused && !this.shop.open; }
  /**
   * The run is already won. The moment the king's HP reaches zero the fight is decided, so nothing
   * during the short collapse -- a stray demon, lava, drowning, overheating, a shot already in the
   * air -- may turn that victory into a GAME OVER. Routed through HealthSystem's own damage gate,
   * so every source is covered by this one predicate.
   */
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
  private comboRewardClaimed = false;
  /** Rewards already paid out this run, so the table rotates instead of repeating. */
  private comboRewardsGranted = 0;
  get combo() { return this.comboValue; }
  set combo(value: number) { this.comboValue = value; if (value === 0) this.comboRewardClaimed = false; }
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
  moveHorizontal(dt: number, direction: number) {
    if (!this.running) return;
    const p = this.player, input = Math.max(-1, Math.min(1, direction)), water = this.water;
    if (!water) { p.vx = 0; p.x = Math.max(WORLD.wall + 12, Math.min(WORLD.width - WORLD.wall - 12, p.x + input * this.stats.moveSpeed * dt)); return; }
    // Submerged: steer towards the input speed instead of snapping to it, and drift on release.
    p.vx += (input * this.stats.moveSpeed - p.vx) * Math.min(1, water.responsiveness * dt);
    const next = Math.max(WORLD.wall + 12, Math.min(WORLD.width - WORLD.wall - 12, p.x + p.vx * dt));
    if (next === p.x) p.vx = 0;
    p.x = next;
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
    if (this.ammo < def.ammoCost) { this.emit('empty', p.x, p.y); return; }
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
   * Spend the rounds, brake the fall and spawn the projectiles the module describes.
   * Recoil brakes a fall; only stomping can create upward velocity. Full recoil returns after
   * 0.34s, so sustained fire brakes less and no module can hover on its own trigger.
   */
  private fireVolley(cost: number, aim: number) {
    const p = this.player;
    const def = this.gun.module;
    this.ammo = Math.max(0, this.ammo - cost);
    const recovery = Math.max(0.65, Math.min(1, 0.65 + (this.elapsed - this.lastAirShot - def.fireInterval) / 0.18 * 0.35));
    if (p.vy > 0) { p.vy = Math.max(0, p.vy - volleyRecoil(def, this.stats) * recovery); this.lastAirShot = this.elapsed; }
    for (const shot of volley(def, this.stats, aim)) {
      this.bullets.push({
        x: p.x, y: p.y + 21, previousY: p.y + 21, previousX: p.x,
        vx: shot.vx, vy: shot.vy, damage: shot.damage, size: shot.size, pierce: shot.pierce,
        range: shot.range, travelled: 0, beam: shot.beam, hits: new Set(), alive: true,
      });
    }
    this.emit('shot', p.x, p.y + 20);
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
    const oldY = p.y;
    this.moveHorizontal(dt, direction);
    const ground = this.platforms.find(f => f.id === p.grounded);
    if (ground && p.x + 9 > ground.x && p.x - 9 < ground.x + ground.width) p.vy = 0;
    else { p.grounded = -1; p.vy = Math.min(this.stats.maxFallSpeed, p.vy + this.stats.gravity * (this.water?.gravity ?? 1) * dt); }
    // A gate spans the shaft, so there is no edge to step off and no way to earn a reload the
    // ordinary way. Without this, landing on a 3-round AREA 3 gate holding the LASER -- four rounds
    // a shot against a six-round magazine -- leaves the run standing on a floor it can no longer
    // open, forever. A gate therefore always supplies the rounds needed to get through it.
    if (ground?.breakFloor && ground.state !== 'broken' && this.ammo < this.gun.module.ammoCost && this.ammo < this.stats.maxAmmo) {
      this.ammo = this.stats.maxAmmo;
      this.emit('land', p.x, ground.y);
    }
    this.fireGun(dt, direction, firing);
    p.y += p.vy * dt;
    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.hurtFlash = Math.max(0, (e.hurtFlash || 0) - dt);
      e.x = e.originX + Math.sin(this.elapsed * enemyType(e.kind).swaySpeed + e.phase) * e.range;
    }
    // Swept bullet collisions prevent fast projectiles tunneling through enemies.
    for (const b of this.bullets) {
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
      // A gate is a wall: it stops the round and takes one hit off its durability. Checked before
      // anything else in the shaft, so nothing can be shot through a floor that is still standing.
      for (const gate of this.platforms) {
        if (!gate.breakFloor || gate.state === 'broken') continue;
        if (b.x + b.size < gate.x || b.x - b.size > gate.x + gate.width) continue;
        if (b.y < gate.y || b.previousY > gate.y + BREAK_FLOOR_RULES.thickness) continue;
        this.hitBreakFloor(gate); b.alive = false; break;
      }
      if (!b.alive) continue;
      for (const box of this.containers) {
        if (box.broken) continue;
        if (b.x > box.x - b.size && b.x < box.x + box.width + b.size && b.y >= box.y && b.previousY <= box.y + box.height) {
          this.breakContainer(box); b.alive = false; break;
        }
      }
      if (!b.alive) continue;
      const targets = this.enemies.filter(e => e.alive && !b.hits.has(e.id) && Math.abs(b.x - e.x) < 15 + b.size && b.previousY <= e.y + 15 && b.y >= e.y - 15).sort((a, z) => a.y - z.y);
      for (const e of targets) {
        b.hits.add(e.id); e.hp -= b.damage; e.flash = 0.1;
        if (e.hp <= 0) this.kill(e, false);
        if (b.hits.size > b.pierce) { b.alive = false; break; }
      }
    }
    for (const e of this.enemies) {
      if (!e.alive || Math.abs(p.x - e.x) > 24) continue;
      const topCrossing = p.vy > 0 && oldY + 15 <= e.y - 10 && p.y + 15 >= e.y - 10;
      if (topCrossing && e.stompable) {
        this.kill(e, true); p.y = e.y - 28; p.vy = -this.stats.bounce; p.grounded = -1;
      } else if ((topCrossing || Math.abs(p.y - e.y) < 25) && p.invincible <= 0) this.hurt(e);
    }
    if (p.vy >= 0 && p.grounded === -1) {
      const land = this.platforms.filter(f => f.state !== 'broken' && p.x + 9 > f.x && p.x - 9 < f.x + f.width && oldY + 15 <= f.y && p.y + 15 >= f.y).sort((a, b) => a.y - b.y)[0];
      if (land) {
        p.y = land.y - 15; p.vy = 0; p.grounded = land.id; this.ammo = this.stats.maxAmmo; this.combo = 0; this.lastAirShot = -Infinity;
        this.emit('land', p.x, land.y);
        // A collapsing ledge still reloads in full; it just starts counting from this moment.
        if (this.collapse.land(land)) this.events.push({ type: 'crack', x: p.x, y: land.y, value: this.collapse.delay });
      }
    }
    for (const gone of this.collapse.tick(dt, this.platforms)) {
      this.events.push({ type: 'collapse', x: gone.x + gone.width / 2, y: gone.y, value: gone.width });
      if (p.grounded === gone.id) p.grounded = -1;
    }
    if (this.platforms.some(f => f.state === 'broken')) this.platforms = this.platforms.filter(f => f.state !== 'broken');
    if (this.boss.enabled) this.tickBoss(dt);
    this.tickContainers(dt);
    this.tickBubbles(dt);
    if (this.coins.tick(dt, p, this.cameraY) > 0) this.events.push({ type: 'coin', x: p.x, y: p.y, value: this.coins.walletCoins });
    this.collectPickups();
    this.sheltered = this.airPockets.some(a => p.x > a.x && p.x < a.x + a.width && p.y + 15 > a.y && p.y - 15 < a.y + a.height);
    if (this.heat.enabled) this.tickHeat(dt);
    this.tickLethalTerrain();
    // Invulnerability delays a drowning hit but can never cancel it: the debt is only cleared once
    // HealthSystem actually accepts the damage.
    if (this.oxygen.tick(dt, this.sheltered) && this.damage(1, 'oxygen')) this.oxygen.consumeDamage();
    if (this.practice) {
      if (p.y > 840) { p.x = 225; p.y = 120; p.vy = 0; p.grounded = -1; this.ammo = this.stats.maxAmmo; this.lastAirShot = -Infinity; }
    } else {
      // The FINAL BOSS descends too, but it is won on the king's HP, not on metres. Banking that
      // descent would push TOTAL DEPTH past the planned 12 x 200m, and there is no section left to
      // complete, so depth accounting stops for the duration of the fight.
      if (!fighting) {
        this.sectionDepth = Math.max(this.sectionDepth, (p.y - WORLD.startY) / WORLD.pixelsPerMeter);
        // Reaching the goal opens the way out; it never ends the SECTION by itself, so a fight,
        // a coin spray or a chase after a bubble is never cut short mid-action.
        if (!this.exit && this.stage.enabled && this.sectionDepth >= this.stage.sectionLength) this.openExit();
        this.enterExit();
        this.enterShop();
      }
      this.cameraY = Math.max(this.cameraY, p.y - WORLD.height * 0.37);
      this.generate();
      if (p.y > this.cameraY + WORLD.height + 50) this.killInstantly('fall');
    }
    this.bullets = this.bullets.filter(b => b.alive && b.y < this.cameraY + WORLD.height + 150);
    this.platforms = this.platforms.filter(f => f.y > this.cameraY - 180);
    this.enemies = this.enemies.filter(e => e.alive && e.y > this.cameraY - 180);
    this.pickups = this.pickups.filter(item => !item.taken && item.y > this.cameraY - 180);
    this.airPockets = this.airPockets.filter(a => a.y + a.height > this.cameraY - 180);
    this.hazards = this.hazards.filter(h => h.y + h.height > this.cameraY - 180);
  }
  /**
   * AREA 3's heat pass. Only hazards near the player are considered -- the run's whole hazard list
   * is already pruned to the camera band, and this narrows it again to what can actually radiate.
   */
  private tickHeat(dt: number) {
    const p = this.player;
    for (const hazard of this.hazards) {
      if (hazard.kind !== 'vent') continue;
      const next = ventStateAt(hazard, this.elapsed);
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
   * One round into a BREAK FLOOR gate. Opening a gate is terrain work, not a kill: it adds nothing
   * to COMBO, drops no COIN, counts as no defeated enemy, and never calls gun.rearm() -- forgetting
   * a shot in progress belongs to a SECTION boundary and to nothing else.
   */
  private hitBreakFloor(gate: Platform) {
    const floor = gate.breakFloor;
    if (!floor || gate.state === 'broken') return;
    floor.hits++;
    if (floor.hits < floor.durability) {
      this.events.push({ type: 'floorCrack', x: this.player.x, y: gate.y, value: floor.durability - floor.hits });
      return;
    }
    gate.state = 'broken';
    if (this.player.grounded === gate.id) this.player.grounded = -1;
    this.events.push({ type: 'floorBreak', x: gate.x + gate.width / 2, y: gate.y, value: gate.width });
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
    if (!this.oxygen.enabled) { this.airPockets = []; this.pickups = this.pickups.filter(item => item.kind !== 'oxygenBubble'); }
    if (!this.heat.enabled) { this.hazards = []; this.pickups = this.pickups.filter(item => item.kind !== 'ice'); }
    if (!phase.gimmicks?.breakablePlatforms) for (const platform of this.platforms) { platform.breakable = false; platform.state = 'stable'; }
    this.sheltered = false; p.vx = 0;
    // The shaft is generated a screen and a half ahead, so simply switching recipes would leave the
    // player falling through ~12s of the OLD phase's terrain while the NEW phase's gauge is already
    // draining -- long enough that PHASE 2 could strand them with no air in reach at all. Cut the
    // unseen tail off and restart the recipe just past the camera, carrying the deepest row that
    // stays so reachability across the seam is still guaranteed.
    const cut = Math.max(p.y + 240, this.cameraY + WORLD.height);
    this.platforms = this.platforms.filter(row => row.y <= cut);
    this.enemies = this.enemies.filter(e => e.y <= cut);
    this.pickups = this.pickups.filter(item => item.y <= cut);
    this.airPockets = this.airPockets.filter(pocket => pocket.y <= cut);
    this.hazards = this.hazards.filter(h => h.y <= cut);
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
    this.airPockets = this.airPockets.filter(a => a.y <= cut);
    this.hazards = this.hazards.filter(h => h.y <= cut);
    this.containers = this.containers.filter(box => box.y <= cut);
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
    this.pickups = []; this.airPockets = []; this.hazards = []; this.sheltered = false; p.vx = 0;
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
    this.ammo = this.stats.maxAmmo;
    this.combo = 0;
    this.generate();
    // One signal for every way a SECTION can begin: run start, NEXT, or a development jump.
    this.events.push({ type: 'section', x: p.x, y: p.y, stage: this.stage.label });
  }
  heal(amount: number, comboReward = false) {
    const result = this.health.heal(amount);
    if (result.restored || result.overflow || result.lifeUps) this.events.push({ type: 'heal', combo: comboReward ? this.combo : undefined, x: this.player.x, y: this.player.y, value: result.restored, overflow: result.overflow, lifeUps: result.lifeUps });
    return result;
  }
  damage(amount: number, cause: DamageCause = 'enemy', source?: Enemy) {
    if (!this.health.damage(amount, cause)) return false;
    this.combo = 0;
    if (source) source.hurtFlash = 0.3;
    this.events.push({ type: 'hurt', x: this.player.x, y: this.player.y, source: source ? { id: source.id, kind: source.kind, x: source.x, y: source.y } : undefined });
    return true;
  }
  killInstantly(cause: DamageCause) { return this.health.killInstantly(cause); }
  hurt(source?: Enemy) { this.damage(1, source ? enemyType(source.kind).damageCause : 'enemy', source); }
  private kill(enemy: Enemy, stomp: boolean) {
    enemy.alive = false; this.kills++; this.combo++; this.maxCombo = Math.max(this.combo, this.maxCombo);
    if (this.combo >= COMBO_RULES.rewardAt && !this.comboRewardClaimed) this.grantComboReward();
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
   * The COMBO payout. It fires once per chain -- `comboRewardClaimed` is cleared the moment COMBO
   * returns to zero, which every landing and every hit taken does -- and never interrupts the run:
   * no screen, no choice, just the reward and a label in the shaft.
   *
   * The reward is applied through applyModuleBonus, exactly the call a gun-module crate and a shop
   * purchase use, so HealthSystem still owns healing, overflow and LIFE UP and a combo reward can
   * never behave differently from any other way the game hands out the same thing.
   */
  private grantComboReward() {
    this.comboRewardClaimed = true;
    const reward = comboRewardFor(this.comboRewardsGranted++);
    // A heart routes through heal() rather than applyModuleBonus so the existing overflow and
    // LIFE UP feedback still reaches the player.
    if (reward.bonus === 'heart') this.heal(1, true);
    else this.applyModuleBonus('charge');
    this.events.push({ type: 'comboReward', x: this.player.x, y: this.player.y, value: this.combo, combo: this.combo, bonus: reward.bonus, stage: reward.label });
  }
  private finish() { if (this.state === 'over' || this.state === 'clear') return; this.state = 'over'; this.emit('over', this.player.x, this.player.y); }
  private generate() {
    while (!this.generator.finished && this.nextChunk * WORLD.chunkHeight < this.cameraY + WORLD.height + WORLD.chunkHeight) {
      const chunk = this.generator.chunk(this.nextChunk++);
      this.platforms.push(...chunk.platforms); this.enemies.push(...chunk.enemies);
      this.pickups.push(...chunk.pickups); this.airPockets.push(...chunk.airPockets); this.hazards.push(...chunk.hazards);
      this.containers.push(...chunk.containers);
      if (chunk.shopDoor) this.shop.placeEntrance(chunk.shopDoor.x, chunk.shopDoor.y, chunk.shopDoor.width, chunk.shopDoor.height);
    }
  }
  private emit(type: GameEvent['type'], x: number, y: number) { this.events.push({ type, x, y }); }
}
