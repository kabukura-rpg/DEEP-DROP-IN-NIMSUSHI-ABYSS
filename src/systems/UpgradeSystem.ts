import { BASE_UPGRADE_CHOICES, UPGRADES, UPGRADE_TUNING, type Upgrade, type UpgradeId } from '../data/upgrades';

/**
 * Which of the twenty the run holds, and what a REST offers next.
 *
 * Owning nothing but the set is deliberate. An upgrade here is a fact the rest of the game reads
 * through `has`, not an effect this class applies -- so adding one is a rule in the system it
 * belongs to plus a row in the catalogue, and this file never grows a branch per upgrade.
 *
 * Offers are drawn uniformly from what the run does not already hold. PROVISIONAL / MEASUREMENT
 * REQUIRED: the original's own draw is not documented, and in particular whether an upgrade can be
 * offered twice in a run is unknown. One of each is the assumption here, so a long run walks through
 * the catalogue rather than being handed the same card again; a candidate that was passed over stays
 * in the pool and can come back at the next REST.
 */
export class UpgradeSystem {
  private held = new Set<UpgradeId>();
  private completed = new Set<string>();
  private offered: Upgrade[] = [];
  private pending: UpgradeId | null = null;
  private section: string | null = null;
  constructor(private random = Math.random) {}

  get acquired(): readonly UpgradeId[] { return [...this.held]; }
  get choices(): readonly Upgrade[] { return [...this.offered]; }
  get selectedId() { return this.pending; }
  get sectionId() { return this.section; }
  /** The single question the rest of the game asks. */
  has(id: UpgradeId) { return this.held.has(id); }
  /** YOUTH widens every REST after the one it was taken at. */
  get choiceCount() { return this.has('youth') ? UPGRADE_TUNING.youth.choices : BASE_UPGRADE_CHOICES; }
  /** Still to be found this run. */
  get pool(): readonly Upgrade[] { return UPGRADES.filter(u => !this.held.has(u.id)); }

  begin(sectionId: string) {
    if (this.section !== null || this.completed.has(sectionId)) return false;
    this.section = sectionId; this.pending = null;
    // Drawn without replacement from this run's remaining catalogue, so one screen never shows the
    // same card twice. The count is read before the choice is applied, which is why taking YOUTH
    // widens the NEXT rest rather than the one it was taken at.
    const pool = [...this.pool];
    const offers: Upgrade[] = [];
    while (offers.length < this.choiceCount && pool.length) {
      const pick = Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)));
      offers.push(pool.splice(pick, 1)[0]);
    }
    this.offered = offers;
    return true;
  }
  select(id: string) {
    if (!this.offered.some(u => u.id === id)) return false;
    this.pending = id as UpgradeId; return true;
  }
  /** Confirm the pending choice. The caller applies whatever the upgrade grants on acquisition. */
  confirm() {
    const chosen = this.offered.find(u => u.id === this.pending);
    if (this.section === null || !chosen || this.held.has(chosen.id)) return null;
    this.held.add(chosen.id);
    this.completed.add(this.section);
    this.section = null; this.offered = []; this.pending = null;
    return chosen;
  }
  /** Hand an upgrade over outside the REST flow. Used by tests and the dev harness. */
  grant(id: UpgradeId) {
    if (this.held.has(id)) return false;
    this.held.add(id);
    return true;
  }
  reset() {
    this.held.clear(); this.completed.clear();
    this.offered = []; this.pending = null; this.section = null;
  }
}
