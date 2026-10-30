import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {acquireOnboardingBroker,onboardingDiscoveryMessage} from '../src/mesh-onboarding-broker.js';
import {MeshOnboarding} from '../src/mesh-onboarding.js';
import {WifiTransport} from '../src/wifi.js';
import {ConnectionBroker,readOnlyConnectionFailure} from '../src/connection-broker.js';
import {MeshInventorySession} from '../src/mesh.js';

const id='112233445566',target='8c4856dab734',fleetId='0123456789abcdef';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
// Execute the actual main handlers, with only their native transports injected.
function handler(name){
 const match=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').exec(source);assert(match);
 const start=match.index+(source[match.index]==='\n'?1:0);let quote=null,escape=false,line=false,block=false,parens=0,body=-1,depth=0;
 for(let i=source.indexOf('(',start);i<source.length;i++){
  const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='/'&&next==='/'){line=true;i++;continue;}if(c==='/'&&next==='*'){block=true;i++;continue;}
  if(body<0){if(c==='(')parens++;else if(c===')')parens--;else if(c==='{'&&parens===0){body=i;depth=1;}}
  else if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 assert.fail('Unterminated production handler '+name);
}
function fixture({fresh=false,authorized=true,active=false,bluetoothFailure=false,httpGate=null,httpHealthy=false,bluetoothGate=null,budget={}}={}){
 const entry={id,name:'Corkscrew',deviceId:'saved-ble',accessoryManaged:authorized,address:'http://192.168.1.42',firmwareVersion:'1.15.2'};
 const calls=[],messages=[],failures=new Map();let releases=0,provisions=0;
 const peer={identity:id,epoch:1,base:'ble:saved-ble',supportsOfflineGroups:true,raw:{deviceId:id,name:entry.name},async request(path){
  calls.push(path);if(path==='/api/mesh/status')return {version:1,deviceId:id,available:true,fleetId};
  if(path==='/api/mesh/new')return {version:1,candidates:[{id:target,name:'CoolLamp Bridge',firmwareVersion:'0.2.1',broker:id,online:true,claimed:false}]};
  throw Error('Unexpected enrollment mutation');
 }};
 class BluetoothTransport{
  constructor(_ble,options){this.options=options;this.epoch=1;this.raw={deviceId:id,name:entry.name};this.supportsOfflineGroups=true;}
  async connect(saved,_retry,options){calls.push('bluetooth');assert.equal(saved.readOnlyReconnect,true);assert.equal(this.options.expectedDeviceIdentity,id);
   assert(options.isCurrent());if(bluetoothGate)await bluetoothGate.promise;if(!options.isCurrent())throw Object.assign(Error('Canceled'),{cancelled:true});
   if(bluetoothFailure)throw Error('Unavailable');this.identity=id;this.base=peer.base;return {};
  }
  request(...args){return peer.request(...args);}
  async disconnect(){releases++;}
 }
 const context={acquireOnboardingBroker:options=>acquireOnboardingBroker({...options,...budget}),onboardingDiscoveryMessage,WifiTransport,LampTransport:BluetoothTransport,
  ConnectionBroker,readOnlyConnectionFailure,connectionBroker:new ConnectionBroker(),meshInventory:new MeshInventorySession(),roomGroups:null,
  store:{items:[entry]},connectivity:{get:()=>({wifi:{fresh,state:'connected'}})},phonePlatform:'ios',groupRemovedIds:new Set(),
  cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,cardPowerTasks:new Map(),groupConnections:new Map(),groupEditor:null,
  firmwareBackgroundGeneration:0,firmwareBackgroundWorkAllowed:()=>true,groupInventoryEntries:()=>[entry],mergedLampEntries:()=>[entry],
  lamp:active?peer:null,bleLamp:{initialization:{},supportsOfflineGroups:true},state:active?{}:null,
  verifiedSelectedLamp:()=>active,advancedAvailable:()=>active,credential:async()=>({value:'already-saved-password'}),
  CapacitorHttp:{async request(request){assert.equal(request.method,'GET');if(!request.url.endsWith('/api/state'))return {status:200,data:await peer.request(new URL(request.url).pathname)};
   calls.push('wifi-state');if(httpGate)return httpGate.promise;return {status:200,data:httpHealthy?
    {deviceId:id,token:'fixture-token',hostname:'coollamp-fixture',effects:['Rainbow'],mode:1,brightness:128,firmware:{version:'1.15.2'}}:'{"token":"SECRET",'};}},
  initializeGroupRadio:async options=>{assert.equal(options.knownDevices().map(value=>value.id).join(','),id);},
  pairing:{},accessoryNative:{},BleClient:{},rememberAccessories:()=>{},removedAccessoryIds:new Set(),savedDevice:null,
  createMeshLampLease:async(_id,options)=>{calls.push('mesh');assert.equal(_id,id);assert.equal(options.recoveryOnly,true);throw Object.assign(Error('No route'),{noRoute:true});},
  liveGroupBluetooth:new Map(),renderLamps:()=>{},observeLampWifi:()=>{},observeLampLighting:()=>{},isNative:true,firmwareFleetTrust:{provision:async()=>{provisions++;}},
  validFirmwareVersion:value=>value,compareFirmwareVersions:()=>-1,clearTimeout,AbortController,
  meshNetworkMessages:new Map(),document:{hidden:false},meshWizard:null,navigationSerial:1,meshDiscoveryRun:null,meshDiscoveryFailures:failures,
  $:()=>({hidden:false}),status:value=>messages.push(value),meshOnboarding:null};
 runInNewContext(['observeBrokerConnection','createGroupLampLease','acquireGroupLamp','closeGroupConnection','acquireOnboardingBridge','refreshNewMeshLamps'].map(handler).join('\n'),context);
 context.meshOnboarding=new MeshOnboarding({getBridges:()=>[entry],acquireBridge:context.acquireOnboardingBridge,
  onDiscoveryError:(entry,error)=>failures.set(entry.id,{name:entry.name,error}),requestTimeout:7900});
 return {entry,calls,context,messages,failures,peer,releases:()=>releases,provisions:()=>provisions};
}

test('production onboarding prefers saved Bluetooth to a stale 1.15.2 HTTP state and finds bridge read-only',async()=>{
 const f=fixture(),result=await f.context.refreshNewMeshLamps({explicit:true});
 assert.equal(result.candidates[0].id,target);assert.deepEqual(f.calls,['bluetooth','/api/mesh/status','/api/mesh/new']);
 assert.equal(f.provisions(),0);assert.equal(f.releases(),1);assert.match(f.messages[0],/Choose the new device/);
 assert.equal(f.context.connectionBroker.get(id).route,'bluetooth');assert.equal(f.context.connectionBroker.get(id).raw.deviceId,id);
 assert.equal(f.context.connectionBroker.active.size,0);
});
test('fresh Wi-Fi with truncated actual settings falls back to saved Bluetooth without mesh or provisioning',async()=>{
 const f=fixture({fresh:true}),result=await f.context.refreshNewMeshLamps();
 assert.equal(result.candidates.length,1);assert.deepEqual(f.calls,['wifi-state','bluetooth','/api/mesh/status','/api/mesh/new']);
 assert.equal(f.provisions(),0);assert.equal(f.messages.length,0);
});
test('healthy fresh production Wi-Fi stays ahead of saved Bluetooth',async()=>{
 const f=fixture({fresh:true,httpHealthy:true}),result=await f.context.refreshNewMeshLamps();
 assert.equal(result.candidates[0].id,target);assert.deepEqual(f.calls,['wifi-state','/api/mesh/status','/api/mesh/new']);
 assert.equal(f.provisions(),0);assert.equal(f.context.groupConnections.size,0);assert.equal(f.messages.length,0);
 assert.equal(f.context.connectionBroker.get(id).route,'wifi');assert.equal(f.context.connectionBroker.get(id).verified,true);
 assert.equal(f.context.connectionBroker.get(id).raw.token,undefined);assert.equal(f.context.connectionBroker.active.size,0);
});
test('verified active broker is borrowed before every acquisition route',async()=>{
 const f=fixture({active:true}),result=await f.context.refreshNewMeshLamps();
 assert.equal(result.candidates[0].id,target);assert.deepEqual(f.calls,['/api/mesh/status','/api/mesh/new']);assert.equal(f.releases(),0);
});
test('onboarding shares an existing group Bluetooth owner and cannot disconnect its link',async()=>{
 const f=fixture(),owner=await f.context.acquireGroupLamp(id,{readOnly:true,onboardingRoute:'bluetooth'});
 const discovery=await f.context.acquireOnboardingBridge(id);
 assert.equal(discovery.lamp,owner.lamp);assert.deepEqual(f.calls,['bluetooth','/api/mesh/status']);
 await discovery.release();assert.equal(f.releases(),0);await owner.release();assert.equal(f.releases(),1);
});
test('an open group editor is borrowed without opening or closing its Bluetooth peripheral',async()=>{
 const f=fixture();f.context.groupEditor={lamp:f.peer};const lease=await f.context.acquireOnboardingBridge(id);
 assert.equal(lease.lamp,f.peer);assert.deepEqual(f.calls,['/api/mesh/status']);await lease.release();assert.equal(f.releases(),0);
});
test('timed-out production pooled HTTP acquisition retires before fresh Bluetooth fallback',async()=>{
 const gate=deferred(),f=fixture({fresh:true,httpGate:gate,budget:{timeoutMs:500,routeTimeoutMs:30}});
 const result=await f.context.refreshNewMeshLamps();assert.equal(result.candidates[0]?.id,target,JSON.stringify({calls:f.calls,failures:[...f.failures.values()].map(value=>value.error.message)}));
 assert.deepEqual(f.calls,['wifi-state','bluetooth','/api/mesh/status','/api/mesh/new']);assert.equal(f.context.groupConnections.size,0);
 gate.resolve({status:200,data:'{"token":"SECRET",'});await tick();assert.equal(f.releases(),1);assert.equal(f.provisions(),0);
});
test('a group owner joining pending onboarding Bluetooth survives the discovery route timeout',async()=>{
 const gate=deferred(),f=fixture({bluetoothGate:gate,budget:{timeoutMs:500,routeTimeoutMs:40}});
 const discovery=f.context.acquireOnboardingBridge(id);await tick();
 const owner=f.context.acquireGroupLamp(id,{readOnly:true});await new Promise(resolve=>setTimeout(resolve,50));gate.resolve();
 const [discoveryLease,ownerLease]=await Promise.all([discovery,owner]);assert.equal(discoveryLease.lamp,ownerLease.lamp);
 assert.deepEqual(f.calls,['bluetooth','/api/mesh/status']);await discoveryLease.release();assert.equal(f.releases(),0);
 await ownerLease.release();assert.equal(f.releases(),1);assert.equal(f.provisions(),0);
});
test('unauthorized iOS saved devices do not open Bluetooth and explicit guide gets a specific safe failure',async()=>{
 const f=fixture({authorized:false});await f.context.refreshNewMeshLamps();assert.deepEqual(f.calls,['wifi-state','mesh']);assert.equal(f.messages.length,0);
 await f.context.refreshNewMeshLamps({explicit:true});assert.match(f.messages[0],/Corkscrew: Wi-Fi returned incomplete or invalid settings/);
 assert(!f.messages[0].includes('SECRET'));assert.equal(f.provisions(),0);
});
test('main route restriction preserves mesh-first ordinary group acquisition',async()=>{
 const f=fixture();await f.context.createGroupLampLease(id,{readOnly:true});
 assert.deepEqual(f.calls,['mesh','wifi-state','bluetooth']);assert.equal(f.provisions(),0);
});
test('canceling discovery ignores a late actual HTTP state reply and never opens another route',async()=>{
 const gate=deferred(),f=fixture({fresh:true,httpGate:gate}),run=f.context.refreshNewMeshLamps({explicit:true});
 await tick();f.context.meshOnboarding.cancelDiscover();const result=await run;assert.equal(result.cancelled,true);
 gate.resolve({status:200,data:'{"token":"SECRET",'});await tick();await tick();
 assert.deepEqual(f.calls,['wifi-state']);assert.equal(f.messages.length,0);assert.equal(f.provisions(),0);
});
test('inactive or wrong active broker is never borrowed; returned wrong identity fails immediately',async()=>{
 const calls=[];await acquireOnboardingBroker({entry:{id,deviceId:'saved'},active:{verified:false,lamp:{identity:id}},bluetoothAuthorized:true,
  acquireRoute:async route=>{calls.push(route);return {lamp:{identity:id,request(){}},release(){}};}});
 assert.deepEqual(calls,['bluetooth']);let released=0;
 await assert.rejects(acquireOnboardingBroker({entry:{id,address:'http://saved'},acquireRoute:async()=>({lamp:{identity:target,request(){}},release(){released++;}})}),error=>error.identity===true);
 assert.equal(released,1);
});
test('one discovery deadline retires slow routes and releases late leases exactly once',async()=>{
 const gate=deferred(),calls=[];let released=0,routeSignal;
 const run=acquireOnboardingBroker({entry:{id,deviceId:'saved',address:'http://saved'},bluetoothAuthorized:true,timeoutMs:30,routeTimeoutMs:100,
  acquireRoute:async(route,options)=>{calls.push(route);routeSignal=options.signal;return gate.promise;}});
 await assert.rejects(run,error=>error.routeTimeout===true);assert.equal(routeSignal.aborted,true);
 gate.resolve({lamp:{identity:id,request(){}},release(){released++;}});await tick();await tick();
 assert.deepEqual(calls,['bluetooth']);assert.equal(released,1);
});
test('route timeout permits another guarded read inside the same overall deadline',async()=>{
 const gate=deferred(),calls=[];let released=0;
 const result=await acquireOnboardingBroker({entry:{id,deviceId:'saved',address:'http://saved'},wifiFresh:true,bluetoothAuthorized:true,
  timeoutMs:1000,routeTimeoutMs:20,acquireRoute:async(route,options)=>{calls.push(route);assert.equal(options.readOnly,true);return route==='wifi'?gate.promise:{lamp:{identity:id,request(){}},release(){}};}});
 assert.equal(result.lamp.identity,id);assert.deepEqual(calls,['wifi','bluetooth']);
 gate.resolve({lamp:{identity:id,request(){}},release(){released++;}});await tick();assert.equal(released,1);
});
test('a provider noticing its local cutoff before the timer permits another read route',async()=>{
 let time=0,retiredSignal,outerCurrent;const calls=[];
 const result=await acquireOnboardingBroker({entry:{id,deviceId:'saved',address:'http://saved'},wifiFresh:true,bluetoothAuthorized:true,
  now:()=>time,timeoutMs:1000,routeTimeoutMs:20,acquireRoute:async(route,options)=>{
   calls.push(route);assert.equal(options.readOnly,true);
   if(route==='wifi'){retiredSignal=options.signal;time=20;outerCurrent=options.isCurrent();throw Object.assign(Error('Provider guard expired.'),{cancelled:true});}
   assert.equal(options.isCurrent(),true);return {lamp:{identity:id,request(){}},release(){}};
  }});
 assert.equal(result.lamp.identity,id);assert.deepEqual(calls,['wifi','bluetooth']);assert.equal(retiredSignal.aborted,true);assert.equal(outerCurrent,true);
});
for(const cause of ['early provider cancellation','parent cancellation','changed admission','identity refusal'])test('local cutoff recovery preserves '+cause,async()=>{
 let time=0,allowed=true;const controller=new AbortController(),calls=[];
 await assert.rejects(acquireOnboardingBroker({entry:{id,deviceId:'saved',address:'http://saved'},wifiFresh:true,bluetoothAuthorized:true,
  now:()=>time,timeoutMs:1000,routeTimeoutMs:20,signal:controller.signal,isCurrent:()=>allowed,acquireRoute:async route=>{
   calls.push(route);time=cause==='early provider cancellation'?19:20;
   if(cause==='parent cancellation')controller.abort();if(cause==='changed admission')allowed=false;
   throw Object.assign(Error('Read acquisition stopped.'),cause==='identity refusal'?{identity:true}:{cancelled:true});
  }}),error=>cause==='identity refusal'?error.identity===true:error.cancelled===true);
 assert.deepEqual(calls,['wifi']);
});
test('changed admission cancels late acquisition without route fallback',async()=>{
 const gate=deferred(),controller=new AbortController();let released=0;const calls=[];
 const run=acquireOnboardingBroker({entry:{id,deviceId:'saved',address:'http://saved'},bluetoothAuthorized:true,signal:controller.signal,
  acquireRoute:async route=>{calls.push(route);return gate.promise;}});
 await tick();controller.abort();await assert.rejects(run,error=>error.cancelled===true);
 gate.resolve({lamp:{identity:id,request(){}},release(){released++;}});await tick();assert.equal(released,1);assert.deepEqual(calls,['bluetooth']);
});
test('explicit feedback is suppressed after navigation or cancel and raw read errors are not displayed',async()=>{
 const f=fixture({authorized:false});f.context.meshOnboarding.discover=async()=>{f.context.navigationSerial++;return {candidates:[]};};
 await f.context.refreshNewMeshLamps({explicit:true});assert.equal(f.messages.length,0);
 assert.equal(onboardingDiscoveryMessage({cancelled:true},[{error:Error('SECRET')}]),'');
 const message=onboardingDiscoveryMessage({candidates:[]},[{name:'Corkscrew',error:Error('SECRET token reply')}]);
 assert.match(message,/Could not read its new-device list/);assert(!message.includes('SECRET'));
});
