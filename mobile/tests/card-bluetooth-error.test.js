import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pairingError} from '../src/pairing.js';
import {LampTransport} from '../src/transport.js';
import {CONTROL,STATE,SERVICE,COMMAND} from '../src/protocol.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>{const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first);return source.slice(first,last);};
const handlers=[extract('async function connect(saved ','\nfunction connected('),extract('async function connectCardBluetooth(','\nfunction completeCardSettings('),extract('async function openCardSettings(','\nconst openCardWifiSettings=')].join('\n');
const id='f0b950b2f180',deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function page(text,tx=0,endpoint=0,status=200){
 const bytes=new TextEncoder().encode(text),value=new DataView(new ArrayBuffer(12+bytes.length));
 value.setUint8(0,1);value.setUint16(1,tx,true);value.setUint8(3,endpoint);value.setUint16(4,status,true);
 value.setUint16(6,bytes.length,true);value.setUint16(10,bytes.length,true);new Uint8Array(value.buffer,12).set(bytes);return value;
}
// A deterministic native peer supplies real protected reads and correlated RPC
// pages. Production LampTransport owns identity checks, transactions and errors.
class DenyingRadio{
 constructor(error){this.error=error;this.listeners=new Map();this.packet=new DataView(Uint8Array.from([1,0,0,4,100,1,38,1,0,0,0,0]).buffer);}
 async initialize(){}
 async getDevices(ids){return ids.map(deviceId=>({deviceId}));}
 async connect(deviceId,disconnect){this.disconnectCallback=disconnect;}
 async disconnect(){this.disconnectCallback?.();}
 async startNotifications(_id,_service,characteristic,callback){this.listeners.set(characteristic,callback);}
 async read(_id,_service,characteristic){
  if(characteristic===STATE)return this.packet;
  if(characteristic==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode(id).buffer);
  if(characteristic===CONTROL)return this.response||page(JSON.stringify({version:1,capabilities:['control','groups'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.15.1'}));
  throw Error('Unexpected characteristic');
 }
 async write(_id,service,characteristic,frame){
  assert.equal(service,SERVICE);assert.equal(characteristic,COMMAND);
  const operation=frame.getUint8(2),tx=frame.getUint16(3,true);
  if(operation===22){this.endpoint=frame.getUint8(5);this.response=null;}
  if(operation===24)this.response=page(this.error.message,tx,this.endpoint,this.error.status);
  this.packet=new DataView(Uint8Array.from([1,frame.getUint8(1),0,4,100,1,38,1,0,0,0,0]).buffer);
  this.listeners.get(STATE)?.(this.packet);
 }
}
function fixture({automatic=false,error=Object.assign(Error('Control resources unavailable. No command executed.'),{confirmed:true,status:503}),gate,production=true,proofPatch,freezeProof=true}={}){
 const entry={id,name:'Desk lamp',address:'http://desk.local',deviceId:'AAAAAAAA-0000-0000-0000-000000000001',accessoryManaged:true},calls=[],messages=new Map(),elements=new Map();
 const transport=production?new LampTransport(new DenyingRadio(error),{timeout:80}):{epoch:1,id:null,expectedDeviceIdentity:null,async disconnect(){calls.push('disconnect');++this.epoch;}};
 const actualConnect=production?transport.connect.bind(transport):null;
 transport.connect=async(saved,retry,options)=>{
  calls.push(['connect',saved,options]);assert.equal(typeof options.isCurrent,'function');if(gate)await gate.promise;
  if(production)return actualConnect(saved,retry,options);
  if(proofPatch){const proof={target:id,endpoint:1,method:1,epoch:1,attempt:transport.settingsConnectionProofToken,...proofPatch};
   Object.defineProperty(error,'verifiedSettingsRead',{value:freezeProof?Object.freeze(proof):proof});}
  if(error)throw error;return {...saved,lampId:id};
 };
 const context={bridgeAccessories:{has:()=>false},AbortController,Error,pairingError,entry,calls,bleLamp:transport,cardConnectionMessages:messages,
  store:{items:[entry],upsert:value=>value,rememberFirmware(){}},phonePlatform:'ios',
  bluetoothFirmwareOwner:()=>null,firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice:()=>assert.fail('Unexpected updater'),fleetLampInstalling:()=>false,
  mergedLampEntries:()=>context.store.items,verifiedSelectedLamp:()=>false,cancelMeshSelection(){},stopGroupInspection:async()=>{},
  beginForegroundConnection:()=>()=>{},
  pairCardBluetooth:()=>assert.fail('Saved connection opened pairing'),rememberAuthorizedAccessories:()=>assert.fail('Saved read-only connection requested new authorization'),
  provisionFirmwareFleet:()=>assert.fail('Read-only connection provisioned fleet'),removedAccessoryIds:new Set(),groupRemovedIds:new Set(),roomGroups:{allow(){}},
  status:message=>calls.push(['status',message]),showPairingRecovery:()=>calls.push('pairing-recovery'),
  connectCardWifiAsync:async()=>{calls.push('wifi');return {connected:false,error:Error('Lamp did not respond over Wi-Fi.')};},
  connectMeshCard:async()=>{calls.push('mesh');calls.push(['status','No mesh route to this lamp.']);return {connected:false,error:Error('No mesh route to this lamp.')};},
  completeCardSettings:()=>assert.fail('Failed connection opened settings'),promptWifiPassword:()=>assert.fail('Unexpected password prompt'),
  connected:()=>assert.fail('Failed connection adopted state'),observeLampWifi(){},renderLamps(){},renderPower(){},renderFirmware(){},renderSettings(){},renderOptions(){},
  connectivity:{get:()=>({wifi:{fresh:false,state:'unknown'}})},
  $:key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);}};
 runInNewContext(`let connecting=false,busy=false,navigationSerial=1,cardSettingsSerial=0,bluetoothFirmwareConnectionSerial=0;
 let wifiSettingsTarget=null,selected=null,state=null,firmware=null,pairingRecoveryTarget=null,savedDevice=null;
 let lamp={disconnect:async()=>{}},wifiLamp={};
 ${handlers}
 globalThis.open=(options={})=>openCardSettings(entry,{automaticReconnect:${automatic},...options});
 globalThis.icon=()=>connectCardBluetooth(entry);
 globalThis.leave=()=>{navigationSerial++;wifiSettingsTarget=null;};`,context);
 return {calls,messages,context,entry,transport,open:context.open,icon:context.icon,leave:context.leave};
}

for(const denial of ['Control resources unavailable. No command executed.','Control resources unavailable. This request was not executed.','Read resources unavailable. Nothing changed.','State response memory unavailable. Nothing changed.'])
for(const action of ['icon','gear'])test('an explicit saved '+action+' surfaces the authenticated resource denial without setup or duplicate connection: '+denial,async()=>{
 const f=fixture({error:Object.assign(Error(denial),{confirmed:true,status:503})});const result=await(action==='icon'?f.icon():f.open());assert.equal(result.connected,false);
 assert.equal(result.settingsUnavailable,true);assert(Object.isFrozen(result.error.verifiedSettingsRead));
 assert.equal(result.error.verifiedSettingsRead.target,id);assert.equal(result.error.verifiedSettingsRead.endpoint,1);
 assert.equal(Object.keys(result.error).includes('verifiedSettingsRead'),false);
 const connects=f.calls.filter(row=>Array.isArray(row)&&row[0]==='connect');assert.equal(connects.length,1);
 assert.equal(connects[0][1].readOnlyReconnect,true);assert.equal(connects[0][1].automaticReconnect,false);
 const message=f.messages.get(id);assert.match(message,/answered over Bluetooth/);assert.match(message,/free memory/);
 assert(!/reconnect before trying again|automatically retry/i.test(message));assert(f.calls.some(row=>Array.isArray(row)&&row[0]==='status'&&row[1]===message));
 assert(!f.calls.includes('wifi')&&!f.calls.includes('mesh'));assert.equal(f.transport.raw,null);assert.equal(f.transport.catalog,null);
 assert.equal(f.transport.settingsConnectionProofToken,null);
});

test('a genuine automatic saved reconnect retains quiet failure behavior',async()=>{
 const f=fixture({automatic:true}),result=await f.open();assert.equal(result.connected,false);assert.equal(result.settingsUnavailable,true);assert.equal(f.messages.size,0);
 const connect=f.calls.find(row=>Array.isArray(row)&&row[0]==='connect');assert.equal(connect[1].automaticReconnect,true);assert.equal(connect[1].readOnlyReconnect,true);
 assert(!f.calls.some(row=>Array.isArray(row)&&row[0]==='status'));
 assert(!f.calls.includes('wifi')&&!f.calls.includes('mesh'));
});

for(const error of [Object.assign(Error('Other unavailable service'),{status:503,confirmed:true}),Object.assign(Error('State response incomplete. Nothing changed.'),{status:503,confirmed:true}),
 ...['Control resources unavailable. No command executed.','Control resources unavailable. This request was not executed.','Read resources unavailable. Nothing changed.','State response memory unavailable. Nothing changed.'].map(message=>Object.assign(Error(message),{status:503,confirmed:false}))])test('unverified or unrelated 503 is not guessed as a settings memory problem: '+error.message,async()=>{
 const f=fixture({error,production:error.confirmed!==false});await f.icon();assert.equal(f.messages.get(id),error.message);assert(!/free memory/.test(f.messages.get(id)));
});

for(const [name,proofPatch,freezeProof] of [['missing',undefined,true],['wrong target',{target:'112233445566'},true],['wrong endpoint',{endpoint:2},true],
 ['mutation',{method:2},true],['expired attempt',{attempt:Object.freeze({})},true],['invalid epoch',{epoch:0},true],['mutable',{},false]])
test('an arbitrary 503 with '+name+' proof cannot stop normal direct and mesh route recovery',async()=>{
 const error=Object.assign(Error('Control resources unavailable. No command executed.'),{confirmed:true,status:503});
 const f=fixture({error,production:false,proofPatch,freezeProof}),result=await f.open();assert.notEqual(result.settingsUnavailable,true);
 assert.equal(f.messages.get(id),error.message);assert(!/free memory/.test(f.messages.get(id)));
 assert(f.calls.includes('wifi')&&f.calls.includes('mesh'));assert.equal(f.transport.settingsConnectionProofToken,null);
});

test('an unconfirmed read is never promoted by a local proof object',async()=>{
 const error=Object.assign(Error('Control resources unavailable. No command executed.'),{confirmed:false,status:503});
 const f=fixture({error,production:false,proofPatch:{}}),result=await f.open();assert.notEqual(result.settingsUnavailable,true);
 assert(f.calls.includes('wifi')&&f.calls.includes('mesh'));assert.equal(f.messages.get(id),error.message);
});

test('a late explicit failure after navigation does not replace another card’s feedback',async()=>{
 const gate=deferred(),f=fixture({gate}),run=f.icon();await new Promise(resolve=>setImmediate(resolve));f.leave();gate.resolve();await run;
 assert.equal(f.messages.size,0);assert(!f.calls.some(row=>Array.isArray(row)&&row[0]==='status'&&/free memory/.test(row[1])));
});

test('the production iOS selector keeps explicit read-only reconnect separate from a new authorization picker',async()=>{
 const calls=[],context={LampTransport:class{constructor(_ble,options){this.options=options;}},BleClient:{},isNative:true,phonePlatform:'ios',
  firmwareBackgroundWorkAllowed:()=>true,firmwareBackgroundGeneration:0,transportCallbacks:()=>({}),pairing:{reconnect:async device=>{calls.push('reconnect');return device;},select:async device=>{calls.push('picker');return device;}},
  removedAccessoryIds:new Set(),rememberAccessories:()=>calls.push('save-authorization'),store:{},renderLamps(){},status:()=>calls.push('status')};
 runInNewContext(extract('const bleLamp = new LampTransport(', '\nconst wifiLamp =')+';globalThis.options=bleLamp.options;',context);
 await context.options.selectDevice({deviceId:'saved',readOnlyReconnect:true});context.options.onDeviceSelected({deviceId:'saved',readOnlyReconnect:true,accessoryManaged:true});
 assert.deepEqual(calls,['reconnect']);
});
