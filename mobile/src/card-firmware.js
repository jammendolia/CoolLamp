import {compareFirmwareVersions,parsePhoneManifest,fetchPhoneManifest} from './bluetooth-firmware.js';

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
export async function updateCardFirmware({entry,manifest,wifi,acquireBluetooth,download,isCurrent=()=>true,onProgress=()=>{},signal}){
 const release=parsePhoneManifest(manifest.text);
 const current=()=>{if(signal?.aborted||!isCurrent())throw Object.assign(Error('Lamp changed or update cancelled.'),{cancelled:true});};
 current();
 if(entry.address){
  onProgress({stage:'wifi',progress:0});
  try{const result=await wifi(entry,release.version);current();return {...result,path:'wifi'};}
  catch(error){current();if(!error.safeBluetoothFallback||error.uncertain||error.identity||error.stale||error.cancelled)throw error;}
 }
 onProgress({stage:'connecting',progress:0});
 const lease=await acquireBluetooth(entry);
 try{
  current();if(lease.lamp.identity!==entry.id)throw Error('Bluetooth identity does not match this lamp.');
  const installed=await lease.lamp.refreshFirmware();current();
  if([1,3,4].includes(installed.phase))throw Error('The lamp already has an update in progress. Reconnect and check its installed version before retrying.');
  if(compareFirmwareVersions(release.version,installed.version)<=0)return {path:'bluetooth',state:'ready',installedVersion:installed.version,message:'Already up to date.'};
  if(compareFirmwareVersions(installed.version,'1.11.0')<0)throw Error('This lamp needs firmware 1.11.0 installed once using Wi-Fi or USB to enable Bluetooth updates.');
  const packageValue=await download(release,{signal,isCurrent,onProgress});current();
  if(packageValue.manifest.text!==release.text)throw Error('The prepared release changed. Nothing was sent.');
  const result=await lease.lamp.updateOverBluetooth(packageValue,onProgress,{signal});
  return {...result,path:'bluetooth',state:'restarting',message:result.committed?'Firmware verified. Reconnect to confirm the installed version.':'Final result unconfirmed. Reconnect and check the installed version before retrying.'};
 }finally{await lease.release();}
}
