import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LampTransport} from '../src/transport.js';
import {BluetoothFirmwareTransfer,OTA_STATUS,OTA_WRITE,parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {STATE,CONTROL,FIRMWARE} from '../src/protocol.js';

const target='f0b950b2f180',identity='7b610006-6e2b-4f3d-9a71-28e45c001001';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const text=value=>new DataView(new TextEncoder().encode(value).buffer);
function fixture(){
 const image=new Uint8Array(512),sha256=createHash('sha256').update(image).digest('hex');
 const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n512\n'+sha256+'\n');
 const receiver={phase:0,error:0,session:0,size:0,offset:0,ack:0},reads=[],writes=[],disconnects=[],holds=new Map(),events=[];
 let current=true,canonical=target,failRead=null,loseFinish=false,resumeFlags=0;
 const radio={
  async initialize(){},async getDevices(ids){return ids.map(deviceId=>({deviceId}));},async connect(){},async disconnect(id){disconnects.push(id);},async getMtu(){return 247;},
  async read(id,service,char){
   reads.push(char);const gate=holds.get(char);if(gate){holds.delete(char);gate.started.resolve();await gate.finished.promise;}
   if(char===failRead)throw Error('not connected to device');
   if(char===identity)return text(canonical);
   if(char===STATE)return new DataView(Uint8Array.of(1,0,0,4,100,1,47,36,0,0,0,0).buffer);
   if(char===FIRMWARE){const p=new DataView(new ArrayBuffer(20));p.setUint8(0,1);p.setUint16(6,1,true);p.setUint16(8,13,true);return p;}
   if(char===CONTROL){const body=new TextEncoder().encode(JSON.stringify({version:1,capabilities:['control'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.13.0'}));
    const p=new DataView(new ArrayBuffer(12+body.length));p.setUint8(0,1);p.setUint16(4,200,true);p.setUint16(6,body.length,true);p.setUint16(10,body.length,true);new Uint8Array(p.buffer,12).set(body);return p;}
   assert.equal(char,OTA_STATUS);const p=new DataView(new ArrayBuffer(20));p.setUint8(0,1);p.setUint8(1,receiver.phase);p.setUint8(2,receiver.error);p.setUint8(3,(receiver.phase===4?1:0)|resumeFlags);
   for(const [at,key]of[[4,'session'],[8,'size'],[12,'offset']])p.setUint32(at,receiver[key],true);p.setUint16(16,receiver.ack,true);p.setUint16(18,232,true);return p;
  },async write(id,service,char,frame){
   assert.equal(char,OTA_WRITE);const op=frame.getUint8(1);writes.push(op);events.push({native:op,sequence:frame.getUint16(6,true)});
   receiver.session=frame.getUint32(2,true);receiver.ack=frame.getUint16(6,true);
   if(op===2){receiver.phase=2;receiver.size=image.length;}
   if(op===3){assert.equal(frame.getUint32(8,true),receiver.offset);receiver.offset+=frame.byteLength-12;}
   if(op===4){receiver.phase=4;if(loseFinish)throw Error('Final native reply lost.');}
   if(op===5){receiver.phase=5;receiver.error=8;}
  }
 };
 const transfer=()=>new BluetoothFirmwareTransfer({ble:radio,deviceId:'saved-peripheral',isCurrent:()=>current});
 const lamp=new LampTransport(radio,{firmwareOnly:true,expectedDeviceIdentity:target,timeout:80});
 const hold=char=>{const gate={started:deferred(),finished:deferred()};holds.set(char,gate);return gate;};
 return {radio,transfer,lamp,reads,writes,disconnects,events,receiver,hold,pkg:{manifest,image},
  connect:options=>lamp.connect({id:target,deviceId:'saved-peripheral'},true,options),
  setCurrent:value=>current=value,setIdentity:value=>canonical=value,setFailRead:value=>failRead=value,setLoseFinish:()=>loseFinish=true,setResumeFlags:value=>resumeFlags=value};
}

test('actual sender awaits a durable observer before every native frame and reports exact acknowledged bytes',async()=>{
 const f=fixture(),transfer=f.transfer(),gate=deferred(),started=deferred(),progress=[];transfer.onProgress=value=>progress.push(value);
 const pending=transfer.send(f.pkg,{onBeforeWrite:async intent=>{
  assert(Object.isFrozen(intent));assert.equal(intent.operation,intent.op);assert.equal(intent.version,'1.15.1');assert.equal(intent.size,512);assert.equal(intent.sha256,f.pkg.manifest.sha256);
  if(!f.events.length){started.resolve();await gate.promise;}f.events.push({saved:intent.operation,sequence:intent.sequence});
 }});
 await started.promise;assert.deepEqual(f.writes,[]);assert.equal(transfer.commitAttempted,false);assert.equal(transfer.beginAttempted,false);gate.resolve();
 const result=await pending;assert.equal(result.committed,true);assert.equal(result.version,'1.15.1');
 assert(Object.isFrozen(result.receipt));assert.deepEqual(result.receipt,{session:transfer.session,size:512,offset:512,ack:transfer.sequence,phase:4,error:0,committed:true});
 assert.equal(f.events.length,f.writes.length*2);
 for(let i=0;i<f.events.length;i+=2)assert.deepEqual(f.events[i],{saved:f.events[i+1].native,sequence:f.events[i+1].sequence});
 const sent=progress.filter(value=>value.stage==='transferring');assert.equal(sent[0].acknowledgedBytes,0);assert.equal(sent.at(-1).acknowledgedBytes,512);
 assert(sent.every(value=>value.total===512));assert.equal(transfer.diagnostic().writesAttempted,f.writes.length);
 assert.equal(transfer.diagnostic().metadataIssued,true);assert.equal(transfer.diagnostic().beginAttempted,true);assert.equal(transfer.diagnostic().commitAttempted,true);
});

for(const denied of [1,2,4])test('storage failure before operation '+denied+' sends no such frame and never fabricates a commit',async()=>{
 const f=fixture(),transfer=f.transfer(),intents=[];
 await assert.rejects(transfer.send(f.pkg,{onBeforeWrite:async intent=>{
  intents.push(intent);if(intent.op===denied)throw Error('Private storage details must not escape.');
 }}),failure=>{
  assert.equal(failure.journalFailure,true);assert.equal(failure.commitAttempted,false);assert.equal(failure.updateDiagnostic.commitAttempted,false);
  assert.equal(failure.installationNotStarted,denied===1);assert.equal(failure.metadataIssued,denied!==1);
  assert.equal(failure.uncertain,denied!==1);assert(!failure.message.includes('Private storage'));
  assert.equal(failure.updateDiagnostic.beginAttempted,denied===4);return true;
 });
 assert(!f.writes.includes(denied));assert(!f.writes.includes(4));
 if(denied!==1){assert(f.writes.includes(5));assert(intents.some(value=>value.op===5));}
 else assert.deepEqual(f.writes,[]);
});

test('an observer which loses its owner cannot release a late native write',async()=>{
 const f=fixture(),transfer=f.transfer(),gate=deferred(),started=deferred();
 const pending=transfer.send(f.pkg,{onBeforeWrite:async()=>{started.resolve();await gate.promise;}});
 await started.promise;f.setCurrent(false);gate.resolve();
 await assert.rejects(pending,failure=>failure.installationNotStarted&&failure.updateDiagnostic.writesAttempted===0&&!failure.uncertain);
 assert.deepEqual(f.writes,[]);
});

test('an abandoned storage observer has a bounded deadline and cannot send its frame later',{timeout:7000},async()=>{
 const f=fixture(),transfer=f.transfer(),gate=deferred();
 await assert.rejects(transfer.send(f.pkg,{onBeforeWrite:()=>gate.promise}),failure=>failure.journalFailure&&failure.installationNotStarted);
 assert.deepEqual(f.writes,[]);gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.writes,[]);
});

test('a lost final ACK preserves one-shot commit fencing after its journal succeeded',async()=>{
 const f=fixture(),transfer=f.transfer(),intents=[];f.setLoseFinish();
 const result=await transfer.send(f.pkg,{onBeforeWrite:async intent=>intents.push(intent)});
 assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);assert.equal(result.updateDiagnostic.commitAttempted,true);
 assert.equal(result.receipt,undefined);
 assert.equal(f.writes.filter(op=>op===4).length,1);assert.equal(intents.filter(value=>value.op===4).length,1);assert(!f.writes.includes(5));
});

for(const char of [identity,OTA_STATUS])test('post-download '+char+' read failure proves no installation began',async()=>{
 const f=fixture();await f.connect();f.setFailRead(char);
 await assert.rejects(f.lamp.updateOverBluetooth(f.pkg),failure=>{
  assert.equal(failure.installationNotStarted,true);assert.equal(failure.metadataIssued,false);assert.equal(failure.uncertain,false);
  assert.equal(failure.updateDiagnostic.writesAttempted,0);assert.equal(failure.updateDiagnostic.beginAttempted,false);assert.equal(failure.updateDiagnostic.commitAttempted,false);return true;
 });
 assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('protected firmware snapshot reads identity, firmware, binary state and receiver without control writes or cache changes',async()=>{
 const f=fixture();await f.connect();const before=f.reads.length,oldState=f.lamp.state;
 f.receiver.phase=2;f.receiver.session=42;f.receiver.size=512;f.receiver.offset=232;
 f.setResumeFlags(12);
 const snapshot=await f.lamp.readFirmwareUpdateSnapshot({expectedSession:42});
 assert(Number.isFinite(snapshot.observedAt)&&snapshot.observedAt<=Date.now());
 assert.equal(snapshot.identity,target);assert.equal(snapshot.firmware.version,'1.13.0');assert.equal(snapshot.state.mode,4);
 assert.equal(snapshot.receiver.session,42);assert.equal(snapshot.receiver.offset,232);
 assert.equal(snapshot.receiver.resumeSupported,true);assert.equal(snapshot.receiver.detached,true);
 assert.deepEqual(f.reads.slice(before),[identity,FIRMWARE,STATE,OTA_STATUS]);assert.deepEqual(f.writes,[]);assert.equal(f.lamp.state,oldState);assert.equal(f.lamp.raw,null);assert.equal(f.lamp.catalog,null);
 await f.lamp.disconnect();
});

test('snapshot target mismatch stops before later reads; receiver session mismatch stays uncertain',async()=>{
 const f=fixture();await f.connect();f.setIdentity('74b950b2f180');const before=f.reads.length;
 await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),failure=>failure.identity&&failure.confirmed);
 assert.deepEqual(f.reads.slice(before),[identity]);assert.deepEqual(f.writes,[]);f.setIdentity(target);
 await assert.rejects(f.lamp.readFirmwareUpdateSnapshot({expectedSession:42}),failure=>failure.sessionChanged&&failure.uncertain);
 assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('out-of-bounds receiver snapshots and throwing ownership checks fail without a mutation',async()=>{
 const f=fixture();await f.connect();
 for(const [size,offset]of[[2031617,0],[512,513]]){
  f.receiver.size=size;f.receiver.offset=offset;await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),/receiver snapshot/);
 }
 f.receiver.size=512;f.receiver.offset=512;f.receiver.phase=2;f.setResumeFlags(1);
 await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),/receiver snapshot/);
 const reads=f.reads.length;await assert.rejects(f.lamp.readFirmwareUpdateSnapshot({isCurrent:()=>{throw Error('Private callback details.');}}),failure=>failure.cancelled);
 assert.equal(f.reads.length,reads);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('committed receiver snapshots require a complete nonempty image and the commit flag',async()=>{
 const f=fixture();await f.connect();f.receiver.phase=4;
 for(const [size,offset]of[[0,0],[512,232]]){
  f.receiver.size=size;f.receiver.offset=offset;await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),/receiver snapshot/);
 }
 f.receiver.size=512;f.receiver.offset=512;
 const read=f.radio.read.bind(f.radio);f.radio.read=async(...args)=>{
  const value=await read(...args);if(args[2]===OTA_STATUS)value.setUint8(3,value.getUint8(3)&~1);return value;
 };
 await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),/receiver snapshot/);f.radio.read=read;
 assert.equal((await f.lamp.readFirmwareUpdateSnapshot()).receiver.committed,true);
 assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('a private lease cancelled with its connection signal sends no late data or Cancel and closes only that lease',async()=>{
 const f=fixture(),abort=new AbortController(),gate=deferred(),started=deferred();await f.connect({signal:abort.signal});
 const pending=f.lamp.updateOverBluetooth(f.pkg,()=>{},{signal:abort.signal,onBeforeWrite:async intent=>{
  if(intent.op===3){started.resolve();await gate.promise;}
 }});
 await started.promise;const writes=[...f.writes];assert(writes.includes(2));abort.abort();gate.resolve();
 await assert.rejects(pending,failure=>failure.updateDiagnostic.beginAttempted&&failure.updateDiagnostic.writesAttempted===writes.length);
 assert.deepEqual(f.writes,writes);assert(!f.writes.includes(3));assert(!f.writes.includes(4));assert(!f.writes.includes(5));
 await f.lamp.disconnect();assert.deepEqual(f.disconnects,['saved-peripheral']);assert.equal(f.lamp.id,null);assert.equal(f.lamp.bluetoothUpdate,null);
});

for(const char of [identity,FIRMWARE,STATE,OTA_STATUS])test('snapshot cancellation fences the late '+char+' read',async()=>{
 const f=fixture();await f.connect();const gate=f.hold(char),abort=new AbortController();const pending=f.lamp.readFirmwareUpdateSnapshot({signal:abort.signal});
 await gate.started.promise;const before=f.reads.length;abort.abort();gate.finished.resolve();
 await assert.rejects(pending,failure=>failure.cancelled);assert.equal(f.reads.length,before);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});

test('normal protected control connections can read snapshots, but an unverified connection or active sender cannot',async()=>{
 const f=fixture();await f.connect();f.lamp.firmwareOnly=false;
 assert.equal((await f.lamp.readFirmwareUpdateSnapshot()).identity,target);
 f.lamp.bluetoothUpdate={};await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),failure=>failure.firmwareBusy);f.lamp.bluetoothUpdate=null;
 f.lamp.control=null;await assert.rejects(f.lamp.readFirmwareUpdateSnapshot(),/protected Bluetooth/);assert.deepEqual(f.writes,[]);await f.lamp.disconnect();
});
