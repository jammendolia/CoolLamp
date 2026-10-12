import test from 'node:test';
import assert from 'node:assert/strict';
import {LampTransport} from '../src/transport.js';
import {STATE,COMMAND,CONTROL,FIRMWARE,EFFECT_OPTIONS} from '../src/protocol.js';

function packet(id=0,result=0,brightness=100){return new DataView(Uint8Array.of(1,id,result,4,brightness,1,28,1,9,0,0,0).buffer);}
const text=value=>new DataView(new TextEncoder().encode(value).buffer);
class NativeRadio {
 constructor(){this.cached=packet();this.frames=[];this.disconnects=0;this.notify=true;this.nativeCallbackErrors=0;this.reads=0;}
 async initialize(){}
 async requestDevice(){return {deviceId:'private-native-uuid',name:'Private lamp name'};}
 async connect(_id,callback){this.disconnected=callback;}
 async disconnect(){++this.disconnects;this.disconnected?.();}
 async read(_id,_service,characteristic){
  if(characteristic===STATE){++this.reads;return this.cached;}
  if(characteristic==='7b610006-6e2b-4f3d-9a71-28e45c001001')return text('aabbccddeeff');
  throw Error('Characteristic not found.');
 }
 async startNotifications(_id,_service,characteristic,callback){assert.equal(characteristic,STATE);this.listener=callback;}
 emit(value){try{this.listener?.(value);}catch{++this.nativeCallbackErrors;}}
 async write(_id,_service,characteristic,frame){
  assert.equal(characteristic,COMMAND);this.frames.push([...new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength)]);
  this.cached=packet(frame.getUint8(1),this.result??0,frame.getUint8(2)===2?frame.getUint8(3):100);
  if(this.notify)this.emit(this.cached);
  if(this.writeHold)await this.writeHold;
 }
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function firmwarePacket(){return new DataView(Uint8Array.of(1,2,0,1,0,0,1,0,2,0,0,0,1,0,3,0,0,0,1,0).buffer);}
const optionsPacket=()=>new DataView(Uint8Array.of(1,4,50,70,0,255,2,3).buffer);
class RichRadio extends NativeRadio {
 constructor(){super();this.cached=this.rich(this.cached);}
 rich(value){value.setUint8(6,37);value.setUint8(7,13);return value;}
 emit(value){super.emit(this.rich(value));}
 async read(...args){if(args[2]===FIRMWARE)return firmwarePacket();if(args[2]===EFFECT_OPTIONS)return optionsPacket();return super.read(...args);}
 async startNotifications(id,service,characteristic,callback){
  if(characteristic===FIRMWARE)this.firmwareListener=callback;else if(characteristic===EFFECT_OPTIONS)this.optionsListener=callback;else return super.startNotifications(id,service,characteristic,callback);
 }
}

test('an initial state consumer exception does not pretend that protected Bluetooth connection failed',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{onState:()=>{throw Error('Private render failure');},timeout:80});
 const device=await lamp.connect();assert.equal(device.deviceId,'private-native-uuid');assert.equal(lamp.id,device.deviceId);
 assert.equal(radio.disconnects,0);assert.equal(radio.frames.length,1);await lamp.disconnect();
});

test('a lost notification exact ACK probe still confirms one command when the consumer throws',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:80});await lamp.connect();
 radio.notify=false;lamp.onState=()=>{throw Error('Private render failure');};const before=radio.frames.length;
 const result=await lamp.command('brightness',173);assert.equal(result.brightness,173);assert.equal(result.result,0);
 assert.equal(radio.frames.length,before+1);assert.equal(radio.disconnects,0);assert.equal(lamp.pending,null);await lamp.disconnect();
});

test('native event settlement precedes a throwing consumer and late native write completion',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:40});await lamp.connect();
 const gate=deferred(),entered=deferred();radio.writeHold=gate.promise;
 lamp.onState=()=>{assert.equal(lamp.pending,null);entered.resolve();throw Error('Private state body');};
 const before=radio.frames.length,reads=radio.reads,job=lamp.command('brightness',173);await entered.promise;
 assert.equal(lamp.pending,null);assert.deepEqual(lamp.lastCallbackError,{version:1,callback:'state',type:'threw',sequence:1});assert(Object.isFrozen(lamp.lastCallbackError));
 await delay(60);assert.equal(radio.disconnects,0);assert.equal(radio.reads,reads);gate.resolve();assert.equal((await job).brightness,173);
 assert.equal(radio.frames.length,before+1);assert.equal(radio.nativeCallbackErrors,0);await lamp.disconnect();
});

test('consumer mutation of its state view cannot alter the already correlated command receipt',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio);await lamp.connect();
 lamp.onState=state=>{state.id=255;state.result=4;state.brightness=1;};
 const result=await lamp.command('brightness',173);assert.equal(result.id,2);assert.equal(result.result,0);assert.equal(result.brightness,173);
 assert.equal(radio.frames.length,2);assert.equal(radio.disconnects,0);await lamp.disconnect();
});

for(const notify of [true,false])test(`a confirmed negative ACK stays rejected and connected despite consumer failure, notify=${notify}`,async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:80});await lamp.connect();radio.notify=notify;radio.result=4;
 lamp.onState=()=>{throw Error('Private render failure');};
 await assert.rejects(lamp.command('saveDefaults'),error=>error.confirmed===true&&!error.code&&/save/.test(error.message));
 assert.equal(lamp.id,'private-native-uuid');assert.equal(lamp.pending,null);assert.equal(radio.frames.length,2);assert.equal(radio.disconnects,0);await lamp.disconnect();
});

test('foreign IDs cannot settle or reject a command even when their observer throws',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:80});await lamp.connect();radio.notify=false;
 lamp.onState=()=>{throw Error('Private renderer');};const gate=deferred();radio.writeHold=gate.promise;
 const job=lamp.command('brightness',173);await delay(0);const pending=lamp.pending;
 radio.emit(packet(pending.id===255?1:pending.id+1,4));assert.equal(lamp.pending,pending);
 radio.emit(packet(pending.id,0,173));assert.equal(lamp.pending,null);gate.resolve();assert.equal((await job).brightness,173);
 assert.equal(radio.disconnects,0);assert.equal(radio.frames.length,2);await lamp.disconnect();
});

test('read admission is checked before ACK settlement or any consumer dispatch',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:80});await lamp.connect();let block=false,events=0;
 lamp.onState=()=>{++events;};const original=radio.emit.bind(radio);radio.emit=value=>{block=true;original(value);};
 await assert.rejects(lamp.command('brightness',173,null,null,()=>{if(block)throw Error('Read lane stopped');}),error=>error.readAdmission&&error.uncertain&&!error.confirmed);
 assert.equal(events,0);assert.equal(lamp.lastCallbackError,null);assert.equal(lamp.pending,null);assert.equal(radio.disconnects,0);assert.equal(radio.frames.length,2);await lamp.disconnect();
});

test('malformed packets retain protocol failure without becoming a consumer diagnostic',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{timeout:80});await lamp.connect();radio.notify=false;const gate=deferred();radio.writeHold=gate.promise;
 const job=lamp.command('brightness',173),failed=assert.rejects(job,error=>error.code==='INVALID_STATE_PACKET');await delay(0);
 radio.emit(new DataView(new ArrayBuffer(3)));assert.equal(lamp.pending,null);assert.equal(lamp.lastCallbackError,null);gate.resolve();await failed;
 assert.equal(radio.frames.length,2);assert.equal(radio.disconnects,1);assert.equal(lamp.id,null);
});

for(const hook of [()=>{throw Error('Private hook failed');},()=>Promise.reject(Error('Private hook rejection'))])test('throwing diagnostic hooks never recurse, expose details or invalidate a confirmed command',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{onCallbackError:hook});await lamp.connect();lamp.onState=()=>{throw Error('Private-native-uuid 192.0.2.1 body password');};
 const result=await lamp.command('brightness',173);assert.equal(result.result,0);await delay(0);
 const diagnostic=lamp.lastCallbackError;assert.deepEqual(diagnostic,{version:1,callback:'state',type:'threw',sequence:1});
 for(const word of ['Private','192.0.2.1','body','password','uuid','message','session'])assert(!JSON.stringify(diagnostic).includes(word));
 assert.equal(radio.disconnects,0);assert.equal(radio.frames.length,2);await lamp.disconnect();
});

test('asynchronous consumer rejection is optional evidence and cannot reject an acknowledged command',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio);await lamp.connect();const gate=deferred();lamp.onState=()=>gate.promise;
 assert.equal((await lamp.command('brightness',173)).result,0);gate.reject(Error('Private async render error'));await delay(0);
 assert.deepEqual(lamp.lastCallbackError,{version:1,callback:'state',type:'rejected',sequence:1});assert.equal(radio.disconnects,0);await lamp.disconnect();
});

test('late consumer rejection is fenced away from a replacement connection',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio);await lamp.connect();const gate=deferred();lamp.onState=()=>gate.promise;
 await lamp.command('brightness',173);await lamp.disconnect();lamp.onState=()=>{};await lamp.connect();gate.reject(Error('Old screen error'));await delay(0);
 assert.equal(lamp.lastCallbackError,null);assert.equal(lamp.id,'private-native-uuid');await lamp.disconnect();
});

test('a consumer deliberately changing connection generation cannot return its old ACK as current',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio);await lamp.connect();lamp.onState=()=>lamp.disconnected();
 await assert.rejects(lamp.command('brightness',173),error=>error.confirmed&&error.cancelled&&/acknowledged/.test(error.message));
 assert.equal(lamp.id,null);assert.equal(radio.frames.length,2);assert.equal(radio.disconnects,0);
});

for(const callback of ['options','firmware'])test(`initial ${callback} observer failure is recorded without failing native setup`,async()=>{
 const radio=new NativeRadio(),seen=[],lamp=new LampTransport(radio,{[callback==='options'?'onOptions':'onFirmware']:()=>{throw Error('Private render');},onCallbackError:value=>seen.push(value)});
 await lamp.connect();assert.equal(lamp.id,'private-native-uuid');assert.equal(lamp.lastCallbackError.callback,callback);assert.equal(lamp.lastCallbackError.type,'threw');assert.equal(seen.length,1);
 assert.equal(radio.frames.length,1);assert.equal(radio.disconnects,0);await lamp.disconnect();
});

test('callback evidence has fixed enums, saturating sequence and no arbitrary public record fields',()=>{
 const lamp=new LampTransport(new NativeRadio());lamp.callbackErrorSequence=0xffffffff;
 lamp.onState=()=>{throw Error('private');};lamp.dispatchConsumer('state',{});assert.equal(lamp.lastCallbackError.sequence,0xffffffff);
 const previous=lamp.lastCallbackError;lamp.recordCallbackError('private','threw',lamp.epoch);lamp.recordCallbackError('state','private',lamp.epoch);lamp.recordCallbackError('state','threw',lamp.epoch+1);
 assert.equal(lamp.lastCallbackError,previous);assert.equal(lamp.dispatchConsumer('toString',{}),false);
});

test('actual firmware/options connect reads and native subscriptions isolate observer exceptions',async()=>{
 const radio=new RichRadio(),errors=[],lamp=new LampTransport(radio,{onState:()=>{throw Error('Private state renderer');},
  onFirmware:()=>{throw Error('Private firmware renderer');},onOptions:()=>{throw Error('Private options renderer');},onCallbackError:value=>errors.push(value)});
 await lamp.connect();assert.equal(radio.frames.length,2);assert.equal(radio.disconnects,0);
 assert(errors.some(value=>value.callback==='state'));assert(errors.some(value=>value.callback==='firmware'));assert(errors.some(value=>value.callback==='options'));
 const before=errors.length;radio.optionsListener(optionsPacket());assert.equal(errors.length,before+1);assert.equal(lamp.lastCallbackError.callback,'options');
 radio.firmwareListener(firmwarePacket());assert.equal(errors.length,before+2);assert.equal(lamp.lastCallbackError.callback,'firmware');
 assert.equal((await lamp.refreshFirmware()).version,'1.2.0');assert.equal(lamp.lastCallbackError.callback,'firmware');assert.equal(radio.frames.length,2);await lamp.disconnect();
});

test('actual full-snapshot refresh emits state, firmware and options without treating observer errors as a read failure',async()=>{
 const radio=new RichRadio(),lamp=new LampTransport(radio);await lamp.connect();lamp.control={capabilities:['control']};
 const raw={deviceId:'aabbccddeeff',effects:Array.from({length:37},()=>''),mode:4,brightness:173,power:true,leds:205,
  firmware:{version:'1.15.1',phase:0},colors:Array.from({length:37},()=>[0,1,2,3]),effectOptions:Array.from({length:37},()=>[50,70,0,1,2,3])};
 lamp.request=async path=>{assert.equal(path,'/api/state');return JSON.stringify(raw);};const errors=[];lamp.onCallbackError=value=>errors.push(value);
 lamp.onState=(_value,metadata)=>{assert.equal(metadata.freshControl,true);throw Error('Private state renderer');};
 lamp.onFirmware=()=>{throw Error('Private firmware renderer');};lamp.onOptions=()=>{throw Error('Private options renderer');};
 const before=radio.frames.length,result=await lamp.refresh();assert.equal(result.leds,205);assert.equal(lamp.state.brightness,173);
 assert.deepEqual(errors.map(value=>value.callback),['state','firmware','options']);assert.equal(radio.frames.length,before);assert.equal(radio.disconnects,0);await lamp.disconnect();
});

test('exact ACK settlement clears both existing timers before the consumer runs',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio);let lateCallbacks=0;
 const response=new Promise((resolve,reject)=>{lamp.pending={id:7,resolve,reject,timer:setTimeout(()=>{++lateCallbacks;},15),probeTimer:setTimeout(()=>{++lateCallbacks;},10)};});
 lamp.onState=()=>{assert.equal(lamp.pending,null);throw Error('Private observer');};lamp.receive(packet(7,0,173));
 assert.equal((await response).brightness,173);await delay(25);assert.equal(lateCallbacks,0);assert.equal(lamp.lastCallbackError.callback,'state');
});

test('an intentional generation change during the initial observer is still caught by the connection guard',async()=>{
 const radio=new NativeRadio();let lamp;lamp=new LampTransport(radio,{onState:()=>lamp.disconnected()});
 await assert.rejects(lamp.connect(),error=>error.confirmed&&error.cancelled&&/changed/.test(error.message));assert.equal(lamp.id,null);assert.equal(radio.frames.length,0);
});

test('an intentional generation change during refreshed firmware is still caught after the observer',async()=>{
 const radio=new RichRadio(),lamp=new LampTransport(radio);await lamp.connect();lamp.onFirmware=()=>lamp.disconnected();
 await assert.rejects(lamp.refreshFirmware(),/changed/);assert.equal(lamp.id,null);assert.equal(radio.frames.length,2);
});

test('direct cleanup survives a synchronous disconnect observer failure and releases the sole native link',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{onDisconnect:()=>{throw Error('Private disconnect renderer');}});await lamp.connect();
 const target=lamp.id;assert(lamp.connectionAttempts.has(target));await lamp.disconnect();
 assert.equal(lamp.id,null);assert.equal(radio.disconnects,1);assert(!lamp.connectionAttempts.has(target));
 assert.deepEqual(lamp.lastCallbackError,{version:1,callback:'disconnect',type:'threw',sequence:1});assert(Object.isFrozen(lamp.lastCallbackError));
});

test('direct cleanup does not await or leak an asynchronously rejecting disconnect observer',async()=>{
 const radio=new NativeRadio(),gate=deferred(),lamp=new LampTransport(radio,{onDisconnect:()=>gate.promise});await lamp.connect();const target=lamp.id;
 await lamp.disconnect();assert.equal(radio.disconnects,1);assert(!lamp.connectionAttempts.has(target));assert.equal(lamp.lastCallbackError,null);
 gate.reject(Error('Private disconnect rejection'));await delay(0);
 assert.deepEqual(lamp.lastCallbackError,{version:1,callback:'disconnect',type:'rejected',sequence:1});assert.equal(radio.frames.length,1);
});

for(const asynchronous of [false,true])test(`confirmed native disconnect callback releases ownership despite observer failure, async=${asynchronous}`,async()=>{
 const radio=new NativeRadio(),errors=[],lamp=new LampTransport(radio,{onDisconnect:()=>{if(asynchronous)return Promise.reject(Error('Private disconnect rejection'));throw Error('Private disconnect renderer');},onCallbackError:value=>errors.push(value)});
 await lamp.connect();const target=lamp.id;assert(lamp.connectionAttempts.has(target));assert.doesNotThrow(()=>radio.disconnected());await delay(0);
 assert.equal(lamp.id,null);assert(!lamp.connectionAttempts.has(target));assert.equal(lamp.pending,null);assert.equal(radio.disconnects,0);
 assert.equal(errors.length,1);assert.equal(errors[0].callback,'disconnect');assert.equal(errors[0].type,asynchronous?'rejected':'threw');
 await lamp.disconnect();assert.equal(radio.disconnects,0);assert.equal(errors.length,1);
});

test('late asynchronous disconnect failure cannot attach to a replacement connection',async()=>{
 const radio=new NativeRadio(),gate=deferred(),errors=[],lamp=new LampTransport(radio,{onDisconnect:()=>gate.promise,onCallbackError:value=>errors.push(value)});
 await lamp.connect();await lamp.disconnect();lamp.onDisconnect=()=>{};await lamp.connect();gate.reject(Error('Private old disconnect error'));await delay(0);
 assert.equal(lamp.id,'private-native-uuid');assert(lamp.connectionAttempts.has(lamp.id));assert.equal(lamp.lastCallbackError,null);assert.equal(errors.length,0);
 assert.equal(radio.disconnects,1);await lamp.disconnect();assert.equal(radio.disconnects,2);
});

test('disconnect observer failure cannot mask a pending command rejection or block native cleanup',async()=>{
 const radio=new NativeRadio(),lamp=new LampTransport(radio,{onDisconnect:()=>{throw Error('Private renderer');}});await lamp.connect();radio.notify=false;
 const gate=deferred();radio.writeHold=gate.promise;const job=lamp.command('brightness',173),rejected=assert.rejects(job,/disconnected/);await delay(0);
 const target=lamp.id;await lamp.disconnect();gate.resolve();await rejected;
 assert.equal(radio.disconnects,1);assert.equal(lamp.pending,null);assert(!lamp.connectionAttempts.has(target));assert.equal(radio.frames.length,2);
 assert.equal(lamp.lastCallbackError.callback,'disconnect');
});

test('a throwing disconnect diagnostic hook cannot skip actual native cleanup or recurse',async()=>{
 const radio=new NativeRadio();let observations=0;const lamp=new LampTransport(radio,{onDisconnect:()=>{throw Error('Private observer');},onCallbackError:()=>{++observations;throw Error('Private diagnostic hook');}});
 await lamp.connect();await lamp.disconnect();assert.equal(radio.disconnects,1);assert.equal(lamp.connectionAttempts.size,0);assert.equal(observations,1);
 assert.deepEqual(lamp.lastCallbackError,{version:1,callback:'disconnect',type:'threw',sequence:1});
});
