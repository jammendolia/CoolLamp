import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {CONTROL,STATE,COMMAND,SERVICE,encodeControlCommand,decodeControlPage,decodeControlCapabilities} from '../src/protocol.js';

const identity='aabbccddeeff', identityChar='7b610006-6e2b-4f3d-9a71-28e45c001001';
const view=bytes=>new DataView(Uint8Array.from(bytes).buffer);
function envelope(text,tx=0,endpoint=0,status=200,offset=0){
  const bytes=new TextEncoder().encode(text),slice=bytes.slice(offset,offset+480),out=new DataView(new ArrayBuffer(12+slice.length));
  out.setUint8(0,1);out.setUint16(1,tx,true);out.setUint8(3,endpoint);out.setUint16(4,status,true);
  out.setUint16(6,bytes.length,true);out.setUint16(8,offset,true);out.setUint16(10,slice.length,true);
  new Uint8Array(out.buffer,12).set(slice);return out;
}
const descriptor=JSON.stringify({version:1,capabilities:['control','groups','espnow'],maxRequest:1024,maxResponse:8192,pageBytes:480,firmware:'1.10.0'});
function model(count=28){return {deviceId:identity,hostname:'coollamp-test.local',name:'Test lamp',ssid:'',mode:4,brightness:100,power:true,
  leds:134,milliamps:500,midpoint:67,effectiveMidpoint:67,apiVersion:2,catalogVersion:1,effects:Array.from({length:count},(_,i)=>'Effect '+(i+1)),
  token:'must-not-retain',sync:{version:2,role:0,active:false,scene:0,key:'private-key',code:'private-code',invite:'private-invite'},
  rotation:{enabled:false,random:true,category:0,seconds:30},audio:{installed:false,gain:8,gate:8,scale:100,liveTuning:true}};}
class Radio {
  constructor(){this.model=model();this.writes=[];this.requests=[];this.disconnections=[];this.initializations=0;this.reply=true;this.listeners=new Map();this.last=new Map();this.transactions=new Map();this.response=new Map();}
  packet(id=0){return view([1,id,0,4,100,1,28,1,0,0,0,0]);}
  async initialize(){this.initializations++;}
  async requestDevice(){return {deviceId:'target'};}
  async getDevices(ids){return ids.map(deviceId=>({deviceId}));}
  async connect(id,callback){this.listeners.set(id,{disconnect:callback});}
  async disconnect(id){this.disconnections.push(id);this.listeners.get(id)?.disconnect?.();}
  async startNotifications(id,service,char,callback){this.listeners.get(id)[char]=callback;}
  async read(id,service,char){
    if(char===STATE)return this.last.get(id)||this.packet();
    if(char===identityChar){if(this.identityFailure)throw Error('missing');return view(new TextEncoder().encode(this.protectedIdentity||identity));}
    if(char===CONTROL){
      const result=this.response.get(id);if(!result)return envelope(descriptor);
      if(this.holdRead){this.readReady?.();await this.holdRead;}
      const page=envelope(result.text,result.tx,result.endpoint,result.status,result.offset);
      if(this.badPage)page.setUint16(1,result.tx+1,true);return page;
    }throw Error('not supported');
  }
  async write(id,service,char,frame){
    assert.equal(char,COMMAND);assert.equal(service,SERVICE);assert(frame.byteLength<=20);
    const bytes=new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength).slice(),op=bytes[2],tx=frame.byteLength>=5?frame.getUint16(3,true):0;
    this.writes.push({id,bytes});
    if(op===22){
      if(bytes[5]===0)this.response.delete(id);
      else this.transactions.set(id,{tx,endpoint:bytes[5],method:bytes[6],length:frame.getUint16(7,true),body:[]});
    }else if(op===23){const request=this.transactions.get(id);assert.equal(tx,request.tx);assert.equal(frame.getUint16(5,true),request.body.length);request.body.push(...bytes.slice(7));}
    else if(op===24){
      const request=this.transactions.get(id);assert.equal(request.tx,tx);assert.equal(request.body.length,request.length);
      const text=new TextDecoder().decode(Uint8Array.from(request.body));this.requests.push({...request,body:text});
      let response=request.endpoint===1?JSON.stringify(this.model):request.endpoint===26?JSON.stringify(this.model.effects.map((name,i)=>({id:i+1,name,category:i>=38?'audio':'calm',speed:true}))):this.largeResponse||'Saved';
      this.response.set(id,{tx,endpoint:request.endpoint,status:this.responseStatus||200,text:response,offset:0});
    }else if(op===25){const result=this.response.get(id);assert.equal(result.tx,tx);result.offset=frame.getUint16(5,true);}
    this.last.set(id,this.packet(bytes[1]));
    if(this.reply&&!(this.omitCommitAck&&op===24))this.listeners.get(id)[STATE]?.(this.last.get(id));
  }
}
async function connected(t){const radio=new Radio(),lamp=new LampTransport(radio,{timeout:60});await lamp.connect();clearTimeout(lamp.controlTimer);t.after(()=>lamp.disconnect());return {radio,lamp};}
test('RPC frames fit minimum ATT payload and reject malformed envelopes',()=>{
  assert.equal(encodeControlCommand(255,'controlBegin',{tx:65535,endpoint:26,method:1,length:1024}).byteLength,9);
  assert.equal(encodeControlCommand(1,'controlChunk',{tx:1,offset:1011,bytes:new Uint8Array(13)}).byteLength,20);
  assert.deepEqual([...new Uint8Array(encodeControlCommand(1,'controlCommit',{tx:258}).buffer)],[1,1,24,2,1]);
  for(const patch of [{tx:0},{offset:1024},{bytes:new Uint8Array(14)}])assert.throws(()=>encodeControlCommand(1,'controlChunk',{tx:1,offset:0,bytes:new Uint8Array(1),...patch}));
  assert.equal(decodeControlCapabilities(envelope(descriptor)).firmware,'1.10.0');
  assert.throws(()=>decodeControlPage(envelope('ok',2,1),{tx:1}));
  const short=envelope('ok');short.setUint16(10,3,true);assert.throws(()=>decodeControlPage(short));
});
test('protected snapshot populates advanced settings without retaining tokens or group secrets',async t=>{
  const {lamp}=await connected(t);assert(lamp.supportsOfflineGroups);assert.equal(lamp.raw.leds,134);assert.equal(lamp.identity,identity);
  for(const field of ['token','key','code','invite'])assert(!JSON.stringify(lamp.raw).includes(field==='token'?'must-not-retain':'private-'+field));
  assert.equal(lamp.raw.token,undefined);assert.equal(lamp.raw.sync.key,undefined);
});
test('snapshot publishes newly read settings and excludes secrets nested in peer metadata',async t=>{
  const {lamp,radio}=await connected(t);radio.model.sync={version:2,role:2,leader:'112233445566',active:true,paused:false,scene:19,
    peers:[{id:'112233445566',name:'Coordinator',role:1,key:'nested-secret',token:'nested-token'}],radio:{available:true,key:'radio-secret'}};
  await lamp.refresh();assert.equal(lamp.state.sync.role,2);assert.equal(lamp.state.sync.active,true);assert.equal(lamp.raw.sync.peers[0].name,'Coordinator');
  assert(!JSON.stringify(lamp.state).includes('nested-'));assert(!JSON.stringify(lamp.raw).includes('radio-secret'));
});
test('serialized RPC jobs chunk UTF-8 forms and read multiple coherent pages',async t=>{
  const {lamp,radio}=await connected(t);radio.largeResponse='🌈'.repeat(400);
  const result=await Promise.all([lamp.request('/api/name',{name:'Café 🌈',extra:'x'.repeat(40)}),lamp.request('/api/identify',{})]);
  assert.deepEqual(result,['🌈'.repeat(400),'🌈'.repeat(400)]);
  const names=radio.requests.filter(request=>request.endpoint===13);assert.equal(names.length,1);
  assert.equal(new URLSearchParams(names[0].body).get('name'),'Café 🌈');
  const begins=radio.writes.filter(write=>write.bytes[2]===22&&write.bytes[5]);assert.equal(new Set(begins.map(write=>write.bytes[3]+256*write.bytes[4])).size,begins.length);
});
test('enqueue and domain helpers use fresh normalized state without command queue deadlock',async t=>{
  const {lamp,radio}=await connected(t);await lamp.enqueue(()=>lamp.configureRotation({enabled:true,random:false,category:0,seconds:60}));
  const write=radio.requests.find(request=>request.endpoint===10);assert.equal(new URLSearchParams(write.body).get('seconds'),'60');
});
test('lost commit notification reads its exact acknowledgment without replaying COMMIT',async t=>{
  const {lamp,radio}=await connected(t);radio.omitCommitAck=true;const start=radio.writes.length;await lamp.request('/api/name',{name:'Lamp'});
  assert.equal(radio.writes.slice(start).filter(write=>write.bytes[2]===24).length,1);assert.equal(lamp.id,'target');
});
test('uncertain commit timeout disconnects and never resends the mutation',async t=>{
  const {lamp,radio}=await connected(t);radio.reply=false;radio.read=async()=>{throw Error('lost');};const start=radio.requests.length;
  await assert.rejects(lamp.request('/api/name',{name:'Lamp'}),/confirm/);assert.equal(lamp.id,null);assert(radio.requests.length<=start+1);
});
test('changed transaction pages are rejected and confirmed server errors retain the connection',async t=>{
  const {lamp,radio}=await connected(t);radio.badPage=true;await assert.rejects(lamp.request('/api/identify',{}),/response/);
  radio.badPage=false;radio.responseStatus=409;await assert.rejects(lamp.request('/api/identify',{}),error=>error.confirmed&&error.status===409);assert.equal(lamp.id,'target');
});
test('catalog changes are validated before new state callbacks and retain audio categories',async t=>{
  const {lamp,radio}=await connected(t);radio.model=model(47);radio.model.mode=47;let observed;
  lamp.onState=state=>{observed={mode:state.mode,count:lamp.catalog.length,category:lamp.catalog.at(-1).category};};
  await lamp.refresh();assert.deepEqual(observed,{mode:47,count:47,category:'audio'});assert.equal(lamp.state.effectCount,47);
});
test('delayed RPC pages cannot publish state after a disconnect',async t=>{
  const {lamp,radio}=await connected(t);let release,ready;radio.holdRead=new Promise(resolve=>release=resolve);const reading=new Promise(resolve=>ready=resolve);radio.readReady=ready;
  const pending=lamp.refresh();await reading;await lamp.disconnect();release();await assert.rejects(pending,/changed/);assert.equal(lamp.raw,null);
});
test('transaction IDs wrap from 65535 to one without using zero',async t=>{
  const {lamp,radio}=await connected(t);lamp.controlSequence=65534;await lamp.request('/api/identify',{});await lamp.request('/api/identify',{});
  assert.deepEqual(radio.requests.slice(-2).map(request=>request.tx),[65535,1]);
});
test('connection metadata transition retries only a protected read and does not replay setup',async t=>{
  const radio=new Radio(),original=radio.read.bind(radio);let initial=0;
  radio.read=async(id,service,char)=>char===CONTROL&&!radio.response.has(id)&&initial++===0?envelope('',0,0,403):original(id,service,char);
  const lamp=new LampTransport(radio,{timeout:60});t.after(()=>lamp.disconnect());await lamp.connect();clearTimeout(lamp.controlTimer);
  assert(lamp.supportsOfflineControl);assert.equal(radio.writes.filter(write=>write.bytes[2]===5).length,1);
});
test('auxiliary control shares the manager and rejects stale supplied identity before any commands',async t=>{
  const {lamp,radio}=await connected(t);const auxiliary=new LampTransport(radio,{sharedInitialization:lamp.initialization,expectedDeviceIdentity:'112233445566',controlOnly:true});
  await assert.rejects(auxiliary.connect({deviceId:'coordinator',lampId:'112233445566'}),/identity/);
  assert.equal(radio.initializations,1);assert.equal(lamp.id,'target');assert(!radio.disconnections.includes('target'));
  assert(!radio.writes.some(write=>write.id==='coordinator'));
});
test('authorized auxiliary state reads are bounded while explicit foreground pairing retains its prompt window',async t=>{
  const radio=new Radio(),original=radio.read.bind(radio),reads=[];
  radio.read=async(id,service,char,options)=>{if(char===STATE)reads.push({id,timeout:options?.timeout});return original(id,service,char);};
  const main=new LampTransport(radio,{timeout:100});t.after(()=>main.disconnect());await main.connect();clearTimeout(main.controlTimer);
  const auxiliary=new LampTransport(radio,{sharedInitialization:main.initialization,expectedDeviceIdentity:identity,controlOnly:true,timeout:100});
  await auxiliary.connect({deviceId:'coordinator'});await auxiliary.disconnect();
  assert.equal(reads.find(read=>read.id==='target').timeout,60000);assert.equal(reads.find(read=>read.id==='coordinator').timeout,100);
});
test('unavailable optional characteristic leaves older firmware basic controls usable',async t=>{
  const radio=new Radio();const original=radio.read.bind(radio);radio.read=(id,service,char)=>char===CONTROL?Promise.reject(Error('missing')):original(id,service,char);
  const lamp=new LampTransport(radio,{timeout:60});t.after(()=>lamp.disconnect());await lamp.connect();assert.equal(lamp.supportsOfflineControl,false);await lamp.command('brightness',120);
  await assert.rejects(lamp.request('/api/config',{}),/connection changed/);
});
