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
  if(![1,2].includes(group?.version)||![0,1,2].includes(group.role))return null;
  if(group.role===0)return {role:0,leader:null};
  if(!canonical.test(id)||!canonical.test(group.leader)||group.role===1&&group.leader!==id||group.role===2&&group.leader===id)return null;
  return {role:group.role,leader:group.leader};
}
const locator = entry => JSON.stringify([entry?.address ?? null,entry?.deviceId ?? null]);
const unknown = () => ({wifi:{state:'unknown',rssi:null,arcs:0,strengthKnown:false,checkedAt:null,fresh:false,label:'Wi-Fi status unknown'}});

export class LampConnectivity {
  constructor({getLamps=()=>[],onStatus,now=Date.now,ttl=30000}={}) {
    Object.assign(this,{getLamps,onStatus,now});
    this.ttl=Math.max(1,ttl);this.samples=new Map();this.groups=new Map();
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
    const value=groupObservation({deviceId:id,sync:{...group,version:2}});
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
    return {state:sample.role===1?'leader':sample.role===2?'follower':'independent',leader:sample.leader,checkedAt:sample.checkedAt,fresh:true};
  }
  forget(id){this.samples.delete(id);this.groups.delete(id);}
  get(id) {
    const entry=this.entry(id),sample=this.samples.get(id),now=this.now();
    if(!entry||!sample||sample.location!==locator(entry)||now<sample.checkedAt||now-sample.checkedAt>this.ttl)return {...unknown(),group:this.groupValue(id)};
    const state=sample.connected?'connected':'disconnected';
    const strengthKnown=sample.connected&&sample.rssi!==null&&sample.rssiAt!==null&&now>=sample.rssiAt&&now-sample.rssiAt<=this.ttl;
    const rssi=strengthKnown?sample.rssi:null;
    return {wifi:{state,rssi,arcs:wifiSignalArcs(rssi),strengthKnown,checkedAt:sample.checkedAt,fresh:true,
      label:!sample.connected?'Wi-Fi disconnected':strengthKnown?'Wi-Fi signal '+rssi+' dBm':'Wi-Fi connected; signal strength unknown'},group:this.groupValue(id)};
  }
}
