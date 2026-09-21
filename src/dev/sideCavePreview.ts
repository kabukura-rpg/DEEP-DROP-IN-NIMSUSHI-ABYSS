/**
 * DEVELOPMENT ONLY: drop the player at the mouth of one SIDE CAVE, on demand.
 *
 * Six fixtures -- three archetypes on two walls -- so the differences between them can be looked at
 * one after another instead of waited for. It builds the cave through `placeCave` and hands it to
 * the model's own `addCave`, which is the same path the generator uses, so what this shows IS what
 * a run generates. Nothing here places anything in a production run.
 *
 * Every call site is behind `import.meta.env.DEV`, so the whole module is dropped from a build.
 */
import type { GameModel } from '../systems/GameModel';
import type { RoutePlatform } from '../systems/StageGenerator';
import { caveShape, placeCave, type CaveArchetype, type SideCave } from '../data/sideCave';
import { rollGunModule } from '../data/gunModules';
import { WORLD } from '../data/balance';

const ARCHETYPES: Record<string, CaveArchetype> = { module: 'gunModule', shop: 'shop', coin: 'coinVein' };
export const SIDE_CAVE_FIXTURES = Object.keys(ARCHETYPES).flatMap(k => [`${k}-left`, `${k}-right`]);

/** Reach-through rather than a widened production API: nothing in the game adds a cave by hand. */
interface CaveReach { caves: SideCave[]; platforms: RoutePlatform[]; addCave(cave: SideCave): void; random(): number }

export function previewSideCave(model: GameModel, request: string): string {
  const name = request.trim().toLowerCase();
  const [kindName, sideName] = name.split('-');
  const kind = ARCHETYPES[kindName];
  const side: -1 | 1 | 0 = sideName === 'left' ? -1 : sideName === 'right' ? 1 : 0;
  if (!kind || side === 0) return `unknown fixture '${request}' -- try ${SIDE_CAVE_FIXTURES.join(', ')}`;

  const reach = model as unknown as CaveReach;
  const p = model.player;
  // A clean stretch to look at it in: the shaft's own furniture would only be in the way.
  model.enemies = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.caves = []; model.safeZones = []; model.pickups = [];
  model.shop.reset();

  // Sit the cave a little below the player, with a ledge to arrive on, exactly as a SECTION would.
  const sillY = Math.round(p.y + 260);
  const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
  const content = kind === 'gunModule'
    ? { kind, ...rollGunModule(reach.random.bind(reach)) }
    : { kind };
  const cave = placeCave(-9000, side, mouthX, sillY, caveShape(kind, side), content);
  reach.addCave(cave);
  // The cave's own floor slabs, as the generator lays them: ordinary platforms marked as shelter.
  let id = -9100;
  for (const slab of cave.floors) {
    reach.platforms.push({
      id: id--, x: slab.x, y: slab.y, width: slab.width,
      safeSide: side === -1 ? 1 : -1,
      safeX: side === -1 ? slab.x + slab.width - 26 : slab.x + 26,
      exitX: side === -1 ? slab.x + slab.width + 12 : slab.x - 12,
      breakable: false, state: 'stable', safeZone: cave.id,
    });
  }
  // Drop the player just above the sill, out in the shaft: the approach is part of the fixture.
  p.x = side === -1 ? WORLD.wall + 40 : WORLD.width - WORLD.wall - 40;
  p.y = sillY - 150;
  p.vy = 0;
  p.grounded = -1;
  const shape = caveShape(kind, side);
  return `SIDE CAVE ${name} -- ${shape.id}, ${shape.throat.depth}px throat, ` +
    `${shape.chamber.depth}x${shape.chamber.height} chamber, ${shape.ledges.length} ledge(s)`;
}
