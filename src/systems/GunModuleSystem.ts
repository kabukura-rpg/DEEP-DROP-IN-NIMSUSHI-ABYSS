import { gunModule, STARTING_GUN_MODULE, type GunModuleDefinition, type GunModuleId } from '../data/gunModules';

/** What the trigger produced this frame. */
export type GunRequest =
  /** Nothing happens: on cooldown, trigger not pressed, or semi-auto still held. */
  | { kind: 'idle' }
  /** The trigger was pressed but the magazine cannot pay for the volley. */
  | { kind: 'empty' }
  /** Fire one volley now, charging `cost` rounds (0 for the tail of a burst). */
  | { kind: 'fire'; cost: number };

/**
 * Owns which gun module is equipped and when it is allowed to fire: rate of fire, semi-auto edge
 * detection and multi-round bursts. It knows nothing about the player, the world or damage -- the
 * projectiles themselves come from `volley()` in the data table, so adding a weapon never means
 * adding a branch here.
 */
export class GunModuleSystem {
  id: GunModuleId = STARTING_GUN_MODULE;
  private cooldown = 0;
  /** Rounds still to leave the barrel from the current burst, already paid for. */
  private burstLeft = 0;
  private burstTimer = 0;
  private wasFiring = false;
  /** How long a semi-automatic press stays valid, so one landing near a cooldown is not lost. */
  private static readonly PRESS_MEMORY = 0.12;
  private pressBuffer = 0;

  get module(): GunModuleDefinition { return gunModule(this.id); }
  get name() { return this.module.name; }
  get short() { return this.module.short; }
  get ammoCost() { return this.module.ammoCost; }
  /** True while a burst is still unspooling, so callers can tell it apart from a fresh press. */
  get bursting() { return this.burstLeft > 0; }

  /**
   * Swap the weapon outright. Only one module is ever equipped, and any burst still in flight is
   * dropped so the new gun cannot inherit the old one's queued rounds.
   */
  equip(id: GunModuleId) {
    const changed = this.id !== id;
    this.id = id;
    this.burstLeft = 0; this.burstTimer = 0;
    this.cooldown = Math.max(this.cooldown, 0);
    return changed;
  }

  reset() {
    this.id = STARTING_GUN_MODULE;
    this.cooldown = 0; this.burstLeft = 0; this.burstTimer = 0; this.wasFiring = false; this.pressBuffer = 0;
  }

  /**
   * Advance timers and decide whether a volley leaves the barrel this frame.
   * `firing` is the raw held state; semi-automatic modules only answer to a fresh press.
   */
  update(dt: number, firing: boolean, ammo: number): GunRequest {
    const def = this.module;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const pressed = firing && !this.wasFiring;
    this.wasFiring = firing;
    // A press that arrives during the tail of a cooldown is remembered rather than dropped: without
    // this, holding the trigger through a cooldown silently eats the shot.
    this.pressBuffer = Math.max(0, this.pressBuffer - dt);
    if (pressed) this.pressBuffer = GunModuleSystem.PRESS_MEMORY;

    // The tail of a burst is already paid for and keeps going regardless of the trigger, so a
    // landing reload part-way through cannot make it fire twice.
    if (this.burstLeft > 0) {
      this.burstTimer = Math.max(0, this.burstTimer - dt);
      if (this.burstTimer > 0) return { kind: 'idle' };
      this.burstLeft--;
      this.burstTimer = def.burst?.interval ?? 0;
      if (this.burstLeft === 0) this.cooldown = def.fireInterval;
      return { kind: 'fire', cost: 0 };
    }

    if (this.cooldown > 0) return { kind: 'idle' };
    if (!(def.automatic ? firing : this.pressBuffer > 0)) return { kind: 'idle' };
    if (ammo < def.ammoCost) { this.cooldown = def.fireInterval; return { kind: 'empty' }; }

    // One press buys exactly one volley.
    this.pressBuffer = 0;
    if (def.burst) {
      // Charge the whole burst up front; the remaining rounds are free.
      this.burstLeft = def.burst.count - 1;
      this.burstTimer = def.burst.interval;
      return { kind: 'fire', cost: def.ammoCost };
    }
    this.cooldown = def.fireInterval;
    return { kind: 'fire', cost: def.ammoCost };
  }
}
