import type { DamageCause } from '../systems/HealthSystem';

/**
 * What the result screen calls each way a run can end. The internal cause id is a debugging name
 * and is never shown to the player, so every cause needs a line here -- declaring this as a Record
 * over DamageCause means adding a cause fails the build until someone writes its label.
 */
export const DAMAGE_LABELS: Record<DamageCause, string> = {
  enemy: 'A CREATURE',
  spike: 'SPIKES',
  tank: 'AN ARMOURED FOE',
  oxygen: 'DROWNING',
  heat: 'THE HEAT',
  lava: 'LAVA',
  fall: 'THE FALL',
  bossContact: 'NIMUSHI',
  bossShot: 'TAPIOCA',
  bossSweep: 'THE STRAW BEAM',
  crush: 'THE RISING DEEP',
};
/** Falls back to a neutral line rather than leaking an id when the cause is unknown. */
export const damageLabel = (cause?: DamageCause | null) => (cause && DAMAGE_LABELS[cause]) || 'THE DEPTHS';
