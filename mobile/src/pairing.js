// AccessorySetupKit owns authorization; the existing BLE transport owns GATT.
// Migrate all saved iPhone peripherals before initializing CBCentralManager.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function rememberAccessories(store,devices,removed=new Set()) {
  for(const device of devices||[]) {
    if(!uuid.test(device?.deviceId||'')||removed.has(device.deviceId.toLowerCase()))continue;
    const prior=store.items.find(d=>d.deviceId?.toLowerCase()===device.deviceId.toLowerCase());
    store.upsert({...prior,id:prior?.id||'ble:'+device.deviceId,deviceId:device.deviceId,
      name:prior?.name||device.name||'CoolLamp',accessoryName:device.name||'CoolLamp',accessoryManaged:true});
  }
}
export function pairingLabel(device={}) {
  return device.accessoryName||device.bluetoothName||(device.id?'CoolLamp':device.name)||'CoolLamp';
}
export function pairingInstructions(platform,device={}) {
  const label=pairingLabel(device);
  const where=platform==='android'?'Settings → Connected devices / Bluetooth':'Settings → Bluetooth';
  return `Open ${where}, find “${label}”, and choose ${platform==='android'?'Forget / Unpair':'ⓘ → Forget This Device'}. Then return here, hold the lamp knob for six seconds until blue, release, and find it again.`+
    (label==='CoolLamp'?' Older firmware can give several lamps this same name. If they are indistinguishable, forgetting those CoolLamp entries means you will need to pair the other lamps again too.':'');
}
export function pairingError(error,device) {
  const message=error?.message||'Could not connect over Bluetooth.';
  const target=error?.device||error?.data?.device||device;
  const stale=error?.code==='PAIRING_KEYS_CHANGED'||/peer removed pairing information/i.test(message);
  return {message:stale?'This lamp has forgotten its old Bluetooth pairing. Clear the phone’s old pairing, then pair again.':message,
    recovery:stale,device:target};
}
export class LampPairing {
  constructor({platform='web',native,knownDevices=()=>[]}) {
    this.platform=platform;this.native=native;this.knownDevices=knownDevices;
    this.radioStarted=false;this.preparing=null;
  }
  async prepare(extra) {
    if(this.platform!=='ios')return {supported:false,devices:[]};
    if(this.preparing)return this.preparing;
    this.preparing=(async()=>{
      const current=await this.native.list();
      if(!current.supported)return current;
      const enrolled=new Set(current.devices.map(d=>d.deviceId.toLowerCase()));
      const legacy=new Map();
      for(const d of [...this.knownDevices(),extra].filter(Boolean)) {
        if(uuid.test(d.deviceId||'')&&!enrolled.has(d.deviceId.toLowerCase())&&!d.accessoryManaged)
          legacy.set(d.deviceId.toLowerCase(),d);
      }
      if(legacy.size) {
        if(this.radioStarted)throw new Error('Close and reopen CoolLamp to authorize the old iPhone pairings before connecting.');
        await this.native.migrate({devices:[...legacy.values()].map(d=>({deviceId:d.deviceId,name:d.name||'CoolLamp'}))});
        const migrated=await this.native.list();
        const ids=new Set(migrated.devices.map(d=>d.deviceId.toLowerCase()));
        if([...legacy.keys()].some(id=>!ids.has(id)))throw new Error('Authorize all saved lamps in Apple’s setup prompt before connecting. Your saved lamps have not been removed.');
        return migrated;
      }
      return current;
    })();
    try{return await this.preparing;}finally{this.preparing=null;}
  }
  async select(saved) {
    const current=await this.prepare(saved);
    if(!current.supported)return saved;
    if(saved?.deviceId) {
      const enrolled=current.devices.find(d=>d.deviceId.toLowerCase()===saved.deviceId.toLowerCase());
      if(!enrolled)throw new Error('This lamp is no longer authorized on this iPhone. Remove its app card, then use Find a lamp flashing blue to set it up again.');
      return {...saved,...enrolled,accessoryManaged:true};
    }
    return {...await this.native.select(),accessoryManaged:true};
  }
  async remove(entry,{appOnly=false}={}) {
    if(!entry?.deviceId)return {removed:false,manual:false};
    if(appOnly)return {removed:false,manual:true};
    if(this.platform!=='ios')return {removed:false,manual:true};
    // Existing bonds may be migrated even while the lamp is offline/reset.
    // Never discard the app record if the system prompt is cancelled or fails.
    let current;
    try { current=await this.prepare(entry); }
    catch(error) {
      if(error.code!=='PAIRING_CANCELLED'&&!/cancel/i.test(error.message||''))error.manualPairingRemoval=true;
      throw error;
    }
    if(!current.supported)return {removed:false,manual:true};
    const result=await this.native.remove({deviceId:entry.deviceId});
    return {removed:result.removed===true,manual:result.removed!==true};
  }
}
