import {COORDINATOR_MODEL,bridgeHostname} from './bridge-accessory.js';
import {bridgeAddress,sharedLocalRequestOwner} from './bridge-management.js';

export const LEGACY_COOLSTRIP_SCHEDULE_PATH='/api/coordinator/schedule';
const STATUS_LIMIT=2048,IDENTITY_LIMIT=4096,DEFAULT_TIMEOUT=8000;
const LOCAL_TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const STATUS_FIELDS=['automatic','locationConfigured','timeValid','sunsetValid','inWindow','manualOverride','storageFault','sunset','timezone','checks'];
const encoder=new TextEncoder();

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const nonce=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const byteLength=value=>encoder.encode(value).length;
const failure=(code,message,fields={})=>Object.assign(Error(message),{scheduleError:true,code,...fields});

function freeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  Object.freeze(value);for(const child of Object.values(value))freeze(child);
 }
 return value;
}

function parseBounded(raw,limit,label){
 if(typeof raw!=='string')throw failure('invalid-response',`${label} reply was incomplete.`);
 if(byteLength(raw)>limit)throw failure('invalid-response',`${label} reply was too large.`);
 try{return JSON.parse(raw);}catch{throw failure('invalid-response',`${label} reply was incomplete.`);}
}

function requiredBoolean(value,label){
 if(typeof value!=='boolean')throw failure('invalid-response',`Invalid CoolStrip ${label}.`);
 return value;
}

export function validateLegacyCoolStripScheduleStatus(raw){
 const source=parseBounded(raw,STATUS_LIMIT,'Schedule status');
 if(!record(source))throw failure('invalid-response','Invalid CoolStrip schedule status.');
 if(Object.keys(source).some(field=>!STATUS_FIELDS.includes(field))||STATUS_FIELDS.some(field=>!Object.hasOwn(source,field)))throw failure('invalid-response','Unexpected CoolStrip schedule status field.');
 const sunsetValid=requiredBoolean(source.sunsetValid,'sunset state');
 if(typeof source.sunset!=='string'||(sunsetValid?!LOCAL_TIME.test(source.sunset):source.sunset!=='--:--'))throw failure('invalid-response','Invalid CoolStrip sunset time.');
 if(source.timezone!=='America/Chicago')throw failure('invalid-response','Unsupported CoolStrip schedule timezone.');
 if(!Number.isInteger(source.checks)||source.checks<0||source.checks>0xffffffff)throw failure('invalid-response','Invalid CoolStrip schedule check counter.');
 return freeze({
  automatic:requiredBoolean(source.automatic,'automatic state'),
  locationConfigured:requiredBoolean(source.locationConfigured,'location state'),
  timeValid:requiredBoolean(source.timeValid,'clock state'),
  sunsetValid,
  inWindow:requiredBoolean(source.inWindow,'window state'),
  manualOverride:requiredBoolean(source.manualOverride,'manual override state'),
  storageFault:requiredBoolean(source.storageFault,'storage state'),
  sunset:source.sunset,timezone:source.timezone,checks:source.checks
 });
}

function nextEvent(value){
 if(!value.timeValid||!value.sunsetValid)return null;
 return value.inWindow?freeze({action:'turn-off',when:freeze({kind:'midnight'})}):freeze({action:'turn-on',when:freeze({kind:'clock',value:value.sunset})});
}

export function legacyCoolStripScheduleSnapshot(raw,{checkedAt=Date.now()}={}){
 const value=validateLegacyCoolStripScheduleStatus(raw);
 let state='on',reasonCode=null,primaryAction=null;
 if(value.storageFault){state='attention';reasonCode='saved-schedule-needs-recovery';primaryAction='view-recovery';}
 else if(!value.locationConfigured){state='attention';reasonCode='home-location-needed';primaryAction='set-home-location';}
 else if(!value.timeValid){state='attention';reasonCode='schedule-time-not-ready';primaryAction='check-again';}
 else if(!value.sunsetValid){state='attention';reasonCode='sunset-time-unavailable';primaryAction='check-home-location';}
 else if(!value.automatic){state='paused';reasonCode='schedule-paused';primaryAction='resume-schedule';}
 else if(value.manualOverride){state='changed';reasonCode='changed-until-next-scheduled-time';primaryAction='resume-schedule';}
 return freeze({
  version:1,state:'ready',lastUpdatedAt:checkedAt,reasonCode:null,primaryAction:null,
  schedules:[{
   id:'coolstrip-sunset-midnight',name:'Window display',state,enabled:value.automatic,
   reasonCode,primaryAction,manualHold:value.manualOverride,nextEvent:nextEvent(value)
  }]
 });
}

export function selectScheduleCoordinator({accessories=[],homeContext}={}){
 const homes=Array.isArray(homeContext?.homes)?homeContext.homes:[];
 const home=homes.find(value=>value?.id===homeContext?.activeHomeId)||homes[0]||null;
 const coordinators=(Array.isArray(accessories)?accessories:[]).filter(value=>value?.modelId===COORDINATOR_MODEL&&canonical(value?.id));
 if(!home)return freeze({state:'not-configured',reasonCode:'home-not-ready',key:'no-home'});
 if(homes.length!==1)return freeze({state:'attention',reasonCode:'schedule-home-assignment-needed',key:`${home.id}:home-assignment`});
 if(!coordinators.length)return freeze({state:'not-configured',reasonCode:'schedule-provider-not-configured',key:`${home.id}:none`});
 if(coordinators.length!==1)return freeze({state:'attention',reasonCode:'schedule-provider-choice-needed',key:`${home.id}:choose`});
 const accessory=coordinators[0];
 if(!nonce(accessory.fleetId))return freeze({state:'attention',reasonCode:'schedule-household-proof-needed',key:`${home.id}:${accessory.id}:household-proof`});
 const route=accessory.address||bridgeHostname(accessory)||'';
 return freeze({state:'ready',reasonCode:null,key:`${home.id}:${accessory.id}:${accessory.fleetId}:${route}`,homeId:home.id,accessory});
}

export function initialAutomationState(selection){
 if(selection?.state==='ready')return freeze({version:1,state:'idle',reasonCode:'schedule-status-not-checked',lastUpdatedAt:null,schedules:[]});
 return freeze({version:1,state:selection?.state==='attention'?'attention':'not-configured',reasonCode:selection?.reasonCode||'schedule-provider-not-configured',lastUpdatedAt:null,schedules:[]});
}

export function checkingAutomationState(previous,{attemptedAt=Date.now()}={}){
 const schedules=Array.isArray(previous?.schedules)?previous.schedules:[];
 return freeze({version:1,state:'checking',reasonCode:null,lastUpdatedAt:Number.isSafeInteger(previous?.lastUpdatedAt)?previous.lastUpdatedAt:null,attemptedAt,schedules});
}

export function failedAutomationState(previous,error,{attemptedAt=Date.now()}={}){
 const code=error?.scheduleError&&typeof error.code==='string'?error.code:'unreachable';
 const attention=new Set(['access-needed','identity-changed','invalid-response','update-needed','route-invalid']);
 const schedules=Array.isArray(previous?.schedules)?previous.schedules:[];
 return freeze({version:1,state:attention.has(code)?'attention':'unreachable',reasonCode:code,lastUpdatedAt:Number.isSafeInteger(previous?.lastUpdatedAt)?previous.lastUpdatedAt:null,attemptedAt,schedules});
}

function basic(password){
 if(typeof password!=='string'||password.length<8||password.length>32||/[^\x20-\x7e]/.test(password))throw failure('access-needed','This Home connection needs attention.');
 const data=encoder.encode('OWNER:'+password);
 try{return 'Basic '+btoa(Array.from(data,byte=>String.fromCharCode(byte)).join(''));}
 finally{data.fill(0);}
}

function identityStatus(raw,accessory){
 const value=parseBounded(raw,IDENTITY_LIMIT,'Home connection');
 if(!record(value)||value.role!=='bridge'||value.deviceId!==accessory.id||!canonical(value.deviceId)||!nonce(value.fleetId)||value.meshEnabled!==true||typeof value.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token))throw failure('identity-changed','This Home connection could not be confirmed.');
 if(accessory.fleetId&&value.fleetId!==accessory.fleetId)throw failure('identity-changed','This Home connection belongs to a different Home.');
 return value;
}

export class LegacyCoolStripScheduleClient{
 constructor({http,accessory,getPassword,timeout=DEFAULT_TIMEOUT,now=Date.now}={}){
  if(!http||typeof http.request!=='function'||!record(accessory)||accessory.modelId!==COORDINATOR_MODEL||!canonical(accessory.id)||!nonce(accessory.fleetId)||typeof getPassword!=='function')throw failure('route-invalid','This schedule connection is not ready.');
  let address;
  try{address=bridgeAddress(accessory.address||bridgeHostname(accessory));}
  catch{throw failure('route-invalid','This schedule connection needs attention.');}
  this.http=http;this.accessory=accessory;this.getPassword=getPassword;this.timeout=Math.max(1,Math.min(15000,timeout));this.now=now;this.address=address;this.busy=false;this.nativeOwner=sharedLocalRequestOwner(http);Object.defineProperty(this,'nativeFlight',{get:()=>this.nativeOwner.flight});
 }
 async request(path,authorization,limit,deadline,signal){
  if(signal?.aborted)throw failure('cancelled','Schedule check stopped.',{cancelled:true});
  const remaining=Math.max(1,deadline-this.now());
  if(remaining<=1)throw failure('unreachable','Schedules could not be refreshed.',{timeout:true});
  if(this.nativeFlight)throw failure('busy','The previous schedule check is still finishing.');
  const options={url:this.address+path,method:'GET',headers:{Authorization:authorization},responseType:'text',connectTimeout:Math.min(4000,remaining),readTimeout:remaining,disableRedirects:true};
  let timer,abort;
  try{
   const native=Promise.resolve(this.http.request(options));this.nativeOwner.flight=native;
   const settled=()=>{if(this.nativeOwner.flight===native)this.nativeOwner.flight=null;};native.then(settled,settled);
   const stopped=new Promise((_,reject)=>{abort=()=>reject(failure('cancelled','Schedule check stopped.',{cancelled:true}));signal?.addEventListener('abort',abort,{once:true});});
   const response=await Promise.race([native,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('unreachable','Schedules could not be refreshed.',{timeout:true})),remaining);}),stopped]);
   if(signal?.aborted)throw failure('cancelled','Schedule check stopped.',{cancelled:true});
   if(response?.url&&new URL(response.url).origin!==this.address)throw failure('identity-changed','This Home connection changed.');
   if(response?.status===401||response?.status===403)throw failure('access-needed','This Home connection needs attention.');
   if([404,405,501].includes(response?.status))throw failure('update-needed','This device needs an update before the app can check schedules.');
   if(!Number.isInteger(response?.status)||response.status<200||response.status>=300)throw failure('unreachable','Schedules could not be refreshed.');
   let text;
   if(typeof response.data==='string')text=response.data;
   else try{text=JSON.stringify(response.data);}catch{throw failure('invalid-response','Schedule reply was incomplete.');}
   if(typeof text!=='string'||byteLength(text)>limit)throw failure('invalid-response','Schedule reply was too large.');
   return text;
  }catch(error){
   if(error?.scheduleError)throw error;
   throw failure('unreachable','Schedules could not be refreshed.');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async read({signal}={}){
  if(this.busy||this.nativeFlight)throw failure('busy','The previous schedule check is still finishing.');
  this.busy=true;
  try{
   const password=await this.getPassword(this.accessory.id),authorization=basic(password),deadline=this.now()+this.timeout;
   if(signal?.aborted)throw failure('cancelled','Schedule check stopped.',{cancelled:true});
   identityStatus(await this.request('/api/bridge/status',authorization,IDENTITY_LIMIT,deadline,signal),this.accessory);
   return legacyCoolStripScheduleSnapshot(await this.request(LEGACY_COOLSTRIP_SCHEDULE_PATH,authorization,STATUS_LIMIT,deadline,signal),{checkedAt:this.now()});
  }finally{this.busy=false;}
 }
}
