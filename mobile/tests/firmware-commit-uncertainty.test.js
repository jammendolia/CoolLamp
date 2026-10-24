import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBleUpdate,parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {FirmwareAttemptJournal,FIRMWARE_ATTEMPT_KEY,classifyFirmwareSnapshot,reconcileFirmwareAttempt,reconcileLegacyFirmwareReceipt} from '../src/firmware-attempt.js';
import {updateCardFirmware} from '../src/card-firmware.js';

const identity='f0b950b2f180';
const manifest=parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.2\nesp32c3\ndual-ota-2031616\n512\n${'a'.repeat(64)}\n`);
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
function uncertainReceiver(){
 const bytes=new DataView(new ArrayBuffer(20));bytes.setUint8(0,1);bytes.setUint8(1,5);bytes.setUint8(2,6);bytes.setUint8(3,0x10);
 bytes.setUint32(4,9,true);bytes.setUint32(8,512,true);bytes.setUint32(12,512,true);bytes.setUint16(16,4,true);bytes.setUint16(18,232,true);
 return decodeBleUpdate(bytes);
}
const idleReceiver=()=>({phase:0,error:0,committed:false,session:0,size:0,offset:0});
function snapshot({version='1.15.2',receiver=uncertainReceiver(),observedAt=Date.now(),identity:target=identity}={}){
 return {identity:target,observedAt,firmware:{version,phase:0},state:{mode:4,effectCount:47,brightness:55,power:true},receiver};
}
function fixture(){const storage=memory(),journal=new FirmwareAttemptJournal(storage),attempt=journal.begin(identity,manifest);return {storage,journal,attempt};}

test('additive journal uncertainty defaults false for old v1 rows and rejects malformed or terminal uncertainty',()=>{
 const f=fixture(),raw=JSON.parse(f.storage.getItem(FIRMWARE_ATTEMPT_KEY));delete raw.records[0].commitUnconfirmed;
 f.storage.setItem(FIRMWARE_ATTEMPT_KEY,JSON.stringify(raw));assert.equal(new FirmwareAttemptJournal(f.storage).get(identity).commitUnconfirmed,false);
 for(const patch of [{commitUnconfirmed:'yes'},{commitUnconfirmed:true,outcome:'installed'},{commitUnconfirmed:true,outcome:'installationNotStarted'}]){
  raw.records[0]={...f.attempt,...patch};f.storage.setItem(FIRMWARE_ATTEMPT_KEY,JSON.stringify(raw));
  assert.equal(new FirmwareAttemptJournal(f.storage).healthy,false);
 }
});
for(const version of ['1.15.1','1.15.2'])test('phase-5 error-6 explicit 0x10 stays pending with running '+version+', including stale matching release',()=>{
 const f=fixture(),result=classifyFirmwareSnapshot(f.attempt,snapshot({version}));
 assert.equal(result.outcome,'unresolved');assert.equal(result.pending,true);assert.equal(result.commitUnconfirmed,true);
 assert.equal(result.receiverInactive,false);assert.equal(result.safeRetry,false);assert.equal(result.safeExplicitRetry,false);
 assert.doesNotMatch(result.message,/unchanged|did not start|updated\./);f.journal.settle(f.attempt,result);
 assert.equal(new FirmwareAttemptJournal(f.storage).get(identity).commitUnconfirmed,true);
});
test('phase-5 committed-false without the explicit uncertainty bit retains the safe legacy stopped-transfer meaning',()=>{
 const f=fixture();f.journal.beforeWrite(f.attempt,1,9);f.journal.beforeWrite(f.attempt,2,9);
 const receiver={...uncertainReceiver(),commitUnconfirmed:false},result=classifyFirmwareSnapshot(f.journal.get(identity),snapshot({version:'1.15.1',receiver}));
 assert.equal(result.outcome,'transferStopped');assert.equal(result.safeExplicitRetry,true);assert.equal(result.commitUnconfirmed,false);
});
test('malformed explicit uncertainty never provides terminal proof',()=>{
 const f=fixture();for(const patch of [{phase:0},{error:7},{session:0},{size:0,offset:0},{offset:511},{committed:true},{commitUnconfirmed:'true'}])
  assert.throws(()=>classifyFirmwareSnapshot(f.attempt,snapshot({receiver:{...uncertainReceiver(),...patch}})),error=>error.invalidRead);
});
test('stale or wrong-target 1.15.2 status cannot resolve an uncertain installation',()=>{
 const f=fixture();f.journal.noteCommitUnconfirmed(f.attempt);
 const result=classifyFirmwareSnapshot(f.journal.get(identity),snapshot({observedAt:1}),{now:()=>10000});
 assert.equal(result.staleSnapshot,true);assert.equal(result.pending,true);assert.equal(result.safeRetry,false);assert.equal(result.commitUnconfirmed,true);
 assert.throws(()=>classifyFirmwareSnapshot(f.journal.get(identity),snapshot({identity:'aabbccddeeff'})),error=>error.identity);
});
test('the observed commit fence survives phone reload, a cleared receiver and matching reboot version without invented boot/digest proof',()=>{
 const f=fixture();f.journal.noteCommitUnconfirmed(f.attempt);const restored=new FirmwareAttemptJournal(f.storage),attempt=restored.get(identity);
 const result=classifyFirmwareSnapshot(attempt,{...snapshot({receiver:idleReceiver()}),bootSession:'changed-boot',runningSha256:manifest.sha256,bootHealthy:true});
 assert.equal(result.outcome,'unresolved');assert.equal(result.commitUnconfirmed,true);assert.equal(result.pending,true);
 assert.equal(result.safeRetry,false);assert.equal(result.receiverInactive,false);restored.settle(attempt,result);assert.equal(restored.pending().length,1);
 assert.throws(()=>restored.beforeWrite(attempt,1,9),error=>error.commitUnconfirmed&&error.beforeMutation);
 assert.throws(()=>restored.beforeWifi(attempt,'/api/firmware/install'),error=>error.requiresReconciliation);
 assert.throws(()=>restored.abandonUnstarted(attempt),error=>error.requiresReconciliation);
 assert.throws(()=>restored.begin(identity,manifest),error=>error.requiresReconciliation);
 assert.throws(()=>restored.settle(attempt,{...result,outcome:'installed',controlResponsive:true,receiverInactive:true}),error=>error.requiresReconciliation);
});
test('uncertainty observation is one bounded durable write, including the reserved final journal write',()=>{
 const f=fixture(),raw=JSON.parse(f.storage.getItem(FIRMWARE_ATTEMPT_KEY));raw.records[0].writes=32;f.storage.setItem(FIRMWARE_ATTEMPT_KEY,JSON.stringify(raw));
 const journal=new FirmwareAttemptJournal(f.storage),attempt=journal.get(identity);journal.noteCommitUnconfirmed(attempt);
 const saved=f.storage.getItem(FIRMWARE_ATTEMPT_KEY);journal.noteCommitUnconfirmed(attempt);assert.equal(f.storage.getItem(FIRMWARE_ATTEMPT_KEY),saved);
 assert.equal(new FirmwareAttemptJournal(f.storage).get(identity).writes,33);
});
test('failed uncertainty persistence remains explicitly uncertain and cannot abandon the pending attempt',()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('Storage unavailable.');};
 assert.throws(()=>f.journal.noteCommitUnconfirmed(f.attempt),error=>error.journalFailure&&error.uncertain&&error.commitUnconfirmed&&error.beforeMutation===false);
 assert.equal(f.journal.pending().length,1);assert.throws(()=>f.journal.begin(identity,manifest),error=>error.requiresReconciliation);
});

function cardFixture({preflightUnconfirmed=false,transferResult=null,transferFailure=null,loseFinish=false}={}){
 const f=fixture(),calls=[],observed=()=>snapshot({receiver:preflightUnconfirmed?uncertainReceiver():idleReceiver(),version:'1.15.1'});
 const acquire=async()=>({lamp:{identity,refreshFirmware:async()=>{calls.push('firmware');return {version:'1.15.1',phase:0};},
  readFirmwareUpdateSnapshot:async()=>{calls.push('snapshot');return observed();},updateOverBluetooth:async(_package,_progress,options)=>{
   calls.push('transfer');if(loseFinish){for(const operation of [1,2,4])options.onBeforeWrite({operation,session:9});}
   if(transferFailure)throw transferFailure;return transferResult;
  }},release:async()=>{calls.push('release');}});
 const reconcile=attempt=>reconcileFirmwareAttempt({attempt,maxAttempts:1,acquire:async()=>{
  calls.push('reconcile');return {lamp:{identity,readFirmwareUpdateSnapshot:async()=>snapshot({receiver:idleReceiver()})},release:async()=>{calls.push('reconcile-release');}};
 }});
 const run=options=>updateCardFirmware({entry:{id:identity,deviceId:'saved'},manifest,attemptJournal:f.journal,attempt:f.attempt,acquireBluetooth:acquire,
  download:async()=>{calls.push('download');return {manifest,image:new Uint8Array(512)};},reconcile,...options});
 return {...f,calls,run};
}
test('a zero-local-frame receiver commit fence stops phone download and uses read-only reconciliation once',async()=>{
 const f=cardFixture({preflightUnconfirmed:true});const result=await f.run();
 assert.equal(result.pending,true);assert.equal(result.commitUnconfirmed,true);assert.equal(result.safeRetry,false);
 assert.deepEqual(f.calls,['firmware','snapshot','release','reconcile','reconcile-release']);
 assert.equal(f.journal.get(identity).metadataIssued,false);assert.equal(new FirmwareAttemptJournal(f.storage).get(identity).commitUnconfirmed,true);
});
for(const kind of ['failure','result'])test('zero-frame '+kind+' commit uncertainty cannot trigger a second Bluetooth sender attempt',async()=>{
 const signal={commitUnconfirmed:true,installationNotStarted:true,uncertain:false};
 const f=cardFixture(kind==='failure'?{transferFailure:Object.assign(Error('Boot selection not confirmed.'),signal)}:{transferResult:signal});
 const result=await f.run();assert.equal(result.pending,true);assert.equal(result.safeRetry,false);assert.equal(result.commitUnconfirmed,true);
 assert.equal(f.calls.filter(value=>value==='transfer').length,1);assert.equal(f.calls.filter(value=>value==='download').length,1);
 assert.equal(f.calls.filter(value=>value==='firmware').length,2);assert.equal(f.calls.filter(value=>value==='reconcile').length,1);
 assert.equal(f.journal.get(identity).metadataIssued,false);assert.equal(f.journal.get(identity).commitUnconfirmed,true);
});
test('lost Finish with explicit receiver uncertainty remains pending across reload and reboot, without another Finish',async()=>{
 const f=cardFixture({loseFinish:true,transferResult:{committed:false,verificationRequired:true,commitUnconfirmed:true}}),result=await f.run();
 assert.equal(result.pending,true);assert.equal(f.calls.filter(value=>value==='transfer').length,1);
 const restored=new FirmwareAttemptJournal(f.storage),attempt=restored.get(identity);assert.equal(attempt.commitAttempted,true);assert.equal(attempt.commitUnconfirmed,true);
 const afterRestart=classifyFirmwareSnapshot(attempt,snapshot({receiver:idleReceiver()}));assert.equal(afterRestart.outcome,'unresolved');assert.equal(afterRestart.pending,true);
});
test('explicit commit uncertainty prevents Wi-Fi-to-Bluetooth fallback even when a lower layer claims safe fallback',async()=>{
 const f=cardFixture();let wifi=0;
 const result=await f.run({entry:{id:identity,deviceId:'saved',address:'192.168.1.222'},wifi:async()=>{wifi++;
  throw Object.assign(Error('Final selection status lost.'),{commitUnconfirmed:true,safeBluetoothFallback:true,uncertain:false});}});
 assert.equal(wifi,1);assert.equal(result.pending,true);assert.equal(result.commitUnconfirmed,true);
 assert.deepEqual(f.calls,['reconcile','reconcile-release']);assert.equal(f.journal.get(identity).metadataIssued,false);
});
test('a restored commit uncertainty goes straight to read-only checking, without another route or download',async()=>{
 const f=cardFixture();f.journal.noteCommitUnconfirmed(f.attempt);let wifi=0;
 const result=await f.run({attempt:f.journal.get(identity),entry:{id:identity,deviceId:'saved',address:'192.168.1.222'},wifi:async()=>{wifi++;}});
 assert.equal(result.pending,true);assert.equal(wifi,0);assert.deepEqual(f.calls,['reconcile','reconcile-release']);
});
test('without a reconciliation adapter, explicit uncertainty overrides contradictory unchanged/safe-fallback error fields',async()=>{
 const f=cardFixture({transferFailure:Object.assign(Error('Boot status lost.'),{commitUnconfirmed:true,confirmed:true,uncertain:false,installationNotStarted:true,safeBluetoothFallback:true})});
 await assert.rejects(f.run({reconcile:null}),error=>error.commitUnconfirmed&&error.uncertain&&error.verificationRequired&&error.confirmed===false&&error.installationNotStarted===false&&error.safeBluetoothFallback===false);
 assert.equal(f.calls.filter(value=>value==='transfer').length,1);assert.equal(f.journal.get(identity).commitUnconfirmed,true);
});
test('legacy verified-restarting receipts cannot ignore an explicit new receiver commit fence',async()=>{
 const result=await reconcileLegacyFirmwareReceipt({receipt:{identity,targetVersion:manifest.version,outcome:'verified-restarting'},maxAttempts:1,
  acquire:async()=>({lamp:{identity,readFirmwareUpdateSnapshot:async()=>snapshot()},release:async()=>{}})});
 assert.equal(result.outcome,'unresolved');assert.equal(result.pending,true);assert.equal(result.commitUnconfirmed,true);assert.equal(result.safeRetry,false);
});
