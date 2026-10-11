import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareAttemptJournal,FIRMWARE_ATTEMPT_KEY,reconcileFirmwareAttempt,classifyFirmwareSnapshot,reconcileLegacyFirmwareReceipt} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {decodeState} from '../src/protocol.js';

const id='f0b950b2f180',other='74b950b2f180';
const manifest=(release='1.15.1',size=512,digest='a'.repeat(64))=>parsePhoneManifest('COOLLAMP-OTA-1\n'+release+'\nesp32c3\ndual-ota-2031616\n'+size+'\n'+digest+'\n');
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function storage(){
 const data=new Map(),writes=[];let fail=false,corrupt=false;
 return {getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('Storage unavailable.');writes.push(value);data.set(key,corrupt?'broken':value);},
  data,writes,fail:value=>fail=value,corrupt:value=>corrupt=value};
}
function attempt({begin=false,commit=false,wifi=false,size=512,reinstall=false}={}){
 const memory=storage(),journal=new FirmwareAttemptJournal(memory),token=journal.begin(id,manifest('1.15.1',size),{reinstall});
 if(begin){journal.beforeWrite(token,{operation:1,session:9});journal.beforeWrite(token,{operation:2,session:9});}
 if(commit)journal.beforeWrite(token,{operation:4,session:9});
 if(wifi)journal.beforeWifi(token,'/api/firmware/install');
 return {memory,journal,token,get value(){return journal.get(id);}};
}
function lampSnapshot({identity=id,version='1.13.0',phase=0,receiver={}}={}){
 return {identity,firmware:{version,phase},state:decodeState(new DataView(Uint8Array.of(1,17,0,4,100,1,47,255,9,0,0,0,0,255,60,110).buffer)),
  receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0,...receiver}};
}
function reader(values,{identity=id,onRead,onAcquire,onRelease}={}){
 let tick=0,index=0;const calls=[];
 return {calls,now:()=>tick,delay:async ms=>{tick+=ms;},acquire:async(value,options)=>{
  calls.push('acquire');await onAcquire?.(value,options);
  return {lamp:{identity,readFirmwareUpdateSnapshot:async()=>{calls.push('snapshot');await onRead?.(options);return values[Math.min(index++,values.length-1)];}},
   release:async()=>{calls.push('release');await onRelease?.();}};
 }};
}
const reconcile=(value,radio,options={})=>reconcileFirmwareAttempt({attempt:value,acquire:radio.acquire,now:radio.now,delay:radio.delay,...options});

test('approved artifact and safety flags survive reload and snapshots remain immutable',()=>{
 const a=attempt(),old=a.value;a.journal.beforeWrite(a.token,{operation:1,session:9,version:'1.15.1',size:512,sha256:'a'.repeat(64)});
 a.journal.beforeWrite(a.token,{operation:2,session:9});
 const restored=new FirmwareAttemptJournal(a.memory).get(id);assert.equal(restored.attemptId,a.token.attemptId);
 assert.equal(restored.text,manifest().text);assert.equal(restored.session,9);assert.equal(restored.beginAttempted,true);
 assert.equal(old.beginAttempted,false);assert(Object.isFrozen(restored));assert.equal(a.journal.pending().length,1);
 assert.throws(()=>a.journal.begin(id,manifest('1.16.0')),error=>error.requiresReconciliation);
});
test('before-write boundary rejects changed artifact/session, duplicate Begin/Finish, and out-of-order frames',()=>{
 const a=attempt();
 for(const event of [{operation:3,session:9},{operation:2,session:9},{operation:4,session:9},{operation:1,session:0},{operation:1,session:9,size:513},{operation:1,session:9,sha256:'b'.repeat(64)}])
  assert.throws(()=>a.journal.beforeWrite(a.token,event),error=>error.beforeMutation);
 a.journal.beforeWrite(a.token,1,9);assert.throws(()=>a.journal.beforeWrite(a.token,1,10),error=>error.beforeMutation);
 a.journal.beforeWrite(a.token,2,9);assert.throws(()=>a.journal.beforeWrite(a.token,2,9),error=>error.beforeMutation);
 a.journal.beforeWrite(a.token,4,9);assert.throws(()=>a.journal.beforeWrite(a.token,4,9),error=>error.beforeMutation);
 assert.equal(new FirmwareAttemptJournal(a.memory).get(id).commitAttempted,true);
});
test('failed persistence and failed readback stop the next native mutation',()=>{
 for(const kind of ['throw','readback']){
  const a=attempt({begin:true});if(kind==='throw')a.memory.fail(true);else a.memory.corrupt(true);
  let sent=0;assert.throws(()=>{a.journal.beforeWrite(a.token,{operation:4,session:9});sent++;},error=>error.journalFailure&&error.beforeMutation);
  assert.equal(sent,0);assert.equal(a.journal.get(id).commitAttempted,false);
 }
 const memory=storage();memory.fail(true);assert.throws(()=>new FirmwareAttemptJournal(memory).begin(id,manifest()),error=>error.journalFailure);
});
test('Wi-Fi Install is persisted before POST and prevents a BLE route from starting',()=>{
 const a=attempt();a.journal.beforeWifi(a.token,'/api/firmware/check');assert.equal(a.value.wifiInstallAttempted,false);
 a.memory.fail(true);let posts=0;assert.throws(()=>{a.journal.beforeWifi(a.token,'/api/firmware/install');posts++;},error=>error.beforeMutation);
 assert.equal(posts,0);a.memory.fail(false);a.journal.beforeWifi(a.token,'/api/firmware/install');
 assert.equal(new FirmwareAttemptJournal(a.memory).get(id).wifiInstallAttempted,true);
 assert.throws(()=>a.journal.beforeWrite(a.token,1,9),error=>error.requiresReconciliation);
});
test('chunk and progress work has bounded durable writes and never accepts attempted/reordered bytes',()=>{
 const a=attempt({begin:true,size:2000000});
 for(let i=0;i<10000;i++){
  a.journal.beforeWrite(a.token,{operation:3,session:9});a.journal.noteProgress(a.token,{acknowledgedBytes:i*200});
 }
 a.journal.noteProgress(a.token,2000000);a.journal.noteProgress(a.token,0);a.journal.noteProgress(a.token,2000001);
 assert.equal(a.value.offset,2000000);assert(a.memory.writes.length<=15);
 assert.equal(new FirmwareAttemptJournal(a.memory).get(id).offset,2000000);
 const b=attempt();b.journal.noteProgress(b.token,512);assert.equal(b.value.offset,0);
});
test('unknown journal versions, duplicates and malformed bounds fail closed without touching other storage',()=>{
 const valid=attempt().value;
 for(const value of ['broken',{version:2,records:[]},{version:1,records:[valid,valid]},
  {version:1,records:[{...valid,session:0}]},{version:1,records:[{...valid,commitAttempted:true}]},
  {version:1,records:[{...valid,offset:513}]},{version:1,records:Array(33).fill(valid)}]){
  const memory=storage();memory.data.set('coollamp-firmware-feedback-v1','keep');memory.data.set(FIRMWARE_ATTEMPT_KEY,typeof value==='string'?value:JSON.stringify(value));
  const journal=new FirmwareAttemptJournal(memory);assert.equal(journal.healthy,false);assert.throws(()=>journal.begin(id,manifest()),error=>error.journalFailure);
  assert.equal(memory.data.get('coollamp-firmware-feedback-v1'),'keep');assert.equal(memory.writes.length,0);
 }
});
test('additive v1 Wi-Fi flags default false and unrecognized fields never enter restored records',()=>{
 const a=attempt(),raw=JSON.parse(a.memory.getItem(FIRMWARE_ATTEMPT_KEY));
 for(const field of ['wifiCheckAttempted','wifiInstallAttempted'])delete raw.records[0][field];raw.records[0].password='must-not-survive';
 a.memory.data.set(FIRMWARE_ATTEMPT_KEY,JSON.stringify(raw));const restored=new FirmwareAttemptJournal(a.memory);
 assert.equal(restored.healthy,true);assert.equal(restored.get(id).wifiInstallAttempted,false);
 assert(!JSON.stringify(restored.get(id)).includes('must-not-survive'));
});
test('all 32 pending attempts are retained; a 33rd cannot evict one',()=>{
 const memory=storage(),journal=new FirmwareAttemptJournal(memory);
 for(let i=0;i<32;i++)journal.begin(i.toString(16).padStart(12,'0'),manifest());
 const saved=memory.getItem(FIRMWARE_ATTEMPT_KEY);assert.equal(journal.pending().length,32);
 assert.throws(()=>journal.begin(id,manifest()),error=>error.journalFull);assert.equal(memory.getItem(FIRMWARE_ATTEMPT_KEY),saved);
 assert.equal(new FirmwareAttemptJournal(memory).pending().length,32);
});
test('fresh protected old firmware and inactive receiver confirms no Begin safely, without a sender',async()=>{
 const a=attempt(),radio=reader([lampSnapshot()]),result=await reconcile(a.value,radio);
 assert.equal(result.outcome,'installationNotStarted');assert.equal(result.safeExplicitRetry,true);assert.match(result.message,/did not start/);
 assert.deepEqual(radio.calls,['acquire','snapshot','release']);a.journal.settle(a.token,result);
 assert.equal(a.journal.pending().length,0);assert.equal(new FirmwareAttemptJournal(a.memory).get(id).outcome,'installationNotStarted');
});
test('fresh inactive receiver after Begin confirms a stopped transfer, not an installed image',async()=>{
 const a=attempt({begin:true}),radio=reader([lampSnapshot({receiver:{phase:5,error:7,session:9,size:512,offset:100}})]);
 const result=await reconcile(a.value,radio);assert.equal(result.outcome,'transferStopped');assert.equal(result.offset,100);
 assert.equal(result.safeRetry,true);a.journal.settle(a.token,result);assert.equal(a.journal.pending().length,0);
});
test('lost Commit and uncertain Wi-Fi Install stay fenced when the lamp still reports old firmware',async()=>{
 for(const flags of [{begin:true,commit:true},{wifi:true}]){
  const a=attempt(flags),radio=reader([lampSnapshot()]);const result=await reconcile(a.value,radio);
  assert.equal(result.outcome,'unresolved');assert.equal(result.safeRetry,false);a.journal.settle(a.token,result);
  assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,1);assert.deepEqual(radio.calls,['acquire','snapshot','release']);
 }
});
test('fresh intended installed version plus protected responsive state resolves without claiming digest or boot health',async()=>{
 const a=attempt({begin:true,commit:true}),radio=reader([lampSnapshot({version:'1.15.1'})]);const result=await reconcile(a.value,radio);
 assert.equal(result.outcome,'installed');assert.equal(result.controlResponsive,true);assert.equal(result.artifactDigestVerified,false);assert.equal(result.bootHealthVerified,false);
 a.journal.settle(a.token,result);assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,0);
 assert.deepEqual(radio.calls,['acquire','snapshot','release']);
});
test('matching active session is observed on one lease until restart, never written/resumed/cancelled',async()=>{
 const a=attempt({begin:true,commit:true}),progress=[],radio=reader([
  lampSnapshot({phase:3,receiver:{phase:3,session:9,size:512,offset:512}}),lampSnapshot({version:'1.15.1'})]);
 const result=await reconcile(a.value,radio,{onProgress:value=>progress.push(value)});
 assert.equal(result.outcome,'installed');assert.equal(result.reads,2);assert.equal(result.attempts,1);
 assert.deepEqual(radio.calls,['acquire','snapshot','snapshot','release']);assert(progress.some(value=>value.offset===512));
});
test('unrelated active session or wrong artifact size never permits retry or guesses progress',async()=>{
 for(const receiver of [{phase:2,session:10,size:512,offset:100},{phase:2,session:9,size:600,offset:100}]){
  const a=attempt({begin:true}),radio=reader([lampSnapshot({phase:3,receiver})]),result=await reconcile(a.value,radio);
  assert.equal(result.outcome,'unresolved');assert.equal(result.safeRetry,false);assert.equal(result.offset,undefined);assert.equal(result.reads,1);
 }
});
test('different installed version, malformed state and malformed offsets never confirm the selected image',async()=>{
 const a=attempt({begin:true,commit:true});
 const newer=await reconcile(a.value,reader([lampSnapshot({version:'1.16.0'})]));assert.equal(newer.outcome,'differentVersion');assert.equal(newer.safeRetry,false);
 for(const invalid of [{...lampSnapshot({version:'1.15.1'}),state:{mode:0}},lampSnapshot({receiver:{size:512,offset:513}})]){
  const result=await reconcile(a.value,reader([invalid]));assert.equal(result.outcome,'unresolved');assert.equal(result.attempts,3);
 }
});
test('wrong lease/snapshot identity fails closed and always releases its private lease',async()=>{
 const a=attempt();
 for(const options of [{identity:other},{}]){
  const radio=reader([lampSnapshot({identity:other})],options);
  await assert.rejects(reconcile(a.value,radio),error=>error.identity);assert.equal(radio.calls.at(-1),'release');
 }
});
test('read failures have three bounded acquisitions and retain pending state without mutation replay',async()=>{
 const a=attempt({begin:true}),radio=reader([],{onRead:()=>{throw Error('Radio lost');}}),result=await reconcile(a.value,radio);
 assert.equal(result.outcome,'unresolved');assert.equal(result.attempts,3);assert.equal(radio.calls.filter(value=>value==='release').length,3);
 assert.equal(result.safeRetry,false);assert.match(result.message,/connection was lost/);
});
test('active receiver obeys both whole-worker deadline and snapshot count bounds',async()=>{
 const a=attempt({begin:true}),active=lampSnapshot({phase:3,receiver:{phase:2,session:9,size:512,offset:100}});
 const radio=reader([active]),result=await reconcile(a.value,radio,{timeoutMs:45000});
 assert.equal(result.outcome,'active');assert.equal(result.timedOut,true);assert(result.reads<=24);assert.equal(result.attempts,1);
 assert.equal(radio.calls.at(-1),'release');assert.equal(result.safeRetry,false);
});
test('cancellation before acquisition and owner callback failure perform no reads',async()=>{
 const a=attempt(),abort=new AbortController();abort.abort();const radio=reader([lampSnapshot()]);
 const cancelled=await reconcile(a.value,radio,{signal:abort.signal});assert(cancelled.pending);assert.equal(cancelled.cancelled,true);assert.deepEqual(radio.calls,[]);
 const failed=await reconcile(a.value,radio,{isCurrent:()=>{throw Error('Owner replaced');}});assert(failed.pending);assert.deepEqual(radio.calls,[]);
});
test('cancelled late read is ignored and released without presenting installation success',async()=>{
 const a=attempt({begin:true,commit:true}),gate=defer(),started=defer(),abort=new AbortController();
 const radio=reader([lampSnapshot({version:'1.15.1'})],{onRead:async()=>{started.resolve();await gate.promise;}});
 const work=reconcile(a.value,radio,{signal:abort.signal});await started.promise;abort.abort();const result=await work;
 assert.equal(result.outcome,'unresolved');assert.equal(result.safeRetry,false);assert.equal(radio.calls.at(-1),'release');gate.resolve();
});
test('cancelled late acquisition is cleaned up once and cannot overlap a replacement check',async()=>{
 const a=attempt(),gate=defer(),entered=defer(),abort=new AbortController();let acquired=0,released=0;
 const acquire=async()=>{acquired++;entered.resolve();await gate.promise;return {lamp:{identity:id,readFirmwareUpdateSnapshot:async()=>lampSnapshot()},release:async()=>released++};};
 const work=reconcileFirmwareAttempt({attempt:a.value,acquire,signal:abort.signal,timeoutMs:100});await entered.promise;abort.abort();await work;
 const replacement=reconcileFirmwareAttempt({attempt:a.value,acquire,timeoutMs:100});await new Promise(resolve=>setTimeout(resolve,2));assert.equal(acquired,1);
 gate.resolve();await replacement;assert.equal(released,2);assert.equal(acquired,2);
});
test('stale reconciliation cannot clear a fence after a new safety boundary',async()=>{
 const a=attempt({begin:true}),result=await reconcile(a.value,reader([lampSnapshot()]));
 a.journal.beforeWrite(a.token,3,9);assert.throws(()=>a.journal.settle(a.token,result),error=>error.stale);assert.equal(a.journal.pending().length,1);
});
test('forged terminal outcomes, newer versions and unsafe flags cannot clear a pending record',()=>{
 const a=attempt({begin:true,commit:true});
 for(const result of [{outcome:'installationNotStarted',installedVersion:'1.13.0',controlResponsive:true,receiverInactive:true},
  {outcome:'installed',installedVersion:'1.16.0',controlResponsive:true,receiverInactive:true},
  {outcome:'installed',installedVersion:'1.15.1',controlResponsive:false,receiverInactive:true}])
  assert.throws(()=>a.journal.settle(a.token,{identity:id,attemptId:a.value.attemptId,safetyVersion:a.value.safetyVersion,...result}),error=>error.requiresReconciliation);
 assert.equal(a.journal.pending().length,1);
});
test('worker configuration and malformed future attempts are rejected before acquisition',async()=>{
 const a=attempt(),radio=reader([lampSnapshot()]);
 for(const options of [{maxAttempts:4},{timeoutMs:45001},{attempt:{...a.value,text:a.value.text.replace('esp32c3','future-chip')}},{now:()=>NaN}])
  await assert.rejects(reconcile(a.value,radio,options));assert.deepEqual(radio.calls,[]);
});
test('zero-mutation abandonment is durable and claims only that this attempt sent nothing',()=>{
 const a=attempt(),saved=a.journal.abandonUnstarted(a.token);
 assert.equal(saved.message,'Nothing was sent to your lamp.');assert.equal(saved.safeExplicitRetry,true);
 assert.equal(a.journal.pending().length,0);assert.equal(new FirmwareAttemptJournal(a.memory).get(id).outcome,'installationNotStarted');
 assert.equal(a.journal.begin(id,manifest()).outcome,'pending');
});
test('metadata, Wifi Check, Begin, Commit, Install and Cancel each prevent local abandonment',()=>{
 for(const kind of ['metadata','check','begin','commit','install','cancel']){
  const a=attempt({begin:kind==='begin'||kind==='commit',commit:kind==='commit'});
  if(kind==='metadata')a.journal.beforeWrite(a.token,1,9);
  if(kind==='check')a.journal.beforeWifi(a.token,'/api/firmware/check');
  if(kind==='install')a.journal.beforeWifi(a.token,'/api/firmware/install');
  if(kind==='cancel')a.journal.beforeWrite(a.token,5,9);
  assert.throws(()=>a.journal.abandonUnstarted(a.token),error=>error.requiresReconciliation);assert.equal(a.journal.pending().length,1);
 }
});
test('abandonment persistence failure keeps the pending fence',()=>{
 const a=attempt();a.memory.fail(true);assert.throws(()=>a.journal.abandonUnstarted(a.token),error=>error.journalFailure);
 assert.equal(a.journal.pending().length,1);assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,1);
});
test('the exported classifier requires a fresh timestamp and rejects stale/future/cached snapshots',()=>{
 const a=attempt({begin:true,commit:true}),observed=lampSnapshot({version:'1.15.1'});
 for(const stamp of [undefined,4000,10001,NaN]){
  const result=classifyFirmwareSnapshot(a.value,{...observed,observedAt:stamp},{now:()=>10000});
  assert.equal(result.outcome,'unresolved');assert.equal(result.staleSnapshot,true);assert.equal(result.controlResponsive,false);
 }
 const fresh=classifyFirmwareSnapshot(a.value,{...observed,observedAt:5000},{now:()=>10000});assert.equal(fresh.outcome,'installed');
 a.journal.settle(a.token,fresh);assert.equal(a.journal.pending().length,0);
});
test('metadata-only and Wifi Check attempts require read-only proof before a new explicit attempt',async()=>{
 for(const kind of ['metadata','wifi']){
  const a=attempt();if(kind==='metadata')a.journal.beforeWrite(a.token,1,9);else a.journal.beforeWifi(a.token,'/api/firmware/check');
  const checked=await reconcile(a.value,reader([lampSnapshot()]));assert.equal(checked.outcome,'installationNotStarted');
  a.journal.settle(a.token,checked);assert.equal(a.journal.pending().length,0);
 }
});
test('only resolved records may make capacity for another approved target',async()=>{
 const memory=storage(),journal=new FirmwareAttemptJournal(memory);
 for(let i=0;i<32;i++)journal.begin(i.toString(16).padStart(12,'0'),manifest());
 const first=journal.get('000000000000');journal.abandonUnstarted(first);journal.begin(id,manifest());
 assert.equal(journal.pending().length,32);assert.equal(journal.get('000000000000'),null);assert(journal.get('000000000001'));
});
test('the real deadline cancels a hung protected read and releases the lease without adopting its late success',async()=>{
 const a=attempt({begin:true,commit:true}),gate=defer(),calls=[];
 const started=performance.now();const result=await reconcileFirmwareAttempt({attempt:a.value,timeoutMs:15,acquire:async()=>({
  lamp:{identity:id,readFirmwareUpdateSnapshot:async()=>{calls.push('read');await gate.promise;return lampSnapshot({version:'1.15.1'});}},
  release:async()=>calls.push('release')})});
 assert.equal(result.outcome,'unresolved');assert.equal(result.timedOut,true);assert(performance.now()-started<500);
 assert.deepEqual(calls,['read','release']);gate.resolve();
});
test('a pending native cleanup fences the next reconnect until the old close actually settles',async()=>{
 const a=attempt({begin:true,commit:true}),close=defer();let acquisitions=0;
 const acquire=async()=>{acquisitions++;return {lamp:{identity:id,readFirmwareUpdateSnapshot:async()=>lampSnapshot({version:'1.15.1'})},release:async()=>close.promise};};
 const first=await reconcileFirmwareAttempt({attempt:a.value,acquire,timeoutMs:15});assert.equal(first.cleanupPending,true);assert.equal(first.outcome,'unresolved');
 const blocked=await reconcileFirmwareAttempt({attempt:a.value,acquire,timeoutMs:15});assert.equal(blocked.outcome,'unresolved');assert.equal(acquisitions,1);
 close.resolve();await new Promise(resolve=>setTimeout(resolve,0));
 const next=await reconcileFirmwareAttempt({attempt:a.value,acquire,timeoutMs:50});assert.equal(next.outcome,'installed');assert.equal(acquisitions,2);
});
test('cleanup failure never hides an explicitly wrong target identity',async()=>{
 const a=attempt(),radio=reader([lampSnapshot()],{identity:other,onRelease:()=>{throw Error('Close failed');}});
 await assert.rejects(reconcile(a.value,radio),error=>error.identity);assert.equal(radio.calls.at(-1),'release');
});
test('contradictory Restarting or committed receiver snapshots cannot guess progress or finish proof',()=>{
 const a=attempt({begin:true,commit:true});
 for(const receiver of [{phase:4,session:9,size:512,offset:100,committed:true},
  {phase:4,session:9,size:512,offset:512,committed:false},{phase:4,session:9,size:0,offset:0,committed:true},
  {phase:2,session:9,size:512,offset:512,committed:true}])
  assert.throws(()=>classifyFirmwareSnapshot(a.value,{...lampSnapshot({phase:4,receiver}),observedAt:Date.now()}),error=>error.invalidRead);
});
test('same-version repair stays pending after an unacknowledged Commit or uncertain Wifi Install',async()=>{
 for(const flags of [{begin:true,commit:true,reinstall:true},{wifi:true,reinstall:true}]){
  const a=attempt(flags),result=await reconcile(a.value,reader([lampSnapshot({version:'1.15.1'})]));
  assert.equal(result.outcome,'unresolved');assert.equal(result.safeRetry,false);a.journal.settle(a.token,result);
  assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,1);
 }
});
test('fresh protected inactive state confirms a zero-frame same-version repair did not start after a connection failure',async()=>{
 const a=attempt({reinstall:true});let acquisitions=0;
 const radio=reader([lampSnapshot({version:'1.15.1'})],{onAcquire:()=>{if(++acquisitions===1)throw Error('Disconnected before sending');}});
 const result=await reconcile(a.value,radio);assert.equal(result.outcome,'installationNotStarted');assert.equal(result.safeExplicitRetry,true);
 assert.equal(result.installedVersion,'1.15.1');assert.equal(result.controlResponsive,true);assert.equal(result.receiverInactive,true);
 assert.equal(result.attempts,2);assert.equal(result.reads,1);assert.equal(a.value.metadataIssued,false);assert.equal(a.value.commitAttempted,false);
 a.journal.settle(a.token,result);assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,0);
 const next=a.journal.begin(id,manifest(),{reinstall:true});assert.notEqual(next.attemptId,a.token.attemptId);
});
test('fresh protected inactive same-version state confirms a pre-Commit cancelled repair transfer stopped',async()=>{
 const a=attempt({begin:true,reinstall:true});a.journal.beforeWrite(a.token,{operation:3,session:9});a.journal.noteProgress(a.token,{offset:128});
 a.journal.beforeWrite(a.token,{operation:5,session:9});
 const result=await reconcile(a.value,reader([lampSnapshot({version:'1.15.1'})]));assert.equal(result.outcome,'transferStopped');assert.equal(result.safeRetry,true);
 assert.equal(result.pending,false);assert.equal(a.value.commitAttempted,false);a.journal.settle(a.token,result);
 assert.equal(new FirmwareAttemptJournal(a.memory).get(id).outcome,'transferStopped');
});
test('same-version repair safe-stop proof rejects stale, malformed or active snapshots and cannot bypass an uncertain Commit',async()=>{
 for(const flags of [{reinstall:true},{begin:true,reinstall:true}]){
  const a=attempt(flags);
  const malformed={...lampSnapshot({version:'1.15.1'}),receiver:{phase:0,error:0,committed:true,session:0,size:0,offset:0}};
  const invalid=await reconcile(a.value,reader([malformed]));assert.equal(invalid.outcome,'unresolved');assert.equal(invalid.safeRetry,false);
  const stale=await reconcile(a.value,reader([{...lampSnapshot({version:'1.15.1'}),observedAt:Date.now()-10000}]));
  assert.equal(stale.outcome,'unresolved');assert.equal(stale.safeExplicitRetry,false);
  const foreign=await reconcile(a.value,reader([lampSnapshot({version:'1.15.1',receiver:{phase:2,session:99,size:512,offset:100}})]));
  assert.equal(foreign.outcome,'unresolved');assert.equal(foreign.safeRetry,false);assert.equal(a.journal.pending().length,1);
 }
 const committed=attempt({begin:true,commit:true,reinstall:true});
 assert.throws(()=>committed.journal.settle(committed.token,{identity:id,attemptId:committed.value.attemptId,safetyVersion:committed.value.safetyVersion,
  outcome:'transferStopped',installedVersion:'1.15.1',controlResponsive:true,receiverInactive:true}),error=>error.requiresReconciliation);
 assert.equal(committed.journal.pending().length,1);
});
test('matched final receipt persists before a same-version repair can reconcile its restart',async()=>{
 const a=attempt({begin:true,reinstall:true});a.journal.beforeWrite(a.token,{operation:4,session:9,sequence:44});
 const receipt=Object.freeze({session:9,size:512,offset:512,phase:4,error:0,committed:true,ack:44});
 const saved=a.journal.confirmCommit(a.token,receipt);assert.equal(saved.commitAcknowledged,true);
 const reloaded=new FirmwareAttemptJournal(a.memory),value=reloaded.get(id);assert.equal(value.reinstall,true);assert.equal(value.commitAcknowledged,true);
 const result=await reconcile(value,reader([lampSnapshot({version:'1.15.1'})]));assert.equal(result.outcome,'installed');
 assert.equal(result.artifactDigestVerified,false);reloaded.settle(value,result);assert.equal(reloaded.pending().length,0);
});
test('missing, foreign, incomplete, wrong-phase or wrong-sequence receipts cannot confirm a repair',()=>{
 const a=attempt({begin:true,reinstall:true});a.journal.beforeWrite(a.token,{operation:4,session:9,sequence:44});
 const valid={session:9,size:512,offset:512,phase:4,error:0,committed:true,ack:44};
 for(const changed of [null,{...valid,session:10},{...valid,size:513},{...valid,offset:511},{...valid,phase:3},
  {...valid,committed:false},{...valid,error:5},{...valid,ack:43}])
  assert.throws(()=>a.journal.confirmCommit(a.token,changed),error=>error.requiresReconciliation);
 assert.equal(a.value.commitAcknowledged,false);assert.equal(a.journal.pending().length,1);
 const beforeCommit=attempt({begin:true});assert.throws(()=>beforeCommit.journal.confirmCommit(beforeCommit.token,valid),error=>error.requiresReconciliation);
});
test('confirmation storage failure preserves the repair fence and never claims no firmware was sent',()=>{
 const a=attempt({begin:true,commit:true,reinstall:true});a.memory.fail(true);
 assert.throws(()=>a.journal.confirmCommit(a.token,{session:9,size:512,offset:512,phase:4,error:0,committed:true,ack:44}),
  error=>error.journalFailure&&error.commitAcknowledged&&error.beforeMutation===false&&/lamp confirmed/.test(error.message));
 assert.equal(a.value.commitAcknowledged,false);assert.equal(new FirmwareAttemptJournal(a.memory).pending().length,1);
});
test('duplicate matched confirmation is idempotent and older v1 records default repair proof flags false',()=>{
 const a=attempt({begin:true,commit:true,reinstall:true}),receipt={session:9,size:512,offset:512,phase:4,error:0,committed:true,ack:44};
 a.journal.confirmCommit(a.token,receipt);const writes=a.memory.writes.length;a.journal.confirmCommit(a.token,receipt);assert.equal(a.memory.writes.length,writes);
 const raw=JSON.parse(a.memory.getItem(FIRMWARE_ATTEMPT_KEY));delete raw.records[0].reinstall;delete raw.records[0].commitAcknowledged;delete raw.records[0].commitSequence;
 a.memory.data.set(FIRMWARE_ATTEMPT_KEY,JSON.stringify(raw));const restored=new FirmwareAttemptJournal(a.memory).get(id);
 assert.equal(restored.reinstall,false);assert.equal(restored.commitAcknowledged,false);
});
test('direct settle cannot invent acknowledged completion of a same-version repair',()=>{
 const a=attempt({begin:true,commit:true,reinstall:true});
 assert.throws(()=>a.journal.settle(a.token,{identity:id,attemptId:a.value.attemptId,safetyVersion:a.value.safetyVersion,
  outcome:'installed',installedVersion:'1.15.1',controlResponsive:true,receiverInactive:true}),error=>error.requiresReconciliation);
 assert.equal(a.journal.pending().length,1);
});

const oldReceipt=(outcome='verified-restarting')=>Object.freeze({identity:id,targetVersion:'1.15.1',outcome});
const reconcileOld=(receipt,radio,options={})=>reconcileLegacyFirmwareReceipt({receipt,acquire:radio.acquire,now:radio.now,delay:radio.delay,...options});

test('an old explicit final receipt can confirm only fresh protected version and responsive inactive control',async()=>{
 let acquired;const radio=reader([lampSnapshot({version:'1.15.1'})],{onAcquire:value=>{acquired=value;}});
 const result=await reconcileOld({...oldReceipt(),sha256:'invented',text:'invented',session:99,password:'secret'},radio);
 assert.equal(result.outcome,'installed');assert.equal(result.pending,false);assert.equal(result.safeRetry,false);
 assert.equal(result.verification,'installed-version-and-protected-control');assert.equal(result.artifactDigestVerified,false);assert.equal(result.bootHealthVerified,false);
 assert.deepEqual(acquired,{identity:id,targetVersion:'1.15.1',outcome:'verified-restarting'});assert(Object.isFrozen(acquired));
 for(const value of [acquired,result])for(const field of ['sha256','text','session','size','attemptId','password'])assert(!(field in value));
 assert.deepEqual(radio.calls,['acquire','snapshot','release']);
});
test('an old lost final receipt remains pending even when the running version equals its target',async()=>{
 const radio=reader([lampSnapshot({version:'1.15.1'})]),result=await reconcileOld(oldReceipt('verification-required'),radio);
 assert.equal(result.outcome,'unresolved');assert.equal(result.pending,true);assert.equal(result.safeExplicitRetry,false);
 assert.equal(result.installedVersion,'1.15.1');assert.equal(result.controlResponsive,true);assert.equal(result.receiverInactive,true);
});
test('old or different running versions never clear either kind of old update fence',async()=>{
 for(const outcome of ['verified-restarting','verification-required'])for(const version of ['1.13.0','1.16.0']){
  const result=await reconcileOld(oldReceipt(outcome),reader([lampSnapshot({version})]));
  assert.equal(result.outcome,'unresolved');assert.equal(result.pending,true);assert.equal(result.safeRetry,false);
 }
});
test('a legacy receipt checks target identity in both its protected connection and returned snapshot',async()=>{
 for(const radio of [reader([lampSnapshot()],{identity:other}),reader([lampSnapshot({identity:other})])]){
  await assert.rejects(reconcileOld(oldReceipt(),radio),error=>error.identity);assert.equal(radio.calls.at(-1),'release');
 }
});
test('legacy receipts cannot manufacture target identity or artifact authority from unsupported feedback',async()=>{
 let acquisitions=0;
 for(const receipt of [null,{id:'ble:unknown',targetVersion:'1.15.1',outcome:'verified-restarting'},
  {...oldReceipt(),id:other},{...oldReceipt(),outcome:'installed'},{...oldReceipt(),targetVersion:'bad'}])
  await assert.rejects(reconcileLegacyFirmwareReceipt({receipt,acquire:async()=>{acquisitions++;}}),error=>error.invalidReceipt);
 assert.equal(acquisitions,0);
 const result=await reconcileOld({id,targetVersion:'1.15.1',outcome:'verified-restarting'},reader([lampSnapshot({version:'1.15.1'})]));
 assert.equal(result.identity,id);assert.equal(result.outcome,'installed');
});
test('legacy reconciliation has the same three-acquisition failure bound and always releases its leases',async()=>{
 const radio=reader([lampSnapshot()],{onRead:()=>{throw Error('Not connected');}}),result=await reconcileOld(oldReceipt(),radio);
 assert.equal(result.outcome,'unresolved');assert.equal(result.attempts,3);assert.equal(result.reads,3);
 assert.equal(radio.calls.filter(value=>value==='acquire').length,3);assert.equal(radio.calls.filter(value=>value==='release').length,3);
});
test('legacy busy reads observe bounded status without guessing which session or bytes belong to the old attempt',async()=>{
 const radio=reader([lampSnapshot({version:'1.13.0',phase:3,receiver:{phase:2,session:100,size:512,offset:200}})]);
 const progress=[],result=await reconcileOld(oldReceipt(),radio,{onProgress:value=>progress.push(value)});
 assert.equal(result.outcome,'unresolved');assert.equal(result.pending,true);assert.equal(result.timedOut,true);
 assert(result.reads<=24);assert(radio.now()<=45000);assert.equal(result.attempts,1);
 assert(!('offset' in result));assert(!('progress' in result));assert(progress.every(value=>value.offset===undefined&&value.progress===undefined));
});
test('an old explicit receipt waits through observed restart before its narrow installed proof',async()=>{
 const radio=reader([lampSnapshot({version:'1.13.0',phase:4,receiver:{phase:4,session:100,size:512,offset:512,committed:true}}),lampSnapshot({version:'1.15.1'})]);
 const result=await reconcileOld(oldReceipt(),radio);assert.equal(result.outcome,'installed');assert.equal(result.reads,2);
 assert.deepEqual(radio.calls,['acquire','snapshot','snapshot','release']);
});
test('stale or malformed protected legacy snapshots never clear an old receipt',async()=>{
 const stale={...lampSnapshot({version:'1.15.1'}),observedAt:Date.now()-10000};
 const staleResult=await reconcileOld(oldReceipt(),reader([stale]));assert.equal(staleResult.outcome,'unresolved');assert.equal(staleResult.staleSnapshot,true);
 const malformed={...lampSnapshot({version:'1.15.1'}),state:{mode:0}};
 const badResult=await reconcileOld(oldReceipt(),reader([malformed]));assert.equal(badResult.outcome,'unresolved');assert.equal(badResult.reads,3);
});
test('legacy cancellation discards late protected success and performs no mutation',async()=>{
 const signal=new AbortController(),gate=defer(),started=defer(),radio=reader([lampSnapshot({version:'1.15.1'})],{onRead:()=>{started.resolve();return gate.promise;}});
 const run=reconcileOld(oldReceipt(),radio,{signal:signal.signal});await started.promise;signal.abort();
 const result=await run;assert.equal(result.outcome,'unresolved');assert.equal(result.cancelled,true);assert.equal(radio.calls.at(-1),'release');
 gate.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(result.pending,true);
});
test('legacy and new-artifact workers share pending native cleanup and cannot reconnect over each other',async()=>{
 const close=defer(),radio=reader([lampSnapshot({version:'1.15.1'})],{onRelease:()=>close.promise});
 const legacy=await reconcileOld(oldReceipt(),radio,{timeoutMs:15});assert.equal(legacy.cleanupPending,true);assert.equal(legacy.outcome,'unresolved');
 const a=attempt({begin:true,commit:true}),modern=reader([lampSnapshot({version:'1.15.1'})]);
 const blocked=await reconcile(a.value,modern,{timeoutMs:15});assert.equal(blocked.outcome,'unresolved');assert.deepEqual(modern.calls,[]);
 close.resolve();await new Promise(resolve=>setTimeout(resolve,0));
 const verified=await reconcile(a.value,modern,{timeoutMs:50});assert.equal(verified.outcome,'installed');
});
