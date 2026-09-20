import type { GunModuleBonus, GunModuleId } from './gunModules';
/**
 * Collectables the stage or a dying enemy can leave behind. One table drives spawning, collision,
 * drawing and the effect, so AREA 3's ice and any later item only add a row here.
 */
export type PickupKind = 'oxygenBubble' | 'ice' | 'gunModule' | 'heart' | 'tomato';
/** What collecting it does. GameModel routes on the effect, never on the kind. */
export type PickupEffect = 'oxygen' | 'heat' | 'gunModule' | 'heal' | 'tomato';
export type PickupSilhouette = 'bubble' | 'shard' | 'module' | 'heart' | 'tomato';
/**
 * Environment pickups belong to one AREA's gimmick and only exist while it is on; gun modules are
 * run-wide and drop anywhere. Keeping them apart stops AREA gating from ever hiding a weapon.
 */
export type PickupCategory = 'environment' | 'healing' | 'gunModule';

export interface PickupType {
  id: PickupKind;
  name: string;
  effect: PickupEffect;
  category: PickupCategory;
  /** Seconds of oxygen for 'oxygen'; heat units shed for 'heat'. Each effect reads its own unit. */
  value: number;
  radius: number;
  silhouette: PickupSilhouette;
  color: number;
}

export const PICKUP_TYPES: Record<PickupKind, PickupType> = {
  oxygenBubble: { id: 'oxygenBubble', name: 'AIR BUBBLE', effect: 'oxygen', category: 'environment', value: 5, radius: 15, silhouette: 'bubble', color: 0x9fe8f5 },
  ice: { id: 'ice', name: 'ICE SHARD', effect: 'heat', category: 'environment', value: 60, radius: 16, silhouette: 'shard', color: 0x8fdcff },
  gunModule: { id: 'gunModule', name: 'GUN MODULE', effect: 'gunModule', category: 'gunModule', value: 0, radius: 17, silhouette: 'module', color: 0xffd479 },
  // THE ABYSS. A heart in the arena is the only healing in the fight, and the TOMATO is what a run
  // that never took shelter is handed instead of the final shop. Both are `healing`, which is
  // ungated: unlike air and ice they belong to no gimmick and must never be hidden by one.
  heart: { id: 'heart', name: 'HEART', effect: 'heal', category: 'healing', value: 1, radius: 16, silhouette: 'heart', color: 0xff8fa8 },
  tomato: { id: 'tomato', name: 'トマト', effect: 'tomato', category: 'healing', value: 0, radius: 19, silhouette: 'tomato', color: 0xff5f5f },
};
export const pickupType = (kind: PickupKind) => PICKUP_TYPES[kind];

export interface Pickup {
  id: number; kind: PickupKind; x: number; y: number; phase: number;
  taken: boolean;
  /** Drops rise for a moment before settling, so a kill reward reads as a reward. */
  drifting: boolean;
  /** Only on a 'gunModule' pickup: which weapon it carries and what it grants besides the swap. */
  module?: GunModuleId;
  bonus?: GunModuleBonus;
  /** REVERSE ENGINEERING has already redrawn this crate. One per crate, ever. */
  rerolled?: boolean;
}
export function spawnPickup(kind: PickupKind, id: number, x: number, y: number, phase = 0, drifting = false): Pickup {
  return { id, kind, x, y, phase, taken: false, drifting };
}
/** A weapon crate. Separate factory so a module pickup can never be built without its weapon. */
export function spawnGunModule(id: number, x: number, y: number, module: GunModuleId, bonus: GunModuleBonus): Pickup {
  return { id, kind: 'gunModule', x, y, phase: 0, taken: false, drifting: false, module, bonus };
}
