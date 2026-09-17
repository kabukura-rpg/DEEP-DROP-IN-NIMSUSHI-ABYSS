import { WORLD } from '../data/balance';
import { BOSS, BOSS_ATTACKS, BOSS_PHASES, bossPhaseAt, type BossAttack, type BossPhase } from '../data/boss';

export interface BossShot { id: number; x: number; y: number; vy: number }
/** What the king is doing right now. `telegraph` is always visible before `active` can hurt. */
export type BossActionState = 'idle' | 'telegraph' | 'active';
export interface BossAction { attack: BossAttack; state: Exclude<BossActionState, 'idle'>; timer: number; side: -1 | 1 }
export type BossSignal =
  | { kind: 'phase'; phase: BossPhase }
  | { kind: 'telegraph'; attack: BossAttack['id']; side: -1 | 1 }
  | { kind: 'fire'; attack: BossAttack['id']; side: -1 | 1 }
  | { kind: 'hurt' }
  | { kind: 'defeated' }
  | { kind: 'cleared' };

/**
 * The FINAL BOSS. It owns the king's HP, where it sits relative to the falling player, its attack
 * telegraphs and the phase it is in -- and nothing else. The gimmicks each phase turns on are the
 * very systems the areas used (oxygen, heat, collapsing ledges); this class only names them.
 */
export class BossFightSystem {
  enabled = false;
  hp: number = BOSS.maxHp;
  /** Seconds of fight, used for the clear time on the result screen. */
  elapsed = 0;
  defeated = false;
  /** Counts down the short collapse before GAME CLEAR. */
  private defeatTimer = 0;
  x = WORLD.width / 2;
  y = 0;
  phaseId: 1 | 2 | 3 | 4 = 1;
  shots: BossShot[] = [];
  action: BossAction | null = null;
  /** The half of the shaft a sweep is about to scour, while that attack is live. */
  danger: -1 | 1 | null = null;
  private cooldowns = new Map<string, number>();
  private nextShotId = 1;

  get maxHp() { return BOSS.maxHp; }
  get ratio() { return Math.max(0, Math.min(1, this.hp / BOSS.maxHp)); }
  get phase(): BossPhase { return BOSS_PHASES.find(p => p.id === this.phaseId) ?? BOSS_PHASES[0]; }
  /** The last stretch: the same attacks, just closer together. No new pattern ever appears. */
  get climax() { return this.enabled && !this.defeated && this.ratio <= BOSS.climaxRatio; }
  get body() { return { x: this.x - BOSS.bodyWidth / 2, y: this.y - BOSS.bodyHeight / 2, width: BOSS.bodyWidth, height: BOSS.bodyHeight }; }

  start(playerY: number) {
    this.enabled = true; this.hp = BOSS.maxHp; this.elapsed = 0; this.defeated = false; this.defeatTimer = 0;
    this.x = WORLD.width / 2; this.y = playerY + (BOSS.minGap + BOSS.maxGap) / 2;
    this.phaseId = 1; this.shots = []; this.action = null; this.danger = null;
    this.cooldowns.clear();
    for (const attack of BOSS_ATTACKS) this.cooldowns.set(attack.id, attack.cooldown * 0.6);
  }
  reset() { this.enabled = false; this.shots = []; this.action = null; this.danger = null; this.defeated = false; this.hp = BOSS.maxHp; this.elapsed = 0; }

  /** Player bullets land here. Returns true on the hit that finishes the fight. */
  damage(amount: number) {
    if (!this.enabled || this.defeated || !Number.isFinite(amount) || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return false;
    this.defeated = true; this.defeatTimer = BOSS.defeatDelay;
    this.action = null; this.danger = null; this.shots = [];
    return true;
  }

  /** The band a sweep covers, whether it is winding up or already live. */
  get sweepBand() {
    const side = this.action?.attack.id === 'sweep' ? this.action.side : this.danger;
    if (side === null || side === undefined) return null;
    return side === -1
      ? { x: WORLD.wall, width: BOSS.sweepWidth }
      : { x: WORLD.width - WORLD.wall - BOSS.sweepWidth, width: BOSS.sweepWidth };
  }
  /** True while a sweep is actually scouring the band the player is standing in. */
  dangerousAt(x: number) {
    if (this.danger === null) return false;
    const band = this.sweepBand;
    return !!band && x > band.x && x < band.x + band.width;
  }

  update(dt: number, player: { x: number; y: number }): BossSignal[] {
    const signals: BossSignal[] = [];
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return signals;
    this.elapsed += dt;

    // Hold station below the player: never so close that a shot cannot be dodged, never so far
    // that the player cannot answer.
    const gap = this.y - player.y;
    const wanted = gap < BOSS.minGap ? BOSS.minGap : gap > BOSS.maxGap ? BOSS.maxGap : gap;
    this.y = player.y + wanted;
    // The king only closes in between attacks. Once a wind-up starts it holds its column, so the
    // telegraph marks exactly where the attack will land and stepping aside always works.
    if (!this.action) {
      const towards = Math.sign(player.x - this.x);
      this.x = Math.max(WORLD.wall + BOSS.bodyWidth / 2, Math.min(WORLD.width - WORLD.wall - BOSS.bodyWidth / 2, this.x + towards * BOSS.drift * dt));
    }

    for (const shot of this.shots) shot.y += shot.vy * dt;
    this.shots = this.shots.filter(shot => shot.y > player.y - WORLD.height);

    if (this.defeated) {
      this.defeatTimer -= dt;
      if (this.defeatTimer <= 0) { this.enabled = false; signals.push({ kind: 'cleared' }); }
      return signals;
    }

    const phase = bossPhaseAt(this.ratio);
    if (phase.id !== this.phaseId) { this.phaseId = phase.id; signals.push({ kind: 'phase', phase }); }

    const speed = this.climax ? BOSS.climaxSpeed : 1;
    if (this.action) {
      this.action.timer -= dt;
      if (this.action.timer <= 0) {
        if (this.action.state === 'telegraph') {
          // The wind-up is over: only now can anything hurt.
          this.action.state = 'active';
          this.action.timer = this.action.attack.active;
          if (this.action.attack.id === 'magicShot') {
            for (const offset of [-26, 0, 26]) this.shots.push({ id: this.nextShotId++, x: this.x + offset, y: this.y - BOSS.bodyHeight / 2, vy: -BOSS.shotSpeed });
          } else this.danger = this.action.side;
          signals.push({ kind: 'fire', attack: this.action.attack.id, side: this.action.side });
        } else {
          this.cooldowns.set(this.action.attack.id, this.action.attack.cooldown * speed);
          this.danger = null;
          this.action = null;
        }
      }
      return signals;
    }

    let ready: BossAttack | undefined;
    for (const attack of BOSS_ATTACKS) {
      if (!attack.phases.includes(this.phaseId)) continue;
      const left = (this.cooldowns.get(attack.id) ?? 0) - dt;
      this.cooldowns.set(attack.id, left);
      if (left <= 0 && !ready) ready = attack;
    }
    if (ready) {
      // A sweep always scours the half the player is standing in, so moving is the answer.
      const side: -1 | 1 = player.x < WORLD.width / 2 ? -1 : 1;
      this.action = { attack: ready, state: 'telegraph', timer: ready.telegraph * speed, side };
      signals.push({ kind: 'telegraph', attack: ready.id, side });
    }
    return signals;
  }
}
