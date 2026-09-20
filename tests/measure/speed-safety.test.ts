import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD } from '../../src/data/balance';
import { spawnEnemy } from '../../src/data/enemies';
import { spawnDoodad } from '../../src/data/doodads';
import { spikePlatform, SPIKE_PLATFORM_RULES, PLATFORM_THICKNESS, EXIT_RULES } from '../../src/data/structures';
import { SAFE_ZONE_RULES } from '../../src/data/safeZone';
import type { Platform } from '../../src/systems/StageGenerator';

/**
 * COLLISION-RISK AUDIT for the speed candidates.
 *
 * Every mechanic that resolves against a moving player is exercised at each profile's terminal
 * velocity. The question is not "is the code swept" but "does the interaction still happen", so each
 * check drives the real model and reads a real outcome.
 */
const STEP = 1 / 120;
const seeded = (n: number) => () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
import { SPEED_PROFILES } from '../../src/data/speedProfiles';
import { BREAK_BLOCK_RULES, LIMBO_HAZARD_RULES, AIR_CONTAINER_RULES } from '../../src/data/structures';

const PROFILES = [
  { name: 'CURRENT', fall: 520, move: 180, gravity: 900 },
  { name: 'FAST-A', fall: 640, move: 220, gravity: 900 },
  { name: 'FAST-B', fall: 760, move: 260, gravity: 900 },
  { name: 'FAST-C', fall: 900, move: 300, gravity: 900 },
  { name: 'VIDEO', fall: SPEED_PROFILES.video.maxFallSpeed, move: SPEED_PROFILES.video.moveSpeed, gravity: SPEED_PROFILES.video.gravity },
] as const;

function rig(fall: number, move: number, seed = 9, gravity = 900) {
  const g = new GameModel(false, seeded(seed));
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = []; g.safeZones = [];
  g.stats.maxFallSpeed = fall; g.stats.moveSpeed = move; g.stats.gravity = gravity;
  return g;
}
const ledge = (y: number): Platform => ({ id: 7001, x: 120, y, width: 200, height: PLATFORM_THICKNESS, breakable: false, state: 'stable' } as Platform);

describe('D. COLLISION-RISK AUDIT', () => {
  it('runs every check at every candidate speed', () => {
    const rows: string[] = [];
    for (const p of PROFILES) {
      const res: Record<string, string> = {};

      // 1. PLATFORM LANDING at terminal, from directly above.
      {
        let ok = true;
        for (let off = 0; off < 12; off++) {          // sub-step phases, so a lucky alignment can't pass it
          const g = rig(p.fall, p.move, 9, p.gravity);
          g.platforms = [ledge(700)];
          g.player.x = 225; g.player.y = 300 + off * (p.fall / 120) / 12; g.player.vy = p.fall;
          for (let i = 0; i < 200 && g.player.grounded === -1; i++) { g.step(STEP, 0, false); if (g.player.y > 900) break; }
          if (g.player.grounded === -1) ok = false;
        }
        res.platform = ok ? 'ok' : 'PASS-THROUGH';
      }

      // 2. ENEMY STOMP at terminal.
      {
        const g = rig(p.fall, p.move, 9, p.gravity);
        g.platforms = [];
        g.enemies = [spawnEnemy('slime', 1, 225, 700)];
        g.player.x = 225; g.player.y = 300; g.player.vy = p.fall;
        for (let i = 0; i < 200 && g.enemies[0]?.alive; i++) g.step(STEP, 0, false);
        res.stomp = g.kills === 1 ? 'ok' : 'MISSED';
      }

      // 3. SPIKE PLATFORM: land, then be hit by the spikes.
      {
        const g = rig(p.fall, p.move, 9, p.gravity);
        const trap = { ...ledge(700), spikePlatform: spikePlatform() } as Platform;
        g.platforms = [trap];
        g.player.x = 225; g.player.y = 300; g.player.vy = p.fall; g.player.invincible = 0;
        const hp0 = g.hp;
        for (let i = 0; i < 1200 && g.hp === hp0; i++) g.step(STEP, 0, false);
        res.spike = g.hp < hp0 ? 'ok' : 'NO HIT';
      }

      // 4. DOODAD contact at terminal.
      {
        const g = rig(p.fall, p.move, 9, p.gravity);
        g.platforms = []; g.ammo = 0;
        g.doodads = [spawnDoodad(1, 200, 700, 'lamp')];
        g.player.x = 210; g.player.y = 300; g.player.vy = p.fall;
        let bounced = false;
        for (let i = 0; i < 200; i++) { g.step(STEP, 0, false); if (g.player.vy < 0) { bounced = true; break; } }
        res.doodad = bounced && g.ammo > 0 ? 'ok' : bounced ? 'bounce, NO RELOAD' : 'MISSED';
      }

      // 5. SAFE ZONE entry at terminal.
      {
        const g = rig(p.fall, p.move, 9, p.gravity);
        g.platforms = [];
        g.safeZones = [{ id: 1, x: WORLD.wall, y: 700, width: SAFE_ZONE_RULES.width, height: SAFE_ZONE_RULES.height, side: -1, content: null } as never];
        g.player.x = WORLD.wall + 40; g.player.y = 300; g.player.vy = p.fall;
        let entered = false;
        for (let i = 0; i < 300; i++) { g.step(STEP, 0, false); if (g.timeFrozen) { entered = true; break; } }
        res.safeZone = entered ? 'ok' : 'SKIPPED';
      }

      // 5b. BREAK BLOCK: a gate block is an ordinary landing, so a fast fall must stop on it.
      {
        let ok = true;
        for (let phase = 0; phase < 12; phase++) {
          const g = rig(p.fall, p.move, 9, p.gravity);
          g.platforms = [{ id: 7100, x: 150, y: 800, width: 90, height: BREAK_BLOCK_RULES.thickness,
            breakBlock: { hits: 0, durability: BREAK_BLOCK_RULES.durability, reward: false } } as never];
          g.player.x = 195; g.player.y = 300 + phase * (p.fall / 120) / 12; g.player.vy = p.fall;
          for (let i = 0; i < 300 && g.player.grounded === -1; i++) { g.step(STEP, 0, false); if (g.player.y > 1100) break; }
          if (g.player.grounded === -1) ok = false;
        }
        res.breakBlock = ok ? 'ok' : 'PASS-THROUGH';
      }

      // 5c. AREA 3 AIR CONTAINER: swum into at terminal, it must still break.
      {
        let broke = 0;
        for (let phase = 0; phase < 12; phase++) {
          const g = rig(p.fall, p.move, 9, p.gravity);
          g.platforms = [];
          // AIR_CONTAINER_RULES exposes `size`, not width/height -- reading the latter built a NaN box
          // that nothing could ever touch, which read as MISSED 12/12 at every speed including CURRENT.
          const box = AIR_CONTAINER_RULES.size;
          g.containers = [{ id: 1, x: 200, y: 800, width: box, height: box, broken: false, debris: 0 } as never];
          g.player.x = 200 + box / 2; g.player.y = 300 + phase * (p.fall / 120) / 12; g.player.vy = p.fall;
          for (let i = 0; i < 300; i++) { g.platforms = []; g.step(STEP, 0, false); if (g.containers[0]?.broken) { broke++; break; } if (g.player.y > 1100) break; }
        }
        res.container = broke === 12 ? 'ok 12/12' : `MISSED ${12 - broke}/12`;
      }

      // 5d. AREA 4 LIMBO HAZARD: barbs on a row, which must hurt a player falling through them.
      {
        let hit = 0;
        for (let phase = 0; phase < 12; phase++) {
          const g = rig(p.fall, p.move, 9, p.gravity);
          g.platforms = [{ id: 7200, x: 150, y: 800, width: 160, height: 10, limboHazard: true } as never];
          g.player.x = 230; g.player.y = 300 + phase * (p.fall / 120) / 12; g.player.vy = p.fall; g.player.invincible = 0;
          const hp0 = g.hp;
          for (let i = 0; i < 300; i++) { g.step(STEP, 0, false); if (g.hp < hp0) { hit++; break; } if (g.player.y > 1200) break; }
        }
        res.limbo = hit === 12 ? 'ok 12/12' : `MISSED ${12 - hit}/12`;
      }

      // 6. EXIT GATE. This is the only discrete AABB test on the player's own path -- `enterExit`
      //    compares positions on the frame, with no sweep -- so it is the one place a faster fall
      //    could genuinely step over a trigger. Tested directly rather than through a run: an
      //    attempt to reach a real exit with a bot parked in a Safe Zone chamber at 83m and never
      //    came out, at CURRENT as much as at FAST-C, which measures the bot and not the speed.
      {
        let missed = 0;
        const gate = { x: 180, y: 900, width: EXIT_RULES.width, height: EXIT_RULES.height };
        for (let phase = 0; phase < 12; phase++) {          // every sub-step alignment
          const g = rig(p.fall, p.move, 9, p.gravity);
          g.platforms = [];
          g.exit = { ...gate } as never;
          g.player.x = gate.x + gate.width / 2;
          g.player.y = 400 + phase * (p.fall / 120) / 12;
          g.player.vy = p.fall;
          // Entering the gate fires an 'exit' event and moves the run to the upgrade screen; the
          // stage LABEL does not change until the card is confirmed, which an earlier version of
          // this check waited for and therefore reported 12/12 skipped at every speed including
          // CURRENT -- where a 104px window against 4.33px/step makes tunneling impossible.
          g.events.length = 0;
          let through = false;
          for (let i = 0; i < 400; i++) {
            g.platforms = [];
            g.step(STEP, 0, false);
            if (g.events.some(e => e.type === 'exit')) { through = true; break; }
            if (g.player.y > gate.y + gate.height + 200) break;
          }
          if (!through) missed++;
        }
        res.exit = missed === 0 ? 'ok 12/12 phases' : `SKIPPED at ${missed}/12 phases`;
        // The window the player must be caught by, against how far they move in one step.
        res.exitMargin = `${(EXIT_RULES.height + 30)}px window vs ${(p.fall / 120).toFixed(2)}px/step`;
      }

      // 7-9. A REAL RUN of AREAs 1-4: camera keeps the player on screen, AREA 3 oxygen ticks,
      //      AREA 4 still lays the doodads its CHARGE economy depends on.
      {
        let offscreen = 0, oxygenSeen = false, a4doodads = 0;
        for (const area of [1, 2, 3, 4] as const) {
          const g = new GameModel(false, seeded(area * 31 + 5));
          g.stats.maxFallSpeed = p.fall; g.stats.moveSpeed = p.move; g.stats.gravity = p.gravity;
          g.jumpToStage(area, 1);
          for (let i = 0; i < 120 * 60; i++) {
            g.player.invincible = 9;
            g.step(STEP, Math.sin(i / 70) > 0 ? 1 : -1, i % 40 === 0);
            if (g.state === 'shop') g.closeShop();
            const screen = g.player.y - g.cameraY;
            if (screen < -60 || screen > WORLD.height + 60) offscreen++;
            if (area === 3 && g.oxygen.ratio < 1) oxygenSeen = true;
            if (area === 4) a4doodads = Math.max(a4doodads, g.doodads.length);
          }
        }
        res.camera = offscreen === 0 ? 'ok' : `${offscreen} frames off-screen`;
        res.oxygen = oxygenSeen ? 'ok' : 'NOT TICKING';
        res.a4 = a4doodads > 0 ? 'ok' : 'NO DOODADS';
      }

      rows.push(`${p.name.padEnd(7)} | ${p.fall}/${p.move} | g${p.gravity} ${(p.fall / 120).toFixed(2)}px/step | plat ${res.platform} | block ${res.breakBlock} | container ${res.container} | limbo ${res.limbo} | stomp ${res.stomp} | spike ${res.spike} | doodad ${res.doodad} | safezone ${res.safeZone} | exit ${res.exit} (${res.exitMargin}) | camera ${res.camera} | oxygen ${res.oxygen} | a4 ${res.a4}`);
    }
    console.log('SAFETY ' + rows.join('\nSAFETY '));
    console.log(`SAFETY (platform slab ${PLATFORM_THICKNESS}px, safe-zone mouth ${SAFE_ZONE_RULES.height}px, spike warning ${SPIKE_PLATFORM_RULES.warning}s)`);
  });
});
