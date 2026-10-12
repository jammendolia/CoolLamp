import {compareFirmwareVersions,parsePhoneManifest,fetchPhoneManifest} from './bluetooth-firmware.js';
import {classifyFirmwareSnapshot,firmwareMayInstall} from './firmware-attempt.js';
import {safeFirmwareTransferMetrics} from './firmware-update-diagnostics.js';

// The lamp's installed-version observation is separate from a public release
// check. A failed or expired release check must never make an old offer fresh.
export class FirmwareReleaseCache {
 constructor(http,{now=Date.now,maxAge=300000}={}){Object.assign(this,{http,now,maxAge});this.manifest=null;this.checkedAt=0;this.verified=false;this.error='';this.run=null;}
 get fresh(){return this.verified&&this.now()-this.checkedAt<this.maxAge;}
 refresh({force=false}={}){
  if(this.run)return this.run;
  if(!force&&this.fresh)return Promise.resolve(this.manifest);
  this.verified=false;this.error='';
  const run=fetchPhoneManifest(this.http).then(manifest=>{this.manifest=manifest;this.checkedAt=this.now();this.verified=true;return manifest;})
   .catch(error=>{this.error=error.message||'Could not check the public firmware release.';throw error;})
   .finally(()=>{if(this.run===run)this.run=null;});
  this.run=run;return run;
 }
}

export function availableCardRelease(installed,manifest){
 try{return compareFirmwareVersions(parsePhoneManifest(manifest?.text).version,installed)>0?manifest:null;}catch{return null;}
}

// A Wi-Fi mutation with an uncertain result must never be replayed over BLE.
// Wi-Fi owns its own identity/token checks; the BLE lease rechecks protected ID.
export async function updateCardFirmware({entry,manifest,wifi,acquireBluetooth,download,isCurrent=()=>true,onProgress=()=>{},signal,
 attemptJournal,attempt,onAttempt=()=>{},reconcile,allowReinstall=false,exactReinstall=false,onFailure=()=>{},onTransferDiagnostic=()=>{}}){
 const release=parsePhoneManifest(manifest.text);
 const current=()=>{if(signal?.aborted||!isCurrent())throw Object.assign(Error('Lamp changed or update cancelled.'),{cancelled:true});};
 if(exactReinstall&&!allowReinstall)throw Object.assign(Error('Confirm a reinstall before sending firmware.'),{confirmed:true,installationNotStarted:true,uncertain:false});
 const verifyReinstallVersion=installed=>{
  if(exactReinstall&&installed.version!==release.version)throw Object.assign(Error('The lamp’s software changed. Nothing was sent. Check its current software before reinstalling.'),
   {confirmed:true,installationNotStarted:true,uncertain:false,stale:true,staleVersion:true,expectedVersion:release.version,installedVersion:installed.version});
 };
 const reportFailure=(error,stage)=>{try{Promise.resolve(onFailure(error,Object.freeze({stage}))).catch(()=>{});}catch{}};
 // Optional evidence must never hold the update owner, alter a receipt, or turn
 // successful installation into a retry. This callback is never awaited.
 const reportTransfer=result=>{try{const value=safeFirmwareTransferMetrics(Object.getOwnPropertyDescriptor(result,'transferDiagnostic')?.value);if(value)Promise.resolve(onTransferDiagnostic(value)).catch(()=>{});}catch{}};
 current();
 // A new, explicitly approved retry may prefer its saved nearby route after
 // the previous attempt was confirmed as never starting an installation.
 // Keep that choice after a phone preflight fails before sending any frame.
 // Read that proof before begin() replaces the terminal journal record. Fresh
 // protected identity, receiver and version checks below remain mandatory.
 const previous=attemptJournal?.get(entry.id);
 const preferBluetoothRetry=!attempt&&typeof entry.deviceId==='string'&&entry.deviceId.length>0&&
  previous?.outcome==='installationNotStarted'&&
  ['wifiInstallAttempted','metadataIssued','beginAttempted','commitAttempted','commitUnconfirmed','dataIssued','cancelAttempted','resumeAttempted']
   .every(field=>previous[field]===false);
 if(attemptJournal){attempt??=attemptJournal.begin(entry.id,release,{reinstall:allowReinstall});onAttempt(attempt);}
 const latest=()=>attemptJournal?.get(entry.id)||attempt;
 const finish=result=>{if(attemptJournal&&attempt)attemptJournal.settle(latest(),result);return result;};
 const unconfirmedCommit=()=>Object.assign(Error('The final installation is not confirmed. Keep your lamp powered while we check which software is installed.'),
  {confirmed:false,commitUnconfirmed:true,uncertain:true,verificationRequired:true,receiverBusy:true,installationNotStarted:false,safeBluetoothFallback:false});
 const checkResult=async failure=>{
  if(failure?.commitUnconfirmed)failure=unconfirmedCommit();
  if(!reconcile||!attemptJournal||!attempt)throw failure;
  current();onProgress({stage:'checking-result'});
  const result=await reconcile(latest(),{entry,signal,isCurrent,onProgress});current();
  return finish({...result,path:'bluetooth'});
 };
 const stopUnstarted=async error=>{
  const value=latest();
  if(error?.commitUnconfirmed){if(attemptJournal&&value)attemptJournal.noteCommitUnconfirmed(value);return checkResult(error);}
  if(attemptJournal&&value&&!value.commitUnconfirmed&&!value.metadataIssued&&!value.wifiCheckAttempted&&!value.wifiInstallAttempted&&!value.beginAttempted&&!value.commitAttempted){
   attemptJournal.abandonUnstarted(value);throw error;
  }
  if(attemptJournal&&reconcile)return checkResult(error);
  throw error;
 };
 const guardReceiver=observed=>{
  if(!observed?.receiver?.commitUnconfirmed)return;
  if(attemptJournal&&attempt)attemptJournal.noteCommitUnconfirmed(latest());
  throw unconfirmedCommit();
 };
 // A receiver may have reached boot selection without this phone sending a
 // frame. Preserve that target's uncertainty before any new route or download.
 if(latest()?.commitUnconfirmed)return checkResult(unconfirmedCommit());
 // A strict reinstall needs protected target proof before any update mutation.
 // The existing allowReinstall repair mode keeps its prior route semantics.
 if(entry.address&&!preferBluetoothRetry&&!exactReinstall){
  onProgress({stage:'wifi',progress:0});
  try{const result=await wifi(entry,release.version);current();
   if(result?.commitUnconfirmed)return stopUnstarted(unconfirmedCommit());
   if(attemptJournal){
    const value=latest();
    if(result.state==='updated'&&result.verified&&result.fresh&&result.id===entry.id&&result.installedVersion===release.version)
     return finish({...result,path:'wifi',outcome:'installed',identity:entry.id,attemptId:value.attemptId,safetyVersion:value.safetyVersion,controlResponsive:true,receiverInactive:true});
    return checkResult(null);
   }
   return {...result,path:'wifi'};
  }
  catch(error){reportFailure(error,'wifi-preflight');current();if(error.commitUnconfirmed)return stopUnstarted(error);
   if(!error.safeBluetoothFallback||error.uncertain||error.identity||error.stale||error.cancelled){
   if(latest()?.wifiInstallAttempted)return checkResult(error);
   return stopUnstarted(error);
  }}
 }
 // A short protected preflight checks eligibility without holding the radio
 // through the phone's potentially slow Internet download.
 onProgress({stage:'connecting',progress:0});
 let preflightFailure;
 for(let retry=0;retry<2;retry++){
 let preflight;
 try{
  preflight=await acquireBluetooth(entry);current();
  if(preflight.lamp.identity!==entry.id)throw Object.assign(Error('This is a different lamp. No update was sent.'),{identity:true});
  const initialFirmware=await preflight.lamp.refreshFirmware();current();
  if(compareFirmwareVersions(initialFirmware.version,'1.11.0')<0)throw Object.assign(Error('This lamp needs a one-time service update before phone updates can work.'),{bootstrapRequired:true});
  const observed=attemptJournal?await preflight.lamp.readFirmwareUpdateSnapshot({signal,isCurrent}):null;
  const installed=observed?.firmware||initialFirmware;current();
  guardReceiver(observed);
  if(firmwareMayInstall(installed))throw Object.assign(Error('Your lamp is already updating. Checking its progress…'),{receiverBusy:true});
  verifyReinstallVersion(installed);
  if(compareFirmwareVersions(release.version,installed.version)<0||!allowReinstall&&compareFirmwareVersions(release.version,installed.version)===0)return attemptJournal?
   finish({...classifyFirmwareSnapshot(latest(),observed),path:'bluetooth',state:'ready'}):
   {path:'bluetooth',state:'ready',version:installed.version,installedVersion:installed.version,message:'Your lamp is up to date.'};
  if(compareFirmwareVersions(installed.version,'1.11.0')<0)throw Object.assign(Error('This lamp needs a one-time service update before phone updates can work.'),{bootstrapRequired:true});
  preflightFailure=null;break;
 }catch(error){
  reportFailure(error,'bluetooth-preflight');
  preflightFailure=error;
  if(error.identity||error.cancelled||error.stale||error.receiverBusy||error.bootstrapRequired||signal?.aborted)break;
  if(retry===0)onProgress({stage:'recovering-connection'});
 }finally{await preflight?.release();}
 }
 if(preflightFailure){
  if(attemptJournal&&reconcile&&preflightFailure.receiverBusy)return checkResult(preflightFailure);
  return stopUnstarted(preflightFailure);
 }
 // Download and verify the approved artifact before taking a Bluetooth lease.
 // Native foreground time spent on the Internet cannot stale this new link.
 let packageValue;
 try{packageValue=await download(release,{signal,isCurrent,onProgress});current();
  if(packageValue.manifest.text!==release.text)throw Error('The prepared release changed. Nothing was sent.');
 }catch(error){reportFailure(error,'phone-download');return stopUnstarted(error);}
 for(let connectionAttempt=0;connectionAttempt<2;connectionAttempt++){
  current();onProgress({stage:connectionAttempt?'recovering-connection':'connecting',progress:0});
  let lease,failure,result,failureStage='bluetooth-preflight';
  try{
  lease=await acquireBluetooth(entry);
  current();if(lease.lamp.identity!==entry.id)throw Object.assign(Error('Bluetooth identity does not match this lamp.'),{identity:true});
  const initialFirmware=await lease.lamp.refreshFirmware();current();
  if(compareFirmwareVersions(initialFirmware.version,'1.11.0')<0)throw Object.assign(Error('This lamp needs a one-time service update before phone updates can work.'),{bootstrapRequired:true});
  const observed=attemptJournal?await lease.lamp.readFirmwareUpdateSnapshot({signal,isCurrent}):null;
  const installed=observed?.firmware||initialFirmware;current();
  guardReceiver(observed);
  if(firmwareMayInstall(installed))throw Object.assign(Error('Your lamp is already updating. Checking its progress…'),{receiverBusy:true});
  verifyReinstallVersion(installed);
  if(compareFirmwareVersions(release.version,installed.version)<0||!allowReinstall&&compareFirmwareVersions(release.version,installed.version)===0)return attemptJournal?
   finish({...classifyFirmwareSnapshot(latest(),observed),path:'bluetooth',state:'ready'}):
   {path:'bluetooth',state:'ready',version:installed.version,installedVersion:installed.version,message:'Your lamp is up to date.'};
  if(compareFirmwareVersions(installed.version,'1.11.0')<0)throw Object.assign(Error('This lamp needs a one-time service update before phone updates can work.'),{bootstrapRequired:true});
  onProgress({stage:'preparing'});
  failureStage='bluetooth-transfer';
  result=await lease.lamp.updateOverBluetooth(packageValue,value=>{
   if(attemptJournal&&Number.isInteger(value.acknowledgedBytes)&&value.stage==='transferring')attemptJournal.noteProgress(latest(),{offset:value.acknowledgedBytes});
   onProgress(value);
   },{signal,isCurrent,...(attemptJournal?{onBeforeWrite:operation=>attemptJournal.beforeWrite(latest(),operation)}:{})});
   reportTransfer(result);
   }catch(error){reportTransfer(error);reportFailure(error,failureStage);failure=error;}
  finally{await lease?.release();}
  current();
  if(result?.commitUnconfirmed){if(attemptJournal&&attempt)attemptJournal.noteCommitUnconfirmed(latest());return checkResult(unconfirmedCommit());}
  if(result){
   if(attemptJournal&&result.receipt){try{attemptJournal.confirmCommit(latest(),result.receipt);}catch(error){reportFailure(error,'bluetooth-transfer');throw error;}}
   if(reconcile&&attemptJournal)return checkResult(null);
   return {...result,path:'bluetooth',state:'restarting',message:'Checking that your lamp finished updating…'};
  }
  if(failure?.staleVersion)return stopUnstarted(failure);
  if(failure?.commitUnconfirmed){if(attemptJournal&&attempt)attemptJournal.noteCommitUnconfirmed(latest());return checkResult(failure);}
  const noFrames=!(latest()?.commitUnconfirmed||latest()?.metadataIssued||latest()?.beginAttempted||latest()?.commitAttempted);
  if(connectionAttempt===0&&noFrames&&(!attemptJournal?failure?.installationNotStarted:true)&&
   !failure?.cancelled&&!failure?.identity&&!failure?.stale&&!failure?.receiverBusy&&!failure?.bootstrapRequired&&!failure?.journalFailure&&!failure?.firmwareBusy)continue;
  if(reconcile&&attemptJournal)return checkResult(failure);
  throw failure;
 }
}
