import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LampTransport } from '../src/transport.js';
import { decodeState, encodeCommand, decodeEffectOptions, decodeFirmware, firmwareMessage, FIRMWARE, EFFECT_OPTIONS, STATE, effects } from '../src/protocol.js';
import { readFileSync } from 'node:fs';

function packet(id = 0, result = 0, brightness = 100) {
  return new DataView(Uint8Array.of(1, id, result, 4, brightness, 1, 28, 1, 9, 0, 0, 0).buffer);
}
class Radio {
  writes = []; requests = 0; reply = true; result = 0; active = 0; maximumActive = 0;
  async initialize() {}
  async requestDevice() { this.requests++; return { deviceId: 'lamp-1', name: 'CoolLamp' }; }
  async connect(id, disconnected) { this.disconnected = disconnected; }
  async read(id, service, characteristic) { assert.equal(characteristic, STATE); return packet(); }
  async startNotifications(id, service, characteristic, listener) { this.listener = listener; }
  async disconnect() { this.disconnected?.(); }
  async write(id, service, characteristic, frame) {
    this.writes.push([...new Uint8Array(frame.buffer)]);
    this.maximumActive = Math.max(this.maximumActive, ++this.active);
    await new Promise(resolve => setTimeout(resolve, 1));
    if (this.reply) this.listener(packet(frame.getUint8(1), this.result, frame.getUint8(2) === 2 ? frame.getUint8(3) : 100));
    this.active--;
  }
}

function firmwarePacket() { return new DataView(Uint8Array.of(1,2,0,1,0,0,1,0,2,0,0,0,1,0,3,0,0,0,1,0).buffer); }
test('firmware status validates boundaries and reports availability, progress and offline state', () => {
  const p=firmwarePacket(), s=decodeFirmware(p);
  assert.equal(s.version,'1.2.0'); assert.equal(s.latest,'1.3.0'); assert.equal(s.available,true);
  assert.match(firmwareMessage(s),/1.3.0/);
  assert.match(firmwareMessage({...s,phase:3,progress:42}),/42%/);
  assert.match(firmwareMessage({...s,wifi:false}),/Wi-Fi/);
  for(const [offset,value] of [[0,2],[1,6],[2,2],[3,2],[4,101],[5,9],[18,2]]) { const bad=firmwarePacket();bad.setUint8(offset,value);assert.throws(()=>decodeFirmware(bad)); }
  assert.throws(()=>decodeFirmware(packet()));
  assert.deepEqual([...new Uint8Array(encodeCommand(1,'autoUpdate',1).buffer)],[1,1,10,1]);
  assert.throws(()=>encodeCommand(1,'autoUpdate',2));
});
test('firmware subscription is separate, stale notifications are ignored, and rejection keeps connection', async () => {
  class UpdateRadio extends Radio {
    async read(id,service,char) { if(char===FIRMWARE)return firmwarePacket();const p=packet();p.setUint8(7,5);return p; }
    async startNotifications(id,service,char,fn) { if(char===FIRMWARE)this.firmwareListener=fn;else this.listener=fn; }
    async write(id,service,char,frame) { this.writes.push([...new Uint8Array(frame.buffer)]);const p=packet(frame.getUint8(1),this.result);p.setUint8(7,5);this.listener(p); }
  }
  const radio=new UpdateRadio(), received=[],lamp=new LampTransport(radio,{onFirmware:s=>received.push(s)});
  await lamp.connect(); assert.equal(received.at(-1).latest,'1.3.0');
  await lamp.command('checkFirmware'); await lamp.command('installFirmware');
  radio.result=3;await assert.rejects(lamp.command('autoUpdate',1),/busy/);assert.equal(lamp.id,'lamp-1');
  const stale=radio.firmwareListener;await lamp.disconnect();const count=received.length;stale(firmwarePacket());assert.equal(received.length,count);
});

test('wire frames preserve boundaries and reject invalid values', () => {
  assert.deepEqual([...new Uint8Array(encodeCommand(255, 'brightness', 255).buffer)], [1,255,2,255]);
  for (const args of [[0,'power',1], [1,'power',2], [1,'brightness',0], [1,'brightness',256], [1,'effect',39], [1,'effect',1.2], [1,'saveDefaults',1], [1,'unknown',0]]) assert.throws(() => encodeCommand(...args));
  const state = decodeState(packet(7)); assert.equal(state.id, 7); assert.equal(state.revision, 9);
  assert.throws(() => decodeState(new DataView(new ArrayBuffer(11))));
  const bad = packet(); bad.setUint8(0, 2); assert.throws(() => decodeState(bad), /version/);
});
test('effect names stay aligned with actual firmware', () => {
  const firmware = readFileSync(new URL('../../LampNetwork.ino', import.meta.url), 'utf8');
  const names = [...firmware.match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  // The fallback list is intentionally the microphone-free legacy catalog.
  assert.deepEqual(effects, names.slice(0,38));
  assert.deepEqual(names.slice(38), ['Sound glow','Sound meter','Spectrum Rise','Bass Launch','Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter']);
});
test('discovery, encrypted read, notification and acknowledged commands', async () => {
  const radio = new Radio(); const received = [];
  const lamp = new LampTransport(radio, { onState: s => received.push(s) });
  await lamp.connect();
  const result = await lamp.command('brightness', 173);
  assert.equal(result.brightness, 173); assert.equal(received.at(-1).brightness, 173);
  radio.listener(packet(0, 0, 62)); assert.equal(received.at(-1).brightness, 62);
  await lamp.disconnect(); assert.equal(lamp.id, null);
});
test('saved phones reconnect without service discovery', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio);
  await lamp.connect({ deviceId: 'saved-lamp' });
  assert.equal(radio.requests, 0); assert.equal(lamp.id, 'saved-lamp');
  await lamp.disconnect();
});
test('commands are serialized and notifications can precede write completion', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio);
  await lamp.connect();
  await Promise.all([lamp.command('brightness', 1), lamp.command('brightness', 255), lamp.command('power', 0)]);
  assert.equal(radio.maximumActive, 1);
  assert.deepEqual(radio.writes.slice(1).map(frame => frame.slice(2)), [[2,1], [2,255], [1,0]]);
  await lamp.disconnect();
});
test('timeout disconnects and queued changes never replay', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio, { timeout: 25 });
  await lamp.connect(); radio.reply = false;
  const results = await Promise.allSettled([lamp.command('power', 0), lamp.command('effect', 2)]);
  assert(results.every(r => r.status === 'rejected'));
  assert.match(results[0].reason.message, /confirm/); assert.equal(lamp.id, null);
  assert.equal(radio.writes.length, 2);
});
test('disconnect rejects pending command and ignores an old connection callback', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio);
  await lamp.connect(); const staleCallback = radio.disconnected;
  radio.reply = false;
  const pending = lamp.command('power', 0);
  const rejected = assert.rejects(pending, /disconnected/);
  await new Promise(resolve => setTimeout(resolve, 5)); radio.disconnected(); await rejected;
  radio.reply = true; await lamp.connect(); staleCallback(); assert.equal(lamp.id, 'lamp-1');
  await lamp.disconnect();
});
test('lamp rejection is reported instead of claiming a saved setting', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio);
  await lamp.connect(); radio.result = 4;
  await assert.rejects(lamp.command('saveDefaults'), /could not save/);
});
test('protected Bluetooth identity matches network identity when supported', async () => {
  class IdentityRadio extends Radio {
    async read(id,service,char) {
      if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode('aabbccddeeff').buffer);
      return super.read(id,service,char);
    }
  }
  const lamp=new LampTransport(new IdentityRadio());const device=await lamp.connect();
  assert.equal(device.lampId,'aabbccddeeff');await lamp.disconnect();
});

test('RGB commands preserve black, primary colors, and effect-specific slots', () => {
  const bytes = value => [...new Uint8Array(encodeCommand(9, 'color', value).buffer)];
  assert.deepEqual(bytes({mode:3,r:255,g:0,b:0}), [1,9,6,3,255,0,0]);
  assert.deepEqual(bytes({mode:29,r:0,g:0,b:0}), [1,9,6,29,0,0,0]);
  for (const value of [null, {mode:0,r:1,g:2,b:3}, {mode:39,r:1,g:2,b:3},
    {mode:3,r:256,g:0,b:0}, {mode:3,r:0,g:-1,b:0}, {mode:3,r:0,g:0,b:1.5}]) {
    assert.throws(() => encodeCommand(1, 'color', value));
  }
  assert.deepEqual([...new Uint8Array(encodeCommand(10,'resetColor',3).buffer)], [1,10,7,3]);
});

test('color state extension is validated and old firmware remains readable', () => {
  assert.equal(decodeState(packet()).supportsColor, false);
  const data = new DataView(Uint8Array.of(1,5,0,29,100,1,29,3,10,0,0,0,1,255,35,85).buffer);
  assert.deepEqual(decodeState(data).color, {enabled:true,r:255,g:35,b:85});
  data.setUint8(12,2); assert.throws(() => decodeState(data), /color/);
  const truncated = packet(); truncated.setUint8(7,3);
  assert.throws(() => decodeState(truncated), /color/);
});

test('old firmware rejects new controls locally without losing its connection', async () => {
  const radio = new Radio(); const lamp = new LampTransport(radio);
  await lamp.connect(); const count = radio.writes.length;
  await assert.rejects(lamp.command('color',{mode:3,r:255,g:0,b:0}), /firmware/);
  await assert.rejects(lamp.command('effect',29), /firmware/);
  await assert.rejects(lamp.command('enableEffects',1), /firmware/);
  await assert.rejects(lamp.command('effectOptions',{}), /firmware/);
  assert.equal(radio.writes.length,count); assert.equal(lamp.id,'lamp-1');
  await lamp.command('power',1);
  await lamp.disconnect();
});

test('advanced effects negotiate full catalog and receive independent option notifications', async () => {
  const options = new DataView(Uint8Array.of(1,37,1,0,1,0,255,127).buffer);
  const value = {mode:37,speed:1,intensity:0,dual:1,r:0,g:255,b:127};
  assert.deepEqual(decodeEffectOptions(options),value);
  assert.deepEqual([...new Uint8Array(encodeCommand(2,'effectOptions',value).buffer)],[1,2,11,37,1,0,1,0,255,127]);
  for(const [field,n] of [['mode',39],['speed',0],['speed',101],['intensity',101],['dual',2],['r',-1],['b',256]])
    assert.throws(()=>encodeCommand(1,'effectOptions',{...value,[field]:n}));
  for(const [offset,n] of [[0,2],[1,0],[1,39],[2,0],[2,101],[3,101],[4,2]]) {
    const bad=new DataView(options.buffer.slice(0));bad.setUint8(offset,n);assert.throws(()=>decodeEffectOptions(bad));
  }
  class EffectsRadio extends Radio {
    extended=false;
    state(id=0) {return new DataView(Uint8Array.of(1,id,0,this.extended?37:29,100,1,this.extended?37:29,11,1,0,0,0,1,255,60,110).buffer);}
    async read(id,service,char) {return char===EFFECT_OPTIONS?options:this.state();}
    async startNotifications(id,service,char,fn) {if(char===EFFECT_OPTIONS)this.optionsListener=fn;else this.listener=fn;}
    async write(id,service,char,frame) {this.writes.push([...new Uint8Array(frame.buffer)]);if(frame.getUint8(2)===12)this.extended=true;this.listener(this.state(frame.getUint8(1)));}
  }
  const radio=new EffectsRadio(), received=[],lamp=new LampTransport(radio,{onOptions:o=>received.push(o)});
  await lamp.connect();assert.equal(lamp.state.effectCount,37);assert.equal(radio.writes[0][2],12);assert.deepEqual(received.at(-1),value);
  await lamp.command('effect',37);await lamp.command('effectOptions',value);
  const stale=radio.optionsListener;await lamp.disconnect();const count=received.length;stale(options);assert.equal(received.length,count);
});

test('outward droplets negotiate the new catalog while old firmware retains its catalog', async () => {
  assert.equal(effects[29], 'Bouncing droplets - rising');
  assert.equal(effects[37], 'Bouncing droplets - falling');
  class OutwardRadio extends Radio {
    extended=false;
    state(id=0) {return new DataView(Uint8Array.of(1,id,0,this.extended?38:29,100,1,this.extended?38:29,27,1,0,0,0,1,255,60,110).buffer);}
    async read(id,service,char) {return char===EFFECT_OPTIONS?new DataView(Uint8Array.of(1,38,50,100,1,35,160,255).buffer):this.state();}
    async startNotifications(id,service,char,fn) {if(char!==EFFECT_OPTIONS)this.listener=fn;}
    async write(id,service,char,frame) {this.writes.push([...new Uint8Array(frame.buffer)]);if(frame.getUint8(2)===12){assert.equal(frame.getUint8(3),2);this.extended=true;}this.listener(this.state(frame.getUint8(1)));}
  }
  const radio=new OutwardRadio(),lamp=new LampTransport(radio);
  await lamp.connect();assert.equal(lamp.state.effectCount,38);assert.equal(lamp.state.mode,38);
  await lamp.command('effect',38);
  await lamp.command('effectOptions',{mode:38,speed:60,intensity:75,dual:1,r:12,g:34,b:56});
  await lamp.disconnect();
});

test('Bluetooth enumerates each lamp catalog, including effects unknown to this app', async () => {
  const { CATALOG } = await import('../src/catalog.js');
  class CatalogRadio extends Radio {
    count=41; extended=false; requested=1;
    state(id=0) {return new DataView(Uint8Array.of(1,id,0,this.extended?this.count:1,100,1,this.extended?this.count:29,43,1,0,0,0,1,255,60,110).buffer);}
    async read(id,service,char) {
      if(char===CATALOG){const bytes=new TextEncoder().encode(JSON.stringify({id:this.requested,name:`Style ${this.count} effect ${this.requested}`,category:'calm',speed:this.requested!==1}));return new DataView(bytes.buffer);}
      if(char===EFFECT_OPTIONS)return new DataView(Uint8Array.of(1,this.count,50,100,1,35,160,255).buffer);
      return this.state();
    }
    async startNotifications(id,service,char,fn){if(char===STATE)this.listener=fn;}
    async write(id,service,char,frame){this.writes.push([...new Uint8Array(frame.buffer)]);const op=frame.getUint8(2);if(op===12){assert.equal(frame.getUint8(3),3);this.extended=true;}if(op===13)this.requested=frame.getUint8(3);this.listener(this.state(frame.getUint8(1)));}
  }
  const radio=new CatalogRadio(),lamp=new LampTransport(radio);
  await lamp.connect();assert.equal(lamp.catalog.length,41);assert.equal(lamp.catalog[40].name,'Style 41 effect 41');
  await lamp.command('effect',41);await lamp.command('color',{mode:41,r:1,g:2,b:3});
  await lamp.command('effectOptions',{mode:41,speed:50,intensity:100,dual:0,r:1,g:2,b:3});
  await assert.rejects(lamp.command('effect',42));
  await lamp.disconnect();assert.equal(lamp.catalog,null);
  radio.count=2;radio.extended=false;
  await lamp.connect({deviceId:'second-lamp'});assert.equal(lamp.catalog.length,2);assert.equal(lamp.catalog[1].name,'Style 2 effect 2');
  assert.equal(lamp.catalog[0].speed,false);await lamp.disconnect();
});
