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
const observed={};
async function sample(ms){const end=Date.now()+ms;while(Date.now()<end){const v=await state();if(v.art.pose&&!observed[v.art.pose]){observed[v.art.pose]=v;await shot('actual-'+v.art.pose)}await sleep(20)}}
await click('#start');await sample(300);await key('KeyD',true);await sample(180);await key('KeyD',false);await key('Space',true);await sample(250);await key('Space',false);await key('KeyD',true);await sample(1000);await key('KeyD',false);await key('KeyA',true);await sample(700);await key('KeyA',false);await key('Space',true);await sample(1800);await key('Space',false);await sample(7000);
await ev('__bossTest()');await sample(500);await key('Space',true);await sample(1500);await key('Space',false);await sample(7000);
await fs.writeFile(path.join(root,'actual-state-results.json'),JSON.stringify({observed,errors,method:'Existing start/BOSS TEST; real CDP keys; no model writes or visual override'},null,2));console.log(Object.keys(observed));ws.close();
