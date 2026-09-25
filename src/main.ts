import Phaser from 'phaser';
import { LEVEL_SELECT_DESTINATIONS, LEVEL_SELECT_GESTURE, type LevelDestination } from './data/levelSelect';
import { approachExtra, BOSS_APPROACH } from './data/nimushi';
import { TITLE, buildIdentifier } from './ui/branding';
import { upgradeCardHtml } from './ui/upgradeCard';
import './style.css';
import { GameScene, type GameBridge } from './scenes/GameScene';
import { GameModel } from './systems/GameModel';
import { GameAudio, eventSound } from './systems/Audio';
import { damageLabel } from './data/damage';
import { UPGRADES } from './data/upgrades';
import { HEALTH_RULES } from './systems/HealthSystem';
import { PhysicsPanel } from './ui/PhysicsPanel';
import { comboFeedback } from './systems/ComboFeedback';
import { AREAS, TOTAL_SECTIONS } from './data/areas';
import { shopItem, type ShopOffer } from './data/shop';
import { BOSS_TEST_WEAPONS, enterBossTest, type BossTestRequest, type BossTestTarget } from './dev/bossTest';
import { setTerrainMode, getTerrainMode, type TerrainMode } from './data/rhythm';
import { setSideRoomMode, getSideRoomMode, setCaveFrequency, getCaveFrequency, type SideRoomMode, type CaveFrequency } from './data/safeZone';
import { previewSideCave, SIDE_CAVE_FIXTURES } from './dev/sideCavePreview';
import { installMenuKeys } from './ui/menuKeys';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="site-header"><a class="wordmark" href="./" aria-label="Deep Drop ホーム"><span class="brand-icon">↓</span> DEEP DROP<span class="version">/ 01</span></a><div class="header-right"><span class="status-dot"></span><span>EXPERIMENTAL ARCADE</span><button id="sound" class="icon-button" aria-label="サウンドをオフにする" title="サウンド切り替え">♪</button></div></header>
<main class="layout">
  <aside class="intro"><div class="eyebrow"><span></span> A DESCENT INTO THE UNKNOWN</div><h1>THE ONLY<br>WAY IS<br><em>DOWN.</em><span class="heading-arrow">↘</span></h1><p class="tagline">撃って、落ちて、<br>もっと深く。</p><p class="intro-copy">一発の反動が、次の一歩になる。<br>残弾と重力を味方につけて、<br>まだ見ぬ深さへ。</p><div class="best-card"><span>PERSONAL BEST</span><div><span id="side-best">000</span><small>m</small><span class="best-arrow">↘</span></div></div><div class="intro-bottom"><span>NO JUMP.<br>JUST DROP.</span><span class="crosshair">✳</span></div></aside>
  <section class="game-column" aria-label="Deep Drop ゲーム">
    <div class="cabinet-top"><span><i></i> SHAFT_01</span><span id="zone">SURFACE ZONE</span></div>
    <div id="game-frame">
      <div id="game" aria-label="縦落下アクションのプレイ画面"></div>
      <div id="hud" class="hud"><div id="boss-bar" class="boss-bar" hidden><span class="boss-name">NIMUSHI <b id="boss-phase"></b></span><div class="boss-track"><i id="boss-fill"></i></div><small id="boss-percent">100%</small></div><div class="hud-top"><div><span class="hud-label"><b id="stage-label">1-1</b>DEPTH</span><div class="depth-number"><span id="depth">000</span><small id="depth-goal">/ 200m</small></div></div><div class="purse"><span id="coin-wallet">COIN 0</span><small id="coin-score">SCORE 0</small><div id="coin-high" class="coin-high"><div class="coin-high-bar"><i id="coin-high-fill"></i></div><b id="coin-high-state">HIGH</b></div></div><button id="pause" class="pause-button" aria-label="ポーズ" disabled>Ⅱ</button></div><div class="hud-status"><div><div id="hearts" aria-label="HP 4">♥ ♥ ♥ ♥</div><small id="life-gauge"></small></div><div class="ammo-group"><span id="ammo-label">AMMO</span><div id="ammo"></div><b id="gun-module" class="gun-module">MG</b></div></div><div id="oxygen" class="oxygen" hidden><span class="oxygen-label">OXYGEN <b id="oxygen-state"></b></span><div class="oxygen-bar"><i id="oxygen-fill"></i></div><small id="oxygen-seconds">12.0s</small></div><div id="heat" class="heat" hidden><span class="heat-label">HEAT <b id="heat-state"></b></span><div class="heat-bar"><i id="heat-fill"></i></div><small id="heat-percent">0%</small></div><div id="stage-intro" class="stage-intro" hidden aria-live="polite"></div><div id="combo" class="combo" hidden></div><div id="gun-toast" class="gun-toast" hidden aria-live="polite"></div><div id="boss-line" class="boss-line" hidden aria-live="polite"></div><div id="practice-label" hidden>CONTROL LAB <span>落下 → 射撃 → 着地</span></div><div class="depth-progress"><div id="progress"></div></div></div>
      <div id="overlay" class="overlay"></div>
      <div id="touch-controls"><div id="move-pad"><button id="left-control" aria-label="左移動">←</button><button id="right-control" aria-label="右移動">→</button></div><div id="fire-pad"><button id="fire-control" aria-label="射撃">FIRE<span>◎</span></button></div></div>
    </div>
    <div class="cabinet-bottom"><span><span class="live-dot"></span> <span id="run-status">READY TO DESCEND</span></span><span>↓ 4 AREAS · 12 SECTIONS</span></div>
    <section id="physics-tuning" class="physics-tuning" aria-label="練習用の物理調整" hidden></section>
  </section>
  <aside class="guide"><div class="guide-title"><span>FIELD GUIDE</span><span>01—03</span></div><section class="guide-item"><span class="guide-index">01</span><h2>落ちる。狙う。</h2><p>左右に動いて、ルートを選ぶ。<br>地上でACTION＝ジャンプ。</p><div class="key-row"><kbd>A</kbd><kbd>D</kbd><span>or</span><kbd>←</kbd><kbd>→</kbd></div></section><section class="guide-item"><span class="guide-index">02</span><h2>撃って、ブレーキ。</h2><p>空中でACTION＝真下へ射撃。<br>反動で減速。CHARGEは8。</p><div class="key-row"><kbd class="space-key">SPACE</kbd><span>地上=跳ぶ / 空中=撃つ</span></div></section><section class="guide-item"><span class="guide-index">03</span><h2>着地で、もう一度。</h2><p>着地でCHARGE全回復。<br>踏みつけでも全回復、コンボは続く。</p><div class="reload-demo"><span>▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰</span><small>FULL RELOAD ↺</small></div></section><div class="tip"><span>↳ KEEP IN MIND</span><p>トゲのある敵は踏まないこと。<br>休憩地点で強化を1つ選ぶ。<br>コンボは着地で精算：8/15/25。</p></div><div class="guide-footer"><kbd>ESC</kbd><span>ひと休みする</span></div></aside>
</main><footer class="site-footer"><span>DEEP DROP <span class="footer-slash">/</span> A SMALL GAME ABOUT GOING DEEPER.</span><span>PROTOTYPE V0.1 <span class="footer-dot">●</span></span></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const audio = new GameAudio();
let best = 0;
/**
 * True while the run was started from TEST LEVEL SELECT. Such a run never writes PERSONAL BEST: its
 * depth counts every SECTION it skipped, so saving it would overwrite a real record with a warp.
 */
let warpedRun = false;
/** Record a finished run's depth as PERSONAL BEST, unless it was a LEVEL SELECT run. */
function recordBest(depth: number) {
  if (warpedRun) return;
  best = Math.max(best, depth);
  try { localStorage.setItem('deep-drop-best', String(best)); } catch { /* Keep a session best if storage is unavailable. */ }
  $('side-best').textContent = String(best).padStart(3, '0');
}
try { best = Number(localStorage.getItem('deep-drop-best') || 0); if (!Number.isFinite(best)) best = 0; } catch { /* Storage is optional in private browsing. */ }
type Mode = 'title' | 'playing' | 'paused' | 'upgrade' | 'boss' | 'over' | 'clear' | 'shop';
let mode: Mode = 'title';
let lastHud = '';
/**
 * The modes that accept gameplay input. The FINAL BOSS is ordinary play with a king in it, so it
 * must answer to exactly the same controls -- this mirrors GameModel.running, which is what the
 * scene uses to decide whether to step the simulation.
 */
const isPlayMode = (m: Mode): m is 'playing' | 'boss' => m === 'playing' || m === 'boss';
const inPlay = () => isPlayMode(mode);
let ready = false;
let physicsPanel: PhysicsPanel | undefined;
let comboAnimation: Animation | undefined;
const bridge: GameBridge = {
  direction: 0, firing: false, active: false, suppressUntil: 0,
  onFrame: updateHud,
  onEvent(event, model) {
    // Events that have no sound simply make none. No cast, so a mismatch is a build error here
    // rather than a crash inside the audio engine.
    const sound = eventSound(event.type);
    if (sound) audio.play(sound, event.combo, event.stomp);
    if (event.type === 'kill') {
      updateHud(model);
      const feedback = comboFeedback(event.combo || 0);
      comboAnimation?.cancel();
      if (feedback.tier && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) comboAnimation = $('combo').animate([{ transform: 'scale(1)' }, { transform: `scale(${feedback.scale})`, offset: 0.2 }, { transform: 'scale(1)' }], { duration: feedback.duration, easing: 'ease-out' });
    }
    if (event.type === 'land' || event.type === 'hurt') comboAnimation?.cancel();
    if (event.type === 'section') showStageIntro(model);
    if (event.type === 'shopOpen') showShop(model);
    if (event.type === 'exitReady') showToast('EXIT OPEN', '下へ進む扉が現れた');
    if (event.type === 'gunModule') showToast(String(event.stage), event.bonus === 'charge' ? `AMMO MAX +${event.value}` : `HP +${event.value}`);
    if (event.type === 'bossPhase') showBossPhase(Number(event.value), String(event.stage));
    // The one beat the fight holds. The banner is screen-space and stays the right way up, which
    // is the whole point of inverting the physics rather than rotating the view.
    if (event.type === 'gravityFlip' && event.value) showToast('GRAVITY REVERSED', '重力が反転した');
    if (event.type === 'bossStart') showToast('BOSS TIME', String(event.stage));
    if (event.type === 'bossRage') showToast('FINAL RAGE', 'NIMUSHI が本気になった');
    if (event.type === 'tomato') showToast('TOMATO', `MAX HP +10 / MAX CHARGE +${event.value}`);
    if (event.type === 'upgrade') showSectionClear(model, event.stage || model.stage.label, event.areaCleared || null);
    if (event.type === 'abyss') showAbyss(model);
    if (event.type === 'boss') showBoss(model);
    if (event.type === 'clear') showClear(model);
    if (event.type === 'over') showResult(model);
  },
};
const scene = new GameScene(bridge);
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: 450, height: 800, backgroundColor: '#10191c', pixelArt: true, antialias: false, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, input: { activePointers: 4 }, audio: { noAudio: true }, callbacks: { postBoot: () => { ready = true; } } });
physicsPanel = new PhysicsPanel($('physics-tuning'), () => scene.model, () => { lastHud = ''; updateHud(scene.model); });
// DEV only: `__bossTest()` for the dormant fight, or `__bossTest('phase3')` / `('rage')` to start
// part-way in. The stretch shortcuts set NIMUSHI's HP as a debug fixture and let its own systems
// pick the stretch up from it -- nothing here forces a phase.
//
// The object form adds a starting weapon and an attack to jump straight to:
//   `__bossTest({ weapon: 'SHOTGUN' })`
//   `__bossTest({ attack: 'SHOWER' })`
//   `__bossTest({ target: 'phase4', weapon: 'PUNCHER', attack: 'SHOWER' })`
// Weapons take an id, a name or a HUD short; attacks take SHOWER / BEAM / CUP / CLONES.
if (import.meta.env.DEV) {
  (window as unknown as { __bossTest: (r?: BossTestTarget | BossTestRequest) => string }).__bossTest =
    (request = 'phase1') => bossTest(request);
  // DEVELOPMENT ONLY: AREA 1 terrain A/B/C.
  //
  //   `__roadTerrain('legacy')`      one ledge per row, evenly spaced -- what AREA 1 shipped with
  //   `__roadTerrain('rhythm-v1')`   the gap varies, still one ledge per row
  //   `__roadTerrain('grammar-v2')`  terrain pieces: the SHAPE varies, and a band may hold several
  //
  //   `__roadTerrain('grammar-v2', 8891)`   ...and run it on a fixed seed
  //
  // With a seed, the run is reproducible: play the same number on each mode and the only thing
  // that differs is the terrain grammar. Without one a run is unseeded, as it always is, and the
  // seed it was given is reported so a run worth repeating can be. This is NOT a difficulty
  // setting, and none of it reaches a production build -- the whole block is compiled out.
  const seeded = (n: number) => () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  let roadSeed: number | null = null;
  (window as unknown as { __roadTerrain: (m?: TerrainMode, s?: number) => string }).__roadTerrain = (mode, seed) => {
    if (mode !== 'legacy' && mode !== 'rhythm-v1' && mode !== 'grammar-v2') {
      return `AREA 1 TERRAIN is ${getTerrainMode()}${roadSeed === null ? '' : ` / seed ${roadSeed}`} -- pass 'legacy', 'rhythm-v1' or 'grammar-v2'`;
    }
    setTerrainMode(mode);
    roadSeed = seed === undefined ? null : Math.floor(seed);
    // Back to the title, because a SECTION already generated keeps the terrain it was built with.
    showTitle();
    return `AREA 1 TERRAIN = ${mode}${roadSeed === null ? ' / unseeded' : ` / seed ${roadSeed}`} -- start a run`;
  };
  // A seeded run is built by replacing the model the scene just made. `startRun` is untouched, so
  // an ordinary run is still exactly an ordinary run.
  const applySeed = () => {
    if (roadSeed === null || scene.model.practice) return;
    scene.model = new GameModel(false, seeded(roadSeed));
  };

  // The terrain read-out: which PIECE the player is standing in. Development only, so that a
  // stretch a human reacted to can be named instead of guessed at.
  const readout = document.createElement('div');
  readout.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;padding:4px 7px;background:#101a14cc;color:#b9ef70;border:1px solid #3c5a35;font:10px \'IBM Plex Mono\',monospace;letter-spacing:1px;pointer-events:none';
  document.body.appendChild(readout);
  const tick = () => {
    const model = scene.model;
    const history = (model as unknown as { generator?: { planner?: { history: readonly { piece: string; y: number }[] } } })
      .generator?.planner?.history ?? [];
    let here = '';
    for (const entry of history) if (entry.y <= model.player.y) here = entry.piece;
    const label = here ? here.replace(/([A-Z])/g, ' $1').toUpperCase() : 'ROW GRAMMAR';
    readout.textContent = `[${label}] ${getTerrainMode()} · caves ${getCaveFrequency()}${roadSeed === null ? '' : ` #${roadSeed}`}`;
    readout.hidden = !inPlay();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  (window as unknown as { __roadSeedApply: () => void }).__roadSeedApply = applySeed;
  // DEVELOPMENT ONLY: AREA 1 side-room A/B.
  //
  //   `__roadSideRooms('legacy')`      one chamber per SECTION -- what every AREA shipped with
  //   `__roadSideRooms('v1')`          two -- the pilot (the default)
  //   `__roadSideRooms('v1', 8891)`    ...on a fixed seed
  //
  // Terrain stays on whatever `__roadTerrain` is set to, so this changes ONE thing: how many times
  // a SECTION offers somewhere to step off the fall line. Compiled out of a production build.
  (window as unknown as { __roadSideRooms: (m?: SideRoomMode, s?: number) => string }).__roadSideRooms = (mode, seed) => {
    if (mode !== 'legacy' && mode !== 'v1') {
      return `SIDE ROOMS are ${getSideRoomMode()} -- pass 'legacy' or 'v1'`;
    }
    setSideRoomMode(mode);
    roadSeed = seed === undefined ? roadSeed : Math.floor(seed);
    showTitle();
    return `SIDE ROOMS = ${mode} (terrain ${getTerrainMode()})${roadSeed === null ? '' : ` / seed ${roadSeed}`} -- start a run`;
  };
  // DEVELOPMENT ONLY: how often a SIDE CAVE turns up.
  //
  //   `__sideCaveFrequency('low', 8891)`       one per SECTION  -- three across AREA 1
  //   `__sideCaveFrequency('variable', 8891)`  one or two, 50/50 -- about four and a half
  //   `__sideCaveFrequency('high', 8891)`      two per SECTION  -- six, which is what they were built at
  //
  // Play the same seed on each. The shaft is IDENTICAL in all three -- caves draw from their own
  // stream and the same slots are reserved whatever the budget is -- so the only thing that differs
  // is how many caves are cut into it. Compiled out of a production build.
  (window as unknown as { __sideCaveFrequency: (m?: CaveFrequency, s?: number) => string }).__sideCaveFrequency = (mode, seed) => {
    if (mode !== 'low' && mode !== 'variable' && mode !== 'high') {
      return `SIDE CAVES are ${getCaveFrequency()} -- pass 'low', 'variable' or 'high'`;
    }
    setCaveFrequency(mode);
    roadSeed = seed === undefined ? roadSeed : Math.floor(seed);
    showTitle();
    const per = mode === 'low' ? '1' : mode === 'high' ? '2' : '1-2';
    return `SIDE CAVES = ${mode} (${per} per SECTION)${roadSeed === null ? '' : ` / seed ${roadSeed}`} -- start a run`;
  };
  // DEVELOPMENT ONLY: look at one SIDE CAVE immediately.
  //
  //   `__sideCavePreview('module-left')`  `__sideCavePreview('shop-right')`  `__sideCavePreview('coin-left')`
  //
  // Starts a run and drops the player at that cave's mouth. The cave is built through the same
  // `placeCave` the generator uses and handed to the same `addCave`, so this shows what a run
  // builds rather than a mock-up of it. Calling it with nothing lists the six fixtures.
  (window as unknown as { __sideCavePreview: (name?: string) => string }).__sideCavePreview = name => {
    if (!ready) return 'not ready yet';
    if (!name) return `SIDE CAVE fixtures: ${SIDE_CAVE_FIXTURES.join(', ')}`;
    start();
    const report = previewSideCave(scene.model, name);
    if (report.startsWith('unknown')) { showTitle(); return report; }
    $('run-status').textContent = `SIDE CAVE / ${name.toUpperCase()}`;
    lastHud = ''; updateHud(scene.model);
    return report;
  };
  // The model the run is actually using, for development harnesses that need to drive one. A
  // getter rather than a snapshot, because `startRun` replaces the model on every run.
  (window as unknown as { __roadModel: () => GameModel }).__roadModel = () => scene.model;
  // The input bridge, for development harnesses that drive the touch controls and need to read what
  // reached the run. A getter, because `bridge` is a live object the scene reads every frame.
  (window as unknown as { __roadInput: () => { direction: number; firing: boolean; active: boolean } }).__roadInput =
    () => ({ direction: bridge.direction, firing: bridge.firing, active: bridge.active });
}

function setOverlay(content: string) {
  if (content) { introAnimation?.cancel(); $('stage-intro').hidden = true; }
  $('overlay').innerHTML = content;
  $('overlay').hidden = !content;
  $('overlay').classList.toggle('rest-overlay', mode === 'upgrade');
  $('game-frame').classList.toggle('in-play', inPlay());
  $('pause').toggleAttribute('disabled', !inPlay());
  $('touch-controls').hidden = !!content;
  // A press cannot survive the controls going away: nothing will ever deliver its release.
  if (content) { movementPointers.clear(); firePointers.clear(); syncPointers(); }
  // A menu's buttons answer to SPACE themselves, and they never see it while the run is capturing
  // it. The run has no use for the key while a menu is up, so it lets go of it for the duration.
  scene.captureKeys(!content);
  physicsPanel?.show(mode);
  if (content) window.setTimeout(() => $('overlay').querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }), 60);
}
/** Announces the SECTION as it starts. The AREA name only appears on that area's first SECTION. */
let introAnimation: Animation | undefined;
function showStageIntro(model: GameModel) {
  const intro = $('stage-intro');
  introAnimation?.cancel();
  if (model.practice || mode !== 'playing' || model.state !== 'playing') { intro.hidden = true; return; }
  const area = model.stage.progress.area;
  intro.innerHTML = model.stage.isAreaOpening
    ? `<b>AREA ${area}</b><strong>${model.stage.areaName}</strong><small>${model.stage.label}</small>`
    : `<strong class="section-only">${model.stage.label}</strong>`;
  intro.hidden = false;
  const duration = model.stage.isAreaOpening ? 1900 : 1100;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setTimeout(() => { intro.hidden = true; }, duration);
    return;
  }
  introAnimation = intro.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.14 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration, easing: 'ease-out' });
  introAnimation.onfinish = () => { intro.hidden = true; };
}
function clearInput() { movementPointers.clear(); firePointers.clear(); syncPointers(); bridge.firing = false; bridge.direction = 0; scene.resetKeys(); }
/**
 * How long the run ignores the keyboard after a menu closes, in ms.
 *
 * ENTER or SPACE confirms a menu and is usually still held when the overlay goes; auto-repeat then
 * delivers that same press to a live run, where SPACE fires the gunboots. Short enough not to be
 * felt, long enough to outlast the gap before a key repeats.
 */
const MENU_INPUT_GUARD_MS = 260;
/** Hand the keyboard back to the run, but not on the frame a menu let go of it. */
function resumeInput() { bridge.suppressUntil = performance.now() + MENU_INPUT_GUARD_MS; bridge.active = true; }
/** True while an overlay menu is up and the keyboard belongs to it. */
const menuOpen = () => !$('overlay').hidden && mode !== 'playing' && mode !== 'boss';
function start(practice = false) {
  if (!ready) return;
  audio.unlock(); clearInput(); scene.startRun(practice);
  warpedRun = false;
  // DEV: a run asked for by seed is rebuilt here, before anything reads the model. Compiled out.
  if (import.meta.env.DEV) (window as unknown as { __roadSeedApply?: () => void }).__roadSeedApply?.();
  mode = 'playing'; resumeInput();
  comboAnimation?.cancel();
  if (practice) physicsPanel?.startPractice();
  setOverlay(''); lastHud = ''; updateHud(scene.model);
  $('run-status').textContent = practice ? 'CONTROL LAB / NO RISK' : 'DESCENT IN PROGRESS';
  $('practice-label').hidden = !practice;
  $('touch-controls').classList.add('visible');
  $('overlay').classList.remove('result-overlay');
}
/**
 * DEVELOPMENT ONLY: start a run and drop straight into the NIMUSHI fight.
 *
 * A debug utility for playtesting the boss without clearing AREA 1-4 first. It reuses the ordinary
 * `start()` so the overlay, audio, HUD and controls come up exactly as they do for a real run --
 * only the destination differs. The normal route to the fight is untouched and still has its own
 * end-to-end browser check.
 */
function bossTest(request: BossTestTarget | BossTestRequest = 'phase1') {
  if (!import.meta.env.DEV) return 'BOSS TEST is development only';
  if (!ready) return 'not ready yet';
  start();
  const report = enterBossTest(scene.model, request);
  // A rejected request must not leave a started run behind: put the title back and say why.
  if (report.startsWith('unknown')) { showTitle(); return report; }
  const target = typeof request === 'string' ? request : request.target ?? 'phase1';
  $('run-status').textContent = `BOSS TEST / ${target.toUpperCase()}`;
  lastHud = ''; updateHud(scene.model);
  return report;
}

function showTitle() {
  mode = 'title'; bridge.active = false;
  if (ready) { clearInput(); scene.startRun(); lastHud = ''; updateHud(scene.model); }
  $('side-best').textContent = String(Math.floor(best)).padStart(3, '0');
  $('practice-label').hidden = true;
  $('run-status').textContent = 'READY TO DESCEND';
  $('touch-controls').classList.remove('visible');
  setOverlay(`<div class="title-content"><div class="pill"><span></span> 4 AREAS · 12 SECTIONS</div><div class="title-symbol">↓</div><h2>DEEP<br><span>DROP</span></h2><div class="title-sub">${TITLE.sub}</div><p>深く潜れ。弾が尽きる、その前に。</p><button id="start" class="primary-button">潜降開始 <span>↘</span></button><button id="practice" class="text-button">操作を試す <span>CONTROL LAB →</span></button><div class="title-hint desktop-hint">MOVE <b>← →</b><span>·</span> SHOOT <b>SPACE</b></div><div class="title-hint mobile-hint">左右をホールドで移動 · タップで射撃<br>FIREボタン長押しで連射</div></div><span class="overlay-bottom">6 BULLETS. ONE WAY DOWN.</span><span class="build-tag" id="build-tag">${buildIdentifier()}</span>`);
  $('start').onclick = () => start(); $('practice').onclick = () => start(true);
  // TEST LEVEL SELECT: hidden from the ordinary title. Tap the arrow above the logo five times, or
  // open the page with `?levels`, and a LEVEL SELECT button appears under CONTROL LAB. Works the
  // same with a mouse and a finger, and in the published build, because Human Review happens there.
  const revealLevelSelect = () => {
    if (document.getElementById('level-select')) return;
    const button = document.createElement('button');
    button.id = 'level-select'; button.className = 'text-button';
    button.innerHTML = 'LEVEL SELECT <span>TEST →</span>';
    button.onclick = showLevelSelect;
    $('practice').insertAdjacentElement('afterend', button);
  };
  if (new URLSearchParams(location.search).has('levels')) revealLevelSelect();
  let taps: number[] = [];
  const arrow = $('overlay').querySelector<HTMLElement>('.title-symbol');
  arrow?.addEventListener('pointerdown', () => {
    const now = performance.now();
    taps = [...taps.filter(t => now - t < LEVEL_SELECT_GESTURE.windowMs), now];
    if (taps.length >= LEVEL_SELECT_GESTURE.taps) revealLevelSelect();
  });
  // DEV only: a BOSS TEST button beside the ordinary ones. The markup is added here rather than in
  // the title template so that a production build has no trace of it at all.
  if (import.meta.env.DEV) {
    // ...and a weapon selector beside it, because the question the button is usually being asked is
    // "is SHOTGUN usable against NIMUSHI at all", not "does the fight start".
    const picker = document.createElement('select');
    picker.id = 'boss-test-weapon';
    picker.title = 'BOSS TEST starting weapon (development only)';
    // Styled inline rather than through a class: a stylesheet rule would ship in the production CSS
    // even though nothing in a production build can create the element it styles.
    picker.style.cssText = "display:block;margin:6px auto 0;padding:5px 8px;background:#17231d;color:#b0baa7;border:1px solid #4a5945;font:10px 'IBM Plex Mono',monospace;letter-spacing:1px";
    for (const id of BOSS_TEST_WEAPONS) {
      const option = document.createElement('option');
      option.value = id; option.textContent = id.toUpperCase();
      picker.appendChild(option);
    }
    const button = document.createElement('button');
    button.id = 'boss-test'; button.className = 'text-button'; button.textContent = 'BOSS TEST';
    button.onclick = () => bossTest({ target: 'phase1', weapon: picker.value });
    $('practice').insertAdjacentElement('afterend', picker);
    picker.insertAdjacentElement('beforebegin', button);
  }
}
/** TEST LEVEL SELECT: every SECTION and the ABYSS before the boss, one tap each. */
function showLevelSelect() {
  const label = (d: LevelDestination) => d === 'boss' ? 'BOSS' : d;
  setOverlay(`<div class="panel-content level-select"><div class="eyebrow">TEST / HUMAN REVIEW</div><h2>LEVEL SELECT<span>通常の新規ランとして開始します</span></h2><div class="level-grid">${LEVEL_SELECT_DESTINATIONS.map(d => `<button class="level-button${d === 'boss' ? ' boss' : ''}" data-dest="${d}">${label(d)}</button>`).join('')}</div><button id="level-back" class="text-button">タイトルへ</button></div>`);
  $('overlay').querySelectorAll<HTMLButtonElement>('.level-button').forEach(b => { b.onclick = () => warp(b.dataset.dest); });
  $('level-back').onclick = showTitle;
}
/** Start an ordinary run and move it; a refused destination puts the title back. */
function warp(destination: unknown) {
  if (!ready) return false;
  start();
  if (!scene.model.warpTo(destination)) { showTitle(); return false; }
  warpedRun = true;
  clearInput(); resumeInput();
  $('run-status').textContent = `LEVEL SELECT / ${String(destination).toUpperCase()}`;
  lastHud = ''; updateHud(scene.model);
  return true;
}
let pausedFrom: 'playing' | 'boss' = 'playing';
function pause() {
  if (!isPlayMode(mode)) return;
  pausedFrom = mode;
  mode = 'paused'; scene.model.paused = true; bridge.active = false; clearInput();
  setOverlay(`<div class="panel-content"><div class="eyebrow">TAKE A BREATH</div><h2>PAUSED<span>ひと休み。</span></h2><p>深淵は、逃げない。</p><button id="resume" class="primary-button">つづける <span>↓</span></button><button id="restart" class="secondary-button">最初から</button><button id="home" class="text-button">タイトルへ</button></div>`);
  $('resume').onclick = resume; $('restart').onclick = () => start(scene.model.practice); $('home').onclick = showTitle;
}
function resume() { scene.model.paused = false; mode = pausedFrom; clearInput(); resumeInput(); setOverlay(''); }
/** A short, skippable SECTION CLEAR card before the rest point. Tap or press any key to move on. */
let bannerTimer: number | undefined;
function showSectionClear(model: GameModel, stage: string, areaCleared: string | null) {
  mode = 'upgrade'; bridge.active = false; clearInput();
  $('run-status').textContent = areaCleared ? `${areaCleared} COMPLETE` : `SECTION ${stage} CLEAR`;
  setOverlay(`<div class="clear-banner"><span class="eyebrow"><span></span> SECTION CLEAR</span><strong>${stage}</strong>${areaCleared ? `<b>AREA ${model.stage.progress.area} COMPLETE<i>${areaCleared}</i></b>` : ''}<small>タップ / キーで休憩地点へ</small></div>`);
  const open = () => {
    if (bannerTimer === undefined) return;
    window.clearTimeout(bannerTimer); bannerTimer = undefined;
    $('overlay').removeEventListener('pointerdown', open); window.removeEventListener('keydown', open);
    if (mode === 'upgrade') showUpgrade(model);
  };
  bannerTimer = window.setTimeout(open, areaCleared ? 1300 : 850);
  $('overlay').addEventListener('pointerdown', open); window.addEventListener('keydown', open);
}
function showUpgrade(model: GameModel) {
  mode = 'upgrade'; bridge.active = false; clearInput();
  const choices = model.upgrades.choices;
  // One of each per run, so the owned list is a set rather than a tally.
  const acquired = UPGRADES.filter(u => model.upgrades.has(u.id)).map(u => `<span title="${u.label}">${u.icon} ${u.name}</span>`).join('');
  const cleared = model.stage.boss ? 'FINAL' : `SECTION ${model.stage.label}`;
  const destination = model.stage.isFinalSection ? 'FINAL BOSS' : model.stage.isAreaFinale ? `AREA ${model.stage.progress.area + 1}` : nextSectionLabel(model);
  $('run-status').textContent = 'REST / SAFE ZONE';
  setOverlay(`<div class="panel-content upgrade-content" role="dialog" aria-modal="true" aria-labelledby="rest-title"><div class="eyebrow">${cleared} CLEAR / REST POINT</div><h2 id="rest-title">CHOOSE ONE<span>安全地帯 · HPの自動回復はありません</span></h2><div class="rest-stats"><span>HP <b>${model.hp} / ${model.health.maxHp}</b></span><span>MAX HP <b>${model.health.maxHp}</b></span><span>LIFE UP <b>${model.health.overflowHealing} / ${HEALTH_RULES.overflowPerLife}</b></span><span>弾数上限 <b>${model.stats.maxAmmo}</b></span><span>NEXT <b>${destination}</b></span><span>SECTION <b>${model.stage.clearedSections + 1} / ${TOTAL_SECTIONS}</b></span></div><div class="owned-upgrades" aria-label="取得済み強化">${acquired || '<span>取得済み強化：なし</span>'}</div><div class="upgrade-list">${choices.map((u, i) => upgradeCardHtml(u, i)).join('')}</div><p id="selection-summary" class="upgrade-note" aria-live="polite">1つ選んでNEXTで確定。選択中は時間が停止します。</p><button id="upgrade-confirm" class="primary-button" disabled>NEXT · 選択してください</button></div>`);
  choices.forEach((u, i) => { $(`upgrade-${i}`).onclick = () => {
    if (!model.selectUpgrade(u.id)) return;
    choices.forEach((_, j) => {
      $(`upgrade-${j}`).setAttribute('aria-pressed', String(i === j));
      $(`upgrade-${j}`).querySelector('.upgrade-arrow')!.textContent = i === j ? '✓' : '○';
    });
    $('selection-summary').textContent = `${u.name}を選択中 · NEXTで確定`;
    $('upgrade-confirm').removeAttribute('disabled'); $('upgrade-confirm').textContent = 'NEXT · 確定して進む';
    // Step the focus onto NEXT, so choosing and confirming are two presses of the same key and a
    // keyboard player never has to hunt for the button. A mouse lands there too, which is where
    // they were going anyway.
    $('upgrade-confirm').focus({ preventScroll: true });
  }; });
  $('upgrade-confirm').onclick = () => {
    if (!model.confirmUpgrade()) return;
    audio.unlock(); audio.play('upgrade');
    // A boss hand-off keeps the panel up for one frame; the 'boss' event opens the FINAL BOSS screen.
    if (model.state !== 'playing') return;
    mode = 'playing'; clearInput(); setOverlay(''); lastHud = ''; updateHud(model);
    $('run-status').textContent = 'DESCENT IN PROGRESS'; resumeInput();
  };
}
/** The label of the SECTION that NEXT will start, without advancing the run. */
function nextSectionLabel(model: GameModel) {
  const progress = model.stage.progress;
  return `${progress.area}-${progress.section + 1}`;
}
/** Short, non-blocking phase card. Play continues underneath exactly as the SECTION card does. */
let gunToastAnimation: Animation | undefined;
/**
 * The SHOP. Walking into the doorway stops the world, so nothing can be bought by accident and
 * nothing kills the player while they read. Every button is a real button, so touch works the
 * same as a mouse.
 */
/** What a good does, in one word, so a shelf can be read before any of it is priced. */
function shopKind(offer: ShopOffer) {
  const item = shopItem(offer.item);
  if (item.maxHp > 0) return 'MAX LIFE';
  if (item.hearts > 0 && item.maxCharge > 0) return 'LIFE + CHARGE';
  if (item.hearts > 0) return 'LIFE';
  return 'CHARGE';
}
function showShop(model: GameModel) {
  mode = 'shop'; bridge.active = false; clearInput();
  const draw = () => {
    const rows = model.shop.offers.map((offer, index) => {
      const affordable = model.coins.walletCoins >= offer.price;
      const state = offer.sold ? 'SOLD OUT' : affordable ? `${offer.price} COIN` : `${offer.price} COIN（不足）`;
      return `<button class="shop-item" id="shop-buy-${index}" ${offer.sold || !affordable ? 'disabled' : ''}>` +
        `<span class="shop-kind">${shopKind(offer)}</span>` +
        `<strong>${offer.name}</strong><small>${offer.effect}</small><b>${state}</b></button>`;
    }).join('');
    setOverlay(`<div class="panel-content shop-content"><div class="eyebrow">SHOP</div>` +
      `<h2>SHOP.<span>コインを使って装備を整える</span></h2>` +
      `<div class="shop-purse">所持 <b>${model.coins.walletCoins}</b> COIN<small>SCORE ${model.coins.scoreCoins}（購入しても減りません）</small></div>` +
      `<div class="shop-list">${rows}</div>` +
      `<button id="shop-close" class="primary-button">立ち去る <span>↓</span></button></div>`);
    model.shop.offers.forEach((_, index) => {
      const button = document.getElementById(`shop-buy-${index}`);
      if (button) button.onclick = () => { audio.unlock(); if (model.buyShopItem(index) === 'bought') { lastHud = ''; updateHud(model); draw(); } };
    });
    $('shop-close').onclick = () => closeShop(model);
  };
  draw();
}
function closeShop(model: GameModel) {
  if (!model.closeShop()) return;
  mode = 'playing'; clearInput(); setOverlay(''); lastHud = ''; updateHud(model);
  resumeInput();
}
/** A short, non-blocking card. Used for weapon swaps and for the exit opening. */
function showToast(title: string, detail: string) {
  const toast = $('gun-toast');
  gunToastAnimation?.cancel();
  toast.innerHTML = `<b>${title}</b><span>${detail}</span>`;
  toast.hidden = false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { window.setTimeout(() => { toast.hidden = true; }, 1100); return; }
  gunToastAnimation = toast.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.18 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], { duration: 1250, easing: 'ease-out' });
  gunToastAnimation.onfinish = () => { toast.hidden = true; };
}
function showBossPhase(phase: number, name: string) {
  const intro = $('stage-intro');
  introAnimation?.cancel();
  if (mode !== 'boss') { intro.hidden = true; return; }
  intro.innerHTML = `<b>PHASE ${phase}</b><strong>${name}</strong>`;
  intro.hidden = false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { window.setTimeout(() => { intro.hidden = true; }, 1100); return; }
  introAnimation = intro.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' });
  introAnimation.onfinish = () => { intro.hidden = true; };
}
/**
 * THE ABYSS opens. The staging room is ordinary play -- it is walked, shopped and shot through --
 * so this puts the controls back exactly as a SECTION start does, and only names the place.
 */
function showAbyss(model: GameModel) {
  mode = 'boss'; clearInput();
  $('run-status').textContent = 'THE ABYSS';
  $('zone').textContent = 'FINAL · THE ABYSS';
  setOverlay(''); lastHud = ''; updateHud(model);
  $('touch-controls').classList.add('visible');
  resumeInput();
  showBossPhase(0, 'THE ABYSS');
}
function showBoss(model: GameModel) {
  mode = 'boss'; clearInput();
  $('run-status').textContent = 'FINAL BOSS / NIMUSHI';
  $('zone').textContent = 'FINAL · NIMUSHI';
  setOverlay(''); lastHud = ''; updateHud(model);
  $('touch-controls').classList.add('visible');
  resumeInput();
  showBossPhase(model.boss.phaseId, model.boss.phase.name);
}
function showClear(model: GameModel) {
  mode = 'clear'; bridge.active = false; clearInput();
  const depth = Math.floor(model.totalDepth);
  recordBest(depth);
  $('run-status').textContent = 'NIMUSHI DEFEATED';
  const upgrades = model.upgrades.acquired.length;
  // model.elapsed only advances inside a running step, so it is play time: title screens, PAUSE
  // and rest/upgrade selection are all already excluded. BOSS TIME is the fight on its own.
  const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const clearTime = mmss(model.elapsed), bossTime = mmss(model.bossTime);
  setOverlay(`<div class="panel-content result-content clear-content"><div class="eyebrow">RUN COMPLETE</div><h2>GAME CLEAR.<span>NIMUSHI DEFEATED</span></h2><div class="result-depth"><small>TOTAL DEPTH</small><strong>${depth}<span>m</span></strong></div><div class="result-stats"><div><span>TOTAL KILLS</span><b>${model.kills}</b></div><div><span>MAX COMBO</span><b>${model.maxCombo}</b></div><div><span>UPGRADES</span><b>${upgrades}</b></div><div><span>SCORE</span><b>${model.score.toLocaleString()}</b></div><div><span>CLEAR TIME</span><b>${clearTime}</b></div><div><span>BOSS TIME</span><b>${bossTime}</b></div></div><button id="play-again" class="primary-button">PLAY AGAIN <span>↻</span></button><button id="clear-home" class="text-button">タイトルへ</button></div>`);
  $('play-again').onclick = () => start();
  $('clear-home').onclick = showTitle;
}
function showResult(model: GameModel) {
  mode = 'over'; bridge.active = false; clearInput();
  const depth = Math.floor(model.totalDepth), newBest = !warpedRun && depth > best;
  recordBest(depth);
  $('run-status').textContent = 'SIGNAL LOST';
  setOverlay(`<div class="panel-content result-content"><div class="eyebrow">SIGNAL LOST / GAME OVER</div><h2>NICE DIVE.<span>まだ、深くへ行ける。</span></h2><div class="result-depth"><small>DEPTH REACHED</small><strong>${depth}<span>m</span></strong>${newBest ? '<b>↗ NEW PERSONAL BEST</b>' : ''}</div><div class="result-stats"><div><span>KILLS</span><b>${model.kills}</b></div><div><span>MAX COMBO</span><b>${model.maxCombo}</b></div><div><span>SCORE</span><b>${model.score.toLocaleString()}</b></div><div><span>REACHED</span><b>${model.stage.label}</b></div></div><div class="death-cause"><small>DEFEATED BY</small><b>${damageLabel(model.health.deathCause?.cause)}</b></div><button id="retry" class="primary-button">もう一度潜る <span>↻</span></button><button id="share" class="secondary-button">結果をシェア ↗</button><button id="home" class="text-button">タイトルへ</button></div>`);
  $('retry').onclick = () => start(); $('home').onclick = showTitle;
  $('share').onclick = async () => {
    const text = `${depth}mまで潜った！\n\nKILLS：${model.kills}\nMAX COMBO：${model.maxCombo}\n\n#DEEPDROP`;
    const url = location.href.split('?')[0];
    if (navigator.share) { try { await navigator.share({ title: 'DEEP DROP', text, url }); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) $('share').textContent = '共有できませんでした。再試行 ↗'; } }
    else window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
  };
}
function updateHud(model: GameModel) {
  physicsPanel?.updateTelemetry();
  const key = [Math.floor(model.sectionDepth), Math.floor(model.totalDepth), model.state, model.stage.label, model.coins.walletCoins, model.coins.scoreCoins, !!model.exit, model.oxygen.enabled ? model.oxygen.remaining.toFixed(1) : '-', model.heat.enabled ? model.heat.value.toFixed(1) : '-', model.boss.enabled ? `${Math.ceil(model.boss.ratio * 100)}|${model.boss.phaseId}` : '-', model.hp, model.health.overflowHealing, model.stats.maxHp, model.ammo, model.stats.maxAmmo, model.gun.id, model.combo, model.multiplier, model.practice, Math.round(model.coinHigh.meter), model.coinHigh.active].join('|');
  if (key === lastHud) return; lastHud = key;
  // The FINAL BOSS banks no section metres, so showing sectionDepth there reads a flat 000m.
  // The run's completed total is the meaningful number, and the fight never adds to it. Keyed on
  // the stage rather than the state, so the read-out stays right after the king falls too --
  // state becomes 'clear' while the run is still, and always will be, at the FINAL BOSS.
  const shownDepth = model.stage.boss ? model.totalDepth : model.sectionDepth;
  $('depth').textContent = String(Math.floor(shownDepth)).padStart(3, '0');
  $('stage-label').textContent = model.stage.label;
  $('stage-label').hidden = model.practice;
  $('depth-goal').textContent = model.stage.boss ? 'm TOTAL' : model.practice ? 'm' : `/ ${model.sectionLength}m`;
  $('hearts').innerHTML = model.stats.maxHp > 8 ? `♥ ${model.hp} / ${model.stats.maxHp}` : Array.from({ length: model.stats.maxHp }, (_, i) => `<span class="${i < model.hp ? '' : 'lost'}">♥</span>`).join(' ');
  $('life-gauge').textContent = `LIFE UP ${model.health.overflowHealing}/${HEALTH_RULES.overflowPerLife}`;
  $('hearts').setAttribute('aria-label', `HP ${model.hp} / ${model.stats.maxHp}`);
  $('ammo').innerHTML = Array.from({ length: model.stats.maxAmmo }, (_, i) => `<i class="${i < model.ammo ? 'loaded' : ''}"></i>`).join('');
  $('ammo-label').textContent = model.ammo ? 'AMMO' : 'EMPTY / 着地で補充';
  $('ammo').setAttribute('aria-label', `残弾 ${model.ammo} / ${model.stats.maxAmmo}`);
  $('coin-wallet').textContent = `COIN ${model.coins.walletCoins}`;
  $('coin-score').textContent = `SCORE ${model.coins.scoreCoins}`;
  $('coin-wallet').setAttribute('aria-label', `所持コイン ${model.coins.walletCoins}、獲得スコア ${model.coins.scoreCoins}`);
  // COIN HIGH. The meter is always on show so the player can see a HIGH coming; the word only
  // appears once it is actually running, and the bar changes colour with it rather than instead
  // of it, so the state never depends on colour alone.
  const high = $('coin-high');
  $('coin-high-fill').style.width = `${Math.round(Math.min(1, model.coinHigh.ratio) * 100)}%`;
  high.dataset.state = model.coinHigh.active ? 'active' : 'idle';
  $('coin-high-state').textContent = model.coinHigh.active ? 'COIN HIGH' : `${Math.floor(model.coinHigh.meter)}/${model.coinHigh.rules.threshold}`;
  high.setAttribute('aria-label', model.coinHigh.active ? 'COIN HIGH 発動中：射程と威力が上昇' : `COIN HIGH メーター ${Math.floor(model.coinHigh.meter)} / ${model.coinHigh.rules.threshold}`);
  $('gun-module').textContent = model.gun.short;
  $('gun-module').setAttribute('aria-label', `装備中 ${model.gun.name}（1射 ${model.gun.ammoCost}発）`);
  const oxygen = $('oxygen');
  oxygen.hidden = !model.oxygen.enabled;
  if (model.oxygen.enabled) {
    const warning = model.oxygen.warning;
    $('oxygen-fill').style.width = `${Math.round(model.oxygen.ratio * 100)}%`;
    $('oxygen-seconds').textContent = `${model.oxygen.remaining.toFixed(1)}s`;
    // Never colour alone: the state word and the blink carry the same warning.
    // No shelter exists any more, so the read-out is purely how much air is left.
    $('oxygen-state').textContent = warning === 'critical' ? '!! NO AIR' : warning === 'low' ? '! LOW' : '';
    oxygen.dataset.state = warning;
    oxygen.setAttribute('aria-label', `酸素 ${model.oxygen.remaining.toFixed(1)}秒 / ${model.oxygen.max}秒`);
  }
  const bossBar = $('boss-bar');
  bossBar.hidden = !model.boss.enabled;
  if (model.boss.enabled) {
    $('boss-fill').style.width = `${Math.max(0, model.boss.ratio) * 100}%`;
    $('boss-percent').textContent = `${Math.ceil(model.boss.ratio * 100)}%`;
    $('boss-phase').textContent = `PHASE ${model.boss.phaseId}`;
    bossBar.dataset.state = model.boss.defeated ? 'down' : model.boss.rageActive ? 'climax' : 'fight';
    bossBar.setAttribute('aria-label', `NIMUSHI HP ${Math.ceil(model.boss.ratio * 100)}%`);
  }
  // NIMUSHI's own voice. Screen-space, dismissable, and never in the way of the controls.
  const line = $('boss-line');
  line.hidden = !model.bossLine;
  if (model.bossLine) line.textContent = model.bossLine.text;
  const heat = $('heat');
  heat.hidden = !model.heat.enabled;
  if (model.heat.enabled) {
    const stage = model.heat.stage;
    $('heat-fill').style.width = `${Math.round(model.heat.ratio * 100)}%`;
    $('heat-percent').textContent = `${Math.round(model.heat.value)}%`;
    // Never colour alone: the stage word says the same thing as the bar.
    $('heat-state').textContent = stage === 'overheat' ? '!! OVERHEAT' : stage === 'hot' ? '! HOT' : stage === 'warm' ? 'WARM' : '';
    heat.dataset.state = stage;
    heat.setAttribute('aria-label', `熱 ${Math.round(model.heat.value)}% / 100%`);
  }
  $('combo').hidden = model.combo < 2;
  $('combo').innerHTML = `<b>${model.combo}</b> COMBO <span>×${model.multiplier.toFixed(1)}</span>`;
  $('combo').dataset.tier = String(comboFeedback(model.combo).tier);
  $('progress').style.width = `${model.practice ? 0 : Math.min(100, model.sectionDepth / model.sectionLength * 100)}%`;
  $('zone').textContent = model.practice ? 'CONTROL LAB' : model.stage.boss ? 'FINAL · NIMUSHI' : `AREA ${model.stage.progress.area} · ${model.stage.areaName}`;
}

$('pause').onclick = pause;
$('sound').onclick = () => { audio.unlock(); audio.muted = !audio.muted; $('sound').textContent = audio.muted ? '♪̸' : '♪'; $('sound').setAttribute('aria-label', audio.muted ? 'サウンドをオンにする' : 'サウンドをオフにする'); $('sound').setAttribute('aria-pressed', String(audio.muted)); };
window.addEventListener('keydown', e => { if (inPlay() && ['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (e.code === 'Escape') { e.preventDefault(); if (inPlay()) pause(); else if (mode === 'paused') resume(); } });
/**
 * The menu keys. One install for every overlay, because every overlay is a list of real buttons --
 * see src/ui/menuKeys.ts for why there is no selection state here and no second code path.
 *
 * ESCAPE means "leave" where leaving is a thing this screen offers: the SHOP has a way out, and a
 * paused run is already handled above. A REST POINT has none -- the choice has to be made -- so
 * ESCAPE does nothing there rather than something arbitrary.
 */
installMenuKeys({
  root: () => $('overlay'),
  isOpen: menuOpen,
  cancel: () => {
    if (mode !== 'shop') return false;
    closeShop(scene.model);
    return true;
  },
});
window.addEventListener('blur', () => { if (inPlay()) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && inPlay()) pause(); });

/**
 * TOUCH CONTROLS: three explicit buttons, and nothing else on screen that moves or shoots.
 *
 * WHY NOT TOUCH ZONES. The playfield used to be its own controller: a touch anywhere set the
 * direction from which half of the screen it landed in and fired at the same time, and dragging
 * re-aimed it. Played on a real phone that is unusable for this game -- moving and shooting are the
 * same gesture, so you cannot fire without drifting, you cannot adjust position without firing, and
 * a thumb resting on the glass to aim is already steering. AREA 1 asks for exactly the things that
 * breaks: steering while firing, nudging a landing mid-fall, and flicking left-right.
 *
 * WHY EACH POINTER IS ITS OWN ENTRY. A phone gives one pointerId per finger, and the left thumb's
 * `pointerup` must never clear what the right thumb is holding. So held state is keyed by pointerId
 * and the bridge is recomputed from all of them, rather than being set directly by whichever event
 * fired last. `pointercancel` -- which a phone raises on its own when a call arrives or the browser
 * takes the gesture -- releases through the same path, so it can never leave a direction stuck on.
 */
const movementPointers = new Map<number, number>();
const firePointers = new Set<number>();
/**
 * BOTH HELD CANCELS OUT, which is what the keyboard already does: GameScene sums `right ? 1 : 0`
 * and `left ? -1 : 0`, so A+D is a standstill. Touch sums the same way rather than inventing a
 * last-press-wins rule -- one semantics, whichever hand is playing.
 */
function syncPointers() {
  bridge.direction = Math.sign([...movementPointers.values()].reduce((sum, value) => sum + value, 0)); bridge.firing = firePointers.size > 0;
  // PRESSED is drawn from this held state, never from CSS :active. A touch browser keeps :active (and
  // sticky :hover) on a button that was hidden mid-press -- an AREA change, a REST, a shop -- so the
  // button stayed lit after the overlay went. Held state is what the run reads; the look follows it.
  const held = [...movementPointers.values()];
  $('left-control').classList.toggle('pressed', held.includes(-1));
  $('right-control').classList.toggle('pressed', held.includes(1));
  $('fire-control').classList.toggle('pressed', firePointers.size > 0);
}
/** A touch belongs to the run only once the run has the input, exactly as a key press does. */
const touchAccepted = () => inPlay() && performance.now() >= bridge.suppressUntil;
/**
 * Capture is an optimisation, not a requirement: it keeps a finger reporting to the control it
 * started on even when it strays. Browsers refuse it for a pointer they no longer consider active,
 * and a throw there would abandon the press half-registered -- leaving a direction held with no
 * pointer to release it. Held state is keyed by pointerId either way, so failing to capture costs
 * nothing that matters.
 */
function capture(element: Element, pointerId: number) {
  try { element.setPointerCapture(pointerId); } catch { /* the press still registers */ }
}

/**
 * The MOVE PAD owns both direction buttons, and the pointer is captured by the PAD rather than by
 * either button. That is what makes a flick work: a thumb resting between LEFT and RIGHT slides
 * from one to the other and the direction changes under it, with no lift and no gap. Captured by a
 * button instead, the slide would keep reporting the button it started on.
 *
 * Sliding into the gap between them keeps the last direction rather than dropping to neutral: the
 * gap is a rendering detail, and a dead strip in the middle of the one control that needs to be
 * fast would be felt as the input sticking.
 */
const movePad = $('move-pad');
const directionAt = (x: number, y: number): number | null => {
  for (const [id, value] of [['left-control', -1], ['right-control', 1]] as const) {
    const r = $(id).getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top - 24 && y <= r.bottom + 24) return value;
  }
  return null;
};
movePad.addEventListener('pointerdown', e => {
  if (!touchAccepted()) return;
  const direction = directionAt(e.clientX, e.clientY);
  if (direction === null) return;
  e.preventDefault(); audio.unlock();
  capture(movePad, e.pointerId);
  movementPointers.set(e.pointerId, direction);
  syncPointers();
});
movePad.addEventListener('pointermove', e => {
  if (!movementPointers.has(e.pointerId)) return;
  const direction = directionAt(e.clientX, e.clientY);
  if (direction !== null) { movementPointers.set(e.pointerId, direction); syncPointers(); }
});
const releaseMove = (e: PointerEvent) => { if (movementPointers.delete(e.pointerId)) syncPointers(); };
movePad.addEventListener('pointerup', releaseMove);
movePad.addEventListener('pointercancel', releaseMove);
movePad.addEventListener('lostpointercapture', releaseMove);

/** FIRE takes the same path SPACE does: a shot on the press, and held fire while it is down. */
const fireButton = $('fire-control');
fireButton.addEventListener('pointerdown', e => {
  if (!touchAccepted()) return;
  e.preventDefault(); audio.unlock();
  capture(fireButton, e.pointerId);
  firePointers.add(e.pointerId);
  syncPointers();
  scene.requestShot();
});
const releaseFire = (e: PointerEvent) => { if (firePointers.delete(e.pointerId)) syncPointers(); };
fireButton.addEventListener('pointerup', releaseFire);
fireButton.addEventListener('pointercancel', releaseFire);
fireButton.addEventListener('lostpointercapture', releaseFire);

/**
 * The playfield itself is no longer a control on touch. A MOUSE click still fires, because that is
 * how the desktop build has always worked and nothing about a mouse was the problem.
 */
const frame = $('game-frame');
frame.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || !inPlay() || (e.target as HTMLElement).closest('button')) return;
  e.preventDefault(); audio.unlock();
  scene.requestShot();
});
showTitle(); updateHud(scene.model);
window.addEventListener('pagehide', () => { game.loop.sleep(); });
window.addEventListener('pageshow', () => { game.loop.wake(); });

// The separate /tests/browser.html entry imports these for browser regression checks.
// No test controls or fixtures are included by the production entry point.
export { scene, bridge, start, pause };

/**
 * BOSS PARITY PASS, Human Review: `?approach=now|half|one` sets how far off NIMUSHI is found, so the
 * three candidates can be compared on the published build. Absent, the chosen default holds.
 */
{
  const choice = new URLSearchParams(location.search).get('approach');
  if (choice !== null && choice in BOSS_APPROACH.options) approachExtra.views = BOSS_APPROACH.options[choice];
}
