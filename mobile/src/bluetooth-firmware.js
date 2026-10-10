import {SERVICE} from './protocol.js';
export const OTA_WRITE='7b61000b-6e2b-4f3d-9a71-28e45c001001';
export const OTA_STATUS='7b61000c-6e2b-4f3d-9a71-28e45c001001';
const root='https://github.com/jammendolia/CoolLamp/releases/';
const version=value=>/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(part=>Number(part)<=65535);
const error=(message,fields={})=>Object.assign(new Error(message),fields);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Hold ownership until a queued native subscribe/unsubscribe has really settled.
// A replacement connection can poll; it must not race an older listener cleanup.
const notificationOwners=new WeakMap();
async function boundedNotification(operation,milliseconds){
 let timer;
 try{return await Promise.race([operation,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(error('Bluetooth notification operation timed out.')),milliseconds);})]);}
 finally{clearTimeout(timer);}
}
export function compareFirmwareVersions(a,b){
 if(!version(a)||!version(b))throw error('Invalid installed firmware version.');
 const left=a.split('.').map(Number),right=b.split('.').map(Number);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return Math.sign(left[i]-right[i]);return 0;
}
export function parsePhoneManifest(text){
 if(typeof text!=='string'||text.length>191)throw error('Invalid firmware manifest.');
 const lines=text.split('\n');
 if(lines.length!==7||lines[6]!==''||lines[0]!=='COOLLAMP-OTA-1'||!version(lines[1])||lines[2]!=='esp32c3'||lines[3]!=='dual-ota-2031616'||!/^[1-9]\d{2,6}$/.test(lines[4])||!/^[a-f0-9]{64}$/.test(lines[5]))throw error('This firmware is incompatible with the lamp.');
 const size=Number(lines[4]);if(size<288||size>2031616)throw error('Firmware does not fit this lamp’s update slot.');
 return Object.freeze({version:lines[1],size,sha256:lines[5],text});
}
function binary(value){
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(value instanceof Uint8Array)return value;
 if(typeof value==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value))return Uint8Array.from(atob(value),byte=>byte.charCodeAt(0));
 throw error('Invalid firmware download response.');
}
export function firmwareBase64(bytes){
 let text='';for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(text);
}
function phoneRequest(http,{isCurrent=()=>true,signal}={}){
 const request=async url=>{
  if(!isCurrent())throw error('Firmware download cancelled.',{cancelled:true});
  if(signal?.aborted)throw error('Firmware download cancelled.',{cancelled:true});
  let abort;
  const stopped=new Promise((resolve,reject)=>{abort=()=>reject(error('Firmware download cancelled.',{cancelled:true}));signal?.addEventListener('abort',abort,{once:true});});
  let response;
  try{response=await Promise.race([http.request({url,method:'GET',responseType:'arraybuffer',connectTimeout:15000,readTimeout:90000}),stopped]);}
  finally{signal?.removeEventListener('abort',abort);}
  if(!isCurrent())throw error('Firmware download cancelled.',{cancelled:true});
  if(response.status!==200)throw error('The phone could not download the firmware. Check cellular data or Wi-Fi.');
  if(response.url){const final=new URL(response.url);if(final.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname))throw error('Unexpected firmware download address.');}
  return binary(response.data);
 };
 return request;
}
export async function fetchPhoneManifest(http,options={}){
 return parsePhoneManifest(new TextDecoder().decode(await phoneRequest(http,options)(root+'latest/download/coollamp-manifest.txt')));
}
export async function downloadPhoneFirmware(http,{onProgress=()=>{},isCurrent=()=>true,signal,digest,expectedManifest}={}){
 const request=phoneRequest(http,{isCurrent,signal});
 onProgress({stage:'downloading',progress:0});
 const manifest=expectedManifest?parsePhoneManifest(new TextDecoder().decode(await request(root+'download/firmware-v'+parsePhoneManifest(expectedManifest.text).version+'/coollamp-manifest.txt'))):await fetchPhoneManifest(http,{isCurrent,signal});
 if(expectedManifest&&manifest.text!==expectedManifest.text)throw error('The selected release changed. Refresh before updating.');
 const image=await request(root+'download/firmware-v'+manifest.version+'/CoolLamp.ino.bin');
 if(image.length!==manifest.size||image[0]!==0xe9||new DataView(image.buffer,image.byteOffset,image.byteLength).getUint16(12,true)!==5||new DataView(image.buffer,image.byteOffset,image.byteLength).getUint32(32,true)!==0xabcd5432)throw error('Downloaded file is not a compatible ESP32-C3 application.');
 const checksum=digest?await digest(image):[...new Uint8Array(await crypto.subtle.digest('SHA-256',image))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(checksum!==manifest.sha256)throw error('Downloaded firmware failed verification. Nothing was sent to the lamp.');
 if(!isCurrent())throw error('Firmware download cancelled.',{cancelled:true});
 onProgress({stage:'downloaded',progress:100,version:manifest.version});return {manifest,image};
}
export function decodeBleUpdate(data){
 if(!(data instanceof DataView)||data.byteLength!==20||data.getUint8(0)!==1||data.getUint8(1)>5||data.getUint8(2)>9)throw error('Invalid Bluetooth update status.');
 return {phase:data.getUint8(1),error:data.getUint8(2),committed:Boolean(data.getUint8(3)&1),session:data.getUint32(4,true),size:data.getUint32(8,true),offset:data.getUint32(12,true),ack:data.getUint16(16,true),maxData:data.getUint16(18,true)};
}
const receiverErrors=['','secure connection required','another update is active','invalid update metadata','unexpected data offset','image verification failed','flash or boot selection failed','receiver timed out','transfer cancelled','update partition unavailable'];
const stopReasons=new Set(['user','app-hidden','transport-disconnect','native-disconnect','target-changed','cancelled','connection-changed','receiver-rejected','ack-timeout','native-read-failure','native-write-failure','transfer-failed']);
const stopMessages={
 user:'Bluetooth update stopped because you cancelled it.',
 'app-hidden':'Bluetooth update stopped because the app moved to the background. Keep it open during the transfer.',
 'transport-disconnect':'Bluetooth update stopped because its connection was closed. Reconnect to the lamp before trying again.',
 'native-disconnect':'Bluetooth connection ended during the update. Reconnect to the lamp before trying again.',
 'target-changed':'Bluetooth update stopped because the selected lamp changed. Reconnect to the intended lamp.',
 'connection-changed':'Bluetooth update stopped because its connection or lamp identity changed. Reconnect to the lamp before trying again.'
};
export function bluetoothFirmwareFailureMessage(failure){
 const value=failure?.updateDiagnostic;if(!value)return failure?.message||'Bluetooth update failed.';
 const bytes=Number.isInteger(value.acknowledgedBytes)&&value.total>0?' '+value.progress+'% ('+value.acknowledgedBytes.toLocaleString('en-US')+' of '+value.total.toLocaleString('en-US')+' bytes confirmed by the lamp).':'';
 const cause=stopMessages[value.stopReason]&&failure.message!==stopMessages[value.stopReason]?' '+stopMessages[value.stopReason]:'';
 const reason=value.error?' Receiver code '+value.error+': '+receiverErrors[value.error]+'.':'';
 const check=failure.uncertain&&!failure.confirmed?' Reconnect and check the installed version before retrying.':'';
 return (failure.message||'Bluetooth update failed.')+cause+bytes+reason+check;
}
export class BluetoothFirmwareTransfer {
 constructor({ble,deviceId,isCurrent=()=>true,onProgress=()=>{},delay=sleep,now=Date.now}){Object.assign(this,{ble,deviceId,isCurrent,onProgress,delay,now});this.session=0;this.sequence=0;this.cancelled=false;this.commitAttempted=false;this.lastStatus=null;this.total=0;this.stage='preparing';this.beganAt=null;this.firstStop=null;this.mtu=null;this.chunkSize=null;this.mtuFallback=null;this.writeCalls=0;this.writeTimeMs=0;this.maxWriteMs=0;this.statusReads=0;this.statusTimeMs=0;this.maxStatusMs=0;this.dataFrames=0;this.dataBytesAttempted=0;this.issuedFrames=[];this.issuedOrder=0;this.observedOrder=0;this.notificationMode='polling';this.notificationFallback=null;this.notificationAcks=0;this.notificationStatus=null;this.notificationRecord=null;this.notificationWaiter=null;}
 elapsed(start=this.beganAt){return start===null?0:Math.max(0,Math.floor(this.now()-start));}
 recordStop(reason){
  if(!this.firstStop)this.firstStop=Object.freeze({reason:stopReasons.has(reason)?reason:'cancelled',elapsedMs:this.elapsed()});
  this.notificationWaiter?.resolve(false);
 }
 current(){
  const connected=this.isCurrent();
  if(this.cancelled||!connected){
   if(!this.firstStop)this.recordStop(this.cancelled?'cancelled':'connection-changed');
   throw error(stopMessages[this.firstStop.reason]||'Bluetooth update stopped. Reconnect to the lamp before trying again.',{cancelled:true,uncertain:!connected,stopReason:this.firstStop.reason});
  }
 }
 frame(op,offset,bytes){
  const header=op===1?10:op===3?12:8,data=new DataView(new ArrayBuffer(header+(bytes?.length??0)));
  data.setUint8(0,1);data.setUint8(1,op);data.setUint32(2,this.session,true);this.sequence=this.sequence%65535+1;data.setUint16(6,this.sequence,true);
  if(op===1)data.setUint16(8,offset,true);if(op===3)data.setUint32(8,offset,true);if(bytes)new Uint8Array(data.buffer).set(bytes,header);return data;
 }
 rememberStatus(value){
  // A status read proves written bytes only for this receiver session. Never
  // attach a prior session, another image size, or a cancelled receiver to it.
  if(!this.session||value.session!==this.session||(value.size!==0&&value.size!==this.total)||value.offset>value.size||this.cancelSent)return false;
  const issued=this.issuedFrames.find(frame=>frame.ack===value.ack);
  if(!issued||issued.order<this.observedOrder)return false;
  if(value.phase===5){if(value.offset>issued.offset)return false;}
  else if(value.offset!==issued.offset||issued.op===1&&(value.size!==0||value.phase!==0)||issued.op!==1&&value.size!==this.total||issued.op===2&&![1,2].includes(value.phase)||issued.op===3&&value.phase!==2||issued.op===4&&![3,4].includes(value.phase))return false;
  const previous=this.lastStatus;
  if(previous?.phase===5||previous?.phase===4&&previous.committed)return false;
  if(previous&&(value.offset<previous.offset||previous.size===this.total&&value.size===0||issued.order===this.observedOrder&&value.phase<previous.phase))return false;
  const changed=!previous||Object.keys(value).some(key=>value[key]!==previous[key]);
  if(!changed)return false;
  this.observedOrder=issued.order;this.lastStatus={...value};return true;
 }
 noteIssued(frame){
  const op=frame.getUint8(1),offset=op===3?frame.getUint32(8,true)+frame.byteLength-12:op===4?this.total:0;
  this.issuedFrames.push({ack:frame.getUint16(6,true),order:++this.issuedOrder,op,offset});
  if(this.issuedFrames.length>16)this.issuedFrames.shift();
 }
 async beginNotifications(){
  if(typeof this.ble.startNotifications!=='function'||typeof this.ble.stopNotifications!=='function'){this.notificationFallback='unsupported';return;}
  let owners=notificationOwners.get(this.ble);if(!owners){owners=new Map();notificationOwners.set(this.ble,owners);}
  const key=String(this.deviceId).toLowerCase(),previous=owners.get(key);
  if(previous){
   if(previous.pending||previous.stopping||previous.current()){this.notificationFallback='owned';return;}
   owners.delete(key);
  }
  const record={owner:this,current:this.isCurrent,pending:true,stopping:false,closed:false,start:null,cleanup:null};
  owners.set(key,record);this.notificationRecord={record,owners,key};this.notificationMode='notifications';
  const callback=bytes=>{
   if(record.closed||owners.get(key)!==record||this.notificationMode!=='notifications'||!this.isCurrent()||this.cancelSent)return;
   try{const value=decodeBleUpdate(bytes);if(this.rememberStatus(value)){
    this.notificationStatus={...value};const waiter=this.notificationWaiter;
    if(waiter&&(value.phase===5||value.ack===waiter.ack&&(waiter.offset===undefined||value.offset===waiter.offset)&&(waiter.phase===undefined||value.phase===waiter.phase)))waiter.resolve(true);
   }}catch{ /* Invalid/stale notification never becomes an application ACK. */ }
  };
  record.start=Promise.resolve().then(()=>this.ble.startNotifications(this.deviceId,SERVICE,OTA_STATUS,callback,{timeout:1200}));
  record.start.then(()=>{record.pending=false;},()=>{record.pending=false;});
  try{await boundedNotification(record.start,1500);}
  catch{
   this.notificationMode='polling';this.notificationFallback='subscribe-failed';
   if(record.pending)throw error('Bluetooth notification setup did not finish. No firmware was sent. Reconnect before trying again.');
  }
 }
 async endNotifications(){
  const ownership=this.notificationRecord;if(!ownership)return;
  const {record,owners,key}=ownership;record.closed=true;this.notificationWaiter?.resolve(false);
  if(!record.cleanup)record.cleanup=record.start.catch(()=>{}).then(async()=>{
   if(owners.get(key)!==record)return;
   if(this.isCurrent()){
    record.stopping=true;
    try{await this.ble.stopNotifications(this.deviceId,SERVICE,OTA_STATUS);}catch{}
   }
   if(owners.get(key)===record)owners.delete(key);
  });
  try{await boundedNotification(record.cleanup,1200);}catch{ /* Pending cleanup retains its owner; later callers safely poll. */ }
 }
 receiverRejected(state){
  this.recordStop('receiver-rejected');throw error('Lamp rejected Bluetooth update (code '+state.error+'). Installed firmware remains selected.',{confirmed:true,stopReason:this.firstStop.reason});
 }
 matchingStatus(state,ack,offset,phase){
  if(!state||state.session!==this.session||(state.size!==0&&state.size!==this.total)||state.offset>state.size)return null;
  const issued=this.issuedFrames.find(frame=>frame.ack===state.ack);
  if(!issued||issued.order<this.observedOrder)return null;
  // status() also returns decoded reads which were rejected as stale. Only a
  // terminal state accepted by rememberStatus can confirm receiver rejection.
  if(state.phase===5){if(this.lastStatus?.phase===5&&Object.keys(state).every(key=>state[key]===this.lastStatus[key]))this.receiverRejected(state);return null;}
  if(state.offset!==issued.offset||issued.op===1&&(state.size!==0||state.phase!==0)||issued.op!==1&&state.size!==this.total||issued.op===2&&![1,2].includes(state.phase)||issued.op===3&&state.phase!==2||issued.op===4&&![3,4].includes(state.phase))return null;
  return state.ack===ack&&(offset===undefined||state.offset===offset)&&(phase===undefined||state.phase===phase)?state:null;
 }
 async readStatus(timeout){
  const started=this.now();++this.statusReads;
  try{return await this.ble.read(this.deviceId,SERVICE,OTA_STATUS,{timeout});}
  finally{const elapsed=this.elapsed(started);this.statusTimeMs+=elapsed;this.maxStatusMs=Math.max(this.maxStatusMs,elapsed);}
 }
 async status(){
  this.current();let bytes;
  try{bytes=await this.readStatus(5000);}catch(failure){this.recordStop(this.isCurrent()?'native-read-failure':'connection-changed');throw Object.assign(failure,{uncertain:true,stopReason:this.firstStop.reason});}
  this.current();const value=decodeBleUpdate(bytes);this.rememberStatus(value);return value;
 }
 async captureFailureStatus(){
  if(this.failureStatusPromise)return this.failureStatusPromise;
  if(!this.session||!this.issuedOrder||this.commitAttempted||!this.isCurrent()||this.lastStatus?.phase===5)return;
  this.failureStatusPromise=(async()=>{
   let timer;
   try{
    // One bounded read, with no data retry. The plugin and the outer deadline
    // both bound this diagnostic; late native replies have no side effects.
    const value=await Promise.race([this.readStatus(1200),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(error('Status snapshot timed out.')),1200);})]);
    if(this.isCurrent()&&!this.cancelSent)this.rememberStatus(decodeBleUpdate(value));
   }catch{}finally{clearTimeout(timer);}
  })();
  return this.failureStatusPromise;
 }
 diagnostic(){
  const value=this.lastStatus,known=value?.size===this.total&&value.offset<=this.total;
  return Object.freeze({transport:'bluetooth',stage:this.stage,phase:value?.phase??null,error:value?.error??0,ack:value?.ack??null,acknowledgedBytes:known?value.offset:null,total:this.total,progress:known?Math.floor(value.offset*100/this.total):null,
   stopReason:this.firstStop?.reason??null,stopElapsedMs:this.firstStop?.elapsedMs??null,elapsedMs:this.elapsed(),connectionCurrent:Boolean(this.isCurrent()),cancelRequested:this.cancelled,
   mtu:this.mtu,chunkSize:this.chunkSize,mtuFallback:this.mtuFallback,dataFrames:this.dataFrames,dataBytesAttempted:this.dataBytesAttempted,
   writeCalls:this.writeCalls,writeTimeMs:this.writeTimeMs,maxWriteMs:this.maxWriteMs,statusReads:this.statusReads,statusTimeMs:this.statusTimeMs,maxStatusMs:this.maxStatusMs,
   notificationMode:this.notificationMode,notificationFallback:this.notificationFallback,notificationAcks:this.notificationAcks});
 }
 async wait(ack,offset,phase){
  if(this.notificationMode==='notifications'){
   this.current();let matched=this.matchingStatus(this.notificationStatus,ack,offset,phase);
   if(!matched){
    let timer;
    try{await new Promise(resolve=>{
     this.notificationWaiter={ack,offset,phase,resolve};timer=setTimeout(()=>resolve(false),phase===4?500:160);
     if(this.matchingStatus(this.notificationStatus,ack,offset,phase))resolve(true);
    });}finally{clearTimeout(timer);this.notificationWaiter=null;}
    this.current();matched=this.matchingStatus(this.notificationStatus,ack,offset,phase);
   }
   if(matched){++this.notificationAcks;return matched;}
   this.notificationMode='polling';this.notificationFallback='missed-ack';
  }
  const end=this.now()+15000;
  while(this.now()<end){const state=await this.status();
   const matched=this.matchingStatus(state,ack,offset,phase);if(matched)return matched;
   await this.delay(40);
  }this.recordStop('ack-timeout');throw error('The lamp did not acknowledge this transfer. No data was replayed.',{uncertain:true,stopReason:this.firstStop.reason});
 }
 async write(frame){
  this.current();if(this.notificationStatus?.phase===5)this.receiverRejected(this.notificationStatus);
  this.noteIssued(frame);const started=this.now();++this.writeCalls;
  if(frame.getUint8(1)===3){++this.dataFrames;this.dataBytesAttempted+=frame.byteLength-12;}
  try{await this.ble.write(this.deviceId,SERVICE,OTA_WRITE,frame,{timeout:8000});}
  catch(failure){this.recordStop(this.isCurrent()?'native-write-failure':'connection-changed');throw Object.assign(failure,{uncertain:true,stopReason:this.firstStop.reason});}
  finally{const elapsed=this.elapsed(started);this.writeTimeMs+=elapsed;this.maxWriteMs=Math.max(this.maxWriteMs,elapsed);}
  this.current();
  if(this.notificationStatus?.phase===5)this.receiverRejected(this.notificationStatus);
 }
 async cancel(reason='cancelled'){
  if(this.cancelPromise)return this.cancelPromise;
  if(reason!=='cleanup')this.recordStop(reason);
  this.cancelled=true;
  if(!this.session||!this.issuedOrder||this.commitAttempted||!this.isCurrent())return;
  this.cancelPromise=(async()=>{await this.captureFailureStatus();if(!this.isCurrent()||this.commitAttempted)return;this.cancelSent=true;await this.ble.write(this.deviceId,SERVICE,OTA_WRITE,this.frame(5),{timeout:3000}).catch(()=>{});})();
  return this.cancelPromise;
 }
 async send({manifest,image}){
  const parsed=parsePhoneManifest(manifest?.text);
  if(!(image instanceof Uint8Array)||image.length!==parsed.size||parsed.version!==manifest.version||parsed.sha256!==manifest.sha256)throw error('Invalid prepared firmware package.');
  this.beganAt=this.now();this.total=image.length;
  this.current();let initial;
  try{initial=await this.status();}catch(failure){
   const missingReceiver=/(?:missing|not found|unavailable|unsupported).*characteristic|characteristic.*(?:missing|not found|unavailable|unsupported)/i.test(failure.message||'');
   if(missingReceiver&&this.isCurrent()&&this.firstStop?.reason==='native-read-failure')failure=error('This lamp needs firmware 1.11.0 or newer installed once over Wi-Fi before it can receive Bluetooth updates.');
   failure.stopReason=this.firstStop?.reason??'transfer-failed';failure.updateDiagnostic=this.diagnostic();throw failure;
  }
  if(initial.phase>0&&initial.phase<5)throw error('A Bluetooth update is already active. Reconnect and check its status.');
  if(!Number.isInteger(initial.maxData)||initial.maxData<1||initial.maxData>232)throw error('Unsupported Bluetooth update capability.');
  let mtu=23;try{mtu=await this.ble.getMtu(this.deviceId);}catch{this.mtuFallback='unavailable';}
  if(mtu&&typeof mtu==='object')mtu=mtu.mtu;
  if(!Number.isInteger(mtu)||mtu<23){mtu=23;this.mtuFallback='invalid';}
  const frameLimit=Math.min(244,mtu-3),chunk=Math.min(initial.maxData,frameLimit-12);
  this.mtu=mtu;this.chunkSize=chunk;
  this.session=crypto.getRandomValues(new Uint32Array(1))[0]||1;
  this.total=image.length;
  try{
   await this.beginNotifications();this.current();
   const text=new TextEncoder().encode(manifest.text);
   for(let offset=0;offset<text.length;){const bytes=text.subarray(offset,offset+frameLimit-10),frame=this.frame(1,offset,bytes);await this.write(frame);await this.wait(this.sequence);offset+=bytes.length;}
   const start=this.frame(2);await this.write(start);await this.wait(this.sequence,0,2);
   this.stage='transferring';this.onProgress({stage:'transferring',progress:0,version:manifest.version});
   for(let offset=0;offset<image.length;){
    // Four copied frames fit the receiver queue. Progress counts written,
    // acknowledged bytes, not ATT acceptance or bytes merely sent by iOS.
    const end=Math.min(image.length,offset+chunk*4);let ack;
    while(offset<end){const bytes=image.subarray(offset,Math.min(end,offset+chunk));const frame=this.frame(3,offset,bytes);await this.write(frame);offset+=bytes.length;ack=this.sequence;}
    const state=await this.wait(ack,offset,2);if(state.size!==image.length)throw error('The lamp’s firmware size changed.');
    this.onProgress({stage:'transferring',progress:Math.floor(offset*100/image.length),version:manifest.version});
   }
   this.stage='verifying';this.onProgress({stage:'verifying',progress:100,version:manifest.version});
   const finish=this.frame(4);this.commitAttempted=true;
   try{await this.write(finish);const state=await this.wait(this.sequence,image.length,4);if(!state.committed)throw error('The lamp did not confirm its boot selection.');return {committed:true,version:manifest.version};}
   catch(failure){if(failure.confirmed)throw failure;this.recordStop('transfer-failed');return {committed:false,verificationRequired:true,version:manifest.version,updateDiagnostic:this.diagnostic()};}
  }catch(failure){this.recordStop('transfer-failed');await this.captureFailureStatus();failure.stopReason=this.firstStop.reason;failure.updateDiagnostic=this.diagnostic();await this.cancel('cleanup');throw failure;}
  finally{await this.endNotifications();}
 }
}
