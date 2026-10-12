// Presentation evidence only: this module never starts, retries or reroutes an
// update. Source comes from written-byte ACKs or a fresh verified target read.
const maxImageBytes=2031616;
const sourceLabels=Object.freeze({bluetooth:'From your phone',internet:'From the internet',donation:'From another trusted lamp','manual-upload':'From your computer'});
export const UPDATE_SOURCE_FRESH_MS=5000;
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
export function updateSourceLabel(source){return typeof source==='string'&&Object.hasOwn(sourceLabels,source)?sourceLabels[source]:null;}

export function acknowledgedBluetoothUpdateSource(value,expectedVersion){
 if(typeof expectedVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(expectedVersion)||value?.version!==expectedVersion||value.stage!=='transferring'||
   !integer(value.total,1,maxImageBytes)||!integer(value.acknowledgedBytes,0,value.total)||
   !integer(value.progress,0,100)||value.progress!==Math.floor(value.acknowledgedBytes*100/value.total))return null;
 return 'bluetooth';
}

function verifiedFirmwareValue(snapshot,target,{verified=false,fresh=false,observedAt=0,now=Date.now()}={}){
 if(typeof target!=='string'||!/^[0-9a-f]{12}$/.test(target)||snapshot?.deviceId!==target||verified!==true||fresh!==true||
   !Number.isFinite(observedAt)||observedAt<=0||!Number.isFinite(now)||now<observedAt||now-observedAt>UPDATE_SOURCE_FRESH_MS)return null;
 return snapshot.firmware??snapshot;
}
export function observedReceiverUpdate(snapshot,target,proof={}){
 const value=verifiedFirmwareValue(snapshot,target,proof);
 // Older browser upload cues reported active ownership without changing the
 // idle phase or knowing the total. Show their source only, never a percentage.
 const legacyManual=value?.route===4&&value.totalBytes===0&&value.phase===0;
 if(value?.updateContractVersion!==2||value.receiver!==true||value.phase!==3&&!legacyManual||!integer(value.totalBytes,0,maxImageBytes)||!integer(value.writtenOffset,0,maxImageBytes))return null;
 // Unknown future routes and manual uploads retain valid confirmed progress,
 // but never acquire an Internet/donation color by association or proximity.
 const source=value.route===1?'internet':value.route===2?'bluetooth':value.route===3?'donation':value.route===4?'manual-upload':null;
 if(value.totalBytes===0)return source==='manual-upload'?Object.freeze({progress:undefined,source}):null;
 if(value.writtenOffset>value.totalBytes||!integer(value.progress,0,100)||value.progress!==Math.floor(value.writtenOffset*100/value.totalBytes))return null;
 return Object.freeze({progress:value.progress,source});
}

const validVersion=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)&&value.split('.').every(part=>integer(Number(part),0,65535));
const compare=(a,b)=>{const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let index=0;index<3;index++)if(left[index]!==right[index])return left[index]>right[index]?1:-1;return 0;};
function automaticService(value){
 const service=value?.automaticService;
 if(service?.version!==1||typeof value.automatic!=='boolean'||!validVersion(value.version)||!integer(value.phase,0,5)||!integer(value.error,0,8)||
   !integer(service.state,0,6)||!integer(service.reason,0,24)||!integer(service.retryInMs,0,21600000)||!integer(service.donorWaitMs,0,30000)||
   !integer(service.internetAttempts,0,65535)||!integer(service.donorOffers,0,65535)||typeof service.attention!=='boolean'||typeof service.phoneFallback!=='boolean'||typeof service.newerSeen!=='boolean')return null;
 return Object.freeze(Object.fromEntries(['version','state','reason','retryInMs','donorWaitMs','internetAttempts','donorOffers','attention','phoneFallback','newerSeen'].map(field=>[field,service[field]])));
}
export function automaticUpdateEvidence(snapshot,target,{latestVersion=null,...proof}={}){
 const value=verifiedFirmwareValue(snapshot,target,proof);
 if(!value||typeof value.automatic!=='boolean'||!validVersion(value.version)||!integer(value.phase,0,5)||!integer(value.error,0,8))return null;
 const service=automaticService(value);
 const record={target,checkedAt:proof.observedAt,automatic:value.automatic,service};
 if(observedReceiverUpdate(snapshot,target,proof))return Object.freeze({...record,kind:'receiving'});
 if(value.phase===4||service?.state===6||service?.reason===24)return Object.freeze({...record,kind:'pending'});
 let latest=validVersion(value.latest)&&value.latest!=='0.0.0'?value.latest:null;
 if(validVersion(latestVersion)&&(!latest||compare(latestVersion,latest)>0))latest=latestVersion;
 if(value.bootHealthy===true&&latest&&compare(value.version,latest)>=0)return Object.freeze({...record,kind:'healthy'});
 if(!service)return null;
 if(value.automatic!==true)return Object.freeze({...record,kind:'disabled'});
 const publicNewer=validVersion(latestVersion)&&compare(latestVersion,value.version)>0;
 const newer=service.newerSeen||Boolean(latest&&compare(latest,value.version)>0);
 const failedAttempt=value.phase===5&&value.error!==0&&service.internetAttempts>0;
 // A receiver without Internet/fleet reach may never learn the newer release.
 // The phone's fresh verified release can offer an explicit phone attempt only
 // after completed donor observation and a concrete transport/resource cause.
 const transportUnavailable=[3,5].includes(service.state)&&service.donorWaitMs===0&&[11,12,13,14,15,16].includes(service.reason);
 const completedUnavailable=publicNewer&&transportUnavailable;
 const kind=service.attention&&(newer||failedAttempt)||completedUnavailable?'attention':'waiting';
 return Object.freeze({...record,kind,offerPhone:kind==='attention'&&transportUnavailable&&(service.phoneFallback||completedUnavailable)});
}
export function automaticUpdateCardMessage(observation,target,{now=Date.now()}={}){
 const evidence=observation?.automaticAttention;
 if(!evidence||evidence.target!==target||observation.automaticEnabled===false||!Number.isFinite(evidence.checkedAt)||evidence.checkedAt<=0)return null;
 const context=observation.automaticContext;
 if(context?.target===target&&context.kind==='waiting'&&([0,2,4,6].includes(context.service?.state)||
   [1,2,3,4,5,6,7,8,9,10,17,18,19,20,21,22,23,24].includes(context.service?.reason)))return null;
 if(evidence.kind==='pending')return 'We’re checking the earlier update. A new update will wait until it is confirmed.';
 if(evidence.kind!=='attention'||!integer(evidence.service?.reason,0,24)||typeof evidence.service.phoneFallback!=='boolean')return null;
 const stale=!Number.isFinite(now)||now<evidence.checkedAt||now-evidence.checkedAt>UPDATE_SOURCE_FRESH_MS;
 if(evidence.offerPhone===true)return (stale?'At the last check, automatic updating needed a hand. ':'Automatic updating needs a hand. ')+
   'Your lamp will keep checking. Tap Update to send it from your phone.';
 const reason=evidence.service.reason;
 const message=reason===20?'This lamp needs a one-time service update before automatic updates can work.':
   [5,6,7,8,23].includes(reason)?'Automatic updating is waiting for this group. No new phone update will start until its group is ready.':
   [17,18,19,21,24].includes(reason)?'The earlier update needs to be checked before another update can start.':
   'Automatic updating is waiting. Keep your lamp powered while it checks again.';
 return (stale?'Last checked: ':'')+message;
}
