import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {MeshTransport,acquireMeshLamp} from '../src/mesh.js';

const target='aabbccddeeff',bridgeIdentity='112233445566',boot='1234567890abcdef';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const firmware=(version='1.15.1')=>({version,latest:version,phase:0,progress:0,error:0,wifi:true,automatic:false,available:false});
const model=()=>({deviceId:target,hostname:'coollamp-target.local',name:'Target',mode:1,brightness:100,power:true,leds:67,
 effects:['Rain'],catalogVersion:1,colors:[[1,1,2,3]],effectOptions:[[50,70,0,0,0,0]],firmware:firmware()});
function fixture(t){
 const raw=model(),calls=[],events=[],transactions=new Map();let allowed=true,generation=0,sequence=0,releases=0,handler=null;
 const bridge={identity:bridgeIdentity,epoch:1,control:{capabilities:['mesh-control']},raw:{firmware:firmware()},
  request:async(path,fields,epoch,beforeWrite,readGuard)=>{
   beforeWrite?.();readGuard?.();const endpoint=fields?.endpoint??transactions.get(fields?.requestId)?.endpoint;
   calls.push({path,endpoint,method:fields?.method,offset:fields?.offset,readGuard:typeof readGuard==='function'});
   if(path==='/api/mesh/request')transactions.set(fields.requestId,{endpoint:fields.endpoint,response:''});
   const override=await handler?.(path,fields,endpoint,beforeWrite,readGuard);if(override!==undefined)return override;
   if(path==='/api/mesh/status')return {version:1,deviceId:bridgeIdentity,fleetId:boot,available:true,peers:[{id:target,online:true,hops:1}]};
   let tx;
   if(path==='/api/mesh/request'){
    let response='OK';if(fields.endpoint===1)response=JSON.stringify(raw);if(fields.endpoint===18)response=JSON.stringify(raw.firmware);
    if(fields.endpoint===26)response=JSON.stringify(raw.effects.map((name,index)=>({id:index+1,name,category:'calm',speed:true})));
    if(fields.method===2&&fields.endpoint===31){raw.power=new URLSearchParams(fields.body).get('on')==='1';}
    tx={endpoint:fields.endpoint,response};transactions.set(fields.requestId,tx);
   }else tx=transactions.get(fields.requestId);
   assert(tx);const bytes=new TextEncoder().encode(tx.response),offset=fields.offset??0,page=bytes.slice(offset,offset+256);
   return {version:1,target,requestId:fields.requestId,targetBoot:boot,status:'ok',executed:true,httpStatus:200,total:bytes.length,offset,
    data:btoa(String.fromCharCode(...page))};
  }};
 const lease={lamp:bridge,release:async()=>{releases++;}};
 const options={timeout:5000,pollInterval:1,id:()=> (++sequence).toString(16).padStart(16,'0'),
  backgroundAllowed:()=>allowed,backgroundGeneration:()=>generation,
  callbacks:{onState:state=>events.push({kind:'state',state}),onFirmware:value=>events.push({kind:'firmware',value}),
   onOptions:value=>events.push({kind:'options',value}),onError:error=>events.push({kind:'error',error}),onDisconnect:()=>events.push({kind:'disconnect'})}};
 const lamp=new MeshTransport(options);t.after(()=>lamp.disconnect());
 return {lamp,bridge,lease,options,raw,calls,events,transactions,get releases(){return releases;},
  hold:()=>{allowed=false;generation++;},resume:()=>{allowed=true;},advance:()=>{generation++;},setHandler:value=>{handler=value;},
  guard:()=>allowed,connect:async()=>{await lamp.connect(target,lease,{poll:false});calls.length=0;events.length=0;}};
}
const endpoints=f=>f.calls.filter(value=>value.path==='/api/mesh/request').map(value=>value.endpoint);
const stopped=error=>error.backgroundCancelled===true&&error.cancelled===true;

test('selected mesh automatic polling inherits suppression and resumes without releasing the bridge',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();f.lamp.schedule();f.hold();
 t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);assert.equal(f.releases,0);
 f.resume();t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(endpoints(f),[18,1]);assert.equal(f.releases,0);
 assert(!f.events.some(value=>['error','disconnect'].includes(value.kind)));assert(f.calls.every(value=>value.readGuard));
});

test('a mesh poll already queued behind another task cannot use a later background generation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();const gate=deferred();
 const prior=f.lamp.enqueue(()=>gate.promise);f.lamp.schedule();t.mock.timers.tick(2500);await nextTurn();
 f.hold();f.resume();gate.resolve();await prior;await nextTurn();assert.deepEqual(f.calls,[]);assert.equal(f.releases,0);
 t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(endpoints(f),[18,1]);
});

for(const phase of ['first-reply','result-page'])test('a paused mesh '+phase+' cannot issue another page, adopt state or disconnect',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw;
 f.setHandler((path,fields,endpoint)=>{
  if(endpoint!==18)return;
  if(path==='/api/mesh/request'){
   if(phase==='first-reply'){entered.resolve();return gate.promise;}
   return {version:1,target,requestId:fields.requestId,status:'pending',executed:false};
  }
  if(path==='/api/mesh/result'){entered.resolve();return gate.promise;}
 });
 f.lamp.schedule();t.mock.timers.tick(2500);await nextTurn();
 if(phase==='result-page')t.mock.timers.tick(1);
 await entered.promise;f.hold();gate.resolve({malformed:'private native response'});await nextTurn();
 assert.deepEqual(endpoints(f),[18]);assert.equal(f.calls.length,phase==='first-reply'?1:2);
 assert.equal(f.lamp.raw,oldRaw);assert.deepEqual(f.events,[]);assert.equal(f.releases,0);assert.equal(f.lamp.identity,target);
});

test('a pending bridge dispatch receives a live generation fence before any target read is sent',async t=>{
 const f=fixture(t);await f.connect();const queued=deferred(),entered=deferred();let targetDispatches=0;
 f.setHandler(async(path,fields,endpoint,beforeWrite,readGuard)=>{
  if(path!=='/api/mesh/request'||endpoint!==18)return;entered.resolve();await queued.promise;
  beforeWrite();readGuard();targetDispatches++;return {version:1,target,requestId:fields.requestId,status:'pending',executed:false};
 });
 const poll=f.lamp.poll();await entered.promise;f.hold();f.resume();queued.resolve();await assert.rejects(poll,stopped);
 assert.equal(targetDispatches,0);assert.equal(f.calls.length,1);assert.deepEqual(f.events,[]);assert.equal(f.releases,0);
});

test('version-change refresh preserves admission through target state paging and catalog selection',async t=>{
 const f=fixture(t);await f.connect();const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw,oldCatalog=f.lamp.catalog;
 f.raw.firmware=firmware('1.16.0');
 f.setHandler((path,fields,endpoint)=>{if(path==='/api/mesh/request'&&endpoint===1){entered.resolve();return gate.promise;}});
 const poll=f.lamp.poll();await entered.promise;f.hold();gate.resolve({malformed:true});await assert.rejects(poll,stopped);
 assert.deepEqual(endpoints(f),[18,1]);assert.equal(f.lamp.raw,oldRaw);assert.equal(f.lamp.catalog,oldCatalog);assert.deepEqual(f.events,[]);
});

test('a paused mesh catalog request cannot adopt its entries or recurse through state again',async t=>{
 const f=fixture(t);await f.connect();const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw,oldCatalog=f.lamp.catalog;
 f.raw.effects.push('Aurora');
 f.setHandler((path,fields,endpoint)=>{if(path==='/api/mesh/request'&&endpoint===26){entered.resolve();return gate.promise;}});
 const poll=f.lamp.poll();await entered.promise;f.hold();gate.resolve({malformed:true});await assert.rejects(poll,stopped);
 assert.deepEqual(endpoints(f),[18,1,26]);assert.equal(f.lamp.raw,oldRaw);assert.equal(f.lamp.catalog,oldCatalog);
 assert.deepEqual(f.events.map(value=>value.kind),['firmware']);
});

test('manual mesh mutations retain their uncertain result and cannot be replayed by a background hold',async t=>{
 const f=fixture(t);await f.connect();f.hold();await f.lamp.command('power',0);assert.equal(f.raw.power,false);
 assert.deepEqual(f.calls.filter(value=>value.method===2).map(value=>value.endpoint),[31]);
 const before=f.calls.length;
 f.setHandler((path,fields)=>{if(path==='/api/mesh/request'&&fields.method===2)throw Error('Native execution reply lost.');});
 await assert.rejects(f.lamp.command('power',1),error=>error.uncertain===true);
 assert.equal(f.calls.slice(before).filter(value=>value.method===2).length,1);assert.equal(f.releases,1);
});

test('guarded mesh connect stops before target catalog and releases only its own lease',async t=>{
 const f=fixture(t),gate=deferred(),entered=deferred();
 f.setHandler((path,fields,endpoint)=>{if(path==='/api/mesh/request'&&endpoint===1){entered.resolve();return gate.promise;}});
 const connecting=f.lamp.connect(target,f.lease,{poll:false,guard:f.guard});await entered.promise;
 f.hold();gate.resolve({malformed:true});await assert.rejects(connecting,stopped);assert.deepEqual(endpoints(f),[1]);
 assert.equal(f.releases,1);assert(!f.events.some(value=>['state','firmware','options'].includes(value.kind)));
});

test('acquireMeshLamp forwards background policy into the selected transport without suppressing manual admission',async t=>{
 const f=fixture(t),lease=await acquireMeshLamp({target,candidates:[{id:bridgeIdentity}],acquireBridge:async()=>f.lease,options:f.options});
 t.after(()=>lease.release());f.calls.length=0;f.events.length=0;f.hold();
 await assert.rejects(lease.lamp.poll(),stopped);assert.deepEqual(f.calls,[]);assert.equal(lease.lamp.identity,target);
 await lease.lamp.refresh();assert.deepEqual(endpoints(f),[1]);
});

test('an automatic mesh failure cannot start recovery after async lease cleanup enters a new firmware generation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();const cleanup=deferred(),entered=deferred();
 f.lease.release=async()=>{entered.resolve();await cleanup.promise;};
 f.setHandler((path,fields)=>{if(path==='/api/mesh/request')return {version:1,target,requestId:fields.requestId,status:'no-route',executed:false};});
 f.lamp.schedule();t.mock.timers.tick(2500);await entered.promise;f.hold();cleanup.resolve();await nextTurn();
 assert.deepEqual(endpoints(f),[18]);assert.deepEqual(f.events.map(value=>value.kind),['disconnect']);
});
