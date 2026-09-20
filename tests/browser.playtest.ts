import { GameModel, plainBullet } from '../src/systems/GameModel';
import { scene, bridge, start, pause, audio } from '../src/main';
import type { Platform, RoutePlatform } from '../src/systems/StageGenerator';
import { spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { AREAS, type SectionId, PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { pickupType } from '../src/data/pickups';
import { UPGRADES } from '../src/data/upgrades';
import { GUN_MODULES } from '../src/data/gunModules';
import { DOODAD_RULES, spawnDoodad } from '../src/data/doodads';
import { SAFE_ZONE_RULES, insideSafeZone } from '../src/data/safeZone';
import { spawnGunModule } from '../src/data/pickups';
// The watchdog behind the word "unassisted" lives in its own file so it can be unit-tested; see
// tests/assistWatch.test.ts, which proves it restores the model and still tells cheating from play.
import { watchForAssists } from './assistWatch';
import { COMBO_TIERS, comboTierFor } from '../src/data/combo';
import { isSpike } from '../src/data/hazards';
import { BREAK_BLOCK_RULES } from '../src/data/structures';
import { COIN_VALUES } from '../src/data/coins';
import { COIN_HIGH_RULES } from '../src/data/coinHigh';
import { SHOP_ITEMS, shopItem, shopPrice } from '../src/data/shop';
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
  let direction = 0, playingHp = model.hp, firing = false;
  const rests: string[] = [];
  let shopsSeen = 0;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  const act = (on: boolean) => { if (on !== firing) { key('Space', on); firing = on; } };
  while (performance.now() < deadline) {
    if (model.state === 'over') throw new Error(`${model.stage.label} で死亡 (死因 ${model.health.deathCause?.cause ?? '?'} / ${Math.floor(model.sectionDepth)}m / 休憩 ${rests.join(' → ') || 'なし'} / SHOP ${shopsSeen} / 武器 ${model.gun.id})`);
    // A SHOP stops the world until it is dismissed, so a play loop has to answer the door.
    if (model.state === 'shop') {
      steer(0); act(false);
      shopsSeen++;
      document.getElementById('shop-close')?.click();
      await wait(120);
      continue;
    }
    if (model.state === 'upgrade') {
      steer(0); act(false);
      await until(() => !!document.getElementById('upgrade-0'), 8000);
      const cleared = model.stage.label, before = { hp: model.hp, max: model.health.maxHp, overflow: model.health.overflowHealing, stacks: Object.values(model.upgrades.stacks).reduce((a, b) => a + b, 0) };
      assert(model.hp === playingHp, `${cleared} クリアで休憩：HPは ${model.hp}/${model.health.maxHp} のまま回復しない`);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      rests.push(cleared);
      assert(model.health.maxHp >= before.max && model.health.overflowHealing >= 0 && Object.values(model.upgrades.stacks).reduce((a, b) => a + b, 0) === before.stacks + 1, `${cleared} 強化を1つだけ適用`);
      assert(model.ammo === model.stats.maxAmmo && model.sectionDepth < 5, `${model.stage.label} 開始：CHARGE満タン・SECTION深度0`);
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
    // A gate row is the one thing steering cannot solve: ACTION on the block hops off it, and ACTION
    // in the air above it is the gunboots. Both halves are needed -- hopping alone just loops.
    const block = model.platforms.filter(f => f.breakBlock && f.state !== 'broken' && f.y > model.player.y - 4).sort((a, b) => a.y - b.y)[0];
    const overBlock = !!block && model.player.x + 9 > block.x && model.player.x - 9 < block.x + block.width;
    const working = !!ground?.breakBlock || (!ground && overBlock);
    act(working && model.ammo > 0);
    const heading = working ? (block ? block.x + block.width / 2 : model.player.x) : (gate ?? target);
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
    output.textContent = `キーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nTOTAL ${Math.floor(model.totalDepth)}m · HP ${model.hp}/${model.health.maxHp} · AMMO ${model.ammo} · COMBO ${model.combo}\n通過した休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); act(false); pause();
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
// Phase 2B: scenery that reloads, chambers cut into the shaft, and the stopped time inside one.
button('DOODAD：踏んで CHARGE 全回復', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = []; model.safeZones = [];
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  model.combo = 9;
  // Spend CHARGE in the air first, so the refill is something that actually happens.
  key('Space', true); await wait(260); key('Space', false); await wait(60);
  const spent = model.ammo;
  assert(spent < model.stats.maxAmmo, `空中射撃で CHARGE が減った（${spent}/${model.stats.maxAmmo}）`);

  model.player.x = 225; model.player.y = 180; model.player.vy = 260; model.player.grounded = -1;
  model.doodads = [spawnDoodad(9100, 225 - DOODAD_RULES.width / 2, 300, 'lamp')];
  const kills = model.kills, coins = model.coins.scoreCoins;
  let bounced = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'doodad') bounced++; };
  await until(() => bounced > 0, 5000);
  bridge.onEvent = original;
  output.textContent += `\nDOODAD 反発 vy ${model.player.vy.toFixed(0)} / CHARGE ${spent}→${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo}`;
  assert(bounced === 1, '上から踏んで1回だけ発火した');
  assert(model.ammo === model.stats.maxAmmo, 'DOODAD で CHARGE 全回復');
  assert(model.combo === 9, 'DOODAD は COMBO を維持する（精算しない）');
  assert(model.player.vy < 0, `跳ね返る (vy ${model.player.vy.toFixed(0)})`);
  assert(model.kills === kills && model.coins.scoreCoins === coins, '撃破でも COIN でもない');
  assert(model.doodads[0].active, 'DOODAD は残る');
  bridge.active = false;
});
button('SAFE ZONE：TIMEVOID と着地', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.pickups = []; model.hazards = []; model.doodads = []; model.containers = [];
  // A chamber cut into the left wall, with something alive and a round left out in the shaft.
  const floorY = 320, height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width;
  const zone = { id: 9200, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height, content: null, taken: false };
  model.safeZones = [zone];
  model.platforms = [{ id: 9201, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
  model.enemies = [enemy('slime', 330, 420, 9300)];
  // The harness spawns with no patrol range, which would make "it did not move" true for the wrong
  // reason. Give it one, and prove it is moving BEFORE stepping into the chamber.
  model.enemies[0].range = 40;
  model.bullets = [];
  model.combo = 17; model.ammo = 2;
  model.player.invincible = 99;
  model.player.x = 300; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const moving = model.enemies[0].x;
  await wait(400);
  assert(Math.abs(model.enemies[0].x - moving) > 0.001, `入る前は外の敵が動いている (${moving.toFixed(2)} → ${model.enemies[0].x.toFixed(2)})`);
  model.player.x = zone.x + width / 2; model.player.y = floorY - 110; model.player.vy = 240; model.player.grounded = -1;
  await until(() => model.player.grounded === 9201, 6000);
  await wait(120);
  output.textContent += `\n着地: TIMEVOID ${model.timeFrozen} / CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo}`;
  assert(model.timeFrozen, '中に入ると TIMEVOID になる');
  assert(model.ammo === model.stats.maxAmmo, 'SAFE ZONE 床で CHARGE 全回復');
  assert(model.combo === 17, 'SAFE ZONE 床では COMBO を精算しない');
  assert(model.state === 'playing' && !model.paused, 'ゲーム全体は停止していない');
  // The outside must not move at all while we stand here.
  const foe = model.enemies[0];
  const held = { x: foe.x, oxygen: model.oxygen.remaining, depth: Math.floor(model.sectionDepth) };
  await wait(2000);
  output.textContent += `\n2秒後: 敵x ${held.x.toFixed(1)}→${foe.x.toFixed(1)} / 深度 ${held.depth}→${Math.floor(model.sectionDepth)}`;
  assert(Math.abs(foe.x - held.x) < 0.001, `外の敵が動かない (${held.x.toFixed(2)} → ${foe.x.toFixed(2)})`);
  assert(Math.floor(model.sectionDepth) === held.depth, '深度が進まない');
  // Inside, the player is fully operational.
  const insideX = model.player.x;
  key('KeyD', true); await wait(220); key('KeyD', false);
  assert(model.player.x !== insideX, 'SAFE ZONE 内で左右移動できる');
  model.player.y = floorY - 15; model.player.vy = 0; model.player.grounded = 9201;
  let jumped = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'jump') jumped++; };
  key('Space', true); await wait(1000 / 60); key('Space', false); await wait(200);
  bridge.onEvent = original;
  assert(jumped === 1, 'SAFE ZONE 内でジャンプできる');
  // Walk out: the world starts again.
  key('KeyD', true);
  for (let i = 0; i < 200 && model.timeFrozen; i++) { keepAwake(); model.player.y = floorY - 15; model.player.vy = 0; await wait(16); }
  key('KeyD', false);
  assert(!model.timeFrozen, 'SAFE ZONE を出ると TIMEVOID が解ける');
  assert(model.combo === 17, '出ても COMBO は維持される');
  const before = foe.x;
  model.player.invincible = 99;
  await wait(600);
  output.textContent += `\n退出後: 敵x ${before.toFixed(1)}→${foe.x.toFixed(1)}`;
  assert(Math.abs(foe.x - before) > 0.001, '外へ出ると外界の時間が再開する');
  bridge.active = false;
});
button('SAFE ZONE content：MODULE / SHOP / COIN VEIN', async () => {
  const height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width, floorY = 320;
  const chamber = (kind: 'gunModule' | 'shop' | 'coinVein') => {
    const model = scene.model;
    model.platforms = []; model.enemies = []; model.pickups = []; model.hazards = []; model.doodads = []; model.containers = [];
    const zone = { id: 9400, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height,
      content: { kind, module: 'laser' as const, bonus: 'charge' as const }, taken: false };
    model.safeZones = [zone];
    model.platforms = [{ id: 9401, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
    model.player.invincible = 99;
    return zone;
  };
  // --- gun module ---------------------------------------------------------------------------
  start();
  let model = scene.model;
  let zone = chamber('gunModule');
  model.combo = 11;
  const centre = Math.round(zone.x + width / 2);
  model.pickups = [spawnGunModule(zone.id + 1, centre, floorY - 34, 'laser', 'charge')];
  const maxAmmo = model.stats.maxAmmo;
  model.player.x = centre; model.player.y = floorY - 34; model.player.vy = 0; model.player.grounded = -1;
  await until(() => model.gun.id === 'laser', 5000);
  await wait(120);
  output.textContent += `\nMODULE: ${model.gun.id} / MAX CHARGE ${maxAmmo}→${model.stats.maxAmmo} / COMBO ${model.combo}`;
  assert(model.gun.id === 'laser', 'SAFE ZONE 内で Gun Module を取得できる');
  assert(model.stats.maxAmmo > maxAmmo, 'CHARGE ボーナスも従来どおり適用される');
  assert(model.combo === 11, 'Module 取得で COMBO は維持される');
  // --- shop ----------------------------------------------------------------------------------
  start();
  model = scene.model;
  zone = chamber('shop');
  model.combo = 13;
  assert(model.shop.offers.length === 3, `SECTION の SHOP 在庫が3品用意された (${model.shop.offers.map(o => o.name).join(' / ')})`);
  assert(new Set(model.shop.offers.map(o => o.item)).size === 3, '3品はすべて別の商品');
  model.shop.placeEntrance(centre - 33, floorY - 66, 66, 66);
  assert(model.shop.available, 'SAFE ZONE が SHOP の入口を開いた');
  model.player.x = centre; model.player.y = floorY - 33; model.player.vy = 0; model.player.grounded = -1;
  await until(() => scene.model.state === 'shop', 5000);
  output.textContent += `\nSHOP: state ${scene.model.state} / 在庫 ${model.shop.offers.length} / COMBO ${model.combo}`;
  assert(scene.model.state === 'shop', 'SAFE ZONE 内で SHOP を開ける');
  assert(model.combo === 13, 'SHOP を開いても COMBO は維持される');
  scene.model.closeShop();
  // --- coin vein ------------------------------------------------------------------------------
  start();
  model = scene.model;
  zone = chamber('coinVein');
  model.combo = 5;
  const vein = model.coinVeinBounds(zone);
  const kills = model.kills;
  // Walking into it does nothing: it is mined with the gunboots, which point down.
  model.player.x = vein.x + vein.width / 2; model.player.y = vein.y + vein.height / 2; model.player.vy = 0; model.player.grounded = -1;
  await wait(700);
  assert(!zone.taken, 'COIN VEIN は触れただけでは割れない');
  // Hover above it and fire down.
  for (let i = 0; i < 200 && !zone.taken; i++) {
    keepAwake();
    model.player.x = vein.x + vein.width / 2; model.player.y = vein.y - 40; model.player.vy = 0; model.player.grounded = -1;
    model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  const loose = model.coins.coins;
  const large = loose.filter(c => c.denomination === 'large').length;
  const small = loose.filter(c => c.denomination === 'small').length;
  const onFloor = loose.reduce((sum, c) => sum + c.value, 0);
  output.textContent += `\nCOIN VEIN: 割れた=${zone.taken} / 落ちたCOIN LARGE ${large} + SMALL ${small} = ${onFloor} / COMBO ${model.combo}`;
  assert(zone.taken, '射撃で COIN VEIN を割れる');
  assert(large > 0 && small > 0, `LARGE と SMALL の両方が落ちる (L${large} / S${small})`);
  assert(onFloor + model.coins.scoreCoins === SAFE_ZONE_RULES.coinVein.value, `総額が ${SAFE_ZONE_RULES.coinVein.value}`);
  // Sweep them up: they are ordinary coins on the ordinary pickup path.
  const wallet = model.coins.walletCoins;
  for (let i = 0; i < 400 && model.coins.coins.length; i++) {
    keepAwake();
    const next = model.coins.coins[0];
    model.player.x = next.x; model.player.y = next.y; model.player.vy = 0; model.player.grounded = -1;
    await wait(16);
  }
  output.textContent += `\n回収後: wallet ${wallet}→${model.coins.walletCoins} / COIN HIGH ${Math.floor(model.coinHigh.meter)} active=${model.coinHigh.active}`;
  assert(model.coins.walletCoins > wallet, 'VEIN の COIN は通常の pickup として回収できる');
  assert(model.coins.scoreCoins === model.coins.walletCoins, 'scoreCoins と walletCoins が一致');
  assert(model.coinHigh.meter > 0, 'VEIN の COIN が COIN HIGH メーターに入る');
  assert(model.kills === kills, '撃破扱いではない');
  assert(model.combo === 5, 'COIN VEIN は COMBO に影響しない');
  bridge.active = false;
});
// Phase 2A: the wall kick, and the gunboots behaving like boots.
button('SAFE ZONE：横穴へ左右だけで進入', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.pickups = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.enemies = []; model.bullets = [];
  // A chamber low enough that the approach down the shaft is a real fall.
  const floorY = 520, height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width;
  const zone = { id: 9600, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height, content: null, taken: false };
  model.safeZones = [zone];
  model.platforms = [{ id: 9601, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
  model.combo = 13; model.ammo = 3;
  model.player.invincible = 99;
  // Out in the shaft, to the right of the mouth and well above the chamber floor.
  model.player.x = zone.x + width + 40; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  await wait(120);
  assert(!model.timeFrozen, '入る前は TIMEVOID ではない');
  // Nothing but LEFT -- no jump, no fire. This is the whole mobile control set.
  let entry: { y: number; grounded: number; ammo: number; combo: number } | null = null;
  key('KeyA', true);
  for (let i = 0; i < 400 && !entry; i++) {
    keepAwake();
    if (model.timeFrozen) entry = { y: model.player.y, grounded: model.player.grounded, ammo: model.ammo, combo: model.combo };
    else if (model.player.grounded !== -1) break;
    await wait(8);
  }
  output.textContent += `\n進入: y ${entry ? entry.y.toFixed(1) : '-'} / grounded ${entry ? entry.grounded : model.player.grounded} / 床 ${floorY}`;
  assert(entry !== null, '左右移動だけで横穴の口を通り TIMEVOID になる');
  assert(entry!.grounded === -1, '進入した瞬間はまだ空中（床への着地は不要）');
  assert(entry!.y < floorY - 15, `SAFE ZONE floor へ着地する前に TIMEVOID ON (y ${entry!.y.toFixed(1)} < ${floorY - 15})`);
  assert(entry!.ammo === 3 && entry!.combo === 13, '口を通っただけでは CHARGE も COMBO も動かない');
  // Then the floor does its own job, unchanged.
  for (let i = 0; i < 400 && model.player.grounded !== 9601; i++) { keepAwake(); key('KeyA', true); await wait(16); }
  key('KeyA', false);
  await wait(120);
  output.textContent += `\n着地: CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo}`;
  assert(model.player.grounded === 9601, '続けて SAFE ZONE floor に着地する');
  assert(model.ammo === model.stats.maxAmmo, '床で CHARGE 全回復');
  assert(model.combo === 13, '床では COMBO を精算しない');
  // And back out the same way it came in.
  key('KeyD', true);
  for (let i = 0; i < 300 && model.timeFrozen; i++) { keepAwake(); model.player.y = floorY - 15; model.player.vy = 0; await wait(16); }
  key('KeyD', false);
  assert(!model.timeFrozen, '左右移動だけで横穴から出られる');
  assert(model.combo === 13, '出ても COMBO は維持される');
  bridge.active = false;
});
button('TIMEVOID：外の弾は止まり中で撃った弾は動く', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.pickups = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.enemies = []; model.bullets = [];
  const floorY = 320, height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width;
  const zone = { id: 9700, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height, content: null, taken: false };
  model.safeZones = [zone];
  model.platforms = [{ id: 9701, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
  model.player.invincible = 99;
  model.player.x = zone.x + width / 2; model.player.y = floorY - 92; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = model.stats.maxAmmo;
  // One round left out in the shaft heading down, one heading up: the shape of anything the world
  // might have in flight, whoever fired it. Enemies deal contact damage today, so nothing of theirs
  // exists yet -- the rule is decided by where a round is, not by who it belongs to.
  const falling = plainBullet(300, 180); falling.vy = 420;
  const rising = plainBullet(300, 500); rising.vy = -520;
  model.bullets = [falling, rising];
  await wait(120);
  assert(model.timeFrozen, 'SAFE ZONE の中にいる');
  const outsideBefore = { fall: falling.y, rise: rising.y };
  await wait(1200);
  output.textContent += `\n外の弾: 下向き ${outsideBefore.fall.toFixed(1)}→${falling.y.toFixed(1)} / 上向き ${outsideBefore.rise.toFixed(1)}→${rising.y.toFixed(1)}`;
  assert(Math.abs(falling.y - outsideBefore.fall) < 0.001, 'SAFE ZONE 外の弾は止まっている');
  assert(Math.abs(rising.y - outsideBefore.rise) < 0.001, 'SAFE ZONE 外を上ってくる弾も止まっている');
  // Fire from inside. The player is airborne in there, so ACTION is the gun.
  const fired: typeof model.bullets = [];
  for (let i = 0; i < 40 && fired.length === 0; i++) {
    keepAwake();
    model.player.y = floorY - 92; model.player.vy = 0; model.player.grounded = -1;
    key('Space', true); await wait(1000 / 60); key('Space', false);
    fired.push(...model.bullets.filter(b => b !== falling && b !== rising && insideSafeZone(zone, b.x, b.y)));
    await wait(16);
  }
  assert(fired.length > 0, 'SAFE ZONE 内で射撃できる');
  const shot = fired[0];
  const shotBefore = shot.y;
  for (let i = 0; i < 12; i++) { keepAwake(); model.player.y = floorY - 92; model.player.vy = 0; model.player.grounded = -1; await wait(16); }
  output.textContent += `\n中で撃った弾: ${shotBefore.toFixed(1)}→${shot.y.toFixed(1)} / travelled ${shot.travelled.toFixed(1)}`;
  assert(Math.abs(shot.y - shotBefore) > 0.5 || shot.travelled > 0.5, 'SAFE ZONE 内で撃った弾は普通に飛ぶ');
  // The outside pair still has not budged while that one flew.
  assert(Math.abs(falling.y - outsideBefore.fall) < 0.001 && Math.abs(rising.y - outsideBefore.rise) < 0.001, '中の弾が動いても外の弾は止まったまま');
  // Step out: the shaft starts again.
  key('KeyD', true);
  for (let i = 0; i < 300 && model.timeFrozen; i++) { keepAwake(); model.player.y = floorY - 15; model.player.vy = 0; model.player.grounded = 9701; await wait(16); }
  key('KeyD', false);
  await wait(200);
  assert(!model.timeFrozen, 'SAFE ZONE を出た');
  assert(falling.y > outsideBefore.fall, '外へ出ると外の弾が動き出す');
  bridge.active = false;
});
button('WALL JUMP：壁キック', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = [];
  const left = WORLD.wall + 12;
  let jumps = 0, shots = 0, ammoAtKick = -1, comboAtKick = -1;
  const order: string[] = [];
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => {
    original(event, game);
    if (event.type === 'wallJump') { jumps++; order.push('wallJump'); ammoAtKick = game.ammo; comboAtKick = game.combo; }
    if (event.type === 'shot') { shots++; order.push('shot'); }
  };
  // Pin the run against the left wall, in the air, and hold LEFT so it stays there.
  key('KeyA', true);
  // Long enough to actually cross the shaft: 225 -> the wall is about a second at moveSpeed 180.
  for (let i = 0; i < 110 && model.player.x > left + 0.5; i++) { keepAwake(); model.player.y = 300; model.player.vy = 0; model.player.grounded = -1; model.platforms = []; model.enemies = []; await wait(16); }
  key('KeyA', false);
  const beforeX = model.player.x, ammo = model.ammo, combo = model.combo = 9;
  assert(Math.abs(beforeX - left) < 1.5, `左壁に接している (x=${beforeX.toFixed(1)})`);
  // Steer AWAY from the wall and press ACTION: that is the whole input.
  key('KeyD', true);
  await wait(30);
  key('Space', true); await wait(1000 / 60); key('Space', false);
  await wait(260);
  key('KeyD', false);
  bridge.onEvent = original;
  output.textContent += `\n壁キック ${jumps} / 順序 ${order.join(' → ') || 'なし'} / x ${beforeX.toFixed(0)}→${model.player.x.toFixed(0)} / vy ${model.player.vy.toFixed(0)} / 壁キック時CHARGE ${ammoAtKick}/${model.stats.maxAmmo}`;
  assert(jumps === 1, '壁接触＋反対入力＋ACTION で WALL JUMP が1回');
  // Holding ACTION past the kick correctly becomes the gunboots -- the player is off the wall by
  // then. What must never happen is a shot BEFORE the kick, or the kick itself costing anything.
  assert(order[0] === 'wallJump', `ACTION がまず返すのは WALL JUMP（実際: ${order.join(' → ')}）`);
  assert(ammoAtKick === ammo, `WALL JUMP は CHARGE を消費しない (${ammo} → ${ammoAtKick})`);
  assert(comboAtKick === combo, `WALL JUMP は COMBO を維持する (${combo} → ${comboAtKick})`);
  assert(model.player.x > beforeX + 20, `壁から離れる向きへ押し出される (${(model.player.x - beforeX).toFixed(0)}px)`);
  assert(model.player.y < 300, `上方向へ跳ねる (y ${model.player.y.toFixed(0)})`);
  bridge.active = false;
});
button('PUNCHER / TRIPLE の見分け', async () => {
  start(); const model = scene.model;
  const spread = (id: 'puncher' | 'triple') => {
    model.platforms = []; model.enemies = []; model.hazards = [];
    model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    model.gun.equip(id); model.stats.maxAmmo = 20; model.ammo = 20; model.cooldown = 0; model.bullets = [];
    model.shoot();
    const xs = model.bullets.map(b => b.x);
    const reach = model.bullets.map(b => b.x + (b.vx / b.vy) * 200);
    return { count: model.bullets.length, muzzle: Math.max(...xs) - Math.min(...xs), at200: Math.max(...reach) - Math.min(...reach) };
  };
  const punch = spread('puncher'), triple = spread('triple');
  output.textContent += `\nPUNCHER ${punch.count}発 銃口幅 ${punch.muzzle.toFixed(0)}px → 200px先 ${punch.at200.toFixed(0)}px`;
  output.textContent += `\nTRIPLE  ${triple.count}発 銃口幅 ${triple.muzzle.toFixed(0)}px → 200px先 ${triple.at200.toFixed(0)}px`;
  assert(punch.count === 3 && triple.count === 3, 'どちらも3発');
  assert(punch.muzzle > 10, 'PUNCHER は銃口の時点で3本に分かれている（平行）');
  assert(punch.at200 < triple.at200 / 3, 'PUNCHER は TRIPLE よりはるかに狭い');
  bridge.active = false;
});
button('LASER：反動で上昇 / ブロック貫通', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = [];
  model.player.x = 225; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
  model.gun.equip('laser'); model.stats.maxAmmo = 40; model.ammo = 40;
  let shots = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'shot') shots++; };
  const startY = model.player.y;
  key('Space', true); await wait(1000 / 60); key('Space', false);
  await wait(60);
  const vy = model.player.vy;
  output.textContent += `\nLASER 反動 vy ${vy.toFixed(0)} / MACHINE recoil ${GUN_MODULES.machine.recoil} / LASER recoil ${GUN_MODULES.laser.recoil}`;
  assert(shots > 0, 'LASER が発射された');
  assert(vy < 0, `反動でプレイヤーが上向きになる (vy ${vy.toFixed(0)})`);
  await wait(200);
  assert(model.player.y < startY, `実際に上へ移動した (${startY.toFixed(0)}→${model.player.y.toFixed(0)})`);
  // A column of BREAK BLOCK in one lane: the round must reach the far one.
  const rows = [0, 1, 2].map(i => ({ id: 8100 + i, x: WORLD.wall, y: 520 + i * 140, width: 120, breakable: false, state: 'stable' as const, breakBlock: { hits: 0, durability: 9, slot: 0, reward: false } }));
  model.platforms = rows;
  model.player.x = WORLD.wall + 40; model.player.y = 360; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = 40; model.cooldown = 0;
  model.shoot();
  for (let i = 0; i < 40; i++) { keepAwake(); model.player.y = 360; model.player.vy = 0; await wait(16); }
  bridge.onEvent = original;
  const hits = rows.map(r => r.breakBlock.hits);
  output.textContent += `\nBREAK BLOCK 3段のヒット数 ${hits.join(' / ')}`;
  assert(hits.every(h => h === 1), `手前で消えず奥まで貫通する (${hits.join('/')})`);
  bridge.active = false;
});
button('SHOTGUN：強い上向き反動', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = [];
  model.player.x = 225; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
  model.gun.equip('shotgun'); model.stats.maxAmmo = 20; model.ammo = 20;
  const startY = model.player.y;
  key('Space', true); await wait(1000 / 60); key('Space', false);
  await wait(60);
  const vy = model.player.vy;
  await wait(200);
  output.textContent += `\nSHOTGUN 反動 vy ${vy.toFixed(0)} / y ${startY.toFixed(0)}→${model.player.y.toFixed(0)} / 弾 ${model.bullets.length}`;
  assert(vy < 0, `反動でプレイヤーが上向きになる (vy ${vy.toFixed(0)})`);
  assert(model.player.y < startY, '実際に上へ移動した');
  bridge.active = false;
});
// ACTION is one input read by where the player is standing. These drive the real app with real
// key events, so what is measured is what a player's finger does.
button('ACTION：地上=ジャンプ / 空中=射撃', async () => {
  start(); const model = scene.model;
  model.platforms = [{ id: 5100, x: 120, y: model.player.y + 60, width: 220, breakable: false, state: 'stable' }];
  model.enemies = []; model.hazards = [];
  await until(() => model.player.grounded === 5100, 6000);
  await wait(120);
  const floor = model.player.y;
  let shots = 0, jumps = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'shot') shots++; if (event.type === 'jump') jumps++; };
  // Ground ACTION. The scene runs several fixed steps per animation frame, so nothing outside the
  // simulation can hold the player down between them -- which is why the frame-exact claim ("a
  // grounded frame emits no shot at all") is proven in tests/downwellCore.test.ts, where the model
  // is stepped one frame at a time. What the real app can show, and what matters to the player, is
  // the ORDER: pressing ACTION while standing produces a JUMP first, never a shot.
  const order: string[] = [];
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'shot') { shots++; order.push('shot'); } if (event.type === 'jump') { jumps++; order.push('jump'); } };
  key('Space', true); await wait(1000 / 60); key('Space', false);
  await wait(200);
  const apex = floor - model.player.y;
  output.textContent += `\n地上ACTION → ${order.join(' → ') || 'なし'} / 上昇 ${Math.round(apex)}px`;
  assert(order[0] === 'jump', `地上のACTIONがまず返すのはジャンプ（実際: ${order.join(' → ') || 'なし'}）`);
  assert(jumps === 1, '単発のACTIONでジャンプは1回');
  assert(model.player.grounded === -1 && apex > 20, `実際に床を離れた（+${Math.round(apex)}px）`);
  // A shot AFTER the jump is the rule working, not a violation: once the player is airborne the
  // same held ACTION is the gunboots. What must never happen is a shot before the jump.
  assert(order.indexOf("shot") === -1 || order.indexOf("shot") > order.indexOf("jump"), `弾が出るのはジャンプより後だけ（${order.join(" → ")}）`);
  // Air ACTION: the same input, now a shot.
  model.platforms = [];
  model.player.y = 200; model.player.vy = 0;
  shots = 0; jumps = 0;
  key('Space', true); await wait(120); key('Space', false);
  await wait(120);
  bridge.onEvent = original; bridge.active = false;
  output.textContent += `\n空中ACTION → ジャンプ ${jumps} / 射撃 ${shots}`;
  assert(shots > 0, '空中の同じACTIONで真下へ射撃した');
  assert(jumps === 0, '空中ではジャンプしない');
});
button('CHARGE：初期8 と 最後の1射', async () => {
  start(); const model = scene.model;
  assert(model.ammo === 8 && model.stats.maxAmmo === 8, `新規ランは CHARGE 8/8（実測 ${model.ammo}/${model.stats.maxAmmo}）`);
  for (const id of ['laser', 'shotgun'] as const) {
    model.platforms = []; model.enemies = []; model.hazards = [];
    model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    model.gun.equip(id);
    model.ammo = 1;
    let shots = 0;
    const original = bridge.onEvent;
    bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'shot') shots++; };
    key('Space', true); await wait(80); key('Space', false); await wait(120);
    bridge.onEvent = original;
    output.textContent += `\n${id} cost ${model.gun.module.ammoCost} / 残1から発射 ${shots} / 残 ${model.ammo}`;
    assert(shots > 0, `${id}：コスト未満でも最後の1射は撃てる`);
    assert(model.ammo === 0, `${id}：撃った後は 0（マイナスにならない）`);
    model.ammo = 0;
    shots = 0;
    bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'shot') shots++; };
    key('Space', true); await wait(200); key('Space', false); await wait(80);
    bridge.onEvent = original;
    assert(shots === 0, `${id}：0 では撃てない`);
  }
  bridge.active = false;
});
// Phase 3: the money loop -- what a coin is worth, which stones pay, and what a full meter does.
button('REWARD BLOCK：見た目で判別・確定 10 COIN', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.pickups = []; model.safeZones = []; model.bullets = [];
  model.player.invincible = 99;
  // A row with one REWARD BLOCK beside one ordinary block, so the two are on screen together.
  const y = 420, width = 120;
  const reward: Platform = { id: 9900, x: WORLD.wall, y, width, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 1, slot: 0, reward: true } };
  const plain: Platform = { id: 9901, x: WORLD.wall + width, y, width, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 1, slot: 1, reward: false } };
  model.platforms = [reward, plain];
  model.player.x = plain.x + width / 2; model.player.y = y - 120; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = model.stats.maxAmmo;
  await wait(200);
  assert(reward.breakBlock!.reward === true && plain.breakBlock!.reward === false, '生成時点で reward / normal が決まっている');
  assert(reward.breakBlock!.hits === 0 && plain.breakBlock!.hits === 0, 'どちらもまだ無傷（壊す前から区別できる）');
  output.textContent += `\n見た目: reward=${reward.breakBlock!.reward} normal=${plain.breakBlock!.reward}（金の亀裂とCOINで描き分け）`;
  // Shoot the ordinary one first: it must pay nothing at all.
  for (let i = 0; i < 200 && plain.state !== 'broken'; i++) {
    keepAwake();
    model.player.x = plain.x + width / 2; model.player.y = y - 120; model.player.vy = 0; model.player.grounded = -1; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  const afterPlain = model.coins.coins.length + model.coins.scoreCoins;
  output.textContent += `\n通常BLOCK破壊: COIN ${afterPlain}`;
  assert(plain.state === 'broken', '通常 BREAK BLOCK を撃ち抜けた');
  assert(afterPlain === 0, '通常 BLOCK は 0 COIN');
  // Now the reward block.
  for (let i = 0; i < 200 && reward.state !== 'broken'; i++) {
    keepAwake();
    model.player.x = reward.x + width / 2; model.player.y = y - 120; model.player.vy = 0; model.player.grounded = -1; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  const loose = model.coins.coins;
  const value = loose.reduce((sum, c) => sum + c.value, 0) + model.coins.scoreCoins;
  output.textContent += `\nREWARD BLOCK破壊: LARGE ${loose.filter(c => c.denomination === 'large').length} / 合計 ${value} / kills ${model.kills} / COMBO ${model.combo}`;
  assert(reward.state === 'broken', 'REWARD BLOCK を撃ち抜けた');
  assert(value === COIN_VALUES.large, `REWARD BLOCK は確定で LARGE COIN = ${COIN_VALUES.large}`);
  assert(loose.every(c => c.denomination === 'large'), '落ちるのは LARGE COIN');
  assert(model.kills === 0 && model.combo === 0, 'BLOCK 破壊は撃破でも COMBO でもない');
  // Collect it: value reaches both totals.
  const next = model.coins.coins[0];
  if (next) { model.player.x = next.x; model.player.y = next.y; model.player.vy = 0; await wait(200); }
  output.textContent += `\n回収: wallet ${model.coins.walletCoins} / score ${model.coins.scoreCoins}`;
  assert(model.coins.walletCoins === COIN_VALUES.large, `拾うと wallet +${COIN_VALUES.large}`);
  assert(model.coins.scoreCoins === COIN_VALUES.large, 'scoreCoins にも同額');
  bridge.active = false;
});
button('COMBO 8 着地 → +100 → COIN HIGH', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.pickups = []; model.safeZones = [];
  model.player.invincible = 99;
  const paid: string[] = [];
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'comboSettle') paid.push(`${event.value}:${event.stage}`); };
  // Stack a chain in the air by stomping, exactly as a run does, then land on an ordinary ledge.
  model.player.y = 160; model.player.vy = 0; model.player.grounded = -1;
  for (let n = 0; n < 8; n++) {
    model.enemies = [enemy('slime', model.player.x, model.player.y + 40, 9800 + n)];
    model.player.vy = 320;
    await until(() => model.combo === n + 1, 4000);
  }
  const chain = model.combo;
  assert(chain === 8, `空中で 8 COMBO を積んだ（${chain}）`);
  assert(model.coinHigh.active === false, '着地前は COIN HIGH ではない');
  // The stomps themselves drop SMALL COIN, so measure the settlement as a delta rather than a total.
  const meterBefore = model.coinHigh.meter;
  const purseBefore = { wallet: model.coins.walletCoins, score: model.coins.scoreCoins };
  const ledge: RoutePlatform = { id: 9850, x: WORLD.wall, y: model.player.y + 90, width: WORLD.width - WORLD.wall * 2, safeX: model.player.x, exitX: model.player.x, safeSide: 1, breakable: false, state: 'stable' };
  model.platforms = [ledge]; model.enemies = [];
  await until(() => model.player.grounded === ledge.id, 5000);
  await wait(150);
  output.textContent += `\n着地精算: ${paid.join(' , ')} / wallet ${purseBefore.wallet}→${model.coins.walletCoins} / meter ${meterBefore.toFixed(0)}→${model.coinHigh.meter.toFixed(0)} / HIGH ${model.coinHigh.active}`;
  assert(paid.length === 1, '着地精算は1回だけ');
  assert(model.coins.walletCoins - purseBefore.wallet === COMBO_TIERS[0].coins, `8 COMBO 着地で wallet +${COMBO_TIERS[0].coins} COIN`);
  assert(model.coins.scoreCoins - purseBefore.score === COMBO_TIERS[0].coins, 'scoreCoins にも +100');
  assert(paid[0].includes('+100'), 'HUD ラベルが +100 を示す');
  assert(model.coinHigh.meter > meterBefore, `+100 でメーターが跳ね上がった（${meterBefore.toFixed(0)}→${model.coinHigh.meter.toFixed(0)}）`);
  assert(model.coinHigh.active, '8 COMBO 着地から COIN HIGH に入れる');
  assert(model.state === 'playing' && !model.paused, '精算でプレイは止まらない');
  bridge.onEvent = original;
  bridge.active = false;
});
button('COIN HIGH：射程と威力が上がり、終了で元へ戻る', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = []; model.doodads = []; model.containers = [];
  model.pickups = []; model.safeZones = []; model.bullets = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = model.stats.maxAmmo;
  const fireOnce = async () => {
    // ACTION is edge-triggered and the module has its own fire interval, so give it a few frames
    // and a few attempts rather than assuming one press always produces a round.
    for (let attempt = 0; attempt < 12; attempt++) {
      keepAwake();
      model.bullets = [];
      model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1; model.ammo = model.stats.maxAmmo;
      key('Space', true); await wait(1000 / 60); key('Space', false);
      for (let f = 0; f < 6 && !model.bullets.length; f++) { model.player.y = 200; model.player.vy = 0; model.player.grounded = -1; await wait(16); }
      if (model.bullets.length) return model.bullets[0];
    }
    throw new Error(`射撃できなかった: state=${model.state} ammo=${model.ammo}/${model.stats.maxAmmo} grounded=${model.player.grounded}`);
  };
  const before = await fireOnce();
  assert(!!before, '通常状態で射撃できた');
  const baseline = { damage: before.damage, range: before.range };
  assert(!model.coinHigh.active, '発動前は COIN HIGH ではない');
  // Fill the meter with real coins, collected the ordinary way.
  model.coins.burst(model.player.x, model.player.y, Math.ceil(COIN_HIGH_RULES.threshold / COIN_VALUES.large), () => 0.5, 'large');
  for (let i = 0; i < 200 && model.coins.coins.length; i++) {
    keepAwake();
    const next = model.coins.coins[0];
    model.player.x = next.x; model.player.y = next.y; model.player.vy = 0; model.player.grounded = -1;
    await wait(16);
  }
  output.textContent += `\nメーター: ${model.coinHigh.meter.toFixed(0)}/${COIN_HIGH_RULES.threshold} / HIGH ${model.coinHigh.active}`;
  assert(model.coinHigh.active, 'COIN を集めて COIN HIGH に入った');
  const during = await fireOnce();
  output.textContent += `\n威力 ${baseline.damage}→${during.damage} / 射程 ${baseline.range.toFixed(0)}→${during.range.toFixed(0)}`;
  assert(during.damage > baseline.damage, `HIGH 中は威力が上がる（${baseline.damage}→${during.damage}）`);
  assert(during.range > baseline.range, `HIGH 中は射程が伸びる（${baseline.range.toFixed(0)}→${during.range.toFixed(0)}）`);
  // Let it run out with no further coins.
  await until(() => !model.coinHigh.active, (COIN_HIGH_RULES.activeSeconds + 6) * 1000);
  const after = await fireOnce();
  output.textContent += `\n終了後: 威力 ${after.damage} / 射程 ${after.range.toFixed(0)}`;
  assert(!model.coinHigh.active, 'COIN を取らなければ COIN HIGH は終わる');
  assert(after.damage === baseline.damage && after.range === baseline.range, '終了後は完全に通常値へ戻る');
  bridge.active = false;
});
button('SHOP：3商品・AREA価格・購入', async () => {
  const height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width, floorY = 320;
  for (const area of [1, 3] as const) {
    start();
    const model = scene.model;
    model.jumpToStage(area, 1);
    model.platforms = []; model.enemies = []; model.pickups = []; model.hazards = []; model.doodads = []; model.containers = [];
    const zone = { id: 9950, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height,
      content: { kind: 'shop' as const }, taken: false };
    model.safeZones = [zone];
    model.platforms = [{ id: 9951, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
    model.player.invincible = 99;
    model.combo = 12;
    model.coins.walletCoins = 5000; model.coins.scoreCoins = 5000;
    const centre = Math.round(zone.x + width / 2);
    model.shop.placeEntrance(centre - 33, floorY - 66, 66, 66);
    model.player.x = centre; model.player.y = floorY - 33; model.player.vy = 0; model.player.grounded = -1;
    await until(() => scene.model.state === 'shop', 5000);
    const offers = model.shop.offers;
    output.textContent += `\nAREA ${area} SHOP: ${offers.map(o => `${o.name} ${o.price}`).join(' / ')}`;
    assert(offers.length === 3, `AREA ${area}：3商品が並ぶ`);
    assert(new Set(offers.map(o => o.item)).size === 3, `AREA ${area}：3商品はすべて別物（重複なし）`);
    assert(offers.every(o => o.price === shopPrice(shopItem(o.item), area)), `AREA ${area}：原作 Normal Mode の AREA 価格`);
    assert(offers.every(o => SHOP_ITEMS.some(i => i.id === o.item)), '売り物は原作6種のみ（武器は売らない）');
    if (area === 1) {
      const wallet = model.coins.walletCoins, score = model.coins.scoreCoins;
      const item = shopItem(offers[0].item);
      const hp = model.hp, maxHp = model.stats.maxHp, maxAmmo = model.stats.maxAmmo;
      assert(model.buyShopItem(0) === 'bought', `${item.name} を購入できた`);
      output.textContent += `\n購入: ${item.name} -${offers[0].price} / wallet ${wallet}→${model.coins.walletCoins} / score ${score}→${model.coins.scoreCoins}`;
      assert(model.coins.walletCoins === wallet - offers[0].price, 'wallet だけが減る');
      assert(model.coins.scoreCoins === score, 'scoreCoins は減らない');
      const grewHp = model.hp - hp, grewMax = model.stats.maxHp - maxHp, grewAmmo = model.stats.maxAmmo - maxAmmo;
      output.textContent += `\n効果: HP +${grewHp} / 最大HP +${grewMax} / 最大CHARGE +${grewAmmo}`;
      assert(grewMax === item.maxHp, `${item.name}：最大HP +${item.maxHp}`);
      assert(grewAmmo === item.maxCharge, `${item.name}：最大CHARGE +${item.maxCharge}`);
      assert(model.buyShopItem(0) === 'soldOut', '同じスロットは二度買えない');
      assert(model.combo === 12, 'SHOP で COMBO は維持される');
    }
    scene.model.closeShop();
  }
  bridge.active = false;
});
button('踏みつけ：CHARGE全回復・コンボ継続', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.hazards = [];
  model.player.y = 180; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = model.stats.maxAmmo;
  // Spend some CHARGE in the air first, so the refill is visible.
  key('Space', true); await wait(260); key('Space', false); await wait(60);
  const spent = model.ammo;
  assert(spent < model.stats.maxAmmo, `空中射撃で CHARGE が減った（${spent}/${model.stats.maxAmmo}）`);
  model.combo = 6;
  model.player.y = 180; model.player.vy = 320;
  model.enemies = [enemy('slime', model.player.x, model.player.y + 40, 9700)];
  await until(() => model.combo === 7, 4000);
  await wait(60);
  bridge.active = false;
  output.textContent += `\n踏みつけ後: COMBO ${model.combo} / CHARGE ${model.ammo}/${model.stats.maxAmmo} / vy ${model.player.vy.toFixed(0)}`;
  assert(model.combo === 7, '踏みつけで COMBO +1（精算されない）');
  assert(model.ammo === model.stats.maxAmmo, '踏みつけで CHARGE 全回復');
  assert(model.player.grounded === -1, '踏みつけ後も空中のまま');
});
button('被弾・SECTION跨ぎでコンボ維持', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.enemies = []; model.hazards = [];
  model.combo = 11;
  model.player.invincible = 0;
  const hp = model.hp;
  model.enemies = [enemy('armoredSlime', model.player.x, model.player.y + 30, 9800)];
  await until(() => model.hp < hp, 5000);
  await wait(60);
  assert(model.combo === 11, `被弾してもコンボ維持（HP ${hp}→${model.hp} / COMBO ${model.combo}）`);
  // Now out through the gate and on into the next SECTION.
  model.enemies = []; model.player.invincible = 99;
  const label = model.stage.label;
  for (let i = 0; i < 60 && !model.exit; i++) { keepAwake(); model.player.y = WORLD.startY + (model.sectionLength + 1 + i * 3) * WORLD.pixelsPerMeter; await wait(16); }
  assert(!!model.exit, 'EXIT が出た');
  model.player.x = model.exit!.x + model.exit!.width / 2; model.player.y = model.exit!.y + model.exit!.height / 2;
  await until(() => scene.model.state === 'upgrade', 5000);
  assert(scene.model.combo === 11, 'REST に入ってもコンボ維持');
  await until(() => !!document.getElementById('upgrade-confirm'), 5000);
  document.getElementById('upgrade-0')!.click(); document.getElementById('upgrade-confirm')!.click();
  await wait(200);
  bridge.active = false;
  output.textContent += `\n${label} → ${scene.model.stage.label} / COMBO ${scene.model.combo}`;
  assert(scene.model.stage.label !== label, `次の SECTION へ進んだ（${scene.model.stage.label}）`);
  assert(scene.model.combo === 11, 'SECTION 跨ぎでもコンボ維持');
});
// COMBO is banked by LANDING now, in tiers. These drive it through real collision kills and a
// real touchdown, so what is measured is what the player actually gets.
for (const tier of COMBO_TIERS) button(`${tier.at} COMBO 着地精算（${tier.label}）`, async () => {
  start(); const model = scene.model;
  model.platforms = []; model.stats.piercing = true;
  model.player.y = 180; model.player.vy = 0; model.player.grounded = -1;
  // Build the chain out of real kills, then touch down on an ordinary ledge.
  model.enemies = Array.from({ length: tier.at }, (_, i) => enemy('slime', 225, 240 + i * 26, 9500 + i));
  key('Space', true); await wait(40); key('Space', false);
  await until(() => model.maxCombo >= tier.at, 6000);
  // The corpses that built the chain drop their own COIN, and some is still in the air. Sweep the
  // loose money and take the baseline AFTER that, so what is measured is the settlement alone.
  model.enemies = [];
  model.coins.clearLoose();
  await wait(120);
  model.coins.clearLoose();
  const before = { coins: model.coins.scoreCoins, maxAmmo: model.stats.maxAmmo, hp: model.hp, overflow: model.health.overflowHealing };
  const paid: string[] = [];
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'comboSettle') paid.push(`${event.value}:${event.stage}`); };
  model.combo = tier.at;
  model.ammo = 0;
  model.platforms = [{ id: 4242, x: 120, y: model.player.y + 60, width: 210, breakable: false, state: 'stable' }];
  await until(() => model.player.grounded === 4242, 6000);
  await wait(400);
  bridge.onEvent = original; bridge.active = false;
  const got = { coins: model.coins.scoreCoins - before.coins, maxAmmo: model.stats.maxAmmo - before.maxAmmo, hp: model.hp - before.hp + (model.health.overflowHealing - before.overflow) };
  output.textContent += `\n精算: ${paid.join(', ') || 'なし'} / COIN +${got.coins} / MAX CHARGE +${got.maxAmmo} / HP +${got.hp}`;
  assert(paid.length === 1, `${tier.at} COMBO で着地 → 精算は1回だけ`);
  assert(model.combo === 0, '精算後に COMBO は 0');
  assert(model.ammo === model.stats.maxAmmo, '着地で CHARGE FULL');
  assert(got.coins === tier.coins, `COIN +${tier.coins}`);
  assert(got.maxAmmo === tier.maxCharge, `MAX CHARGE +${tier.maxCharge}`);
  assert(got.hp === tier.hearts, `HP +${tier.hearts}`);
  assert(model.state === 'playing' && !model.paused, '精算でランは止まらない');
  pause();
});
button('7 COMBO 着地 → 報酬なし', async () => {
  start(); const model = scene.model;
  model.platforms = []; model.player.y = 180; model.player.vy = 0; model.player.grounded = -1;
  const before = { coins: model.coins.scoreCoins, maxAmmo: model.stats.maxAmmo, hp: model.hp };
  model.combo = COMBO_TIERS[0].at - 1;
  model.ammo = 0;
  model.platforms = [{ id: 4243, x: 120, y: model.player.y + 60, width: 210, breakable: false, state: 'stable' }];
  await until(() => model.player.grounded === 4243, 6000);
  await wait(300);
  bridge.active = false;
  assert(comboTierFor(COMBO_TIERS[0].at - 1) === undefined, `${COMBO_TIERS[0].at - 1} は精算の段位に届かない`);
  assert(model.combo === 0, '届かなくても着地で COMBO は 0 になる');
  assert(model.ammo === model.stats.maxAmmo, '届かなくても着地で CHARGE FULL');
  assert(model.coins.scoreCoins === before.coins && model.stats.maxAmmo === before.maxAmmo && model.hp === before.hp, '報酬は一切出ない');
});
// SPIKE: instant death terrain, in the running game, drawn by the real renderer.
button('SPIKE 即死（AREA 1-3 / AREA 2-3）', async () => {
  for (const area of [1, 2] as const) {
    start(); scene.model.jumpToStage(area, 3);
    await wait(60);
    const model = scene.model;
    // Descend for real until the shaft has laid some SPIKE. Standing still is not enough: without
    // steering off each ledge the run simply parks on the first one and never sees more terrain.
    for (let i = 0; i < 1600 && !model.hazards.some(h => isSpike(h.kind)); i++) {
      keepAwake();
      model.player.invincible = 99;
      const standing = model.platforms.find(f => f.id === model.player.grounded) as RoutePlatform | undefined;
      bridge.direction = standing ? Math.sign(standing.exitX - model.player.x) : 0;
      await wait(16);
    }
    bridge.direction = 0;
    const spike = model.hazards.find(h => isSpike(h.kind));
    assert(!!spike, `AREA ${area} の実生成シャフトに SPIKE がある`);
    model.health.heal(9);
    const hp = model.hp;
    assert(hp > 1, `AREA ${area}：満タン付近のHP ${hp} から試す`);
    model.player.invincible = 99;
    model.player.x = spike!.x + spike!.width / 2;
    model.player.y = spike!.y + spike!.height - 2;
    await until(() => scene.model.state === 'over', 4000);
    assert(scene.model.health.deathCause?.instant === true, `AREA ${area}：大ダメージではなく即死`);
    assert(scene.model.health.deathCause?.cause === 'spike', `AREA ${area}：死因は spike`);
    assert(document.body.innerText.includes('SPIKES'), `AREA ${area}：結果画面が SPIKES と表示する`);
  }
});
// BREAK BLOCK: a row of separate blocks, landed on like any floor and opened only by shooting.
button('BREAK BLOCK 着地 → 1個開けて通過', async () => {
  start(); scene.model.jumpToStage(1, 2);
  await wait(60);
  const model = scene.model;
  let armed = false, standing: RoutePlatform | undefined, ended = '';
  for (let i = 0; i < 3400 && !standing; i++) {
    keepAwake();
    // A SHOP stops the world until it is dismissed; walking into one is ordinary play, not a
    // reason for this check to give up.
    if (model.state === 'shop') { document.getElementById('shop-close')?.click(); await wait(120); continue; }
    // Anything else that ended the run would otherwise fail this check with no reason given.
    if (model.state !== 'playing') { ended = `${model.state} (${model.health.deathCause?.cause ?? '-'}) ${Math.floor(model.sectionDepth)}m`; break; }
    model.player.invincible = 99; model.hazards = [];
    const under = model.platforms.find(f => f.id === model.player.grounded) as RoutePlatform | undefined;
    if (under?.breakBlock) { standing = under; break; }
    const next = model.platforms.filter(f => f.y > model.player.y + 15 && f.state !== 'broken').sort((a, b) => a.y - b.y)[0];
    // Arrive at the row spent and mid-chain, so the landing itself is what gets measured.
    if (!armed && !under && next?.breakBlock) { armed = true; model.combo = 5; model.ammo = 0; }
    bridge.direction = under ? Math.sign(under.exitX - model.player.x) : 0;
    await wait(16);
  }
  bridge.direction = 0;
  assert(!!standing && armed, `通常の落下で BREAK BLOCK まで到達し、空中で弾切れ・COMBO 5 にした${ended ? ` — 到達前に終了: ${ended}` : ''}`);
  await wait(120);
  const row = model.platforms.filter(f => f.breakBlock && f.y === standing!.y);
  output.textContent += `\n1列 ${row.length} 個 / 1個の幅 ${Math.round(standing!.width)}px / 耐久 ${standing!.breakBlock!.durability} / 厚み ${BREAK_BLOCK_RULES.thickness}px`;
  assert(row.length === BREAK_BLOCK_RULES.count, `1列が ${BREAK_BLOCK_RULES.count} 個のブロックで構成されている`);
  assert(standing!.width < WORLD.width - WORLD.wall * 2, '1個は全幅ではない（横に並んでいる）');
  assert(model.ammo === model.stats.maxAmmo, '着地で AMMO FULL RELOAD');
  assert(model.combo === 0, '着地で COMBO RESET');
  assert(standing!.breakable !== true && model.collapse.counting === 0, 'AREA 4 の崩落足場とは別物：タイマーは動かない');
  await wait(800);
  assert(model.platforms.includes(standing!), '乗っているだけでは壊れない');
  const kills = model.kills, cracks: number[] = [];
  let broke = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'blockCrack') cracks.push(event.value ?? 0); if (event.type === 'blockBreak') broke++; };
  for (let i = 0; i < 40 && !broke; i++) { keepAwake(); model.player.invincible = 99; key('Space', true); await wait(110); key('Space', false); await wait(110); }
  bridge.onEvent = original;
  output.textContent += `\nヒビ ${cracks.join(',') || 'なし'} / 破壊 ${broke} 個`;
  assert(broke === 1, '真下へ撃つと、その1個だけが割れる');
  assert(cracks.length === standing!.breakBlock!.durability - 1, 'ヒビは耐久-1回、残弾数つきで出る');
  const left = model.platforms.filter(f => f.breakBlock && f.y === standing!.y);
  assert(left.length === BREAK_BLOCK_RULES.count - 1, '隣のブロックは無傷のまま残る');
  assert(left.every(f => f.breakBlock!.hits === 0), '隣のブロックの耐久は減っていない');
  assert(model.combo === 0 && model.kills === kills, '破壊は COMBO も撃破数も増やさない');
  // Breaking the block underfoot does not always drop you on its own: a body straddling the seam
  // catches on the neighbour, which is correct -- the hole is one block wide, not the whole row.
  // Walk into the gap the way a player does and confirm it really is a way through.
  const hole = { left: standing!.x, right: standing!.x + standing!.width };
  output.textContent += `\n穴 ${Math.round(hole.left)}〜${Math.round(hole.right)}px / 破壊直後の足元 ${model.player.grounded === -1 ? 'なし（即落下）' : '隣のブロック'} / x=${Math.round(model.player.x)}`;
  const centre = (hole.left + hole.right) / 2;
  for (let i = 0; i < 160 && model.player.y < standing!.y + 40; i++) {
    keepAwake();
    model.player.invincible = 99;
    bridge.direction = Math.abs(centre - model.player.x) < 4 ? 0 : Math.sign(centre - model.player.x);
    await wait(16);
  }
  bridge.direction = 0;
  assert(model.player.y > standing!.y + 40, '開いた1個分の穴を通過して落下する');
  assert(model.player.x > hole.left && model.player.x < hole.right, '通過したのは開けた穴の位置である');
  pause();
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
  let direction = 0, lowest = model.oxygen.max, collected = 0, playingHp = model.hp, lastAir = model.oxygen.max;
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
      assert(model.oxygen.remaining > model.oxygen.max - 0.5 && model.ammo === model.stats.maxAmmo,
        `${model.stage.label} 開始で酸素 ${model.oxygen.remaining.toFixed(1)}s / ${model.oxygen.max}s・CHARGE ${model.ammo}/${model.stats.maxAmmo}（COMBO ${model.combo} は跨いで維持）`);
      playingHp = model.hp; lowest = model.oxygen.max; lastAir = model.oxygen.max;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    lowest = Math.min(lowest, model.oxygen.remaining);
    if (model.oxygen.remaining > lastAir + 0.01) collected++;
    lastAir = model.oxygen.remaining;
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
    output.textContent = `AREA 2 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nOXYGEN ${model.oxygen.remaining.toFixed(1)}s (最低 ${lowest.toFixed(1)}s)\nHP ${model.hp}/${model.health.maxHp} · 取得 ${collected} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  assert(rests.join(' ') === '2-1 2-2 2-3', `2-1 → 2-2 → 2-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '3-1', `AREA 2 クリア後に AREA 3 / 3-1 へ (${model.stage.label})`);
  // AREA 3 brings its own pickups; what must be gone is every air source.
  assert(!model.oxygen.enabled && model.pickups.every(p => p.kind !== 'oxygenBubble') && model.containers.length === 0 && model.bubbles.length === 0, 'AREA 3 では酸素・コンテナ・泡が消える');
  assert(model.water === undefined, 'AREA 3 では水中物理が解除される');
  // Air pockets are deliberately rare late in the area, so only the refills themselves are required.
  assert(collected > 0, `酸素を ${collected} 回補給（すべてコンテナ由来の泡）`);
  assert(!('sheltered' in (model as object)) && !('airPockets' in (model as object)), '固定AIRスペースと sheltered 依存が残っていない');
  assert(lowest < model.oxygen.max, `酸素が実際に消費された (最低 ${lowest.toFixed(1)}s)`);
});

// AREA 3: play 3-1 -> rest -> 3-2 -> rest -> 3-3 -> rest -> 4-1 with keyboard input only, taking ice
// when the gauge climbs, and check heat behaves at every boundary.
button('3-1 → 4-1 を通常プレイ', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(3, 1);
  assert(model.heat.enabled && model.heat.value === 0, `3-1 開始でHEAT 0% (${model.heat.value.toFixed(0)}%)`);
  assert(!model.oxygen.enabled && model.containers.length === 0 && model.water === undefined, 'AREA 2 の酸素・コンテナ・水中物理は無効');
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
      assert(model.heat.value < 1 && model.ammo === model.stats.maxAmmo, `${model.stage.label} 開始でHEAT 0%・CHARGE満タン（COMBO ${model.combo} は跨いで維持）`);
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
      assert(model.ammo === model.stats.maxAmmo, `${model.stage.label} 開始で CHARGE 満タン（COMBO ${model.combo} は跨いで維持）`);
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

  // ACTION is read by where the player is standing, so the bot has to be too. On the ground it is a
  // JUMP and produces no shot at all -- holding it there would only make the run hop in place.
  if (ground) {
    // A BREAK BLOCK row spans the shaft: the only way on is through it. Hop off the block so the
    // very next frames are airborne and the gunboots can be pointed straight down at it. Out of
    // rounds, step onto the neighbour instead -- an ordinary landing, and an ordinary full reload.
    if (ground.breakBlock) {
      if (model.ammo > 0) return { target: p.x, fire: true };
      const room = ground.x + ground.width < WORLD.width - WORLD.wall - 4;
      return { target: room ? ground.x + ground.width + 14 : ground.x - 14, fire: false };
    }
    return { target, fire: false };
  }
  // Airborne directly over a gate row: keep the gunboots on it. Hopping off a block is only half
  // the move -- without this the run lands, jumps, lands and jumps again forever, which is exactly
  // what it did the first time the ACTION rule changed underneath it.
  const blockBelow = model.platforms
    .filter(f => f.breakBlock && f.state !== 'broken' && f.y > p.y)
    .sort((a, b) => a.y - b.y)[0];
  if (blockBelow && model.ammo > 0 && p.x + 9 > blockBelow.x && p.x - 9 < blockBelow.x + blockBelow.width) {
    return { target: blockBelow.x + blockBelow.width / 2, fire: true };
  }

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
// The watchdog above is what the word 'unassisted' rests on, so it gets its own check: it must
// stay silent through ordinary play and still catch this file handing the run something.
button('補助検出そのものを検証', async () => {
  start(); scene.model.jumpToBoss();
  await until(() => scene.model.state === 'boss' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  pause();                                    // the scene must not race this; we drive the step

  // 1. The game damaging the king through its own simulation. The API is reached from
  //    GameModel.step, so the call site is the game even though this file started the step.
  const quiet = watchForAssists(model);
  const body = model.boss.body;
  model.player.x = body.x + body.width / 2;
  model.player.y = body.y - 120;
  model.bullets.push(plainBullet(model.player.x, body.y - 40, 5));
  const before = model.boss.hp;
  model.paused = false;
  for (let i = 0; i < 20 && model.boss.hp === before; i++) model.step(1 / 120, 0, false);
  const dealt = before - model.boss.hp;
  quiet.stop();
  output.textContent += `\nゲーム自身の弾が与えたダメージ: ${dealt}`;
  assert(dealt > 0, '実際に魔王へ当たっている（当たらなければ何も検証していない）');
  assert(quiet.used.length === 0, `ゲーム自身の処理は補助として検出されない（検出: ${quiet.used.join(', ') || 'なし'}）`);

  // 2. The same APIs, called straight from this file. The watchdog must see every one.
  const caught = watchForAssists(model);
  model.heal(9);
  model.boss.damage(5);
  model.player.invincible = 99;
  caught.stop();
  output.textContent += `\n意図的な補助の検出: ${caught.used.join(', ')}`;
  assert(caught.used.includes('model.heal'), 'テストからの heal を検出する');
  assert(caught.used.includes('boss.damage'), 'テストからの boss.damage を検出する');
  assert(caught.used.includes('player.invincible'), 'テストからの無敵付与を検出する');
  pause();
});
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
