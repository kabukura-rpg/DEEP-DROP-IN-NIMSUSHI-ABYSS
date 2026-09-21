/**
 * SIDE CAVE -- a cave in the wall of the shaft, not a room bolted to it.
 *
 * The SAFE ZONE it replaces was a 150x116 recess: one flat floor, the reward at arm's length, and
 * nothing to do inside but touch it. Reference footage shows the lateral spaces are not that. They
 * are small caves -- an opening, a throat, and then a chamber with its own floor, ceiling and
 * height changes, with the reward somewhere inside it rather than at the door. The experience is
 *
 *     main shaft -> wall opening -> lateral throat -> cave chamber -> internal terrain
 *                -> reward -> back out the way you came
 *
 * so this models the SHELL, and an archetype fills it. MODULE CAVE is the only archetype built;
 * SHOP and COIN caves are the same shell with different contents and are deliberately not written
 * yet -- one archetype is what a human can review.
 *
 * WHAT THE SHELL MAY NOT DO. It may not need a verb the player does not have, and it may not ask
 * for one it does not get. The ground jump peaks at 32px, so no ledge inside a cave rises further
 * than that; and because a platform here is ONE-WAY -- it catches a fall, it does not block a walk
 * -- height comes from LEDGES STANDING ON THE FLOOR rather than from steps cut into it. A stepped
 * floor cannot be climbed at all: the player walks straight through the riser. The floor itself is
 * one continuous slab from the sill to past the far wall, because a cave hangs outside the shaft
 * and a gap in its ground is a hole out of the world. Together those two rules mean no arrangement
 * of a cave can strand anyone: every ledge can be stepped off, and the floor always catches.
 */
import type { SafeZoneContent } from './safeZone';

export interface CaveRect { x: number; y: number; width: number; height: number }

/**
 * One cave, in WORLD coordinates. `side` is which wall it is cut into: -1 the left, 1 the right,
 * and a left cave's geometry runs to NEGATIVE x -- outside the shaft is the point.
 */
export interface SideCave {
  id: number;
  side: -1 | 1;
  /** The slot in the shaft wall. Falling into this is how a cave is entered. */
  opening: CaveRect;
  /** Everything a camera must be able to show, and the far bounds the player is held inside. */
  bounds: CaveRect;
  /**
   * Past the throat: being in HERE is being in the cave. TIMEVOID keys off this and not off the
   * opening, so standing in the doorway looking in does not stop the world.
   */
  interior: CaveRect;
  /** Solid ground, left to right. Continuous by construction -- see the note above. */
  floors: readonly CaveRect[];
  /** The rock overhead. Drawn, and it stops nothing: the jump cannot reach it. */
  roof: readonly CaveRect[];
  content: SafeZoneContent | null;
  /** Set once the cave's reward has been taken. A cave itself is never "used up". */
  taken: boolean;
}

/**
 * A cave layout, written relative to its own opening: x grows INTO the rock, y grows downward from
 * the sill the player lands on. `place` turns one into world coordinates for either wall.
 */
export interface CaveShape {
  id: string;
  /** How far the throat reaches before the chamber begins, and how tall it is. */
  throat: { depth: number; height: number };
  /** The chamber past the throat: how much further it reaches, and how tall. */
  chamber: { depth: number; height: number };
  /**
   * Ledges standing ON the cave floor, each at `from` depth from the mouth, `depth` deep and `rise`
   * above the floor.
   *
   * NOT steps in the floor. A platform in this game is one-way: it catches a fall and is walked off
   * freely, but walking sideways into its body does nothing. A stepped floor therefore cannot be
   * climbed at all -- the player strolls straight through the riser and out the far end of the
   * cave, which is what the first version of this did. A ledge is entered the way every other ledge
   * in the game is: jump, cross its top from below, land on it.
   *
   * `rise` is bounded by the ground jump, which peaks at 32px.
   */
  ledges: readonly { from: number; depth: number; rise: number }[];
  /**
   * Which ledge the content stands on, by index; omitted when it stands on the cave floor.
   * Either way it must be deep enough that nobody in the mouth can reach it -- see `contentDepth`.
   */
  rewardLedge?: number;
  /**
   * Depth from the mouth at which the content sits. With `rewardLedge` it is the ledge's own
   * middle; without one it has to be stated, and it is what keeps a SHOP's door out of the throat.
   */
  contentDepth?: number;
}

/**
 * The two MODULE CAVE fixtures, one per wall, authored separately rather than mirrored.
 *
 * Both are under half a viewport wide and a quarter tall -- a small play space, not another level.
 * Both put the reward on the deepest and highest step, so finding it means going IN and stepping UP
 * rather than reaching through the door, and both are walked back out the way they were entered.
 *
 * Steps rise 24px. The ground jump peaks at 32px, so a step is cleared with 8px to spare, and
 * walking back down one costs nothing -- which is what makes taking the module optional in the only
 * way that matters: the player can always leave.
 */
export const MODULE_CAVE_LEFT: CaveShape = {
  id: 'moduleCaveLeft',
  throat: { depth: 88, height: 96 },
  chamber: { depth: 230, height: 154 },
  ledges: [
    { from: 132, depth: 66, rise: 24 },   // a shelf part-way in: something to climb, not the prize
    { from: 226, depth: 84, rise: 24 },   // the back shelf, where the module waits
  ],
  rewardLedge: 1,
};

export const MODULE_CAVE_RIGHT: CaveShape = {
  id: 'moduleCaveRight',
  throat: { depth: 78, height: 98 },
  chamber: { depth: 242, height: 166 },
  ledges: [
    { from: 118, depth: 58, rise: 24 },
    { from: 214, depth: 96, rise: 24 },
  ],
  rewardLedge: 1,
};

/**
 * SHOP CAVE. The role is different from MODULE's, so the room is.
 *
 * A module cave is a climb: go in, get up, take it. A shop is a place to STOP in -- the world is
 * held while the shelf is open, and the player is reading prices rather than moving -- so this one
 * is the widest and tallest of the three and has no ledges at all. Flat ground, a short throat, and
 * the merchant well back from the mouth: far enough that walking in is a decision that has already
 * been made by the time the shelf opens, which is the rule that matters most here.
 */
export const SHOP_CAVE_LEFT: CaveShape = {
  id: 'shopCaveLeft',
  throat: { depth: 62, height: 100 },
  chamber: { depth: 252, height: 196 },
  ledges: [],
  contentDepth: 214,
};

export const SHOP_CAVE_RIGHT: CaveShape = {
  id: 'shopCaveRight',
  throat: { depth: 70, height: 104 },
  chamber: { depth: 238, height: 188 },
  ledges: [],
  contentDepth: 206,
};

/**
 * REWARD CAVE. The lightest of the three: duck in, take it, leave.
 *
 * Barely more than half the depth of the other two, one pocket raised a single jump off the floor,
 * and the vein on it. Nothing to work out and nothing to stand around for -- if a module cave is a
 * climb and a shop is a stop, this is a detour that costs a couple of seconds.
 */
export const COIN_CAVE_LEFT: CaveShape = {
  id: 'coinCaveLeft',
  throat: { depth: 54, height: 94 },
  chamber: { depth: 148, height: 128 },
  ledges: [{ from: 108, depth: 82, rise: 24 }],
  rewardLedge: 0,
};

export const COIN_CAVE_RIGHT: CaveShape = {
  id: 'coinCaveRight',
  throat: { depth: 48, height: 92 },
  chamber: { depth: 156, height: 134 },
  ledges: [{ from: 100, depth: 92, rise: 24 }],
  rewardLedge: 0,
};

export const CAVE_RULES = {
  /**
   * How far the sill reaches back INTO the shaft, so a fall into the opening has somewhere to land.
   *
   * It has to be a real target, not a lip. The player's body is clamped 12px clear of the brickwork
   * and is 18px wide, so an overhang of 20 left an 8px window to land in -- narrower than the player.
   * 70 gives a ledge that is aimed at rather than threaded, and still takes less of the fall
   * corridor than the 150px floor the old SAFE ZONE chamber put there.
   */
  sillOverhang: 70,
  /** Thickness of the floor slabs and of the rock overhead. Drawing and collision share it. */
  slab: 14,
  /** How fast the camera closes on its target inside a cave, per second. Eased, never snapped. */
  cameraFollow: 6.5,
  /**
   * A hard ceiling on how fast the view may travel sideways, in px/s.
   *
   * The ease alone is not enough. Easing moves a share of the remaining distance, so the FIRST
   * frame after entering is the biggest -- and a player who falls straight into the mouth creates
   * the whole offset in one frame. Measured that way it moved 17px in a single frame, which is a
   * lurch. The clamp makes the worst case the same as the ordinary case: the view slides.
   */
  cameraMaxSpeed: 520,
  /** Rock kept beyond the far wall, so the view never runs off the end of the cave. */
  farMargin: 26,
} as const;

/**
 * The six fixtures, by what the cave holds and which wall it is in. LEFT and RIGHT are authored
 * separately rather than mirrored, and the three archetypes differ in shape rather than only in
 * contents -- the same cave three times would teach the player that a hole is a hole.
 *
 *            throat   chamber   ledges   the shape of the visit
 *   MODULE     ~83     ~236x160    2      go in, climb, take it
 *   SHOP       ~66     ~245x192    0      go in, stand, read
 *   COIN       ~51     ~152x131    1      duck in, hop, leave
 */
export const CAVE_SHAPES = {
  gunModule: { '-1': MODULE_CAVE_LEFT, '1': MODULE_CAVE_RIGHT },
  shop: { '-1': SHOP_CAVE_LEFT, '1': SHOP_CAVE_RIGHT },
  coinVein: { '-1': COIN_CAVE_LEFT, '1': COIN_CAVE_RIGHT },
} as const;

export type CaveArchetype = keyof typeof CAVE_SHAPES;

/** The fixture for one archetype on one wall. */
export const caveShape = (kind: CaveArchetype, side: -1 | 1): CaveShape => CAVE_SHAPES[kind][side === -1 ? '-1' : '1'];
/** The shape a placed cave was built from, read back off its own content. */
export const shapeOf = (cave: SideCave) => caveShape((cave.content?.kind ?? 'gunModule') as CaveArchetype, cave.side);
/** MODULE CAVE's fixtures, by wall. Kept as its own name because that archetype is locked. */
export const moduleCaveShape = (side: -1 | 1) => caveShape('gunModule', side);

/**
 * Turn a shape into a cave at a wall, with its sill at `sillY`.
 *
 * `mouthX` is the shaft-side face of the opening: the left wall's inner edge, or the right wall's.
 * Depth runs away from the shaft, so a left cave's rectangles have decreasing x.
 */
export function placeCave(id: number, side: -1 | 1, mouthX: number, sillY: number, shape: CaveShape, content: SafeZoneContent | null): SideCave {
  const dir = side === -1 ? -1 : 1;
  /** A rectangle `from`..`from + depth` deep, `height` tall, sitting ON the given floor level. */
  const box = (from: number, depth: number, top: number, height: number): CaveRect => ({
    x: dir === -1 ? mouthX - from - depth : mouthX + from,
    y: top, width: depth, height,
  });
  const total = shape.throat.depth + shape.chamber.depth;
  const openingHeight = shape.throat.height;
  const roofTop = sillY - Math.max(shape.chamber.height, openingHeight);

  // ONE continuous floor, from the sill to past the far wall. A cave hangs outside the shaft, so a
  // gap in its ground is not a route -- it is a hole out of the world, and there is nothing below.
  const floors: CaveRect[] = [
    box(-CAVE_RULES.sillOverhang, total + CAVE_RULES.sillOverhang + CAVE_RULES.farMargin, sillY, CAVE_RULES.slab),
  ];
  // ...and the ledges standing on it, which is where the height comes from.
  for (const ledge of shape.ledges) floors.push(box(ledge.from, ledge.depth, sillY - ledge.rise, CAVE_RULES.slab));

  const roof: CaveRect[] = [
    box(0, shape.throat.depth, sillY - openingHeight - CAVE_RULES.slab, CAVE_RULES.slab),
    box(shape.throat.depth, shape.chamber.depth + CAVE_RULES.farMargin, roofTop - CAVE_RULES.slab, CAVE_RULES.slab),
  ];

  const bounds = box(-CAVE_RULES.sillOverhang, total + CAVE_RULES.sillOverhang + CAVE_RULES.farMargin, roofTop, sillY + CAVE_RULES.slab - roofTop);
  return {
    id, side, content, taken: false,
    opening: box(0, 8, sillY - openingHeight, openingHeight),
    // The cave proper starts one player-width past the mouth: the doorway is not the cave.
    interior: box(26, total - 26, roofTop, sillY - roofTop),
    bounds, floors, roof,
  };
}

/**
 * Where the cave's content sits: on top of its reward ledge, or on the floor at the stated depth.
 * Deep either way -- nothing an archetype holds may be reachable from the mouth.
 */
export function caveRewardSpot(cave: SideCave, shape: CaveShape) {
  const dir = cave.side === -1 ? -1 : 1;
  const mouthX = cave.side === -1 ? cave.opening.x + cave.opening.width : cave.opening.x;
  const floorY = cave.opening.y + cave.opening.height;
  if (shape.rewardLedge === undefined) {
    return { x: mouthX + dir * (shape.contentDepth ?? shape.throat.depth + shape.chamber.depth / 2), y: floorY };
  }
  const ledge = shape.ledges[shape.rewardLedge];
  return { x: mouthX + dir * (ledge.from + ledge.depth / 2), y: floorY - ledge.rise };
}

/** A cave's COIN VEIN: standing on whatever the content spot sits on, facing the way in. */
export function caveVeinBounds(cave: SideCave, shape: CaveShape, size: { width: number; height: number }) {
  const spot = caveRewardSpot(cave, shape);
  return { x: Math.round(spot.x - size.width / 2), y: Math.round(spot.y - size.height), width: size.width, height: size.height };
}

/** True when a point is inside the cave at all -- used for the player's bounds and the camera. */
export const insideCave = (cave: SideCave, x: number, y: number) =>
  x > cave.bounds.x && x < cave.bounds.x + cave.bounds.width && y > cave.bounds.y && y < cave.bounds.y + cave.bounds.height;
/** True when a point is past the throat: this is what TIMEVOID keys off, not the opening. */
export const inCaveInterior = (cave: SideCave, x: number, y: number) =>
  x > cave.interior.x && x < cave.interior.x + cave.interior.width && y > cave.interior.y && y < cave.interior.y + cave.interior.height;
