import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareFeedback} from '../src/firmware-feedback.js';
import {reconcileLegacyFirmwareReceipt} from '../src/firmware-attempt.js';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation} from '../src/firmware-update-ui.js';

const identity='f0b950b2f180',other='aabbccddeeff',version='1.15.2',source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function checkLampUpdateResult('),end=source.indexOf('\nconst firmwareResultCheckAt=',start);
assert(start>=0&&end>start);
function memory(){const rows=new Map();return {rows,getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};}
function savedFeedback(storage){const feedback=new FirmwareFeedback(storage);feedback.update(feedback.begin(identity),{message:'Previous update awaits a check.',terminal:true,outcome:'verified-restarting',targetVersion:version});return feedback;}
const snapshot=(flag=true)=>({identity,observedAt:Date.now(),firmware:{version,phase:0},state:{mode:4,effectCount:47,brightness:55,power:true},
 receiver:flag?{phase:5,error:6,committed:false,commitUnconfirmed:true,session:9,size:512,offset:512}:{phase:0,error:0,committed:false,session:0,size:0,offset:0}});
function context(storage,{flag=true}={}){
 const feedback=new FirmwareFeedback(storage),receipt=feedback.get(identity),entry={id:identity,deviceId:'saved'};let reads=0;
 const ctx={AbortController,document:{hidden:false},connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  firmwareAttempts:{get:()=>null,pending:()=>[]},legacyFirmwareReceipts:new Map(),firmwareFeedback:feedback,cardFirmwareUnconfirmed:new Map(),store:{items:[entry]},
  mergedLampEntries:()=>[entry],groupRemovedIds:new Set(),pauseFirmwareBackgroundWork(){},firmwareUpdatePresentation,firmwareUpdateFailurePresentation,
  renderLamps(){},renderFirmware(){},validFirmwareVersion:value=>value===version,rememberVerifiedUpdateResult(result){assert.notEqual(result?.outcome,'installed');},
  reconcileLegacyFirmwareReceipt:options=>reconcileLegacyFirmwareReceipt({...options,maxAttempts:1}),
  acquireCardFirmwareBluetooth:async()=>({lamp:{identity,readFirmwareUpdateSnapshot:async()=>{reads++;return snapshot(flag);}},release:async()=>{}})};
 // Execute the real startup adoption loop and the production check handler.
 const restore=source.split('\n').find(line=>line.startsWith('for(const entry of store.items){const receipt=firmwareFeedback.get(entry.id);'));
 assert(restore);runInNewContext(restore+'\n'+source.slice(start,end)+';globalThis.check=checkLampUpdateResult;',ctx);
 assert.equal(ctx.legacyFirmwareReceipts.get(identity).targetVersion,receipt.targetVersion);
 return {ctx,feedback,entry,get reads(){return reads;}};
}

test('old feedback records interpret missing additive uncertainty as false without losing their receipt',()=>{
 const storage=memory();storage.setItem('coollamp-firmware-feedback-v1',JSON.stringify([{id:identity,message:'Waiting.',terminal:true,outcome:'verified-restarting',targetVersion:version}]));
 const restored=new FirmwareFeedback(storage);assert.equal(restored.get(identity).commitUnconfirmed,false);assert.equal(restored.get(identity).outcome,'verified-restarting');
});
test('observed legacy commit uncertainty is durable even while a check token is active and survives repeated checks',async()=>{
 const storage=memory();savedFeedback(storage);const first=context(storage);await first.ctx.check(first.entry);
 assert.equal(first.ctx.legacyFirmwareReceipts.get(identity).commitUnconfirmed,true);assert.equal(first.reads,1);
 assert.equal(new FirmwareFeedback(storage).get(identity).commitUnconfirmed,true);
 const reboot=context(storage,{flag:false});assert.equal(reboot.ctx.legacyFirmwareReceipts.get(identity).commitUnconfirmed,true);
 await reboot.ctx.check(reboot.entry);await reboot.ctx.check(reboot.entry);
 assert.equal(reboot.reads,2);assert.equal(reboot.ctx.legacyFirmwareReceipts.has(identity),true);
 assert.equal(new FirmwareFeedback(storage).get(identity).commitUnconfirmed,true);assert.equal(reboot.ctx.cardFirmwareUnconfirmed.get(identity),version);
});
test('flagged legacy feedback cannot clear through version-only confirm, explicit begin, or equal-version success callbacks',()=>{
 const storage=memory(),feedback=savedFeedback(storage),token=feedback.begin(identity,{preservePending:true});
 feedback.markCommitUnconfirmed(identity,{targetVersion:version});
 assert.equal(new FirmwareFeedback(storage).get(identity).commitUnconfirmed,true);
 feedback.update(token,{message:'Checking…'});feedback.update(feedback.begin(other),{message:'Other updated.',terminal:true,outcome:'installed',targetVersion:version});
 assert.equal(new FirmwareFeedback(storage).get(identity).commitUnconfirmed,true);
 feedback.update(token,{message:'Stale equal version.',terminal:true,outcome:'installed',targetVersion:version,commitUnconfirmed:false});
 assert.equal(feedback.get(identity).outcome,'verified-restarting');assert.equal(feedback.get(identity).commitUnconfirmed,true);
 assert.equal(feedback.confirmInstalled(identity,{version,verified:true,fresh:true}),false);
 const again=feedback.begin(identity);assert.equal(new FirmwareFeedback(storage).get(identity).commitUnconfirmed,true);
 feedback.update(again,{message:'Still checking.',terminal:true,commitUnconfirmed:false});assert.equal(feedback.get(identity).commitUnconfirmed,true);
});
test('a forged installed record with uncertainty or malformed additive value is retained as a pending bounded receipt',()=>{
 for(const commitUnconfirmed of [true,'unknown',null,1]){
  const storage=memory();storage.setItem('coollamp-firmware-feedback-v1',JSON.stringify([{id:identity,message:'Unsafe success.',terminal:true,outcome:'installed',targetVersion:version,commitUnconfirmed}]));
  const feedback=new FirmwareFeedback(storage);assert.equal(feedback.get(identity).outcome,'verification-required');assert.equal(feedback.get(identity).commitUnconfirmed,true);
  assert.equal(feedback.confirmInstalled(identity,{version,verified:true,fresh:true}),false);
 }
});
test('failed storage or readback preserves the in-memory fence and reports honest inability to retain it',async()=>{
 for(const kind of ['write','readback']){
  const storage=memory();savedFeedback(storage);const f=context(storage);
  storage.setItem=kind==='write'?()=>{throw Error('Storage failed.');}:()=>{};
  await f.ctx.check(f.entry);assert.equal(f.ctx.legacyFirmwareReceipts.get(identity).commitUnconfirmed,true);
  assert.equal(f.feedback.get(identity).commitUnconfirmed,true);assert.equal(f.feedback.confirmInstalled(identity,{version,verified:true,fresh:true}),false);
  assert.match(f.feedback.get(identity).message,/not confirmed|checking|could not save/i);
  assert.throws(()=>f.feedback.markCommitUnconfirmed(identity,{targetVersion:version}),error=>error.journalFailure&&error.uncertain&&error.commitUnconfirmed);
 }
});
test('legacy flag identity/version mismatch cannot contaminate another saved target',()=>{
 const storage=memory(),feedback=savedFeedback(storage);
 assert.throws(()=>feedback.markCommitUnconfirmed(other,{targetVersion:version}),error=>error.requiresReconciliation);
 assert.throws(()=>feedback.markCommitUnconfirmed(identity,{targetVersion:'1.15.1'}),error=>error.requiresReconciliation);
 assert.equal(feedback.get(identity).commitUnconfirmed,false);assert.equal(feedback.get(other),undefined);
});
test('legacy flagged receipt retains its identity/uncertainty through missing, stale and reboot-cleared protected reads',async()=>{
 const receipt={identity,targetVersion:version,outcome:'verified-restarting',commitUnconfirmed:true};
 for(const observed of [snapshot(false),{...snapshot(false),observedAt:1}]){
  const result=await reconcileLegacyFirmwareReceipt({receipt,maxAttempts:1,acquire:async()=>({lamp:{identity,readFirmwareUpdateSnapshot:async()=>observed},release:async()=>{}})});
  assert.equal(result.pending,true);assert.equal(result.commitUnconfirmed,true);assert.equal(result.safeRetry,false);assert.equal(result.outcome,'unresolved');
 }
});
