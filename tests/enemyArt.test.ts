import { describe, expect, it } from 'vitest';
import { BONE_THROWER_OFFSET_Y, ENEMY_ART_KINDS, ENEMY_ART_KINDS_AREA2, ENEMY_ART_KINDS_AREA3, ENEMY_ART_PLACEMENT, ENEMY_ART_URLS, GHOST_DORMANT_LOOK, GHOST_HUNT_ALPHA, enemyArtFlipX, enemyArtKey, enemyArtLook } from '../src/render/enemyArt';
import { ENEMY_TYPES, spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { DWELLER_RULES, dwellerShot, stepDweller, type DwellerState } from '../src/data/dwellers';
import { dormantGhost, GHOST_RULES } from '../src/data/chasers';
import { AREAS } from '../src/data/areas';
import { ABYSS_PHASES } from '../src/data/abyss';
import { WORLD } from '../src/data/balance';

// Files read straight off disk: Vitest serves image imports as URLs, not bytes. (No Node types here.)
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const pngSize = (file: string, dir = 'area1') => {
  const b = read(`../src/assets/enemies/${dir}/${file}`);
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return [u32(16), u32(20)];
};
const at = (kind: EnemyKind, ai?: unknown) => enemyArtKey({ kind, ai } as never);
const AREA2_KEYS = ['enemy-ghost-dormant', 'enemy-ghost-hunt', 'enemy-bone-hopper-sit', 'enemy-bone-hopper-windup', 'enemy-bone-hopper-air',
  'enemy-bone-thrower-idle', 'enemy-bone-thrower-windup', 'enemy-flying-skull-calm', 'enemy-flying-skull-angry', 'enemy-shade-orb-idle'];
const AREA3_KEYS = ['enemy-squid-rise', 'enemy-squid-poise', 'enemy-squid-dive', 'enemy-shell-swimmer-idle', 'enemy-riser-jelly-idle', 'enemy-biter-idle'];

/** AREA 1 ENEMY ART: images for the AREA 1 roster, on the enemies the model already has. */
describe('the images', () => {
  it('cover exactly AREA 1\'s roster, twelve 64x64 files from src/assets', () => {
    const area1 = AREAS.find(a => a.id === 1)!;
    expect([...ENEMY_ART_KINDS].sort()).toEqual([...area1.enemyPool].sort());
    const area1Keys = Object.keys(ENEMY_ART_URLS).filter(key => !AREA2_KEYS.includes(key) && !AREA3_KEYS.includes(key));
    expect(area1Keys).toHaveLength(12);
    for (const key of area1Keys) {
      const url = ENEMY_ART_URLS[key];
      expect(url, key).not.toMatch(/(^|\/)(output|dist)\//);
      expect(pngSize(`${key.replace(/^enemy-/, '')}.png`), key).toEqual([64, 64]);
    }
    expect(ENEMY_ART_PLACEMENT).toEqual({ size: 64, originX: 0.5, originY: 0.5, scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('maps each kind to its texture', () => {
    expect(at('slime')).toBe('enemy-slime-idle');
    expect(at('spore')).toBe('enemy-spore-idle');
    expect(at('armoredSlime')).toBe('enemy-armored-slime-idle');
    expect(at('shellback')).toBe('enemy-shellback-idle');
    expect(at('creeper')).toBe('enemy-creeper-idle');
    expect(at('watcher')).toBe('enemy-watcher-idle');
    for (const key of Object.keys(ENEMY_ART_URLS)) expect(Object.keys(ENEMY_ART_URLS)).toContain(key);
  });

  it('follows the cave bat\'s own AI state: hang, unfurl, chase', () => {
    for (const state of ['hang', 'unfurl', 'chase'] as const) expect(at('caveBat', { kind: 'bat', state }), state).toBe(`enemy-cave-bat-${state}`);
    // Without the AI the model gives it, there is no state to show: the procedural look draws it.
    expect(at('caveBat')).toBeNull();
    // A freshly laid cave bat starts hanging, as the AI says.
    expect(enemyArtKey(spawnEnemy('caveBat', 1, 200, 300))).toBe('enemy-cave-bat-hang');
  });

  it('follows the toad\'s own AI state: sit, windup, air -- and nothing else that hops', () => {
    for (const state of ['sit', 'windup', 'air'] as const) expect(at('toad', { kind: 'hop', role: 'frog', state }), state).toBe(`enemy-toad-${state}`);
    expect(at('toad', { kind: 'hop', role: 'groundSkull', state: 'sit' })).toBeNull();
    expect(at('toad')).toBeNull();
  });

  it('leaves every other kind -- AREA 4 and the boss\'s own -- to the procedural look', () => {
    const imaged = [...ENEMY_ART_KINDS, ...ENEMY_ART_KINDS_AREA2, ...ENEMY_ART_KINDS_AREA3] as readonly string[];
    const others = (Object.keys(ENEMY_TYPES) as EnemyKind[]).filter(k => !imaged.includes(k));
    expect(others.length).toBeGreaterThan(20);
    for (const kind of others) for (const where of [1, 2, 3, 4, 'boss'] as const) expect(enemyArtKey({ kind, ai: { kind: 'bat', state: 'hang' } } as never, where), kind).toBeNull();
    for (const area of AREAS.filter(a => a.id === 3 || a.id === 4)) for (const kind of area.enemyPool) {
      if (imaged.includes(kind) && kind !== 'shadeOrb') continue;
      expect(enemyArtKey(spawnEnemy(kind, 1, 200, 300), area.id), `${area.id}:${kind}`).toBeNull();
    }
    for (const kind of ['nimushiClone', 'nimushiShade', 'bounceTapioca'] as EnemyKind[]) expect(enemyArtKey(spawnEnemy(kind, 1, 200, 300), 'boss'), kind).toBeNull();
  });

  it('falls back to the procedural body when a texture is missing', () => {
    const scene = String(read('../src/scenes/GameScene.ts'));
    expect(scene).toContain('if (artKey && this.textures.exists(artKey)) {');
    expect(scene).toContain('this.enemyImage(artKey, x, y, !!hurt, enemyArtFlipX(e), enemyArtLook(e, artKey, this.model.elapsed, !!hurt));');
    // The procedural bodies it falls back to are all still there.
    for (const draw of ['this.ghost(e, x, y, !!hurt)', 'this.skull(e, x, y, !!hurt)', "type.silhouette === 'bones'", "type.silhouette === 'boneSkull'", "type.silhouette === 'orbShade'"]) expect(scene, draw).toContain(draw);
  });

  it('mirrors only the creeper, and only on the right wall', () => {
    expect(enemyArtFlipX({ kind: 'creeper', x: WORLD.wall + 13 })).toBe(false);
    expect(enemyArtFlipX({ kind: 'creeper', x: WORLD.width - WORLD.wall - 13 })).toBe(true);
    expect(enemyArtFlipX({ kind: 'slime', x: 400 })).toBe(false);
  });
});

describe('gameplay is untouched', () => {
  it('keeps every AREA 1 kind\'s rules exactly: stompability, shooting, HP, size, damage', () => {
    const rules = Object.fromEntries(ENEMY_ART_KINDS.map(k => {
      const t = ENEMY_TYPES[k];
      return [k, { stompable: t.stompable, shootable: t.shootable, hp: t.hp, bodyWidth: t.bodyWidth, damageCause: t.damageCause, flying: t.flying, spawnWeight: t.spawnWeight }];
    }));
    expect(rules).toEqual({
      slime: { stompable: true, shootable: true, hp: 1, bodyWidth: 26, damageCause: 'enemy', flying: false, spawnWeight: 1 },
      caveBat: { stompable: true, shootable: true, hp: 2, bodyWidth: 24, damageCause: 'enemy', flying: true, spawnWeight: 0.7 },
      spore: { stompable: true, shootable: true, hp: 3, bodyWidth: 28, damageCause: 'enemy', flying: true, spawnWeight: 1 },
      toad: { stompable: true, shootable: true, hp: 4, bodyWidth: 28, damageCause: 'enemy', flying: false, spawnWeight: 0.8 },
      armoredSlime: { stompable: false, shootable: true, hp: 1, bodyWidth: 26, damageCause: 'spike', flying: false, spawnWeight: 1 },
      shellback: { stompable: true, shootable: false, hp: 1, bodyWidth: 30, damageCause: 'enemy', flying: false, spawnWeight: 0.6 },
      creeper: { stompable: false, shootable: true, hp: 3, bodyWidth: 26, damageCause: 'spike', flying: true, spawnWeight: 0.5 },
      watcher: { stompable: false, shootable: true, hp: 4, bodyWidth: 26, damageCause: 'spike', flying: true, spawnWeight: 0.2 },
    });
  });

  it('still summons the same AREA 1 kinds in the FINAL BOSS', () => {
    expect(ABYSS_PHASES[0].summonPool).toEqual(['caveBat', 'spore', 'watcher']);
  });
});

const view = { top: 0, height: 800 };
const player = (x: number, y: number) => ({ x, y, grounded: 0 });
const area2 = AREAS.find(a => a.id === 2)!;

/** AREA 2 ENEMY ART: images for AREA 2's roster (its pool plus the ghosts), on the same model. */
describe('AREA 2 images', () => {
  it('cover exactly AREA 2\'s roster -- its pool and the ghost -- ten 64x64 files from src/assets', () => {
    expect([...ENEMY_ART_KINDS_AREA2].sort()).toEqual([...area2.enemyPool, 'ghost'].sort());
    expect(Object.keys(ENEMY_ART_URLS).filter(key => !AREA3_KEYS.includes(key))).toHaveLength(22);
    for (const key of AREA2_KEYS) {
      expect(ENEMY_ART_URLS[key], key).toBeTruthy();
      expect(ENEMY_ART_URLS[key], key).not.toMatch(/(^|\/)(output|dist)\//);
      expect(pngSize(`${key.replace(/^enemy-/, '')}.png`, 'area2'), key).toEqual([64, 64]);
    }
    // Placement is AREA 1's, unchanged: centred, scale 1.
    expect(ENEMY_ART_PLACEMENT).toEqual({ size: 64, originX: 0.5, originY: 0.5, scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('keeps AREA 1\'s mapping exactly as it was', () => {
    for (const where of [undefined, 1, 2, 'boss'] as const) {
      expect(enemyArtKey({ kind: 'slime' } as never, where)).toBe('enemy-slime-idle');
      expect(enemyArtKey({ kind: 'caveBat', ai: { kind: 'bat', state: 'unfurl' } } as never, where)).toBe('enemy-cave-bat-unfurl');
      expect(enemyArtKey({ kind: 'toad', ai: { kind: 'hop', role: 'frog', state: 'windup' } } as never, where)).toBe('enemy-toad-windup');
      expect(enemyArtKey({ kind: 'watcher' } as never, where)).toBe('enemy-watcher-idle');
    }
    const look = enemyArtLook(spawnEnemy('slime', 1, 200, 300), 'enemy-slime-idle', 3, true);
    expect(look).toEqual({ offsetX: 0, offsetY: 0, alpha: 1, crop: null });
  });

  it('GHOST: dormant in the wall shows only its faint face; hunting, the see-through body', () => {
    const ghost = spawnEnemy('ghost', 1, GHOST_RULES.wallDepth, 300, 0, 0.7, 'open');
    expect(enemyArtKey(ghost, 2)).toBeNull(); // no chase state yet: procedural
    ghost.ai = dormantGhost(40);
    expect(enemyArtKey(ghost, 2)).toBe('enemy-ghost-dormant');
    // Dormant: cropped to the head, at the procedural face's pulsing alpha (0.30-0.60), never the whole body.
    for (const t of [0, 0.4, 1.3, 2.9]) {
      const look = enemyArtLook(ghost, 'enemy-ghost-dormant', t, false);
      expect(look.crop).toEqual([25, 6, 16, 12]);
      expect(look.alpha).toBeCloseTo(0.45 + Math.sin(t * 2 + ghost.phase) * 0.15, 10);
      expect(look.alpha).toBeGreaterThanOrEqual(0.3 - 1e-9); expect(look.alpha).toBeLessThanOrEqual(0.6 + 1e-9);
    }
    // The shown face stays inside the 28px wall the ghost waits 14px deep in -- on either side.
    const [cx, , cw] = GHOST_DORMANT_LOOK.crop;
    for (const x of [GHOST_RULES.wallDepth, WORLD.width - GHOST_RULES.wallDepth]) {
      const left = x + GHOST_DORMANT_LOOK.offsetX + cx - 32, right = left + cw;
      const wall = x < WORLD.width / 2 ? [0, WORLD.wall] : [WORLD.width - WORLD.wall, WORLD.width];
      expect(left).toBeGreaterThanOrEqual(wall[0]); expect(right).toBeLessThanOrEqual(wall[1]);
    }
    (ghost.ai as { state: string }).state = 'hunt';
    expect(enemyArtKey(ghost, 2)).toBe('enemy-ghost-hunt');
    expect(enemyArtLook(ghost, 'enemy-ghost-hunt', 1, false)).toEqual({ offsetX: 0, offsetY: 0, alpha: GHOST_HUNT_ALPHA.normal, crop: null });
    expect(enemyArtLook(ghost, 'enemy-ghost-hunt', 1, true).alpha).toBe(GHOST_HUNT_ALPHA.hurt);
    expect(GHOST_HUNT_ALPHA).toEqual({ normal: 0.62, hurt: 0.9 });
    // Its rules and the schedule's timing are the chase's own, untouched.
    expect(GHOST_RULES).toMatchObject({ hudClear: 190, wakeLead: 90, wallDepth: 14, catchUp: 420, seenBeforeHit: 1.0, activeCap: 2, huntTime: 7 });
  });

  it('BONE HOPPER: follows its own hop state -- sit, windup, air -- and no frog\'s', () => {
    const hopper = spawnEnemy('boneHopper', 1, 200, 300, 40);
    expect(hopper.ai).toMatchObject({ kind: 'hop', role: 'groundSkull', state: 'sit' });
    expect(enemyArtKey(hopper, 2)).toBe('enemy-bone-hopper-sit');
    for (const state of ['sit', 'windup', 'air'] as const) expect(at('boneHopper', { kind: 'hop', role: 'groundSkull', state }), state).toBe(`enemy-bone-hopper-${state}`);
    expect(at('boneHopper', { kind: 'hop', role: 'frog', state: 'sit' })).toBeNull();
    expect(at('toad', { kind: 'hop', role: 'groundSkull', state: 'sit' })).toBeNull();
    // Its hop is the model's: no windup today (it goes sit -> air), and the image does not add one.
    expect(DWELLER_RULES.groundSkull).toEqual({ wait: [0.35, 0.9], windup: 0, jump: 300, run: 70 });
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) { stepDweller(hopper, hopper.ai as DwellerState, player(260, 300), 1 / 60, view); seen.add(enemyArtKey(hopper, 2)!); }
    expect([...seen].sort()).toEqual(['enemy-bone-hopper-air', 'enemy-bone-hopper-sit']);
  });

  it('BONE THROWER: idle, then its windup image for exactly the model\'s windup; the bone still leaves from (x, y - 14)', () => {
    const thrower = spawnEnemy('boneThrower', 1, 200, 300, 20);
    expect(enemyArtKey(thrower, 2)).toBe('enemy-bone-thrower-idle');
    expect(at('boneThrower', { kind: 'throw', t: 0, windup: 0.2 })).toBe('enemy-bone-thrower-windup');
    expect(at('boneThrower', { kind: 'throw', t: 0, windup: 0 })).toBe('enemy-bone-thrower-idle');
    expect(DWELLER_RULES.skeleton).toEqual({ range: 330, every: 1.7, windup: 0.35, boneVx: 165, boneVy: -430 });
    let windupSteps = 0, bone: { x: number; y: number } | null = null;
    for (let i = 0; i < 600 && !bone; i++) {
      const signal = stepDweller(thrower, thrower.ai as DwellerState, player(300, 400), 1 / 120, view);
      if (signal?.type === 'bone') bone = signal;
      else if (enemyArtKey(thrower, 2) === 'enemy-bone-thrower-windup') windupSteps++;
    }
    expect(bone).toEqual(expect.objectContaining({ x: thrower.x, y: thrower.y - 14 }));
    expect(windupSteps * (1 / 120)).toBeCloseTo(DWELLER_RULES.skeleton.windup, 1);
    expect(enemyArtKey(thrower, 2)).toBe('enemy-bone-thrower-idle');
    // Visual only: raised 7px so its feet stand on the ledge (a guard's y is the ledge's minus 15).
    expect(BONE_THROWER_OFFSET_Y).toBe(-7);
    for (const key of ['enemy-bone-thrower-idle', 'enemy-bone-thrower-windup']) expect(enemyArtLook(thrower, key, 0, false)).toEqual({ offsetX: 0, offsetY: -7, alpha: 1, crop: null });
  });

  it('FLYING SKULL: calm while stompable; shot, it turns angry and cannot be stood on -- the image follows, never leads', () => {
    const skull = spawnEnemy('flyingSkull', 1, 200, 300, 0, 0, 'open');
    expect(skull.stompable).toBe(true);
    expect(enemyArtKey(skull, 2)).toBe('enemy-flying-skull-calm');
    expect(enemyArtKey(skull, 'boss')).toBe('enemy-flying-skull-calm');
    // Reading the image never changes the state or the flag.
    enemyArtKey(skull, 2); enemyArtLook(skull, 'enemy-flying-skull-calm', 1, false);
    expect(skull.stompable).toBe(true); expect(skull.ai).toMatchObject({ kind: 'wander', state: 'calm' });
    dwellerShot(skull, skull.ai as DwellerState);
    expect(skull.stompable).toBe(false);
    expect(enemyArtKey(skull, 2)).toBe('enemy-flying-skull-angry');
    expect(at('flyingSkull', { kind: 'skull', state: 'idle' })).toBeNull();
  });

  it('SHADE ORB: its image in AREA 2 and the boss\'s AREA 2 phase; AREA 4 keeps the procedural orb', () => {
    const orb = spawnEnemy('shadeOrb', 1, 200, 300, 0, 0, 'open');
    expect(enemyArtKey(orb, 2)).toBe('enemy-shade-orb-idle');
    expect(enemyArtKey(orb, 'boss')).toBe('enemy-shade-orb-idle');
    expect(enemyArtKey(orb, 4)).toBeNull();
    expect(enemyArtKey(orb)).toBeNull();
    expect(enemyArtKey(spawnEnemy('angryOrb', 1, 200, 300), 4)).toBeNull();
    expect(AREAS.find(a => a.id === 4)!.enemyPool).toContain('shadeOrb');
    expect(ABYSS_PHASES.map(p => p.summonPool.includes('shadeOrb'))).toEqual([false, true, false, false]);
  });
});

describe('AREA 2 gameplay is untouched', () => {
  it('keeps every AREA 2 kind\'s rules exactly: stompability, shooting, HP, size, damage, weight', () => {
    const rules = Object.fromEntries(ENEMY_ART_KINDS_AREA2.map(k => {
      const t = ENEMY_TYPES[k];
      return [k, { stompable: t.stompable, shootable: t.shootable, hp: t.hp, bodyWidth: t.bodyWidth, damageCause: t.damageCause, flying: t.flying, spawnWeight: t.spawnWeight, behaviour: t.behaviour }];
    }));
    expect(rules).toEqual({
      ghost: { stompable: true, shootable: true, hp: 2, bodyWidth: 26, damageCause: 'enemy', flying: true, spawnWeight: 0, behaviour: undefined },
      boneHopper: { stompable: true, shootable: true, hp: 2, bodyWidth: 22, damageCause: 'enemy', flying: false, spawnWeight: 1, behaviour: 'groundSkull' },
      boneThrower: { stompable: true, shootable: true, hp: 5, bodyWidth: 26, damageCause: 'enemy', flying: false, spawnWeight: 0.8, behaviour: 'throw' },
      flyingSkull: { stompable: true, shootable: true, hp: 3, bodyWidth: 24, damageCause: 'enemy', flying: true, spawnWeight: 0.8, behaviour: 'wander' },
      shadeOrb: { stompable: false, shootable: true, hp: 2, bodyWidth: 24, damageCause: 'spike', flying: true, spawnWeight: 1, behaviour: 'phantom' },
    });
  });

  it('still summons the same kinds in every FINAL BOSS phase', () => {
    expect(ABYSS_PHASES.map(p => p.summonPool)).toEqual([['caveBat', 'spore', 'watcher'], ['flyingSkull', 'shadeOrb'], ['biter', 'riserJelly'], ['voidWisp', 'hollowShade', 'angryOrb']]);
    expect(ABYSS_PHASES.map(p => p.clonePool)).toEqual([['nimushiClone'], ['nimushiClone'], ['nimushiClone'], ['nimushiShade']]);
  });
});

const area3 = AREAS.find(a => a.id === 3)!;

/** AREA 3 ENEMY ART: images for AREA 3's pool, on the same model; the boss's AREA 3 summons share them. */
describe('AREA 3 images', () => {
  it('cover exactly AREA 3\'s pool, six 64x64 files from src/assets', () => {
    expect([...ENEMY_ART_KINDS_AREA3].sort()).toEqual([...area3.enemyPool].sort());
    expect(Object.keys(ENEMY_ART_URLS)).toHaveLength(28);
    for (const key of AREA3_KEYS) {
      expect(ENEMY_ART_URLS[key], key).toBeTruthy();
      expect(ENEMY_ART_URLS[key], key).not.toMatch(/(^|\/)(output|dist)\//);
      expect(pngSize(`${key.replace(/^enemy-/, '')}.png`, 'area3'), key).toEqual([64, 64]);
    }
    expect(ENEMY_ART_PLACEMENT).toEqual({ size: 64, originX: 0.5, originY: 0.5, scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('maps each AREA 3 kind to its texture, placed plainly', () => {
    const squid = spawnEnemy('squid', 1, 200, 300, 0, 0, 'open');
    expect(enemyArtKey(squid, 3)).toBe('enemy-squid-rise');
    expect(enemyArtKey(spawnEnemy('shellSwimmer', 1, 200, 300, 0, 0, 'open'), 3)).toBe('enemy-shell-swimmer-idle');
    expect(enemyArtKey(spawnEnemy('riserJelly', 1, 200, 300, 0, 0, 'open'), 3)).toBe('enemy-riser-jelly-idle');
    expect(enemyArtKey(spawnEnemy('biter', 1, 200, 300, 0, 0, 'open'), 3)).toBe('enemy-biter-idle');
    for (const key of AREA3_KEYS) expect(enemyArtLook(squid, key, 1, true), key).toEqual({ offsetX: 0, offsetY: 0, alpha: 1, crop: null });
    // No squid AI, no state to show: the procedural body draws it.
    expect(at('squid')).toBeNull();
    expect(at('squid', { kind: 'bat', state: 'hang' })).toBeNull();
  });

  it('SQUID: rise, poise, dive follow its own state; it turns unstompable exactly as the dive starts -- the image follows, never leads', () => {
    for (const state of ['rise', 'poise', 'dive'] as const) expect(at('squid', { kind: 'squid', state, t: 0 }), state).toBe(`enemy-squid-${state}`);
    expect(DWELLER_RULES.squid).toEqual({ rise: 55, dive: 390, turnLine: 250, poise: 0.3 });
    const squid = spawnEnemy('squid', 1, 200, 600, 0, 0, 'open');
    expect(squid.stompable).toBe(true);
    const seen: { key: string; stompable: boolean }[] = [];
    let poiseSteps = 0;
    for (let i = 0; i < 1200; i++) {
      stepDweller(squid, squid.ai as DwellerState, player(200, 700), 1 / 120, view);
      const key = enemyArtKey(squid, 3)!;
      if (key === 'enemy-squid-poise') poiseSteps++;
      if (seen.at(-1)?.key !== key) seen.push({ key, stompable: squid.stompable });
      // Every frame: the image and the model agree -- dive image iff unstompable.
      expect(key === 'enemy-squid-dive', `${i}`).toBe(!squid.stompable);
    }
    expect(seen).toEqual([
      { key: 'enemy-squid-rise', stompable: true },
      { key: 'enemy-squid-poise', stompable: true },
      { key: 'enemy-squid-dive', stompable: false },
    ]);
    expect(poiseSteps * (1 / 120)).toBeCloseTo(DWELLER_RULES.squid.poise, 1);
  });

  it('SHELL SWIMMER: one image; still stompable and still immune to shots', () => {
    const swimmer = spawnEnemy('shellSwimmer', 1, 200, 300, 0, 1, 'open');
    expect(swimmer.ai).toMatchObject({ kind: 'bounce', vy: 0 });
    expect(swimmer.stompable).toBe(true);
    expect(swimmer.shootable).toBe(false);
  });

  it('SHELL SWIMMER: art faces left, mirrored while it swims right -- turning at the wall, never moved by it', () => {
    const at = (vx: number) => enemyArtFlipX({ kind: 'shellSwimmer', x: 200, ai: { kind: 'bounce', vx, vy: 0, top: 300, bottom: 300, seen: 0 } });
    expect(at(-DWELLER_RULES.swim.speed)).toBe(false);
    expect(at(DWELLER_RULES.swim.speed)).toBe(true);
    expect(enemyArtFlipX({ kind: 'shellSwimmer', x: 200 })).toBe(false); // no AI: unmirrored
    // Swims right into the right wall, turns, swims left: the image follows vx every step.
    const swimmer = spawnEnemy('shellSwimmer', 1, WORLD.width - WORLD.wall - 60, 300, 0, 0, 'open'); // phase 0 -> starts right
    expect(swimmer.ai).toMatchObject({ kind: 'bounce', vx: DWELLER_RULES.swim.speed, vy: 0 });
    const seen: boolean[] = [];
    let lastX = swimmer.x;
    for (let i = 0; i < 180; i++) {
      stepDweller(swimmer, swimmer.ai as DwellerState, player(100, 300), 1 / 60, view);
      const flip = enemyArtFlipX(swimmer);
      // Facing is the model's vx, every step; on the step it meets the wall it has already turned.
      expect(flip, `${i}`).toBe((swimmer.ai as { vx: number }).vx > 0);
      const turning = swimmer.x === WORLD.width - WORLD.wall - 12;
      if (swimmer.x !== lastX && !turning) expect(flip, `${i}`).toBe(swimmer.x > lastX);
      if (seen.at(-1) !== flip) seen.push(flip);
      lastX = swimmer.x;
    }
    expect(seen).toEqual([true, false]);
    expect(swimmer.y).toBe(300);
    // Visual only: still stompable, still immune to shots, same speed.
    expect(swimmer.stompable).toBe(true); expect(swimmer.shootable).toBe(false);
    expect(DWELLER_RULES.swim).toEqual({ speed: 62 });
  });

  it('RISER JELLY: one image through its pause and its rise', () => {
    const jelly = spawnEnemy('riserJelly', 1, 200, 500, 0, 0, 'open');
    const keys = new Set<string>();
    for (let i = 0; i < 300; i++) { stepDweller(jelly, jelly.ai as DwellerState, player(200, 700), 1 / 60, view); keys.add(enemyArtKey(jelly, 3)!); }
    expect(jelly.y).toBeLessThan(500);
    expect([...keys]).toEqual(['enemy-riser-jelly-idle']);
    expect(DWELLER_RULES.jelly).toEqual({ pause: 0.5, move: 0.7, dx: 46, dy: 64 });
  });

  it('BITER: art faces right, mirrored while its chase velocity points left -- never moved by it', () => {
    expect(enemyArtFlipX({ kind: 'biter', x: 200, ai: { kind: 'eye', role: 'piranha', vx: 130, vy: 0, t: 0, seen: 0 } })).toBe(false);
    expect(enemyArtFlipX({ kind: 'biter', x: 200, ai: { kind: 'eye', role: 'piranha', vx: -130, vy: 0, t: 0, seen: 0 } })).toBe(true);
    const biter = spawnEnemy('biter', 1, 250, 400, 0, 0, 'open');
    expect(biter.ai).toMatchObject({ kind: 'eye', role: 'piranha', vx: 0 });
    expect(enemyArtFlipX(biter)).toBe(false); // not moved yet: faces right, as the procedural jaws did
    for (let i = 0; i < 20; i++) stepDweller(biter, biter.ai as DwellerState, player(100, 400), 1 / 60, view);
    expect(biter.x).toBeLessThan(250);
    expect(enemyArtFlipX(biter)).toBe(true);
    const x = biter.x;
    for (let i = 0; i < 40; i++) stepDweller(biter, biter.ai as DwellerState, player(400, 400), 1 / 60, view);
    expect(biter.x).toBeGreaterThan(x);
    expect(enemyArtFlipX(biter)).toBe(false);
    // Only the biter, the shell swimmer and the creeper are ever mirrored -- each by its own state.
    for (const kind of ['squid', 'shellSwimmer', 'riserJelly'] as const) expect(enemyArtFlipX({ kind, x: 400, ai: { kind: 'eye', role: 'piranha', vx: -1, vy: 0, t: 0, seen: 0 } }), kind).toBe(false);
    expect(DWELLER_RULES.piranha).toEqual({ speed: 130, wobble: 0, wobbleRate: 0 });
  });

  it('keeps AREA 1 and AREA 2 exactly as they were, and AREA 4 procedural', () => {
    expect(enemyArtKey({ kind: 'slime' } as never, 3)).toBe('enemy-slime-idle');
    expect(enemyArtKey({ kind: 'caveBat', ai: { kind: 'bat', state: 'chase' } } as never, 3)).toBe('enemy-cave-bat-chase');
    expect(enemyArtKey(spawnEnemy('flyingSkull', 1, 200, 300, 0, 0, 'open'), 2)).toBe('enemy-flying-skull-calm');
    expect(enemyArtKey(spawnEnemy('shadeOrb', 1, 200, 300, 0, 0, 'open'), 2)).toBe('enemy-shade-orb-idle');
    expect(enemyArtKey(spawnEnemy('shadeOrb', 1, 200, 300, 0, 0, 'open'), 3)).toBeNull();
    expect(enemyArtKey(spawnEnemy('shadeOrb', 1, 200, 300, 0, 0, 'open'), 4)).toBeNull();
    expect(enemyArtFlipX({ kind: 'creeper', x: WORLD.width - WORLD.wall - 13 })).toBe(true);
    const area4 = AREAS.find(a => a.id === 4)!;
    for (const kind of area4.enemyPool) {
      if (kind === 'shadeOrb') continue;
      expect(enemyArtKey(spawnEnemy(kind, 1, 200, 300, 0, 0, 'open'), 4), kind).toBeNull();
    }
    for (const kind of ENEMY_ART_KINDS_AREA3) expect(area4.enemyPool as readonly string[]).not.toContain(kind);
  });

  it('shows the same images for the FINAL BOSS\'s AREA 3 summons; its own kinds stay procedural', () => {
    expect(ABYSS_PHASES[2].summonPool).toEqual(['biter', 'riserJelly']);
    expect(enemyArtKey(spawnEnemy('biter', -1, 200, 300, 34, 1, 'open'), 'boss')).toBe('enemy-biter-idle');
    expect(enemyArtKey(spawnEnemy('riserJelly', -1, 200, 300, 34, 1, 'open'), 'boss')).toBe('enemy-riser-jelly-idle');
    for (const kind of ['nimushiClone', 'nimushiShade', 'bounceTapioca'] as EnemyKind[]) expect(enemyArtKey(spawnEnemy(kind, 1, 200, 300), 'boss'), kind).toBeNull();
  });
});

describe('AREA 3 gameplay is untouched', () => {
  it('keeps every AREA 3 kind\'s rules exactly: stompability, shooting, HP, size, damage, weight', () => {
    const rules = Object.fromEntries(ENEMY_ART_KINDS_AREA3.map(k => {
      const t = ENEMY_TYPES[k];
      return [k, { stompable: t.stompable, shootable: t.shootable, hp: t.hp, bodyWidth: t.bodyWidth, damageCause: t.damageCause, flying: t.flying, spawnWeight: t.spawnWeight, behaviour: t.behaviour }];
    }));
    expect(rules).toEqual({
      squid: { stompable: true, shootable: true, hp: 1, bodyWidth: 22, damageCause: 'enemy', flying: true, spawnWeight: 1, behaviour: 'squid' },
      shellSwimmer: { stompable: true, shootable: false, hp: 1, bodyWidth: 30, damageCause: 'enemy', flying: true, spawnWeight: 0.7, behaviour: 'swim' },
      riserJelly: { stompable: false, shootable: true, hp: 3, bodyWidth: 24, damageCause: 'spike', flying: true, spawnWeight: 1, behaviour: 'rise' },
      biter: { stompable: false, shootable: true, hp: 2, bodyWidth: 24, damageCause: 'spike', flying: true, spawnWeight: 0.5, behaviour: 'piranha' },
    });
    expect(area3.enemyPool).toEqual(['squid', 'shellSwimmer', 'riserJelly', 'biter']);
  });
});
