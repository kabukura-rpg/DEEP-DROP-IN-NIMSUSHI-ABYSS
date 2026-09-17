import type { DamageCause } from '../systems/HealthSystem';

export type HazardKind = 'lavaPool' | 'lavaWall' | 'vent';
export type HazardSilhouette = 'pool' | 'wall' | 'vent';

/** How a vent cycles. Nothing ever erupts without the warning phase running first. */
export const VENT_CYCLE = { idle: 2.6, warning: 0.7, erupting: 1.1 } as const;
export const VENT_PERIOD = VENT_CYCLE.idle + VENT_CYCLE.warning + VENT_CYCLE.erupting;
export type VentState = 'idle' | 'warning' | 'erupting';

export interface HazardType {
  id: HazardKind;
  /** Lava kills on contact, ignoring hearts and invulnerability. Vents never do. */
  lethal: boolean;
  damageCause: DamageCause;
  /** Heat units per second at the centre, falling off linearly to zero at `heatRadius`. */
  heat: number;
  heatRadius: number;
  /** A vent only radiates its full heat while erupting; this is its resting output. */
  idleHeat?: number;
  silhouette: HazardSilhouette;
}

/**
 * One table drives spawning, collision, heat and drawing. AREA 4's collapsing platforms slot in the
 * same way: add a row here, list it in the area's plan, and the model needs no new branch.
 */
export const HAZARD_TYPES: Record<HazardKind, HazardType> = {
  lavaPool: { id: 'lavaPool', lethal: true, damageCause: 'lava', heat: 21, heatRadius: 300, silhouette: 'pool' },
  lavaWall: { id: 'lavaWall', lethal: true, damageCause: 'lava', heat: 26, heatRadius: 320, silhouette: 'wall' },
  vent: { id: 'vent', lethal: false, damageCause: 'heat', heat: 54, heatRadius: 300, idleHeat: 3, silhouette: 'vent' },
};
export const hazardType = (kind: HazardKind) => HAZARD_TYPES[kind];

export interface Hazard {
  id: number; kind: HazardKind;
  x: number; y: number; width: number; height: number;
  lethal: boolean;
  /** Vents only: where in the cycle this one sits, so neighbours do not fire in lockstep. */
  phase: number;
  state: VentState;
  /** Height of the plume above a vent while it is erupting. */
  plume: number;
}
export function spawnHazard(kind: HazardKind, id: number, x: number, y: number, width: number, height: number, phase = 0): Hazard {
  const type = HAZARD_TYPES[kind];
  return { id, kind, x, y, width, height, lethal: type.lethal, phase, state: 'idle', plume: kind === 'vent' ? 132 : 0 };
}

/** Pure function of elapsed time: a vent's phase never jumps, so the warning always precedes fire. */
export function ventStateAt(hazard: Hazard, elapsed: number): VentState {
  if (hazard.kind !== 'vent') return 'idle';
  const t = (elapsed + hazard.phase) % VENT_PERIOD;
  if (t < VENT_CYCLE.idle) return 'idle';
  return t < VENT_CYCLE.idle + VENT_CYCLE.warning ? 'warning' : 'erupting';
}

/** The rectangle a hazard actually occupies right now; a vent only fills its plume while erupting. */
export function hazardBounds(hazard: Hazard) {
  if (hazard.kind !== 'vent' || hazard.state !== 'erupting') return { x: hazard.x, y: hazard.y, width: hazard.width, height: hazard.height };
  return { x: hazard.x, y: hazard.y - hazard.plume, width: hazard.width, height: hazard.height + hazard.plume };
}

/** Heat output right now: a resting vent is warm, an erupting one is the strongest source in AREA 3. */
export function hazardHeat(hazard: Hazard) {
  const type = HAZARD_TYPES[hazard.kind];
  if (hazard.kind !== 'vent') return type.heat;
  return hazard.state === 'erupting' ? type.heat : hazard.state === 'warning' ? type.heat * 0.35 : type.idleHeat ?? 0;
}
