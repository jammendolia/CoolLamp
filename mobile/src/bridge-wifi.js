import {bridgeDescriptor} from './bridge-accessory.js';
import {bridgeAddress} from './bridge-management.js';

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const transaction=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const encoded=value=>new TextEncoder().encode(value);
const failure=(message,fields={})=>Object.assign(Error(message),{bridgeWifiError:true,...fields});
const cancelled=()=>failure('Bridge connection changed.',{confirmed:true,cancelled:true});
const paths=new Set(['/api/mesh/status','/api/mesh/request','/api/mesh/result','/api/descriptor','/api/state']);
const direct=()=>failure('Use the lamp’s direct connection for this setting.',{confirmed:true,needsDirectConnection:true});
const MAX_REPLY=8192,MAX_REQUEST=2048,MAX_CONCURRENT=2;
const nativeOwners=new WeakMap();
function nativeFlights(http){let flights=nativeOwners.get(http);if(!flights){flights=new Set();nativeOwners.set(http,flights);}return flights;}
const readJson=value=>typeof value==='string'?JSON.parse(value):value;
function authorization(password){
 if(typeof password!=='string'||encoded(password).length<8||encoded(password).length>32)throw failure('Enter the bridge password chosen during setup.',{confirmed:true,needsPassword:true});
 const bytes=encoded('OWNER:'+password);try{return 'Basic '+btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));}finally{bytes.fill(0);}
}
function statusSnapshot(value,expectedId,expectedFleet,token=null){
 if(value?.role!=='bridge'||value.deviceId!==expectedId||value.fleetId!==expectedFleet||value.meshEnabled!==true||typeof value.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token)||token&&value.token!==token)throw failure('This bridge’s identity or household connection changed.',{confirmed:true,cancelled:true,identityChanged:true});
 return value;
}
function meshSnapshot(value,identity,fleet,boot=null){
 if(value?.version!==1||value.deviceId!==identity||value.fleetId!==fleet||!transaction(value.boot)||boot&&value.boot!==boot||typeof value.available!=='boolean'||!Array.isArray(value.peers)||value.peers.length>16)throw failure('This bridge’s radio session was not confirmed.',{confirmed:true,cancelled:true,bridgeRestarted:true});
 const ids=new Set();
 for(const peer of value.peers){if(!canonical(peer?.id)||ids.has(peer.id)||!transaction(peer.boot)||typeof peer.online!=='boolean'||!Number.isInteger(peer.hops)||peer.hops<1||peer.hops>4)throw failure('This bridge’s nearby devices were not confirmed.',{confirmed:true});ids.add(peer.id);}
 return value;
}
function requestFields(path,data){
 if(path==='/api/mesh/request'){
  if(!data||!canonical(data.target)||!transaction(data.requestId)||!Number.isInteger(Number(data.endpoint))||Number(data.endpoint)<1||Number(data.endpoint)>52||![1,2].includes(Number(data.method))||typeof data.body!=='string'||encoded(data.body).length>1022||data.targetBoot!==undefined&&!transaction(data.targetBoot))throw failure('Invalid bridge relay request.',{confirmed:true});
  // This broker is only a route to already-owned lamps. Enrollment, native
  // pairing/reset and firmware installations retain their separate contracts.
  if([19,20,22,24,36,37,38,39].includes(Number(data.endpoint)))throw direct();
  return {mutation:Number(data.method)===2,data};
 }
 if(path==='/api/mesh/result'){
  if(!data||!canonical(data.target)||!transaction(data.requestId)||!Number.isInteger(Number(data.offset))||Number(data.offset)<0||Number(data.offset)>8192||data.targetBoot!==undefined&&!transaction(data.targetBoot))throw failure('Invalid bridge result query.',{confirmed:true});
  return {mutation:false,data};
 }
 if(data!==undefined)throw direct();return {mutation:false,data:undefined};
}

// Owner-authenticated bridge route only. MeshTransport verifies the leaf lamp,
// request ID, target boot and response fragments; a bridge ACK is never a lamp
// execution receipt. This class never downloads an effect catalog or provisions.
export class BridgeWifiBroker {
 constructor(http,{timeout=8000,now=Date.now,expectedFleetId=null}={}){
  if(typeof http?.request!=='function')throw failure('Native bridge networking is unavailable.',{confirmed:true});
  this.http=http;this.timeout=Math.max(1,Math.min(8000,timeout));this.now=now;this.expectedFleetId=expectedFleetId;this.epoch=0;this.isBridge=true;this.active=new Set();this.nativeFlights=nativeFlights(http);this.connection=null;this.base=null;this.identity=null;this.raw=null;
 }
 fence(connection,epoch,before=null){
  if(connection!==this.connection||epoch!==this.epoch||this.base!==connection.base||this.identity!==connection.identity||connection.signal?.aborted||connection.isCurrent()!==true)throw cancelled();
  before?.();
  if(connection!==this.connection||epoch!==this.epoch||connection.signal?.aborted||connection.isCurrent()!==true)throw cancelled();
 }
 async io(connection,path,data,{epoch=this.epoch,beforeWrite=null,readGuard=null,deadline=this.now()+this.timeout,mutation=false}={}){
  const expectedToken=connection.token,expectedAuthorization=connection.authorization;
  const guard=()=>{this.fence(connection,epoch,readGuard);if(connection.token!==expectedToken||connection.authorization!==expectedAuthorization)throw cancelled();if(this.now()>=deadline)throw failure('The bridge did not answer in time.',{confirmed:!mutation,uncertain:mutation,requestDeadline:true});};
  guard();if(this.active.size>=MAX_CONCURRENT||this.nativeFlights.size>=MAX_CONCURRENT)throw failure('The bridge is finishing its previous requests. Wait a moment before checking again.',{confirmed:true,status:503,busy:true});
  const remaining=Math.max(1,Math.floor(deadline-this.now())),owned=new AbortController(),headers={Authorization:connection.authorization};
  const request={url:connection.base+path,method:data===undefined?'GET':'POST',headers,responseType:'text',connectTimeout:Math.min(4000,remaining),readTimeout:remaining,disableRedirects:true};
  if(data!==undefined){if(!connection.token)throw failure('Refresh this bridge before changing a lamp.',{confirmed:true});headers['X-Lamp-Token']=connection.token;headers['Content-Type']='application/x-www-form-urlencoded';request.data=new URLSearchParams(data).toString();if(encoded(request.data).length>MAX_REQUEST)throw failure('Bridge request exceeds its bounded size.',{confirmed:true});}
  let timer,abort,stop,dispatched=false;this.active.add(owned);
  try{
   const response=await Promise.race([Promise.resolve().then(()=>{
    guard();beforeWrite?.();guard();if(owned.signal.aborted)throw cancelled();
    if(this.nativeFlights.size>=MAX_CONCURRENT)throw failure('The bridge is finishing its previous requests. Wait a moment before checking again.',{confirmed:true,status:503,busy:true});
    // Native networking has no cancellation API. A JS timeout or disconnect
    // discards the result, but its slot remains owned until native settlement.
    const flight={};this.nativeFlights.add(flight);dispatched=true;let native;
    try{native=Promise.resolve(this.http.request(request));}catch(error){this.nativeFlights.delete(flight);throw error;}
    const settled=()=>{this.nativeFlights.delete(flight);};native.then(settled,settled);return native;
   }),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(failure('The bridge did not answer in time.',{confirmed:!mutation,uncertain:mutation&&dispatched,requestDeadline:true})),remaining);
    abort=()=>reject(mutation&&dispatched?failure('The lamp change is waiting for confirmation.',{uncertain:true,cancelled:true}):cancelled());stop=abort;
    connection.signal?.addEventListener('abort',abort,{once:true});owned.signal.addEventListener('abort',stop,{once:true});
   })]);
   guard();if(response?.url){let url;try{url=new URL(response.url);}catch{throw failure('Bridge response address was not confirmed.',{confirmed:true});}if(url.origin!==connection.base||url.pathname!==path)throw failure('Bridge response address changed.',{confirmed:true,cancelled:true});}
   if(response?.status===401)throw failure('Check the bridge access password.',{confirmed:true,needsPassword:true,status:401});
   if(response?.status===403)throw failure('The bridge connection changed. Open its saved card again.',{confirmed:true,status:403});
   const text=typeof response?.data==='string'?response.data:JSON.stringify(response?.data);if(typeof text!=='string'||encoded(text).length>MAX_REPLY)throw failure('Bridge response exceeded its size limit.',{uncertain:mutation&&dispatched,confirmed:!mutation});
   if(!Number.isInteger(response.status)||response.status<100||response.status>599)throw failure('Bridge response status was not confirmed.',{uncertain:mutation&&dispatched,confirmed:!mutation});
   if(response.status<200||response.status>=300)throw failure('The bridge did not accept this request.',{confirmed:true,status:response.status});
   return text;
  }catch(error){
   // Once a target mutation was submitted, a cancellation, timeout, malformed
   // reply or native disconnect is uncertain. Nothing automatically resubmits.
   if(mutation&&dispatched&&(!error.confirmed||error.cancelled))throw failure('The lamp change is waiting for confirmation. Check its original result before trying again.',{uncertain:true,cancelled:error.cancelled===true,status:error.status});
   if(error.bridgeWifiError)throw error;throw failure('The bridge did not answer.',{confirmed:!mutation,uncertain:mutation&&dispatched});
  }finally{clearTimeout(timer);connection.signal?.removeEventListener('abort',abort);owned.signal.removeEventListener('abort',stop);this.active.delete(owned);}
 }
 async connect(address,password,expectedId,{signal,isCurrent=()=>true,guard=null,expectedFleetId=this.expectedFleetId,fleetId,timeoutMs=this.timeout}={}){
  await this.disconnect();
  if(!canonical(expectedId)||!transaction(expectedFleetId||fleetId))throw failure('Find this bridge in your household before using it as a connection.',{confirmed:true});
  const epoch=this.epoch,base=bridgeAddress(address),connection={epoch,base,identity:expectedId,fleet:expectedFleetId||fleetId,authorization:authorization(password),signal,isCurrent:()=>isCurrent()===true&&(!guard||guard()!==false),token:null,boot:null,verified:false};
  this.connection=connection;this.base=base;this.identity=expectedId;const deadline=this.now()+Math.max(1,Math.min(8000,timeoutMs));
  try{
   const status=statusSnapshot(readJson(await this.io(connection,'/api/bridge/status',undefined,{epoch,deadline})),expectedId,connection.fleet);connection.token=status.token;
   const descriptor=bridgeDescriptor(readJson(await this.io(connection,'/api/descriptor',undefined,{epoch,deadline})),expectedId);if(!descriptor)throw failure('This device was not confirmed as a household bridge.',{confirmed:true});
   const mesh=meshSnapshot(readJson(await this.io(connection,'/api/mesh/status',undefined,{epoch,deadline})),expectedId,connection.fleet);connection.boot=mesh.boot;
   this.fence(connection,epoch);connection.verified=true;this.raw={role:'bridge',deviceId:expectedId,name:descriptor.name,firmware:{version:descriptor.firmwareVersion},fleetId:connection.fleet,mesh};return this.raw;
  }catch(error){if(epoch===this.epoch)await this.disconnect();if(error.bridgeWifiError)throw error;throw failure('The bridge connection was not confirmed.',{confirmed:true});}
 }
 async request(path,data,epoch=this.epoch,beforeWrite=null,readGuard=null){
  const connection=this.connection;if(!connection?.verified||!paths.has(path))throw direct();this.fence(connection,epoch,readGuard);
  const fields=requestFields(path,data),deadline=this.now()+this.timeout;
  try{
   if(path==='/api/mesh/request')statusSnapshot(readJson(await this.io(connection,'/api/bridge/status',undefined,{epoch,readGuard,deadline})),connection.identity,connection.fleet,connection.token);
   const text=await this.io(connection,path,fields.data,{epoch,beforeWrite,readGuard,mutation:fields.mutation,deadline});this.fence(connection,epoch,readGuard);
   if(path==='/api/mesh/status'){const mesh=meshSnapshot(readJson(text),connection.identity,connection.fleet,connection.boot);this.raw={...this.raw,mesh};}
   else if(path==='/api/descriptor'){if(!bridgeDescriptor(readJson(text),connection.identity))throw cancelled();}
   else if(path==='/api/state')statusSnapshot(readJson(text),connection.identity,connection.fleet,connection.token);
   return text;
  }catch(error){if(error.identityChanged||error.bridgeRestarted)await this.disconnect();throw error;}
 }
 adoptScope({isCurrent,guard,epoch=this.epoch,identity=this.identity,base=this.base}={}){
  const connection=this.connection;
  const live=()=>connection&&connection===this.connection&&connection.verified===true&&connection.epoch===epoch&&this.epoch===epoch&&connection.identity===identity&&this.identity===identity&&canonical(identity)&&connection.base===base&&this.base===base&&this.raw?.role==='bridge'&&this.raw.deviceId===identity&&this.raw.fleetId===connection.fleet&&this.raw.mesh?.boot===connection.boot;
  if(typeof isCurrent!=='function'||typeof guard!=='function'||!live())throw cancelled();
  if(this.active.size)throw failure('Finish the bridge check before handing its connection to another screen.',{confirmed:true,busy:true,status:503});
  // The acquisition intent may already have retired. Authority comes from the
  // new owner's guard over the verified transport/epoch, never from removing
  // checks altogether. Failed adoption cannot alter the previous scope.
  try{if(guard()===false||isCurrent()!==true)throw cancelled();}catch{throw cancelled();}
  if(!live()||this.active.size)throw cancelled();
  connection.signal=null;
  connection.isCurrent=()=>{try{return isCurrent()===true&&guard()!==false;}catch{return false;}};
  return true;
 }
 async disconnect(){
  this.epoch++;const connection=this.connection;this.connection=null;this.identity=null;this.raw=null;this.base=null;
  for(const request of this.active)request.abort();this.active.clear();if(connection){connection.token=null;connection.authorization=null;connection.verified=false;}
  // nativeFlights intentionally survives disconnect: late native requests may
  // still own sockets. Epoch checks prevent their replies being adopted.
 }
}
