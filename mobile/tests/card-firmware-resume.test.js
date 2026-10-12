import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {updateCardFirmware} from '../src/card-firmware.js';
import {parsePhoneManifest,OTA_STATUS,OTA_WRITE} from '../src/bluetooth-firmware.js';
import {LampTransport} from '../src/transport.js';
import {STATE,FIRMWARE,SERVICE} from '../src/protocol.js';
import {FirmwareAttemptJournal,classifyFirmwareSnapshot,acquireFirmwareResumeLease,reconcileFirmwareAttempt} from '../src/firmware-attempt.js';

const id='aabbccddeeff',other='112233445566',manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.3\nesp32c3\ndual-ota-2031616\n512\n'+'a'.repeat(64)+'\n');
const storage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function observed(identity=id,{version='1.15.2',phase=0,receiver={}}={}){
 return{identity,observedAt:Date.now(),firmware:{version,phase},state:{mode:4,effectCount:47,brightness:55,power:true},
  receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0,...receiver}};
}
function fixture(){
 const journal=new FirmwareAttemptJournal(storage()),events=[],ops=[],ids=[],errors=[],pkg={manifest,image:new Uint8Array(512)};
 let acquireCount=0,resumeCount=0,sourceFailure={},resumedFailure=null,snapshotChange=value=>value,current=true,releaseCount=0;
 const proof={identity:id,session:99,version:manifest.version,size:manifest.size,sha256:manifest.sha256};
 const options={entry:{id,deviceId:'paired'},manifest,attemptJournal:journal,isCurrent:()=>current,onFailure:error=>errors.push(error.message),
  download:async()=>{events.push('download');return pkg;},
  acquireBluetooth:async(_entry,scope)=>{
   const index=++acquireCount;events.push('acquire:'+index);
   const lamp={identity:id,refreshFirmware:async()=>({version:'1.15.2',phase:0}),
    readFirmwareUpdateSnapshot:async readOptions=>{
     if(index<3)return observed();
     assert.equal(scope.signal.aborted,false);assert.equal(readOptions.expectedSession,99);
     return snapshotChange(observed(id,{phase:3,receiver:{phase:2,session:99,size:512,offset:128,resumeSupported:true,detached:true}}));
    },updateOverBluetooth:async(prepared,progress,sendOptions)=>{
     assert.equal(prepared,pkg);assert.equal(sendOptions.enableResume,true);ids.push(journal.get(id).attemptId);
     const issue=operation=>{ops.push(operation);sendOptions.onBeforeWrite({operation,session:99,version:manifest.version,size:512,sha256:manifest.sha256,sequence:operation===4?7:1});};
     if(!sendOptions.resumeLease){issue(1);issue(6);issue(3);progress({stage:'transferring',acknowledgedBytes:64});
      throw Object.assign(Error('Native link ended'),{stopReason:'native-disconnect',cancelled:true,firmwareResumeLease:proof,...sourceFailure});}
     ++resumeCount;assert.deepEqual(sendOptions.resumeLease,proof);issue(7);
     if(resumedFailure)throw Object.assign(Error('The resumed link ended'),resumedFailure);
     progress({stage:'transferring',acknowledgedBytes:128});
     issue(3);progress({stage:'transferring',acknowledgedBytes:512});issue(4);
     return{committed:true,receipt:{session:99,size:512,offset:512,ack:7,phase:4,error:0,committed:true}};
    }};
   return{lamp,release:async()=>{++releaseCount;events.push('release:'+index);}};
  },reconcile:async attempt=>{
   events.push('reconcile');return classifyFirmwareSnapshot(attempt,observed(id,{version:attempt.commitAcknowledged?'1.15.3':'1.15.2'}));
  }};
 return{options,journal,events,ops,ids,errors,setFailure:value=>sourceFailure=value,setResumedFailure:value=>resumedFailure=value,setSnapshot:callback=>snapshotChange=callback,
  setCurrent:value=>current=value,counts:()=>({acquireCount,resumeCount,releaseCount})};
}

test('one native-disconnect resumes the same durable attempt after old lease release, with no Manifest/Begin/Finish replay',async()=>{
 const f=fixture(),result=await updateCardFirmware(f.options);
 assert.equal(result.outcome,'installed',JSON.stringify({errors:f.errors,ops:f.ops}));assert.deepEqual(f.ops,[1,6,3,7,3,4]);
 assert.equal(new Set(f.ids).size,1);assert.equal(f.journal.get(id).resumeAttempted,true);
 assert.equal(f.journal.get(id).commitAcknowledged,true);assert.equal(f.journal.get(id).session,99);
 assert.deepEqual(f.events,['acquire:1','release:1','download','acquire:2','release:2','acquire:3','release:3','reconcile']);
 assert.deepEqual(f.counts(),{acquireCount:3,resumeCount:1,releaseCount:3});
});

for(const reason of ['app-hidden','user','cancelled','native-write-failure','connection-changed','transport-disconnect'])
 test(reason+' cannot start resume recovery',async()=>{
  const f=fixture();f.setFailure({stopReason:reason});const result=await updateCardFirmware(f.options);
  assert.equal(result.outcome,'transferStopped');assert.equal(f.counts().resumeCount,0);assert.deepEqual(f.ops,[1,6,3]);
 });
for(const fields of [{identity:true},{journalFailure:true},{commitUnconfirmed:true},{stale:true},{firmwareResumeLease:null},
 {firmwareResumeLease:{identity:other,session:99,version:manifest.version,size:512,sha256:manifest.sha256}}])
 test('unusable failure lease does not authorize resume '+JSON.stringify(fields),async()=>{
  const f=fixture();f.setFailure(fields);await updateCardFirmware(f.options);assert.equal(f.counts().resumeCount,0);assert.deepEqual(f.ops,[1,6,3]);
 });
for(const change of [value=>({...value,identity:other}),value=>({...value,observedAt:0}),value=>({...value,firmware:{version:'1.15.3',phase:0}}),
 value=>({...value,receiver:{...value.receiver,session:100}}),value=>({...value,receiver:{...value.receiver,detached:false}}),
 value=>({...value,receiver:{...value.receiver,resumeSupported:false}}),value=>({...value,receiver:{...value.receiver,phase:0}}),
 value=>({...value,receiver:{...value.receiver,offset:63}}),value=>({...value,receiver:{...value.receiver,offset:513}})])
 test('changed, expired or inconsistent protected snapshot is reconciled read-only without resume '+change.toString(),async()=>{
  const f=fixture();f.setSnapshot(change);const result=await updateCardFirmware(f.options);
  assert.equal(result.outcome,'transferStopped');assert.equal(f.counts().resumeCount,0);assert.deepEqual(f.ops,[1,6,3]);
  assert.equal(f.counts().releaseCount,3);
 });

function pendingAttempt(identity){const journal=new FirmwareAttemptJournal(storage()),token=journal.begin(identity,manifest);
 journal.beforeWrite(token,{operation:1,session:99});journal.beforeWrite(token,{operation:6,session:99});
 return{journal,attempt:journal.get(identity),proof:{identity,session:99,version:manifest.version,size:512,sha256:manifest.sha256}};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('timed-out pending acquisition fences later reconciliation; a late lease only closes',async()=>{
 const identity='aabbccddee01',f=pendingAttempt(identity),acquisition=defer(),closing=defer();let closes=0,reads=0,newAcquires=0;
 await assert.rejects(acquireFirmwareResumeLease({attempt:f.attempt,resumeLease:f.proof,installedVersion:'1.15.2',timeoutMs:10,
  acquire:()=>acquisition.promise}),error=>error.timeout||error.cancelled);
 const checking=reconcileFirmwareAttempt({attempt:f.attempt,timeoutMs:30,maxAttempts:1,acquire:async()=>{++newAcquires;assert.fail('Raced a pending native acquisition');}});
 acquisition.resolve({lamp:{identity,readFirmwareUpdateSnapshot:async()=>{++reads;return observed(identity);}},release:()=>{++closes;return closing.promise;}});
 await tick();const result=await checking;assert.equal(result.outcome,'unresolved');assert.equal(newAcquires,0);assert.equal(reads,0);assert.equal(closes,1);
 closing.resolve();await tick();await tick();
});
test('foreground cancellation prevents a late acquisition from reading or resuming',async()=>{
 const identity='aabbccddee02',f=pendingAttempt(identity),acquisition=defer(),abort=new AbortController();let closes=0;
 const waiting=acquireFirmwareResumeLease({attempt:f.attempt,resumeLease:f.proof,installedVersion:'1.15.2',acquire:()=>acquisition.promise,signal:abort.signal});
 await tick();abort.abort('app-hidden');await assert.rejects(waiting,error=>error.cancelled);
 acquisition.resolve({lamp:{identity,readFirmwareUpdateSnapshot:()=>assert.fail('An orphan lease read state')},release:async()=>++closes});
 await tick();await tick();assert.equal(closes,1);
});
test('deadline during a native snapshot releases once and ignores its late result',async()=>{
 const identity='aabbccddee03',f=pendingAttempt(identity),reading=defer();let releases=0;
 await assert.rejects(acquireFirmwareResumeLease({attempt:f.attempt,resumeLease:f.proof,installedVersion:'1.15.2',timeoutMs:10,
  acquire:async()=>({lamp:{identity,readFirmwareUpdateSnapshot:()=>reading.promise},release:async()=>++releases})}));
 assert.equal(releases,1);reading.resolve(observed(identity));await tick();assert.equal(releases,1);
});

test('an already stopped attempt cannot become a resume lease',async()=>{
 const identity='aabbccddee04',f=pendingAttempt(identity);
 const ended=classifyFirmwareSnapshot(f.attempt,observed(identity));f.journal.settle(f.attempt,ended);
 let acquired=0;await assert.rejects(acquireFirmwareResumeLease({attempt:f.journal.get(identity),resumeLease:f.proof,installedVersion:'1.15.2',
  acquire:async()=>{++acquired;}}));assert.equal(acquired,0);
});

test('a second disconnect after Resume never reacquires, restarts Begin or repeats Resume',async()=>{
 const f=fixture();f.setResumedFailure({stopReason:'native-disconnect',firmwareResumeLease:{identity:id,session:99,
  version:manifest.version,size:512,sha256:manifest.sha256}});
 const result=await updateCardFirmware(f.options);assert.equal(result.outcome,'transferStopped');
 assert.deepEqual(f.ops,[1,6,3,7]);assert.equal(f.counts().acquireCount,3);assert.equal(f.counts().resumeCount,1);
});

test('without a durable journal the card does not enable receiver leases or automatic resume',async()=>{
 const f=fixture();delete f.options.attemptJournal;
 f.options.acquireBluetooth=async()=>({lamp:{identity:id,refreshFirmware:async()=>({version:'1.15.2',phase:0}),
  updateOverBluetooth:async(_pkg,_progress,options)=>{assert.equal(options.enableResume,undefined);assert.equal(options.resumeLease,undefined);return{committed:true};}},release:async()=>{}});
 assert.equal((await updateCardFirmware(f.options)).committed,true);
});

test('a full-size production card/transport/sender resumes retained bytes and hashes the artifact once without replay',{timeout:30000},async()=>{
 const size=2031568,image=new Uint8Array(size);for(let index=0;index<size;index++)image[index]=(index*29+(index>>>8)*7)&255;
 const header=new DataView(image.buffer);image[0]=0xe9;header.setUint16(12,5,true);header.setUint32(32,0xabcd5432,true);
 image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.15.3\0'),300);
 const digest=createHash('sha256').update(image).digest('hex');
 const selected=parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.3\nesp32c3\ndual-ota-2031616\n${size}\n${digest}\n`),prepared={manifest:selected,image};
 const journal=new FirmwareAttemptJournal(storage()),events=[],operations=[],dataOffsets=[],hash=createHash('sha256');
 let currentTransport,acquisitions=0,failed=false,retained=null,firstResumedData=null,installed='1.15.2',metadata=[];
 const receiver={phase:0,error:0,session:0,size:0,offset:0,ack:0,committed:false,detached:false};
 const view=bytes=>new DataView(Uint8Array.from(bytes).buffer);
 const status=()=>{const out=new DataView(new ArrayBuffer(20));out.setUint8(0,1);out.setUint8(1,receiver.phase);out.setUint8(2,receiver.error);
  out.setUint8(3,4|(receiver.detached?8:0)|(receiver.committed?1:0));out.setUint32(4,receiver.session,true);out.setUint32(8,receiver.size,true);
  out.setUint32(12,receiver.offset,true);out.setUint16(16,receiver.ack,true);out.setUint16(18,232,true);return out;};
 const ble={getMtu:async()=>247,disconnect:async()=>{if(receiver.phase===2)receiver.detached=true;},
  read:async(_device,service,char)=>{assert.equal(service,SERVICE);
   if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001')return view(new TextEncoder().encode(id));
   if(char===STATE)return view([1,0,0,4,55,1,47,37,0,0,0,0]);
   if(char===OTA_STATUS)return status();
   assert.equal(char,FIRMWARE);const out=new DataView(new ArrayBuffer(20));out.setUint8(0,1);out.setUint8(1,receiver.phase===2?3:0);
   installed.split('.').forEach((part,index)=>out.setUint16(6+index*2,Number(part),true));out.setUint16(12,1,true);out.setUint16(14,15,true);out.setUint16(16,3,true);return out;
  },write:async(_device,service,char,frame)=>{
   assert.equal(service,SERVICE);assert.equal(char,OTA_WRITE);assert(frame.byteLength<=244);
   const operation=frame.getUint8(1),session=frame.getUint32(2,true),sequence=frame.getUint16(6,true);operations.push(operation);
   if(receiver.session)assert.equal(session,receiver.session);else receiver.session=session;
   if(operation===1){assert.equal(frame.getUint16(8,true),metadata.length);metadata.push(...new Uint8Array(frame.buffer,frame.byteOffset+10,frame.byteLength-10));}
   else if(operation===6){assert.equal(new TextDecoder().decode(Uint8Array.from(metadata)),selected.text);receiver.phase=2;receiver.size=size;}
   else if(operation===7){assert.equal(receiver.detached,true);assert.equal(frame.byteLength,50);assert.equal(frame.getUint32(8,true),size);
    assert.equal(Buffer.from(frame.buffer,frame.byteOffset+12,32).toString('hex'),digest);
    assert.deepEqual([frame.getUint16(44,true),frame.getUint16(46,true),frame.getUint16(48,true)],[1,15,3]);receiver.detached=false;}
   else if(operation===3){assert.equal(receiver.detached,false);const offset=frame.getUint32(8,true);assert.equal(offset,receiver.offset);
    if(operations.includes(7)&&firstResumedData===null)firstResumedData=offset;
    const bytes=new Uint8Array(frame.buffer,frame.byteOffset+12,frame.byteLength-12);assert.deepEqual(bytes,image.subarray(offset,offset+bytes.length));
    dataOffsets.push(offset);hash.update(bytes);receiver.offset+=bytes.length;
    if(!failed&&receiver.offset>=11136){failed=true;retained=receiver.offset;receiver.detached=true;currentTransport.disconnected(null,'native-disconnect');}
   }else if(operation===4){assert.equal(receiver.offset,size);assert.equal(hash.digest('hex'),digest);receiver.phase=4;receiver.committed=true;}
   else assert.fail('Unexpected mutation '+operation);
   receiver.ack=sequence;
  }};
 const acquire=async()=>{++acquisitions;events.push('acquire:'+acquisitions);
  const lamp=new LampTransport(ble,{firmwareOnly:true,expectedDeviceIdentity:id});lamp.id='receiver';lamp.deviceIdentity=id;
  lamp.state={id:0,result:0,mode:4,effectCount:47,brightness:55,power:true,capabilities:37};lamp.control={capabilities:['control']};
  lamp.firmwareReady=true;lamp.firmwareConnectionGuard=()=>true;currentTransport=lamp;
  const number=acquisitions;return{lamp,release:async()=>{events.push('release:'+number);await lamp.disconnect();}};};
 const result=await updateCardFirmware({entry:{id,deviceId:'receiver'},manifest:selected,attemptJournal:journal,download:async()=>prepared,
  acquireBluetooth:acquire,reconcile:async attempt=>{installed=selected.version;receiver.phase=0;receiver.committed=false;receiver.session=0;receiver.size=0;receiver.offset=0;
   return classifyFirmwareSnapshot(attempt,observed(id,{version:installed}));}});
 assert.equal(result.outcome,'installed');assert.equal(acquisitions,3);assert.equal(firstResumedData,retained);assert.equal(retained,11136);
 assert.equal(operations.filter(value=>value===6).length,1);assert.equal(operations.filter(value=>value===7).length,1);assert.equal(operations.filter(value=>value===4).length,1);
 assert.equal(new Set(dataOffsets).size,dataOffsets.length);assert(dataOffsets.every((offset,index)=>index===0||offset>dataOffsets[index-1]));
 assert.equal(journal.get(id).resumeAttempted,true);assert.equal(journal.get(id).commitAcknowledged,true);
 assert(events.indexOf('release:2')<events.indexOf('acquire:3'));
});
