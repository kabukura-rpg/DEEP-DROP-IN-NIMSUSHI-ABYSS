import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const targets=await(await fetch('http://127.0.0.1:59158/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));let serial=0;const pending=new Map(),errors=[],assets=[];
ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result)}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params);else if(d.method==='Network.requestWillBeSent'&&d.params.request.url.includes('sprites-48'))assets.push(d.params.request.url)});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const key=async(code,down)=>{const spec={KeyA:['a',65],KeyD:['d',68],Space:[' ',32]}[code];await cdp('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:spec[0],windowsVirtualKeyCode:spec[1],nativeVirtualKeyCode:spec[1]})};
const click=async selector=>{const r=await ev('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1})};
const until=async(expression,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await ev(expression);if(v)return v;await sleep(20)}throw Error('Timed out: '+expression)};
const state=()=>ev('(()=>{const m=__dev.scene.model;return{art:__playerArt(),state:m.state,arena:m.inBossArena,elapsed:m.elapsed,hp:m.hp,ammo:m.ammo,player:{...m.player},cameraY:m.cameraY,gravity:m.gravitySign,bullets:m.bullets.map(b=>({x:b.x,y:b.y,vy:b.vy})),particles:__dev.scene.particles.length}})()');
async function shot(name){
 const data=await ev('new Promise(resolve=>__dev.scene.game.renderer.snapshot(image=>resolve(image.src)))');
 await fs.writeFile(path.join(root,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
}
async function pauseAt(condition){
 await ev('(()=>{const previous=__dev.bridge.onFrame;__captureDone=false;__dev.bridge.onFrame=m=>{previous(m);if('+condition+'){__dev.bridge.onFrame=previous;__dev.pause();__captureDone=true;}}})()');
}
await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'http://127.0.0.1:5196/tests/browser.html'});
await until('!!window.__playerArt && !!window.__dev && !!document.querySelector("#start")');
await click('#start');await sleep(450);
const grounded=await state();
await pauseAt('m.player.grounded===-1 && m.player.vy>180 && m.player.y>300');
await key('KeyD',true);await until('window.__captureDone');await key('KeyD',false);
const normal=await state();await shot('normal-fall');
const abBefore=await ev('JSON.stringify(__dev.scene.model)');
await ev('__playerArt("legacy")');await shot('normal-legacy');
const abAfter=await ev('JSON.stringify(__dev.scene.model)');
await ev('__playerArt("prototype")');
const bossEntry=await ev('__bossTest()');
await pauseAt('m.player.vy < -250');
await until('window.__captureDone');const ascend=await state();await shot('nimushi-ascend');
await ev('__playerArt("legacy")');await shot('nimushi-legacy');await ev('__playerArt("prototype")');
// Existing pause/resume and real keyboard events only. No velocity, HP or body assignments.
await pauseAt('__playerArt().pose==="boss_brake"');
await click('#resume');await key('Space',true);
await until('window.__captureDone');await key('Space',false);
const brake=await state();await shot('nimushi-brake');
await sleep(200);const pausedBrake=await state();
// Flip via actual directional input, then pause again for observation.
await pauseAt('m.elapsed > '+(brake.elapsed+0.05));
await click('#resume');await key('KeyA',true);await until('window.__captureDone');await key('KeyA',false);
const left=await state();
const beforeScale=await ev('JSON.stringify(__dev.scene.model)');
const scale2=await ev('__playerArt("prototype",2)');await ev('__playerArt("prototype",1)');
const afterScale=await ev('JSON.stringify(__dev.scene.model)');
const layerOrder=await ev('(()=>{const s=__dev.scene;return{world:s.children.getIndex(s.graphics),body:s.children.getIndex(s.playerArt.image),effects:s.children.getIndex(s.artForeground)}})()');
const result={method:'Real CDP keyboard/mouse inputs. Existing BOSS TEST entry used, no model modifications. Existing pause freezes snapshots; no compositing.',grounded,normal,bossEntry,ascend,brake,pausedBrake,left,scale2,abModelUnchanged:abBefore===abAfter,scaleModelUnchanged:beforeScale===afterScale,layerOrder,assets,errors};
await fs.writeFile(path.join(root,'browser-results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));ws.close();
