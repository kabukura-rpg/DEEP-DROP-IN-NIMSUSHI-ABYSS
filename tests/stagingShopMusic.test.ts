import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave } from '../src/dev/sideCavePreview';
import { AreaMusic, MUSIC, musicTrack, type AreaTrack } from '../src/systems/Music';
import mainSource from '../src/main.ts?raw';

/**
 * STAGING SHOP MUSIC -- which BGM plays while a shelf is open.
 *
 * main.ts asks musicTrack() for a track every 100ms and told it "this is THE ABYSS" only while the
 * model's state was 'boss'. A shelf opened in THE ABYSS staging room puts the model in 'shop', so
 * for as long as it was open the ask fell through to the AREA track -- stage.config.id is 4 down
 * there -- and Cavernous_Drift played in a room that is silent until NIMUSHI wakes. Closing the
 * shelf put the state back to 'boss' and the music stopped again.
 *
 * The fix reads where the shelf was opened from off the model: abyssStage stays 'staging' while
 * shopping there, and is 'none' for every SIDE CAVE. These tests run main.ts's own argument
 * expression -- its source, unchanged -- against a real GameModel.
 */

const STEP = 1 / 120;

/** main.ts's musicTrack({...}) argument, executed: what the BGM asks for given `mode` and the model. */
function mainMusicAsk() {
  const head = 'window.setInterval(() => music.sync(musicTrack({';
  const start = mainSource.indexOf(head), end = mainSource.indexOf('})), 100);', start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const args = mainSource.slice(start + head.length, end);
  return new Function('musicTrack', `return (mode, scene, audio) => musicTrack({${args}});`)(musicTrack) as
    (mode: string, scene: { model: GameModel }, audio: { muted: boolean }) => AreaTrack | null;
}
const ask = mainMusicAsk();
const track = (mode: string, g: GameModel, muted = false) => ask(mode, { model: g }, { muted });

function walkInto(g: GameModel, x: number, y: number) {
  g.player.x = x; g.player.y = y; g.player.vx = 0; g.player.vy = 0; g.player.invincible = 99;
  for (let i = 0; i < 240 && g.state !== 'shop'; i++) { g.step(STEP, 0, false); g.events.length = 0; }
  expect(g.state).toBe('shop');
}
/** A SIDE CAVE SHOP in an ordinary SECTION of `area`; main.ts's mode there is 'playing'. */
function caveRun(area: 1 | 2 | 3 | 4) {
  const g = new GameModel(false);
  g.jumpToStage(area, 2);
  previewSideCave(g, 'shop-right');
  g.events.length = 0;
  return g;
}
const openCave = (g: GameModel) => { const d = g.shopDoor(g.caves[0]); walkInto(g, d.x + d.width / 2, d.y + d.height - 16); };
/** THE ABYSS staging room; main.ts's mode there is 'boss'. */
function stagingRun() {
  const g = new GameModel(false);
  g.safeZoneVisitCount = 1;
  g.jumpToBoss();
  g.events.length = 0;
  expect({ state: g.state, stage: g.abyssStage, started: g.boss.started }).toEqual({ state: 'boss', stage: 'staging', started: false });
  return g;
}
const openStaging = (g: GameModel) => { const e = g.shop.entrance!; walkInto(g, e.x + e.width / 2, e.y + e.height - 16); };

describe('root cause, pinned', () => {
  it('THE ABYSS is AREA 4 to the stage, so a shelf the ABYSS did not claim fell through to Cavernous_Drift', () => {
    const g = stagingRun();
    openStaging(g);
    expect(g.stage.config.id).toBe(4);
    // The 8d71014 argument, for the record: state 'shop' is not 'boss', mode 'shop' is not 'boss'.
    const before = musicTrack({ mode: 'shop', area: g.stage.config.id, muted: false, abyss: g.state === 'boss', bossStarted: g.boss.enabled && g.boss.started });
    expect(before).toBe(4);
    expect(track('shop', g)).toBeNull();
  });
});

describe('A/B. an ordinary SHOP keeps its AREA track', () => {
  it.each([1, 2, 3, 4] as const)('AREA %i: playing -> SHOP -> close, one track throughout', area => {
    const g = caveRun(area);
    expect(track('playing', g)).toBe(area);
    openCave(g);
    expect({ state: g.state, stage: g.abyssStage }).toEqual({ state: 'shop', stage: 'none' });
    expect(track('shop', g)).toBe(area);
    // A purchase changes nothing either.
    g.coins.walletCoins = 9999;
    expect(g.buyShopItem(0)).toBe('bought');
    expect(track('shop', g)).toBe(area);
    expect(g.closeShop()).toBe(true);
    expect(g.state).toBe('playing');
    expect(track('playing', g)).toBe(area);
    // PAUSE over the AREA still holds its track, as before.
    expect(track('paused', g)).toBe(area);
  });
});

describe('C-F. THE ABYSS staging room stays silent through its SHOP', () => {
  it('C/D/E. before -> SHOP open -> close: silence, never AREA 4, never the fight', () => {
    const g = stagingRun();
    expect(track('boss', g)).toBeNull();
    expect(track('paused', g)).toBeNull();
    openStaging(g);
    expect({ state: g.state, stage: g.abyssStage, started: g.boss.started }).toEqual({ state: 'shop', stage: 'staging', started: false });
    expect(track('shop', g)).toBeNull();
    expect(g.closeShop()).toBe(true);
    // main.ts's closeShop sets mode from the model (5c740b3): 'boss' here.
    expect(g.state).toBe('boss');
    expect(track('boss', g)).toBeNull();
    expect(g.boss.started).toBe(false);
  });

  it('F. a purchase then close: still silent', () => {
    const g = stagingRun();
    g.coins.award(9000);
    openStaging(g);
    const wallet = g.coins.walletCoins;
    expect(g.buyShopItem(0)).toBe('bought');
    expect(g.coins.walletCoins).toBeLessThan(wallet);
    expect(track('shop', g)).toBeNull();
    g.closeShop();
    expect({ state: g.state, track: track('boss', g), started: g.boss.started }).toEqual({ state: 'boss', track: null, started: false });
  });

  it('♪ off is still silence everywhere', () => {
    const g = stagingRun();
    openStaging(g);
    expect(track('shop', g, true)).toBeNull();
    const c = caveRun(4); openCave(c);
    expect(track('shop', c, true)).toBeNull();
  });
});

describe('G/H. the fight', () => {
  /** THE ABYSS fight, woken the way the run wakes it: by stepping until NIMUSHI starts. */
  function fight() {
    const g = new GameModel(false);
    expect(g.jumpToNimushi()).toBe(true);
    const events: string[] = [];
    for (let i = 0; i < 120 * 30 && !g.boss.started; i++) {
      g.player.invincible = 99;
      g.step(STEP, 0, true);
      events.push(...g.events.splice(0).map(e => e.type));
    }
    return { g, events };
  }

  it('G. pressure_in_the_deep only once NIMUSHI has actually woken', () => {
    const g = new GameModel(false);
    g.jumpToNimushi();
    expect({ stage: g.abyssStage, enabled: g.boss.enabled, started: g.boss.started }).toEqual({ stage: 'fight', enabled: true, started: false });
    expect(track('boss', g)).toBeNull();
    const woke = fight();
    expect(woke.g.boss.started).toBe(true);
    expect(woke.events).toContain('bossStart');
    expect(track('boss', woke.g)).toBe('boss');
  });

  it('H. the fight track holds through PAUSE and never falls back to AREA 4', () => {
    const { g } = fight();
    for (const mode of ['boss', 'paused']) expect(track(mode, g), mode).toBe('boss');
    // No shelf can open in the fight: the arena removed the staging doorway.
    expect(g.shop.entrance).toBeFalsy();
  });
});

describe('transitions between AREAs are as they were', () => {
  it('AREA 1 -> 2 -> 3 -> 4 -> STAGING -> BOSS asks 1, 2, 3, 4, silence, the fight', () => {
    const asks: (AreaTrack | null)[] = [];
    for (const area of [1, 2, 3, 4] as const) {
      const g = new GameModel(false);
      g.jumpToStage(area, 1);
      asks.push(track('playing', g));
    }
    asks.push(track('boss', stagingRun()));
    const g = new GameModel(false);
    g.jumpToNimushi();
    for (let i = 0; i < 120 * 30 && !g.boss.started; i++) { g.player.invincible = 99; g.step(STEP, 0, true); g.events.length = 0; }
    asks.push(track('boss', g));
    expect(asks).toEqual([1, 2, 3, 4, null, 'boss']);
  });

  it('title, GAME OVER and GAME CLEAR stay silent', () => {
    const g = stagingRun();
    for (const mode of ['title', 'over', 'clear']) expect(track(mode, g), mode).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The player itself: what a SHOP open/close does to the one audio element.

class FakeElement {
  static made = 0;
  loop = false; preload = ''; currentTime = 0; paused = true; srcSets: string[] = []; plays = 0; pauses = 0;
  private _src = '';
  constructor() { FakeElement.made++; }
  get src() { return this._src; }
  set src(value: string) { this._src = value; this.srcSets.push(value); this.currentTime = 0; }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauses++; this.paused = true; }
}
const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
const fakeContext = () => ({ currentTime: 0, destination: {}, createGain: () => ({ gain: param(), connect: (x: unknown) => x }), createMediaElementSource: () => ({ connect: (x: unknown) => x }) });

describe('AreaMusic around a SHOP: no restarts, no new elements, no track changes', () => {
  const realAudio = (globalThis as { Audio?: unknown }).Audio;
  afterEach(() => { (globalThis as { Audio?: unknown }).Audio = realAudio; vi.useRealTimers(); });

  /** Drive the player through the asks main.ts makes for one walk, settling every fade. */
  async function play(asks: (AreaTrack | null)[]) {
    vi.useFakeTimers();
    FakeElement.made = 0;
    (globalThis as { Audio?: unknown }).Audio = FakeElement;
    const music = new AreaMusic();
    music.unlock(fakeContext() as unknown as AudioContext);
    const element = (music as unknown as { element: FakeElement }).element;
    const settle = async () => { for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync((MUSIC.fadeOut + MUSIC.fadeIn) * 1000 + 50); } };
    await settle();
    const marks: { plays: number; pauses: number; srcs: number; time: number; playing: AreaTrack | null }[] = [];
    for (const want of asks) {
      music.sync(want); await settle();
      element.currentTime += 3; // the track runs on between asks
      marks.push({ plays: element.plays, pauses: element.pauses, srcs: element.srcSets.length, time: element.currentTime, playing: (music as unknown as { playing: AreaTrack | null }).playing });
    }
    return { marks, made: FakeElement.made, element };
  }

  it('SIDE CAVE in AREA 4: the shelf opening and closing touches nothing', async () => {
    const g = caveRun(4);
    const asks = [track('playing', g)];
    openCave(g); asks.push(track('shop', g));
    g.closeShop(); asks.push(track('playing', g));
    const { marks, made } = await play(asks);
    expect(asks).toEqual([4, 4, 4]);
    expect(made).toBe(1);
    // Started once; then no play, pause or reload, and the position kept running.
    expect(marks.map(m => [m.plays, m.pauses, m.srcs])).toEqual([marks[0], marks[0], marks[0]].map(m => [m.plays, m.pauses, m.srcs]));
    expect(marks.map(m => m.time)).toEqual([marks[0].time, marks[0].time + 3, marks[0].time + 6]);
  });

  it('STAGING: AREA 4 fades out on arrival, and the shelf brings nothing back', async () => {
    const area4 = caveRun(4);
    const g = stagingRun();
    const asks = [track('playing', area4), track('boss', g)];
    openStaging(g); asks.push(track('shop', g));
    g.coins.award(9000); g.buyShopItem(0); asks.push(track('shop', g));
    g.closeShop(); asks.push(track('boss', g));
    expect(asks).toEqual([4, null, null, null, null]);
    const { marks, made } = await play(asks);
    expect(made).toBe(1);
    expect(marks.map(m => m.playing)).toEqual([4, null, null, null, null]);
    // After the fade on arrival, nothing: no play, no pause, no new file.
    const settled = marks[1];
    for (const m of marks.slice(2)) expect([m.plays, m.pauses, m.srcs]).toEqual([settled.plays, settled.pauses, settled.srcs]);
  });
});
