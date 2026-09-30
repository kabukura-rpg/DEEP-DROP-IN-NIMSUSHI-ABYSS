/**
 * ENEMY ART -- image-based enemies, drawing only. Nothing here reads or changes an enemy's
 * position, collision, stompability or AI: each image is placed on the enemy's own (x, y), centred
 * (origin 0.5, 0.5; the art's pivot is (32, 32) of a 64x64 canvas) at scale 1.
 *
 * An enemy KIND listed here draws from its image; any other kind -- AREA 4's, the boss's own --
 * keeps the procedural look in GameScene.enemy(). A kind whose state has no image, or whose texture
 * did not load, falls back to the procedural look as well.
 *
 * States are read from the AI the model already runs (data/dwellers.ts, data/chasers.ts), never
 * invented here:
 *   caveBat      bat.state     hang | unfurl | chase
 *   toad         hop.state     sit  | windup | air     (role 'frog')
 *   ghost        ghost.state   dormant | hunt          (a ghost that has hunted its time is removed)
 *   boneHopper   hop.state     sit  | windup | air     (role 'groundSkull'; its windup is 0s today)
 *   boneThrower  throw.windup  0 = idle, > 0 = windup  (the bone still leaves from (x, y - 14))
 *   flyingSkull  wander.state  calm | angry
 *   squid        squid.state   rise | poise | dive     (the model makes it unstompable as it dives)
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
import ghostDormant from '../assets/enemies/area2/ghost-dormant.png?url';
import ghostHunt from '../assets/enemies/area2/ghost-hunt.png?url';
import boneHopperSit from '../assets/enemies/area2/bone-hopper-sit.png?url';
import boneHopperWindup from '../assets/enemies/area2/bone-hopper-windup.png?url';
import boneHopperAir from '../assets/enemies/area2/bone-hopper-air.png?url';
import boneThrowerIdle from '../assets/enemies/area2/bone-thrower-idle.png?url';
import boneThrowerWindup from '../assets/enemies/area2/bone-thrower-windup.png?url';
import flyingSkullCalm from '../assets/enemies/area2/flying-skull-calm.png?url';
import flyingSkullAngry from '../assets/enemies/area2/flying-skull-angry.png?url';
import shadeOrbIdle from '../assets/enemies/area2/shade-orb-idle.png?url';
import squidRise from '../assets/enemies/area3/squid-rise.png?url';
import squidPoise from '../assets/enemies/area3/squid-poise.png?url';
import squidDive from '../assets/enemies/area3/squid-dive.png?url';
import shellSwimmerIdle from '../assets/enemies/area3/shell-swimmer-idle.png?url';
import riserJellyIdle from '../assets/enemies/area3/riser-jelly-idle.png?url';
import biterIdle from '../assets/enemies/area3/biter-idle.png?url';
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
  'enemy-ghost-dormant': ghostDormant, 'enemy-ghost-hunt': ghostHunt,
  'enemy-bone-hopper-sit': boneHopperSit, 'enemy-bone-hopper-windup': boneHopperWindup, 'enemy-bone-hopper-air': boneHopperAir,
  'enemy-bone-thrower-idle': boneThrowerIdle, 'enemy-bone-thrower-windup': boneThrowerWindup,
  'enemy-flying-skull-calm': flyingSkullCalm, 'enemy-flying-skull-angry': flyingSkullAngry,
  'enemy-shade-orb-idle': shadeOrbIdle,
  'enemy-squid-rise': squidRise, 'enemy-squid-poise': squidPoise, 'enemy-squid-dive': squidDive,
  'enemy-shell-swimmer-idle': shellSwimmerIdle,
  'enemy-riser-jelly-idle': riserJellyIdle,
  'enemy-biter-idle': biterIdle,
};

/** The AREA 1 roster the images cover. */
export const ENEMY_ART_KINDS = ['slime', 'caveBat', 'spore', 'toad', 'armoredSlime', 'shellback', 'creeper', 'watcher'] as const;
/** The AREA 2 roster the images cover: its roll's pool plus the ghosts laid by its schedule. */
export const ENEMY_ART_KINDS_AREA2 = ['ghost', 'boneHopper', 'boneThrower', 'flyingSkull', 'shadeOrb'] as const;
/**
 * The AREA 3 roster the images cover. None of these is rolled anywhere else; the FINAL BOSS's AREA 3
 * phase summons the biter and riser jelly, the same kinds, so they show the same images there.
 */
export const ENEMY_ART_KINDS_AREA3 = ['squid', 'shellSwimmer', 'riserJelly', 'biter'] as const;

/**
 * Where an enemy is being drawn: the AREA's id, or 'boss' in the FINAL BOSS's arena. Only the SHADE
 * ORB reads it -- it is the one AREA 2 kind that AREA 4 also rolls, and AREA 4 is not given its image
 * here (it stays procedural; a later AREA 4 pass may give it its own). The FINAL BOSS summons shade
 * orbs only in its AREA 2 phase, so there it shows the AREA 2 image.
 */
export type EnemyArtWhere = number | 'boss';

/** How every enemy image is placed on its enemy. Visual only. */
export const ENEMY_ART_PLACEMENT = { size: 64, originX: 0.5, originY: 0.5, scale: 1, offsetX: 0, offsetY: 0 } as const;

/**
 * The texture for an enemy as the model has it now, or null for "draw it procedurally": a kind with
 * no images, or a state the images do not cover.
 */
export function enemyArtKey(e: Pick<Enemy, 'kind' | 'ai'>, where?: EnemyArtWhere): string | null {
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
    case 'ghost':
      if (e.ai?.kind !== 'ghost') return null;
      return e.ai.state === 'dormant' ? 'enemy-ghost-dormant' : e.ai.state === 'hunt' ? 'enemy-ghost-hunt' : null;
    case 'boneHopper':
      if (e.ai?.kind !== 'hop' || e.ai.role !== 'groundSkull') return null;
      return e.ai.state === 'sit' ? 'enemy-bone-hopper-sit' : e.ai.state === 'windup' ? 'enemy-bone-hopper-windup' : e.ai.state === 'air' ? 'enemy-bone-hopper-air' : null;
    case 'boneThrower':
      if (e.ai?.kind !== 'throw') return null;
      return e.ai.windup > 0 ? 'enemy-bone-thrower-windup' : 'enemy-bone-thrower-idle';
    case 'flyingSkull':
      if (e.ai?.kind !== 'wander') return null;
      return e.ai.state === 'calm' ? 'enemy-flying-skull-calm' : e.ai.state === 'angry' ? 'enemy-flying-skull-angry' : null;
    case 'shadeOrb':
      return where === 2 || where === 'boss' ? 'enemy-shade-orb-idle' : null;
    case 'squid':
      // The image follows the state; stompability is the model's (it clears it as the dive starts).
      if (e.ai?.kind !== 'squid') return null;
      return e.ai.state === 'rise' ? 'enemy-squid-rise' : e.ai.state === 'poise' ? 'enemy-squid-poise' : e.ai.state === 'dive' ? 'enemy-squid-dive' : null;
    case 'shellSwimmer': return 'enemy-shell-swimmer-idle';
    case 'riserJelly': return 'enemy-riser-jelly-idle';
    case 'biter': return 'enemy-biter-idle';
    default: return null;
  }
}

/**
 * Mirror the image, never the enemy. The CREEPER art clings to a LEFT wall (claws to the wall); on
 * the right wall -- the model puts it on whichever is nearer -- it is shown mirrored.
 * The BITER art faces RIGHT; it is mirrored while its chase velocity (eye.vx, role 'piranha') points
 * left -- the same test the procedural biter's jaws use, so before it has moved it faces right.
 * The SHELL SWIMMER art faces LEFT; it is mirrored while its swim velocity (bounce.vx, which the
 * shaft walls turn round) points right.
 */
export function enemyArtFlipX(e: Pick<Enemy, 'kind' | 'x'> & Partial<Pick<Enemy, 'ai'>>) {
  if (e.kind === 'biter') return e.ai?.kind === 'eye' && e.ai.vx < 0;
  if (e.kind === 'shellSwimmer') return e.ai?.kind === 'bounce' && e.ai.vx > 0;
  return e.kind === 'creeper' && e.x > WORLD.width / 2;
}

/** How one image is shown on top of ENEMY_ART_PLACEMENT: a nudge, a see-through alpha, a crop. Visual only. */
export type EnemyArtLook = { offsetX: number; offsetY: number; alpha: number; crop: readonly [number, number, number, number] | null };
const PLAIN: EnemyArtLook = { offsetX: 0, offsetY: 0, alpha: 1, crop: null };

/**
 * GHOST, DORMANT: the procedural ghost waits in the wall as only a faint FACE pressed into the stone,
 * pulsing (alpha 0.45 +- 0.15) -- never its whole body. The image does the same: only its head
 * (x 25-40, y 6-17 of the 64x64 art) is shown, nudged so its eyes sit where the procedural eyes did
 * (about 3px above the ghost's y), at the procedural pulse. 15px wide, it stays inside the 28px wall
 * the ghost waits in (14px deep).
 */
export const GHOST_DORMANT_LOOK = { crop: [25, 6, 16, 12] as const, offsetX: -1, offsetY: 17 };
/** GHOST, HUNTING: see-through, exactly as the procedural sheet (0.62; 0.9 while it flashes white). */
export const GHOST_HUNT_ALPHA = { normal: 0.62, hurt: 0.9 } as const;
/**
 * BONE THROWER: a guard stands with its y 15px above the ledge (StageGenerator). The art's feet are
 * at its row 53, 22px below the pivot, so it is raised 7px to stand on the ledge, as the procedural
 * skeleton's feet did. The bone's release point is the model's and does not move.
 */
export const BONE_THROWER_OFFSET_Y = -7;

export function enemyArtLook(e: Pick<Enemy, 'kind' | 'phase'>, key: string, elapsed: number, hurt: boolean): EnemyArtLook {
  switch (key) {
    case 'enemy-ghost-dormant':
      return { offsetX: GHOST_DORMANT_LOOK.offsetX, offsetY: GHOST_DORMANT_LOOK.offsetY, alpha: 0.45 + Math.sin(elapsed * 2 + e.phase) * 0.15, crop: GHOST_DORMANT_LOOK.crop };
    case 'enemy-ghost-hunt':
      return { ...PLAIN, alpha: hurt ? GHOST_HUNT_ALPHA.hurt : GHOST_HUNT_ALPHA.normal };
    case 'enemy-bone-thrower-idle': case 'enemy-bone-thrower-windup':
      return { ...PLAIN, offsetY: BONE_THROWER_OFFSET_Y };
    default: return PLAIN;
  }
}
