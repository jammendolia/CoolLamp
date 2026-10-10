import {availableGroupScenes} from './group-scenes.js';

// Session-only telemetry. Discovery, a saved address and an unanswered request
// do not prove AP association. No credentials or raw snapshots are retained.
export const validWifiRssi = value => Number.isInteger(value) && value >= -127 && value < 0 ? value : null;
export function wifiSignalArcs(rssi) {
  const value=validWifiRssi(rssi);
  return value===null?0:value>=-55?3:value>=-67?2:value>=-80?1:0;
}
export function wifiObservation(raw) {
  const wifi=raw?.wifi;
  if(typeof wifi?.connected==='boolean')return {connected:wifi.connected,rssi:wifi.connected?validWifiRssi(wifi.rssi):null};
  if(typeof raw?.connected==='boolean')return {connected:raw.connected};
  if(typeof raw?.firmware?.wifi==='boolean')return {connected:raw.firmware.wifi};
  return null;
}
export function groupObservation(raw) {
  const group=raw?.sync,id=raw?.deviceId,canonical=/^[0-9a-f]{12}$/;
  if(![1,2,3].includes(group?.version)||![0,1,2].includes(group.role))return null;
  if(group.version===3&&(!Number.isInteger(group.maxMembers)||group.maxMembers<1||group.maxMembers>32))return null;
  if(group.role===0)return {role:0,leader:null};
  if(!canonical.test(id)||!canonical.test(group.leader)||group.role===1&&group.leader!==id||group.role===2&&group.leader===id)return null;
  const value={role:group.role,leader:group.leader};
  for(const key of ['active','paused'])if(typeof group[key]==='boolean')value[key]=group[key];
  if(['udp','esp-now','hybrid','none'].includes(group.transport))value.transport=group.transport;
  return value;
}
// Inactive firmware can report available interfaces instead of an accepted path.
// Membership and a leader's discovery hints do not prove an active follower link.
export function groupCardPresentation(group){
  const state=group?.fresh===true&&['leader','follower','independent'].includes(group.state)?group.state:'unknown';
  const active=state==='follower'&&group.active===true&&group.paused===false;
  const transport=active&&['udp','esp-now'].includes(group.transport)?group.transport:'unknown';
  const detail=state==='follower'?group.paused===true?'Group sync paused':group.active===false?'Waiting for coordinator':transport==='esp-now'?'Following via ESP-NOW':transport==='udp'?'Following via Wi-Fi UDP':'Coordination path unknown':state==='leader'&&group.transport==='hybrid'?'Coordinator supports Wi-Fi UDP and ESP-NOW':null;
  return {state,transport,detail,badge:transport==='esp-now'?'NOW':null};
}
const effectName=value=>typeof value==='string'&&value.trim()&&!/[\x00-\x1f\x7f]/.test(value)&&new TextEncoder().encode(value).length<=96?value.trim():null;
export function lightingObservation(raw,catalog=null) {
  const render=raw?.render??raw,mode=render?.mode,power=render?.power;
  if(!Number.isInteger(mode)||mode<1||mode>255||typeof power!=='boolean')return null;
  const group=groupObservation(raw),sync=raw?.sync;
  if(sync&&!group)return null;
  const runningGroup=group?.role===1&&sync.paused!==true||group?.role===2&&sync.active===true&&sync.paused!==true;
  const entry=Array.isArray(catalog)?catalog.find(entry=>entry.id===mode):null;
  const inline=Array.isArray(raw?.effects)&&raw.effects.length<=255?raw.effects[mode-1]:null;
  const name=effectName(render?.effectName??entry?.name??inline);
  const scene=Number.isInteger(sync?.scene)?sync.scene:sync?.version===1?0:null;
  if(runningGroup&&scene===0)return {kind:'group',name,mode,power,scene:0};
  if(runningGroup&&scene>0){
    const declared=Number.isInteger(sync.sceneCount)?sync.sceneCount:8;
    const name=scene<=declared?availableGroupScenes(sync).find(entry=>entry.id===scene)?.name:null;
    return {kind:'group',name:effectName(name),mode,power,scene};
  }
  return {kind:'effect',name,mode,power,scene:null};
}
function cleanLighting(value){
  if(!value||!['effect','group'].includes(value.kind)||typeof value.power!=='boolean'||!Number.isInteger(value.mode)||value.mode<1||value.mode>255)return null;
  if(value.kind==='group'&&(!Number.isInteger(value.scene)||value.scene<0||value.scene>255))return null;
  return {kind:value.kind,power:value.power,mode:value.mode,scene:value.kind==='group'?value.scene:null,name:effectName(value.name)};
}
const unknownLighting=()=>({state:'unknown',fresh:false,name:null,checkedAt:null,label:'Effect unavailable'});
const locator = entry => JSON.stringify([entry?.address ?? null,entry?.deviceId ?? null]);
const unknown = () => ({wifi:{state:'unknown',rssi:null,arcs:0,strengthKnown:false,checkedAt:null,fresh:false,label:'Wi-Fi status unknown'}});

export class LampConnectivity {
  constructor({getLamps=()=>[],onStatus,now=Date.now,ttl=30000}={}) {
    Object.assign(this,{getLamps,onStatus,now});
    this.ttl=Math.max(1,ttl);this.samples=new Map();this.groups=new Map();this.lighting=new Map();
  }
  entry(id){return this.getLamps().find(entry=>entry?.id===id);}
  emit(id){const value=this.get(id);this.onStatus?.(id,value);return value;}
  observe(id,{deviceId,wifi,checkedAt=this.now(),source}={}) {
    const entry=this.entry(id),now=this.now();
    if(!entry||deviceId!==id||typeof wifi?.connected!=='boolean'||!Number.isFinite(checkedAt)||checkedAt<0||checkedAt>now+1000)return false;
    const previous=this.samples.get(id),location=locator(entry);
    if(previous?.location===location&&checkedAt<previous.checkedAt)return false;
    const same=previous?.location===location&&previous.connected&&wifi.connected;
    const supplied=Object.prototype.hasOwnProperty.call(wifi,'rssi');
    const rssi=wifi.connected?(supplied?validWifiRssi(wifi.rssi):same?previous.rssi:null):null;
    const rssiAt=rssi===null?null:supplied?checkedAt:same?previous.rssiAt:null;
    this.samples.set(id,{connected:wifi.connected,rssi,rssiAt,checkedAt,location,source:['diagnostics','firmware','ble-wifi','state'].includes(source)?source:null});
    this.emit(id);return true;
  }
  invalidate(id,{attemptedAt=this.now()}={}) {
    const previous=this.samples.get(id);
    // A slow, failed HTTP read cannot erase a newer protected BLE observation.
    if(previous&&previous.checkedAt>attemptedAt)return false;
    this.samples.delete(id);this.emit(id);return true;
  }
  observeGroup(id,{deviceId,group,checkedAt=this.now()}={}) {
    const entry=this.entry(id),now=this.now();
    if(!entry||deviceId!==id||!Number.isFinite(checkedAt)||checkedAt<0||checkedAt>now+1000)return false;
    const value=groupObservation({deviceId:id,sync:{...group,version:group?.version??2}});
    if(!value)return false;
    const previous=this.groups.get(id),location=locator(entry);
    if(previous?.location===location&&checkedAt<previous.checkedAt)return false;
    this.groups.set(id,{...value,checkedAt,location});this.emit(id);return true;
  }
  invalidateGroup(id,{attemptedAt=this.now()}={}) {
    if(this.groups.get(id)?.checkedAt>attemptedAt)return false;
    this.groups.delete(id);this.emit(id);return true;
  }
  groupValue(id) {
    const entry=this.entry(id),sample=this.groups.get(id),now=this.now();
    if(!entry||!sample||sample.location!==locator(entry)||now<sample.checkedAt||now-sample.checkedAt>this.ttl)
      return {state:'unknown',leader:null,checkedAt:null,fresh:false};
    const {location,...value}=sample;
    return {...value,state:sample.role===1?'leader':sample.role===2?'follower':'independent',leader:sample.leader,checkedAt:sample.checkedAt,fresh:true};
  }
  observeLighting(id,{deviceId,lighting,checkedAt=this.now()}={}){
    const entry=this.entry(id),value=cleanLighting(lighting),now=this.now();
    if(!entry||deviceId!==id||!value||!Number.isFinite(checkedAt)||checkedAt<0||checkedAt>now+1000)return false;
    const previous=this.lighting.get(id),location=locator(entry);
    if(previous?.location===location&&checkedAt<previous.checkedAt)return false;
    this.lighting.set(id,{...value,checkedAt,location});this.emit(id);return true;
  }
  invalidateLighting(id,{attemptedAt=this.now()}={}){
    if(this.lighting.get(id)?.checkedAt>attemptedAt)return false;
    this.lighting.delete(id);this.emit(id);return true;
  }
  lightingValue(id){
    const entry=this.entry(id),sample=this.lighting.get(id),now=this.now();
    if(!entry||!sample||sample.location!==locator(entry)||now<sample.checkedAt)return unknownLighting();
    const fresh=now-sample.checkedAt<=this.ttl;
    const label=(sample.power?'':'Off · ')+(sample.name?(sample.kind==='group'?(sample.scene===0?'Group mirror · ':'Group · '):'')+sample.name:sample.kind==='group'?(sample.scene===0?'Group · Mirror effects':'Group effect unavailable'):'Effect unavailable');
    return {...sample,location:undefined,state:fresh?'live':'stale',fresh,label:fresh?label:'Last seen: '+label};
  }
  forget(id){this.samples.delete(id);this.groups.delete(id);this.lighting.delete(id);}
  get(id) {
    const entry=this.entry(id),sample=this.samples.get(id),now=this.now();
    if(!entry||!sample||sample.location!==locator(entry)||now<sample.checkedAt||now-sample.checkedAt>this.ttl)return {...unknown(),group:this.groupValue(id),lighting:this.lightingValue(id)};
    const state=sample.connected?'connected':'disconnected';
    const strengthKnown=sample.connected&&sample.rssi!==null&&sample.rssiAt!==null&&now>=sample.rssiAt&&now-sample.rssiAt<=this.ttl;
    const rssi=strengthKnown?sample.rssi:null;
    return {wifi:{state,rssi,arcs:wifiSignalArcs(rssi),strengthKnown,checkedAt:sample.checkedAt,fresh:true,
      label:!sample.connected?'Wi-Fi disconnected':strengthKnown?'Wi-Fi signal '+rssi+' dBm':'Wi-Fi connected; signal strength unknown'},group:this.groupValue(id),lighting:this.lightingValue(id)};
  }
}
