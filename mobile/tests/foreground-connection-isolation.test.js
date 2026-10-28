import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LampTransport} from '../src/transport.js';
import {STATE,CONTROL,SERVICE,COMMAND,effects} from '../src/protocol.js';
import {lampAddress} from '../src/lamps.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';
import {meshRouteCandidates} from '../src/mesh-route-candidates.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function handler(name){
 const match=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').exec(source);assert(match,'Missing actual handler '+name);
 const start=match.index+(source[match.index]==='\n'?1:0);let quote=null,escape=false,line=false,block=false,parens=0,body=-1,depth=0;
 for(let i=source.indexOf('(',start);i<source.length;i++){
  const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='/'&&next==='/'){line=true;i++;continue;}if(c==='/'&&next==='*'){block=true;i++;continue;}
  if(body<0){if(c==='(')parens++;else if(c===')')parens--;else if(c==='{'&&parens===0){body=i;depth=1;}}
  else if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 assert.fail('Unterminated handler '+name);
}
const entryId='aabbccddeeff';
const view=bytes=>new DataView(Uint8Array.from(bytes).buffer);
function page(text,tx=0,endpoint=0,offset=0){
 const bytes=new TextEncoder().encode(text),part=bytes.slice(offset,offset+480),value=new DataView(new ArrayBuffer(12+part.length));
 value.setUint8(0,1);value.setUint16(1,tx,true);value.setUint8(3,endpoint);value.setUint16(4,200,true);
 value.setUint16(6,bytes.length,true);value.setUint16(8,offset,true);value.setUint16(10,part.length,true);new Uint8Array(value.buffer,12).set(part);return value;
}
// Native event keys match the pinned SDK's shared device/service/characteristic
// registry. The application handlers and LampTransport are production code.
class NativeRegistry{
 constructor(entries){Object.assign(this,{entries,events:[],listeners:new Map(),disconnects:new Map(),ack:new Map(),responses:new Map(),connectGates:new Map(),disconnectGates:new Map()});}
 async initialize(){this.events.push(['initialize']);}
 async getDevices(ids){return ids.map(deviceId=>({deviceId}));}
 async connect(id,callback){this.events.push(['connect',id]);this.disconnects.set(id,callback);await this.connectGates.get(id)?.promise;}
 async disconnect(id){this.events.push(['disconnect-start',id]);await this.disconnectGates.get(id)?.promise;
  this.listeners.delete(id+'|'+SERVICE+'|'+STATE);this.disconnects.get(id)?.();this.events.push(['disconnect-done',id]);}
 async startNotifications(id,service,characteristic,callback){
  const key=id+'|'+service+'|'+characteristic;this.events.push(['subscribe',id,characteristic,this.listeners.has(key)]);this.listeners.set(key,callback);
 }
 packet(id){return view([1,this.ack.get(id)||0,0,4,55,1,effects.length,255,0,0,0,0,0,0,0,0]);}
 async read(id,service,characteristic){
  assert.equal(service,SERVICE);this.events.push(['read',id,characteristic]);
  if(characteristic===STATE){if(this.stateFailure)throw Error('Read timeout.');return this.packet(id);}
  if(characteristic==='7b610006-6e2b-4f3d-9a71-28e45c001001')return view(new TextEncoder().encode(this.entries.find(row=>row.deviceId===id).id));
  assert.equal(characteristic,CONTROL);const response=this.responses.get(id);
  return response?.text?page(response.text,response.tx,response.endpoint,response.offset):page(JSON.stringify({version:1,capabilities:['control','groups'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.15.1'}));
 }
 async write(id,service,characteristic,frame){
  assert.equal(service,SERVICE);assert.equal(characteristic,COMMAND);const op=frame.getUint8(2);this.events.push(['write',id,op]);
  if(op===22){const endpoint=frame.getUint8(5);if(!endpoint)this.responses.delete(id);else this.responses.set(id,{tx:frame.getUint16(3,true),endpoint,offset:0});}
  if(op===24){const response=this.responses.get(id),entry=this.entries.find(row=>row.deviceId===id);
   response.text=JSON.stringify(response.endpoint===26?effects.map((name,index)=>({id:index+1,name,category:'calm',speed:true})):
    {deviceId:entry.id,name:entry.name,hostname:'lamp.fixture',effects:[...effects],mode:4,brightness:55,power:true,leds:135,
     firmware:{version:'1.15.1',phase:0},sync:{version:2,role:0,leader:'',members:0,order:[],peers:[]}});
  }
  if(op===25)this.responses.get(id).offset=frame.getUint16(5,true);
  this.ack.set(id,frame.getUint8(1));this.listeners.get(id+'|'+SERVICE+'|'+STATE)?.(this.packet(id));
 }
}
function fixture(){
 const entries=Array.from({length:20},(_,index)=>({id:index===0?entryId:(index+1).toString(16).padStart(12,'0'),name:'Lamp '+(index+1),
  deviceId:'00000000-0000-0000-0000-'+(index+1).toString(16).padStart(12,'0'),accessoryManaged:true}));
 const radio=new NativeRegistry(entries),events=[],elements=new Map();
 const context={Map,Set,Promise,Object,Error,AbortController,clearTimeout,console,LampTransport,lampAddress,entries,events,
  foregroundConnectionHold:null,firmwareBackgroundGeneration:0,connecting:false,busy:false,appTourActive:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  wifiSettingsTarget:null,navigationSerial:1,bluetoothFirmwareConnectionSerial:0,cardSettingsSerial:0,selected:null,state:null,firmware:null,
  groupConnections:new Map(),groupRemovedIds:new Set(),cardPowerTasks:new Map(),groupEditor:null,liveGroupBluetooth:new Map(),
  groupScanRun:null,groupJoinPending:null,savedDevice:null,pairingRecoveryTarget:null,removedAccessoryIds:new Set(),cardConnectionMessages:new Map(),
  phonePlatform:'ios',isNative:true,BleClient:radio,CapacitorHttp:{},pairing:{},accessoryNative:{},settingsView:'lighting',
  fleet:{cancelRefresh:()=>events.push('cancel-fleet')},meshOnboarding:{cancelDiscover:()=>events.push('cancel-new-lamps')},
  roomGroups:{cancel:()=>events.push('cancel-groups'),allow(){}},groupDiscovery:{cancelScan:()=>events.push('cancel-coordinators')},bluetoothGroups:{cancel:()=>events.push('cancel-bluetooth-scan')},
  groupInventoryEntries:()=>entries,mergedLampEntries:()=>entries,renderLamps(){},renderPower(){},renderFirmware(){},renderSettings(){},renderOptions(){},
  initializeGroupRadio:async()=>events.push('radio-ready'),rememberAccessories:()=>assert.fail('Unexpected ownership change'),
  createMeshLampLease:async()=>{throw Object.assign(Error('No route'),{noRoute:true,confirmed:true});},
  firmwareFleetTrust:{provision:async()=>events.push('provision')},closeGroupEditor:async()=>{},
  bluetoothFirmwareOwner:()=>null,firmwareConnectionNotice:()=>assert.fail('Unexpected updater'),fleetLampInstalling:()=>false,
  cancelMeshSelection(){},stopGroupInspection:null,observeLampWifi(){},provisionFirmwareFleet:()=>assert.fail('Read-only reconnect provisioned a fleet'),
  rememberAuthorizedAccessories:()=>assert.fail('Read-only reconnect enrolled a phone'),pairingError:error=>({message:error.message}),showPairingRecovery:()=>assert.fail('Unexpected pairing recovery'),
  connected:()=>events.push('adopt-foreground'),status:message=>events.push(['status',message]),settingsSection:section=>{context.settingsView=section;},page(){},
  connectivity:{get:()=>({wifi:{fresh:false,state:'unknown'}})},store:{items:entries,upsert:value=>value,rememberFirmware(){}},
  $:key=>{if(!elements.has(key))elements.set(key,{focus(){},disabled:false,hidden:false});return elements.get(key);}};
 context.bleLamp=new LampTransport(radio,{timeout:1000,sharedInitialization:Promise.resolve(),
  onState:value=>context.state=value,onFirmware:value=>context.firmware=value});
 context.lamp={disconnect:async()=>events.push('old-target-closed')};context.wifiLamp={};
 context.verifiedSelectedLamp=()=>Boolean(!context.connecting&&context.state&&context.selected&&context.lamp.identity===context.selected.id);
 context.advancedAvailable=()=>Boolean(context.lamp.raw);context.legacyWithoutGroups=()=>false;
 const names=['firmwareBackgroundWorkAllowed','pauseFirmwareBackgroundWork','beginForegroundConnection','acquireGroupLamp','closeGroupConnection','stopGroupInspection',
  'createGroupLampLease','connect','openCardSettings','completeCardSettings','connectCardBluetooth','loadApp2EffectSchema'];
 runInNewContext(names.map(handler).join('\n'),context);
 return {context,radio,events,entries,entry:entries[0]};
}
const connect=f=>f.context.connect(f.entry,{expectedId:f.entry.id,readOnlyReconnect:true,navigate:false});

test('nested foreground ownership retires passive work once and fences a 20-lamp inventory',async()=>{
 const f=fixture(),intent={id:entryId},outer=f.context.beginForegroundConnection(intent),inner=f.context.beginForegroundConnection(intent);
 assert.equal(f.context.firmwareBackgroundGeneration,1);assert.equal(f.events.filter(row=>row==='cancel-fleet').length,1);
 for(const entry of f.entries)await assert.rejects(f.context.acquireGroupLamp(entry.id,{readOnly:true}),error=>error.cancelled&&error.readAdmission);
 assert.equal(f.context.groupConnections.size,0);assert.equal(f.radio.events.length,0);
 inner();inner();assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);outer();assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
 f.context.connecting=true;assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);f.context.connecting=false;
});

test('a tour blocks passive native acquisition across twenty lamps without changing foreground ownership',async()=>{
 const f=fixture(),intent={id:entryId},release=f.context.beginForegroundConnection(intent),owner=f.context.foregroundConnectionHold;
 f.context.appTourActive=true;
 for(const entry of f.entries)await assert.rejects(f.context.acquireGroupLamp(entry.id,{readOnly:true}),error=>error.cancelled&&error.readAdmission);
 assert.equal(f.context.groupConnections.size,0);assert.equal(f.radio.events.length,0);assert.equal(f.context.foregroundConnectionHold,owner);
 f.context.appTourActive=false;assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);release();
 assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
});

test('a passive acquisition queued before a tour releases its late lease before any native connection',async()=>{
 const f=fixture(),gate=deferred();let released=0;
 f.context.createMeshLampLease=()=>gate.promise;
 const pending=f.context.acquireGroupLamp(entryId,{readOnly:true}),rejected=assert.rejects(pending,error=>error.cancelled===true);
 await tick();f.context.appTourActive=true;
 gate.resolve({lamp:{},release:async()=>{released++;}});await rejected;
 assert.equal(released,1);assert.equal(f.radio.events.length,0);assert.equal(f.context.groupConnections.size,0);assert(!f.events.includes('provision'));
 f.context.appTourActive=false;assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
});

test('a late foreground release cannot clear a replacement connection intent',()=>{
 const f=fixture(),old=f.context.beginForegroundConnection({id:entryId}),next=f.context.beginForegroundConnection({id:f.entries[1].id});
 old();assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);assert.equal(f.context.firmwareBackgroundGeneration,2);
 next();assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
});

test('foreground native connect waits for shared old teardown and late release cannot disconnect its owner',async()=>{
 const f=fixture(),old=await f.context.acquireGroupLamp(entryId,{readOnly:true}),gate=deferred();
 f.radio.disconnectGates.set(f.entry.deviceId,gate);const closing=old.release();await tick();
 assert.equal(f.context.groupConnections.get(entryId).closed,true);
 const foreground=connect(f);await tick();assert.equal(f.radio.events.filter(row=>row[0]==='connect').length,1);
 assert.equal(f.context.firmwareBackgroundWorkAllowed(),false);
 gate.resolve();await closing;assert.equal((await foreground).connected,true);
 assert.equal(f.radio.events.filter(row=>row[0]==='disconnect-start').length,1);assert.equal(f.radio.events.filter(row=>row[0]==='connect').length,2);
 await old.release();await f.context.stopGroupInspection(entryId);
 assert.equal(f.radio.events.filter(row=>row[0]==='disconnect-start').length,1);
 assert.equal(f.radio.events.filter(row=>row[0]==='subscribe'&&row[2]===STATE).length,2);
 assert(f.radio.events.filter(row=>row[0]==='subscribe').every(row=>row[3]===false));
 assert.equal(f.context.bleLamp.id,f.entry.deviceId);assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);
 clearTimeout(f.context.bleLamp.controlTimer);
});

test('a stale passive acquisition cannot initialize or subscribe after the foreground generation takes ownership',async()=>{
 const f=fixture(),gate=deferred();f.context.createMeshLampLease=()=>gate.promise;
 const pending=f.context.acquireGroupLamp(entryId,{readOnly:true}),rejected=assert.rejects(pending,error=>error.cancelled);await tick();
 const foreground=connect(f);await tick();assert.equal(f.radio.events.length,0);
 gate.reject(Object.assign(Error('No route'),{noRoute:true,confirmed:true}));await rejected;assert.equal((await foreground).connected,true);
 assert.equal(f.events.filter(row=>row==='radio-ready').length,0);assert.equal(f.radio.events.filter(row=>row[0]==='connect').length,1);
 assert.equal(f.context.groupConnections.size,0);assert(!f.events.includes('provision'));clearTimeout(f.context.bleLamp.controlTimer);
});

test('an already issued old native connection is cleaned before the foreground can subscribe',async()=>{
 const f=fixture(),gate=deferred();f.radio.connectGates.set(f.entry.deviceId,gate);
 const pending=f.context.acquireGroupLamp(entryId,{readOnly:true}),rejected=assert.rejects(pending,error=>error.cancelled);await tick();
 assert.equal(f.radio.events.filter(row=>row[0]==='connect').length,1);
 const foreground=connect(f);await tick();assert.equal(f.radio.events.filter(row=>row[0]==='subscribe').length,0);
 gate.resolve();await rejected;assert.equal((await foreground).connected,true);
 assert.equal(f.radio.events.filter(row=>row[0]==='disconnect-start').length,1);
 assert.equal(f.radio.events.filter(row=>row[0]==='subscribe'&&row[2]===STATE).length,1);clearTimeout(f.context.bleLamp.controlTimer);
});

test('a passive replacement waiting on native teardown stays stale even after the hold ends',async()=>{
 const f=fixture(),old=await f.context.acquireGroupLamp(entryId,{readOnly:true}),gate=deferred();f.radio.disconnectGates.set(f.entry.deviceId,gate);
 const closing=old.release();await tick();
 const replacement=f.context.acquireGroupLamp(entryId,{readOnly:true}),rejected=assert.rejects(replacement,error=>error.cancelled&&error.readAdmission);
 await tick();const release=f.context.beginForegroundConnection({id:entryId});release();gate.resolve();await closing;await rejected;
 assert.equal(f.radio.events.filter(row=>row[0]==='connect').length,1);assert.equal(f.context.groupConnections.size,0);
});

test('the current foreground mesh read remains admitted while unrelated passive mesh work is held',async()=>{
 const f=fixture(),intent={id:entryId};f.context.wifiSettingsTarget=intent;
 f.context.selectMeshRecoveryCandidates=selectMeshRecoveryCandidates;f.context.meshBridgeSupported=()=>false;
 f.context.meshRouteCandidates=meshRouteCandidates;f.context.bridgeAccessories={items:[]};
 f.context.compareFirmwareVersions=()=>0;f.context.acquireMeshLamp=async options=>options;
 runInNewContext(handler('createMeshLampLease'),f.context);
 const release=f.context.beginForegroundConnection(intent);
 const selected=await f.context.createMeshLampLease(entryId,{recoveryOnly:true,foregroundIntent:intent,isCurrent:()=>true});
 assert.equal(selected.options.backgroundAllowed(),true);assert.equal(selected.options.totalTimeout,10000);assert.equal(selected.options.timeout,4000);
 const passive=await f.context.createMeshLampLease(f.entries[1].id,{recoveryOnly:true});assert.equal(passive.options.backgroundAllowed(),false);
 f.context.wifiSettingsTarget={id:f.entries[1].id};assert.equal(selected.options.backgroundAllowed(),false);release();
});

test('a queued production metadata read stays fenced after its foreground hold ends',async()=>{
 const f=fixture(),gate=deferred();let queued,reads=0;
 const record={supported:true,mode:null,schemas:new Map(),session:{descriptor:{capabilities:{catalogVersions:[2]}},schema:async()=>{reads++;return {entries:[{localId:4}]};}},
  target:{enqueue:action=>{queued=action;return gate.promise;}}};
 f.context.loadApp2Experience=async()=>record;f.context.app2Experience=record;f.context.assertApp2Target=()=>{};
 f.context.state={mode:4};f.context.lamp={catalog:[{id:4}]};
 const pending=f.context.loadApp2EffectSchema();await tick();const release=f.context.beginForegroundConnection({id:entryId});release();
 try{gate.resolve(await queued());}catch(error){gate.reject(error);}await pending;
 assert.equal(reads,0);assert.equal(record.mode,null);assert.equal(record.loading,false);
});

for(const outcome of ['failure','navigation'])test('foreground '+outcome+' releases admission without adopting stale state',async()=>{
 const f=fixture();let current=true;const gate=deferred();
 if(outcome==='failure')f.radio.stateFailure=true;else f.radio.connectGates.set(f.entry.deviceId,gate);
 const pending=f.context.connect(f.entry,{expectedId:entryId,readOnlyReconnect:true,navigate:false,isCurrent:()=>current});
 if(outcome==='navigation'){await tick();current=false;gate.resolve();}
 assert.equal((await pending).connected,false);assert.equal(f.context.foregroundConnectionHold,null);assert.equal(f.context.connecting,false);
 assert.equal(f.context.selected,null);assert.equal(f.context.firmwareBackgroundWorkAllowed(),true);assert(!f.events.includes('adopt-foreground'));
});

test('verified selected reuse performs no new retirement, connection or subscription',async()=>{
 const f=fixture();assert.equal((await connect(f)).connected,true);clearTimeout(f.context.bleLamp.controlTimer);
 const before=f.radio.events.length,generation=f.context.firmwareBackgroundGeneration;
 assert.equal((await f.context.openCardSettings(f.entry,{section:'hardware',navigate:false})).connected,true);
 assert.equal(f.radio.events.length,before);assert.equal(f.context.firmwareBackgroundGeneration,generation);
 assert.equal(f.context.foregroundConnectionHold,null);
});

test('explicit group acquisition retains provisioning while passive acquisition remains read-only',async()=>{
 const f=fixture(),explicit=await f.context.acquireGroupLamp(entryId,{readOnly:false});
 assert.equal(f.events.filter(row=>row==='provision').length,1);await explicit.release();
 const passive=await f.context.acquireGroupLamp(entryId,{readOnly:true});assert.equal(f.events.filter(row=>row==='provision').length,1);await passive.release();
});
