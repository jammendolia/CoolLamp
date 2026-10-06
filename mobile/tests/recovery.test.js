import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {WifiTransport} from '../src/wifi.js';
import {encodeCommand,STATE,effects} from '../src/protocol.js';
const json=value=>new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);
class RecoveryRadio {
  capabilities=193;writes=[];resetCount=0;
  center={version:1,active:false,position:103,midpoint:0,leds:205};
  state(id=0,result=0){return new DataView(Uint8Array.of(1,id,result,4,100,1,28,this.capabilities,1,0,0,0).buffer);}
  async initialize(){}async requestDevice(){return {deviceId:'test-lamp'};}
  async connect(id,disconnect){this.onDisconnect=disconnect;}async disconnect(){this.onDisconnect?.();}
  async startNotifications(id,service,char,fn){assert.equal(char,STATE);this.listener=fn;}
  async read(id,service,char){
    if(char===STATE)return this.state();
    if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode('24eae26e9e9c').buffer);
    if(char==='7b610009-6e2b-4f3d-9a71-28e45c001001')return json(this.center);
    throw Error('Unavailable characteristic');
  }
  async write(id,service,char,frame){
    const b=Array.from(new Uint8Array(frame.buffer));this.writes.push(b);let result=0;
    if(b[2]===19){assert.equal(b[3],165);++this.resetCount;}
    if(b[2]===20){if(b[3]===0)this.center.active=true;if(b[3]===1){this.center.midpoint=this.center.position;this.center.active=false;}if(b[3]===2)this.center.active=false;}
    if(b[2]===21){const position=b[3]|b[4]<<8;if(!this.center.active||position>=205)result=2;else this.center.position=position;}
    this.listener(this.state(b[1],result));
  }
}
test('reset requires advertised support and explicit wire confirmation',async()=>{
  assert.deepEqual([...new Uint8Array(encodeCommand(7,'factoryReset',165).buffer)],[1,7,19,165]);
  assert.throws(()=>encodeCommand(1,'factoryReset',0));
  const radio=new RecoveryRadio(),lamp=new LampTransport(radio);await lamp.connect();
  await lamp.factoryReset();assert.equal(radio.resetCount,1);
  lamp.state.capabilities=65;const count=radio.writes.length;
  await assert.rejects(lamp.factoryReset(),/1.9.1/);await assert.rejects(lamp.calibrateCenter('start'),/1.9.1/);
  assert.equal(radio.writes.length,count);assert.equal(lamp.id,'test-lamp');await lamp.disconnect();
});
test('center protocol previews, bounds, cancellation and save use the selected connection',async()=>{
  const radio=new RecoveryRadio(),lamp=new LampTransport(radio);await lamp.connect();
  assert.equal((await lamp.calibrateCenter('start')).position,103);
  assert.equal((await lamp.calibrateCenter('move',150)).position,150);
  assert.equal(radio.center.midpoint,0);
  await assert.rejects(lamp.calibrateCenter('move',205),/rejected/);assert.equal(lamp.id,'test-lamp');
  await lamp.calibrateCenter('cancel');assert.equal(radio.center.midpoint,0);
  await lamp.calibrateCenter('start');await lamp.calibrateCenter('move',150);
  const saved=await lamp.calibrateCenter('save');assert.equal(saved.midpoint,150);assert.equal(saved.active,false);
  radio.center.midpoint=205;await assert.rejects(lamp.calibrateCenter('status'),/Invalid center/);
  await lamp.disconnect();
});
test('Wi-Fi reset authenticates the selected lamp and center save applies without restarting',async()=>{
  const calls=[],raw={deviceId:'24eae26e9e9c',hostname:'coollamp-e2ea24.local',token:'test-token',mode:4,brightness:100,power:true,
    effects,leds:205,midpoint:0,factoryReset:true,calibration:{active:false,position:103,kind:'leds',centerSupported:true}};
  const http={async request(request){calls.push(request);const data=Object.fromEntries(new URLSearchParams(request.data||''));
    if(request.url.endsWith('/api/calibration')){raw.calibration.active=data.action==='start';raw.calibration.kind='center';if(data.action==='save')raw.midpoint=103;return {status:200,data:'Center updated'};}
    if(request.url.endsWith('/api/factory-reset'))return {status:200,data:'Reset scheduled'};
    return {status:200,data:JSON.stringify(raw)};}};
  const lamp=new WifiTransport(http);await lamp.connect('192.168.1.42','owner-password',raw.deviceId);
  await lamp.calibrateCenter('start');assert.equal(lamp.raw.calibration.active,true);
  await lamp.calibrateCenter('save');assert.equal(lamp.raw.midpoint,103);assert.equal(lamp.raw.leds,205);
  await lamp.factoryReset();const request=calls.find(r=>r.url.endsWith('/api/factory-reset'));
  assert.equal(request.method,'POST');assert.equal(request.headers['X-Lamp-Token'],'test-token');assert(request.headers.Authorization.startsWith('Basic '));
  assert.equal(new URLSearchParams(request.data).get('confirm'),'RESET');await lamp.disconnect();
});
