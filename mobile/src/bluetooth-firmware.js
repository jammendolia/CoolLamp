import {SERVICE} from './protocol.js';
export const OTA_WRITE='7b61000b-6e2b-4f3d-9a71-28e45c001001';
export const OTA_STATUS='7b61000c-6e2b-4f3d-9a71-28e45c001001';
const root='https://github.com/jammendolia/CoolLamp/releases/';
const version=value=>/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(part=>Number(part)<=65535);
const error=(message,fields={})=>Object.assign(new Error(message),fields);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
export function bluetoothFirmwareFailureMessage(failure){
 const value=failure?.updateDiagnostic;if(!value)return failure?.message||'Bluetooth update failed.';
 const bytes=Number.isInteger(value.acknowledgedBytes)&&value.total>0?' '+value.progress+'% ('+value.acknowledgedBytes.toLocaleString('en-US')+' of '+value.total.toLocaleString('en-US')+' bytes confirmed by the lamp).':'';
 const reason=value.error?' Receiver code '+value.error+': '+receiverErrors[value.error]+'.':'';
 const check=failure.uncertain&&!failure.confirmed?' Reconnect and check the installed version before retrying.':'';
 return (failure.message||'Bluetooth update failed.')+bytes+reason+check;
}
export class BluetoothFirmwareTransfer {
 constructor({ble,deviceId,isCurrent=()=>true,onProgress=()=>{},delay=sleep,now=Date.now}){Object.assign(this,{ble,deviceId,isCurrent,onProgress,delay,now});this.session=0;this.sequence=0;this.cancelled=false;this.commitAttempted=false;this.lastStatus=null;this.total=0;this.stage='preparing';}
 current(){if(this.cancelled||!this.isCurrent())throw error('Bluetooth update stopped. Reconnect to the lamp before trying again.',{cancelled:true});}
 frame(op,offset,bytes){
  const header=op===1?10:op===3?12:8,data=new DataView(new ArrayBuffer(header+(bytes?.length??0)));
  data.setUint8(0,1);data.setUint8(1,op);data.setUint32(2,this.session,true);this.sequence=this.sequence%65535+1;data.setUint16(6,this.sequence,true);
  if(op===1)data.setUint16(8,offset,true);if(op===3)data.setUint32(8,offset,true);if(bytes)new Uint8Array(data.buffer).set(bytes,header);return data;
 }
 rememberStatus(value){
  // A status read proves written bytes only for this receiver session. Never
  // attach a prior session, another image size, or a cancelled receiver to it.
  if(this.session&&value.session===this.session&&(value.size===0||value.size===this.total)&&value.offset<=value.size&&!this.cancelSent)this.lastStatus={...value};
 }
 async status(){this.current();const value=decodeBleUpdate(await this.ble.read(this.deviceId,SERVICE,OTA_STATUS,{timeout:5000}));this.current();this.rememberStatus(value);return value;}
 async captureFailureStatus(){
  if(this.failureStatusPromise)return this.failureStatusPromise;
  if(!this.session||this.commitAttempted||!this.isCurrent()||this.lastStatus?.phase===5)return;
  this.failureStatusPromise=(async()=>{
   let timer;
   try{
    // One bounded read, with no data retry. The plugin and the outer deadline
    // both bound this diagnostic; late native replies have no side effects.
    const value=await Promise.race([this.ble.read(this.deviceId,SERVICE,OTA_STATUS,{timeout:1200}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(error('Status snapshot timed out.')),1200);})]);
    if(this.isCurrent()&&!this.cancelSent)this.rememberStatus(decodeBleUpdate(value));
   }catch{}finally{clearTimeout(timer);}
  })();
  return this.failureStatusPromise;
 }
 diagnostic(){
  const value=this.lastStatus,known=value?.size===this.total&&value.offset<=this.total;
  return Object.freeze({transport:'bluetooth',stage:this.stage,phase:value?.phase??null,error:value?.error??0,ack:value?.ack??null,acknowledgedBytes:known?value.offset:null,total:this.total,progress:known?Math.floor(value.offset*100/this.total):null});
 }
 async wait(ack,offset,phase){
  const end=this.now()+15000;
  while(this.now()<end){const state=await this.status();
   if(state.session===this.session){if(state.phase===5)throw error('Lamp rejected Bluetooth update (code '+state.error+'). Installed firmware remains selected.',{confirmed:true});
    if(state.ack===ack&&(offset===undefined||state.offset===offset)&&(phase===undefined||state.phase===phase))return state;}
   await this.delay(40);
  }throw error('The lamp did not acknowledge this transfer. No data was replayed.',{uncertain:true});
 }
 async write(frame){this.current();try{await this.ble.write(this.deviceId,SERVICE,OTA_WRITE,frame,{timeout:8000});}catch(failure){throw Object.assign(failure,{uncertain:true});}this.current();}
 async cancel(){
  if(this.cancelPromise)return this.cancelPromise;
  this.cancelled=true;
  if(!this.session||this.commitAttempted||!this.isCurrent())return;
  this.cancelPromise=(async()=>{await this.captureFailureStatus();if(!this.isCurrent()||this.commitAttempted)return;this.cancelSent=true;await this.ble.write(this.deviceId,SERVICE,OTA_WRITE,this.frame(5),{timeout:3000}).catch(()=>{});})();
  return this.cancelPromise;
 }
 async send({manifest,image}){
  const parsed=parsePhoneManifest(manifest?.text);
  if(!(image instanceof Uint8Array)||image.length!==parsed.size||parsed.version!==manifest.version||parsed.sha256!==manifest.sha256)throw error('Invalid prepared firmware package.');
  this.current();let initial;
  try{initial=await this.status();}catch{throw error('This lamp needs firmware 1.11.0 or newer installed once over Wi-Fi before it can receive Bluetooth updates.');}
  if(initial.phase>0&&initial.phase<5)throw error('A Bluetooth update is already active. Reconnect and check its status.');
  if(!Number.isInteger(initial.maxData)||initial.maxData<1||initial.maxData>232)throw error('Unsupported Bluetooth update capability.');
  let mtu=23;try{mtu=await this.ble.getMtu(this.deviceId);}catch{}
  if(typeof mtu==='object')mtu=mtu.mtu;
  if(!Number.isInteger(mtu)||mtu<23)mtu=23;
  const frameLimit=Math.min(244,mtu-3),chunk=Math.min(initial.maxData,frameLimit-12);
  this.session=crypto.getRandomValues(new Uint32Array(1))[0]||1;
  this.total=image.length;
  try{
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
   catch(failure){if(failure.confirmed)throw failure;return {committed:false,verificationRequired:true,version:manifest.version,updateDiagnostic:this.diagnostic()};}
  }catch(failure){await this.captureFailureStatus();failure.updateDiagnostic=this.diagnostic();await this.cancel();throw failure;}
 }
}
