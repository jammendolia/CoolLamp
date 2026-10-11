import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshTransport,MeshInventorySession,acquireMeshLamp} from '../src/mesh.js';
import {runLampPower} from '../src/lamp-power.js';

const target='aabbccddeeff',bridgeId='112233445566',boot='1234567890abcdef';
const model=()=>({deviceId:target,hostname:'coollamp-target.local',name:'Target',mode:1,brightness:100,power:true,leds:67,
 apiVersion:2,catalogVersion:1,effects:['Target rain'],colors:[[1,1,2,3]],effectOptions:[[50,75,0,4,5,6]],
 firmware:{version:'1.12.0',latest:'1.12.0',phase:0,progress:0,error:0,wifi:false,available:false,automatic:false},
 sync:{version:2,role:0,active:false,paused:false,scene:0,key:'must-not-retain'},token:'must-not-retain'});
function fixture(){
 const raw=model(),requests=[],transactions=new Map(),writes=[];let sequence=0,releases=0;
 const bridge={identity:bridgeId,epoch:1,control:{capabilities:['mesh-control']},raw:{name:'Bridge'},async request(path,fields,epoch,fence){
  fence?.();requests.push({path,fields});
  if(path==='/api/mesh/status')return {version:1,deviceId:bridgeId,fleetId:boot,available:true,peers:[{id:target,name:'Target',online:true,hops:2}]};
  if(path==='/api/mesh/request'){
   const form=new URLSearchParams(fields.body);let response='OK';
   if(fields.endpoint===1)response=JSON.stringify(raw);
   if(fields.endpoint===26)response=JSON.stringify([{id:1,name:raw.effects[0],category:'calm',speed:true}]);
   if(fields.endpoint===18)response=JSON.stringify(raw.firmware);
   if(fields.method===2){writes.push(fields);if(fields.endpoint===31){raw.power=form.get('on')==='1';if(raw.sync.role===2&&!raw.power){raw.sync.paused=true;raw.sync.active=false;}}}
   transactions.set(fields.requestId,{...fields,response});return {version:1,target,requestId:fields.requestId,status:'pending',executed:false};
  }
  const tx=transactions.get(fields.requestId),bytes=new TextEncoder().encode(tx.response),slice=bytes.slice(fields.offset,fields.offset+256);
  return {version:1,target,requestId:fields.requestId,targetBoot:boot,status:'ok',executed:true,httpStatus:200,total:bytes.length,offset:fields.offset,data:btoa(String.fromCharCode(...slice))};
 }};
 const lease={lamp:bridge,release:async()=>{releases++;}};
 const lamp=new MeshTransport({timeout:90,pollInterval:1,id:()=> (++sequence).toString(16).padStart(16,'0')});
 return {raw,bridge,lamp,requests,writes,lease,releases:()=>releases};
}
async function connected(t){const f=fixture();await f.lamp.connect(target,f.lease,{poll:false});t.after(()=>f.lamp.disconnect());return f;}

test('target snapshot, settings, identity and authoritative catalog stay separate from bridge',async t=>{
 const f=await connected(t);assert.equal(f.lamp.identity,target);assert.equal(f.bridge.identity,bridgeId);assert.equal(f.lamp.base,'mesh:'+target+'@'+bridgeId);
 assert.equal(f.lamp.catalog[0].name,'Target rain');assert.equal(f.lamp.raw.leds,67);assert.equal(f.lamp.state.color.g,2);
 assert(!JSON.stringify(f.lamp.raw).includes('must-not-retain'));assert.equal(f.writes.length,0);
 assert(f.requests.filter(row=>row.path==='/api/mesh/request').every(row=>row.fields.target===target));
});
test('power uses exactly one target mutation and a fresh readback',async t=>{
 const f=await connected(t);await f.lamp.command('power',0);assert.equal(f.raw.power,false);assert.equal(f.lamp.state.power,false);
 assert.deepEqual(f.writes.map(row=>row.endpoint),[31]);assert.equal(new Set(f.requests.filter(row=>row.path==='/api/mesh/request').map(row=>row.fields.requestId)).size,4);
});
test('card power uses the mesh transport interface and pauses only the chosen follower',async t=>{
 const f=fixture();f.raw.sync={version:2,role:2,leader:bridgeId,active:true,paused:false,scene:0};await f.lamp.connect(target,f.lease,{poll:false});t.after(()=>f.lamp.disconnect());
 const result=await runLampPower({id:target,expected:{power:true,group:{role:2,leader:bridgeId}},acquire:async()=>({lamp:f.lamp,release:async()=>{}})});
 assert(result.changed);assert.equal(f.raw.sync.paused,true);assert.equal(f.raw.sync.role,2);assert.equal(f.writes.length,1);
});
test('paged UTF8 replies are decoded after complete bytes, including split multi-byte names',async t=>{
 const f=fixture();f.raw.name='é'.repeat(130);await f.lamp.connect(target,f.lease,{poll:false});t.after(()=>f.lamp.disconnect());assert.equal(f.lamp.raw.name,f.raw.name);
 assert(f.requests.filter(row=>row.path==='/api/mesh/result').some(row=>row.fields.offset>=256));
});
test('lost result ACK is bounded and never replays an executed mutation',async t=>{
 const f=await connected(t),original=f.bridge.request.bind(f.bridge);f.bridge.request=async(path,fields,...args)=>{
  if(path==='/api/mesh/result')return {version:1,target,requestId:fields.requestId,status:'pending',executed:true};return original(path,fields,...args);
 };
 const start=Date.now();await assert.rejects(f.lamp.command('power',0),error=>error.uncertain===true);assert(Date.now()-start<600);assert.equal(f.writes.length,1);assert.equal(f.releases(),1);
});
test('a bridge request that never resolves is bounded without a resend',async t=>{
 const f=await connected(t);f.bridge.request=()=>new Promise(()=>{});const start=Date.now();await assert.rejects(f.lamp.command('power',0),error=>error.uncertain===true);assert(Date.now()-start<600);
});
test('no route is distinguished from ambiguous execution and suggests direct Bluetooth',async t=>{
 const f=await connected(t);f.bridge.request=async(path,fields)=>({version:1,target,requestId:fields.requestId,status:'no-route',executed:false});
 await assert.rejects(f.lamp.request('/api/state'),error=>error.noRoute===true&&error.confirmed===true&&/Bluetooth/.test(error.message));
 f.bridge.request=async(path,fields)=>({version:1,target,requestId:fields.requestId,status:'no-route',executed:true});await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true&&!error.noRoute);
});
test('a changed target, transaction, response offset or boot cannot confirm a change',async t=>{
 for(const patch of [{target:bridgeId},{requestId:boot},{offset:1},{targetBoot:'fedcba0987654321'}]){
  const f=await connected(t),original=f.bridge.request.bind(f.bridge);f.bridge.request=async(path,fields,...args)=>{const reply=await original(path,fields,...args);return path==='/api/mesh/result'?{...reply,...patch}:reply;};
  await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true);assert.equal(f.writes.length,1);
 }
});
test('target reboot during catalog reading cannot replace its previous verified snapshot',async t=>{
 const f=await connected(t),prior=f.lamp.raw,original=f.bridge.request.bind(f.bridge);f.raw.firmware.version='1.12.1';
 f.bridge.request=async(path,fields,...args)=>{const reply=await original(path,fields,...args);return path==='/api/mesh/result'&&f.bridge.epoch===1?{...reply,targetBoot:'ffffffffffffffff'}:reply;};
 await assert.rejects(f.lamp.refresh(),error=>error.targetRestarted===true);assert.equal(f.lamp.raw,prior);
});
test('post-submission selection cancellation and bridge loss preserve uncertainty',async t=>{
 for(const cancelBridge of [false,true]){
  const f=await connected(t),original=f.bridge.request.bind(f.bridge),abort=new AbortController();f.lamp.signal=abort.signal;
  f.bridge.request=async(path,fields,...args)=>{const reply=await original(path,fields,...args);if(path==='/api/mesh/request'){if(cancelBridge)f.bridge.epoch++;else abort.abort();}return reply;};
  await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true&&error.confirmed!==true);assert.equal(f.writes.length,1);
 }
});
for(const failure of ['Deadline','Unavailable','SessionChanged'])test(failure+' without an execution receipt remains uncertain and is never resent',async t=>{
 const f=await connected(t),original=f.bridge.request.bind(f.bridge);
 f.bridge.request=async(path,fields,...args)=>path==='/api/mesh/result'?{version:1,target,requestId:fields.requestId,targetBoot:boot,status:'rejected',executed:false,uncertain:true,httpStatus:503,total:0,offset:0,data:''}:original(path,fields,...args);
 await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true&&error.confirmed!==true&&!error.noRoute);
 assert.equal(f.writes.length,1);assert.equal(f.raw.power,false);
});
test('authenticated complete HTTP rejection preserves its body and confirmed status',async t=>{
 for(const status of [400,409]){
  const f=await connected(t),original=f.bridge.request.bind(f.bridge),message='Target rejected these settings.';
  f.bridge.request=async(path,fields,...args)=>path==='/api/mesh/result'?{version:1,target,requestId:fields.requestId,targetBoot:boot,status:'ok',executed:true,uncertain:false,httpStatus:status,total:message.length,offset:0,data:btoa(message)}:original(path,fields,...args);
  await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.confirmed===true&&error.status===status&&error.message===message&&!error.uncertain);
  assert.equal(f.writes.length,1);assert.equal(f.lamp.identity,target);
 }
});
test('lost retained bridge results stay uncertain even when HTTP 404 or 409 is confirmed',async t=>{
 for(const status of [404,409])for(const mutation of [false,true]){
  const f=await connected(t),original=f.bridge.request.bind(f.bridge);
  f.bridge.request=async(path,...args)=>{if(path==='/api/mesh/result')throw Object.assign(Error('Retained result unavailable.'),{status,confirmed:true});return original(path,...args);};
  await assert.rejects(f.lamp.request(mutation?'/api/power':'/api/state',mutation?{on:0}:undefined),error=>error.uncertain===true&&error.confirmed!==true&&!error.noRoute);
  assert.equal(f.writes.length,Number(mutation));
 }
});
test('queued bridge write fence rejects cancelled selection before late target dispatch',async t=>{
 const f=await connected(t),original=f.bridge.request.bind(f.bridge),abort=new AbortController();let release;
 f.lamp.signal=abort.signal;f.bridge.request=async(...args)=>{await new Promise(resolve=>release=resolve);return original(...args);};
 const pending=f.lamp.request('/api/power',{on:0});await new Promise(resolve=>setTimeout(resolve,2));abort.abort();await assert.rejects(pending,error=>error.cancelled===true);release();await new Promise(resolve=>setTimeout(resolve,2));assert.equal(f.writes.length,0);
});
test('external remote-broker ownership fence is rechecked before queued mesh dispatch',async t=>{
 const f=await connected(t),original=f.bridge.request.bind(f.bridge);let current=true,release;
 f.bridge.request=async(...args)=>{await new Promise(resolve=>release=resolve);return original(...args);};
 const request=f.lamp.request('/api/mesh/enroll/start',{target:'223344556677',broker:target,requestId:'aaaaaaaaaaaaaaaa'},f.lamp.epoch,()=>{if(!current)throw Object.assign(Error('Wizard canceled.'),{cancelled:true,confirmed:true});});
 await new Promise(resolve=>setTimeout(resolve,1));current=false;release();await assert.rejects(request,error=>error.cancelled===true);assert.equal(f.writes.length,0);
});
test('duplicate transaction IDs cannot issue another mutation',async t=>{
 const f=await connected(t);f.lamp.nextId=()=> 'aaaaaaaaaaaaaaaa';await f.lamp.request('/api/power',{on:0});await assert.rejects(f.lamp.request('/api/power',{on:1}),/fresh mesh request/);assert.equal(f.writes.length,1);
});
test('oversized Bluetooth bridge envelope is rejected before any relay write',async t=>{
 const f=await connected(t);await assert.rejects(f.lamp.request('/api/name',{name:'%'.repeat(200)}),error=>error.confirmed===true&&/bridge request limit/.test(error.message));assert.equal(f.writes.length,0);
});
test('destructive, trust, firmware-install and network settings explicitly need a direct connection',async t=>{
 const f=await connected(t);for(const [path,data] of [['/api/factory-reset',{confirm:'RESET'}],['/api/bluetooth/forget',{}],['/api/firmware/install',{}],['/api/firmware/check',{}],['/api/firmware/fleet',{key:boot}]])await assert.rejects(f.lamp.request(path,data),error=>error.needsDirectConnection===true&&error.confirmed===true);
 assert.equal(f.writes.length,0);await f.lamp.request('/api/config',{leds:67,milliamps:500,startupMode:1,startupBrightness:100});assert.equal(f.writes.length,1);
});
test('inventory supplements session cards without credentials, pairing or default selection',()=>{
 const inventory=new MeshInventorySession();inventory.remember({version:1,deviceId:bridgeId,fleetId:boot,available:true,peers:[{id:target,name:'Target',online:true,hops:2,deviceId:'not-authorized',key:'secret'},{id:'broken',online:true,hops:1}]},bridgeId);
 assert.deepEqual(inventory.items,[{id:target,name:'Target',meshBridgeId:bridgeId,meshOnline:true,meshHops:2}]);inventory.forget(target);inventory.remember({version:1,deviceId:bridgeId,fleetId:boot,available:true,peers:[{id:target,online:true,hops:1}]},bridgeId);assert.equal(inventory.items.length,0);
});
test('read-only bridge search tries the next bridge after proven no route and releases once',async t=>{
 const first=fixture(),second=fixture();first.bridge.request=async(path,fields)=>path==='/api/mesh/status'?{}:{version:1,target,requestId:fields.requestId,status:'no-route',executed:false};
 const lease=await acquireMeshLamp({target,candidates:[first,second],acquireBridge:async candidate=>candidate.lease,options:{timeout:90,pollInterval:1}});t.after(()=>lease.release());
 assert.equal(lease.lamp.identity,target);assert.equal(first.releases(),1);assert.equal(second.releases(),0);assert.equal(first.writes.length+second.writes.length,0);
});
test('an uncertain target read is preserved when a later bridge reports no route',async()=>{
 const first=fixture(),second=fixture(),original=first.bridge.request.bind(first.bridge);
 first.bridge.request=async(path,...args)=>path==='/api/mesh/request'?Promise.reject(Object.assign(Error('Target ACK lost.'),{uncertain:true})):original(path,...args);
 const next=second.bridge.request.bind(second.bridge);second.bridge.request=async(path,fields,...args)=>path==='/api/mesh/request'?{version:1,target,requestId:fields.requestId,status:'no-route',executed:false}:next(path,fields,...args);
 await assert.rejects(acquireMeshLamp({target,candidates:[first,second],acquireBridge:async candidate=>candidate.lease,options:{timeout:90,pollInterval:1}}),error=>error.uncertain===true&&!error.noRoute);
 assert.equal(first.releases(),1);assert.equal(second.releases(),1);assert.equal(first.writes.length+second.writes.length,0);
});
test('a Wi-Fi bridge on new firmware is enabled only by matching authenticated inventory',async t=>{
 const f=fixture();delete f.bridge.control;f.bridge.raw.firmware={version:'1.13.0'};
 const lease=await acquireMeshLamp({target,candidates:[f],acquireBridge:async()=>f.lease,options:{timeout:90,pollInterval:1}});t.after(()=>lease.release());assert.equal(lease.lamp.identity,target);
 const wrong=fixture();delete wrong.bridge.control;wrong.bridge.raw.firmware={version:'1.13.0'};const original=wrong.bridge.request.bind(wrong.bridge);
 wrong.bridge.request=async(path,...args)=>path==='/api/mesh/status'?{version:1,deviceId:target,fleetId:boot,available:true,peers:[]}:original(path,...args);
 await assert.rejects(acquireMeshLamp({target,candidates:[wrong],acquireBridge:async()=>wrong.lease,options:{timeout:90,pollInterval:1}}),error=>error.noRoute===true);assert.equal(wrong.requests.length,0);assert.equal(wrong.releases(),1);
});
test('cancelled selection never adopts a late bridge and releases its connection',async()=>{
 const f=fixture(),abort=new AbortController();let release;
 const pending=acquireMeshLamp({target,candidates:[f],acquireBridge:()=>new Promise(resolve=>release=()=>resolve(f.lease)),signal:abort.signal,options:{timeout:90}});
 await new Promise(resolve=>setTimeout(resolve,1));abort.abort();await assert.rejects(pending,error=>error.cancelled===true);release();await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.releases(),1);assert.equal(f.requests.length,0);
});
test('selection revision changed after a target read never returns a stale lease',async()=>{
 const f=fixture(),original=f.bridge.request.bind(f.bridge);let current=true;
 f.bridge.request=async(...args)=>{const reply=await original(...args);if(args[0]==='/api/mesh/result')current=false;return reply;};
 await assert.rejects(acquireMeshLamp({target,candidates:[f],acquireBridge:async()=>f.lease,isCurrent:()=>current,options:{timeout:90,pollInterval:1}}),error=>error.cancelled===true);assert.equal(f.releases(),1);
});

test('settings bridge timeout stops searching and releases a late native connection',async()=>{
 const first=fixture(),second=fixture();let finish;const attempts=[];
 await assert.rejects(acquireMeshLamp({target,candidates:[first,second],
  acquireBridge:candidate=>{attempts.push(candidate);return new Promise(resolve=>finish=()=>resolve(candidate.lease));},
  options:{timeout:15,totalTimeout:80,stopOnTimeout:true}}),error=>error.routeTimeout===true);
 assert.equal(attempts.length,1);finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(first.releases(),1);assert.equal(second.requests.length,0);
});

test('settings mesh has one total deadline across bridge acquisition and status',async()=>{
 const f=fixture();let statusStarted,finishStatus;const started=new Promise(resolve=>statusStarted=resolve);
 const original=f.bridge.request.bind(f.bridge);
 f.bridge.request=(path,...args)=>path==='/api/mesh/status'?new Promise(resolve=>{statusStarted();finishStatus=()=>resolve(original(path,...args));}):original(path,...args);
 const before=Date.now(),pending=acquireMeshLamp({target,candidates:[f],
  acquireBridge:async()=>{await new Promise(resolve=>setTimeout(resolve,25));return f.lease;},
  options:{timeout:200,totalTimeout:60,stopOnTimeout:true}});
 await started;await assert.rejects(pending,error=>error.routeTimeout===true);assert(Date.now()-before<150);
 assert.equal(f.releases(),1);finishStatus();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.requests.filter(row=>row.path==='/api/mesh/request').length,0);
});

test('settings mesh deadline includes reading the target snapshot and catalog',async()=>{
 const f=fixture(),original=f.bridge.request.bind(f.bridge);let finish,reading;
 const started=new Promise(resolve=>reading=resolve);
 f.bridge.request=(path,...args)=>path==='/api/mesh/request'?new Promise(resolve=>{reading();finish=()=>resolve(original(path,...args));}):original(path,...args);
 const pending=acquireMeshLamp({target,candidates:[f],acquireBridge:async()=>f.lease,
  options:{timeout:200,totalTimeout:40,stopOnTimeout:true,pollInterval:1}});
 await started;await assert.rejects(pending,error=>error.routeTimeout===true);
 assert.equal(f.releases(),1);finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.writes.length,0);
});
