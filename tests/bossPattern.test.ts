import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, laneOf, round, seeded, STEP, tick } from './nimushi';
import { GameModel } from '../src/systems/GameModel';
import { NIMUSHI, TAPIOCA_SHOWER, FULL_SCREEN_TAPIOCA, STRAW_BEAM, TAPIOCA_CUP, ATTACK_STATES } from '../src/data/nimushi';
import { ENEMY_TYPES, spawnEnemy } from '../src/data/enemies';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { ABYSS_PHASES } from '../src/data/abyss';
import { WORLD } from '../src/data/balance';

/**
 * EVERY ATTACK MUST HAVE A READABLE SAFE ROUTE.
 *
 * The attacks are DISABLED in the prototype, so what survives here is the data-level guarantee: the
 * corridor's shape, its walk, and the telegraphs. The live-attack cases went with the rotation and
 * come back when the attacks do -- in the order SHOWER, BEAM, CLONES, CUP, one at a time.
 *
 * Human playtest called the tapioca barrage unavoidable. It was never bullet soup -- the corridor
 * was always guaranteed -- but it was two lanes wide and moved every 0.4s, so answering it meant
 * walking correctly from the first wave with no time to look at it. These tests hold the difference
 * between "a gap exists" and "a gap a person can find and reach".
 */
const SPAN = WORLD.width - WORLD.wall * 2;
const laneWidth = (lanes: number) => SPAN / lanes;

describe('the shower is a pattern, not a barrage', () => {
  it('leaves a corridor wide enough to see and to stand in', () => {
    expect(TAPIOCA_SHOWER.safeLanes).toBeGreaterThanOrEqual(3);
    const corridor = laneWidth(TAPIOCA_SHOWER.lanes) * TAPIOCA_SHOWER.safeLanes;
    // Comfortably wider than the player, and a real fraction of the shaft.
    expect(corridor).toBeGreaterThan(120);
    expect(corridor / SPAN).toBeGreaterThan(0.3);
  });

  it('gives more than enough time to walk to the next gap', () => {
    // The corridor moves at most one lane per wave, so following it costs one lane of travel.
    const crossing = laneWidth(TAPIOCA_SHOWER.lanes) / BOSS_PHYSICS.moveSpeed;
    expect(TAPIOCA_SHOWER.waveInterval).toBeGreaterThan(crossing * 2);
  });

  it('runs a handful of waves, not a stream', () => {
    const waves = NIMUSHI.recovery && Math.round(2.4 / TAPIOCA_SHOWER.waveInterval);
    expect(waves).toBeGreaterThanOrEqual(2);
    expect(waves).toBeLessThanOrEqual(4);
  });

  it('never builds a wave without a gap, and moves it one lane at a time', () => {
    const g = atNimushi(200);
    const seen: number[][] = [];
    for (let i = 0; i < 24; i++) seen.push(g.boss.spawnShowerWave(() => (i * 0.137) % 1));
    for (const safe of seen) {
      expect(safe.length).toBe(TAPIOCA_SHOWER.safeLanes);
      // Adjacent, so the corridor is one opening rather than scattered slots.
      for (let i = 1; i < safe.length; i++) expect(safe[i] - safe[i - 1]).toBe(1);
      for (const lane of safe) expect(lane).toBeGreaterThanOrEqual(0);
      for (const lane of safe) expect(lane).toBeLessThan(TAPIOCA_SHOWER.lanes);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i][0] - seen[i - 1][0])).toBeLessThanOrEqual(1);
    }
  });

});

describe('FINAL RAGE keeps its corridor', () => {
  it('never seals the screen, however fast it goes', () => {
    expect(FULL_SCREEN_TAPIOCA.corridor).toBeGreaterThanOrEqual(2);
    const corridor = laneWidth(FULL_SCREEN_TAPIOCA.lanes) * FULL_SCREEN_TAPIOCA.corridor;
    expect(corridor).toBeGreaterThan(60);
  });

  it('moves its corridor one lane at a time, like the ordinary shower', () => {
    const g = atNimushi(202);
    const seen: number[][] = [];
    for (let i = 0; i < 20; i++) seen.push(g.boss.spawnRageWave());
    for (const safe of seen) {
      expect(safe.length).toBe(FULL_SCREEN_TAPIOCA.corridor);
      for (let i = 1; i < safe.length; i++) expect(safe[i] - safe[i - 1]).toBe(1);
    }
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i][0] - seen[i - 1][0])).toBeLessThanOrEqual(1);
  });
});

describe('the four attacks ask for different answers', () => {
  it('telegraphs the beam before it can hurt, and leaves the rest of the shaft open', () => {
    expect(STRAW_BEAM.warning).toBeGreaterThan(0.6);
    // A column, not a curtain: the shaft is far wider than the beam, so stepping out is the answer.
    expect(STRAW_BEAM.width).toBeLessThan(SPAN * 0.25);
  });

  it('warns before a cup fires, and lets the cup be shot down', () => {
    expect(TAPIOCA_CUP.warning).toBeGreaterThan(0.5);
    expect(TAPIOCA_CUP.hp).toBeGreaterThan(0);
  });

});

/**
 * The SHOWER is the one attack the player fights THROUGH rather than waits out.
 *
 * This replaces "never has the eye open while an attack is running", which was true of a fight that
 * alternated between attacking and being attacked. That alternation turned the attack's own 2.4s
 * into a stretch with nothing in it but dodging -- a different game wearing the same costume. The
 * wind-up is still a pure warning; what changed is the answer to it.
 */
describe('the shower is fought through, not waited out', () => {
  it('keeps the eye SHUT through the wind-up and OPEN through the shower', () => {
    const g = fighting(204);
    let prepOpen = 0, prepFrames = 0, showerShut = 0, showerFrames = 0;
    for (let i = 0; i < 60 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      if (g.boss.state === 'attackPrep') { prepFrames++; if (g.boss.eyeOpen) prepOpen++; }
      if (g.boss.state === 'tapiocaShower') { showerFrames++; if (!g.boss.eyeOpen) showerShut++; }
    }
    expect(prepFrames).toBeGreaterThan(0);
    expect(showerFrames).toBeGreaterThan(0);
    // Closed for the tell...
    expect(prepOpen).toBe(0);
    // ...open for the answer.
    expect(showerShut).toBe(0);
  });

  /**
   * THREE COLUMNS, ONE AT A TIME, each aimed where the player is when ITS OWN warning starts.
   *
   * One column was answered by stepping aside once and then ignoring the rest of the attack. Three
   * ask the question again, twice, from wherever the last answer left the player -- so the attack
   * is a sequence of decisions instead of one, made while still watching for the next stomp.
   */
  it('fires three columns in sequence, never two at once', () => {
    const g = fighting(210);
    let attacks = 0, twoAtOnce = 0, columnsThisAttack = 0, was = '';
    const perAttack: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 90 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      if (g.boss.beams.length > 1) twoAtOnce++;
      for (const b of g.boss.beams) if (!seen.has(b.id)) { seen.add(b.id); columnsThisAttack++; }
      const inAttack = g.boss.state === 'strawBeam' || (g.boss.state === 'attackPrep' && g.boss.beams.length > 0);
      if (!inAttack && was && columnsThisAttack) { perAttack.push(columnsThisAttack); columnsThisAttack = 0; attacks++; }
      was = inAttack ? 'in' : '';
    }
    expect(attacks).toBeGreaterThan(1);
    // Every attack fired the whole sequence...
    for (const n of perAttack) expect(n).toBe(STRAW_BEAM.count);
    // ...and never more than one column existed at a time, which is what stops it pincering.
    expect(twoAtOnce).toBe(0);
  });

  it('re-aims every column at where the player is when its warning starts', () => {
    const g = fighting(211);
    const raised: { x: number; playerAt: number }[] = [];
    const seen = new Set<number>();
    // Walk, so the player is somewhere different by the time each column is raised.
    for (let i = 0; i < 90 / STEP && g.state === 'boss' && raised.length < 9; i++) {
      g.player.invincible = 9;
      g.step(STEP, Math.sin(i / 70) > 0 ? 1 : -1, false);
      for (const b of g.boss.beams) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        raised.push({ x: b.x, playerAt: g.player.x });
      }
    }
    expect(raised.length).toBeGreaterThanOrEqual(6);
    // Each column stands where the player was at the moment it appeared -- not where the first was.
    for (const r of raised) expect(Math.abs(r.x - r.playerAt)).toBeLessThan(3);
    // ...so a walking player is chased rather than answered once.
    const moves: number[] = [];
    for (let i = 1; i < raised.length; i++) moves.push(Math.abs(raised[i].x - raised[i - 1].x));
    expect(Math.max(...moves)).toBeGreaterThan(STRAW_BEAM.width);
  });

  it('holds the eye shut for each warning and open for each burn, all three times', () => {
    const g = fighting(212);
    let warnOpen = 0, warnFrames = 0, liveShut = 0, liveFrames = 0, burns = 0;
    let wasLive = false;
    for (let i = 0; i < 90 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      const warning = g.boss.beams.some(b => b.state === 'warning');
      const live = g.boss.beams.some(b => b.state === 'live');
      if (warning) { warnFrames++; if (g.boss.eyeOpen) warnOpen++; }
      if (live) { liveFrames++; if (!g.boss.eyeOpen) liveShut++; }
      if (live && !wasLive) burns++;
      wasLive = live;
    }
    expect(burns).toBeGreaterThanOrEqual(STRAW_BEAM.count);
    expect(warnFrames).toBeGreaterThan(0);
    expect(warnOpen).toBe(0);
    // ...including the last column, which used to burn on into `recovery` with the eye shut.
    expect(liveShut).toBe(0);
  });

  /**
   * CLONES asks WHAT to stomp, which is a question the other two never ask.
   *
   * What it puts on screen goes into the ORDINARY enemy list, so a clone is stomped, shot, counted
   * and rewarded by exactly the code a slime is. That is the whole design: the attack adds to the
   * thing the loop is made of instead of adding something in the way of it.
   */
  it('splits off things that live in the ordinary enemy list', () => {
    const g = fighting(213);
    const seen = new Map<number, string>();
    for (let i = 0; i < 90 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      for (const e of g.enemies) {
        if (e.kind === 'nimushiClone' || e.kind === 'nimushiShade') seen.set(e.id, e.kind);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    // A clone can be stood on and shot; a shade can only be shot. Both are ordinary enemies.
    expect(ENEMY_TYPES.nimushiClone.stompable).toBe(true);
    expect(ENEMY_TYPES.nimushiClone.shootable).toBe(true);
    expect(ENEMY_TYPES.nimushiShade.stompable).toBe(false);
    expect(ENEMY_TYPES.nimushiShade.shootable).toBe(true);
    // ...and the shape says which, because colour never does.
    expect(ENEMY_TYPES.nimushiClone.silhouette).not.toBe(ENEMY_TYPES.nimushiShade.silhouette);
  });

  it('pays a clone stomp the ordinary stomp reward, and refuses a shade', () => {
    for (const [kind, stompable] of [['nimushiClone', true], ['nimushiShade', false]] as const) {
      const g = atNimushi(214);
      g.enemies = [spawnEnemy(kind, -900, g.player.x, g.player.y - 60, 0, 0, 'open')];
      g.ammo = 0;
      g.player.invincible = 9;
      g.player.vy = -BOSS_PHYSICS.maxFallSpeed;
      const combo = g.combo;
      for (let i = 0; i < 30 && g.combo === combo && g.enemies[0].alive; i++) g.step(STEP, 0, false);
      expect({ kind, stomped: g.combo > combo }).toEqual({ kind, stomped: stompable });
      if (stompable) {
        // The ordinary reward, reached by the ordinary path: bounce and a full magazine.
        expect(g.player.vy * g.gravitySign).toBeLessThan(0);
        expect(g.ammo).toBe(g.stats.maxAmmo);
      }
    }
  });

  it('hurts on contact through the ordinary causes, and can be shot down either way', () => {
    for (const [kind, cause] of [['nimushiClone', 'enemy'], ['nimushiShade', 'spike']] as const) {
      // Contact: walked into from the side, so a stomp is not what happens.
      const hit = atNimushi(216);
      hit.enemies = [spawnEnemy(kind, -901, hit.player.x + 4, hit.player.y, 0, 0, 'open')];
      hit.player.invincible = 0;
      hit.player.vy = 0;
      const hearts = hit.hp;
      hit.step(STEP, 0, false);
      expect({ kind, hp: hit.hp }).toEqual({ kind, hp: hearts - 1 });
      expect(hit.health.lastDamage?.cause).toBe(cause);

      // ...and a round kills either of them, which is the shade's only answer.
      const shot = atNimushi(217);
      const e = spawnEnemy(kind, -902, shot.player.x, shot.player.y - 80, 0, 0, 'open');
      shot.enemies = [e];
      shot.player.invincible = 9;
      shot.bullets.push(round(e.x, e.y, 1));
      shot.step(STEP, 0, false);
      expect({ kind, alive: e.alive }).toEqual({ kind, alive: false });
    }
  });

  it('never stops the arena laying things to stand on', () => {
    // The attack is layered ON the loop, not instead of it: the standing supply keeps coming.
    //
    // NOT `fighting`, which wipes the arena to give a geometry test a clean slate -- this one is
    // about the supply, so it keeps what the arena itself lays and only clears the terrain.
    const g = new GameModel(false, seeded(215));
    g.jumpToNimushi();
    g.platforms = []; g.doodads = []; g.containers = [];
    g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
    g.step(STEP, 0, false);
    let noTarget = 0, frames = 0, sawSummoned = false;
    for (let i = 0; i < 90 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      if (g.player.y - g.cameraY > WORLD.height * 0.9) g.player.y = g.cameraY + WORLD.height * 0.6;
      const target = g.enemies.filter(e => e.alive && e.stompable && e.y < g.player.y).sort((a, b) => b.y - a.y)[0];
      g.step(STEP, target ? Math.sign(target.x - g.player.x) as -1 | 0 | 1 : 0, false);
      frames++;
      if (g.enemies.some(e => e.alive && (e.kind === 'nimushiClone' || e.kind === 'nimushiShade'))) sawSummoned = true;
      if (!g.enemies.some(e => e.alive && e.stompable && e.y < g.player.y)) noTarget++;
    }
    expect(sawSummoned).toBe(true);
    expect(noTarget).toBe(0);
    void frames;
  });

  /**
   * The rotation counts ACROSS stretches, which is what lets the third attack exist.
   *
   * A stretch has room for about two attacks and the rotation is three long, so restarting it at
   * every boundary meant SHOWER, BEAM, transition, SHOWER, BEAM, transition -- and CLONES 0.4 times
   * in a whole fight, with LIMBO's shades never summoned at all.
   */
  it('carries the attack rotation across a stretch boundary', () => {
    const g = fighting(220);
    const machine = g.boss as unknown as { rotation: number; enterPhaseTransition(out: unknown[]): boolean };
    // Walk the rotation part-way, then force the stretch change the fight would make.
    machine.rotation = 2;
    g.boss.hp = Math.round(NIMUSHI.maxHp * ABYSS_PHASES[1].from) - 1;
    const moved = machine.enterPhaseTransition([]);
    expect(moved).toBe(true);
    expect(g.boss.phaseId).toBe(2);
    // The counter is where it was: the next attack is the next attack, not the first one again.
    expect(machine.rotation).toBe(2);
  });

  it('reaches every attack in its rotation over a whole fight', () => {
    const seen = new Set<string>();
    const counts: Record<string, number> = { tapiocaShower: 0, strawBeam: 0, nimushiClones: 0 };
    let shades = 0, phase4Clones = 0;
    const summoned = new Set<number>();
    for (const seed of [221, 222, 223, 224, 225]) {
      const g = new GameModel(false, seeded(seed));
      // The fight starts on a stream of its own, so how 1-1 happened to be set up cannot change it.
      (g as unknown as { random: () => number }).random = seeded(seed);
      g.jumpToNimushi();
      g.platforms = []; g.doodads = []; g.containers = [];
      g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
      g.step(STEP, 0, false);
      let was = '';
      for (let i = 0; i < 300 / STEP && g.state === 'boss' && !g.boss.defeated; i++) {
        const p = g.player;
        g.player.invincible = 9;
        if (p.y - g.cameraY > WORLD.height * 0.9) p.y = g.cameraY + WORLD.height * 0.6;
        const ahead = g.enemies.filter(e => e.alive && e.stompable && e.y < p.y).sort((a, b) => b.y - a.y)[0];
        const want = g.boss.eyeOpen && g.ammo > 0 ? g.boss.x : (ahead ? ahead.x : p.x);
        g.step(STEP, Math.abs(want - p.x) < 5 ? 0 : Math.sign(want - p.x) as -1 | 0 | 1, g.ammo > 0 && i % 8 < 4);
        const st = g.boss.state;
        if (st !== was && (st === 'tapiocaShower' || st === 'strawBeam' || st === 'nimushiClones')) {
          seen.add(st); counts[st]++;
        }
        was = st;
        for (const e of g.enemies) {
          if (summoned.has(e.id)) continue;
          if (e.kind === 'nimushiShade') { summoned.add(e.id); shades++; }
          if (e.kind === 'nimushiClone' && g.boss.phaseId === 4) { summoned.add(e.id); phase4Clones++; }
        }
      }
    }
    // All three of them, in one fight's worth of attacks. MEASURED over 24 fights: CLONES runs in
    // 24/24, 2.6 times each. It ran 0.4 times a fight when the rotation restarted every stretch.
    expect([...seen].sort()).toEqual(['nimushiClones', 'strawBeam', 'tapiocaShower']);
    expect(counts.nimushiClones).toBeGreaterThan(5);
    // ...and LIMBO's shades, which only exist because the rotation gets that far. NOT every fight:
    // LIMBO is one stretch of four with room for about two attacks, so which of the three lands
    // there depends on where the counter is when it starts. Measured at 15/24 fights, so five
    // fights is the sample this needs to be sure of one.
    expect(shades).toBeGreaterThan(0);
    void phase4Clones;
  });

  it('leaves CUP shut, whenever it comes back', () => {
    // Opening the eye is not something an attack inherits by being an attack: only the three that
    // were judged one at a time are named in `eyeOpen`.
    const g = fighting(205);
    const machine = g.boss as unknown as { state: string };
    machine.state = ATTACK_STATES.cupSummon;
    expect(g.boss.eyeOpen).toBe(false);
    for (const id of ['tapiocaShower', 'nimushiClones'] as const) {
      machine.state = ATTACK_STATES[id];
      expect({ id, open: g.boss.eyeOpen }).toEqual({ id, open: true });
    }
  });

  /**
   * The BEAM's telegraph outlives the `attackPrep` state by half a second, so the state alone is
   * the wrong thing to ask -- what decides it is whether a line is still being PROMISED.
   */
  it('keeps the eye shut while a beam is only a warning, and opens it once it burns', () => {
    const g = fighting(206);
    const machine = g.boss as unknown as { state: string };
    machine.state = ATTACK_STATES.strawBeam;
    g.boss.beams.push({ id: 1, x: 200, width: STRAW_BEAM.width, state: 'warning', timer: STRAW_BEAM.warning });
    expect(g.boss.eyeOpen).toBe(false);
    g.boss.beams[0].state = 'live';
    expect(g.boss.eyeOpen).toBe(true);
    // ...and for the tail of the attack after the column has gone.
    g.boss.beams = [];
    expect(g.boss.eyeOpen).toBe(true);
  });

  it('shuts the eye through the warning, in a real fight', () => {
    const g = fighting(207);
    let warnOpen = 0, warnFrames = 0, liveShut = 0, liveFrames = 0;
    for (let i = 0; i < 60 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      const warning = g.boss.beams.some(b => b.state === 'warning');
      const live = g.boss.beams.some(b => b.state === 'live');
      if (warning) { warnFrames++; if (g.boss.eyeOpen) warnOpen++; }
      if (live) { liveFrames++; if (!g.boss.eyeOpen) liveShut++; }
    }
    expect(warnFrames).toBeGreaterThan(0);
    expect(liveFrames).toBeGreaterThan(0);
    expect(warnOpen).toBe(0);
    expect(liveShut).toBe(0);
  });
});
