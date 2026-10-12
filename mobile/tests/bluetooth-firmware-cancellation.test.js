import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer,parsePhoneManifest,OTA_STATUS,OTA_WRITE} from '../src/bluetooth-firmware.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let n=0;n<24;++n)await Promise.resolve();}
function packageValue(){
 const image=new Uint8Array(2048),header=new DataView(image.buffer);image[0]=0xe9;header.setUint16(12,5,true);header.setUint32(32,0xabcd5432,true);
 const sha=createHash('sha256').update(image).digest('hex');
 return {image,manifest:parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n${image.length}\n${sha}\n`)};
}
class Receiver{
 constructor({notifications=false}={}){
  this.pkg=packageValue();this.current=true;this.clock=0;this.frames=[];this.reads=[];
  this.s={phase:0,error:0,committed:false,session:0,size:0,offset:0,ack:0,maxData:232};
  this.firstData=deferred();this.dataRelease=deferred();this.cancelStarted=deferred();
  if(notifications){
   this.startNotifications=async(_id,_service,char,callback)=>{assert.equal(char,OTA_STATUS);this.listener=callback;};
   this.stopNotifications=async()=>{this.listener=null;};
  }
 }
 status(changes={}){
  if(typeof changes==='function')changes=changes(this.s);
  const s={...this.s,...changes},v=new DataView(new ArrayBuffer(20));v.setUint8(0,1);v.setUint8(1,s.phase);v.setUint8(2,s.error);v.setUint8(3,s.committed?1:0);
  for(const [at,key] of [[4,'session'],[8,'size'],[12,'offset']])v.setUint32(at,s[key],true);
  v.setUint16(16,s.ack,true);v.setUint16(18,s.maxData,true);return v;
 }
 emit(changes={}){this.listener?.(this.status(changes));}
 async getMtu(){return 247;}
 async read(_id,_service,char,options){
  assert.equal(char,OTA_STATUS);this.reads.push(options.timeout);++this.clock;
  if(this.onRead)return this.onRead();
  return this.status(this.s.phase===5?this.cancelReply:null);
 }
 async write(_id,_service,char,frame,options){
  assert.equal(char,OTA_WRITE);assert(frame.byteLength<=244);++this.clock;
  const op=frame.getUint8(1);this.frames.push({op,session:frame.getUint32(2,true),seq:frame.getUint16(6,true),timeout:options.timeout,frame:new Uint8Array(frame.buffer).slice()});
  this.s.session=frame.getUint32(2,true);this.s.ack=frame.getUint16(6,true);
  if(op===2){this.s.phase=2;this.s.size=this.pkg.image.length;}
  else if(op===3){
   assert.equal(frame.getUint32(8,true),this.s.offset);
   const bytes=new Uint8Array(frame.buffer,frame.byteOffset+12,frame.byteLength-12);
   assert.deepEqual(bytes,this.pkg.image.subarray(this.s.offset,this.s.offset+bytes.length));this.s.offset+=bytes.length;
   if(this.frames.filter(value=>value.op===3).length===1){this.emit();this.firstData.resolve();await this.dataRelease.promise;}
  }else if(op===4){this.s.phase=4;this.s.committed=true;}
  else if(op===5){
   this.cancelStarted.resolve();if(this.onCancel)await this.onCancel(frame);
   this.s.phase=5;this.s.error=8;
  }
  if(op!==5||!this.suppressCancelNotification)this.emit(op===5?this.cancelReply:null);
 }
 transfer(options={}){return new BluetoothFirmwareTransfer({ble:this,deviceId:'same-protected-target',isCurrent:()=>this.current,now:()=>this.clock,delay:async ms=>{this.clock+=ms;},...options});}
}
async function active(receiver,options={}){
 const transfer=receiver.transfer(options),outcome={settled:false};
 const job=transfer.send(receiver.pkg,options).then(value=>{outcome.settled=true;outcome.value=value;return outcome;},failure=>{outcome.settled=true;outcome.failure=failure;return outcome;});
 await receiver.firstData.promise;return {transfer,job,outcome};
}
function noReplay(receiver){assert.equal(receiver.frames.filter(row=>row.op===3).length,1);assert.equal(receiver.frames.filter(row=>row.op===5).length,1);assert(!receiver.frames.some(row=>row.op===4));}

test('foreground Cancel stops queued Data synchronously and holds the sender owner until matching read receipt',async()=>{
 const receiver=new Receiver(),gate=deferred(),intents=[];receiver.onCancel=()=>gate.promise;
 const {transfer,job,outcome}=await active(receiver,{onBeforeWrite:intent=>intents.push(intent)});
 const cancelling=transfer.cancel('user');assert.equal(transfer.cancelled,true);
 await receiver.cancelStarted.promise;receiver.dataRelease.resolve();await flush();
 assert.equal(outcome.settled,false,'the coordinator must not release its lease before Cancel acknowledgement');
 assert.equal(receiver.frames.at(-1).timeout,3000);assert.equal(intents.at(-1).op,5);
 assert.equal(intents.at(-1).session,transfer.session);assert.equal(intents.at(-1).sha256,receiver.pkg.manifest.sha256);assert.equal(intents.at(-1).version,'1.15.1');
 gate.resolve();const result=await cancelling,finished=await job;
 assert.equal(result.confirmed,true);assert.equal(result.uncertain,false);assert.equal(result.cancelSent,true);assert.equal(result.receipt.error,8);
 assert.equal(result.receipt.session,transfer.session);assert.equal(result.receipt.ack,receiver.frames.at(-1).seq);assert(Object.isFrozen(result.receipt));
 assert.equal(finished.failure.stopReason,'user');assert.equal(finished.failure.updateDiagnostic.phase,2);assert.equal(finished.failure.updateDiagnostic.error,0);
 assert.equal(finished.failure.updateDiagnostic.acknowledgedBytes,232);assert.equal(transfer.lastStatus.phase,2,'Cancel must not replace the original failure snapshot');noReplay(receiver);
});

test('a matching cancellation notification confirms even when the ATT response is lost',async()=>{
 const receiver=new Receiver({notifications:true});receiver.onCancel=async()=>{receiver.emit({phase:5,error:8});throw Error('ATT response lost.');};
 const {transfer,job}=await active(receiver);const result=await transfer.cancel('user');receiver.dataRelease.resolve();await job;
 assert.equal(result.confirmed,true);assert.equal(result.uncertain,false);assert.equal(result.receipt.error,8);noReplay(receiver);
});

test('a late matching Cancel notification wins without adopting a stale read or replaying bytes',async()=>{
 const receiver=new Receiver({notifications:true}),read=deferred();receiver.suppressCancelNotification=true;
 const {transfer,job}=await active(receiver);let postCancelReads=0;
 receiver.onRead=()=>receiver.s.phase===5?(++postCancelReads,read.promise):receiver.status();
 const cancelling=transfer.cancel('user');await receiver.cancelStarted.promise;await flush();assert.equal(postCancelReads,1);
 receiver.emit({phase:5,error:8});const result=await cancelling;assert.equal(result.confirmed,true);
 read.resolve(receiver.status({session:transfer.session^1,committed:true}));receiver.dataRelease.resolve();await job;
 assert.equal(transfer.lastStatus.phase,2);assert.equal(transfer.lastStatus.committed,false);noReplay(receiver);
});

for(const [kind,change] of [
 ['wrong session',s=>({session:s.session^1})],['wrong ACK',s=>({ack:s.ack%65535+1})],['selected image',()=>({committed:true})],
 ['wrong phase',()=>({phase:2,error:0})],['wrong error',()=>({error:7})],['wrong size',s=>({size:s.size+1})],
 ['offset overflow',s=>({offset:s.size+1})],['invalid limits',()=>({maxData:233})]
])test(`${kind} never confirms cancellation and receipt polling is bounded`,async()=>{
 const receiver=new Receiver({notifications:true}),{transfer,job}=await active(receiver);receiver.cancelReply=change;
 const before=receiver.reads.length,result=await transfer.cancel('user');receiver.dataRelease.resolve();await job;
 assert.equal(result.confirmed,false);assert.equal(result.uncertain,true);assert.equal(result.ackUnconfirmed,true);
 assert(receiver.reads.length-before<=4,'one failure snapshot plus at most three Cancel receipt reads');
 assert.equal(transfer.lastStatus.phase,2);noReplay(receiver);
});

test('duplicate Cancel calls share one durable intent and one native frame',async()=>{
 const receiver=new Receiver(),gate=deferred(),intents=[];receiver.onCancel=()=>gate.promise;
 const {transfer,job}=await active(receiver,{onBeforeWrite:value=>intents.push(value)});
 const first=transfer.cancel('user'),second=transfer.cancel('user');await receiver.cancelStarted.promise;
 receiver.dataRelease.resolve();gate.resolve();assert.deepEqual(await first,await second);await job;
 assert.equal(intents.filter(value=>value.op===5).length,1);noReplay(receiver);
});

test('a synchronous native callback joins the existing Cancel attempt before its first read returns',async()=>{
 const receiver=new Receiver(),{transfer,job}=await active(receiver);let nested;
 receiver.onRead=()=>{nested??=transfer.cancel('user');return receiver.status();};
 const result=await transfer.cancel('user');assert.deepEqual(await nested,result);receiver.dataRelease.resolve();await job;noReplay(receiver);
});

test('durable recovery storage failure prevents Cancel native write and remains uncertain',async()=>{
 const receiver=new Receiver(),{transfer,job}=await active(receiver,{onBeforeWrite:intent=>{if(intent.op===5)throw Error('Storage unavailable.');}});
 const result=await transfer.cancel('user');receiver.dataRelease.resolve();await job;
 assert.equal(result.confirmed,false);assert.equal(result.uncertain,true);assert.equal(result.journalFailure,true);
 assert.equal(result.cancelSent,false);assert(!receiver.frames.some(row=>row.op===5||row.op===4));assert.equal(receiver.frames.filter(row=>row.op===3).length,1);
});

test('owner loss before cancellation starts issues no additional read, Cancel or Finish',async()=>{
 const receiver=new Receiver(),{transfer,job}=await active(receiver),reads=receiver.reads.length;receiver.current=false;
 const result=await transfer.cancel('user');receiver.dataRelease.resolve();await job;
 assert.equal(result.ownerLost,true);assert.equal(result.confirmed,false);assert.equal(receiver.reads.length,reads);
 assert(!receiver.frames.some(row=>row.op===5||row.op===4));
});

test('owner loss during Cancel fences its late ACK and all follow-up reads',async()=>{
 const receiver=new Receiver({notifications:true}),gate=deferred();receiver.onCancel=()=>gate.promise;
 const {transfer,job}=await active(receiver);const cancelling=transfer.cancel('user');await receiver.cancelStarted.promise;
 const reads=receiver.reads.length;receiver.current=false;gate.resolve();receiver.emit({phase:5,error:8});
 const result=await cancelling;receiver.dataRelease.resolve();await job;
 assert.equal(result.confirmed,false);assert.equal(result.ownerLost,true);assert.equal(receiver.reads.length,reads);noReplay(receiver);
});

test('app-hidden cancellation is best effort and does not claim foreground receipt confirmation',async()=>{
 const receiver=new Receiver({notifications:true}),{transfer,job}=await active(receiver);
 const result=await transfer.cancel('app-hidden');receiver.dataRelease.resolve();await job;
 assert.equal(result.confirmed,false);assert.equal(result.uncertain,true);assert.equal(result.lifetimeEnded,true);noReplay(receiver);
});

test('Cancel before any updater frame proves no installation started without a native command',async()=>{
 const receiver=new Receiver(),transfer=receiver.transfer();const result=await transfer.cancel('user');
 assert.equal(result.confirmed,true);assert.equal(result.installationNotStarted,true);assert.equal(result.cancelSent,false);assert.equal(result.uncertain,false);
 await assert.rejects(transfer.send(receiver.pkg),/cancelled/);assert.equal(receiver.reads.length,0);assert.equal(receiver.frames.length,0);
});

test('Cancel refuses the durable Finish intent race and leaves its existing verification owner intact',async()=>{
 const receiver=new Receiver();receiver.dataRelease.resolve();const entered=deferred(),release=deferred();let savedFinish=false;
 const transfer=receiver.transfer(),job=transfer.send(receiver.pkg,{onBeforeWrite:async intent=>{if(intent.op===4){savedFinish=true;entered.resolve();await release.promise;}}});
 await entered.promise;assert.equal(savedFinish,true);assert.equal(transfer.commitAttempted,false);assert.equal(transfer.stage,'verifying');
 const result=await transfer.cancel('user');assert.equal(result.tooLate,true);assert.equal(result.verificationRequired,true);assert.equal(result.cancelled,false);assert.equal(transfer.cancelled,false);
 release.resolve();assert.equal((await job).committed,true);assert.equal(receiver.frames.filter(row=>row.op===4).length,1);assert(!receiver.frames.some(row=>row.op===5));
});

test('Cancel after native Finish is attempted never changes ownership or boot selection',async()=>{
 const receiver=new Receiver();receiver.dataRelease.resolve();const transfer=receiver.transfer();assert.equal((await transfer.send(receiver.pkg)).committed,true);
 const result=await transfer.cancel('user');assert.equal(result.tooLate,true);assert.equal(transfer.cancelled,false);assert(!receiver.frames.some(row=>row.op===5));
});

test('an unresolved native Cancel has a three-second outer bound and is never replayed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const receiver=new Receiver(),gate=deferred();receiver.onCancel=()=>gate.promise;
 const {transfer,job}=await active(receiver);const cancelling=transfer.cancel('user');await receiver.cancelStarted.promise;
 let settled=false;cancelling.then(()=>{settled=true;});t.mock.timers.tick(2999);await flush();assert.equal(settled,false);
 t.mock.timers.tick(1);await flush();const result=await cancelling;assert.equal(result.writeUnconfirmed,true);assert.equal(result.uncertain,true);assert.equal(result.confirmed,false);
 receiver.current=false;gate.resolve();receiver.dataRelease.resolve();await job;noReplay(receiver);
});

test('an unresolved Cancel receipt read expires after 1.2 seconds and ignores its late response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const receiver=new Receiver(),late=deferred(),{transfer,job}=await active(receiver);
 receiver.onRead=()=>receiver.s.phase===5?late.promise:receiver.status();const cancelling=transfer.cancel('user');await receiver.cancelStarted.promise;await flush();
 t.mock.timers.tick(1200);await flush();const result=await cancelling;assert.equal(result.ackUnconfirmed,true);assert.equal(result.confirmed,false);
 const reads=receiver.reads.length;receiver.current=false;late.resolve(receiver.status());receiver.dataRelease.resolve();await job;
 assert.equal(receiver.reads.length,reads);assert.equal(transfer.lastStatus.phase,2);noReplay(receiver);
});
