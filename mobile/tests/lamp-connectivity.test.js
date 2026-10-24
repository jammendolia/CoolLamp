import test from 'node:test';
import assert from 'node:assert/strict';
import {LampConnectivity,wifiObservation,wifiSignalArcs,validWifiRssi,groupObservation,groupCardPresentation} from '../src/lamp-connectivity.js';

function setup(){
  let now=1000,entries=[{id:'aabbccddeeff',address:'http://192.168.1.20',deviceId:'phone-uuid'},{id:'112233445566',address:'http://192.168.1.21'}];
  const changes=[],cache=new LampConnectivity({getLamps:()=>entries,now:()=>now,ttl:100,onStatus:(id,value)=>changes.push({id,...value})});
  return {cache,changes,id:entries[0].id,other:entries[1].id,setNow:value=>now=value,setEntries:value=>entries=value,entries:()=>entries};
}
test('signal arcs use negative RSSI boundaries; zero, text and invalid measurements stay unknown',()=>{
  for(const [rssi,arcs] of [[-1,3],[-55,3],[-56,2],[-67,2],[-68,1],[-80,1],[-81,0],[-127,0]])assert.equal(wifiSignalArcs(rssi),arcs);
  for(const bad of [0,1,-128,NaN,Infinity,null,'-50',{},-55.5]){assert.equal(validWifiRssi(bad),null);assert.equal(wifiSignalArcs(bad),0);}
});
test('diagnostics are whitelisted; connected false discards stale RSSI and arbitrary nested data',()=>{
  assert.deepEqual(wifiObservation({wifi:{connected:true,rssi:-58,token:'private',ssid:'private'}}),{connected:true,rssi:-58});
  assert.deepEqual(wifiObservation({wifi:{connected:false,rssi:0}}),{connected:false,rssi:null});
  assert.deepEqual(wifiObservation({connected:true,firmware:{wifi:false}}),{connected:true});
  assert.deepEqual(wifiObservation({firmware:{wifi:false}}),{connected:false});
  assert.equal(wifiObservation({wifi:{connected:'true'},connected:'false'}),null);
});
test('saved/discovered lamps start unknown and only identity-matched evidence changes that card',()=>{
  const {cache,id,other,changes}=setup();
  assert.equal(cache.get(id).wifi.state,'unknown');
  assert.equal(cache.observe(id,{deviceId:other,wifi:{connected:true,rssi:-40}}),false);
  assert.equal(cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-60}}),true);
  assert.deepEqual([cache.get(id).wifi.state,cache.get(id).wifi.arcs,cache.get(id).wifi.rssi],['connected',2,-60]);
  assert.equal(cache.get(other).wifi.state,'unknown');assert.equal(changes.length,1);
});
test('only confirmed offline gets a slash state; failed reads and expired evidence become unknown',()=>{
  const {cache,id,setNow}=setup();
  cache.observe(id,{deviceId:id,wifi:{connected:false,rssi:-40}});
  assert.equal(cache.get(id).wifi.state,'disconnected');assert.equal(cache.get(id).wifi.rssi,null);
  setNow(1101);assert.equal(cache.get(id).wifi.state,'unknown');
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-40}});
  cache.invalidate(id);assert.equal(cache.get(id).wifi.state,'unknown');
});
test('fresh boolean-only BLE evidence never renews old signal strength',()=>{
  const {cache,id,setNow}=setup();
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-58},source:'diagnostics'});
  setNow(1080);cache.observe(id,{deviceId:id,wifi:{connected:true},source:'firmware'});
  assert.equal(cache.get(id).wifi.strengthKnown,true);
  setNow(1101);assert.equal(cache.get(id).wifi.state,'connected');assert.equal(cache.get(id).wifi.strengthKnown,false);
  cache.observe(id,{deviceId:id,wifi:{connected:false},source:'ble-wifi'});
  setNow(1102);cache.observe(id,{deviceId:id,wifi:{connected:true},source:'ble-wifi'});
  assert.equal(cache.get(id).wifi.strengthKnown,false);
});
test('older results, future timestamps and failed old requests cannot override newer BLE evidence',()=>{
  const {cache,id,setNow}=setup();
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-50}});
  setNow(1050);cache.observe(id,{deviceId:id,wifi:{connected:false},source:'ble-wifi'});
  assert.equal(cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-40},checkedAt:1000}),false);
  assert.equal(cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-40},checkedAt:3000}),false);
  assert.equal(cache.invalidate(id,{attemptedAt:1000}),false);assert.equal(cache.get(id).wifi.state,'disconnected');
});
test('removal, address or Bluetooth identity changes invalidate previous observations',()=>{
  const {cache,id,setEntries,entries}=setup();
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-50}});
  setEntries(entries().map(entry=>entry.id===id?{...entry,address:'http://192.168.1.30'}:entry));
  assert.equal(cache.get(id).wifi.state,'unknown');
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-60}});cache.forget(id);
  assert.equal(cache.get(id).wifi.state,'unknown');
  setEntries([]);assert.equal(cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-40}}),false);
});

test('group evidence allows one verified role and leader and never retains invitation keys',()=>{
  const id='aabbccddeeff',leader='112233445566';
  assert.deepEqual(groupObservation({deviceId:id,sync:{version:2,role:0,leader:'',key:'private'}}),{role:0,leader:null});
  assert.deepEqual(groupObservation({deviceId:id,sync:{version:2,role:1,leader:id}}),{role:1,leader:id});
  assert.deepEqual(groupObservation({deviceId:id,sync:{version:2,role:2,leader,key:'private'}}),{role:2,leader});
  for(const sync of [{version:2,role:1,leader},{version:2,role:2,leader:id},{version:3,role:0},{version:2,role:'2',leader},{version:2,role:2,leader:'private'}])assert.equal(groupObservation({deviceId:id,sync}),null);
});
test('membership has independent freshness and exact identity guards; Wi-Fi cannot renew it',()=>{
  const {cache,id,other,setNow}=setup();
  assert.equal(cache.get(id).group.state,'unknown');
  assert.equal(cache.observeGroup(id,{deviceId:other,group:{role:1,leader:id}}),false);
  cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,key:'private'}});
  assert.equal(cache.get(id).group.state,'follower');assert.equal(cache.get(id).group.leader,other);
  setNow(1080);cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-58}});
  setNow(1101);assert.equal(cache.get(id).wifi.state,'connected');assert.equal(cache.get(id).group.state,'unknown');
  cache.observeGroup(id,{deviceId:id,group:{role:0}});assert.equal(cache.get(id).group.state,'independent');
  assert(!JSON.stringify(cache.get(id)).includes('private'));
});

test('expanded groups require a valid negotiated capacity and retain exact membership guards',()=>{
  const {cache,id,other,setNow}=setup();
  const sync={version:3,maxMembers:32,role:2,leader:other,active:true,paused:false,transport:'esp-now',key:'private'};
  assert.deepEqual(groupObservation({deviceId:id,sync}),{role:2,leader:other,active:true,paused:false,transport:'esp-now'});
  assert(cache.observeGroup(id,{deviceId:id,group:sync}));
  assert.equal(cache.get(id).group.state,'follower');
  assert.equal(groupCardPresentation(cache.get(id).group).badge,'NOW');
  for(const maxMembers of [undefined,0,33,32.5,'32'])assert.equal(groupObservation({deviceId:id,sync:{...sync,maxMembers}}),null);
  for(const patch of [{leader:id},{role:1,leader:other},{version:4}])assert.equal(groupObservation({deviceId:id,sync:{...sync,...patch}}),null);
  assert.equal(cache.observeGroup(id,{deviceId:id,group:{...sync,maxMembers:33}}),false);
  assert(!JSON.stringify(cache.get(id)).includes('private'));
  setNow(1101);assert.equal(cache.get(id).group.state,'unknown');
});
test('late membership, old failed requests and removal cannot overwrite or revive newer membership',()=>{
  const {cache,id,other,setNow}=setup();
  cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other}});
  setNow(1050);cache.observeGroup(id,{deviceId:id,group:{role:0}});
  assert.equal(cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other},checkedAt:1000}),false);
  assert.equal(cache.invalidateGroup(id,{attemptedAt:1000}),false);assert.equal(cache.get(id).group.state,'independent');
  cache.forget(id);assert.equal(cache.get(id).group.state,'unknown');
});

test('active coordination path is independent of AP association and phone connectivity',()=>{
  const {cache,id,other}=setup();
  cache.observe(id,{deviceId:id,wifi:{connected:true,rssi:-40}});
  cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,active:true,paused:false,transport:'esp-now',key:'private'}});
  assert.equal(groupCardPresentation(cache.get(id).group).badge,'NOW');
  assert.equal(cache.get(id).wifi.state,'connected');
  cache.observe(id,{deviceId:id,wifi:{connected:false}});
  assert.equal(groupCardPresentation(cache.get(id).group).transport,'esp-now');
  cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,active:true,paused:false,transport:'udp'}});
  assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
  assert.equal(groupCardPresentation(cache.get(id).group).detail,'Following via Wi-Fi UDP');
  assert(!JSON.stringify(cache.get(id)).includes('private'));
});

test('pause, waiting, available hybrid interfaces and missing metadata never claim ESP-NOW following',()=>{
  const {cache,id,other}=setup();
  for(const patch of [{active:false},{paused:true},{transport:'hybrid'},{transport:'none'},{active:undefined},{paused:undefined},{transport:2}]){
    cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,active:true,paused:false,transport:'esp-now',...patch}});
    assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
  }
  cache.observeGroup(id,{deviceId:id,group:{role:1,leader:id,active:false,paused:false,transport:'hybrid'}});
  assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
  assert.match(groupCardPresentation(cache.get(id).group).detail,/supports Wi-Fi UDP and ESP-NOW/);
});

test('a membership-only observation, expired evidence or changed address cannot retain an active radio badge',()=>{
  const {cache,id,other,setNow,setEntries,entries}=setup();
  const observe=()=>cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,active:true,paused:false,transport:'esp-now'}});
  observe();setNow(1101);assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
  observe();cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other}});
  assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
  observe();setEntries(entries().map(entry=>entry.id===id?{...entry,address:'http://192.168.1.99'}:entry));
  assert.equal(groupCardPresentation(cache.get(id).group).badge,null);
});

test('late or wrong-device telemetry cannot replace a fresh accepted ESP-NOW path',()=>{
  const {cache,id,other,setNow}=setup();setNow(1050);
  cache.observeGroup(id,{deviceId:id,group:{role:2,leader:other,active:true,paused:false,transport:'esp-now'}});
  assert.equal(cache.observeGroup(id,{deviceId:other,group:{role:2,leader:other,active:true,paused:false,transport:'udp'}}),false);
  assert.equal(cache.observeGroup(id,{deviceId:id,checkedAt:1000,group:{role:2,leader:other,active:true,paused:false,transport:'udp'}}),false);
  assert.equal(groupCardPresentation(cache.get(id).group).badge,'NOW');
});
