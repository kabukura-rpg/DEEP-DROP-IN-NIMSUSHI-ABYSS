// Isolated Vite dev entry. Not imported by the production entry or copied into dist.
if (!import.meta.env.DEV) throw Error('Art review requires the dev server');
const frame=document.querySelector('iframe');
await new Promise(resolve=>{const id=setInterval(()=>{if(frame.contentWindow.__dev?.scene?.playerArt&&frame.contentWindow.__bossTest){clearInterval(id);resolve()}},100)});
const w=frame.contentWindow,s=w.__dev.scene;
w.document.querySelector('#check-buttons').closest('aside').hidden=true;
const original=s.bossBody.bind(s),images={};
for(const resolution of ['128','256']){
 const im=new Image();im.src=`nimushi_idle_${resolution}.png`;await im.decode();
 s.textures.addImage(`nimushi-review-${resolution}`,im).setFilter(1);
 images[resolution]=im;
}
let resolution='256',alignment='A',legacy=false,showOverlay=false;
const sprite=s.add.image(0,0,'nimushi-review-256').setOrigin(0).setVisible(false);
s.children.moveBelow(sprite,s.playerArt.image);
// Subsequent enemies/bullets must remain above the body, as in the original draw order.
const afterBody=s.add.graphics();s.children.moveAbove(afterBody,sprite);
const overlay=s.add.graphics();
const metrics={frames:0,drawModelChecks:[],switchChecks:[],events:{},recent:[],dt:[]};
const prevEvent=w.__dev.bridge.onEvent;
w.__dev.bridge.onEvent=(event,model)=>{metrics.events[event.type]=(metrics.events[event.type]||0)+1;if(event.type==='hurt'||event.type==='bossHit'||event.type==='kill'||event.type==='bossFire'){metrics.recent.push({...event});if(metrics.recent.length>40)metrics.recent.shift()}prevEvent(event,model)};
const prevDraw=s.draw.bind(s);
s.draw=()=>{sprite.setVisible(false);overlay.clear();afterBody.clear();prevDraw()};
s.bossBody=(cam)=>{
 if(legacy){original(cam);return}
 const m=s.model,f=m.boss,b=f.body;
 const x=b.x+b.width/2-128,y=b.y+b.height/2-cam-40+(alignment==='B'?-16:0);
 sprite.setTexture(`nimushi-review-${resolution}`).setDisplaySize(256,224).setPosition(x+s.graphics.x,y+s.graphics.y).setVisible(true);
 // IDLE-only review: preserve the master pixels, even while the machine changes pose.
 // Existing hazards remain in GameScene.boss; opening state is disclosed below and in the overlay.
 if(showOverlay){
  overlay.setPosition(s.graphics.x,s.graphics.y);
  for(const [box,color] of [[f.contactBox,0xff9255],[f.eye,f.eyeOpen?0xf8ed6a:0xa5a5a5]])overlay.lineStyle(1,color,1).strokeRect(box.x,box.y-cam,box.width,box.height);
  overlay.lineStyle(1,0x69e4ff,1).strokeRect(x+16,y+16,216,192);
 }
 afterBody.setPosition(s.graphics.x,s.graphics.y);s.graphics=afterBody;
 metrics.frames++;
};
function state(){const m=s.model,f=m.boss;return {resolution,alignment,legacy,showOverlay,sourceSize:resolution==='128'?[128,112]:[256,224],displaySize:[256,224],body:f.body,contact:f.contactBox,eye:f.eye,cameraY:m.cameraY,player:{x:m.player.x,y:m.player.y},state:m.state,bossState:f.state,pose:f.pose,eyeOpen:f.eyeOpen,bossHp:f.hp,hp:m.hp,elapsed:m.elapsed,ammo:m.ammo,deathCause:m.health.deathCause,paused:m.paused,renderer:s.game.renderer.type,textureSize:[sprite.texture.source[0].width,sprite.texture.source[0].height]}}
function select(opts={}){
 const before=JSON.stringify(s.model);
 if(opts.resolution!==undefined){if(!['128','256'].includes(opts.resolution))throw Error('128 or 256');resolution=opts.resolution;legacy=false}
 if(opts.alignment!==undefined){if(!['A','B'].includes(opts.alignment))throw Error('A or B');alignment=opts.alignment}
 if(opts.legacy!==undefined)legacy=opts.legacy;
 if(opts.overlay!==undefined)showOverlay=opts.overlay;
 s.draw();metrics.switchChecks.push(before===JSON.stringify(s.model));
 document.querySelectorAll('[data-res]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.res===resolution&&!legacy)));
 document.querySelectorAll('[data-align]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.align===alignment)));
 document.querySelector('#legacy').setAttribute('aria-pressed',String(legacy));
 return state();
}
function restart(request){if(request){if(request.weapon)document.querySelector('#weapon').value=request.weapon;if(request.target)document.querySelector('#phase').value=request.target;document.querySelector('#attack').value=request.attack||''}const result=w.__bossTest(request??{weapon:document.querySelector('#weapon').value,target:document.querySelector('#phase').value,...(document.querySelector('#attack').value?{attack:document.querySelector('#attack').value}:{})});w.focus();return result}
document.querySelectorAll('[data-res]').forEach(b=>b.onclick=()=>select({resolution:b.dataset.res}));
document.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>select({alignment:b.dataset.align}));
document.querySelector('#legacy').onclick=()=>select({legacy:!legacy});
document.querySelector('#overlay').onclick=()=>select({overlay:!showOverlay});
document.querySelector('#start').onclick=()=>restart();
document.querySelector('#pause').onclick=()=>{const button=w.document.querySelector('#resume');if(button){button.click();w.focus()}else w.__dev.pause()};
// Avoid giving A/B buttons keyboard focus or pausing simply to compare pixels.
document.querySelectorAll('button').forEach(b=>b.addEventListener('pointerdown',e=>e.preventDefault()));
let previous=performance.now();
function tick(now){const dt=now-previous;previous=now;if(w.__dev.bridge.active&&s.model.running&&metrics.dt.length<12000)metrics.dt.push(dt);const f=s.model.boss;document.querySelector('#status').textContent=`${resolution}px / ${alignment} / ${legacy?'LEGACY':'MASTER IDLE'} · ${f.pose} · EYE ${f.eyeOpen?'OPEN':'CLOSED'} · HP ${s.model.hp} · ${s.model.paused?'PAUSED':'LIVE'}`;requestAnimationFrame(tick)}
requestAnimationFrame(tick);
window.artReview={select,state,restart,metrics,frame:w};
select();restart();
