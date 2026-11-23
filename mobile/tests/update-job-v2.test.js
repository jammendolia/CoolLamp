import test from 'node:test';
import assert from 'node:assert/strict';
import {UPDATE_JOB_CONTRACT_VERSION,normalizeUpdateJobSnapshot,updateJobView} from '../src/update-job-contract.js';
import {UpdateJobCoordinator,UPDATE_JOB_LIMIT,UPDATE_JOB_STORAGE_KEY} from '../src/update-job-coordinator.js';

const target='f0b950b2f180',bridge='a1b2c3d4e5f6',jobId='1'.repeat(32);
const artifact=Object.freeze({version:'1.16.0',size:2027408,sha256:'a'.repeat(64)});
function storage(){
 const data=new Map();let fail=false,corrupt=false;
 return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('storage failed');data.set(key,corrupt?'broken':value);},
  fail:value=>fail=value,corrupt:value=>corrupt=value};
}
const coordinator=(memory=storage(),options={})=>new UpdateJobCoordinator(memory,{idFactory:()=>jobId,...options});
function prepared(subject,{route='internet',ownerId=target}={}){
 return subject.prepare({targetId:target,artifact,route,ownerId});
}
function snapshot({revision=1,phase='accepted',confirmedBytes=0,route='internet',ownerId=target,terminal=false,receipt=null,error=null,
 id=jobId,targetId=target,selectedArtifact=artifact}={}){
 return {contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:id,targetId,artifact:selectedArtifact,route,ownerId,revision,phase,
  confirmedBytes,totalBytes:selectedArtifact.size,terminal,receipt,error};
}

test('one immutable tuple is persisted before submission and survives app restart',()=>{
 const memory=storage(),first=coordinator(memory);const ready=prepared(first);
 assert.deepEqual(ready.artifact,artifact);assert.equal(ready.route,'internet');assert.equal(ready.ownerId,target);
 const submission=first.beginSubmission(target);assert.equal(submission.request.jobId,jobId);assert.equal(submission.request.targetId,target);
 assert.deepEqual(submission.request.artifact,artifact);assert.equal(submission.request.route,'internet');
 const restored=coordinator(memory).get(target);assert.equal(restored.phase,'reconciling');assert.equal(restored.mutationAttempted,true);
 assert.throws(()=>coordinator(memory).beginSubmission(target),error=>error.beforeMutation&&error.requiresReconciliation);
 assert(Object.isFrozen(restored));assert(Object.isFrozen(restored.artifact));
});

test('route selection is explicit, owner-bound and never falls back to Bluetooth',()=>{
 for(const choice of [{route:'internet',ownerId:target},{route:'targeted-bridge',ownerId:bridge},{route:'phone-service',ownerId:'phone:installation-1'}]){
  const item=prepared(coordinator(storage()),choice);assert.equal(item.route,choice.route);assert.equal(item.ownerId,choice.ownerId);
 }
 assert.throws(()=>prepared(coordinator(storage()),{route:'internet',ownerId:bridge}),error=>error.beforeMutation);
 assert.throws(()=>prepared(coordinator(storage()),{route:'targeted-bridge',ownerId:'not-a-bridge'}),error=>error.beforeMutation);
 assert.throws(()=>prepared(coordinator(storage()),{route:'bluetooth',ownerId:'phone:installation-1'}),error=>error.beforeMutation);
 const subject=coordinator(storage());prepared(subject,{route:'targeted-bridge',ownerId:bridge});subject.beginSubmission(target);
 for(let i=0;i<3;i++){subject.beginObservation(target);subject.recordObservationFailure(target,{code:'offline',message:'Bridge unavailable.'});}
 assert.equal(subject.get(target).route,'targeted-bridge');assert.equal(subject.get(target).ownerId,bridge);
 assert.equal(subject.view(target).action,'check-status');
});

test('lost submission response becomes a bounded check and then a safe needs-attention state',()=>{
 const memory=storage(),subject=coordinator(memory);prepared(subject);subject.beginSubmission(target);
 for(let attempt=1;attempt<=3;attempt++){
  const request=subject.beginObservation(target);assert.equal(request.jobId,jobId);assert.equal(request.afterRevision,null);
  subject.recordObservationFailure(target,{code:'timeout',message:'No status reply.'});
  const restored=coordinator(memory);assert.equal(restored.get(target).observationAttempts,attempt);
 }
 const view=subject.view(target);assert.deepEqual({state:view.state,active:view.active,indeterminate:view.indeterminate,action:view.action},
  {state:'needs-attention',active:false,indeterminate:false,action:'check-status'});
 assert.throws(()=>subject.beginObservation(target),error=>error.needsAttention);
 const retried=subject.retryObservation(target);assert.equal(retried.jobId,jobId);assert.equal(retried.phase,'reconciling');
 assert.equal(retried.observationAttempts,0);assert.equal(retried.route,'internet');
});

test('accepted device-owned job remains observable after restart and successful observations are idempotent',()=>{
 const memory=storage(),subject=coordinator(memory);prepared(subject);subject.beginSubmission(target);
 const accepted=snapshot();subject.applySnapshot(target,accepted);
 const restored=coordinator(memory);assert.equal(restored.get(target).phase,'accepted');assert.equal(restored.jobsNeedingObservation().length,1);
 let view=restored.view(target);assert.equal(view.message,'Update accepted by the lamp. You may leave CoolLamp.');assert.equal(view.action,'leave');
 restored.beginObservation(target);assert.equal(restored.get(target).observationAttempts,1);
 const again=restored.applySnapshot(target,accepted);assert.equal(again.observationAttempts,0);assert.equal(again.revision,1);
 view=restored.view(target);assert.equal(view.active,true);
});

test('same revision plus same tuple is idempotent; changed reuse and stale revisions are conflicts',()=>{
 const subject=coordinator();prepared(subject);subject.beginSubmission(target);subject.applySnapshot(target,snapshot({revision:2,phase:'downloading'}));
 assert.equal(subject.applySnapshot(target,snapshot({revision:2,phase:'downloading'})).revision,2);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:1,phase:'accepted'})),error=>error.stale);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:2,phase:'installing'})),error=>error.conflict);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:3,phase:'downloading',confirmedBytes:1,selectedArtifact:{...artifact,sha256:'b'.repeat(64)}})),error=>error.conflict);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:3,phase:'offering',route:'targeted-bridge',ownerId:bridge})),error=>error.conflict);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:3,phase:'downloading',id:'2'.repeat(32)})),error=>error.conflict);
});

test('remote revisions, phases and confirmed bytes advance monotonically',()=>{
 const subject=coordinator();prepared(subject);subject.beginSubmission(target);
 subject.applySnapshot(target,snapshot({revision:1,phase:'accepted'}));
 subject.applySnapshot(target,snapshot({revision:2,phase:'downloading',confirmedBytes:100}));
 subject.applySnapshot(target,snapshot({revision:3,phase:'installing',confirmedBytes:artifact.size}));
 assert.equal(subject.get(target).confirmedBytes,artifact.size);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:4,phase:'downloading',confirmedBytes:artifact.size})),error=>error.conflict);
 assert.throws(()=>subject.applySnapshot(target,snapshot({revision:4,phase:'verifying',confirmedBytes:99})),error=>error.conflict);
});

test('targeted bridge phases stay bound to the selected bridge through terminal verification',()=>{
 const subject=coordinator();prepared(subject,{route:'targeted-bridge',ownerId:bridge});subject.beginSubmission(target);
 const bridgeSnapshot=(revision,phase,confirmedBytes=0,terminal=false,receipt=null)=>snapshot({revision,phase,confirmedBytes,terminal,receipt,
  route:'targeted-bridge',ownerId:bridge});
 subject.applySnapshot(target,bridgeSnapshot(1,'accepted'));
 subject.applySnapshot(target,bridgeSnapshot(2,'offering'));
 subject.applySnapshot(target,bridgeSnapshot(3,'transferring',artifact.size));
 subject.applySnapshot(target,bridgeSnapshot(4,'awaiting-verification',artifact.size));
 const view=subject.view(target);assert.equal(view.state,'awaiting-verification');assert.match(view.message,/selected bridge/);
 subject.applySnapshot(target,bridgeSnapshot(5,'succeeded',artifact.size,true,{outcome:'installed',installedVersion:artifact.version}));
 assert.equal(subject.get(target).ownerId,bridge);assert.equal(subject.get(target).receipt.outcome,'installed');
});

test('terminal receipt is authoritative and permits a deliberately selected new job',()=>{
 const memory=storage(),subject=coordinator(memory);prepared(subject);subject.beginSubmission(target);
 const done=snapshot({revision:5,phase:'succeeded',confirmedBytes:artifact.size,terminal:true,
  receipt:{outcome:'installed',installedVersion:artifact.version}});
 subject.applySnapshot(target,done);assert.equal(subject.get(target).terminal,true);assert.equal(subject.view(target).progress,100);
 assert.equal(subject.jobsNeedingObservation().length,0);
 const replacement=subject.prepare({targetId:target,artifact:{...artifact,version:'1.16.1'},route:'targeted-bridge',ownerId:bridge,jobId:'3'.repeat(32)});
 assert.equal(replacement.jobId,'3'.repeat(32));assert.equal(replacement.route,'targeted-bridge');
});

test('invalid terminal receipts, progress and running errors fail closed',()=>{
 assert.throws(()=>normalizeUpdateJobSnapshot(snapshot({phase:'succeeded',terminal:true,confirmedBytes:artifact.size,
  receipt:{outcome:'installed',installedVersion:'1.15.9'}})));
 assert.throws(()=>normalizeUpdateJobSnapshot(snapshot({confirmedBytes:artifact.size+1})));
 assert.throws(()=>normalizeUpdateJobSnapshot(snapshot({error:{code:'bad',message:'not terminal'}})));
 assert.throws(()=>normalizeUpdateJobSnapshot(snapshot({phase:'failed',terminal:true,receipt:{outcome:'failed',installedVersion:'1.15.9'}})));
});

test('storage failure prevents mutation and corrupt storage fails closed without repair or fallback',()=>{
 const memory=storage(),subject=coordinator(memory);prepared(subject);memory.fail(true);
 assert.throws(()=>subject.beginSubmission(target),error=>error.beforeMutation&&error.storageFailure);
 memory.fail(false);assert.equal(coordinator(memory).get(target).phase,'prepared');
 memory.data.set(UPDATE_JOB_STORAGE_KEY,'broken');const corrupt=coordinator(memory);assert.equal(corrupt.healthy,false);
 assert.throws(()=>prepared(corrupt),error=>error.beforeMutation&&error.storageFailure);
});

test('failed capacity pruning leaves in-memory and durable records unchanged',()=>{
 const memory=storage(),subject=coordinator(memory);
 for(let index=1;index<=UPDATE_JOB_LIMIT;index++){
  const rowTarget=index.toString(16).padStart(12,'0'),rowJob=index.toString(16).padStart(32,'0');
  subject.prepare({targetId:rowTarget,artifact,route:'internet',ownerId:rowTarget,jobId:rowJob});subject.beginSubmission(rowTarget);
  subject.applySnapshot(rowTarget,snapshot({revision:1,phase:'succeeded',confirmedBytes:artifact.size,terminal:true,
   receipt:{outcome:'installed',installedVersion:artifact.version},id:rowJob,targetId:rowTarget,ownerId:rowTarget}));
 }
 const beforeRecords=subject.all(),beforeStorage=memory.data.get(UPDATE_JOB_STORAGE_KEY);memory.fail(true);
 const nextTarget=(UPDATE_JOB_LIMIT+1).toString(16).padStart(12,'0');
 assert.throws(()=>subject.prepare({targetId:nextTarget,artifact,route:'internet',ownerId:nextTarget,jobId:'f'.repeat(32)}),
  error=>error.beforeMutation&&error.storageFailure);
 assert.deepEqual(subject.all(),beforeRecords);assert.equal(memory.data.get(UPDATE_JOB_STORAGE_KEY),beforeStorage);
});

test('pure presentation never claims indefinite checking after its bounded observation budget',()=>{
 const value={...prepared(coordinator()),phase:'reconciling',mutationAttempted:true,observationAttempts:3};
 const view=updateJobView(value,{maximumObservationAttempts:3});
 assert.equal(view.state,'needs-attention');assert.equal(view.active,false);assert.equal(view.indeterminate,false);assert.equal(view.action,'check-status');
 assert(!Object.hasOwn(value,'startedAt'));assert(!Object.hasOwn(value,'deadlineAt'));
});
