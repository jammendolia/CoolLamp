import {compareFirmwareVersions,parsePhoneManifest} from './bluetooth-firmware.js';

export const FIRMWARE_ATTEMPT_KEY='coollamp-firmware-attempts-v1';
export const FIRMWARE_ATTEMPT_LIMIT=32;
const STORAGE_LIMIT=32768,WRITE_LIMIT=32,SNAPSHOT_LIMIT=24;
const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const version=value=>{try{return typeof value==='string'&&compareFirmwareVersions(value,value)===0;}catch{return false;}};
const terminal=new Set(['installed','installationNotStarted','transferStopped']);
const outcomes=new Set([...terminal,'pending','unresolved','active','differentVersion']);
const failure=(message,fields={})=>Object.assign(Error(message),{confirmed:true,...fields});
const copy=value=>Object.freeze({...value});
const pending=value=>!terminal.has(value.outcome);
const delayDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cleanupOwners=new Map();
const acquisitionOwners=new Map(),workerOwners=new Map();

// Phase 2 can leave the loop's automatic installer armed. The BLE receiver's
// idle phase does not reserve that updater or prove it cannot start next turn.
export function firmwareMayInstall(firmware){
 if([1,3,4].includes(firmware?.phase))return true;
 if(firmware?.phase!==2||firmware.automatic!==true||firmware.available!==true)return false;
 try{return compareFirmwareVersions(firmware.latest,firmware.version)>0;}catch{return true;}
}

function artifact(value){
 const parsed=parsePhoneManifest(value?.text);
 if(parsed.version!==value.version||parsed.size!==value.size||parsed.sha256!==value.sha256)
  throw failure('The selected firmware changed. Nothing was sent.');
 return parsed;
}
function restored(value){
 if(!value||!canonical(value.identity)||typeof value.attemptId!=='string'||!/^[0-9a-f]{32}$/.test(value.attemptId))throw Error('Invalid update attempt.');
 const parsed=artifact(value);
 const result={identity:value.identity,attemptId:value.attemptId,...parsed,session:value.session,
  offset:value.offset,outcome:value.outcome??'pending',safetyVersion:value.safetyVersion??0,writes:value.writes??1,
  checkpoint:value.checkpoint??Math.floor(value.offset*10/parsed.size),lastOperation:value.lastOperation??null,commitSequence:value.commitSequence??null};
 for(const field of ['metadataIssued','beginAttempted','commitAttempted']){
  if(typeof value[field]!=='boolean')throw Error('Invalid update safety boundary.');result[field]=value[field];
 }
 // Additive v1 fields default to false. Unknown fields are never exposed/stored.
 for(const field of ['dataIssued','cancelAttempted','resumeAttempted','wifiCheckAttempted','wifiInstallAttempted','reinstall','commitAcknowledged','commitUnconfirmed']){
  if(value[field]!==undefined&&typeof value[field]!=='boolean')throw Error('Invalid update safety boundary.');result[field]=value[field]??false;
 }
 if(result.session!==null&&!integer(result.session,1,0xffffffff)||!integer(result.offset,0,parsed.size)||
  !integer(result.safetyVersion,0,32)||!integer(result.writes,1,WRITE_LIMIT+1)||!integer(result.checkpoint,0,10)||result.checkpoint!==Math.floor(result.offset*10/parsed.size)||
  !outcomes.has(result.outcome)||result.lastOperation!==null&&!([1,2,3,4,5,6,7,'wifi-check','wifi-install'].includes(result.lastOperation))||
  result.commitAttempted&&!result.beginAttempted||result.dataIssued&&!result.beginAttempted||
  result.beginAttempted&&result.session===null||result.wifiInstallAttempted&&result.beginAttempted||
  result.commitAcknowledged&&!result.commitAttempted||result.commitUnconfirmed&&terminal.has(result.outcome)||
  result.commitSequence!==null&&(!result.commitAttempted||!integer(result.commitSequence,1,65535)))
  throw Error('Invalid update attempt.');
 return result;
}

// This journal stores intent/proof boundaries, never authority or firmware bytes.
// Every safety write completes and is read back before the caller may transmit.
export class FirmwareAttemptJournal {
 constructor(storage){
  this.storage=storage;this.records=new Map();this.healthy=true;this.storageError='';
  try{
   if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')throw Error('Storage unavailable.');
   const text=storage.getItem(FIRMWARE_ATTEMPT_KEY);if(text===null||text===undefined)return;
   if(typeof text!=='string'||text.length>STORAGE_LIMIT)throw Error('Invalid journal.');
   const value=JSON.parse(text);
   if(value?.version!==1||!Array.isArray(value.records)||value.records.length>FIRMWARE_ATTEMPT_LIMIT)throw Error('Unsupported journal.');
   for(const row of value.records){const record=restored(row);if(this.records.has(record.identity))throw Error('Duplicate target.');this.records.set(record.identity,record);}
  }catch{
   this.records.clear();this.healthy=false;this.storageError='Previous update status could not be read. Check your lamps before starting another update.';
  }
 }
 get(identity){const value=this.records.get(identity);return value?copy(value):null;}
 pending(){return [...this.records.values()].filter(pending).map(copy);}
 require(attempt){
  if(!this.healthy)throw failure(this.storageError,{journalFailure:true,beforeMutation:true});
  const value=this.records.get(attempt?.identity);
  if(!value||value.attemptId!==attempt?.attemptId||!pending(value))throw failure('This update attempt changed. Check your lamp before trying again.',{stale:true,beforeMutation:true});
  return value;
 }
 persist(records){
  const text=JSON.stringify({version:1,records:[...records.values()]});
  if(text.length>STORAGE_LIMIT)throw failure('Update status exceeds the supported size.',{journalFailure:true,beforeMutation:true});
  try{this.storage.setItem(FIRMWARE_ATTEMPT_KEY,text);if(this.storage.getItem(FIRMWARE_ATTEMPT_KEY)!==text)throw Error('Write not retained.');}
  catch{throw failure('The next update step was not sent because its status could not be saved. Check your lamp before trying again.',{journalFailure:true,beforeMutation:true});}
  this.records=records;
 }
 save(value,next,{terminalWrite=false}={}){
  if(value.writes>=WRITE_LIMIT&&!terminalWrite)throw failure('Update status reached its write limit. Check your lamp before trying again.',{journalFailure:true,beforeMutation:true});
  next={...next,writes:value.writes+1};const records=new Map(this.records);records.set(next.identity,next);this.persist(records);return copy(next);
 }
 begin(identity,manifest,{reinstall=false}={}){
  if(!this.healthy)throw failure(this.storageError,{journalFailure:true,beforeMutation:true});
  if(!canonical(identity))throw failure('The update target is invalid. Nothing was sent.');
  if(typeof reinstall!=='boolean')throw failure('Choose a valid firmware repair action. Nothing was sent.');
  const parsed=artifact(manifest),existing=this.records.get(identity);
  if(existing&&pending(existing))throw failure('Check this lamp’s previous update before starting another.',{requiresReconciliation:true,beforeMutation:true});
  const records=new Map(this.records);
  if(!existing&&records.size>=FIRMWARE_ATTEMPT_LIMIT){
   const removable=[...records.values()].find(record=>!pending(record));
   if(!removable)throw failure('Check a pending lamp update before starting another.',{journalFull:true,beforeMutation:true});
   records.delete(removable.identity);
  }
  const bytes=crypto.getRandomValues(new Uint8Array(16)),attemptId=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const result={identity,attemptId,...parsed,session:null,metadataIssued:false,beginAttempted:false,commitAttempted:false,
   dataIssued:false,cancelAttempted:false,resumeAttempted:false,wifiCheckAttempted:false,wifiInstallAttempted:false,
   offset:0,outcome:'pending',safetyVersion:0,writes:1,checkpoint:0,lastOperation:null,reinstall,commitAcknowledged:false,commitSequence:null,commitUnconfirmed:false};
  records.set(identity,result);this.persist(records);return copy(result);
 }
 beforeWrite(attempt,operation,session){
  const value=this.require(attempt),event=typeof operation==='number'?{operation,session}:operation;
  const op=event?.operation;
  if(!integer(op,1,7)||!integer(event.session,1,0xffffffff)||
   event.version!==undefined&&event.version!==value.version||event.size!==undefined&&event.size!==value.size||
   event.sha256!==undefined&&event.sha256!==value.sha256||value.session!==null&&value.session!==event.session)
   throw failure('The original lamp or firmware attempt changed. The next update step was not sent.',{beforeMutation:true});
  if(value.commitUnconfirmed)throw failure('The final installation needs confirmation before another update can start.',{requiresReconciliation:true,uncertain:true,commitUnconfirmed:true,beforeMutation:true});
  if(value.wifiInstallAttempted)throw failure('The Wi-Fi installation needs confirmation before another update route can start.',{requiresReconciliation:true,beforeMutation:true});
  if(value.commitAttempted||value.cancelAttempted)throw failure('This firmware attempt has already ended. Check your lamp before trying again.',{requiresReconciliation:true,beforeMutation:true});
  if(op===1&&value.beginAttempted||[2,6].includes(op)&&(!value.metadataIssued||value.beginAttempted)||
   op===3&&!value.beginAttempted||op===4&&!value.beginAttempted||op===7&&(!value.beginAttempted||value.resumeAttempted))
   throw failure('This update step is out of order. Nothing was sent.',{beforeMutation:true});
  const next={...value,session:event.session,lastOperation:op};
  if(op===1)next.metadataIssued=true;
  if([2,6,7].includes(op))next.beginAttempted=true;
  if(op===3)next.dataIssued=true;
  if(op===4){
   if(event.sequence!==undefined&&!integer(event.sequence,1,65535))throw failure('The final update request is invalid.',{beforeMutation:true});
   next.commitAttempted=true;next.commitSequence=event.sequence??null;
  }
  if(op===5)next.cancelAttempted=true;
  if(op===7)next.resumeAttempted=true;
  // Thousands of consecutive metadata/data chunks do not cause journal writes.
  if(Object.keys(next).every(key=>next[key]===value[key]))return copy(value);
  next.safetyVersion=value.safetyVersion+1;return this.save(value,next);
 }
 beforeWifi(attempt,path){
  const value=this.require(attempt);
  if(!['/api/firmware/check','/api/firmware/install'].includes(path)||value.commitUnconfirmed||value.beginAttempted||value.commitAttempted||value.wifiInstallAttempted)
   throw failure('The original update route needs confirmation. Nothing was sent.',{requiresReconciliation:true,beforeMutation:true});
  const install=path==='/api/firmware/install';
  if(!install&&value.wifiCheckAttempted)throw failure('The update check was already sent. Check your lamp before trying again.',{requiresReconciliation:true,beforeMutation:true});
  return this.save(value,{...value,wifiCheckAttempted:value.wifiCheckAttempted||!install,wifiInstallAttempted:install,
   lastOperation:install?'wifi-install':'wifi-check',safetyVersion:value.safetyVersion+1});
 }
 confirmCommit(attempt,receipt){
  const value=this.require(attempt);
  if(!value.commitAttempted||value.session===null||!receipt||receipt.session!==value.session||receipt.size!==value.size||
   receipt.offset!==value.size||receipt.phase!==4||receipt.error!==0||receipt.committed!==true||!integer(receipt.ack,1,65535)||
   value.commitSequence!==null&&receipt.ack!==value.commitSequence)
   throw failure('The lamp did not confirm this final update request.',{requiresReconciliation:true});
  if(value.commitAcknowledged)return copy(value);
  try{return this.save(value,{...value,commitAcknowledged:true,safetyVersion:value.safetyVersion+1});}
  catch(error){throw failure('Your lamp confirmed the update, but this phone could not save that confirmation. Check your lamp before another update.',
   {journalFailure:true,commitAcknowledged:true,beforeMutation:false,cause:error});}
 }
 noteCommitUnconfirmed(attempt){
  const value=this.require(attempt);
  if(value.commitUnconfirmed)return copy(value);
  // Like a terminal receipt, this safety observation may use the final bounded
  // write after normal progress checkpoints have consumed their allowance.
  try{return this.save(value,{...value,commitUnconfirmed:true,safetyVersion:value.safetyVersion+1},{terminalWrite:true});}
  catch(error){throw failure('The final installation is not confirmed, and this phone could not save that status. Keep your lamp powered while we check it.',
   {journalFailure:true,uncertain:true,commitUnconfirmed:true,requiresReconciliation:true,beforeMutation:false,cause:error});}
 }
 noteProgress(attempt,progress){
  const value=this.require(attempt),offset=typeof progress==='number'?progress:progress?.acknowledgedBytes??progress?.offset;
  if(!integer(offset,0,value.size)||offset<value.offset||!value.beginAttempted)return copy(value);
  const next={...value,offset},checkpoint=Math.floor(offset*10/value.size);
  if(checkpoint>value.checkpoint)return this.save(value,{...next,checkpoint});
  // Exact progress is volatile between ten-percent durable checkpoints.
  const records=new Map(this.records);records.set(value.identity,next);this.records=records;return copy(next);
 }
 abandonUnstarted(attempt){
  const value=this.require(attempt);
  if(['metadataIssued','beginAttempted','commitAttempted','commitUnconfirmed','wifiCheckAttempted','wifiInstallAttempted','dataIssued','cancelAttempted','resumeAttempted'].some(field=>value[field]))
   throw failure('This update needs a lamp status check before another attempt.',{requiresReconciliation:true});
  const saved=this.save(value,{...value,outcome:'installationNotStarted'},{terminalWrite:true});
  return Object.freeze({...saved,pending:false,safeRetry:true,safeExplicitRetry:true,message:'Nothing was sent to your lamp.'});
 }
 settle(attempt,result){
  const value=this.require(attempt);
  if(!result||!outcomes.has(result.outcome)||result.attemptId!==value.attemptId||result.identity!==value.identity||
   result.safetyVersion!==value.safetyVersion)throw failure('This lamp check belongs to an older update attempt.',{stale:true});
  if(!terminal.has(result.outcome))return result.commitUnconfirmed===true?this.noteCommitUnconfirmed(value):copy(value);
  const installed=result.outcome==='installed';
  if(value.commitUnconfirmed||result.commitUnconfirmed===true||!result.controlResponsive||!version(result.installedVersion)||result.firmwareMayInstall===true||
   installed&&(result.installedVersion!==value.version||result.receiverInactive!==true||value.reinstall&&!value.commitAcknowledged)||
   !installed&&(value.commitAttempted||value.wifiInstallAttempted||result.receiverInactive!==true||
    (compareFirmwareVersions(result.installedVersion,value.version)>=0&&!(value.reinstall&&result.installedVersion===value.version))||
    result.outcome==='installationNotStarted'&&value.beginAttempted||result.outcome==='transferStopped'&&!value.beginAttempted))
   throw failure('The lamp did not confirm a safe update outcome.',{requiresReconciliation:true});
  return this.save(value,{...value,outcome:result.outcome}, {terminalWrite:true});
 }
}

function snapshot(value,attempt){
 if(value?.identity!==attempt.identity)throw failure('This connection belongs to a different lamp.',{identity:true});
 const state=value.state,fw=value.firmware,receiver=value.receiver;
 if(!state||!integer(state.mode,1,255)||!integer(state.effectCount,1,255)||state.mode>state.effectCount||
  !integer(state.brightness,1,255)||typeof state.power!=='boolean'||!version(fw?.version)||!integer(fw.phase,0,5)||
  fw.automatic!==undefined&&typeof fw.automatic!=='boolean'||fw.available!==undefined&&typeof fw.available!=='boolean'||
  fw.latest!==undefined&&!version(fw.latest)||
  !receiver||!integer(receiver.phase,0,5)||!integer(receiver.error,0,9)||typeof receiver.committed!=='boolean'||
  receiver.commitUnconfirmed!==undefined&&typeof receiver.commitUnconfirmed!=='boolean'||
  !integer(receiver.session,0,0xffffffff)||!integer(receiver.size,0,2031616)||!integer(receiver.offset,0,receiver.size)||
  receiver.committed&&receiver.phase!==4||receiver.phase===4&&(!receiver.committed||receiver.size===0||receiver.offset!==receiver.size)||
  receiver.commitUnconfirmed&&(receiver.phase!==5||receiver.error!==6||receiver.committed||receiver.session===0||receiver.size<288||receiver.offset!==receiver.size))
  throw failure('The lamp’s update status could not be verified.',{invalidRead:true});
 return value;
}
function outcome(attempt,value){
 const base={identity:attempt.identity,attemptId:attempt.attemptId,safetyVersion:attempt.safetyVersion,
  outcome:'unresolved',pending:true,safeRetry:false,safeExplicitRetry:false,controlResponsive:Boolean(value),
  installedVersion:value?.firmware.version??null,commitUnconfirmed:Boolean(attempt.commitUnconfirmed||value?.receiver.commitUnconfirmed),
  receiverInactive:Boolean(value&&!attempt.commitUnconfirmed&&!value.receiver.commitUnconfirmed&&[0,5].includes(value.receiver.phase)),
  firmwareMayInstall:Boolean(value&&firmwareMayInstall(value.firmware)),
  message:'The connection was lost. We’ll check your lamp when it is available.'};
 if(!value)return Object.freeze(base);
 // Binary BLE status supplies no boot nonce, running image digest or health
 // proof. Keep this additive fence even after a reboot clears the receiver;
 // version equality alone cannot resolve a possibly executed boot selection.
 if(base.commitUnconfirmed)return Object.freeze({...base,
  message:'The final installation is not confirmed. Keep your lamp powered while we check which software is installed.'});
 if(value.firmware.phase===2&&base.firmwareMayInstall)return Object.freeze({...base,receiverInactive:false,automaticInstallPossible:true,
  message:'Your lamp may start its automatic update. We’ll check its status before another update.'});
 const busy=[1,3,4].includes(value.firmware.phase),inactive=base.receiverInactive&&!busy;
 const comparison=compareFirmwareVersions(value.firmware.version,attempt.version);
 if(comparison===0&&inactive){
  if(attempt.reinstall&&!attempt.commitAcknowledged){
   if(!attempt.commitAttempted&&!attempt.wifiInstallAttempted)return Object.freeze({...base,
    outcome:attempt.beginAttempted?'transferStopped':'installationNotStarted',pending:false,safeRetry:true,safeExplicitRetry:true,
    message:attempt.beginAttempted?'The repair transfer stopped. Your lamp is still on its previous firmware.':'The repair did not start. Your lamp is unchanged.'});
   return Object.freeze({...base,message:'The firmware repair is not confirmed. We’ll check your lamp before another update.'});
  }
  return Object.freeze({...base,outcome:'installed',pending:false,message:'Your lamp is updated.',
   verification:'installed-version-and-protected-control',artifactDigestVerified:false,bootHealthVerified:false});
 }
 if(comparison>0)return Object.freeze({...base,outcome:'differentVersion',message:'Your lamp reports different firmware. Check its version before another update.'});
 if(!inactive){
  if(!attempt.session||value.receiver.session!==attempt.session||value.receiver.size!==attempt.size)
   return Object.freeze({...base,message:'Another update may be active on this lamp. We’ll check its status before trying again.'});
  return Object.freeze({...base,outcome:'active',message:'Checking your lamp…',offset:value.receiver.offset,
   progress:Math.floor(value.receiver.offset*100/attempt.size)});
 }
 if(attempt.commitAttempted||attempt.wifiInstallAttempted)return Object.freeze({...base,
  message:'The installation is not confirmed. We’ll check your lamp again before another update.'});
 return Object.freeze({...base,outcome:attempt.beginAttempted?'transferStopped':'installationNotStarted',pending:false,
  safeRetry:true,safeExplicitRetry:true,message:attempt.beginAttempted?'The transfer stopped. Your lamp is still on its previous firmware.':'The update did not start. Your lamp is unchanged.',
  offset:value.receiver.session===attempt.session&&value.receiver.size===attempt.size?value.receiver.offset:attempt.offset});
}

// Direct callers must supply a just-completed protected read, never a cached
// card. A missing/stale wall-clock stamp cannot provide a terminal proof.
export function classifyFirmwareSnapshot(attempt,snapshotValue,{now=Date.now,maxAgeMs=5000}={}){
 const value=restored(attempt),observed=snapshot(snapshotValue,value),time=now();
 if(!integer(maxAgeMs,1,5000)||!Number.isFinite(time)||!Number.isFinite(observed.observedAt)||
  time<observed.observedAt||time-observed.observedAt>maxAgeMs)
  return Object.freeze({...outcome(value,null),staleSnapshot:true,message:'Your lamp needs a fresh status check before another update.'});
 return outcome(value,observed);
}

// All operations here are reads. This worker never invokes a sender, updater,
// cancel command, provisioning, settings/catalog RPC, or a different route.
export async function reconcileFirmwareAttempt({attempt,...options}={}){
 const value=restored(attempt);
 return reconcileProtectedFirmware({...options,value,classify:observed=>classifyFirmwareSnapshot(value,observed),unknown:()=>outcome(value,null)});
}

function legacyReceipt(receipt){
 const identity=receipt?.identity??receipt?.id;
 if(!canonical(identity)||receipt.identity!==undefined&&receipt.id!==undefined&&receipt.identity!==receipt.id||
  !version(receipt?.targetVersion)||!['verified-restarting','verification-required'].includes(receipt?.outcome)||
  receipt.commitUnconfirmed!==undefined&&typeof receipt.commitUnconfirmed!=='boolean')
  throw failure('This older update needs its original saved receipt before checking the lamp.',{invalidReceipt:true});
 // Old feedback did not pin an artifact/session. Never invent either here.
 return Object.freeze({identity,targetVersion:receipt.targetVersion,outcome:receipt.outcome,...(receipt.commitUnconfirmed===true?{commitUnconfirmed:true}:{})});
}
function legacyOutcome(receipt,value){
 const base={identity:receipt.identity,targetVersion:receipt.targetVersion,legacyReceipt:true,
  outcome:'unresolved',pending:true,safeRetry:false,safeExplicitRetry:false,controlResponsive:Boolean(value),
  installedVersion:value?.firmware.version??null,commitUnconfirmed:Boolean(receipt.commitUnconfirmed||value?.receiver.commitUnconfirmed),
  receiverInactive:Boolean(value&&!receipt.commitUnconfirmed&&!value.receiver.commitUnconfirmed&&[0,5].includes(value.receiver.phase)),
  firmwareMayInstall:Boolean(value&&firmwareMayInstall(value.firmware)),
  artifactDigestVerified:false,bootHealthVerified:false,
  message:'The earlier update is not confirmed. We’ll check your lamp before another update.'};
 if(!value)return Object.freeze(base);
 if(base.commitUnconfirmed)return Object.freeze({...base,
  message:'The final installation is not confirmed. Keep your lamp powered while we check which software is installed.'});
 if(value.firmware.phase===2&&base.firmwareMayInstall)return Object.freeze({...base,receiverInactive:false,automaticInstallPossible:true,
  message:'Your lamp may start its automatic update. We’ll check its status before another update.'});
 if(!base.receiverInactive||[1,3,4].includes(value.firmware.phase))return Object.freeze({...base,outcome:'active',message:'Checking your lamp…'});
 if(receipt.outcome==='verified-restarting'&&value.firmware.version===receipt.targetVersion)return Object.freeze({...base,
  outcome:'installed',pending:false,verification:'installed-version-and-protected-control',message:'Your lamp is updated.'});
 return Object.freeze(base);
}
export async function reconcileLegacyFirmwareReceipt({receipt,...options}={}){
 const value=legacyReceipt(receipt);
 const result=await reconcileProtectedFirmware({...options,value,unknown:()=>legacyOutcome(value,null),classify:observed=>{
  snapshot(observed,value);const time=Date.now();
  if(!Number.isFinite(observed.observedAt)||time<observed.observedAt||time-observed.observedAt>5000)
   return Object.freeze({...legacyOutcome(value,null),staleSnapshot:true});
  return legacyOutcome(value,observed);
 }});
 // Without the original session, even observed activity is not this attempt's
 // progress. Keep the old receipt fenced until its narrow proof is satisfied.
 return result.outcome==='active'?Object.freeze({...result,outcome:'unresolved'}):result;
}

async function reconcileProtectedFirmware({value,classify,unknown,acquire,isCurrent=()=>true,signal,onProgress=()=>{},
 delay=delayDefault,now=()=>performance.now(),maxAttempts=3,timeoutMs=45000}={}){
 if(!pending(value)||typeof acquire!=='function'||!integer(maxAttempts,1,3)||!integer(timeoutMs,1,45000))
  throw failure('Invalid lamp update check.');
 const started=now();if(!Number.isFinite(started))throw failure('Invalid lamp update clock.');
 const nativeOwners=new Set([...workerOwners.keys(),...acquisitionOwners.keys(),...cleanupOwners.keys()]);
 if(workerOwners.has(value.identity)||!nativeOwners.has(value.identity)&&nativeOwners.size>=FIRMWARE_ATTEMPT_LIMIT)return unknown();
 const owner={};workerOwners.set(value.identity,owner);
 const controller=new AbortController();let elapsed=0,attempts=0,reads=0,last=null,cancelled=false;
 const external=()=>{cancelled=true;controller.abort('cancelled');};signal?.addEventListener('abort',external,{once:true});if(signal?.aborted)external();
 const deadlineTimer=setTimeout(()=>controller.abort('deadline'),timeoutMs);
 const remaining=()=>{const current=now();if(Number.isFinite(current))elapsed=Math.max(elapsed,current-started);return Math.max(0,timeoutMs-elapsed);};
 const current=()=>{try{return !controller.signal.aborted&&remaining()>0&&isCurrent();}catch{return false;}};
 const check=()=>{if(!current())throw failure('Lamp changed or update check cancelled.',{cancelled:true});};
 const bounded=async operation=>{
  check();let timer,abort;
  try{return await Promise.race([Promise.resolve().then(()=>{check();return operation();}),new Promise((_,reject)=>{
   abort=()=>reject(failure('Lamp update check stopped.',{cancelled:true}));controller.signal.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>reject(failure('Lamp update check timed out.',{timeout:true})),remaining());
  })]);}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
 };
 const cleanup=async lease=>{
  if(!lease)return true;
  let close=cleanupOwners.get(value.identity);
  if(!close){close=Promise.resolve().then(()=>lease.release()).then(()=>true,()=>false);cleanupOwners.set(value.identity,close);
   close.finally(()=>{if(cleanupOwners.get(value.identity)===close)cleanupOwners.delete(value.identity);});}
  let timer;
  try{return await Promise.race([close,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),Math.min(1500,Math.max(1,remaining())));})]);}
  finally{clearTimeout(timer);}
 };
 try{
  const oldAcquisition=acquisitionOwners.get(value.identity);if(oldAcquisition){await bounded(()=>oldAcquisition);check();}
  const previous=cleanupOwners.get(value.identity);if(previous){await bounded(()=>previous);check();}
  while(current()&&attempts<maxAttempts&&reads<SNAPSHOT_LIMIT){
   let lease,expired=false,fatalIdentity=false;attempts++;
   try{
    onProgress({stage:'reconciling',message:'Checking your lamp…',attempts});check();
    const acquisition=Promise.resolve().then(()=>{check();return acquire(copy(value),{signal:controller.signal,isCurrent:current});});
    const settled=acquisition.then(async late=>{if(expired)await cleanup(late);},()=>{});
    acquisitionOwners.set(value.identity,settled);
    settled.finally(()=>{if(acquisitionOwners.get(value.identity)===settled)acquisitionOwners.delete(value.identity);});
    try{lease=await bounded(()=>acquisition);}catch(error){expired=true;throw error;}
    check();if(!lease?.lamp||typeof lease.release!=='function'||typeof lease.lamp.readFirmwareUpdateSnapshot!=='function')throw failure('The lamp’s update status is unavailable.',{invalidRead:true});
    if(lease.lamp.identity!==value.identity)throw failure('This connection belongs to a different lamp.',{identity:true});
    do{
     check();reads++;const observed=await bounded(()=>lease.lamp.readFirmwareUpdateSnapshot({signal:controller.signal,isCurrent:current}));check();
     // This method invocation was awaited under this worker's live owner. Older
     // adapters without a timestamp get one here, never on a cached card path.
     last=classify({...observed,observedAt:observed?.observedAt??Date.now()});
     if(last.outcome!=='active')return Object.freeze({...last,attempts,reads});
     onProgress({stage:'reconciling',message:last.message,attempts,offset:last.offset,progress:last.progress});
     if(reads>=SNAPSHOT_LIMIT)break;await bounded(()=>delay(Math.min(2000,remaining())));
    }while(current());
   }catch(error){
    if(error.identity){fatalIdentity=true;throw error;}
    if(error.cancelled||!current())break;
   }finally{
    const closed=await cleanup(lease);if(closed!==true&&lease&&!fatalIdentity)return Object.freeze({...unknown(),attempts,reads,cleanupPending:closed===null});
   }
   if(current()&&attempts<maxAttempts)await bounded(()=>delay(Math.min(1000*attempts,remaining())));
  }
  if(last?.outcome==='active'&&!cancelled&&(remaining()===0||controller.signal.reason==='deadline'||reads>=SNAPSHOT_LIMIT))
   return Object.freeze({...last,attempts,reads,timedOut:true,message:'Your lamp was still updating at the last check. We’ll check its status again.'});
  return Object.freeze({...unknown(),attempts,reads,cancelled:cancelled||!current()&&controller.signal.reason!=='deadline',
   timedOut:controller.signal.reason==='deadline'||remaining()===0});
 }catch(error){
  if(error.identity)throw error;
  return Object.freeze({...unknown(),attempts,reads,cancelled:cancelled||Boolean(error.cancelled),timedOut:Boolean(error.timeout)});
 }finally{
  clearTimeout(deadlineTimer);signal?.removeEventListener('abort',external);controller.abort('finished');
  if(workerOwners.get(value.identity)===owner)workerOwners.delete(value.identity);
 }
}
