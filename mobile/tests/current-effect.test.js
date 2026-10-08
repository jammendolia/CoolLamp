import test from 'node:test';
import assert from 'node:assert/strict';
import {lightingObservation,LampConnectivity} from '../src/lamp-connectivity.js';
const id='aabbccddeeff',leader='112233445566';
const raw={deviceId:id,render:{mode:3,power:true},sync:{version:2,role:0}};
test('effect names come from this lamp catalogue, never from local numerical IDs',()=>{
 assert.equal(lightingObservation(raw,[{id:3,name:'A new local effect'}]).name,'A new local effect');
 assert.equal(lightingObservation(raw,[{id:3,name:'Another lamp effect'}]).name,'Another lamp effect');
 assert.equal(lightingObservation(raw).name,null);
 assert.equal(lightingObservation({...raw,render:{mode:3,power:false}},[{id:3,name:'Fire'}]).power,false);
 for(const render of [{mode:0,power:true},{mode:256,power:true},{mode:3,power:1}])assert.equal(lightingObservation({...raw,render}),null);
});
test('group labels require actual role/scene/active state and declared support',()=>{
 const sync={version:2,role:2,leader,active:true,paused:false,scene:27,sceneCount:32};
 assert.deepEqual(lightingObservation({...raw,sync}),{kind:'group',name:'Chromatic screw',mode:3,power:true,scene:27});
 assert.equal(lightingObservation({...raw,sync:{...sync,active:false}},[{id:3,name:'Local effect'}]).name,'Local effect');
 assert.equal(lightingObservation({...raw,sync:{...sync,paused:true}},[{id:3,name:'Local effect'}]).kind,'effect');
 assert.equal(lightingObservation({...raw,sync:{...sync,sceneCount:8}}).name,null);
 assert.equal(lightingObservation({...raw,sync:{...sync,role:1,leader:id,active:false}}).kind,'group');
 assert.equal(lightingObservation({...raw,sync:{...sync,leader:id}}),null);
});
test('lighting freshness is independent, expires honestly and cannot cross addresses or overwrite newer BLE',()=>{
 let now=1000;const entries=[{id,address:'192.168.1.20'}],cache=new LampConnectivity({getLamps:()=>entries,now:()=>now,ttl:30});
 const lighting=lightingObservation(raw,[{id:3,name:'Fire'}]);
 assert(cache.observeLighting(id,{deviceId:id,lighting,checkedAt:1000}));assert.equal(cache.get(id).lighting.label,'Fire');
 now=1020;assert(cache.observeLighting(id,{deviceId:id,lighting:{...lighting,power:false},checkedAt:1020}));
 assert.equal(cache.invalidateLighting(id,{attemptedAt:1000}),false);assert.equal(cache.get(id).lighting.label,'Off · Fire');
 assert.equal(cache.observeLighting(id,{deviceId:id,lighting:{...lighting,name:'Old'},checkedAt:1000}),false);
 now=1060;assert.equal(cache.get(id).lighting.state,'stale');assert.match(cache.get(id).lighting.label,/Last seen/);
 entries[0].address='192.168.1.21';assert.equal(cache.get(id).lighting.state,'unknown');
 assert.equal(cache.observeLighting(id,{deviceId:leader,lighting}),false);cache.forget(id);assert.equal(cache.lighting.size,0);
});

test('Mirror groups retain their actual catalogue effect and disclose unknown names honestly',()=>{
 const groupRaw={...raw,sync:{version:2,role:2,leader,active:true,paused:false,scene:0,sceneCount:32}};
 const value=lightingObservation(groupRaw,[{id:3,name:'This lamp effect'}]);assert.equal(value.kind,'group');assert.equal(value.scene,0);assert.equal(value.name,'This lamp effect');
 const entries=[{id,address:'192.168.1.20'}],cache=new LampConnectivity({getLamps:()=>entries,now:()=>1000});
 cache.observeLighting(id,{deviceId:id,lighting:value});assert.equal(cache.get(id).lighting.label,'Group mirror · This lamp effect');
 cache.observeLighting(id,{deviceId:id,lighting:lightingObservation(groupRaw)});assert.equal(cache.get(id).lighting.label,'Group · Mirror effects');
});
