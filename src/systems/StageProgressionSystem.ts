import { AREAS, FINAL_STAGE, areaConfig, type AreaConfig, type AreaId, type SectionId, type SectionPlan } from '../data/areas';

export interface RunProgress { area: AreaId; section: SectionId; boss: boolean }
/** What a single SECTION CLEAR moved the run to; the UI turns this into its banner. */
export interface StageAdvance { from: string; to: string; areaCleared: string | null; boss: boolean }

/**
 * The sole owner of "where in the run am I": AREA, SECTION, the 4-3 -> FINAL BOSS hand-off and the
 * reset back to 1-1. It never touches depth, HP or upgrades; GameModel asks it and acts.
 */
export class StageProgressionSystem {
  private area: AreaId = 1;
  private section: SectionId = 1;
  private bossReached = false;
  clearedSections = 0;
  constructor(public readonly enabled = true, private readonly areas: readonly AreaConfig[] = AREAS) {}

  get progress(): RunProgress { return { area: this.area, section: this.section, boss: this.bossReached }; }
  get boss() { return this.bossReached; }
  get config(): AreaConfig { return areaConfig(this.area, this.areas); }
  get sectionLength() { return this.config.sectionLength; }
  /** Generation recipe for the SECTION standing in. Undefined areas fall back to the depth curve. */
  get sectionPlan(): SectionPlan | undefined { return this.bossReached ? undefined : this.config.plans?.[this.section - 1]; }
  get enemyPool() { return this.config.enemyPool; }
  /** True on the first SECTION of an AREA, where the UI announces the area by name. */
  get isAreaOpening() { return !this.bossReached && this.section === 1; }
  get id() { return this.bossReached ? FINAL_STAGE.id : `${this.area}-${this.section}`; }
  get label() { return this.bossReached ? FINAL_STAGE.label : this.id; }
  get areaName() { return this.bossReached ? FINAL_STAGE.name : this.config.name; }
  /** True while standing in the last SECTION of the current AREA, so the UI can announce it early. */
  get isAreaFinale() { return !this.bossReached && this.section >= this.config.sections; }
  get isFinalSection() { return this.isAreaFinale && !this.areas.some(a => a.id > this.area); }
  /** SECTION CLEAR is purely section-local depth; the boss has no depth goal. */
  isComplete(sectionDepth: number) { return this.enabled && !this.bossReached && sectionDepth >= this.sectionLength; }
  /** Planned metres before the current section, used to keep difficulty scaling with the whole run. */
  plannedDepthBefore() {
    return this.areas.reduce((total, area) => {
      if (area.id < this.area) return total + area.sectionLength * area.sections;
      if (area.id === this.area) return total + area.sectionLength * (this.bossReached ? area.sections : this.section - 1);
      return total;
    }, 0);
  }

  advance(): StageAdvance {
    const from = this.label;
    if (this.bossReached) return { from, to: from, areaCleared: null, boss: true };
    this.clearedSections++;
    const areaName = this.config.name;
    if (this.section < this.config.sections) {
      this.section = (this.section + 1) as SectionId;
      return { from, to: this.label, areaCleared: null, boss: false };
    }
    const next = this.areas.find(a => a.id > this.area);
    if (next) {
      this.area = next.id; this.section = 1;
      return { from, to: this.label, areaCleared: areaName, boss: false };
    }
    this.bossReached = true;
    return { from, to: this.label, areaCleared: areaName, boss: true };
  }

  /** Development only. The production UI never calls these. */
  jumpTo(area: AreaId, section: SectionId) {
    const config = areaConfig(area, this.areas);
    this.area = config.id; this.section = Math.max(1, Math.min(config.sections, section)) as SectionId;
    this.bossReached = false;
    this.clearedSections = this.areas.reduce((n, a) => n + (a.id < this.area ? a.sections : 0), 0) + this.section - 1;
  }
  jumpToBoss() {
    const last = this.areas[this.areas.length - 1];
    this.area = last.id; this.section = last.sections as SectionId; this.bossReached = true;
    this.clearedSections = this.areas.reduce((n, a) => n + a.sections, 0);
  }
  reset() { this.area = 1; this.section = 1; this.bossReached = false; this.clearedSections = 0; }
}
