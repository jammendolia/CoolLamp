import {validateCatalog} from './catalog.js';
import {groupObservation} from './lamp-connectivity.js';
import {normalizeLampStyle,normalizeLampModel} from './lamp-style.js';

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const kinds=['mesh','wifi','bluetooth'];
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const failure=(message,fields={})=>Object.assign(Error(message),{confirmed:true,...fields});
const cancelled=()=>failure('Lamp selection changed.',{cancelled:true});
const timedOut=()=>failure('The lamp did not respond in time.',{connectionTimeout:true,routeTimeout:true});
const blocked=error=>error?.cancelled===true||error?.name==='AbortError'||error?.needsAuthorization===true||error?.stale===true||
 error?.identity===true||error?.identityChanged===true||error?.settingsUnavailable===true||error?.resourceRefusal===true||error?.targetResourceRefusal===true;
const terminal=error=>error?.uncertain===true||blocked(error);
const text=(value,max=96)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').replace(/CL[13]-[0-9a-f]{12}-[0-9a-f]{32}/gi,'[private group information]').slice(0,max):'';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// Call only where the caller knows this failed acquisition issued reads only.
// The helper does not infer HTTP methods and is unsafe after a possible write.
export function readOnlyConnectionFailure(error){
 if(error?.uncertain!==true||blocked(error))return error;
 const copy=Error(typeof error.message==='string'?error.message:'The lamp read was not confirmed.');
 for(const key of Object.keys(error))Object.defineProperty(copy,key,{value:error[key],writable:true,configurable:true,enumerable:true});
 if(typeof error.name==='string')copy.name=error.name;
 copy.cause=error;copy.uncertain=false;copy.readUncertain=true;return copy;
}

// This is a public confirmed-state projection, not a transport snapshot. Never
// retain passwords, bearer/session tokens, invitations, fleet keys or addresses.
function publicRaw(raw,id){
 if(raw?.deviceId!==id)return null;
 const value={deviceId:id};
 const name=text(raw.name);if(name)value.name=name;
 for(const [key,min,max] of [['mode',1,255],['brightness',1,255],['leds',1,4096],['apiVersion',1,255],['stateView',0,1]]){
  if(Object.hasOwn(raw,key)){if(!integer(raw[key],min,max))return null;value[key]=raw[key];}
 }
 if(Object.hasOwn(raw,'power')){if(typeof raw.power!=='boolean')return null;value.power=raw.power;}
 if(raw.firmware){const version=text(raw.firmware.version,64);if(version)value.firmware={version};}
 const style=normalizeLampStyle(raw.lampStyle);if(style)value.lampStyle=style;
 const model=normalizeLampModel(raw.model);if(model)value.model=model;
 if(raw.audio){value.audio={};for(const key of ['installed','liveTuning'])if(typeof raw.audio[key]==='boolean')value.audio[key]=raw.audio[key];
  for(const key of ['gain','gate','scale'])if(integer(raw.audio[key],0,65535))value.audio[key]=raw.audio[key];}
 if(raw.sync!==undefined){
  if(!groupObservation(raw))return null;
  const sync=raw.sync;value.sync={version:sync.version,role:sync.role,leader:sync.role?sync.leader:''};
  for(const key of ['active','paused','membershipLocked','coordinatorMigration','dissolutionV1','peerTruncated'])if(typeof sync[key]==='boolean')value.sync[key]=sync[key];
  for(const key of ['members','maxMembers','maxSupportedMembers','position','count','scene','sceneCount','sceneSpeed','sceneIntensity','peerTotal','peerCursor','peerNext'])
   if(integer(sync[key],0,65535))value.sync[key]=sync[key];
  if(/^[a-f0-9]{32}$/.test(sync.incarnation||''))value.sync.incarnation=sync.incarnation;
  if(Array.isArray(sync.protocolVersions))value.sync.protocolVersions=[...new Set(sync.protocolVersions.filter(version=>[1,2,3].includes(version)))].slice(0,3);
  if(['udp','esp-now','hybrid','none'].includes(sync.transport))value.sync.transport=sync.transport;
  for(const key of ['scenePrimary','sceneSecondary'])if(Array.isArray(sync[key])&&sync[key].length===3&&sync[key].every(channel=>integer(channel,0,255)))value.sync[key]=sync[key].slice();
  for(const [key,limit]of [['order',32],['peers',8]])if(Array.isArray(sync[key]))value.sync[key]=sync[key].filter(peer=>canonical(peer?.id)).slice(0,limit).map(peer=>({id:peer.id,name:text(peer.name)||'Lamp',...(typeof peer.online==='boolean'?{online:peer.online}:{})}));
 }
 return value;
}

// The broker acquires and verifies connections only. Commands remain pinned to
// their selected transport and existing receipt contract; selection never replays
// a write. Adapters own authorization, hardware admission and transport cleanup.
export class ConnectionBroker {
 // WKWebView requires Window timers to retain their Window receiver even when
 // the scheduler is stored and called through a broker instance.
 constructor({now=Date.now,ttl=15000,onStatus,setTimer=(callback,delay)=>globalThis.setTimeout(callback,delay),clearTimer=handle=>globalThis.clearTimeout(handle)}={}){
  if(typeof now!=='function'||!Number.isFinite(ttl)||ttl<1)throw Error('Invalid connection broker clock or freshness.');
  Object.assign(this,{now,ttl,onStatus,setTimer,clearTimer});this.records=new Map();this.revisions=new Map();this.versions=new Map();this.selections=new Map();this.active=new Map();
 }
 revision(id){return this.revisions.get(id)||0;}
 get(id){
  const row=this.records.get(id);if(!row)return freeze({id,state:'unknown',route:null,verified:false,available:false,fresh:false,checkedAt:null});
  const fresh=row.verified===true&&Number.isFinite(row.checkedAt)&&this.now()-row.checkedAt<this.ttl;
  return freeze(clone({...row,fresh,available:fresh&&row.available===true,verified:fresh,state:!fresh&&row.state==='ready'?'stale':row.state}));
 }
 notify(id,callback){const value=this.get(id);try{this.onStatus?.(id,value);}catch{/* Presentation cannot change acquisition ownership. */}try{callback?.(value);}catch{}return value;}
 observe(id,{raw,catalog,route,checkedAt=this.now(),generation}={}){
  if(!canonical(id)||!kinds.includes(route)||!Number.isFinite(checkedAt)||checkedAt<0||checkedAt>this.now())return false;
  if(generation!==undefined&&generation!==this.selections.get(id))return false;
  const previous=this.records.get(id);if(Number.isFinite(previous?.checkedAt)&&checkedAt<previous.checkedAt)return false;
  const value=publicRaw(raw,id);if(!value)return false;
  let effects;try{if(catalog!==undefined)effects=validateCatalog(catalog,catalog.length);}catch{return false;}
  this.versions.set(id,(this.versions.get(id)||0)+1);
  this.records.set(id,{id,state:'ready',route,checkedAt,verified:true,available:true,raw:value,...(effects?{catalog:effects}:{})});this.notify(id);return true;
 }
 invalidate(id){
  this.revisions.set(id,this.revision(id)+1);this.versions.set(id,(this.versions.get(id)||0)+1);
  this.selections.set(id,(this.selections.get(id)||0)+1);
  for(const dispose of [...this.active.get(id)||[]])dispose();
  const previous=this.records.get(id);if(previous)this.records.set(id,{...previous,state:'unknown',verified:false,available:false});this.notify(id);
 }
 forget(id){this.revisions.set(id,this.revision(id)+1);this.versions.set(id,(this.versions.get(id)||0)+1);this.selections.set(id,(this.selections.get(id)||0)+1);for(const dispose of [...this.active.get(id)||[]])dispose();this.records.delete(id);this.notify(id);}
 async select(id,{routes=[],only=null,signal,isCurrent=()=>true,timeoutMs=25000,verify,onStatus}={}){
  if(!canonical(id)||typeof verify!=='function'||typeof isCurrent!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1)throw failure('Select a verified lamp and a bounded connection operation.');
  const allowed=only==null?kinds:Array.isArray(only)?only:[only];
  const plan=routes.map((route,index)=>({...route,index})).filter(route=>allowed.includes(route.kind)&&kinds.includes(route.kind)&&typeof route.acquire==='function')
   .sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.index-b.index);
  const revision=this.revision(id),version=(this.versions.get(id)||0)+1,deadline=this.now()+timeoutMs;this.versions.set(id,version);
  const generation=(this.selections.get(id)||0)+1;this.selections.set(id,generation);
  const current=()=>{try{return !signal?.aborted&&Boolean(isCurrent())&&this.revision(id)===revision;}catch{return false;}};
  // A verified connection can lack a usable state/catalog observation. Only
  // observe() may carry those fields forward as newly confirmed lamp data.
  const publish=(state,route)=>{if(this.versions.get(id)!==version)return;const old=state==='ready'?{}:this.records.get(id)||{};this.records.set(id,{...old,id,state,route:route??old.route??null,available:state==='ready',verified:state==='ready',...(state==='ready'?{checkedAt:this.now()}:{})});this.notify(id,onStatus);};
  let lastError;
  for(const route of plan){
   if(!current())throw cancelled();
   const remaining=deadline-this.now();if(remaining<=0){lastError=timedOut();break;}
   const slice=Number.isFinite(route.timeoutMs)&&route.timeoutMs>0?Math.min(remaining,route.timeoutMs):remaining;
   const routeDeadline=this.now()+slice,controller=new AbortController();let expired=false,retained=false,closed=false,value,hasValue=false,released=false,timer,abort,rejectInterrupted;
   const live=()=>!closed&&!controller.signal.aborted&&current()&&(retained||!expired&&this.now()<routeDeadline);
   const guard=()=>{if(expired||!retained&&this.now()>=routeDeadline)throw timedOut();if(!live())throw cancelled();};
   const registrations=this.active.get(id)||new Set();this.active.set(id,registrations);
   const dispose=()=>{if(closed)return;closed=true;controller.abort();signal?.removeEventListener('abort',abort);registrations.delete(dispose);if(!registrations.size&&this.active.get(id)===registrations)this.active.delete(id);if(!retained)rejectInterrupted?.(cancelled());};
   registrations.add(dispose);
   const context={id,kind:route.kind,generation,signal:controller.signal,isCurrent:live,guard,dispose,deadline:routeDeadline,remainingMs:()=>retained?Infinity:Math.max(0,routeDeadline-this.now())};
   const release=async candidate=>{if(released)return;released=true;try{await candidate?.release?.();}catch{/* Retain the original route outcome. */}};
   const pending=Promise.resolve().then(()=>{guard();return route.acquire(context);}).then(candidate=>{value=candidate;hasValue=true;if(!live()){void release(candidate);guard();}return candidate;});
   publish('connecting',route.kind);
   try{
    const interrupted=new Promise((_,reject)=>{
     rejectInterrupted=reject;
     timer=this.setTimer(()=>{expired=true;controller.abort();reject(timedOut());},slice);
     abort=dispose;signal?.addEventListener('abort',abort,{once:true});
     if(signal?.aborted)abort();
    });
    const verified=pending.then(async candidate=>{
     guard();if(!await verify(candidate,context))throw failure('This connection did not verify the intended lamp.',{stale:true,identityChanged:true});
     guard();return candidate;
    });
    value=await Promise.race([verified,interrupted]);guard();
    retained=true;this.clearTimer(timer);
    // The successful context is now owned by the caller's live lease/selection.
    // Removing the acquisition deadline must not retire that persistent guard.
    publish('ready',route.kind);return value;
   }catch(error){
    lastError=expired?timedOut():error;dispose();
    if(hasValue)await release(value);else void pending.then(release,()=>{});
    if(!current())lastError=cancelled();
    if(terminal(lastError)){publish(lastError.cancelled?'cancelled':'failed',route.kind);throw lastError;}
   }finally{this.clearTimer(timer);if(!retained)signal?.removeEventListener('abort',abort);}
  }
  if(!current())throw cancelled();
  publish('unreachable',null);throw lastError||failure('No authorized connection is currently available for this lamp.',{noRoute:true});
 }
}
