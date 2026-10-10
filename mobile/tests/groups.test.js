import test from 'node:test';
import assert from 'node:assert/strict';
import { Groups, groupCreationPlan } from '../src/groups.js';
import { parseGroupCode } from '../src/sync.js';

const ids=['aabbccddeeff','112233445566','223344556677','334455667788','445566778899','5566778899aa'];
const key='0123456789abcdef0123456789abcdef';
const groupIncarnation=id=>id+id+'12345678';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({scanTimeout=45000,removalPersistence={}}={}) {
  let entries=ids.map((id,index)=>({id,name:'Lamp '+index,address:'192.168.1.'+(40+index),deviceId:'saved-'+index}));
  const models=new Map(ids.map((id,index)=>[id,{deviceId:id,name:'Lamp '+index,token:'private-token-'+index,
    leds:205,midpoint:102,brightness:55,mode:4,power:true,firmware:{version:'1.10.0',phase:0},audio:{installed:true,gain:8,gate:8,scale:100,liveTuning:true},
    sync:{version:2,role:index===0||index===2?1:index===1?2:0,leader:index===0?id:index===1?ids[0]:index===2?id:'',members:0,
      sceneCount:32,scene:0,sceneSpeed:60,sceneIntensity:85,scenePrimary:[70,220,255],sceneSecondary:[255,65,170],active:false,paused:false,transport:'esp-now',
      order:index===0||index===2?[{id,name:'Lamp '+index,online:true}]:[],peers:[],key,code:'CL1-'+id+'-'+key},adminPassword:'private-access-password'}]));
  const hooks=new Map(),calls=[],leases=[],changes=[];
  let active=0,peak=0,selected=ids[0],discover=async()=>[];
  const factory=async(id,options)=>{
    const hook=hooks.get(id)||{};
    if(hook.acquireError)throw hook.acquireError;
    active++;peak=Math.max(peak,active);
    if(hook.acquireDelay)await hook.acquireDelay;
    const model=models.get(id);assert(model,'Only mocked lamps may be acquired.');
    const lamp={identity:id,epoch:7,base:(id===ids[4]?'ble:':'http:')+id,raw:structuredClone(model),refreshCount:0,tail:Promise.resolve(),
      enqueue(action){const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;},
      async refresh(expected){calls.push({id,op:'read'});this.refreshCount++;assert.equal(expected,id);
        if(hook.beforeRead)await hook.beforeRead(this,model,this.refreshCount);
        if(hook.readError)throw hook.readError;
        this.raw=structuredClone(model);
        if(hook.afterRead)await hook.afterRead(this,model,this.refreshCount);
        return this.raw;
      },
      async syncInvite(){calls.push({id,op:'invite'});if(hook.invite)await hook.invite(this,model);return (model.sync.version===3?'CL3-':'CL1-')+id+'-'+key;},
      async configureSync(role,code,expectedIncarnation=''){calls.push({id,op:'sync',role,expectedIncarnation});if(hook.beforeSync)await hook.beforeSync(this,model,role);
        if(expectedIncarnation&&expectedIncarnation!==model.sync.incarnation)throw Object.assign(Error('Group incarnation changed'),{groupPublic:true,stale:true});
        const fields=role?parseGroupCode(code):{};
        if(fields.protocol===3){model.sync.version=3;model.sync.maxMembers=32;}
        model.sync.role=role;model.sync.leader=role?fields.leader:'';model.sync.active=false;model.sync.paused=false;
        if(role===1)model.sync.order=[{id,name:model.name,online:true}];
        this.raw=structuredClone(model);
        if(hook.afterSync)await hook.afterSync(this,model,role);
        return 'Saved';
      },
      async configureGroupScene(value){calls.push({id,op:'scene',value});model.sync.scene=value.scene;model.sync.sceneSpeed=value.speed;this.raw=structuredClone(model);},
      async configureGroupOrder(order){calls.push({id,op:'order',order});model.sync.order=order.map(id=>({id,online:true}));this.raw=structuredClone(model);},
      async syncAction(action){calls.push({id,op:action});model.sync.paused=action==='pause';this.raw=structuredClone(model);},
      async request(path,data){calls.push({id,op:'request',path,data});
        if(path==='/api/group/remove'){
          if(hook.beforePrune)await hook.beforePrune(this,model,data);
          assert.equal(data.order,model.sync.order.map(row=>row.id).join(','));assert.equal(data.session,model.sync.session);
          model.sync.order=model.sync.order.filter(row=>row.id!==data.target);model.sync.session=(BigInt('0x'+model.sync.session)+1n).toString(16).padStart(16,'0');
          if(hook.afterPrune)await hook.afterPrune(this,model,data);
        }else Object.assign(model.audio,data);
        this.raw=structuredClone(model);return 'Saved';}
    };
    const lease={id,lamp,borrowed:id===selected,released:false,entry:structuredClone(options.entry)};leases.push(lease);
    return {lamp,release:async()=>{assert.equal(lease.released,false);lease.released=true;active--;}};
  };
  const createGroups=()=>new Groups({getLamps:()=>entries,discover:()=>discover(),acquire:factory,onStatus:value=>changes.push(value),now:()=>1234,scanTimeout,
    random:{getRandomValues(bytes){bytes.fill(42);return bytes;}},...removalPersistence});
  const groups=createGroups();
  return {groups,models,hooks,calls,leases,changes,setEntries:value=>{entries=value;},entries:()=>entries,setDiscover:value=>{discover=value;},
    selected:()=>selected,peak:()=>peak,active:()=>active,restart:createGroups};
}
const writes=f=>f.calls.filter(call=>!['read','invite'].includes(call.op));
function expanded(f,members=[ids[0],ids[1]]){
  const leader=f.models.get(members[0]);Object.assign(leader.sync,{version:3,maxMembers:32,protocolVersions:[2,3],dissolutionV1:true,incarnation:groupIncarnation(members[0]),session:'0000000000000001',order:members.map(id=>({id,online:true}))});
  for(const id of members.slice(1))Object.assign(f.models.get(id).sync,{version:3,maxMembers:32,protocolVersions:[2,3],role:2,leader:members[0],dissolutionV1:true,incarnation:groupIncarnation(members[0])});
}
function removalStorage(initial=null){
  let value=initial,writes=0,fail=false;
  return {callbacks:{loadRemovalIntents:()=>structuredClone(value),saveRemovalIntents:next=>{if(fail)throw Error('storage full');value=structuredClone(next);++writes;}},
    read:()=>structuredClone(value),writes:()=>writes,setFailure:value=>{fail=value;}};
}

test('durable dissolution survives app restart with offline positions and never repeats confirmed departures',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f,[ids[0],ids[1],ids[3]]);
  f.hooks.set(ids[1],{readError:Error('offline')});assert.equal((await f.groups.dissolve(ids[0])).phase,'dissolution-pending');
  assert.deepEqual(storage.read(),{version:2,sources:[{source:ids[0],targets:[ids[1]],dissolve:true,incarnation:groupIncarnation(ids[0])}]});
  const restarted=f.restart();await restarted.refresh();const group=restarted.snapshot().groups.find(row=>row.id===ids[0]);
  assert.equal(group.removalPending,true);assert.equal(group.dissolutionPending,true);assert.equal(restarted.snapshot().removalIntentStorage,'ready');
  const before=writes(f).length;await restarted.refresh();assert.equal(writes(f).length,before); // Reconnect only reads.
  f.hooks.delete(ids[1]);assert.equal((await restarted.reconcileRemovals(ids[0])).phase,'dissolved');
  assert.equal(writes(f).filter(call=>call.op==='sync'&&call.id===ids[3]).length,1);
  assert.deepEqual(storage.read(),{version:2,sources:[]});
  const persisted=JSON.stringify(storage.read());assert(!persisted.includes(key));assert(!persisted.includes('private-'));
});
test('last-follower move keeps durable source cleanup pending across restart and failed destination',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);f.models.get(ids[2]).sync.protocolVersions=[2,3];
  f.hooks.set(ids[0],{acquireError:Error('source offline')});
  f.hooks.set(ids[1],{beforeSync:(_,__,role)=>{if(role===2)throw Object.assign(Error('lost join'),{uncertain:true});}});
  await assert.rejects(f.groups.move(ids[1],ids[2]),error=>error.leftPrevious&&error.sourceCleanup.pending);
  assert.deepEqual(storage.read(),{version:2,sources:[{source:ids[0],targets:[ids[1]],dissolve:false,incarnation:groupIncarnation(ids[0])}]});
  const restarted=f.restart();await restarted.refresh();assert(restarted.snapshot().groups.find(row=>row.id===ids[0]).removalPending);
  f.hooks.delete(ids[0]);const result=await restarted.reconcileRemovals(ids[0]);assert.equal(result.phase,'removal-reconciled');
  assert.equal(f.models.get(ids[0]).sync.role,0);assert.equal(f.models.get(ids[1]).sync.role,0);
  assert.equal(writes(f).filter(call=>call.op==='sync'&&call.id===ids[1]&&call.role===0).length,1);assert.deepEqual(storage.read(),{version:2,sources:[]});
});
test('unconfirmed departure after app restart is read-only and remains durably pending',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  f.hooks.set(ids[1],{beforeSync:()=>{throw Object.assign(Error('lost before execution'),{uncertain:true});}});
  await assert.rejects(f.groups.leave(ids[1]));const restarted=f.restart(),before=writes(f).length;
  const result=await restarted.reconcileRemovals(ids[0]);assert.equal(result.phase,'removal-pending');assert.equal(writes(f).length,before);
  assert.equal(f.models.get(ids[0]).sync.order.length,2);assert.equal(storage.read().sources.length,1);
});
test('removal intent write failure prevents mutation and post-prune storage failure preserves pending until reconciliation',async()=>{
  for(const action of ['leave','dissolve','move']){
    const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);f.models.get(ids[2]).sync.protocolVersions=[2,3];storage.setFailure(true);
    await assert.rejects(action==='dissolve'?f.groups.dissolve(ids[0]):action==='move'?f.groups.move(ids[1],ids[2]):f.groups.leave(ids[1]),error=>error.storageFailed===true);
    assert.equal(writes(f).length,0);assert.equal(storage.read(),null);
  }
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  f.hooks.set(ids[0],{afterPrune:()=>storage.setFailure(true)});
  const result=await f.groups.dissolve(ids[0]);assert.equal(result.phase,'dissolution-pending');assert.equal(result.pending[0].storageFailed,true);
  assert.equal(f.models.get(ids[0]).sync.role,1);assert.deepEqual(storage.read().sources[0].targets,[ids[1]]);
  f.hooks.delete(ids[0]);storage.setFailure(false);const restarted=f.restart();assert.equal((await restarted.reconcileRemovals(ids[0])).phase,'dissolved');
  assert.equal(writes(f).filter(call=>call.path==='/api/group/remove').length,1);
});
test('lost final phone storage write reconciles an already independent coordinator without replay',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  f.hooks.set(ids[0],{afterSync:()=>storage.setFailure(true)});
  await assert.rejects(f.groups.dissolve(ids[0]),error=>error.storageFailed);
  assert.equal(f.models.get(ids[0]).sync.role,0);assert.equal(storage.read().sources[0].dissolve,true);assert.deepEqual(storage.read().sources[0].targets,[]);
  storage.setFailure(false);const restarted=f.restart();assert.equal((await restarted.reconcileRemovals(ids[0])).phase,'dissolved');
  assert.equal(writes(f).filter(call=>call.op==='sync'&&call.id===ids[0]).length,1);
});
test('an already stopped coordinator cannot erase pending unreachable follower confirmation',async()=>{
  const storage=removalStorage({version:2,sources:[{source:ids[0],targets:[ids[1]],dissolve:true,incarnation:groupIncarnation(ids[0])}]}),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  Object.assign(f.models.get(ids[0]).sync,{role:0,leader:''});f.hooks.set(ids[1],{readError:Error('offline')});
  assert.equal((await f.groups.reconcileRemovals(ids[0])).phase,'dissolution-pending');assert.equal(storage.read().sources.length,1);assert.equal(writes(f).length,0);
  f.hooks.delete(ids[1]);assert.equal((await f.groups.reconcileRemovals(ids[0])).phase,'dissolved');assert.equal(f.models.get(ids[1]).sync.role,0);assert.equal(writes(f).filter(call=>call.id===ids[0]).length,0);
});
test('persisted dissolution cannot act on a recreated group and explicit reconfirmation pins the reviewed incarnation',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);f.hooks.set(ids[1],{readError:Error('offline')});
  assert.equal((await f.groups.dissolve(ids[0])).phase,'dissolution-pending');const retained=storage.read(),next='f'.repeat(32);
  Object.assign(f.models.get(ids[0]).sync,{incarnation:next,order:[{id:ids[0],online:true},{id:ids[3],online:true}]});
  Object.assign(f.models.get(ids[3]).sync,{version:3,maxMembers:32,role:2,leader:ids[0],incarnation:next});
  const restarted=f.restart(),before=writes(f).length;await restarted.refresh();assert(restarted.snapshot().groups.find(row=>row.id===ids[0]).removalNeedsReconfirmation);
  await assert.rejects(restarted.reconcileRemovals(ids[0]),error=>error.needsReconfirmation);assert.equal(writes(f).length,before);assert.deepEqual(storage.read(),retained);
  for(const expectedIncarnation of [undefined,groupIncarnation(ids[0])])await assert.rejects(restarted.dissolve(ids[0],{reconfirm:true,expectedIncarnation}),error=>error.needsReconfirmation);
  assert.equal(writes(f).length,before);
  const result=await restarted.dissolve(ids[0],{reconfirm:true,expectedIncarnation:next});assert.equal(result.phase,'dissolution-pending');assert.equal(f.models.get(ids[3]).sync.role,0);
  assert.equal(f.models.get(ids[0]).sync.role,1);assert(storage.read().sources[0].targets.includes(ids[1])); // Old unreachable intent is not evicted.
  f.hooks.delete(ids[1]);assert.equal((await restarted.leave(ids[1])).phase,'left'); // Explicit fresh target action can resolve the old incarnation.
  assert.equal((await restarted.reconcileRemovals(ids[0])).phase,'dissolved');
});
test('legacy removal intent migrates as unknown and cannot mutate a current group without new reviewed approval',async()=>{
  const legacy={version:1,sources:[{source:ids[0],targets:[ids[1]],dissolve:true}]},storage=removalStorage(legacy),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  await assert.rejects(f.groups.reconcileRemovals(ids[0]),error=>error.needsReconfirmation);assert.equal(writes(f).length,0);assert.deepEqual(storage.read(),legacy);
  assert.equal((await f.groups.dissolve(ids[0],{reconfirm:true,expectedIncarnation:groupIncarnation(ids[0])})).phase,'dissolved');assert.deepEqual(storage.read(),{version:2,sources:[]});
});
test('dissolution recovery never authorizes a concurrently added member until a reviewed reconfirmation',async()=>{
  const storage=removalStorage(),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  f.hooks.set(ids[0],{afterPrune:(_,model)=>{model.sync.order.push({id:ids[3],online:true});Object.assign(f.models.get(ids[3]).sync,{version:3,maxMembers:32,role:2,leader:ids[0],incarnation:groupIncarnation(ids[0])});}});
  assert.equal((await f.groups.dissolve(ids[0])).phase,'dissolution-pending');assert.deepEqual(storage.read().sources[0].targets,[]);
  f.hooks.delete(ids[0]);const restarted=f.restart(),before=writes(f).length;
  const pending=await restarted.reconcileRemovals(ids[0]);assert.equal(pending.pending[0].needsReconfirmation,true);assert.equal(writes(f).length,before);assert.equal(f.models.get(ids[3]).sync.role,2);
  assert.equal((await restarted.dissolve(ids[0],{reconfirm:true,expectedIncarnation:groupIncarnation(ids[0])})).phase,'dissolved');
});
test('execution fence rejects target/coordinator recreation after the final read before departure command',async()=>{
  for(const coordinator of [false,true]){
    const f=fixture();expanded(f,coordinator?[ids[0]]:[ids[0],ids[1]]);const target=coordinator?ids[0]:ids[1],next='d'.repeat(32);
    f.hooks.set(target,{beforeSync:(_,model)=>{model.sync.incarnation=next;}});
    const result=await f.groups.dissolve(ids[0]).catch(error=>error);
    assert.equal(f.models.get(target).sync.role,coordinator?1:2);assert.equal(f.models.get(target).sync.incarnation,next);
    assert.equal(writes(f).filter(call=>call.path==='/api/group/remove').length,0);
    assert(writes(f).every(call=>call.op!=='sync'||call.expectedIncarnation===groupIncarnation(ids[0])));
    assert(coordinator?result.stale:result.phase==='dissolution-pending');
  }
  const moved=fixture();expanded(moved);moved.models.get(ids[2]).sync.protocolVersions=[2,3];moved.hooks.set(ids[1],{beforeSync:(_,model)=>{model.sync.incarnation='e'.repeat(32);}});
  await assert.rejects(moved.groups.move(ids[1],ids[2]));assert.equal(moved.models.get(ids[1]).sync.role,2);assert.equal(moved.models.get(ids[0]).sync.role,1);
});
test('malformed, duplicate, over-limit and secret-bearing removal storage fails closed without inventory eviction',async()=>{
  const valid={source:ids[0],targets:[ids[1]],dissolve:true};
  for(const initial of [{version:3,sources:[]},{version:1,sources:[valid,valid]},{version:1,sources:[{...valid,key}]},
    {version:1,sources:[{...valid,targets:Array.from({length:32},(_,i)=>i.toString(16).padStart(12,'0'))}]},
    {version:1,sources:Array.from({length:65},(_,i)=>({source:i.toString(16).padStart(12,'0'),targets:[],dissolve:true}))}]){
    const f=fixture({removalPersistence:removalStorage(initial).callbacks});expanded(f);await f.groups.refresh();
    assert.equal(f.groups.snapshot().removalIntentStorage,'failed');await assert.rejects(f.groups.dissolve(ids[0]),error=>error.storageFailed);assert.equal(writes(f).length,0);assert.equal(f.entries().length,ids.length);
  }
  const initial={version:1,sources:Array.from({length:64},(_,i)=>({source:i.toString(16).padStart(12,'0'),targets:[],dissolve:true}))};
  const storage=removalStorage(initial),f=fixture({removalPersistence:storage.callbacks});expanded(f);
  await assert.rejects(f.groups.leave(ids[1]),error=>error.storageFailed);assert.equal(writes(f).length,0);assert.deepEqual(storage.read(),initial);
});

test('confirmed direct dissolution leaves followers first and stops coordinator last preserving individual state',async()=>{
  const f=fixture();expanded(f,[ids[0],ids[1],ids[3]]);const before=new Map([...f.models].map(([id,model])=>[id,structuredClone(model)]));
  const result=await f.groups.dissolve(ids[0]);assert.equal(result.phase,'dissolved');assert.equal(result.coordinatorStopped,true);
  assert.deepEqual(writes(f).filter(call=>call.op==='sync').map(({id,role})=>({id,role})),[{id:ids[1],role:0},{id:ids[3],role:0},{id:ids[0],role:0}]);
  for(const id of [ids[0],ids[1],ids[3]])for(const field of ['leds','midpoint','brightness','mode','power','audio','firmware','name'])assert.deepEqual(f.models.get(id)[field],before.get(id)[field]);
  assert.equal(f.peak(),2);assert.equal(f.active(),0);assert(f.leases.every(lease=>lease.released));
});
test('unreachable dissolution members remain visibly pending and prevent coordinator stop',async()=>{
  const f=fixture();expanded(f,[ids[0],ids[1],ids[3]]);f.hooks.set(ids[1],{readError:Error('offline')});
  const result=await f.groups.dissolve(ids[0]);assert.equal(result.phase,'dissolution-pending');assert.deepEqual(result.pending.map(row=>row.id),[ids[1]]);
  assert.equal(f.models.get(ids[0]).sync.role,1);assert.deepEqual(f.models.get(ids[0]).sync.order.map(row=>row.id),[ids[0],ids[1]]);
  assert.equal(f.models.get(ids[3]).sync.role,0);const group=f.groups.snapshot().groups.find(row=>row.id===ids[0]);assert.equal(group.removalPending,true);assert.deepEqual(group.pendingRemovalIds,[ids[1]]);
  f.hooks.delete(ids[1]);assert.equal((await f.groups.dissolve(ids[0])).phase,'dissolved');
});
test('last-follower leave dissolves source and one-member removal bypasses any creation minimum',async()=>{
  const f=fixture();expanded(f);const left=await f.groups.leave(ids[1]);assert.equal(left.sourceCleanup.phase,'dissolved');assert.equal(f.models.get(ids[0]).sync.role,0);
  assert.deepEqual(writes(f).filter(call=>call.op==='sync').map(call=>call.id),[ids[1],ids[0]]);
  const single=fixture();expanded(single,[ids[2]]);assert.equal((await single.groups.dissolve(ids[2])).phase,'dissolved');
});
test('moving last follower cleans source after success and after a failed destination join',async()=>{
  for(const failed of [false,true]){
    const f=fixture();expanded(f);f.models.get(ids[2]).sync.protocolVersions=[2,3];
    if(failed)f.hooks.set(ids[1],{beforeSync:(_,__,role)=>{if(role===2)throw Object.assign(Error('lost join'),{uncertain:true});}});
    if(failed)await assert.rejects(f.groups.move(ids[1],ids[2]),error=>error.leftPrevious&&error.sourceCleanup.phase==='dissolved');
    else assert.equal((await f.groups.move(ids[1],ids[2])).sourceCleanup.phase,'dissolved');
    assert.equal(f.models.get(ids[0]).sync.role,0);assert.equal(f.models.get(ids[1]).sync.role,failed?0:2);assert(f.peak()<=2);
  }
});
test('lost prune and stop replies reconcile state once without route replay',async()=>{
  const f=fixture();expanded(f);f.hooks.set(ids[0],{afterPrune:()=>{throw Object.assign(Error('lost prune'),{uncertain:true});},afterSync:()=>{throw Object.assign(Error('lost stop'),{uncertain:true});}});
  const result=await f.groups.dissolve(ids[0]);assert.equal(result.phase,'dissolved');assert.equal(writes(f).filter(call=>call.path==='/api/group/remove').length,1);assert.equal(writes(f).filter(call=>call.op==='sync'&&call.id===ids[0]).length,1);
});
test('lost target readback cannot prune membership and concurrent addition leaves explicit pending position',async()=>{
  const f=fixture();expanded(f);f.hooks.set(ids[1],{afterSync:()=>{throw Object.assign(Error('lost reply'),{uncertain:true});},beforeRead:(_,__,count)=>{if(count===2)throw Error('offline');}});
  const result=await f.groups.dissolve(ids[0]);assert.equal(result.phase,'dissolution-pending');assert.equal(writes(f).filter(call=>call.path==='/api/group/remove').length,0);assert.equal(f.models.get(ids[0]).sync.role,1);
  const concurrent=fixture();expanded(concurrent);concurrent.hooks.set(ids[0],{afterPrune:(_,model)=>{model.sync.order.push({id:ids[3],online:true});}});
  const pending=await concurrent.groups.dissolve(ids[0]);assert.equal(pending.phase,'dissolution-pending');assert.deepEqual(pending.pending.map(row=>row.id),[ids[3]]);assert.equal(concurrent.models.get(ids[0]).sync.role,1);
});

test('global inventory partitions multiple groups and independent lamps without selection or secrets',async()=>{
  const f=fixture(),snapshot=await f.groups.refresh();
  assert.equal(snapshot.groups.length,2);assert.deepEqual(snapshot.groups.find(group=>group.id===ids[0]).followers.map(row=>row.id),[ids[1]]);
  assert.deepEqual(snapshot.ungrouped.map(row=>row.id),ids.slice(3));assert.equal(snapshot.scanning,false);assert.equal(f.peak(),2);
  assert.equal(f.active(),0);assert(f.leases.every(lease=>lease.released));assert.equal(f.selected(),ids[0]);assert.equal(writes(f).length,0);
  const publicData=JSON.stringify([snapshot,...f.changes]);assert(!publicData.includes(key));assert(!publicData.includes('private-token'));assert(!publicData.includes('private-access-password'));assert(!publicData.includes('CL1-'));
  const all=snapshot.groups.flatMap(group=>[group.leader.id,...group.followers.map(row=>row.id)]).concat(snapshot.ungrouped.map(row=>row.id));
  assert.equal(new Set(all).size,ids.length);assert.equal(all.length,ids.length);
});

test('expanded groups preserve all32 offline positions and negotiate limits independently from radio hints',async()=>{
  const f=fixture(),model=f.models.get(ids[2]);
  model.sync.version=3;model.sync.maxMembers=32;model.sync.protocolVersions=[2,3];
  model.sync.order=Array.from({length:32},(_,index)=>({id:index===0?ids[2]:index.toString(16).padStart(12,'0'),name:'Position '+index,online:index===0}));
  model.sync.peerTotal=31;model.sync.peerNext=8;model.sync.peerTruncated=true;
  await f.groups.refresh();const group=f.groups.snapshot().groups.find(group=>group.id===ids[2]);
  assert.equal(group.capacity,31);assert.equal(group.usedSlots,31);assert.equal(group.remaining,0);
  assert.equal(group.leader.sync.order.length,32);assert.equal(group.leader.sync.peerTotal,31);assert.equal(group.leader.sync.peerTruncated,true);
  await assert.rejects(f.groups.join(ids[3],ids[2]),/matching group/);assert.equal(writes(f).length,0);
  f.models.get(ids[3]).sync.protocolVersions=[2,3];await assert.rejects(f.groups.join(ids[3],ids[2]),/full \(32 lamps\)/);assert.equal(writes(f).length,0);
  await assert.rejects(f.groups.stopCoordinating(ids[2]),/migration is not supported/);assert.equal(writes(f).length,0);
});

test('expanded invitation upgrades a capable independent member and old members cannot join silently',async()=>{
  const f=fixture(),destination=f.models.get(ids[2]),target=f.models.get(ids[3]);
  Object.assign(destination.sync,{version:3,maxMembers:32,protocolVersions:[2,3],members:19});
  await assert.rejects(f.groups.join(ids[3],ids[2]),/matching group/);assert.equal(writes(f).length,0);
  target.sync.protocolVersions=[2,3];const result=await f.groups.join(ids[3],ids[2]);
  assert.equal(result.phase,'joined');assert.equal(target.sync.version,3);assert.equal(target.sync.leader,ids[2]);
  assert.equal(writes(f).filter(write=>write.op==='sync').length,1);
  assert(!JSON.stringify(f.groups.snapshot()).includes(key));
});

test('expanded group creation requires fresh capability and refuses malformed capacity',async()=>{
  const f=fixture(),target=f.models.get(ids[3]);target.sync.protocolVersions=[2,3];
  const result=await f.groups.create(ids[3]);assert.equal(result.saved,true);assert.equal(target.sync.version,3);
  target.sync.maxMembers=33;f.groups.rows.clear();await f.groups.refresh();
  assert.equal(f.groups.snapshot().lamps.find(row=>row.id===ids[3]).verified,false);
});

test('explicit common v2 group creation keeps a capable main compatible with older members',async()=>{
  const f=fixture(),target=f.models.get(ids[3]);target.sync.protocolVersions=[2,3];target.sync.maxSupportedMembers=32;
  const result=await f.groups.create(ids[3],{protocol:2});
  assert.equal(result.protocol,2);assert.equal(target.sync.version,2);assert.equal(target.sync.role,1);
  await f.groups.join(ids[4],ids[3]);assert.equal(f.models.get(ids[4]).sync.version,2);
  assert.equal(writes(f).filter(call=>call.op==='sync').length,2);
});

test('requested group protocol is checked against fresh capabilities before a write',async()=>{
  for(const protocol of [1,3,4,'2']){
    const f=fixture();await assert.rejects(f.groups.create(ids[3],{protocol}),error=>error.incompatible===true);
    assert.equal(writes(f).length,0);assert.equal(f.models.get(ids[3]).sync.role,0);
  }
  const old=fixture();old.models.get(ids[3]).sync.version=1;
  await assert.rejects(old.groups.create(ids[3],{protocol:2}),error=>error.incompatible===true);assert.equal(writes(old).length,0);
  const advertised=fixture();Object.assign(advertised.models.get(ids[3]).sync,{version:1,protocolVersions:[2]});
  advertised.hooks.set(ids[3],{beforeSync:(_,model)=>{model.sync.version=2;}});
  assert.equal((await advertised.groups.create(ids[3],{protocol:2})).protocol,2);
});

test('a locked or stale-capability main cannot create a group',async()=>{
  const locked=fixture();locked.models.get(ids[3]).sync.membershipLocked=true;
  await assert.rejects(locked.groups.create(ids[3]),/staged update/);assert.equal(writes(locked).length,0);
  const stale=fixture();await stale.groups.refresh();stale.models.get(ids[3]).sync.protocolVersions=[2];
  await assert.rejects(stale.groups.create(ids[3],{protocol:3}),error=>error.incompatible===true);assert.equal(writes(stale).length,0);
});

test('public snapshots preserve validated upgrade capacity separately from current v2 membership limit',async()=>{
  const f=fixture(),target=f.models.get(ids[3]);Object.assign(target.sync,{maxSupportedMembers:32,protocolVersions:[2,3]});
  await f.groups.refresh();const row=f.groups.snapshot().lamps.find(row=>row.id===ids[3]);
  assert.equal(row.sync.maxMembers,9);assert.equal(row.sync.maxSupportedMembers,32);
  for(const invalid of [0,8,33,'32']){
    target.sync.maxSupportedMembers=invalid;f.groups.rows.clear();await f.groups.refresh();
    const invalidRow=f.groups.snapshot().lamps.find(row=>row.id===ids[3]);assert.equal(invalidRow.verified,false);assert.equal(invalidRow.sync,null);
  }
});

function creationRows(count=2){return Array.from({length:count},(_,index)=>({id:index.toString(16).padStart(12,'0'),name:'Selected lamp '+index,
  available:true,verified:true,role:0,audio:{installed:index===1},sync:{version:2,role:0,maxMembers:9,maxSupportedMembers:32,protocolVersions:[2,3],membershipLocked:false}}));}

test('group builder prefers an installed microphone and chooses a common protocol before mutating anything',()=>{
  const rows=creationRows(),before=structuredClone(rows);rows[0].sync.protocolVersions=[2];
  const plan=groupCreationPlan(rows);assert.equal(plan.protocol,2);assert.equal(plan.capacity,9);assert.equal(plan.leader.id,rows[1].id);
  assert.deepEqual(plan.followers.map(row=>row.id),[rows[0].id]);
  plan.leader.name='Changed output';assert.equal(rows[1].name,before[1].name);
  assert.equal(rows[0].role,0);assert.equal(rows[1].role,0);
});

test('expanded builder uses advertised capability despite independent lamps reporting current v2 limits',()=>{
  const rows=creationRows(20),plan=groupCreationPlan(rows);
  assert.equal(plan.protocol,3);assert.equal(plan.capacity,32);assert.equal(plan.followers.length,19);
  assert.equal(plan.leader.id,rows[1].id);assert(rows.every(row=>row.sync.version===2&&row.role===0));
  delete rows[19].sync.maxSupportedMembers;
  assert.throws(()=>groupCreationPlan(rows),/up to 9/);
  rows[19].sync={...rows[19].sync,version:3,maxMembers:32};
  assert.equal(groupCreationPlan(rows).capacity,32);
});

test('group builder checks every member capacity, shared protocol, role, lock and identity',()=>{
  const tooMany=creationRows(10);tooMany[9].sync.protocolVersions=[2];assert.throws(()=>groupCreationPlan(tooMany),/up to 9/);
  const reduced=creationRows(20);reduced[19].sync.maxSupportedMembers=16;assert.throws(()=>groupCreationPlan(reduced),/up to 16/);
  for(const change of [row=>{row.sync.maxSupportedMembers=33;},row=>{row.sync.maxSupportedMembers='32';},row=>{row.available=false;},row=>{row.verified=false;},row=>{row.role=2;},row=>{row.sync.role=1;},row=>{row.sync.membershipLocked=true;},row=>{row.id='wrong';},row=>{row.sync={version:1,role:0};}]){
    const rows=creationRows();change(rows[1]);assert.throws(()=>groupCreationPlan(rows));
  }
  const duplicate=creationRows();duplicate[1].id=duplicate[0].id;assert.throws(()=>groupCreationPlan(duplicate));
  assert.throws(()=>groupCreationPlan(creationRows(1)));assert.throws(()=>groupCreationPlan(creationRows(33)));
});

test('known lamps are read before slow native discovery and fresh radio hints join the same bounded scan',async()=>{
  const f=fixture(),native=defer();f.setEntries([f.entries()[0]]);f.setDiscover(()=>native.promise);
  f.models.get(ids[0]).sync.peers=[{id:ids[3],name:'Radio neighbor',address:'',role:0,transport:'esp-now'}];
  f.hooks.set(ids[3],{acquireError:Object.assign(Error('not authorized'),{needsPairing:true})});
  const scanning=f.groups.refresh();await tick();await tick();
  assert(f.calls.some(call=>call.id===ids[0]&&call.op==='read'));
  assert.equal(f.groups.snapshot().unavailable.find(row=>row.id===ids[3]).state,'needs-pairing');
  native.resolve([f.entries()[0],{id:ids[2],name:'Native coordinator'}]);const result=await scanning;
  assert(result.groups.some(group=>group.id===ids[2]));assert(f.peak()<=2);assert.equal(f.calls.filter(call=>call.id===ids[0]&&call.op==='read').length,1);
});

test('offline coordinator is honestly retained and absent coordinator becomes an unavailable placeholder',async()=>{
  const f=fixture();await f.groups.refresh();f.hooks.set(ids[0],{acquireError:Error('offline')});
  let snapshot=await f.groups.refresh(),group=snapshot.groups.find(group=>group.id===ids[0]);
  assert.equal(group.available,false);assert.equal(group.leader.state,'offline');assert.equal(group.leader.checkedAt,1234);assert.equal(group.followers[0].id,ids[1]);
  const another=fixture();another.setEntries([another.entries()[1]]);snapshot=await another.groups.refresh();group=snapshot.groups[0];
  assert.equal(group.id,ids[0]);assert.equal(group.placeholder,true);assert.equal(group.leader.verified,false);assert.equal(group.available,false);
});

test('wrong identities, invalid follower roles and unverified hints cannot become available',async()=>{
  const f=fixture();f.models.get(ids[3]).deviceId=ids[4];f.models.get(ids[4]).sync={version:2,role:2,leader:ids[4]};
  const snapshot=await f.groups.refresh();
  for(const id of [ids[3],ids[4]]){const row=snapshot.lamps.find(row=>row.id===id);assert.equal(row.available,false);assert.equal(row.verified,false);}
  assert.equal(writes(f).length,0);
});

test('scan cancellation rejects late inventory updates and releases acquired links without touching selected link',async()=>{
  const f=fixture(),waiting=defer();f.setEntries([f.entries()[0]]);f.hooks.set(ids[0],{beforeRead:()=>waiting.promise});
  const scan=f.groups.refresh();await tick();f.groups.cancel();waiting.resolve();const result=await scan;
  assert.equal(result.cancelled,true);assert.equal(result.scanning,false);assert.equal(result.lamps.length,0);
  await tick();assert.equal(f.active(),0);assert.equal(f.selected(),ids[0]);
});

test('inventory deadline returns promptly and late owned leases are released without stale updates',async()=>{
  const f=fixture({scanTimeout:20}),waiting=defer();f.setEntries([f.entries()[0]]);f.hooks.set(ids[0],{acquireDelay:waiting.promise});
  const result=await f.groups.refresh();assert.equal(result.scanning,false);assert.equal(result.cancelled,true);assert.equal(result.lamps[0].available,false);
  assert.equal(f.changes.at(-1).scanning,false);assert.equal(f.calls.length,0);
  waiting.resolve();await tick();await tick();assert.equal(f.active(),0);assert.equal(f.calls.length,0);assert.equal(f.groups.snapshot().lamps[0].available,false);
});

test('replacing a delayed scan keeps the global inventory connection bound at two',async()=>{
  const f=fixture(),waiting=defer();f.setEntries(f.entries().slice(0,2));
  for(const id of ids.slice(0,2))f.hooks.set(id,{acquireDelay:waiting.promise});
  const first=f.groups.refresh();await tick();const second=f.groups.refresh();await tick();assert.equal(f.peak(),2);
  waiting.resolve();await Promise.all([first,second]);assert.equal(f.peak(),2);assert.equal(f.active(),0);assert.equal(f.groups.snapshot().lamps.filter(row=>row.available).length,2);
});

test('create only changes an independent lamp and never rotates an existing coordinator key',async()=>{
  const f=fixture();assert.equal((await f.groups.create(ids[3])).phase,'created');
  assert.deepEqual(writes(f).map(({id,role})=>({id,role})),[{id:ids[3],role:1}]);
  await assert.rejects(f.groups.create(ids[0]),/membership changed/);assert.equal(writes(f).length,1);
  assert.equal(f.models.get(ids[3]).leds,205);assert.equal(f.models.get(ids[3]).brightness,55);
});

test('stop coordinating changes only the verified leader and retains every follower setting',async()=>{
  const f=fixture();await f.groups.refresh();
  const follower=structuredClone(f.models.get(ids[1])),leader=structuredClone(f.models.get(ids[0]));
  const result=await f.groups.stopCoordinating(ids[0]);
  assert.equal(result.phase,'stopped-coordinating');assert.equal(result.saved,true);
  assert.deepEqual(writes(f).map(({id,role})=>({id,role})),[{id:ids[0],role:0}]);
  assert.deepEqual(f.models.get(ids[1]),follower);
  for(const field of ['leds','midpoint','brightness','mode','power','audio','firmware','name'])assert.deepEqual(f.models.get(ids[0])[field],leader[field]);
  assert(f.groups.snapshot().ungrouped.some(row=>row.id===ids[0]));
  const retained=f.groups.snapshot().groups.find(group=>group.id===ids[0]);
  assert(retained.placeholder);assert.deepEqual(retained.followers.map(row=>row.id),[ids[1]]);
  assert.equal(f.active(),0);assert(f.leases.every(lease=>lease.released));
});

test('stop coordinating rejects followers, independent lamps, active updates and repeated demotion',async()=>{
  const f=fixture();
  for(const id of [ids[1],ids[3]])await assert.rejects(f.groups.stopCoordinating(id),/membership changed/);
  f.models.get(ids[0]).firmware.phase=3;
  await assert.rejects(f.groups.stopCoordinating(ids[0]),/Finish setup or updating/);
  assert.equal(writes(f).length,0);f.models.get(ids[0]).firmware.phase=0;
  await f.groups.stopCoordinating(ids[0]);
  await assert.rejects(f.groups.stopCoordinating(ids[0]),/membership changed/);
  assert.equal(writes(f).length,1);assert.equal(f.active(),0);
});

test('lost stop reply is confirmed by a fresh membership read without replaying the mutation',async()=>{
  const f=fixture();f.hooks.set(ids[0],{afterSync:()=>{throw Object.assign(Error('lost reply'),{uncertain:true});}});
  assert.equal((await f.groups.stopCoordinating(ids[0])).phase,'stopped-coordinating');
  assert.equal(writes(f).length,1);assert.equal(f.models.get(ids[0]).sync.role,0);assert.equal(f.active(),0);
});

test('unconfirmed stop does not move followers or repeat the attempted change',async()=>{
  const f=fixture(),follower=structuredClone(f.models.get(ids[1]));
  f.hooks.set(ids[0],{afterSync:()=>{throw Object.assign(Error('lost reply'),{uncertain:true});},
    beforeRead:(_lamp,_model,count)=>{if(count===2)throw Error('lost connection');}});
  await assert.rejects(f.groups.stopCoordinating(ids[0]),error=>error.uncertain===true&&error.phase==='stop-coordinating-unconfirmed');
  assert.equal(writes(f).length,1);assert.deepEqual(f.models.get(ids[1]),follower);assert.equal(f.active(),0);
});

test('join targets only the independent lamp and reports saved waiting separately from active',async()=>{
  const f=fixture(),result=await f.groups.join(ids[3],ids[2]);
  assert.equal(result.saved,true);assert.equal(result.active,false);assert.equal(result.phase,'joined');
  assert.deepEqual(writes(f).map(({id,role})=>({id,role})),[{id:ids[3],role:2}]);assert.equal(f.models.get(ids[3]).sync.leader,ids[2]);
  assert.equal(f.models.get(ids[1]).sync.leader,ids[0]);assert.equal(f.models.get(ids[0]).sync.role,1);
  assert(!JSON.stringify(f.changes).includes(key));assert.equal(f.selected(),ids[0]);
});

test('coordinators cannot join, move or leave and a follower must explicitly Move',async()=>{
  const f=fixture();await assert.rejects(f.groups.join(ids[0],ids[2]));await assert.rejects(f.groups.move(ids[0],ids[2]));
  await assert.rejects(f.groups.leave(ids[0]));await assert.rejects(f.groups.join(ids[1],ids[2]));await assert.rejects(f.groups.join(ids[2],ids[2]));
  assert.equal(writes(f).length,0);
});

test('full, incompatible or changed destination aborts before leaving a follower',async()=>{
  const f=fixture();f.models.get(ids[2]).sync.members=8;
  await assert.rejects(f.groups.move(ids[1],ids[2]),/full/);assert.equal(writes(f).length,0);
  f.models.get(ids[2]).sync.members=0;f.models.get(ids[2]).sync.version=1;
  await assert.rejects(f.groups.move(ids[1],ids[2]),/matching/);assert.equal(writes(f).length,0);
  f.models.get(ids[2]).sync.version=2;f.hooks.set(ids[2],{invite:async(_,model)=>{model.sync.role=0;}});
  await assert.rejects(f.groups.move(ids[1],ids[2]),/membership changed/);assert.equal(writes(f).length,0);assert.equal(f.models.get(ids[1]).sync.leader,ids[0]);
});

test('move preflights invitation then leaves once and joins once while preserving all other groups',async()=>{
  const f=fixture();await f.groups.refresh();const result=await f.groups.move(ids[1],ids[2]);
  assert.equal(result.leftPrevious,true);assert.equal(result.saved,true);
  assert.deepEqual(writes(f).map(({id,role})=>({id,role})),[{id:ids[1],role:0},{id:ids[1],role:2}]);
  assert(f.calls.findIndex(call=>call.op==='invite')<f.calls.findIndex(call=>call.op==='sync'));
  const snapshot=f.groups.snapshot();assert.equal(snapshot.groups.find(group=>group.id===ids[0]).followers.length,0);
  assert.deepEqual(snapshot.groups.find(group=>group.id===ids[2]).followers.map(row=>row.id),[ids[1]]);
  assert.equal(f.models.get(ids[0]).sync.role,1);assert.equal(f.models.get(ids[2]).sync.role,1);assert.equal(f.selected(),ids[0]);
});

test('a failed join after Move leaves an honest independent lamp and never rolls back or replays',async()=>{
  const f=fixture();f.hooks.set(ids[1],{beforeSync:async(_,model,role)=>{if(role===2)throw Object.assign(Error('private '+key),{uncertain:true});}});
  await assert.rejects(f.groups.move(ids[1],ids[2]),error=>error.leftPrevious===true&&error.phase==='left'&&error.uncertain===true&&!error.message.includes(key));
  assert.deepEqual(writes(f).map(call=>call.role),[0,2]);assert.equal(f.models.get(ids[1]).sync.role,0);
  assert(f.groups.snapshot().ungrouped.some(row=>row.id===ids[1]));assert.equal(f.calls.filter(call=>call.op==='invite').length,1);
});

test('lost leave or join response is resolved by readback with exactly one mutation per phase',async()=>{
  for(const lostRole of [0,2]){
    const f=fixture();f.hooks.set(ids[1],{afterSync:async(_,model,role)=>{if(role===lostRole)throw Object.assign(Error('response lost'),{uncertain:true});}});
    const result=await f.groups.move(ids[1],ids[2]);assert.equal(result.saved,true);assert.deepEqual(writes(f).map(call=>call.role),[0,2]);
  }
});

test('capacity changing after leave reports partial completion without an automatic rollback',async()=>{
  const f=fixture();f.hooks.set(ids[1],{afterSync:async(_,model,role)=>{if(role===0)f.models.get(ids[2]).sync.members=8;}});
  await assert.rejects(f.groups.move(ids[1],ids[2]),error=>error.leftPrevious&&error.phase==='left');
  assert.deepEqual(writes(f).map(call=>call.role),[0]);assert.equal(f.models.get(ids[1]).sync.role,0);
});

test('target wire changes at final pre-join read prevent the target POST',async()=>{
  const f=fixture();f.hooks.set(ids[3],{beforeRead:async(_,model,number)=>{if(number===3)model.sync.version=1;}});
  await assert.rejects(f.groups.join(ids[3],ids[2]),/matching/);assert.equal(writes(f).length,0);
});

test('coordinator boot token, connection epoch or target membership changes abort before mutation',async()=>{
  for(const change of ['token','epoch','membership']){
    const f=fixture();f.hooks.set(ids[2],{invite:async(lamp,model)=>{
      if(change==='token')model.token='rebooted';else if(change==='epoch')lamp.epoch++;else {f.models.get(ids[3]).sync.role=2;f.models.get(ids[3]).sync.leader=ids[0];}
    }});
    await assert.rejects(f.groups.join(ids[3],ids[2]));assert.equal(writes(f).length,0);
  }
});

test('concurrent actions on one member are rejected while another group remains controllable',async()=>{
  const f=fixture(),waiting=defer();f.hooks.set(ids[2],{invite:()=>waiting.promise});
  const join=f.groups.join(ids[3],ids[2]);await tick();await tick();
  await assert.rejects(f.groups.create(ids[3]),/current group action/);
  await f.groups.scene(ids[0],{scene:27});waiting.resolve();await join;
  assert(writes(f).some(call=>call.id===ids[0]&&call.op==='scene'));assert.equal(writes(f).filter(call=>call.id===ids[3]).length,1);
});

test('global scene, palette, order and audio intents target verified coordinator without selected-lamp dependence',async()=>{
  const f=fixture();await f.groups.scene(ids[2],{scene:32,primary:[255,0,90],secondary:[20,160,255]});
  await f.groups.order(ids[2],[ids[2]]);await f.groups.audio(ids[2],{gain:12,gate:18,scale:140});
  assert(writes(f).every(call=>call.id===ids[2]));assert.equal(f.selected(),ids[0]);assert.equal(f.models.get(ids[0]).sync.scene,0);
  assert.equal(f.models.get(ids[2]).sync.scene,32);assert.equal(f.models.get(ids[2]).audio.gain,12);
  await assert.rejects(f.groups.scene(ids[1],{scene:27}));assert.equal(writes(f).length,3);
});

test('scene capability and microphone gates reject unsupported audio while ambient scenes remain usable',async()=>{
  const f=fixture();f.models.get(ids[2]).audio.installed=false;
  await assert.rejects(f.groups.scene(ids[2],{scene:32}),/microphone/);await f.groups.scene(ids[2],{scene:27});
  f.models.get(ids[2]).sync.sceneCount=26;await assert.rejects(f.groups.scene(ids[2],{scene:27}),/supports/);
  await assert.rejects(f.groups.audio(ids[2],{gain:8,gate:8,scale:100}),/microphone/);assert.equal(writes(f).length,1);
});

test('explicit follower leave and pause/resume keep role exclusivity and never disband its coordinator',async()=>{
  const f=fixture();await f.groups.pause(ids[1]);assert.equal(f.models.get(ids[1]).sync.paused,true);
  await f.groups.resume(ids[1]);assert.equal(f.models.get(ids[1]).sync.paused,false);
  await f.groups.leave(ids[1]);assert.equal(f.models.get(ids[1]).sync.role,0);assert.equal(f.models.get(ids[0]).sync.role,1);
  assert(writes(f).every(call=>call.id===ids[1]));
});

test('forget during a pending invitation invalidates old action even after explicit allow',async()=>{
  const f=fixture(),waiting=defer();f.hooks.set(ids[2],{invite:()=>waiting.promise});
  const join=f.groups.join(ids[3],ids[2]);await tick();await tick();assert(f.calls.some(call=>call.op==='invite'));
  f.groups.forget(ids[3]);f.groups.allow(ids[3]);waiting.resolve();
  await assert.rejects(join,error=>error.stale===true);assert.equal(writes(f).length,0);assert.equal(f.active(),0);
  assert.equal(f.models.get(ids[3]).sync.role,0);assert.equal(f.groups.rows.has(ids[3]),false);
});

test('forgetting a coordinator preserves follower graph while new discovery remains unauthorized',async()=>{
  const f=fixture();await f.groups.refresh();const before=f.leases.filter(lease=>lease.id===ids[0]).length;
  f.groups.forget(ids[0]);f.setEntries([...f.entries().filter(entry=>entry.id!==ids[0]),{id:ids[0],name:'Public discovery hint',address:'192.168.1.40'}]);
  const snapshot=await f.groups.refresh(),group=snapshot.groups.find(group=>group.id===ids[0]);
  assert.equal(group.available,false);assert.equal(group.placeholder,true);assert.deepEqual(group.followers.map(row=>row.id),[ids[1]]);
  assert.equal(snapshot.unavailable.find(row=>row.id===ids[0]).state,'needs-pairing');
  assert.equal(f.leases.filter(lease=>lease.id===ids[0]).length,before);assert.equal(f.groups.entries.get(ids[0]).deviceId,undefined);
  await assert.rejects(f.groups.join(ids[3],ids[0]),error=>error.needsAuthorization===true);assert.equal(writes(f).length,0);
});

test('forgotten follower retains only honest last-seen public membership and cannot be mutated',async()=>{
  const f=fixture();await f.groups.refresh();const count=f.leases.length;f.groups.forget(ids[1]);
  assert.equal(f.groups.rows.has(ids[1]),false);assert.equal(f.groups.entries.has(ids[1]),false);
  const follower=f.groups.snapshot().groups.find(group=>group.id===ids[0]).followers.find(row=>row.id===ids[1]);
  assert.equal(follower.available,false);assert.equal(follower.verified,false);assert.equal(follower.lastSeenMembership,true);
  assert.equal(follower.sync.leader,ids[0]);assert(!JSON.stringify(follower).includes('saved-'));assert(!JSON.stringify(follower).includes(key));
  await assert.rejects(f.groups.leave(ids[1]),error=>error.needsAuthorization===true);assert.equal(f.leases.length,count);assert.equal(writes(f).length,0);
  assert.equal(f.models.get(ids[1]).sync.role,2);
});

test('actions use current inventory locator instead of cached authorization and reject removed descriptors',async()=>{
  const f=fixture();await f.groups.refresh();
  f.setEntries(f.entries().map(entry=>entry.id===ids[3]?{...entry,deviceId:'newly-authorized-device',address:'192.168.1.99'}:entry));
  await f.groups.create(ids[3]);const lease=f.leases.filter(value=>value.id===ids[3]).at(-1);
  assert.equal(lease.entry.deviceId,'newly-authorized-device');assert.equal(lease.entry.address,'192.168.1.99');
  const count=f.leases.length;f.setEntries(f.entries().filter(entry=>entry.id!==ids[3]));
  await assert.rejects(f.groups.create(ids[3]),/no longer in discovery/);assert.equal(f.leases.length,count);
});

test('forget while factory acquisition is pending releases late link before any read or mutation',async()=>{
  const f=fixture(),waiting=defer();f.hooks.set(ids[3],{acquireDelay:waiting.promise});
  const creating=f.groups.create(ids[3]);await tick();f.groups.forget(ids[3]);f.setEntries(f.entries().filter(entry=>entry.id!==ids[3]));waiting.resolve();
  await assert.rejects(creating,error=>error.stale===true);assert.equal(f.calls.length,0);assert.equal(f.active(),0);
  assert.equal(f.groups.rows.has(ids[3]),false);
});

test('forget after dispatch never repeats or rolls back an already attempted group mutation',async()=>{
  const f=fixture(),waiting=defer();f.hooks.set(ids[3],{afterSync:(_,model,role)=>role===2?waiting.promise:undefined});
  const join=f.groups.join(ids[3],ids[2]);await tick();await tick();assert.equal(writes(f).length,1);
  f.groups.forget(ids[3]);waiting.resolve();await assert.rejects(join,error=>error.stale===true);
  assert.equal(writes(f).length,1);assert.equal(f.models.get(ids[3]).sync.role,2);assert.equal(f.active(),0);
});
