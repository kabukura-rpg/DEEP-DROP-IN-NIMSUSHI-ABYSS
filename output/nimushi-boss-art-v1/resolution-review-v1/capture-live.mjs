import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const targets=await(await fetch('http://127.0.0.1:59158/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));let serial=0;const pending=new Map(),errors=[],assets=[];
ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result)}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params);else if(d.method==='Network.requestWillBeSent'&&d.params.request.url.includes('player-sprites-v1'))assets.push(d.params.request.url)});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const key=async(code,down)=>{const spec={KeyA:['a',65],KeyD:['d',68],Space:[' ',32]}[code];await cdp('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:spec[0],windowsVirtualKeyCode:spec[1],nativeVirtualKeyCode:spec[1]})};
const click=async selector=>{const r=await ev('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1})};
const until=async(expression,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await ev(expression);if(v)return v;await sleep(20)}throw Error('Timed out: '+expression+' '+JSON.stringify(errors))};
const state=()=>ev('(()=>{const m=__dev.scene.model;return{art:__playerArt(),state:m.state,arena:m.inBossArena,elapsed:m.elapsed,hp:m.hp,ammo:m.ammo,player:{...m.player},cameraY:m.cameraY,gravity:m.gravitySign,bullets:m.bullets.map(b=>({x:b.x,y:b.y,vy:b.vy})),particles:__dev.scene.particles.length}})()');
async function shot(name){
 const data=await ev('new Promise(resolve=>__dev.scene.game.renderer.snapshot(image=>resolve(image.src)))');
 await fs.writeFile(path.join(root,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
}
async function pauseAt(condition){
 await ev('(()=>{const previous=__dev.bridge.onFrame;__captureDone=false;__dev.bridge.onFrame=m=>{previous(m);if('+condition+'){__dev.bridge.onFrame=previous;__dev.pause();__captureDone=true;}}})()');
}

await cdp('Page.enable');await cdp('Runtime.enable');
const results={};
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'http://127.0.0.1:5197/DEEP-DROP-IN-NIMSUSHI-ABYSS/output/nimushi-boss-art-v1/resolution-review-v1/live.html'});
await until('!!window.artReview',20000);
await ev('artReview.frame.__dev.pause()');
const baseline=await ev('artReview.state()');
for(const resolution of ['128','256'])for(const alignment of ['A','B']){
 const st=await ev(`artReview.select({resolution:'${resolution}',alignment:'${alignment}',overlay:true})`);
 results[resolution+alignment]={state:st,geometryUnchanged:['body','contact','eye','cameraY','player'].every(k=>JSON.stringify(st[k])===JSON.stringify(baseline[k]))};
}
await ev('artReview.select({legacy:true})');await ev('artReview.select({resolution:"256",alignment:"B",overlay:false})');
// Genuine CDP key input; existing boss-test shortcuts only initialize each run.
for(const [name,weapon,attack,target,mobile] of [
 ['machine-shower','MACHINE','SHOWER','phase1',false],
 ['shotgun-beam','SHOTGUN','BEAM','phase1',false],
 ['puncher-clones','PUNCHER','CLONES','phase4',false],
 ['clone-normal','SHOTGUN','CLONES','phase1',false],
 ['shotgun-shower','SHOTGUN','SHOWER','phase1',false],
 ['mobile-high','MACHINE','SHOWER','phase1',true],
 ['desktop-low','MACHINE','SHOWER','phase1',false]
]){
 await cdp('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:1000,deviceScaleFactor:1,mobile});
 await ev(`artReview.select({resolution:'${name==='desktop-low'?'128':'256'}',alignment:'B',overlay:false});artReview.metrics.dt.length=0;artReview.metrics.events={};artReview.metrics.recent=[];artReview.restart(${JSON.stringify({weapon,attack,target})})`);
 await sleep(500);
 // Focus the live game with a real pointer; this is also a real tap/fire action.
 const point=await ev(`(()=>{const f=document.querySelector('iframe').getBoundingClientRect(),c=artReview.frame.document.querySelector('canvas').getBoundingClientRect();return {x:f.x+c.x+c.width/2,y:f.y+c.y+c.height*.7}})()`);
 for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 await key('Space',true);
 const samples=[];let captured=false;
 for(let i=0;i<28;i++){
  await sleep(250);
  const st=await ev(`(()=>{const m=artReview.frame.__dev.scene.model;return {...artReview.state(),pearls:m.boss.tapiocas.length,beams:m.boss.beams.length,enemies:m.enemies.filter(e=>e.alive).map(e=>({kind:e.kind,x:e.x,y:e.y})),events:{...artReview.metrics.events}}})()`);samples.push(st);
  if(!captured&&i>=10){const shot=await cdp('Page.captureScreenshot');await fs.writeFile(path.join(root,'live-'+name+'.png'),Buffer.from(shot.data,'base64'));captured=true}
 }
 await key('Space',false);
 results[name]={samples,metrics:await ev(`(()=>{const d=artReview.metrics.dt.slice(10).sort((a,b)=>a-b);return {samples:d.length,medianFrameMs:d[Math.floor(d.length*.5)],p95FrameMs:d[Math.floor(d.length*.95)],events:artReview.metrics.events,recent:artReview.metrics.recent}})()`)};
 console.log(name,JSON.stringify(results[name].metrics));
}
results.switchChecks=await ev('artReview.metrics.switchChecks');
await fs.writeFile(path.join(root,'live-results.json'),JSON.stringify({results,errors},null,2));
ws.close();
