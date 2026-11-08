// REVIEW ONLY: state preparation; no draw interception, no candidate rendering.
window.auditCases=[
{id:'area1',area:1},{id:'area2',area:2},{id:'area3',area:3},{id:'area4',area:4},
{id:'timeout-a1',area:1,held:['timeout','drone'],action:'timeout'},
{id:'timeout-a3',area:3,held:['timeout','drone','heartBalloon','safetyJetpack'],action:'timeout'},
{id:'timeout-a4',area:4,held:['timeout','drone','heartBalloon','safetyJetpack'],action:'timeout'},
{id:'timeout-boss',area:'boss',held:['timeout','drone','heartBalloon','safetyJetpack'],action:'timeout'},
{id:'sight-a2',area:2,held:['laserSight','drone','heartBalloon','safetyJetpack'],action:'sight'},
{id:'sight-boss',area:'boss',held:['laserSight','drone','heartBalloon','safetyJetpack'],action:'sight'},
{id:'shot-triple',area:3,held:['drone','heartBalloon','hotCasing'],action:'shot',weapon:'triple'},
{id:'shot-laser',area:4,held:['drone','heartBalloon'],action:'shot',weapon:'laser'},
{id:'shot-puncher',area:2,held:['drone','heartBalloon'],action:'shot',weapon:'puncher'},
{id:'jetpack-reference',area:3,held:['drone','heartBalloon','safetyJetpack'],action:'jetpack'},
{id:'air-bubbles',area:3,action:'air'},
{id:'bones',area:2,action:'bones'},
{id:'boss-pearls',area:'boss',held:['drone','heartBalloon'],action:'pearls'},
{id:'boss-barrier',area:'boss',held:['drone','heartBalloon'],action:'barrier'},
{id:'boss-tell',area:'boss',action:'tell'},
{id:'boss-summon',area:'boss',action:'summon'},
{id:'boss-heart',area:'boss',action:'heart'},
{id:'staging',area:'staging',action:'shop-room'},
{id:'staging-tomato',area:'staging',action:'tomato'},
{id:'shop',area:'staging',action:'shop'},
{id:'rest',area:2,action:'rest'},
{id:'game-over',area:4,action:'over'},
{id:'clear',area:'boss',action:'clear'},
{id:'explosion',area:3,held:['blastModule','drone','heartBalloon'],action:'explosion'},
];
window.auditSetup=cfg=>{
 let seed=71103;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 s.labels.forEach(x=>x.text.destroy());s.labels=[];s.particles=[];s.flash=0;s.shake=0;s.hurtAge=100;s.freeze=0;s.accumulator=0;s.playerArt.reset();
 s.model=new auditM(false,rng);const m=s.model,p=m.player;const notes=['Suspended state fixture, not uninterrupted earned gameplay.'];const triggers=[];
 (cfg.held||[]).forEach(id=>m.upgrades.grant(id));m.syncUpgrades();
 if(cfg.area==='staging'){m.safeZoneVisitCount=cfg.action==='tomato'?0:1;m.warpTo('boss');}
 else if(cfg.area==='boss'){m.jumpToNimushi();m.cameraY=Math.round(m.cameraY);p.y=m.cameraY+485;m.boss.x=225;m.boss.y=m.cameraY+200;m.boss.mark=p.y;m.boss.deepY=m.cameraY+1100;m.boss.started=true;m.boss.engaged=true;m.boss.state='eyeOpen';m.boss.timer=1.2;notes.push('Arena boss/player/camera manually sampled; approach omitted.');}
 else {m.warpTo(`${cfg.area}-3`);m.cameraY=2200;p.y=2550;m.generate();}
 p.x=225;p.vy=150*m.gravitySign;p.grounded=-1;m.elapsed=10;m.events=[];
 if(m.balloon){m.balloon.x=p.x;m.balloon.y=p.y-46*m.gravitySign;}
 s.bridge.direction=0;s.bridge.firing=false;
 const act=cfg.action;
 if(act==='timeout'){m.hurt();triggers.push('GameModel.hurt -> damage accepted -> timeoutBubbles');s.hurtAge=.4;m.health.tick(.4);}
 if(act==='sight'||act==='shot'){
  m.gun.equip(cfg.weapon||'noppy');s.bridge.direction=act==='sight'?1:0;m.fireVolley(m.gun.module.ammoCost,s.bridge.direction);
  m.bullets.forEach(b=>{b.x+=b.vx*.16;b.y+=b.vy*.16;b.travelled+=Math.hypot(b.vx,b.vy-(b.carried||0))*.16});triggers.push('GameModel.fireVolley');notes.push('160ms ballistic sample without collision replay.');
 }
 if(act==='jetpack'){m.ammo=0;p.vy=m.physics.maxFallSpeed*m.gravitySign;m.fireGun(1/120,0,true);triggers.push('GameModel.fireGun(empty)');}
 if(act==='air'){
  let box=m.containers.find(b=>!b.broken&&b.y>m.cameraY+80&&b.y<m.cameraY+720)||m.containers.find(b=>!b.broken);
  if(!box)throw Error('no generated air container');m.cameraY=box.y-420;p.y=m.cameraY+350;m.breakContainer(box);for(let i=0;i<48;i++)m.tickBubbles(1/120);triggers.push('GameModel.breakContainer + 48 tickBubbles');
 }
 if(act==='bones'){
  const e=m.enemies.find(e=>e.kind==='boneThrower');if(!e)throw Error('no generated boneThrower');m.cameraY=e.y-400;p.x=e.x>225?e.x-140:e.x+140;p.y=e.y;p.vy=0;
  const origY=p.y,origX=p.x;for(let i=0;i<300&&!m.bones.length;i++){m.step(1/120,0,false);p.x=origX;p.y=origY;p.vy=0;p.invincible=1;}
  if(!m.bones.length)throw Error('bone emitter did not fire');m.cameraY=m.bones[0].y-400;triggers.push('GameModel.step -> stepDweller bone emitter');notes.push('Player held at emitter acquisition range during source ticks.');
 }
 if(['pearls','barrier','tell','summon'].includes(act)){
  const b=m.boss;b.y=m.cameraY+340;b.started=true;b.engaged=true;b.barrierAge=2;b.state='tripleShot';b.timer=1.45;b.prepare('tripleShot',p);
  if(act==='pearls'){b.launch('tripleShot',p,rng,[]);for(let f=0;f<50;f++)b.update(1/120,p,rng,m.cameraY);triggers.push('NimushiBossSystem.launch(tripleShot) + 50 update ticks');}
  if(act==='tell'){b.pendingAttack='tripleShot';b.state='attackPrep';b.timer=.3;triggers.push('Sampled active tripleShot windup state');}
  if(act==='summon'){b.pendingAttack='enemySummon';b.state='attackPrep';b.timer=.3;triggers.push('Sampled active enemySummon windup state');}
  m.cameraY=Math.round(b.y-216);notes.push('Camera reframed on sampled boss; no disabled attack enabled.');
 }
 if(act==='heart'){const h=m.pickups.find(p=>p.kind==='heart');if(!h)throw Error('no source opening heart');m.cameraY=h.y-400;p.x=h.x+55;p.y=h.y+70;triggers.push('Opening layAbyssBatch generated heart');}
 if(cfg.area==='staging'){
  const z=m.safeZones[0];m.cameraY=z.y-280;p.x=z.x+z.width/2;p.y=z.y+z.height-16;p.vy=0;notes.push('Staging chamber camera/position sampled.');
  if(act==='tomato'){const t=m.pickups.find(i=>i.kind==='tomato');s.tomatoSeen.set(t,-Infinity);triggers.push('Source buildStaging no-shelter tomato; settled reveal.');}
 }
 if(act==='explosion'){m.spawnExplosion({x:p.x,y:p.y+26*m.gravitySign,radius:78,damage:2});triggers.push('Source-equivalent blastModule stomp explosion (contact not replayed)');}
 // Restore the in-play DOM shell for fixtures; actual menus below are built through bridge events.
 const o=document.getElementById('overlay');o.hidden=true;o.classList.remove('title-overlay');o.innerHTML='';
 document.getElementById('game-frame').classList.remove('title-screen','title-fading');document.getElementById('game-frame').classList.add('in-play');
 document.getElementById('touch-controls').hidden=false;document.getElementById('touch-controls').classList.add('visible');document.getElementById('pause').disabled=false;
 // Discard section/cast feedback only; hurt/shot/explosion particle events still use production.
 s.dispatchEvents();
 if(act==='rest'){m.completeSection();s.dispatchEvents();triggers.push('GameModel.completeSection -> production REST panel');}
 if(act==='shop'){m.enterShop();s.dispatchEvents();if(m.state!=='shop')throw Error('shop not entered');triggers.push('GameModel.enterShop -> production SHOP panel');}
 if(act==='over'){m.killInstantly('enemy');m.finish();s.dispatchEvents();triggers.push('GameModel.killInstantly + finish -> production GAME OVER');}
 if(act==='clear'){m.clearBoss();s.dispatchEvents();triggers.push('GameModel.clearBoss -> production CLEAR');}
 s.shake=0;notes.push('Camera shake fixed to zero for repeatable inspection; draw commands unchanged.');s.bridge.active=false;s.bridge.onFrame(m);document.getElementById('stage-intro').hidden=true;
 document.getElementById('gun-toast').hidden=true;
 document.getElementById('run-status').textContent=cfg.area==='boss'?'BOSS COMBAT':cfg.area==='staging'?'THE ABYSS':'DESCENT IN PROGRESS';
 return {seed:71103,notes,triggers,...cfg};
};
window.auditRender=()=>{s.draw();s.game.renderer.preRender();s.sys.render(s.game.renderer);s.game.renderer.postRender();};
true;
