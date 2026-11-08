import './audit-fixtures.js';
import { rectCounts } from './scenes/air-art.js';

const STEP = 1 / 120;
const END = 540;
const names = ['area3', 'timeout', 'boss', 'catch', 'stress'];
const variants = ['Current', 'A', 'B'];
let tick = 0;
let fixture = 'area3';
let model;
let scene;
let box;
let playing = false;
let last = 0;
let carry = 0;
let animation = 0;
let recovered = 0;

function reset(which) {
  if (!names.includes(which)) throw Error('Unknown review scene');
  fixture = which;
  tick = 0;
  recovered = 0;
  auditSetup({ area: which === 'boss' ? 'boss' : 3, held: which === 'timeout' ? ['timeout'] : [] });
  model = scene.model;
  if (which === 'boss') {
    model.boss.phaseId = 3;
    model.enterAbyssPhase(model.boss.phase);
  }
  box = model.containers.find(b => !b.broken && b.y > model.cameraY + 80 && b.y < model.cameraY + 720)
    ?? model.containers.find(b => !b.broken);
  if (!box) throw Error('Fixture has no generated container');
  model.cameraY = box.y - 410;
  model.player.x = box.x < 225 ? Math.min(390, box.x + 70) : Math.max(60, box.x - 55);
  model.player.y = model.cameraY + 356;
  model.oxygen.remaining = 4.8;
  if (which === 'timeout') {
    const { x, y } = model.player;
    model.player.x = box.x + box.width / 2;
    model.player.y = box.y + 55;
    model.damage(1);
    model.player.x = x;
    model.player.y = y;
    if (model.timeFrozen) model.player.y -= 50;
  }
  model.events = [];
  model.breakContainer(box);
  if (which === 'stress') {
    model.player.y = model.cameraY + 575;
    const source = model.bubbles.slice();
    model.bubbles = Array.from({ length: 12 }, (_, i) => ({
      ...source[i % source.length], id: 1000 + i,
      x: 100 + (i % 4) * 58, y: model.cameraY + 385 + Math.floor(i / 4) * 30,
    }));
  }
  model.events = [];
  scene.bridge.onFrame(model);
}

function advance(target) {
  for (; tick < target; tick++) {
    if (fixture === 'catch' && tick === 64 && model.bubbles.length) {
      const first = model.bubbles[0];
      model.player.x = first.x;
      model.player.y = first.y;
    }
    if (fixture === 'catch' && tick === 65) model.player.x = box.x < 225 ? 389 : 61;
    model.elapsed += STEP;
    model.tickContainers(STEP);
    model.tickBubbles(STEP);
    for (const event of model.events) {
      if (event.type === 'oxygen') recovered += event.value;
    }
    model.events.length = 0;
  }
  scene.bridge.onFrame(model);
}

function render() {
  const start = performance.now();
  scene.draw();
  const afterDraw = performance.now();
  const renderer = scene.game.renderer;
  renderer.preRender();
  scene.sys.render(renderer);
  renderer.postRender();
  return [afterDraw - start, performance.now() - start];
}

function describe() {
  const g = scene.worldFrontAir;
  const canvas = scene.game.canvas;
  return {
    fixture, tick, recovered, playing,
    variant: window.airReviewVariant ?? 'Current',
    cameraY: model.cameraY, elapsed: model.elapsed, oxygen: model.oxygen.remaining,
    hp: model.hp, box: { id: box.id, shotOnly: !!box.shotOnly, x: box.x, y: box.y },
    player: { x: model.player.x, y: model.player.y }, frozen: model.timeFrozen,
    timeout: model.timeoutBubbles, bubbles: model.bubbles,
    layer: { x: g.x, y: g.y, commandSlots: g.commandBuffer.length },
    rectCounts, renderer: scene.game.renderer.type, dpr: devicePixelRatio,
    canvas: canvas.getBoundingClientRect().toJSON(),
    touch: getComputedStyle(document.getElementById('touch-controls')).display,
  };
}

function animate(now) {
  if (!playing) return;
  if (last) carry += Math.min(now - last, 100) / 1000;
  last = now;
  const steps = Math.floor(carry / STEP);
  carry -= steps * STEP;
  if (tick === END && steps) reset(fixture);
  if (steps) advance(Math.min(END, tick + steps));
  render();
  animation = requestAnimationFrame(animate);
}

function play(on) {
  if (playing === on) return;
  playing = on;
  cancelAnimationFrame(animation);
  last = 0;
  carry = 0;
  if (on) animation = requestAnimationFrame(animate);
}

async function initialize() {
  while (!window.airReviewScene) await new Promise(requestAnimationFrame);
  await document.fonts.ready;
  scene = window.airReviewScene;
  scene.update = () => {};
  scene.game.loop.sleep();
  window.auditM = scene.model.constructor;
  window.s = scene;
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.append(style);
  if (new URLSearchParams(location.search).has('touch')) {
    style.textContent += '#touch-controls.visible{display:flex!important}';
  }
  window.airReview = {
    reset(which) { reset(which); render(); },
    seek(target) {
      const frame = Math.max(0, Math.min(END, Math.round(target)));
      if (frame < tick) reset(fixture);
      advance(frame);
      render();
    },
    setVariant(variant) {
      if (!variants.includes(variant)) throw Error('Unknown art variant');
      window.airReviewVariant = variant;
      render();
    },
    describe,
    render,
    play,
  };
  reset('area3');
  advance(48);
  render();
}
initialize();
