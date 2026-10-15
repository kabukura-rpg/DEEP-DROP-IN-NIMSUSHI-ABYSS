import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { chamberDrawn, environmentArtArea, environmentParts } from '../src/render/environmentArt';
import { PlayerAnimationState, type PlayerAnimation } from '../src/dev/playerAnimationState';
import { shownPose } from '../src/render/playerArtAssets';
import { previewSideCave } from '../src/dev/sideCavePreview';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import playerArtSource from '../src/render/PlayerArt.ts?raw';

/**
 * VISUAL STATE MAPPING -- what a frame is drawn from follows the PLACE, never the run's state.
 *
 * A SHOP, a REST, a death or the clear changes `GameModel.state` and nothing about where the run is.
 * At 914b47c the environment was read off the state, so THE ABYSS's shelf and the arena's result
 * screens fell through to AREA 4's walls, ledges and painting; and the PLAYER's pose selector, which
 * has no pose outside play, dropped the image for the procedural body behind every overlay.
 */

const STEP = 1 / 120;

/** Step until the shelf opens. */
function walkInto(g: GameModel, x: number, y: number) {
  g.player.x = x; g.player.y = y; g.player.vx = 0; g.player.vy = 0; g.player.invincible = 99;
  for (let i = 0; i < 240 && g.state !== 'shop'; i++) { g.step(STEP, 0, false); g.events.length = 0; }
  expect(g.state).toBe('shop');
}
function staging() {
  const g = new GameModel(false);
  g.safeZoneVisitCount = 1;
  g.jumpToBoss();
  expect(g.abyssStage).toBe('staging');
  return g;
}
function arena() {
  const g = new GameModel(false);
  g.jumpToNimushi();
  expect(g.abyssStage).toBe('fight');
  return g;
}
/** The background painting GameScene picks, by its own expression. */
const backgroundOf = (g: GameModel) => {
  const artArea = environmentArtArea(g);
  return artArea === 'boss' ? 'boss' : g.stage.config.id;
};
/** The set and painting GameScene draws a frame from, in one read. */
const look = (g: GameModel) => ({ state: g.state, art: environmentArtArea(g), background: backgroundOf(g), chamber: chamberDrawn(environmentArtArea(g)) });

describe('environment: the place, whatever the state', () => {
  it('AREA 4: its own art, in play, in a SIDE CAVE shop, at a REST and after a death', () => {
    const g = new GameModel(false);
    g.jumpToStage(4, 2);
    expect(look(g)).toEqual({ state: 'playing', art: 4, background: 4, chamber: true });
    previewSideCave(g, 'shop-right');
    const cave = g.caves.find(c => c.content?.kind === 'shop')!;
    const door = g.shopDoor(cave);
    walkInto(g, door.x + door.width / 2, door.y + door.height - 16);
    expect(look(g)).toEqual({ state: 'shop', art: 4, background: 4, chamber: true });
    const rest = new GameModel(false);
    rest.jumpToStage(4, 3);
    rest.completeSection();
    expect(look(rest)).toEqual({ state: 'upgrade', art: 4, background: 4, chamber: true });
    const dead = new GameModel(false);
    dead.jumpToStage(4, 1);
    dead.killInstantly('enemy');
    expect(look(dead)).toEqual({ state: 'over', art: 4, background: 4, chamber: true });
  });

  it('AREA 1-3 keep their own art in every state they can be in', () => {
    for (const area of [1, 2, 3] as const) {
      const g = new GameModel(false);
      g.jumpToStage(area, 1);
      expect(environmentArtArea(g)).toBe(area);
      g.completeSection();
      expect(g.state).toBe('upgrade');
      expect(environmentArtArea(g)).toBe(area);
    }
  });

  it('STAGING: the staging set in play, while its SHOP is open, and after a death there', () => {
    const g = staging();
    expect(look(g)).toEqual({ state: 'boss', art: 'staging', background: 4, chamber: false });
    const e = g.shop.entrance!;
    walkInto(g, e.x + e.width / 2, e.y + e.height - 16);
    // Was AREA 4's walls and ledges, and the TOMATO room's recess, behind the shelf.
    expect(look(g)).toEqual({ state: 'shop', art: 'staging', background: 4, chamber: false });
    expect(g.closeShop()).toBe(true);
    expect(look(g)).toEqual({ state: 'boss', art: 'staging', background: 4, chamber: false });
    const dead = staging();
    dead.killInstantly('enemy');
    expect(look(dead)).toEqual({ state: 'over', art: 'staging', background: 4, chamber: false });
    // The staging set's own parts, never AREA 4's.
    const parts = environmentParts(environmentArtArea(g), () => true);
    expect(parts.keys.fill).toBe('env-staging-wall-fill');
    expect(parts.keys.center).toBe('env-staging-platform-center');
    expect(parts.platform).toBe(true);
  });

  it('BOSS: the arena set and painting in the fight, after a death in it, and at the clear', () => {
    const g = arena();
    expect(look(g)).toEqual({ state: 'boss', art: 'boss', background: 'boss', chamber: false });
    const dead = arena();
    dead.killInstantly('enemy');
    // Was AREA 4's walls behind the result screen.
    expect(look(dead)).toEqual({ state: 'over', art: 'boss', background: 'boss', chamber: false });
    const cleared = arena();
    expect(cleared.clearBoss()).toBe(true);
    // clearBoss puts abyssStage back to 'none'; the place is still the arena. Was AREA 4's walls AND painting.
    expect(cleared.abyssStage).toBe('none');
    expect(look(cleared)).toEqual({ state: 'clear', art: 'boss', background: 'boss', chamber: false });
    expect(environmentParts(environmentArtArea(cleared), () => true).keys.fill).toBe('env-boss-wall-fill');
  });

  it('never reads the run state for art: GameScene keys painting, chamber and enemy art on the place', () => {
    expect(sceneSource).toContain('const artArea = environmentArtArea(m);');
    expect(sceneSource).toContain("const backgroundId = artArea === 'boss' ? 'boss' : m.stage.config.id;");
    expect(sceneSource).toContain('if (!chamberDrawn(artArea)) continue;');
    expect(sceneSource).toContain("enemyArtKey(e, environmentArtArea(this.model) === 'boss' ? 'boss' : this.model.stage.config.id)");
    expect(sceneSource).not.toContain("inBossArena ? 'boss'");
    expect(sceneSource).not.toContain('chamberDrawn(m.state)');
  });
});

describe('player: the image is kept behind every overlay', () => {
  /** PlayerArt.render's own choice, outside Phaser: the selector's pose, else the one last drawn. */
  class Shown {
    readonly state = new PlayerAnimationState();
    current: PlayerAnimation | null = null;
    frame(g: GameModel) { this.current = shownPose(this.state.pose(g), this.current); return this.current; }
    run(g: GameModel, seconds: number, firing = false) {
      for (let t = 0; t < seconds; t += STEP) {
        g.step(STEP, 0, firing);
        for (const e of g.events.splice(0)) this.state.event(e, g);
        this.frame(g);
      }
    }
  }

  it('keeps a PNG pose in playing, upgrade, shop, boss, clear and over', () => {
    const seen: Record<string, PlayerAnimation | null> = {};
    // playing -> upgrade (REST)
    const a = new GameModel(false), sa = new Shown();
    a.jumpToStage(1, 1);
    sa.run(a, 0.5);
    seen.playing = sa.frame(a);
    a.completeSection();
    expect(a.state).toBe('upgrade');
    expect(sa.state.pose(a)).toBeNull();
    seen.upgrade = sa.frame(a);
    // shop (THE ABYSS's shelf)
    const b = staging(), sb = new Shown();
    sb.run(b, 0.3);
    const e = b.shop.entrance!;
    walkInto(b, e.x + e.width / 2, e.y + e.height - 16);
    for (const ev of b.events.splice(0)) sb.state.event(ev, b);
    expect(sb.state.pose(b)).toBeNull();
    seen.shop = sb.frame(b);
    // boss -> clear
    const c = arena(), sc = new Shown();
    sc.run(c, 0.5, true);
    seen.boss = sc.frame(c);
    c.clearBoss();
    expect(sc.state.pose(c)).toBeNull();
    seen.clear = sc.frame(c);
    // over: the selector's own death pose
    const d = new GameModel(false), sd = new Shown();
    d.jumpToStage(2, 1);
    sd.run(d, 0.3);
    d.killInstantly('enemy');
    seen.over = sd.frame(d);
    for (const [state, pose] of Object.entries(seen)) expect(pose, state).not.toBeNull();
    expect(seen.over).toBe('death');
  });

  it('holds the last pose through the arena bounce the selector has no approved frame for', () => {
    const g = arena(), s = new Shown();
    s.run(g, 0.3);
    const before = s.frame(g);
    expect(before).not.toBeNull();
    // A downward bounce in the arena: the selector still answers null (no downward-thrust pose).
    g.player.vy = 120;
    expect(s.state.pose(g)).toBeNull();
    expect(s.frame(g)).toBe(before);
  });

  it('keeps the selector and the timing untouched, and the procedural body for a missing image only', () => {
    expect(shownPose<PlayerAnimation>('fall', 'idle')).toBe('fall');
    expect(shownPose<PlayerAnimation>(null, 'idle')).toBe('idle');
    expect(shownPose<PlayerAnimation>(null, null)).toBeNull();
    // A fresh selector still answers null outside play: the hold is the renderer's, not the selector's.
    const g = new GameModel(false);
    g.jumpToStage(1, 1);
    g.completeSection();
    expect(new PlayerAnimationState().pose(g)).toBeNull();
    expect(playerArtSource).toContain('const pose = this.forced ?? shownPose(this.state.pose(model), this.currentPose);');
    // A held pose keeps its start time, so it is frozen with the run's clock and never restarted.
    expect(playerArtSource).toContain('if (pose !== this.currentPose) { this.currentPose = pose; this.started = model.elapsed;');
    // The image is used only when its frame exists and its sheet loaded; otherwise the body is drawn.
    expect(playerArtSource).toContain("const use = this.mode === 'prototype' && !!frame;");
    expect(sceneSource).toContain('if (!art && !(p.invincible > 0 && Math.floor(p.invincible * 16) % 2)) {');
  });
});
