import { SERVICE, COMMAND, STATE, encodeCommand, decodeState, resultError } from './protocol.js';

// Dependency injection keeps reconnect, acknowledgment, and timeout behavior testable without a radio.
export class LampTransport {
  constructor(ble, { onState = () => {}, onDisconnect = () => {}, timeout = 5000 } = {}) {
    this.ble = ble; this.onState = onState; this.onDisconnect = onDisconnect; this.timeout = timeout;
    this.id = null; this.sequence = 0; this.pending = null; this.epoch = 0; this.tail = Promise.resolve();
  }
  disconnected() {
    const hadConnection = this.id !== null;
    this.epoch++; this.id = null; this.state = null;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Lamp disconnected.')); this.pending = null; }
    if (hadConnection) this.onDisconnect();
  }
  receive(data) {
    let state;
    try { state = decodeState(data); } catch (error) {
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
      return;
    }
    this.state = state;
    this.onState(state);
    if (this.pending && state.id === this.pending.id) {
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
      if (state.result) pending.reject(new Error(resultError(state.result))); else pending.resolve(state);
    }
  }
  async connect(savedDevice = null) {
    await this.disconnect();
    await this.ble.initialize({ androidNeverForLocation: true });
    const device = savedDevice || await this.ble.requestDevice({ services: [SERVICE] });
    const epoch = ++this.epoch;
    this.id = device.deviceId;
    try {
      await this.ble.connect(this.id, () => { if (epoch === this.epoch) this.disconnected(); });
      // Protected read triggers the phone's pairing prompt before subscriptions or commands.
      const initial = await this.ble.read(this.id, SERVICE, STATE, { timeout: 60000 });
      if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
      decodeState(initial); // Fail visibly on incompatible firmware.
      await this.ble.startNotifications(this.id, SERVICE, STATE, data => { if (epoch === this.epoch) this.receive(data); });
      this.receive(initial);
      await this.command('refresh'); // Closes the read/subscribe race.
      return device;
    } catch (error) { await this.disconnect(); throw error; }
  }
  async disconnect() {
    const id = this.id;
    this.disconnected();
    if (id) { try { await this.ble.disconnect(id); } catch {} }
  }
  command(operation, value = 0) {
    const epoch = this.epoch;
    const run = async () => {
      if (!this.id || epoch !== this.epoch) throw new Error('Connect to your lamp first.');
      if (['color','resetColor'].includes(operation) && !this.state?.supportsColor) throw new Error('Update the lamp firmware to use custom colors.');
      if (operation === 'effect' && value > this.state?.effectCount) throw new Error('Update the lamp firmware to use this effect.');
      const id = this.sequence = this.sequence % 255 + 1;
      const frame = encodeCommand(id, operation, value);
      // Install the listener BEFORE writing: notifications may precede the write response.
      let settle;
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lamp did not confirm the change. Reconnect before trying again.')), this.timeout);
        this.pending = settle = { id, resolve, reject, timer };
      });
      try {
        const [, state] = await Promise.all([this.ble.write(this.id, SERVICE, COMMAND, frame), response]);
        return state;
      } catch (error) {
        // An uncertain command must not be replayed after reconnect or ID wraparound.
        await this.disconnect(); throw error;
      } finally {
        clearTimeout(settle.timer);
        if (this.pending === settle) this.pending = null;
      }
    };
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
}
