import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {STATE} from '../src/protocol.js';
import {WIFI_SETUP,encodeWifiSetup,wifiCredentials,decodeWifiSetup,wifiSetupMessage} from '../src/wifi-setup.js';

const view=value=>new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);
class SetupRadio {
  writes=[];phase=0;scanId=1;network=0;ssid='';received=[];reply=null;fail=false;
  status(){return {version:1,phase:this.phase,error:this.phase===5?2:0,count:2,scanId:this.scanId,
    connected:this.phase===4,ssid:this.ssid,address:this.phase===4?'192.168.1.42':'0.0.0.0',
    hostname:'coollamp-e2ea24.local',deviceId:'24eae26e9e9c',usingDefaultPassword:true};}
  state(id=0){return new DataView(Uint8Array.of(1,id,0,4,100,1,28,65,1,0,0,0).buffer);}
  async initialize(){}async requestDevice(){return {deviceId:'lamp-1'};}
  async connect(id,disconnect){this.disconnectCallback=disconnect;}
  async disconnect(){this.disconnectCallback?.();}
  async startNotifications(id,service,char,fn){assert.equal(char,STATE);this.listener=fn;}
  async read(id,service,char){
    if(char===STATE)return this.state();
    if(char===WIFI_SETUP)return view(this.reply);
    if(char==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode('24eae26e9e9c').buffer);
    throw Error('Unavailable characteristic');
  }
  async write(id,service,char,frame){
    const bytes=Array.from(new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength));this.writes.push(bytes);
    const op=bytes[2],value=bytes[3];
    if(op===14){if(value===1)this.phase=1;if(value===2)this.phase=0;
      if(value===0&&this.phase===1)this.phase=2;
      if(value===0&&this.phase===3)this.phase=this.fail?5:4;
      this.reply=this.status();}
    if(op===15)this.reply={version:1,scanId:this.scanId,index:value,ssid:value?'Guest':'Home',rssi:-50,open:Boolean(value)};
    if(op===16){this.received=[];this.ssidLength=value;}
    if(op===17){assert.equal(value,this.received.length);this.received.push(...bytes.slice(4));}
    if(op===18){this.ssid=new TextDecoder().decode(Uint8Array.from(this.received.slice(0,this.ssidLength)));this.phase=3;this.reply=this.status();}
    this.listener(this.state(bytes[1]));
  }
}
const connect=async()=>{const radio=new SetupRadio(),lamp=new LampTransport(radio);await lamp.connect();lamp.waitWifi=async(epoch,signal)=>{
  if(signal?.aborted)throw Error('Wi-Fi setup cancelled.');if(epoch!==lamp.epoch)throw Error('Connection changed.');
};return {radio,lamp};};

test('credential frames fit minimum MTU, use UTF-8 lengths and reject malformed input',()=>{
  const value=wifiCredentials('é'.repeat(16),'a'.repeat(63));assert.equal(value.bytes.length,95);
  assert.equal(encodeWifiSetup(1,'wifiBegin',value).byteLength,6);
  for(let offset=0;offset<95;offset+=16)assert(encodeWifiSetup(1,'wifiChunk',{offset,bytes:value.bytes.slice(offset,offset+16)}).byteLength<=20);
  for(const args of [['', 'password'],['é'.repeat(17),'password'],['Home','short'],['Home','a'.repeat(64)],['Home\0','password'],['Home','pass\0word'],['Home','password',true]])assert.throws(()=>wifiCredentials(...args));
  assert.equal(wifiCredentials('Guest','',true).passwordLength,0);
  assert.throws(()=>encodeWifiSetup(1,'wifiChunk',{offset:0,bytes:new Uint8Array(17)}));
});
test('scan paging and credential submission are acknowledged, scoped and serialized with controls',async()=>{
  const {radio,lamp}=await connect();assert(lamp.supportsWifiSetup);
  const [networks]=await Promise.all([lamp.scanWifi(),lamp.command('brightness',120)]);
  assert.deepEqual(networks.map(x=>x.ssid),['Home','Guest']);
  const result=await lamp.configureWifi('Home','a'.repeat(63));assert.equal(result.phase,4);assert(result.connected);
  assert(radio.writes.every(frame=>frame.length<=20));assert.equal(radio.received.length,67);
  const report=await lamp.readWifiSetup();assert.equal(report.ssid,'Home');assert(!JSON.stringify(report).includes('a'.repeat(63)));
  await lamp.disconnect();
});
test('failed joins keep Bluetooth usable and report a retry without replaying credentials',async()=>{
  const {radio,lamp}=await connect();radio.fail=true;
  await assert.rejects(lamp.configureWifi('Home','password'),/timed out/);
  assert.equal(lamp.id,'lamp-1');assert.equal(radio.writes.filter(x=>x[2]===18).length,1);
  await lamp.command('power',0);await lamp.disconnect();
});
test('cancellation clears a pending setup and a stale connection cannot configure another lamp',async()=>{
  const {radio,lamp}=await connect(),controller=new AbortController();controller.abort();
  await assert.rejects(lamp.configureWifi('Home','password',false,{signal:controller.signal}),/cancelled/);
  assert.equal(radio.writes.filter(x=>x[2]===18).length,0);
  lamp.waitWifi=async()=>{await lamp.disconnect();};
  await assert.rejects(lamp.scanWifi(),/first|changed|disconnected/);
});
test('old firmware is rejected locally and response identities cannot cross lamps',async()=>{
  const {radio,lamp}=await connect();lamp.state.capabilities=1;const count=radio.writes.length;
  await assert.rejects(lamp.scanWifi(),/1.9.0/);assert.equal(radio.writes.length,count);
  assert.throws(()=>decodeWifiSetup(radio.status(),'aabbccddeeff'),/identity/);
  await lamp.disconnect();
});

test('Wi-Fi failure messages distinguish security, association, signal and DHCP without assuming a bad password',()=>{
  const base={...new SetupRadio().status(),phase:5,error:2};
  const decoded=decodeWifiSetup({...base,join:[2,202,0,0]});
  assert.equal(decoded.wifiReason,202);assert.equal(decoded.associated,false);
  assert.match(wifiSetupMessage(decoded),/authentication.*202/);
  assert.match(wifiSetupMessage({...base,wifiReason:210}),/compatible security/);
  assert.match(wifiSetupMessage({...base,wifiReason:2}),/initial Wi-Fi authentication exchange/);
  assert.match(wifiSetupMessage({...base,wifiReason:2}),/does not confirm an incorrect password/);
  assert.match(wifiSetupMessage({...base,wifiReason:201}),/could not find/);
  assert.match(wifiSetupMessage({...base,wifiReason:212}),/signal/);
  assert.match(wifiSetupMessage({...base,associated:true,gotIp:false}),/IP address.*DHCP/);
  assert.match(wifiSetupMessage({...base,wifiReason:203}),/reason 203/);
  assert.match(wifiSetupMessage(base),/did not report a specific failure reason/);
  for(const join of [[2,202,0],[2,202,0,2],[4,202,0,0],[2,-1,0,0]])assert.throws(()=>decodeWifiSetup({...base,join}));
});
