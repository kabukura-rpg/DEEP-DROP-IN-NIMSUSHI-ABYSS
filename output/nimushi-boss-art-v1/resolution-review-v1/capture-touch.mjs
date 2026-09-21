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
await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
await cdp('Page.navigate',{url:'http://127.0.0.1:5197/DEEP-DROP-IN-NIMSUSHI-ABYSS/output/nimushi-boss-art-v1/resolution-review-v1/live.html'});await until('!!window.artReview',20000);
await ev('artReview.restart({weapon:"MACHINE",attack:"SHOWER"});artReview.select({resolution:"256",alignment:"B"})');await sleep(400);
const before=await ev('({state:artReview.state(),events:{...artReview.metrics.events}})');
async function touch(selector,ms){const point=await ev(`(()=>{const f=document.querySelector('iframe').getBoundingClientRect(),r=artReview.frame.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:f.x+r.x+r.width/2,y:f.y+r.y+r.height/2}})()`);await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:4,radiusY:4,force:1}]});await sleep(ms);await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
await touch('#fire-control',600);const fired=await ev('({state:artReview.state(),events:{...artReview.metrics.events}})');
await touch('#left-control',350);const left=await ev('artReview.state()');await touch('#right-control',350);const right=await ev('artReview.state()');
const screenshot=await cdp('Page.captureScreenshot');await fs.writeFile(path.join(root,'live-mobile-high.png'),Buffer.from(screenshot.data,'base64'));
await ev('artReview.frame.__dev.pause()');
const paused=await ev('artReview.state()');const checks=[];
for(const resolution of ['128','256'])for(const alignment of ['A','B'])checks.push(await ev(`artReview.select({resolution:'${resolution}',alignment:'${alignment}'})`));
await ev('artReview.select({resolution:"256",alignment:"B"})');
const result={before,fired,left,right,paused,checks,errors};
await fs.writeFile(path.join(root,'touch-results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({shots:(fired.events.shot||0)-(before.events.shot||0),leftDelta:left.player.x-fired.state.player.x,rightDelta:right.player.x-left.player.x,errors}));
ws.close();
