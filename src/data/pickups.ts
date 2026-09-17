/**
 * Collectables the stage or a dying enemy can leave behind. One table drives spawning, collision,
 * drawing and the effect, so AREA 3's ice and any later item only add a row here.
 */
export type PickupKind = 'oxygenBubble' | 'ice';
/** What collecting it does. GameModel routes on the effect, never on the kind. */
export type PickupEffect = 'oxygen' | 'heat';
export type PickupSilhouette = 'bubble' | 'shard';

export interface PickupType {
  id: PickupKind;
  name: string;
  effect: PickupEffect;
  /** Seconds of oxygen for 'oxygen'; heat units shed for 'heat'. Each effect reads its own unit. */
  value: number;
  radius: number;
  silhouette: PickupSilhouette;
  color: number;
}

export const PICKUP_TYPES: Record<PickupKind, PickupType> = {
  oxygenBubble: { id: 'oxygenBubble', name: 'AIR BUBBLE', effect: 'oxygen', value: 5, radius: 15, silhouette: 'bubble', color: 0x9fe8f5 },
  ice: { id: 'ice', name: 'ICE SHARD', effect: 'heat', value: 60, radius: 16, silhouette: 'shard', color: 0x8fdcff },
};
export const pickupType = (kind: PickupKind) => PICKUP_TYPES[kind];

export interface Pickup {
  id: number; kind: PickupKind; x: number; y: number; phase: number;
  taken: boolean;
  /** Drops rise for a moment before settling, so a kill reward reads as a reward. */
  drifting: boolean;
}
export function spawnPickup(kind: PickupKind, id: number, x: number, y: number, phase = 0, drifting = false): Pickup {
  return { id, kind, x, y, phase, taken: false, drifting };
}
