import { BALANCE, type Stats } from './balance';

/**
 * Gun modules replace the shot itself: rate, recoil, spread, reach and cost all come from this
 * table. The player carries exactly one at a time and swaps it outright on pickup.
 *
 * A module is the BASE weapon. The run's upgrades (POWER+, RECOIL+, BIG BULLET, PIERCING, MAG+)
 * stay pure modifiers layered on top, so nothing is counted twice -- see `volley` below.
 */
export type GunModuleId = 'machine' | 'burst' | 'laser' | 'noppy' | 'puncher' | 'shotgun' | 'triple';

/** What a module pickup grants besides the weapon swap. */
export type GunModuleBonus = 'heart' | 'charge';

export interface GunModuleDefinition {
  id: GunModuleId;
  name: string;
  /** Short label for the HUD; must stay readable on a 360px phone. */
  short: string;
  ammoCost: number;
  /** true: holding fire keeps shooting. false: one volley per press. */
  automatic: boolean;
  /** Seconds between volleys. */
  fireInterval: number;
  /** Upward brake applied once per volley. Never produces upward velocity. */
  recoil: number;
  projectileSpeed: number;
  projectileDamage: number;
  projectileCount: number;
  projectileSize: number;
  /** Total fan angle in radians across all projectiles. 0 means straight down. */
  spread: number;
  /** Pixels of travel before the projectile expires. */
  range: number;
  /** Extra enemies a projectile passes through. 0 stops at the first. */
  piercing: number;
  /** How far horizontal input tilts the shot, in radians at full input. */
  horizontalAimFactor: number;
  /** Sequential shots from a single press, e.g. BURST's three-round point fire. */
  burst?: { count: number; interval: number };
  /** Drawn as a streak rather than a pellet. Damage still goes through the ordinary path. */
  beam?: boolean;
  description: string;
}

const base = { spread: 0, piercing: 0, horizontalAimFactor: 0, projectileCount: 1, projectileSize: 4 };

export const GUN_MODULES: Record<GunModuleId, GunModuleDefinition> = {
  machine: {
    ...base, id: 'machine', name: 'MACHINE GUN', short: 'MG',
    ammoCost: 1, automatic: true, fireInterval: BALANCE.shotDelay, recoil: BALANCE.shotRecoil,
    projectileSpeed: 850, projectileDamage: 1, range: 900,
    description: '標準。真下へ1発、強めの反動で落下を制御する。',
  },
  burst: {
    ...base, id: 'burst', name: 'BURST', short: 'BURST',
    ammoCost: 3, automatic: false, fireInterval: 0.46, recoil: 150,
    projectileSpeed: 900, projectileDamage: 1, range: 900,
    burst: { count: 3, interval: 0.075 },
    description: '1入力で3点射。反動も3回に分かれて効く。',
  },
  laser: {
    ...base, id: 'laser', name: 'LASER', short: 'LASER',
    ammoCost: 4, automatic: false, fireInterval: 0.5, recoil: 120,
    projectileSpeed: 2600, projectileDamage: 3, projectileSize: 3, range: 2000, piercing: 99,
    beam: true,
    description: '超長射程・高威力・貫通。横の当たりは狭い。',
  },
  noppy: {
    ...base, id: 'noppy', name: 'NOPPY', short: 'NOPPY',
    ammoCost: 1, automatic: true, fireInterval: 0.085, recoil: 95,
    projectileSpeed: 950, projectileDamage: 1, projectileSize: 3, range: 620,
    horizontalAimFactor: 0.42,
    description: '高速連射・小弾・弱反動。横移動で弾道が斜めに傾く。',
  },
  puncher: {
    ...base, id: 'puncher', name: 'PUNCHER', short: 'PUNCH',
    ammoCost: 2, automatic: true, fireInterval: 0.30, recoil: 165,
    projectileSpeed: 520, projectileDamage: 3, projectileSize: 11, range: 330, piercing: 1,
    description: '大口径・高威力・低速・短射程。横判定が広い。',
  },
  shotgun: {
    ...base, id: 'shotgun', name: 'SHOTGUN', short: 'SHOT',
    ammoCost: 5, automatic: false, fireInterval: 0.55, recoil: 330,
    projectileSpeed: 780, projectileDamage: 1, projectileCount: 5, range: 260, spread: 0.85,
    description: '扇状に5発。至近距離で最大火力、反動は最強。',
  },
  triple: {
    ...base, id: 'triple', name: 'TRIPLE', short: 'TRIPLE',
    ammoCost: 2, automatic: true, fireInterval: 0.28, recoil: 150,
    projectileSpeed: 820, projectileDamage: 1, projectileCount: 3, range: 700, spread: 0.62,
    description: '左下・真下・右下の3方向を継続射撃。',
  },
};

export const GUN_MODULE_IDS = Object.keys(GUN_MODULES) as GunModuleId[];
export const gunModule = (id: GunModuleId) => GUN_MODULES[id];
export const STARTING_GUN_MODULE: GunModuleId = 'machine';

/** How much MAX AMMO a CHARGE module adds, for the rest of the run. */
export const CHARGE_AMMO_BONUS = 2;

/**
 * Spawn weights. Rarer, swingier weapons show up less often; the starting gun stays common so a
 * run can always fall back to the familiar feel.
 */
export const GUN_MODULE_WEIGHTS: Record<GunModuleId, number> = {
  machine: 14, noppy: 18, triple: 18, puncher: 16, burst: 16, shotgun: 10, laser: 8,
};

/**
 * Per-row chance of a weapon crate. Rows are ~10m apart and a full run is 12 x 200m, so this lands
 * a handful of modules in a run without ever making them feel routine.
 */
export const GUN_MODULE_SPAWN_CHANCE = 0.016;

/** Pick a weapon and its bonus. Weights keep any one gun from dominating a run. */
export function rollGunModule(random: () => number): { module: GunModuleId; bonus: GunModuleBonus } {
  const total = GUN_MODULE_IDS.reduce((sum, id) => sum + GUN_MODULE_WEIGHTS[id], 0);
  let roll = random() * total;
  let module: GunModuleId = GUN_MODULE_IDS[0];
  for (const id of GUN_MODULE_IDS) { roll -= GUN_MODULE_WEIGHTS[id]; if (roll <= 0) { module = id; break; } }
  return { module, bonus: random() < 0.5 ? 'heart' : 'charge' };
}

export interface ProjectileSpec {
  /** Velocity components in px/s. Down is +y; these already include aim and spread. */
  vx: number; vy: number;
  damage: number; size: number;
  /** Enemies it may pass through beyond the first. */
  pierce: number;
  range: number;
  beam: boolean;
}

/**
 * Build one volley. This is the single place where a module's base numbers and the run's upgrade
 * modifiers combine, so no caller ever needs to know which weapon is equipped.
 *
 * POWER+ adds its flat +1 on top of the module's damage, BIG BULLET scales the module's calibre,
 * RECOIL+ scales the module's recoil, and PIERCING makes any module pass through everything.
 * `aim` is the horizontal input (-1..1); only modules with a horizontalAimFactor react to it.
 */
export function volley(def: GunModuleDefinition, stats: Stats, aim: number): ProjectileSpec[] {
  const damage = Math.max(1, def.projectileDamage + (stats.power - 1));
  const size = Math.max(1, def.projectileSize * (stats.bulletSize / 4));
  const pierce = stats.piercing ? 99 : def.piercing;
  const tilt = def.horizontalAimFactor * Math.max(-1, Math.min(1, aim));
  const count = Math.max(1, def.projectileCount);
  const shots: ProjectileSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Spread fans evenly around the aim line; a single projectile sits exactly on it.
    const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * def.spread;
    const angle = tilt + offset;
    shots.push({
      vx: Math.sin(angle) * def.projectileSpeed,
      vy: Math.cos(angle) * def.projectileSpeed,
      damage, size, pierce, range: def.range, beam: def.beam === true,
    });
  }
  return shots;
}

/** Recoil for one volley, after the run's RECOIL+ modifier. */
export const volleyRecoil = (def: GunModuleDefinition, stats: Stats) =>
  def.recoil * (stats.shotRecoil / BALANCE.shotRecoil);

/*
 * Not implemented yet, deliberately: the seven above must be solid first.
 *   CANNON   - single huge slug, enormous recoil, very high damage
 *   DRILL    - short range, continuous piercing contact damage
 *   RICOCHET - bounces off a wall once
 */
