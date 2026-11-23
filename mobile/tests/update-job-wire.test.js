import test from 'node:test';
import assert from 'node:assert/strict';
import {lampUpdateJobV2Body,parseLampUpdateJobV2} from '../src/update-job-wire.js';
import {UpdateJobCoordinator} from '../src/update-job-coordinator.js';

const jobId='1'.repeat(32),targetId='aabbccddeeff',bridgeId='112233445566';
const artifact={version:'1.16.0',size:2027408,sha256:'a'.repeat(64)};
const wire=(changes={})=>({version:2,storageReady:true,jobId,targetId,ownerId:targetId,route:1,target:artifact.version,
 sha256:artifact.sha256,size:artifact.size,state:1,error:0,revision:1,confirmedBytes:0,totalBytes:artifact.size,terminal:false,...changes});

test('Internet wire states map to the app contract with exact immutable identity',()=>{
 const expected={jobId,targetId,ownerId:targetId,route:'internet',version:artifact.version,sha256:artifact.sha256,size:artifact.size};
 for(const [state,phase,confirmedBytes,terminal] of [[1,'accepted',0,false],[2,'downloading',0,false],[3,'downloading',65536,false],
  [4,'installing',artifact.size,false],[5,'succeeded',artifact.size,true]]){
  const parsed=parseLampUpdateJobV2(wire({state,confirmedBytes,terminal,revision:state}),expected);
  assert.equal(parsed.kind,'job');assert.equal(parsed.normalized.phase,phase);assert.equal(parsed.normalized.route,'internet');
  assert.equal(parsed.normalized.confirmedBytes,confirmedBytes);assert(Object.isFrozen(parsed));assert(Object.isFrozen(parsed.normalized));
 }
});

test('terminal pre-commit failure produces an explicit installation-not-started receipt',()=>{
 const failed=parseLampUpdateJobV2(wire({state:6,error:3,terminal:true,revision:2}));
 assert.equal(failed.normalized.phase,'failed');assert.equal(failed.normalized.receipt.outcome,'installation-not-started');
 assert.equal(failed.normalized.error.code,'lamp-update-error-3');
});

test('post-commit uncertainty remains fenced and cannot become a replacement-authorizing failed receipt',()=>{
 const uncertain=parseLampUpdateJobV2(wire({state:7,terminal:true,confirmedBytes:artifact.size,revision:3}),
  {jobId,targetId,ownerId:targetId,route:'internet',version:artifact.version,sha256:artifact.sha256,size:artifact.size});
 assert.equal(uncertain.kind,'uncertain');assert.equal(uncertain.reconciliationRequired,true);assert.equal(uncertain.normalized,null);
 assert.throws(()=>parseLampUpdateJobV2(wire({state:7,terminal:true,confirmedBytes:artifact.size,revision:3}),{jobId:'2'.repeat(32)}),
  error=>error.identity===true);
 assert.throws(()=>parseLampUpdateJobV2(wire({state:7,terminal:true,confirmedBytes:0,revision:3})),/state/i);
 const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
 const coordinator=new UpdateJobCoordinator(storage,{idFactory:()=>jobId});
 coordinator.prepare({targetId,artifact,route:'internet',ownerId:targetId});coordinator.beginSubmission(targetId);
 assert.throws(()=>coordinator.applySnapshot(targetId,uncertain.normalized));
 assert.throws(()=>coordinator.prepare({targetId,artifact:{...artifact,version:'1.16.1'},route:'internet',ownerId:targetId,jobId:'2'.repeat(32)}),
  /unresolved/i);
});

test('migrated size-less v1 jobs remain read-only compatibility records',()=>{
 for(const [state,error,terminal] of [[1,0,false],[2,0,false],[6,3,true]]){
  const legacy=parseLampUpdateJobV2(wire({size:0,totalBytes:0,confirmedBytes:0,state,error,terminal,revision:7}),
   {jobId,targetId,ownerId:targetId,route:'internet',version:artifact.version,sha256:artifact.sha256});
  assert.equal(legacy.kind,state===6?'legacy-failed':'legacy-job');assert.equal(legacy.reconciliationRequired,state!==6);assert.equal(legacy.normalized,null);
  const exact=()=>parseLampUpdateJobV2(wire({size:0,totalBytes:0,confirmedBytes:0,state,error,terminal,revision:7}),
   {jobId,targetId,ownerId:targetId,route:'internet',version:artifact.version,sha256:artifact.sha256,size:artifact.size});
  if(state===6){assert.equal(exact().kind,'legacy-failed');assert.equal(exact().receipt.outcome,'installation-not-started');}
  else assert.throws(exact,error=>error.requiresReconciliation===true);
  assert.throws(()=>parseLampUpdateJobV2(wire({size:0,totalBytes:0,confirmedBytes:0,state,error,terminal,revision:7}),{size:0}),/expected.*artifact/i);
 }
 const failed=wire({size:0,totalBytes:0,confirmedBytes:0,state:6,error:3,terminal:true,revision:7});
 for(const expected of [{jobId:'2'.repeat(32)},{targetId:bridgeId},{ownerId:bridgeId},{version:'1.16.1'},{sha256:'b'.repeat(64)},{route:'targeted-bridge'}])
  assert.throws(()=>parseLampUpdateJobV2(failed,expected),error=>error.identity===true);
 assert.throws(()=>parseLampUpdateJobV2(wire({size:0,totalBytes:0,confirmedBytes:0,state:3,revision:7})),/artifact|progress/i);
 assert.throws(()=>parseLampUpdateJobV2(wire({size:0,totalBytes:0,confirmedBytes:0,state:1,ownerId:bridgeId,route:2,revision:7})),/artifact|progress/i);
});

test('empty and storage-unavailable sentinels are accepted only when explicitly requested',()=>{
 const empty={version:2,storageReady:true,jobId:'',targetId:'',ownerId:'',route:0,target:'0.0.0',sha256:'',size:0,
  state:0,error:0,revision:0,confirmedBytes:0,totalBytes:0,terminal:false};
 const unavailable={...empty,storageReady:false,state:7,terminal:true};
 assert.equal(parseLampUpdateJobV2(empty,{allowEmpty:true}).kind,'empty');
 assert.equal(parseLampUpdateJobV2(unavailable,{allowEmpty:true}).kind,'storage-unavailable');
 assert.equal(parseLampUpdateJobV2(empty,{allowEmpty:true}).normalized,null);
 assert.throws(()=>parseLampUpdateJobV2(empty),/no matching/i);
 assert.throws(()=>parseLampUpdateJobV2({...empty,state:1},{allowEmpty:true}),/identity|artifact/i);
});

test('bridge records are safe to observe but cannot be submitted to the direct lamp endpoint',()=>{
 const bridge=parseLampUpdateJobV2(wire({ownerId:bridgeId,route:2,state:3,confirmedBytes:65536,revision:3}));
 assert.equal(bridge.normalized.route,'targeted-bridge');assert.equal(bridge.normalized.phase,'transferring');
 assert.throws(()=>parseLampUpdateJobV2(wire({ownerId:bridgeId,route:2}),{route:'internet'}),error=>error.identity===true);
 assert.throws(()=>lampUpdateJobV2Body({jobId,targetId,ownerId:bridgeId,route:'targeted-bridge',...artifact}),error=>error.beforeMutation===true);
});

test('direct Internet body is exact, deterministic, and owner-bound',()=>{
 const body=lampUpdateJobV2Body({jobId,targetId,ownerId:targetId,route:'internet',...artifact});
 assert.equal(body,'jobId='+jobId+'&targetId='+targetId+'&ownerId='+targetId+'&route=1&version=1.16.0&sha256='+artifact.sha256+'&size=2027408');
 assert.throws(()=>lampUpdateJobV2Body({jobId,targetId,ownerId:bridgeId,route:'internet',...artifact}),error=>error.beforeMutation===true);
 assert.throws(()=>lampUpdateJobV2Body({jobId,targetId,ownerId:targetId,route:'internet',...artifact,size:0}),error=>error.beforeMutation===true);
});

test('malformed, contradictory, regressive, and foreign wire records fail closed',()=>{
 const invalid=[
  wire({version:1}),wire({targetId:'AABBCCDDEEFF'}),wire({ownerId:bridgeId}),wire({totalBytes:artifact.size-1}),
  wire({state:1,confirmedBytes:1}),wire({state:4,confirmedBytes:artifact.size-1}),wire({state:5,terminal:false,confirmedBytes:artifact.size}),
  wire({state:6,error:0,terminal:true}),wire({state:7,error:1,terminal:true}),wire({revision:0}),wire({revision:0xffffffff})
 ];
 for(const value of invalid)assert.throws(()=>parseLampUpdateJobV2(value));
 assert.throws(()=>parseLampUpdateJobV2(wire(),{jobId:'2'.repeat(32)}),error=>error.identity===true);
 assert.throws(()=>parseLampUpdateJobV2(wire(),{size:512}),error=>error.identity===true);
});
