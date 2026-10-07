import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {availableGroupScenes,groupScenes,groupSceneSettings,moveGroupLamp} from '../src/group-scenes.js';
import {WifiTransport} from '../src/wifi.js';
test('thirty-two scenes retain contiguous IDs, distinct names and validated controls',()=>{
 assert.equal(groupScenes.length,33);
 assert.deepEqual(groupScenes.map(x=>x.id),Array.from({length:33},(_,id)=>id));
 assert.equal(new Set(groupScenes.map(x=>x.name)).size,33);
 assert.equal(groupSceneSettings({scene:4,sceneSpeed:70,sceneIntensity:0}).intensity,0);
 for(const patch of [{scene:33},{scene:-1},{scene:19.5},{speed:0},{intensity:101},{primary:[1,2,999]}])assert.throws(()=>groupSceneSettings({},patch));
 for(let scene=19;scene<=32;scene++)assert.equal(groupSceneSettings({}, {scene}).scene,scene);
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
 assert.equal(availableGroupScenes({sceneCount:26}).length,27);
 assert.equal(availableGroupScenes({sceneCount:32}).length,33);
 const lamp=new WifiTransport({});lamp.raw={sync:{version:2,role:1}};
 lamp.request=async()=> 'Saved';lamp.refresh=async()=>{};
 await assert.rejects(()=>lamp.configureGroupScene({scene:9}),/Update every lamp/);
 lamp.raw.sync.sceneCount=18;
 for(let scene=9;scene<=18;scene++)await lamp.configureGroupScene({scene});
 await assert.rejects(()=>lamp.configureGroupScene({scene:19}),/Update every lamp/);
 lamp.raw.sync.sceneCount=26;
 for(let scene=19;scene<=26;scene++)await lamp.configureGroupScene({scene});
 await assert.rejects(()=>lamp.configureGroupScene({scene:27}),/Update every lamp to firmware 1\.9\.6/);
 lamp.raw.sync.sceneCount=32;
 for(let scene=27;scene<=32;scene++)await lamp.configureGroupScene({scene});
 lamp.raw.sync.sceneCount=18;
 await assert.rejects(()=>lamp.configureGroupScene({scene:26}),/Update every lamp/);
 assert.deepEqual(groupScenes.filter(s=>s.id>8&&s.audio).map(s=>s.id),[16,17,19,20,21,22,23,24,25,26,29,30,31,32]);
 assert.equal(groupScenes.find(s=>s.id===15).fixedColors,true);
});

test('scene availability uses selected firmware metadata with bounded legacy fallback',()=>{
 const ids=sync=>availableGroupScenes(sync).map(scene=>scene.id);
 const legacy=Array.from({length:9},(_,id)=>id);
 for(const sync of [undefined,null,{}, {sceneCount:undefined},{sceneCount:null},{sceneCount:'26'},
  {sceneCount:18.5},{sceneCount:NaN},{sceneCount:Infinity}])assert.deepEqual(ids(sync),legacy);
 for(const sceneCount of [0,-1,-500])assert.deepEqual(ids({sceneCount}),[0]);
 for(const sceneCount of [32,33,1000])assert.deepEqual(ids({sceneCount}),groupScenes.map(scene=>scene.id));
 assert.deepEqual(ids({sceneCount:18}),Array.from({length:19},(_,id)=>id));
 assert.equal(ids({sceneCount:26}).at(-1),26);
 assert.equal(ids({sceneCount:27}).at(-1),27);
 assert.equal(ids({sceneCount:18}).at(-1),18);
 assert.deepEqual(ids({}),legacy);
});

test('new room scenes expose palettes and require the coordinator microphone',()=>{
 const scenes=groupScenes.filter(scene=>scene.id>=19&&scene.id<=26);
 assert.deepEqual(scenes.map(scene=>scene.name),[
  'Bass cathedral','Spectrum loom','Resonant rings','Velvet thunder',
  'Prism chorus','Twin vortex','Electric bloom','Room groove',
 ]);
 for(const scene of scenes){
  assert.equal(scene.audio,true);
  assert.notEqual(scene.optionalAudio,true);
  assert.notEqual(scene.fixedColors,true);
  assert.ok(scene.description.length>0);
  assert.ok(scene.speedLabel.length>0);
 }
 const ui=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(ui,/button\.dataset\.needsMic=String\(item\.audio&&!item\.optionalAudio\)/);
 assert.match(ui,/button\.disabled=.*button\.dataset\.needsMic==='true'&&!state\.audio\?\.installed/);
});

test('corkscrew scenes retain selected-lamp compatibility and separate ambient from audio',()=>{
 const scenes=groupScenes.filter(scene=>scene.id>=27);
 assert.deepEqual(scenes.map(scene=>scene.name),[
  'Chromatic screw','Mercury ribbon','Bass turbine','Prism torque','Echo coils','Aurora braid',
 ]);
 assert.deepEqual(scenes.map(scene=>scene.audio),[false,false,true,true,true,true]);
 for(const scene of scenes){
  assert.notEqual(scene.optionalAudio,true);
  assert.notEqual(scene.fixedColors,true);
  assert.ok(scene.description.length>0);
  assert.ok(scene.speedLabel.length>0);
 }
 assert.equal(availableGroupScenes({sceneCount:26}).some(scene=>scene.id>=27),false);
 assert.deepEqual(availableGroupScenes({sceneCount:32}).filter(scene=>scene.id>=27),scenes);
});
