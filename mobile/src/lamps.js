// Only display metadata lives here. Passwords belong in the native credential vault.
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
  remove(id) { this.items = this.items.filter(x=>x.id!==id); this.save(); }
  save() { this.storage.setItem('coollamp-lamps', JSON.stringify(this.items)); }
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
