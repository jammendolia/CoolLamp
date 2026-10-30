import {meshBridgeSupported} from './mesh.js';

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const fleet=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);

// Saved bridge records are authenticated accessories, not lamps or group
// coordinators. Their address is a hint; BridgeWifiBroker verifies it again.
export function meshRouteCandidates({target,activeBridge,entries=[],bridges=[],bridgeId=null,platform,connectivity,observations=[],now=Date.now}={}){
 const candidates=[],wifiFresh=entry=>{const wifi=connectivity?.get(entry.id)?.wifi;return wifi?.fresh&&wifi.state==='connected';};
 if(activeBridge&&activeBridge.identity!==target&&meshBridgeSupported(activeBridge))candidates.push({transport:activeBridge,epoch:activeBridge.epoch,id:activeBridge.identity});
 const lamps=entries.filter(entry=>canonical(entry?.id)&&entry.id!==target&&entry.role!=='bridge');
 const accessories=bridges.slice(0,8).filter(entry=>canonical(entry?.id)&&entry.id!==target&&entry.role==='bridge'&&fleet(entry.fleetId));
 const wifi=[...lamps.filter(entry=>entry.address).map(entry=>({entry,kind:'wifi'})),
  ...accessories.map(entry=>({entry:{...entry,address:entry.address||'coollamp-bridge-'+entry.id.slice(8)+'.local'},kind:'wifi',accessory:true}))];
 const rank=candidate=>candidate.entry.id===bridgeId?0:wifiFresh(candidate.entry)?1:candidate.accessory?2:3;
 wifi.sort((a,b)=>rank(a)-rank(b));
 const seen=new Set(candidates.map(candidate=>candidate.id));
 for(const candidate of wifi)if(!seen.has(candidate.entry.id)){seen.add(candidate.entry.id);candidates.push(candidate);}
 // Keep Bluetooth as its own route even if that lamp also has a Wi-Fi hint.
 for(const entry of lamps)if(entry.deviceId&&(platform!=='ios'||entry.accessoryManaged))candidates.push({entry,kind:'bluetooth'});
 const at=typeof now==='function'?now():now,known=new Map();
 if(Number.isFinite(at))for(const observation of Array.isArray(observations)?observations:[]){
  if(observation?.targetId!==target||!canonical(observation.gatewayId)||observation.gatewayId===target||!fleet(observation.fleetId)||
   !Number.isInteger(observation.hops)||observation.hops<1||observation.hops>4||!Number.isFinite(observation.observedAt)||
   !Number.isFinite(observation.expiresAt)||observation.observedAt>at||observation.expiresAt<=at||observation.expiresAt<=observation.observedAt)continue;
  if(observation.gatewayEpoch!==undefined&&(!Number.isInteger(observation.gatewayEpoch)||observation.gatewayEpoch<0))continue;
  const previous=known.get(observation.gatewayId);
  if(!previous||observation.hops<previous.hops||observation.hops===previous.hops&&observation.observedAt>previous.observedAt)
   known.set(observation.gatewayId,{targetId:target,gatewayId:observation.gatewayId,fleetId:observation.fleetId,hops:observation.hops,
    observedAt:observation.observedAt,expiresAt:observation.expiresAt,
    ...(observation.gatewayEpoch!==undefined?{gatewayEpoch:observation.gatewayEpoch}:{}),
    ...(fleet(observation.gatewayBoot)?{gatewayBoot:observation.gatewayBoot}:{}),...(fleet(observation.targetBoot)?{targetBoot:observation.targetBoot}:{})});
 }
 for(const candidate of candidates){
  const id=candidate.id||candidate.entry.id,observation=known.get(id);
  if(observation&&(!candidate.transport||observation.gatewayEpoch===undefined||observation.gatewayEpoch===candidate.epoch)&&
   (!candidate.accessory||observation.fleetId===candidate.entry.fleetId))candidate.observation={...observation};
 }
 // Reachability never creates a gateway candidate or grants authorization.
 // Prefer a proved target route over unrelated hints while keeping a live
 // supported gateway first and preserving legacy order without observations.
 if(candidates.some(candidate=>candidate.observation)){
  const index=new Map(candidates.map((candidate,order)=>[candidate,order]));
  candidates.sort((a,b)=>Number(Boolean(b.transport))-Number(Boolean(a.transport))||
   Number(Boolean(b.observation))-Number(Boolean(a.observation))||
   (a.observation&&b.observation?Number((b.id||b.entry.id)===bridgeId)-Number((a.id||a.entry.id)===bridgeId)||a.observation.hops-b.observation.hops||b.observation.observedAt-a.observation.observedAt:0)||
   index.get(a)-index.get(b));
 }
 return candidates;
}
