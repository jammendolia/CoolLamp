import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampStore,lampFirmwareLabel,validFirmwareVersion} from '../src/lamps.js';

function setup(items=[]){
 const data=new Map([['coollamp-lamps',JSON.stringify(items)]]);let saves=0;
 const storage={getItem:key=>data.get(key),setItem:(key,value)=>{++saves;data.set(key,value);}};
 return {store:new LampStore(storage),data,get saves(){return saves;},storage};
}

test('style choices are per canonical lamp, survive restart and preserve every other preference',()=>{
 const id='acb950b2f180',second='f0b950b2f180';
 const model=setup([{id,name:'BACL',room:'Studio',favorites:[4,47],firmwareVersion:'1.9.6',deviceId:'phone-a'},{id:second,name:'CoolLamp 2'}]);
 assert.equal(model.store.setLampStyle(id,'corkscrew',{source:'phone'}).phoneLampStyle,'corkscrew');
 assert.equal(model.saves,1);model.store.setLampStyle(id,'corkscrew',{source:'phone'});assert.equal(model.saves,1);
 assert.equal(new LampStore(model.storage).items[0].phoneLampStyle,'corkscrew');
 const descriptor={version:1,code:2,id:'large-helix',family:'helix',token:'private'};
 const entry=model.store.setLampStyle(id,descriptor,{source:'lamp'});assert.equal(model.saves,2);
 assert.deepEqual(entry.lampStyle,{version:1,code:2,id:'large-helix',family:'helix'});
 assert.equal(entry.phoneLampStyle,'corkscrew');assert.equal(entry.room,'Studio');assert.deepEqual(entry.favorites,[4,47]);assert.equal(entry.firmwareVersion,'1.9.6');
 assert.deepEqual(model.store.items.map(row=>row.id),[id,second]);assert.equal(model.store.items[1].lampStyle,undefined);
 model.store.setLampStyle(id,descriptor,{source:'lamp'});assert.equal(model.saves,2);
 model.store.setLampStyle(id,'unspecified',{source:'phone'});assert.equal(model.saves,3);assert.equal(entry.phoneLampStyle,undefined);
 assert(!model.data.get('coollamp-lamps').includes('private'));
});

test('bad style sources, mismatched descriptors, aliases and removed IDs cannot update inventory',()=>{
 const id='acb950b2f180',model=setup([{id},{id:'ble:phone-a'}]);
 for(const value of ['future',2,{version:1,code:2,id:'corkscrew',family:'corkscrew'},null])assert.equal(model.store.setLampStyle(id,value,{source:'lamp'}),false);
 for(const target of ['unknown','ble:phone-a','ACB950B2F180'])assert.equal(model.store.setLampStyle(target,'helix',{source:'phone'}),false);
 assert.equal(model.store.setLampStyle(id,'helix',{source:'unknown'}),false);assert.equal(model.saves,0);
 model.store.remove(id);const before=model.saves;assert.equal(model.store.setLampStyle(id,'helix',{source:'phone'}),false);assert.equal(model.saves,before);
});

test('installed firmware accepts bounded triplets and rejects unavailable or malformed values',()=>{
 for(const version of ['1.9.5','1.4.0','0.0.1','65535.65535.65535'])assert.equal(validFirmwareVersion(version),version);
 for(const version of [null,undefined,0,'','0.0.0','v1.9.5','1.9','1.9.5-beta','1.9.5\n','01.9.5','65536.1.0','<script>'])assert.equal(validFirmwareVersion(version),null);
});

test('firmware observations remain per lamp, preserve preferences/order, and save only version changes',()=>{
 const model=setup([{id:'a',name:'BACL',room:'Studio',favorites:[4,47],deviceId:'phone-a'},
  {id:'b',name:'CoolLamp 2',room:'Hall',firmwareVersion:'1.9.4'}]);
 assert.equal(model.store.rememberFirmware('a',{version:'1.9.5',latest:'9.0.0',token:'secret'}).firmwareVersion,'1.9.5');
 assert.equal(model.saves,1);
 model.store.rememberFirmware('a',{version:'1.9.5',latest:'10.0.0'});assert.equal(model.saves,1);
 assert.equal(model.store.items[1].firmwareVersion,'1.9.4');
 assert.deepEqual(model.store.items.map(item=>item.id),['a','b']);
 assert.deepEqual(model.store.items[0].favorites,[4,47]);assert.equal(model.store.items[0].room,'Studio');
 assert.equal(model.store.items[0].token,undefined);assert.equal(model.store.items[0].latest,undefined);
 assert.equal(new LampStore(model.storage).items[0].firmwareVersion,'1.9.5');
 model.store.rememberFirmware('a',{version:'1.9.6'});assert.equal(model.saves,2);
});

test('unknown, removed, unsupported, and latest-only observations cannot create or overwrite records',()=>{
 const model=setup([{id:'a',firmwareVersion:'1.9.4'}]);
 for(const status of [null,{}, {latest:'1.9.5'}, {version:'0.0.0'}, {version:'bad'}])model.store.rememberFirmware('a',status);
 model.store.rememberFirmware('unknown',{version:'1.9.5'});
 assert.equal(model.saves,0);assert.equal(model.store.items[0].firmwareVersion,'1.9.4');
 model.store.remove('a');const saves=model.saves;
 model.store.rememberFirmware('a',{version:'1.9.5'});assert.equal(model.saves,saves);assert.deepEqual(model.store.items,[]);
});

test('card versions distinguish live installed firmware, last seen, unknown, and unsupported',()=>{
 const cached={id:'a',firmwareVersion:'1.9.4'};
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware:{version:'1.9.5',latest:'9.0.0'}}),'Firmware 1.9.5');
 assert.equal(lampFirmwareLabel(cached),'Firmware 1.9.4 · Last seen');
 assert.equal(lampFirmwareLabel({id:'b'}),'Firmware · Connect to view');
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware:null}),'Firmware unavailable');
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware:{latest:'1.9.5'}}),'Firmware unavailable');
 assert.equal(lampFirmwareLabel({firmwareVersion:'bad'}),'Firmware · Connect to view');
});

test('Wi-Fi/Bluetooth identity migration preserves the installed-version observation',()=>{
 const model=setup([{id:'ble:phone-a',deviceId:'phone-a',name:'BACL',room:'Studio'}]);
 model.store.rememberFirmware('ble:phone-a',{version:'1.9.4'});
 model.store.upsertWifi({id:'24eae26e9e9c',address:'http://192.168.1.220'},'ble:phone-a');
 assert.equal(model.store.items.length,1);assert.equal(model.store.items[0].firmwareVersion,'1.9.4');
 assert.equal(model.store.items[0].deviceId,'phone-a');assert.equal(model.store.items[0].room,'Studio');
 model.store.rememberFirmware('24eae26e9e9c',{version:'1.9.5'});
 assert.equal(model.store.items[0].firmwareVersion,'1.9.5');
});

test('connected cards use the latest verified observation without replacing active transport data',()=>{
 const cached={id:'a',firmwareVersion:'1.9.4'};
 const firmware=Object.freeze({version:'1.9.4',latest:'9.9.9'});
 const observation=Object.freeze({verified:true,fresh:true,installedVersion:'1.9.5',checkedAt:20});
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware,firmwareReceivedAt:10,observation}),'Firmware 1.9.5');
 assert.equal(firmware.version,'1.9.4');
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware:{version:'1.9.5'},firmwareReceivedAt:30,
  observation:{verified:true,fresh:true,installedVersion:'1.9.4',checkedAt:20}}),'Firmware 1.9.5');
 // A later active read also wins if the lamp actually returns to older firmware.
 assert.equal(lampFirmwareLabel(cached,{connected:true,firmware,firmwareReceivedAt:30,observation}),'Firmware 1.9.4');
});

test('unverified, stale, untimed or malformed fleet values cannot supersede an active firmware observation',()=>{
 const options={connected:true,firmware:{version:'1.9.4'},firmwareReceivedAt:10};
 for(const observation of [
  {verified:false,fresh:true,installedVersion:'1.9.5',checkedAt:20},
  {verified:true,fresh:false,installedVersion:'1.9.5',checkedAt:20},
  {verified:true,fresh:true,installedVersion:'bad',checkedAt:20},
  {verified:true,fresh:true,installedVersion:'1.9.5'},
  {verified:true,fresh:true,installedVersion:'1.9.5',checkedAt:NaN},
  {verified:true,fresh:true,installedVersion:'1.9.5',checkedAt:10},
 ])assert.equal(lampFirmwareLabel({}, {...options,observation}),'Firmware 1.9.4');
});
