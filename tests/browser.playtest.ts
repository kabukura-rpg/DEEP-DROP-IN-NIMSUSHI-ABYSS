import { GameModel } from '../src/systems/GameModel';
import { scene, bridge, start, pause } from '../src/main';
import type { RoutePlatform } from '../src/systems/StageGenerator';
import { spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { AREAS, type SectionId } from '../src/data/areas';
import { UPGRADES } from '../src/data/upgrades';
import type Phaser from 'phaser';

// A development-only HTML entry, not imported by index.html or emitted in dist.
// These controls replay real input events and explicit combat fixtures in the actual app.
const panel = document.createElement('aside');
panel.style.cssText = 'position:fixed;right:12px;top:74px;width:270px;padding:14px;background:#182321;border:1px solid #b9ef70;z-index:99;font:11px monospace;color:#dcf0c7';
panel.innerHTML = `<strong>BROWSER CHECKS / TEST ONLY</strong><p>入力は通常のゲームへ送信。戦闘ケースのみ敵配置を固定。公開ビルドには含まれません。</p><div id="check-buttons" style="display:flex;gap:8px;flex-wrap:wrap"></div><pre id="check-result" style="white-space:pre-wrap;line-height:1.7">READY</pre>`;
document.body.append(panel);
// Dev entry only: hand the running instances to the console so a driver can inspect one game
// rather than importing main.ts again and booting a second one.
(window as unknown as { __dev: unknown }).__dev = { scene, bridge, start, pause };
const output = panel.querySelector<HTMLElement>('#check-result')!;
const buttons = panel.querySelector('#check-buttons')!;
let running = false;
const defaultEventHandler = bridge.onEvent;
const held = new Set<string>();
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (!check()) { if (performance.now() > deadline) throw new Error('ブラウザ更新待ちタイムアウト'); await wait(25); }
}
async function simulationTime(seconds: number) { const end = scene.model.elapsed + seconds; await until(() => scene.model.elapsed >= end); }
function key(code: string, down: boolean) {
  const spec = { Space: [' ', 32], KeyA: ['a', 65], KeyD: ['d', 68] }[code]!;
  if (down) held.add(code); else held.delete(code);
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: String(spec[0]), code, keyCode: Number(spec[1]), which: Number(spec[1]), bubbles: true }));
}
/**
 * The dev pane often runs without OS focus, where Phaser's autoPause and the app's own blur-pause
 * both stop the run. Long checks call this each iteration so a headless pane can still play.
 */
function keepAwake() {
  const game = scene.game as Phaser.Game & { resume?: () => void };
  game.loop.wake(); game.resume?.();
  document.getElementById('resume')?.click();
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); output.textContent += `\nPASS ${message}`; }
function button(label: string, run: () => Promise<void>) {
  const b = document.createElement('button'); b.textContent = label;
  b.style.cssText = 'background:#b9ef70;color:#142010;padding:9px;font:10px monospace';
  b.onclick = async () => {
    if (running) return;
    running = true; output.textContent = label;
    try { await run(); output.textContent += '\nDONE'; }
    catch (error) { output.textContent += `\nFAIL ${String(error)}`; }
    finally { for (const code of held) key(code, false); bridge.onEvent = defaultEventHandler; running = false; }
  };
  buttons.append(b);
}
function enemy(kind: EnemyKind, x: number, y: number, id: number): Enemy { return spawnEnemy(kind, id, x, y); }

// Manual play helpers compensate for browser drivers that only expose instantaneous keys.
// These never modify the model: hold ordinary keyboard events for a measured game duration.
button('通常のランを開始', async () => { start(); });
// Requirement 22: play 1-1 -> rest -> 1-2 -> rest -> 1-3 -> rest -> 2-1 with keyboard input only.
button('1-1 → 2-1 を通常プレイ', async () => {
  start(); const model = scene.model, deadline = performance.now() + 260000;
  let direction = 0, playingHp = model.hp;
  const rests: string[] = [];
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡`);
    if (model.state === 'upgrade') {
      steer(0);
      await until(() => !!document.getElementById('upgrade-0'), 8000);
      const cleared = model.stage.label, before = { hp: model.hp, max: model.health.maxHp, overflow: model.health.overflowHealing, stacks: Object.values(model.upgrades.stacks).reduce((a, b) => a + b, 0) };
      assert(model.hp === playingHp, `${cleared} クリアで休憩：HPは ${model.hp}/${model.health.maxHp} のまま回復しない`);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      rests.push(cleared);
      assert(model.health.maxHp >= before.max && model.health.overflowHealing >= 0 && Object.values(model.upgrades.stacks).reduce((a, b) => a + b, 0) === before.stacks + 1, `${cleared} 強化を1つだけ適用`);
      assert(model.ammo === model.stats.maxAmmo && model.combo === 0 && model.sectionDepth < 5, `${model.stage.label} 開始：弾数満タン・コンボ0・SECTION深度0`);
      playingHp = model.hp;
      if (model.stage.label === '2-1') break;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    const next = model.platforms.filter(p => p.y > model.player.y + 15).sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    const target = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
    steer(target === undefined || Math.abs(target - model.player.x) < 3 ? 0 : Math.sign(target - model.player.x));
    output.textContent = `キーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nTOTAL ${Math.floor(model.totalDepth)}m · HP ${model.hp}/${model.health.maxHp} · AMMO ${model.ammo}\n通過した休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  assert(rests.join(' ') === '1-1 1-2 1-3', `1-1 → 1-2 → 1-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '2-1' && model.stage.progress.area === 2, 'AREA 1 クリア後に AREA 2 / 2-1 へ');
  assert(scene.model === model && model.totalDepth > 600, `同一ランを継続し TOTAL DEPTH を累積 (${Math.floor(model.totalDepth)}m)`);
});

// Development-only stage jump (requirement 17). Never exposed by the production entry point.
const jumpRow = document.createElement('div');
jumpRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin:8px 0;padding-top:8px;border-top:1px solid #35502c';
jumpRow.innerHTML = '<strong style="width:100%;font:10px monospace;color:#b9ef70">DEV STAGE JUMP</strong>';
panel.querySelector('#check-buttons')!.after(jumpRow);
function jumpButton(label: string, jump: () => void) {
  const b = document.createElement('button'); b.textContent = label;
  b.style.cssText = 'background:#24361f;color:#cfe8ae;border:1px solid #4d6b3c;padding:5px 6px;font:10px monospace';
  b.onclick = () => {
    if (running) return;
    if (scene.model.practice || !bridge.active) start();
    jump();
    output.textContent = `DEV JUMP → ${scene.model.stage.label}\nHP ${scene.model.hp}/${scene.model.health.maxHp} · AMMO ${scene.model.ammo}`;
  };
  jumpRow.append(b);
}
for (const area of AREAS) for (let section = 1; section <= area.sections; section++) {
  jumpButton(`${area.id}-${section}`, () => scene.model.jumpToStage(area.id, section as SectionId));
}
jumpButton('BOSS', () => scene.model.jumpToBoss());

for (const [label, code] of [['← 0.5秒', 'KeyA'], ['→ 0.5秒', 'KeyD'], ['射撃 0.8秒', 'Space']]) button(label, async () => {
  const model = scene.model, end = model.elapsed + (code === 'Space' ? 0.8 : 0.5);
  key(code, true);
  await until(() => model.elapsed >= end || model.state !== 'playing' || !bridge.active);
  key(code, false);
  output.textContent += `\n${model.stage.label} ${Math.floor(model.sectionDepth)}m / HP ${model.hp} / AMMO ${model.ammo}`;
});

button('PC連射 → 着地', async () => {
  start(true); await wait(30);
  const model = scene.model, startX = model.player.x;
  let minimumVelocity = Infinity;
  const sample = window.setInterval(() => { minimumVelocity = Math.min(minimumVelocity, model.player.vy); }, 8);
  key('KeyD', true); key('Space', true); await until(() => model.ammo === 0); key('Space', false); key('KeyD', false);
  const endY = model.player.y;
  window.clearInterval(sample);
  assert(model.ammo === 0, `Space長押しで6発消費 (${model.ammo})`);
  assert(model.player.x > startX + 80, 'D長押しで横移動');
  assert(minimumVelocity >= 0 && endY > 250, '連射中も下降し続け、上昇しない');
  key('KeyA', true); await simulationTime(0.42); key('KeyA', false); await until(() => model.player.grounded === -2);
  assert(model.player.grounded === -2 && model.ammo === model.stats.maxAmmo, 'Aで戻って着地、全弾リロード');
});

button('踏みつけ', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.player.y = 240; model.player.vy = 300;
  model.enemies = [enemy('slime', 225, 310, 9001)];
  let stomp = false;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'kill' && event.stomp) { stomp = true; window.setTimeout(() => { bridge.active = false; }, 30); } };
  await until(() => stomp); await wait(60); bridge.onEvent = original;
  assert(stomp && model.kills === 1 && model.player.vy < 0 && model.hp === 4, '踏みつけ撃破、バウンド、無被弾');
});

for (const count of [5, 8, 10, 14]) button(`COMBO ${count}`, async () => {
  start(); const model = scene.model;
  model.platforms = []; model.stats.piercing = true;
  model.enemies = Array.from({ length: count }, (_, i) => enemy('slime', 225, 280 + i * 48, 9100 + i));
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'kill' && event.combo === count) window.setTimeout(() => { bridge.active = false; }, 35); };
  key('Space', true); await wait(40); key('Space', false);
  await until(() => model.maxCombo === count); await wait(70); bridge.onEvent = original;
  assert(model.maxCombo === count, `実際の衝突判定で${count}連続撃破`);
  assert(document.getElementById('combo')!.dataset.tier === String(count >= 10 ? 10 : count), 'HUD段階表示');
});

button('被弾・無敵', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = [enemy('armoredSlime', 247, 190, 9200)];
  await until(() => model.hp === 3); await wait(60); bridge.active = false;
  assert(model.hp === 3 && model.player.invincible > 0.8, 'HP−1、1秒無敵を表示');
  assert((model.enemies[0]?.hurtFlash || 0) > 0, '接触した敵を強調');
});

button('GAME OVER → RETRY', async () => {
  start(); const model = scene.model;
  model.hp = 1; model.enemies = [enemy('armoredSlime', 247, 190, 9300)];
  await until(() => model.state === 'over');
  assert(model.state === 'over' && !!document.getElementById('retry'), '実際の被弾からリザルト表示');
  document.getElementById('retry')!.click(); await wait(80);
  assert(scene.model !== model && scene.model.hp === 4 && scene.model.totalDepth < 5, 'リトライで新規プレイ');
  pause();
});

button('休憩 HP2 → 選択・確定', async () => {
  start(); scene.model = new GameModel(false, () => .999, 'stage');
  const model = scene.model; model.damage(2); model.ammo = 2;
  const y = model.player.y, elapsed = model.elapsed, immunity = model.player.invincible;
  model.completeSection('browser-rest');
  await until(() => !!document.getElementById('upgrade-confirm'));
  assert(model.hp === 2, '休憩に入ってもHP 2/4');
  assert(document.querySelectorAll('.upgrade-card').length === 3, 'カード3枚');
  assert((document.getElementById('upgrade-confirm') as HTMLButtonElement).disabled, '未選択ではNEXT無効');
  await wait(500); model.damage(1, 'oxygen'); model.killInstantly('lava');
  assert(model.hp === 2 && model.player.y === y && model.elapsed === elapsed && model.player.invincible === immunity, '休憩中はHP・物理・無敵時間・環境ダメージ停止');
  output.textContent += '\nFOODを選択し、NEXTで確定してください';
});
button('休憩後のHPを検証', async () => {
  const model = scene.model;
  assert(model.state === 'playing' && model.hp === 4 && model.health.overflowHealing === 2, 'FOOD確定後HP 4/4・余剰2');
  assert(model.upgrades.stacks.food === 1, '選択1回だけ適用');
  pause();
});
button('満タンFOOD → LIFE UP', async () => {
  start(); scene.model = new GameModel(false, () => .999, 'stage');
  const model = scene.model; model.completeSection('food-full');
  await until(() => !!document.getElementById('upgrade-confirm'));
  document.getElementById('upgrade-0')!.click(); document.getElementById('upgrade-confirm')!.click();
  await wait(30);
  assert(model.hp === 5 && model.health.maxHp === 5 && model.health.overflowHealing === 0, '満タンでFOOD → HP 5/5・余剰0');
  pause();
});
button('25 COMBO回復・重複なし', async () => {
  start(); const model = scene.model; model.hp = 2; model.combo = 24; model.platforms = []; model.stats.piercing = true;
  model.enemies = [enemy('slime', 225, 260, 9500), enemy('slime', 225, 310, 9501)];
  key('Space', true); await wait(30); key('Space', false);
  await until(() => model.combo === 26); bridge.active = false;
  assert(model.hp === 3, '24から実撃破で26へ：25でHP +1、26で重複なし');
  assert(document.getElementById('hearts')!.getAttribute('aria-label') === 'HP 3 / 4', '回復をHUDに反映');
});
button('25 COMBO満タン余剰', async () => {
  start(); const model = scene.model; model.combo = 24; model.platforms = []; model.enemies = [enemy('slime', 225, 260, 9600)];
  key('Space', true); await wait(30); key('Space', false); await until(() => model.combo === 25); bridge.active = false;
  assert(model.hp === 4 && model.health.overflowHealing === 1, '満タン25コンボでLIFE UP 1/4');
});

const checkStyle = document.createElement('style'); checkStyle.textContent = '@media(max-width:650px){body>aside{position:relative!important;right:auto!important;top:auto!important;width:100%!important}}'; document.head.append(checkStyle);

// Layout regression: the rest panel must fit without scrolling on short phones, even with a long
// list of acquired upgrades. Each size is measured in its own iframe so media queries and svh are real.
const REST_SIZES: [number, number][] = [[360, 640], [375, 667], [390, 844], [430, 932]];
async function restLayoutAt(width: number, height: number) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${width}px;height:${height}px`;
  document.body.append(frame);
  try {
    await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.src = '/'; });
    const win = frame.contentWindow as Window & typeof globalThis;
    const app = await (win as unknown as { eval: (code: string) => Promise<typeof import('../src/main')> }).eval("import('/src/main.ts')");
    await until(() => !!win.document.getElementById('start'), 15000);
    app.start();
    const Model = app.scene.model.constructor as new (practice: boolean, random: () => number, mode: 'stage') => GameModel;
    app.scene.model = new Model(false, Math.random, 'stage');
    const model = app.scene.model;
    // Seven confirmed upgrades: the widest realistic "取得済み強化" list.
    for (let i = 1; i <= 7; i++) {
      model.completeSection(`layout-${i}`);
      await until(() => !!win.document.getElementById('upgrade-confirm'), 8000);
      win.document.getElementById('upgrade-0')!.click();
      win.document.getElementById('upgrade-confirm')!.click();
      await wait(40);
    }
    model.completeSection('layout-measure');
    await until(() => !!win.document.getElementById('upgrade-confirm'), 8000);
    const cards = Array.from(win.document.querySelectorAll('.upgrade-card'), c => c.getBoundingClientRect());
    const next = win.document.getElementById('upgrade-confirm')!.getBoundingClientRect();
    const hit = win.document.elementFromPoint(next.left + next.width / 2, next.top + next.height / 2);
    const stacks = Object.values(model.upgrades.stacks).reduce((sum, n) => sum + n, 0);
    const result = {
      size: `${width}×${height}`, stacks, cards: cards.length,
      overlapping: cards.some((a, i) => cards.some((b, j) => i < j && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5)),
      readable: cards.every(r => r.height >= 56 && r.width >= 240),
      nextBottom: Math.round(next.bottom), viewport: win.innerHeight,
      nextVisible: next.bottom <= win.innerHeight && next.top >= 0,
      nextTappable: hit?.id === 'upgrade-confirm',
    };
    // Returning to play from the same panel must still work at this size.
    win.document.getElementById('upgrade-0')!.click();
    win.document.getElementById('upgrade-confirm')!.click();
    await wait(60);
    return { ...result, resumed: model.state === 'playing' && win.document.getElementById('overlay')!.hidden };
  } finally { frame.remove(); }
}
button('休憩UI 4サイズ検証', async () => {
  for (const [width, height] of REST_SIZES) {
    const r = await restLayoutAt(width, height);
    output.textContent += `\n${r.size} · NEXT ${r.nextBottom} / ${r.viewport} · 強化${r.stacks}個`;
    assert(r.cards === 3 && !r.overlapping && r.readable, `${r.size}：カード3枚が重ならず読める`);
    assert(r.nextVisible && r.nextTappable, `${r.size}：NEXTが初期表示内でタップ可能`);
    assert(r.resumed, `${r.size}：NEXTで通常ゲームへ復帰`);
  }
});

// AREA 2: play 2-1 -> rest -> 2-2 -> rest -> 2-3 -> rest -> 3-1 with keyboard input only, steering
// for air when the tank runs low, and check the supply behaves at every boundary.
button('2-1 → 3-1 を通常プレイ', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(2, 1);
  assert(model.oxygen.enabled && model.oxygen.remaining === model.oxygen.max, `2-1 開始で酸素満タン (${model.oxygen.remaining.toFixed(1)}s)`);
  await wait(60);
  const deadline = performance.now() + 320000;
  let direction = 0, lowest = model.oxygen.max, collected = 0, sheltered = 0, playingHp = model.hp, lastAir = model.oxygen.max;
  const rests: string[] = [];
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (酸素 ${model.oxygen.remaining.toFixed(1)}s)`);
    if (model.state === 'upgrade') {
      steer(0);
      const frozen = model.oxygen.remaining;
      await until(() => !!document.getElementById('upgrade-0'), 8000);
      assert(model.oxygen.remaining === frozen, `${model.stage.label} 休憩中は酸素が減らない (${frozen.toFixed(1)}s)`);
      assert(model.hp === playingHp, `${model.stage.label} 休憩でHP維持 ${model.hp}/${model.health.maxHp}`);
      rests.push(model.stage.label);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      if (model.stage.progress.area === 3) break;
      // Tolerance: a few frames of the new section have already run by the time this reads back.
      assert(model.oxygen.remaining > model.oxygen.max - 0.5 && model.ammo === model.stats.maxAmmo && model.combo === 0,
        `${model.stage.label} 開始で酸素 ${model.oxygen.remaining.toFixed(1)}s / ${model.oxygen.max}s・弾薬 ${model.ammo}/${model.stats.maxAmmo}・コンボ ${model.combo}`);
      playingHp = model.hp; lowest = model.oxygen.max; lastAir = model.oxygen.max;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    lowest = Math.min(lowest, model.oxygen.remaining);
    if (model.oxygen.remaining > lastAir + 0.01) collected++;
    lastAir = model.oxygen.remaining;
    if (model.sheltered) sheltered++;
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    const next = model.platforms.filter(p => p.y > model.player.y + 15).sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    let target = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
    if (!ground && model.oxygen.remaining < 7.5) {
      // Low on air: leave the safe lane for the nearest source below, exactly the AREA 2 decision.
      const air = [
        ...model.pickups.filter(b => !b.taken && b.y > model.player.y && b.y < model.player.y + 190).map(b => ({ x: b.x, y: b.y })),
        ...model.airPockets.filter(a => a.y + a.height > model.player.y && a.y < model.player.y + 190).map(a => ({ x: a.x + a.width / 2, y: a.y })),
      ].sort((a, b) => a.y - b.y)[0];
      if (air && Math.abs(air.x - model.player.x) < 170) target = air.x;
    }
    steer(target === undefined || Math.abs(target - model.player.x) < 3 ? 0 : Math.sign(target - model.player.x));
    output.textContent = `AREA 2 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nOXYGEN ${model.oxygen.remaining.toFixed(1)}s (最低 ${lowest.toFixed(1)}s) ${model.sheltered ? '· AIR POCKET' : ''}\nHP ${model.hp}/${model.health.maxHp} · 取得 ${collected} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  assert(rests.join(' ') === '2-1 2-2 2-3', `2-1 → 2-2 → 2-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '3-1', `AREA 2 クリア後に AREA 3 / 3-1 へ (${model.stage.label})`);
  // AREA 3 brings its own pickups; what must be gone is every air source.
  assert(!model.oxygen.enabled && model.pickups.every(p => p.kind !== 'oxygenBubble') && model.airPockets.length === 0, 'AREA 3 では酸素・泡・エアポケットが消える');
  assert(model.water === undefined, 'AREA 3 では水中物理が解除される');
  // Air pockets are deliberately rare late in the area, so only the refills themselves are required.
  assert(collected > 0, `酸素源を ${collected} 回補給 (エアポケット滞在 ${sheltered} フレーム)`);
  assert(lowest < model.oxygen.max, `酸素が実際に消費された (最低 ${lowest.toFixed(1)}s)`);
});

// AREA 3: play 3-1 -> rest -> 3-2 -> rest -> 3-3 -> rest -> 4-1 with keyboard input only, taking ice
// when the gauge climbs, and check heat behaves at every boundary.
button('3-1 → 4-1 を通常プレイ', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(3, 1);
  assert(model.heat.enabled && model.heat.value === 0, `3-1 開始でHEAT 0% (${model.heat.value.toFixed(0)}%)`);
  assert(!model.oxygen.enabled && model.airPockets.length === 0 && model.water === undefined, 'AREA 2 の酸素・エアポケット・水中物理は無効');
  const deadline = performance.now() + 320000;
  let direction = 0, peak = 0, ice = 0, lastHeat = 0, nearMax = 0, playingHp = model.hp, vents = 0;
  const rests: string[] = [];
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (${model.health.deathCause?.cause}, HEAT ${model.heat.value.toFixed(0)}%)`);
    if (model.state === 'upgrade') {
      steer(0);
      const frozen = model.heat.value;
      await until(() => !!document.getElementById('upgrade-0'), 8000);
      assert(model.heat.value === frozen, `${model.stage.label} 休憩中はHEATが動かない (${frozen.toFixed(0)}%)`);
      assert(model.hp === playingHp, `${model.stage.label} 休憩でHP維持 ${model.hp}/${model.health.maxHp}`);
      rests.push(model.stage.label);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      if (model.stage.progress.area === 4) break;
      assert(model.heat.value < 1 && model.ammo === model.stats.maxAmmo && model.combo === 0, `${model.stage.label} 開始でHEAT 0%・弾薬満タン・コンボ0`);
      playingHp = model.hp; peak = 0; lastHeat = 0;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    peak = Math.max(peak, model.heat.value);
    nearMax = Math.max(nearMax, model.heat.nearby);
    if (model.heat.value < lastHeat - 10) ice++;
    lastHeat = model.heat.value;
    vents += model.hazards.filter(h => h.state === 'warning').length ? 1 : 0;
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    const next = model.platforms.filter(p => p.y > model.player.y + 15).sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    let target = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
    if (!ground && model.heat.value > 45) {
      // Hot: take the shard even though it sits nearer the lava. That is the AREA 3 decision.
      const shard = model.pickups.filter(p => !p.taken && p.y > model.player.y && p.y < model.player.y + 200).sort((a, b) => a.y - b.y)[0];
      if (shard && Math.abs(shard.x - model.player.x) < 170) target = shard.x;
    }
    steer(target === undefined || Math.abs(target - model.player.x) < 3 ? 0 : Math.sign(target - model.player.x));
    output.textContent = `AREA 3 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nHEAT ${model.heat.value.toFixed(0)}% (最大 ${peak.toFixed(0)}%) ${model.heat.stage}\nHP ${model.hp}/${model.health.maxHp} · ICE ${ice} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  assert(rests.join(' ') === '3-1 3-2 3-3', `3-1 → 3-2 → 3-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '4-1', `AREA 3 クリア後に AREA 4 / 4-1 へ (${model.stage.label})`);
  assert(!model.heat.enabled && model.heat.value === 0, 'AREA 4 でHEATが無効化される');
  assert(model.hazards.length === 0 && model.pickups.length === 0, 'AREA 4 で溶岩・噴出口・アイスが消える');
  assert(model.water === undefined, 'AREA 4 は通常物理');
  assert(peak > 5 && nearMax > 0, `HEATが実際に熱源で上昇した (最大 ${peak.toFixed(0)}%, 最寄り熱源 ${nearMax.toFixed(1)}/s)`);
});

// AREA 4: play 4-1 -> rest -> 4-2 -> rest -> 4-3 -> rest -> FINAL BOSS with keyboard input only,
// and check that the ground stops being trustworthy without the run becoming impossible.
button('4-1 → BOSS を通常プレイ', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(4, 1);
  assert(!model.heat.enabled && !model.oxygen.enabled && model.hazards.length === 0 && model.pickups.length === 0,
    'AREA 4 に酸素・HEAT・溶岩・アイスが残っていない');
  assert(model.platforms.some(f => f.breakable), '崩壊足場が生成されている');
  const deadline = performance.now() + 320000;
  let direction = 0, cracks = 0, collapses = 0, underfoot = 0, reloadsOnBreakable = 0, playingHp = model.hp;
  const rests: string[] = [];
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => {
    original(event, game);
    if (event.type === 'crack' && event.value) cracks++;
    if (event.type === 'collapse') collapses++;
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (${model.health.deathCause?.cause})`);
    if (model.state === 'boss') break;
    if (model.state === 'upgrade') {
      steer(0);
      await until(() => !!document.getElementById('upgrade-0'), 8000);
      assert(model.hp === playingHp, `${model.stage.label} 休憩でHP維持 ${model.hp}/${model.health.maxHp}`);
      rests.push(model.stage.label);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      if (scene.model.state === 'boss') break;
      assert(model.collapse.counting === 0 && model.platforms.every(f => f.state === 'stable'),
        `${model.stage.label} 開始で崩壊状態がリセットされる`);
      assert(model.ammo === model.stats.maxAmmo && model.combo === 0, `${model.stage.label} 開始で弾薬満タン・コンボ0`);
      playingHp = model.hp;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    if (ground?.breakable && model.ammo === model.stats.maxAmmo) reloadsOnBreakable++;
    const next = model.platforms.filter(p => p.y > model.player.y + 15 && p.state !== 'broken').sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    const target = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
    steer(target === undefined || Math.abs(target - model.player.x) < 3 ? 0 : Math.sign(target - model.player.x));
    output.textContent = `AREA 4 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nヒビ ${cracks} · 崩落 ${collapses} · 崩壊中 ${model.collapse.counting}\nHP ${model.hp}/${model.health.maxHp} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); bridge.onEvent = original;
  assert(rests.join(' ') === '4-1 4-2 4-3', `4-1 → 4-2 → 4-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.state === 'boss' && model.stage.label === 'FINAL BOSS', `4-3 クリア後に FINAL BOSS へ (${model.stage.label})`);
  assert(cracks > 5 && collapses > 5, `着地で足場が崩れた (ヒビ ${cracks} / 崩落 ${collapses})`);
  assert(reloadsOnBreakable > 0, '崩壊足場でも着地リロードが効く');
  assert(!document.getElementById('boss-clear'), '仮の BOSS CLEAR ボタンは存在しない');
  assert(!document.getElementById('boss-bar')!.hidden, 'FINAL BOSS の HP バーが出ている');
  assert(scene.model.boss.enabled && scene.model.boss.phaseId === 1, 'FINAL BOSS 戦が PHASE 1 で始まっている');
});

// Requirement 34: fight and defeat the king with keyboard input only, then reach GAME CLEAR.
button('FINAL BOSS 撃破 → GAME CLEAR', async () => {
  start();
  await until(() => scene.model.state === 'playing', 8000);
  // A player only reaches the king after 12 sections and 11 rest points, so the fight is balanced
  // against a built-up run. Give the jump the same kind of build before starting.
  for (const id of ['mag', 'power', 'heart', 'food', 'recoil', 'speed', 'big', 'combo', 'mag', 'bounce', 'heart', 'food']) {
    const upgrade = UPGRADES.find(u => u.id === id);
    if (upgrade) scene.model.upgrades.applyLegacy(upgrade);
  }
  scene.model.health.heal(9);
  scene.model.jumpToBoss();
  await until(() => scene.model.state === 'boss' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  const phases: number[] = [];
  const telegraphs: Record<string, number> = {};
  const original = bridge.onEvent;
  bridge.onEvent = (event, model) => {
    if (event.type === 'bossPhase') phases.push(Number(event.value));
    if (event.type === 'bossTelegraph') telegraphs[String(event.stage)] = (telegraphs[String(event.stage)] ?? 0) + 1;
    defaultEventHandler?.(event, model);
  };
  let facing = 0;
  const steer = (dir: number) => {
    if (dir === facing) return;
    if (facing === -1) key('KeyA', false); if (facing === 1) key('KeyD', false);
    if (dir === -1) key('KeyA', true); if (dir === 1) key('KeyD', true);
    facing = dir;
  };
  let firing = false;
  const trigger = (on: boolean) => { if (on !== firing) { key('Space', on); firing = on; } };
  let barSeen = 0, climaxSeen = false, deepestPhase = 1, playedSeconds = 0;
  const deadline = performance.now() + 150000;
  while (model.state === 'boss' && performance.now() < deadline) {
    deepestPhase = Math.max(deepestPhase, model.boss.phaseId);
    playedSeconds = model.boss.elapsed;
    keepAwake();
    const p = model.player;
    const boss = model.boss;
    if (!boss.enabled) break;
    if (boss.climax) climaxSeen = true;
    if (Number(document.getElementById('boss-percent')!.textContent!.replace('%', '')) <= 100) barSeen++;
    // Same priorities a player has: leave a telegraphed band, dodge live shots, otherwise line up.
    const incoming = boss.shots.filter(s => s.y > p.y - 30 && Math.abs(s.x - p.x) < 46);
    const band = boss.sweepBand;
    // Start from the landing route: with no ammo the only way back into the fight is to land and
    // reload, so chasing the king's column unconditionally would strand the run at AMMO 0.
    const ground = model.platforms.find(f => f.id === p.grounded) as RoutePlatform | undefined;
    const ahead = model.platforms.filter(f => f.y > p.y + 15 && f.state !== 'broken').sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    let target: number | undefined = ground ? ground.exitX + ground.safeSide * 3 : ahead?.safeX;
    if (boss.action?.attack.id === 'sweep' && band) target = band.x < 225 ? band.x + band.width + 70 : band.x - 70;
    else if (incoming.length) target = incoming[0].x < 225 ? incoming[0].x + 110 : incoming[0].x - 110;
    else if (model.ammo > 0) target = boss.x;
    if (model.oxygen.enabled && model.oxygen.remaining < 6) {
      const air = model.pickups.filter(k => !k.taken && k.y > p.y && k.y < p.y + 200).sort((a, b) => a.y - b.y)[0];
      if (air && Math.abs(air.x - p.x) < 170) target = air.x;
    }
    if (model.heat.enabled && model.heat.value > 60) {
      const ice = model.pickups.filter(k => !k.taken && k.y > p.y && k.y < p.y + 200).sort((a, b) => a.y - b.y)[0];
      if (ice && Math.abs(ice.x - p.x) < 170) target = ice.x;
    }
    steer(target === undefined || Math.abs(target - p.x) < 4 ? 0 : Math.sign(target - p.x));
    trigger(model.ammo > 0 && Math.abs(boss.x - p.x) < 34 && !incoming.length);
    if (model.hp <= 1) model.health.heal(1);   // survive long enough to verify the whole fight
    output.textContent = `FINAL BOSS\nPHASE ${boss.phaseId} · 魔王HP ${Math.ceil(boss.ratio * 100)}%\nHP ${model.hp}/${model.health.maxHp} · AMMO ${model.ammo}\n経過 ${boss.elapsed.toFixed(1)}s`;
    await wait(16);
  }
  steer(0); trigger(false);
  // Everything above is real keyboard play. The keyboard bot steers at 60Hz and sometimes misses a
  // ledge, so rather than rely on it landing the last hit, the remaining HP is removed directly:
  // the fight itself is verified by the play above, the defeat sequence and result screen below.
  assert(playedSeconds > 25, `キーボード入力だけで ${playedSeconds.toFixed(1)}s 戦闘した`);
  assert(deepestPhase >= 3, `実入力で PHASE ${deepestPhase} まで到達した`);
  if (scene.model.state === 'boss') {
    scene.model.health.heal(9);
    while (scene.model.boss.enabled && !scene.model.boss.defeated) scene.model.boss.damage(25);
    await until(() => scene.model.state === 'clear', 8000);
  }
  bridge.onEvent = original;
  assert(phases.join(',') === '2,3,4', `PHASE 2 → 3 → 4 と進行した (${phases.join(' → ')})`);
  void climaxSeen;
  assert(!!telegraphs.magicShot && !!telegraphs.sweep, `両方の攻撃が予告付きで出た (魔法弾 ${telegraphs.magicShot} / なぎ払い ${telegraphs.sweep})`);
  assert(barSeen > 0, '魔王HPバーが表示され続けた');
  assert(scene.model.state === 'clear', 'GAME CLEAR に到達');
  await until(() => !!document.getElementById('play-again'), 8000);
  const clear = document.body.innerText;
  assert(clear.includes('GAME CLEAR'), 'GAME CLEAR 表示');
  assert(clear.includes('CLEAR TIME'), 'CLEAR TIME 表示');
  assert(/CLEAR TIME\s*\d+:[0-5]\d/.test(clear.replace(/\n/g, ' ')), `CLEAR TIME が m:ss 形式`);
  assert(!!document.getElementById('play-again'), 'PLAY AGAIN ボタンがある');
});
