import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LampTransport} from '../src/transport.js';
import {parsePhoneManifest,OTA_STATUS,OTA_WRITE} from '../src/bluetooth-firmware.js';
function setup(){
 const image=new Uint8Array(2048),sha=createHash('sha256').update(image).digest('hex'),manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.13.0\nesp32c3\ndual-ota-2031616\n2048\n'+sha+'\n');
 let dataFrames=0,release,held;
 const paused=new Promise(resolve=>held=resolve),state={phase:0,error:0,session:0,size:0,offset:0,ack:0},writes=[],disconnects=[];
 const ble={getMtu:async()=>247,disconnect:async id=>disconnects.push(id),read:async(id,service,char)=>{
  if(char.startsWith('7b610006'))return new DataView(new TextEncoder().encode('aabbccddeeff').buffer);
  assert.equal(char,OTA_STATUS);const data=new DataView(new ArrayBuffer(20));data.setUint8(0,1);data.setUint8(1,state.phase);data.setUint8(2,state.error);data.setUint8(3,state.phase===4?1:0);
  for(const [offset,key]of[[4,'session'],[8,'size'],[12,'offset']])data.setUint32(offset,state[key],true);data.setUint16(16,state.ack,true);data.setUint16(18,232,true);return data;
 },write:async(id,service,char,data)=>{
  assert.equal(char,OTA_WRITE);const op=data.getUint8(1);writes.push(op);state.session=data.getUint32(2,true);state.ack=data.getUint16(6,true);
  if(op===2){state.phase=2;state.size=image.length;}if(op===3){assert.equal(data.getUint32(8,true),state.offset);state.offset+=data.byteLength-12;if(++dataFrames===5){held();await new Promise(resolve=>release=resolve);}}
  if(op===4)state.phase=4;if(op===5){state.phase=5;state.error=8;}
 }};
 const lamp=new LampTransport(ble);lamp.id='target';lamp.deviceIdentity='aabbccddeeff';lamp.control={capabilities:['control']};
 return {lamp,packageValue:{manifest,image},paused,release:()=>release(),writes,disconnects,state};
}
test('ordinary transport teardown cannot cancel an active firmware owner',async t=>{
 const f=setup();t.after(()=>clearTimeout(f.lamp.controlTimer));const work=f.lamp.updateOverBluetooth(f.packageValue);await f.paused;
 const epoch=f.lamp.epoch,transfer=f.lamp.bluetoothUpdate;await assert.rejects(f.lamp.disconnect(),error=>error.firmwareBusy&&error.confirmed);
 assert.equal(f.lamp.epoch,epoch);assert.equal(f.lamp.id,'target');assert.equal(transfer.cancelled,false);assert.deepEqual(f.disconnects,[]);assert(!f.writes.includes(5));
 f.release();assert.equal((await work).committed,true);assert.equal(f.writes.filter(op=>op===4).length,1);assert(!f.writes.includes(5));
});
test('real native disconnect is recorded before identity and epoch are cleared',async t=>{
 const f=setup();t.after(()=>clearTimeout(f.lamp.controlTimer));const work=f.lamp.updateOverBluetooth(f.packageValue);await f.paused;f.lamp.disconnected('target');f.release();
 await assert.rejects(work,error=>error.updateDiagnostic?.stopReason==='native-disconnect'&&error.updateDiagnostic.connectionCurrent===false);
 assert.equal(f.lamp.id,null);assert(!f.writes.includes(4));assert(!f.writes.includes(5));
});
test('app-hidden AbortSignal keeps its first stop cause and bounded receiver-confirmed offset',async t=>{
 const f=setup(),abort=new AbortController();t.after(()=>clearTimeout(f.lamp.controlTimer));const work=f.lamp.updateOverBluetooth(f.packageValue,()=>{},{signal:abort.signal});await f.paused;abort.abort('app-hidden');
 await f.lamp.bluetoothUpdate.cancel('app-hidden');f.release();await assert.rejects(work,error=>error.updateDiagnostic?.stopReason==='app-hidden'&&error.updateDiagnostic.acknowledgedBytes===1160);
 assert.equal(f.writes.filter(op=>op===5).length,1);assert(!f.writes.includes(4));
});
test('a user Cancel keeps that reason if the native disconnect callback follows it',async t=>{
 const f=setup(),abort=new AbortController();t.after(()=>clearTimeout(f.lamp.controlTimer));const work=f.lamp.updateOverBluetooth(f.packageValue,()=>{},{signal:abort.signal});await f.paused;abort.abort('user');await f.lamp.bluetoothUpdate.cancel('user');f.lamp.disconnected('target');f.release();
 await assert.rejects(work,error=>error.updateDiagnostic?.stopReason==='user');assert(!f.writes.includes(4));
});
