import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {CONTROL,STATE,COMMAND,SERVICE,EFFECT_OPTIONS,encodeControlCommand,decodeControlPage,decodeControlCapabilities} from '../src/protocol.js';
import {CATALOG} from '../src/catalog.js';

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
      if(request.endpoint===25&&request.method===2){const code=Number(new URLSearchParams(text).get('style'));this.model.lampStyle={version:1,code,id:['unspecified','helix','large-helix','corkscrew'][code],family:['unspecified','helix','helix','corkscrew'][code]};}
      let response=request.endpoint===1?JSON.stringify(this.model):request.endpoint===26?JSON.stringify(this.model.effects.map((name,i)=>({id:i+1,name,category:i>=38?'audio':'calm',speed:true}))):this.largeResponse||'Saved';
      this.response.set(id,{tx,endpoint:request.endpoint,status:this.responseStatus||200,text:response,offset:0});
    }else if(op===25){const result=this.response.get(id);assert.equal(result.tx,tx);result.offset=frame.getUint16(5,true);}
    this.last.set(id,this.packet(bytes[1]));
    if(this.reply&&!(this.omitCommitAck&&op===24))this.listeners.get(id)[STATE]?.(this.last.get(id));
  }
}
async function connected(t){const radio=new Radio(),lamp=new LampTransport(radio,{timeout:60});await lamp.connect();clearTimeout(lamp.controlTimer);t.after(()=>lamp.disconnect());return {radio,lamp};}
test('RPC frames fit minimum ATT payload and reject malformed envelopes',()=>{
  assert.equal(encodeControlCommand(1,'controlBegin',{tx:1,endpoint:39,method:2,length:0}).getUint8(5),39);
  assert.equal(encodeControlCommand(255,'controlBegin',{tx:65535,endpoint:26,method:1,length:1024}).byteLength,9);
  assert.equal(encodeControlCommand(1,'controlChunk',{tx:1,offset:1011,bytes:new Uint8Array(13)}).byteLength,20);
  assert.deepEqual([...new Uint8Array(encodeControlCommand(1,'controlCommit',{tx:258}).buffer)],[1,1,24,2,1]);
  for(const patch of [{tx:0},{offset:1024},{bytes:new Uint8Array(14)}])assert.throws(()=>encodeControlCommand(1,'controlChunk',{tx:1,offset:0,bytes:new Uint8Array(1),...patch}));
  assert.equal(decodeControlCapabilities(envelope(descriptor)).firmware,'1.10.0');
  assert.throws(()=>decodeControlPage(envelope('ok',2,1),{tx:1}));
  const short=envelope('ok');short.setUint16(10,3,true);assert.throws(()=>decodeControlPage(short));
});
test('queued relay RPC fence cancels before BEGIN or target dispatch',async t=>{
 const {radio,lamp}=await connected(t);let release;
 const held=lamp.controlJob(()=>new Promise(resolve=>release=resolve));await new Promise(resolve=>setTimeout(resolve,1));
 let current=true;const before=radio.requests.length;
 const request=lamp.request('/api/mesh/request',{target:'112233445566',requestId:'1234567890abcdef',endpoint:31,method:2,body:'on=0'},lamp.epoch,()=>{if(!current)throw Object.assign(Error('Selection changed.'),{confirmed:true,cancelled:true});});
 current=false;release();await held;await assert.rejects(request,/Selection changed/);assert.equal(radio.requests.length,before);
});
test('relay RPC rechecks the fence immediately before its commit',async t=>{
 const {radio,lamp}=await connected(t),original=radio.write.bind(radio);let current=true;
 radio.write=async(...args)=>{const frame=args[3];await original(...args);if(frame.getUint8(2)===23)current=false;};
 const before=radio.requests.length;
 await assert.rejects(lamp.request('/api/mesh/request',{target:'112233445566',requestId:'1234567890abcdef',endpoint:31,method:2,body:'on=0'},lamp.epoch,()=>{if(!current)throw Object.assign(Error('Selection changed.'),{confirmed:true,cancelled:true});}),/Selection changed/);
 assert.equal(radio.requests.length,before);
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
test('fresh control metadata distinguishes a protected snapshot from a bare state acknowledgment',async t=>{
  const {lamp,radio}=await connected(t),observed=[];lamp.onState=(state,metadata)=>observed.push(metadata);
  await lamp.refresh();assert.deepEqual(observed.at(-1),{freshControl:true});assert.equal(observed.filter(metadata=>metadata?.freshControl).length,1);
  lamp.receive(radio.packet(17));assert.equal(observed.at(-1),undefined);assert.equal(observed.filter(metadata=>metadata?.freshControl).length,1);
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
test('encrypted style helper targets endpoint25 and publishes only validated design metadata',async t=>{
  const {lamp,radio}=await connected(t);radio.model.lampStyle={version:1,code:1,id:'helix',family:'helix',secret:'excluded'};await lamp.refresh();
  assert.deepEqual(lamp.raw.lampStyle,{version:1,code:1,id:'helix',family:'helix'});
  const before={mode:lamp.state.mode,brightness:lamp.state.brightness,power:lamp.state.power};await lamp.enqueue(()=>lamp.configureLampStyle('large-helix'));
  const changes=radio.requests.filter(request=>request.endpoint===25);assert.equal(changes.length,1);assert.equal(changes[0].method,2);assert.equal(changes[0].body,'style=2');
  assert.equal(lamp.state.lampStyle.id,'large-helix');assert.deepEqual({mode:lamp.state.mode,brightness:lamp.state.brightness,power:lamp.state.power},before);
  radio.model.lampStyle={version:1,code:1,id:'corkscrew',family:'helix'};await lamp.refresh();assert.equal(lamp.raw.lampStyle,undefined);
});
test('Bluetooth1.10.1 design defect is guarded before any Style25 transaction',async t=>{
  const {lamp,radio}=await connected(t);radio.model.lampStyle={version:1,code:0,id:'unspecified',family:'unspecified'};radio.model.firmware={version:'1.10.1'};
  await lamp.refresh();await assert.rejects(lamp.configureLampStyle('helix'),/1.10.2/);assert.equal(radio.requests.filter(request=>request.endpoint===25).length,0);
});
test('queued Bluetooth command rechecks its owner before writing and retains connection on cancellation',async t=>{
  const {lamp,radio}=await connected(t);lamp.raw.sync={version:2,role:1,leader:identity,scene:0};
  let release;const blocker=new Promise(resolve=>release=resolve);lamp.tail=blocker;
  const before=radio.writes.length,pending=lamp.command('brightness',150,null,()=>{if(lamp.raw.sync.role!==1)throw Error('Coordinator changed');});
  lamp.raw.sync={version:2,role:0,leader:'',scene:0};release();
  await assert.rejects(pending,error=>error.confirmed===true&&error.cancelled===true&&/Coordinator/.test(error.message));
  assert.equal(radio.writes.length,before);assert.equal(lamp.id,'target');
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

class CatalogRadio extends Radio {
  constructor(){super();this.stateTimeouts=[];this.capabilityReads=0;}
  packet(id=0){const data=super.packet(id);data.setUint8(7,41);return data;}
  async read(id,service,char,options){
    if(char===STATE)this.stateTimeouts.push(options?.timeout);
    if(char===CONTROL)this.capabilityReads++;
    if(char===CATALOG){
      const index=this.writes.findLast(write=>write.id===id&&write.bytes[2]===13).bytes[3];
      return view(new TextEncoder().encode(JSON.stringify({id:index,name:this.model.effects[index-1],category:'calm',speed:true})));
    }
    if(char===EFFECT_OPTIONS)return view([1,4,50,100,0,0,0,0]);
    return super.read(id,service,char);
  }
}
test('saved settings reconnect reads current settings and catalog without replaying effect setup',async t=>{
  const radio=new CatalogRadio(),observed=[],firmware=[],options=[];
  radio.model.leds=175;radio.model.firmware={version:'1.15.0'};
  radio.model.effectOptions=radio.model.effects.map(()=>[50,100,0,0,0,0]);
  const lamp=new LampTransport(radio,{timeout:80,onState:(state,metadata)=>observed.push({state,metadata}),onFirmware:value=>firmware.push(value),onOptions:value=>options.push(value)});
  t.after(()=>lamp.disconnect());
  await lamp.connect({deviceId:'target',lampId:identity,readOnlyReconnect:true});
  assert.equal(radio.stateTimeouts[0],80);assert.equal(lamp.identity,identity);assert.equal(lamp.raw.leds,175);
  assert.equal(lamp.catalog.length,28);assert.equal(lamp.catalog[0].name,'Effect 1');
  assert.equal(observed.at(-1).metadata.freshControl,true);assert.equal(firmware.at(-1).version,'1.15.0');assert.equal(options.at(-1).mode,4);
  assert.deepEqual(radio.requests.map(request=>({endpoint:request.endpoint,method:request.method})),[{endpoint:1,method:1},{endpoint:26,method:1}]);
  assert(radio.writes.every(write=>[22,24,25].includes(write.bytes[2])));assert(lamp.controlTimer);
});
test('explicit first connection retains protected pairing time and complete legacy effect negotiation',async t=>{
  const radio=new CatalogRadio(),lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  await lamp.connect({deviceId:'target',lampId:identity});
  assert.equal(radio.stateTimeouts[0],60000);assert.equal(radio.writes.filter(write=>write.bytes[2]===12).length,1);
  assert.equal(radio.writes.filter(write=>write.bytes[2]===13).length,28);assert.equal(lamp.catalog.length,28);assert(lamp.supportsOfflineControl);
});
test('saved settings reconnect retains old lamp controls when the optional characteristic is absent',async t=>{
  const radio=new CatalogRadio(),read=radio.read.bind(radio);
  radio.read=(id,service,char,options)=>char===CONTROL?Promise.reject(Error('Characteristic not found.')):read(id,service,char,options);
  const lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  await lamp.connect({deviceId:'target',lampId:identity,readOnlyReconnect:true});
  assert.equal(radio.stateTimeouts[0],80);assert.equal(lamp.supportsOfflineControl,false);
  assert.equal(radio.writes.filter(write=>write.bytes[2]===12).length,1);assert.equal(radio.writes.filter(write=>write.bytes[2]===13).length,28);
  await lamp.command('brightness',120);assert.equal(lamp.id,'target');
});
test('saved settings reconnect fails on modern read errors without replaying legacy setup',async t=>{
  for(const fault of ['timeout','invalid capabilities']){
    const radio=new CatalogRadio(),read=radio.read.bind(radio),lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
    radio.read=(id,service,char,options)=>char===CONTROL?(fault==='timeout'?Promise.reject(Error('Reading characteristic timed out.')):Promise.resolve(envelope('{}'))):read(id,service,char,options);
    await assert.rejects(lamp.connect({deviceId:'target',lampId:identity,readOnlyReconnect:true}),fault==='timeout'?/timed out/:/capabilities/);
    assert.equal(radio.writes.length,0);assert.equal(lamp.id,null);assert.equal(lamp.raw,null);
  }
});
test('saved settings reconnect rejects protected identity mismatches before sending any commands',async t=>{
  const radio=new CatalogRadio(),lamp=new LampTransport(radio,{timeout:80});radio.protectedIdentity='112233445566';t.after(()=>lamp.disconnect());
  await assert.rejects(lamp.connect({deviceId:'target',lampId:identity,readOnlyReconnect:true}),/identity did not match this lamp/);
  assert.equal(radio.writes.length,0);assert.equal(radio.capabilityReads,0);assert.equal(lamp.id,null);
});
test('saved settings reconnect rejects another lamp in the protected snapshot before catalog publication',async t=>{
  const radio=new CatalogRadio(),observed=[],lamp=new LampTransport(radio,{timeout:80,onState:(state,metadata)=>observed.push({state,metadata})});
  radio.model.deviceId='112233445566';t.after(()=>lamp.disconnect());
  await assert.rejects(lamp.connect({deviceId:'target',lampId:identity,readOnlyReconnect:true}),/Invalid Bluetooth settings snapshot/);
  assert.equal(radio.requests.length,1);assert.equal(radio.requests[0].method,1);assert(!observed.some(value=>value.metadata?.freshControl));
  assert.equal(lamp.id,null);assert.equal(lamp.catalog,null);assert.equal(lamp.raw,null);
});
test('initial state cache retry retains saved read-only and automatic reconnect flags',async t=>{
  const radio=new CatalogRadio(),read=radio.read.bind(radio),selections=[];let initial=true;
  radio.read=async(id,service,char,options)=>{
    if(char===STATE&&initial){initial=false;radio.stateTimeouts.push(options?.timeout);return view([1]);}
    return read(id,service,char,options);
  };
  const lamp=new LampTransport(radio,{timeout:80,selectDevice:device=>{selections.push(device);return {deviceId:device.deviceId,lampId:device.lampId,accessoryManaged:true};}});
  t.after(()=>lamp.disconnect());await lamp.connect({deviceId:'target',lampId:identity,accessoryManaged:true,readOnlyReconnect:true,automaticReconnect:true});
  assert.equal(selections.length,2);assert.equal(selections[1].readOnlyReconnect,true);assert.equal(selections[1].automaticReconnect,true);
  assert.deepEqual(radio.stateTimeouts.slice(0,2),[80,80]);assert(radio.writes.every(write=>[22,24,25].includes(write.bytes[2])));assert.equal(lamp.raw.leds,134);
});
test('cancelled capability read cannot fall back to setup or disconnect a newer settings connection',async t=>{
  const radio=new CatalogRadio(),read=radio.read.bind(radio);let release,ready,hold=true;
  const reading=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  radio.read=async(id,service,char,options)=>{if(char===CONTROL&&id==='old'&&hold){ready();await gate;}return read(id,service,char,options);};
  const lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true});const rejection=assert.rejects(old,/Connection changed/);
  await reading;await lamp.disconnect();hold=false;
  await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});const writes=radio.writes.length;
  release();await rejection;
  assert.equal(lamp.id,'new');assert.equal(lamp.raw.leds,134);assert.equal(radio.writes.length,writes);assert(!radio.disconnections.includes('new'));
});

test('cancelled authorization preserves its saved accessory without opening a late native link',async t=>{
  const radio=new CatalogRadio(),authorized=[],connections=[];let release,ready;
  const selecting=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  const connect=radio.connect.bind(radio);radio.connect=async(id,...args)=>{connections.push(id);return connect(id,...args);};
  const lamp=new LampTransport(radio,{timeout:80,selectDevice:async device=>{
    if(device.deviceId==='old'){ready();await gate;}return {...device,accessoryManaged:true};
  },onDeviceSelected:device=>authorized.push(device.deviceId)});
  t.after(()=>lamp.disconnect());
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true}),rejected=assert.rejects(old,/Connection changed/);
  await selecting;await lamp.disconnect();await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;
  assert.deepEqual(connections,['new']);assert.deepEqual(authorized,['new','old']);assert.equal(lamp.id,'new');
  assert(!radio.disconnections.includes('new'));
});

test('cancelled native initialization records radio creation but cannot revive its old connection',async t=>{
  const radio=new CatalogRadio(),connections=[];let release,ready,radioReady=0;
  const initializing=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  radio.initialize=async()=>{radio.initializations++;ready();await gate;};
  const connect=radio.connect.bind(radio);radio.connect=async(id,...args)=>{connections.push(id);return connect(id,...args);};
  const lamp=new LampTransport(radio,{timeout:80,onRadioReady:()=>radioReady++});t.after(()=>lamp.disconnect());
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true}),rejected=assert.rejects(old,/Connection changed/);
  await initializing;await lamp.disconnect();const newer=lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;await newer;
  assert.equal(radio.initializations,1);assert.equal(radioReady,2);assert.deepEqual(connections,['new']);assert.equal(lamp.id,'new');
  assert(!radio.disconnections.includes('new'));
});

test('cancelled foreground device picker cannot connect after a saved lamp has taken ownership',async t=>{
  const radio=new CatalogRadio(),connections=[];let release,ready;
  const picking=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  radio.requestDevice=async()=>{ready();await gate;return {deviceId:'old'};};
  const connect=radio.connect.bind(radio);radio.connect=async(id,...args)=>{connections.push(id);return connect(id,...args);};
  const lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  const old=lamp.connect(),rejected=assert.rejects(old,/Connection changed/);
  await picking;await lamp.disconnect();await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;
  assert.deepEqual(connections,['new']);assert.equal(lamp.id,'new');assert(!radio.disconnections.includes('new'));
});

test('cancellation during native disconnect cleanup cannot renew the cancelled connection generation',async t=>{
  const radio=new CatalogRadio(),connections=[];let release,ready;
  const lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  await lamp.connect({deviceId:'prior',lampId:identity,readOnlyReconnect:true});
  const cleaning=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve),disconnect=radio.disconnect.bind(radio);
  radio.disconnect=async id=>{if(id==='prior'){ready();await gate;}return disconnect(id);};
  const connect=radio.connect.bind(radio);radio.connect=async(id,...args)=>{connections.push(id);return connect(id,...args);};
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true}),rejected=assert.rejects(old,/Connection changed/);
  await cleaning;await lamp.disconnect();await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;
  assert.deepEqual(connections,['new']);assert.equal(lamp.id,'new');assert(!radio.disconnections.includes('new'));
});

test('cancelled existing-peripheral cleanup cannot proceed into a late native connection',async t=>{
  const radio=new CatalogRadio(),connections=[];let release,ready,hold=true;
  const cleaning=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve),disconnect=radio.disconnect.bind(radio);
  radio.disconnect=async id=>{if(id==='old'&&hold){hold=false;ready();await gate;}return disconnect(id);};
  const connect=radio.connect.bind(radio);radio.connect=async(id,...args)=>{connections.push(id);return connect(id,...args);};
  const lamp=new LampTransport(radio,{timeout:80});lamp.connectionAttempts.add('old');t.after(()=>lamp.disconnect());
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true}),rejected=assert.rejects(old,/Connection changed/);
  await cleaning;await lamp.disconnect();await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;
  assert.deepEqual(connections,['new']);assert.equal(lamp.id,'new');assert(!radio.disconnections.includes('new'));
});

test('cancelled native connection completion cannot issue protected reads against an old lamp',async t=>{
  const radio=new CatalogRadio(),reads=[];let release,ready;
  const connecting=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve),connect=radio.connect.bind(radio),read=radio.read.bind(radio);
  radio.connect=async(id,...args)=>{await connect(id,...args);if(id==='old'){ready();await gate;}};
  radio.read=async(id,...args)=>{reads.push(id);return read(id,...args);};
  const lamp=new LampTransport(radio,{timeout:80});t.after(()=>lamp.disconnect());
  const old=lamp.connect({deviceId:'old',lampId:identity,readOnlyReconnect:true}),rejected=assert.rejects(old,/Connection changed/);
  await connecting;await lamp.disconnect();await lamp.connect({deviceId:'new',lampId:identity,readOnlyReconnect:true});
  release();await rejected;
  assert(!reads.includes('old'));assert.equal(lamp.id,'new');assert(!radio.disconnections.includes('new'));
});
