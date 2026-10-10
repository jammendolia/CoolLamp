import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BluetoothFirmwareTransfer, parsePhoneManifest, OTA_WRITE, OTA_STATUS} from '../src/bluetooth-firmware.js';
import {SERVICE} from '../src/protocol.js';

// Synthetic image at the published 1.13.0 image's size. This exercises the
// production phone sender and a bounded receiver model, not a physical radio.
const imageSize = 1_920_432;
function preparedImage() {
  const image = new Uint8Array(imageSize);
  for (let i = 0; i < image.length; ++i) image[i] = (i * 29 + (i >>> 8) * 7) & 255;
  const header = new DataView(image.buffer);
  image[0] = 0xe9;
  header.setUint16(12, 5, true);
  header.setUint32(32, 0xabcd5432, true);
  image.set(new TextEncoder().encode('COOLLAMP-PUBLIC-1.13.0\0'), 300);
  const sha256 = createHash('sha256').update(image).digest('hex');
  const text = `COOLLAMP-OTA-1\n1.13.0\nesp32c3\ndual-ota-2031616\n${image.length}\n${sha256}\n`;
  return {image, manifest: parsePhoneManifest(text)};
}

class BoundedReceiver {
  constructor(packageValue, mtu) {
    this.packageValue = packageValue;
    this.mtu = mtu;
    this.chunk = Math.min(232, Math.min(244, mtu - 3) - 12);
    this.clock = 0;
    this.state = {phase: 0, error: 0, session: 0, size: 0, offset: 0, ack: 0};
    this.manifest = [];
    this.pending = [];
    this.acceptedBytes = 0;
    this.dataFrames = 0;
    this.ackWindows = 0;
    this.sequence = 0;
    this.wraps = 0;
    this.commits = 0;
    this.starts = 0;
    this.cancels = 0;
    this.staleReads = 0;
    this.maxQueued = 0;
    this.returnsStale = true;
    this.hash = createHash('sha256');
    this.prefix = new Uint8Array(36);
    this.prefixUsed = 0;
    this.headerChecked = false;
  }
  async getMtu() { return this.mtu; }
  async write(device, service, characteristic, frame) {
    assert.equal(device, 'full-size-target');
    assert.equal(service, SERVICE);
    assert.equal(characteristic, OTA_WRITE);
    assert(frame.byteLength <= Math.min(244, this.mtu - 3));
    assert.equal(frame.getUint8(0), 1);
    const session = frame.getUint32(2, true);
    assert.notEqual(session, 0);
    if (this.state.session) assert.equal(session, this.state.session);
    else this.state.session = session;
    const sequence = frame.getUint16(6, true);
    const expected = this.sequence === 65535 ? 1 : this.sequence + 1;
    assert.equal(sequence, expected);
    assert.notEqual(sequence, 0, 'wire protocol rejects sequence zero');
    if (this.sequence === 65535) ++this.wraps;
    this.sequence = sequence;
    ++this.clock;
    const operation = frame.getUint8(1);
    if (operation === 1) {
      assert.equal(this.state.phase, 0);
      assert.equal(frame.getUint16(8, true), this.manifest.length);
      this.manifest.push(...new Uint8Array(frame.buffer, frame.byteOffset + 10, frame.byteLength - 10));
      assert(this.manifest.length < 192);
      this.state.ack = sequence;
    } else if (operation === 2) {
      assert.equal(frame.byteLength, 8);
      assert.equal(this.starts++, 0);
      assert.equal(new TextDecoder().decode(new Uint8Array(this.manifest)), this.packageValue.manifest.text);
      this.state.phase = 2;
      this.state.size = this.packageValue.image.length;
      this.state.ack = sequence;
    } else if (operation === 3) {
      assert.equal(this.state.phase, 2);
      assert.equal(frame.getUint32(8, true), this.acceptedBytes);
      const bytes = new Uint8Array(frame.buffer, frame.byteOffset + 12, frame.byteLength - 12);
      assert.equal(bytes.length, Math.min(this.chunk, this.state.size - this.acceptedBytes));
      for (let i = 0; i < bytes.length; ++i) assert.equal(bytes[i], this.packageValue.image[this.acceptedBytes + i]);
      this.pending.push({bytes: bytes.slice(), sequence, offset: this.acceptedBytes});
      this.acceptedBytes += bytes.length;
      ++this.dataFrames;
      this.maxQueued = Math.max(this.maxQueued, this.pending.length);
      assert(this.pending.length <= 4, 'sender must await written-byte ACK before sending another window');
    } else if (operation === 4) {
      assert.equal(frame.byteLength, 8);
      assert.equal(this.pending.length, 0);
      assert.equal(this.state.offset, this.state.size);
      assert(this.headerChecked);
      assert.equal(this.hash.digest('hex'), this.packageValue.manifest.sha256);
      assert.equal(this.commits++, 0, 'commit must be sent exactly once');
      this.state.phase = 4;
      this.state.ack = sequence;
    } else {
      if (operation === 5) ++this.cancels;
      assert.fail('unexpected operation ' + operation);
    }
  }
  async read(device, service, characteristic) {
    assert.equal(device, 'full-size-target');
    assert.equal(service, SERVICE);
    assert.equal(characteristic, OTA_STATUS);
    if (this.pending.length) {
      // ATT acceptance is not a flash ACK. Return one old snapshot for every
      // window, then consume only the bounded copied frames on the next read.
      if (this.returnsStale) {
        this.returnsStale = false;
        ++this.staleReads;
      } else {
        assert.equal(this.pending.length, Math.min(4, Math.ceil((this.state.size - this.state.offset) / this.chunk)));
        for (const frame of this.pending) {
          assert.equal(frame.offset, this.state.offset);
          this.hash.update(frame.bytes);
          const take = Math.min(frame.bytes.length, this.prefix.length - this.prefixUsed);
          if (take) {
            this.prefix.set(frame.bytes.subarray(0, take), this.prefixUsed);
            this.prefixUsed += take;
          }
          if (!this.headerChecked && this.prefixUsed === this.prefix.length) {
            const prefix = new DataView(this.prefix.buffer);
            assert.equal(prefix.getUint8(0), 0xe9);
            assert.equal(prefix.getUint16(12, true), 5);
            assert.equal(prefix.getUint32(32, true), 0xabcd5432);
            this.headerChecked = true;
          }
          this.state.offset += frame.bytes.length;
          this.state.ack = frame.sequence;
        }
        this.pending.length = 0;
        ++this.ackWindows;
        this.returnsStale = true;
      }
    }
    const status = new DataView(new ArrayBuffer(20));
    status.setUint8(0, 1);
    status.setUint8(1, this.state.phase);
    status.setUint8(2, this.state.error);
    status.setUint8(3, this.commits ? 1 : 0);
    status.setUint32(4, this.state.session, true);
    status.setUint32(8, this.state.size, true);
    status.setUint32(12, this.state.offset, true);
    status.setUint16(16, this.state.ack, true);
    status.setUint16(18, 232, true);
    return status;
  }
}

for (const mtu of [23, 185]) test(`full-size Bluetooth image with MTU ${mtu} confirms each window and sequence rollover`, {timeout: 30_000}, async () => {
  const packageValue = preparedImage(), receiver = new BoundedReceiver(packageValue, mtu);
  let progressCount = 0, previousProgress = -1, verifying = 0;
  const transfer = new BluetoothFirmwareTransfer({
    ble: receiver, deviceId: 'full-size-target', now: () => receiver.clock,
    delay: async milliseconds => { receiver.clock += milliseconds; },
    onProgress: value => {
      assert.equal(receiver.pending.length, 0, 'reported progress requires flash ACK, not accepted ATT writes');
      assert.equal(value.version, '1.13.0');
      assert.equal(value.progress, Math.floor(receiver.state.offset * 100 / imageSize));
      assert(value.progress >= previousProgress);
      previousProgress = value.progress;
      if (value.stage === 'transferring') {
        assert.equal(progressCount++, receiver.ackWindows);
      } else {
        assert.equal(value.stage, 'verifying');
        assert.equal(receiver.state.offset, imageSize);
        ++verifying;
      }
    }
  });
  const result = await transfer.send(packageValue);
  assert.deepEqual(result, {committed: true, version: '1.13.0'});
  assert.equal(receiver.state.offset, imageSize);
  assert.equal(receiver.dataFrames, Math.ceil(imageSize / receiver.chunk));
  assert.equal(receiver.ackWindows, Math.ceil(receiver.dataFrames / 4));
  assert.equal(receiver.staleReads, receiver.ackWindows);
  assert.equal(progressCount, receiver.ackWindows + 1);
  assert.equal(receiver.maxQueued, 4);
  assert.equal(receiver.wraps, mtu === 23 ? 3 : 0);
  assert.equal(receiver.commits, 1);
  assert.equal(receiver.starts, 1);
  assert.equal(receiver.cancels, 0);
  assert.equal(verifying, 1);
  assert.equal(previousProgress, 100);
  if (mtu === 23) assert(receiver.clock > 180_000, 'slow advancing Bluetooth transfer has no HTTPS total deadline');
});
