import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availableGroupScenes,groupScenes,groupSceneSettings,moveGroupLamp} from '../src/group-scenes.js';
import {WifiTransport} from '../src/wifi.js';
test('eighteen scenes have distinct names, defaults and validated controls',()=>{
 assert.equal(groupScenes.length,19);
 assert.equal(new Set(groupScenes.map(x=>x.name)).size,19);
 assert.equal(groupSceneSettings({scene:4,sceneSpeed:70,sceneIntensity:0}).intensity,0);
 for(const patch of [{scene:19},{speed:0},{intensity:101},{primary:[1,2,999]}])assert.throws(()=>groupSceneSettings({},patch));
});
test('lamp order moves exactly one step without mutating discovery',()=>{
 const order=[{id:'a'},{id:'b'},{id:'c'}];
 assert.deepEqual(moveGroupLamp(order,'b',-1),['b','a','c']);
 assert.deepEqual(order.map(x=>x.id),['a','b','c']);
 assert.throws(()=>moveGroupLamp(order,'a',-1));
});
test('group scene and order changes target the coordinator and retain other values',async()=>{
 const calls=[];const lamp=new WifiTransport({});
 lamp.raw={sync:{version:2,role:1,scene:5,sceneSpeed:60,sceneIntensity:70,order:[{id:'a',online:true},{id:'b',online:true}]}};
 lamp.identity='a';lamp.request=async(path,data)=>{calls.push({path,data});return 'Saved';};lamp.refresh=async()=>{};
 await lamp.configureGroupScene({intensity:20});
 assert.equal(calls[0].data.scene,5);assert.equal(calls[0].data.speed,60);assert.equal(calls[0].data.intensity,20);
 await lamp.configureGroupOrder(['b','a']);assert.equal(calls[1].data.order,'b,a');
 await assert.rejects(()=>lamp.configureGroupOrder(['a']));
 lamp.raw.sync.role=2;await assert.rejects(()=>lamp.configureGroupScene({scene:1}));
 lamp.raw.sync.role=1;lamp.raw.sync.version=1;await assert.rejects(()=>lamp.configureGroupScene({scene:1}));
});

test('older controllers only offer supported scenes and cannot receive new scene IDs',async()=>{
 assert.equal(availableGroupScenes({}).length,9);
 assert.equal(availableGroupScenes({sceneCount:18}).length,19);
 const lamp=new WifiTransport({});lamp.raw={sync:{version:2,role:1}};
 lamp.request=async()=> 'Saved';lamp.refresh=async()=>{};
 await assert.rejects(()=>lamp.configureGroupScene({scene:9}),/Update every lamp/);
 lamp.raw.sync.sceneCount=18;
 for(let scene=9;scene<=18;scene++)await lamp.configureGroupScene({scene});
 assert.deepEqual(groupScenes.filter(s=>s.id>8&&s.audio).map(s=>s.id),[16,17]);
 assert.equal(groupScenes.find(s=>s.id===15).fixedColors,true);
});
