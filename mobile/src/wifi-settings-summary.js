import {validWifiRssi,wifiSignalArcs} from './lamp-connectivity.js';

const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const networkName=value=>typeof value==='string'&&value.length>0&&!value.includes('\0')&&new TextEncoder().encode(value).length<=32?value:null;
function savedStatus(status,id){
 return status?.deviceId===id&&status.error===0&&status.connected===true&&[0,4].includes(status.phase)?networkName(status.ssid):null;
}

// Session-only presentation. A candidate join/scan and a remembered phone card
// never establish a saved network. No passwords or raw responses are retained.
export class WifiSettingsSummary {
 constructor(){this.context=null;this.editing=false;this.confirmedName=null;this.name=null;}
 matches({id,target,epoch}={}){return Boolean(this.context&&this.context.id===id&&this.context.target===target&&this.context.epoch===epoch);}
 scope(){return this.context?{...this.context}:null;}
 view({id,target,epoch,verified,rawSsid,status,wifi}={}){
  if(!verified||!canonical(id)){this.context=null;this.editing=false;this.confirmedName=this.name=null;return {name:null,editing:true,wifi:null};}
  if(!this.matches({id,target,epoch})){this.context={id,target,epoch};this.editing=false;this.confirmedName=null;}
  this.name=this.confirmedName??networkName(rawSsid)??savedStatus(status,id)??this.name;
  return {name:this.name,editing:this.editing||!this.name,wifi};
 }
 reconfigure(){if(!this.context||!this.name)return false;this.editing=true;return true;}
 cancel(){if(!this.context||!this.name)return null;this.editing=false;return this.name;}
 accept(scope,status){
  const name=status?.phase===4?savedStatus(status,scope?.id):null;
  if(!name||!this.matches(scope))return false;
  this.confirmedName=this.name=name;this.editing=false;return true;
 }
}

export function wifiSettingsSignal(wifi){
 const state=wifi?.fresh===true&&['connected','disconnected'].includes(wifi.state)?wifi.state:'unknown';
 const rssi=state==='connected'&&wifi.strengthKnown===true?validWifiRssi(wifi.rssi):null;
 const arcs=wifiSignalArcs(rssi),strength=rssi!==null;
 const description=state==='unknown'?'Connection status unknown':state==='disconnected'?'Not connected to Wi-Fi':
  strength?'Connected · '+['Very weak signal','Weak signal','Good signal','Strong signal'][arcs]:'Connected · signal strength unknown';
 const paths=['M2.5 8a16 16 0 0 1 19 0','M5.5 11.5a11 11 0 0 1 13 0','M8.5 15a6 6 0 0 1 7 0'];
 const svg='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths.map((path,index)=>'<path class="wifi-arc'+(strength&&arcs>=3-index?' active':'')+'" d="'+path+'"/>').join('')+
  '<circle class="wifi-dot'+(state==='connected'?' active':'')+'" cx="12" cy="18.5" r="1.25"/>'+
  (state==='disconnected'?'<g class="wifi-slash"><circle cx="12" cy="12" r="10"/><path d="m5 19 14-14"/></g>':!strength?'<g class="wifi-question"><circle cx="19" cy="18" r="5"/><text x="19" y="21.5" text-anchor="middle">?</text></g>':'')+'</svg>';
 return {state,arcs,description,svg};
}

export function renderSavedWifi(get,model){
 const signal=wifiSettingsSignal(model.wifi),icon=get('savedWifiSignal');
 get('savedWifiSummary').hidden=!model.name;
 get('savedWifiName').textContent=model.name??'';
 get('savedWifiConnection').textContent=signal.description;
 icon.dataset.state=signal.state;icon.dataset.arcs=String(signal.arcs);icon.setAttribute('aria-label',signal.description);
 // Only fixed icon paths/classes enter HTML. Network names use textContent.
 icon.innerHTML=signal.svg;
 get('wifiNetworkEditor').hidden=!model.editing;
 get('reconfigureWifi').hidden=model.editing;
 get('cancelWifiEdit').hidden=!model.name||!model.editing;
}
