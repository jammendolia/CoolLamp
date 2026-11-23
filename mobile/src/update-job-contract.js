export const UPDATE_JOB_CONTRACT_VERSION=2;
export const UPDATE_JOB_ROUTES=Object.freeze(['internet','targeted-bridge','phone-service']);
export const UPDATE_JOB_REMOTE_PHASES=Object.freeze([
 'accepted','downloading','offering','transferring','installing','restarting','awaiting-verification','verifying','succeeded','failed','cancelled'
]);

const routes=new Set(UPDATE_JOB_ROUTES),remotePhases=new Set(UPDATE_JOB_REMOTE_PHASES);
const terminalPhases=new Set(['succeeded','failed','cancelled']),localPhases=new Set(['prepared','reconciling','needs-attention']);
const phasesByRoute=Object.freeze({
 internet:Object.freeze(['accepted','downloading','installing','restarting','verifying','succeeded','failed','cancelled']),
 'targeted-bridge':Object.freeze(['accepted','offering','transferring','awaiting-verification','succeeded','failed','cancelled']),
 'phone-service':Object.freeze(['accepted','transferring','installing','restarting','verifying','succeeded','failed','cancelled'])
});
const canonicalId=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const canonicalJobId=value=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value);
const canonicalDigest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const boundedString=(value,max=240)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const firmwareVersion=value=>{
 if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))return false;
 return value.split('.').every(part=>integer(Number(part),0,65535));
};
const immutable=value=>Object.freeze(value);

export function normalizeUpdateArtifact(value){
 if(!value||!firmwareVersion(value.version)||!integer(value.size,288,2031616)||!canonicalDigest(value.sha256))
  throw Object.assign(Error('The selected firmware artifact is invalid.'),{beforeMutation:true});
 return immutable({version:value.version,size:value.size,sha256:value.sha256});
}

export function normalizeUpdateOwner(route,ownerId,targetId){
 if(!routes.has(route))throw Object.assign(Error('Choose an update route before starting.'),{beforeMutation:true});
 if(!boundedString(ownerId,64))throw Object.assign(Error('The selected update owner is invalid.'),{beforeMutation:true});
 if(route==='internet'&&ownerId!==targetId)throw Object.assign(Error('A direct Internet update must be owned by the target lamp.'),{beforeMutation:true});
 if(route==='targeted-bridge'&&!canonicalId(ownerId))throw Object.assign(Error('Choose a verified bridge before starting.'),{beforeMutation:true});
 return ownerId;
}

export function normalizeUpdateError(value){
 if(value===null||value===undefined)return null;
 if(!boundedString(value.code,48)||!boundedString(value.message,240))throw Error('Invalid update job error.');
 return immutable({code:value.code,message:value.message});
}

export function normalizeUpdateReceipt(value,phase,artifact){
 if(value===null||value===undefined){if(terminalPhases.has(phase))throw Error('A terminal update job requires a receipt.');return null;}
 if(!terminalPhases.has(phase)||!['installed','installation-not-started','failed','cancelled'].includes(value.outcome))throw Error('Invalid update job receipt.');
 const expected=phase==='succeeded'?'installed':phase==='cancelled'?'cancelled':null;
 if(expected&&value.outcome!==expected||phase==='failed'&&!['installation-not-started','failed'].includes(value.outcome))throw Error('The update receipt does not match its phase.');
 const installedVersion=value.installedVersion??null;
 if(installedVersion!==null&&!firmwareVersion(installedVersion)||value.outcome==='installed'&&installedVersion!==artifact.version)
  throw Error('Invalid installed firmware receipt.');
 return immutable({outcome:value.outcome,installedVersion});
}

export function normalizeUpdateJobSnapshot(value){
 if(!value||value.contractVersion!==UPDATE_JOB_CONTRACT_VERSION||!canonicalJobId(value.jobId)||!canonicalId(value.targetId)||
  !routes.has(value.route)||!integer(value.revision,1,0xfffffffe)||!remotePhases.has(value.phase)||
  typeof value.terminal!=='boolean'||terminalPhases.has(value.phase)!==value.terminal)
  throw Error('Invalid update job snapshot.');
 const artifact=normalizeUpdateArtifact(value.artifact),ownerId=normalizeUpdateOwner(value.route,value.ownerId,value.targetId);
 if(!phasesByRoute[value.route].includes(value.phase))throw Error('The update phase does not match its route.');
 if(value.totalBytes!==artifact.size||!integer(value.confirmedBytes,0,value.totalBytes))throw Error('Invalid update job progress.');
 const receipt=normalizeUpdateReceipt(value.receipt,value.phase,artifact),error=normalizeUpdateError(value.error);
 if(value.phase==='failed'&&!error||value.phase!=='failed'&&error)throw Error('The update error does not match its phase.');
 return immutable({contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:value.jobId,targetId:value.targetId,artifact,
  route:value.route,ownerId,revision:value.revision,phase:value.phase,confirmedBytes:value.confirmedBytes,
  totalBytes:value.totalBytes,terminal:value.terminal,receipt,error});
}

export function sameUpdateJobTuple(left,right){
 return Boolean(left&&right&&left.jobId===right.jobId&&left.targetId===right.targetId&&left.route===right.route&&
  left.ownerId===right.ownerId&&left.artifact?.version===right.artifact?.version&&left.artifact?.size===right.artifact?.size&&
  left.artifact?.sha256===right.artifact?.sha256);
}

export function updateJobSnapshotFingerprint(value){return JSON.stringify(normalizeUpdateJobSnapshot(value));}

export function validUpdateJobTransition(previous,next){
 const before=normalizeUpdateJobSnapshot(previous),after=normalizeUpdateJobSnapshot(next);
 if(!sameUpdateJobTuple(before,after)||after.revision<=before.revision||before.terminal||after.confirmedBytes<before.confirmedBytes)return false;
 const phases=phasesByRoute[after.route];return phases.indexOf(after.phase)>=phases.indexOf(before.phase);
}

export function updateJobView(value,{maximumObservationAttempts=3}={}){
 if(!value||value.contractVersion!==UPDATE_JOB_CONTRACT_VERSION||!localPhases.has(value.phase)&&!remotePhases.has(value.phase))
  return immutable({state:'unavailable',active:false,indeterminate:false,action:null,message:'Update status is unavailable.'});
 const owner=value.route==='internet'?'the lamp':value.route==='targeted-bridge'?'the selected bridge':'this phone';
 if(value.phase==='prepared')return immutable({state:'ready',active:false,indeterminate:false,action:'start',message:'Ready to start through '+owner+'.'});
 if(value.phase==='needs-attention'||value.observationAttempts>=maximumObservationAttempts)
  return immutable({state:'needs-attention',active:false,indeterminate:false,action:'check-status',message:value.error?.message||'Update status needs a check.'});
 if(value.phase==='reconciling')return immutable({state:'reconciling',active:true,indeterminate:true,action:'leave',message:'Waiting for '+owner+' to confirm the same job.'});
 if(value.terminal){
  if(value.phase==='succeeded')return immutable({state:'succeeded',active:false,indeterminate:false,action:null,progress:100,message:'Your lamp is updated.'});
  if(value.phase==='cancelled')return immutable({state:'cancelled',active:false,indeterminate:false,action:null,message:'The update job was cancelled.'});
  return immutable({state:'failed',active:false,indeterminate:false,action:'details',message:value.error?.message||'The update job failed.'});
 }
 const progress=Math.floor(value.confirmedBytes*100/value.totalBytes);
 const messages={accepted:'Update accepted by '+owner+'. You may leave CoolLamp.',downloading:'The update owner is downloading the exact firmware.',
  offering:'The selected bridge is offering the exact firmware to your lamp.',transferring:'The selected bridge or phone is delivering the update.',
  installing:'Your lamp is installing the update.',restarting:'Your lamp is restarting.','awaiting-verification':'The selected bridge is waiting for the lamp to confirm the update.',
  verifying:'Your lamp is verifying the installed firmware.'};
 return immutable({state:value.phase,active:true,indeterminate:value.phase==='accepted'&&value.confirmedBytes===0,action:'leave',progress,
  message:messages[value.phase]||'The update job is running.'});
}

export const isUpdateJobId=canonicalJobId;
export const isUpdateTargetId=canonicalId;
