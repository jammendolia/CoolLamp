import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeWifiBroker} from '../src/bridge-wifi.js';
import {MeshTransport,meshBridgeSupported} from '../src/mesh.js';
import {BRIDGE_MODEL} from '../src/bridge-accessory.js';

const bridge='112233445566',target='aabbccddeeff',fleet='1111111111111111',bridgeBoot='2222222222222222',targetBoot='3333333333333333',token='0123456789abcdef0123456789abcdef';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let n=0;n<10;n++)await new Promise(done=>setTimeout(done,1));};
function fixture(options={}){
 const calls=[],transactions=new Map(),f={mutations:0};let sequence=0;
 const status={role:'bridge',deviceId:bridge,name:'Household bridge',fleetId:fleet,meshEnabled:true,token};
 const descriptor={role:'bridge',deviceId:bridge,name:'Household bridge',firmwareVersion:'0.2.2',model:{id:BRIDGE_MODEL},capabilities:['mesh-control','trusted-cached-donation']};
 const mesh={version:1,deviceId:bridge,fleetId:fleet,boot:bridgeBoot,available:true,peers:[{id:target,name:'Leaf',boot:targetBoot,online:true,hops:2}]};
 const raw={deviceId:target,hostname:'coollamp-target.local',name:'é'.repeat(130),mode:1,brightness:100,power:true,leds:67,effects:['Leaf rain'],firmware:{version:'1.15.3'},sync:{version:2,role:2,leader:'999999999999',active:true,paused:false,scene:0,key:'never-retain-group-secret'},colors:[[1,1,2,3]],effectOptions:[[50,75,0,4,5,6]],token:'never-retain-lamp-token'};
 const http={request:async request=>{
  calls.push(request);assert.equal(request.disableRedirects,true);assert.equal(request.responseType,'text');assert(request.connectTimeout<=4000&&request.readTimeout<=8000);
  assert.equal(request.headers.Authorization,'Basic '+btoa('OWNER:private-password'));
  const path=new URL(request.url).pathname,fields=request.data?Object.fromEntries(new URLSearchParams(request.data)):undefined;
  if(f.gate&&f.gatePath===path)await f.gate.promise;if(f.failPath===path)throw Error('native error with sensitive implementation detail');let value;
  if(path==='/api/bridge/status'||path==='/api/state')value={...status,...f.statusPatch};
  else if(path==='/api/descriptor')value={...descriptor,...f.descriptorPatch};
  else if(path==='/api/mesh/status')value={...mesh,...f.meshPatch};
  else if(path==='/api/mesh/request'){
   assert.equal(request.headers['X-Lamp-Token'],token);assert.equal(request.method,'POST');assert.equal(fields.target,target);assert(!transactions.has(fields.requestId),'a relay request ID was replayed');
   if(f.excluded&&fields.method==='2'&&fields.endpoint!=='44')value={version:1,target,requestId:fields.requestId,status:'rejected',executed:false,httpStatus:409};
   else{
    const content=fields.endpoint==='1'?JSON.stringify(raw):fields.endpoint==='26'?JSON.stringify([{id:1,name:raw.effects[0],category:'calm',speed:true}]):fields.endpoint==='44'?JSON.stringify({receiptVersion:1,executed:true,persisted:true}):'Lamp confirmed.';
    transactions.set(fields.requestId,{...fields,content});if(fields.method==='2'&&fields.endpoint!=='44'){f.mutations++;if(fields.endpoint==='31')raw.power=new URLSearchParams(fields.body).get('on')==='1';}
    if(f.lostMutation&&fields.method==='2')throw Error('final relay reply lost');value={version:1,target,requestId:fields.requestId,status:'pending',executed:false};
   }
  }else if(path==='/api/mesh/result'){
   assert.equal(request.headers['X-Lamp-Token'],token);assert.equal(request.method,'POST');const tx=transactions.get(fields.requestId);assert(tx);
   const bytes=new TextEncoder().encode(tx.content),offset=Number(fields.offset),part=bytes.slice(offset,offset+256);
   value={version:1,target,requestId:fields.requestId,targetBoot,status:'ok',executed:true,httpStatus:200,total:bytes.length,offset,data:btoa(String.fromCharCode(...part)),...f.replyPatch};
  }else throw Error('Unexpected bridge route');
  f.advanceClock?.(path);return {status:f.httpStatus||200,data:f.responseText===undefined?JSON.stringify(value):f.responseText,url:f.finalUrl||request.url};
 }};
 const broker=new BridgeWifiBroker(http,{expectedFleetId:fleet,timeout:200,...options});
 const lamp=new MeshTransport({timeout:250,pollInterval:1,id:()=> (++sequence).toString(16).padStart(16,'0')});
 return Object.assign(f,{broker,lamp,http,status,descriptor,mesh,raw,calls,transactions,connect:(extra={})=>broker.connect('192.168.1.197','private-password',bridge,extra),relayPosts:()=>calls.filter(call=>new URL(call.url).pathname==='/api/mesh/request')});
}
async function connected(t){const f=fixture();await f.connect();await f.lamp.connect(target,{lamp:f.broker,release:()=>f.broker.disconnect()},{poll:false});t.after(()=>f.lamp.disconnect());return f;}

test('bridge connection verifies exact owner status, descriptor and radio fleet/boot with three read-only GETs',async()=>{
 const f=fixture();await f.connect();assert.deepEqual(f.calls.map(call=>[new URL(call.url).pathname,call.method]),[['/api/bridge/status','GET'],['/api/descriptor','GET'],['/api/mesh/status','GET']]);assert.equal(f.broker.isBridge,true);assert.equal(f.broker.identity,bridge);assert.equal(f.broker.raw.name,'Household bridge');assert.equal(meshBridgeSupported(f.broker),true);assert.equal(f.mutations,0);await f.broker.disconnect();
});
test('missing household metadata, remote address, wrong credentials and redirects fail without provisioning',async()=>{
 const absent=fixture();await assert.rejects(absent.connect({expectedFleetId:null}),/Find this bridge/);assert.equal(absent.calls.length,0);
 const remote=fixture();await assert.rejects(remote.broker.connect('example.com','private-password',bridge));assert.equal(remote.calls.length,0);
 for(const code of [401,403]){const f=fixture();f.httpStatus=code;await assert.rejects(f.connect(),error=>error.confirmed===true&&error.status===code);assert.equal(f.calls.length,1);assert.equal(f.broker.raw,null);}
 const redirect=fixture();redirect.finalUrl='http://192.168.1.198/api/bridge/status';await assert.rejects(redirect.connect());assert.equal(redirect.calls.length,1);
});
test('wrong bridge identity, fleet, role, model or microphone-shaped lamp descriptor cannot become a broker',async()=>{
 for(const [field,patch]of [['statusPatch',{deviceId:target}],['statusPatch',{fleetId:targetBoot}],['statusPatch',{role:'lamp'}],['descriptorPatch',{deviceId:target}],['descriptorPatch',{model:{id:'coollamp.lamp'}}],['descriptorPatch',{effects:[]}],['meshPatch',{deviceId:target}],['meshPatch',{fleetId:targetBoot}],['meshPatch',{boot:'0'.repeat(16)}]]){const f=fixture();f[field]=patch;await assert.rejects(f.connect());assert.equal(f.broker.raw,null);assert.equal(f.mutations,0);}
});
test('unknown roles/capabilities, sixteen-peer bounds and malformed/truncated replies fail closed',async()=>{
 for(const patch of [{peers:Array.from({length:17},()=>({id:target,boot:targetBoot,online:true,hops:1}))},{peers:[{id:target,boot:targetBoot,online:true,hops:5}]},{peers:[{id:target,boot:targetBoot,online:'yes',hops:1}]}]){const f=fixture();f.meshPatch=patch;await assert.rejects(f.connect());}
 for(const text of ['{incomplete','x'.repeat(8193)]){const f=fixture();f.responseText=text;await assert.rejects(f.connect());assert.equal(f.calls.length,1);}
});
test('real Broker plus MeshTransport validates paged UTF8 leaf state/catalog and odd geometry independently',async t=>{
 const f=await connected(t);assert.equal(f.lamp.identity,target);assert.equal(f.broker.identity,bridge);assert.equal(f.lamp.raw.leds,67);assert.equal(f.lamp.raw.name,f.raw.name);assert.equal(f.lamp.catalog[0].name,'Leaf rain');assert.equal(f.lamp.raw.sync.role,2);assert(!JSON.stringify(f.lamp.raw).includes('never-retain'));assert.equal(f.mutations,0);
 assert(f.calls.filter(call=>new URL(call.url).pathname==='/api/mesh/result').some(call=>Number(new URLSearchParams(call.data).get('offset'))>=256));
});
test('leaf mutation owns one relay request and confirms target execution through original pages',async t=>{
 const f=await connected(t);await f.lamp.request('/api/power',{on:0});assert.equal(f.mutations,1);assert.equal(f.raw.power,false);assert.equal(f.relayPosts().filter(call=>new URLSearchParams(call.data).get('method')==='2').length,1);
});
test('lost relay ACK preserves uncertainty and never automatically retries a possibly executed mutation',async t=>{
 const f=await connected(t);f.lostMutation=true;await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true);assert.equal(f.mutations,1);assert.equal(f.relayPosts().filter(call=>new URLSearchParams(call.data).get('method')==='2').length,1);assert.equal(f.raw.power,false);
});
test('wrong target, request, frame offset or target boot cannot confirm a leaf command',async t=>{
 for(const patch of [{target:bridge},{requestId:bridgeBoot},{offset:1},{targetBoot:bridgeBoot}]){const f=await connected(t);f.replyPatch=patch;await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.uncertain===true);assert.equal(f.mutations,1);}
});
test('source address, owner token, fleet or radio boot changes fence the original route',async()=>{
 for(const change of [f=>{f.broker.base='http://192.168.1.198';},f=>{f.statusPatch={token:'f'.repeat(32)};},f=>{f.meshPatch={fleetId:targetBoot};},f=>{f.meshPatch={boot:targetBoot};}]){const f=fixture();await f.connect();change(f);await assert.rejects(f.broker.request(f.statusPatch?'/api/state':'/api/mesh/status'));assert.equal(f.mutations,0);await f.broker.disconnect();}
});
test('read-only connect deadline is total across all stages and late native completion is ignored',async()=>{
 const f=fixture({timeout:30});f.gate=deferred();f.gatePath='/api/bridge/status';const started=Date.now();await assert.rejects(f.connect(),error=>error.requestDeadline===true);assert(Date.now()-started<500);assert.equal(f.calls.length,1);f.gate.resolve();await flush();assert.equal(f.calls.length,1);assert.equal(f.broker.identity,null);
});
test('canceling selection before queued dispatch prevents any relay packet',async()=>{
 const f=fixture();await f.connect();const before=f.calls.length;let current=true;await assert.rejects(f.broker.request('/api/mesh/request',{target,requestId:'aaaaaaaaaaaaaaaa',endpoint:31,method:2,body:'on=0'},f.broker.epoch,()=>{current=false;},()=>{if(!current)throw Error('Selection changed.');}));assert.equal(f.calls.length,before+1,'one identity-only preflight is permitted');assert.equal(f.relayPosts().length,0);assert.equal(f.mutations,0);await f.broker.disconnect();
});
test('disconnect/cancel after dispatch never replays and keeps the target outcome uncertain',async t=>{
 const f=await connected(t);f.gate=deferred();f.gatePath='/api/mesh/request';const changing=f.lamp.request('/api/power',{on:0});await flush();await f.broker.disconnect();await assert.rejects(changing,error=>error.uncertain===true);f.gate.resolve();await flush();assert.equal(f.mutations,1);assert.equal(f.relayPosts().filter(call=>new URLSearchParams(call.data).get('method')==='2').length,1);
});
test('read connect cancellation clears session and cannot publish a late verified broker',async()=>{
 const f=fixture(),controller=new AbortController();f.gate=deferred();f.gatePath='/api/descriptor';const connecting=f.connect({signal:controller.signal});await flush();controller.abort();await assert.rejects(connecting,error=>error.cancelled===true);f.gate.resolve();await flush();assert.equal(f.broker.raw,null);assert.equal(f.calls.length,2);
});
test('arbitrary provisioning, uploads and pairing endpoints are rejected before network dispatch',async()=>{
 const f=fixture();await f.connect();const count=f.calls.length;
 for(const path of ['/api/bridge/wifi','/api/mesh/new','/api/mesh/enroll/start','/api/firmware/upload/prepare','/update','/api/effects'])await assert.rejects(f.broker.request(path,{}),error=>error.confirmed===true&&error.needsDirectConnection===true);
 for(const endpoint of [19,20,22,24,36,37,38,39])await assert.rejects(f.broker.request('/api/mesh/request',{target,requestId:'aaaaaaaaaaaaaaaa',endpoint,method:2,body:''}),error=>error.needsDirectConnection===true);assert.equal(f.calls.length,count);await f.broker.disconnect();
});
test('new control mutations are refused after bridge removal while original receipt/state reads remain available',async t=>{
 const f=await connected(t);f.excluded=true;const count=f.mutations;await assert.rejects(f.lamp.request('/api/power',{on:0}),error=>error.confirmed===true&&error.uncertain!==true);assert.equal(f.mutations,count);assert.equal(JSON.parse(await f.lamp.request('/api/state')).deviceId,target);const result=JSON.parse(await f.lamp.request('/api/receipt',{id:'7777777777777777'}));assert.equal(result.persisted,true);assert.equal(f.mutations,count);
});
test('expired bridge epoch and request/body bounds fail before dispatch',async()=>{
 const f=fixture();await f.connect();const count=f.calls.length,old=f.broker.epoch;
 await assert.rejects(f.broker.request('/api/mesh/request',{target,requestId:'aaaaaaaaaaaaaaaa',endpoint:31,method:2,body:'x'.repeat(1023)}));await assert.rejects(f.broker.request('/api/mesh/result',{target,requestId:'aaaaaaaaaaaaaaaa',offset:8193}));assert.equal(f.calls.length,count);await f.broker.disconnect();await assert.rejects(f.broker.request('/api/mesh/status',undefined,old));
});
test('each new relay command checks the existing bridge identity/token before submitting, without token refresh',async()=>{
 for(const patch of [{deviceId:target},{fleetId:targetBoot},{token:'f'.repeat(32)}]){const f=fixture();await f.connect();f.statusPatch=patch;await assert.rejects(f.broker.request('/api/mesh/request',{target,requestId:'aaaaaaaaaaaaaaaa',endpoint:31,method:2,body:'on=0'}));assert.equal(f.relayPosts().length,0);assert.equal(f.mutations,0);assert.equal(f.broker.identity,null);}
});
test('multi-stage connection consumes one deadline instead of resetting it per GET',async()=>{
 let clock=100000;const f=fixture({timeout:30,now:()=>clock});f.advanceClock=path=>{clock+=path==='/api/bridge/status'?10:25;};await assert.rejects(f.connect(),error=>error.requestDeadline===true);assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/bridge/status','/api/descriptor']);
});
test('the broker has two bounded request owners and rejects excess work before dispatch',async()=>{
 const f=fixture();await f.connect();f.gate=deferred();f.gatePath='/api/mesh/status';const first=f.broker.request('/api/mesh/status'),second=f.broker.request('/api/mesh/status');await flush();const before=f.calls.length;await assert.rejects(f.broker.request('/api/mesh/status'),error=>error.confirmed===true&&error.status===503);assert.equal(f.calls.length,before);await f.broker.disconnect();await assert.rejects(first);await assert.rejects(second);f.gate.resolve();await flush();
});
test('ignored native aborts retain both flights across disconnect and replacement brokers until actual settlement',async()=>{
 const f=fixture();await f.connect();f.gate=deferred();f.gatePath='/api/mesh/status';
 const results=[f.broker.request('/api/mesh/status'),f.broker.request('/api/mesh/status')].map(promise=>promise.then(value=>({value}),error=>({error})));await flush();assert.equal(f.broker.nativeFlights.size,2);
 await f.broker.disconnect();for(const result of await Promise.all(results))assert.equal(result.error.cancelled,true);assert.equal(f.broker.active.size,0);assert.equal(f.broker.nativeFlights.size,2);
 const count=f.calls.length,replacement=new BridgeWifiBroker(f.http,{expectedFleetId:fleet,timeout:100});
 for(let attempt=0;attempt<3;attempt++)await assert.rejects((attempt===1?replacement:f.broker).connect('192.168.1.197','private-password',bridge),error=>error.busy===true&&error.status===503);
 assert.equal(f.calls.length,count,'reconnecting reused a logically freed but physically owned slot');f.gate.resolve();await flush();assert.equal(f.broker.nativeFlights.size,0);assert.equal(f.broker.raw,null);assert.equal(replacement.raw,null);
 await replacement.connect('192.168.1.197','private-password',bridge);assert.equal(replacement.raw.deviceId,bridge);await replacement.disconnect();
});
test('ignored native connect timeouts permit only two outstanding calls, including newly constructed clients',async()=>{
 const f=fixture({timeout:25});f.gate=deferred();f.gatePath='/api/bridge/status';
 await assert.rejects(f.connect(),error=>error.requestDeadline===true);await assert.rejects(f.connect(),error=>error.requestDeadline===true);assert.equal(f.calls.length,2);assert.equal(f.broker.nativeFlights.size,2);
 const replacement=new BridgeWifiBroker(f.http,{expectedFleetId:fleet,timeout:25});await assert.rejects(replacement.connect('192.168.1.197','private-password',bridge),error=>error.busy===true);assert.equal(f.calls.length,2);f.gate.resolve();await flush();assert.equal(f.broker.nativeFlights.size,0);assert.equal(f.broker.raw,null);assert.equal(replacement.raw,null);
});
test('acquisition scope explicitly hands a verified broker to stable leaf ownership, retaining future fences',async()=>{
 const f=fixture(),acquisition=new AbortController();let acquiring=true,stable=true;
 await f.connect({signal:acquisition.signal,isCurrent:()=>acquiring});await f.lamp.connect(target,{lamp:f.broker,release:()=>f.broker.disconnect()},{poll:false,isCurrent:()=>acquiring});
 f.lamp.signal=null;f.lamp.isCurrent=()=>stable;acquiring=false;
 assert.equal(f.broker.adoptScope({epoch:f.lamp.bridgeEpoch,identity:f.lamp.bridgeIdentity,base:f.broker.base,isCurrent:()=>stable,guard:()=>f.lamp.guard()}),true);
 acquisition.abort();assert.equal(f.broker.connection.signal,null);await f.lamp.request('/api/power',{on:0});assert.equal(f.mutations,1);
 stable=false;const count=f.calls.length;await assert.rejects(f.lamp.request('/api/power',{on:1}));assert.equal(f.calls.length,count);assert.equal(f.mutations,1);await f.lamp.disconnect();
});
test('stale epochs, wrong identities/origins, missing guards and disconnected adoption are refused',async()=>{
 const f=fixture();await f.connect();const epoch=f.broker.epoch;
 for(const patch of [{epoch:epoch-1},{identity:target},{base:'http://192.168.1.198'},{isCurrent:()=>false},{guard:()=>false},{guard:()=>{throw Error('not the owner');}},{guard:null}])assert.throws(()=>f.broker.adoptScope({epoch,isCurrent:()=>true,guard:()=>{},...patch}),error=>error.cancelled===true);
 await f.broker.request('/api/mesh/status');await f.broker.disconnect();assert.throws(()=>f.broker.adoptScope({epoch,isCurrent:()=>true,guard:()=>{}}),error=>error.cancelled===true);
 await f.connect();assert.throws(()=>f.broker.adoptScope({epoch,isCurrent:()=>true,guard:()=>{}}),error=>error.cancelled===true);await f.broker.disconnect();
});
test('adoption checks caller guard before changing scope and cannot occur during logical I/O',async()=>{
 const f=fixture(),original=new AbortController();let oldCurrent=true;await f.connect({signal:original.signal,isCurrent:()=>oldCurrent});
 const originalGuard=f.broker.connection.isCurrent;assert.throws(()=>f.broker.adoptScope({isCurrent:()=>true,guard:()=>{assert.equal(f.broker.connection.signal,original.signal);assert.equal(f.broker.connection.isCurrent,originalGuard);throw Error('cannot own');}}));assert.equal(f.broker.connection.signal,original.signal);assert.equal(f.broker.connection.isCurrent,originalGuard);
 f.gate=deferred();f.gatePath='/api/mesh/status';const reading=f.broker.request('/api/mesh/status');await flush();assert.throws(()=>f.broker.adoptScope({isCurrent:()=>true,guard:()=>{}}),error=>error.busy===true);f.gate.resolve();await reading;
 oldCurrent=false;let callerCurrent=true;f.broker.adoptScope({isCurrent:()=>callerCurrent,guard:()=>{}});await f.broker.request('/api/mesh/status');callerCurrent=false;const count=f.calls.length;await assert.rejects(f.broker.request('/api/mesh/status'),error=>error.cancelled===true);assert.equal(f.calls.length,count);await f.broker.disconnect();
});
test('a borrowed verified broker adopts a new leaf after the previous mesh leaf disconnected and its guard became false',async()=>{
 const f=fixture();await f.connect();const previous=f.lamp;await previous.connect(target,{lamp:f.broker,release:async()=>{}},{poll:false});
 f.broker.adoptScope({epoch:previous.bridgeEpoch,identity:previous.bridgeIdentity,isCurrent:()=>true,guard:()=>previous.guard()});
 let sequence=100;const replacement=new MeshTransport({timeout:250,pollInterval:1,id:()=> (++sequence).toString(16).padStart(16,'0')});await replacement.connect(target,{lamp:f.broker,release:()=>f.broker.disconnect()},{poll:false});
 await previous.disconnect();assert.equal(f.broker.connection.isCurrent(),false,'the retired leaf guard should no longer own the broker');
 const epoch=f.broker.epoch;assert.equal(f.broker.adoptScope({epoch:replacement.bridgeEpoch,identity:replacement.bridgeIdentity,isCurrent:()=>true,guard:()=>replacement.guard()}),true);assert.equal(f.broker.epoch,epoch,'adoption must keep the same verified bridge session');
 await replacement.request('/api/power',{on:0});assert.equal(f.mutations,1);await assert.rejects(previous.request('/api/power',{on:1}));assert.equal(f.mutations,1);await replacement.disconnect();
});
