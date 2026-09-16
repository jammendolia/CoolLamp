import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LampTransport } from '../src/transport.js';
import { decodeState, encodeCommand, STATE, effects } from '../src/protocol.js';
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

test('wire frames preserve boundaries and reject invalid values', () => {
  assert.deepEqual([...new Uint8Array(encodeCommand(255, 'brightness', 255).buffer)], [1,255,2,255]);
  for (const args of [[0,'power',1], [1,'power',2], [1,'brightness',0], [1,'brightness',256], [1,'effect',29], [1,'effect',1.2], [1,'saveDefaults',1], [1,'unknown',0]]) assert.throws(() => encodeCommand(...args));
  const state = decodeState(packet(7)); assert.equal(state.id, 7); assert.equal(state.revision, 9);
  assert.throws(() => decodeState(new DataView(new ArrayBuffer(11))));
  const bad = packet(); bad.setUint8(0, 2); assert.throws(() => decodeState(bad), /version/);
});
test('effect names stay aligned with actual firmware', () => {
  const firmware = readFileSync(new URL('../../LampNetwork.ino', import.meta.url), 'utf8');
  const names = [...firmware.match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(effects, names);
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
