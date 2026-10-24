import { CATALOG, validateCatalog, legacyCatalog, effectAvailable } from './catalog.js';
import { effects, SERVICE, COMMAND, STATE, FIRMWARE, EFFECT_OPTIONS, CONTROL, CONTROL_ENDPOINTS, encodeCommand, decodeState, decodeFirmware, decodeEffectOptions, decodeControlCapabilities, decodeControlPage, resultError } from './protocol.js';
import { WIFI_SETUP, WIFI_SETUP_CAPABILITY, wifiCredentials, decodeWifiSetup, wifiSetupMessage } from './wifi-setup.js';
import { WifiTransport } from './wifi.js';
import { normalizeLampStyle } from './lamp-style.js';
import { validCurrentStateView } from './state-current.js';
import { BluetoothFirmwareTransfer, decodeBleUpdate, OTA_STATUS } from './bluetooth-firmware.js';

const controlPaths={'/api/state':1,'/api/state/current':1,'/api/sync/status':2,'/api/sync/invite':3,'/api/sync':4,'/api/sync/scene':5,
 '/api/sync/order':6,'/api/config':7,'/api/audio':8,'/api/audio/tuning':9,'/api/rotation':10,'/api/geometry':11,
 '/api/calibration':12,'/api/name':13,'/api/identify':14,'/api/vu-colors':15,'/api/fountain-colors':16,
 '/api/audio/test':17,'/api/firmware':18,'/api/firmware/check':19,'/api/firmware/install':20,
 '/api/firmware/automatic':21,'/api/factory-reset':22,'/api/bluetooth':24,'/api/bluetooth/forget':24,'/api/style':25,'/api/effects':26,'/api/firmware/fleet':27,
 '/api/mesh/status':28,'/api/mesh/request':29,'/api/mesh/result':30,'/api/power':31,'/api/preview':32,'/api/defaults':33,'/api/color':34,'/api/effect-options':35,
 '/api/mesh/new':36,'/api/mesh/enroll/start':37,'/api/mesh/enroll/status':38,'/api/mesh/enroll/cancel':39,
 '/api/descriptor':40,'/api/effects/schema':41,'/api/state/patch':42,'/api/appearance/save':43,'/api/receipt':44,'/api/revision':45,'/api/firmware/policy':46,'/api/sync/page':47,'/api/household':48,'/api/firmware/rollout':51,'/api/group/remove':52};
const publicFields=(value,fields)=>Object.fromEntries(fields.filter(field=>['string','boolean','number'].includes(typeof value?.[field])).map(field=>[field,value[field]]));
const consumerCallbacks=Object.freeze({state:'onState',firmware:'onFirmware',options:'onOptions',disconnect:'onDisconnect'});
function publicControlSync(value){
  const sync=publicFields(value,['version','role','leader','active','paused','members','sceneCount','scene','position','count','sceneSpeed','sceneIntensity','transport','maxMembers','maxSupportedMembers','broadcastFrames','coordinatorMigration','peerTotal','peerCursor','peerNext','peerTruncated','slotSaved','slotSaveFailures','incompatibleSubscriptions','session','dissolutionV1','membershipLocked']);
  if(typeof value?.incarnation==='string'&&/^[0-9a-f]{32}$/.test(value.incarnation))sync.incarnation=value.incarnation;
  if(Array.isArray(value.protocolVersions)&&value.protocolVersions.length<=3)sync.protocolVersions=[...new Set(value.protocolVersions.filter(version=>[2,3].includes(version)))];
  for(const field of ['scenePrimary','sceneSecondary'])if(Array.isArray(value[field])&&value[field].length===3&&value[field].every(number=>Number.isInteger(number)&&number>=0&&number<=255))sync[field]=value[field].slice();
  sync.order=(Array.isArray(value.order)?value.order:[]).slice(0,value.version===3?32:9).map(entry=>publicFields(entry,['id','name','online']));
  sync.peers=(Array.isArray(value.peers)?value.peers:[]).slice(0,8).map(entry=>publicFields(entry,['id','name','address','role','version','microphone','transport','channel']));
  sync.radio=publicFields(value.radio,['available','channel','seeking','security','received','receiveDropped','sent','sendFailed','sendDropped','channelChanges']);
  sync.network=publicFields(value.network,['listening','blocked','received','discoveries','authenticationFailures','subscriptions','frames','clockDrops']);
  return sync;
}
// Dependency injection keeps reconnect, acknowledgment, and timeout behavior testable without a radio.
export class LampTransport {
  constructor(ble, { onState = () => {}, onFirmware = () => {}, onOptions = () => {}, onDisconnect = () => {}, timeout = 5000,
    selectDevice = null, onRadioReady = () => {}, onDeviceSelected = () => {}, sharedInitialization = null,
    expectedDeviceIdentity = null, controlOnly = false, firmwareOnly = false, firmwareBulkWrites = false,
    backgroundAllowed = () => true, backgroundGeneration = () => 0, onCallbackError = () => {} } = {}) {
    this.ble = ble; this.onState = onState; this.onDisconnect = onDisconnect; this.timeout = timeout;
    this.onFirmware = onFirmware;
    this.onOptions = onOptions;
    this.onCallbackError=onCallbackError;this.lastCallbackError=null;this.callbackErrorSequence=0;
    this.selectDevice = selectDevice; this.onRadioReady = onRadioReady;
    this.onDeviceSelected = onDeviceSelected;
    this.connectionAttempts = new Set();
    this.initialization = sharedInitialization;
    this.expectedDeviceIdentity=expectedDeviceIdentity;
    this.controlOnly=controlOnly;
    this.firmwareOnly=firmwareOnly===true;this.firmwareReady=false;this.firmwareConnectionGuard=null;
    this.firmwareBulkWrites=firmwareBulkWrites===true;
    this.backgroundAllowed=backgroundAllowed;this.backgroundGeneration=backgroundGeneration;this.controlRefreshOwner=null;
    this.control=null;this.raw=null;this.controlSequence=0;this.controlTail=Promise.resolve();this.actionTail=Promise.resolve();
    this.id = null; this.sequence = 0; this.pending = null; this.epoch = 0; this.tail = Promise.resolve();
  }
  recordCallbackError(callback,type,epoch){
    if(epoch!==this.epoch||!Object.hasOwn(consumerCallbacks,callback)||!['threw','rejected'].includes(type))return;
    const value=Object.freeze({version:1,callback,type,sequence:this.callbackErrorSequence=Math.min(0xffffffff,this.callbackErrorSequence+1)});
    this.lastCallbackError=value;
    // No messages, identifiers or protocol payloads leave this optional hook.
    // Reporting failures must not recurse, hold a command, or become retries.
    try{Promise.resolve(this.onCallbackError(value)).catch(()=>{});}catch{}
  }
  dispatchConsumer(callback,...args){
    if(!Object.hasOwn(consumerCallbacks,callback))return false;
    const name=consumerCallbacks[callback],epoch=this.epoch;
    try{const result=this[name](...args);
      if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>this.recordCallbackError(callback,'rejected',epoch));
      return true;
    }catch{this.recordCallbackError(callback,'threw',epoch);return false;}
  }
  disconnected(confirmedId = null,reason='native-disconnect') {
    this.bluetoothUpdate?.recordStop?.(reason);
    if(confirmedId)this.connectionAttempts.delete(confirmedId);
    const hadConnection = this.id !== null;
    clearTimeout(this.controlTimer);this.controlTimer=null;this.controlRefreshOwner=null;
    this.epoch++; this.id = null; this.state = null; this.catalog = null; this.deviceIdentity=null;this.control=null;this.raw=null;
    this.firmwareReady=false;this.firmwareConnectionGuard=null;
    this.lastCallbackError=null;
    if (this.pending) { clearTimeout(this.pending.timer);clearTimeout(this.pending.probeTimer); this.pending.reject(new Error('Lamp disconnected.')); this.pending = null; }
    if (hadConnection) this.dispatchConsumer('disconnect');
  }
  receive(data) {
    if(this.pending?.readGuard){try{this.pending.readGuard();}catch(error){
      const pending=this.pending;this.pending=null;clearTimeout(pending.timer);clearTimeout(pending.probeTimer);pending.reject(error);return;
    }}
    let state;
    try { state = decodeState(data); } catch (error) {
      if (this.pending) { clearTimeout(this.pending.timer);clearTimeout(this.pending.probeTimer); this.pending.reject(error); this.pending = null; }
      return;
    }
    if(this.raw){
      for(const field of ['mode','brightness','power'])this.raw[field]=state[field];
      state={...this.raw,...state};
    }
    this.state = state;
    // Settle the exact device ACK before any screen observer. Consumer code
    // cannot lose or alter that receipt, even when native delivery is early.
    if (this.pending && state.id === this.pending.id) {
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);clearTimeout(pending.probeTimer);
      if (state.result) pending.reject(Object.assign(new Error(resultError(state.result)), {confirmed:true})); else pending.resolve({...state});
    }
    this.dispatchConsumer('state',state);
  }
  async retrieveSelectedDevice(device,epoch,guard=()=>{if(epoch!==this.epoch)throw Error('Connection changed.');},signal=null) {
    const matches=peripheral=>peripheral?.deviceId?.toLowerCase()===device.deviceId.toLowerCase();
    let peripheral=(await this.ble.getDevices([device.deviceId])).find(matches);
    guard();
    if(peripheral||!device.accessoryManaged)return peripheral;
    // Apple's authorized inventory can precede Core Bluetooth's peripheral cache.
    await new Promise(resolve=>setTimeout(resolve,250));
    guard();
    peripheral=(await this.ble.getDevices([device.deviceId])).find(matches);
    guard();
    if(!peripheral&&typeof this.ble.getConnectedDevices==='function')
      peripheral=(await this.ble.getConnectedDevices([SERVICE])).find(matches);
    guard();
    if(peripheral)return peripheral;
    if(typeof this.ble.requestLEScan!=='function'||typeof this.ble.stopLEScan!=='function')return null;
    // Outside enrollment, the lamp intentionally omits its service/name from
    // advertising. Scan without those filters, but accept ONLY the authorized UUID.
    let finish,timer;
    const found=new Promise(resolve=>{finish=resolve;});
    const cancelled=()=>finish(null);signal?.addEventListener('abort',cancelled,{once:true});
    try {
      guard();
      timer=setTimeout(()=>finish(null),8000);
      await this.ble.requestLEScan({allowDuplicates:false},result=>{
        try{guard();if(matches(result.device))finish(result.device);}catch{finish(null);}
      });
      guard();
      peripheral=await found;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancelled);await this.ble.stopLEScan();}
    guard();
    return peripheral;
  }
  async connect(savedDevice = null, retryInitialState = true, {signal=null,isCurrent=()=>true}={}) {
    const readOnlyReconnect=Boolean(savedDevice?.deviceId&&savedDevice?.readOnlyReconnect);
    const savedIdentity=savedDevice?.lampId||savedDevice?.id;
    const expectedReconnectIdentity=this.expectedDeviceIdentity||(/^[0-9a-f]{12}$/.test(savedIdentity||'')?savedIdentity:null);
    if(this.firmwareOnly&&(typeof savedDevice?.deviceId!=='string'||!savedDevice.deviceId||savedDevice.deviceId.length>128||
      /[\x00-\x1f\x7f]/.test(savedDevice.deviceId)||!expectedReconnectIdentity||savedDevice.newAuthorization||
      !/^[0-9a-f]{12}$/.test(expectedReconnectIdentity)||
      /^[0-9a-f]{12}$/.test(savedIdentity||'')&&savedIdentity!==expectedReconnectIdentity))
      throw Object.assign(Error('Use this lamp’s saved, authorized Bluetooth connection to update it.'),{confirmed:true});
    // disconnect() advances the generation before waiting for native cleanup.
    // Capture it now so cancellation during cleanup or authorization cannot
    // revive this attempt after another connection has taken ownership.
    const cleanup=this.disconnect(),epoch=this.epoch;
    const ownsConnection=()=>{try{return epoch===this.epoch&&!signal?.aborted&&isCurrent();}catch{return false;}};
    const current=()=>{if(!ownsConnection())throw Object.assign(Error('Connection changed or cancelled.'),{confirmed:true,cancelled:true});};
    await cleanup;current();
    // ASK authorization/migration must precede creation of CBCentralManager.
    const selected = !this.firmwareOnly&&this.selectDevice ? await this.selectDevice(savedDevice) : savedDevice;
    // Authorization is a durable event even if initialization/GATT later fails.
    if(selected&&!this.firmwareOnly)await this.onDeviceSelected(selected);
    current();
    // The iOS plugin recreates CBCentralManager on every initialize call but
    // keeps its peripheral cache. Keep one manager for this app session.
    if(!this.initialization)this.initialization=this.ble.initialize({ androidNeverForLocation: true }).catch(error=>{
      this.initialization=null;throw error;
    });
    await this.initialization;
    // The native radio was created even if the initiating selection changed.
    // Persist that fact before rejecting the old connection attempt.
    this.onRadioReady();
    current();
    const device = selected || await this.ble.requestDevice({ services: [SERVICE] });
    current();
    this.id = device.deviceId;
    try {
      if(selected && typeof this.ble.getDevices==='function') {
        const peripheral=await this.retrieveSelectedDevice(device,epoch,current,signal);
        if(!peripheral)throw new Error('The iPhone could not retrieve this authorized lamp. Keep its card, bring the lamp nearby, and retry connecting.');
        current();
        device.deviceId=peripheral.deviceId;this.id=device.deviceId;
        device.bluetoothName=peripheral.name||device.bluetoothName||'CoolLamp';
        if(device.accessoryManaged)device.accessoryName=device.name;
        // Apple's setup picker may still own the link for a fresh authorization.
        // Only clean up a connection this transport actually attempted itself.
        if(device.newAuthorization)this.connectionAttempts.delete(device.deviceId);
        if(this.connectionAttempts.has(device.deviceId)) {
          await this.ble.disconnect(device.deviceId);
          current();
          this.connectionAttempts.delete(device.deviceId);
        }
      } else device.bluetoothName=device.name||device.bluetoothName||'CoolLamp';
      current();
      this.connectionAttempts.add(device.deviceId);
      await this.ble.connect(this.id, () => { if (epoch === this.epoch) this.disconnected(device.deviceId); });
      current();
      // Protected read triggers the phone's pairing prompt before subscriptions or commands.
      const initial = await this.ble.read(this.id, SERVICE, STATE, { timeout: this.firmwareOnly||this.controlOnly||savedDevice?.automaticReconnect||readOnlyReconnect?this.timeout:60000 });
      current();
      try { decodeState(initial); } // Fail visibly on incompatible firmware.
      catch(error) { error.initialStateRead=true;throw error; }
      // Optional on older firmware. The short protected value matches Wi-Fi discovery.
      let protectedIdentity=null;
      try {
        const identity = await this.ble.read(this.id, SERVICE, '7b610006-6e2b-4f3d-9a71-28e45c001001',{timeout:this.timeout});
        current();
        const text = new TextDecoder().decode(new Uint8Array(identity.buffer, identity.byteOffset, identity.byteLength));
        if (/^[0-9a-f]{12}$/.test(text)) protectedIdentity=device.lampId=text;
      } catch { /* Firmware before network discovery has no identity characteristic. */ }
      current();
      if(this.expectedDeviceIdentity&&protectedIdentity!==this.expectedDeviceIdentity)throw Error(this.firmwareOnly?
        'Bluetooth identity did not match this lamp. No firmware was sent.':'Bluetooth identity did not match this coordinator. Pair the correct lamp first.');
      if(readOnlyReconnect&&expectedReconnectIdentity&&protectedIdentity!==expectedReconnectIdentity)throw Error('Bluetooth identity did not match this lamp. Connect to the correct lamp first.');
      if(this.firmwareOnly){
        // Short protected reads suffice for an explicit firmware lease. Never
        // turn it into general settings, group or provisioning ownership.
        current();
        if(protectedIdentity!==expectedReconnectIdentity)throw Error('Bluetooth identity did not match this lamp. No firmware was sent.');
        const binary=decodeState(initial);
        if(!(binary.capabilities&4))throw Error('This lamp needs updater firmware installed once using Wi-Fi or USB.');
        this.deviceIdentity=protectedIdentity;this.state=binary;this.sequence=binary.id;
        this.control=await this.readControlCapabilities(epoch,current);current();
        const value=await this.ble.read(this.id,SERVICE,FIRMWARE,{timeout:this.timeout});current();
        this.receiveFirmware(decodeFirmware(value));current();
        this.firmwareConnectionGuard=ownsConnection;this.firmwareReady=true;
        return device;
      }
      await this.ble.startNotifications(this.id, SERVICE, STATE, data => { if (epoch === this.epoch) this.receive(data); });
      if(epoch!==this.epoch)throw Error('Connection changed.');
      this.receive(initial);current();
      // Continue beyond the cached acknowledgment from the previous connection.
      // A readback must never mistake that reply for our first new command.
      this.sequence = this.state.id;
      if(this.controlOnly){
        if(!protectedIdentity)throw Error('Could not verify this lamp’s Bluetooth identity.');
        this.deviceIdentity=protectedIdentity;
        try{this.control=await this.readControlCapabilities(epoch,current);}
        // A timeout, malformed reply or authorization error is not evidence of
        // old firmware. This short path has not read a fresh firmware version.
        catch(error){current();throw error;}
        current();
        await this.refresh(this.expectedDeviceIdentity||this.deviceIdentity,true,current);current();return device;
      }
      if(readOnlyReconnect){
        // A saved lamp already negotiated its effects during setup. Its protected
        // control snapshots supply the current catalog without replaying setup.
        let capabilities;
        try{capabilities=await this.readControlCapabilities(epoch,current);}
        catch(error){
          current();
          if(epoch!==this.epoch||!/^Characteristic not found\.?$/i.test(error.message||''))throw error;
          // Firmware before 1.10 has no optional control characteristic.
        }
        current();
        if(capabilities){
          if(!protectedIdentity)throw Error('Could not verify this lamp’s Bluetooth control identity.');
          this.deviceIdentity=protectedIdentity;this.control=capabilities;
          await this.refresh(expectedReconnectIdentity||protectedIdentity,true,current);
          current();
          this.scheduleControlRefresh();return device;
        }
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
          if (epoch === this.epoch) { try { this.dispatchConsumer('options',decodeEffectOptions(data,this.state.effectCount)); } catch {} }
        });
        const options = await this.ble.read(this.id, SERVICE, EFFECT_OPTIONS);
        if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
        this.dispatchConsumer('options',decodeEffectOptions(options,this.state.effectCount));
      } else this.dispatchConsumer('options',null);
      current();
      if (this.state.capabilities & 4) {
        const firmware = await this.ble.read(this.id, SERVICE, FIRMWARE);
        if (epoch !== this.epoch) throw new Error('Lamp disconnected.');
        this.receiveFirmware(decodeFirmware(firmware));current();
        await this.ble.startNotifications(this.id, SERVICE, FIRMWARE, data => {
          if (epoch === this.epoch) { try { this.receiveFirmware(decodeFirmware(data)); } catch {} }
        });
        const latest = await this.ble.read(this.id, SERVICE, FIRMWARE);
        if (epoch === this.epoch) this.receiveFirmware(decodeFirmware(latest));
      } else this.dispatchConsumer('firmware',null);
      current();
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
      error.device=device;
      // A cancelled attempt must not disconnect a later connection that owns
      // this transport while an old native read or subscription is completing.
      if(epoch!==this.epoch)throw error;
      const canRetry=ownsConnection();
      await this.disconnect();
      if(canRetry&&retryInitialState&&device.accessoryManaged&&error.initialStateRead&&error.code==='INVALID_STATE_PACKET') {
        // Service Changed may invalidate iOS's old handles during the first
        // encrypted read after an update. No commands have been sent yet.
        const retryEpoch=this.epoch;
        await new Promise(resolve=>setTimeout(resolve,250));
        if(retryEpoch!==this.epoch||signal?.aborted||!isCurrent())throw error;
        return this.connect({...device,newAuthorization:false,
          ...(savedDevice?.automaticReconnect?{automaticReconnect:true}:{}),
          ...(readOnlyReconnect?{readOnlyReconnect:true}: {})},false,{signal,isCurrent});
      }
      throw error;
    }
  }
  async disconnect(reason='transport-disconnect') {
    if(this.bluetoothUpdate)throw Object.assign(Error('Finish or cancel the Bluetooth firmware transfer before changing its connection.'),{confirmed:true,firmwareBusy:true});
    const id = this.id;
    this.disconnected(null,reason);
    if (id) { try { await this.ble.disconnect(id);this.connectionAttempts.delete(id); } catch {} }
  }
  command(operation, value = 0, responseCharacteristic = null, beforeWrite = null, readGuard = null) {
    if(this.firmwareOnly)return Promise.reject(Object.assign(Error('This Bluetooth connection is reserved for firmware updates.'),{confirmed:true,firmwareOnly:true}));
    if(this.bluetoothUpdate)return Promise.reject(Error('Finish or cancel the Bluetooth firmware transfer before changing this lamp.'));
    const fence=()=>{try{beforeWrite?.();}catch(error){throw Object.assign(error instanceof Error?error:new Error('Connection changed.'),{confirmed:true,cancelled:true});}};
    const readFence=()=>{try{readGuard?.();}catch(error){throw Object.assign(error instanceof Error?error:new Error('Background read stopped.'),{readAdmission:true,cancelled:true});}};
    if(operation==='effect'&&this.catalog?.some(entry=>entry.id===value&&entry.available===false))return Promise.reject(Object.assign(Error('This effect is not available on the selected lamp.'),{confirmed:true}));
    if(operation==='effect'&&this.supportsOfflineControl&&this.raw?.sync?.role===1&&this.raw.sync.scene){
      try{fence();}catch(error){return Promise.reject(error);}
      return this.configureGroupScene({scene:0}).then(()=>this.command(operation,value,responseCharacteristic,beforeWrite,readGuard));
    }
    const epoch = this.epoch;
    const run = async () => {
      readFence();
      if(this.bluetoothUpdate)throw Object.assign(Error('Bluetooth firmware transfer owns this connection.'),{confirmed:true});
      if (!this.id || epoch !== this.epoch) throw new Error('Connect to your lamp first.');
      if(operation.startsWith('control')&&!this.supportsOfflineControl)throw Error('Update this lamp to firmware 1.10.0 or newer for full Bluetooth settings.');
      if(this.raw?.sync?.active&&['brightness','effect','saveDefaults','color','resetColor','effectOptions'].includes(operation))throw Error('Edit the coordinator or pause this lamp’s group first.');
      if(operation.startsWith('wifi')&&!(this.state?.capabilities&WIFI_SETUP_CAPABILITY))throw Error('Update this lamp to firmware 1.9.0 or newer for Bluetooth Wi-Fi setup.');
      if(operation==='factoryReset'&&!(this.state?.capabilities&128))throw Error('Update this lamp to firmware 1.9.1 or newer for factory reset.');
      if(operation.startsWith('center')&&!(this.state?.capabilities&128))throw Error('Update this lamp to firmware 1.9.1 or newer to fine-tune its center.');
      if (['color','resetColor'].includes(operation) && !this.state?.supportsColor) throw new Error('Update the lamp firmware to use custom colors.');
      if (['effectOptions','enableEffects'].includes(operation) && !(this.state?.capabilities & 8)) throw new Error('Update the lamp firmware to use effect controls.');
      if (operation === 'effect' && value > this.state?.effectCount) throw new Error('Update the lamp firmware to use this effect.');
      const effect=operation==='effect'||operation==='resetColor'?value:['color','effectOptions'].includes(operation)?value?.mode:null;
      if(effect!==null&&this.catalog&&!effectAvailable(this.catalog,effect))throw Object.assign(Error('This effect is not available on the selected lamp.'),{confirmed:true});
      if(operation==='saveDefaults'&&this.catalog?.some(entry=>entry.id===this.state.mode&&entry.startupSupported===false))throw Object.assign(Error('Choose a different effect for the lamp’s startup light.'),{confirmed:true});
      if (['checkFirmware','installFirmware','autoUpdate'].includes(operation) && !(this.state?.capabilities & 4)) throw new Error('Install the updater firmware using the lamp’s Wi-Fi page first.');
      const id = this.sequence = this.sequence % 255 + 1;
      const frame = encodeCommand(id, operation, value, this.state.effectCount);
      readFence();
      fence();
      // Install the listener BEFORE writing: notifications may precede the write response.
      let settle,nativeAttempted=false;
      const response = new Promise((resolve, reject) => {
        this.pending = settle = { id, resolve, reject, timer:null, probeTimer:null,readGuard:readGuard?readFence:null };
      });
      try {
        const deviceId = this.id;
        nativeAttempted=true;
        const write = this.ble.write(deviceId, SERVICE, COMMAND, frame).then(() => {
          readFence();
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
            try{readFence();}catch(error){settle.reject(error);return;}
            try {
              const data=await this.ble.read(deviceId,SERVICE,STATE,{timeout:this.timeout/2});
              try{readFence();}catch(error){settle.reject(error);return;}
              if(this.pending===settle&&epoch===this.epoch&&decodeState(data).id===id)this.receive(data);
            } catch { /* The original deadline still bounds an unconfirmed write. */ }
          },operation.startsWith('control')||operation.startsWith('center')?Math.min(200,this.timeout/2):this.timeout/2);
        });
        const [, state] = await Promise.all([write, response]);
        readFence();
        if(epoch!==this.epoch||deviceId!==this.id)throw Object.assign(Error('Connection changed after the lamp acknowledged the command.'),{confirmed:true,cancelled:true});
        if(responseCharacteristic) {
          readFence();
          const data=await this.ble.read(this.id,SERVICE,responseCharacteristic);
          readFence();
          if(epoch!==this.epoch)throw Error('Connection changed.');
          return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)));
        }
        return state;
      } catch (error) {
        if(error.readAdmission){error.confirmed=!nativeAttempted;error.uncertain=nativeAttempted;}
        // An uncertain command must not be replayed after reconnect or ID wraparound.
        if (!error.confirmed&&!error.readAdmission&&epoch===this.epoch) await this.disconnect(); throw error;
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
  get supportsWifiSetup() { return Boolean(!this.firmwareOnly&&this.id&&this.state?.capabilities&WIFI_SETUP_CAPABILITY); }
  async readControlCapabilities(epoch,guard=()=>{if(epoch!==this.epoch)throw Error('Connection changed.');}) {
    guard();
    const first=await this.ble.read(this.id,SERVICE,CONTROL,{timeout:this.timeout});guard();
    if(epoch!==this.epoch)throw Error('Connection changed.');
    try{return decodeControlCapabilities(first);}catch(error){
      // The loop restores metadata after a connection generation transition.
      // Retry this protected read once only; never repeat a mutation.
      if(!(first instanceof DataView)||first.byteLength<12||first.getUint8(0)!==1||first.getUint16(4,true)!==403)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));guard();
      const next=await this.ble.read(this.id,SERVICE,CONTROL,{timeout:this.timeout});guard();
      return decodeControlCapabilities(next);
    }
  }
  receiveFirmware(next) {
    if(this.raw)this.raw.firmware=next;if(this.state)this.state.firmware=next;this.dispatchConsumer('firmware',next);
  }
  async refreshFirmware(readGuard=null) {
    const guard=()=>{try{readGuard?.();}catch(error){throw Object.assign(error instanceof Error?error:new Error('Firmware status read stopped.'),{confirmed:true,cancelled:true,readAdmission:true});}};
    guard();
    if(!this.id||!(this.state?.capabilities&4))throw Error('Firmware status is unavailable over Bluetooth.');
    if(this.firmwareOnly&&!this.firmwareConnectionGuard?.())throw Object.assign(Error('Firmware connection changed or cancelled.'),{confirmed:true,cancelled:true});
    const epoch=this.epoch,id=this.id;
    const value=await this.ble.read(id,SERVICE,FIRMWARE,{timeout:this.timeout});
    guard();
    if(epoch!==this.epoch||id!==this.id)throw Error('Connection changed.');
    if(this.firmwareOnly&&!this.firmwareConnectionGuard?.())throw Object.assign(Error('Firmware connection changed or cancelled.'),{confirmed:true,cancelled:true});
    const status=decodeFirmware(value);guard();this.receiveFirmware(status);guard();
    if(epoch!==this.epoch||id!==this.id)throw Error('Connection changed.');return status;
  }
  async readFirmwareUpdateSnapshot({signal,isCurrent=()=>true,expectedSession=null}={}) {
    if(this.bluetoothUpdate)throw Object.assign(Error('The active firmware sender owns its receiver status.'),{confirmed:true,firmwareBusy:true});
    if(!this.supportsBluetoothFirmware||!/^[0-9a-f]{12}$/.test(this.deviceIdentity||''))throw Error('Connect to the intended lamp over protected Bluetooth first.');
    if(expectedSession!==null&&(!Number.isInteger(expectedSession)||expectedSession<1||expectedSession>0xffffffff))throw Error('Invalid expected firmware receiver session.');
    const epoch=this.epoch,id=this.id,target=this.deviceIdentity,ownerGuard=this.firmwareOnly?this.firmwareConnectionGuard:null;
    const guard=()=>{let owned=false;try{owned=isCurrent()&&(!ownerGuard||ownerGuard());}catch{}
      if(!owned||signal?.aborted||epoch!==this.epoch||id!==this.id||target!==this.deviceIdentity)
        throw Object.assign(Error('Firmware snapshot connection changed or cancelled.'),{cancelled:true,confirmed:true});};
    const read=async characteristic=>{guard();const data=await this.ble.read(id,SERVICE,characteristic,{timeout:this.timeout});guard();return data;};
    const canonical=new TextDecoder('utf-8',{fatal:true}).decode(await read('7b610006-6e2b-4f3d-9a71-28e45c001001'));
    if(canonical!==target)throw Object.assign(Error('Bluetooth identity did not match this lamp.'),{identity:true,confirmed:true});
    const firmware=decodeFirmware(await read(FIRMWARE)),state=decodeState(await read(STATE)),receiverBytes=await read(OTA_STATUS);
    const receiver={...decodeBleUpdate(receiverBytes),resumeSupported:Boolean(receiverBytes.getUint8(3)&4),detached:Boolean(receiverBytes.getUint8(3)&8)};
    if(receiver.size>2031616||receiver.offset>receiver.size||receiver.maxData<1||receiver.maxData>232||receiver.committed&&receiver.phase!==4||
      receiver.phase===4&&(!receiver.committed||receiver.size===0||receiver.offset!==receiver.size))
      throw Error('Invalid Bluetooth firmware receiver snapshot.');
    if(expectedSession!==null&&receiver.session!==expectedSession)throw Object.assign(Error('Firmware receiver session changed. Reconcile the original update before retrying.'),{uncertain:true,sessionChanged:true});
    guard();const observedAt=Date.now();return Object.freeze({identity:canonical,observedAt,firmware:Object.freeze(firmware),state:Object.freeze(state),receiver:Object.freeze(receiver)});
  }
  async updateOverBluetooth(packageValue,onProgress=()=>{},{signal,isCurrent=()=>true,enableResume=false,resumeLease=null,onLease=()=>{},onBeforeWrite=null}={}) {
    if(this.bluetoothUpdate)throw Object.assign(Error('Another Bluetooth update owns this connection.'),{confirmed:true,firmwareBusy:true});
    if(!this.id||!this.deviceIdentity||!this.supportsBluetoothFirmware)throw Object.assign(Error('Connect to the intended lamp over Bluetooth first.'),{installationNotStarted:true,metadataIssued:false,uncertain:false});
    const epoch=this.epoch,id=this.id,identity=this.deviceIdentity;
    const ownerGuard=this.firmwareOnly?this.firmwareConnectionGuard:null;
    const ownsUpdate=()=>{try{return isCurrent()&&(!ownerGuard||ownerGuard());}catch{return false;}};
    if(resumeLease&&resumeLease.identity!==identity)throw Error('The original firmware lease belongs to a different verified lamp.');
    const transfer=new BluetoothFirmwareTransfer({ble:this.ble,deviceId:id,isCurrent:()=>this.epoch===epoch&&this.id===id&&this.deviceIdentity===identity&&ownsUpdate(),onProgress,allowBulkWrites:this.firmwareBulkWrites});
    // Close all normal command lanes before taking ownership of the radio.
    clearTimeout(this.controlTimer);this.controlTimer=null;this.controlRefreshOwner=null;
    await Promise.all([this.actionTail,this.controlTail,this.tail]);
    if(signal?.aborted)throw Error('Bluetooth update cancelled. No firmware was sent.');
    if(this.bluetoothUpdate||epoch!==this.epoch||id!==this.id||!ownsUpdate())throw Error('The Bluetooth connection changed.');
    this.bluetoothUpdate=transfer;
    const cancel=()=>void transfer.cancel(typeof signal?.reason==='string'?signal.reason:'cancelled');signal?.addEventListener('abort',cancel,{once:true});
    try{
    transfer.current();
    // Verify protected device identity again after the phone download.
    const value=await this.ble.read(id,SERVICE,'7b610006-6e2b-4f3d-9a71-28e45c001001',{timeout:this.timeout});
    const actual=new TextDecoder().decode(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
    if(epoch!==this.epoch||id!==this.id||actual!==identity)throw Object.assign(Error('The Bluetooth lamp changed. No firmware was sent.'),{identity:actual!==identity});
    const result=await transfer.send(packageValue,{enableResume,resumeLease,onBeforeWrite});
    return {...result,transferDiagnostic:result.transferDiagnostic??transfer.transferDiagnostic()};}
    catch(failure){
      if(!transfer.firstStop)transfer.recordStop(transfer.isCurrent()?'native-read-failure':'connection-changed');
      if(!failure.updateDiagnostic)transfer.describeFailure(failure);
      const lease=transfer.getResumeLease();
      if(lease){const bounded=Object.freeze({...lease,identity});failure.firmwareResumeLease=bounded;try{onLease(bounded);}catch{}}
      throw failure;
    }
    finally{signal?.removeEventListener('abort',cancel);if(this.bluetoothUpdate===transfer)this.bluetoothUpdate=null;if(this.id&&this.epoch===epoch)this.scheduleControlRefresh();}
  }
  get supportsBluetoothFirmware() { return Boolean(this.id&&this.deviceIdentity&&this.control?.capabilities.includes('control')&&
    (!this.firmwareOnly||this.firmwareReady&&this.firmwareConnectionGuard?.())); }
  get supportsOfflineControl() { return Boolean(!this.firmwareOnly&&this.id&&this.control?.capabilities.includes('control')); }
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
  request(path,data,epoch=this.epoch,beforeWrite=null,readGuard=null) {
    if(this.firmwareOnly)return Promise.reject(Object.assign(Error('This Bluetooth connection is reserved for firmware updates.'),{confirmed:true,firmwareOnly:true}));
    const endpoint=controlPaths[path];
    if(!endpoint)return Promise.reject(Error('This setting is unavailable over Bluetooth.'));
    const method=data===undefined?1:2;
    if(path==='/api/state/current'){
      if(data!==undefined||!this.control?.capabilities.includes('current-state-v1'))return Promise.reject(Error('This lamp has not confirmed current settings reads.'));
      data={view:'current'};
    }
    if(path==='/api/bluetooth/forget')data={...data,action:'forget'};
    return this.controlRequest(endpoint,method,data,()=>{if(this.epoch!==epoch)throw Error('Bluetooth control connection changed.');beforeWrite?.();},readGuard);
  }
  controlRequest(endpoint,method,data,beforeWrite=null,readGuard=null) {
    if(this.firmwareOnly)return Promise.reject(Object.assign(Error('This Bluetooth connection is reserved for firmware updates.'),{confirmed:true,firmwareOnly:true}));
    const body=new TextEncoder().encode(data===undefined?'':new URLSearchParams(data).toString());
    if(body.length>1024){body.fill(0);return Promise.reject(Error('Bluetooth settings exceed the supported size.'));}
    readGuard??=method===1?beforeWrite:null;
    return this.controlJob(async epoch=>{
      const deviceId=this.id,identity=this.deviceIdentity,tx=this.controlSequence=this.controlSequence%65535+1;
      const settingsAttempt=this.settingsConnectionProofToken;
      let mutationMayHaveExecuted=false;
      const guard=()=>{
        if(epoch!==this.epoch||this.id!==deviceId||this.deviceIdentity!==identity)throw Error('Bluetooth control connection changed.');
        try{readGuard?.();}catch(error){throw Object.assign(error instanceof Error?error:new Error('Background read stopped.'),
          {readAdmission:true,cancelled:true,confirmed:!mutationMayHaveExecuted,uncertain:mutationMayHaveExecuted});}
      };
      let responseBytes,requestFailed=false;
      try{
        guard();
        beforeWrite?.();
        await this.command('controlBegin',{tx,endpoint,method,length:body.length},null,null,guard);guard();
        for(let offset=0;offset<body.length;offset+=13){
          guard();await this.command('controlChunk',{tx,offset,bytes:body.slice(offset,offset+13)},null,null,guard);guard();
        }
        // A consumed commit is never resent. The existing command path only
        // reads a matching cached acknowledgment if its notification is lost.
        guard();beforeWrite?.();await this.command('controlCommit',{tx},null,()=>{beforeWrite?.();mutationMayHaveExecuted=method===2;},guard);guard();
        let offset=0,status,total;
        do{
          // Control v1 caches page zero before acknowledging Commit (including
          // error replies). Select only subsequent pages; never repeat Commit.
          guard();if(offset){await this.command('controlPage',{tx,offset},null,null,guard);guard();}
          guard();
          const data=await this.ble.read(deviceId,SERVICE,CONTROL);guard();
          const page=decodeControlPage(data,{tx,endpoint,offset,...(total===undefined?{}:{total,status})});
          if(total===undefined){total=page.total;status=page.status;responseBytes=new Uint8Array(total);}
          if(!page.length&&offset<total)throw Error('Bluetooth control response stopped before completion.');
          responseBytes.set(page.bytes,offset);offset+=page.length;
        }while(offset<total);
        const text=new TextDecoder('utf-8',{fatal:true}).decode(responseBytes);
        guard();
        if(status<200||status>=300){
          const failure=Object.assign(new Error(text||'Lamp rejected Bluetooth settings.'),{confirmed:true,status});
          // Local evidence, never decoded from response text. The identity came
          // from the protected characteristic and the existing guard has just
          // fenced every page against this connection generation and target.
          if(method===1&&endpoint===1&&settingsAttempt&&this.settingsConnectionProofToken===settingsAttempt&&
            /^[0-9a-f]{12}$/.test(identity||'')&&this.expectedDeviceIdentity===identity)
            Object.defineProperty(failure,'verifiedSettingsRead',{value:Object.freeze({target:identity,endpoint,method,epoch,attempt:settingsAttempt})});
          throw failure;
        }
        return text;
      }catch(error){
        requestFailed=true;
        if(error.readAdmission){error.uncertain=mutationMayHaveExecuted;error.confirmed=!mutationMayHaveExecuted;}
        throw error;
      }finally{
        body.fill(0);responseBytes?.fill(0);
        if(epoch===this.epoch&&this.id===deviceId){
          try{guard();await this.command('controlBegin',{tx,endpoint:0,method:0,length:0},null,null,guard);guard();}
          catch(error){if(error.readAdmission&&!requestFailed){error.uncertain=mutationMayHaveExecuted;error.confirmed=!mutationMayHaveExecuted;throw error;} /* Preserve the original failure; never replay it. */ }
        }
      }
    });
  }
  async refresh(expectedId=this.deviceIdentity,retryCatalog=true,readGuard=null) {
    if(!this.supportsOfflineControl)throw Error('Update this lamp to firmware 1.10.0 or newer for full Bluetooth settings.');
    const epoch=this.epoch,guard=()=>{if(epoch!==this.epoch)throw Error('Connection changed.');readGuard?.();};
    const path=this.control?.capabilities.includes('current-state-v1')?'/api/state/current':'/api/state';
    guard();const text=await this.request(path,undefined,epoch,null,guard);guard();
    let raw;try{raw=JSON.parse(text);}catch{throw Error('Invalid Bluetooth settings snapshot.');}
    if(raw?.deviceId!==expectedId||raw.deviceId!==this.deviceIdentity||!Array.isArray(raw.effects)||path==='/api/state/current'&&!validCurrentStateView(raw))throw Error('Invalid Bluetooth settings snapshot.');
    let catalog=this.catalog;
    if(!catalog||catalog.length!==raw.effects.length){
      guard();const entries=JSON.parse(await this.request('/api/effects',undefined,epoch,null,guard));guard();
      if(Array.isArray(entries)&&entries.length!==raw.effects.length&&retryCatalog)return this.refresh(expectedId,false,readGuard);
      catalog=validateCatalog(entries,raw.effects.length);
    }
    if(
      !Number.isInteger(raw.mode)||!catalog?.some(effect=>effect.id===raw.mode)||
      !Number.isInteger(raw.brightness)||raw.brightness<1||raw.brightness>255||typeof raw.power!=='boolean'||
      !Number.isInteger(raw.leds)||raw.leds<1||raw.leds>1024)throw Error('Invalid Bluetooth settings snapshot.');
    const snapshot={};
    for(const field of ['deviceId','hostname','name','ssid','leds','milliamps','midpoint','startupMode','startupBrightness',
      'mode','brightness','power','apiVersion','catalogVersion','colors','effectOptions','vuColors','fountainColors',
      'audio','rotation','calibration','firmware','sync','factoryReset','usingDefaultPassword','effectiveMidpoint','motionPath','motionVersion'])
      if(raw[field]!==undefined)snapshot[field]=raw[field];
    if(snapshot.sync)snapshot.sync=publicControlSync(snapshot.sync);
    const design=raw.lampStyle&&typeof raw.lampStyle==='object'&&!Array.isArray(raw.lampStyle)?normalizeLampStyle(raw.lampStyle):null;if(design)snapshot.lampStyle=design;
    guard();this.catalog=catalog;this.raw=snapshot;
    const color=raw.colors?.[raw.mode-1],binary=this.state;
    this.state={...snapshot,id:binary.id,result:binary.result,revision:binary.revision,capabilities:binary.capabilities,
      mode:raw.mode,brightness:raw.brightness,power:raw.power,
      effectCount:this.catalog.length,supportsColor:binary.supportsColor,color:color?{enabled:Boolean(color[0]),r:color[1],g:color[2],b:color[3]}:binary.color};
    guard();this.dispatchConsumer('state',this.state,{freshControl:true});guard();if(raw.firmware)this.receiveFirmware(raw.firmware);
    const options=raw.effectOptions?.[raw.mode-1];
    guard();if(options)this.dispatchConsumer('options',{mode:raw.mode,speed:options[0],intensity:options[1],dual:options[2],r:options[3],g:options[4],b:options[5]});guard();
    return snapshot;
  }
  async refreshLight(expectedId=this.deviceIdentity,readGuard=null) {
    // Protected characteristic reads work on existing firmware too. They do
    // not allocate/paginate the complete settings tree or download a catalog.
    // Full settings still require refresh() on connect and after settings saves.
    const epoch=this.epoch,id=this.id;
    const guard=()=>{if(epoch!==this.epoch||id!==this.id||expectedId!==this.deviceIdentity||!this.raw||!this.catalog)
      throw Error('Connection changed.');readGuard?.();};
    guard();const bytes=await this.ble.read(id,SERVICE,STATE,{timeout:this.timeout});guard();
    const light=decodeState(bytes);
    if(light.result||light.effectCount!==this.catalog.length||!this.catalog.some(item=>item.id===light.mode))
      throw Error('Lamp state changed. Reconnect to read its settings.');
    let options=null;
    if(light.capabilities&8){
      const data=await this.ble.read(id,SERVICE,EFFECT_OPTIONS,{timeout:this.timeout});guard();
      options=decodeEffectOptions(data,light.effectCount);
      if(options.mode!==light.mode)throw Object.assign(Error('The effect changed while reading its controls.'),{confirmed:true,conflict:true});
    }
    guard();
    for(const field of ['mode','brightness','power'])this.raw[field]=light[field];
    if(light.color&&Array.isArray(this.raw.colors))this.raw.colors[light.mode-1]=[Number(light.color.enabled),light.color.r,light.color.g,light.color.b];
    if(options&&Array.isArray(this.raw.effectOptions))this.raw.effectOptions[light.mode-1]=[options.speed,options.intensity,options.dual,options.r,options.g,options.b];
    this.state={...this.raw,...light};
    // This proves light values only; never renew group/hardware freshness.
    this.dispatchConsumer('state',this.state,{freshLight:true});guard();
    if(options)this.dispatchConsumer('options',options);guard();return this.state;
  }
  scheduleControlRefresh() {
    if(this.firmwareOnly)return;
    clearTimeout(this.controlTimer);const epoch=this.epoch,owner={};this.controlRefreshOwner=owner;
    let generation;try{generation=this.backgroundGeneration();}catch{}
    const readGuard=()=>{let admitted=false;
      try{admitted=this.backgroundAllowed()&&generation!==undefined&&generation===this.backgroundGeneration();}catch{}
      if(!admitted||this.controlRefreshOwner!==owner||epoch!==this.epoch)
        throw Object.assign(Error('Automatic Bluetooth reads are paused.'),{confirmed:true,cancelled:true,readAdmission:true,backgroundPaused:true});
    };
    const rearm=()=>{if(this.controlRefreshOwner===owner&&epoch===this.epoch&&this.supportsOfflineControl&&!this.bluetoothUpdate)this.scheduleControlRefresh();};
    this.controlTimer=setTimeout(async()=>{
      if(this.controlRefreshOwner!==owner||epoch!==this.epoch||!this.supportsOfflineControl||this.bluetoothUpdate)return;
      try{readGuard();}catch{rearm();return;}
      try{
        if(![1,3,4].includes(this.raw?.firmware?.phase))await this.enqueue(async()=>{readGuard();
          if(this.raw?.calibration?.active&&this.raw.calibration.kind==='center')await this.calibrateCenter('status',undefined,readGuard);
          else await this.refreshLight(this.deviceIdentity,readGuard);
        });
      }catch{ /* Radio loss/legacy control handles connection state independently. */ }
      rearm();
    },2500);
  }
  factoryReset() { return this.command('factoryReset',0xa5); }
  async calibrateCenter(action,position,readGuard=null) {
    const actions={start:0,save:1,cancel:2,status:3};
    if(!Object.hasOwn(actions,action)&&action!=='move')throw Error('Choose a valid center action.');
    const epoch=this.epoch,id=this.id,identity=this.deviceIdentity,control=this.control,modern=this.supportsOfflineControl;
    const guard=()=>{
      if(!id||this.id!==id||this.epoch!==epoch||this.deviceIdentity!==identity||
        modern&&(!/^[0-9a-f]{12}$/.test(identity||'')||this.control!==control||this.raw?.deviceId!==identity)||
        this.expectedDeviceIdentity&&identity!==this.expectedDeviceIdentity)
        throw Error('Center adjustment connection changed.');
      readGuard?.();
    };
    const valid=value=>{
      if(value?.version!==1||typeof value.active!=='boolean'||!Number.isInteger(value.leds)||value.leds<1||value.leds>1024||value.active&&value.leds<2||
        !Number.isInteger(value.midpoint)||value.midpoint<0||value.midpoint>=value.leds||
        !Number.isInteger(value.position)||value.position<1||value.position>Math.max(1,value.leds-1))throw Error('Invalid center adjustment status.');
      if(modern&&value.leds!==this.raw.leds)throw Error('The lamp’s LED count changed during center adjustment.');
      return value;
    };
    let saveAttempted=false;
    const send=async(operation,value,save=false)=>{
      guard();
      const result=await this.command(operation,value,'7b610009-6e2b-4f3d-9a71-28e45c001001',()=>{
        guard();if(save)saveAttempted=true;
      },guard);
      guard();return valid(result);
    };
    try {
      let value;
      if(action==='save') {
        // The protected status command copies a fresh marker position without
        // touching its inactivity timer. Never save from an old settings tree.
        const current=await send('centerControl',actions.status);
        if(!current.active)throw Object.assign(Error('The center adjustment has ended. Start it again to choose a new center.'),{confirmed:true});
        value=await send('centerControl',actions.save,true);
        if(value.active||value.leds!==current.leds||value.midpoint!==current.position||value.position!==current.position)
          throw Error('The lamp did not confirm this center.');
      } else value=await send(action==='move'?'centerMove':'centerControl',action==='move'?position:actions[action]);
      guard();
      if(modern) {
        this.raw.midpoint=value.midpoint;
        this.raw.effectiveMidpoint=value.midpoint||Math.ceil(value.leds/2);
        this.raw.calibration={...this.raw.calibration,active:value.active,kind:value.active?'center':'leds',position:value.position};
        this.state={...this.state,midpoint:this.raw.midpoint,effectiveMidpoint:this.raw.effectiveMidpoint,calibration:this.raw.calibration};
        // This updates only verified center fields. It does not renew complete
        // settings/group freshness, retrieve catalogs or allocate large replies.
        this.dispatchConsumer('state',this.state,{freshCenter:true});guard();
      }
      return value;
    } catch(error) {
      if(saveAttempted)throw Object.assign(error,{uncertain:true,confirmed:false,
        message:'We could not confirm your new center. The lamp needs to check its settings before you try again.'});
      throw error;
    }
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
 'calibrateLeds','configureRotation','configureGeometry','configureMotionPath','setAudioReactionEnabled','configureFountainColors','configureVuColors','tuneAudio','configureAudio','configureLampStyle'])
  LampTransport.prototype[method]=WifiTransport.prototype[method];
