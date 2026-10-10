import {normalizeLampStyle} from './lamp-style.js';

// Only display metadata lives here. Passwords belong in the native credential vault.
// Discovery lasts for this app session only, including lamps not yet connected.
export class LampDiscoverySession {
  constructor() { this.lamps=new Map(); this.scanned=false; this.forgotten=new Set(); }
  get items() { return [...this.lamps.values()]; }
  beginRefresh() { this.forgotten.clear(); }
  forget(id) { this.lamps.delete(id);this.forgotten.add(id);return this.items; }
  remember(entries) {
    for(const entry of entries || []) {
      if(typeof entry?.id!=='string'||!entry.id||entry.id.length>128)continue;
      if(this.forgotten.has(entry.id))continue;
      try {
        const address=lampAddress(entry.address);
        this.lamps.set(entry.id,{id:entry.id,address,name:entry.name,hostname:entry.hostname});
      } catch { /* Ignore malformed discovery advertisements. */ }
    }
    this.scanned=true;
    return this.items;
  }
}

export class LampStore {
  constructor(storage) {
    this.storage = storage;
    try { this.items = JSON.parse(storage.getItem('coollamp-lamps') || '[]'); } catch { this.items = []; }
    if (!Array.isArray(this.items)) this.items = [];
    this.items = this.items.filter(x => x && typeof x.id === 'string');
    try {
      const old = JSON.parse(storage.getItem('coollamp-device'));
      if (old?.deviceId && !this.items.some(x => x.deviceId === old.deviceId)) this.upsert({id:'ble:'+old.deviceId,deviceId:old.deviceId,name:old.name || 'CoolLamp'});
      if (old) storage.removeItem('coollamp-device');
    } catch {}
  }
  upsert(value, previousId) {
    const matches = this.items.filter(x => x.id === value.id || x.id === previousId || (value.deviceId && x.deviceId === value.deviceId));
    const entry = Object.assign({}, ...matches, value);
    this.items = this.items.filter(x => !matches.includes(x));
    this.items.push(entry); this.save(); return entry;
  }
  upsertWifi(value, previousId) {
    // A new lamp reports its hardware name until named over Wi-Fi. Preserve
    // the phone/picker nickname during handoff; an explicit server name wins.
    const hardwareName = name => !name || /^CoolLamp(?:-[0-9a-f]{6})?$/i.test(name);
    if (hardwareName(value.name)) {
      const matches = this.items.filter(x => x.id === value.id || x.id === previousId || (value.deviceId && x.deviceId === value.deviceId));
      const nickname = [...matches].reverse().flatMap(x => [x.name, x.accessoryName]).find(name => !hardwareName(name));
      if (nickname) value = {...value, name:nickname};
    }
    return this.upsert(value, previousId);
  }
  rememberFirmware(id, status) {
    const entry = this.items.find(item => item.id === id);
    const version = validFirmwareVersion(status?.version);
    if (!entry || !version || entry.firmwareVersion === version) return entry;
    entry.firmwareVersion = version;
    entry.firmwareSeenAt = Number.isFinite(status?.checkedAt)&&status.checkedAt>0 ? status.checkedAt : Date.now();
    this.save();
    return entry;
  }
  setLampStyle(id, value, {source}={}) {
    if(typeof id!=='string'||!/^[0-9a-f]{12}$/.test(id))return false;
    const entry=this.items.find(item=>item.id===id),style=normalizeLampStyle(value);
    if(!entry||!style||!['phone','lamp'].includes(source))return false;
    if(source==='phone') {
      if(style.id==='unspecified') {
        if(!Object.hasOwn(entry,'phoneLampStyle'))return entry;
        delete entry.phoneLampStyle;
      } else {
        if(entry.phoneLampStyle===style.id)return entry;
        entry.phoneLampStyle=style.id;
      }
    } else {
      const prior=normalizeLampStyle(entry.lampStyle);
      if(prior?.id===style.id&&typeof entry.lampStyle==='object')return entry;
      entry.lampStyle=style;
      entry.styleSeenAt=Date.now();
    }
    this.save();return entry;
  }
  remove(id) { this.items = this.items.filter(x=>x.id!==id); this.save(); }
  // Only canonical IDs and removal intent live beside the saved lamp inventory.
  // Groups validates its bounded record; read/write errors must reach that model.
  loadGroupRemovalIntents() { const value=this.storage.getItem('coollamp-group-removals-v1');return value==null?null:JSON.parse(value); }
  saveGroupRemovalIntents(value) { this.storage.setItem('coollamp-group-removals-v1',JSON.stringify(value));return true; }
  save() { this.storage.setItem('coollamp-lamps', JSON.stringify(this.items)); }
}

export function validFirmwareVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(part => part <= 65535) && parts.some(Boolean) ? value : null;
}

export function lampFirmwareLabel(entry, {connected=false, firmware=null, firmwareReceivedAt=0, observation=null}={}) {
  const current=validFirmwareVersion(firmware?.version);
  const fresh=observation?.verified===true&&observation?.fresh===true?validFirmwareVersion(observation.installedVersion):null;
  if(connected){
    const newerPing=Number.isFinite(observation?.checkedAt)&&observation.checkedAt>firmwareReceivedAt;
    const version=fresh&&(!current||newerPing)?fresh:current;
    return version?'Firmware '+version:'Firmware unavailable';
  }
  if(fresh)return 'Firmware '+fresh;
  const version=validFirmwareVersion(entry?.firmwareVersion);
  return version ? 'Firmware ' + version + ' · Last seen' : 'Firmware · Connect to view';
}

export function lampAddress(value) {
  const url = new URL(value.includes('://') ? value : 'http://' + value);
  const h = url.hostname.toLowerCase();
  const parts = h.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
  const local = h.endsWith('.local') || (ipv4 && (parts[0] === 10 || (parts[0]===192&&parts[1]===168) || (parts[0]===172&&parts[1]>=16&&parts[1]<=31) || (parts[0]===169&&parts[1]===254)));
  if (url.protocol !== 'http:' || !local || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '80')) throw new Error('Enter the lamp’s .local name or local IPv4 address.');
  return url.origin;
}
