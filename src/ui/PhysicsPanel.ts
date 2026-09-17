import type { GameModel } from '../systems/GameModel';
import { TUNING_FIELDS, defaultTuning, loadTuning, saveTuning, tuningVisible, type PhysicsTuning, type TuningKey } from '../systems/PhysicsTuning';

export class PhysicsPanel {
  private values: PhysicsTuning;
  private expanded = false;
  private lastTelemetry = '';
  private storage?: Storage;
  constructor(private root: HTMLElement, private getModel: () => GameModel, private onChange: () => void) {
    try { this.storage = localStorage; } catch { /* Storage is optional. */ }
    this.values = loadTuning(this.storage);
    root.innerHTML = `<button class="tuning-toggle" aria-expanded="false" aria-controls="tuning-body">PHYSICS TUNING <span>＋</span></button><div id="tuning-body" hidden><p class="tuning-note">練習のみ適用 · 自動保存<br>単発反動は全量、最速連射は約65%</p>${TUNING_FIELDS.map(f => `<div class="tuning-row"><span>${f.label}</span><output data-value="${f.key}"></output><button data-key="${f.key}" data-step="-1" aria-label="${f.label} を減らす">−</button><button data-key="${f.key}" data-step="1" aria-label="${f.label} を増やす">＋</button></div>`).join('')}<div class="tuning-bottom"><output class="physics-telemetry" aria-label="現在の落下速度"></output><button class="tuning-reset">RESET</button></div></div>`;
    // Pointer tuning never steals the keyboard from A/D, arrows, Space, or Escape.
    root.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
    root.querySelector<HTMLButtonElement>('.tuning-toggle')!.onclick = () => this.setExpanded(!this.expanded);
    root.querySelector<HTMLButtonElement>('.tuning-reset')!.onclick = () => { this.values = defaultTuning(); this.apply(); };
    root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button => {
      button.onclick = () => {
        const key = button.dataset.key as TuningKey, field = TUNING_FIELDS.find(f => f.key === key)!;
        this.values[key] = Math.min(field.max, Math.max(field.min, this.values[key] + Number(button.dataset.step) * field.step));
        this.apply();
      };
    });
    this.render();
  }
  startPractice() { this.getModel().setPhysicsTuning(this.values); this.setExpanded(false); }
  show(mode: string) {
    this.root.hidden = !tuningVisible(this.getModel().practice, mode);
    this.root.closest('.game-column')!.classList.toggle('tuning-open', !this.root.hidden && this.expanded);
    document.body.classList.toggle('practice-active', !this.root.hidden);
  }
  updateTelemetry() {
    if (this.root.hidden || !this.expanded) return;
    const model = this.getModel();
    const text = `VY ${Math.round(model.player.vy / 10) * 10} px/s · ${model.ammo}/${model.stats.maxAmmo}`;
    if (text !== this.lastTelemetry) { this.root.querySelector('.physics-telemetry')!.textContent = text; this.lastTelemetry = text; }
  }
  private setExpanded(open: boolean) {
    this.expanded = open;
    this.root.querySelector<HTMLElement>('#tuning-body')!.hidden = !open;
    this.root.querySelector('.tuning-toggle')!.setAttribute('aria-expanded', String(open));
    this.root.querySelector('.tuning-toggle span')!.textContent = open ? '−' : '＋';
    this.root.closest('.game-column')!.classList.toggle('tuning-open', open && !this.root.hidden);
  }
  private apply() {
    if (!this.getModel().practice) return;
    this.getModel().setPhysicsTuning(this.values); saveTuning(this.values, this.storage);
    this.render(); this.onChange(); this.updateTelemetry();
  }
  private render() {
    for (const field of TUNING_FIELDS) {
      this.root.querySelector(`[data-value="${field.key}"]`)!.textContent = String(this.values[field.key]);
      this.root.querySelectorAll<HTMLButtonElement>(`[data-key="${field.key}"]`).forEach(button => { button.disabled = Number(button.dataset.step) < 0 ? this.values[field.key] <= field.min : this.values[field.key] >= field.max; });
    }
  }
}
