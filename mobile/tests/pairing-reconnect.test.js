import test from 'node:test';
import assert from 'node:assert/strict';
import {LampPairing} from '../src/pairing.js';
import {LampTransport} from '../src/transport.js';
import {STATE} from '../src/protocol.js';

const deviceId='AAAAAAAA-0000-0000-0000-000000000001',target='aabbccddeeff';
const saved={deviceId,id:target,name:'Reading lamp',accessoryManaged:true};
function nativeFixture(devices=[saved],supported=true){
  const calls=[];return {calls,async list(){calls.push('list');return {supported,devices};},async migrate(){calls.push('migrate');throw Error('Recovery must not migrate');},async select(){calls.push('select');throw Error('Recovery must not show a picker');}};
}

test('iPhone automatic pairing reconnect lists only the exact existing authorization',async()=>{
  const native=nativeFixture([{...saved,deviceId:deviceId.toLowerCase(),name:'Apple name'},{deviceId:'BBBBBBBB-0000-0000-0000-000000000002',name:'Other'}]);
  const pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[{...saved,accessoryManaged:false}]});
  const result=await pairing.reconnect({...saved,automaticReconnect:true});assert.equal(result.deviceId,deviceId.toLowerCase());assert.equal(result.id,target);assert.equal(result.newAuthorization,false);assert.equal(result.accessoryManaged,true);
  assert.deepEqual(native.calls,['list']);
});

test('missing automatic iPhone authorization fails without migration or a picker',async()=>{
  const native=nativeFixture([]),pairing=new LampPairing({platform:'ios',native,knownDevices:()=>[{...saved,accessoryManaged:false}]});
  await assert.rejects(pairing.reconnect(saved),/authorized again/);assert.deepEqual(native.calls,['list']);
  await assert.rejects(pairing.reconnect({name:'Unknown lamp'}),/paired/);assert.deepEqual(native.calls,['list']);
});

test('unsupported iPhone accessory management and Android reuse saved identity without prompting',async()=>{
  for(const platform of ['ios','android']){
    const native=nativeFixture([],false),pairing=new LampPairing({platform,native});assert.equal(await pairing.reconnect(saved),saved);
    assert.deepEqual(native.calls,platform==='ios'?['list']:[]);
  }
});

class Radio {
  constructor(identity=target){this.identity=identity;this.initialTimeouts=[];this.operations=[];this.requests=0;}
  packet(id=0){return new DataView(Uint8Array.of(1,id,0,4,100,1,28,0,0,0,0,0).buffer);}
  async initialize(){}
  async getDevices(ids){return ids.map(deviceId=>({deviceId,name:'Saved CoolLamp'}));}
  async requestDevice(){this.requests++;throw Error('Saved reconnect must not request a device');}
  async connect(id,disconnect){this.disconnected=disconnect;}
  async read(id,service,char,options){
    if(char===STATE){if(options)this.initialTimeouts.push(options.timeout);return this.packet();}
    if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001'){const bytes=new TextEncoder().encode(this.identity);return new DataView(bytes.buffer);}
    throw Error('Optional legacy characteristic unavailable');
  }
  async startNotifications(id,service,char,listener){if(char===STATE)this.listener=listener;}
  async write(id,service,char,frame){this.operations.push(frame.getUint8(2));this.listener(this.packet(frame.getUint8(1)));}
  async disconnect(){this.disconnected?.();}
}

test('automatic protected state read uses a short deadline, while manual saved setup retains its pairing deadline',async()=>{
  for(const automaticReconnect of [true,false]){
    const native=nativeFixture(),pairing=new LampPairing({platform:'ios',native}),radio=new Radio();
    const lamp=new LampTransport(radio,{timeout:80,expectedDeviceIdentity:target,selectDevice:device=>device?.automaticReconnect?pairing.reconnect(device):pairing.select(device)});
    await lamp.connect({...saved,automaticReconnect});assert.equal(radio.initialTimeouts[0],automaticReconnect?80:60000);
    assert.equal(radio.requests,0);assert.deepEqual(native.calls,['list']);assert.deepEqual(radio.operations,[5]);
    await lamp.disconnect();
  }
});

test('automatic Bluetooth identity mismatch rejects before any lamp command or adoption',async()=>{
  const native=nativeFixture(),pairing=new LampPairing({platform:'ios',native}),radio=new Radio('112233445566');
  const lamp=new LampTransport(radio,{timeout:80,expectedDeviceIdentity:target,selectDevice:device=>pairing.reconnect(device)});
  await assert.rejects(lamp.connect({...saved,automaticReconnect:true}),/identity did not match/);
  assert.equal(lamp.id,null);assert.equal(radio.requests,0);assert.deepEqual(radio.operations,[]);assert.deepEqual(native.calls,['list']);
});
