import test from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';
const id='aabbccddeeff';
async function fixture(t,{accept=true,lost=false,legacy=false,unknown=false,postStatus=200,readStatus=200}={}){
 const raw={deviceId:id,hostname:'coollamp-test.local',token:'test-token',mode:1,brightness:55,power:true,effects:['Rain'],leds:205,midpoint:102,
  startupMode:4,startupBrightness:80,motionVersion:1,motionPath:0,
  audio:{installed:true,captureVersion:1,enabled:true,gain:8,gate:8,scale:100}};
 if(legacy){delete raw.motionVersion;delete raw.motionPath;delete raw.audio.captureVersion;delete raw.audio.enabled;}
 if(unknown){raw.motionVersion=2;raw.motionPath=33;raw.audio.captureVersion=2;raw.audio.enabled=null;}
 const calls=[];let duringRead=null,duringPost=null;
 const lamp=new WifiTransport({request:async options=>{
  calls.push(options);if(options.method==='POST'){
   const form=new URLSearchParams(options.data);
   if(accept&&(postStatus===200||postStatus>=500)){if(options.url.endsWith('/api/geometry'))raw.motionPath=Number(form.get('path'));else raw.audio.enabled=form.get('enabled')==='1';}
   if(duringPost)await duringPost();if(lost)throw Error('reply lost');return{status:postStatus,data:'Setting reply.'};
  }
  if(duringRead)await duringRead();return{status:calls.some(x=>x.method==='POST')?readStatus:200,data:JSON.stringify(raw)};
 }});
 await lamp.connect('192.168.1.9','test-password',id);clearTimeout(lamp.timer);calls.length=0;t.after(()=>lamp.disconnect());
 return{lamp,raw,calls,setRead:f=>duringRead=f,setPost:f=>duringPost=f};
}
for(const setting of ['path','sound']){
 const run=lamp=>setting==='path'?lamp.configureMotionPath(1):lamp.setAudioReactionEnabled(false);
 test(setting+' sends one fresh, target-verified absolute field and preserves unrelated settings',async t=>{
  const {lamp,raw,calls}=await fixture(t);raw.token='new-boot-token';await lamp.enqueue(()=>run(lamp));
  assert.deepEqual(calls.map(x=>x.method),['GET','POST','GET']);assert.equal(calls[1].headers['X-Lamp-Token'],'new-boot-token');
  assert.equal(calls[1].data,setting==='path'?'pathVersion=1&path=1':'action=use&useVersion=1&enabled=0');
  assert.deepEqual([raw.midpoint,raw.mode,raw.brightness,raw.power,raw.startupMode,raw.startupBrightness,raw.audio.gain,raw.audio.gate,raw.audio.scale],[102,1,55,true,4,80,8,8,100]);
 });
 test(setting+' does not guess support from legacy or future fields',async t=>{
  for(const option of [{legacy:true},{unknown:true}]){const {lamp,calls}=await fixture(t,option);await assert.rejects(run(lamp),/does not support/);assert(calls.every(x=>x.method==='GET'));}
 });
 test(setting+' lost accepted reply verifies state once and never replays',async t=>{
  const {lamp,calls}=await fixture(t,{lost:true});assert.match(await run(lamp),/verified/);assert.equal(calls.filter(x=>x.method==='POST').length,1);
 });
 test(setting+' missing or conflicting readback remains unconfirmed without replay',async t=>{
  for(const lost of [true,false]){const {lamp,calls}=await fixture(t,{lost,accept:false});await assert.rejects(run(lamp),error=>error.uncertain===true);assert.equal(calls.filter(x=>x.method==='POST').length,1);}
 });
 test(setting+' selection/epoch/address changes during preparation prevent mutation',async t=>{
  for(const change of [lamp=>lamp.disconnect(),lamp=>{lamp.base='http://192.168.1.10';}]){
   const {lamp,calls,setRead}=await fixture(t);let ready,release;const pendingRead=new Promise(r=>ready=r);
   setRead(()=>{ready();return new Promise(r=>release=r);});const promise=run(lamp);await pendingRead;await change(lamp);release();await assert.rejects(promise,/changed/i);assert(calls.every(x=>x.method==='GET'));
  }
 });
 test(setting+' connection loss or malformed snapshot after POST remains uncertain',async t=>{
  for(const fault of ['epoch','address','malformed']){
   const {lamp,raw,calls,setPost}=await fixture(t);
   setPost(()=>{if(fault==='epoch')return lamp.disconnect();if(fault==='address')lamp.base='http://192.168.1.10';if(fault==='malformed')raw.mode=99;});
   await assert.rejects(run(lamp),error=>error.uncertain===true&&error.confirmed===false);
   assert.equal(calls.filter(x=>x.method==='POST').length,1);
   assert.equal(setting==='path'?raw.motionPath:raw.audio.enabled,setting==='path'?1:false);
  }
 });
 test(setting+' rejection of readback never becomes proof the earlier save was rejected',async t=>{
  for(const readStatus of [400,401,409,503]){
   const {lamp,calls}=await fixture(t,{readStatus});await assert.rejects(run(lamp),error=>error.uncertain===true&&error.confirmed===false);assert.equal(calls.filter(x=>x.method==='POST').length,1);
  }
 });
 test(setting+' confirmed pre-execution POST rejection retains its safe outcome',async t=>{
  for(const postStatus of [400,401,409]){
   const {lamp,calls}=await fixture(t,{postStatus});await assert.rejects(run(lamp),error=>error.confirmed===true&&error.status===postStatus&&!error.uncertain);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal(calls.filter(x=>x.method==='GET').length,1);
  }
 });
}
test('malformed values and an unverified friendly identity cannot mutate',async t=>{
 const {lamp,calls}=await fixture(t);for(const value of [-1,2,'1',NaN])await assert.rejects(lamp.configureMotionPath(value));
 for(const value of [0,1,'true',null])await assert.rejects(lamp.setAudioReactionEnabled(value));
 assert.equal(calls.length,0);lamp.identity='friendly-name';await assert.rejects(lamp.configureMotionPath(1),/changed/);assert.equal(calls.length,0);
});
