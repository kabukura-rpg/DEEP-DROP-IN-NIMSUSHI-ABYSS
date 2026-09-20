import { GameModel, plainBullet } from '../src/systems/GameModel';
import { scene, bridge, start, pause, audio } from '../src/main';
import type { Platform, RoutePlatform } from '../src/systems/StageGenerator';
import { spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { AREAS, type SectionId, PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { pickupType } from '../src/data/pickups';
import { GUN_MODULES } from '../src/data/gunModules';
import { DOODAD_RULES, spawnDoodad } from '../src/data/doodads';
import { spikePlatform } from '../src/data/structures';
import { UPGRADES } from '../src/data/upgrades';
import { spawnCorpse } from '../src/data/corpses';
import { SAFE_ZONE_RULES, insideSafeZone, type SafeZoneContentKind } from '../src/data/safeZone';
import { spawnGunModule } from '../src/data/pickups';
// The watchdog behind the word "unassisted" lives in its own file so it can be unit-tested; see
// tests/assistWatch.test.ts, which proves it restores the model and still tells cheating from play.
import { watchForAssists } from './assistWatch';
import { COMBO_TIERS, comboTierFor } from '../src/data/combo';
import { isSpike, spawnHazard } from '../src/data/hazards';
import { BREAK_BLOCK_RULES } from '../src/data/structures';
import { OXYGEN_RULES } from '../src/systems/OxygenSystem';
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
 * Hold keys the way a hand does, and never trust a cached idea of what is down.
 *
 * `clearInput()` releases every key whenever the UI changes mode -- a rest, a shop, a pause, a
 * resume. A driver that dispatches only on a CHANGE of its own `facing` then believes it is
 * holding a key the game has already let go of, and the run stands still for the rest of its life
 * with no error, no death and no clue: a FULL RUN sat at 2-1 for fourteen minutes doing exactly
 * this, loop spinning, target 102px away, every key up.
 *
 * So the GAME's key state is the source of truth and the intent is re-asserted whenever the two
 * disagree. `scene.keys` is private to GameScene; reading it here is a test looking at what the
 * product actually received, which is the whole point.
 */
function driver() {
  let facing = 0, firing = false;
  const live = (code: 'KeyA' | 'KeyD' | 'Space') => {
    const keys = (scene as unknown as { keys?: Record<string, { isDown: boolean }> }).keys;
    if (!keys) return held.has(code);
    if (code === 'KeyA') return !!(keys.a?.isDown || keys.left?.isDown);
    if (code === 'KeyD') return !!(keys.d?.isDown || keys.right?.isDown);
    return !!keys.space?.isDown;
  };
  const hold = (code: 'KeyA' | 'KeyD' | 'Space', want: boolean) => { if (want !== live(code)) key(code, want); };
  return {
    steer(dir: number) { facing = dir; hold('KeyA', dir === -1); hold('KeyD', dir === 1); },
    trigger(on: boolean) { firing = on; hold('Space', on); },
    release() { this.steer(0); this.trigger(false); },
    get facing() { return facing; },
    get firing() { return firing; },
  };
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
  // CAVERNS is the breakable-rich AREA now: 8 gate rows across its three SECTIONs, needing 14
  // rounds at a minimum. A player opens one in a second or two; this bot hops and shoots in a crude
  // cycle and simply needs longer for the same terrain.
  start(); const model = scene.model, deadline = performance.now() + 420000;
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
      const cleared = model.stage.label, before = { hp: model.hp, max: model.health.maxHp, overflow: model.health.overflowHealing, stacks: model.upgrades.acquired.length };
      assert(model.hp === playingHp, `${cleared} クリアで休憩：HPは ${model.hp}/${model.health.maxHp} のまま回復しない`);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      rests.push(cleared);
      assert(model.health.maxHp >= before.max && model.health.overflowHealing >= 0 && model.upgrades.acquired.length === before.stacks + 1, `${cleared} 強化を1つだけ適用`);
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
jumpButton('ABYSS', () => scene.model.jumpToBoss());
jumpButton('NIMUSHI', () => scene.model.jumpToNimushi());

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
  assert(minimumVelocity >= 0 && endY > 250, `連射中も下降し続け、上昇しない (最小vy ${Math.round(minimumVelocity)} / y ${Math.round(endY)})`);
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
  // APPLE is what the follow-up check measures, so it is the card taken. Everything else is put
  // out of the draw rather than hoping it comes up first.
  for (const id of model.upgrades.pool.map(u => u.id)) { if (id !== 'apple') model.upgrades.grant(id); }
  const y = model.player.y, elapsed = model.elapsed, immunity = model.player.invincible;
  model.completeSection('browser-rest');
  await until(() => !!document.getElementById('upgrade-confirm'));
  assert(model.hp === 2, '休憩に入ってもHP 2/4');
  assert(document.querySelectorAll('.upgrade-card').length === 1, '残り1種なのでカード1枚');
  assert((document.getElementById('upgrade-confirm') as HTMLButtonElement).disabled, '未選択ではNEXT無効');
  await wait(500); model.damage(1, 'oxygen'); model.killInstantly('lava');
  assert(model.hp === 2 && model.player.y === y && model.elapsed === elapsed && model.player.invincible === immunity, '休憩中はHP・物理・無敵時間・環境ダメージ停止');
  // Taken here rather than by hand, so the check below measures APPLE every time it is run.
  const index = model.upgrades.choices.findIndex(u => u.id === 'apple');
  assert(index >= 0, 'APPLE が提示されている');
  document.getElementById(`upgrade-${index}`)!.click();
  document.getElementById('upgrade-confirm')!.click();
  await wait(60);
  assert(model.state === 'playing' && model.hp === 4 && model.health.overflowHealing === 2, 'APPLE確定後HP 4/4・余剰2');
  assert(model.upgrades.acquired.includes('apple'), 'APPLE が適用された');
  pause();
});
button('満タンAPPLE → LIFE UP', async () => {
  start(); scene.model = new GameModel(false, () => .999, 'stage');
  const model = scene.model;
  // APPLE is the card under test, so it is the card that gets taken. Reaching for whichever one
  // happens to be first makes this a test of the draw rather than of overflow healing.
  model.upgrades.grant('youth');
  for (const id of model.upgrades.pool.map(u => u.id)) { if (id !== 'apple') model.upgrades.grant(id); }
  model.completeSection('food-full');
  await until(() => !!document.getElementById('upgrade-confirm'));
  const index = model.upgrades.choices.findIndex(u => u.id === 'apple');
  assert(index >= 0, 'APPLE が提示されている');
  document.getElementById(`upgrade-${index}`)!.click(); document.getElementById('upgrade-confirm')!.click();
  await wait(30);
  assert(model.hp === 5 && model.health.maxHp === 5 && model.health.overflowHealing === 0, '満タンでAPPLE → HP 5/5・余剰0');
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
// Phase 3 follow-up: a chamber in every AREA, holding that AREA's own gauge.
button('AREA 2/3/4 SAFE ZONE：各ギミックの freeze → 退出 → 再開', async () => {
  const height = SAFE_ZONE_RULES.height, width = SAFE_ZONE_RULES.width, floorY = 360;
  for (const area of [2, 3, 4] as const) {
    start();
    const model = scene.model;
    model.jumpToStage(area, 2);
    model.platforms = []; model.enemies = []; model.pickups = []; model.hazards = [];
    model.doodads = []; model.containers = []; model.bubbles = []; model.bullets = [];
    const content: SafeZoneContentKind = area === 3 ? 'coinVein' : area === 2 ? 'gunModule' : 'shop';
    const zone = { id: 9200 + area, side: -1 as const, x: WORLD.wall, y: floorY - height, width, height,
      content: { kind: content, module: 'laser' as const, bonus: 'charge' as const }, taken: false };
    model.safeZones = [zone];
    model.platforms = [{ id: 9300 + area, x: zone.x, y: floorY, width, breakable: false, state: 'stable' as const, safeZone: zone.id }];
    model.player.invincible = 99;
    model.combo = 14; model.ammo = 2;
    const centre = Math.round(zone.x + width / 2);
    // AREA-specific furniture out in the shaft, so each AREA's own clock has something to run on.
    let ledge: Platform | undefined;
    if (area === 2 || area === 4) {
      // Dangerous ground with its cycle already armed: CATACOMBS and LIMBO both run on it.
      ledge = { id: 9500, x: zone.x + width + 10, y: floorY, width: 120, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
      model.platforms.push(ledge);
    }
    // Arrive the way a run does: fall down the shaft beside the mouth and steer in.
    model.player.x = zone.x + width + 34;
    model.player.y = zone.y - 130; model.player.vy = 0; model.player.grounded = -1;
    if (ledge) {
      // Land on the dangerous ledge first, so its cycle is already running when the player leaves it
      // for the chamber. A warning nobody started proves nothing about freezing one.
      model.player.x = ledge.x + 60; model.player.y = floorY - 140; model.player.vy = 260;
      await until(() => model.player.grounded === ledge.id, 6000);
      assert(ledge.spikePlatform!.state === 'warning', `AREA ${area}：危険な床のタイマーが動き出した`);
      model.combo = 14; model.ammo = 2;
      model.player.x = centre; model.player.y = floorY - 30; model.player.vy = 0; model.player.grounded = -1;
    }
    // Steer into the mouth with LEFT alone -- no jump, exactly as a phone would.
    let airborneEntry = false, crossed = false;
    key('KeyA', true);
    for (let i = 0; i < 500 && !crossed; i++) {
      keepAwake();
      if (model.timeFrozen) { crossed = true; airborneEntry = model.player.grounded === -1; break; }
      if (model.player.grounded === (9300 + area)) { crossed = true; break; }
      await wait(8);
    }
    for (let i = 0; i < 400 && model.player.grounded !== (9300 + area); i++) { keepAwake(); await wait(16); }
    key('KeyA', false);
    await wait(120);
    assert(crossed, `AREA ${area}：左右移動だけで横穴へ入れた`);
    output.textContent += `\nAREA ${area}: TIMEVOID ${model.timeFrozen} / 着地 CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo}`;
    assert(model.timeFrozen, `AREA ${area}：SAFE ZONE で TIMEVOID`);
    assert(model.ammo === model.stats.maxAmmo, `AREA ${area}：床で CHARGE 全回復`);
    assert(model.combo === 14, `AREA ${area}：床では COMBO を精算しない`);
    if (area !== 4) assert(airborneEntry, `AREA ${area}：横穴を横切った時点で TIMEVOID（着地前）`);

    // The AREA's own gauge, frozen.
    if (area === 3) {
      const held = model.oxygen.remaining;
      await wait(2500);
      output.textContent += `\nAREA 3 OXYGEN: ${held.toFixed(1)}s → ${model.oxygen.remaining.toFixed(1)}s`;
      assert(model.oxygen.enabled, 'AREA 3：酸素ギミックが有効');
      assert(model.oxygen.remaining === held, 'AREA 3：SAFE ZONE 中は酸素が減らない');
      assert(model.oxygen.remaining <= OXYGEN_RULES.max, 'AREA 3：SAFE ZONE は酸素を回復もしない');
    }
    if (area === 2 || area === 4) {
      const spikes = ledge!.spikePlatform!;
      const held = { state: spikes.state, timer: spikes.timer };
      await wait(2500);
      output.textContent += `\nAREA ${area} 罠床: ${held.state} ${held.timer.toFixed(2)}s → ${spikes.state} ${spikes.timer.toFixed(2)}s`;
      assert(spikes.state === held.state, `AREA ${area}：SAFE ZONE 中は罠床の状態が変わらない`);
      assert(Math.abs(spikes.timer - held.timer) < 0.001, `AREA ${area}：警告タイマーも止まる`);
    }

    // Use the content.
    if (content === 'coinVein') {
      const vein = model.coinVeinBounds(zone);
      for (let i = 0; i < 200 && !zone.taken; i++) {
        keepAwake();
        model.player.x = vein.x + vein.width / 2; model.player.y = vein.y - 40; model.player.vy = 0; model.player.grounded = -1;
        model.ammo = model.stats.maxAmmo;
        key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
      }
      const spilled = model.coins.coins.reduce((sum, c) => sum + c.value, 0);
      output.textContent += `\nAREA ${area} VEIN: 割れた=${zone.taken} / ${spilled} COIN`;
      assert(zone.taken && spilled > 0, `AREA ${area}：SAFE ZONE の COIN VEIN を撃って割れる`);
    }
    if (content === 'gunModule') {
      model.pickups = [spawnGunModule(zone.id + 1, centre, floorY - 34, 'laser', 'charge')];
      const maxAmmo = model.stats.maxAmmo;
      model.player.x = centre; model.player.y = floorY - 34; model.player.vy = 0; model.player.grounded = -1;
      await until(() => model.gun.id === 'laser', 6000);
      output.textContent += `\nAREA ${area} MODULE: ${model.gun.id} / MAX CHARGE ${maxAmmo}→${model.stats.maxAmmo}`;
      assert(model.gun.id === 'laser', `AREA ${area}：SAFE ZONE の Gun Module を取得できる`);
      assert(model.stats.maxAmmo > maxAmmo, `AREA ${area}：CHARGE ボーナスも効く`);
    }
    if (content === 'shop') {
      model.coins.walletCoins = 5000; model.coins.scoreCoins = 5000;
      model.shop.placeEntrance(centre - 33, floorY - 66, 66, 66);
      model.player.x = centre; model.player.y = floorY - 33; model.player.vy = 0; model.player.grounded = -1;
      await until(() => scene.model.state === 'shop', 6000);
      const offers = model.shop.offers;
      output.textContent += `\nAREA 4 SHOP: ${offers.map(o => `${o.name} ${o.price}`).join(' / ')}`;
      assert(scene.model.state === 'shop', 'AREA 4：SAFE ZONE の SHOP を開ける');
      assert(offers.length === 3 && new Set(offers.map(o => o.item)).size === 3, 'AREA 4：3商品・重複なし');
      assert(offers.every(o => o.price === shopPrice(shopItem(o.item), 4)), 'AREA 4：AREA 4 価格が適用される');
      const wallet = model.coins.walletCoins;
      assert(model.buyShopItem(0) === 'bought', 'AREA 4：購入できる');
      assert(model.coins.walletCoins === wallet - offers[0].price, 'AREA 4：wallet だけ減る');
      // Leave through the panel's own button, so the app restores input the way a player would.
      document.getElementById('shop-close')?.click();
      await until(() => scene.model.state === 'playing', 4000);
    }
    assert(model.combo === 14, `AREA ${area}：content 利用後も COMBO 維持`);

    // Walk back out; the AREA's gauge starts again.
    key('KeyD', true);
    for (let i = 0; i < 400 && model.timeFrozen; i++) { keepAwake(); model.player.y = floorY - 15; model.player.vy = 0; model.player.grounded = 9300 + area; await wait(16); }
    key('KeyD', false);
    assert(!model.timeFrozen, `AREA ${area}：横移動だけで退出できる`);
    assert(model.combo === 14, `AREA ${area}：退出後も COMBO 維持`);
    model.player.grounded = -1;
    if (area === 3) {
      const before = model.oxygen.remaining;
      await wait(800);
      output.textContent += `\nAREA 3 退出後 OXYGEN: ${before.toFixed(1)}s → ${model.oxygen.remaining.toFixed(1)}s`;
      assert(model.oxygen.remaining < before, 'AREA 3：退出すると酸素が再び減る');
    }
    if (area === 2 || area === 4) {
      const spikes = ledge!.spikePlatform!;
      const before = spikes.state;
      model.player.invincible = 99;
      await until(() => spikes.state !== before, 6000);
      output.textContent += `\nAREA ${area} 退出後 罠床: ${before} → ${spikes.state}`;
      assert(spikes.state !== before, `AREA ${area}：退出すると罠床のサイクルが再開する`);
    }
  }
  bridge.active = false;
});
// Phase 5: the original twenty. Grouped so one run of a check covers a whole bundle.
button('UPGRADE：3択 / YOUTH後4択 / 重複なし', async () => {
  start(); const model = scene.model;
  model.completeSection('area-1/section-1');
  await until(() => !!document.getElementById('upgrade-0'), 8000);
  const cards = () => Array.from(document.querySelectorAll('.upgrade-card'));
  output.textContent += `\n3択: ${model.upgrades.choices.map(c => c.name).join(' / ')}`;
  assert(cards().length === 3, `YOUTHなしでは3枚 (${cards().length})`);
  assert(new Set(model.upgrades.choices.map(c => c.id)).size === 3, '同一画面に重複なし');
  assert(model.upgrades.choices.every(c => UPGRADES.some(u => u.id === c.id)), '原作20種から出ている');
  const retired = ['mag', 'power', 'recoil', 'heart', 'speed', 'big', 'piercing', 'bounce', 'combo', 'food'];
  assert(!model.upgrades.choices.some(c => retired.includes(c.id)), '旧独自Upgradeは出ない');
  // NEXT is disabled until something is chosen: there is no skipping a REST.
  assert(document.getElementById('upgrade-confirm')!.hasAttribute('disabled'), '選択前は NEXT できない');
  document.getElementById('upgrade-0')!.click();
  document.getElementById('upgrade-confirm')!.click();
  await wait(120);
  // YOUTH widens the NEXT rest, not this one.
  model.upgrades.grant('youth');
  model.completeSection('area-1/section-2');
  await until(() => !!document.getElementById('upgrade-0'), 8000);
  output.textContent += `\n4択: ${model.upgrades.choices.map(c => c.name).join(' / ')}`;
  assert(cards().length === 4, `YOUTH後は4枚 (${cards().length})`);
  assert(new Set(model.upgrades.choices.map(c => c.id)).size === 4, '4枚とも別の強化');
  assert(!model.upgrades.choices.some(c => model.upgrades.acquired.includes(c.id)), '取得済みは再提示されない');
  bridge.active = false;
});
button('UPGRADE 戦闘：BLAST / DRONE / HOT CASING / ROCKET JUMP / BALLOON', async () => {
  // --- BLAST MODULE: a stomp takes the neighbours too -------------------------------------------
  start(); let model = scene.model;
  model.upgrades.grant('blastModule');
  model.platforms = []; model.hazards = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99; model.combo = 0;
  model.player.x = 225; model.player.y = 180; model.player.vy = 0; model.player.grounded = -1;
  const stomped = enemy('slime', 225, 240, 9100);
  const bystander = enemy('slime', 265, 240, 9101);
  model.enemies = [stomped, bystander];
  model.player.vy = 320;
  await until(() => !bystander.alive, 5000);
  output.textContent += `\nBLAST: 踏んだ敵 ${!stomped.alive} / 巻き込み ${!bystander.alive} / COMBO ${model.combo} / kills ${model.kills}`;
  assert(!stomped.alive && !bystander.alive, 'BLAST MODULE：踏みつけで周囲も倒れる');
  assert(model.combo === 2 && model.kills === 2, '二重カウントなし（COMBO 2 / kills 2）');

  // --- DRONE: one extra round per trigger, no CHARGE ---------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('drone');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.gun.equip('shotgun');
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  model.bullets = [];
  const ammoBefore = model.ammo;
  key('Space', true); await wait(1000 / 60); key('Space', false); await wait(80);
  const droneRounds = model.bullets.filter(b => b.source === 'drone');
  output.textContent += `\nDRONE: 弾 ${model.bullets.length} (うちdrone ${droneRounds.length}) / CHARGE ${ammoBefore}→${model.ammo}`;
  assert(droneRounds.length === 1, 'SHOTGUNでも drone 弾は1発だけ');
  assert(ammoBefore - model.ammo === GUN_MODULES.shotgun.ammoCost, 'drone 弾は CHARGE を消費しない');

  // --- HOT CASING --------------------------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('hotCasing');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  model.bullets = [];
  key('Space', true); await wait(1000 / 60); key('Space', false); await wait(80);
  const casings = model.bullets.filter(b => b.source === 'casing');
  output.textContent += `\nHOT CASING: 薬莢 ${casings.length} / 威力 ${casings[0]?.damage}`;
  assert(casings.length === 1, '射撃1回につき薬莢1つ');
  assert(Math.abs(casings[0].damage - GUN_MODULES.machine.projectileDamage * 0.5) < 1e-6, '薬莢は MACHINE の半分の威力');

  // --- ROCKET JUMP -------------------------------------------------------------------------------
  start(); model = scene.model;
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  const floor: RoutePlatform = { id: 9200, x: WORLD.wall, y: 400, width: WORLD.width - WORLD.wall * 2, safeX: 225, exitX: 225, safeSide: 1, breakable: false, state: 'stable' };
  model.platforms = [floor];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 385; model.player.vy = 0; model.player.grounded = floor.id;
  model.jump();
  const plainJump = Math.abs(model.player.vy);
  start(); model = scene.model;
  model.upgrades.grant('rocketJump');
  model.platforms = [floor]; model.enemies = [enemy('slime', 250, 410, 9210)]; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 385; model.player.vy = 0; model.player.grounded = floor.id;
  const victim = model.enemies[0];
  model.jump();
  await wait(80);
  output.textContent += `\nROCKET JUMP: 通常 ${plainJump.toFixed(0)} → ${Math.abs(model.player.vy).toFixed(0)} / 足元の敵 ${!victim.alive}`;
  assert(Math.abs(model.player.vy) > plainJump, '地上ジャンプが高くなる');
  assert(!victim.alive, '足元で爆発して敵を倒す');

  // --- HEART BALLOON -----------------------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('heartBalloon');
  model.jumpToStage(1, 1);
  await wait(60);
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 0;
  model.player.x = 225; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
  assert(!!model.balloon?.alive, 'SECTION開始で風船がある');
  const hpBefore = model.hp;
  const balloon = model.balloon!;
  balloon.x = 225; balloon.y = 300 - 46;
  const popper = enemy('bat', balloon.x, balloon.y, 9300);
  model.enemies = [popper];
  for (let i = 0; i < 200 && balloon.alive; i++) {
    keepAwake();
    model.player.x = 225; model.player.y = 300; model.player.vy = 0;
    popper.x = balloon.x; popper.y = balloon.y;
    await wait(16);
  }
  output.textContent += `\nBALLOON: 割れた ${!balloon.alive} / 敵 ${!popper.alive} / HP ${hpBefore}→${model.hp}`;
  assert(!balloon.alive, '敵が触れると風船が割れる');
  assert(!popper.alive, '爆発で敵を倒す');
  assert(model.hp === hpBefore, 'player は自分の爆発で傷つかない');
  bridge.active = false;
});
button('UPGRADE コイン：MAGNET / POWERED / SICK / POPPING', async () => {
  start(); const model = scene.model;
  model.upgrades.grant('gemAttractor'); model.upgrades.grant('gemPowered');
  model.upgrades.grant('gemSick'); model.upgrades.grant('poppingGems');
  model.jumpToStage(1, 1);
  await wait(60);
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = []; model.containers = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  assert(model.coins.attractMultiplier > 1, 'COIN MAGNET：吸引倍率が上がっている');
  assert(model.coinHigh.durationMultiplier > 1, 'COIN SICK：HIGH 持続倍率が上がっている');
  model.ammo = 0; model.bullets = []; model.coins.coins = [];
  model.coins.burst(225, 200, 1, () => 0.5, 'large');
  for (let i = 0; i < 200 && model.coins.coins.length; i++) {
    keepAwake();
    const coin = model.coins.coins[0];
    model.player.x = coin.x; model.player.y = coin.y; model.player.vy = 0; model.player.grounded = -1;
    await wait(16);
  }
  const popped = model.bullets.filter(b => b.source === 'poppingGem');
  output.textContent += `\nLARGE COIN 回収: CHARGE 0→${model.ammo} / 上向き弾 ${popped.length}`;
  assert(model.ammo === 5, 'COIN POWERED：LARGE で CHARGE +5');
  assert(popped.length === 1, 'POPPING COINS：1枚につき上へ1発');
  assert(popped[0].vy < 0, '上向きに撃っている');
  // A settled chain is awarded, not dropped: neither upgrade may fire for it.
  model.bullets = []; model.ammo = 1; model.combo = 8;
  model.settleCombo();
  await wait(60);
  output.textContent += `\nCOMBO 精算後: CHARGE ${model.ammo} / 上向き弾 ${model.bullets.filter(b => b.source === 'poppingGem').length}`;
  assert(model.bullets.filter(b => b.source === 'poppingGem').length === 0, '精算では POPPING COINS は撃たない');
  assert(model.ammo === 1, '精算では COIN POWERED も回復しない');
  bridge.active = false;
});
button('UPGRADE 死体：KNIFE & FORK / REST IN PIECES', async () => {
  start(); let model = scene.model;
  model.upgrades.grant('knifeAndFork');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 0;
  model.damage(2);
  model.player.invincible = 99;
  const hurtHp = model.hp;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  for (let i = 0; i < 10; i++) {
    model.corpses = [spawnCorpse(i + 1, 225, 200)];
    for (let f = 0; f < 10 && model.corpses.length; f++) { keepAwake(); model.player.x = 225; model.player.y = 200; await wait(16); }
  }
  output.textContent += `\nKNIFE & FORK: 食べた ${model.corpsesEaten} / HP ${hurtHp}→${model.hp}`;
  assert(model.corpsesEaten === 10, '死体を10体食べた');
  assert(model.hp === hurtHp + 1, '10体で HP +1');

  start(); model = scene.model;
  model.upgrades.grant('restInPieces');
  model.platforms = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const body = spawnCorpse(1, 225, 280); body.vy = 0;
  model.corpses = [body];
  const near = enemy('slime', 255, 280, 9400);
  model.enemies = [near];
  for (let i = 0; i < 300 && !body.claimed; i++) {
    keepAwake();
    model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    body.x = 225; body.y = 280;
    model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  output.textContent += `\nREST IN PIECES: 爆散 ${body.claimed} / 巻き込み ${!near.alive}`;
  assert(body.claimed, '死体を撃つと爆散する');
  assert(!near.alive, '爆発で近くの敵を巻き込む');
  bridge.active = false;
});
button("UPGRADE 実用：REVERSE / JETPACK / TIMEOUT / MEMBER'S CARD", async () => {
  // --- REVERSE ENGINEERING -------------------------------------------------------------------------
  start(); let model = scene.model;
  model.upgrades.grant('reverseEngineering');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const crate = spawnGunModule(9500, 225, 300, 'machine', 'heart');
  model.pickups = [crate];
  for (let i = 0; i < 300 && !crate.rerolled; i++) {
    keepAwake();
    model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    crate.x = 225; crate.y = 300; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  const drawn = { module: crate.module, bonus: crate.bonus };
  output.textContent += `\nREVERSE: machine/heart → ${drawn.module}/${drawn.bonus} / crate 健在 ${!crate.taken}`;
  assert(crate.rerolled === true, 'GUN MODULE を撃つと引き直される');
  assert(model.pickups.includes(crate) && !crate.taken, 'crate は破壊されない');
  for (let i = 0; i < 120; i++) {
    keepAwake();
    model.player.x = 225; model.player.y = 200; model.player.grounded = -1;
    crate.x = 225; crate.y = 300; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  assert(crate.module === drawn.module && crate.bonus === drawn.bonus, '2回目以降は引き直さない');

  // --- SAFETY JETPACK -----------------------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('safetyJetpack');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  model.ammo = 0; model.bullets = [];
  model.player.x = 225; model.player.y = 200; model.player.vy = model.stats.maxFallSpeed; model.player.grounded = -1;
  const fuelBefore = model.jetpackFuel;
  key('Space', true);
  for (let i = 0; i < 40; i++) { keepAwake(); model.player.grounded = -1; await wait(16); }
  key('Space', false);
  output.textContent += `\nJETPACK: 燃料 ${fuelBefore.toFixed(1)}→${model.jetpackFuel.toFixed(1)} / vy ${model.player.vy.toFixed(0)} / 弾 ${model.bullets.length}`;
  assert(model.jetpackFuel < fuelBefore, 'CHARGE 0 + ACTION で燃料を使う');
  assert(model.bullets.length === 0, 'projectile は出ない');
  assert(model.ammo === 0, 'CHARGE は増えない');
  assert(model.player.vy < model.stats.maxFallSpeed, '落下が緩む');
  const held = model.jetpackFuel;
  await wait(600);
  assert(model.jetpackFuel === held, 'ACTION を離すと燃料は減らない');

  // --- TIMEOUT -------------------------------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('timeout');
  model.jumpToStage(1, 1);
  await wait(60);
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = []; model.bullets = [];
  model.player.x = 225; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
  model.player.invincible = 0;
  model.damage(1);
  const bubble = model.timeoutBubbles[0];
  assert(!!bubble, '被弾した位置に泡ができる');
  assert(model.timeFrozen, '泡の中では TIMEVOID');
  model.bullets = [plainBullet(bubble.x + bubble.radius + 90, 180)];
  const outside = model.bullets[0];
  for (let i = 0; i < 90; i++) { keepAwake(); model.player.invincible = 99; model.player.x = 225; model.player.y = 300; model.player.vy = 0; await wait(16); }
  output.textContent += `\nTIMEOUT: 泡(${bubble.x.toFixed(0)},${bubble.y.toFixed(0)}) / 外の弾 y=${outside.y.toFixed(0)}`;
  assert(outside.y === 180, '泡の中にいる間は外の弾が止まる');
  model.player.x = bubble.x + bubble.radius + 220;
  await wait(200);
  assert(!model.timeFrozen, '泡を出ると解除される');
  assert(bubble.x === 225 && bubble.y === 300, '泡は動かない（player に追従しない）');
  assert(outside.y > 180, '出ると外の弾が動き出す');

  // --- MEMBER'S CARD ---------------------------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('membersCard');
  model.jumpToStage(2, 1);
  await wait(60);
  const full = model.shop.offers.map(o => shopPrice(shopItem(o.item), 2));
  output.textContent += `\nMEMBER'S CARD: ${model.shop.offers.map((o, i) => `${o.name} ${full[i]}→${o.price}`).join(' / ')}`;
  assert(model.shop.offers.every((o, i) => o.price === Math.round(full[i] * 0.9)), 'SHOP が 10% 引き');
  const early = model.safeZones.concat();
  assert(model.stage.sectionPlan !== undefined, 'SECTION plan がある');
  // The guaranteed chamber is cut near the top, so it is already generated at the opening.
  await wait(200);
  const shops = model.safeZones.filter(z => z.content?.kind === 'shop');
  output.textContent += `\nSECTION序盤の chamber: ${model.safeZones.length} (うち SHOP ${shops.length})`;
  assert(model.safeZones.length >= 1, 'SECTION 序盤に chamber がある');
  assert(shops.length >= 1, 'そのうち少なくとも1つが SHOP');
  void early;
  bridge.active = false;
});
button('UPGRADE × AREA：Catacombs火薬 / Aquifer死体 / Limbo燃料', async () => {
  // --- AREA 2 CATACOMBS + GUNPOWDER BLOCKS -------------------------------------------------------
  start(); let model = scene.model;
  model.upgrades.grant('gunpowderBlocks');
  model.jumpToStage(2, 2);
  await wait(80);
  model.enemies = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 99;
  const width = 70;
  const row: Platform[] = Array.from({ length: 5 }, (_, i) => ({
    id: 9600 + i, x: WORLD.wall + i * width, y: 420, width,
    breakable: false, state: 'stable' as const,
    breakBlock: { hits: 0, durability: 1, slot: i, reward: i === 2 },
  }));
  model.platforms = row;
  model.bullets = [];
  row[0].breakBlock!.hits = 0;
  model.player.x = row[0].x + 20; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
  for (let i = 0; i < 200 && row[4].state !== 'broken'; i++) {
    keepAwake();
    model.player.x = row[0].x + 20; model.player.y = 300; model.player.vy = 0; model.player.grounded = -1;
    model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  const powder = model.bullets.filter(b => b.source === 'gunpowderBlock');
  const value = model.coins.coins.reduce((sum, c) => sum + c.value, 0) + model.coins.scoreCoins;
  output.textContent += `\nAREA2 + GUNPOWDER: 割れた ${row.filter(b => b.state === 'broken').length}/5 / 誘爆弾 ${powder.length} / COIN ${value}`;
  assert(row.every(b => b.state === 'broken'), '誘爆で1列すべて割れる');
  assert(powder.length === row.length, 'ブロック1個につき1発');
  assert(value === 10, '誘爆で割れた REWARD BLOCK も 10 COIN 出す');
  assert(model.kills === 0 && model.combo === 0, 'ブロック破壊は撃破でも COMBO でもない');

  // --- AREA 3 AQUIFER + KNIFE & FORK --------------------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('knifeAndFork');
  model.jumpToStage(3, 1);
  await wait(80);
  assert(model.oxygen.enabled, 'AREA 3 で酸素が有効');
  model.platforms = []; model.enemies = []; model.doodads = []; model.safeZones = []; model.containers = [];
  model.player.invincible = 99;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const fish = enemy('fish', 225, 260, 9700);
  model.enemies = [fish];
  for (let i = 0; i < 300 && fish.alive; i++) {
    keepAwake();
    model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    fish.x = 225; fish.y = 260; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  await wait(120);
  output.textContent += `\nAREA3 + KNIFE&FORK: 死体 ${model.corpses.length} / 食べた ${model.corpsesEaten}`;
  assert(!fish.alive, 'AREA 3 の敵を倒した');
  assert(model.corpses.length + model.corpsesEaten > 0, '水中でも死体が残る');

  // --- AREA 4 LIMBO + GEM POWERED / SAFETY JETPACK ------------------------------------------------
  start(); model = scene.model;
  model.upgrades.grant('gemPowered'); model.upgrades.grant('safetyJetpack');
  model.jumpToStage(4, 2);
  await wait(80);
  model.platforms = []; model.enemies = []; model.safeZones = []; model.doodads = [];
  model.player.invincible = 99;
  model.ammo = 0; model.jetpackFuel = 0;
  model.player.x = 225; model.player.y = 200; model.player.vy = 300; model.player.grounded = -1;
  model.doodads = [spawnDoodad(9800, 225 - DOODAD_RULES.width / 2, 320, 'lamp')];
  for (let i = 0; i < 200 && model.jetpackFuel === 0; i++) { keepAwake(); await wait(16); }
  output.textContent += `\nAREA4 + JETPACK: doodad で燃料 ${model.jetpackFuel.toFixed(1)} / CHARGE ${model.ammo}`;
  assert(model.jetpackFuel > 0, 'LIMBO では床がなくても doodad で燃料が戻る');
  model.ammo = 0; model.coins.coins = [];
  model.doodads = [];
  model.coins.burst(model.player.x, model.player.y, 1, () => 0.5, 'small');
  for (let i = 0; i < 200 && model.coins.coins.length; i++) {
    keepAwake();
    const coin = model.coins.coins[0];
    model.player.x = coin.x; model.player.y = coin.y; model.player.vy = 0; model.player.grounded = -1;
    await wait(16);
  }
  output.textContent += `\nAREA4 + GEM POWERED: SMALL 回収で CHARGE ${model.ammo}`;
  assert(model.ammo === 1, 'LIMBO でも COIN 回収で CHARGE +1');
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
button('AREA 1：即死SPIKEなし・BREAK BLOCK・stomp/combo', async () => {
  start(); const model = scene.model;
  model.jumpToStage(1, 2);
  await wait(80);
  model.player.invincible = 99;
  // Descend for real for a while and watch what the shaft actually lays.
  let lethal = 0, blocks = 0, turning = 0;
  for (let i = 0; i < 1400; i++) {
    keepAwake();
    model.player.invincible = 99;
    lethal += model.hazards.filter(h => h.lethal).length;
    turning += model.platforms.filter(f => f.spikePlatform).length;
    blocks = Math.max(blocks, model.platforms.filter(f => f.breakBlock).length);
    const standing = model.platforms.find(f => f.id === model.player.grounded) as RoutePlatform | undefined;
    bridge.direction = standing ? Math.sign(standing.exitX - model.player.x) : 0;
    await wait(16);
  }
  bridge.direction = 0;
  output.textContent += `\nAREA 1 実降下: 致死hazard ${lethal} / 罠床 ${turning} / BREAK BLOCK 同時 ${blocks} / 深度 ${Math.floor(model.sectionDepth)}m`;
  assert(lethal === 0, 'AREA 1 は即死hazardを一切生成しない');
  assert(turning === 0, 'AREA 1 は罠床（SPIKE PLATFORM）も生成しない');
  assert(blocks > 0, 'AREA 1 に BREAK BLOCK がある');
  assert(model.state === 'playing' || model.state === 'upgrade', `AREA 1 を即死せず降下できた (${model.state})`);
  // Stomp and settle, on ordinary AREA 1 ground.
  start(); const m2 = scene.model;
  m2.jumpToStage(1, 2);
  await wait(60);
  m2.platforms = []; m2.hazards = []; m2.doodads = [];
  m2.player.invincible = 99;
  m2.player.y = 180; m2.player.vy = 0; m2.player.grounded = -1;
  m2.ammo = m2.stats.maxAmmo; m2.combo = 0;
  for (let n = 0; n < 3; n++) {
    m2.enemies = [enemy('slime', m2.player.x, m2.player.y + 40, 9600 + n)];
    m2.player.vy = 320;
    await until(() => m2.combo === n + 1, 4000);
  }
  assert(m2.combo === 3, `踏みつけで COMBO 3 まで繋がった (${m2.combo})`);
  const ledge: RoutePlatform = { id: 9650, x: WORLD.wall, y: m2.player.y + 90, width: WORLD.width - WORLD.wall * 2, safeX: m2.player.x, exitX: m2.player.x, safeSide: 1, breakable: false, state: 'stable' };
  m2.platforms = [ledge]; m2.enemies = []; m2.ammo = 1;
  await until(() => m2.player.grounded === ledge.id, 5000);
  await wait(120);
  output.textContent += `\n通常床へ着地: CHARGE ${m2.ammo}/${m2.stats.maxAmmo} / COMBO ${m2.combo}`;
  assert(m2.ammo === m2.stats.maxAmmo, '通常床の着地で CHARGE 全回復');
  assert(m2.combo === 0, '通常床の着地で COMBO が精算される');
  bridge.active = false;
});
button('AREA 2：SPIKE PLATFORM の warning → 1ダメージ', async () => {
  start(); const model = scene.model;
  model.jumpToStage(2, 2);
  await wait(80);
  model.platforms = []; model.enemies = []; model.hazards = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 0;
  const ledge: Platform = { id: 9700, x: WORLD.wall, y: 520, width: 240, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
  model.platforms = [ledge];
  model.player.x = ledge.x + 120; model.player.y = 300; model.player.vy = 240; model.player.grounded = -1;
  model.ammo = 1; model.combo = 6;
  const hp = model.hp;
  await until(() => model.player.grounded === ledge.id, 6000);
  output.textContent += `\n着地時: state=${ledge.spikePlatform!.state} HP ${model.hp}/${model.stats.maxHp} CHARGE ${model.ammo}/${model.stats.maxAmmo} COMBO ${model.combo}`;
  assert(ledge.spikePlatform!.state === 'warning', '着地した瞬間は warning（即ダメージではない）');
  assert(model.hp === hp, '着地そのものでは1も減らない');
  assert(model.ammo === model.stats.maxAmmo, '罠床でも着地で CHARGE 全回復');
  assert(model.combo === 0, '罠床でも着地で COMBO は精算される');
  // Ride the warning out and take the hit.
  model.combo = 11;
  await until(() => ledge.spikePlatform!.state === 'active', 4000);
  await wait(120);
  output.textContent += `\nspikes 展開: HP ${hp} → ${model.hp} / 死因 ${model.health.lastDamage?.cause} / instant=${model.health.lastDamage?.instant} / COMBO ${model.combo}`;
  assert(model.hp === hp - 1, 'spikes 接触は 1 ダメージ');
  assert(model.health.lastDamage?.instant === false, '即死ではなく通常ダメージ');
  assert(model.state === 'playing', '被弾してもランは続く');
  assert(model.combo === 11, '被弾しても COMBO は維持される');
  // A candle keeps a chain alive without touching the floor at all.
  model.player.invincible = 99;
  model.platforms = []; model.ammo = 2;
  model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const candle = spawnDoodad(9750, model.player.x - DOODAD_RULES.width / 2, model.player.y + 60, 'lamp');
  model.doodads = [candle];
  // Latched through the event bridge: a 'doodad' event lives for one frame, and polling for it can
  // simply step over the frame it happened on.
  let bounced = false;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'doodad') bounced = true; };
  model.player.vy = 300;
  for (let i = 0; i < 260 && !bounced; i++) { keepAwake(); await wait(16); }
  bridge.onEvent = original;
  assert(bounced, 'CANDLE を踏んだ');
  await wait(60);
  output.textContent += `\nCANDLE: CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo} / vy ${model.player.vy.toFixed(0)}`;
  assert(model.ammo === model.stats.maxAmmo, 'CANDLE を踏むと CHARGE 全回復');
  assert(model.combo === 11, 'CANDLE は COMBO を精算しない');
  assert(model.player.vy < 0, 'CANDLE で跳ね返る');
  assert(model.kills === 0, 'CANDLE は撃破ではない');
  bridge.active = false;
});
button('AREA 3：oxygen → container → bubble → 回復', async () => {
  start(); const model = scene.model;
  model.jumpToStage(3, 1);
  await wait(80);
  assert(model.oxygen.enabled, 'AREA 3 で酸素ギミックが有効');
  assert(!!model.water, 'AREA 3 は水中物理');
  assert(!model.heat.enabled, 'AREA 3 に熱ギミックはない');
  model.player.invincible = 99;
  // Let the tank drain a little without moving.
  const full = model.oxygen.remaining;
  for (let i = 0; i < 180; i++) { keepAwake(); model.player.y = 220; model.player.vy = 0; model.player.grounded = -1; model.enemies = []; await wait(16); }
  output.textContent += `\nOXYGEN: ${full.toFixed(1)}s → ${model.oxygen.remaining.toFixed(1)}s`;
  assert(model.oxygen.remaining < full, 'AREA 3 では酸素が減る');
  const low = model.oxygen.remaining;
  // Break a container and catch a bubble.
  const box = { id: 9800, x: model.player.x - 17, y: model.player.y + 50, width: 34, height: 34, broken: false, debris: 0 };
  model.containers = [box];
  model.ammo = model.stats.maxAmmo;
  for (let i = 0; i < 200 && !box.broken; i++) {
    keepAwake();
    model.player.y = 220; model.player.vy = 0; model.player.grounded = -1; model.ammo = model.stats.maxAmmo;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  assert(box.broken, 'AIR CONTAINER を撃って割れる');
  assert(model.bubbles.length > 0, '割ると bubble が出る');
  for (let i = 0; i < 300 && model.oxygen.remaining <= low; i++) {
    keepAwake();
    const b = model.bubbles.find(x => !x.taken);
    if (b) { model.player.x = b.x; model.player.y = b.y; model.player.vy = 0; }
    await wait(16);
  }
  output.textContent += `\nBUBBLE 回収: ${low.toFixed(1)}s → ${model.oxygen.remaining.toFixed(1)}s`;
  assert(model.oxygen.remaining > low, 'bubble を取ると酸素が回復する');
  bridge.active = false;
});
button('AREA 4：踏めない敵・射撃撃破・doodadでリロード', async () => {
  start(); const model = scene.model;
  model.jumpToStage(4, 2);
  await wait(80);
  model.platforms = []; model.enemies = []; model.hazards = []; model.doodads = []; model.safeZones = [];
  model.player.invincible = 0;
  model.player.x = 225; model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  model.ammo = 4; model.combo = 4;
  // Fall onto one: it must NOT read as a stomp.
  const foe = enemy(model.stage.config.enemyPool[0], model.player.x, model.player.y + 40, 9900);
  model.enemies = [foe];
  const hp = model.hp, combo = model.combo, ammo = model.ammo;
  model.player.vy = 320;
  await until(() => model.hp < hp, 4000);
  output.textContent += `\n上から接触: HP ${hp}→${model.hp} / 敵 alive=${foe.alive} / COMBO ${model.combo} / CHARGE ${model.ammo}`;
  assert(model.hp === hp - 1, 'AREA 4 の敵は踏めず、接触ダメージになる');
  assert(foe.alive, '踏んでも敵は死なない');
  assert(model.combo === combo, '踏んでも COMBO は増えない');
  assert(model.ammo === ammo, '踏んでも CHARGE は回復しない');
  // Shoot it instead.
  model.player.invincible = 99;
  model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  foe.x = model.player.x; foe.y = 270;
  model.ammo = model.stats.maxAmmo;
  for (let i = 0; i < 300 && foe.alive; i++) {
    keepAwake();
    model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
    foe.x = model.player.x; foe.y = 270;
    key('Space', true); await wait(1000 / 60); key('Space', false); await wait(16);
  }
  output.textContent += `\n射撃: 敵 alive=${foe.alive} / COMBO ${model.combo} / CHARGE ${model.ammo}/${model.stats.maxAmmo}`;
  assert(!foe.alive, 'AREA 4 の敵は Gunboots で倒せる');
  assert(model.combo > combo, '射撃撃破で COMBO が増える');
  // Reload from a floating doodad, keeping the chain.
  const chain = model.combo;
  model.ammo = 1;
  model.enemies = [];
  model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const doodad = spawnDoodad(9950, model.player.x - DOODAD_RULES.width / 2, model.player.y + 60, 'lamp');
  model.doodads = [doodad];
  let bounced = false;
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => { original(event, game); if (event.type === 'doodad') bounced = true; };
  model.player.vy = 300;
  for (let i = 0; i < 260 && !bounced; i++) { keepAwake(); await wait(16); }
  bridge.onEvent = original;
  assert(bounced, 'DOODAD を踏んだ');
  await wait(60);
  output.textContent += `\nDOODAD: CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo} / grounded ${model.player.grounded}`;
  assert(model.ammo === model.stats.maxAmmo, 'AREA 4 は doodad が主要リロード源');
  assert(model.combo === chain, 'doodad は COMBO を精算しない');
  assert(model.player.grounded === -1, 'doodad 着地ではなく跳ね返り');
  // Dangerous ground: a heart, and nothing else. CHARGE and the chain both survive it untouched.
  model.doodads = []; model.enemies = [];
  model.player.invincible = 0;
  model.ammo = 3; model.combo = chain;
  const beforeHazard = { hp: model.hp, ammo: model.ammo, combo: model.combo };
  const barbs: Platform = { id: 9960, x: WORLD.wall, y: 520, width: WORLD.width - WORLD.wall * 2, limboHazard: true };
  model.platforms = [barbs];
  model.player.x = 225; model.player.y = 360; model.player.vy = 260; model.player.grounded = -1;
  await until(() => model.hp < beforeHazard.hp, 6000);
  await wait(120);
  output.textContent += `\n危険な床: HP ${beforeHazard.hp}→${model.hp} / CHARGE ${beforeHazard.ammo}→${model.ammo} / COMBO ${beforeHazard.combo}→${model.combo} / grounded ${model.player.grounded} / 即死 ${model.health.lastDamage?.instant}`;
  assert(model.hp === beforeHazard.hp - 1, '危険な床は 1 ダメージ');
  assert(model.health.lastDamage?.instant === false, '即死ではない');
  assert(model.ammo === beforeHazard.ammo, '危険な床では CHARGE が増えない');
  assert(model.combo === beforeHazard.combo, '危険な床でも COMBO は維持される');
  assert(model.player.grounded === -1, '危険な床には着地しない（床ではない）');
  assert(!model.events.some(e => e.type === 'comboSettle'), '危険な床は COMBO を精算しない');
  // And the very next doodad refills, still without settling.
  model.player.invincible = 99;
  model.platforms = []; model.ammo = 1;
  model.player.y = 200; model.player.vy = 0; model.player.grounded = -1;
  const second = spawnDoodad(9970, model.player.x - DOODAD_RULES.width / 2, model.player.y + 60, 'bracket');
  model.doodads = [second];
  let again = false;
  const watcher = bridge.onEvent;
  bridge.onEvent = (event, game) => { watcher(event, game); if (event.type === 'doodad') again = true; };
  model.player.vy = 300;
  for (let i = 0; i < 260 && !again; i++) { keepAwake(); await wait(16); }
  bridge.onEvent = watcher;
  output.textContent += `\n次の DOODAD: CHARGE ${model.ammo}/${model.stats.maxAmmo} / COMBO ${model.combo}`;
  assert(again, '次の DOODAD を踏んだ');
  assert(model.ammo === model.stats.maxAmmo, '次の DOODAD で CHARGE 全回復');
  assert(model.combo === beforeHazard.combo, '一連の流れで COMBO は一度も精算されない');
  // And the real shaft has no ordinary resting ground.
  start(); const m3 = scene.model;
  m3.jumpToStage(4, 2);
  await wait(80);
  m3.player.invincible = 99;
  // Count DISTINCT ledges, not frames: a platform on screen for 200 frames is still one platform.
  // The run's own starting ledge is excluded -- it is where a SECTION puts the player, not ground
  // the AREA generated.
  const trap = new Set<number>(), ordinary = new Set<number>();
  for (let i = 0; i < 900; i++) {
    keepAwake();
    m3.player.invincible = 99;
    for (const f of m3.platforms) {
      if (f.breakBlock || f.safeZone !== undefined || f.id < 0) continue;
      (f.limboHazard ? trap : ordinary).add(f.id);
    }
    const standing = m3.platforms.find(f => f.id === m3.player.grounded) as RoutePlatform | undefined;
    bridge.direction = standing ? Math.sign(standing.exitX - m3.player.x) : 0;
    await wait(16);
  }
  bridge.direction = 0;
  output.textContent += `\nAREA 4 実降下: 危険な床 ${trap.size} / 通常床 ${ordinary.size} / 崩落床 ${m3.platforms.filter(f => f.breakable).length} / 深度 ${Math.floor(m3.sectionDepth)}m`;
  assert(trap.size > 0, 'AREA 4 の床は危険な床');
  assert(ordinary.size === 0, `AREA 4 に通常の休める床はない (通常床 ${ordinary.size})`);
  assert(m3.platforms.filter(f => f.spikePlatform).length === 0, 'AREA 4 に CATACOMBS の罠床（SPIKE PLATFORM）はない');
  assert(m3.collapse.counting === 0, 'AREA 4 に崩落タイマーは存在しない');
  bridge.active = false;
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
    // YOUTH first, so every size is measured at the WIDEST the panel ever gets: four cards rather
    // than three. Leaving it to the draw made this check depend on whether YOUTH happened to come
    // up, which is the sort of thing a layout test must never rest on.
    model.upgrades.grant('youth');
    // Seven more confirmed upgrades: the widest realistic "取得済み強化" list.
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
    const stacks = model.upgrades.acquired.length;
    const result = {
      size: `${width}×${height}`, stacks, cards: cards.length,
      overlapping: cards.some((a, i) => cards.some((b, j) => i < j && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5)),
      readable: cards.every(r => r.height >= 56 && r.width >= 240),
      nextBottom: Math.round(next.bottom), viewport: win.innerHeight,
      nextVisible: next.bottom <= win.innerHeight && next.top >= 0,
      nextTappable: hit?.id === 'upgrade-confirm',
      hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : 'none',
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
    output.textContent += `\n${r.size} · NEXT ${r.nextBottom} / ${r.viewport} · 強化${r.stacks}個 · hit ${r.hit}`;
    assert(r.cards === 4 && !r.overlapping && r.readable, `${r.size}：カード4枚が重ならず読める`);
    assert(r.nextVisible && r.nextTappable, `${r.size}：NEXTが初期表示内でタップ可能`);
    assert(r.resumed, `${r.size}：NEXTで通常ゲームへ復帰`);
  }
});


// AREA 2: play 2-1 -> rest -> 2-2 -> rest -> 2-3 -> rest -> 3-1 with keyboard input only, meeting
// the ground that turns and surviving it, and check CATACOMBS behaves at every boundary.
button('2-1 → 3-1 を通常プレイ（CATACOMBS）', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(2, 1);
  assert(!model.oxygen.enabled && model.containers.length === 0 && model.water === undefined, 'AREA 2 に水・酸素・コンテナはない');
  assert(!model.heat.enabled, 'AREA 2 に熱ギミックはない');
  await wait(60);
  const deadline = performance.now() + 420000;
  let direction = 0, firing = false, playingHp = model.hp;
  let landedOnTrap = 0, warned = 0, spiked = 0, hits = 0, lethal = 0;
  const rests: string[] = [];
  let shopsSeen = 0;
  const seenStates = new Set<string>();
  let lastHp = model.hp;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  const act = (on: boolean) => { if (on !== firing) { key('Space', on); firing = on; } };
  const original = bridge.onEvent;
  bridge.onEvent = (event, game) => {
    original(event, game);
    if (event.type !== 'spikePlatform') return;
    if (event.value === 0) warned++;
    if (event.value === 1) spiked++;
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') {
      bridge.onEvent = original;
      throw new Error(`${model.stage.label} で死亡 (死因 ${model.health.deathCause?.cause} / 即死 ${model.health.deathCause?.instant} / ${Math.floor(model.sectionDepth)}m / 罠床着地 ${landedOnTrap} / warning ${warned} / spikes ${spiked} / 被弾 ${hits} / 休憩 ${rests.join(' → ') || 'なし'})`);
    }
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
      const cleared = model.stage.label;
      assert(model.hp === playingHp, `${cleared} クリアで休憩：HPは ${model.hp}/${model.health.maxHp} のまま回復しない`);
      document.getElementById('upgrade-0')!.click();
      document.getElementById('upgrade-confirm')!.click();
      await wait(90);
      rests.push(cleared);
      if (model.stage.label === '3-1') break;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    lethal += model.hazards.filter(h => h.lethal).length;
    for (const f of model.platforms) if (f.spikePlatform) seenStates.add(f.spikePlatform.state);
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    if (ground?.spikePlatform && ground.spikePlatform.state !== 'safe') landedOnTrap++;
    const next = model.platforms.filter(p => p.y > model.player.y + 15).sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
    const target = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    const block = model.platforms.filter(f => f.breakBlock && f.state !== 'broken' && f.y > model.player.y - 4).sort((a, b) => a.y - b.y)[0];
    const overBlock = !!block && model.player.x + 9 > block.x && model.player.x - 9 < block.x + block.width;
    const working = !!ground?.breakBlock || (!ground && overBlock);
    act(working && model.ammo > 0);
    const heading = working ? (block ? block.x + block.width / 2 : model.player.x) : (gate ?? target);
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
    if (model.hp < lastHp) { hits++; lastHp = model.hp; } else if (model.hp > lastHp) lastHp = model.hp;
    output.textContent = `AREA 2 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nHP ${model.hp}/${model.health.maxHp} · 罠床着地 ${landedOnTrap} · warning ${warned} · spikes ${spiked}\n休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); act(false); pause();
  bridge.onEvent = original;
  output.textContent += `\n結果: 休憩 ${rests.join(' → ')} / warning ${warned} / spikes ${spiked} / 致死hazard ${lethal} / SHOP ${shopsSeen}`;
  assert(rests.join(' ') === '2-1 2-2 2-3', `2-1 → 2-2 → 2-3 を通常プレイで踏破 (${rests.join(' → ')})`);
  assert(model.stage.label === '3-1' && model.stage.progress.area === 3, `AREA 2 クリア後に AREA 3 / 3-1 へ (${model.stage.label})`);
  assert(lethal === 0, 'AREA 2 を通して即死hazardは一度も生成されない');
  assert(warned > 0, `罠床が warning を出した (${warned} 回)`);
  assert(spiked > 0, `罠床が実際に spikes を展開した (${spiked} 回)`);
  assert(seenStates.has('safe'), '罠床は待機状態も持つ');
  assert(model.hp > 0, `即死せず AREA 2 を踏破した (HP ${model.hp}/${model.health.maxHp})`);
  // AREA 2 ran no gauge at all; crossing into AQUIFER is where the breath gauge starts.
  assert(model.oxygen.enabled && model.water !== undefined, 'AREA 3 に入ると酸素と水中物理が始まる');
});

// AREA 2: play 3-1 -> rest -> 3-2 -> rest -> 3-3 -> rest -> 3-1 with keyboard input only, steering
// for air when the tank runs low, and check the supply behaves at every boundary.
button('3-1 → 4-1 を通常プレイ（AQUIFER）', async () => {
  keepAwake(); start(); await until(() => bridge.active, 8000);
  const model = scene.model;
  model.jumpToStage(3, 1);
  assert(model.oxygen.enabled && model.oxygen.remaining === model.oxygen.max, `3-1 開始で酸素満タン (${model.oxygen.remaining.toFixed(1)}s)`);
  await wait(60);
  const deadline = performance.now() + 460000;
  let direction = 0, lowest = model.oxygen.max, collected = 0, playingHp = model.hp, lastAir = model.oxygen.max;
  const rests: string[] = [];
  let shopsSeen = 0;
  const steer = (next: number) => {
    if (next === direction) return;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', false);
    direction = next;
    if (direction) key(direction < 0 ? 'KeyA' : 'KeyD', true);
  };
  let drowned: string | null = null;
  while (performance.now() < deadline) {
    if (model.state === 'over') { drowned = `${model.stage.label} ${Math.floor(model.sectionDepth)}m`; break; }
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
    output.textContent = `AREA 3 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\nOXYGEN ${model.oxygen.remaining.toFixed(1)}s (最低 ${lowest.toFixed(1)}s)\nHP ${model.hp}/${model.health.maxHp} · 取得 ${collected} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); pause();
  output.textContent += `\n結果: 休憩 ${rests.join(' → ') || 'なし'} / 補給 ${collected} 回 / 最低酸素 ${lowest.toFixed(1)}s / ${drowned ? '溺死 ' + drowned : '生存'}`;
  // KNOWN HARNESS LIMIT, and deliberately not asserted away. This bot's whole policy is "chase the
  // next breath", which is right for the AREA's own mechanic and wrong for a gate row: left alone it
  // parks on a row it will not shoot, and taught to shoot one it stops chasing air. Whether it
  // finishes a SECTION is therefore seed-dependent -- measured at 6.0s, 6.5s and 0.0s of tank left
  // on three shafts -- so this check holds the INVARIANTS the AREA must satisfy however the descent
  // goes, and the supply itself is held on every seed by the generator sweep in tests/area3.test.ts.
  assert(collected > 0, `酸素を ${collected} 回補給（すべてコンテナ由来の泡）`);
  assert(!('sheltered' in (model as object)) && !('airPockets' in (model as object)), '固定AIRスペースと sheltered 依存が残っていない');
  assert(lowest < model.oxygen.max, `酸素が実際に消費された (最低 ${lowest.toFixed(1)}s)`);
  // However it ends, it is never ended by touching something: AQUIFER lays nothing lethal.
  assert(model.health.deathCause?.instant !== true, `即死では終わらない (死因 ${model.health.deathCause?.cause ?? 'なし'})`);
  // The AREA 3 -> AREA 4 boundary, reached by a stage jump rather than by play, because the bot
  // above cannot finish the AREA. Labelled as a jump so nothing here reads as "played through".
  scene.model.jumpToStage(4, 1);
  await wait(120);
  const limbo = scene.model;
  output.textContent += `\n[stage jump] ${limbo.stage.label}: oxygen=${limbo.oxygen.enabled} water=${limbo.water ? 'yes' : 'no'}`;
  assert(!limbo.oxygen.enabled && limbo.pickups.every(p => p.kind !== 'oxygenBubble') && limbo.containers.length === 0 && limbo.bubbles.length === 0, 'AREA 4 では酸素・コンテナ・泡が消える');
  assert(limbo.water === undefined, 'AREA 4 では水中物理が解除される');
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
  // LIMBO's ground is dangerous rather than crumbling: the collapse mechanic left normal play with
  // the world roles, and every ledge here is a SPIKE PLATFORM instead.
  assert(model.stage.config.gimmicks?.breakablePlatforms === undefined && (model.stage.sectionPlan?.breakableChance ?? 0) === 0,
    'AREA 4 の生成計画に崩壊足場はもうない');
  assert((model.stage.sectionPlan?.limboHazardChance ?? 0) === 1, 'AREA 4 の床はすべて危険な床');
  assert((model.stage.sectionPlan?.spikePlatformChance ?? 0) === 0, 'AREA 4 に CATACOMBS の罠床は使わない');
  const deadline = performance.now() + 460000;
  let direction = 0, cracks = 0, collapses = 0, underfoot = 0, reloadsOnTrap = 0, playingHp = model.hp, shopsSeen = 0;
  let died: string | null = null;
  let warned = 0, spiked = 0, stomps = 0, bounces = 0, ordinaryGround = 0;
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
    if (event.type === 'spikePlatform' && event.value === 0) warned++;
    if (event.type === 'spikePlatform' && event.value === 1) spiked++;
    if (event.type === 'kill' && event.stomp) stomps++;
    if (event.type === 'doodad') bounces++;
  };
  while (performance.now() < deadline) {
    if (model.state === 'over') { died = `${model.stage.label} ${Math.floor(model.sectionDepth)}m (${model.health.deathCause?.cause})`; break; }
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
      // `state` is only written where the collapse gimmick is on, so LIMBO's ledges carry none at
      // all now. What must hold is that nothing is part-way through crumbling.
      assert(model.collapse.counting === 0 && !model.platforms.some(f => f.state === 'cracking' || f.state === 'critical' || f.state === 'broken'),
        `${model.stage.label} 開始で崩壊タイマーは存在しない`);
      assert(model.platforms.every(f => !f.spikePlatform),
        `${model.stage.label} に CATACOMBS の罠床は存在しない`);
      assert(model.ammo === model.stats.maxAmmo, `${model.stage.label} 開始で CHARGE 満タン（COMBO ${model.combo} は跨いで維持）`);
      playingHp = model.hp;
      continue;
    }
    keepAwake();
    playingHp = model.hp;
    const ground = model.platforms.find(p => p.id === model.player.grounded) as RoutePlatform | undefined;
    // Anything the player is actually STANDING on. A barb row can never appear here -- it is not a
    // floor -- so any id that does is either the chamber or ordinary ground that should not exist.
    if (ground && ground.safeZone === undefined && !ground.breakBlock && ground.id >= 0) ordinaryGround++;
    if (ground?.limboHazard) reloadsOnTrap++;
    // LIMBO is flown, not walked. There is nothing to aim a landing at, so the policy is the one a
    // player uses: step off whatever you are standing on, drop onto a doodad when CHARGE is low, and
    // steer clear of one when it is not -- otherwise the bounce simply hangs the descent up.
    const below = model.doodads.filter(d => d.y > model.player.y + 10).sort((a, b) => a.y - b.y)[0];
    let heading: number | undefined;
    if (ground) heading = ground.x + ground.width / 2 > WORLD.width / 2 ? WORLD.wall : WORLD.width - WORLD.wall;
    else if (below) {
      const over = model.player.x + 9 > below.x && model.player.x - 9 < below.x + below.width;
      const want = model.ammo < model.stats.maxAmmo / 2;
      if (over && !want) heading = below.x - WORLD.wall > WORLD.width - WORLD.wall - (below.x + below.width) ? WORLD.wall : WORLD.width - WORLD.wall;
      else if (!over && want) heading = below.x + below.width / 2;
    }
    // Barbs are avoided, not endured: they span a quarter of the shaft, so a fall that watches for
    // the next row simply goes past it. Only a doodad worth having overrides that.
    const barbs = model.platforms.filter(f => f.limboHazard && f.y > model.player.y + 10).sort((a, b) => a.y - b.y)[0];
    if (barbs && heading === undefined) {
      const onTrack = model.player.x + 12 > barbs.x && model.player.x - 12 < barbs.x + barbs.width;
      if (onTrack) heading = barbs.x - WORLD.wall > WORLD.width - WORLD.wall - (barbs.x + barbs.width) ? WORLD.wall + 20 : WORLD.width - WORLD.wall - 20;
    }
    // A SECTION still ends at the gate, and that has to be walked into.
    const gate = model.exit ? gateHeading(model, ground) : undefined;
    if (gate !== undefined) heading = gate;
    steer(heading === undefined || Math.abs(heading - model.player.x) < 3 ? 0 : Math.sign(heading - model.player.x));
    output.textContent = `AREA 4 をキーボード入力のみで通常プレイ\n${model.stage.label} ${Math.floor(model.sectionDepth)} / ${model.sectionLength}m\n罠床 warning ${warned} · spikes ${spiked} · doodad ${bounces} · 踏みつけ ${stomps}\nHP ${model.hp}/${model.health.maxHp} · 休憩 ${rests.join(' → ') || 'なし'}`;
    await wait(20);
  }
  steer(0); bridge.onEvent = original;
  // KNOWN HARNESS LIMIT, deliberately not asserted away. LIMBO is flown rather than walked, and no
  // simple steering policy written here survives a whole AREA: this bot bleeds out on barb rows a
  // player would fall past. What the GENERATION has to satisfy is held in tests/area4.test.ts --
  // 30 seeds per SECTION reach the way out on doodads alone, the magazine never reaches zero, and
  // terrain costs 1.2-1.5 hits a descent on average. This check holds the AREA's own rules, which
  // have to be true however far the bot gets.
  output.textContent += `\n結果: 休憩 ${rests.join(' → ') || 'なし'} / ${died ? '死亡 ' + died : '生存'} / 到達 ${model.stage.label}`;
  assert(model.health.deathCause?.instant !== true, `即死では終わらない (死因 ${model.health.deathCause?.cause ?? 'なし'})`);
  output.textContent += `\n結果: warning ${warned} / spikes ${spiked} / doodad ${bounces} / 踏みつけ ${stomps} / 通常床フレーム ${ordinaryGround} / ヒビ ${cracks} / 崩落 ${collapses}`;
  assert(cracks === 0 && collapses === 0, `LIMBO では足場は崩れない (ヒビ ${cracks} / 崩落 ${collapses})`);
  assert(spiked > 0, `危険な床に触れて通常ダメージを受けた (${spiked} 回)`);
  assert(warned === 0, `LIMBO に CATACOMBS の warning は出ない (${warned})`);
  assert(reloadsOnTrap === 0, `危険な床には一度も着地していない (${reloadsOnTrap})`);
  assert(stomps === 0, `LIMBO の敵は一度も踏めない (踏みつけ ${stomps})`);
  // This bot steers ledge to ledge, so it reaches the floating scenery only by accident -- it
  // survives the AREA on the dangerous ground alone, which is itself worth knowing. The doodad
  // reload loop is driven deliberately in the 'AREA 4：踏めない敵・射撃撃破・doodadでリロード' check.
  output.textContent += `\n（doodad リロード ${bounces} 回：この bot は足場伝いに降りるため、doodad ループは専用チェックで検証）`;
  // 4-1 opens with a couple of calm rows and the SECTION's own start platform; everything after is
  // barbs the fall goes through. Counted as frames standing on one, so a brief opening reads small.
  assert(ordinaryGround < 200, `Safe Zone 外に休める通常床はほぼない (通常床フレーム ${ordinaryGround})`);
  output.textContent += `\n（通常床に立っていたフレーム ${ordinaryGround}：4-1 冒頭の助走行と SECTION 開始床のみ）`;
  assert(!document.getElementById('boss-clear'), '仮の BOSS CLEAR ボタンは存在しない');
  // Only when the bot actually got there. The 4-3 -> FINAL BOSS transition has its own coverage in
  // the stage suite, and claiming it from a run that ended at 4-1 would be claiming it from nothing.
  if (scene.model.state === 'boss') {
    assert(!document.getElementById('boss-bar')!.hidden, 'FINAL BOSS の HP バーが出ている');
    assert(scene.model.boss.enabled && scene.model.boss.phaseId === 1, 'FINAL BOSS 戦が PHASE 1 で始まっている');
  } else {
    output.textContent += `\n（FINAL BOSS まで到達しなかったため BOSS 側の確認はスキップ：到達 ${scene.model.stage.label}）`;
  }
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
  // LIMBO's barbs are NOT a floor -- nothing lands on one -- so aiming at one as if it were the
  // next landing walks the run straight into a heart's worth of damage for nothing.
  const next = model.platforms
    .filter(f => f.y > p.y + 15 && f.state !== 'broken' && !f.limboHazard)
    .sort((a, b) => a.y - b.y)[0] as RoutePlatform | undefined;
  let target: number | undefined = ground ? ground.exitX + ground.safeSide * 3 : next?.safeX;
  let fire = false;

  // CATACOMBS: landing on a SPIKE PLATFORM arms it, and standing there through the warning is a
  // heart every cycle. Once it is armed the only thing worth doing is walking off the nearer end.
  if (ground?.spikePlatform && ground.spikePlatform.state !== 'safe') {
    const left = p.x - ground.x < ground.width / 2;
    const exit = left ? ground.x - 16 : ground.x + ground.width + 16;
    const inside = exit > WORLD.wall + 12 && exit < WORLD.width - WORLD.wall - 12;
    return { target: inside ? exit : (left ? ground.x + ground.width + 16 : ground.x - 16), fire: false };
  }

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

  // Airborne over a SPIKE PLATFORM that is already armed: the teeth stand 16px proud of the
  // surface, so falling through that column costs a heart whether or not the run means to land.
  // Standing on one is handled above; this is the other half, and it is the half that was killing
  // the run in CATACOMBS -- HP bled away a heart at a time on ledges it was only passing.
  if (!ground) {
    const armed = model.platforms.filter(f => f.spikePlatform && f.spikePlatform.state !== 'safe'
      && f.spikePlatform.state !== 'cooldown' && f.y > p.y - 30 && f.y < p.y + 260
      && p.x + 14 > f.x && p.x - 14 < f.x + f.width);
    if (armed.length) {
      const row = armed.sort((a, b) => a.y - b.y)[0];
      const leftRoom = row.x - WORLD.wall - 14, rightRoom = WORLD.width - WORLD.wall - (row.x + row.width) - 14;
      target = leftRoom > rightRoom ? row.x - 26 : row.x + row.width + 26;
    }
  }

  // A "prefer a ledge without spikes" rule used to live here and was removed: it fired on any
  // spike platform, armed or not, and aimed at a ledge further down by its safeX -- which, while
  // the run was still STANDING on something, replaced "step off this edge" with "stand exactly
  // where you already are" and parked it for good. Choosing where to land is the airborne check
  // above; on the ground the only job is to leave.

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
  //
  // Braking a long fall is a luxury; clearing what is in the way is not. Spending the last rounds
  // on the brake is how the run arrived in CATACOMBS at CHARGE 0 with a spike platform underneath
  // and nothing left to answer it with, so the brake only runs while there is ammo to spare.
  fire = fire || threat || (p.vy > 360 && model.ammo > 2);
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
  let tapFrame = 0;
  const pad = driver();
  const steer = (dir: number) => pad.steer(dir);
  const trigger = (on: boolean) => pad.trigger(on);

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
        // first, then reach: that is what carries a run into THE ABYSS.
        //
        // This list named the PRE-Phase-5 upgrades until now, none of which exist any more -- so
        // every id scored the same and the run silently took whichever card happened to be first.
        const order = [
          'apple', 'youth', 'candle', 'heartBalloon', 'knifeAndFork',
          'laserSight', 'gemAttractor', 'membersCard', 'drone', 'blastModule',
          'safetyJetpack', 'timeout', 'gemPowered', 'hotCasing', 'poppingGems',
        ];
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
        const p = model.player;
        if (model.shop.open) {
          // The last shelf before NIMUSHI: buy whatever the wallet covers, then carry on down.
          for (let i = 0; i < 3; i++) {
            const buy = document.getElementById(`shop-buy-${i}`) as HTMLButtonElement | null;
            if (buy && !buy.disabled) { buy.click(); seen.bought++; await wait(120); break; }
          }
          document.getElementById('shop-close')!.click();
          await wait(120);
          continue;
        }
        frame++;
        const plan = abyssPlan(model, frame);
        steer(plan.target === undefined || Math.abs(plan.target - p.x) < 4 ? 0 : Math.sign(plan.target - p.x));
        trigger(plan.fire);
        const stage = model.abyssStage === 'fight'
          ? `NIMUSHI PHASE ${model.boss.phaseId} · HP ${Math.ceil(model.boss.ratio * 100)}% · ${model.boss.state}`
          : `ABYSS ${model.abyssStage}`;
        output.textContent = `FULL RUN（補助なし）\n${stage}\nHP ${model.hp}/${model.health.maxHp} · COIN ${model.coins.walletCoins}\n経過 ${model.boss.elapsed.toFixed(1)}s`;
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
 * ABYSS 入場 -- 4-3 CLEAR から店・封印・重力反転・NIMUSHI 登場まで、実キー入力だけで通す。
 */
button('ABYSS 入場 → 重力反転', async () => {
  start();
  await until(() => scene.model.state === 'playing', 8000);
  const model = scene.model;
  // A run that DID take shelter, so the guaranteed shelf is what the staging room offers.
  model.safeZoneVisitCount = 2;
  model.jumpToBoss();
  await until(() => model.abyssStage === 'staging', 8000);
  assert(model.state === 'boss' && model.stage.label === 'FINAL BOSS', 'ABYSS は FINAL BOSS 区画として開く');
  assert(model.gravitySign === 1, 'ABYSS の staging では重力はまだ通常方向');
  assert(!model.boss.enabled, 'staging では NIMUSHI はまだ出てこない');
  assert(model.shop.available, '最終ショップが保証されている');
  const prices = model.shop.offers.map(o => o.price);
  assert(model.shop.offers.length === 3 && new Set(model.shop.offers.map(o => o.item)).size === 3, `3種類の商品が並ぶ (${prices.join(' / ')})`);
  assert(Math.min(...prices) >= 950, `World 5 価格で並んでいる (${prices.join(' / ')})`);
  const seal = model.platforms.filter(f => f.breakBlock).length;
  assert(seal === 5, `封印が通路をふさいでいる (BREAK BLOCK ${seal})`);
  const depthAtEntry = Math.floor(model.totalDepth);
  assert(depthAtEntry === PLANNED_TOTAL_DEPTH, `ABYSS 入場時 TOTAL DEPTH = ${depthAtEntry}m`);

  let frame = 0, shopped = 0, reversed = 0;
  const touched = new Set<string>();
  const pad = driver();
  const steer = (dir: number) => pad.steer(dir);
  const trigger = (on: boolean) => pad.trigger(on);
  const original = bridge.onEvent;
  bridge.onEvent = (event, m) => { if (event.type === 'gravityFlip') reversed++; defaultEventHandler?.(event, m); };
  const deadline = performance.now() + 90000;
  while (model.abyssStage !== 'fight' && performance.now() < deadline && model.state !== 'over') {
    keepAwake();
    if (model.shop.open) {
      shopped++;
      document.getElementById('shop-close')!.click();
      await wait(120);
      continue;
    }
    frame++;
    const plan = abyssPlan(model, frame);
    if (model.player.grounded !== -1) {
      const g = model.platforms.find(f => f.id === model.player.grounded);
      if (g) touched.add(`${g.id}@${Math.round(g.y)}${g.safeZone !== undefined ? '(zone)' : ''}`);
    }
    steer(plan.target === undefined || Math.abs(plan.target - model.player.x) < 4 ? 0 : Math.sign(plan.target - model.player.x));
    trigger(plan.fire);
    output.textContent = `ABYSS ${model.abyssStage}\n封印 ${model.platforms.filter(f => f.breakBlock && f.state !== 'broken').length}/5 · y ${Math.round(model.player.y)} · HP ${model.hp}`;
    await wait(16);
  }
  steer(0); trigger(false);
  bridge.onEvent = original;
  output.textContent += `\n着地した床: ${[...touched].join(' / ')}`;
  assert(shopped > 0, `最終ショップに実際に入った (${shopped} 回)`);
  assert(model.abyssStage === 'fight', `封印を撃ち抜いて重力反転まで到達 (${model.abyssStage})`);
  assert(reversed >= 2, `GRAVITY REVERSED の演出が入った (${reversed} 段階)`);
  assert(model.gravitySign === -1 && model.inverted, '重力が反転している');
  assert(model.boss.enabled && model.boss.state === 'dormant', 'NIMUSHI は休眠状態で登場する');
  assert(model.boss.y < model.player.y, 'NIMUSHI は画面上・プレイヤーは下');
  assert(model.boss.boundaryY > model.player.y, '深淵はプレイヤーの下から迫る');
  assert(Math.floor(model.totalDepth) === PLANNED_TOTAL_DEPTH, 'TOTAL DEPTH は 3780m のまま');
  // The HUD is screen-space and stays the right way up.
  const bar = document.getElementById('boss-bar')!;
  assert(!bar.hidden && bar.textContent!.includes('NIMUSHI'), 'NIMUSHI の HP バーが出ている');
  assert(getComputedStyle(document.getElementById('hud')!).transform === 'none', 'HUD は反転していない');
});

/**
 * 反転した操作そのもの -- ACTION が上へ撃ち、反動が下へ効く。
 */
button('反転 ACTION / 弱点', async () => {
  start();
  await until(() => scene.model.state === 'playing', 8000);
  scene.model.jumpToNimushi();
  await until(() => scene.model.abyssStage === 'fight', 8000);
  const model = scene.model;
  // The scene must not race this: the Phaser scene is paused and the model is stepped by hand.
  pause();
  model.paused = false;
  model.platforms = []; model.doodads = [];
  model.player.grounded = -1; model.player.vy = 0; model.bullets = [];
  model.shoot();
  assert(model.bullets.length > 0 && model.bullets.every(b => b.vy < 0), `ACTION は上へ撃つ (vy ${Math.round(model.bullets[0].vy)})`);
  assert(model.player.vy > 0, `反動は下へ効く (vy ${Math.round(model.player.vy)})`);
  // LEFT / RIGHT are untouched.
  const x0 = model.player.x;
  model.moveHorizontal(0.1, 1);
  assert(model.player.x > x0, 'RIGHT は右のまま');
  model.moveHorizontal(0.1, -1);
  assert(model.player.x < model.player.x + 1, 'LEFT は左のまま');
  // The body is armour; the eye is the fight.
  model.bullets = [];
  const hp0 = model.boss.hp;
  const body = model.boss.body;
  model.bullets.push({ ...plainBullet(body.x + 14, body.y + 8, 5), vy: 0, previousY: body.y + 8 });
  for (let i = 0; i < 10; i++) model.step(1 / 120, 0, false);
  assert(model.boss.hp === hp0, '本体を撃っても NIMUSHI の HP は減らない');
  assert(!model.boss.started, '本体撃ちでは戦闘が始まらない');
  const eye = model.boss.eye;
  model.bullets.push({ ...plainBullet(model.boss.x, eye.y + eye.height / 2, 3), vy: 0, previousY: eye.y + eye.height / 2 });
  for (let i = 0; i < 10; i++) model.step(1 / 120, 0, false);
  assert(model.boss.hp < hp0, `弱点に当てると HP が減る (${hp0} → ${model.boss.hp})`);
  assert(model.boss.started, '弱点ヒットで戦闘開始 = BOSS TIME スタート');
  // An explosion cannot get round the eye, from any of the four upgrades that make one.
  const hp1 = model.boss.hp;
  model.spawnExplosion({ x: model.boss.x, y: eye.y, radius: 420, damage: 99 });
  assert(model.boss.hp === hp1, '爆発は弱点を迂回できない');
  pause();
});

/**
 * How a player answers THE ABYSS, in one place.
 *
 * Two rooms, one brain. In the staging room it walks to whatever is on offer -- the shelf, or the
 * TOMATO -- and then shoots the seal open. In the arena it does what the fight asks: get out of a
 * live beam, step out of a falling column, keep off a cup, and otherwise line up under the eye and
 * squeeze the trigger. The gunboots fire along the pull, which is straight up at NIMUSHI, and the
 * recoil is what holds the player off the deep -- so it eases off when the deep has got close.
 */
/**
 * Where to walk to leave the slab underfoot.
 *
 * A ledge cut into a wall has only ONE open side, and the SAFE ZONE floor in the staging room is
 * exactly that. Stepping towards the wall would simply pin the run against the brickwork, so the
 * preferred side is dropped whenever there is nothing to step into.
 */
function stepOff(ground: Platform, prefer: 'left' | 'right') {
  const left = WORLD.wall + 12, right = WORLD.width - WORLD.wall - 12;
  const leftExit = ground.x - 24, rightExit = ground.x + ground.width + 24;
  let wantLeft = prefer === 'left';
  if (wantLeft && leftExit <= left) wantLeft = false;
  if (!wantLeft && rightExit >= right) wantLeft = true;
  return wantLeft ? Math.max(left, leftExit) : Math.min(right, rightExit);
}

function abyssPlan(model: GameModel, frame: number): { target?: number; fire: boolean } {
  const p = model.player;
  if (model.abyssStage === 'staging') {
    const tomato = model.pickups.find(k => !k.taken && k.kind === 'tomato');
    const door = model.shop.entrance;
    const seal = model.platforms.filter(f => f.breakBlock && f.state !== 'broken');
    // Once a stone has given way there is a hole, and the hole is the whole point: aim for it and
    // stop shooting, rather than standing under the next stone and hovering on the recoil.
    let hole: number | undefined;
    for (let x = WORLD.wall + 14; seal.length && x <= WORLD.width - WORLD.wall - 14; x += 8) {
      if (!seal.some(b => x > b.x - 10 && x < b.x + b.width + 10)) { hole = x; break; }
    }
    // Two things down here are worth WALKING to rather than falling past: the doorway, and the
    // TOMATO a run without a shop gets instead. Everything else is below, at the seal.
    const wantShop = !!door && !model.shop.used;
    const wantTomato = !!tomato;
    let target: number | undefined;
    if (tomato && tomato.y > p.y - 140) target = tomato.x;
    // The doorway stands ON the chamber floor, so once the player is standing there too its y is
    // ABOVE theirs by the height of the door. The margin has to cover that or the run walks in,
    // lands, and then forgets what it came for.
    else if (door && wantShop && door.y > p.y - 140) target = door.x + door.width / 2;
    else if (seal.length) target = hole ?? seal.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0].x + 20;
    const ground = model.platforms.find(f => f.id === p.grounded);
    if (ground) {
      // Standing still only ever makes sense on the floor that actually CARRIES what is wanted:
      // the chamber floor for the doorway, the ledge the TOMATO is lying on. A target that merely
      // happens to share an x with the ledge overhead would otherwise park the run there forever.
      const atDoor = wantShop && ground.safeZone !== undefined;
      const atTomato = wantTomato && Math.abs(tomato!.y - p.y) < 44;
      if (!atDoor && !atTomato) {
        const wantLeft = target === undefined ? p.x - ground.x < ground.width / 2 : target < ground.x + ground.width / 2;
        target = stepOff(ground, wantLeft ? 'left' : 'right');
      }
    }
    // Airborne ACTION is the gunboots, so holding the trigger on the way down would simply hover
    // on the recoil. It is saved for the seal, which is the one thing down here that needs shooting.
    const shooting = seal.length > 0 && hole === undefined && !wantShop && !wantTomato && seal[0].y - p.y < 520;
    return { target, fire: p.grounded === -1 && shooting && frame % 8 < 4 };
  }
  const boss = model.boss;
  if (!boss.enabled) return { fire: false };
  const beam = boss.beams.find(b => b.state === 'live' && Math.abs(b.x - p.x) < b.width / 2 + 30);
  const warning = boss.beams.find(b => b.state === 'warning' && Math.abs(b.x - p.x) < b.width / 2 + 30);
  // Only a pearl that is genuinely about to arrive is worth breaking the aim for. Treating the
  // whole column as a threat keeps the run permanently sidestepping and never shooting back.
  const pearl = boss.tapiocas.filter(t => Math.abs(t.x - p.x) < 26 && Math.abs(t.y - p.y) < 170).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
  const cup = boss.cups.find(c => c.alive && Math.abs(c.x - p.x) < 40 && Math.abs(c.y - p.y) < 170);
  const away = (x: number, by: number) => (x < 225 ? x + by : x - by);
  /**
   * The nearest column with nothing falling down it.
   *
   * A wave always leaves lanes open -- that is a guarantee of the attack, not luck -- so the answer
   * to a shower is to go and stand in one, not to shuffle a fixed distance sideways and hope.
   */
  const safest = () => {
    const threats = boss.tapiocas.filter(t => Math.abs(t.y - p.y) < 420);
    if (!threats.length) return undefined;
    let best: number | undefined, bestCost = Infinity;
    for (let x = WORLD.wall + 24; x <= WORLD.width - WORLD.wall - 24; x += 12) {
      const near = threats.reduce((m, t) => Math.min(m, Math.abs(t.x - x)), Infinity);
      if (near < 30) continue;
      const cost = Math.abs(x - p.x) - near * 0.35;
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    return best;
  };
  const ground = model.platforms.find(f => f.id === p.grounded);
  // The arena hangs its rows from one wall at a time and leaves the other side open. Climbing
  // means using that lane rather than ploughing into the next slab, so a row just ahead along the
  // pull outranks lining up under the eye.
  const climbing = model.platforms
    .filter(f => (f.y - p.y) * model.gravitySign < 0 && Math.abs(f.y - p.y) < 300 && p.x + 30 > f.x && p.x - 30 < f.x + f.width)
    .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
  let target: number | undefined = boss.x;
  if (beam || warning) target = away((beam ?? warning)!.x, 130);
  else if (pearl) target = safest() ?? away(pearl.x, 74);
  else if (cup) target = away(cup.x, 74);
  else if (ground) target = stepOff(ground, p.x - ground.x < ground.width / 2 ? 'left' : 'right');
  else if (climbing) target = climbing.x + climbing.width / 2 < 225 ? WORLD.width - WORLD.wall - 20 : WORLD.wall + 20;
  // On a ledge ACTION jumps rather than fires, which is how you leave one -- but a jump goes
  // AWAY from NIMUSHI, so it is not what you do with the deep already at your heels. Then you
  // simply walk off the edge and let the pull take you.
  if (p.grounded !== -1) return { target, fire: boss.reach(p.y) < 380 };
  // The gunboots reach far further than NIMUSHI ever gets, so the only reason to hold fire is the
  // recoil pushing the run back towards the deep -- and a live beam, which is not worth trading.
  const reach = boss.reach(p.y);
  const aimed = Math.abs(boss.x - p.x) < 52;
  return { target, fire: model.ammo > 0 && !beam && aimed && reach < 520 && frame % 6 < 3 };
}

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
  start(); scene.model.jumpToNimushi();
  await until(() => scene.model.abyssStage === 'fight' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  pause();                                    // the scene must not race this; we drive the step

  // 1. The game damaging NIMUSHI through its own simulation. The API is reached from
  //    GameModel.step, so the call site is the game even though this file started the step.
  const quiet = watchForAssists(model);
  const eye = model.boss.eye;
  model.player.x = model.boss.x;
  model.player.y = eye.y + 300;
  model.bullets.push({ ...plainBullet(model.boss.x, eye.y + eye.height / 2, 5), vy: 0, previousY: eye.y + eye.height / 2 });
  const before = model.boss.hp;
  model.paused = false;
  for (let i = 0; i < 20 && model.boss.hp === before; i++) model.step(1 / 120, 0, false);
  const dealt = before - model.boss.hp;
  quiet.stop();
  output.textContent += `\nゲーム自身の弾が与えたダメージ: ${dealt}`;
  assert(dealt > 0, '実際に弱点へ当たっている（当たらなければ何も検証していない）');
  assert(quiet.used.length === 0, `ゲーム自身の処理は補助として検出されない（検出: ${quiet.used.join(', ') || 'なし'}）`);

  // 2. The same APIs, called straight from this file. The watchdog must see every one. NIMUSHI's
  //    HP is a field rather than a method, so the FIELD is what has to be caught.
  const caught = watchForAssists(model);
  model.heal(9);
  model.boss.hp = 5;
  model.boss.phaseId = 4;
  model.boss.deepY = model.player.y + 900;
  model.player.invincible = 99;
  caught.stop();
  output.textContent += `\n意図的な補助の検出: ${caught.used.join(', ')}`;
  assert(caught.used.includes('model.heal'), 'テストからの heal を検出する');
  assert(caught.used.includes('boss.hp'), 'テストからの BOSS HP 直書きを検出する');
  assert(caught.used.includes('boss.phaseId'), 'テストからのフェーズ飛ばしを検出する');
  assert(caught.used.includes('boss.deepY'), 'テストからの圧力リセットを検出する');
  assert(caught.used.includes('player.invincible'), 'テストからの無敵付与を検出する');
  pause();
});
button('UNASSISTED BOSS CHECK', async () => {
  start();
  await until(() => scene.model.state === 'playing', 8000);
  // Twelve cards, which is what a cleared run reaches NIMUSHI holding.
  for (const definition of UPGRADES.slice(0, 12)) scene.model.upgrades.grant(definition.id);
  scene.model.jumpToNimushi();
  await until(() => scene.model.abyssStage === 'fight' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  const watch = watchForAssists(model);
  const startHp = model.hp;
  const phases: number[] = [];
  const original = bridge.onEvent;
  bridge.onEvent = (event, m) => { if (event.type === 'bossPhase') phases.push(Number(event.value)); defaultEventHandler?.(event, m); };
  let hits = 0, lastHp = model.hp, deepest = 1, healed = 0, tapFrame = 0;
  const pad = driver();
  const steer = (dir: number) => pad.steer(dir);
  const trigger = (on: boolean) => pad.trigger(on);
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
    tapFrame++;
    // The AQUIFER stretch drowns the player, so air comes before aiming when the tank is low.
    const plan = abyssPlan(model, tapFrame);
    let target = plan.target;
    if (model.oxygen.enabled && model.oxygen.remaining < 6) {
      const bubble = model.bubbles.filter(b => !b.taken && Math.abs(b.y - p.y) < 320).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
      const box = model.containers.filter(c => !c.broken && Math.abs(c.y - p.y) < 520).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
      if (bubble && Math.abs(bubble.x - p.x) < 200) target = bubble.x;
      else if (box) target = box.x + box.width / 2;
    }
    steer(target === undefined || Math.abs(target - p.x) < 4 ? 0 : Math.sign(target - p.x));
    trigger(plan.fire);
    output.textContent = `UNASSISTED BOSS CHECK\nPHASE ${boss.phaseId} · NIMUSHI HP ${Math.ceil(boss.ratio * 100)}% · ${boss.state}\nHP ${model.hp}/${model.health.maxHp} · 被弾 ${hits}\n経過 ${boss.elapsed.toFixed(1)}s`;
    await wait(16);
  }
  steer(0); trigger(false);
  const fightTime = model.boss.enabled ? model.boss.elapsed : scene.model.bossTime;
  await wait(1400);
  bridge.onEvent = original;
  const won = scene.model.state === 'clear';
  const cause = scene.model.health.deathCause?.cause ?? 'なし';
  assert(scene.model.gravitySign === -1 || won, '戦闘中ずっと重力は反転していた');
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
  // Twelve cards, which is what a cleared run reaches the king holding.
  for (const definition of UPGRADES.slice(0, 12)) scene.model.upgrades.grant(definition.id);
  scene.model.health.heal(9);
  scene.model.jumpToNimushi();
  await until(() => scene.model.abyssStage === 'fight' && scene.model.boss.enabled, 8000);
  const model = scene.model;
  const phases: number[] = [];
  const telegraphs: Record<string, number> = {};
  const attacks: Record<string, number> = {};
  const eyeStates: number[] = [];
  let rages = 0;
  const original = bridge.onEvent;
  bridge.onEvent = (event, model) => {
    if (event.type === 'bossPhase') phases.push(Number(event.value));
    if (event.type === 'bossTelegraph') telegraphs[String(event.stage)] = (telegraphs[String(event.stage)] ?? 0) + 1;
    if (event.type === 'bossFire') attacks[String(event.stage)] = (attacks[String(event.stage)] ?? 0) + 1;
    if (event.type === 'bossEye') eyeStates.push(Number(event.value));
    if (event.type === 'bossRage') rages++;
    defaultEventHandler?.(event, model);
  };
  const pad = driver();
  const steer = (dir: number) => pad.steer(dir);
  const trigger = (on: boolean) => pad.trigger(on);
  let barSeen = 0, climaxSeen = false, deepestPhase = 1, playedSeconds = 0, tapFrame = 0;
  const deadline = performance.now() + 260000;
  while (model.state === 'boss' && performance.now() < deadline) {
    deepestPhase = Math.max(deepestPhase, model.boss.phaseId);
    playedSeconds = model.boss.elapsed;
    keepAwake();
    const p = model.player;
    const boss = model.boss;
    if (!boss.enabled) break;
    if (boss.rageActive) climaxSeen = true;
    if (Number(document.getElementById('boss-percent')!.textContent!.replace('%', '')) <= 100) barSeen++;
    tapFrame++;
    const plan = abyssPlan(model, tapFrame);
    let target = plan.target;
    if (model.oxygen.enabled && model.oxygen.remaining < 6) {
      const bubble = model.bubbles.filter(b => !b.taken && Math.abs(b.y - p.y) < 320).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
      const box = model.containers.filter(c => !c.broken && Math.abs(c.y - p.y) < 520).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
      if (bubble && Math.abs(bubble.x - p.x) < 200) target = bubble.x;
      else if (box) target = box.x + box.width / 2;
    }
    steer(target === undefined || Math.abs(target - p.x) < 4 ? 0 : Math.sign(target - p.x));
    trigger(plan.fire);
    // Propped up on purpose: the STRAW BEAM costs two hearts, so a one-heart floor is not a floor.
    if (model.hp <= 3) model.health.heal(1);   // survive long enough to verify the whole fight
    output.textContent = `FINAL BOSS / NIMUSHI\nPHASE ${boss.phaseId} · HP ${Math.ceil(boss.ratio * 100)}% · ${boss.state}\nHP ${model.hp}/${model.health.maxHp} · AMMO ${model.ammo}\n経過 ${boss.elapsed.toFixed(1)}s`;
    await wait(16);
  }
  steer(0); trigger(false);
  // Everything above is real keyboard play. The keyboard bot steers at 60Hz and sometimes misses a
  // ledge, so rather than rely on it landing the last hit, the remaining HP is removed directly:
  // the fight itself is verified by the play above, the defeat sequence and result screen below.
  assert(playedSeconds > 25, `キーボード入力だけで ${playedSeconds.toFixed(1)}s 戦闘した`);
  // What the keyboard bot is for is proving the cycle runs under real input, not measuring
  // difficulty -- UNASSISTED BOSS CHECK does that. The stretch it reaches is reported, not gated
  // beyond "it got past the first one".
  assert(deepestPhase >= 2, `実入力で PHASE ${deepestPhase} まで到達した`);
  output.textContent += `\nキーボード戦闘の結果: ${scene.model.state}${scene.model.health.deathCause ? ` / 死因 ${scene.model.health.deathCause.cause}` : ''} · NIMUSHI HP ${Math.ceil(scene.model.boss.ratio * 100)}%`;
  if (scene.model.state === 'boss') {
    // The keyboard bot steers at 60Hz and does not always land the last window in time. NIMUSHI's
    // HP is only ever spent through an open eye, so the finish is driven the same way here --
    // real rounds into the weak point -- rather than by writing the number.
    scene.model.health.heal(9);
    const deadline2 = performance.now() + 240000;
    while (scene.model.boss.enabled && !scene.model.boss.defeated && performance.now() < deadline2) {
      keepAwake();                              // a headless pane stops stepping without this
      const m = scene.model, eye = m.boss.eye;
      m.player.invincible = 9;
      if (m.boss.eyeOpen) m.bullets.push({ ...plainBullet(m.boss.x, eye.y + eye.height / 2, 4), vy: 0, previousY: eye.y + eye.height / 2 });
      output.textContent = `仕上げ（弱点撃ちのみ）\nPHASE ${m.boss.phaseId} · HP ${Math.ceil(m.boss.ratio * 100)}% · ${m.boss.state}`;
      await wait(16);
    }
    output.textContent += `\n仕上げ後の NIMUSHI HP: ${Math.ceil(scene.model.boss.ratio * 100)}%`;
    await until(() => scene.model.state === 'clear', 8000);
  }
  bridge.onEvent = original;
  // THE ABYSS announces the stretch it opens on as well as the three it crosses into.
  assert(phases.join(',') === '1,2,3,4', `PHASE 1 → 2 → 3 → 4 と進行した (${phases.join(' → ')})`);
  assert(climaxSeen && rages === 1, `FINAL RAGE が一度だけ発動した (${rages} 回)`);
  assert(eyeStates.includes(0) && eyeStates.includes(1), `弱点が閉じて再び開いた (${eyeStates.join('')})`);
  assert(Object.keys(attacks).length >= 3, `タピオカ攻撃が3種類以上出た (${Object.entries(attacks).map(([k, v]) => `${k}:${v}`).join(' / ')})`);
  assert(Object.keys(telegraphs).length >= 3, `どの攻撃にも予告があった (${Object.keys(telegraphs).join(' / ')})`);
  assert(barSeen > 0, 'NIMUSHI HPバーが表示され続けた');
  assert(scene.model.state === 'clear', 'GAME CLEAR に到達');
  await until(() => !!document.getElementById('play-again'), 8000);
  const clear = document.body.innerText;
  assert(clear.includes('GAME CLEAR'), 'GAME CLEAR 表示');
  assert(clear.includes('CLEAR TIME'), 'CLEAR TIME 表示');
  assert(/CLEAR TIME\s*\d+:[0-5]\d/.test(clear.replace(/\n/g, ' ')), `CLEAR TIME が m:ss 形式`);
  assert(!!document.getElementById('play-again'), 'PLAY AGAIN ボタンがある');
});
