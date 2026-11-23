import {UPDATE_JOB_CONTRACT_VERSION,isUpdateJobId,isUpdateTargetId,normalizeUpdateArtifact,normalizeUpdateError,
 normalizeUpdateJobSnapshot,normalizeUpdateOwner,sameUpdateJobTuple,updateJobSnapshotFingerprint,updateJobView,
 validUpdateJobTransition} from './update-job-contract.js';

export const UPDATE_JOB_STORAGE_KEY='coollamp-update-jobs-v2';
export const UPDATE_JOB_STORAGE_LIMIT=65536;
export const UPDATE_JOB_LIMIT=64;
export const UPDATE_JOB_MAX_OBSERVATIONS=3;

const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const failure=(message,fields={})=>Object.assign(Error(message),{confirmed:true,...fields});
const copy=value=>Object.freeze({...value,artifact:Object.freeze({...value.artifact}),error:value.error?Object.freeze({...value.error}):null,
 receipt:value.receipt?Object.freeze({...value.receipt}):null});

function restored(value){
 if(!value||value.contractVersion!==UPDATE_JOB_CONTRACT_VERSION||!isUpdateJobId(value.jobId)||!isUpdateTargetId(value.targetId)||
  typeof value.mutationAttempted!=='boolean'||!integer(value.observationAttempts,0,UPDATE_JOB_MAX_OBSERVATIONS))throw Error('Invalid update job.');
 const artifact=normalizeUpdateArtifact(value.artifact),ownerId=normalizeUpdateOwner(value.route,value.ownerId,value.targetId);
 const common={contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:value.jobId,targetId:value.targetId,artifact,route:value.route,ownerId,
  mutationAttempted:value.mutationAttempted,observationAttempts:value.observationAttempts};
 if(value.phase==='prepared'){
  if(value.mutationAttempted||value.revision!==null||value.confirmedBytes!==0||value.totalBytes!==artifact.size||value.terminal||
   value.receipt!==null||value.error!==null||value.snapshotFingerprint!==null||value.observationAttempts!==0)throw Error('Invalid prepared update job.');
  return {...common,phase:'prepared',revision:null,confirmedBytes:0,totalBytes:artifact.size,terminal:false,receipt:null,error:null,snapshotFingerprint:null};
 }
 if(value.phase==='reconciling'||value.phase==='needs-attention'){
  const error=normalizeUpdateError(value.error);
  if(!value.mutationAttempted||value.revision!==null||value.confirmedBytes!==0||value.totalBytes!==artifact.size||value.terminal||
   value.receipt!==null||value.snapshotFingerprint!==null||value.phase==='needs-attention'&&!error)throw Error('Invalid unresolved update job.');
  return {...common,phase:value.phase,revision:null,confirmedBytes:0,totalBytes:artifact.size,terminal:false,receipt:null,error,snapshotFingerprint:null};
 }
 const snapshot=normalizeUpdateJobSnapshot({contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:value.jobId,targetId:value.targetId,
  artifact,route:value.route,ownerId,revision:value.revision,phase:value.phase,confirmedBytes:value.confirmedBytes,
  totalBytes:value.totalBytes,terminal:value.terminal,receipt:value.receipt,error:value.error});
 if(!value.mutationAttempted||value.snapshotFingerprint!==updateJobSnapshotFingerprint(snapshot))throw Error('Invalid observed update job.');
 return {...common,...snapshot,snapshotFingerprint:value.snapshotFingerprint};
}

function defaultId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}

export class UpdateJobCoordinator{
 constructor(storage,{idFactory=defaultId,maximumObservationAttempts=UPDATE_JOB_MAX_OBSERVATIONS}={}){
  this.storage=storage;this.idFactory=idFactory;this.maximumObservationAttempts=maximumObservationAttempts;
  if(!integer(maximumObservationAttempts,1,UPDATE_JOB_MAX_OBSERVATIONS))throw Error('Invalid update observation limit.');
  this.records=new Map();this.healthy=true;this.storageError='';
  try{
   if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')throw Error('Storage unavailable.');
   const text=storage.getItem(UPDATE_JOB_STORAGE_KEY);if(text===null||text===undefined)return;
   if(typeof text!=='string'||text.length>UPDATE_JOB_STORAGE_LIMIT)throw Error('Invalid update job storage.');
   const value=JSON.parse(text);
   if(value?.version!==UPDATE_JOB_CONTRACT_VERSION||!Array.isArray(value.jobs)||value.jobs.length>UPDATE_JOB_LIMIT)throw Error('Unsupported update job storage.');
   for(const row of value.jobs){const record=restored(row);if(this.records.has(record.targetId))throw Error('Duplicate update target.');this.records.set(record.targetId,record);}
  }catch{
   this.records.clear();this.healthy=false;this.storageError='Saved update jobs could not be read. No update will be started.';
  }
 }
 persist(records){
  if(!this.healthy)throw failure(this.storageError,{beforeMutation:true,storageFailure:true});
  const text=JSON.stringify({version:UPDATE_JOB_CONTRACT_VERSION,jobs:[...records.values()]});
  if(text.length>UPDATE_JOB_STORAGE_LIMIT)throw failure('Update job storage is full.',{beforeMutation:true,storageFailure:true});
  try{this.storage.setItem(UPDATE_JOB_STORAGE_KEY,text);if(this.storage.getItem(UPDATE_JOB_STORAGE_KEY)!==text)throw Error('Write not retained.');}
  catch{throw failure('The update job was not changed because its status could not be saved.',{beforeMutation:true,storageFailure:true});}
  this.records=records;
 }
 save(value){const records=new Map(this.records);records.set(value.targetId,value);this.persist(records);return copy(value);}
 get(targetId){const value=this.records.get(targetId);return value?copy(value):null;}
 all(){return [...this.records.values()].map(copy);}
 prepare({targetId,artifact,route,ownerId,jobId=this.idFactory()}={}){
  if(!this.healthy)throw failure(this.storageError,{beforeMutation:true,storageFailure:true});
  if(!isUpdateTargetId(targetId)||!isUpdateJobId(jobId))throw failure('The update target or job identifier is invalid.',{beforeMutation:true});
  const existing=this.records.get(targetId);if(existing&&!existing.terminal)throw failure('This lamp already has an unresolved update job.',{beforeMutation:true,requiresReconciliation:true});
  const exact=normalizeUpdateArtifact(artifact),value={contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId,targetId,artifact:exact,route,
   ownerId:normalizeUpdateOwner(route,ownerId,targetId),phase:'prepared',revision:null,confirmedBytes:0,totalBytes:exact.size,
   terminal:false,receipt:null,error:null,mutationAttempted:false,observationAttempts:0,snapshotFingerprint:null};
  const records=new Map(this.records);
  if(records.size>=UPDATE_JOB_LIMIT&&!existing){
   const removable=[...records.values()].find(row=>row.terminal);if(!removable)throw failure('Resolve an existing update job before starting another.',{beforeMutation:true});
   records.delete(removable.targetId);
  }
  records.set(value.targetId,value);this.persist(records);return copy(value);
 }
 beginSubmission(targetId){
  const value=this.records.get(targetId);
  if(!value||value.phase!=='prepared'||value.mutationAttempted)
   throw failure('This update job cannot be submitted again. Check the same job instead.',{beforeMutation:true,requiresReconciliation:Boolean(value)});
  const next={...value,phase:'reconciling',mutationAttempted:true};this.save(next);
  return Object.freeze({job:copy(next),request:Object.freeze({contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:next.jobId,
   targetId:next.targetId,artifact:next.artifact,route:next.route,ownerId:next.ownerId})});
 }
 beginObservation(targetId){
  const value=this.records.get(targetId);
  if(!value||!value.mutationAttempted||value.terminal)throw failure('This update job does not need another status check.',{beforeMutation:true});
  if(value.observationAttempts>=this.maximumObservationAttempts)
   throw failure('This update job needs attention before another automatic check.',{needsAttention:true,beforeMutation:true});
  const next={...value,observationAttempts:value.observationAttempts+1};this.save(next);
  return Object.freeze({contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:next.jobId,targetId:next.targetId,
   artifact:next.artifact,route:next.route,ownerId:next.ownerId,afterRevision:next.revision});
 }
 applySnapshot(targetId,input){
  const value=this.records.get(targetId);if(!value||!value.mutationAttempted)throw failure('No submitted update job matches this status.',{requiresReconciliation:true});
  const snapshot=normalizeUpdateJobSnapshot(input);if(!sameUpdateJobTuple(value,snapshot))
   throw failure('The returned update job does not match the requested job.',{requiresReconciliation:true,conflict:true});
  const fingerprint=updateJobSnapshotFingerprint(snapshot);
  if(value.revision!==null){
   if(snapshot.revision<value.revision)throw failure('The returned update status is older than the saved status.',{stale:true});
   if(snapshot.revision===value.revision){
    if(value.snapshotFingerprint!==fingerprint)throw failure('The update owner changed an existing job revision.',{requiresReconciliation:true,conflict:true});
    return this.save({...value,observationAttempts:0,error:snapshot.error});
   }
   const prior=normalizeUpdateJobSnapshot(value);if(!validUpdateJobTransition(prior,snapshot))
    throw failure('The returned update status is not a valid forward transition.',{requiresReconciliation:true,conflict:true});
  }
  return this.save({...value,...snapshot,mutationAttempted:true,observationAttempts:0,snapshotFingerprint:fingerprint});
 }
 recordObservationFailure(targetId,error){
  const value=this.records.get(targetId);if(!value||value.terminal||value.phase==='prepared')return value?copy(value):null;
  const normalized=normalizeUpdateError({code:error?.code||'status-unavailable',message:error?.message||'The update owner did not return a status.'});
  if(value.phase==='reconciling'&&value.observationAttempts>=this.maximumObservationAttempts)
   return this.save({...value,phase:'needs-attention',error:normalized});
  if(value.phase==='reconciling'||value.phase==='needs-attention')return this.save({...value,error:normalized});
  return copy(value);
 }
 retryObservation(targetId){
  const value=this.records.get(targetId);if(!value||!value.mutationAttempted||value.terminal)throw failure('This update job cannot be checked again.',{beforeMutation:true});
  return this.save({...value,phase:value.phase==='needs-attention'?'reconciling':value.phase,observationAttempts:0,error:null});
 }
 jobsNeedingObservation(){
  return [...this.records.values()].filter(value=>value.mutationAttempted&&!value.terminal&&value.observationAttempts<this.maximumObservationAttempts).map(copy);
 }
 view(targetId){return updateJobView(this.records.get(targetId),{maximumObservationAttempts:this.maximumObservationAttempts});}
}
