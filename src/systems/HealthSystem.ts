/**
 * Healing, overflow and invulnerability. The COMBO reward used to be specified here as well
 * (comboRewardAt / comboHealing); it now lives in data/combo.ts in one place, so there is no second
 * threshold to fall out of step with it.
 */
export const HEALTH_RULES = { overflowPerLife: 4, fillNewHeart: true, invincibilitySeconds: 1 } as const;
export type DamageCause =
  | 'enemy' | 'spike' | 'tank' | 'oxygen' | 'heat' | 'lava' | 'fall'
  /** The FINAL BOSS hurts in three distinguishable ways, so a death report can name which. */
  | 'bossContact' | 'bossShot' | 'bossSweep';
export interface HealthLoss { cause: DamageCause; instant: boolean; amount: number }
export interface HealingResult { restored: number; overflow: number; lifeUps: number }

/** The sole owner of HP, invulnerability, overflow and death accounting. */
export class HealthSystem {
  private hp: number;
  private maximum: number;
  overflowHealing = 0;
  invincibilityRemaining = 0;
  lastDamage: HealthLoss | null = null;
  deathCause: HealthLoss | null = null;
  constructor(maxHp = 4, private canTakeDamage = () => true, private onDeath = () => {}, public readonly rules: { overflowPerLife: number; fillNewHeart: boolean; invincibilitySeconds: number } = HEALTH_RULES) {
    this.maximum = maxHp; this.hp = maxHp;
  }
  get currentHp() { return this.hp; }
  // Compatibility for saved/debug fixtures; gameplay uses damage/heal/lifeUp.
  set currentHp(value: number) { this.hp = Math.max(0, Math.min(this.maximum, value)); }
  get maxHp() { return this.maximum; }
  tick(dt: number) { this.invincibilityRemaining = Math.max(0, this.invincibilityRemaining - dt); }
  damage(amount: number, cause: DamageCause = 'enemy') {
    if (!this.canTakeDamage() || this.hp <= 0 || this.invincibilityRemaining > 0 || !Number.isFinite(amount) || amount <= 0) return false;
    const loss = { cause, instant: false, amount: Math.min(this.hp, amount) };
    this.hp -= loss.amount; this.invincibilityRemaining = this.rules.invincibilitySeconds;
    this.recordLoss(loss); return true;
  }
  killInstantly(cause: DamageCause) {
    if (!this.canTakeDamage() || this.hp <= 0) return false;
    const loss = { cause, instant: true, amount: this.hp };
    this.hp = 0; this.recordLoss(loss); return true;
  }
  heal(amount: number): HealingResult {
    if (this.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return { restored: 0, overflow: 0, lifeUps: 0 };
    const restored = Math.min(amount, this.maximum - this.hp), overflow = amount - restored;
    this.hp += restored; this.overflowHealing += overflow;
    const lifeUps = Math.floor(this.overflowHealing / this.rules.overflowPerLife);
    this.overflowHealing -= lifeUps * this.rules.overflowPerLife;
    if (lifeUps) this.lifeUp(lifeUps);
    return { restored, overflow, lifeUps };
  }
  lifeUp(amount = 1) {
    if (this.hp <= 0 || !Number.isInteger(amount) || amount <= 0) return;
    this.maximum += amount;
    if (this.rules.fillNewHeart) this.hp += amount;
  }
  private recordLoss(loss: HealthLoss) {
    this.lastDamage = loss;
    if (this.hp === 0) { this.deathCause = loss; this.onDeath(); }
  }
}
