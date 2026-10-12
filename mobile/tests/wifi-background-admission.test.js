import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {WifiTransport} from '../src/wifi.js';

const identity='aabbccddeeff';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const firmware=(version='1.15.1')=>({version,latest:version,phase:0,progress:0,error:0,wifi:true,automatic:false,available:false});
const snapshot=()=>({deviceId:identity,hostname:'coollamp-ddeeff.local',token:'fixture-token',mode:1,brightness:100,power:true,
 effects:['Rain'],catalogVersion:1,colors:[[1,10,20,30]],effectOptions:[[50,70,0,0,0,0]],firmware:firmware()});
const catalog=count=>Array.from({length:count},(_,index)=>({id:index+1,name:index?'Aurora':'Rain',category:'calm',speed:true}));
function fixture(t){
 const calls=[],events=[];let raw=snapshot(),allowed=true,generation=0,handler=null;
 const lamp=new WifiTransport({request:async options=>{
  const path=new URL(options.url).pathname;calls.push({path,method:options.method});
  const overridden=await handler?.(path,options);if(overridden!==undefined)return overridden;
  if(options.method==='POST'){if(path==='/api/power')raw={...raw,power:new URLSearchParams(options.data).get('on')==='1'};return {status:200,data:'OK'};}
  return {status:200,data:JSON.stringify(path==='/api/state'?raw:path==='/api/effects'?catalog(raw.effects.length):raw.firmware)};
 }},{onState:state=>events.push({kind:'state',state}),onFirmware:value=>events.push({kind:'firmware',value}),
  onOptions:value=>events.push({kind:'options',value}),onError:error=>events.push({kind:'error',error}),onDisconnect:()=>events.push({kind:'disconnect'})},
  {backgroundAllowed:()=>allowed,backgroundGeneration:()=>generation});
 t.after(()=>lamp.disconnect());
 return {lamp,calls,events,get raw(){return raw;},setRaw:value=>{raw=value;},setHandler:value=>{handler=value;},
  hold:()=>{allowed=false;generation++;},resume:()=>{allowed=true;},advance:()=>{generation++;},setAllowed:value=>{allowed=value;},
  guard:()=>allowed,connect:async()=>{await lamp.connect('192.168.1.20','fixture-password',identity);calls.length=0;events.length=0;}};
}
const paths=f=>f.calls.map(value=>value.path);
const cancelled=error=>error.backgroundCancelled===true&&error.cancelled===true&&error.confirmed===true;

test('automatic suppression performs no I/O and reschedules fresh polling after the firmware hold',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();f.hold();
 t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);assert.equal(f.lamp.identity,identity);
 t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(f.calls,[]);
 f.resume();t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(paths(f),['/api/firmware','/api/state']);
 assert(f.events.some(value=>value.kind==='state'));assert(!f.events.some(value=>['error','disconnect'].includes(value.kind)));
});

for(const releasedBeforeQueue of [false,true])test('an automatic poll queued before an update never runs in a later generation, hold released='+releasedBeforeQueue,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();const gate=deferred();
 const prior=f.lamp.enqueue(()=>gate.promise);t.mock.timers.tick(2500);await nextTurn();
 f.hold();if(releasedBeforeQueue)f.resume();gate.resolve();await prior;await nextTurn();
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);assert.equal(f.lamp.identity,identity);
 f.resume();t.mock.timers.tick(2500);await nextTurn();assert.deepEqual(paths(f),['/api/firmware','/api/state']);
});

for(const reply of ['valid','malformed','rejected'])test('a started compact read cannot adopt state, issue another query or disconnect after a hold: '+reply,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw;
 f.setHandler(path=>{if(path==='/api/firmware'){entered.resolve();return gate.promise;}});
 t.mock.timers.tick(2500);await entered.promise;f.hold();
 if(reply==='rejected')gate.reject(Error('Private native details.'));
 else gate.resolve({status:200,data:reply==='malformed'?'invalid JSON':JSON.stringify({...firmware(),phase:3,progress:20})});
 await nextTurn();assert.deepEqual(paths(f),['/api/firmware']);assert.equal(f.lamp.raw,oldRaw);
 assert.equal(f.lamp.raw.firmware.phase,0);assert.deepEqual(f.events,[]);assert.equal(f.lamp.identity,identity);
});

test('generation change fences an already-started native read even when admission has reopened',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);const gate=deferred(),entered=deferred();
 f.setHandler(path=>{if(path==='/api/firmware'){entered.resolve();return gate.promise;}});
 const poll=f.lamp.poll();await entered.promise;f.advance();gate.resolve({status:200,data:JSON.stringify({...firmware(),phase:3})});
 await assert.rejects(poll,cancelled);assert.deepEqual(paths(f),['/api/firmware']);assert.deepEqual(f.events,[]);assert.equal(f.lamp.raw.firmware.phase,0);
});

test('firmware version refresh keeps its guard through state and catalog reload',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);const gate=deferred(),entered=deferred(),oldCatalog=f.lamp.catalog,oldRaw=f.lamp.raw;
 f.setRaw({...f.raw,token:'next-token',firmware:firmware('1.16.0')});
 f.setHandler(path=>{if(path==='/api/state'){entered.resolve();return gate.promise;}});
 const poll=f.lamp.poll();await entered.promise;f.hold();gate.resolve({status:200,data:JSON.stringify(f.raw)});
 await assert.rejects(poll,cancelled);assert.deepEqual(paths(f),['/api/firmware','/api/state']);
 assert.equal(f.lamp.raw,oldRaw);assert.equal(f.lamp.catalog,oldCatalog);assert.deepEqual(f.events,[]);
});

test('a stopped catalog read cannot adopt its entries or recurse into another state request',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw,oldCatalog=f.lamp.catalog;
 f.setRaw({...f.raw,token:'next-token',effects:['Rain','Aurora']});
 f.setHandler(path=>{if(path==='/api/effects'){entered.resolve();return gate.promise;}});
 const poll=f.lamp.poll();await entered.promise;f.hold();gate.resolve({status:200,data:JSON.stringify(catalog(1))});
 await assert.rejects(poll,cancelled);assert.deepEqual(paths(f),['/api/firmware','/api/state','/api/effects']);
 assert.equal(f.lamp.raw,oldRaw);assert.equal(f.lamp.catalog,oldCatalog);assert.deepEqual(f.events.map(value=>value.kind),['firmware']);
});

test('normal catalog size retry retains the admission guard on its second read',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);let stateReads=0;const gate=deferred(),entered=deferred(),oldRaw=f.lamp.raw;
 f.setRaw({...f.raw,token:'next-token',effects:['Rain','Aurora']});
 f.setHandler(path=>{
  if(path==='/api/effects')return {status:200,data:JSON.stringify(catalog(1))};
  if(path==='/api/state'&&++stateReads===2){entered.resolve();return gate.promise;}
 });
 const poll=f.lamp.poll();await entered.promise;f.hold();gate.resolve({status:200,data:JSON.stringify(f.raw)});
 await assert.rejects(poll,cancelled);assert.deepEqual(paths(f),['/api/firmware','/api/state','/api/effects','/api/state']);
 assert.equal(f.lamp.raw,oldRaw);assert.deepEqual(f.events.map(value=>value.kind),['firmware']);
});

test('manual refresh and absolute mutations remain usable during background suppression and never replay an uncertain POST',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);f.hold();
 await f.lamp.refresh();await f.lamp.refreshFirmware();await f.lamp.command('power',0);
 assert.deepEqual(paths(f),['/api/state','/api/firmware','/api/power','/api/state']);assert.equal(f.lamp.state.power,false);
 const before=f.calls.length;f.setHandler((path,options)=>{if(path==='/api/power'&&options.method==='POST')throw Error('Reply lost.');});
 await assert.rejects(f.lamp.command('power',1),error=>error.uncertain===true);
 assert.deepEqual(f.calls.slice(before),[{path:'/api/power',method:'POST'}]);assert.equal(f.lamp.identity,null);
});

test('connect guard stops after state and before catalog or callbacks',async t=>{
 const f=fixture(t),gate=deferred(),entered=deferred();
 f.setHandler(path=>{if(path==='/api/state'){entered.resolve();return gate.promise;}});
 const connecting=f.lamp.connect('192.168.1.20','fixture-password',identity,{guard:f.guard});
 await entered.promise;f.hold();gate.resolve({status:200,data:JSON.stringify(f.raw)});
 await assert.rejects(connecting,cancelled);assert.deepEqual(paths(f),['/api/state']);assert.equal(f.lamp.identity,null);
 assert(!f.events.some(value=>['state','firmware','options','error'].includes(value.kind)));
});

test('a late catalog from guarded connect cannot adopt state or disconnect a replacement connection',async t=>{
 const f=fixture(t),gate=deferred(),entered=deferred();let catalogs=0;
 f.setHandler(path=>{if(path==='/api/effects'&&++catalogs===1){entered.resolve();return gate.promise;}});
 const old=f.lamp.connect('192.168.1.20','fixture-password',identity,{guard:f.guard});await entered.promise;
 await f.lamp.connect('192.168.1.21','fixture-password',identity);clearTimeout(f.lamp.timer);const replacement=f.lamp.raw,epoch=f.lamp.epoch;
 gate.resolve({status:200,data:JSON.stringify(catalog(1))});await assert.rejects(old,cancelled);
 assert.equal(f.lamp.epoch,epoch);assert.equal(f.lamp.raw,replacement);assert.equal(f.lamp.identity,identity);
 assert.equal(f.events.filter(value=>value.kind==='state').length,1);
});

test('a held lane cannot surface a callback after an earlier callback starts the firmware task',async t=>{
 const f=fixture(t);await f.connect();clearTimeout(f.lamp.timer);f.lamp.callbacks.onFirmware=()=>f.hold();
 await assert.rejects(f.lamp.poll(),cancelled);assert.deepEqual(paths(f),['/api/firmware']);assert(!f.events.some(value=>value.kind==='state'));
});

test('automatic errors cannot trigger recovery after disconnect cleanup starts a firmware task',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.connect();
 f.lamp.callbacks.onDisconnect=()=>{f.events.push({kind:'disconnect'});f.hold();};
 f.setHandler(()=>({status:401,data:'fixture rejection'}));
 t.mock.timers.tick(2500);await nextTurn();
 assert.deepEqual(paths(f),['/api/firmware']);assert.deepEqual(f.events.map(value=>value.kind),['disconnect']);
});
