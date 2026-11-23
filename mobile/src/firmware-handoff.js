const sessionId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !/^0+$/.test(value);

// Holds only the brief native background lease needed to durably hand a Wi-Fi
// update job to the lamp. It must never wrap an image download, polling loop,
// or Bluetooth transfer.
export class FirmwareHandoff {
  constructor({native, enabled = false} = {}) {
    this.native = native;
    this.enabled = enabled === true;
    this.owner = null;
    this.depth = 0;
  }

  async run(id, operation) {
    if (typeof operation !== 'function') throw Error('Firmware handoff operation is required.');
    if (!this.enabled) return operation();
    if (!sessionId(id)) throw Error('Invalid firmware handoff session.');
    if (this.owner !== null) {
      if (this.owner !== id) throw Error('Another firmware handoff is already active. Nothing was sent.');
      // The native task may have expired while JavaScript was awaiting a
      // credential or preflight read. Same-owner begin is idempotent while
      // active and reacquires a task after expiry, so revalidate immediately
      // before nested mutation work without adding a second cleanup owner.
      const renewed = await this.native.beginFirmwareHandoff({sessionId: id});
      if (renewed?.active !== true) throw Error('Native firmware handoff did not renew. Nothing was sent.');
      ++this.depth;
      try { return await operation(); }
      finally { --this.depth; }
    }
    if (typeof this.native?.beginFirmwareHandoff !== 'function' || typeof this.native?.endFirmwareHandoff !== 'function') {
      throw Error('Native firmware handoff is unavailable. Nothing was sent.');
    }
    const started = await this.native.beginFirmwareHandoff({sessionId: id});
    if (started?.active !== true) throw Error('Native firmware handoff did not start. Nothing was sent.');
    this.owner = id;this.depth = 1;
    try {
      return await operation();
    } finally {
      // Native expiry also releases the lease. Cleanup failure must not replace
      // an authoritative lamp response or an uncertain network result.
      this.depth = 0;this.owner = null;
      try { await this.native.endFirmwareHandoff({sessionId: id}); } catch {}
    }
  }
}
