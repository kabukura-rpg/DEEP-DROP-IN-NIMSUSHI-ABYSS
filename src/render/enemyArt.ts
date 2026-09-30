/**
 * ENEMY ART -- image-based enemies, drawing only. Nothing here reads or changes an enemy's
 * position, collision, stompability or AI: each image is placed on the enemy's own (x, y), centred
 * (origin 0.5, 0.5; the art's pivot is (32, 32) of a 64x64 canvas) at scale 1.
 *
 * An enemy KIND listed here draws from its image; any other kind -- AREA 2-4's, the boss's own --
 * keeps the procedural look in GameScene.enemy(). A kind whose state has no image, or whose texture
 * did not load, falls back to the procedural look as well.
 *
 * States are read from the AI the model already runs (data/dwellers.ts), never invented here:
 *   caveBat  bat.state  hang | unfurl | chase
 *   toad     hop.state  sit  | windup | air     (role 'frog')
 * Everything else has one idle image.
 */
import slimeIdle from '../assets/enemies/area1/slime-idle.png?url';
import caveBatHang from '../assets/enemies/area1/cave-bat-hang.png?url';
import caveBatUnfurl from '../assets/enemies/area1/cave-bat-unfurl.png?url';
import caveBatChase from '../assets/enemies/area1/cave-bat-chase.png?url';
import sporeIdle from '../assets/enemies/area1/spore-idle.png?url';
import toadSit from '../assets/enemies/area1/toad-sit.png?url';
import toadWindup from '../assets/enemies/area1/toad-windup.png?url';
import toadAir from '../assets/enemies/area1/toad-air.png?url';
import armoredSlimeIdle from '../assets/enemies/area1/armored-slime-idle.png?url';
import shellbackIdle from '../assets/enemies/area1/shellback-idle.png?url';
import creeperIdle from '../assets/enemies/area1/creeper-idle.png?url';
import watcherIdle from '../assets/enemies/area1/watcher-idle.png?url';
import type { Enemy } from '../systems/StageGenerator';
import { WORLD } from '../data/balance';

/** Every enemy image, by texture key. */
export const ENEMY_ART_URLS: Record<string, string> = {
  'enemy-slime-idle': slimeIdle,
  'enemy-cave-bat-hang': caveBatHang, 'enemy-cave-bat-unfurl': caveBatUnfurl, 'enemy-cave-bat-chase': caveBatChase,
  'enemy-spore-idle': sporeIdle,
  'enemy-toad-sit': toadSit, 'enemy-toad-windup': toadWindup, 'enemy-toad-air': toadAir,
  'enemy-armored-slime-idle': armoredSlimeIdle,
  'enemy-shellback-idle': shellbackIdle,
  'enemy-creeper-idle': creeperIdle,
  'enemy-watcher-idle': watcherIdle,
};

/** The AREA 1 roster the images cover. */
export const ENEMY_ART_KINDS = ['slime', 'caveBat', 'spore', 'toad', 'armoredSlime', 'shellback', 'creeper', 'watcher'] as const;

/** How every enemy image is placed on its enemy. Visual only. */
export const ENEMY_ART_PLACEMENT = { size: 64, originX: 0.5, originY: 0.5, scale: 1, offsetX: 0, offsetY: 0 } as const;

/**
 * The texture for an enemy as the model has it now, or null for "draw it procedurally": a kind with
 * no images, or a state the images do not cover.
 */
export function enemyArtKey(e: Pick<Enemy, 'kind' | 'ai'>): string | null {
  switch (e.kind) {
    case 'slime': return 'enemy-slime-idle';
    case 'spore': return 'enemy-spore-idle';
    case 'armoredSlime': return 'enemy-armored-slime-idle';
    case 'shellback': return 'enemy-shellback-idle';
    case 'creeper': return 'enemy-creeper-idle';
    case 'watcher': return 'enemy-watcher-idle';
    case 'caveBat':
      if (e.ai?.kind !== 'bat') return null;
      return e.ai.state === 'hang' ? 'enemy-cave-bat-hang' : e.ai.state === 'unfurl' ? 'enemy-cave-bat-unfurl' : e.ai.state === 'chase' ? 'enemy-cave-bat-chase' : null;
    case 'toad':
      if (e.ai?.kind !== 'hop' || e.ai.role !== 'frog') return null;
      return e.ai.state === 'sit' ? 'enemy-toad-sit' : e.ai.state === 'windup' ? 'enemy-toad-windup' : e.ai.state === 'air' ? 'enemy-toad-air' : null;
    default: return null;
  }
}

/**
 * Mirror the image, never the enemy. The CREEPER art clings to a LEFT wall (claws to the wall); on
 * the right wall -- the model puts it on whichever is nearer -- it is shown mirrored.
 */
export function enemyArtFlipX(e: Pick<Enemy, 'kind' | 'x'>) {
  return e.kind === 'creeper' && e.x > WORLD.width / 2;
}
