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
