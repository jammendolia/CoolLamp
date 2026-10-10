import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer, parsePhoneManifest, decodeBleUpdate, OTA_WRITE, OTA_STATUS} from '../src/bluetooth-firmware.js';
import {LampTransport} from '../src/transport.js';
import {SERVICE} from '../src/protocol.js';

function packageValue(size=2048) {
 const image=new Uint8Array(size);for(let i=0;i<size;++i)image[i]=(i*29+(i>>>8)*7)&255;
 const header=new DataView(image.buffer);image[0]=0xe9;header.setUint16(12,5,true);header.setUint32(32,0xabcd5432,true);
 image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.13.0\0'),300);
 const sha=createHash('sha256').update(image).digest('hex');
 return {image,manifest:parsePhoneManifest(`COOLLAMP-OTA-1\n1.13.0\nesp32c3\ndual-ota-2031616\n${size}\n${sha}\n`)};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

// Native completion only copies a frame into a bounded queue. The receiver
// consumes and hashes the frames separately before it advertises written ACKs.
class Receiver {
 constructor({size=2048,mtu=247,capability=true,notifications=true}={}) {
  this.pkg=packageValue(size);this.mtu=mtu;this.capability=capability;this.notifications=notifications;
  this.current=true;this.clock=0;this.queries=0;this.reads=0;this.writes=[];this.pending=[];
  this.s={phase:0,error:0,session:0,size:0,offset:0,ack:0,committed:false};
  this.manifest=[];this.accepted=0;this.sequence=0;this.wraps=0;this.windows=0;this.maxQueued=0;this.dataCalls=0;this.hash=createHash('sha256');
  this.services=[{uuid:SERVICE.toUpperCase(),characteristics:[{uuid:OTA_WRITE.toUpperCase(),properties:{write:true,writeWithoutResponse:true}}]}];
 }
 status(overrides={}) {
  const s={...this.s,...overrides},value=new DataView(new ArrayBuffer(20));
  value.setUint8(0,1);value.setUint8(1,s.phase);value.setUint8(2,s.error);
  value.setUint8(3,(s.committed?1:0)|(this.capability?2:0));
  for(const [at,key] of [[4,'session'],[8,'size'],[12,'offset']])value.setUint32(at,s[key],true);
  value.setUint16(16,s.ack,true);value.setUint16(18,232,true);return value;
 }
 emit(overrides={}){this.listener?.(this.status(overrides));}
 async getServices(id) {
  assert.equal(id,'bulk-target');assert.equal(this.writes.length,0,'GATT preflight must precede every mutation');++this.queries;
  if(this.onDiscovery)await this.onDiscovery();if(this.discoveryError)throw Error('Discovery failed: private native detail');return this.services;
 }
 async getMtu(){return this.mtu;}
 async startNotifications(_id,_service,characteristic,callback){assert.equal(characteristic,OTA_STATUS);this.listener=callback;}
 async stopNotifications(){this.listener=null;}
 async read(id,service,characteristic,options) {
  assert.equal(id,'bulk-target');assert.equal(service,SERVICE);
  if(characteristic==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode('aabbccddeeff').buffer);
  assert.equal(characteristic,OTA_STATUS);++this.reads;this.clock+=3;
  if(this.beforeRead)await this.beforeRead(options);
  if(this.pending.length&&!this.holdAck)this.consume();
  return this.status(this.readOverride?.()??{});
 }
 consume() {
  if(!this.pending.length)return;
  ++this.windows;
  for(const row of this.pending){
   assert.equal(row.offset,this.s.offset);this.hash.update(row.bytes);
   this.s.offset+=row.bytes.length;this.s.ack=row.sequence;
  }
  this.pending.length=0;
 }
 async write(id,service,characteristic,frame,options){return this.submit('response',id,service,characteristic,frame,options);}
 async writeWithoutResponse(id,service,characteristic,frame,options){
  assert.equal(frame.getUint8(1),3,'only Data can use NR');
  if(this.beforeBulk)await this.beforeBulk(frame);
  return this.submit('bulk',id,service,characteristic,frame,options);
 }
 async submit(kind,id,service,characteristic,frame,options) {
  assert.equal(id,'bulk-target');assert.equal(service,SERVICE);assert.equal(characteristic,OTA_WRITE);
  assert(frame.byteLength<=Math.min(244,this.mtu-3));assert.equal(options.timeout,frame.getUint8(1)===5?3000:8000);
  const op=frame.getUint8(1),sequence=frame.getUint16(6,true),session=frame.getUint32(2,true);
  if(op!==5)assert.equal(sequence,this.sequence===65535?1:this.sequence+1);
  if(this.sequence===65535)++this.wraps;this.sequence=sequence;
  if(this.s.session)assert.equal(session,this.s.session);else this.s.session=session;
  this.clock+=kind==='bulk'?1:12;
  const row={op,kind,sequence,offset:op===3?frame.getUint32(8,true):0};this.writes.push(row);
  if(op===1){
   assert.equal(kind,'response');assert.equal(frame.getUint16(8,true),this.manifest.length);
   this.manifest.push(...new Uint8Array(frame.buffer,frame.byteOffset+10,frame.byteLength-10));this.s.ack=sequence;
  }else if(op===2){
   assert.equal(kind,'response');assert.equal(new TextDecoder().decode(new Uint8Array(this.manifest)),this.pkg.manifest.text);
   this.s.phase=2;this.s.size=this.pkg.image.length;this.s.ack=sequence;
  }else if(op===3){
   assert.equal(this.s.phase,2);assert.equal(row.offset,this.accepted);
   const bytes=new Uint8Array(frame.buffer,frame.byteOffset+12,frame.byteLength-12);
   assert.deepEqual(bytes,this.pkg.image.subarray(this.accepted,this.accepted+bytes.length));
   this.pending.push({offset:this.accepted,bytes:bytes.slice(),sequence});this.accepted+=bytes.length;
   this.maxQueued=Math.max(this.maxQueued,this.pending.length);assert(this.pending.length<=4,'no fifth frame before a written ACK');
   if(this.rejectAt===++this.dataCalls){this.consume();this.s.phase=5;this.s.error=7;this.emit();}
   else if(!this.holdAck&&(this.pending.length===4||this.accepted===this.pkg.image.length)){
    this.consume();if(!this.dropNotifications)this.emit();
   }else if(this.staleNotifications)this.emit({session:this.s.session^1,ack:sequence,offset:this.accepted});
  }else if(op===4){
   assert.equal(kind,'response');assert.equal(this.pending.length,0);assert.equal(this.s.offset,this.pkg.image.length);
   assert.equal(this.writes.filter(value=>value.op===4).length,1,'single commit');
   if(this.badDigest||this.hash.digest('hex')!==this.pkg.manifest.sha256){this.s.phase=5;this.s.error=5;}
   else {this.s.phase=4;this.s.committed=true;}this.s.ack=sequence;
  }else if(op===5){assert.equal(kind,'response');this.pending.length=0;this.s.phase=5;this.s.error=8;this.s.ack=sequence;}
  else assert.fail('Unknown operation');
  if(this.afterWrite)await this.afterWrite(op,row);
  if(op!==3&&!this.dropNotifications)this.emit();
 }
 transfer(options={}) {
  const ble=this.notifications?this:{getMtu:this.getMtu.bind(this),getServices:this.getServices.bind(this),read:this.read.bind(this),write:this.write.bind(this),writeWithoutResponse:this.writeWithoutResponse.bind(this)};
  return new BluetoothFirmwareTransfer({ble,deviceId:'bulk-target',allowBulkWrites:true,isCurrent:()=>this.current,
   now:()=>this.clock,delay:async milliseconds=>{this.clock+=milliseconds;},...options});
 }
}
async function failureOf(receiver,transfer=receiver.transfer()) {let failure;try{await transfer.send(receiver.pkg);}catch(value){failure=value;}assert(failure instanceof Error);return failure;}

test('reserved capability flag and committed flag remain independent',()=>{
 const receiver=new Receiver();for(const flags of [0,1,2,3,255]){
  const value=receiver.status();value.setUint8(3,flags);const parsed=decodeBleUpdate(value);
  assert.equal(parsed.committed,Boolean(flags&1));assert.equal(parsed.dataWriteWithoutResponseFour,Boolean(flags&2));
 }
});

for(const mtu of [23,185,247])test(`published-size fast data with MTU ${mtu} hashes every byte, bounds four frames and commits once`,{timeout:30000},async()=>{
 const receiver=new Receiver({size:1920432,mtu});receiver.staleNotifications=true;let previous=-1,count=0;
 const transfer=receiver.transfer({onProgress:value=>{
  assert.equal(receiver.pending.length,0,'native queued bytes never become progress');
  assert.equal(value.progress,Math.floor(receiver.s.offset*100/receiver.pkg.image.length));assert(value.progress>=previous);previous=value.progress;
  if(value.stage==='transferring')assert.equal(count++,receiver.windows);
 }});
 assert.deepEqual(await transfer.send(receiver.pkg),{committed:true,version:'1.13.0'});
 const data=receiver.writes.filter(row=>row.op===3),chunk=Math.min(232,Math.min(244,mtu-3)-12);
 assert.equal(data.length,Math.ceil(1920432/chunk));assert(data.every(row=>row.kind==='bulk'));
 assert.equal(new Set(data.map(row=>row.offset)).size,data.length);assert.equal(receiver.maxQueued,4);
 assert.equal(receiver.wraps,mtu===23?3:0);assert.equal(receiver.queries,1);assert.equal(receiver.reads,1);
 assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert(!receiver.writes.some(row=>row.op===5));
 assert.equal(previous,100);assert.equal(count,receiver.windows+1);assert.equal(transfer.diagnostic().dataWriteMode,'without-response-four');
 assert.equal(transfer.diagnostic().bulkWriteCalls,data.length);assert.equal(transfer.diagnostic().bulkWriteFallback,null);
});

for(const [name,setup,reason,queries] of [
 ['native opt-in disabled',(_r,o)=>{o.allowBulkWrites=false;},'platform-disabled',0],
 ['legacy receiver',r=>{r.capability=false;},'receiver-unsupported',0],
 ['missing NR method',r=>{r.writeWithoutResponse=null;},'sdk-unavailable',0],
 ['missing discovery method',r=>{r.getServices=null;},'sdk-unavailable',0],
 ['stale GATT property',r=>{r.services[0].characteristics[0].properties.writeWithoutResponse=false;},'property-unavailable',1],
 ['unconfirmed property',r=>{r.services[0].characteristics[0].properties.writeWithoutResponse='true';},'property-unavailable',1],
 ['wrong characteristic',r=>{r.services[0].characteristics[0].uuid=OTA_STATUS;},'characteristic-unavailable',1],
 ['wrong service',r=>{r.services[0].uuid='00000000-0000-0000-0000-000000000000';},'characteristic-unavailable',1],
 ['malformed service list',r=>{r.services={services:r.services};},'characteristic-unavailable',1],
 ['service discovery failure',r=>{r.discoveryError=true;},'service-discovery-failed',1],
])test(`${name} selects legacy response writes before mutation`,async()=>{
 const receiver=new Receiver(),options={};setup(receiver,options);const transfer=receiver.transfer(options);
 assert.equal((await transfer.send(receiver.pkg)).committed,true);assert(receiver.writes.every(row=>row.kind==='response'));
 assert.equal(receiver.queries,queries);assert.equal(transfer.diagnostic().dataWriteMode,'with-response');assert.equal(transfer.diagnostic().bulkWriteFallback,reason);
 assert(!JSON.stringify(transfer.diagnostic()).includes('private native detail'));
});

test('default sender does not opt into NR even when both capabilities are present',async()=>{
 const receiver=new Receiver();const transfer=new BluetoothFirmwareTransfer({ble:receiver,deviceId:'bulk-target',now:()=>receiver.clock,delay:async ms=>{receiver.clock+=ms;}});
 assert.equal((await transfer.send(receiver.pkg)).committed,true);assert.equal(receiver.queries,0);assert(receiver.writes.every(row=>row.kind==='response'));
});

test('a capability first seen after initial preflight cannot change an active legacy attempt',async()=>{
 const receiver=new Receiver({capability:false});receiver.afterWrite=op=>{if(op===1)receiver.capability=true;};
 const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
 assert.equal(receiver.queries,0);assert.equal(transfer.diagnostic().receiverBulkWrites,false);assert(receiver.writes.every(row=>row.kind==='response'));
});

test('unsettled discovery stops before mutation and ignores late enabling properties',async()=>{
 const receiver=new Receiver(),discovery=deferred();receiver.onDiscovery=()=>discovery.promise;
 const transfer=receiver.transfer();const failure=await failureOf(receiver,transfer);assert.match(failure.message,/No firmware was sent/);
 discovery.resolve();await Promise.resolve();assert.equal(transfer.diagnostic().dataWriteMode,'with-response');
 assert.equal(transfer.diagnostic().bulkWriteFallback,'service-discovery-pending');assert.equal(receiver.writes.length,0);
});

test('timed-out service discovery never queues a firmware mutation behind the SDK global queue',async()=>{
 const receiver=new Receiver(),discovery=deferred(),calls=[];let tail=Promise.resolve();
 const queue=(method,action)=>{calls.push(method);const work=tail.then(action);tail=work.catch(()=>{});return work;};
 const ble={};
 for(const name of ['read','getMtu','write','writeWithoutResponse','startNotifications','stopNotifications'])ble[name]=(...args)=>queue(name,()=>receiver[name](...args));
 ble.getServices=id=>queue('getServices',async()=>{assert.equal(id,'bulk-target');await discovery.promise;return receiver.services;});
 const transfer=receiver.transfer({ble}),failure=await failureOf(receiver,transfer);
 assert.match(failure.message,/discovery did not finish/);assert.deepEqual(calls,['read','getMtu','getServices']);
 assert.equal(receiver.writes.length,0);assert.equal(failure.updateDiagnostic.bulkWriteFallback,'service-discovery-pending');
 discovery.resolve();await tail;await Promise.resolve();assert.deepEqual(calls,['read','getMtu','getServices']);assert.equal(receiver.writes.length,0);
});

test('connection replacement while readonly discovery is pending sends no frame',async()=>{
 const receiver=new Receiver(),discovery=deferred(),entered=deferred();receiver.onDiscovery=()=>{entered.resolve();return discovery.promise;};
 const transfer=receiver.transfer(),work=transfer.send(receiver.pkg);await entered.promise;receiver.current=false;discovery.resolve();
 await assert.rejects(work,/connection or lamp identity changed/);assert.equal(receiver.writes.length,0);
});

test('Cancel during readonly discovery sends no frame even if discovery later succeeds',async()=>{
 const receiver=new Receiver(),discovery=deferred(),entered=deferred();receiver.onDiscovery=()=>{entered.resolve();return discovery.promise;};
 const transfer=receiver.transfer(),work=transfer.send(receiver.pkg);await entered.promise;await transfer.cancel('user');discovery.resolve();
 await assert.rejects(work,/you cancelled/);assert.equal(receiver.writes.length,0);assert.equal(transfer.diagnostic().stopReason,'user');
});

test('native backpressure must settle each queued Data call before another frame is issued',async()=>{
 const receiver=new Receiver(),gate=deferred(),entered=deferred();let calls=0;const progress=[];
 receiver.beforeBulk=()=>{if(++calls===1){entered.resolve();return gate.promise;}};
 const transfer=receiver.transfer({onProgress:value=>progress.push(value)}),work=transfer.send(receiver.pkg);await entered.promise;
 await Promise.resolve();assert.equal(calls,1);assert(!receiver.writes.some(row=>row.op===3));assert.deepEqual(progress.map(row=>row.progress),[0]);
 gate.resolve();assert.equal((await work).committed,true);assert.equal(receiver.maxQueued,4);
});

test('NR write uncertainty captures matching written bytes and never converts or replays Data',async()=>{
 const receiver=new Receiver();let count=0;
 receiver.afterWrite=op=>{if(op===3&&++count===5)throw Error('Native NR queue timed out.');};
 const failure=await failureOf(receiver),data=receiver.writes.filter(row=>row.op===3);
 assert(failure.uncertain);assert.equal(failure.updateDiagnostic.stopReason,'native-write-failure');assert.equal(data.length,5);
 assert.equal(new Set(data.map(row=>row.offset)).size,5);assert(data.every(row=>row.kind==='bulk'));
 assert.equal(failure.updateDiagnostic.acknowledgedBytes,1160);assert.equal(failure.updateDiagnostic.progress,56);
 assert.equal(failure.updateDiagnostic.dataWriteMode,'without-response-four');assert.equal(receiver.s.error,8);
 assert.equal(receiver.writes.filter(row=>row.op===5).length,1);assert(!receiver.writes.some(row=>row.op===4));
});

test('missing ACK bounds the fast window and does not optimistically report queued bytes',async()=>{
 const receiver=new Receiver({notifications:false});receiver.holdAck=true;const progress=[];
 const failure=await failureOf(receiver,receiver.transfer({onProgress:value=>progress.push(value)}));
 assert.equal(failure.updateDiagnostic.stopReason,'ack-timeout');assert.equal(failure.updateDiagnostic.acknowledgedBytes,0);
 assert.equal(receiver.writes.filter(row=>row.op===3).length,4);assert.equal(receiver.maxQueued,4);
 assert.deepEqual(progress.map(row=>row.progress),[0]);assert(!receiver.writes.some(row=>row.op===4));
});

test('lost fast-path notification polls written ACK without retransmission',async()=>{
 const receiver=new Receiver();receiver.dropNotifications=true;const transfer=receiver.transfer();
 assert.equal((await transfer.send(receiver.pkg)).committed,true);
 const data=receiver.writes.filter(row=>row.op===3);assert.equal(data.length,Math.ceil(receiver.pkg.image.length/232));
 assert.equal(new Set(data.map(row=>row.offset)).size,data.length);assert.equal(transfer.diagnostic().notificationFallback,'missed-ack');
 assert.equal(transfer.diagnostic().dataWriteMode,'without-response-four');assert(data.every(row=>row.kind==='bulk'));
});

test('receiver rejection retains its code and written bytes before response Cancel resets status',async()=>{
 const receiver=new Receiver();receiver.rejectAt=2;const failure=await failureOf(receiver);
 assert(failure.confirmed);assert.equal(failure.updateDiagnostic.error,7);assert.equal(failure.updateDiagnostic.acknowledgedBytes,464);
 assert.equal(receiver.writes.filter(row=>row.op===3).length,2);assert.equal(receiver.s.error,8);
 assert(receiver.writes.filter(row=>row.op!==3).every(row=>row.kind==='response'));assert(!receiver.writes.some(row=>row.op===4));
});

for(const reason of ['user','app-hidden'])test(`${reason} while an NR operation is pending sends no next Data or Finish`,async()=>{
 const receiver=new Receiver(),gate=deferred(),entered=deferred();receiver.beforeBulk=()=>{entered.resolve();return gate.promise;};
 const transfer=receiver.transfer(),work=transfer.send(receiver.pkg);await entered.promise;await transfer.cancel(reason);gate.reject(Error('Pending native write cancelled.'));
 await assert.rejects(work);assert.equal(transfer.diagnostic().stopReason,reason);assert.equal(receiver.writes.filter(row=>row.op===3).length,0);
 assert.equal(receiver.writes.filter(row=>row.op===5).length,1);assert(!receiver.writes.some(row=>row.op===4));
});

test('a native Data queue success arriving after Cancel allows no subsequent Data or Finish',async()=>{
 const receiver=new Receiver(),gate=deferred(),entered=deferred(),write=receiver.write.bind(receiver);
 receiver.beforeBulk=()=>{entered.resolve();return gate.promise;};
 // Model the SDK's native command queue: Cancel cannot overtake a pending NR.
 receiver.write=async(...args)=>{if(args[3].getUint8(1)===5)await gate.promise;return write(...args);};
 const transfer=receiver.transfer(),work=transfer.send(receiver.pkg);await entered.promise;
 const cancellation=transfer.cancel('user');await Promise.resolve();gate.resolve();await cancellation;
 await assert.rejects(work);assert.equal(transfer.diagnostic().stopReason,'user');
 assert.equal(receiver.writes.filter(row=>row.op===3).length,1);assert.equal(receiver.writes.filter(row=>row.op===5).length,1);
 assert(!receiver.writes.some(row=>row.op===4));assert.equal(transfer.diagnostic().acknowledgedBytes,0);
});

test('native dropout during fast Data preserves first reason and never writes on a replacement',async()=>{
 const receiver=new Receiver(),transfer=receiver.transfer();receiver.afterWrite=op=>{if(op===3){transfer.recordStop('native-disconnect');receiver.current=false;throw Error('Radio ended.');}};
 const failure=await failureOf(receiver,transfer);assert.equal(failure.updateDiagnostic.stopReason,'native-disconnect');
 assert.equal(failure.updateDiagnostic.acknowledgedBytes,0);assert.equal(receiver.writes.filter(row=>row.op===3).length,1);
 assert(!receiver.writes.some(row=>row.op===4||row.op===5));
});

test('lost final response remains verification-required with exactly one response Finish and no Cancel',async()=>{
 const receiver=new Receiver();receiver.afterWrite=op=>{if(op===4){receiver.current=false;throw Error('Final response lost.');}};
 const result=await receiver.transfer().send(receiver.pkg);assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);
 assert.equal(result.updateDiagnostic.acknowledgedBytes,2048);assert.equal(receiver.writes.filter(row=>row.op===4).length,1);
 assert(!receiver.writes.some(row=>row.op===5));assert.equal(receiver.writes.at(-1).kind,'response');
});

test('full-size SHA mismatch cannot become success or select an unverified image',async()=>{
 const receiver=new Receiver({size:1920432});receiver.badDigest=true;const failure=await failureOf(receiver);
 assert(failure.confirmed);assert.equal(failure.updateDiagnostic.error,5);assert.equal(failure.updateDiagnostic.acknowledgedBytes,1920432);
 assert.equal(receiver.s.committed,false);assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert(!receiver.writes.some(row=>row.op===5));
});

for(const enabled of [false,true])test(`transport native opt-in ${enabled} is forwarded only to its owned transfer`,async t=>{
 const receiver=new Receiver(),transport=new LampTransport(receiver,{firmwareBulkWrites:enabled});
 transport.id='bulk-target';transport.deviceIdentity='aabbccddeeff';transport.control={capabilities:['control']};
 t.after(()=>clearTimeout(transport.controlTimer));assert.equal((await transport.updateOverBluetooth(receiver.pkg)).committed,true);
 assert.equal(receiver.writes.filter(row=>row.op===3).every(row=>row.kind===(enabled?'bulk':'response')),true);
 assert.equal(receiver.queries,enabled?1:0);assert.equal(transport.bluetoothUpdate,null);
});
