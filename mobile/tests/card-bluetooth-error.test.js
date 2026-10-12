import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pairingError} from '../src/pairing.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>{const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first);return source.slice(first,last);};
const handlers=[extract('async function connect(saved ','\nfunction connected('),extract('async function connectCardBluetooth(','\nfunction completeCardSettings('),extract('async function openCardSettings(','\nconst openCardWifiSettings=')].join('\n');
const id='f0b950b2f180',deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({automatic=false,error=Object.assign(Error('Control resources unavailable. No command executed.'),{confirmed:true,status:503}),gate}={}){
 const entry={id,name:'Desk lamp',deviceId:'AAAAAAAA-0000-0000-0000-000000000001',accessoryManaged:true},calls=[],messages=new Map(),elements=new Map();
 const transport={epoch:1,id:null,expectedDeviceIdentity:null,
  async connect(saved,retry,options){calls.push(['connect',saved,options]);assert.equal(typeof options.isCurrent,'function');if(gate)await gate.promise;if(error)throw error;return {...saved,lampId:id};},
  async disconnect(){calls.push('disconnect');++this.epoch;}};
 const context={AbortController,Error,pairingError,entry,calls,bleLamp:transport,cardConnectionMessages:messages,
  store:{items:[entry],upsert:value=>value,rememberFirmware(){}},phonePlatform:'ios',
  bluetoothFirmwareOwner:()=>null,firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice:()=>assert.fail('Unexpected updater'),fleetLampInstalling:()=>false,
  mergedLampEntries:()=>context.store.items,verifiedSelectedLamp:()=>false,cancelMeshSelection(){},stopGroupInspection:async()=>{},
  pairCardBluetooth:()=>assert.fail('Saved connection opened pairing'),rememberAuthorizedAccessories:()=>assert.fail('Saved read-only connection requested new authorization'),
  provisionFirmwareFleet:()=>assert.fail('Read-only connection provisioned fleet'),removedAccessoryIds:new Set(),groupRemovedIds:new Set(),roomGroups:{allow(){}},
  status:message=>calls.push(['status',message]),showPairingRecovery:()=>calls.push('pairing-recovery'),
  connectCardWifiAsync:async()=>({connected:false}),connectMeshCard:async()=>({connected:false}),
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
 return {calls,messages,context,entry,open:context.open,icon:context.icon,leave:context.leave};
}

for(const denial of ['Control resources unavailable. No command executed.','Control resources unavailable. This request was not executed.','Read resources unavailable. Nothing changed.','State response memory unavailable. Nothing changed.'])
for(const action of ['icon','gear'])test('an explicit saved '+action+' surfaces the authenticated resource denial without setup or duplicate connection: '+denial,async()=>{
 const f=fixture({error:Object.assign(Error(denial),{confirmed:true,status:503})});const result=await(action==='icon'?f.icon():f.open());assert.equal(result.connected,false);
 const connects=f.calls.filter(row=>Array.isArray(row)&&row[0]==='connect');assert.equal(connects.length,1);
 assert.equal(connects[0][1].readOnlyReconnect,true);assert.equal(connects[0][1].automaticReconnect,false);
 const message=f.messages.get(id);assert.match(message,/answered over Bluetooth/);assert.match(message,/free memory/);
 assert(!/reconnect before trying again|automatically retry/i.test(message));assert(f.calls.some(row=>Array.isArray(row)&&row[0]==='status'&&row[1]===message));
});

test('a genuine automatic saved reconnect retains quiet failure behavior',async()=>{
 const f=fixture({automatic:true});assert.equal((await f.open()).connected,false);assert.equal(f.messages.size,0);
 const connect=f.calls.find(row=>Array.isArray(row)&&row[0]==='connect');assert.equal(connect[1].automaticReconnect,true);assert.equal(connect[1].readOnlyReconnect,true);
 assert(!f.calls.some(row=>Array.isArray(row)&&row[0]==='status'));
});

for(const error of [Object.assign(Error('Other unavailable service'),{status:503,confirmed:true}),Object.assign(Error('State response incomplete. Nothing changed.'),{status:503,confirmed:true}),
 ...['Control resources unavailable. No command executed.','Control resources unavailable. This request was not executed.','Read resources unavailable. Nothing changed.','State response memory unavailable. Nothing changed.'].map(message=>Object.assign(Error(message),{status:503,confirmed:false}))])test('unverified or unrelated 503 is not guessed as a settings memory problem: '+error.message,async()=>{
 const f=fixture({error});await f.icon();assert.equal(f.messages.get(id),error.message);assert(!/free memory/.test(f.messages.get(id)));
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
