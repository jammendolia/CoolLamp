import test from 'node:test';
import assert from 'node:assert/strict';
import {meshRouteCandidates} from '../src/mesh-route-candidates.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';

const target='111111111111',lamp={id:'222222222222',address:'192.168.1.20',deviceId:'paired',accessoryManaged:true},bridge={id:'333333333333',role:'bridge',fleetId:'1234567890abcdef',firmwareVersion:'0.2.2'};
test('a saved household bridge is tried before stale lamp Wi-Fi while retaining paired Bluetooth',()=>{
 const routes=selectMeshRecoveryCandidates(meshRouteCandidates({target,entries:[lamp],bridges:[bridge],platform:'ios'}));
 assert.equal(routes.length,2);assert.equal(routes[0].entry.id,bridge.id);assert.equal(routes[0].entry.address,'coollamp-bridge-3333.local');assert.equal(routes[0].accessory,true);
 assert.equal(routes[1].kind,'bluetooth');
});
test('fresh lamp Wi-Fi stays ahead of a saved bridge hint',()=>{
 const routes=meshRouteCandidates({target,entries:[lamp],bridges:[bridge],connectivity:{get:()=>({wifi:{fresh:true,state:'connected'}})}});
 assert.equal(routes[0].entry.id,lamp.id);
});
test('a specifically selected bridge retains priority without treating its version as lamp firmware',()=>{
 const routes=meshRouteCandidates({target,entries:[lamp],bridges:[bridge],bridgeId:bridge.id,connectivity:{get:()=>({wifi:{fresh:true,state:'connected'}})}});
 assert.equal(routes[0].entry.id,bridge.id);
});
test('an active verified bridge is borrowed once, with a paired fallback',()=>{
 const activeBridge={identity:bridge.id,epoch:7,request(){},raw:{mesh:{version:1,available:true}}};
 const routes=selectMeshRecoveryCandidates(meshRouteCandidates({target,activeBridge,entries:[lamp],bridges:[bridge],platform:'ios'}));
 assert.equal(routes[0].transport,activeBridge);assert.equal(routes[0].epoch,7);assert.equal(routes[1].kind,'bluetooth');
});
test('unverified household records, the leaf itself and bridge-shaped lamp entries are excluded',()=>{
 const routes=meshRouteCandidates({target,entries:[{...lamp,id:target},{...lamp,role:'bridge'}],bridges:[{...bridge,fleetId:''},{...bridge,id:target},{...bridge,role:'lamp'}]});
 assert.deepEqual(routes,[]);
});
test('bridge inventory is bounded to eight without evicting or rewriting saved records',()=>{
 const bridges=Array.from({length:20},(_,index)=>({...bridge,id:index.toString(16).padStart(12,'0')})),before=structuredClone(bridges);
 const routes=meshRouteCandidates({target,bridges});assert.equal(routes.length,8);assert.deepEqual(bridges,before);
});
test('unmanaged iOS Bluetooth accessories remain excluded while Android keeps its authorized path',()=>{
 assert.equal(meshRouteCandidates({target,entries:[{...lamp,accessoryManaged:false}],platform:'ios'}).filter(row=>row.kind==='bluetooth').length,0);
 assert.equal(meshRouteCandidates({target,entries:[{...lamp,accessoryManaged:false}],platform:'android'}).filter(row=>row.kind==='bluetooth').length,1);
});

const observation=(gatewayId,changes={})=>({targetId:target,gatewayId,fleetId:bridge.fleetId,hops:2,observedAt:100,expiresAt:15100,...changes});
test('a fresh observed target gateway precedes unrelated hints without inventing a new gateway',()=>{
 const observed={...lamp,id:'444444444444'},unknown='555555555555';
 const routes=meshRouteCandidates({target,entries:[lamp,observed],bridges:[bridge],observations:[observation(observed.id),observation(unknown)],now:1000,platform:'ios'});
 assert.equal(routes[0].entry.id,observed.id);assert.equal(routes[0].observation.targetId,target);
 assert(!routes.some(row=>(row.id||row.entry.id)===unknown));
 assert.equal(routes.filter(row=>row.observation).length,2,'both authorized ingress alternatives retain the same target proof');
});

test('a freshly observed Bluetooth-only gateway ranks before an unrelated Wi-Fi hint',()=>{
 const nearby={...lamp,id:'444444444444'};delete nearby.address;
 const routes=meshRouteCandidates({target,entries:[lamp,nearby],observations:[observation(nearby.id)],now:1000,platform:'ios'});
 assert.equal(routes[0].kind,'bluetooth');assert.equal(routes[0].entry.id,nearby.id);
});

test('supported active gateway remains first while target observations use exact gateway epochs',()=>{
 const activeBridge={identity:bridge.id,epoch:7,request(){},raw:{mesh:{version:1,available:true}}};
 const routes=meshRouteCandidates({target,activeBridge,entries:[lamp],bridges:[bridge],observations:[observation(bridge.id,{gatewayEpoch:6}),observation(lamp.id,{hops:1})],now:1000});
 assert.equal(routes[0].transport,activeBridge);assert.equal(routes[0].observation,undefined);assert.equal(routes[1].entry.id,lamp.id);assert(routes[1].observation);
});

test('expired, future, wrong-target and malformed observations do not alter legacy route order',()=>{
 const options={target,entries:[lamp],bridges:[bridge],platform:'ios',now:1000},expected=meshRouteCandidates(options);
 for(const changes of [{expiresAt:1000},{observedAt:1001},{targetId:'999999999999'},{fleetId:''},{hops:0},{hops:5},{gatewayEpoch:-1},{expiresAt:99}]){
  assert.deepEqual(meshRouteCandidates({...options,observations:[observation(lamp.id,changes)]}),expected,JSON.stringify(changes));
 }
});

test('gateway ranking uses hop/freshness hints and honors a selected eligible fresh gateway',()=>{
 const first={...lamp,id:'444444444444'},second={...lamp,id:'555555555555'},proofs=[observation(first.id,{hops:1}),observation(second.id,{hops:2})];
 const options={target,entries:[lamp,first,second],observations:proofs,now:1000,platform:'ios'};
 assert.equal(meshRouteCandidates(options)[0].entry.id,first.id);
 assert.equal(meshRouteCandidates({...options,bridgeId:second.id})[0].entry.id,second.id);
 assert.equal(meshRouteCandidates({...options,bridgeId:target})[0].entry.id,first.id,'an excluded identity cannot become eligible through override');
 assert.equal(meshRouteCandidates({...options,observations:[observation(first.id,{observedAt:100}),observation(second.id,{observedAt:200})]})[0].entry.id,second.id);
});

test('inventory hints cannot authorize an unmanaged Bluetooth accessory or cross a saved bridge fleet',()=>{
 const denied={...lamp,address:null,accessoryManaged:false},routes=meshRouteCandidates({target,entries:[denied],bridges:[bridge],platform:'ios',observations:[observation(lamp.id),observation(bridge.id,{fleetId:'fedcba0987654321'})],now:1000});
 assert.equal(routes.length,1);assert.equal(routes[0].entry.id,bridge.id);assert.equal(routes[0].observation,undefined);
});

test('public route candidates copy only bounded observation metadata and cannot change the caller snapshot',()=>{
 const value=observation(lamp.id,{password:'private',key:'private',gatewayBoot:'1234567890abcdef',targetBoot:'fedcba0987654321'});
 const routes=meshRouteCandidates({target,entries:[lamp],observations:[value],now:1000});
 assert(!JSON.stringify(routes[0].observation).includes('private'));routes[0].observation.hops=4;assert.equal(value.hops,2);
});
