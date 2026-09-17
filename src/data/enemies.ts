import type { DamageCause } from '../systems/HealthSystem';
import type { PickupKind } from './pickups';

export type EnemyKind = 'slime' | 'bat' | 'armoredSlime' | 'tank' | 'fish' | 'bubbleFish' | 'jellyfish' | 'urchin'
  | 'fireLizard' | 'fireBat' | 'magmaSlime' | 'fireArmor' | 'frostBeetle'
  | 'demon' | 'wraith' | 'armorGuard' | 'spikeDemon' | 'ruinBreaker';
/** Shape family GameScene draws. Silhouette, never colour alone, tells the player what is stompable. */
export type EnemySilhouette = 'blob' | 'wing' | 'shell' | 'brute' | 'fin' | 'orb' | 'bell' | 'spiked'
  | 'lizard' | 'ember' | 'flame' | 'plated' | 'crystal'
  | 'horned' | 'shade' | 'bulwark' | 'barb' | 'breaker';
/** Spawn weight class. Independent of `stompable`: it only decides how often a row rolls this tier. */
export type EnemyThreat = 'basic' | 'armored' | 'heavy';
/** Where the generator may place it: guarding a ledge, loose in open water/air, or either. */
export type EnemySlot = 'guard' | 'open' | 'any';

export interface EnemyType {
  id: EnemyKind;
  name: string;
  /** The single source of truth for "can I land on this?". No gameplay code branches on the kind. */
  stompable: boolean;
  /** Air enemies patrol above the row instead of standing on the platform. */
  flying: boolean;
  threat: EnemyThreat;
  spawnSlot: EnemySlot;
  /** Relative draw weight inside its threat tier, so a rewarding enemy can stay uncommon. */
  spawnWeight: number;
  hp: number;
  silhouette: EnemySilhouette;
  bodyWidth: number;
  /** Patrol speed multiplier applied to the shared sway motion. */
  swaySpeed: number;
  /** Contact damage cause, so a hit records what actually hurt the player. */
  damageCause: DamageCause;
  /** Short on-hit hint shown next to the enemy. */
  contactHint: string;
  /** Wide bodies need a wide ledge; the generator skips them on narrow platforms. */
  minPlatformWidth?: number;
  /** What the corpse leaves behind. Generic on purpose: later areas drop other pickups the same way. */
  drop?: { pickup: PickupKind; chance?: number };
  /** A world effect the death triggers. Kept as data so GameModel routes on it, not on the kind. */
  onDefeat?: 'shatterNearby';
}

/**
 * AREA 1 uses slime / bat / armoredSlime. `tank` stays available for the later areas that still run
 * on the shared difficulty curve. New areas add entries here and list them in their `enemyPool`.
 */
export const ENEMY_TYPES: Record<EnemyKind, EnemyType> = {
  slime: { id: 'slime', name: 'SLIME', stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'blob', bodyWidth: 26, swaySpeed: 0.95, damageCause: 'enemy', contactHint: '接触' },
  bat: { id: 'bat', name: 'BAT', stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'wing', bodyWidth: 26, swaySpeed: 1.5, damageCause: 'enemy', contactHint: '接触' },
  armoredSlime: { id: 'armoredSlime', name: 'ARMORED SLIME', stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'shell', bodyWidth: 26, swaySpeed: 0.95, damageCause: 'spike', contactHint: '甲羅は踏めない' },
  tank: { id: 'tank', name: 'ARMORED BRUTE', stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'brute', bodyWidth: 34, swaySpeed: 0.95, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 118 },
  // AREA 2. Fish swim in open water like bats; urchins hold a ledge.
  fish: { id: 'fish', name: 'FISH', stompable: true, flying: true, threat: 'basic', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'fin', bodyWidth: 26, swaySpeed: 1.25, damageCause: 'enemy', contactHint: '接触' },
  bubbleFish: { id: 'bubbleFish', name: 'BUBBLE FISH', stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.45, hp: 1, silhouette: 'orb', bodyWidth: 24, swaySpeed: 1.05, damageCause: 'enemy', contactHint: '接触', drop: { pickup: 'oxygenBubble' } },
  jellyfish: { id: 'jellyfish', name: 'JELLYFISH', stompable: false, flying: true, threat: 'armored', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'bell', bodyWidth: 24, swaySpeed: 0.6, damageCause: 'spike', contactHint: '触手は踏めない' },
  urchin: { id: 'urchin', name: 'URCHIN', stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'spiked', bodyWidth: 24, swaySpeed: 0.35, damageCause: 'spike', contactHint: 'トゲは踏めない' },
  // AREA 3. Two soft targets to bounce from, two hard ones to shoot, one that carries ice.
  fireLizard: { id: 'fireLizard', name: 'FIRE LIZARD', stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'lizard', bodyWidth: 28, swaySpeed: 1.1, damageCause: 'enemy', contactHint: '接触' },
  fireBat: { id: 'fireBat', name: 'FIRE BAT', stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 1, hp: 1, silhouette: 'ember', bodyWidth: 26, swaySpeed: 1.75, damageCause: 'enemy', contactHint: '接触' },
  magmaSlime: { id: 'magmaSlime', name: 'MAGMA SLIME', stompable: false, flying: false, threat: 'armored', spawnSlot: 'guard', spawnWeight: 1, hp: 1, silhouette: 'flame', bodyWidth: 26, swaySpeed: 0.85, damageCause: 'heat', contactHint: '炎の上は踏めない' },
  fireArmor: { id: 'fireArmor', name: 'FIRE ARMOR', stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'plated', bodyWidth: 32, swaySpeed: 0.7, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 112 },
  frostBeetle: { id: 'frostBeetle', name: 'FROST BEETLE', stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.4, hp: 1, silhouette: 'crystal', bodyWidth: 26, swaySpeed: 0.9, damageCause: 'enemy', contactHint: '接触', drop: { pickup: 'ice' } },
  // AREA 4. Stompable ones double as footholds once the ledges stop being trustworthy.
  demon: { id: 'demon', name: 'DEMON', stompable: true, flying: true, threat: 'basic', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'horned', bodyWidth: 28, swaySpeed: 1.15, damageCause: 'enemy', contactHint: '接触' },
  wraith: { id: 'wraith', name: 'WRAITH', stompable: true, flying: true, threat: 'basic', spawnSlot: 'open', spawnWeight: 0.8, hp: 1, silhouette: 'shade', bodyWidth: 26, swaySpeed: 0.45, damageCause: 'enemy', contactHint: '接触' },
  armorGuard: { id: 'armorGuard', name: 'ARMOR GUARD', stompable: false, flying: false, threat: 'heavy', spawnSlot: 'guard', spawnWeight: 1, hp: 3, silhouette: 'bulwark', bodyWidth: 32, swaySpeed: 0.6, damageCause: 'tank', contactHint: '装甲に注意', minPlatformWidth: 108 },
  spikeDemon: { id: 'spikeDemon', name: 'SPIKE DEMON', stompable: false, flying: true, threat: 'armored', spawnSlot: 'any', spawnWeight: 1, hp: 1, silhouette: 'barb', bodyWidth: 26, swaySpeed: 1.0, damageCause: 'spike', contactHint: 'トゲは踏めない' },
  ruinBreaker: { id: 'ruinBreaker', name: 'RUIN BREAKER', stompable: true, flying: false, threat: 'basic', spawnSlot: 'guard', spawnWeight: 0.45, hp: 1, silhouette: 'breaker', bodyWidth: 30, swaySpeed: 0.8, damageCause: 'enemy', contactHint: '接触', onDefeat: 'shatterNearby' },
};
export const enemyType = (kind: EnemyKind) => ENEMY_TYPES[kind];

export interface Enemy {
  id: number; kind: EnemyKind; x: number; y: number; originX: number; range: number; phase: number;
  hp: number; alive: boolean; flash: number; hurtFlash?: number;
  /** Copied from the type so collision code reads one flag instead of matching kinds. */
  stompable: boolean; flying: boolean;
  /** Which generator slot placed it: a ledge guard or loose in open water. */
  slot: 'guard' | 'open';
}
export function spawnEnemy(kind: EnemyKind, id: number, x: number, y: number, range = 0, phase = 0, slot: 'guard' | 'open' = 'guard'): Enemy {
  const type = ENEMY_TYPES[kind];
  return { id, kind, x, y, originX: x, range, phase, hp: type.hp, alive: true, flash: 0, hurtFlash: 0, stompable: type.stompable, flying: type.flying, slot };
}
