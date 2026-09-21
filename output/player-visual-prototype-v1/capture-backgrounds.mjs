// Isolated browser render fixtures only. Does not alter source or install sprites.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const targets=await(await fetch('http://127.0.0.1:59158/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let serial=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result)}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params)});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
await cdp('Page.enable');await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'http://127.0.0.1:5196/tests/browser.html'});
for(let i=0;i<100;i++){await sleep(100);if(await ev('!!window.__dev && !!__dev.scene.graphics'))break;}
await ev(`(()=>{__dev.start();__dev.scene.model.jumpToStage(1,2);__dev.bridge.active=false;const m=__dev.scene.model;m.player.y=850;m.cameraY=450;m.step(1/120,0,false);m.cameraY=450;m.player.x=-1000;__dev.scene.draw();return true;})()`);
await sleep(100);
const normalState=await ev(`({stage:__dev.scene.model.stage.label,cameraY:__dev.scene.model.cameraY,world:[450,800],fixture:true})`);
async function snapshot(name){await ev(`(()=>{__dev.bridge.active=false;__dev.scene.model.paused=true;__dev.scene.model.player.x=-1000;__dev.scene.draw();})()`);const data=await ev(`new Promise(resolve=>__dev.scene.game.renderer.snapshot(image=>resolve(image.src)))`);await fs.writeFile(path.join(root,'backgrounds',name+'.png'),Buffer.from(data.split(',')[1],'base64'))}
await snapshot('normal-area-1');
await ev(`(()=>{__dev.start();__dev.scene.model.jumpToNimushi();__dev.bridge.active=false;__dev.scene.model.player.x=-1000;__dev.scene.draw();return true;})()`);
await sleep(100);
const bossState=await ev(`({stage:__dev.scene.model.stage.label,abyss:__dev.scene.model.abyssStage,cameraY:__dev.scene.model.cameraY,world:[450,800],fixture:true})`);
await snapshot('boss-nimushi');
await fs.writeFile(path.join(root,'backgrounds','capture.json'),JSON.stringify({sourceCommit:'6270378',method:'Actual Phaser renderer snapshots of isolated development fixtures. Original player moved outside canvas; simulation frozen. No sprite integration. UI overlays excluded.',normalState,bossState,errors},null,2));
console.log(JSON.stringify({normalState,bossState,errors}));ws.close();
