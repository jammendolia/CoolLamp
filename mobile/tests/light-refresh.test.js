import test from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {SERVICE,STATE,EFFECT_OPTIONS,COMMAND,CONTROL,effects,decodeState} from '../src/protocol.js';
import {legacyCatalog} from '../src/catalog.js';

const target='aabbccddeeff',nativeId='saved-native-lamp';
const names=[...effects,'Sound glow','Sound meter','Spectrum Rise','Bass Launch','Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter','Rainbow Embers'];
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function packet({id=9,result=0,mode=46,brightness=70,power=true,count=47,capabilities=46,color=[1,30,60,90]}={}){
 const data=new DataView(new ArrayBuffer(capabilities&2?16:12));
 [1,id,result,mode,brightness,Number(power),count,capabilities].forEach((value,index)=>data.setUint8(index,value));data.setUint32(8,18,true);
 if(capabilities&2)color.forEach((value,index)=>data.setUint8(12+index,value));return data;
}
function optionPacket({mode=46,speed=33,intensity=75,dual=1,r=10,g=20,b=30}={}){
 return new DataView(Uint8Array.of(1,mode,speed,intensity,dual,r,g,b).buffer);
}
function fixture({leds=135,state=packet(),options=optionPacket()}={}){
 const reads=[],writes=[],callbacks=[];let admission=true;
 const radio={async read(device,service,characteristic,config){
  assert.equal(device,nativeId);assert.equal(service,SERVICE);reads.push({characteristic,config});
  await radio.hold?.(characteristic);
  if(characteristic===STATE)return radio.state;if(characteristic===EFFECT_OPTIONS)return radio.options;
  assert.fail('Unexpected complete control read: '+characteristic);
 },async write(device,service,characteristic,value){writes.push({device,service,characteristic,value});assert.fail('A light refresh must not write');},async disconnect(){}};
 radio.state=state;radio.options=options;
 const lamp=new LampTransport(radio,{onState:(state,metadata)=>callbacks.push({state,metadata}),onOptions:options=>callbacks.push({options}),onFirmware:firmware=>callbacks.push({firmware})});
 lamp.id=nativeId;lamp.deviceIdentity=target;lamp.control={capabilities:['control','groups']};lamp.catalog=legacyCatalog(names);
 lamp.raw={deviceId:target,token:'current-token',name:'Pink',leds,midpoint:Math.floor(leds/2),motionPath:1,
  mode:4,brightness:100,power:true,startupMode:4,startupBrightness:100,firmware:{version:'1.15.2',phase:0},
  sync:{role:0,scene:0,order:[]},colors:names.map(()=>[0,1,2,3]),effectOptions:names.map(()=>[50,100,0,0,0,0])};
 lamp.state={...lamp.raw,...decodeState(packet({mode:4,brightness:100}))};
 const guard=()=>{if(!admission)throw Object.assign(Error('Protected target admission ended.'),{readAdmission:true,confirmed:true,cancelled:true});};
 return {lamp,radio,reads,writes,callbacks,guard,stop:()=>{admission=false;}};
}

for(const leds of [1,135,179,180,1023,1024])test('legacy 47-effect protected light reads preserve catalog and '+leds+'-LED hardware',async()=>{
 const f=fixture({leds}),catalog=f.lamp.catalog,group=f.lamp.raw.sync,firmware=f.lamp.raw.firmware;
 const result=await f.lamp.refreshLight(target,f.guard);
 assert.equal(result.mode,46);assert.equal(result.brightness,70);assert.equal(result.power,true);assert.equal(result.effectCount,47);
 assert.equal(result.leds,leds);assert.equal(result.midpoint,Math.floor(leds/2));assert.equal(result.motionPath,1);
 assert.equal(f.lamp.catalog,catalog);assert.equal(f.lamp.raw.sync,group);assert.equal(f.lamp.raw.firmware,firmware);
 assert.equal(f.lamp.raw.startupMode,4);assert.equal(f.lamp.raw.startupBrightness,100);
 assert.deepEqual(f.lamp.raw.colors[45],[1,30,60,90]);assert.deepEqual(f.lamp.raw.effectOptions[45],[33,75,1,10,20,30]);
 assert.deepEqual(f.lamp.raw.colors[3],[0,1,2,3]);assert.deepEqual(f.lamp.raw.effectOptions[3],[50,100,0,0,0,0]);
 assert.deepEqual(f.reads.map(row=>row.characteristic),[STATE,EFFECT_OPTIONS]);assert(f.reads.every(row=>row.config.timeout===5000));assert.deepEqual(f.writes,[]);
 const stateCallback=f.callbacks.find(row=>row.state);assert.equal(stateCallback.metadata.freshLight,true);assert.equal(stateCallback.metadata.freshControl,undefined);
 assert.equal(f.callbacks.filter(row=>row.options).length,1);assert(!f.callbacks.some(row=>row.firmware));
});

test('firmware without adjustable options requires only one protected state read',async()=>{
 const f=fixture({state:packet({capabilities:34})});await f.lamp.refreshLight(target,f.guard);
 assert.deepEqual(f.reads.map(row=>row.characteristic),[STATE]);assert(!f.callbacks.some(row=>row.options));assert.deepEqual(f.writes,[]);
});

test('wrong target and revoked admission reject before any native call',async()=>{
 const f=fixture();await assert.rejects(f.lamp.refreshLight('112233445566',f.guard),/Connection changed/);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.callbacks,[]);f.stop();await assert.rejects(f.lamp.refreshLight(target,f.guard),error=>error.cancelled&&error.confirmed);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
});

for(const changed of [packet({result:4}),packet({count:48}),packet({mode:48}),new DataView(new ArrayBuffer(11))])test('invalid or changed protected light state cannot replace cached settings '+changed.byteLength+' '+(changed.byteLength>3?changed.getUint8(3):0),async()=>{
 const f=fixture({state:changed}),before=JSON.stringify(f.lamp.raw),previous=f.lamp.state;
 await assert.rejects(f.lamp.refreshLight(target,f.guard));assert.equal(JSON.stringify(f.lamp.raw),before);assert.equal(f.lamp.state,previous);
 assert.deepEqual(f.reads.map(row=>row.characteristic),[STATE]);assert.deepEqual(f.callbacks,[]);assert.deepEqual(f.writes,[]);
});

test('changing effect between state and option reads rejects the inconsistent tuple without adopting it',async()=>{
 const f=fixture({options:optionPacket({mode:47})}),before=JSON.stringify(f.lamp.raw),previous=f.lamp.state;
 await assert.rejects(f.lamp.refreshLight(target,f.guard),error=>error.conflict&&error.confirmed);
 assert.equal(JSON.stringify(f.lamp.raw),before);assert.equal(f.lamp.state,previous);assert.deepEqual(f.callbacks,[]);assert.deepEqual(f.writes,[]);
});

for(const characteristic of [STATE,EFFECT_OPTIONS])test('revocation during '+characteristic+' read blocks late cache and callbacks',async()=>{
 const f=fixture(),gate=deferred(),started=deferred(),before=JSON.stringify(f.lamp.raw),previous=f.lamp.state;
 f.radio.hold=async value=>{if(value===characteristic){started.resolve();await gate.promise;}};
 const pending=f.lamp.refreshLight(target,f.guard);await started.promise;f.stop();gate.resolve();
 await assert.rejects(pending,error=>error.cancelled&&error.confirmed);
 assert.equal(JSON.stringify(f.lamp.raw),before);assert.equal(f.lamp.state,previous);assert.deepEqual(f.callbacks,[]);
 assert.equal(f.reads.length,characteristic===STATE?1:2);assert.deepEqual(f.writes,[]);
});

test('a disconnected generation cannot install its late short-read snapshot on a replacement connection',async()=>{
 const f=fixture(),gate=deferred(),started=deferred();f.radio.hold=async characteristic=>{if(characteristic===STATE){started.resolve();await gate.promise;}};
 const pending=f.lamp.refreshLight(target,f.guard);await started.promise;f.lamp.disconnected();
 f.lamp.id='new-native-lamp';f.lamp.deviceIdentity='112233445566';f.lamp.raw={name:'Replacement'};f.lamp.catalog=legacyCatalog(names);const replacement=f.lamp.raw;
 gate.resolve();await assert.rejects(pending,/Connection changed/);assert.equal(f.lamp.raw,replacement);assert.equal(f.lamp.state,null);assert.deepEqual(f.callbacks,[]);
});

test('a state observer ending admission prevents subsequent options observer delivery',async()=>{
 const f=fixture();f.lamp.onState=(state,metadata)=>{f.callbacks.push({state,metadata});f.stop();};
 await assert.rejects(f.lamp.refreshLight(target,f.guard),error=>error.cancelled&&error.confirmed);
 assert.equal(f.callbacks.filter(row=>row.state).length,1);assert(!f.callbacks.some(row=>row.options));assert.deepEqual(f.writes,[]);
});

function probeFixture(t){
 t.mock.timers.enable({apis:['setTimeout']});const writes=[],reads=[];let cached=packet({id:0,mode:4}),release=null;
 const radio={async write(device,service,characteristic,frame){assert.equal(characteristic,COMMAND);writes.push(frame);if(release)await release.promise;cached=packet({id:frame.getUint8(1),mode:4});},
  async read(device,service,characteristic){assert.equal(characteristic,STATE);reads.push(characteristic);return cached;},async disconnect(){}};
 const lamp=new LampTransport(radio);lamp.id=nativeId;lamp.deviceIdentity=target;lamp.control={capabilities:['control']};lamp.state=decodeState(cached);
 t.after(()=>{clearTimeout(lamp.pending?.timer);clearTimeout(lamp.pending?.probeTimer);});
 return {lamp,radio,writes,reads,setHold:value=>{release=value;},stale:()=>{cached=packet({id:0,mode:4});}};
}

test('lost control notification is recovered at 200 ms with one read and no command replay',async t=>{
 const f=probeFixture(t),pending=f.lamp.command('controlBegin',{tx:1,endpoint:45,method:1,length:0});await settle();
 t.mock.timers.tick(199);await settle();assert.equal(f.reads.length,0);assert.equal(f.writes.length,1);
 t.mock.timers.tick(1);await settle();assert.equal((await pending).id,1);assert.equal(f.reads.length,1);assert.equal(f.writes.length,1);assert.equal(f.lamp.id,nativeId);
});

test('the 200 ms control probe starts after native write completion rather than queued write admission',async t=>{
 const f=probeFixture(t),gate=deferred();f.setHold(gate);const pending=f.lamp.command('controlBegin',{tx:1,endpoint:45,method:1,length:0});await settle();
 t.mock.timers.tick(4000);await settle();assert.equal(f.reads.length,0);assert.equal(f.lamp.pending.timer,null);assert.equal(f.lamp.pending.probeTimer,null);
 gate.resolve();await settle();t.mock.timers.tick(199);await settle();assert.equal(f.reads.length,0);
 t.mock.timers.tick(1);await settle();await pending;assert.equal(f.reads.length,1);assert.equal(f.writes.length,1);
});

test('a stale 200 ms control probe cannot acknowledge or resend the submitted command',async t=>{
 const f=probeFixture(t),pending=f.lamp.command('controlBegin',{tx:1,endpoint:45,method:1,length:0});const rejected=assert.rejects(pending,/did not confirm/);await settle();f.stale();
 t.mock.timers.tick(200);await settle();assert.equal(f.lamp.pending.id,1);assert.equal(f.reads.length,1);assert.equal(f.writes.length,1);
 t.mock.timers.tick(4800);await settle();await rejected;assert.equal(f.lamp.id,null);assert.equal(f.writes.length,1);assert.equal(f.reads.length,1);
});

test('ordinary user commands retain the established half-timeout recovery window',async t=>{
 const f=probeFixture(t),pending=f.lamp.command('brightness',120);await settle();t.mock.timers.tick(200);await settle();assert.equal(f.reads.length,0);
 t.mock.timers.tick(2299);await settle();assert.equal(f.reads.length,0);t.mock.timers.tick(1);await settle();await pending;
 assert.equal(f.reads.length,1);assert.equal(f.writes.length,1);
});
