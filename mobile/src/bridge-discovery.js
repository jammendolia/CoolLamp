import {MeshTransport} from './mesh.js';
import {bridgeDescriptor} from './bridge-accessory.js';

const id=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const boot=value=>typeof value==='string'&&/^[0-9a-f]{16}$/.test(value)&&!/^0+$/.test(value);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const failure=message=>Object.assign(Error(message),{confirmed:true});
const cancelled=()=>Object.assign(Error('Finding bridges was stopped.'),{cancelled:true,confirmed:true});

function inventory(raw,brokerId){
 const value=parse(raw);
 if(value?.version!==1||value.deviceId!==brokerId||value.available!==true||!boot(value.boot)||!boot(value.fleetId)||
    !Array.isArray(value.peers)||value.peers.length>16)throw failure('This lamp cannot currently find household bridges.');
 const seen=new Set();
 for(const peer of value.peers){
  if(!id(peer?.id)||seen.has(peer.id)||typeof peer.online!=='boolean'||!boot(peer.boot)||
     !Number.isInteger(peer.hops)||peer.hops<1||peer.hops>4)throw failure('The nearby device list could not be verified.');
  seen.add(peer.id);
 }
 return value;
}

// One read-only neighborhood page. The caller owns/releases the verified broker
// lease. Discovery never provisions keys, enrolls a device or downloads effects.
export async function discoverBridgePage({broker,brokerId,accessories,cursor=0,signal,isCurrent=()=>true,
 now=()=>Date.now(),timeout=7500,readDescriptor}={}){
 if(!id(brokerId)||!broker||typeof broker.request!=='function'||!accessories||
    !Number.isInteger(cursor)||cursor<0||cursor>16)throw failure('Choose an existing household lamp to find bridges.');
 const epoch=broker.epoch,base=broker.base,deadline=now()+Math.min(7500,Math.max(1,timeout));
 const guard=()=>{if(signal?.aborted||!isCurrent()||broker.epoch!==epoch||broker.base!==base)throw cancelled();};
 const bounded=async run=>{
  guard();let timer,abort;
  const remaining=deadline-now();if(remaining<=0)throw failure('Finding bridges took too long. Try finding them again.');
  try{return await Promise.race([Promise.resolve().then(()=>{guard();return run();}),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(failure('Finding bridges took too long. Try finding them again.')),remaining);
   abort=()=>reject(cancelled());signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
 const readInventory=async()=>inventory(await bounded(()=>broker.request('/api/mesh/status',undefined,epoch,guard,guard)),brokerId);
 const original=await readInventory();guard();
 const peers=[...original.peers].sort((a,b)=>a.id.localeCompare(b.id)),end=Math.min(peers.length,cursor+4);
 const found=[];
 for(const peer of peers.slice(cursor,end)){
  guard();if(!peer.online)continue;
  const relay=new MeshTransport({timeout:Math.max(1,Math.min(1500,deadline-now())),now});
  Object.assign(relay,{target:peer.id,targetBoot:peer.boot,bridge:broker,bridgeIdentity:brokerId,bridgeEpoch:epoch,signal,isCurrent});
  try{
   const raw=await bounded(()=>readDescriptor?readDescriptor(peer,guard):relay.request('/api/descriptor',undefined,relay.epoch,guard,guard));guard();
   const descriptor=bridgeDescriptor(parse(raw),peer.id);
   if(descriptor)found.push({descriptor,peerBoot:peer.boot});
  }catch(error){guard();if(error.cancelled||error.identity)throw error;/* Unavailable/unsupported devices stay in their existing inventory. */}
 }
 const fresh=await readInventory();guard();
 if(fresh.boot!==original.boot||fresh.fleetId!==original.fleetId)throw failure('The household connection restarted. Find bridges again.');
 const confirmed=[];
 for(const entry of found){
  const peer=fresh.peers.find(value=>value.id===entry.descriptor.id);
  if(!peer?.online||peer.boot!==entry.peerBoot)continue;
  confirmed.push(accessories.remember(entry.descriptor,{bridgeId:brokerId,fleetId:fresh.fleetId,verifiedAt:now()}));
 }
 return {bridges:confirmed,brokerId,fleetId:fresh.fleetId,cursor:end<peers.length?end:null,
         neighborhoodSize:peers.length,inventoryScope:'local-neighborhood'};
}
