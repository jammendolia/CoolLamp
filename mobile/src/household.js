const hex=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
const positive=(value)=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const transaction=value=>hex(value,16)&&!/^0+$/.test(value);
const bytes=value=>Uint8Array.from(value.match(/../g)||[],value=>parseInt(value,16));
const encoded=value=>new TextEncoder().encode(value);
const asHex=value=>[...value].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const asObject=value=>typeof value==='string'?JSON.parse(value):value;
const reversedMac=value=>value.match(/../g).reverse().join('');
const failure=(message,extra={})=>Object.assign(Error(message),extra);
const uncertain=()=>failure('The lamp outcome was not authenticated. Check its original receipt or fresh state before trying again.',{uncertain:true});
function u32(value){if(!positive(value))throw Error('Invalid household counter.');const output=new Uint8Array(4);new DataView(output.buffer).setUint32(0,value,true);return output;}
function u64(value){if(!transaction(value))throw Error('Invalid household request or session.');const output=new Uint8Array(8);new DataView(output.buffer).setBigUint64(0,BigInt('0x'+value),true);return output;}
function joined(...values){const output=new Uint8Array(values.reduce((sum,value)=>sum+value.length,0));let offset=0;for(const value of values){output.set(value,offset);offset+=value.length;}return output;}
const randomRequest=()=>asHex(crypto.getRandomValues(new Uint8Array(8)));
export function validateHouseholdGrant(value){
 if(value?.version!==1||!hex(value.deviceId,12)||!hex(value.targetMac,12)||reversedMac(value.targetMac)!==value.deviceId||!transaction(value.phone)||!hex(value.secret,32)||/^0+$/.test(value.secret)||!positive(value.epoch)||!transaction(value.bootSession)||!transaction(value.requestId)||!Number.isInteger(value.expiresAtUptimeMs)||value.expiresAtUptimeMs<0||value.expiresAtUptimeMs>0xffffffff)throw Error('Invalid household invitation.');
 return Object.freeze({version:1,deviceId:value.deviceId,targetMac:value.targetMac,phone:value.phone,secret:value.secret,epoch:value.epoch,bootSession:value.bootSession,requestId:value.requestId,expiresAtUptimeMs:value.expiresAtUptimeMs});
}
export function validateHouseholdChallenge(value,grant){
 if(value?.version!==1||value.deviceId!==grant.deviceId||value.targetMac!==grant.targetMac||value.phone!==grant.phone||value.epoch!==grant.epoch||!transaction(value.bootSession)||!hex(value.nonce,32))throw uncertain();
 return Object.freeze({version:1,deviceId:value.deviceId,targetMac:value.targetMac,phone:value.phone,epoch:value.epoch,bootSession:value.bootSession,nonce:value.nonce});
}
async function hmac(secret,message){
 const key=bytes(secret);try{const imported=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return asHex(new Uint8Array(await crypto.subtle.sign('HMAC',imported,message)));}finally{key.fill(0);message.fill(0);}
}
function prefix(domain,c){return joined(encoded(domain),bytes(c.targetMac),u64(c.bootSession),bytes(c.phone),u32(c.epoch),bytes(c.nonce));}
export async function householdAdoptionProof(grant,challenge){validateHouseholdChallenge(challenge,grant);return hmac(grant.secret,joined(prefix('CoolLamp household adoption v1',challenge),u64(grant.requestId)));}
export async function householdCommandProof(grant,challenge,authorization,body){
 validateHouseholdChallenge(challenge,grant);const raw=encoded(body);
 if(raw.length>1024||!positive(authorization.sequence)||!transaction(authorization.requestId)||!Number.isInteger(authorization.endpoint)||authorization.endpoint<1||authorization.endpoint>47||![1,2].includes(authorization.method))throw Error('Invalid household command.');
 try{return await hmac(grant.secret,joined(prefix('CoolLamp household command v1',challenge),u32(authorization.sequence),u64(authorization.requestId),Uint8Array.of(authorization.endpoint,authorization.method),new Uint8Array(await crypto.subtle.digest('SHA-256',raw))));}finally{raw.fill(0);}
}
export async function householdResponseProof(grant,challenge,authorization,status,body){
 validateHouseholdChallenge(challenge,grant);const raw=typeof body==='string'?encoded(body):body;
 if(!(raw instanceof Uint8Array)||raw.length>8192||!Number.isInteger(status)||status<100||status>599)throw Error('Invalid household response.');
 return hmac(grant.secret,joined(prefix('CoolLamp household response v1',challenge),u32(authorization.sequence),u64(authorization.requestId),Uint8Array.of(status&255,status>>>8),new Uint8Array(await crypto.subtle.digest('SHA-256',raw))));
}
const vaultId=(deviceId,phone)=>'coollamp-household-v1:'+deviceId+':'+phone;
export class HouseholdVault {
 constructor({credential,isNative=false}={}){if(!isNative||typeof credential!=='function')throw Error('Household sharing requires the native secure credential vault.');this.credential=credential;this.ranges=new Map();this.tail=Promise.resolve();}
 async load(deviceId,phone){
  if(!hex(deviceId,12)||!transaction(phone))throw Error('Invalid household target.');const saved=(await this.credential(vaultId(deviceId,phone)))?.value;
  if(!saved)return null;const value=asObject(saved),grant=validateHouseholdGrant(value.grant);if(grant.deviceId!==deviceId||grant.phone!==phone)throw Error('Saved household identity changed.');return {grant,sequenceBoot:value.sequenceBoot||'',reservedThrough:value.reservedThrough||0};
 }
 async persist(value){const text=JSON.stringify(value),id=vaultId(value.grant.deviceId,value.grant.phone);await this.credential(id,text);if((await this.credential(id))?.value!==text)throw Error('Could not verify native household credential storage.');}
 async importAuthenticated(exchange){
  if(typeof exchange?.receiveAuthenticatedInvitation!=='function')throw Error('A confidential authenticated phone invitation channel is required.');
  const received=await exchange.receiveAuthenticatedInvitation();if(received?.authenticated!==true||received?.confidential!==true)throw Error('The household invitation channel is not verified.');
  const grant=validateHouseholdGrant(received.grant),existing=await this.load(grant.deviceId,grant.phone);
  if(existing&&(existing.grant.epoch>grant.epoch||existing.grant.epoch===grant.epoch&&existing.grant.secret!==grant.secret))throw Error('An older or conflicting household invitation cannot replace saved authority.');
  const preserved=existing?.grant.epoch===grant.epoch?{sequenceBoot:existing.sequenceBoot,reservedThrough:existing.reservedThrough}:{sequenceBoot:'',reservedThrough:0};
  await this.persist({grant,...preserved});this.ranges.delete(vaultId(grant.deviceId,grant.phone));return {deviceId:grant.deviceId,phone:grant.phone,epoch:grant.epoch};
 }
 async shareInvitation(invitation,exchange){
  const grant=validateHouseholdGrant(invitation);if(typeof exchange?.sendAuthenticatedInvitation!=='function')throw Error('A confidential authenticated phone invitation channel is required.');
  const result=await exchange.sendAuthenticatedInvitation(grant);if(result?.authenticated!==true||result?.confidential!==true)throw Error('Phone invitation delivery was not verified.');return {deviceId:grant.deviceId,phone:grant.phone};
 }
 nextSequence(deviceId,phone,bootSession){
  const task=this.tail.then(async()=>{
   const id=vaultId(deviceId,phone),saved=await this.load(deviceId,phone);if(!saved)throw Error('This phone has no household invitation for the lamp.');
   let range=this.ranges.get(id);if(!range||range.bootSession!==bootSession||range.next>range.end){
    const previous=saved.sequenceBoot===bootSession?saved.reservedThrough:0;if(!Number.isInteger(previous)||previous<0||previous>0xffffffff-64)throw Error('Household command counter needs a new lamp session.');
    const end=previous+64;await this.persist({...saved,sequenceBoot:bootSession,reservedThrough:end});range={bootSession,next:previous+1,end};this.ranges.set(id,range);
   }return range.next++;
  });this.tail=task.catch(()=>{});return task;
 }
 // Local removal deliberately does not claim fleet revocation.
 async removeFromPhone(deviceId,phone){await this.credential(vaultId(deviceId,phone),'');this.ranges.delete(vaultId(deviceId,phone));return {removedFromPhone:true,revoked:false};}
}
export class HouseholdClient {
 constructor({http,vault,deviceId,phone,address,nextRequest=randomRequest}={}){
  if(typeof http?.request!=='function'||!(vault instanceof HouseholdVault)||!hex(deviceId,12)||!transaction(phone))throw Error('Invalid household connection.');
  const url=new URL(address);if(url.protocol!=='http:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'&&url.pathname!=='')throw Error('Use the lamp’s direct local address.');
  Object.assign(this,{http,vault,deviceId,phone,base:url.origin,nextRequest});this.tail=Promise.resolve();
 }
 async post(path,fields){
  try{const result=await this.http.request({url:this.base+path,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},data:new URLSearchParams(fields).toString(),responseType:'text',connectTimeout:5000,readTimeout:8000,disableRedirects:true});
   const text=typeof result.data==='string'?result.data:JSON.stringify(result.data);if(encoded(text).length>16384)throw uncertain();return {httpStatus:result.status,value:asObject(text)};
  }catch{throw uncertain();}
 }
 async context(){const saved=await this.vault.load(this.deviceId,this.phone);if(!saved)throw Error('This phone has no household invitation for the lamp.');const response=await this.post('/api/household/challenge',{action:'challenge',phone:this.phone});return {grant:saved.grant,challenge:validateHouseholdChallenge(response.value,saved.grant)};}
 async perform(endpoint,method,fields){
  const {grant,challenge}=await this.context(),sequence=await this.vault.nextSequence(this.deviceId,this.phone,challenge.bootSession),requestId=this.nextRequest();
  const body=typeof fields==='string'?fields:new URLSearchParams(fields||{}).toString();const authorization={sequence,requestId,endpoint,method};
  const proof=await householdCommandProof(grant,challenge,authorization,body);
  const response=await this.post('/api/household/control',{phone:this.phone,bootSession:challenge.bootSession,epoch:grant.epoch,sequence,requestId,endpoint,method,body,proof});
  const value=response.value;
  if(value?.version!==1||value.deviceId!==this.deviceId||value.phone!==this.phone||value.bootSession!==challenge.bootSession||value.epoch!==grant.epoch||value.sequence!==sequence||value.requestId!==requestId||value.bodyEncoding!=='base64'||!hex(value.proof,64)||!Number.isInteger(value.status)||value.status<100||value.status>599||typeof value.body!=='string'||value.body.length>10924)throw uncertain();
  let raw;try{const decoded=atob(value.body);if(decoded.length>8192||btoa(decoded)!==value.body)throw uncertain();raw=Uint8Array.from(decoded,char=>char.charCodeAt(0));}catch{throw uncertain();}
  const expected=await householdResponseProof(grant,challenge,authorization,value.status,raw);let difference=0;const a=bytes(expected),b=bytes(value.proof);for(let i=0;i<32;++i)difference|=a[i]^b[i];a.fill(0);b.fill(0);if(difference){raw.fill(0);throw uncertain();}
  let data;try{data=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw uncertain();}finally{raw.fill(0);}
  if(value.status<200||value.status>=300)throw failure('The lamp rejected the household command.',{confirmed:true,status:value.status,data});
  return {verified:true,deviceId:this.deviceId,bootSession:challenge.bootSession,requestId,status:value.status,data};
 }
 control(endpoint,method,fields){const task=this.tail.then(()=>this.perform(endpoint,method,fields));this.tail=task.catch(()=>{});return task;}
 async adopt(){
  const {grant,challenge}=await this.context();
  if(challenge.bootSession===grant.bootSession){const proof=await householdAdoptionProof(grant,challenge);try{await this.post('/api/household/challenge',{action:'adopt',phone:this.phone,requestId:grant.requestId,proof});}catch{ /* Read authority; never resubmit adoption over another route. */ }}
  // An unsigned adoption ACK cannot create ownership. This authenticated
  // read also reconciles a lost final ACK or already-adopted postboot phone.
  const result=await this.control(1,1);return {...result,adopted:true};
 }
}
