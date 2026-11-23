import {UPDATE_JOB_CONTRACT_VERSION,isUpdateJobId,isUpdateTargetId,normalizeUpdateArtifact,
 normalizeUpdateJobSnapshot,normalizeUpdateOwner} from './update-job-contract.js';

const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const firmwareVersion=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&
 value.split('.').every(part=>integer(Number(part),0,65535));
const fail=message=>Object.assign(Error(message),{invalidRead:true});
const frozen=value=>Object.freeze(value);

const routeNames=Object.freeze({1:'internet',2:'targeted-bridge'});
const phases=Object.freeze({
 internet:Object.freeze({1:'accepted',2:'downloading',3:'downloading',4:'installing',5:'succeeded',6:'failed',7:'failed'}),
 'targeted-bridge':Object.freeze({1:'accepted',2:'offering',3:'transferring',4:'awaiting-verification',5:'succeeded',6:'failed',7:'failed'})
});
const lampErrors=Object.freeze({
 1:'The lamp is offline.',2:'The lamp could not set its clock.',3:'The lamp cannot reach the update server.',
 4:'The lamp rejected the update manifest.',5:'This update needs a USB partition upgrade.',
 6:'Firmware verification or download failed.',7:'The lamp could not save update settings.',
 8:'The lamp did not have enough memory for the update.',9:'The saved transfer was interrupted before installation.'
});

function sentinel(value){
 const tupleEmpty=value.jobId===''&&value.targetId===''&&value.ownerId===''&&value.route===0&&value.target==='0.0.0'&&
  value.sha256===''&&value.size===0&&value.error===0&&value.revision===0&&value.confirmedBytes===0&&value.totalBytes===0;
 if(!tupleEmpty)return null;
 if(value.storageReady&&value.state===0&&!value.terminal)return 'empty';
 if(!value.storageReady&&value.state===7&&value.terminal)return 'storage-unavailable';
 return null;
}

function expectedRoute(value){
 if(value===undefined)return undefined;
 if(value===1||value==='internet')return 'internet';
 if(value===2||value==='targeted-bridge')return 'targeted-bridge';
 throw fail('Invalid expected update-job route.');
}

// Strictly adapts the lamp's bounded C++ JSON projection into the app-owned
// Update Job v2 contract. Parsing a bridge record is read-only: the direct
// request encoder below accepts only the lamp-owned Internet route.
export function parseLampUpdateJobV2(value,{allowEmpty=false,jobId,targetId,ownerId,route,version,sha256,size}={}){
 if(!value||value.version!==2||typeof value.storageReady!=='boolean'||!integer(value.state,0,7)||
  !integer(value.error,0,255)||!integer(value.revision,0,0xfffffffe)||!integer(value.confirmedBytes,0,2031616)||
  !integer(value.totalBytes,0,2031616)||!integer(value.size,0,2031616)||typeof value.terminal!=='boolean')
  throw fail('Invalid lamp update-job status.');
 const kind=sentinel(value);
 if(kind){
  if(!allowEmpty)throw fail('The lamp has no matching update job.');
  return frozen({...value,kind,normalized:null});
 }
 if(!value.storageReady||value.state===0||!isUpdateJobId(value.jobId)||!isUpdateTargetId(value.targetId)||
  !isUpdateTargetId(value.ownerId)||!routeNames[value.route]||!firmwareVersion(value.target)||!digest(value.sha256)||value.revision<1)
  throw fail('Invalid lamp update-job identity or artifact.');
 const routeName=routeNames[value.route];
 const wantedRoute=expectedRoute(route);
 if(size!==undefined&&!integer(size,288,2031616))throw fail('Invalid expected update-job artifact.');
 if(jobId!==undefined&&value.jobId!==jobId||targetId!==undefined&&value.targetId!==targetId||
  ownerId!==undefined&&value.ownerId!==ownerId||wantedRoute!==undefined&&routeName!==wantedRoute||
  version!==undefined&&value.target!==version||sha256!==undefined&&value.sha256!==sha256)
  throw Object.assign(Error('This update-job status belongs to a different immutable request.'),{identity:true,confirmed:true});
 // A one-time v1-to-v2 migration can preserve an Accepted, Checking, or
 // pre-manifest Failed job whose exact image size was never recorded. It is
 // observable for safe recovery, but is never promoted to an exact v2 tuple.
 const legacyJob=value.size===0&&value.totalBytes===0&&value.confirmedBytes===0&&value.route===1&&value.ownerId===value.targetId&&
  [1,2,6].includes(value.state)&&value.terminal===(value.state===6)&&value.state===6===(value.error>0);
 if(legacyJob){
  // A terminal pre-manifest failure proves that this same immutable request
  // never reached installation even though the v1 record did not retain size.
  // Keep it outside the normal v2 contract, but expose a bounded read-only
  // receipt that can safely settle the matching app journal without a replay.
  if(value.state===6)return frozen({...value,kind:'legacy-failed',reconciliationRequired:false,normalized:null,
   receipt:frozen({outcome:'installation-not-started',installedVersion:null})});
  if(size!==undefined)throw Object.assign(Error('A migrated active job cannot confirm the exact artifact. Check it without replaying the request.'),
   {requiresReconciliation:true,confirmed:true});
  return frozen({...value,kind:'legacy-job',reconciliationRequired:true,normalized:null});
 }
 if(size!==undefined&&value.size!==size)
  throw Object.assign(Error('This update-job status belongs to a different immutable request.'),{identity:true,confirmed:true});
 if(!integer(value.size,288,2031616)||value.totalBytes!==value.size||!integer(value.confirmedBytes,0,value.size))
  throw fail('Invalid lamp update-job artifact or progress.');
 const phase=phases[routeName][value.state];
 if(!phase||routeName==='internet'&&value.ownerId!==value.targetId||
  value.terminal!==(value.state>=5)||value.state===6!==(value.error>0)||value.state!==6&&value.error!==0||
  value.state<=2&&value.confirmedBytes!==0||[4,5,7].includes(value.state)&&value.confirmedBytes!==value.size)
  throw fail('Invalid lamp update-job state.');
 // Uncertain is the persisted result of losing confirmation after commit. It
 // is not a failed receipt and must keep the tuple fenced until installed
 // firmware is reconciled independently.
 if(value.state===7)return frozen({...value,kind:'uncertain',reconciliationRequired:true,normalized:null});
 let receipt=null,error=null;
 if(value.state===5)receipt=frozen({outcome:'installed',installedVersion:value.target});
 else if(value.state===6){
  receipt=frozen({outcome:'installation-not-started',installedVersion:null});
  error=frozen({code:'lamp-update-error-'+value.error,message:lampErrors[value.error]||'The lamp could not start or finish the update.'});
 }
 const normalized=normalizeUpdateJobSnapshot({contractVersion:UPDATE_JOB_CONTRACT_VERSION,jobId:value.jobId,targetId:value.targetId,
  artifact:{version:value.target,size:value.size,sha256:value.sha256},route:routeName,ownerId:value.ownerId,
  revision:value.revision,phase,confirmedBytes:value.confirmedBytes,totalBytes:value.totalBytes,terminal:value.terminal,receipt,error});
 return frozen({...value,kind:'job',normalized});
}

// This encoder is intentionally narrower than the parser. Bridge jobs must be
// submitted to the selected bridge's authenticated endpoint, never to the
// target lamp's Internet-job endpoint.
export function lampUpdateJobV2Body({jobId,targetId,ownerId,route,version,sha256,size}={}){
 if(!isUpdateJobId(jobId)||!isUpdateTargetId(targetId))throw Object.assign(Error('Invalid update-job identity.'),{beforeMutation:true});
 const routeName=expectedRoute(route);
 if(routeName!=='internet')throw Object.assign(Error('The direct lamp endpoint accepts only lamp-owned Internet jobs.'),{beforeMutation:true});
 normalizeUpdateOwner(routeName,ownerId,targetId);
 const artifact=normalizeUpdateArtifact({version,size,sha256});
 return new URLSearchParams([['jobId',jobId],['targetId',targetId],['ownerId',ownerId],['route','1'],
  ['version',artifact.version],['sha256',artifact.sha256],['size',String(artifact.size)]]).toString();
}
