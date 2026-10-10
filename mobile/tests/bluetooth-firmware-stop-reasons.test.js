import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer, bluetoothFirmwareFailureMessage, parsePhoneManifest, OTA_STATUS, OTA_WRITE} from '../src/bluetooth-firmware.js';

function packageValue() {
  const image = new Uint8Array(2048), header = new DataView(image.buffer);
  image[0] = 0xe9; header.setUint16(12, 5, true); header.setUint32(32, 0xabcd5432, true);
  image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.13.0\0'), 300);
  const sha = createHash('sha256').update(image).digest('hex');
  return {image, manifest: parsePhoneManifest(`COOLLAMP-OTA-1\n1.13.0\nesp32c3\ndual-ota-2031616\n2048\n${sha}\n`)};
}

class Receiver {
  constructor() {
    this.pkg = packageValue(); this.clock = 1000; this.current = true; this.mtu = 247;
    this.s = {phase: 0, error: 0, session: 0, size: 0, offset: 0, ack: 0};
    this.manifest = []; this.operations = []; this.dataOffsets = []; this.reads = 0;
  }
  async getMtu() { if (this.mtuUnavailable) throw Error('MTU lookup failed.'); return this.mtu; }
  async read(_id, _service, characteristic) {
    assert.equal(characteristic, OTA_STATUS); ++this.reads; this.clock += 3;
    if (this.onRead) await this.onRead();
    const value = new DataView(new ArrayBuffer(20));
    value.setUint8(0, 1); value.setUint8(1, this.s.phase); value.setUint8(2, this.s.error); value.setUint8(3, this.s.phase === 4 ? 1 : 0);
    for (const [at, key] of [[4, 'session'], [8, 'size'], [12, 'offset']]) value.setUint32(at, this.s[key], true);
    value.setUint16(16, this.s.ack, true); value.setUint16(18, 232, true); return value;
  }
  async write(_id, _service, characteristic, value) {
    assert.equal(characteristic, OTA_WRITE); this.clock += 7;
    const op = value.getUint8(1); this.operations.push(op); this.s.session = value.getUint32(2, true);
    if (op === 1) {
      assert.equal(value.getUint16(8, true), this.manifest.length);
      this.manifest.push(...new Uint8Array(value.buffer, value.byteOffset + 10, value.byteLength - 10));
    } else if (op === 2) {
      assert.equal(new TextDecoder().decode(new Uint8Array(this.manifest)), this.pkg.manifest.text);
      this.s.phase = 2; this.s.size = this.pkg.image.length;
    } else if (op === 3) {
      if (this.s.phase !== 5) {
        assert.equal(value.getUint32(8, true), this.s.offset);
        this.dataOffsets.push(this.s.offset); this.s.offset += value.byteLength - 12;
      }
    } else if (op === 4) {
      assert.equal(this.s.offset, this.pkg.image.length); this.s.phase = 4;
    } else if (op === 5) {
      this.s.phase = 5; this.s.error = 8;
    } else assert.fail('Unknown operation');
    if (!(op === 3 && this.loseDataAck)) this.s.ack = value.getUint16(6, true);
    if (op === 3 && this.onData) await this.onData();
  }
  transfer() { return new BluetoothFirmwareTransfer({ble: this, deviceId: 'lamp', isCurrent: () => this.current, now: () => this.clock, delay: async milliseconds => { this.clock += milliseconds; }}); }
}
async function failedTransfer(receiver, transfer) {
  let failure;
  try { await transfer.send(receiver.pkg); } catch (error) { failure = error; }
  assert(failure instanceof Error); return failure;
}

for (const [reason, message] of [['user', /you cancelled/], ['app-hidden', /app moved to the background/], ['transport-disconnect', /connection was closed/], ['target-changed', /selected lamp changed/]]) {
  test(`${reason} retains its first cause and acknowledged bytes through cleanup`, async () => {
    const receiver = new Receiver(), transfer = receiver.transfer();
    receiver.onData = async () => { if (receiver.dataOffsets.length === 5) await transfer.cancel(reason); };
    const failure = await failedTransfer(receiver, transfer);
    assert.equal(failure.stopReason, reason); assert.equal(failure.updateDiagnostic.stopReason, reason);
    assert.equal(failure.updateDiagnostic.acknowledgedBytes, 1160); assert.equal(failure.updateDiagnostic.progress, 56);
    assert.equal(failure.updateDiagnostic.cancelRequested, true); assert.equal(failure.updateDiagnostic.connectionCurrent, true);
    assert.equal(failure.updateDiagnostic.mtu, 247); assert.equal(failure.updateDiagnostic.chunkSize, 232);
    assert.equal(failure.updateDiagnostic.dataFrames, 5); assert.equal(failure.updateDiagnostic.dataBytesAttempted, 1160);
    assert.equal(receiver.operations.filter(op => op === 5).length, 1); assert(!receiver.operations.includes(4));
    assert.equal(new Set(receiver.dataOffsets).size, receiver.dataOffsets.length);
    assert.match(bluetoothFirmwareFailureMessage(failure), message);
    const first = failure.updateDiagnostic.stopElapsedMs;
    assert(first <= failure.updateDiagnostic.elapsedMs);
    transfer.recordStop('connection-changed'); await transfer.cancel('cancelled');
    assert.equal(transfer.diagnostic().stopReason, reason); assert.equal(transfer.diagnostic().stopElapsedMs, first);
  });
}

for (const reason of ['native-disconnect', 'connection-changed']) test(`${reason} fences the link without a diagnostic read or abort on its replacement`, async () => {
  const receiver = new Receiver(), transfer = receiver.transfer(); let readsAtStop;
  receiver.onData = () => {
    if (receiver.dataOffsets.length === 5) {
      if (reason === 'native-disconnect') transfer.recordStop(reason);
      receiver.current = false; readsAtStop = receiver.reads;
    }
  };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, reason); assert.equal(failure.updateDiagnostic.stopReason, reason);
  assert.equal(failure.updateDiagnostic.acknowledgedBytes, 928);
  assert.equal(failure.updateDiagnostic.connectionCurrent, false); assert.equal(failure.updateDiagnostic.cancelRequested, false);
  assert.equal(receiver.reads, readsAtStop); assert(!receiver.operations.some(op => op === 4 || op === 5));
  assert.match(failure.message, reason === 'native-disconnect' ? /connection ended/ : /identity changed/);
});

test('receiver rejection keeps its original code and message rather than cleanup cancellation', async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  receiver.onData = () => { if (receiver.dataOffsets.length === 2) { receiver.s.phase = 5; receiver.s.error = 7; } };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, 'receiver-rejected'); assert.equal(failure.updateDiagnostic.error, 7);
  assert.equal(failure.updateDiagnostic.phase, 5); assert.equal(failure.updateDiagnostic.acknowledgedBytes, 464);
  assert.equal(failure.message, 'Lamp rejected Bluetooth update (code 7). Installed firmware remains selected.');
  assert.equal(receiver.s.error, 8); assert.equal(transfer.diagnostic().stopReason, 'receiver-rejected');
});

for (const operation of ['write', 'read']) test(`native ${operation} failure is classified without replacing its error or replaying data`, async () => {
  const receiver = new Receiver(), transfer = receiver.transfer(); let readFailed = false;
  if (operation === 'write') receiver.onData = () => { if (receiver.dataOffsets.length === 5) throw Error('Native write failed.'); };
  else receiver.onRead = () => { if (!readFailed && receiver.s.offset === 928) { readFailed = true; throw Error('Native read failed.'); } };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, `native-${operation}-failure`); assert.equal(failure.message, `Native ${operation} failed.`);
  assert.equal(failure.updateDiagnostic.acknowledgedBytes, operation === 'write' ? 1160 : 928);
  assert.equal(failure.updateDiagnostic.cancelRequested, false);
  assert.equal(receiver.operations.filter(op => op === 5).length, 1); assert(!receiver.operations.includes(4));
  assert.equal(new Set(receiver.dataOffsets).size, receiver.dataOffsets.length);
});

test('a callback-recorded native disconnection wins over the subsequent native write error', async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  receiver.onData = () => { if (receiver.dataOffsets.length === 5) { transfer.recordStop('native-disconnect'); receiver.current = false; throw Error('Native write failed.'); } };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, 'native-disconnect'); assert.equal(failure.updateDiagnostic.stopReason, 'native-disconnect');
  assert.equal(failure.message, 'Native write failed.'); assert(!receiver.operations.includes(5));
  assert.match(bluetoothFirmwareFailureMessage(failure), /Native write failed.*connection ended/);
});

test('ACK timeout is retained through abort with no data retry', async () => {
  const receiver = new Receiver(), transfer = receiver.transfer(); receiver.loseDataAck = true;
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, 'ack-timeout'); assert.match(failure.message, /No data was replayed/);
  assert(failure.updateDiagnostic.stopElapsedMs >= 15_000);
  assert.equal(receiver.dataOffsets.length, 4); assert.equal(receiver.operations.filter(op => op === 5).length, 1);
});

for (const fallback of ['unavailable', 'invalid']) test(`MTU ${fallback} records the safe small-packet fallback and bounded timing totals`, async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  if (fallback === 'unavailable') receiver.mtuUnavailable = true;
  else receiver.mtu = null;
  const result = await transfer.send(receiver.pkg), diagnostic = transfer.diagnostic();
  assert.equal(result.committed, true); assert.equal(diagnostic.mtuFallback, fallback);
  assert.equal(diagnostic.mtu, 23); assert.equal(diagnostic.chunkSize, 8);
  assert.equal(diagnostic.dataFrames, receiver.pkg.image.length / 8); assert.equal(diagnostic.dataBytesAttempted, receiver.pkg.image.length);
  assert.equal(diagnostic.writeCalls, receiver.operations.length); assert.equal(diagnostic.writeTimeMs, receiver.operations.length * 7); assert.equal(diagnostic.maxWriteMs, 7);
  assert.equal(diagnostic.statusReads, receiver.reads); assert.equal(diagnostic.statusTimeMs, receiver.reads * 3); assert.equal(diagnostic.maxStatusMs, 3);
  assert.equal(diagnostic.elapsedMs, diagnostic.writeTimeMs + diagnostic.statusTimeMs); assert.equal(diagnostic.stopReason, null);
  assert.equal(diagnostic.stopElapsedMs, null); assert(Object.isFrozen(diagnostic));
  for (const key of ['session', 'deviceId', 'identity', 'image', 'manifest', 'nativeError', 'credentials']) assert(!(key in diagnostic));
});

test('arbitrary cancellation payloads cannot enter the safe diagnostic or user message', async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  receiver.onData = async () => { if (receiver.dataOffsets.length === 1) await transfer.cancel({secret: 'not-for-diagnostics'}); };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, 'cancelled'); assert(!JSON.stringify(failure.updateDiagnostic).includes('not-for-diagnostics'));
  assert(!bluetoothFirmwareFailureMessage(failure).includes('not-for-diagnostics'));
});

for (const reason of ['user', 'app-hidden', 'native-disconnect', 'connection-changed']) test(`initial status ${reason} preserves its cause instead of a bootstrap hint`, async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  receiver.onRead = async () => {
    if (reason === 'user' || reason === 'app-hidden') await transfer.cancel(reason);
    else {
      if (reason === 'native-disconnect') transfer.recordStop(reason);
      receiver.current = false;
    }
  };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.stopReason, reason); assert.equal(failure.updateDiagnostic.stopReason, reason);
  assert.equal(failure.updateDiagnostic.total, receiver.pkg.image.length);
  assert(!failure.message.includes('needs firmware 1.11.0')); assert.equal(receiver.reads, 1);
  assert.equal(receiver.operations.length, 0); assert.equal(failure.updateDiagnostic.dataBytesAttempted, 0);
});

test('initial native read timeout retains its error without claiming missing receiver support', async () => {
  const receiver = new Receiver(), transfer = receiver.transfer();
  receiver.onRead = () => { throw Error('Bluetooth read timed out.'); };
  const failure = await failedTransfer(receiver, transfer);
  assert.equal(failure.message, 'Bluetooth read timed out.'); assert.equal(failure.stopReason, 'native-read-failure');
  assert.equal(receiver.operations.length, 0); assert.equal(receiver.reads, 1);
});
