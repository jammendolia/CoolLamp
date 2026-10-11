import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LampTransport} from '../src/transport.js';
import {SERVICE,STATE,CONTROL,FIRMWARE} from '../src/protocol.js';
import {OTA_WRITE,OTA_STATUS,parsePhoneManifest} from '../src/bluetooth-firmware.js';

const target='f0b950b2f180',other='74b950b2f180';
const identity='7b610006-6e2b-4f3d-9a71-28e45c001001';
const saved={id:target,deviceId:'AAAAAAAA-0000-0000-0000-000000000001',accessoryManaged:true,name:'Fixture lamp'};
const text=value=>new DataView(new TextEncoder().encode(value).buffer);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function statePacket(capabilities=255){return new DataView(Uint8Array.of(1,17,0,4,100,1,47,capabilities,9,0,0,0,0,255,60,110).buffer);}
function firmwarePacket(version='1.13.0'){
 const result=new DataView(new ArrayBuffer(20));result.setUint8(0,1);result.setUint8(3,1);
 version.split('.').forEach((number,index)=>result.setUint16(6+index*2,Number(number),true));return result;
}
function controlPacket(value={version:1,capabilities:['control','groups','firmware-relay'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.13.0'}){
 const bytes=new TextEncoder().encode(JSON.stringify(value)),result=new DataView(new ArrayBuffer(12+bytes.length));
 result.setUint8(0,1);result.setUint16(4,200,true);result.setUint16(6,bytes.length,true);result.setUint16(10,bytes.length,true);
 new Uint8Array(result.buffer,12).set(bytes);return result;
}
function receiverPacket(receiver){
 const result=new DataView(new ArrayBuffer(20));result.setUint8(0,1);result.setUint8(1,receiver.phase);result.setUint8(2,receiver.error);
 result.setUint8(3,receiver.phase===4?1:0);
 for(const [offset,key]of[[4,'session'],[8,'size'],[12,'offset']])result.setUint32(offset,receiver[key],true);
 result.setUint16(16,receiver.ack,true);result.setUint16(18,232,true);return result;
}
function fixture(options={}){
 const reads=[],writes=[],connections=[],disconnects=[],subscriptions=[],holds=new Map();
 const receiver={phase:0,error:0,session:0,size:0,offset:0,ack:0};
 const image=new Uint8Array(512),hash=createHash('sha256').update(image).digest('hex');
 const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n512\n'+hash+'\n');
 let protectedIdentity=target;
 const radio={
  async initialize(){connections.push('initialize');},
  async getDevices(ids){const gate=holds.get('getDevices');if(gate){holds.delete('getDevices');gate.started.resolve();await gate.finish.promise;}return ids.map(deviceId=>({deviceId,name:'Fixture lamp'}));},
  async requestDevice(){throw Error('Firmware recovery must not show a picker.');},
  async connect(id,callback){connections.push(id);this.callback=callback;},
  async disconnect(id){disconnects.push(id);const gate=holds.get('disconnect');if(gate){holds.delete('disconnect');gate.started.resolve();await gate.finish.promise;}this.callback?.();},
  async read(id,service,characteristic,readOptions){
   assert.equal(service,SERVICE);reads.push({id,characteristic,timeout:readOptions?.timeout});
   const gate=holds.get(characteristic);if(gate){holds.delete(characteristic);gate.started.resolve();await gate.finish.promise;}
   if(options.read)return options.read(characteristic);
   if(characteristic===STATE)return statePacket();
   if(characteristic===identity)return text(protectedIdentity);
   if(characteristic===CONTROL)return controlPacket();
   if(characteristic===FIRMWARE)return firmwarePacket();
   if(characteristic===OTA_STATUS)return receiverPacket(receiver);
   throw Error('Firmware recovery must not read the full state, catalog or settings.');
  },
  async startNotifications(id,service,characteristic){subscriptions.push(characteristic);},
  async stopNotifications(){},
  async getMtu(){return 247;},
  async write(id,service,characteristic,frame){
   assert.equal(characteristic,OTA_WRITE,'No normal control or settings writes are allowed.');
   const operation=frame.getUint8(1);writes.push(operation);receiver.session=frame.getUint32(2,true);receiver.ack=frame.getUint16(6,true);
   if(operation===2){receiver.phase=2;receiver.size=image.length;}
   if(operation===3){assert.equal(frame.getUint32(8,true),receiver.offset);receiver.offset+=frame.byteLength-12;}
   if(operation===4){receiver.phase=4;if(options.lostFinalReply)throw Error('Native final reply lost.');}
   if(operation===5){receiver.phase=5;receiver.error=8;}
   options.afterWrite?.(operation);
  }
 };
 const lamp=new LampTransport(radio,{firmwareOnly:true,expectedDeviceIdentity:target,timeout:80,
  selectDevice:()=>{throw Error('Firmware recovery must use its saved authorization.');},...options.transport});
 const hold=stage=>{const gate={started:deferred(),finish:deferred()};holds.set(stage,gate);return gate;};
 return {lamp,radio,reads,writes,connections,disconnects,subscriptions,hold,receiver,packageValue:{manifest,image},
  changeIdentity:value=>protectedIdentity=value,
  connect:connectionOptions=>lamp.connect({...saved},true,connectionOptions)};
}

test('firmware-only connection uses four short protected reads without full settings or setup',async()=>{
 const f=fixture();await f.connect();
 assert.deepEqual(f.reads.map(value=>value.characteristic),[STATE,identity,CONTROL,FIRMWARE]);
 assert(f.reads.every(value=>value.timeout===80));assert.deepEqual(f.writes,[]);assert.deepEqual(f.subscriptions,[]);
 assert.equal(f.lamp.identity,target);assert.equal(f.lamp.state.firmware.version,'1.13.0');assert.equal(f.lamp.state.id,17);
 assert.equal(f.lamp.raw,null);assert.equal(f.lamp.catalog,null);assert.equal(f.lamp.controlTimer,null);
 assert.equal(f.lamp.supportsOfflineControl,false);assert.equal(f.lamp.supportsOfflineGroups,false);assert.equal(f.lamp.supportsWifiSetup,false);
 assert.equal(f.lamp.supportsBluetoothFirmware,true);await f.lamp.disconnect();assert.equal(f.lamp.supportsBluetoothFirmware,false);
});

test('restricted connection blocks ordinary commands, raw RPCs, group and fleet provisioning',async()=>{
 const f=fixture();await f.connect();const count=f.reads.length;
 for(const operation of ['power','effect','refresh','autoUpdate','controlBegin','wifiControl','factoryReset'])
  await assert.rejects(f.lamp.command(operation,1),error=>error.confirmed&&error.firmwareOnly);
 for(const [path,data]of[['/api/state'],['/api/firmware/fleet',{key:'fixture'}],['/api/config',{leds:180}],['/api/sync',{role:0}],['/api/mesh/enroll/start',{}]])
  await assert.rejects(f.lamp.request(path,data),error=>error.confirmed&&error.firmwareOnly);
 await assert.rejects(f.lamp.controlRequest(1,1),error=>error.confirmed&&error.firmwareOnly);
 f.lamp.scheduleControlRefresh();assert.equal(f.lamp.controlTimer,null);assert.deepEqual(f.writes,[]);assert.equal(f.reads.length,count);
 await f.lamp.disconnect();
});

test('firmware recovery needs a saved canonical target and never starts new enrollment',async()=>{
 for(const entry of [null,{id:target},{...saved,deviceId:123},{...saved,deviceId:'x'.repeat(129)},{...saved,deviceId:'uuid\n'},
  {...saved,newAuthorization:true},{...saved,id:other},{...saved,id:'future-alias'}]){
  const f=fixture({transport:{expectedDeviceIdentity:entry?.id==='future-alias'?null:target}});
  await assert.rejects(f.lamp.connect(entry),/saved, authorized/);assert.deepEqual(f.connections,[]);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();await f.lamp.connect({...saved,accessoryManaged:undefined});
 // Android does not use Apple's accessory flag; successful protected reads
 // establish security, while the caller retains its platform authorization gate.
 assert.equal(f.lamp.supportsBluetoothFirmware,true);await f.lamp.disconnect();
});

test('wrong or missing protected identity prevents capability reads and all writes',async()=>{
 for(const value of [other,'','F0B950B2F180','f0b950b2f180\n']){
  const f=fixture();f.changeIdentity(value);await assert.rejects(f.connect(),/identity did not match/);
  assert.equal(f.lamp.id,null);assert(!f.reads.some(value=>value.characteristic===CONTROL));assert.deepEqual(f.writes,[]);
 }
});

test('invalid binary state, missing update support, capabilities or firmware fail closed',async()=>{
 for(const failAt of [STATE,'unsupported-state',CONTROL,FIRMWARE]){
  const f=fixture({read:characteristic=>{
   if(characteristic===STATE)return failAt===STATE?new DataView(new ArrayBuffer(15)):statePacket(failAt==='unsupported-state'?251:255);
   if(characteristic===identity)return text(target);
   if(characteristic===CONTROL)return failAt===CONTROL?controlPacket({version:2}):controlPacket();
   if(characteristic===FIRMWARE)return failAt===FIRMWARE?new DataView(new ArrayBuffer(19)):firmwarePacket();
   throw Error('Unexpected read.');
  }});
  await assert.rejects(f.lamp.connect({...saved},false));assert.equal(f.lamp.id,null);assert.equal(f.lamp.supportsBluetoothFirmware,false);assert.deepEqual(f.writes,[]);
 }
});

test('a denied bonded control read gets only one bounded retry, with no enrollment writes',async()=>{
 const denied=new DataView(new ArrayBuffer(12));denied.setUint8(0,1);denied.setUint16(4,403,true);
 const f=fixture({read:characteristic=>characteristic===STATE?statePacket():characteristic===identity?text(target):denied});
 await assert.rejects(f.connect(),/Invalid Bluetooth control/);assert.equal(f.reads.filter(value=>value.characteristic===CONTROL).length,2);
 assert.deepEqual(f.writes,[]);assert.equal(f.lamp.id,null);
});

for(const stage of ['getDevices',STATE,identity,CONTROL,FIRMWARE])test('cancelled firmware acquisition rejects late '+stage+' without another read or write',async()=>{
 const f=fixture(),abort=new AbortController(),gate=f.hold(stage);const pending=f.connect({signal:abort.signal});
 await gate.started.promise;const count=f.reads.length;abort.abort('app-hidden');gate.finish.resolve();
 await assert.rejects(pending,error=>error.cancelled);assert.equal(f.reads.length,count);assert.equal(f.lamp.id,null);
 assert.equal(f.lamp.supportsBluetoothFirmware,false);assert.deepEqual(f.writes,[]);
});

test('owner replacement during a protected read rejects without adopting its old response',async()=>{
 const f=fixture(),gate=f.hold(FIRMWARE);let owned=true;const pending=f.connect({isCurrent:()=>owned});
 await gate.started.promise;owned=false;gate.finish.resolve();await assert.rejects(pending,error=>error.cancelled);
 assert.equal(f.lamp.id,null);assert.equal(f.lamp.state,null);assert.deepEqual(f.writes,[]);
});

test('cancellation during native cleanup cannot revive firmware acquisition',async()=>{
 const f=fixture(),abort=new AbortController(),gate=f.hold('disconnect');f.lamp.id='previous-peripheral';
 const pending=f.connect({signal:abort.signal});await gate.started.promise;abort.abort();gate.finish.resolve();
 await assert.rejects(pending,error=>error.cancelled);assert.deepEqual(f.connections,[]);assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
});

test('late read from an obsolete acquisition never disconnects the replacement connection',async()=>{
 const f=fixture(),gate=f.hold(FIRMWARE),old=f.connect();await gate.started.promise;
 await f.lamp.disconnect();await f.connect();const disconnects=f.disconnects.length;gate.finish.resolve();
 await assert.rejects(old,/changed/);assert.equal(f.disconnects.length,disconnects);assert.equal(f.lamp.id,saved.deviceId);
 assert.equal(f.lamp.supportsBluetoothFirmware,true);await f.lamp.disconnect();
});

test('firmware-only lease sends the existing verified transfer and never schedules settings refresh',async()=>{
 const f=fixture();await f.connect();const result=await f.lamp.updateOverBluetooth(f.packageValue);
 assert.equal(result.committed,true);assert.equal(f.writes.filter(operation=>operation===4).length,1);
 assert.equal(f.receiver.offset,512);assert(f.writes.every(operation=>[1,2,3,4].includes(operation)));
 assert.equal(f.lamp.controlTimer,null);assert.equal(f.lamp.raw,null);await f.lamp.disconnect();
});

test('lost final reply remains unconfirmed, without repeating boot selection or cancelling it',async()=>{
 const f=fixture({lostFinalReply:true});await f.connect();const result=await f.lamp.updateOverBluetooth(f.packageValue);
 assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);assert.equal(f.writes.filter(operation=>operation===4).length,1);
 assert(!f.writes.includes(5));assert.equal(f.lamp.controlTimer,null);await f.lamp.disconnect();
});

test('protected target identity is rechecked immediately before any update write',async()=>{
 const f=fixture();await f.connect();f.changeIdentity(other);
 await assert.rejects(f.lamp.updateOverBluetooth(f.packageValue),/lamp changed/);assert.deepEqual(f.writes,[]);
 assert.equal(f.lamp.controlTimer,null);await f.lamp.disconnect();
});

test('a cancelled or superseded firmware lease cannot refresh status or start a transfer',async()=>{
 for(const kind of ['cancel','owner']){
  const f=fixture(),abort=new AbortController();let owned=true;await f.connect({signal:abort.signal,isCurrent:()=>owned});const count=f.reads.length;
  if(kind==='cancel')abort.abort();else owned=false;
  await assert.rejects(f.lamp.refreshFirmware(),error=>error.cancelled);await assert.rejects(f.lamp.updateOverBluetooth(f.packageValue));
  assert.equal(f.reads.length,count);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
 }
});

test('loss of the card owner during transfer stops data without selecting a boot image or rerouting',async()=>{
 let owned=true;const f=fixture({afterWrite:operation=>{if(operation===3)owned=false;}});
 await f.connect({isCurrent:()=>owned});
 await assert.rejects(f.lamp.updateOverBluetooth(f.packageValue),error=>error.updateDiagnostic?.connectionCurrent===false);
 assert(f.writes.includes(3));assert(!f.writes.includes(4));assert(!f.writes.includes(5));
 assert.equal(f.lamp.supportsBluetoothFirmware,false);assert.equal(f.lamp.controlTimer,null);await f.lamp.disconnect();
});

test('a reused healthy normal connection also fences its superseded firmware task before Finish',async t=>{
 let owned=true;const f=fixture({transport:{firmwareOnly:false,controlOnly:true,selectDevice:null},afterWrite:operation=>{if(operation===3)owned=false;}});
 t.after(()=>clearTimeout(f.lamp.controlTimer));
 const entries=Array.from({length:47},(_,index)=>({id:index+1,name:'Fixture effect '+(index+1),category:'other',speed:true}));
 f.lamp.request=async path=>{if(path==='/api/effects')return JSON.stringify(entries);assert.equal(path,'/api/state');
  return JSON.stringify({deviceId:target,effects:entries.map(entry=>entry.name),mode:4,brightness:100,power:true,leds:134});};
 await f.connect();assert.equal(f.lamp.supportsOfflineControl,true);assert.equal(f.lamp.firmwareOnly,false);
 await assert.rejects(f.lamp.updateOverBluetooth(f.packageValue,()=>{},{isCurrent:()=>owned}),error=>error.updateDiagnostic?.connectionCurrent===false);
 assert(f.writes.includes(3));assert(!f.writes.includes(4));assert(!f.writes.includes(5));await f.lamp.disconnect();
});

test('an update owner callback failure fails closed before any native update operation',async()=>{
 const f=fixture();await f.connect();const count=f.reads.length;
 await assert.rejects(f.lamp.updateOverBluetooth(f.packageValue,()=>{},{isCurrent:()=>{throw Error('Obsolete task.');}}),/connection changed/);
 assert.equal(f.reads.length,count);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('native protected-read authentication failure does not proceed to identity or an update write',async()=>{
 const f=fixture({read:()=>{throw Error('Native encrypted read denied.');}});
 await assert.rejects(f.connect(),/encrypted read denied/);assert.deepEqual(f.reads.map(value=>value.characteristic),[STATE]);
 assert.equal(f.lamp.id,null);assert.deepEqual(f.writes,[]);
});

test('firmware recovery does not need mappings for a future binary effect catalog',async()=>{
 const unknown=statePacket(36);unknown.setUint8(3,200);unknown.setUint8(6,240);
 const f=fixture({read:characteristic=>characteristic===STATE?unknown:characteristic===identity?text(target):characteristic===CONTROL?controlPacket():firmwarePacket()});
 await f.connect();assert.equal(f.lamp.state.mode,200);assert.equal(f.lamp.catalog,null);assert.equal(f.lamp.supportsBluetoothFirmware,true);
 assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('cancelled saved-peripheral scan is stopped without waiting for its eight-second discovery deadline',async()=>{
 const f=fixture(),abort=new AbortController(),started=deferred();let stopped=0;
 f.radio.getDevices=async()=>[];f.radio.getConnectedDevices=async()=>[];
 f.radio.requestLEScan=async()=>started.resolve();f.radio.stopLEScan=async()=>stopped++;
 const pending=f.connect({signal:abort.signal});await started.promise;abort.abort();
 await assert.rejects(pending,error=>error.cancelled);assert.equal(stopped,1);assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[]);
});

test('the existing single service-cache retry remains read-only for a firmware lease',async()=>{
 let initialReads=0;const f=fixture({read:characteristic=>{
  if(characteristic===STATE)return ++initialReads===1?new DataView(new ArrayBuffer(15)):statePacket();
  if(characteristic===identity)return text(target);if(characteristic===CONTROL)return controlPacket();return firmwarePacket();
 }});
 await f.connect();assert.equal(initialReads,2);assert.equal(f.connections.filter(value=>value===saved.deviceId).length,2);
 assert.equal(f.lamp.supportsBluetoothFirmware,true);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('ordinary control connections still require a valid full settings snapshot',async()=>{
 const f=fixture({transport:{firmwareOnly:false,controlOnly:true,selectDevice:null}});let fullReads=0;
 f.lamp.request=async path=>{assert.equal(path,'/api/state');fullReads++;return '{"deviceId":';};
 await assert.rejects(f.connect(),/Invalid Bluetooth settings snapshot/);assert.equal(fullReads,1);assert.equal(f.lamp.id,null);
 assert.deepEqual(f.writes,[]);
});
