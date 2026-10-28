import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSavedLook,normalizeSavedLook,resolveSavedLookEffect,SavedLooksStore,SAVED_LOOKS_STORAGE_KEY} from '../src/saved-looks.js';

const lampId='acb950b2f180',other='f0b950b2f180';
const catalog=[{id:13,name:'Plasma',speed:true,category:'calm'}];
function state(){return {deviceId:lampId,mode:13,brightness:120,sync:{role:0,scene:0},colors:Array.from({length:13},(_,i)=>i===12?[0,255,60,110]:null),effectOptions:Array.from({length:13},(_,i)=>i===12?[50,100,0,35,160,255]:null)};}
const draft=()=>captureSavedLook({lampId,state:state(),catalog,name:'Cozy Plasma'});
function storage(){const data=new Map([['coollamp-lamps','legacy lamp data']]);return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function store(backing=storage()){let counter=0;return new SavedLooksStore(backing,{now:()=>1234,id:()=>`look-${++counter}`});}

test('default record IDs support WebKit with getRandomValues but no randomUUID',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');let fills=0;
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(bytes){assert.equal(bytes.length,16);bytes.fill(++fills);return bytes;}}});
  const records=new SavedLooksStore(storage(),{now:()=>1234});
  const first=records.save(draft()),second=records.save(draft());
  assert.match(first.id,/^[a-f0-9]{32}$/);assert.notEqual(first.id,second.id);assert.equal(records.list(lampId).length,2);
 }finally{if(original)Object.defineProperty(globalThis,'crypto',original);else delete globalThis.crypto;}
});

test('captures the actual recorded CoolLamp1 Plasma look without inventing custom colors',()=>{
 const value=captureSavedLook({lampId,state:{...state(),sync:{role:2,scene:0,active:false}},catalog,name:'My Plasma'});
 assert.equal(value.effect.localId,13);assert.equal(value.effect.name,'Plasma');
 assert.deepEqual(value.appearance,{brightness:120,color:[0,255,60,110],options:[50,100,0,35,160,255]});
});
test('BLE full snapshots can use their separately verified catalog; supplied names must agree',()=>{
 assert.equal(draft().effect.name,'Plasma');const raw=state();raw.effects=Array(13).fill('Wrong');
 assert.throws(()=>captureSavedLook({lampId,state:raw,catalog}),/effect changed/);
 raw.effects[12]='Plasma';assert.equal(captureSavedLook({lampId,state:raw,catalog}).name,'Plasma');
});
test('snapshot fields are copied and credentials/hardware/startup/group authority are excluded',()=>{
 const raw=state();Object.assign(raw,{token:'secret',ssid:'private',startupMode:3,power:true,leds:134});
 const value=captureSavedLook({lampId,state:raw,catalog});raw.colors[12][1]=0;
 assert.equal(value.appearance.color[1],255);assert.deepEqual(Object.keys(value).sort(),['appearance','effect','lampId','name','version']);
 assert(!JSON.stringify(value).includes('secret'));assert(!JSON.stringify(value).includes('private'));
});
test('fresh target and catalog identity/availability are mandatory',()=>{
 assert.throws(()=>captureSavedLook({lampId:other,state:state(),catalog}),/current light/);
 assert.throws(()=>captureSavedLook({lampId,state:state(),catalog:[...catalog,...catalog]}),/verified/);
 assert.throws(()=>captureSavedLook({lampId,state:state(),catalog:[{...catalog[0],available:false}]}),/not available/);
 assert.throws(()=>resolveSavedLookEffect(draft(),{lampId:other,catalog}),/different lamp/);
 assert.throws(()=>resolveSavedLookEffect(draft(),{lampId,catalog:[{...catalog[0],name:'Unrelated'}]}),/list has changed/);
});
test('only an explicit unique semantic key permits changing a local ID',()=>{
 const look={...draft(),effect:{localId:13,name:'Plasma',key:'effect.plasma'}};
 assert.equal(resolveSavedLookEffect(look,{lampId,catalog:[{id:99,name:'New display name',key:'effect.plasma',speed:true}]}).id,99);
 assert.throws(()=>resolveSavedLookEffect(look,{lampId,catalog:[{id:13,name:'Plasma',key:'effect.other'}]}),/changed/);
 assert.throws(()=>resolveSavedLookEffect(look,{lampId,catalog:[{id:13,name:'Plasma',key:'effect.plasma'},{id:99,name:'Clone',key:'effect.plasma'}]}),/ambiguous/);
});
test('unknown future effects keep their identity and generic standard values',()=>{
 const raw=state();raw.mode=51;raw.colors[50]=[1,2,3,4];raw.effectOptions[50]=[10,20,1,5,6,7];
 const value=captureSavedLook({lampId,state:raw,catalog:[{id:51,name:'Future coil',speed:false}]});
 assert.equal(value.effect.name,'Future coil');assert.equal(resolveSavedLookEffect(value,{lampId,catalog:[{id:51,name:'Future coil',speed:false}]}).id,51);
});
test('group Mirror and local fallback may be recorded; active spatial scenes cannot',()=>{
 for(const sync of [{role:1,scene:0},{role:2,scene:0,active:false},{role:2,scene:0,active:true}])assert.equal(captureSavedLook({lampId,state:{...state(),sync},catalog}).effect.localId,13);
 for(const sync of [{role:1,scene:4},{role:2,scene:4,active:true,paused:false}])assert.throws(()=>captureSavedLook({lampId,state:{...state(),sync},catalog}),/group scene/);
 assert.throws(()=>captureSavedLook({lampId,state:{...state(),sync:null},catalog}),/group status/);
});
test('zone effects reject incomplete appearance instead of silently losing their colors',()=>{
 for(const name of ['VU Meter','Three-band Fountain'])assert.throws(()=>captureSavedLook({lampId,state:state(),catalog:[{id:13,name,speed:true}]}),/separate color zones/);
});
test('schema rejects malformed tuples, nonfinite numbers, controls and future versions',()=>{
 for(const change of [{brightness:0},{brightness:NaN},{color:[true,2,3,4]},{color:[0,0,0,256]},{options:[0,100,0,1,2,3]},{options:[50,101,0,1,2,3]},{options:[50,100,2,1,2,3]}])assert.throws(()=>normalizeSavedLook({...draft(),appearance:{...draft().appearance,...change}}));
 assert.throws(()=>normalizeSavedLook({...draft(),version:2}));assert.throws(()=>normalizeSavedLook({...draft(),name:'x'.repeat(65)}));assert.throws(()=>normalizeSavedLook({...draft(),name:'bad\nname'}));
});
test('phone-local save/reload/remove preserves legacy effect favorites and isolates lamps',()=>{
 const backing=storage(),model=store(backing),saved=model.save(draft());
 assert.equal(store(backing).list(lampId)[0].name,'Cozy Plasma');assert.equal(model.list(other).length,0);
 assert.equal(model.remove(saved.id,other),false);assert.equal(model.list(lampId).length,1);
 assert.equal(model.remove(saved.id,lampId),true);assert.equal(model.list(lampId).length,0);assert.equal(backing.data.get('coollamp-lamps'),'legacy lamp data');
});
test('failed save/remove never changes the stored copies or invents a success',()=>{
 const backing=storage(),model=store(backing),saved=model.save(draft()),old=backing.getItem(SAVED_LOOKS_STORAGE_KEY);
 backing.setItem=()=>{throw Error('quota');};assert.throws(()=>model.save(draft()),/could not be saved/);assert.throws(()=>model.remove(saved.id,lampId),/could not be saved/);
 assert.equal(backing.getItem(SAVED_LOOKS_STORAGE_KEY),old);assert.equal(model.list(lampId).length,1);
});
test('damaged and future storage is retained and refuses overwrite',()=>{
 for(const raw of ['broken','null','{"version":2,"looks":[]}','{"version":1,"looks":[{}]}']){
  const backing=storage();backing.data.set(SAVED_LOOKS_STORAGE_KEY,raw);const model=store(backing);
  assert.throws(()=>model.list());assert.throws(()=>model.save(draft()));assert.equal(backing.getItem(SAVED_LOOKS_STORAGE_KEY),raw);
 }
 const backing={getItem(){throw Error('blocked');}};assert.throws(()=>store(backing).list(),/unavailable/);
});
test('capacity bounds reject without evicting/reordering any saved looks',()=>{
 const backing=storage(),model=store(backing);for(let i=0;i<32;i++)model.save({...draft(),name:'Look '+i});
 const old=backing.getItem(SAVED_LOOKS_STORAGE_KEY);assert.throws(()=>model.save(draft()),/limit/);assert.equal(backing.getItem(SAVED_LOOKS_STORAGE_KEY),old);
 for(const id of ['000000000001','000000000002','000000000003'])for(let i=0;i<32;i++)model.save({...draft(),lampId:id});
 assert.equal(model.list().length,128);assert.throws(()=>model.save({...draft(),lampId:other}),/limit/);
});
