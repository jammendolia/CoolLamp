import test from 'node:test';
import assert from 'node:assert/strict';
import { WifiTransport } from '../src/wifi.js';
import { LampStore, lampAddress } from '../src/lamps.js';

const fixture = () => ({token:'boot-token',deviceId:'aabbccddeeff',hostname:'coollamp-ddeeff.local',name:'Desk',mode:1,brightness:100,power:true,effects:['Rain'],colors:[[1,255,40,70]],effectOptions:[[50,75,0,0,100,255]],firmware:{version:'1.4.0'}});
function setup() {
  const calls=[];let raw=fixture();
  const http={request:async options=>{calls.push(options);return {status:200,data:options.method==='GET'?JSON.stringify(raw):'OK'};}};
  const states=[];const lamp=new WifiTransport(http,{onState:s=>states.push(s)});
  return {lamp,http,calls,states,setRaw:v=>raw=v};
}
test('Wi-Fi maps state and sends authenticated, token-bound form commands',async()=>{
  const {lamp,calls}=setup();
  await lamp.connect('coollamp-ddeeff.local','test-password','aabbccddeeff');
  try {
    assert.equal(lamp.state.color.r,255);assert.equal(lamp.state.capabilities,14);
    await lamp.command('color',{mode:1,r:0,g:0,b:0});
    const post=calls.find(x=>x.method==='POST');
    assert.equal(post.url,'http://coollamp-ddeeff.local/api/color');
    assert.equal(post.headers['X-Lamp-Token'],'boot-token');
    assert.equal(post.data,'mode=1&r=0&g=0&b=0');assert.equal(post.disableRedirects,true);
  }finally{await lamp.disconnect();}
});
test('wrong identity and malformed responses cannot enable controls',async()=>{
  const {lamp,setRaw,states}=setup();
  await assert.rejects(lamp.connect('192.168.1.9','test','different'),/different lamp/);
  assert.equal(states.length,0);setRaw({...fixture(),mode:99});
  await assert.rejects(lamp.connect('192.168.1.9','test'),/Invalid lamp/);
  assert.equal(lamp.raw,null);
});
test('late responses after switching lamps are discarded',async()=>{
  const {lamp,http,states}=setup();await lamp.connect('192.168.1.9','test');
  let complete;http.request=()=>new Promise(resolve=>complete=resolve);
  const pending=lamp.refresh();await lamp.disconnect();
  complete({status:200,data:JSON.stringify(fixture())});
  await assert.rejects(pending,/Connection changed/);assert.equal(states.length,1);assert.equal(lamp.raw,null);
});
test('uncertain writes disconnect and queued commands never replay',async()=>{
  const {lamp,http}=setup();await lamp.connect('192.168.1.9','test');let writes=0;
  http.request=async()=>{writes++;throw new Error('timeout');};
  const first=lamp.command('power',0), second=lamp.command('power',1);
  await assert.rejects(first,/did not respond/);await assert.rejects(second,/Connection changed/);
  assert.equal(writes,1);assert.equal(lamp.state,null);
});
test('server rejection stays visible and does not claim success',async()=>{
  const {lamp,http}=setup();await lamp.connect('192.168.1.9','test');
  http.request=async()=>({status:409,data:'Updater busy'});
  await assert.rejects(lamp.command('power',0),/Updater busy/);assert.equal(lamp.state.power,true);await lamp.disconnect();
});
test('adjusting an off lamp preserves power and older firmware cannot turn it on accidentally',async()=>{
  const {lamp,setRaw,calls}=setup();setRaw({...fixture(),power:false,apiVersion:2});
  await lamp.connect('192.168.1.9','test');await lamp.command('brightness',50);
  assert.equal(new URLSearchParams(calls.find(x=>x.method==='POST').data).get('keepPower'),'1');
  setRaw({...fixture(),power:false});await lamp.refresh();const count=calls.length;
  await assert.rejects(lamp.command('effect',1),/Turn the lamp on first/);assert.equal(calls.length,count);await lamp.disconnect();
});
test('local addresses reject remote hosts, credentials, paths and redirects',()=>{
  for(const address of ['https://lamp.local','example.com','192.168.1.4/evil','user:pass@lamp.local','127.0.0.1','192.168.1.2:443','lamp.local?x=1'])assert.throws(()=>lampAddress(address));
  assert.equal(lampAddress('lamp.local'),'http://lamp.local');assert.equal(lampAddress('192.168.1.4'),'http://192.168.1.4');
});
test('legacy Bluetooth migration runs once and Wi-Fi/BLE identities merge',()=>{
  const data=new Map([['coollamp-device',JSON.stringify({deviceId:'phone-id',name:'Old lamp'})]]);
  const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const store=new LampStore(storage);assert.equal(store.items.length,1);
  store.upsert({id:'aabb',name:'Desk',address:'http://lamp.local',room:'Office'});
  store.upsert({id:'aabb',deviceId:'phone-id'});assert.equal(store.items.length,1);assert.equal(store.items[0].room,'Office');
  store.remove('aabb');assert.equal(new LampStore(storage).items.length,0);
});
test('a firmware upgrade migrates legacy Wi-Fi identity without a duplicate lamp',async()=>{
  const {lamp}=setup();
  await lamp.connect('coollamp-ddeeff.local','test','coollamp-ddeeff');
  const data=new Map();const store=new LampStore({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)});
  store.upsert({id:'coollamp-ddeeff',room:'Office'});
  store.upsert({id:lamp.identity},'coollamp-ddeeff');
  assert.equal(store.items.length,1);assert.equal(store.items[0].room,'Office');await lamp.disconnect();
});

test('Wi-Fi loads lamp-specific categories and speed support and clears them when switching',async()=>{
  const {lamp,http,setRaw}=setup();let count=2;
  setRaw({...fixture(),catalogVersion:1,effects:['Still sky','Spark'],colors:[[1,1,2,3],[1,4,5,6]]});
  const original=http.request;
  http.request=async options=>options.url.endsWith('/api/effects')?{status:200,data:Array.from({length:count},(_,i)=>({id:i+1,name:count===2?(i?'Spark':'Still sky'):'Other lamp effect',category:i?'fire':'calm',speed:Boolean(i)}))}:original(options);
  await lamp.connect('192.168.1.9','test');
  assert.equal(lamp.catalog[0].speed,false);assert.equal(lamp.catalog[1].category,'fire');
  await assert.rejects(lamp.command('color',{mode:3,r:1,g:2,b:3}),/not available/);
  await lamp.disconnect();assert.equal(lamp.catalog,null);
  count=1;setRaw({...fixture(),deviceId:'second',catalogVersion:1});
  await lamp.connect('192.168.1.10','test');assert.equal(lamp.catalog.length,1);assert.equal(lamp.catalog[0].name,'Other lamp effect');
  await lamp.disconnect();
});

test('malformed or late Wi-Fi catalogs cannot populate a new connection',async()=>{
  const {lamp,http,setRaw}=setup();setRaw({...fixture(),catalogVersion:1});const original=http.request;
  http.request=async options=>options.url.endsWith('/api/effects')?{status:200,data:[{id:2,name:'Wrong ID',category:'calm',speed:true}]}:original(options);
  await assert.rejects(lamp.connect('192.168.1.9','test'),/catalog/);assert.equal(lamp.catalog,null);
  let complete,started;const ready=new Promise(r=>started=r);
  http.request=async options=>options.url.endsWith('/api/effects')?new Promise(r=>{complete=r;started();}):original(options);
  const pending=lamp.connect('192.168.1.9','test');await ready;await lamp.disconnect();
  complete({status:200,data:[{id:1,name:'Late',category:'calm',speed:true}]});
  await assert.rejects(pending,/Connection changed/);assert.equal(lamp.catalog,null);
});
