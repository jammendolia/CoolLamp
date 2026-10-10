import { WifiTransport } from './wifi.js';
import { validateCatalog } from './catalog.js';
import { normalizeLampStyle } from './lamp-style.js';
import { validFirmwareVersion } from './lamps.js';

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const transaction=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const endpoints=Object.freeze({'/api/state':1,'/api/sync/status':2,'/api/sync/invite':3,'/api/sync':4,'/api/sync/scene':5,
 '/api/sync/order':6,'/api/config':7,'/api/audio':8,'/api/audio/tuning':9,'/api/rotation':10,'/api/geometry':11,
 '/api/calibration':12,'/api/name':13,'/api/identify':14,'/api/vu-colors':15,'/api/fountain-colors':16,
 '/api/audio/test':17,'/api/firmware':18,'/api/firmware/check':19,'/api/firmware/install':20,
 '/api/firmware/automatic':21,'/api/factory-reset':22,'/api/bluetooth':24,'/api/bluetooth/forget':24,
 '/api/style':25,'/api/effects':26,'/api/power':31,'/api/preview':32,'/api/defaults':33,'/api/color':34,'/api/effect-options':35,
 '/api/mesh/new':36,'/api/mesh/enroll/start':37,'/api/mesh/enroll/status':38,'/api/mesh/enroll/cancel':39,
 '/api/descriptor':40,'/api/effects/schema':41,'/api/state/patch':42,'/api/appearance/save':43,'/api/receipt':44,'/api/revision':45,'/api/firmware/policy':46,'/api/sync/page':47,'/api/household':48,'/api/firmware/rollout':51,'/api/group/remove':52});
const cancelled=()=>Object.assign(Error('Lamp selection changed.'),{confirmed:true,cancelled:true});
const noRoute=()=>Object.assign(Error('No mesh route to this lamp. Bring it nearby and connect directly over Bluetooth.'),{confirmed:true,noRoute:true});
const unconfirmed=()=>Object.assign(Error('The mesh reply was not confirmed. Refresh this lamp before trying again; connect directly over Bluetooth if needed.'),{uncertain:true});
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const randomId=()=>[...crypto.getRandomValues(new Uint8Array(8))].map(value=>value.toString(16).padStart(2,'0')).join('');
const verifiedBridges=new WeakMap();
const modernBridge=bridge=>{const version=validFirmwareVersion(bridge?.raw?.firmware?.version)?.split('.').map(Number);return version&&(version[0]>1||version[0]===1&&version[1]>=13);};
const validInventory=(value,bridge)=>value?.version===1&&value.deviceId===bridge?.identity&&canonical(value.deviceId)&&transaction(value.fleetId)&&typeof value.available==='boolean'&&Array.isArray(value.peers);

export function meshBridgeSupported(bridge) {
 const verified=bridge&&verifiedBridges.get(bridge);
 return canonical(bridge?.identity)&&typeof bridge.request==='function'&&(verified?.identity===bridge.identity&&verified.epoch===bridge.epoch||bridge.control?.capabilities?.includes('mesh-control')||bridge.raw?.mesh?.version===1&&bridge.raw.mesh.available===true);
}

// Discovery is session-only. An inventory advertisement never grants pairing,
// supplies credentials, or changes which lamp is selected.
export class MeshInventorySession {
 constructor(){this.lamps=new Map();this.forgotten=new Set();}
 get items(){return [...this.lamps.values()];}
 forget(id){this.forgotten.add(id);this.lamps.delete(id);}
 remember(value,bridgeId){
  if(value?.version!==1||value.deviceId!==bridgeId||!canonical(bridgeId)||!transaction(value.fleetId)||value.available!==true||!Array.isArray(value.peers))return this.items;
  for(const peer of value.peers.slice(0,16)){
   if(!canonical(peer?.id)||peer.id===bridgeId||this.forgotten.has(peer.id)||typeof peer.online!=='boolean'||!Number.isInteger(peer.hops)||peer.hops<1||peer.hops>4)continue;
   this.lamps.set(peer.id,{id:peer.id,name:typeof peer.name==='string'?peer.name.slice(0,64):'CoolLamp',meshBridgeId:bridgeId,meshOnline:peer.online,meshHops:peer.hops});
  }return this.items;
 }
}

// One accepted bridge owns each request. Only result pages are retried/polled;
// an uncertain target mutation is never submitted again on this or another path.
export class MeshTransport extends WifiTransport {
 constructor({callbacks={},timeout=6000,pollInterval=120,now=Date.now,id=randomId}={}){
  super(null,callbacks);Object.assign(this,{timeout,pollInterval,now,nextId:id,isMesh:true});this.usedIds=new Set();
 }
 guard(epoch=this.epoch){
  if(epoch!==this.epoch||!this.bridge||this.signal?.aborted||!this.isCurrent())throw cancelled();
  if(this.bridge.epoch!==this.bridgeEpoch||this.bridge.identity!==this.bridgeIdentity)throw Object.assign(Error('Mesh bridge connection changed. Refresh this lamp.'),{confirmed:true,cancelled:true});
 }
 async bounded(action,deadline,epoch,mutation=false){
  this.guard(epoch);const remaining=deadline-this.now();if(remaining<=0)throw unconfirmed();
  let timer,abort;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(unconfirmed()),remaining);
   abort=()=>reject(mutation?Object.assign(unconfirmed(),{cancelled:true}):cancelled());
   this.signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);this.signal?.removeEventListener('abort',abort);}
 }
 async request(path,data,epoch=this.epoch,beforeWrite=null){
  const endpoint=endpoints[path];
  const direct=()=>Object.assign(Error('Use a direct Wi-Fi or Bluetooth connection to this lamp for this setting.'),{confirmed:true,needsDirectConnection:true});
  if(!endpoint||[19,20,22,24].includes(endpoint))throw direct();
  if(path==='/api/bluetooth/forget')data={...data,action:'forget'};
  const mutation=data!==undefined,body=mutation?new URLSearchParams(data).toString():'';
  if(new TextEncoder().encode(body).length>1022)throw Object.assign(Error('These settings exceed the mesh request limit.'),{confirmed:true});
  let requestId;for(let attempt=0;attempt<8;++attempt){const candidate=this.nextId();if(transaction(candidate)&&!this.usedIds.has(candidate)){requestId=candidate;break;}}
  if(!requestId)throw Object.assign(Error('Could not create a fresh mesh request. Reconnect before trying again.'),{confirmed:true});
  const fields={target:this.target,requestId,endpoint,method:mutation?2:1,body};
  if(this.bridge?.control&&new TextEncoder().encode(new URLSearchParams(fields).toString()).length>1024)throw Object.assign(Error('These settings exceed the Bluetooth bridge request limit.'),{confirmed:true});
  this.usedIds.add(requestId);const deadline=this.now()+this.timeout,target=this.target;
  let reply,submitted=false,resultPolling=false,confirmedReply=false;
  const read=async action=>{const value=parse(await this.bounded(action,deadline,epoch,mutation&&submitted));this.guard(epoch);
   if(value?.version!==1||value.target!==target||value.requestId!==requestId||!['pending','ok','no-route','rejected'].includes(value.status)||typeof value.executed!=='boolean')throw unconfirmed();return value;};
  try{
   this.guard(epoch);beforeWrite?.();submitted=true;
   reply=await read(()=>this.bridge.request('/api/mesh/request',fields,this.bridgeEpoch,()=>{this.guard(epoch);if(this.now()>=deadline)throw unconfirmed();beforeWrite?.();}));
   let bytes,total,status,targetBoot,offset=0;
   for(;;){
    this.guard(epoch);
    if(reply.uncertain===true)throw unconfirmed();
    if(reply.status==='no-route'){if(reply.executed||offset)throw unconfirmed();confirmedReply=true;throw noRoute();}
    if(reply.status==='rejected'){
     if(reply.executed)throw unconfirmed();confirmedReply=true;throw Object.assign(Error('Mesh bridge rejected this request. Connect directly over Bluetooth.'),{confirmed:true,status:reply.httpStatus});
    }
    if(reply.status==='ok'){
     if(!transaction(reply.targetBoot)||targetBoot&&reply.targetBoot!==targetBoot||this.targetBoot&&reply.targetBoot!==this.targetBoot)throw Object.assign(unconfirmed(),{targetRestarted:true});
     targetBoot=reply.targetBoot;
     if(!reply.executed||!Number.isInteger(reply.httpStatus)||reply.httpStatus<100||reply.httpStatus>599||!Number.isInteger(reply.total)||reply.total<0||reply.total>8192||reply.offset!==offset||typeof reply.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reply.data))throw unconfirmed();
     const page=Uint8Array.from(atob(reply.data),char=>char.charCodeAt(0));
     if(page.length>256||!page.length&&offset<reply.total||offset+page.length>reply.total)throw unconfirmed();
     if(total===undefined){total=reply.total;status=reply.httpStatus;bytes=new Uint8Array(total);}
     if(total!==reply.total||status!==reply.httpStatus)throw unconfirmed();
     bytes.set(page,offset);offset+=page.length;
     if(offset===total){const result=new TextDecoder('utf-8',{fatal:true}).decode(bytes);bytes.fill(0);this.targetBoot=targetBoot;confirmedReply=true;
      if(status<200||status>=300)throw Object.assign(Error(result||'Lamp rejected the request.'),{confirmed:true,status});return result;}
    }else await this.bounded(()=>new Promise(resolve=>setTimeout(resolve,this.pollInterval)),deadline,epoch,mutation&&submitted);
    resultPolling=true;reply=await read(()=>this.bridge.request('/api/mesh/result',{target,requestId,offset}));
   }
  }catch(error){
   if(resultPolling&&!confirmedReply||mutation&&submitted&&(!error.confirmed||error.cancelled)){error.uncertain=true;error.confirmed=false;delete error.noRoute;}
   throw error;
  }
 }
 async connect(target,lease,{signal,isCurrent=()=>true,poll=true}={}){
  await this.disconnect();if(!canonical(target)||!meshBridgeSupported(lease?.lamp))throw noRoute();
  this.target=target;this.bridge=lease.lamp;this.bridgeIdentity=this.bridge.identity;this.bridgeEpoch=this.bridge.epoch;this.lease=lease;
  this.signal=signal;this.isCurrent=isCurrent;this.base='mesh:'+target+'@'+this.bridgeIdentity;
  try{await this.refresh(target);this.guard();if(poll)this.schedule();return this.raw;}
  catch(error){await this.disconnect();throw error;}
 }
 async refresh(expectedId=this.target,retryCatalog=true){
  const epoch=this.epoch,raw=parse(await this.request('/api/state'));this.guard(epoch);
  if(raw?.deviceId!==this.target||raw.deviceId!==expectedId||!Array.isArray(raw.effects)||typeof raw.hostname!=='string'||typeof raw.power!=='boolean'||!Number.isInteger(raw.mode)||!Number.isInteger(raw.brightness)||raw.brightness<1||raw.brightness>255||!Number.isInteger(raw.leds)||raw.leds<1||raw.leds>1024)throw Error('Invalid target lamp snapshot from mesh.');
  let catalog=this.catalog;
  if(!catalog||catalog.length!==raw.effects.length||this.raw?.firmware?.version!==raw.firmware?.version){
   const entries=parse(await this.request('/api/effects'));this.guard(epoch);
   if(Array.isArray(entries)&&entries.length!==raw.effects.length&&retryCatalog)return this.refresh(expectedId,false);
   catalog=validateCatalog(entries,raw.effects.length);
  }
  if(!catalog.some(entry=>entry.id===raw.mode))throw Error('Invalid target lamp effect from mesh.');
  const snapshot={};for(const field of ['deviceId','hostname','name','ssid','leds','milliamps','midpoint','startupMode','startupBrightness','mode','brightness','power','apiVersion','catalogVersion','effects','colors','effectOptions','vuColors','fountainColors','audio','rotation','calibration','firmware','sync','factoryReset','usingDefaultPassword','effectiveMidpoint'])if(raw[field]!==undefined)snapshot[field]=raw[field];
  if(snapshot.sync){snapshot.sync={...snapshot.sync};for(const field of ['key','code','invite'])delete snapshot.sync[field];}
  const design=normalizeLampStyle(raw.lampStyle);if(design)snapshot.lampStyle=design;
  this.identity=this.target;this.catalog=catalog;this.raw=snapshot;
  const color=raw.colors?.[raw.mode-1],options=raw.effectOptions?.[raw.mode-1];
  this.state={...snapshot,effectCount:catalog.length,capabilities:4|(color?2:0)|(raw.effectOptions?8:0)|(raw.factoryReset?128:0),supportsColor:Boolean(color),color:color?{enabled:Boolean(color[0]),r:color[1],g:color[2],b:color[3]}:null};
  this.callbacks.onState?.(this.state,{freshControl:true});this.callbacks.onFirmware?.(raw.firmware);
  this.callbacks.onOptions?.(options?{mode:raw.mode,speed:options[0],intensity:options[1],dual:options[2],r:options[3],g:options[4],b:options[5]}:null);return snapshot;
 }
 async disconnect(){const lease=this.lease;this.lease=null;this.bridge=null;this.target=null;this.targetBoot=null;await super.disconnect();await lease?.release?.();}
}

export async function acquireMeshLamp({target,candidates,acquireBridge,signal,isCurrent=()=>true,options={},onInventory=()=>{}}){
 const current=()=>{if(signal?.aborted||!isCurrent())throw cancelled();};let lastError,uncertainError;
 const bounded=async(action,lateRelease=false)=>{
  let timer,abort,settled=false;const pending=Promise.resolve().then(action);
  pending.then(value=>{if(settled&&lateRelease)void value?.release?.();},()=>{});
  try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(noRoute()),options.timeout??6000);abort=()=>reject(cancelled());signal?.addEventListener('abort',abort,{once:true});})]);}
  finally{settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
 for(const candidate of candidates){
  current();let lease,transport;
  try{
   lease=await bounded(()=>acquireBridge(candidate),true);current();if(!meshBridgeSupported(lease?.lamp)&&!modernBridge(lease?.lamp)){await lease?.release?.();lease=null;continue;}
   const bridge=lease.lamp;
   const inventory=parse(await bounded(()=>bridge.request('/api/mesh/status')));current();
   if(!validInventory(inventory,bridge)||inventory.available!==true)throw noRoute();
   verifiedBridges.set(bridge,{identity:bridge.identity,epoch:bridge.epoch});onInventory(inventory,bridge.identity);
   transport=new MeshTransport(options);const owned=lease;lease=null;await transport.connect(target,owned,{signal,isCurrent,poll:false});current();return {lamp:transport,release:()=>transport.disconnect()};
  }catch(error){lastError=error;if(error.uncertain)uncertainError=error;await transport?.disconnect();await lease?.release?.();current();if(error.cancelled)throw error;}
 }
 if(uncertainError)throw uncertainError;
 if(lastError&&!lastError.noRoute&&!lastError.confirmed)throw lastError;
 throw noRoute();
}
