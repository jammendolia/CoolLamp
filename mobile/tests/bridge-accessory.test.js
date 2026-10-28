import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {BridgeAccessoryStore,BRIDGE_MODEL,BRIDGE_SETUP_MESSAGE,bridgeDescriptor,identifyEnrolledBridge} from '../src/bridge-accessory.js';

const target='aabbccddeeff',bridgeId='112233445566',brokerId='123456789abc';
const requestId='0102030405060708',fleetId='1111111111111111',targetBoot='2222222222222222',brokerBoot='3333333333333333';
// The firmware independently creates commission advert/session nonces and mesh
// session nonces. Identical fake values concealed the original integration bug.
const targetMeshBoot='4444444444444444',brokerMeshBoot='5555555555555555';
const result={target,bridgeId,broker:brokerId,requestId,fleetId};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const storage=()=>{const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};
function fixture(){
  const memory=storage(),accessories=new BridgeAccessoryStore(memory),calls=[];
  const descriptor={deviceId:target,role:'bridge',model:{id:BRIDGE_MODEL},name:'CoolLamp Bridge',firmwareVersion:'0.1.0',
    capabilities:['mesh-control','trusted-cached-donation'],key:'SECRET',password:'SECRET'};
  let releases=0,acquires=0,sequence=0,statusReads=0,meshReads=0;
  const f={memory,accessories,calls,descriptor,result:{...result},controller:new AbortController(),statusPatch:{},replyPatch:{},httpStatus:200,
    meshPatch:{},peerPatch:{}};
  const page=offset=>{
    const bytes=new TextEncoder().encode(JSON.stringify(f.descriptor));
    return {version:1,target,requestId:f.meshRequestId,status:'ok',executed:true,targetBoot:targetMeshBoot,httpStatus:f.httpStatus,
      total:bytes.length,offset,data:Buffer.from(bytes.subarray(offset,offset+256)).toString('base64'),...f.replyPatch};
  };
  const broker={identity:bridgeId,epoch:7,base:'ble:known-broker',request:async(path,fields,epoch,beforeWrite,readGuard)=>{
    beforeWrite?.();readGuard?.();assert.equal(epoch,broker.epoch);calls.push({path,fields});
    if(path==='/api/mesh/enroll/status'){
      statusReads++;return {version:1,phase:'complete',target,requestId,broker:brokerId,fleetId,targetBoot,brokerBoot,...f.statusPatch};
    }
    if(path==='/api/mesh/status'){
      meshReads++;const value={version:1,deviceId:bridgeId,fleetId,available:true,boot:brokerMeshBoot,
        peers:[{id:target,online:true,boot:targetMeshBoot,hops:1,...f.peerPatch}],...f.meshPatch};
      return f.meshRead?f.meshRead(value,meshReads):value;
    }
    if(path==='/api/mesh/request'){
      assert.equal(fields.target,target);assert.equal(fields.endpoint,40);assert.equal(fields.method,1);assert.equal(fields.body,'');
      assert.notEqual(fields.requestId,requestId);f.meshRequestId=fields.requestId;
      if(f.gate)await f.gate.promise;f.afterRequest?.();return page(0);
    }
    if(path==='/api/mesh/result')return page(fields.offset);
    throw Error('Unexpected request '+path);
  }};
  f.broker=broker;f.acquireBridge=async(id,options)=>{acquires++;assert.equal(id,bridgeId);assert.equal(options.signal,f.controller.signal);return {lamp:broker,release:async()=>{releases++;}};};
  f.run=options=>identifyEnrolledBridge({result:f.result,acquireBridge:f.acquireBridge,accessories,signal:f.controller.signal,
    isCurrent:()=>f.current!==false,now:()=>123456,id:()=> (++sequence).toString(16).padStart(16,'0'),...options});
  f.counts=()=>({releases,acquires,statusReads,meshReads});return f;
}

test('physically enrolled bridge is identified over the original broker without any lamp reads or new enrollment',async()=>{
  const f=fixture(),record=await f.run();
  assert.deepEqual(record,{id:target,role:'bridge',modelId:BRIDGE_MODEL,name:'CoolLamp Bridge',firmwareVersion:'0.1.0',
    capabilities:['mesh-control','trusted-cached-donation'],meshBridgeId:bridgeId,fleetId,verifiedAt:123456});
  assert.equal(f.accessories.has(target),true);assert.deepEqual(f.counts(),{releases:1,acquires:1,statusReads:2,meshReads:2});
  assert(f.calls.every(call=>['/api/mesh/enroll/status','/api/mesh/status','/api/mesh/request','/api/mesh/result'].includes(call.path)));
  const text=f.memory.getItem('coollamp-bridges-v1');assert(!text.includes('SECRET'));assert(!text.includes('targetBoot'));assert(!text.includes('requestId'));
});

test('ordinary lamp and unsupported legacy descriptor continue normal lamp setup without accessory records',async()=>{
  for(const mode of ['lamp','legacy']){
    const f=fixture();f.descriptor=mode==='lamp'?{deviceId:target,model:{id:'coollamp.esp32-c3'},name:'Lamp'}:{error:'Unsupported'};
    if(mode==='legacy')f.httpStatus=404;
    assert.equal(await f.run(),null);assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
  }
});

test('wrong enrollment target, original request, broker, fleet or missing boot cannot classify a device',async()=>{
  for(const patch of [{target:bridgeId},{requestId:'9999999999999999'},{broker:bridgeId},{fleetId:'9999999999999999'},
    {phase:'approved'},{targetBoot:null},{brokerBoot:null}]){
    const f=fixture();f.statusPatch=patch;await assert.rejects(f.run(),error=>error.uncertain===true);
    assert(!f.calls.some(call=>call.path==='/api/mesh/request'));assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
  }
});

test('descriptor pages bind the target, fresh request and authenticated mesh boot',async()=>{
  for(const patch of [{target:bridgeId},{requestId:'9999999999999999'},{targetBoot:'9999999999999999'},
    {executed:false},{offset:1},{total:9000},{uncertain:true}]){
    const f=fixture();f.replyPatch=patch;await assert.rejects(f.run());assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
  }
});

test('distinct commissioning exchange and mesh session nonces classify a real bridge correctly',async()=>{
  assert.notEqual(targetBoot,targetMeshBoot);assert.notEqual(brokerBoot,brokerMeshBoot);
  const f=fixture();assert.equal((await f.run()).id,target);assert.equal(f.counts().statusReads,2);assert.equal(f.counts().meshReads,2);
  const incorrect=fixture();incorrect.replyPatch={targetBoot};await assert.rejects(incorrect.run(),error=>error.targetRestarted===true);
  assert.equal(incorrect.accessories.items.length,0);
});

test('wrong fleet, broker identity or malformed mesh presence fail immediately without a descriptor request',async()=>{
  for(const [where,patch] of [['meshPatch',{fleetId:'9999999999999999'}],['meshPatch',{deviceId:brokerId}],
    ['meshPatch',{available:null}],['meshPatch',{boot:null}],['meshPatch',{peers:null}],
    ['peerPatch',{online:null}],['peerPatch',{boot:null}],['peerPatch',{hops:5}]]){
    const f=fixture();f[where]=patch;await assert.rejects(f.run(),error=>error.uncertain===true);
    assert(!f.calls.some(call=>call.path==='/api/mesh/request'));assert.equal(f.accessories.items.length,0);
    assert.equal(f.counts().meshReads,1);assert.equal(f.counts().releases,1);
  }
});

test('delayed radio availability and target live challenge use fresh reads before bridge classification',async()=>{
  const f=fixture();f.meshRead=(value,index)=>index===1?{...value,available:false,peers:[]}:
    index===2?{...value,peers:[]}:index===3?{...value,peers:[{...value.peers[0],online:false}]}:value;
  assert.equal((await f.run({now:Date.now,timeout:2000})).id,target);
  const paths=f.calls.map(call=>call.path),descriptorIndex=paths.indexOf('/api/mesh/request');
  assert.equal(paths.slice(0,descriptorIndex).filter(path=>path==='/api/mesh/status').length,4);
  assert.equal(f.counts().meshReads,5);assert.equal(f.counts().acquires,1);assert.equal(f.counts().releases,1);
  assert(!f.calls.some(call=>/enroll\/(start|cancel)/.test(call.path)));
});

test('old lamp descriptor fallback waits for real same-fleet online target proof',async()=>{
  const f=fixture();f.httpStatus=404;f.descriptor={error:'Unsupported descriptor'};
  f.meshRead=(value,index)=>index===1?{...value,available:false,peers:[]}:value;
  assert.equal(await f.run({now:Date.now,timeout:1000}),null);
  const paths=f.calls.map(call=>call.path);assert.equal(paths.filter(path=>path==='/api/mesh/status').length,2);
  assert(paths.indexOf('/api/mesh/request')>paths.lastIndexOf('/api/mesh/status'));assert.equal(f.accessories.items.length,0);
});

test('no fresh ready presence is bounded by the original deadline, including old lamp fallback',async()=>{
  for(const change of [value=>({...value,available:false}),value=>({...value,peers:[]}),
    value=>({...value,peers:[{...value.peers[0],online:false}]})]){
    const f=fixture();f.httpStatus=404;f.meshRead=change;const started=Date.now();
    await assert.rejects(f.run({now:Date.now,timeout:25}),error=>error.uncertain===true);
    assert(Date.now()-started<1000);assert(!f.calls.some(call=>call.path==='/api/mesh/request'));
    assert.equal(f.counts().acquires,1);assert.equal(f.counts().releases,1);assert.equal(f.accessories.items.length,0);
  }
});

test('identity, fleet or broker mesh boot changes while awaiting presence fail on the first changed read',async()=>{
  for(const patch of [{deviceId:brokerId},{fleetId:'9999999999999999'},{boot:'9999999999999999'}]){
    const f=fixture();f.meshRead=(value,index)=>index===1?{...value,peers:[]}:{...value,...patch};
    await assert.rejects(f.run({now:Date.now,timeout:1000}),error=>error.uncertain===true);
    assert.equal(f.counts().meshReads,2);assert(!f.calls.some(call=>call.path==='/api/mesh/request'));assert.equal(f.counts().releases,1);
  }
});

test('canceling while waiting for mesh readiness prevents fresh reads and descriptor work',async()=>{
  const f=fixture();f.meshRead=value=>{f.controller.abort();return {...value,peers:[]};};
  await assert.rejects(f.run(),error=>error.cancelled===true);assert.equal(f.counts().meshReads,1);
  assert(!f.calls.some(call=>call.path==='/api/mesh/request'));assert.equal(f.counts().releases,1);
});

test('a changed target or broker mesh session after descriptor read cannot persist a bridge',async()=>{
  for(const change of [f=>{f.peerPatch={boot:'9999999999999999'};},f=>{f.meshPatch={boot:'9999999999999999'};},
    f=>{f.meshPatch={fleetId:'9999999999999999'};},f=>{f.peerPatch={online:false};}]){
    const f=fixture();f.afterRequest=()=>change(f);await assert.rejects(f.run(),error=>error.uncertain===true);
    assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
  }
});

test('broker or target reboot after descriptor read cannot persist a bridge',async()=>{
  for(const field of ['brokerBoot','targetBoot']){
    const f=fixture();f.afterRequest=()=>{f.statusPatch={[field]:'9999999999999999'};};
    await assert.rejects(f.run(),error=>error.uncertain===true);assert.equal(f.accessories.items.length,0);
  }
});

test('wrong device identity, false model, light fields, unknown role and missing capabilities fail closed',async()=>{
  for(const patch of [{deviceId:bridgeId},{model:{id:'coollamp.lamp'}},{power:false},{effects:[]},{role:'accessory'},{capabilities:['mesh-control']}]){
    const f=fixture();Object.assign(f.descriptor,patch);await assert.rejects(f.run());assert.equal(f.accessories.items.length,0);
  }
});

test('navigation, cancellation or broker connection change during descriptor work rejects the late reply',async()=>{
  for(const change of [f=>{f.current=false;},f=>f.controller.abort(),f=>{f.broker.epoch++;},f=>{f.broker.identity=target;},f=>{f.broker.base='other';}]){
    const f=fixture();f.afterRequest=()=>change(f);await assert.rejects(f.run(),error=>error.cancelled===true);
    assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
  }
});

test('late original-broker acquisition is released after cancellation without sending any request',async()=>{
  const f=fixture(),gate=deferred();let release=0;f.acquireBridge=()=>gate.promise;
  const pending=f.run();await Promise.resolve();f.controller.abort();await assert.rejects(pending,error=>error.cancelled===true);
  gate.resolve({lamp:f.broker,release:async()=>{release++;}});await new Promise(done=>setTimeout(done,0));
  assert.equal(release,1);assert.equal(f.calls.length,0);assert.equal(f.accessories.items.length,0);
});

test('accessory records stay bounded and reload only sanitized nonsecret metadata',()=>{
  const memory=storage(),store=new BridgeAccessoryStore(memory);
  for(let index=1;index<=8;++index){const id=index.toString(16).padStart(12,'0');
    store.remember(bridgeDescriptor({deviceId:id,role:'bridge',model:{id:BRIDGE_MODEL},name:'Bridge\u0000',firmwareVersion:'0.1.0',
      capabilities:['mesh-control','trusted-cached-donation'],token:'SECRET'},id),{bridgeId,verifiedAt:index});}
  assert.equal(store.items.length,8);assert.equal(store.has('000000000001'),true);
  const values=JSON.parse(memory.getItem('coollamp-bridges-v1'));values[0].password='SECRET';values.push({id:target,role:'lamp'});
  memory.setItem('coollamp-bridges-v1',JSON.stringify(values));const reloaded=new BridgeAccessoryStore(memory);
  assert.equal(reloaded.items.length,8);assert(reloaded.has('000000000001'));
  assert(reloaded.items.every(value=>value.role==='bridge'&&value.name==='Bridge'));assert(!JSON.stringify(reloaded.items).includes('SECRET'));
});

test('storage failure never falls back to adding a bridge as a lamp',async()=>{
  const f=fixture();f.memory.setItem=()=>{throw Error('Storage unavailable');};
  await assert.rejects(f.run(),/Storage unavailable/);assert.equal(f.accessories.items.length,0);assert.equal(f.counts().releases,1);
});

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const prepare=source.slice(source.indexOf('async function prepareMeshWizard('),source.indexOf('\nasync function beginMeshSetup('));
const merge=source.slice(source.indexOf('function mergedLampEntries('),source.indexOf('\nfunction fleetLampInstalling('));
function handlerFixture(identify){
  const elements=new Map(),calls=[],task={candidate:{id:target},abort:new AbortController()};
  const context={task,result,AbortController,identifyEnrolledBridge:identify,BRIDGE_SETUP_MESSAGE,
    bridgeAccessories:{has:id=>id===target},acquireOnboardingBridge:()=>{},
    createMeshLampLease:async()=>{calls.push('lamp-acquisition');throw Error('Normal lamp path reached');},
    meshInventory:{items:[{id:target},{id:bridgeId}],forget:id=>calls.push('mesh-forget:'+id)},
    discovery:{forgotten:new Set(),forget:id=>calls.push('discovery-forget:'+id)},
    store:{items:[]},discovered:[{id:target},{id:brokerId}],
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},renderLamps:()=>calls.push('render')};
  runInNewContext('let meshWizard=task;'+prepare+merge+';globalThis.run=()=>prepareMeshWizard(task,result);globalThis.merged=()=>mergedLampEntries();',context);
  return {...context,elements,calls};
}

test('actual onboarding handler displays bridge setup and never acquires lamp effects or opens lamp settings',async()=>{
  const f=handlerFixture(async()=>({id:target,role:'bridge'}));await f.run();
  assert(!f.calls.includes('lamp-acquisition'));assert.equal(f.elements.get('meshSetupForm').hidden,true);
  assert.equal(f.elements.get('meshSetupStatus').textContent,BRIDGE_SETUP_MESSAGE);assert.equal(f.task.accessory.id,target);
  assert.deepEqual([...f.merged()].map(value=>value.id),[bridgeId,brokerId]);
});

test('actual onboarding handler continues its existing lamp path after a normal descriptor',async()=>{
  const f=handlerFixture(async()=>null);await assert.rejects(f.run(),/Normal lamp path reached/);
  assert.deepEqual(f.calls,['lamp-acquisition']);
});

test('actual onboarding handler rejects unconfirmed classification and navigation without acquiring a lamp',async()=>{
  const failed=handlerFixture(async()=>{throw Error('Descriptor not confirmed');});await assert.rejects(failed.run(),/Descriptor not confirmed/);
  assert.equal(failed.calls.length,0);
  const cancelled=handlerFixture(async()=>{cancelled.task.abort.abort();return {id:target,role:'bridge'};});await cancelled.run();
  assert.equal(cancelled.calls.length,0);assert.equal(cancelled.task.accessory,undefined);
});
