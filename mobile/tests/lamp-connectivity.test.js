import test from 'node:test';
import assert from 'node:assert/strict';
import {LampConnectivity,wifiObservation,wifiSignalArcs,validWifiRssi} from '../src/lamp-connectivity.js';

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
