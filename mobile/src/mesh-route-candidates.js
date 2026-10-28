import {meshBridgeSupported} from './mesh.js';

const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const fleet=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);

// Saved bridge records are authenticated accessories, not lamps or group
// coordinators. Their address is a hint; BridgeWifiBroker verifies it again.
export function meshRouteCandidates({target,activeBridge,entries=[],bridges=[],bridgeId=null,platform,connectivity}={}){
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
 return candidates;
}
