import test from 'node:test';
import assert from 'node:assert/strict';
import {MeshOnboarding} from '../src/mesh-onboarding.js';
import {MeshTransport} from '../src/mesh.js';

const bridgeId='112233445566',target='aabbccddeeff',broker='123456789abc',fleetId='0123456789abcdef';
const tick=()=>new Promise(resolve=>setTimeout(resolve,1));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(options={}){
 const entries=[{id:bridgeId,address:'http://192.168.1.2',deviceId:'paired-bridge'}],calls=[],statuses=[],inventories=[];
 let sequence=0,releases=0,statusIndex=0;
 const phaseList=['confirm','approved','complete'];
 const inventory={version:1,candidates:[{id:target,name:'New lamp',firmwareVersion:'1.12.0',broker,online:true,claimed:false,key:'SECRET',deviceId:'not-a-pairing'}],key:'SECRET'};
 const bridge={identity:bridgeId,epoch:1,base:'http://192.168.1.2',async request(path,fields,epoch,fence){
  fence?.();calls.push({path,fields});
  if(path==='/api/mesh/new')return inventory;
  const phase=path.endsWith('/start')?'exchange':path.endsWith('/cancel')?'failed':phaseList[Math.min(statusIndex++,phaseList.length-1)];
  return {version:1,target,requestId:fields.requestId,broker:fields.broker,phase,pattern:[1,4,7,12],fleetId,confirmedAbsent:phase==='failed',message:'SECRET',key:'SECRET'};
 }};
 const lease={lamp:bridge,release:async()=>{releases++;}};
 const controller=new MeshOnboarding({getBridges:()=>entries,acquireBridge:async()=>lease,onStatus:value=>statuses.push(value),onCandidates:values=>inventories.push(values),id:()=> (++sequence).toString(16).padStart(16,'0'),timeout:1000,requestTimeout:80,pollInterval:1,...options});
 return {entries,calls,statuses,inventories,inventory,bridge,lease,controller,phaseList,releases:()=>releases};
}
async function ready(f){const result=await f.controller.discover();assert.equal(result.candidates.length,1);return result.candidates[0];}

test('startup discovery is read only and session-only metadata excludes secrets and pairing identifiers',async()=>{
 const f=fixture(),row=await ready(f);
 assert.deepEqual(Object.keys(row),['id','name','firmwareVersion','broker','bridgeId','online','claimed','observedAt']);
 assert.equal(row.id,target);assert.equal(row.bridgeId,bridgeId);assert.equal(row.broker,broker);
 assert(f.calls.every(call=>call.path==='/api/mesh/new'&&call.fields===undefined));assert.equal(f.releases(),1);
 assert(!JSON.stringify(f.inventories).includes('SECRET'));assert(!JSON.stringify(f.inventories).includes('not-a-pairing'));
 assert(Object.isFrozen(row));assert.equal(f.statuses.length,0);
});
test('one explicit start waits through physical color approval and completes only after durable confirmation',async()=>{
 const f=fixture(),row=await ready(f);const result=await f.controller.start(row);
 assert.deepEqual(result,{target,bridgeId,broker,requestId:'0000000000000001',fleetId});
 assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
 assert(f.calls.filter(call=>call.fields).every(call=>Object.keys(call.fields).join(',')==='target,requestId,broker'&&call.fields.broker===broker));
 assert.deepEqual(f.statuses.map(value=>value.phase),['exchange','exchange','confirm','approved','complete']);
 const confirm=f.statuses.find(value=>value.phase==='confirm');assert.deepEqual(confirm.pattern,[1,4,7,12]);assert(Object.isFrozen(confirm.pattern));
 assert(/knob once/.test(confirm.message));assert(!JSON.stringify(f.statuses).includes('SECRET'));assert.equal(f.controller.candidates.size,0);assert.equal(f.releases(),2);
});
test('confirm alone never finishes enrollment or emits a key-install/app-approval command',async()=>{
 const f=fixture();f.phaseList.splice(0,3,'confirm');const row=await ready(f);let finished=false;
 const task=f.controller.start(row).then(()=>{finished=true;},error=>error);
 while(!f.statuses.some(value=>value.phase==='confirm'))await tick();assert.equal(finished,false);
 assert(!f.calls.some(call=>/approve|finish|key/.test(call.path)));const cancel=await f.controller.cancel();assert.equal(cancel.uncertain,false);
 const error=await task;assert(error.cancelled);assert.equal(f.calls.filter(call=>call.path.endsWith('/cancel')).length,1);assert.equal(f.releases(),2);
});
test('a lost Start reply is recovered with the same request ID through status, without replay',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
 f.bridge.request=async(...args)=>{const reply=await original(...args);if(args[0].endsWith('/start'))throw Error('SECRET lost reply');return reply;};
 const result=await f.controller.start(row);assert.equal(result.target,target);assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
 assert.equal(new Set(f.calls.filter(call=>call.fields).map(call=>call.fields.requestId)).size,1);assert(!JSON.stringify(f.statuses).includes('SECRET'));
});
test('wrong target or request ID cannot report successful approval',async()=>{
 for(const patch of [{target:bridgeId},{requestId:'ffffffffffffffff'}]){
  const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
  f.bridge.request=async(...args)=>{const value=await original(...args);return args[0].endsWith('/status')?{...value,...patch}:value;};
  await assert.rejects(f.controller.start(row),error=>error.uncertain===true);
  assert(!f.statuses.some(value=>value.phase==='complete'));assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
 }
});
test('invalid color patterns and completion missing fleet fingerprint fail closed',async()=>{
 for(const patch of [{phase:'confirm',pattern:[1,2,3]},{phase:'confirm',pattern:[1,2,3,16]},{phase:'complete',fleetId:'invalid'}]){
  const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
  f.bridge.request=async(...args)=>{const value=await original(...args);return args[0].endsWith('/status')?{...value,...patch}:value;};
  await assert.rejects(f.controller.start(row),error=>error.uncertain===true);assert(!f.statuses.some(value=>value.phase==='complete'));
 }
});
test('stale candidate, changed broker and replaced bridge locator cannot start another lamp',async()=>{
 const f=fixture(),row=await ready(f);
 await assert.rejects(f.controller.start({...row,broker:bridgeId}),/Refresh/);
 f.entries[0].address='http://192.168.1.3';await assert.rejects(f.controller.start(row));
 assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,0);
 const old=fixture({now:()=>20000}),oldRow=await ready(old);old.controller.now=()=>40000;
 await assert.rejects(old.controller.start(oldRow),/Refresh/);assert.equal(old.calls.length,1);
});
test('fresh inventory changing the broker cannot redirect an explicit setup',async()=>{
 const f=fixture(),row=await ready(f);f.inventory.candidates[0].broker=bridgeId;
 await assert.rejects(f.controller.start(row));assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,0);
});
test('a queued Start checks removal/cancellation again at the actual bridge write',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge),gate=deferred();let waiting=false;
 f.bridge.request=async(...args)=>{if(args[0].endsWith('/start')){waiting=true;await gate.promise;}return original(...args);};
 const task=f.controller.start(row).catch(error=>error);while(!waiting)await tick();
 const cancellation=f.controller.cancel();gate.resolve();await cancellation;const error=await task;
 assert(error.cancelled);assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,0);
});
test('bridge epoch change after Start preserves uncertainty instead of selecting another bridge',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
 f.bridge.request=async(...args)=>{const value=await original(...args);if(args[0].endsWith('/start'))f.bridge.epoch++;return value;};
 await assert.rejects(f.controller.start(row),error=>error.uncertain===true);assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
 assert.equal(f.releases(),2);assert(!f.statuses.some(value=>value.phase==='complete'));
});
test('unconfirmed completion blocks a new claim; protected exact-target fleet readback recovers it',async()=>{
 let verifiedTarget=bridgeId;
 const f=fixture({verifyEnrollment:async()=>({verified:true,target:verifiedTarget,fleetId})}),row=await ready(f),original=f.bridge.request.bind(f.bridge);
 f.bridge.request=async(...args)=>{if(args[0].endsWith('/status'))throw Error('SECRET');return original(...args);};
 await assert.rejects(f.controller.start(row),error=>error.uncertain===true);
 await assert.rejects(f.controller.start(row),error=>error.requiresVerification===true);
 await assert.rejects(f.controller.recover(target),error=>error.uncertain===true);
 verifiedTarget=target;const result=await f.controller.recover(target);assert.equal(result.target,target);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);assert(!f.controller.unconfirmed.has(target));
});
test('same-session status recovery completes a lost result without another Start',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);let fail=true;
 f.bridge.request=async(...args)=>{if(fail&&args[0].endsWith('/status'))throw Error('lost');return original(...args);};
 await assert.rejects(f.controller.start(row));fail=false;f.phaseList.splice(0,3,'complete');const result=await f.controller.recover(target);
 assert.equal(result.requestId,'0000000000000001');assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
});
test('confirmed refusal does not claim success and duplicate active Start is rejected',async()=>{
 const f=fixture(),row=await ready(f);f.phaseList.splice(0,3,'failed');const pending=f.controller.start(row);
 await assert.rejects(f.controller.start(row),/Finish or cancel/);await assert.rejects(pending,error=>error.confirmed===true&&!error.uncertain);
 assert(!f.statuses.some(value=>value.phase==='complete'));assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
});
test('discovery is deduplicated, capped at two concurrent bridges and independently publishes arrivals',async()=>{
 const f=fixture(),gates=[deferred(),deferred(),deferred()];f.entries.push({id:'223344556677'},{id:'334455667788'});let active=0,peak=0;
 f.controller.acquireBridge=async id=>({lamp:{identity:id,epoch:1,base:'ble:'+id,request:async()=>{const index=f.entries.findIndex(entry=>entry.id===id);active++;peak=Math.max(peak,active);await gates[index].promise;active--;return {version:1,candidates:[{id:['aabbccddeeff','bbccddeeff00','ccddeeff0011'][index],broker:id,online:true,claimed:false}]};}},release:async()=>{}});
 const first=f.controller.discover();assert.equal(first,f.controller.discover());while(active<2)await tick();assert.equal(peak,2);
 gates[1].resolve();while(f.inventories.length<1)await tick();assert.equal(f.inventories[0][0].bridgeId,f.entries[1].id);
 gates[0].resolve();gates[2].resolve();const result=await first;assert.equal(result.candidates.length,3);assert.equal(peak,2);
});
test('late connection leases are released after bounded cancellation, with no late Start',async()=>{
 const f=fixture(),row=await ready(f),gate=deferred();let called=false;
 f.controller.acquireBridge=()=>{called=true;return gate.promise;};const pending=f.controller.start(row).catch(error=>error);
 while(!called)await tick();await f.controller.cancel();assert((await pending).cancelled);gate.resolve(f.lease);await tick();
 assert.equal(f.releases(),2);assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,0);
});
test('unsupported or failed bridge cannot prevent discovery from another owned bridge',async()=>{
 const f=fixture();f.entries.push({id:'223344556677'});const original=f.controller.acquireBridge;
 f.controller.acquireBridge=async id=>id===bridgeId?{lamp:{identity:id,epoch:1,base:'ble:'+id,request:async()=>{throw Object.assign(Error('SECRET'),{confirmed:true});}},release:async()=>{}}:original();
 // Match the second authenticated bridge identity before accepting its rows.
 f.bridge.identity=f.entries[1].id;const result=await f.controller.discover();assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].bridgeId,f.entries[1].id);
});
test('disposal cancels discovery and prevents candidate/start publications afterward',async()=>{
 const f=fixture(),gate=deferred();f.bridge.request=()=>gate.promise;
 const pending=f.controller.discover();await tick();await f.controller.dispose();gate.resolve(f.inventory);
 const result=await pending;assert(result.cancelled);assert.equal(f.inventories.length,0);await assert.rejects(f.controller.start({id:target}),error=>error.cancelled===true);
});
test('expired or unknown failed status does not prove absence and cannot allow a new claim',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
 f.bridge.request=async(...args)=>{const reply=await original(...args);return args[0].endsWith('/status')?{...reply,phase:'failed',confirmedAbsent:false,uncertain:true}:reply;};
 await assert.rejects(f.controller.start(row),error=>error.uncertain===true);
 await assert.rejects(f.controller.recover(target),error=>error.uncertain===true);
 await assert.rejects(f.controller.start(row),error=>error.requiresVerification===true);assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
});
test('duplicate cancel sends once and uncertain cancellation retains the unresolved target',async()=>{
 const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);f.phaseList.splice(0,3,'confirm');
 f.bridge.request=async(...args)=>{const reply=await original(...args);return args[0].endsWith('/cancel')?{...reply,confirmedAbsent:false}:reply;};
 const task=f.controller.start(row).catch(error=>error);while(!f.statuses.some(value=>value.phase==='confirm'))await tick();
 const result=await Promise.all([f.controller.cancel(),f.controller.cancel()]);await task;
 assert(result.every(value=>value.uncertain===true));assert.equal(f.calls.filter(call=>call.path.endsWith('/cancel')).length,1);
 await assert.rejects(f.controller.start(row),error=>error.requiresVerification===true);
});
test('a hung bridge is bounded and its queued Start cannot dispatch after the session ends',async()=>{
 const f=fixture({requestTimeout:5}),row=await ready(f),original=f.bridge.request.bind(f.bridge),gate=deferred();
 f.bridge.request=async(...args)=>{if(args[0].endsWith('/start'))await gate.promise;else if(args[0].endsWith('/status'))throw Error('unreachable');return original(...args);};
 const before=Date.now();await assert.rejects(f.controller.start(row),error=>error.uncertain===true);assert(Date.now()-before<500);
 gate.resolve();await tick();assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,0);assert.equal(f.releases(),2);
});
test('completion is not undone by a simultaneous UI cancel after confirmed durable trust',async()=>{
 const f=fixture(),row=await ready(f);let cancellation;
 f.controller.onStatus=value=>{f.statuses.push(value);if(value.phase==='complete')cancellation=f.controller.cancel();};
 await f.controller.start(row);assert.deepEqual(await cancellation,{cancelled:false,complete:true,uncertain:false});
 assert.equal(f.calls.filter(call=>call.path.endsWith('/cancel')).length,0);
});
test('missing or different broker never confirms another enrollment session',async()=>{
 for(const value of [undefined,bridgeId]){
  const f=fixture(),row=await ready(f),original=f.bridge.request.bind(f.bridge);
  f.bridge.request=async(...args)=>{const reply=await original(...args);return args[0].endsWith('/status')?{...reply,broker:value}:reply;};
  await assert.rejects(f.controller.start(row),error=>error.uncertain===true);assert(!f.statuses.some(status=>status.phase==='complete'));
  assert.equal(f.calls.filter(call=>call.path.endsWith('/start')).length,1);
 }
});
test('production remote broker transport fences a queued Start when onboarding is canceled',async()=>{
 const f=fixture(),gate=deferred(),transactions=new Map();let sequence=20,queued=false,startWrites=0;
 const brokerState={deviceId:broker,hostname:'coollamp-broker.local',name:'Broker',power:true,mode:1,brightness:100,leds:67,effects:['Rain'],catalogVersion:1,firmware:{version:'1.13.0'},sync:{version:2,role:0}};
 const downstream={identity:bridgeId,epoch:1,control:{capabilities:['mesh-control']},async request(path,fields,epoch,fence){
  if(path==='/api/mesh/request'){
   if(fields.endpoint===37){queued=true;await gate.promise;}fence?.();let response='';
   if(fields.endpoint===1)response=JSON.stringify(brokerState);
   else if(fields.endpoint===26)response=JSON.stringify([{id:1,name:'Rain',category:'calm',speed:true}]);
   else if(fields.endpoint===36)response=JSON.stringify(f.inventory);
   else{const form=new URLSearchParams(fields.body);if(fields.endpoint===37)startWrites++;response=JSON.stringify({version:1,target,broker,requestId:form.get('requestId'),phase:fields.endpoint===39?'failed':'exchange',confirmedAbsent:fields.endpoint===39});}
   transactions.set(fields.requestId,response);return {version:1,target:broker,requestId:fields.requestId,status:'pending',executed:false};
  }
  const bytes=new TextEncoder().encode(transactions.get(fields.requestId)),page=bytes.slice(fields.offset,fields.offset+256);
  return {version:1,target:broker,requestId:fields.requestId,targetBoot:fleetId,status:'ok',executed:true,httpStatus:200,total:bytes.length,offset:fields.offset,data:btoa(String.fromCharCode(...page))};
 }};
 const remote=new MeshTransport({timeout:400,pollInterval:1,id:()=> (++sequence).toString(16).padStart(16,'0')});
 await remote.connect(broker,{lamp:downstream,release:async()=>{}},{poll:false});
 f.entries.splice(0,1,{id:broker,meshBridgeId:bridgeId});f.controller.acquireBridge=async()=>({lamp:remote,release:async()=>{}});
 const row=await ready(f),pending=f.controller.start(row).catch(error=>error);while(!queued)await tick();
 await f.controller.cancel();await pending;gate.resolve();await tick();assert.equal(startWrites,0);await remote.disconnect();
});
