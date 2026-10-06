import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampPairing,rememberAccessories,pairingError,pairingLabel,pairingInstructions} from '../src/pairing.js';
import {LampStore} from '../src/lamps.js';
import {LampTransport} from '../src/transport.js';
import {STATE} from '../src/protocol.js';
const a={id:'lamp-a',deviceId:'AAAAAAAA-0000-0000-0000-000000000001',name:'Living room'};
const b={id:'lamp-b',deviceId:'BBBBBBBB-0000-0000-0000-000000000002',name:'Bedroom'};
class Accessories {
  events=[];devices=[];supported=true;cancel=false;
  async list(){this.events.push('list');return {supported:this.supported,devices:this.devices};}
  async migrate({devices}) {
    this.events.push('migrate');this.migrated=devices;
    if(this.cancel)throw Error('Migration cancelled');
    this.devices.push(...devices.map(d=>({...d,accessoryManaged:true})));
  }
  async select(){this.events.push('select');return {...a,name:'New helix',accessoryManaged:true};}
  async remove({deviceId}){
    this.events.push('remove:'+deviceId);
    if(this.cancel)throw Error('Removal cancelled');
    const found=this.devices.some(d=>d.deviceId===deviceId);
    this.devices=this.devices.filter(d=>d.deviceId!==deviceId);return {removed:found};
  }
}
class Radio {
  constructor(events){this.events=events;}
  packet(id=0){return new DataView(Uint8Array.of(1,id,0,4,100,1,28,0,0,0,0,0).buffer);}
  async initialize(){this.events.push('initialize');}
  async getDevices(ids){this.events.push('retrieve');return ids.map(deviceId=>({deviceId,name:'CoolLamp-E2EA24'}));}
  async requestDevice(){this.events.push('legacy-picker');return {deviceId:a.deviceId,name:'CoolLamp'};}
  async connect(id,disconnect){this.events.push('connect');this.onDisconnect=disconnect;}
  async disconnect(){this.onDisconnect?.();}
  async read(id,service,char){if(char===STATE)return this.packet();throw Error('Unavailable');}
  async startNotifications(id,service,char,fn){this.listener=fn;}
  async write(id,service,char,frame){this.listener(this.packet(frame.getUint8(1)));}
}
test('migrates every saved iPhone lamp before BLE initialization, then retrieves only the selected UUID',async()=>{
  const native=new Accessories(),pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[a,b]});
  const radio=new Radio(native.events);
  const lamp=new LampTransport(radio,{selectDevice:d=>pairing.select(d),onRadioReady:()=>{pairing.radioStarted=true;}});
  const device=await lamp.connect(a);
  assert.deepEqual(native.migrated,[{deviceId:a.deviceId,name:a.name},{deviceId:b.deviceId,name:b.name}]);
  assert.deepEqual(native.events,['list','migrate','list','initialize','retrieve','connect']);
  assert.equal(device.bluetoothName,'CoolLamp-E2EA24');assert.equal(device.accessoryName,'Living room');
  assert.equal(device.accessoryManaged,true);assert.equal(pairing.radioStarted,true);
  await lamp.disconnect();
});
test('new iPhone setup selects via Apple before initializing BLE; reconnect does not show a picker',async()=>{
  const native=new Accessories(),pairing=new LampPairing({platform:'ios',native});
  const radio=new Radio(native.events),lamp=new LampTransport(radio,{selectDevice:d=>pairing.select(d)});
  await lamp.connect();assert.deepEqual(native.events,['list','select','initialize','retrieve','connect']);
  native.devices=[a];native.events=[];await lamp.disconnect();await pairing.select(a);
  assert.deepEqual(native.events,['list']);await lamp.disconnect();
});
test('cancelled/partial migration never initializes the BLE radio and remains retryable',async()=>{
  const native=new Accessories();native.cancel=true;
  const pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[a,b]});
  const lamp=new LampTransport(new Radio(native.events),{selectDevice:d=>pairing.select(d)});
  await assert.rejects(lamp.connect(a),/cancelled/);assert(!native.events.includes('initialize'));
  native.cancel=false;native.migrate=async()=>{native.devices=[a];};
  await assert.rejects(lamp.connect(a),/Authorize all saved lamps/);assert(!native.events.includes('initialize'));
  native.devices=[a,b];await lamp.connect(a);await lamp.disconnect();
});
test('only removes the selected OS accessory, preserving other pairings; cancellation propagates',async()=>{
  const native=new Accessories();native.devices=[a,b];
  const pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[a,b]});
  assert.deepEqual(await pairing.remove(a),{removed:true,manual:false});assert.deepEqual(native.devices,[b]);
  native.cancel=true;await assert.rejects(pairing.remove(b),/cancelled/);assert.deepEqual(native.devices,[b]);
});
test('offline/legacy removal migrates first; refused migration never attempts unpairing',async()=>{
  const native=new Accessories(),pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[a]});
  assert.deepEqual(await pairing.remove(a),{removed:true,manual:false});
  assert.deepEqual(native.events,['list','migrate','list','remove:'+a.deviceId]);
  native.cancel=true;await assert.rejects(pairing.remove(a),/cancelled/);
  assert.equal(native.events.filter(x=>x.startsWith('remove:')).length,1);
});
test('never migrates after a BLE manager starts, and never substitutes another managed lamp',async()=>{
  const native=new Accessories();native.devices=[b];
  const pairing=new LampPairing({platform:'ios',native});pairing.radioStarted=true;
  await assert.rejects(pairing.select(a),/Close and reopen/);assert(!native.events.includes('migrate'));
  await assert.rejects(pairing.select({...a,accessoryManaged:true}),/no longer authorized/);
  assert(!native.events.includes('select'));
});
test('Android/web/older iOS keep their existing picker and show a truthful manual-unpair fallback',async()=>{
  for(const platform of ['android','web','ios']) {
    const native=new Accessories();native.supported=false;
    const pairing=new LampPairing({platform,native});
    assert.equal(await pairing.select(a),a);assert.equal(await pairing.select(),undefined);
    assert.deepEqual(await pairing.remove(a),{removed:false,manual:true});
    assert.deepEqual(await pairing.remove({id:'wifi-only'}),{removed:false,manual:false});
    if(platform!=='ios')assert.deepEqual(native.events,[]);
  }
});
test('a stale OS bond has named recovery steps, while ordinary connection errors remain distinct',()=>{
  const device={...a,bluetoothName:'CoolLamp-E2EA24',accessoryName:'Living room helix'};
  assert.equal(pairingLabel(device),'Living room helix');
  const error=pairingError(new Error('Peer removed pairing information'),device);
  assert.equal(error.recovery,true);assert.equal(error.device,device);assert(!error.message.includes('Peer'));
  assert.equal(pairingError(new Error('Bluetooth permission denied')).recovery,false);
  assert.match(pairingInstructions('ios',device),/Living room helix.*Forget This Device/);
  assert.match(pairingInstructions('android',device),/Connected devices.*Forget \/ Unpair/);
  assert.match(pairingInstructions('ios',a),/Older firmware/);
});
test('switching A → B → A keeps one native BLE manager and hydrates saved peripherals on each reconnect',async()=>{
  class CachedRadio extends Radio {
    manager=0;peripherals=new Map();
    async initialize(){this.manager++;this.events.push('initialize');}
    async getDevices(ids){for(const id of ids)this.peripherals.set(id,this.manager);return super.getDevices(ids);}
    async requestDevice(){const d=await super.requestDevice();this.peripherals.set(d.deviceId,this.manager);return d;}
    async connect(id,callback){assert.equal(this.peripherals.get(id),this.manager,'peripheral belongs to the active manager');return super.connect(id,callback);}
  }
  const events=[],radio=new CachedRadio(events),lamp=new LampTransport(radio);
  const device=await lamp.connect();await lamp.connect(b);await lamp.connect(device);
  assert.equal(radio.manager,1);assert.equal(events.filter(e=>e==='initialize').length,1);
  assert.equal(events.filter(e=>e==='connect').length,3);assert.equal(events.filter(e=>e==='retrieve').length,2);
  await lamp.disconnect();
});
test('a saved lamp can reconnect after app restart, and a failed BLE initialization can be retried',async()=>{
  const events=[],radio=new Radio(events);let attempts=0;
  radio.initialize=async()=>{if(++attempts===1)throw Error('Bluetooth permission denied');};
  const lamp=new LampTransport(radio);
  await assert.rejects(lamp.connect(a),/permission/);await lamp.connect(a);
  assert.equal(attempts,2);assert.deepEqual(events,['retrieve','connect']);
  await lamp.disconnect();await lamp.connect(b);assert.equal(attempts,2);await lamp.disconnect();
});
test('clears an unfinished connection only to the saved target before asking native iOS to connect again',async()=>{
  class ConnectedRadio extends Radio {
    connected=new Set([a.deviceId,b.deviceId]);disconnections=[];
    async connect(id,callback){assert(!this.connected.has(id),'native didConnect must be able to fire');this.connected.add(id);return super.connect(id,callback);}
    async disconnect(id){this.disconnections.push(id);this.connected.delete(id);return super.disconnect();}
  }
  const radio=new ConnectedRadio([]),lamp=new LampTransport(radio);
  await lamp.connect(a);assert.deepEqual(radio.disconnections,[a.deviceId]);assert(radio.connected.has(b.deviceId));
  await lamp.disconnect();
});
test('keeps OS-authorized lamps available after app restart or failed GATT setup without resurrecting removals',()=>{
  const data=new Map(),store=new LampStore({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)});
  store.upsert({...a,room:'Den',bluetoothName:'CoolLamp-E2EA24',address:'http://192.168.1.42'});
  rememberAccessories(store,[{...a,name:'Apple display name'},b]);
  assert.equal(store.items.length,2);assert.equal(store.items[0].name,'Living room');assert.equal(store.items[0].room,'Den');
  assert.equal(store.items[0].bluetoothName,'CoolLamp-E2EA24');assert.equal(store.items[0].accessoryName,'Apple display name');
  assert.equal(store.items[1].id,'ble:'+b.deviceId);assert.equal(store.items[1].accessoryManaged,true);
  store.remove(store.items[1].id);
  rememberAccessories(store,[b,{deviceId:'invalid',name:'Wrong'}],new Set([b.deviceId.toLowerCase()]));
  assert.equal(store.items.length,1);
});
test('an unmigratable legacy record can be removed app-only after a separate user confirmation',async()=>{
  const native=new Accessories(),pairing=new LampPairing({platform:'ios',native});pairing.radioStarted=true;
  await assert.rejects(pairing.remove(a),error=>error.manualPairingRemoval===true);
  assert.deepEqual(await pairing.remove(a,{appOnly:true}),{removed:false,manual:true});
  assert(!native.events.some(e=>e.startsWith('remove:')));
  pairing.radioStarted=false;native.cancel=true;
  await assert.rejects(pairing.remove(a),error=>!error.manualPairingRemoval&&/cancelled/.test(error.message));
});
