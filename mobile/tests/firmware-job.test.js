import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareFleet} from '../src/firmware-fleet.js';
import {FirmwareAttemptJournal,confirmedFirmwareJobRejection} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {updateCardFirmware} from '../src/card-firmware.js';

const id='aabbccddeeff',entry={id,address:'192.168.1.20',deviceId:'paired'};
const foreignJobId='b'.repeat(32);
const requestedJobId='c'.repeat(32);
const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.16.0\nesp32c3\ndual-ota-2031616\n512\n'+'a'.repeat(64)+'\n');
const jobRequest=()=>({jobId:requestedJobId,version:manifest.version,sha256:manifest.sha256});
const emptyJob=()=>({version:1,storageReady:true,jobId:'',target:'0.0.0',sha256:'',size:0,state:0,error:0,revision:0,terminal:false});
const reply=(data,status=200)=>({status,data:typeof data==='string'?data:JSON.stringify(data)});
const memory=()=>{const rows=new Map();return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};};

function fixture({losePostReply=false,postConflict=false,postState=1,aroundMutation,aroundJobStart,credential,jobContract=1,
 includeJobSnapshot=jobContract===1,legacyCheckResponse,onJobRejected,automatic=false,wrappedJobResponse=true,
 jobResponseDeviceId=id,jobResponseContract=1,omitResponseJob=false}={}){
 let installed='1.15.9',installedSize=512,installedSha='b'.repeat(64),installedHealthy=true,installedReceiving=false,job=emptyJob(),posts=0;
 const requests=[],journal=new FirmwareAttemptJournal(memory());
 const firmware=(compact=false)=>({version:installed,phase:[1,2,3,4].includes(job.state)?3:0,latest:'1.16.0',available:true,automatic,wifi:true,
  progress:job?.state===3?35:0,error:0,...(compact&&jobContract===1?{updateJobContractVersion:1}:{}),...(compact&&includeJobSnapshot?{updateJob:job}:{})});
 const jobReply=status=>reply(wrappedJobResponse?{deviceId:jobResponseDeviceId,...firmware(false),updateJobContractVersion:jobResponseContract,
  ...(!omitResponseJob?{updateJob:job}:{})}:job,status);
 const http={request:async options=>{
  requests.push(options);const url=new URL(options.url);
  if(url.pathname==='/api/diagnostics')return reply({deviceId:id,firmware:firmware(),uptimeMs:100000});
  if(url.pathname==='/api/state')return reply({deviceId:id,firmware:firmware(),token:'fixture-token',uptimeMs:100000});
  if(url.pathname==='/api/firmware'&&options.method==='GET')return reply({deviceId:id,...firmware(true)});
  if(url.pathname==='/api/firmware/job'&&options.method==='GET'){
   if(url.searchParams.get('jobId')!==job.jobId)return reply('Missing',404);
   return jobReply(200);
  }
  if(url.pathname==='/api/firmware/upload/status'&&options.method==='GET')return reply({deviceId:id,boot:'0000000000000001',
   version:installed,healthy:installedHealthy,receiving:installedReceiving,installedKnown:true,size:installedSize,sha256:installedSha});
  if(url.pathname==='/api/firmware/job'&&options.method==='POST'){
   ++posts;assert.equal(options.headers['X-Lamp-Token'],'fixture-token');
   const form=new URLSearchParams(options.data);assert.equal(form.get('version'),manifest.version);assert.equal(form.get('sha256'),manifest.sha256);
   if(postConflict)return reply('Conflict',409);
   const jobId=form.get('jobId');job={version:1,storageReady:true,jobId,target:manifest.version,sha256:manifest.sha256,size:0,state:postState,error:postState===6?3:0,revision:1,terminal:postState>=5};
   if(losePostReply)throw Error('reply lost');return jobReply(202);
  }
  if(url.pathname==='/api/firmware/check'&&options.method==='POST'&&legacyCheckResponse!==undefined)return legacyCheckResponse;
  assert.fail('Unexpected request '+options.method+' '+url.pathname);
 }};
 const saveRejection=async evidence=>{
  if(onJobRejected)return onJobRejected(evidence,journal);
  const attempt=journal.get(id),proof=confirmedFirmwareJobRejection(attempt,evidence);journal.settle(attempt,proof);return proof;
 };
 const fleet=new FirmwareFleet({http,credential:credential??(async()=>({value:'fixture-password'})),getLamps:()=>[entry],beforeMutation:({path})=>journal.beforeWifi(journal.get(id),path),aroundMutation,aroundJobStart,onJobRejected:saveRejection,
  now:()=>1000,sleep:async()=>{},requestTimeout:1000});
 return {fleet,journal,requests,get job(){return job;},replaceJob(value){job=value===undefined?undefined:{...value};},
  setInstalled(value){installed=value.version??installed;installedSize=value.size??installedSize;installedSha=value.sha256??installedSha;
   installedHealthy=value.healthy??installedHealthy;installedReceiving=value.receiving??installedReceiving;},
  setJob(value){job={...job,...value};if(job.state===5){installed=manifest.version;installedSize=manifest.size;installedSha=manifest.sha256;}},get posts(){return posts;}};
}

test('a capable lamp accepts one durable exact update job without a phone download or legacy mutation',async()=>{
 const f=fixture(),attempt=f.journal.begin(id,manifest),result=await updateCardFirmware({entry,manifest,attemptJournal:f.journal,attempt,
  wifi:(_entry,version)=>f.fleet.updateLamp(entry,version,{jobId:attempt.attemptId,version,sha256:manifest.sha256}),
  acquireBluetooth:()=>assert.fail('A lamp-owned job must not acquire Bluetooth.'),download:()=>assert.fail('A lamp-owned job must not download to the phone.')});
 assert.equal(result.outcome,'accepted');assert.equal(result.jobId,attempt.attemptId);assert.equal(result.durable,true);assert.equal(f.posts,1);
 const saved=f.journal.get(id);assert.equal(saved.wifiJobAttempted,true);assert.equal(saved.wifiInstallAttempted,true);assert.equal(f.journal.pending().length,1);
 assert.equal(f.requests.filter(value=>value.method==='GET'&&new URL(value.url).pathname==='/api/firmware').length,1);
 assert.deepEqual(f.requests.filter(value=>value.method==='POST').map(value=>new URL(value.url).pathname),['/api/firmware/job']);
});

test('raw durable-job responses remain compatible with the original endpoint shape',async()=>{
 const f=fixture({wrappedJobResponse:false}),attempt=f.journal.begin(id,manifest);
 const accepted=await f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256});
 assert.equal(accepted.state,'accepted');assert.equal(accepted.updateJob.jobId,attempt.attemptId);assert.equal(f.posts,1);
 f.setJob({state:3,revision:2,size:manifest.size});
 const active=await f.fleet.reconcileJob(entry,f.journal.get(id));assert.equal(active.outcome,'active');assert.equal(active.wifiJobId,attempt.attemptId);
});

test('wrapped job responses require the exact lamp identity, contract and embedded snapshot',async()=>{
 for(const options of [{jobResponseDeviceId:'ffffffffffff'},{jobResponseContract:0},{omitResponseJob:true}]){
  const f=fixture(options),attempt=f.journal.begin(id,manifest);
  await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),
   error=>options.jobResponseDeviceId?error.identity===true:error.invalidRead===true);
  assert.equal(f.posts,1);
 }
});

test('wrapped reconciliation rejects a foreign lamp response without replaying the saved job',async()=>{
 const f=fixture({losePostReply:true,jobResponseDeviceId:'ffffffffffff'}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.uncertain===true);
 await assert.rejects(f.fleet.reconcileJob(entry,f.journal.get(id)),error=>error.identity===true);
 assert.equal(f.posts,1);
});

test('a lost acceptance reply is never replayed and the exact durable job reconciles after foreground return',async()=>{
 const f=fixture({losePostReply:true}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.uncertain===true);
 assert.equal(f.posts,1);assert.equal(f.journal.get(id).wifiJobAttempted,true);
 f.setJob({state:3,revision:2,size:manifest.size});const active=await f.fleet.reconcileJob(entry,f.journal.get(id));assert.equal(active.outcome,'active');assert.equal(active.wifiJobId,attempt.attemptId);assert.equal(f.posts,1);
 f.setJob({state:5,terminal:true,revision:3,size:manifest.size});const installed=await f.fleet.reconcileJob(entry,f.journal.get(id));assert.equal(installed.outcome,'installed');
 f.journal.settle(f.journal.get(id),installed);assert.equal(f.journal.pending().length,0);assert.equal(f.posts,1);
});

test('the card updater reconciles a lost job acknowledgment by exact job GET and never opens Bluetooth',async()=>{
 const f=fixture({losePostReply:true}),attempt=f.journal.begin(id,manifest);
 const result=await updateCardFirmware({entry,manifest,attemptJournal:f.journal,attempt,
  wifi:(_entry,version)=>f.fleet.updateLamp(entry,version,{jobId:attempt.attemptId,version,sha256:manifest.sha256}),
  reconcileWifiJob:value=>f.fleet.reconcileJob(entry,value),
  reconcile:()=>assert.fail('A durable Wi-Fi job must not use Bluetooth reconciliation.'),
  acquireBluetooth:()=>assert.fail('A durable Wi-Fi job must not acquire Bluetooth.'),
  download:()=>assert.fail('A durable Wi-Fi job must not download to the phone.')});
 assert.equal(result.outcome,'active');assert.equal(result.path,'wifi');assert.equal(result.wifiJobId,attempt.attemptId);
 assert.equal(f.posts,1);assert.equal(f.journal.pending().length,1);
 assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
 assert.equal(f.requests.filter(value=>value.method==='GET'&&new URL(value.url).pathname==='/api/firmware/job').length,1);
});

test('a lost job reply followed by exact GET 404 remains unresolved and is never replayed',async()=>{
 const f=fixture({losePostReply:true}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.uncertain===true);
 f.replaceJob(emptyJob());
 await assert.rejects(f.fleet.reconcileJob(entry,f.journal.get(id)),error=>error.requiresReconciliation===true&&error.jobMissing===true);
 assert.equal(f.posts,1);assert.equal(f.journal.pending().length,1);assert.equal(f.journal.get(id).outcome,'pending');
 assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
});

test('a replaced terminal job settles only from the exact healthy installed manifest',async()=>{
 const f=fixture({losePostReply:true}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.uncertain===true);
 f.replaceJob(emptyJob());f.setInstalled({version:manifest.version,size:manifest.size,sha256:manifest.sha256,healthy:true,receiving:false});
 const installed=await f.fleet.reconcileJob(entry,f.journal.get(id));
 assert.equal(installed.outcome,'installed');assert.equal(installed.installedManifestVerified,true);assert.equal(installed.installedVersion,manifest.version);
 f.journal.settle(f.journal.get(id),installed);assert.equal(f.journal.pending().length,0);assert.equal(f.posts,1);
 assert.deepEqual(f.requests.filter(value=>value.method==='GET').map(value=>new URL(value.url).pathname).slice(-2),
  ['/api/firmware/job','/api/firmware/upload/status']);
});

test('same installed version with the wrong digest never settles a missing exact job',async()=>{
 const f=fixture({losePostReply:true}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.uncertain===true);
 f.replaceJob(emptyJob());f.setInstalled({version:manifest.version,size:manifest.size,sha256:'c'.repeat(64),healthy:true,receiving:false});
 await assert.rejects(f.fleet.reconcileJob(entry,f.journal.get(id)),error=>error.requiresReconciliation===true&&error.jobMissing===true);
 assert.equal(f.journal.pending().length,1);assert.equal(f.journal.get(id).outcome,'pending');assert.equal(f.posts,1);
});

test('the brief mutation lease encloses durable intent and the one job POST',async()=>{
 const events=[];let active=false;
 const f=fixture({aroundMutation:async(context,operation)=>{
  assert.equal(context.path,'/api/firmware/job');events.push('begin');active=true;
  try{return await operation();}finally{active=false;events.push('end');}
 }});
 const original=f.fleet.beforeMutation;f.fleet.beforeMutation=value=>{assert.equal(active,true);events.push('journal');return original(value);};
 const request=f.fleet.http.request;f.fleet.http.request=options=>{if(options.method==='POST'){assert.equal(active,true);events.push('post');}return request(options);};
 const attempt=f.journal.begin(id,manifest);
 await f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256});
 assert.deepEqual(events,['begin','journal','post','end']);
});

test('the job handoff starts before credential access and legacy software is refused before any mutation',async()=>{
 let releaseCredential,credentialStarted;const credentialGate=new Promise(resolve=>releaseCredential=resolve),started=new Promise(resolve=>credentialStarted=resolve);
 const events=[];let active=false;
 const aroundJobStart=async(_context,operation)=>{events.push('begin');active=true;try{return await operation();}finally{active=false;events.push('end');}};
 const f=fixture({aroundJobStart,credential:async()=>{assert.equal(active,true);events.push('credential');credentialStarted();await credentialGate;return {value:'fixture-password'};}});
 const attempt=f.journal.begin(id,manifest),pending=f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256});
 await started;assert.deepEqual(events,['begin','credential']);releaseCredential();await pending;assert.deepEqual(events.slice(-1),['end']);
 assert.deepEqual(f.requests.filter(value=>value.method==='GET').map(value=>new URL(value.url).pathname),['/api/diagnostics','/api/firmware','/api/state']);

 const legacyEvents=[];active=false;
 const legacy=fixture({jobContract:0,aroundJobStart:async(_context,operation)=>{
  legacyEvents.push('begin');active=true;try{return await operation();}finally{active=false;legacyEvents.push('end');}
 }});
 const legacyAttempt=legacy.journal.begin(id,manifest);
 await assert.rejects(legacy.fleet.updateLamp(entry,manifest.version,{jobId:legacyAttempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>
  error.safeBluetoothFallback===true&&error.phoneTransferRequired===true);
 assert.deepEqual(legacyEvents,['begin','end']);assert.equal(legacy.posts,0);
 assert.deepEqual(legacy.requests.filter(value=>value.method==='GET').map(value=>new URL(value.url).pathname),['/api/diagnostics','/api/firmware']);
 assert.equal(legacy.requests.some(value=>value.method==='POST'),false);
 const saved=legacy.journal.get(id);assert.equal(saved.wifiCheckAttempted,false);assert.equal(saved.wifiInstallAttempted,false);assert.equal(saved.wifiJobAttempted,false);
});

test('the card updater turns a legacy job refusal into an explicit phone-only choice without sending anything',async()=>{
 const f=fixture({jobContract:0}),attempt=f.journal.begin(id,manifest);let downloadCalled=false,bluetoothCalled=false;
 await assert.rejects(updateCardFirmware({entry,manifest,attemptJournal:f.journal,attempt,phoneFallbackAvailable:true,
  wifi:(_entry,version)=>f.fleet.updateLamp(entry,version,{jobId:attempt.attemptId,version,sha256:manifest.sha256}),
  acquireBluetooth:()=>{bluetoothCalled=true;assert.fail('Consent is required before acquiring Bluetooth.');},
  download:()=>{downloadCalled=true;assert.fail('Consent is required before downloading to the phone.');}}),error=>{
   assert.equal(error.phoneTransferRequired,true);assert.equal(error.confirmed,true);assert.equal(error.uncertain,false);
   assert.equal(error.installationNotStarted,true);assert.equal(error.safeBluetoothFallback,false);
   assert.equal(error.phoneFallbackAvailable,true);assert.equal(error.directInternetRetryAvailable,false);
   assert.equal(error.fallbackRequiresConsent,true);assert.equal(error.failedPath,'wifi');return true;
  });
 assert.equal(downloadCalled,false);assert.equal(bluetoothCalled,false);assert.equal(f.posts,0);
 assert.equal(f.requests.some(value=>value.method==='POST'),false);
 const saved=f.journal.get(id);assert.equal(saved.outcome,'pending');assert.equal(saved.wifiCheckAttempted,false);
 assert.equal(saved.wifiInstallAttempted,false);assert.equal(saved.wifiJobAttempted,false);
});

test('an already-updated legacy lamp returns ready before the phone-only fallback and sends no mutation',async()=>{
 const f=fixture({jobContract:0});f.setInstalled({version:manifest.version});const attempt=f.journal.begin(id,manifest);
 const result=await f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256});
 assert.equal(result.state,'ready');assert.equal(result.installedVersion,manifest.version);assert.match(result.message,/Already up to date/);
 assert.equal(f.posts,0);assert.equal(f.requests.some(value=>value.method==='POST'),false);
 assert.deepEqual(f.requests.filter(value=>value.method==='GET').map(value=>new URL(value.url).pathname),['/api/diagnostics','/api/diagnostics','/api/firmware']);
 const saved=f.journal.get(id);assert.equal(saved.wifiCheckAttempted,false);assert.equal(saved.wifiInstallAttempted,false);assert.equal(saved.wifiJobAttempted,false);
});

test('bulk updates hand capable lamps off as independent durable jobs',async()=>{
 const events=[],f=fixture({aroundJobStart:async({identity,job},operation)=>{
  events.push(['begin',identity,job.jobId]);try{return await operation();}finally{events.push(['end',identity,job.jobId]);}
 }});
 let attempt;
 const result=await f.fleet.updateAll(manifest.version,{jobFor:(target,version)=>{
  assert.equal(target.id,id);assert.equal(version,manifest.version);attempt=f.journal.begin(target.id,manifest);
  return {jobId:attempt.attemptId,version,sha256:manifest.sha256};
 }});
 assert.equal(result.results[0].state,'accepted');assert.equal(result.results[0].durable,true);assert.equal(f.posts,1);
 assert.deepEqual(f.requests.filter(value=>value.method==='POST').map(value=>new URL(value.url).pathname),['/api/firmware/job']);
 assert.deepEqual(events,[['begin',id,attempt.attemptId],['end',id,attempt.attemptId]]);
});

test('empty and storage-unavailable sentinels are accepted only with exact state invariants',async()=>{
 const f=fixture({automatic:true});
 let refreshed=await f.fleet.refresh();assert.equal(refreshed.results[0].state,'ready');
 f.replaceJob({version:1,storageReady:false,jobId:'',target:'0.0.0',sha256:'',size:0,state:7,error:0,revision:0,terminal:true});
 refreshed=await f.fleet.refresh();assert.equal(refreshed.results[0].state,'ready');
 f.replaceJob({version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:1,error:0,revision:1,terminal:true});
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,jobRequest()),/state/i);assert.equal(f.posts,0);
});

test('the advertised job contract rejects missing, legacy-only and contradictory snapshots',async()=>{
 for(const f of [
  fixture({jobContract:1,includeJobSnapshot:false,automatic:true}),
  fixture({jobContract:0,includeJobSnapshot:true,automatic:true})
 ]){
  await assert.rejects(f.fleet.updateLamp(entry,manifest.version,jobRequest()),/capability/i);assert.equal(f.posts,0);
 }
 for(const value of [
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:1,error:0,revision:0,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:1,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:2,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:3,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:4,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:5,error:0,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:1,state:1,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:1,error:3,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:5,error:3,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:6,error:0,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:7,error:3,revision:1,terminal:true}
 ]){
   const f=fixture({automatic:true});f.replaceJob(value);
   await assert.rejects(f.fleet.updateLamp(entry,manifest.version,jobRequest()),/state/i);assert.equal(f.posts,0);
 }
 const high=fixture({automatic:true});high.replaceJob({version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,
  size:0,state:1,error:0,revision:0xffffffff,terminal:false});
 const refreshed=await high.fleet.refresh();assert.notEqual(refreshed.results[0].state,'failed');
 for(const value of [
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:0,state:6,error:3,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:6,error:3,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:3,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:4,error:0,revision:1,terminal:false},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:5,error:0,revision:1,terminal:true},
  {version:1,storageReady:true,jobId:foreignJobId,target:manifest.version,sha256:manifest.sha256,size:288,state:7,error:0,revision:1,terminal:true}
 ]){
   const f=fixture({automatic:true});f.replaceJob(value);const accepted=await f.fleet.refresh();assert.notEqual(accepted.results[0].state,'failed');
 }
});

test('durable firmware jobs require exactly 32 lowercase hexadecimal characters before any request',async()=>{
 for(const jobId of ['abcdefgh','A'.repeat(32),'a'.repeat(31),'a'.repeat(33),'g'.repeat(32)]){
  const f=fixture();
  await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId,version:manifest.version,sha256:manifest.sha256}),/invalid/i);
  assert.equal(f.requests.length,0);
 }
});

test('a confirmed foreign-job conflict settles this rejected tuple without replay or Bluetooth',async()=>{
 const events=[];let active=false;
 const f=fixture({postConflict:true,aroundJobStart:async(_context,operation)=>{events.push('begin');active=true;try{return await operation();}finally{active=false;events.push('end');}},
  onJobRejected:(evidence,journal)=>{assert.equal(active,true);events.push('settle');const attempt=journal.get(id),proof=confirmedFirmwareJobRejection(attempt,evidence);journal.settle(attempt,proof);return proof;}}),attempt=f.journal.begin(id,manifest);
 const result=await updateCardFirmware({entry,manifest,attemptJournal:f.journal,attempt,
  wifi:(_entry,version)=>f.fleet.updateLamp(entry,version,{jobId:attempt.attemptId,version,sha256:manifest.sha256}),
  reconcileWifiJob:()=>assert.fail('A confirmed 409 rejection needs no speculative GET.'),
  reconcile:()=>assert.fail('A rejected Wi-Fi job must not use Bluetooth reconciliation.'),
  acquireBluetooth:()=>assert.fail('A rejected Wi-Fi job must not acquire Bluetooth.'),
  download:()=>assert.fail('A rejected Wi-Fi job must not download to the phone.')});
 assert.equal(result.outcome,'installationNotStarted');assert.equal(result.wifiJobRejected,true);assert.equal(result.wifiJobStatus,409);
 assert.equal(f.posts,1);assert.equal(f.journal.pending().length,0);assert.equal(f.journal.get(id).outcome,'installationNotStarted');
 assert.equal(f.requests.filter(value=>value.method==='POST').length,1);
 assert.equal(f.requests.filter(value=>value.method==='GET'&&new URL(value.url).pathname==='/api/firmware/job').length,0);
 assert.deepEqual(events,['begin','settle','end']);
});

test('bulk conflict persists exact rejection before handoff end and leaves no local fence',async()=>{
 const events=[];let active=false;
 const f=fixture({postConflict:true,aroundJobStart:async(_context,operation)=>{events.push('begin');active=true;try{return await operation();}finally{active=false;events.push('end');}},
  onJobRejected:(evidence,journal)=>{assert.equal(active,true);events.push('settle');const attempt=journal.get(id),proof=confirmedFirmwareJobRejection(attempt,evidence);journal.settle(attempt,proof);return proof;}});
 let attempt;const result=await f.fleet.updateAll(manifest.version,{jobFor:target=>{
  attempt=f.journal.begin(target.id,manifest);return {jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256};
 }});
 assert.equal(result.results[0].state,'rejected');assert.equal(result.results[0].wifiJobRejected,true);
 assert.equal(f.posts,1);assert.equal(f.journal.pending().length,0);assert.equal(f.journal.get(id).outcome,'installationNotStarted');
 assert.equal(f.requests.filter(value=>value.method==='GET'&&new URL(value.url).pathname==='/api/firmware/job').length,0);
 assert.deepEqual(events,['begin','settle','end']);
});

test('a terminal POST snapshot is never presented as newly accepted',async()=>{
 const f=fixture({postState:6}),attempt=f.journal.begin(id,manifest);
 await assert.rejects(f.fleet.updateLamp(entry,manifest.version,{jobId:attempt.attemptId,version:manifest.version,sha256:manifest.sha256}),error=>error.requiresReconciliation===true);
 assert.equal(f.posts,1);assert.equal(f.journal.get(id).wifiJobAttempted,true);
});

test('a terminal exact job failure safely settles without permitting a second transport before proof',async()=>{
 const f=fixture(),attempt=f.journal.begin(id,manifest);await updateCardFirmware({entry,manifest,attemptJournal:f.journal,attempt,
  wifi:(_entry,version)=>f.fleet.updateLamp(entry,version,{jobId:attempt.attemptId,version,sha256:manifest.sha256}),
  acquireBluetooth:()=>assert.fail('No Bluetooth route.'),download:()=>assert.fail('No phone download.')});
 assert.throws(()=>f.journal.beforeWrite(f.journal.get(id),1,7),error=>error.requiresReconciliation);
 f.setJob({state:6,terminal:true,error:3,revision:2});const failed=await f.fleet.reconcileJob(entry,f.journal.get(id));
 assert.throws(()=>f.journal.settle(f.journal.get(id),{...failed,wifiJobTarget:'9.9.9'}),error=>error.requiresReconciliation);
 assert.throws(()=>f.journal.settle(f.journal.get(id),{...failed,wifiJobSha256:'b'.repeat(64)}),error=>error.requiresReconciliation);
 assert.equal(failed.outcome,'installationNotStarted');f.journal.settle(f.journal.get(id),failed);assert.equal(f.journal.pending().length,0);
});
