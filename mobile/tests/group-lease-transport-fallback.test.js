import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Groups} from '../src/groups.js';
import {WifiTransport} from '../src/wifi.js';
import {compareFirmwareVersions} from '../src/bluetooth-firmware.js';
import {validFirmwareVersion} from '../src/lamps.js';
import {ConnectionBroker,readOnlyConnectionFailure} from '../src/connection-broker.js';
import {MeshInventorySession} from '../src/mesh.js';

const id='bceeb1a28dcc',other='5432e99205d4';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function createGroupLampLease('),end=source.indexOf('\nfunction refreshRoomGroups(',start);
assert(start>=0&&end>start);
const production=source.slice(start,end);
const observeStart=source.indexOf('function observeBrokerConnection('),observeEnd=source.indexOf('\nfunction fleetLampInstalling(',observeStart);
assert(observeStart>=0&&observeEnd>observeStart);
const observeSource=source.slice(observeStart,observeEnd);

function fixture({password='',authorized=true,httpFailure=null,meshAvailable=false,meshFailure=null,afterCredential=null,afterHttp=null,bluetoothFailure=null}={}){
 const entry={id,name:'Sonata Left',deviceId:'authorized-sonata-left',accessoryManaged:authorized,address:'http://192.168.1.234',firmwareVersion:'1.15.7'};
 const events=[],http=[],transports=[];
 const raw={deviceId:id,name:entry.name,token:'fixture-session',hostname:'coollamp-fixture',firmware:{version:'1.15.7',wifi:true},
  mode:4,brightness:100,power:true,leds:128,audio:{installed:true},sync:{version:3,protocolVersions:[2,3],maxMembers:32,maxSupportedMembers:32,
  role:0,leader:'',active:false,paused:false,order:[],peers:[],transport:'hybrid'}};
 const foreground={identity:other},ble={initialization:Promise.resolve()};
 const context={WifiTransport,ConnectionBroker,readOnlyConnectionFailure,connectionBroker:new ConnectionBroker(),CapacitorHttp:{async request(request){http.push(request);assert.equal(request.method,'GET');assert.equal(request.data,undefined);
   events.push('wifi-read');afterHttp?.(context);if(httpFailure)throw httpFailure;return {status:401,data:'Unauthorized'};}},
  firmwareBackgroundGeneration:1,firmwareBackgroundWorkAllowed:()=>context.backgroundAllowed,backgroundAllowed:true,
  groupRemovedIds:new Set(),groupInventoryEntries:()=>context.entries,mergedLampEntries:()=>context.entries,entries:[entry],meshInventory:new MeshInventorySession(),roomGroups:null,
  credential:async target=>{assert.equal(target,id);afterCredential?.(context);return {value:password};},
  lamp:foreground,bleLamp:ble,state:{},selected:{id:other},phonePlatform:'ios',isNative:true,validFirmwareVersion,compareFirmwareVersions,
  createMeshLampLease:async(target,options)=>{assert.equal(target,id);assert.equal(options.recoveryOnly,true);assert(options.isCurrent());events.push('mesh-read');
   if(meshFailure)throw meshFailure;if(!meshAvailable)throw Object.assign(Error('No known mesh route'),{noRoute:true,confirmed:true});
   return {lamp:{identity:id,epoch:1,raw,refresh:async()=>raw},release:async()=>events.push('mesh-release')};},
  initializeGroupRadio:async options=>{assert.deepEqual(Array.from(options.knownDevices(),row=>row.id),[id]);events.push('bluetooth-initialize');},
  BleClient:{},pairing:{},accessoryNative:{},store:{items:[entry]},savedDevice:null,removedAccessoryIds:new Set(),
  rememberAccessories:()=>assert.fail('Discovery cannot authorize a new device'),
  firmwareFleetTrust:{provision:()=>assert.fail('Discovery cannot provision fleet trust')},
  liveGroupBluetooth:new Map(),observeLampWifi(){},observeLampLighting(){},renderLamps(){},clearTimeout};
 context.LampTransport=class {
  constructor(_radio,options){assert.equal(options.expectedDeviceIdentity,id);assert.equal(options.controlOnly,true);this.epoch=1;this.supportsOfflineGroups=true;this.raw=raw;transports.push(this);}
  async connect(saved,_retry,options){events.push('bluetooth-connect');assert.equal(saved.deviceId,entry.deviceId);assert.equal(saved.lampId,id);assert.equal(saved.readOnlyReconnect,true);
   assert(options.isCurrent());if(bluetoothFailure)throw bluetoothFailure;this.identity=id;this.base='ble:'+entry.deviceId;}
  async refresh(expected,_retry,guard){assert.equal(expected,id);guard?.();events.push('bluetooth-read');return raw;}
  async disconnect(){events.push('bluetooth-disconnect');}
  configureSync(){assert.fail('Read-only discovery must not submit membership');}
 };
 runInNewContext(observeSource+'\n'+production+'\nthis.lease=createGroupLampLease;',context);
 const groups=new Groups({getLamps:()=>[entry],acquire:(target,options)=>context.lease(target,options)});
 context.roomGroups=groups;
 return {entry,context,events,http,transports,groups,raw,foreground};
}

for(const password of ['', 'outdated-wifi-password'])test('group discovery exposes a paired Sonata over Bluetooth when Wi-Fi '+(password?'returns 401':'has no saved password'),async()=>{
 const f=fixture({password}),before=structuredClone(f.raw),result=await f.groups.refresh();
 assert.equal(result.unavailable.length,0);assert.equal(result.ungrouped.length,1);
 assert.equal(result.ungrouped[0].id,id);assert.equal(result.ungrouped[0].verified,true);assert.equal(result.ungrouped[0].available,true);
 assert.equal(f.http.length,password?1:0);assert(f.events.includes('bluetooth-read'));
 assert.equal(f.context.lamp,f.foreground);assert.equal(f.context.selected.id,other);assert.equal(f.context.liveGroupBluetooth.size,0);
 assert.deepEqual(f.raw,before);assert.equal(f.events.filter(event=>event==='bluetooth-disconnect').length,1);
});

test('a failed read-only Wi-Fi request also permits the existing paired Bluetooth route',async()=>{
 const f=fixture({password:'saved-password',httpFailure:Error('Native HTTP connection lost')});
 const lease=await f.context.lease(id,{readOnly:true});assert.equal(lease.lamp.identity,id);assert.equal(f.http.length,1);
 assert.deepEqual(f.events,['mesh-read','wifi-read','bluetooth-initialize','bluetooth-connect']);await lease.release();
});

test('a known mesh route can verify the lamp without a Wi-Fi password or another Bluetooth connection',async()=>{
 const f=fixture({meshAvailable:true}),result=await f.groups.refresh();
 assert.equal(result.ungrouped[0].available,true);assert.deepEqual(f.events,['mesh-read','mesh-release']);assert.equal(f.http.length,0);
 assert.equal(f.context.connectionBroker.active.size,0);
});

test('a classified read-only mesh timeout can try the authorized Bluetooth fallback without a write',async()=>{
 const f=fixture({meshFailure:Object.assign(Error('Mesh GET read timed out.'),{readUncertain:true,uncertain:false})});
 const lease=await f.context.lease(id,{readOnly:true});assert.equal(lease.lamp.identity,id);
 assert.deepEqual(f.events,['mesh-read','bluetooth-initialize','bluetooth-connect']);assert.equal(f.http.length,0);
 assert.equal(f.context.connectionBroker.active.get(id).size,1);
 await lease.release();await lease.release();
 assert.equal(f.context.connectionBroker.active.size,0);assert.equal(f.events.filter(event=>event==='bluetooth-disconnect').length,1);
});

for(const password of ['', 'outdated-wifi-password'])test('Wi-Fi '+(password?'rejection':'missing password')+' never starts a new iPhone authorization',async()=>{
 const f=fixture({password,authorized:false});await assert.rejects(f.context.lease(id,{readOnly:true}),error=>error.needsPassword===true);
 assert.equal(f.transports.length,0);assert(!f.events.includes('bluetooth-initialize'));assert.equal(f.http.length,password?1:0);
});

for(const password of ['', 'outdated-wifi-password'])test('explicit onboarding Wi-Fi probe stays on its requested route after '+(password?'401':'missing credentials'),async()=>{
 const f=fixture({password});await assert.rejects(f.context.lease(id,{readOnly:true,onboardingRoute:'wifi'}),error=>error.needsPassword===true);
 assert(!f.events.includes('mesh-read'));assert.equal(f.transports.length,0);assert.equal(f.http.length,password?1:0);
});

test('explicit onboarding Bluetooth probe bypasses Wi-Fi and mesh even when Wi-Fi credentials are missing',async()=>{
 const f=fixture(),lease=await f.context.lease(id,{readOnly:true,onboardingRoute:'bluetooth'});
 assert.deepEqual(f.events,['bluetooth-initialize','bluetooth-connect']);await lease.release();
});

test('explicit onboarding mesh failure never changes routes to Bluetooth',async()=>{
 const f=fixture();await assert.rejects(f.context.lease(id,{readOnly:true,onboardingRoute:'mesh'}),error=>error.noRoute===true);
 assert.deepEqual(f.events,['mesh-read']);assert.equal(f.transports.length,0);
});

for(const [name,invalidate] of [['discovery generation',context=>{context.firmwareBackgroundGeneration++;}],['background admission',context=>{context.backgroundAllowed=false;}],
 ['lamp ownership',context=>{context.groupRemovedIds.add(id);}],['inventory',context=>{context.entries=[];}]])
 test('changed '+name+' fences Wi-Fi fallback',async()=>{
  const f=fixture({password:'saved-password',afterHttp:invalidate});await assert.rejects(f.context.lease(id,{readOnly:true}),error=>error.cancelled===true);
  assert.deepEqual(f.events,['mesh-read','wifi-read']);assert.equal(f.transports.length,0);
 });

test('cancellation during credential lookup cannot open any fallback transport',async()=>{
 const abort=new AbortController(),f=fixture({afterCredential:()=>abort.abort()});
 await assert.rejects(f.context.lease(id,{readOnly:true,signal:abort.signal}),error=>error.cancelled===true);
 assert.deepEqual(f.events,['mesh-read']);assert.equal(f.transports.length,0);
});

test('an uncertain mesh result remains fenced rather than proceeding to Bluetooth',async()=>{
 const f=fixture({meshFailure:Object.assign(Error('Mesh reply was not confirmed'),{uncertain:true})});
 await assert.rejects(f.context.lease(id,{readOnly:true}),error=>error.uncertain===true);
 assert.deepEqual(f.events,['mesh-read']);assert.equal(f.transports.length,0);
});

test('a Bluetooth identity refusal is released without publishing a live group connection',async()=>{
 const f=fixture({bluetoothFailure:Object.assign(Error('Different lamp identity'),{identity:true})});
 await assert.rejects(f.context.lease(id,{readOnly:true}),error=>error.identity===true);
 assert.equal(f.context.liveGroupBluetooth.size,0);assert.equal(f.events.filter(event=>event==='bluetooth-disconnect').length,1);
});
