import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareUpdateDiagnostics,FIRMWARE_UPDATE_DIAGNOSTICS_KEY,FIRMWARE_UPDATE_DIAGNOSTIC_STAGES,FIRMWARE_UPDATE_DIAGNOSTIC_CODES} from '../src/firmware-update-diagnostics.js';
import {FirmwareAttemptJournal,FIRMWARE_ATTEMPT_KEY} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';

const id='f0b950b2f180',other='74b950b2f180',attempt='a'.repeat(32),nextAttempt='b'.repeat(32);
function memory(){
 const values=new Map(),writes=[];let failGet=false,failSet=false;
 return {values,writes,getItem:key=>{if(failGet)throw Error('Private storage details.');return values.get(key)??null;},
  setItem:(key,value)=>{if(failSet)throw Error('Private quota details.');writes.push({key,value});values.set(key,value);},
  failGet:value=>failGet=value,failSet:value=>failSet=value};
}
function fixture(){const storage=memory(),diagnostics=new FirmwareUpdateDiagnostics(storage);diagnostics.begin(id,attempt);return {storage,diagnostics};}
const classify=(error,stage='bluetooth-transfer')=>{const f=fixture();return f.diagnostics.failure(id,attempt,error,{stage}).stages[0];};

test('safe stage evidence and completion survive reload as immutable copies in a separate namespace',()=>{
 const {storage,diagnostics}=fixture();
 const row=diagnostics.failure(id,attempt,Object.assign(Error('Private native details.'),{updateDiagnostic:{phase:2,error:7,metadataIssued:true,beginAttempted:true,commitAttempted:false,acknowledgedBytes:232,writesAttempted:5,stopReason:'receiver-rejected'}}),{stage:'bluetooth-transfer'});
 assert.equal(row.stages[0].code,'receiver-rejected');assert.equal(row.stages[0].firmwarePhase,2);assert.equal(row.stages[0].acknowledgedBytes,232);
 assert(Object.isFrozen(row)&&Object.isFrozen(row.stages)&&Object.isFrozen(row.stages[0]));
 assert.throws(()=>{row.stages[0].code='unknown';},TypeError);assert.equal(diagnostics.get(id).stages[0].code,'receiver-rejected');
 diagnostics.complete(id,attempt,{outcome:'transferStopped',installedVersion:'1.13.0',offset:232});
 assert.deepEqual(new FirmwareUpdateDiagnostics(storage).get(id),diagnostics.get(id));
 const report=JSON.parse(diagnostics.report(id));assert.equal(report.version,1);assert.equal(report.record.identity,id);assert.equal(report.record.attemptId,attempt);
 assert(report.record.updatedAt>=report.record.startedAt);assert.equal(report.record.outcome,'transferStopped');
 assert(storage.writes.every(row=>row.key===FIRMWARE_UPDATE_DIAGNOSTICS_KEY));assert.equal(storage.getItem(FIRMWARE_ATTEMPT_KEY),null);
});

for(const [error,code]of [
 [{identity:true},'identity-mismatch'],[{needsPassword:true,httpStatus:403},'wifi-password-required'],[{httpStatus:403},'authorization-required'],
 [{stale:true},'target-changed'],[{journalFailure:true},'recovery-storage-failure'],[{bootstrapRequired:true},'bootstrap-required'],
 [{firmwareBusy:true},'update-busy'],[{receiverBusy:true},'update-busy'],[{invalidRead:true},'invalid-status'],
 [{missingUpdateToken:true},'missing-update-token'],[{unsupported:true},'unsupported'],[{offline:true},'wifi-unreachable'],
 [{httpStatus:409},'wifi-check-rejected'],[{firmwareError:3,firmwarePhase:5},'firmware-rejected'],[{cancelled:true},'cancelled'],
 [{uncertain:true},'mutation-uncertain'],[{timeout:true},'timeout'],[{httpStatus:503},'http-error'],
 [{updateDiagnostic:{error:7}},'receiver-rejected'],[{stopReason:'ack-timeout'},'ack-timeout'],
 [Error('Not connected to device.'),'native-not-connected'],[Error('Not connected to device. Private lamp name.'),'unknown'],
 [Error('not connected to device'),'unknown'],[Error('SSID: private'),'unknown']
])test('source-backed diagnostic classifier: '+code+' '+JSON.stringify(error),()=>assert.equal(classify(error).code,code));

test('bounded two-cause walk supports native first causes, cycles and competing security flags without exporting messages',()=>{
 const original=Error('Not connected to device.'),wrapper=Object.assign(Error('private wrapper'),{cause:{cause:original}});
 assert.equal(classify(wrapper).code,'native-not-connected');assert.equal(classify({cause:{cause:{cause:original}}}).code,'unknown');
 const cyclic={cause:null,offline:true,password:'private'};cyclic.cause=cyclic;assert.equal(classify(cyclic).code,'wifi-unreachable');
 assert.equal(classify({identity:true,cause:original}).code,'identity-mismatch');
 assert.equal(classify({stopReason:'user',cause:original}).code,'user');assert.equal(classify({updateDiagnostic:{stopReason:'native-disconnect'},cause:original}).code,'native-disconnect');
 assert(!JSON.stringify(classify(wrapper)).includes('private'));assert(!JSON.stringify(classify(cyclic)).includes('password'));
});

test('only validated safe metrics survive hostile extra data, getters and cyclic journal context',()=>{
 const {storage,diagnostics}=fixture(),safety={metadataIssued:true,beginAttempted:false,commitAttempted:false,wifiCheckAttempted:true,wifiInstallAttempted:false,offset:123,
  text:'private'.repeat(100000),sha256:'secret-hash',session:4321,fleetKey:'secret-key'};safety.loop=safety;
 let invoked=0;const error={updateDiagnostic:{metadataIssued:false,beginAttempted:true,commitAttempted:true,offset:600,acknowledgedBytes:232,writesAttempted:6,phase:2,error:0},
  httpStatus:409,firmwareError:2,body:safety,SSID:'private-network',deviceId:'private-native-uuid',address:'192.0.2.1'};
 Object.defineProperty(error,'message',{get(){invoked++;return 'Not connected to device.';}});
 Object.defineProperty(error,'cause',{get(){invoked++;return safety;}});error.toJSON=()=>{invoked++;return {secret:'private'};};
 const result=diagnostics.failure(id,attempt,error,{stage:'wifi-preflight',safety}).stages[0];
 assert.equal(invoked,0);assert.equal(result.code,'firmware-rejected');assert.equal(result.metadataIssued,true);assert.equal(result.beginAttempted,false);
 assert.equal(result.commitAttempted,false);assert.equal(result.wifiCheckAttempted,true);assert.equal(result.wifiInstallAttempted,false);assert.equal(result.offset,123);
 assert.equal(result.acknowledgedBytes,232);assert.equal(result.writesAttempted,6);
 const report=diagnostics.report(id);for(const secret of ['private','secret-hash','secret-key','4321','192.0.2.1','deviceId','session','sha256','SSID','body','toJSON'])assert(!report.includes(secret));
 assert(storage.getItem(FIRMWARE_UPDATE_DIAGNOSTICS_KEY).length<=32768);
});

test('invalid metrics, unrecognized stop reasons and invalid completion fields are omitted',()=>{
 const {diagnostics}=fixture();
 const result=diagnostics.failure(id,attempt,{updateDiagnostic:{metadataIssued:'true',beginAttempted:1,commitAttempted:null,phase:6,error:10,acknowledgedBytes:2031617,writesAttempted:1048577,stopReason:'private-network'},
  httpStatus:600,firmwareError:9,offset:-1},{stage:'phone-download',safety:{offset:Infinity,wifiInstallAttempted:'true'}});
 assert.deepEqual(result.stages[0],{stage:'phone-download',at:result.stages[0].at,code:'unknown'});
 const done=diagnostics.complete(id,attempt,{outcome:'unresolved',installedVersion:'1.01.3 private',offset:2031617});
 assert.equal(done.installedVersion,undefined);assert.equal(done.offset,undefined);
});

test('four distinct latest stages retain failures when a later installed result is recorded',()=>{
 const {diagnostics}=fixture();
 for(const stage of FIRMWARE_UPDATE_DIAGNOSTIC_STAGES)diagnostics.failure(id,attempt,{offline:true},{stage});
 diagnostics.failure(id,attempt,Error('Not connected to device.'),{stage:'bluetooth-preflight'});
 assert.deepEqual(diagnostics.get(id).stages.map(row=>row.stage),['wifi-preflight','phone-download','bluetooth-transfer','bluetooth-preflight']);
 assert.equal(diagnostics.get(id).stages.length,4);assert.equal(diagnostics.get(id).stages.at(-1).code,'native-not-connected');
 diagnostics.complete(id,attempt,{outcome:'unresolved'});diagnostics.complete(id,attempt,{outcome:'installed',installedVersion:'1.15.1'});
 assert.equal(diagnostics.get(id).outcome,'installed');assert.equal(diagnostics.get(id).stages.length,4);
});

test('owner tokens fence stale, foreign, invalid-stage and post-terminal callbacks',()=>{
 const {diagnostics}=fixture();diagnostics.begin(other,attempt);diagnostics.failure(other,attempt,{offline:true},{stage:'wifi-preflight'});
 const original=diagnostics.get(id);assert.equal(diagnostics.begin(id,attempt).startedAt,original.startedAt);
 for(const [target,owner,stage]of[[id,nextAttempt,'wifi-preflight'],[other,nextAttempt,'wifi-preflight'],['invalid',attempt,'wifi-preflight'],[id,attempt,'private-stage']])
  assert.equal(diagnostics.failure(target,owner,{offline:true},{stage}),null);
 diagnostics.begin(id,nextAttempt);assert.equal(diagnostics.failure(id,attempt,{offline:true},{stage:'wifi-preflight'}),null);
 assert.equal(diagnostics.complete(id,attempt,{outcome:'installed',installedVersion:'1.15.1'}),null);
 diagnostics.complete(id,nextAttempt,{outcome:'installationNotStarted'});const final=diagnostics.get(id);
 assert.equal(diagnostics.failure(id,nextAttempt,{offline:true},{stage:'wifi-preflight'}),null);assert.equal(diagnostics.complete(id,nextAttempt,{outcome:'installed'}),null);
 assert.deepEqual(diagnostics.get(id),final);assert.equal(diagnostics.get(other).stages[0].code,'wifi-unreachable');
 for(const [target,owner]of[['INVALID',attempt],[id,'A'.repeat(32)],[id,'wrong']])assert.equal(diagnostics.begin(target,owner),null);
 assert.equal(diagnostics.get('missing'),null);assert.equal(diagnostics.report('missing'),null);
});

test('storage denial and absent storage remain best effort and never touch the safety journal',()=>{
 const storage=memory(),diagnostics=new FirmwareUpdateDiagnostics(storage);storage.failSet(true);
 assert.doesNotThrow(()=>diagnostics.begin(id,attempt));assert.doesNotThrow(()=>diagnostics.failure(id,attempt,{offline:true},{stage:'wifi-preflight'}));
 assert.doesNotThrow(()=>diagnostics.complete(id,attempt,{outcome:'installationNotStarted'}));assert.equal(diagnostics.get(id).outcome,'installationNotStarted');
 const noStore=new FirmwareUpdateDiagnostics();assert.doesNotThrow(()=>noStore.begin(id,attempt));assert(noStore.report(id));
 storage.failGet(true);const denied=new FirmwareUpdateDiagnostics(storage);assert.doesNotThrow(()=>denied.begin(id,attempt));assert(denied.get(id));
 storage.failGet(false);storage.failSet(false);
 const journal=new FirmwareAttemptJournal(storage),manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n512\n'+'a'.repeat(64)+'\n');
 const safety=journal.begin(id,manifest);journal.beforeWrite(safety,{operation:1,session:9});journal.beforeWrite(safety,{operation:2,session:9});
 assert.equal(journal.get(id).beginAttempted,true);assert.equal(diagnostics.get(id).outcome,'installationNotStarted');
});

test('v1 extra fields are stripped on migration; corrupt and future stores never become update authority',()=>{
 const {storage,diagnostics}=fixture();diagnostics.failure(id,attempt,{offline:true},{stage:'wifi-preflight'});
 const stored=JSON.parse(storage.getItem(FIRMWARE_UPDATE_DIAGNOSTICS_KEY));stored.records[0].password='private';stored.records[0].stages[0].ssid='private';
 storage.values.set(FIRMWARE_UPDATE_DIAGNOSTICS_KEY,JSON.stringify(stored));assert(!new FirmwareUpdateDiagnostics(storage).report(id).includes('private'));
 const valid=diagnostics.get(id);
 for(const value of ['broken',JSON.stringify({version:2,records:[valid]}),JSON.stringify({version:1,records:[valid,valid]}),
  JSON.stringify({version:1,records:[{...valid,stages:[{stage:'wifi-preflight',at:valid.updatedAt,code:'executable-custom'}]}]}),' '.repeat(32769)]){
  storage.values.set(FIRMWARE_UPDATE_DIAGNOSTICS_KEY,value);const writes=storage.writes.length,restored=new FirmwareUpdateDiagnostics(storage);
  assert.equal(restored.get(id),null);assert.doesNotThrow(()=>restored.begin(id,nextAttempt));assert(restored.get(id));assert.equal(storage.writes.length,writes);
 }
});

test('record, stage, storage and report bounds hold for worst-case safe metrics',()=>{
 const storage=memory(),diagnostics=new FirmwareUpdateDiagnostics(storage),error={firmwarePhase:5,error:9,firmwareError:8,httpStatus:599,
  stopReason:'transport-disconnect',metadataIssued:true,beginAttempted:true,commitAttempted:true,wifiCheckAttempted:true,wifiInstallAttempted:true,offset:2031616,acknowledgedBytes:2031616,writesAttempted:1048576};
 for(let i=0;i<100;i++){
  const target=i.toString(16).padStart(12,'0');diagnostics.begin(target,attempt);
  for(const stage of FIRMWARE_UPDATE_DIAGNOSTIC_STAGES)diagnostics.failure(target,attempt,error,{stage});
  diagnostics.complete(target,attempt,{outcome:'installed',installedVersion:'65535.65535.65535',offset:2031616});
  const saved=storage.getItem(FIRMWARE_UPDATE_DIAGNOSTICS_KEY);assert(saved.length<=32768);assert(JSON.parse(saved).records.length<=32);assert(diagnostics.report(target).length<=4096);
 }
 assert.equal(diagnostics.get('000000000000'),null);const loaded=new FirmwareUpdateDiagnostics(storage);assert(loaded.get('000000000063'));
 const bad=JSON.stringify({version:1,records:Array.from({length:33},(_,i)=>({...diagnostics.get('000000000063'),identity:i.toString(16).padStart(12,'0')}))});
 storage.values.set(FIRMWARE_UPDATE_DIAGNOSTICS_KEY,bad);assert.equal(new FirmwareUpdateDiagnostics(storage).get('000000000000'),null);
 assert(Object.isFrozen(FIRMWARE_UPDATE_DIAGNOSTIC_CODES));assert(Object.isFrozen(FIRMWARE_UPDATE_DIAGNOSTIC_STAGES));
});
