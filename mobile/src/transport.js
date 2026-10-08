import { CATALOG, validateCatalog, legacyCatalog } from './catalog.js';
import { effects, SERVICE, COMMAND, STATE, FIRMWARE, EFFECT_OPTIONS, CONTROL, CONTROL_ENDPOINTS, encodeCommand, decodeState, decodeFirmware, decodeEffectOptions, decodeControlCapabilities, decodeControlPage, resultError } from './protocol.js';
import { WIFI_SETUP, WIFI_SETUP_CAPABILITY, wifiCredentials, decodeWifiSetup, wifiSetupMessage } from './wifi-setup.js';
import { WifiTransport } from './wifi.js';
import { normalizeLampStyle } from './lamp-style.js';

const controlPaths={'/api/state':1,'/api/sync/status':2,'/api/sync/invite':3,'/api/sync':4,'/api/sync/scene':5,
 '/api/sync/order':6,'/api/config':7,'/api/audio':8,'/api/audio/tuning':9,'/api/rotation':10,'/api/geometry':11,
 '/api/calibration':12,'/api/name':13,'/api/identify':14,'/api/vu-colors':15,'/api/fountain-colors':16,
 '/api/audio/test':17,'/api/firmware':18,'/api/firmware/check':19,'/api/firmware/install':20,
 '/api/firmware/automatic':21,'/api/factory-reset':22,'/api/bluetooth':24,'/api/bluetooth/forget':24,'/api/style':25,'/api/effects':26};
const publicFields=(value,fields)=>Object.fromEntries(fields.filter(field=>['string','boolean','number'].includes(typeof value?.[field])).map(field=>[field,value[field]]));
function publicControlSync(value){
  const sync=publicFields(value,['version','role','leader','active','paused','members','sceneCount','scene','position','count','sceneSpeed','sceneIntensity','transport']);
  for(const field of ['scenePrimary','sceneSecondary'])if(Array.isArray(value[field])&&value[field].length===3&&value[field].every(number=>Number.isInteger(number)&&number>=0&&number<=255))sync[field]=value[field].slice();
  sync.order=(Array.isArray(value.order)?value.order:[]).slice(0,9).map(entry=>publicFields(entry,['id','name','online']));
  sync.peers=(Array.isArray(value.peers)?value.peers:[]).slice(0,8).map(entry=>publicFields(entry,['id','name','address','role','microphone','transport','channel']));
  sync.radio=publicFields(value.radio,['available','channel','seeking','security','received','receiveDropped','sent','sendFailed','sendDropped','channelChanges']);
  sync.network=publicFields(value.network,['listening','blocked','received','discoveries','authenticationFailures','subscriptions','frames','clockDrops']);
  return sync;
}

// Dependency injection keeps reconnect, acknowledgment, and timeout behavior testable without a radio.
export class LampTransport {
  constructor(ble, { onState = () => {}, onFirmware = () => {}, onOptions = () => {}, onDisconnect = () => {}, timeout = 5000,
    selectDevice = null, onRadioReady = () => {}, onDeviceSelected = () => {}, sharedInitialization = null,
    expectedDeviceIdentity = null, controlOnly = false } = {}) {
    this.ble = ble; this.onState = onState; this.onDisconnect = onDisconnect; this.timeout = timeout;
    this.onFirmware = onFirmware;
    this.onOptions = onOptions;
    this.selectDevice = selectDevice; this.onRadioReady = onRadioReady;
    this.onDeviceSelected = onDeviceSelected;
    this.connectionAttempts = new Set();
    this.initialization = sharedInitialization;
    this.expectedDeviceIdentity=expectedDeviceIdentity;
    this.controlOnly=controlOnly;
    this.control=null;this.raw=null;this.controlSequence=0;this.controlTail=Promise.resolve();this.actionTail=Promise.resolve();
    this.id = null; this.sequence = 0; this.pending = null; this.epoch = 0; this.tail = Promise.resolve();
  }
  disconnected(confirmedId = null) {
    if(confirmedId)this.connectionAttempts.delete(confirmedId);
    const hadConnection = this.id !== null;
    clearTimeout(this.controlTimer);this.controlTimer=null;
    this.epoch++; this.id = null; this.state = null; this.catalog = null; this.deviceIdentity=null;this.control=null;this.raw=null;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Lamp disconnected.')); this.pending = null; }
    if (hadConnection) this.onDisconnect();
  }
  receive(data) {
    let state;
    try { state = decodeState(data); } catch (error) {
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
      return;
    }
    if(this.raw){
      for(const field of ['mode','brightness','power'])this.raw[field]=state[field];
      state={...this.raw,...state};
    }
    this.state = state;
    this.onState(state);
    if (this.pending && state.id === this.pending.id) {
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
      if (state.result) pending.reject(Object.assign(new Error(resultError(state.result)), {confirmed:true})); else pending.resolve(state);
    }
  }
  async retrieveSelectedDevice(device,epoch) {
    const matches=peripheral=>peripheral?.deviceId?.toLowerCase()===device.deviceId.toLowerCase();
    let peripheral=(await this.ble.getDevices([device.deviceId])).find(matches);
    if(peripheral||!device.accessoryManaged)return peripheral;
    // Apple's authorized inventory can precede Core Bluetooth's peripheral cache.
    await new Promise(resolve=>setTimeout(resolve,250));
    if(epoch!==this.epoch)throw Error('Connection changed.');
    peripheral=(await this.ble.getDevices([device.deviceId])).find(matches);
    if(!peripheral&&typeof this.ble.getConnectedDevices==='function')
      peripheral=(await this.ble.getConnectedDevices([SERVICE])).find(matches);
    if(peripheral)return peripheral;
    if(typeof this.ble.requestLEScan!=='function'||typeof this.ble.stopLEScan!=='function')return null;
    // Outside enrollment, the lamp intentionally omits its service/name from
    // advertising. Scan without those filters, but accept ONLY the authorized UUID.
    let finish,timer;
    const found=new Promise(resolve=>{finish=resolve;});
    try {
      timer=setTimeout(()=>finish(null),8000);
      await this.ble.requestLEScan({allowDuplicates:false},result=>{
        if(epoch===this.epoch&&matches(result.device))finish(result.device);
      });
      peripheral=await found;
    } finally {clearTimeout(timer);await this.ble.stopLEScan();}
    if(epoch!==this.epoch)throw Error('Connection changed.');
    return peripheral;
  }
  async connect(savedDevice = null, retryInitialState = true) {
    await this.disconnect();
    // ASK authorization/migration must precede creation of CBCentralManager.
    const selected = this.selectDevice ? await this.selectDevice(savedDevice) : savedDevice;
    // Authorization is a durable event even if initialization/GATT later fails.
    if(selected)await this.onDeviceSelected(selected);
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
        const peripheral=await this.retrieveSelectedDevice(device,epoch);
        if(!peripheral)throw new Error('The iPhone could not retrieve this authorized lamp. Keep its card, bring the lamp nearby, and retry connecting.');
        if(epoch!==this.epoch)throw Error('Connection changed.');
        device.deviceId=peripheral.deviceId;this.id=device.deviceId;
        device.bluetoothName=peripheral.name||device.bluetoothName||'CoolLamp';
        if(device.accessoryManaged)device.accessoryName=device.name;
        // Apple's setup picker may still own the link for a fresh authorization.
        // Only clean up a connection this transport actually attempted itself.
        if(device.newAuthorization)this.connectionAttempts.delete(device.deviceId);
        if(this.connectionAttempts.has(device.deviceId)) {
          await this.ble.disconnect(device.deviceId);
          this.connectionAttempts.delete(device.deviceId);
        }
      } else device.bluetoothName=device.name||device.bluetoothName||'CoolLamp';
      this.connectionAttempts.add(device.deviceId);
      await this.ble.connect(this.id, () => { if (epoch === this.epoch) this.disconnected(device.deviceId); });
      // Protected read triggers the phone's pairing prompt before subscriptions or commands.
      const initial = await this.ble.read(this.id, SERVICE, STATE, { timeout: this.controlOnly?this.timeout:60000 });
      if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
      try { decodeState(initial); } // Fail visibly on incompatible firmware.
      catch(error) { error.initialStateRead=true;throw error; }
      // Optional on older firmware. The short protected value matches Wi-Fi discovery.
      let protectedIdentity=null;
      try {
        const identity = await this.ble.read(this.id, SERVICE, '7b610006-6e2b-4f3d-9a71-28e45c001001');
        const text = new TextDecoder().decode(new Uint8Array(identity.buffer, identity.byteOffset, identity.byteLength));
        if (/^[0-9a-f]{12}$/.test(text)) protectedIdentity=device.lampId=text;
      } catch { /* Firmware before network discovery has no identity characteristic. */ }
      if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
      if(this.expectedDeviceIdentity&&protectedIdentity!==this.expectedDeviceIdentity)throw Error('Bluetooth identity did not match this coordinator. Pair the correct lamp first.');
      await this.ble.startNotifications(this.id, SERVICE, STATE, data => { if (epoch === this.epoch) this.receive(data); });
      this.receive(initial);
      // Continue beyond the cached acknowledgment from the previous connection.
      // A readback must never mistake that reply for our first new command.
      this.sequence = this.state.id;
      if(this.controlOnly){
        if(!protectedIdentity)throw Error('Could not verify this lamp’s Bluetooth identity.');
        this.deviceIdentity=protectedIdentity;
        try{this.control=await this.readControlCapabilities(epoch);}
        catch(error){if(epoch!==this.epoch)throw error;throw Object.assign(Error('Update this lamp to firmware 1.10.0 for offline Bluetooth group controls.'),{incompatible:true,code:'OFFLINE_CONTROL_UNAVAILABLE'});}
        if(epoch!==this.epoch)throw Error('Connection changed.');
        await this.refresh(this.expectedDeviceIdentity||this.deviceIdentity);return device;
      }
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
        this.receiveFirmware(decodeFirmware(firmware));
        await this.ble.startNotifications(this.id, SERVICE, FIRMWARE, data => {
          if (epoch === this.epoch) { try { this.receiveFirmware(decodeFirmware(data)); } catch {} }
        });
        const latest = await this.ble.read(this.id, SERVICE, FIRMWARE);
        if (epoch === this.epoch) this.receiveFirmware(decodeFirmware(latest));
      } else this.onFirmware(null);
      if (!this.catalog) this.catalog=legacyCatalog(effects.slice(0,this.state.effectCount));
      this.deviceIdentity = protectedIdentity;
      if(this.supportsWifiSetup&&!this.deviceIdentity)throw Error('Could not verify this lamp’s Bluetooth identity. Reconnect before setting up Wi-Fi.');
      await this.command('refresh'); // Closes the read/subscribe race.
      // The optional protected characteristic adds settings without changing the
      // existing state packet or catalog negotiation on older lamps.
      let capabilities;
      try{capabilities=await this.readControlCapabilities(epoch);}
      catch{ /* Older firmware retains its normal Bluetooth controls. */ }
      if(epoch!==this.epoch)throw Error('Lamp disconnected.');
      if(capabilities){
        if(!this.deviceIdentity)throw Error('Could not verify this lamp’s Bluetooth control identity.');
        this.control=capabilities;await this.refresh(this.deviceIdentity);this.scheduleControlRefresh();
      }
      return device;
    } catch (error) {
      if(error.code==='COMMAND_NOT_CONFIRMED'&&device.accessoryManaged)
        error.message='Bluetooth connected, but the lamp did not confirm setup. Tap its saved card to reconnect.';
      error.device=device; await this.disconnect();
      if(retryInitialState&&device.accessoryManaged&&error.initialStateRead&&error.code==='INVALID_STATE_PACKET') {
        // Service Changed may invalidate iOS's old handles during the first
        // encrypted read after an update. No commands have been sent yet.
        const retryEpoch=this.epoch;
        await new Promise(resolve=>setTimeout(resolve,250));
        if(retryEpoch!==this.epoch)throw error;
        return this.connect({...device,newAuthorization:false},false);
      }
      throw error;
    }
  }
  async disconnect() {
    const id = this.id;
    this.disconnected();
    if (id) { try { await this.ble.disconnect(id);this.connectionAttempts.delete(id); } catch {} }
  }
  command(operation, value = 0, responseCharacteristic = null) {
    if(operation==='effect'&&this.supportsOfflineControl&&this.raw?.sync?.role===1&&this.raw.sync.scene)
      return this.configureGroupScene({scene:0}).then(()=>this.command(operation,value,responseCharacteristic));
    const epoch = this.epoch;
    const run = async () => {
      if (!this.id || epoch !== this.epoch) throw new Error('Connect to your lamp first.');
      if(operation.startsWith('control')&&!this.supportsOfflineControl)throw Error('Update this lamp to firmware 1.10.0 or newer for full Bluetooth settings.');
      if(this.raw?.sync?.active&&['brightness','effect','saveDefaults','color','resetColor','effectOptions'].includes(operation))throw Error('Edit the coordinator or pause this lamp’s group first.');
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
        this.pending = settle = { id, resolve, reject, timer:null, probeTimer:null };
      });
      try {
        const deviceId = this.id;
        const write = this.ble.write(deviceId, SERVICE, COMMAND, frame).then(() => {
          if(this.pending!==settle||epoch!==this.epoch)return;
          // The native plugin queues every device's radio calls together.
          // Begin the acknowledgment window after our queued write completes;
          // an early notification may already have settled this command.
          settle.timer=setTimeout(()=>settle.reject(Object.assign(
            new Error('Lamp did not confirm the change. Reconnect before trying again.'),
            {code:'COMMAND_NOT_CONFIRMED',operation})),this.timeout);
          // A notification can be lost during the first encrypted subscription.
          // Read the lamp's exact acknowledgment once; never resend the command.
          settle.probeTimer = setTimeout(async () => {
            if(this.pending!==settle||epoch!==this.epoch)return;
            try {
              const data=await this.ble.read(deviceId,SERVICE,STATE,{timeout:this.timeout/2});
              if(this.pending===settle&&epoch===this.epoch&&decodeState(data).id===id)this.receive(data);
            } catch { /* The original deadline still bounds an unconfirmed write. */ }
          },this.timeout/2);
        });
        const [, state] = await Promise.all([write, response]);
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
        clearTimeout(settle.probeTimer);
        if (this.pending === settle) this.pending = null;
      }
    };
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
  get supportsWifiSetup() { return Boolean(this.id&&this.state?.capabilities&WIFI_SETUP_CAPABILITY); }
  async readControlCapabilities(epoch) {
    const first=await this.ble.read(this.id,SERVICE,CONTROL);
    if(epoch!==this.epoch)throw Error('Connection changed.');
    try{return decodeControlCapabilities(first);}catch(error){
      // The loop restores metadata after a connection generation transition.
      // Retry this protected read once only; never repeat a mutation.
      if(!(first instanceof DataView)||first.byteLength<12||first.getUint8(0)!==1||first.getUint16(4,true)!==403)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));if(epoch!==this.epoch)throw Error('Connection changed.');
      const next=await this.ble.read(this.id,SERVICE,CONTROL);if(epoch!==this.epoch)throw Error('Connection changed.');
      return decodeControlCapabilities(next);
    }
  }
  receiveFirmware(next) {
    if(this.raw)this.raw.firmware=next;if(this.state)this.state.firmware=next;this.onFirmware(next);
  }
  async refreshFirmware() {
    if(!this.id||!(this.state?.capabilities&4))throw Error('Firmware status is unavailable over Bluetooth.');
    const epoch=this.epoch,id=this.id;
    const value=await this.ble.read(id,SERVICE,FIRMWARE,{timeout:this.timeout});
    if(epoch!==this.epoch||id!==this.id)throw Error('Connection changed.');
    const status=decodeFirmware(value);this.receiveFirmware(status);return status;
  }
  get supportsOfflineControl() { return Boolean(this.id&&this.control?.capabilities.includes('control')); }
  get supportsOfflineGroups() { return Boolean(this.supportsOfflineControl&&this.control.capabilities.includes('groups')); }
  get identity() { return this.deviceIdentity; }
  get base() { return this.id?'ble:'+this.id:null; }
  enqueue(action) {
    const epoch=this.epoch,result=this.actionTail.then(()=>{
      if(!this.id||epoch!==this.epoch)throw Error('Connection changed.');return action();
    });
    this.actionTail=result.catch(()=>{});return result;
  }
  controlJob(action) {
    const epoch=this.epoch,result=this.controlTail.then(()=>{
      if(!this.supportsOfflineControl||epoch!==this.epoch)throw Error('Bluetooth control connection changed.');return action(epoch);
    });
    this.controlTail=result.catch(()=>{});return result;
  }
  request(path,data) {
    const endpoint=controlPaths[path];
    if(!endpoint)return Promise.reject(Error('This setting is unavailable over Bluetooth.'));
    if(path==='/api/bluetooth/forget')data={...data,action:'forget'};
    return this.controlRequest(endpoint,data===undefined?1:2,data);
  }
  controlRequest(endpoint,method,data) {
    const body=new TextEncoder().encode(data===undefined?'':new URLSearchParams(data).toString());
    if(body.length>1024){body.fill(0);return Promise.reject(Error('Bluetooth settings exceed the supported size.'));}
    return this.controlJob(async epoch=>{
      const deviceId=this.id,identity=this.deviceIdentity,tx=this.controlSequence=this.controlSequence%65535+1;
      const guard=()=>{if(epoch!==this.epoch||this.id!==deviceId||this.deviceIdentity!==identity)throw Error('Bluetooth control connection changed.');};
      let responseBytes;
      try{
        await this.command('controlBegin',{tx,endpoint,method,length:body.length});guard();
        for(let offset=0;offset<body.length;offset+=13){
          await this.command('controlChunk',{tx,offset,bytes:body.slice(offset,offset+13)});guard();
        }
        // A consumed commit is never resent. The existing command path only
        // reads a matching cached acknowledgment if its notification is lost.
        await this.command('controlCommit',{tx});guard();
        let offset=0,status,total;
        do{
          await this.command('controlPage',{tx,offset});guard();
          const data=await this.ble.read(deviceId,SERVICE,CONTROL);guard();
          const page=decodeControlPage(data,{tx,endpoint,offset,...(total===undefined?{}:{total,status})});
          if(total===undefined){total=page.total;status=page.status;responseBytes=new Uint8Array(total);}
          if(!page.length&&offset<total)throw Error('Bluetooth control response stopped before completion.');
          responseBytes.set(page.bytes,offset);offset+=page.length;
        }while(offset<total);
        const text=new TextDecoder('utf-8',{fatal:true}).decode(responseBytes);
        if(status<200||status>=300)throw Object.assign(new Error(text||'Lamp rejected Bluetooth settings.'),{confirmed:true,status});
        return text;
      }finally{
        body.fill(0);responseBytes?.fill(0);
        if(epoch===this.epoch&&this.id===deviceId){
          try{await this.command('controlBegin',{tx,endpoint:0,method:0,length:0});}catch{ /* No request replay. */ }
        }
      }
    });
  }
  async refresh(expectedId=this.deviceIdentity,retryCatalog=true) {
    if(!this.supportsOfflineControl)throw Error('Update this lamp to firmware 1.10.0 or newer for full Bluetooth settings.');
    const epoch=this.epoch,text=await this.request('/api/state');
    if(epoch!==this.epoch)throw Error('Connection changed.');
    let raw;try{raw=JSON.parse(text);}catch{throw Error('Invalid Bluetooth settings snapshot.');}
    if(raw?.deviceId!==expectedId||raw.deviceId!==this.deviceIdentity||!Array.isArray(raw.effects))throw Error('Invalid Bluetooth settings snapshot.');
    let catalog=this.catalog;
    if(!catalog||catalog.length!==raw.effects.length){
      const entries=JSON.parse(await this.request('/api/effects'));
      if(epoch!==this.epoch)throw Error('Connection changed.');
      if(Array.isArray(entries)&&entries.length!==raw.effects.length&&retryCatalog)return this.refresh(expectedId,false);
      catalog=validateCatalog(entries,raw.effects.length);
    }
    if(
      !Number.isInteger(raw.mode)||!catalog?.some(effect=>effect.id===raw.mode)||
      !Number.isInteger(raw.brightness)||raw.brightness<1||raw.brightness>255||typeof raw.power!=='boolean'||
      !Number.isInteger(raw.leds)||raw.leds<1||raw.leds>1024)throw Error('Invalid Bluetooth settings snapshot.');
    const snapshot={};
    for(const field of ['deviceId','hostname','name','ssid','leds','milliamps','midpoint','startupMode','startupBrightness',
      'mode','brightness','power','apiVersion','catalogVersion','colors','effectOptions','vuColors','fountainColors',
      'audio','rotation','calibration','firmware','sync','factoryReset','usingDefaultPassword','effectiveMidpoint'])
      if(raw[field]!==undefined)snapshot[field]=raw[field];
    if(snapshot.sync)snapshot.sync=publicControlSync(snapshot.sync);
    const design=raw.lampStyle&&typeof raw.lampStyle==='object'&&!Array.isArray(raw.lampStyle)?normalizeLampStyle(raw.lampStyle):null;if(design)snapshot.lampStyle=design;
    this.catalog=catalog;this.raw=snapshot;
    const color=raw.colors?.[raw.mode-1],binary=this.state;
    this.state={...snapshot,id:binary.id,result:binary.result,revision:binary.revision,capabilities:binary.capabilities,
      mode:raw.mode,brightness:raw.brightness,power:raw.power,
      effectCount:this.catalog.length,supportsColor:binary.supportsColor,color:color?{enabled:Boolean(color[0]),r:color[1],g:color[2],b:color[3]}:binary.color};
    this.onState(this.state);if(raw.firmware)this.receiveFirmware(raw.firmware);
    const options=raw.effectOptions?.[raw.mode-1];
    if(options)this.onOptions({mode:raw.mode,speed:options[0],intensity:options[1],dual:options[2],r:options[3],g:options[4],b:options[5]});
    return snapshot;
  }
  scheduleControlRefresh() {
    clearTimeout(this.controlTimer);const epoch=this.epoch;
    this.controlTimer=setTimeout(async()=>{
      if(epoch!==this.epoch||!this.supportsOfflineControl)return;
      try{
        if(![1,3,4].includes(this.raw?.firmware?.phase))await this.enqueue(()=>this.refresh());
      }catch{ /* Radio loss/legacy control handles connection state independently. */ }
      if(epoch===this.epoch&&this.supportsOfflineControl)this.scheduleControlRefresh();
    },2500);
  }
  factoryReset() { return this.command('factoryReset',0xa5); }
  async calibrateCenter(action,position) {
    if(this.supportsOfflineControl)return WifiTransport.prototype.calibrateCenter.call(this,action,position);
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

// The encrypted adapter uses the same validation and readback as Wi-Fi without
// importing HTTP tokens or changing the selected lamp's radio connection.
for(const method of ['configureGroupScene','configureGroupOrder','configureSync','joinCoordinator','syncAction','syncInvite',
 'calibrateLeds','configureRotation','configureGeometry','configureFountainColors','configureVuColors','tuneAudio','configureAudio','configureLampStyle'])
  LampTransport.prototype[method]=WifiTransport.prototype[method];
