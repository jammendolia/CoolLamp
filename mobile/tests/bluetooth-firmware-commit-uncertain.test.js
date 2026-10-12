import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer,decodeBleUpdate,parsePhoneManifest,bluetoothFirmwareFailureMessage,OTA_WRITE,OTA_STATUS} from '../src/bluetooth-firmware.js';

function packageValue(){
 const image=new Uint8Array(2048);image[0]=0xe9;
 const view=new DataView(image.buffer);view.setUint16(12,5,true);view.setUint32(32,0xabcd5432,true);
 const sha=createHash('sha256').update(image).digest('hex');
 return {image,manifest:parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.2\nesp32c3\ndual-ota-2031616\n${image.length}\n${sha}\n`)};
}
function status(overrides={}){
 const s={phase:5,error:6,flags:16,session:77,size:2048,offset:2048,ack:91,maxData:232,...overrides};
 const bytes=new DataView(new ArrayBuffer(20));bytes.setUint8(0,1);bytes.setUint8(1,s.phase);bytes.setUint8(2,s.error);bytes.setUint8(3,s.flags);
 for(const [offset,key] of [[4,'session'],[8,'size'],[12,'offset']])bytes.setUint32(offset,s[key],true);
 bytes.setUint16(16,s.ack,true);bytes.setUint16(18,s.maxData,true);return bytes;
}
class Receiver{
 constructor({notifications=false}={}){
  this.pkg=packageValue();this.clock=0;this.writes=[];this.reads=0;this.mtuCalls=0;this.subscriptions=0;
  this.s={phase:0,error:0,flags:0,session:0,size:0,offset:0,ack:0,maxData:232};this.finishUncertain=true;
  if(notifications){this.startNotifications=async(_id,_service,char,callback)=>{assert.equal(char,OTA_STATUS);++this.subscriptions;this.listener=callback;};this.stopNotifications=async()=>{this.listener=null;};}
 }
 async getMtu(){++this.mtuCalls;return 247;}
 async read(_id,_service,char){assert.equal(char,OTA_STATUS);++this.reads;return status(this.s);}
 async write(_id,_service,char,frame){
  assert.equal(char,OTA_WRITE);const op=frame.getUint8(1);this.writes.push({op,ack:frame.getUint16(6,true)});
  this.s.session=frame.getUint32(2,true);this.s.ack=frame.getUint16(6,true);
  if(op===2){this.s.phase=2;this.s.size=this.pkg.image.length;}
  if(op===3){assert.equal(frame.getUint32(8,true),this.s.offset);this.s.offset+=frame.byteLength-12;}
  if(op===4){assert.equal(this.s.offset,this.pkg.image.length);Object.assign(this.s,this.finishUncertain?{phase:5,error:6,flags:16}:{phase:4,error:0,flags:1});}
  if(op===5){Object.assign(this.s,{phase:5,error:8,flags:0});}
  if(this.onWrite)await this.onWrite(op,frame);
  this.listener?.(status(this.s));
 }
 transfer(){return new BluetoothFirmwareTransfer({ble:this,deviceId:'verified-target',now:()=>this.clock,delay:async ms=>{this.clock+=ms;}});}
}

test('v1 uncertainty flag is additive and preserves the original status fields and capability bits',()=>{
 const value=decodeBleUpdate(status({flags:16|2|4|32|64|128}));
 assert.equal(value.commitUnconfirmed,true);assert.equal(value.committed,false);assert.equal(value.dataWriteWithoutResponseFour,true);
 assert.equal(value.phase,5);assert.equal(value.error,6);assert.equal(value.session,77);assert.equal(value.ack,91);assert.equal(value.offset,value.size);
 const legacy=decodeBleUpdate(status({phase:4,error:0,flags:1|2|32|64|128}));
 assert.equal(legacy.commitUnconfirmed,false);assert.equal(legacy.committed,true);assert.equal(legacy.dataWriteWithoutResponseFour,true);
});

for(const [name,invalid] of Object.entries({phase:{phase:4},error:{error:5},committed:{flags:17},detached:{flags:24},session:{session:0},ack:{ack:0},small:{size:287,offset:287},large:{size:2031617,offset:2031617},offset:{offset:2047},emptyData:{maxData:0},largeData:{maxData:233}}))test(`uncertainty status rejects inconsistent ${name}`,()=>{
 assert.throws(()=>decodeBleUpdate(status(invalid)),failure=>failure.invalidRead&&failure.uncertain&&failure.verificationRequired&&failure.receiverBusy);
});

for(const resumeLease of [null,{session:77,version:'1.15.2',size:2048,sha256:packageValue().manifest.sha256}])test(`initial uncertainty blocks ${resumeLease?'resume':'new transfer'} before every native mutation`,async()=>{
 const receiver=new Receiver({notifications:true});receiver.s={...decodeBleUpdate(status()),flags:16};
 const transfer=receiver.transfer();let intents=0;
 await assert.rejects(transfer.send(receiver.pkg,{resumeLease,onBeforeWrite:()=>{++intents;}}),failure=>{
  assert.equal(failure.uncertain,true);assert.equal(failure.confirmed,false);assert.equal(failure.verificationRequired,true);assert.equal(failure.commitUnconfirmed,true);
  assert.equal(failure.receiverBusy,true);assert.equal(failure.installationNotStarted,false);assert.equal(failure.metadataIssued,false);assert.equal(failure.beginAttempted,false);assert.equal(failure.commitAttempted,false);
  assert.equal(failure.updateDiagnostic.commitUnconfirmed,true);assert.equal(failure.updateDiagnostic.installationNotStarted,false);assert.doesNotMatch(failure.message,/unchanged|remains selected/);return true;
 });
 assert.equal(receiver.writes.length,0);assert.equal(receiver.mtuCalls,0);assert.equal(receiver.subscriptions,0);assert.equal(receiver.reads,1);assert.equal(intents,0);
 for(const reason of ['user','cleanup','app-hidden']){const cancellation=await transfer.cancel(reason);assert.equal(cancellation.cancelled,false);assert.equal(cancellation.tooLate,true);assert.equal(cancellation.verificationRequired,true);}
 assert.equal(receiver.writes.length,0);
});

test('a malformed initial uncertainty flag cannot prove unchanged firmware or authorize new metadata',async()=>{
 const receiver=new Receiver({notifications:true}),transfer=receiver.transfer();receiver.s={...receiver.s,phase:2,flags:16};
 await assert.rejects(transfer.send(receiver.pkg),failure=>{
  assert.equal(failure.invalidRead,true);assert.equal(failure.uncertain,true);assert.equal(failure.confirmed,false);assert.equal(failure.installationNotStarted,false);
  assert.equal(failure.receiverBusy,true);assert.equal(failure.verificationRequired,true);assert.equal(failure.updateDiagnostic.phase,null,'invalid fields never become an accepted receipt');
  assert.doesNotMatch(bluetoothFirmwareFailureMessage(failure),/unchanged|remains selected|Reconnect and check/);return true;
 });
 assert.equal(receiver.writes.length,0);assert.equal(receiver.mtuCalls,0);assert.equal(receiver.subscriptions,0);assert.equal((await transfer.cancel('cleanup')).tooLate,true);
});

for(const notifications of [false,true])test(`Finish uncertainty over ${notifications?'notifications':'polling'} requires verification without Cancel or replay`,async()=>{
 const receiver=new Receiver({notifications}),transfer=receiver.transfer(),result=await transfer.send(receiver.pkg);
 assert.equal(result.committed,false);assert.equal(result.verificationRequired,true);assert.equal(result.commitUnconfirmed,true);
 assert.equal(result.updateDiagnostic.commitUnconfirmed,true);assert.equal(result.updateDiagnostic.phase,5);assert.equal(result.updateDiagnostic.error,6);
 assert.equal(result.updateDiagnostic.acknowledgedBytes,receiver.pkg.image.length);assert.equal(result.updateDiagnostic.commitAcknowledged,false);
 assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert.equal(receiver.writes.filter(row=>row.op===5).length,0);
 assert.equal(transfer.getResumeLease(),null);assert.equal((await transfer.cancel('user')).tooLate,true);assert.equal((await transfer.cancel('cleanup')).tooLate,true);
 assert.equal(receiver.writes.filter(row=>row.op===5).length,0);
});

test('native Finish rejection after a matching uncertainty notification preserves the retained receipt',async()=>{
 const receiver=new Receiver({notifications:true}),transfer=receiver.transfer();
 receiver.onWrite=async op=>{if(op===4){receiver.listener(status(receiver.s));throw Error('Native response lost.');}};
 const result=await transfer.send(receiver.pkg);assert.equal(result.verificationRequired,true);assert.equal(result.commitUnconfirmed,true);
 assert.equal(result.updateDiagnostic.error,6);assert.equal(result.updateDiagnostic.acknowledgedBytes,2048);
 assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert(!receiver.writes.some(row=>row.op===5));
});

test('the uncertainty flag cannot turn an issued Data ACK into a Finish receipt',async()=>{
 const receiver=new Receiver({notifications:true}),transfer=receiver.transfer();receiver.finishUncertain=false;
 receiver.onWrite=async op=>{if(op===3&&receiver.s.offset===2048)receiver.listener(status({...receiver.s,phase:5,error:6,flags:16}));};
 const result=await transfer.send(receiver.pkg);assert.equal(result.committed,true);assert.equal(transfer.diagnostic().commitUnconfirmed,false);assert(!receiver.writes.some(row=>row.op===5));
});

test('foreign, stale and malformed uncertainty notifications cannot replace the matching Finish result',async()=>{
 const receiver=new Receiver({notifications:true}),transfer=receiver.transfer();receiver.finishUncertain=false;
 receiver.onWrite=async op=>{if(op===4){
  const receipt={...receiver.s,phase:5,error:6,flags:16};
  for(const patch of [{session:receiver.s.session^1},{size:2049,offset:2049},{ack:receiver.writes[0].ack},{ack:65535},{offset:2047},{flags:17}])receiver.listener(status({...receipt,...patch}));
 }};
 const result=await transfer.send(receiver.pkg);assert.equal(result.committed,true);assert.equal(transfer.diagnostic().commitUnconfirmed,false);assert.equal(transfer.diagnostic().phase,4);
 assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert(!receiver.writes.some(row=>row.op===5));
});

test('legacy Finish flash rejection without the flag remains a confirmed preselection failure',async()=>{
 const receiver=new Receiver(),transfer=receiver.transfer();receiver.onWrite=async op=>{if(op===4)receiver.s.flags=0;};
 await assert.rejects(transfer.send(receiver.pkg),failure=>failure.confirmed===true&&failure.uncertain!==true&&/remains selected/.test(failure.message));
 assert.equal(receiver.writes.filter(row=>row.op===4).length,1);assert(!receiver.writes.some(row=>row.op===5));
});
