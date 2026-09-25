import { describe, expect, it } from 'vitest';
import animationMapRaw from '../output/player-sprites-v1/animation-map.json?raw';
import { PLAYER_ART_ASSETS, artFrameUsable, type ArtMap } from '../src/render/playerArtAssets';
import { NIMUSHI_ART, nimushiArtPlacement, nimushiArtShade } from '../src/render/NimushiArt';
import { PLAYER_ANIMATIONS } from '../src/dev/playerAnimationState';
import { UPGRADES } from '../src/data/upgrades';
import { UPGRADE_ICON_ASSETS, UPGRADE_ICON_FILES, upgradeIcon } from '../src/data/upgradeIcons';
import codexMappingRaw from '../output/upgrade-icons-v1/mapping.json?raw';
import { upgradeCardHtml } from '../src/ui/upgradeCard';
import { entered, replaySignature } from './regressionSignature';

/**
 * EXTERNAL TEST BUILD: the approved PLAYER ART v1 and NIMUSHI images in the shipped game, the upgrade
 * choice's icon / name / line, and proof that none of it moved a single rule of play.
 */
const MAP = JSON.parse(animationMapRaw) as ArtMap & { cell: number };

describe('PLAYER ART v1 in the shipped game', () => {
  it('ships the approved sheets and map, by URL, at the approved 48px cell', () => {
    expect(PLAYER_ART_ASSETS.cell).toBe(48);
    expect(MAP.cell).toBe(48);
    for (const url of [PLAYER_ART_ASSETS.map, ...Object.values(PLAYER_ART_ASSETS.sheets)]) {
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
    // The three approved v1 sheets, plus the contact- and stomp-rebound frames as one-cell sheets of their own.
    expect(Object.keys(PLAYER_ART_ASSETS.sheets).sort()).toEqual(['boss', 'contact', 'normal', 'shared', 'stomp']);
  });

  it('has a frame, on a shipped sheet, for every frame of every animation the game asks for', () => {
    for (const [pose, [count]] of Object.entries(PLAYER_ANIMATIONS) as [string, readonly [number, ...unknown[]]][]) {
      for (let i = 0; i < count; i++) {
        const key = `${pose}_${String(i).padStart(2, '0')}`;
        const frame = MAP.frames[key];
        expect(frame, key).toBeDefined();
        expect(Object.keys(PLAYER_ART_ASSETS.sheets)).toContain(frame.group);
      }
    }
  });

  it('falls back to the procedural body when the map or a sheet is missing', () => {
    const loaded = () => true, missing = () => false;
    expect(artFrameUsable(MAP, 'fall_00', loaded)).toBeDefined();
    expect(artFrameUsable(MAP, 'fall_00', missing)).toBeUndefined();
    expect(artFrameUsable(undefined, 'fall_00', loaded)).toBeUndefined();
    expect(artFrameUsable(MAP, 'no_such_pose_00', loaded)).toBeUndefined();
  });
});

describe('NIMUSHI in the shipped fight', () => {
  it('ships the HIGH idle image, 256x224, on the approved alignment B', () => {
    expect(typeof NIMUSHI_ART.url).toBe('string');
    expect(NIMUSHI_ART.url.length).toBeGreaterThan(0);
    expect([NIMUSHI_ART.width, NIMUSHI_ART.height]).toEqual([256, 224]);
    expect(NIMUSHI_ART.pivot).toEqual({ x: 128, y: 40 });
    expect(NIMUSHI_ART.renderOffsetY).toBe(-16);
  });

  it('places it exactly where the approved live review did: pivot on the body centre, 16px up', () => {
    const body = { x: 141, y: 1000, width: 168, height: 112 };
    const at = nimushiArtPlacement(body, 700);
    // live.js (resolution-review-v1): x = centreX - 128, y = centreY - cam - 40 + (B ? -16 : 0)
    expect(at).toEqual({ x: 141 + 84 - 128, y: 1000 + 56 - 700 - 40 - 16 });
  });

  it('reads the barrier and the damage window differently, with one frame', () => {
    const base = { pose: 'idle', barrier: false, hitFlash: 0, rageActive: false, started: true };
    const open = nimushiArtShade(base);
    const shut = nimushiArtShade({ ...base, pose: 'closed', barrier: true });
    expect(open.tint).toBe(0xffffff);
    expect(shut.tint).not.toBe(open.tint);
    // A landed shot flashes it white; the defeat fades it.
    expect(nimushiArtShade({ ...base, hitFlash: 1 })).toEqual({ tint: 0xffffff, fill: true, alpha: 1 });
    expect(nimushiArtShade({ ...base, pose: 'dead' }).alpha).toBeLessThan(1);
  });
});

describe('upgrade icons and the choice card', () => {
  // Codex's UPGRADE ICONS v1: mapping.json names the 64px file for each upgrade id.
  const CODEX_MAPPING = JSON.parse(codexMappingRaw) as Record<string, string>;
  const SHIPPED_FILES = Object.keys(import.meta.glob('../src/assets/upgrades/*.png')).map(p => p.split('/').pop()!);

  it('maps all twenty upgrades, exactly as mapping.json does, with no duplicates', () => {
    const ids = UPGRADES.map(u => u.id).sort();
    expect(Object.keys(UPGRADE_ICON_FILES).sort()).toEqual(ids);
    expect(Object.keys(CODEX_MAPPING).sort()).toEqual(ids);
    for (const u of UPGRADES) expect({ id: u.id, file: UPGRADE_ICON_FILES[u.id] }).toEqual({ id: u.id, file: CODEX_MAPPING[u.id].split('/').pop() });
    expect(new Set(Object.values(UPGRADE_ICON_FILES)).size).toBe(20);
  });

  it('ships a file for every one of them, and resolves each to an image', () => {
    expect(SHIPPED_FILES.sort()).toEqual(Object.values(UPGRADE_ICON_FILES).sort());
    for (const u of UPGRADES) {
      const src = UPGRADE_ICON_ASSETS[u.id];
      expect(typeof src, u.id).toBe('string');
      expect(upgradeIcon(u)).toEqual({ kind: 'image', src, fallback: u.icon });
    }
    expect(new Set(Object.values(UPGRADE_ICON_ASSETS)).size).toBe(20);
  });

  it('falls back to the upgrade\'s own glyph where a file is missing, and when an image fails to load', () => {
    const apple = UPGRADES.find(u => u.id === 'apple')!;
    expect(upgradeIcon(apple, {})).toEqual({ kind: 'glyph', text: apple.icon });
    expect(upgradeIcon(apple, { apple: null })).toEqual({ kind: 'glyph', text: apple.icon });
    const html = upgradeCardHtml(apple, 0);
    expect(html).toContain(`data-fallback="${apple.icon}"`);
    expect(html).toContain('onerror="this.replaceWith(document.createTextNode(this.dataset.fallback))"');
  });

  it('keeps the card ICON / NAME / one short line, with the image in the icon slot', () => {
    for (const [i, u] of UPGRADES.entries()) {
      const html = upgradeCardHtml(u, i);
      expect(html).toContain(`<span class="upgrade-icon"><img src="${UPGRADE_ICON_ASSETS[u.id]}" alt="" width="32" height="32"`);
      expect(html).toContain(`<strong>${u.name}</strong><small>${u.short}</small>`);
      expect(html).toContain(`id="upgrade-${i}" aria-pressed="false"`);
      expect(html).not.toContain(u.description);
      expect(html).not.toContain('ORIGIN');
      expect(u.short.length, u.id).toBeLessThanOrEqual(20);
    }
    expect(UPGRADES.find(u => u.id === 'safetyJetpack')!.short).toBe('EMPTY時にFIREで短時間ホバー');
  });
});

describe('isolation from 7e958e7', () => {
  /** Replays from each SECTION's entry and from the fight's, taken on 7e958e7 with this helper. */
  const AT_7E958E7: Record<string, string> = {
    '1-1': '414b1f52261b82c067509d92', '1-2': '22ddb6304f988ed56d4538e5', '1-3': '683c2598a46b4eadcc576b35',
    '2-1': '95ebcdc29407d78501ec1a47', '2-2': 'f5d50c7e36c05e33c315524d', '2-3': 'e5f4c74110599c23f5ad5b62',
    '3-1': 'd813e6aa01f3d20ed9e034a4', '3-2': '27a110a2880f9aaaafae8a08', '3-3': 'b1c14c441b457f2baa84336f',
    '4-1': '9e7c6b738ad3bd3514afd646', '4-2': '516e68ff1ffddfa04e93b75f', '4-3': '2ebcb752cd22d061e39e6733',
    boss: '47f4f796c2f3b2c98507455f',
  };
  it('plays all twelve SECTIONs exactly as 7e958e7 did', () => {
    for (const a of [1, 2, 3, 4] as const) for (const s of [1, 2, 3] as const) {
      expect(replaySignature(entered(g => g.jumpToStage(a, s))), `${a}-${s}`).toBe(AT_7E958E7[`${a}-${s}`]);
    }
  });
  it('plays the FINAL BOSS exactly as 7e958e7 did', () => {
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe(AT_7E958E7.boss);
  });
});
