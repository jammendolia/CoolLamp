import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {MeshOnboarding} from '../src/mesh-onboarding.js';
import {FirmwareFleet} from '../src/firmware-fleet.js';
import {LampTransport} from '../src/transport.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const id='f0b950b2f180',other='aabbccddeeff';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function handler(name){
 const match=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').exec(source);assert(match,'Missing production handler '+name);
 const start=match.index+(source[match.index]==='\n'?1:0);let quote=null,escaped=false,line=false,block=false,parens=0,body=-1,depth=0;
 for(let index=source.indexOf('(',start);index<source.length;index++){
  const char=source[index],next=source[index+1];
  if(line){if(char==='\n')line=false;continue;}if(block){if(char==='*'&&next==='/'){block=false;index++;}continue;}
  if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}
  if(char==='"'||char==="'"||char==='`'){quote=char;continue;}if(char==='/'&&next==='/'){line=true;index++;continue;}if(char==='/'&&next==='*'){block=true;index++;continue;}
  if(body<0){if(char==='(')parens++;else if(char===')')parens--;else if(char==='{'&&parens===0){body=index;depth=1;}}
  else if(char==='{')depth++;else if(char==='}'&&--depth===0)return source.slice(start,index+1);
 }
 assert.fail('Unterminated production handler '+name);
}
function fixture(names=[],overrides={}){
 const calls=[],entry={id:other,address:'192.0.2.2',deviceId:'paired-fixture',accessoryManaged:true};
 const context={Error,Map,Set,Promise,AbortController,clearTimeout,setTimeout,JSON,
  firmwareBackgroundGeneration:0,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  foregroundConnectionHold:null,connecting:false,appTourActive:false,app2Pending:new Map(),
  firmwareAttempts:{pending:()=>[]},legacyFirmwareReceipts:new Map(),fleetRefreshRun:null,fleetRefreshQueued:false,fleetSummary:'',
  fleet:{cancelRefresh:()=>calls.push('cancel-fleet'),refresh:options=>{calls.push(['fleet',...options.excludeIds]);return Promise.resolve({results:[],cancelled:false});}},
  meshOnboarding:{cancelDiscover:()=>calls.push('cancel-mesh'),discover:()=>{calls.push('discover');return Promise.resolve();}},
  roomGroups:{cancel:()=>calls.push('cancel-groups'),refresh:()=>{calls.push('groups');return Promise.resolve();}},
  groupDiscovery:{cancelScan:()=>calls.push('cancel-coordinators')},bluetoothGroups:{cancel:()=>calls.push('cancel-bluetooth-scan')},groupScanRun:null,groupJoinPending:null,
  document:{hidden:false},meshWizard:null,store:{items:[entry]},groupRemovedIds:new Set(),meshNetworkMessages:new Map(),
  renderLamps(){},renderFleetControls(){},renderRoomGroups(){},renderOptions:()=>calls.push('render-options'),
  roomGroupsRun:null,roomGroupsGeneration:0,roomGroupsCompleted:0,roomGroupsRefreshQueued:false,
  $:()=>({textContent:''}),isNative:true,phonePlatform:'ios',BleClient:{},CapacitorHttp:{},pairing:{},accessoryNative:{},savedDevice:null,removedAccessoryIds:new Set(),
  initializeGroupRadio:async()=>calls.push('initialize-radio'),rememberAccessories:()=>calls.push('authorize'),
  firmwareFleetTrust:{provision:async()=>{calls.push('provision');return {supported:true};}},liveGroupBluetooth:new Map(),
  ...overrides};
 runInNewContext(['firmwareBackgroundWorkAllowed','pauseFirmwareBackgroundWork',...names].map(handler).join('\n'),context);
 return {context,calls,entry};
}
function hold(context,kind){
 if(kind==='legacy')context.bluetoothFirmwareTask={id};else if(kind==='bulk')context.fleetUpdating=true;
 else context.cardFirmwareTasks.set(id,kind==='confirm'?{}:{path:kind,reconciling:kind==='reconciling'});
}
for(const kind of ['confirm','wifi','bluetooth','reconciling','legacy','bulk'])test('production passive services pause every lamp for active '+kind+' ownership',async()=>{
 const f=fixture(['refreshLampFirmware','refreshNewMeshLamps','refreshRoomGroups','loadApp2EffectSchema'],{loadApp2Experience:()=>assert.fail('Unexpected metadata factory')});hold(f.context,kind);
 assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);f.context.refreshLampFirmware();f.context.refreshNewMeshLamps();f.context.refreshRoomGroups();await f.context.loadApp2EffectSchema();
 assert.deepEqual(f.calls,[]);assert.equal(f.context.fleetRefreshRun,null);
});

test('a presentation tour admits no passive lamp work and preserves updater and unresolved receipt ownership',async()=>{
 const f=fixture(['refreshLampFirmware','refreshNewMeshLamps','refreshRoomGroups','loadApp2EffectSchema'],{loadApp2Experience:()=>assert.fail('Tour requested lamp metadata')});
 const receipt={outcome:'verification-required'},owner={path:'bluetooth',id};
 f.context.legacyFirmwareReceipts.set(id,receipt);f.context.cardFirmwareTasks.set(id,owner);f.context.appTourActive=true;
 f.context.refreshLampFirmware();f.context.refreshNewMeshLamps();f.context.refreshRoomGroups();await f.context.loadApp2EffectSchema();
 assert.deepEqual(f.calls,[]);assert.equal(f.context.fleetRefreshRun,null);
 assert.equal(f.context.cardFirmwareTasks.get(id),owner);assert.equal(f.context.legacyFirmwareReceipts.get(id),receipt);
 f.context.appTourActive=false;assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);
 f.context.cardFirmwareTasks.clear();assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
 f.context.refreshLampFirmware();await f.context.fleetRefreshRun;
 assert.deepEqual(f.calls,[['fleet',id]]);assert.equal(f.context.legacyFirmwareReceipts.get(id),receipt);
});
test('pending receipts do not permanently pause unrelated inventory or initiate a new installation',async()=>{
 const f=fixture(['refreshLampFirmware','refreshNewMeshLamps']);f.context.firmwareAttempts.pending=()=>[{identity:id}];f.context.legacyFirmwareReceipts.set('112233445566',{});
 assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);f.context.refreshLampFirmware();await f.context.fleetRefreshRun;f.context.refreshNewMeshLamps();
 assert.deepEqual(f.calls,[['fleet',id,'112233445566'],'discover']);
});
test('production main and fleet send no background requests across 21 lamps while a private owner is active, then resume 20 unfenced lamps',async()=>{
 const entries=Array.from({length:21},(_,index)=>({id:index===0?id:index.toString(16).padStart(12,'0'),address:'192.168.77.'+(index+1)})),requests=[];
 const f=fixture(['refreshLampFirmware']);f.context.fleet=new FirmwareFleet({getLamps:()=>entries,credential:async()=>({value:'fixture-access'}),http:{request:async options=>{
  requests.push(options);assert.equal(options.method,'GET');const entry=entries.find(value=>options.url.startsWith('http://'+value.address+'/'));assert(entry);
  return {status:200,data:{deviceId:entry.id,firmware:{version:'1.15.1',latest:'0.0.0',phase:0,progress:0,error:0,wifi:true,automatic:false,available:false}}};}}});
 hold(f.context,'bluetooth');f.context.refreshLampFirmware();assert.deepEqual(requests,[]);assert.equal(f.context.fleetRefreshRun,null);
 f.context.cardFirmwareTasks.clear();f.context.firmwareAttempts.pending=()=>[{identity:id}];f.context.refreshLampFirmware();await f.context.fleetRefreshRun;
 assert.equal(requests.length,20);assert(requests.every(value=>!value.url.startsWith('http://192.168.77.1/')));assert.equal(entries.length,21);
});
test('production pause invalidates generation and cancels only passive workloads, preserving updater and receipt records',()=>{
 const f=fixture();hold(f.context,'bluetooth');const task=f.context.cardFirmwareTasks.get(id);f.context.pauseFirmwareBackgroundWork();f.context.pauseFirmwareBackgroundWork();
 assert.equal(f.context.firmwareBackgroundGeneration,2);assert.equal(f.context.cardFirmwareTasks.get(id),task);
 assert.deepEqual(f.calls,['cancel-fleet','cancel-mesh','cancel-groups','cancel-coordinators','cancel-fleet','cancel-mesh','cancel-groups','cancel-coordinators']);
});
test('pause cancels a Bluetooth inventory scan without canceling an explicit group invitation',()=>{
 const scan=fixture([], {groupScanRun:Promise.resolve()});scan.context.pauseFirmwareBackgroundWork();assert(scan.calls.includes('cancel-bluetooth-scan'));
 const invite=fixture([], {groupScanRun:Promise.resolve(),groupJoinPending:{id:other}});invite.context.pauseFirmwareBackgroundWork();assert(!invite.calls.includes('cancel-bluetooth-scan'));
});
function bridgeFixture({acquire,request}={}){
 const calls=[],lease={lamp:{identity:other,epoch:7,request:async(...args)=>{calls.push(args[0]);assert.equal(typeof args[4],'function');assert.equal(args[3],args[4]);args[4]();return request?request(...args):{version:1,deviceId:other,available:false,fleetId:''};}},release:async()=>calls.push('release')};
 const f=fixture(['acquireOnboardingBridge'],{acquireGroupLamp:async(target,options)=>{calls.push('acquire');assert.equal(target,other);assert.equal(options.readOnly,true);assert.equal(typeof options.isCurrent,'function');return acquire?acquire(lease,options):lease;}});
 return {...f,bridgeCalls:calls,lease};
}
test('automatic onboarding can report an absent fleet without initializing Bluetooth or provisioning trust',async()=>{
 const f=bridgeFixture(),lease=await f.context.acquireOnboardingBridge(other,{readOnly:true});assert.equal(lease,f.lease);
 assert.deepEqual(f.bridgeCalls,['acquire','/api/mesh/status']);assert.deepEqual(f.calls,[]);assert(f.context.meshNetworkMessages.has(other));await lease.release();
});
for(const kind of ['held','generation','signal'])test('late onboarding bridge acquisition after '+kind+' is released before any mesh read',async()=>{
 const gate=deferred(),signal=new AbortController(),f=bridgeFixture({acquire:()=>gate.promise});
 const run=f.context.acquireOnboardingBridge(other,{signal:signal.signal});await tick();
 if(kind==='held')hold(f.context,'bluetooth');else if(kind==='generation')f.context.pauseFirmwareBackgroundWork();else signal.abort();
 gate.resolve(f.lease);await assert.rejects(run,error=>error.cancelled);assert.deepEqual(f.bridgeCalls,['acquire','release']);
});
test('an in-flight onboarding status read cannot continue after firmware ownership begins',async()=>{
 const gate=deferred(),f=bridgeFixture({request:()=>gate.promise}),run=f.context.acquireOnboardingBridge(other);await tick();
 hold(f.context,'wifi');f.context.pauseFirmwareBackgroundWork();gate.resolve({version:1,deviceId:other,available:false,fleetId:''});
 await assert.rejects(run,error=>error.cancelled);assert.deepEqual(f.bridgeCalls,['acquire','/api/mesh/status','release']);assert(!f.calls.includes('provision'));
});
test('actual MeshOnboarding discovery is canceled without late native acquisition, new-lamp reads or provisioning',async()=>{
 const gate=deferred(),f=bridgeFixture({acquire:()=>gate.promise});
 const discovery=new MeshOnboarding({getBridges:()=>[f.entry],acquireBridge:(target,options)=>f.context.acquireOnboardingBridge(target,options),requestTimeout:1000});f.context.meshOnboarding=discovery;
 const run=discovery.discover();await tick();hold(f.context,'bluetooth');f.context.pauseFirmwareBackgroundWork();
 const result=await run;assert.equal(result.cancelled,true);gate.resolve(f.lease);await tick();await tick();
 assert.deepEqual(f.bridgeCalls,['acquire','release']);assert(!f.calls.includes('provision'));
});
function groupFixture({connect,mesh,radio}={}){
 let f;const instances=[];
 class Wifi {constructor(){this.timer=null;instances.push(this);}async connect(address,password,target,options){f.calls.push('wifi-connect');assert.equal(typeof options.guard,'function');options.guard();await connect?.(options);options.guard();}async disconnect(){f.calls.push('wifi-close');}}
 class Bluetooth {constructor(){this.epoch=1;this.supportsOfflineGroups=true;this.raw={firmware:{wifi:true}};instances.push(this);}async connect(entry,retry,options){f.calls.push(['ble-connect',entry.readOnlyReconnect]);assert.equal(typeof options.isCurrent,'function');assert(options.isCurrent());}async disconnect(){f.calls.push('ble-close');}}
 f=fixture(['createGroupLampLease'],{WifiTransport:Wifi,LampTransport:Bluetooth,lamp:{},bleLamp:{id:null},state:{},
  groupInventoryEntries:()=>[f.entry],credential:async()=>({value:'fixture-access'}),
  createMeshLampLease:async(target,options)=>{f.calls.push(['mesh',options.recoveryOnly]);assert.equal(typeof options.isCurrent,'function');return mesh?mesh(options):Promise.reject(Object.assign(Error('No route'),{noRoute:true}));},
  initializeGroupRadio:async options=>{f.calls.push('initialize-radio');await radio?.(options);},observeLampWifi(){}});
 return {...f,instances};
}
test('read-only group acquisition passes guarded Wi-Fi connection without provisioning any lamp',async()=>{
 const f=groupFixture(),lease=await f.context.createGroupLampLease(other,{readOnly:true});assert.deepEqual(f.calls,['wifi-connect']);await lease.release();assert.deepEqual(f.calls,['wifi-connect','wifi-close']);
});
test('read-only group discovery never guesses a missing Wi-Fi access password or opens a fallback factory',async()=>{
 const f=groupFixture();f.context.credential=async()=>({value:''});
 await assert.rejects(f.context.createGroupLampLease(other,{readOnly:true}),error=>error.needsPassword);assert.deepEqual(f.calls,['wifi-close']);
});
test('read-only group Wi-Fi failure cannot fall back after a background generation change',async()=>{
 let f;f=groupFixture({connect:()=>{f.context.pauseFirmwareBackgroundWork();throw Error('Offline');}});
 await assert.rejects(f.context.createGroupLampLease(other,{readOnly:true}),error=>error.cancelled);assert(!f.calls.some(value=>Array.isArray(value)&&value[0]==='mesh'));assert(!f.calls.includes('provision'));
});
test('read-only Bluetooth group fallback stays read-only while an inactive explicit manual group intent can provision',async()=>{
 for(const readOnly of [true,false]){
  const f=groupFixture({connect:()=>{throw Error('Offline');}}),lease=await f.context.createGroupLampLease(other,{readOnly});
  assert(f.calls.some(value=>Array.isArray(value)&&value[0]==='mesh'&&value[1]===readOnly));assert(f.calls.some(value=>Array.isArray(value)&&value[0]==='ble-connect'&&Boolean(value[1])===readOnly));
  assert.equal(f.calls.includes('provision'),!readOnly);await lease.release();
 }
});
test('late mesh fallback acquisition is released before admission after generation changes',async()=>{
 const gate=deferred(),released=[];const f=groupFixture({connect:()=>{throw Error('Offline');},mesh:()=>gate.promise});
 const run=f.context.createGroupLampLease(other,{readOnly:true});await tick();f.context.pauseFirmwareBackgroundWork();gate.resolve({lamp:{},release:async()=>released.push('release')});
 await assert.rejects(run,error=>error.cancelled);assert.deepEqual(released,['release']);assert(!f.calls.includes('initialize-radio'));
});
test('descriptor queued before a firmware hold cannot send after that generation ends, and a fresh operation still works',async()=>{
 const gate=deferred();let queued;const calls=[];
 const target={epoch:1,raw:{token:'fixture'},enqueue:action=>{queued=action;return gate.promise;},request:async(path,fields,epoch,guard)=>{guard();calls.push(path);return {};}};
 class Session {constructor(transport){this.transport=transport;}async negotiate(){await this.transport.request('/api/descriptor');}}
 const f=fixture(['loadApp2Experience'],{verifiedSelectedLamp:()=>true,advancedAvailable:()=>true,updatingLamp:()=>false,selected:{id:other},lamp:target,
  app2Experience:null,app2ExperienceRun:null,app2TargetMatches:record=>record?.target===target,assertApp2Target:()=>{},LampExperienceSession:Session});
 const run=f.context.loadApp2Experience();f.context.pauseFirmwareBackgroundWork();
 try{gate.resolve(await queued());}catch(error){gate.reject(error);}await assert.rejects(run,error=>error.cancelled);assert.deepEqual(calls,[]);
 target.enqueue=async action=>action();const record=await f.context.loadApp2Experience();assert.equal(record.supported,true);assert.deepEqual(calls,['/api/descriptor']);
 f.context.pauseFirmwareBackgroundWork();await record.transport.request('/api/revision');assert.deepEqual(calls,['/api/descriptor','/api/revision']);
});
test('schema queued before an update does not send or adopt a late page when its generation changes',async()=>{
 const gate=deferred();let queued;let reads=0;const record={supported:true,loading:false,mode:null,schemas:new Map(),session:{descriptor:{capabilities:{catalogVersions:[2]}},schema:async()=>{reads++;return {entries:[{localId:1}]};}},target:{enqueue:action=>{queued=action;return gate.promise;}}};
 const f=fixture(['loadApp2EffectSchema'],{state:{mode:1},lamp:{catalog:[{id:1}]},loadApp2Experience:async()=>record,app2Experience:record,assertApp2Target:()=>{}});
 const run=f.context.loadApp2EffectSchema();await tick();f.context.pauseFirmwareBackgroundWork();
 try{gate.resolve(await queued());}catch(error){gate.reject(error);}await run;assert.equal(reads,0);assert.equal(record.mode,null);assert.equal(record.schemas.size,0);assert.equal(record.loading,false);
});

test('production tour entry fences a queued schema after exit, while a fresh schema read still works',async()=>{
 const gate=deferred();let queued,reads=0;
 const record={supported:true,loading:false,mode:null,schemas:new Map(),session:{descriptor:{capabilities:{catalogVersions:[2]}},schema:async()=>{reads++;return {entries:[{localId:1}]};}},target:{enqueue:action=>{queued=action;return gate.promise;}}};
 const f=fixture(['loadApp2EffectSchema','tourPresentation'],{state:{mode:1},lamp:{catalog:[{id:1}]},loadApp2Experience:async()=>record,app2Experience:record,assertApp2Target:()=>{},
  appTourSettingsView:null,settingsView:'network',appV2:{navigate(){}},scheduleLampStatusRefresh(){},renderSettings(){}});
 const pending=f.context.loadApp2EffectSchema();await tick();
 assert.equal(f.context.tourPresentation('help'),true);assert.equal(f.context.appTourActive,true);assert.equal(f.context.firmwareBackgroundGeneration,1);
 f.context.tourPresentation('lamps');assert.equal(f.context.firmwareBackgroundGeneration,1);
 f.context.tourPresentation('help',{active:false});assert.equal(f.context.appTourActive,false);assert.equal(f.context.settingsView,'network');
 try{gate.resolve(await queued());}catch(error){gate.reject(error);}await pending;
 assert.equal(reads,0);assert.equal(record.schemas.size,0);assert.equal(record.mode,null);assert.equal(record.loading,false);
 record.target.enqueue=async action=>action();await f.context.loadApp2EffectSchema();
 assert.equal(reads,1);assert.equal(record.mode,1);assert.equal(record.schemas.size,1);
});
async function metadataFixture(){
 const target={epoch:1,raw:{token:'fixture'},enqueue:async action=>action(),request:async(path,fields,epoch,guard,readGuard)=>{assert.equal(typeof readGuard,'function');assert.equal(guard,readGuard);guard();return {};}};
 class Session {constructor(transport){this.transport=transport;}async negotiate(){await this.transport.request('/api/descriptor');}}
 const f=fixture(['loadApp2Experience'],{verifiedSelectedLamp:()=>true,advancedAvailable:()=>true,updatingLamp:()=>false,selected:{id:other},lamp:target,
  app2Experience:null,app2ExperienceRun:null,app2TargetMatches:record=>record?.target===target,assertApp2Target:()=>{},LampExperienceSession:Session});
 return {...f,target,record:await f.context.loadApp2Experience()};
}
test('an appearance POST never leaves the cached metadata wrapper while firmware admission is held',async()=>{
 const f=await metadataFixture();hold(f.context,'bluetooth');f.context.pauseFirmwareBackgroundWork();f.target.request=()=>assert.fail('Mutation left while held');
 await assert.rejects(f.record.transport.request('/api/appearance/save',{commandId:'fixture'}),error=>error.cancelled&&error.confirmed&&!error.uncertain);
});
for(const reply of ['success','lost'])test('appearance POST '+reply+' after an update hold is honestly uncertain, never a confirmed safe cancellation',async()=>{
 const f=await metadataFixture();let writes=0;
 f.target.request=async(path,fields,epoch,beforeWrite)=>{beforeWrite();writes++;hold(f.context,'bluetooth');f.context.pauseFirmwareBackgroundWork();if(reply==='lost')throw Error('Reply lost');return {executed:true};};
 await assert.rejects(f.record.transport.request('/api/appearance/save',{commandId:'fixture'}),error=>error.uncertain===true&&error.confirmed===false);
 assert.equal(writes,1);assert.equal(f.context.cardFirmwareTasks.size,1);
});
for(const result of ['success','failure'])test('an in-flight basic Bluetooth firmware '+result+' cannot adopt or invalidate unrelated telemetry after a firmware hold',async()=>{
 const gate=deferred(),published=[],invalidated=[];
 const transport=new LampTransport({read:()=>gate.promise},{onFirmware:value=>published.push(value)});
 transport.id='fixture-peripheral';transport.deviceIdentity=other;transport.epoch=1;transport.state={capabilities:4};
 const f=fixture(['refreshBasicBluetoothTelemetry'],{bleLamp:transport,lamp:transport,selected:{id:other},state:{capabilities:4},
  bleConnectivityRead:null,connecting:false,busy:false,verifiedSelectedLamp:()=>true,updatingLamp:()=>false,connectivity:{invalidate:value=>invalidated.push(value)}});
 f.context.refreshBasicBluetoothTelemetry();const run=f.context.bleConnectivityRead;hold(f.context,'bluetooth');f.context.pauseFirmwareBackgroundWork();
 if(result==='success'){const packet=new DataView(new ArrayBuffer(20));packet.setUint8(0,1);packet.setUint16(6,1,true);packet.setUint16(8,13,true);gate.resolve(packet);}else gate.reject(Error('Native read ended'));
 await assert.rejects(run);await tick();assert.deepEqual(published,[]);assert.deepEqual(invalidated,[]);assert.equal(transport.state.firmware,undefined);assert.equal(f.context.bleConnectivityRead,null);
});
