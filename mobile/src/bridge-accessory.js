import {MeshTransport} from './mesh.js';

export const BRIDGE_MODEL='coollamp.bridge.heltec-wifi-kit32-v3';
export const BRIDGE_SETUP_MESSAGE='Bridge added. Follow its screen to join the setup network, then open 192.168.4.1 in a browser to connect it to home Wi-Fi. Return to Lamps → Bridges and choose Find a bridge to check its connection and lamps.';
const storageKey='coollamp-bridges-v1',capacity=8;
const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const bridgeAddress=value=>typeof value==='string'&&value.split('.').length===4&&value.split('.').every(part=>/^(0|[1-9]\d{0,2})$/.test(part)&&Number(part)<=255)&&!['0.0.0.0','255.255.255.255'].includes(value)?value:null;
const transaction=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const changed=()=>Object.assign(Error('Device setup changed or was canceled.'),{cancelled:true,confirmed:true});
const unconfirmed=()=>Object.assign(Error('Device approval was saved, but its type was not confirmed. Check setup before continuing.'),{uncertain:true});
const lightFields=['effects','effectCount','catalogVersion','mode','brightness','power','leds','colors','effectOptions','lampStyle','audio'];
const allowedCapabilities=['mesh-control','trusted-cached-donation'];

// A truthful role/model is mandatory before this accessory can bypass lamp
// setup. Unknown accessory roles and bridge-shaped light snapshots fail closed.
export function bridgeDescriptor(value,target){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.deviceId!==target||!canonical(target))throw unconfirmed();
  if(value.role===undefined||value.role==='lamp')return null;
  if(value.role!=='bridge'||value.model?.id!==BRIDGE_MODEL||lightFields.some(field=>Object.hasOwn(value,field))||
    !Array.isArray(value.capabilities)||!allowedCapabilities.every(capability=>value.capabilities.includes(capability))||
    typeof value.firmwareVersion!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value.firmwareVersion))throw unconfirmed();
  const name=typeof value.name==='string'?value.name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,32):'';
  const address=bridgeAddress(value.address);
  return Object.freeze({id:target,role:'bridge',modelId:BRIDGE_MODEL,name:name||'CoolLamp Bridge',
    firmwareVersion:value.firmwareVersion,capabilities:Object.freeze([...allowedCapabilities]),...(address?{address}:{})});
}

function savedRecord(value){
  if(!canonical(value?.id)||value.role!=='bridge'||value.modelId!==BRIDGE_MODEL||!canonical(value.meshBridgeId)||
    !Number.isSafeInteger(value.verifiedAt)||value.verifiedAt<0)return null;
  try{
    const descriptor=bridgeDescriptor({deviceId:value.id,role:value.role,model:{id:value.modelId},
      name:value.name,firmwareVersion:value.firmwareVersion,capabilities:value.capabilities,address:value.address},value.id);
    const fleetId=transaction(value.fleetId)?value.fleetId:null;
    return Object.freeze({...descriptor,meshBridgeId:value.meshBridgeId,verifiedAt:value.verifiedAt,...(fleetId?{fleetId}:{})});
  }catch{return null;}
}

// Separate, bounded display metadata. Fleet keys, pairing identifiers,
// request/boot nonces, access passwords, and lamp settings are never persisted.
export class BridgeAccessoryStore {
  constructor(storage){
    this.storage=storage;this.items=[];
    try{
      const text=storage.getItem(storageKey)||'[]';if(text.length>8192)return;
      const values=JSON.parse(text);if(!Array.isArray(values))return;
      for(const value of values){
        const record=savedRecord(value);if(!record)continue;
        const index=this.items.findIndex(item=>item.id===record.id);
        if(index>=0)this.items[index]=record;else if(this.items.length<capacity)this.items.push(record);
      }
    }catch{ /* Malformed display metadata cannot become a lamp or a credential. */ }
  }
  has(id){return this.items.some(item=>item.id===id);}
  remember(descriptor,{bridgeId,fleetId,verifiedAt=Date.now()}={}){
    const record=savedRecord({...descriptor,meshBridgeId:bridgeId,fleetId,verifiedAt});if(!record)throw unconfirmed();
    const index=this.items.findIndex(item=>item.id===record.id);
    if(index<0&&this.items.length>=capacity)throw Error('This phone already has eight saved bridges. No bridge was removed.');
    const items=[...this.items];if(index<0)items.push(record);else items[index]=record;
    this.storage.setItem(storageKey,JSON.stringify(items));this.items=items;return record;
  }
}

function enrollmentStatus(value,result,pinned=null){
  if(value?.version!==1||value.phase!=='complete'||value.target!==result.target||value.requestId!==result.requestId||
    value.broker!==result.broker||value.fleetId!==result.fleetId||!transaction(value.targetBoot)||!transaction(value.brokerBoot)||
    pinned&&(value.targetBoot!==pinned.targetBoot||value.brokerBoot!==pinned.brokerBoot))throw unconfirmed();
  return {targetBoot:value.targetBoot,brokerBoot:value.brokerBoot};
}

function meshPresence(value,result,pinned=null,allowNotReady=false){
  if(value?.version!==1||value.deviceId!==result.bridgeId||value.fleetId!==result.fleetId||typeof value.available!=='boolean'||
    !transaction(value.boot)||!Array.isArray(value.peers)||value.peers.length>16)throw unconfirmed();
  const peers=value.peers.filter(peer=>peer?.id===result.target);
  if(peers.length>1||peers.length&&(!transaction(peers[0].boot)||typeof peers[0].online!=='boolean'||
    !Number.isInteger(peers[0].hops)||peers[0].hops<1||peers[0].hops>4))throw unconfirmed();
  if(!value.available||!peers.length||!peers[0].online){
    if(!allowNotReady)throw unconfirmed();
    return {targetBoot:null,brokerBoot:value.boot};
  }
  const presence={targetBoot:peers[0].boot,brokerBoot:value.boot};
  if(pinned&&(presence.targetBoot!==pinned.targetBoot||presence.brokerBoot!==pinned.brokerBoot))throw unconfirmed();
  return presence;
}

// Called only after MeshOnboarding's durable physical approval. Reuse the
// original known broker for this read; do not acquire a lamp snapshot/effects,
// scan alternate routes, repeat enrollment, or accept an announcement as proof.
export async function identifyEnrolledBridge({result,acquireBridge,accessories,signal,isCurrent=()=>true,
  now=Date.now,timeout=12000,id}={}){
  if(!canonical(result?.target)||!canonical(result.bridgeId)||!canonical(result.broker)||
    !transaction(result.requestId)||!transaction(result.fleetId)||typeof acquireBridge!=='function')throw unconfirmed();
  const deadline=now()+Math.max(1,Math.min(12000,timeout));let lease,broker,epoch,address;
  const guard=()=>{
    if(signal?.aborted||!isCurrent())throw changed();
    if(now()>=deadline)throw unconfirmed();
    if(broker&&(broker.identity!==result.bridgeId||broker.epoch!==epoch||broker.base!==address))throw changed();
  };
  const bounded=async action=>{
    guard();let timer,abort;
    try{
      const value=await Promise.race([Promise.resolve().then(()=>{guard();return action();}),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(unconfirmed()),Math.max(1,deadline-now()));abort=()=>reject(changed());
        if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      })]);guard();return value;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
  let acquisitionExpired=false;
  const acquisition=Promise.resolve().then(()=>{guard();return acquireBridge(result.bridgeId,{signal,isCurrent});});
  acquisition.then(value=>{if(acquisitionExpired)void value?.release?.();},()=>{});
  try{
    try{lease=await bounded(()=>acquisition);}catch(error){acquisitionExpired=true;throw error;}
    broker=lease?.lamp||lease?.transport;epoch=broker?.epoch;address=broker?.base;guard();
    if(typeof broker?.request!=='function')throw unconfirmed();
    const fields={target:result.target,requestId:result.requestId,broker:result.broker};
    const readApproval=()=>bounded(async()=>parse(await broker.request('/api/mesh/enroll/status',fields,epoch,guard,guard)));
    const commission=enrollmentStatus(await readApproval(),result);
    const readMesh=()=>bounded(async()=>parse(await broker.request('/api/mesh/status',undefined,epoch,guard,guard)));
    const waitForMesh=async()=>{
      let observedBrokerBoot;
      for(;;){
        const presence=meshPresence(await readMesh(),result,null,true);
        if(observedBrokerBoot&&presence.brokerBoot!==observedBrokerBoot)throw unconfirmed();
        observedBrokerBoot=presence.brokerBoot;
        if(presence.targetBoot)return presence;
        // Complete releases commissioning's radio ownership before presence
        // announcements and the live mesh challenge have propagated. Wait only
        // through fresh reads of the original broker, within the same deadline.
        await bounded(()=>new Promise(resolve=>setTimeout(resolve,Math.min(120,Math.max(1,deadline-now())))));
      }
    };
    const mesh=await waitForMesh();
    // Bind only a read relay, without MeshTransport.connect(), which requires a
    // lamp state and a light catalog. Its paged reply validates fresh request ID,
    // exact target, HTTP status, and the authenticated mesh boot on every page.
    // Commissioning's advertised exchange nonce belongs to a separate domain;
    // it must never be compared to the target's mesh session boot.
    const relay=new MeshTransport({timeout:Math.min(6000,Math.max(1,deadline-now())),now,...(id?{id}:{})});
    Object.assign(relay,{target:result.target,targetBoot:mesh.targetBoot,bridge:broker,bridgeIdentity:result.bridgeId,
      bridgeEpoch:epoch,signal,isCurrent});
    let value;
    try{value=parse(await bounded(()=>relay.request('/api/descriptor',undefined,relay.epoch,guard,guard)));}
    catch(error){
      if(error.confirmed&&!error.cancelled&&[404,405,501].includes(error.status))return null;
      throw error;
    }
    const descriptor=bridgeDescriptor(value,result.target);
    if(!descriptor)return null;
    enrollmentStatus(await readApproval(),result,commission);
    meshPresence(await readMesh(),result,mesh);guard();
    return accessories.remember(descriptor,{bridgeId:result.bridgeId,fleetId:result.fleetId,verifiedAt:now()});
  }finally{await lease?.release?.();}
}
