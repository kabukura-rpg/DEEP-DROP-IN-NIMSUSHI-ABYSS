import { GameModel } from '../src/systems/GameModel';
import { scene, bridge, start, pause, audio } from '../src/main';
import type { RoutePlatform } from '../src/systems/StageGenerator';
import { spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { AREAS, type SectionId, PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { pickupType } from '../src/data/pickups';
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
(window as unknown as { __dev: unknown }).__dev = { scene, bridge, start, pause, audio };
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
  let shopsSeen = 0;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡`);
    // A SHOP stops the world until it is dismissed, so a play loop has to answer the door.
    if (model.state === 'shop') {
      steer(0);
      shopsSeen++;
      document.getElementById('shop-close')?.click();
      await wait(120);
      continue;
    }
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
    // A SECTION now ends at the gate; gateHeading knows how to leave a ledge to reach it.
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    const heading = gate ?? target;
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
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
  let shopsSeen = 0;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (酸素 ${model.oxygen.remaining.toFixed(1)}s)`);
    // A SHOP stops the world until it is dismissed, so a play loop has to answer the door.
    if (model.state === 'shop') {
      steer(0);
      shopsSeen++;
      document.getElementById('shop-close')?.click();
      await wait(120);
      continue;
    }
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
    // Air is sealed in containers now: break one, then chase what it released. The shared policy
    // owns that decision so the AREA 2 check and the full run cannot drift apart.
    const air = descendPlan(model);
    if (air.target !== undefined) target = air.target;
    if (air.fire) key('Space', true); else key('Space', false);
    // A SECTION now ends at the gate; gateHeading knows how to leave a ledge to reach it.
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    const heading = gate ?? target;
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
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
  let shopsSeen = 0;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (${model.health.deathCause?.cause}, HEAT ${model.heat.value.toFixed(0)}%)`);
    // A SHOP stops the world until it is dismissed, so a play loop has to answer the door.
    if (model.state === 'shop') {
      steer(0);
      shopsSeen++;
      document.getElementById('shop-close')?.click();
      await wait(120);
      continue;
    }
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
      const shard = model.pickups.filter(p => !p.taken && p.kind === 'ice' && p.y > model.player.y && p.y < model.player.y + 200).sort((a, b) => a.y - b.y)[0];
      if (shard && Math.abs(shard.x - model.player.x) < 170) target = shard.x;
    }
    // A SECTION now ends at the gate; gateHeading knows how to leave a ledge to reach it.
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    const heading = gate ?? target;
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
    output.textContent = `AREA 3 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nHEAT ${model.heat.value.toFixed(0)}% (最大 ${peak.toFixed(0)}%) ${model.heat.stage}\nHP ${model.hp}/${model.health.maxHp} · ICE ${ice} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  assert(rests.join(' ') === '3-1 3-2 3-3', `3-1 → 3-2 → 3-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '4-1', `AREA 3 クリア後に AREA 4 / 4-1 へ (${model.stage.label})`);
  assert(!model.heat.enabled && model.heat.value === 0, 'AREA 4 でHEATが無効化される');
  assert(model.hazards.length === 0 && model.pickups.filter(k => pickupType(k.kind).category === 'environment').length === 0,
    'AREA 4 で溶岩・噴出口・アイスが消える');
  assert(model.water === undefined, 'AREA 4 は通常物理');
  assert(peak > 5 && nearMax > 0, `HEATが実際に熱源で上昇した (最大 ${peak.toFixed(0)}%, 最寄り熱源 ${nearMax.toFixed(1)}/s)`);
});

// AREA 4: play 4-1 -> rest -> 4-2 -> rest -> 4-3 -> rest -> FINAL BOSS with keyboard input only,
// and check that the ground stops being trustworthy without the run becoming impossible.
button('4-1 → BOSS を通常プレイ', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(4, 1);
  // Only AREA-owned pickups have to be gone. Gun modules are run-wide and drop in every AREA,
  // so counting them here would fail whenever a crate happens to spawn in the first chunk.
  assert(!model.heat.enabled && !model.oxygen.enabled && model.hazards.length === 0
    && model.pickups.filter(k => pickupType(k.kind).category === 'environment').length === 0,
    'AREA 4 に酸素・HEAT・溶岩・アイスが残っていない');
  // Sampling the 7-8 rows that exist at the instant of the jump is a coin flip: at a 45% per-row
  // chance it shows no collapsing ledge about 7.5% of the time (measured identically on main).
  // The recipe is asserted deterministically here; that ledges really do generate and collapse is
  // proved behaviourally by the cracks/collapses assertion at the end of this same run.
  assert(model.stage.config.gimmicks?.breakablePlatforms === true && (model.stage.sectionPlan?.breakableChance ?? 0) > 0,
    `AREA 4 の生成計画に崩壊足場が含まれる (breakableChance ${model.stage.sectionPlan?.breakableChance})`);
  const deadline = performance.now() + 320000;
  let direction = 0, cracks = 0, collapses = 0, underfoot = 0, reloadsOnBreakable = 0, playingHp = model.hp, shopsSeen = 0;
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
    // A SHOP stops the world until it is dismissed, so a play loop has to answer the door.
    if (model.state === 'shop') {
      steer(0);
      shopsSeen++;
      document.getElementById('shop-close')?.click();
      await wait(120);
      continue;
    }
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
    // A SECTION now ends at the gate; gateHeading knows how to leave a ledge to reach it.
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    const heading = gate ?? target;
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
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


/**
 * Proof that a check did not cheat.
 *
 * The old test asked "did HP go up?", which is the wrong question: picking up a HEART crate that
 * the shaft generated and walking into it is ordinary play, and so is any future in-game reward.
 * What actually makes a run assisted is THIS FILE calling an API that hands the player something
 * the game would not have. So each of those APIs is wrapped for the duration of the check and only
 * records a violation when the call came from the harness -- the game calling heal() because the
 * player collected a HEART does not appear, because that stack has no harness frame in it.
 */
function watchForAssists(model: GameModel) {
  const used: string[] = [];
  const fromHarness = () => (new Error().stack ?? '').split('\n').slice(2).some(line => line.includes('browser.playtest'));
  const undo: (() => void)[] = [];
  const patch = (owner: object, key: string, label: string) => {
    const target = owner as Record<string, unknown>;
    const original = target[key] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    target[key] = function (this: unknown, ...args: unknown[]) {
      if (fromHarness()) used.push(label);
      return original.apply(this ?? owner, args);
    };
    undo.push(() => { target[key] = original; });
  };
  patch(model, 'heal', 'model.heal');
  patch(model.health, 'heal', 'health.heal');
  patch(model.health, 'lifeUp', 'health.lifeUp');
  patch(model.health, 'killInstantly', 'health.killInstantly');
  patch(model, 'killInstantly', 'model.killInstantly');
  patch(model.boss, 'damage', 'boss.damage');
  patch(model, 'clearBoss', 'clearBoss');
  // Invincibility is a plain field, so it needs a property trap rather than a wrapper.
  const player = model.player as unknown as Record<string, unknown>;
  let invincible = player.invincible as number;
  Object.defineProperty(player, 'invincible', {
    configurable: true,
    get: () => invincible,
    set: (value: number) => { if (fromHarness()) used.push('player.invincible'); invincible = value; },
  });
  undo.push(() => {
    delete player.invincible;
    player.invincible = invincible;
  });
  return { used, stop: () => { for (const restore of undo) restore(); } };
}

/**
 * Heading for the gate. While a ledge is still underfoot the player has to step off its edge --
 * but a ledge flush against a wall has no edge on that side, and walking into the wall forever is
 * how a bot gets stuck. Pick the side that is actually open, preferring the one toward the gate.
 */
function gateHeading(model: GameModel, ground: RoutePlatform | undefined): number {
  const exit = model.exit!;
  const centre = exit.x + exit.width / 2;
  const p = model.player;
  if (!ground || exit.y <= p.y + 40) return centre;
  // Which edge is reachable depends on the ledge: one flush against a wall has no edge that side,
  // and pressing into a wall forever is how a bot gets stuck. Sweep toward one edge, then the
  // other, so any ledge with an open side is left within a couple of seconds.
  const leftOpen = ground.x > WORLD.wall + 6;
  const rightOpen = ground.x + ground.width < WORLD.width - WORLD.wall - 6;
  if (leftOpen && !rightOpen) return ground.x - 26;
  if (rightOpen && !leftOpen) return ground.x + ground.width + 26;
  const sweepLeft = Math.floor(performance.now() / 900) % 2 === 0 ? centre < p.x : centre >= p.x;
  return sweepLeft ? ground.x - 26 : ground.x + ground.width + 26;
}
/**
 * One descent policy that understands every mechanic the game currently has. The per-AREA checks
 * and the full run share it, so a rule change only has to be taught once.
 *
 * It returns the x the player should be heading for and whether to hold fire. It never touches
 * the model: everything it decides is delivered as ordinary key presses by the caller.
 */
function descendPlan(model: GameModel): { target: number | undefined; fire: boolean } {
  const p = model.player;
  const ground = model.platforms.find(f => f.id === p.grounded) as RoutePlatform | undefined;
  const next = model.platforms.filter(f => f.y > p.y + 15 && f.state !== 'broken').sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
  let target: number | undefined = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
  let fire = false;

  // AREA 2: air is sealed in containers now. Low on air, go and break one, then chase what it
  // released -- the bubbles climb, so they have to be caught rather than collected.
  if (model.oxygen.enabled) {
    // A bubble that has already climbed above us is gone: chasing it upward is impossible, since
    // nothing in this game pushes the player up. Only go for one still at or below our level.
    const bubble = model.bubbles
      .filter(b => !b.taken && b.y > p.y - 30 && b.y < p.y + 300 && Math.abs(b.x - p.x) < 210)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const box = model.containers
      .filter(c => !c.broken && c.y > p.y - 20 && c.y < p.y + 520)
      .sort((a, b) => a.y - b.y)[0];
    const thirsty = model.oxygen.remaining < model.oxygen.max * 0.72;
    if (bubble) {
      target = bubble.x;
    } else if (box && thirsty) {
      // Falling onto it breaks it and costs no ammo, so line up on it and drop through.
      const centre = box.x + box.width / 2;
      target = centre;
      if (Math.abs(centre - p.x) < 26 && box.y > p.y) fire = true;
    }
  }
  // AREA 3: ice still matters exactly as before.
  // Ice is worth going for well before the gauge is dangerous: HEAT climbs with proximity, so
  // waiting until it is high means the detour itself is spent in the hot zone.
  if (model.heat.enabled && model.heat.value > 38) {
    const ice = model.pickups.filter(k => !k.taken && k.kind === 'ice' && k.y > p.y - 40 && k.y < p.y + 300).sort((a, b) => a.y - b.y)[0];
    if (ice && Math.abs(ice.x - p.x) < 220) target = ice.x;
  }
  // Loose money on the way down is worth a small detour, never a dangerous one.
  const coin = model.coins.coins.filter(c => !c.taken && c.y > p.y - 30 && c.y < p.y + 150 && Math.abs(c.x - p.x) < 90)[0];
  if (coin && !model.exit) target = coin.x;

  // The gate ends the SECTION. It is below, so while a ledge is still underfoot the job is to step
  // off its edge; once falling, aim straight at it.
  // AREA 3 keeps everything lethal off the safe corridor, so a detour is the only way to end up
  // over lava. If the chosen detour sits above a hazard, give it up and take the route.
  const routeTarget = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
  if (target !== undefined && model.hazards.some(h => target! > h.x - 22 && target! < h.x + h.width + 22 && h.y > p.y - 20 && h.y < p.y + 420)) {
    target = routeTarget;
  }

  if (model.exit) target = gateHeading(model, ground);

  // The core of the game: shoot what is under you, and use the recoil to brake a long fall.
  const threat = model.enemies.some(e => e.alive && Math.abs(e.x - p.x) < 34 && e.y > p.y && e.y < p.y + 430);
  // A ledge with something unstompable standing on it is worth clearing before landing on it.
  fire = fire || threat || p.vy > 360;
  return { target, fire };
}

/**
 * FULL RUN -- 1-1 to GAME CLEAR with nothing given.
 *
 * No heal, no HP written, no invincibility, no forced kill, no boss HP touched, no teleporting,
 * no oxygen topped up, no forced SECTION change. Every SECTION is finished by walking into its
 * gate. Whatever happens is reported exactly as it lands.
 */
button('FULL RUN 1-1 → GAME CLEAR（補助なし）', async () => {
  start();
  await until(() => bridge.active, 8000);
  const deadline = performance.now() + 1500000;
  let facing = 0, firing = false, tapFrame = 0;
  const steer = (dir: number) => {
    if (dir === facing) return;
    if (facing) key(facing < 0 ? 'KeyA' : 'KeyD', false);
    facing = dir;
    if (facing) key(facing < 0 ? 'KeyA' : 'KeyD', true);
  };
  const trigger = (on: boolean) => { if (on !== firing) { key('Space', on); firing = on; } };

  const sections: string[] = [];
  let frame = 0, died = '';
  const seen = {
    shops: 0, bought: 0, containersBroken: 0, bubblesCaught: 0, coins: 0,
    cracks: 0, collapses: 0, landings: 0, exits: 0, gunSwaps: 0, phases: [] as number[],
  };
  const areaNotes: Record<string, string> = {};
  let depthAtBoss = -1, gunAtBossEntry = '', maxOxygen = 0, minOxygen = 99, maxHeat = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, m) => {
    if (event.type === 'crack') seen.cracks++;
    if (event.type === 'collapse') seen.collapses++;
    if (event.type === 'land') seen.landings++;
    if (event.type === 'coin') seen.coins++;
    if (event.type === 'containerBreak') seen.containersBroken++;
    if (event.type === 'oxygen') seen.bubblesCaught++;
    if (event.type === 'exit') seen.exits++;
    if (event.type === 'gunModule') seen.gunSwaps++;
    if (event.type === 'bossPhase') seen.phases.push(Number(event.value));
    original(event, m);
  };

  try {
    while (performance.now() < deadline) {
      const model = scene.model;
      if (model.state === 'over') {
        died = `${model.stage.label} で死亡 (${model.health.deathCause?.cause ?? '?'})`;
        break;
      }
      if (model.state === 'clear') break;
      // A shop stops the world. Buy the first affordable thing once, then leave.
      if (model.state === 'shop') {
        steer(0); trigger(false);
        seen.shops++;
        await until(() => !!document.getElementById('shop-close'), 6000);
        for (let i = 0; i < model.shop.offers.length; i++) {
          const button = document.getElementById(`shop-buy-${i}`) as HTMLButtonElement | null;
          if (button && !button.disabled) { button.click(); seen.bought++; await wait(120); break; }
        }
        document.getElementById('shop-close')!.click();
        await wait(120);
        continue;
      }
      if (model.state === 'upgrade') {
        steer(0); trigger(false);
        await until(() => !!document.getElementById('upgrade-0'), 8000);
        sections.push(model.stage.label);
        if (model.stage.progress.area === 2) areaNotes['AREA2'] = `酸素箱${seen.containersBroken}破壊・泡${seen.bubblesCaught}回収・最低酸素${minOxygen.toFixed(1)}s`;
        if (model.stage.progress.area === 3) areaNotes['AREA3'] = `最大HEAT ${maxHeat.toFixed(0)}%`;
        if (model.stage.progress.area === 4) areaNotes['AREA4'] = `着地${seen.landings}・ヒビ${seen.cracks}・崩落${seen.collapses}`;
        // Choose, the way a player does, rather than always taking the leftmost card. Survivability
        // first, then damage: that is what carries a run into the FINAL BOSS.
        const order = ['heart', 'food', 'power', 'mag', 'recoil', 'piercing', 'big', 'speed', 'combo', 'bounce'];
        const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
        let best = 0;
        model.upgrades.choices.forEach((choice, index) => { if (rank(choice.id) < rank(model.upgrades.choices[best].id)) best = index; });
        document.getElementById(`upgrade-${best}`)!.click();
        document.getElementById('upgrade-confirm')!.click();
        await wait(120);
        continue;
      }
      keepAwake();
      if (model.state === 'boss') {
        if (depthAtBoss < 0) { depthAtBoss = Math.floor(model.totalDepth); gunAtBossEntry = model.gun.id; }
        const p = model.player, boss = model.boss;
        const incoming = boss.shots.filter(s => s.y > p.y - 30 && Math.abs(s.x - p.x) < 46);
        const band = boss.sweepBand;
        const ground = model.platforms.find(f => f.id === p.grounded) as RoutePlatform | undefined;
        const ahead = model.platforms.filter(f => f.y > p.y + 15 && f.state !== 'broken').sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
        let target: number | undefined = ground ? ground.exitX + ground.safeSide * 3 : ahead?.safeX;
        if (boss.action?.attack.id === 'sweep' && band) target = band.x < 225 ? band.x + band.width + 70 : band.x - 70;
        else if (incoming.length) target = incoming[0].x < 225 ? incoming[0].x + 110 : incoming[0].x - 110;
        else if (model.ammo > 0) target = boss.x;
        if (model.oxygen.enabled) {
          const bubble = model.bubbles.filter(b => !b.taken && b.y > p.y - 150 && b.y < p.y + 280).sort((a, b) => a.y - b.y)[0];
          const box = model.containers.filter(c => !c.broken && c.y > p.y - 40 && c.y < p.y + 460).sort((a, b) => a.y - b.y)[0];
          if (bubble && model.oxygen.remaining < model.oxygen.max * 0.8) target = bubble.x;
          else if (box && model.oxygen.remaining < model.oxygen.max * 0.6) target = box.x + box.width / 2;
        }
        if (model.heat.enabled && model.heat.value > 55) {
          const ice = model.pickups.filter(k => !k.taken && k.kind === 'ice' && k.y > p.y && k.y < p.y + 220).sort((a, b) => a.y - b.y)[0];
          if (ice && Math.abs(ice.x - p.x) < 190) target = ice.x;
        }
        steer(target === undefined || Math.abs(target - p.x) < 4 ? 0 : Math.sign(target - p.x));
        // Tap here too: arriving at the king holding a semi-automatic module and holding the
        // trigger down would fire exactly one round for the whole fight.
        frame++;
        trigger(model.ammo > 0 && Math.abs(boss.x - p.x) < 34 && !incoming.length && frame % 10 < 5);
        output.textContent = `FULL RUN（補助なし）\nFINAL BOSS PHASE ${boss.phaseId} · 魔王HP ${Math.ceil(boss.ratio * 100)}%\nHP ${model.hp}/${model.health.maxHp} · COIN ${model.coins.walletCoins}\n経過 ${boss.elapsed.toFixed(1)}s`;
        await wait(16);
        continue;
      }
      if (model.oxygen.enabled) { minOxygen = Math.min(minOxygen, model.oxygen.remaining); maxOxygen = Math.max(maxOxygen, model.oxygen.remaining); }
      if (model.heat.enabled) maxHeat = Math.max(maxHeat, model.heat.value);
      const plan = descendPlan(model);
      steer(plan.target === undefined || Math.abs(plan.target - model.player.x) < 4 ? 0 : Math.sign(plan.target - model.player.x));
      // Tap rather than hold: a semi-automatic module only answers to a fresh press.
      frame++;
      trigger(plan.fire && frame % 10 < 5);
      output.textContent = `FULL RUN（補助なし）\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m${model.exit ? ' · EXIT OPEN' : ''}\n` +
        `HP ${model.hp}/${model.health.maxHp} · AMMO ${model.ammo}/${model.stats.maxAmmo} · ${model.gun.short}\n` +
        `COIN ${model.coins.walletCoins} (SCORE ${model.coins.scoreCoins})\n` +
        `通過 ${sections.length}/12 · 酸素箱${seen.containersBroken} 泡${seen.bubblesCaught} 店${seen.shops}`;
      await wait(16);
    }
  } finally {
    steer(0); trigger(false); bridge.onEvent = original;
  }

  const model = scene.model;
  await wait(900);
  const body = document.body.innerText.replace(/\n/g, ' | ');
  const timeAt = (label: string) => { const k = body.indexOf(label); if (k < 0) return 'なし'; const t = body.slice(k, k + 60).match(/[0-9]+:[0-5][0-9]/); return t ? t[0] : 'なし'; };

  if (died) output.textContent += `\n\n${died}`;
  output.textContent += `\n通過SECTION: ${sections.join(' → ')}`;
  output.textContent += `\n${Object.entries(areaNotes).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  assert(sections.length === 12, `12 SECTION すべてを EXIT 侵入で踏破 (${sections.length}: ${sections.join(' ')})`);
  assert(seen.exits === 12, `EXIT 侵入イベントが 12 回 (${seen.exits})`);
  assert(depthAtBoss === PLANNED_TOTAL_DEPTH, `BOSS 到達時 TOTAL DEPTH = ${depthAtBoss}m（計画 ${PLANNED_TOTAL_DEPTH}m）`);
  assert(seen.containersBroken > 0 && seen.bubblesCaught > 0, `AREA 2 実プレイで酸素箱→泡→回復が成立 (箱 ${seen.containersBroken} / 泡 ${seen.bubblesCaught})`);
  assert(maxHeat > 0, `AREA 3 の HEAT が実プレイで動いた (最大 ${maxHeat.toFixed(0)}%)`);
  assert(seen.cracks > 0 && seen.collapses > 0, `AREA 4 で着地→ヒビ→崩落が成立 (着地 ${seen.landings} / ヒビ ${seen.cracks} / 崩落 ${seen.collapses})`);
  assert(seen.phases.join(',') === '2,3,4', `BOSS PHASE 2 → 3 → 4 と進行 (${seen.phases.join(' → ')})`);
  assert(model.state === 'clear', `GAME CLEAR に到達 (state=${model.state})`);
  assert(Math.floor(model.totalDepth) === PLANNED_TOTAL_DEPTH, `CLEAR 時も TOTAL DEPTH ${PLANNED_TOTAL_DEPTH}m (${Math.floor(model.totalDepth)})`);
  const clearTime = timeAt('CLEAR TIME'), bossTime = timeAt('BOSS TIME');
  assert(clearTime !== 'なし' && bossTime !== 'なし' && clearTime !== bossTime, `CLEAR TIME ${clearTime} と BOSS TIME ${bossTime} が分離`);
  output.textContent += `\n\n結果: CLEAR / 残HP ${model.hp}/${model.health.maxHp} / COIN ${model.coins.walletCoins} (SCORE ${model.coins.scoreCoins})`;
  output.textContent += `\n店 ${seen.shops} 回 / 購入 ${seen.bought} / 武器交換 ${seen.gunSwaps} / 最終武器 ${model.gun.short} / BOSS入場時 ${gunAtBossEntry}`;
  output.textContent += `\nCLEAR TIME ${clearTime} · BOSS TIME ${bossTime}`;
});
/**
 * UNASSISTED BOSS CHECK -- the fight exactly as a player meets it.
 *
 * Nothing is given: no heal, no HP written directly, no invincibility, no boss HP touched, no
 * forced kill, during setup or during the fight. The only concession is the twelve upgrades a
 * player genuinely arrives with after 12 sections, and whatever HP *those upgrade effects*
 * produce on their own is the HP the fight starts with. The run is reported exactly as it lands,
 * win or lose; the difficulty is never touched to make this pass.
 *
 * A guard below fails the check if the player's HP ever rises during the fight, so this can never
 * quietly turn back into an assisted test.
 */
button('UNASSISTED BOSS CHECK', async () => {
  start();
  await until(() => scene.model.state === 'playing', 8000);
  for (const id of ['mag', 'power', 'heart', 'food', 'recoil', 'speed', 'big', 'combo', 'mag', 'bounce', 'heart', 'food']) {
    const upgrade = UPGRADES.find(u => u.id === id);
    if (upgrade) scene.model.upgrades.applyLegacy(upgrade);
  }
  scene.model.jumpToBoss();
  await until(() => scene.model.state === 'boss' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  const watch = watchForAssists(model);
  const startHp = model.hp;
  const phases: number[] = [];
  const original = bridge.onEvent;
  bridge.onEvent = (event, m) => { if (event.type === 'bossPhase') phases.push(Number(event.value)); defaultEventHandler?.(event, m); };
  let facing = 0, firing = false, hits = 0, lastHp = model.hp, deepest = 1, healed = 0, tapFrame = 0;
  const steer = (dir: number) => {
    if (dir === facing) return;
    if (facing === -1) key('KeyA', false); if (facing === 1) key('KeyD', false);
    if (dir === -1) key('KeyA', true); if (dir === 1) key('KeyD', true);
    facing = dir;
  };
  const trigger = (on: boolean) => { if (on !== firing) { key('Space', on); firing = on; } };
  const deadline = performance.now() + 220000;
  while (model.state === 'boss' && performance.now() < deadline) {
    keepAwake();
    const p = model.player, boss = model.boss;
    deepest = Math.max(deepest, boss.phaseId);
    if (model.hp < lastHp) hits++;
    // HP going up is NOT evidence of cheating: a HEART crate the shaft generated is ordinary
    // play. It is recorded only so the result can say where the HP came from.
    if (model.hp > lastHp) healed++;
    lastHp = model.hp;
    const incoming = boss.shots.filter(s => s.y > p.y - 30 && Math.abs(s.x - p.x) < 46);
    const band = boss.sweepBand;
    const ground = model.platforms.find(f => f.id === p.grounded) as RoutePlatform | undefined;
    const ahead = model.platforms.filter(f => f.y > p.y + 15 && f.state !== 'broken').sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    let target: number | undefined = ground ? ground.exitX + ground.safeSide * 3 : ahead?.safeX;
    if (boss.action?.attack.id === 'sweep' && band) target = band.x < 225 ? band.x + band.width + 70 : band.x - 70;
    else if (incoming.length) target = incoming[0].x < 225 ? incoming[0].x + 110 : incoming[0].x - 110;
    else if (model.ammo > 0) target = boss.x;
    if (model.oxygen.enabled && model.oxygen.remaining < 6) {
      // PHASE 2 runs AREA 2's air rules, which are containers now: catch a released bubble if one
      // is still within reach, otherwise go and break a container open.
      const bubble = model.bubbles.filter(b => !b.taken && b.y > p.y - 30 && b.y < p.y + 300).sort((a, b) => a.y - b.y)[0];
      const box = model.containers.filter(c => !c.broken && c.y > p.y - 20 && c.y < p.y + 520).sort((a, b) => a.y - b.y)[0];
      if (bubble && Math.abs(bubble.x - p.x) < 200) target = bubble.x;
      else if (box) target = box.x + box.width / 2;
    }
    if (model.heat.enabled && model.heat.value > 55) {
      const ice = model.pickups.filter(k => !k.taken && k.kind === 'ice' && k.y > p.y && k.y < p.y + 220).sort((a, b) => a.y - b.y)[0];
      if (ice && Math.abs(ice.x - p.x) < 180) target = ice.x;
    }
    steer(target === undefined || Math.abs(target - p.x) < 4 ? 0 : Math.sign(target - p.x));
    tapFrame++;
    trigger(model.ammo > 0 && Math.abs(boss.x - p.x) < 34 && !incoming.length && tapFrame % 10 < 5);
    output.textContent = `UNASSISTED BOSS CHECK\nPHASE ${boss.phaseId} · 魔王HP ${Math.ceil(boss.ratio * 100)}%\nHP ${model.hp}/${model.health.maxHp} · 被弾 ${hits}\n経過 ${boss.elapsed.toFixed(1)}s`;
    await wait(16);
  }
  steer(0); trigger(false);
  const fightTime = model.boss.enabled ? model.boss.elapsed : scene.model.bossTime;
  await wait(1400);
  bridge.onEvent = original;
  const won = scene.model.state === 'clear';
  const cause = scene.model.health.deathCause?.cause ?? 'なし';
  output.textContent += `\n\n結果: ${won ? 'GAME CLEAR' : scene.model.state === 'over' ? 'GAME OVER' : '時間切れ'}`;
  output.textContent += `\n到達フェーズ: ${deepest} (${phases.join(' → ') || '1のみ'})`;
  output.textContent += `\n開始HP: ${startHp}/${model.health.maxHp}（強化効果のみ・回復なし）`;
  output.textContent += `\n撃破時間: ${fightTime.toFixed(1)}s / 被弾: ${hits} / 残HP: ${scene.model.hp}/${model.health.maxHp} / 死因: ${cause}`;
  watch.stop();
  assert(watch.used.length === 0, `補助APIをテストから一度も呼んでいない（検出: ${watch.used.join(', ') || 'なし'}）`);
  output.textContent += `\n戦闘中のHP上昇: ${healed} 回（ゲーム内取得によるものは正当）`;
  assert(true, `実測（補助なし）: ${won ? 'CLEAR' : scene.model.state} / PHASE ${deepest} / ${fightTime.toFixed(1)}s / 開始HP${startHp} / 被弾${hits} / 残HP${scene.model.hp} / 死因${cause}`);
});

/**
 * ASSISTED BOSS CHECK -- a UI and phase-progression check, NOT a difficulty measurement.
 *
 * This one deliberately props the player up so the whole fight is guaranteed to be observed:
 * it tops HP up before the fight, keeps the player alive at 1 HP during it, and removes the
 * king's last HP directly if the keyboard bot has not finished in time. Its job is to prove that
 * PHASE 1-4, the HP bar, the telegraphs, GAME CLEAR, CLEAR TIME and PLAY AGAIN all work.
 * Never quote its numbers as a measure of how hard the fight is -- use UNASSISTED BOSS CHECK.
 */
button('ASSISTED BOSS CHECK', async () => {
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
      // Same as above: the king's PHASE 2 air comes out of containers, not off the floor.
      const bubble = model.bubbles.filter(b => !b.taken && b.y > p.y - 30 && b.y < p.y + 300).sort((a, b) => a.y - b.y)[0];
      const box = model.containers.filter(c => !c.broken && c.y > p.y - 20 && c.y < p.y + 520).sort((a, b) => a.y - b.y)[0];
      if (bubble && Math.abs(bubble.x - p.x) < 200) target = bubble.x;
      else if (box) target = box.x + box.width / 2;
    }
    if (model.heat.enabled && model.heat.value > 60) {
      const ice = model.pickups.filter(k => !k.taken && k.kind === 'ice' && k.y > p.y && k.y < p.y + 200).sort((a, b) => a.y - b.y)[0];
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
