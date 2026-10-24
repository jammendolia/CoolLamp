import test from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {CONTROL,STATE,COMMAND,SERVICE,FIRMWARE,EFFECT_OPTIONS,effects} from '../src/protocol.js';
import {legacyCatalog} from '../src/catalog.js';

const identity='aabbccddeeff',deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const identityChar='7b610006-6e2b-4f3d-9a71-28e45c001001';
function page(text,tx,endpoint,offset=0){
 const bytes=new TextEncoder().encode(text),part=bytes.slice(offset,offset+480),out=new DataView(new ArrayBuffer(12+part.length));
 out.setUint8(0,1);out.setUint16(1,tx,true);out.setUint8(3,endpoint);out.setUint16(4,200,true);out.setUint16(6,bytes.length,true);out.setUint16(8,offset,true);out.setUint16(10,part.length,true);
 new Uint8Array(out.buffer,12).set(part);return out;
}
function fixture(options={}){
 let admitted=true,ack=0,transaction=null,response=null,gate=null;const events=[],callbacks=[],executions=[];
 const raw={deviceId:identity,mode:4,brightness:100,power:true,leds:135,effects:[...effects],name:'New snapshot',
  firmware:{version:'1.15.1',phase:0},effectOptions:effects.map(()=>[50,60,0,0,0,0])};
 const packet=()=>new DataView(Uint8Array.of(1,ack,0,4,100,1,effects.length,9,0,0,0,0).buffer);
 const pause=async key=>{if(gate?.key!==key)return;if(gate.skip>0){--gate.skip;return;}const held=gate;gate=null;held.started.resolve();await held.finished.promise;};
 const radio={
  async write(device,service,characteristic,frame){
   assert.equal(device,'target');assert.equal(service,SERVICE);assert.equal(characteristic,COMMAND);
   const op=frame.getUint8(2),tx=frame.byteLength>=5?frame.getUint16(3,true):0;events.push({write:op,tx});await pause('write:'+op);
   if(op===22){if(!frame.getUint8(5))response=null;else transaction={tx,endpoint:frame.getUint8(5),method:frame.getUint8(6),body:[]};}
   if(op===23)transaction.body.push(...new Uint8Array(frame.buffer,frame.byteOffset+7,frame.byteLength-7));
   if(op===24){
    executions.push({...transaction});const text=transaction.endpoint===1?JSON.stringify(raw):transaction.endpoint===26?JSON.stringify(legacyCatalog(effects)):JSON.stringify({ok:true,padding:'x'.repeat(1100)});
    response={tx,endpoint:transaction.endpoint,text,offset:0};
   }
   if(op===25)response.offset=frame.getUint16(5,true);
   ack=frame.getUint8(1);lamp.receive(packet());
  },
  async read(device,service,characteristic){
   assert.equal(device,'target');assert.equal(service,SERVICE);events.push({read:characteristic,endpoint:response?.endpoint,offset:response?.offset});
   await pause('read:'+characteristic+':'+(response?.endpoint??0));
   if(characteristic===STATE)return packet();
   if(characteristic===EFFECT_OPTIONS)return new DataView(Uint8Array.of(1,4,50,60,0,0,0,0).buffer);
   if(characteristic===identityChar)return new DataView(new TextEncoder().encode(identity).buffer);
   assert.equal(characteristic,CONTROL);if(!response)return page(JSON.stringify({version:1,capabilities:['control','groups'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.15.1'}),0,0);
   return page(response.text,response.tx,response.endpoint,response.offset);
  },async disconnect(){events.push({disconnect:true});}
 };
 const lamp=new LampTransport(radio,{timeout:60,onState:(state,metadata)=>callbacks.push({state,metadata}),onFirmware:firmware=>callbacks.push({firmware}),onOptions:options=>callbacks.push({options}),...options});
 lamp.id='target';lamp.deviceIdentity=identity;lamp.control={capabilities:['control'],maxRequest:1024,maxResponse:8192,pageBytes:480};
 lamp.state={id:0,result:0,mode:4,brightness:100,power:true,effectCount:effects.length,capabilities:9,supportsColor:true};lamp.catalog=legacyCatalog(effects);
 const guard=()=>{if(!admitted)throw Object.assign(Error('A firmware operation owns the radio.'),{confirmed:true,cancelled:true,backgroundPaused:true});};
 return {lamp,radio,events,callbacks,executions,guard,raw,setAdmitted:value=>admitted=value,getAdmitted:()=>admitted,
  hold:(key,skip=0)=>{const held={key,skip,started:deferred(),finished:deferred()};gate=held;return held;}};
}
async function resume(f){
 f.setAdmitted(true);const result=JSON.parse(await f.lamp.request('/api/firmware',undefined,f.lamp.epoch,f.guard));assert.equal(result.ok,true);
 assert.equal(f.lamp.id,'target');assert(!f.events.some(row=>row.disconnect));
}
const heldError=(error,uncertain=false)=>error.readAdmission&&error.cancelled&&error.confirmed===!uncertain&&error.uncertain===uncertain;

test('a GET fourth guard rejects a queued BEGIN without any native query and normal reads resume',async()=>{
 const f=fixture(),gate=deferred();f.lamp.tail=gate.promise;
 const result=f.lamp.request('/api/descriptor',undefined,f.lamp.epoch,f.guard);await new Promise(resolve=>setImmediate(resolve));
 f.setAdmitted(false);gate.resolve();await assert.rejects(result,error=>heldError(error));
 assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);assert.deepEqual(f.executions,[]);await resume(f);
});

for(const op of [22,24,25])test('admission lost during GET command '+op+' fences its late ACK, all later queries and cleanup',async()=>{
 const f=fixture(),gate=f.hold('write:'+op),pending=f.lamp.request('/api/descriptor',undefined,f.lamp.epoch,f.guard);
 await gate.started.promise;const native=f.events.length,callbacks=f.callbacks.length,state=f.lamp.state;
 f.setAdmitted(false);gate.finished.resolve();await assert.rejects(pending,error=>heldError(error));
 assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.state,state);
 const reads=f.events.filter(row=>row.read);
 assert.equal(reads.length,op===25?1:0);if(op===25)assert.deepEqual(reads.map(row=>({read:row.read,offset:row.offset})),[{read:CONTROL,offset:0}]);
 assert.equal(f.events.filter(row=>row.write===24).length,op===22?0:1);await resume(f);
});

test('explicit fifth guard fences each body chunk of a background relay read before a remote dispatch',async()=>{
 const f=fixture(),gate=f.hold('write:23');
 const pending=f.lamp.request('/api/mesh/request',{target:'112233445566',requestId:'a'.repeat(16),endpoint:1,method:1,body:''},f.lamp.epoch,null,f.guard);
 await gate.started.promise;const native=f.events.length,callbacks=f.callbacks.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error));assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);
 assert.equal(f.executions.length,0);assert.equal(f.events.filter(row=>row.write===23).length,1);assert(!f.events.some(row=>row.write===24||row.write===25||row.read));await resume(f);
});

test('a PAGE queued behind another lane checks admission again before its native write',async()=>{
 const f=fixture(),gate=deferred(),queued=deferred(),write=f.radio.write.bind(f.radio),command=f.lamp.command.bind(f.lamp);
 f.radio.write=async(...args)=>{await write(...args);if(args[3].getUint8(2)===24)f.lamp.tail=gate.promise;};
 f.lamp.command=(operation,...args)=>{const result=command(operation,...args);if(operation==='controlPage')queued.resolve();return result;};
 const pending=f.lamp.request('/api/descriptor',undefined,f.lamp.epoch,f.guard);await queued.promise;
 assert(!f.events.some(row=>row.write===25));
 // The Commit-cached first page has already been read. This queued selector
 // is for its next offset; cancellation must prevent that write and all
 // subsequent reads or cleanup, rather than disallow the earlier valid read.
 assert.deepEqual(f.events.filter(row=>row.read).map(row=>({read:row.read,offset:row.offset})),[{read:CONTROL,offset:0}]);
 const native=f.events.length;f.setAdmitted(false);gate.resolve();await assert.rejects(pending,error=>heldError(error));
 assert.equal(f.events.length,native);assert(!f.events.some(row=>row.write===25));assert.equal(f.executions.length,1);await resume(f);
});

test('a late CONTROL page read never submits another page or adopts a stale settings snapshot',async()=>{
 const f=fixture(),previous={name:'Saved snapshot'};f.lamp.raw=previous;
 const gate=f.hold('read:'+CONTROL+':1'),pending=f.lamp.refresh(identity,true,f.guard);await gate.started.promise;
 const native=f.events.length,callbacks=f.callbacks.length,state=f.lamp.state,catalog=f.lamp.catalog;
 f.setAdmitted(false);gate.finished.resolve();await assert.rejects(pending,error=>heldError(error));
 assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.state,state);assert.equal(f.lamp.catalog,catalog);
 assert(!f.callbacks.some(row=>row.metadata?.freshControl||row.firmware||row.options));await resume(f);
});

test('a direct GET cannot return stale text if admission is lost during its awaited cleanup',async()=>{
 const f=fixture(),gate=f.hold('write:22',1),pending=f.lamp.request('/api/descriptor',undefined,f.lamp.epoch,f.guard);
 await gate.started.promise;const native=f.events.length,callbacks=f.callbacks.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error));assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);await resume(f);
});

test('a late catalog read cannot publish the saved state or begin a retry catalog download',async()=>{
 const f=fixture();f.lamp.catalog=null;const gate=f.hold('read:'+CONTROL+':26'),pending=f.lamp.refresh(identity,true,f.guard);
 await gate.started.promise;const native=f.events.length,callbacks=f.callbacks.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error));assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.catalog,null);assert.equal(f.lamp.raw,null);
 assert.equal(f.executions.filter(row=>row.endpoint===26).length,1);assert(!f.callbacks.some(row=>row.metadata?.freshControl||row.firmware||row.options));await resume(f);
});

test('a normal refreshed snapshot publishes callbacks only while the read remains admitted',async()=>{
 const f=fixture();f.lamp.onState=(state,metadata)=>{f.callbacks.push({state,metadata});if(metadata?.freshControl)f.setAdmitted(false);};
 await assert.rejects(f.lamp.refresh(identity,true,f.guard),/owns the radio/);
 assert.equal(f.callbacks.filter(row=>row.metadata?.freshControl).length,1);assert(!f.callbacks.some(row=>row.firmware||row.options));
 f.lamp.onState=()=>{};await resume(f);
});

test('admission loss after a settings Commit remains uncertain and never replays or resets that transaction',async()=>{
 const f=fixture(),gate=f.hold('write:24'),pending=f.lamp.request('/api/name',{name:'Chosen name'},f.lamp.epoch,null,f.guard);
 await gate.started.promise;const native=f.events.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error,true));assert.equal(f.events.length,native);assert.equal(f.executions.length,1);
 assert.equal(f.events.filter(row=>row.write===24).length,1);assert.equal(f.events.filter(row=>row.write===22).length,1);assert(!f.events.some(row=>row.write===25||row.read));
 assert.equal(f.lamp.id,'target');assert(!f.events.some(row=>row.disconnect));
});

test('a mutative response page lost to admission also remains uncertain after its single Commit',async()=>{
 const f=fixture(),gate=f.hold('read:'+CONTROL+':13'),pending=f.lamp.request('/api/name',{name:'Chosen name'},f.lamp.epoch,null,f.guard);
 await gate.started.promise;const native=f.events.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error,true));assert.equal(f.events.length,native);assert.equal(f.executions.length,1);assert.equal(f.events.filter(row=>row.write===24).length,1);
});

test('an issued ordinary mutation also remains uncertain when its ACK admission is lost',async()=>{
 const f=fixture(),gate=f.hold('write:2'),pending=f.lamp.command('brightness',120,null,null,f.guard);
 await gate.started.promise;f.setAdmitted(false);gate.finished.resolve();await assert.rejects(pending,error=>heldError(error,true));
 assert.equal(f.events.filter(row=>row.write===2).length,1);assert.equal(f.callbacks.length,0);assert(!f.events.some(row=>row.read||row.disconnect));
});

test('admission loss during an ACK probe fences its late state read and callback',async()=>{
 const f=fixture(),gate=f.hold('read:'+STATE+':0'),receive=f.lamp.receive.bind(f.lamp);let blocked=true;
 f.lamp.receive=data=>{if(!blocked)receive(data);};
 const pending=f.lamp.request('/api/descriptor',undefined,f.lamp.epoch,f.guard);await gate.started.promise;
 const native=f.events.length,callbacks=f.callbacks.length;blocked=false;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>heldError(error));assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);assert.equal(f.executions.length,0);
 await resume(f);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function scheduler(t,options={}){
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(options);
 f.lamp.raw={...f.raw,name:'Saved snapshot'};
 t.after(()=>{clearTimeout(f.lamp.controlTimer);f.lamp.controlRefreshOwner=null;});return f;
}
test('a globally paused automatic timer reschedules without GATT and resumes with a fresh generation',async t=>{
 let allowed=true,generation=0;const f=scheduler(t,{backgroundAllowed:()=>allowed,backgroundGeneration:()=>generation});
 f.lamp.scheduleControlRefresh();allowed=false;generation++;t.mock.timers.tick(2500);await settle();t.mock.timers.tick(2500);await settle();
 assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);assert.equal(f.lamp.id,'target');assert(f.lamp.controlTimer);
 allowed=true;generation++;t.mock.timers.tick(2500);await settle();assert.deepEqual(f.events,[]);
 t.mock.timers.tick(2500);await settle();assert(f.callbacks.some(row=>row.metadata?.freshLight));assert.equal(f.lamp.raw.name,'Saved snapshot');
 assert.deepEqual(f.events.filter(row=>row.read).map(row=>row.read),[STATE,EFFECT_OPTIONS]);assert.deepEqual(f.executions,[]);
 assert(!f.events.some(row=>row.disconnect));
});

test('automatic refresh queued behind the action lane rechecks the generation before any query',async t=>{
 let allowed=true,generation=0;const f=scheduler(t,{backgroundAllowed:()=>allowed,backgroundGeneration:()=>generation}),gate=deferred();
 f.lamp.actionTail=gate.promise;f.lamp.scheduleControlRefresh();t.mock.timers.tick(2500);await settle();assert.deepEqual(f.events,[]);
 allowed=false;generation++;gate.resolve();await settle();assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);assert.equal(f.lamp.raw.name,'Saved snapshot');
 allowed=true;generation++;t.mock.timers.tick(2500);await settle();t.mock.timers.tick(2500);await settle();
 assert(f.callbacks.some(row=>row.metadata?.freshLight));assert(!f.events.some(row=>row.disconnect));
});

test('a generation change during an automatic protected light read prevents late cache, callbacks and further native work',async t=>{
 let allowed=true,generation=0;const f=scheduler(t,{backgroundAllowed:()=>allowed,backgroundGeneration:()=>generation}),previous={name:'Saved snapshot',firmware:{phase:0}};
 f.lamp.raw=previous;const gate=f.hold('read:'+STATE+':0');f.lamp.scheduleControlRefresh();t.mock.timers.tick(2500);await gate.started.promise;
 const native=f.events.length,callbacks=f.callbacks.length;allowed=false;generation++;gate.finished.resolve();await settle();
 assert.equal(f.events.length,native);assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.id,'target');
 t.mock.timers.tick(2500);await settle();assert.equal(f.events.length,native);assert(!f.events.some(row=>row.disconnect));
});

test('a late scheduler callback cannot rearm or clear a replacement timer owner',async t=>{
 const f=scheduler(t),gate=f.hold('read:'+STATE+':0'),previous=f.lamp.raw;f.lamp.scheduleControlRefresh();t.mock.timers.tick(2500);await gate.started.promise;
 const native=f.events.length;f.lamp.scheduleControlRefresh();const replacement=f.lamp.controlRefreshOwner,timer=f.lamp.controlTimer;
 gate.finished.resolve();await settle();assert.equal(f.events.length,native);assert.equal(f.lamp.controlRefreshOwner,replacement);assert.equal(f.lamp.controlTimer,timer);assert.equal(f.lamp.raw,previous);
 t.mock.timers.tick(2500);await settle();assert(f.callbacks.some(row=>row.metadata?.freshLight));
});

test('throwing automatic policy callbacks fail closed without disconnecting or blocking future admitted refreshes',async t=>{
 let broken=true;const f=scheduler(t,{backgroundAllowed:()=>{if(broken)throw Error('Private callback details.');return true;}});
 f.lamp.scheduleControlRefresh();t.mock.timers.tick(5000);await settle();assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);
 broken=false;t.mock.timers.tick(2500);await settle();assert(f.callbacks.some(row=>row.metadata?.freshLight));assert(!f.events.some(row=>row.disconnect));
});

test('private firmware-only connections never arm automatic control timers or consult their policy',async t=>{
 let checks=0;const f=scheduler(t,{firmwareOnly:true,backgroundAllowed:()=>{checks++;return false;},backgroundGeneration:()=>{checks++;return 1;}});
 f.lamp.scheduleControlRefresh();t.mock.timers.tick(10000);await settle();assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);assert.equal(checks,0);assert(!f.lamp.controlTimer);
});

function basicFirmware(f){
 f.lamp.state.capabilities|=4;const native=f.radio.read.bind(f.radio);
 f.radio.read=async(device,service,characteristic)=>{
  if(characteristic!==FIRMWARE)return native(device,service,characteristic);
  f.events.push({read:FIRMWARE});await f.firmwareRead?.();const data=new DataView(new ArrayBuffer(20));data.setUint8(0,1);data.setUint16(6,1,true);data.setUint16(8,15,true);data.setUint16(10,1,true);return data;
 };
}
test('basic firmware telemetry guards admission before issuing its single protected read',async()=>{
 const f=fixture();basicFirmware(f);f.setAdmitted(false);await assert.rejects(f.lamp.refreshFirmware(f.guard),error=>error.readAdmission&&error.confirmed&&error.cancelled);
 assert.deepEqual(f.events,[]);assert.deepEqual(f.callbacks,[]);
});
test('a late basic firmware read cannot adopt cache or callback after a global hold',async()=>{
 const f=fixture();basicFirmware(f);const previous={version:'1.13.0'},gate=deferred(),started=deferred();f.lamp.raw={firmware:previous};f.lamp.state.firmware=previous;
 f.firmwareRead=async()=>{started.resolve();await gate.promise;};const pending=f.lamp.refreshFirmware(f.guard);await started.promise;f.setAdmitted(false);gate.resolve();
 await assert.rejects(pending,error=>error.readAdmission&&error.confirmed&&error.cancelled);assert.equal(f.lamp.raw.firmware,previous);assert.equal(f.lamp.state.firmware,previous);assert.deepEqual(f.callbacks,[]);
 assert.deepEqual(f.events,[{read:FIRMWARE}]);f.setAdmitted(true);f.firmwareRead=null;assert.equal((await f.lamp.refreshFirmware(f.guard)).version,'1.15.1');assert.equal(f.callbacks.filter(row=>row.firmware).length,1);
});
test('intentional firmware-owner reads retain default behavior despite the global background policy',async()=>{
 const f=fixture({backgroundAllowed:()=>false});basicFirmware(f);assert.equal((await f.lamp.refreshFirmware()).version,'1.15.1');assert.deepEqual(f.events,[{read:FIRMWARE}]);assert.equal(f.callbacks.filter(row=>row.firmware).length,1);
});

function automaticConnection({controlOnly=false}={}){
 const f=fixture({controlOnly,expectedDeviceIdentity:identity});f.lamp.id=null;f.lamp.state=null;f.lamp.control=null;f.lamp.deviceIdentity=null;f.lamp.catalog=null;
 f.radio.initialize=async()=>{};f.radio.getDevices=async ids=>ids.map(deviceId=>({deviceId}));f.radio.connect=async()=>{};f.radio.startNotifications=async()=>{};
 f.connect=()=>f.lamp.connect({id:identity,deviceId:'target',accessoryManaged:true,readOnlyReconnect:true},false,{isCurrent:f.getAdmitted});return f;
}
for(const controlOnly of [true,false])test('automatic '+(controlOnly?'auxiliary':'saved')+' connect fences late capability metadata before a settings request',async()=>{
 const f=automaticConnection({controlOnly}),gate=f.hold('read:'+CONTROL+':0'),pending=f.connect();await gate.started.promise;
 const native=f.events.length,callbacks=f.callbacks.length;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>error.cancelled&&!error.incompatible);
 assert(f.events.slice(native).every(row=>row.disconnect));assert(!f.events.some(row=>row.write));assert.equal(f.events.filter(row=>row.read===CONTROL).length,1);
 assert.equal(f.callbacks.length,callbacks);assert.equal(f.lamp.id,null);assert.equal(f.lamp.raw,null);
});
for(const controlOnly of [true,false])test('automatic '+(controlOnly?'auxiliary':'saved')+' connect fences all late snapshot pages and catalog requests',async()=>{
 const f=automaticConnection({controlOnly}),gate=f.hold('read:'+CONTROL+':1'),pending=f.connect();await gate.started.promise;
 const native=f.events.length,callbacks=f.callbacks.length;f.setAdmitted(false);gate.finished.resolve();await assert.rejects(pending,error=>error.cancelled);
 assert(f.events.slice(native).every(row=>row.disconnect));assert.equal(f.callbacks.length,callbacks);assert.equal(f.executions.filter(row=>row.endpoint===26).length,0);
 assert.equal(f.lamp.id,null);assert.equal(f.lamp.raw,null);assert.equal(f.lamp.catalog,null);
});
test('cancellation of an automatic capability read prevents the cached-denial retry instead of relabeling firmware incompatible',async()=>{
 const f=automaticConnection({controlOnly:true}),read=f.radio.read.bind(f.radio);f.radio.read=async(...args)=>{
  const value=await read(...args);if(args[2]===CONTROL&&!f.executions.length){const denied=page('',0,0);denied.setUint16(4,403,true);return denied;}return value;
 };
 const gate=f.hold('read:'+CONTROL+':0'),pending=f.connect();await gate.started.promise;f.setAdmitted(false);gate.finished.resolve();
 await assert.rejects(pending,error=>error.cancelled&&!error.incompatible);assert.equal(f.events.filter(row=>row.read===CONTROL).length,1);assert(!f.events.some(row=>row.write));
});
