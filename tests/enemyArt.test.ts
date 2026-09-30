import { describe, expect, it } from 'vitest';
import { ENEMY_ART_KINDS, ENEMY_ART_PLACEMENT, ENEMY_ART_URLS, enemyArtFlipX, enemyArtKey } from '../src/render/enemyArt';
import { ENEMY_TYPES, spawnEnemy, type EnemyKind } from '../src/data/enemies';
import { AREAS } from '../src/data/areas';
import { ABYSS_PHASES } from '../src/data/abyss';
import { WORLD } from '../src/data/balance';

// Files read straight off disk: Vitest serves image imports as URLs, not bytes. (No Node types here.)
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const pngSize = (file: string) => {
  const b = read(`../src/assets/enemies/area1/${file}`);
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return [u32(16), u32(20)];
};
const at = (kind: EnemyKind, ai?: unknown) => enemyArtKey({ kind, ai } as never);

/** AREA 1 ENEMY ART: images for the AREA 1 roster, on the enemies the model already has. */
describe('the images', () => {
  it('cover exactly AREA 1\'s roster, twelve 64x64 files from src/assets', () => {
    const area1 = AREAS.find(a => a.id === 1)!;
    expect([...ENEMY_ART_KINDS].sort()).toEqual([...area1.enemyPool].sort());
    expect(Object.keys(ENEMY_ART_URLS)).toHaveLength(12);
    for (const [key, url] of Object.entries(ENEMY_ART_URLS)) {
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

  it('leaves every other kind -- AREA 2-4 and the boss\'s own -- to the procedural look', () => {
    const others = (Object.keys(ENEMY_TYPES) as EnemyKind[]).filter(k => !(ENEMY_ART_KINDS as readonly string[]).includes(k));
    expect(others.length).toBeGreaterThan(20);
    for (const kind of others) expect(at(kind, { kind: 'bat', state: 'hang' }), kind).toBeNull();
    for (const area of AREAS.filter(a => a.id !== 1)) for (const kind of area.enemyPool) {
      if ((ENEMY_ART_KINDS as readonly string[]).includes(kind)) continue;
      expect(at(kind), `${area.id}:${kind}`).toBeNull();
    }
  });

  it('falls back to the procedural body when a texture is missing', () => {
    const scene = String(read('../src/scenes/GameScene.ts'));
    expect(scene).toContain('if (artKey && this.textures.exists(artKey)) { this.enemyImage(artKey, x, y, !!hurt, enemyArtFlipX(e)); return; }');
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
