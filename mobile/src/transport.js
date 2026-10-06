import { CATALOG, validateCatalog, legacyCatalog } from './catalog.js';
import { effects, SERVICE, COMMAND, STATE, FIRMWARE, EFFECT_OPTIONS, encodeCommand, decodeState, decodeFirmware, decodeEffectOptions, resultError } from './protocol.js';
import { WIFI_SETUP, WIFI_SETUP_CAPABILITY, wifiCredentials, decodeWifiSetup, wifiSetupMessage } from './wifi-setup.js';

// Dependency injection keeps reconnect, acknowledgment, and timeout behavior testable without a radio.
export class LampTransport {
  constructor(ble, { onState = () => {}, onFirmware = () => {}, onOptions = () => {}, onDisconnect = () => {}, timeout = 5000,
    selectDevice = null, onRadioReady = () => {} } = {}) {
    this.ble = ble; this.onState = onState; this.onDisconnect = onDisconnect; this.timeout = timeout;
    this.onFirmware = onFirmware;
    this.onOptions = onOptions;
    this.selectDevice = selectDevice; this.onRadioReady = onRadioReady;
    this.initialization = null;
    this.id = null; this.sequence = 0; this.pending = null; this.epoch = 0; this.tail = Promise.resolve();
  }
  disconnected() {
    const hadConnection = this.id !== null;
    this.epoch++; this.id = null; this.state = null; this.catalog = null; this.deviceIdentity=null;
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
      if (state.result) pending.reject(Object.assign(new Error(resultError(state.result)), {confirmed:true})); else pending.resolve(state);
    }
  }
  async connect(savedDevice = null) {
    await this.disconnect();
    // ASK authorization/migration must precede creation of CBCentralManager.
    const selected = this.selectDevice ? await this.selectDevice(savedDevice) : savedDevice;
    // The iOS plugin recreates CBCentralManager on every initialize call but
    // keeps its peripheral cache. Keep one manager for this app session.
    if(!this.initialization)this.initialization=this.ble.initialize({ androidNeverForLocation: true }).catch(error=>{
      this.initialization=null;throw error;
    });
    await this.initialization;
    this.onRadioReady();
    const device = selected || await this.ble.requestDevice({ services: [SERVICE] });
    const epoch = ++this.epoch;
    this.id = device.deviceId;
    try {
      if(selected && typeof this.ble.getDevices==='function') {
        const devices=await this.ble.getDevices([device.deviceId]);
        const peripheral=devices.find(d=>d.deviceId.toLowerCase()===device.deviceId.toLowerCase());
        if(!peripheral)throw new Error('The phone could not retrieve this lamp. Remove its card and set it up again.');
        device.bluetoothName=peripheral.name||device.bluetoothName||'CoolLamp';
        if(device.accessoryManaged)device.accessoryName=device.name;
        // End any unfinished connection to this same saved peripheral before
        // reconnecting. CBCentralManager doesn't emit didConnect twice for an
        // already-connected device. Other lamps are left alone.
        await this.ble.disconnect(device.deviceId);
      } else device.bluetoothName=device.name||device.bluetoothName||'CoolLamp';
      await this.ble.connect(this.id, () => { if (epoch === this.epoch) this.disconnected(); });
      // Protected read triggers the phone's pairing prompt before subscriptions or commands.
      const initial = await this.ble.read(this.id, SERVICE, STATE, { timeout: 60000 });
      if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
      decodeState(initial); // Fail visibly on incompatible firmware.
      // Optional on older firmware. The short protected value matches Wi-Fi discovery.
      try {
        const identity = await this.ble.read(this.id, SERVICE, '7b610006-6e2b-4f3d-9a71-28e45c001001');
        const text = new TextDecoder().decode(new Uint8Array(identity.buffer, identity.byteOffset, identity.byteLength));
        if (/^[0-9a-f]{12}$/.test(text)) device.lampId = text;
      } catch { /* Firmware before network discovery has no identity characteristic. */ }
      if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
      await this.ble.startNotifications(this.id, SERVICE, STATE, data => { if (epoch === this.epoch) this.receive(data); });
      this.receive(initial);
      if (this.state.capabilities & 8) {
        await this.command('enableEffects', (this.state.capabilities & 32) ? 3 : (this.state.capabilities & 16) ? 2 : 1);
        if (this.state.capabilities & 32) {
          const entries=[], count=this.state.effectCount;
          for (let id=1;id<=count;id++) {
            await this.command('catalogEntry',id);
            const data=await this.ble.read(this.id,SERVICE,CATALOG);
            if(epoch!==this.epoch)throw new Error('Lamp disconnected.');
            entries.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(data.buffer,data.byteOffset,data.byteLength))));
          }
          this.catalog=validateCatalog(entries,count);
        }
        await this.ble.startNotifications(this.id, SERVICE, EFFECT_OPTIONS, data => {
          if (epoch === this.epoch) { try { this.onOptions(decodeEffectOptions(data,this.state.effectCount)); } catch {} }
        });
        const options = await this.ble.read(this.id, SERVICE, EFFECT_OPTIONS);
        if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
        this.onOptions(decodeEffectOptions(options,this.state.effectCount));
      } else this.onOptions(null);
      if (this.state.capabilities & 4) {
        const firmware = await this.ble.read(this.id, SERVICE, FIRMWARE);
        if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
        this.onFirmware(decodeFirmware(firmware));
        await this.ble.startNotifications(this.id, SERVICE, FIRMWARE, data => {
          if (epoch === this.epoch) { try { this.onFirmware(decodeFirmware(data)); } catch {} }
        });
        const latest = await this.ble.read(this.id, SERVICE, FIRMWARE);
        if (epoch === this.epoch) this.onFirmware(decodeFirmware(latest));
      } else this.onFirmware(null);
      if (!this.catalog) this.catalog=legacyCatalog(effects.slice(0,this.state.effectCount));
      this.deviceIdentity = device.lampId || null;
      if(this.supportsWifiSetup&&!this.deviceIdentity)throw Error('Could not verify this lamp’s Bluetooth identity. Reconnect before setting up Wi-Fi.');
      await this.command('refresh'); // Closes the read/subscribe race.
      return device;
    } catch (error) { error.device=device; await this.disconnect(); throw error; }
  }
  async disconnect() {
    const id = this.id;
    this.disconnected();
    if (id) { try { await this.ble.disconnect(id); } catch {} }
  }
  command(operation, value = 0, responseCharacteristic = null) {
    const epoch = this.epoch;
    const run = async () => {
      if (!this.id || epoch !== this.epoch) throw new Error('Connect to your lamp first.');
      if(operation.startsWith('wifi')&&!(this.state?.capabilities&WIFI_SETUP_CAPABILITY))throw Error('Update this lamp to firmware 1.9.0 or newer for Bluetooth Wi-Fi setup.');
      if(operation==='factoryReset'&&!(this.state?.capabilities&128))throw Error('Update this lamp to firmware 1.9.1 or newer for factory reset.');
      if(operation.startsWith('center')&&!(this.state?.capabilities&128))throw Error('Update this lamp to firmware 1.9.1 or newer to fine-tune its center.');
      if (['color','resetColor'].includes(operation) && !this.state?.supportsColor) throw new Error('Update the lamp firmware to use custom colors.');
      if (['effectOptions','enableEffects'].includes(operation) && !(this.state?.capabilities & 8)) throw new Error('Update the lamp firmware to use effect controls.');
      if (operation === 'effect' && value > this.state?.effectCount) throw new Error('Update the lamp firmware to use this effect.');
      if (['checkFirmware','installFirmware','autoUpdate'].includes(operation) && !(this.state?.capabilities & 4)) throw new Error('Install the updater firmware using the lamp’s Wi-Fi page first.');
      const id = this.sequence = this.sequence % 255 + 1;
      const frame = encodeCommand(id, operation, value, this.state.effectCount);
      // Install the listener BEFORE writing: notifications may precede the write response.
      let settle;
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lamp did not confirm the change. Reconnect before trying again.')), this.timeout);
        this.pending = settle = { id, resolve, reject, timer };
      });
      try {
        const [, state] = await Promise.all([this.ble.write(this.id, SERVICE, COMMAND, frame), response]);
        if(responseCharacteristic) {
          const data=await this.ble.read(this.id,SERVICE,responseCharacteristic);
          if(epoch!==this.epoch)throw Error('Connection changed.');
          return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)));
        }
        return state;
      } catch (error) {
        // An uncertain command must not be replayed after reconnect or ID wraparound.
        if (!error.confirmed) await this.disconnect(); throw error;
      } finally {
        clearTimeout(settle.timer);
        if (this.pending === settle) this.pending = null;
      }
    };
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
  get supportsWifiSetup() { return Boolean(this.id&&this.state?.capabilities&WIFI_SETUP_CAPABILITY); }
  factoryReset() { return this.command('factoryReset',0xa5); }
  async calibrateCenter(action,position) {
    const actions={start:0,save:1,cancel:2,status:3};
    if(!(action in actions)&&action!=='move')throw Error('Choose a valid center action.');
    const value=await this.command(action==='move'?'centerMove':'centerControl',action==='move'?position:actions[action],
      '7b610009-6e2b-4f3d-9a71-28e45c001001');
    if(value?.version!==1||typeof value.active!=='boolean'||!Number.isInteger(value.leds)||value.leds<1||value.leds>1024||
      !Number.isInteger(value.midpoint)||value.midpoint<0||value.midpoint>=value.leds||
      !Number.isInteger(value.position)||value.position<1||value.position>Math.max(1,value.leds-1))throw Error('Invalid center adjustment status.');
    return value;
  }
  async wifiRequest(operation, value=0) {
    return decodeWifiSetup(await this.command(operation,value,WIFI_SETUP),this.deviceIdentity);
  }
  readWifiSetup() { return this.wifiRequest('wifiControl',0); }
  wifiJob(action) {
    const epoch=this.epoch;
    const result=(this.setupTail||Promise.resolve()).then(()=>{
      if(!this.id||epoch!==this.epoch)throw Error('Connection changed.');
      return action(epoch);
    });
    this.setupTail=result.catch(()=>{});return result;
  }
  async waitWifi(epoch,signal) {
    if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');
    if(!this.id||epoch!==this.epoch)throw Error('Connection changed.');
    await new Promise(resolve=>setTimeout(resolve,700));
    if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');
    if(!this.id||epoch!==this.epoch)throw Error('Connection changed.');
  }
  scanWifi({onProgress=()=>{},signal}={}) {
    return this.wifiJob(async epoch=>{
      try {
        let s=await this.wifiRequest('wifiControl',1);onProgress(s);
        const started=Date.now();
        while(s.phase===1&&Date.now()-started<30000){await this.waitWifi(epoch,signal);s=await this.readWifiSetup();onProgress(s);}
        if(s.phase!==2)throw Error(wifiSetupMessage(s.phase===1?{phase:5,error:1}:s));
        const networks=[];
        for(let i=0;i<s.count;i++) {
          if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');
          const network=await this.wifiRequest('wifiNetwork',i);
          if(network.scanId!==s.scanId||network.index!==i)throw Error('Network scan changed. Find networks again.');
          networks.push(network);
        }
        return networks;
      } catch(e) { if(this.id&&epoch===this.epoch)await this.command('wifiControl',2).catch(()=>{});throw e; }
    });
  }
  configureWifi(ssid,password,open=false,{onProgress=()=>{},signal}={}) {
    const credentials=wifiCredentials(ssid,password,open);
    return this.wifiJob(async epoch=>{
      try {
        if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');
        await this.command('wifiBegin',credentials);
        for(let offset=0;offset<credentials.bytes.length;offset+=16) {
          if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');
          await this.command('wifiChunk',{offset,bytes:credentials.bytes.slice(offset,offset+16)});
        }
        let s=await this.wifiRequest('wifiCommit');onProgress(s);
        const started=Date.now();
        while(s.phase===3&&Date.now()-started<40000){await this.waitWifi(epoch,signal);s=await this.readWifiSetup();onProgress(s);}
        if(s.phase!==4||!s.connected||s.ssid!==ssid)throw Error(wifiSetupMessage(s.phase===3?{phase:5,error:2}:s));
        return s;
      } catch(e) { if(this.id&&epoch===this.epoch)await this.command('wifiControl',2).catch(()=>{});throw e; }
      finally { credentials.bytes.fill(0); }
    }).finally(()=>credentials.bytes.fill(0));
  }
}
