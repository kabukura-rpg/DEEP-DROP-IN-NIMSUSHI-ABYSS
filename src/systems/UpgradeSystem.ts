import { chooseUpgrades, isUpgradeAvailable, UPGRADES, type Upgrade } from '../data/upgrades';
import type { Stats } from '../data/balance';
import type { HealthSystem } from './HealthSystem';

/** Section completion is the sole entry point. Selection never advances or applies an effect. */
export class UpgradeSystem {
  private completed = new Set<string>();
  private counts: Record<string, number> = {};
  private offered: Upgrade[] = [];
  private pending: string | null = null;
  private section: string | null = null;
  constructor(private stats: Stats, private health: HealthSystem, private random = Math.random) {}
  get stacks(): Readonly<Record<string, number>> { return { ...this.counts }; }
  get choices(): readonly Upgrade[] { return [...this.offered]; }
  get selectedId() { return this.pending; }
  get sectionId() { return this.section; }
  begin(sectionId: string) {
    if (this.section !== null || this.completed.has(sectionId)) return false;
    this.section = sectionId; this.pending = null;
    this.offered = chooseUpgrades(this.stats, this.random, this.counts);
    return true;
  }
  select(id: string) {
    if (!this.offered.some(u => u.id === id)) return false;
    this.pending = id; return true;
  }
  confirm() {
    const upgrade = this.offered.find(u => u.id === this.pending);
    if (this.section === null || !upgrade || !this.apply(upgrade)) return false;
    this.completed.add(this.section); this.section = null; this.offered = []; this.pending = null;
    return true;
  }
  /** Legacy integration only; UI uses select + confirm to enforce offered choices. */
  applyLegacy(upgrade: Upgrade) {
    const canonical = UPGRADES.find(u => u.id === upgrade.id);
    if (!canonical || !this.apply(canonical)) return false;
    if (this.section !== null) this.completed.add(this.section);
    this.section = null; this.offered = []; this.pending = null;
    return true;
  }
  private apply(upgrade: Upgrade) {
    if (!isUpgradeAvailable(upgrade, this.stats, this.counts)) return false;
    upgrade.apply(this.stats, this.health);
    this.counts[upgrade.id] = (this.counts[upgrade.id] || 0) + 1;
    return true;
  }
}
