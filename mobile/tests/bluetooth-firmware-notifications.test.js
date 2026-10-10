import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer, parsePhoneManifest, OTA_WRITE, OTA_STATUS} from '../src/bluetooth-firmware.js';

function packageValue(size=4096) {
  const image=new Uint8Array(size);for(let i=0;i<size;++i)image[i]=(i*13)&255;
  const header=new DataView(image.buffer);image[0]=0xe9;header.setUint16(12,5,true);header.setUint32(32,0xabcd5432,true);
  image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.13.0\0'),300);
  const sha=createHash('sha256').update(image).digest('hex');
  return {image,manifest:parsePhoneManifest(`COOLLAMP-OTA-1\n1.13.0\nesp32c3\ndual-ota-2031616\n${size}\n${sha}\n`)};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Receiver {
  constructor(){this.pkg=packageValue();this.generation=1;this.clock=1000;this.listeners=[];this.startCalls=0;this.stopCalls=0;this.reads=0;this.dataReads=0;this.reset();}
  reset(){this.s={phase:0,error:0,session:0,size:0,offset:0,ack:0,committed:false};this.manifest=[];this.operations=[];this.dataOffsets=[];this.hash=createHash('sha256');this.snapshotHistory=[];}
  status(overrides={}){
    const s={...this.s,...overrides},value=new DataView(new ArrayBuffer(20));
    value.setUint8(0,1);value.setUint8(1,s.phase);value.setUint8(2,s.error);value.setUint8(3,s.committed?1:0);
    for(const [at,key] of [[4,'session'],[8,'size'],[12,'offset']])value.setUint32(at,s[key],true);
    value.setUint16(16,s.ack,true);value.setUint16(18,232,true);return value;
  }
  emit(overrides={}){this.listener?.(this.status(overrides));}
  async getMtu(){return 247;}
  async startNotifications(_device,_service,characteristic,callback){
    assert.equal(characteristic,OTA_STATUS);assert(!this.operations.length,'subscribe precedes every mutative frame');
    ++this.startCalls;this.listener=callback;this.listeners.push(callback);
    if(this.subscriptionError)throw Error('Notifications unsupported.');
    if(this.subscriptionDeferred)await this.subscriptionDeferred.promise;
  }
  async stopNotifications(_device,_service,characteristic){
    assert.equal(characteristic,OTA_STATUS);++this.stopCalls;
    if(this.stopDeferred)await this.stopDeferred.promise;
    this.listener=null;
  }
  async read(_device,_service,characteristic){
    assert.equal(characteristic,OTA_STATUS);++this.reads;this.clock+=3;
    if(this.operations.at(-1)===3)++this.dataReads;
    if(this.readFailure)throw Error('Native status read failed.');
    return this.status();
  }
  async write(_device,_service,characteristic,frame){
    assert.equal(characteristic,OTA_WRITE);assert(frame.byteLength<=244);
    const op=frame.getUint8(1),count=this.dataOffsets.length;this.operations.push(op);this.clock+=7;
    this.s.session=frame.getUint32(2,true);this.s.ack=frame.getUint16(6,true);
    if(op===1){assert.equal(frame.getUint16(8,true),this.manifest.length);this.manifest.push(...new Uint8Array(frame.buffer,frame.byteOffset+10,frame.byteLength-10));}
    else if(op===2){assert.equal(new TextDecoder().decode(new Uint8Array(this.manifest)),this.pkg.manifest.text);this.s.phase=2;this.s.size=this.pkg.image.length;}
    else if(op===3){
      assert.equal(frame.getUint32(8,true),this.s.offset);this.dataOffsets.push(this.s.offset);
      const bytes=new Uint8Array(frame.buffer,frame.byteOffset+12,frame.byteLength-12);
      assert.deepEqual(bytes,this.pkg.image.subarray(this.s.offset,this.s.offset+bytes.length));this.hash.update(bytes);this.s.offset+=bytes.length;
      if(this.rejectAt===count+1){this.s.phase=5;this.s.error=7;}
    }else if(op===4){assert.equal(this.s.offset,this.pkg.image.length);assert.equal(this.hash.digest('hex'),this.pkg.manifest.sha256);this.s.phase=4;this.s.committed=true;}
    else if(op===5){this.s.phase=5;this.s.error=8;}
    else assert.fail('Unknown operation');
    if(this.onWrite)await this.onWrite(op,frame);
    if(op===4&&this.loseFinish){++this.generation;throw Error('Final link ended.');}
    this.snapshotHistory.push({...this.s});if(this.snapshotHistory.length>20)this.snapshotHistory.shift();
    if(this.notify)this.notify(op);else this.emit();
  }
  transfer(progress=()=>{}){
    const generation=this.generation;
    return new BluetoothFirmwareTransfer({ble:this,deviceId:'same-peripheral',isCurrent:()=>this.generation===generation,now:()=>this.clock,delay:async ms=>{this.clock+=ms;},onProgress:progress});
  }
}
async function failureOf(receiver,transfer){let failure;try{await transfer.send(receiver.pkg);}catch(error){failure=error;}assert(failure instanceof Error);return failure;}

test('notification ACKs require no per-window reads and report only written bytes',async()=>{
  const receiver=new Receiver();let transferring=0;
  const transfer=receiver.transfer(progress=>{if(progress.stage==='transferring'){++transferring;assert.equal(progress.progress,Math.floor(receiver.s.offset*100/receiver.pkg.image.length));}});
  const result=await transfer.send(receiver.pkg);
  assert.equal(result.committed,true);assert.equal(receiver.reads,1);assert.equal(receiver.dataReads,0);
  assert.equal(receiver.startCalls,1);assert.equal(receiver.stopCalls,1);
  assert.equal(receiver.operations.filter(op=>op===4).length,1);assert(!receiver.operations.includes(5));
  assert.equal(transferring,1+Math.ceil(receiver.dataOffsets.length/4));
  assert.equal(transfer.diagnostic().notificationFallback,null);assert(transfer.diagnostic().notificationAcks>1);
  assert(transfer.issuedFrames.length<=16);
});

test('the complete published-size image verifies SHA and commits once using notification ACKs',async()=>{
  const receiver=new Receiver();receiver.pkg=packageValue(1920432);const transfer=receiver.transfer();
  const result=await transfer.send(receiver.pkg);
  assert.equal(result.committed,true);assert.equal(receiver.reads,1);assert.equal(receiver.dataReads,0);
  assert.equal(receiver.s.offset,1920432);assert.equal(receiver.dataOffsets.length,Math.ceil(1920432/232));
  assert.equal(receiver.operations.filter(op=>op===4).length,1);assert(!receiver.operations.includes(5));
  assert.equal(transfer.diagnostic().notificationFallback,null);assert.equal(transfer.diagnostic().chunkSize,232);
});

test('asynchronous notifications and same-ACK Ready transitions wake the bounded waiter',async()=>{
  const receiver=new Receiver();receiver.notify=op=>{
    const value=receiver.status();
    if(op===2){receiver.emit({phase:1});setTimeout(()=>receiver.listener?.(value),0);}
    else if(op===4||op===3&&receiver.dataOffsets.length%4===0)setTimeout(()=>receiver.listener?.(value),0);
    else receiver.emit();
  };
  const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
  assert.equal(receiver.reads,1);assert.equal(transfer.diagnostic().notificationFallback,null);
});

test('cached status rejects wrong session, size, offset, future ACK, bad phase, duplicates and regression',async()=>{
  const receiver=new Receiver();receiver.notify=op=>{
    if(op===3){
      receiver.emit({session:receiver.s.session^1});receiver.emit({size:receiver.s.size+1});receiver.emit({offset:receiver.s.offset+1});
      receiver.emit({ack:(receiver.s.ack+99)%65535+1});receiver.emit({phase:4,committed:true});
    }
    receiver.emit();receiver.emit();
    const old=receiver.snapshotHistory.at(-2);if(old)receiver.emit(old);
    receiver.listener?.(new DataView(new ArrayBuffer(19)));
  };
  const transfer=receiver.transfer();const result=await transfer.send(receiver.pkg);
  assert.equal(result.committed,true);assert.equal(receiver.reads,1);assert.equal(transfer.diagnostic().acknowledgedBytes,receiver.pkg.image.length);
  assert.equal(transfer.diagnostic().notificationFallback,null);
});

test('notification ordering stays monotonic across 65535-to-1 sequence rollover',async()=>{
  const receiver=new Receiver(),transfer=receiver.transfer();transfer.sequence=65530;
  receiver.notify=()=>{receiver.emit();const old=receiver.snapshotHistory.at(-2);if(old)receiver.emit(old);};
  assert.equal((await transfer.send(receiver.pkg)).committed,true);
  assert(transfer.sequence<100);assert.equal(receiver.reads,1);assert.equal(receiver.operations.filter(op=>op===4).length,1);
});

test('a missed data ACK downgrades once to read polling without retrying a frame',async()=>{
  const receiver=new Receiver();receiver.notify=op=>{if(op!==3)receiver.emit();};
  const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
  assert.equal(transfer.diagnostic().notificationMode,'polling');assert.equal(transfer.diagnostic().notificationFallback,'missed-ack');
  assert.equal(receiver.dataReads,Math.ceil(receiver.dataOffsets.length/4));
  assert.equal(new Set(receiver.dataOffsets).size,receiver.dataOffsets.length);assert.equal(receiver.startCalls,1);
});

test('old-session notifications cannot confirm delivery and fall back to matching status reads',async()=>{
  const receiver=new Receiver();receiver.notify=()=>receiver.emit({session:receiver.s.session^1});
  const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
  assert.equal(transfer.diagnostic().notificationAcks,0);assert.equal(transfer.diagnostic().notificationFallback,'missed-ack');
  assert(receiver.dataReads>0);assert.equal(new Set(receiver.dataOffsets).size,receiver.dataOffsets.length);
});

for(const regression of ['offset','size'])test(`a polled ${regression} regression cannot become a confirmed receiver error`,async()=>{
  const receiver=new Receiver();let injected=false;const nativeRead=receiver.read.bind(receiver);
  receiver.notify=op=>{if(op!==3||receiver.dataOffsets.length<=4)receiver.emit();};
  receiver.read=async(...args)=>{
    const current=await nativeRead(...args);
    if(!injected&&receiver.operations.at(-1)===3&&receiver.dataOffsets.length===8){
      injected=true;return receiver.status({phase:5,error:7,...(regression==='offset'?{offset:0}:{size:0,offset:0})});
    }
    return current;
  };
  const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
  assert.equal(injected,true);assert.equal(transfer.diagnostic().stopReason,null);
  assert.equal(transfer.diagnostic().notificationFallback,'missed-ack');assert(!receiver.operations.includes(5));
});

test('subscription rejection preserves the existing polling path',async()=>{
  const receiver=new Receiver();receiver.subscriptionError=true;const transfer=receiver.transfer();
  assert.equal((await transfer.send(receiver.pkg)).committed,true);assert.equal(transfer.diagnostic().notificationFallback,'subscribe-failed');
  assert.equal(receiver.dataReads,Math.ceil(receiver.dataOffsets.length/4));assert.equal(receiver.stopCalls,1);
});

test('notification receiver error stops the window and retains its original code through Cancel',async()=>{
  const receiver=new Receiver();receiver.rejectAt=2;const transfer=receiver.transfer();
  const failure=await failureOf(receiver,transfer);
  assert.equal(failure.stopReason,'receiver-rejected');assert.equal(failure.updateDiagnostic.error,7);
  assert.equal(failure.updateDiagnostic.acknowledgedBytes,464);assert.equal(receiver.dataOffsets.length,2);
  assert.equal(receiver.reads,1);assert.equal(receiver.s.error,8);assert.equal(receiver.operations.filter(op=>op===5).length,1);
  assert(!receiver.operations.includes(4));
});

test('cancellation keeps its cause and releases only its current subscription',async()=>{
  const receiver=new Receiver(),transfer=receiver.transfer();
  receiver.onWrite=async op=>{if(op===3&&receiver.dataOffsets.length===5)await transfer.cancel('app-hidden');};
  const failure=await failureOf(receiver,transfer);
  assert.equal(failure.stopReason,'app-hidden');assert.equal(failure.updateDiagnostic.acknowledgedBytes,1160);
  assert.equal(receiver.stopCalls,1);assert.equal(receiver.operations.filter(op=>op===5).length,1);assert(!receiver.operations.includes(4));
});

test('user cancellation wakes an outstanding notification wait and captures written bytes before Cancel',async()=>{
  const receiver=new Receiver(),transfer=receiver.transfer();receiver.notify=op=>{
    if(op!==3)receiver.emit();
    else if(receiver.dataOffsets.length===4)setTimeout(()=>{void transfer.cancel('user');},0);
  };
  const failure=await failureOf(receiver,transfer);
  assert.equal(failure.stopReason,'user');assert.equal(failure.updateDiagnostic.acknowledgedBytes,928);
  assert.equal(receiver.dataOffsets.length,4);assert.equal(receiver.operations.filter(op=>op===5).length,1);
  assert(!receiver.operations.includes(4));assert.equal(receiver.stopCalls,1);
});

test('native disconnect wakes an outstanding notification wait without sending to a replacement link',async()=>{
  const receiver=new Receiver(),transfer=receiver.transfer();receiver.notify=op=>{
    if(op!==3)receiver.emit();
    else if(receiver.dataOffsets.length===4)setTimeout(()=>{transfer.recordStop('native-disconnect');++receiver.generation;},0);
  };
  const failure=await failureOf(receiver,transfer);
  assert.equal(failure.stopReason,'native-disconnect');assert.equal(receiver.reads,1);
  assert.equal(receiver.dataOffsets.length,4);assert(!receiver.operations.includes(5));assert(!receiver.operations.includes(4));
  assert.equal(receiver.stopCalls,0);
});

test('late old callback and cleanup cannot disturb a replacement connection listener',async()=>{
  const receiver=new Receiver(),hold=deferred(),entered=deferred();const first=receiver.transfer();
  receiver.onWrite=async op=>{if(op===3&&receiver.dataOffsets.length===1){entered.resolve();await hold.promise;}};
  const firstJob=first.send(receiver.pkg).then(()=>assert.fail('Old connection must stop'),error=>error);
  await entered.promise;const oldListener=receiver.listeners[0];++receiver.generation;receiver.reset();receiver.onWrite=null;
  const second=receiver.transfer();receiver.notify=()=>{oldListener(receiver.status());receiver.emit();};
  const secondJob=second.send(receiver.pkg);await secondJob;hold.resolve();
  const failure=await firstJob;assert.equal(failure.stopReason,'connection-changed');
  assert.equal(receiver.startCalls,2);assert.equal(receiver.stopCalls,1);assert.equal(second.diagnostic().notificationFallback,null);
});

test('lost final response remains unconfirmed without repeating Finish or sending Cancel',async()=>{
  const receiver=new Receiver();receiver.loseFinish=true;const transfer=receiver.transfer();
  const result=await transfer.send(receiver.pkg);
  assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);
  assert.equal(receiver.operations.filter(op=>op===4).length,1);assert(!receiver.operations.includes(5));assert.equal(receiver.stopCalls,0);
});

test('a lost final notification and failed reconciliation remain unconfirmed without replay',async()=>{
  const receiver=new Receiver();receiver.notify=op=>{if(op===4)receiver.readFailure=true;else receiver.emit();};
  const transfer=receiver.transfer(),result=await transfer.send(receiver.pkg);
  assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);
  assert.equal(result.updateDiagnostic.stopReason,'native-read-failure');assert.equal(receiver.reads,2);
  assert.equal(receiver.operations.filter(op=>op===4).length,1);assert(!receiver.operations.includes(5));
});

test('an unsettled subscribe is bounded and prevents a newer listener racing its late cleanup',async()=>{
  const receiver=new Receiver(),pending=deferred();receiver.subscriptionDeferred=pending;const first=receiver.transfer();
  const failure=await failureOf(receiver,first);assert.match(failure.message,/No firmware was sent/);
  assert.equal(receiver.operations.length,0);
  assert.equal(first.diagnostic().notificationFallback,'subscribe-failed');assert.equal(receiver.stopCalls,0);
  ++receiver.generation;receiver.reset();receiver.subscriptionDeferred=null;const second=receiver.transfer();
  assert.equal((await second.send(receiver.pkg)).committed,true);assert.equal(second.diagnostic().notificationFallback,'owned');
  assert.equal(receiver.startCalls,1);pending.resolve();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(receiver.stopCalls,0,'old epoch must not unsubscribe a replacement link');
  ++receiver.generation;receiver.reset();const third=receiver.transfer();assert.equal((await third.send(receiver.pkg)).committed,true);
  assert.equal(receiver.startCalls,2);assert.equal(third.diagnostic().notificationFallback,null);
});

test('an unsettled unsubscribe is bounded and reserves ownership until its native operation finishes',async()=>{
  const receiver=new Receiver(),pending=deferred();receiver.stopDeferred=pending;const first=receiver.transfer();
  assert.equal((await first.send(receiver.pkg)).committed,true);assert.equal(receiver.stopCalls,1);
  ++receiver.generation;receiver.reset();const second=receiver.transfer();assert.equal((await second.send(receiver.pkg)).committed,true);
  assert.equal(second.diagnostic().notificationFallback,'owned');assert.equal(receiver.startCalls,1);
  pending.resolve();await new Promise(resolve=>setTimeout(resolve,0));receiver.stopDeferred=null;
  ++receiver.generation;receiver.reset();const third=receiver.transfer();assert.equal((await third.send(receiver.pkg)).committed,true);
  assert.equal(third.diagnostic().notificationFallback,null);assert.equal(receiver.startCalls,2);
});
