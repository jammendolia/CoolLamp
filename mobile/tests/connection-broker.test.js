import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {ConnectionBroker,readOnlyConnectionFailure} from '../src/connection-broker.js';

const id='bceeb1a28dcc',other='5432e99205d4';
const fail=fields=>Object.assign(Error('Route did not finish.'),fields);
const deferred=()=>{let resolve,reject;const promise=new Promise((done,error)=>{resolve=done;reject=error;});return {promise,resolve,reject};};
const settle=async()=>{for(let turn=0;turn<16;turn++)await Promise.resolve();};
const verify=value=>value?.lamp?.identity===id;
const lease=(release=()=>{},identity=id)=>({lamp:{identity},release});
function fixture(options={}){
 let time=100,next=0;const timers=new Map();
 const clock={now:()=>time,setTimer:(callback,ms)=>{const key=++next;timers.set(key,{callback,at:time+ms});return key;},clearTimer:key=>timers.delete(key)};
 return {broker:new ConnectionBroker({...clock,...options}),advance(ms){const until=time+ms;for(;;){const found=[...timers].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!found)break;time=found[1].at;timers.delete(found[0]);found[1].callback();}time=until;},timers};
}
const raw=(name='Sonata Left')=>({deviceId:id,name,mode:4,power:true,brightness:100,leds:128,firmware:{version:'1.15.7'},
 sync:{version:2,role:0,leader:'',active:false,paused:false,maxMembers:9,maxSupportedMembers:32,protocolVersions:[2,3],order:[]}});

test('automatic acquisition prefers mesh, then Wi-Fi, then Bluetooth without guessing access',async()=>{
 const {broker}=fixture(),calls=[],value=lease();
 const routes=[{kind:'bluetooth',acquire:()=>{calls.push('bluetooth');return value;}},
  {kind:'wifi',acquire:()=>{calls.push('wifi');throw fail({needsPassword:true});}},
  {kind:'mesh',acquire:()=>{calls.push('mesh');throw fail({noRoute:true});}}];
 assert.equal(await broker.select(id,{routes,verify}),value);assert.deepEqual(calls,['mesh','wifi','bluetooth']);
 assert.equal(broker.get(id).route,'bluetooth');assert.equal(broker.get(id).state,'ready');
});

test('a successful first mesh route does not open direct Wi-Fi or Bluetooth',async()=>{
 const {broker}=fixture(),calls=[];await broker.select(id,{verify,routes:['bluetooth','wifi','mesh'].map(kind=>({kind,acquire:()=>{calls.push(kind);return lease();}}))});
 assert.deepEqual(calls,['mesh']);
});

test('an explicit Wi-Fi-only request never crosses to another connection type',async()=>{
 const {broker}=fixture(),calls=[];await assert.rejects(broker.select(id,{only:'wifi',verify,routes:['mesh','wifi','bluetooth'].map(kind=>({kind,acquire:()=>{calls.push(kind);throw fail({needsPassword:true});}}))}),error=>error.needsPassword);
 assert.deepEqual(calls,['wifi']);
});

for(const fields of [{cancelled:true},{uncertain:true},{identity:true},{identityChanged:true},{stale:true},{needsAuthorization:true},{settingsUnavailable:true},{resourceRefusal:true},{targetResourceRefusal:true},{name:'AbortError'}])test('terminal acquisition refusal never falls through: '+Object.keys(fields).join(','),async()=>{
 const {broker}=fixture(),calls=[];const error=fail(fields);
 await assert.rejects(broker.select(id,{verify,routes:[{kind:'mesh',acquire:()=>{calls.push('mesh');throw error;}},{kind:'wifi',acquire:()=>{calls.push('wifi');return lease();}}]}),value=>value===error);
 assert.deepEqual(calls,['mesh']);
});

test('route-local pairing failure permits a different authenticated read route',async()=>{
 const {broker}=fixture(),calls=[];await broker.select(id,{only:['mesh','wifi'],verify,routes:[{kind:'mesh',acquire:()=>{calls.push('mesh');throw fail({needsPairing:true});}},{kind:'wifi',acquire:()=>{calls.push('wifi');return lease();}}]});assert.deepEqual(calls,['mesh','wifi']);
});

test('verification is required and identity refusal releases the wrong lease once',async()=>{
 const {broker}=fixture();let attempts=0,releases=0;
 await assert.rejects(broker.select(id,{routes:[{kind:'mesh',acquire:()=>{attempts++;return lease();}}]}));assert.equal(attempts,0);
 await assert.rejects(broker.select(id,{verify,routes:[{kind:'mesh',acquire:()=>lease(()=>{releases++;},other)},{kind:'wifi',acquire:()=>{attempts++;return lease();}}]}),error=>error.identityChanged);
 assert.equal(attempts,0);assert.equal(releases,1);
});

test('legacy protected Bluetooth proof works without pretending a modern JSON snapshot exists',async()=>{
 const {broker}=fixture(),value={connected:true,protectedDeviceIdentity:id};
 assert.equal(await broker.select(id,{verify:value=>value.protectedDeviceIdentity===id,routes:[{kind:'bluetooth',acquire:()=>value}]}),value);
 assert.equal(broker.get(id).verified,true);assert.equal(broker.get(id).raw,undefined);
});

test('verified connection cannot refresh an old state or catalog after its new observation is rejected',async()=>{
 const f=fixture(),catalog=[{id:1,name:'Fire',category:'fire',speed:true}];
 assert(f.broker.observe(id,{raw:raw('Old state'),catalog,route:'wifi'}));f.advance(20);let context;
 await f.broker.select(id,{routes:[{kind:'bluetooth',acquire:value=>{context=value;return lease();}}],verify:(_value,value)=>{
  assert.equal(f.broker.observe(id,{raw:{...raw('Rejected'),deviceId:other},catalog,route:'bluetooth',generation:value.generation}),false);return true;
 }});
 const sample=f.broker.get(id);assert.equal(sample.route,'bluetooth');assert.equal(sample.verified,true);
 assert.equal(sample.raw,undefined);assert.equal(sample.catalog,undefined);context.dispose();
});

test('accepted observation retains its exact state and catalog through connection publication',async()=>{
 const f=fixture(),catalog=[{id:1,name:'Fire',category:'fire',speed:true}];let context;
 await f.broker.select(id,{routes:[{kind:'mesh',acquire:value=>{context=value;return lease();}}],verify:(_value,value)=>
  f.broker.observe(id,{raw:raw('New observation'),catalog,route:'mesh',generation:value.generation})});
 assert.equal(f.broker.get(id).raw.name,'New observation');assert.equal(f.broker.get(id).catalog[0].name,'Fire');context.dispose();
});

test('route timeout retires that guard and releases a late lease while Wi-Fi remains usable',async()=>{
 const f=fixture(),late=deferred();let mesh,wifi,releases=0;
 const pending=f.broker.select(id,{timeoutMs:25,verify,routes:[{kind:'mesh',timeoutMs:6,acquire:context=>{mesh=context;return late.promise;}},{kind:'wifi',acquire:context=>{wifi=context;return lease();}}]});
 await settle();assert.equal(mesh.remainingMs(),6);f.advance(6);await settle();await pending;
 assert.equal(mesh.signal.aborted,true);assert.equal(mesh.isCurrent(),false);assert.equal(wifi.isCurrent(),true);
 late.resolve(lease(()=>{releases++;}));await settle();assert.equal(releases,1);assert.equal(f.broker.get(id).route,'wifi');
 f.advance(100000);assert.equal(wifi.isCurrent(),true,'the accepted persistent route has no acquisition deadline');assert.doesNotThrow(wifi.guard);
 wifi.dispose();assert.equal(wifi.isCurrent(),false);
});

test('the shared deadline includes asynchronous verification and releases the acquired route',async()=>{
 const f=fixture(),waiting=deferred();let releases=0,context;
 const request=f.broker.select(id,{timeoutMs:12,verify:()=>waiting.promise,routes:[{kind:'mesh',acquire:value=>{context=value;return lease(()=>{releases++;});}}]});
 const rejected=assert.rejects(request,error=>error.connectionTimeout);await settle();f.advance(12);await rejected;
 assert.equal(releases,1);assert.equal(context.signal.aborted,true);waiting.resolve(true);await settle();assert.equal(f.broker.get(id).available,false);assert.equal(releases,1);
});

test('parent cancellation promptly rejects a hung acquisition and cleans a late provider',async()=>{
 const f=fixture(),parent=new AbortController(),late=deferred();let context,releases=0;
 const request=f.broker.select(id,{signal:parent.signal,verify,routes:[{kind:'mesh',acquire:value=>{context=value;return late.promise;}}]});
 const rejected=assert.rejects(request,error=>error.cancelled);await settle();parent.abort();await rejected;assert.equal(context.signal.aborted,true);
 late.resolve(lease(()=>{releases++;}));await settle();assert.equal(releases,1);assert.equal(f.timers.size,0);
});

test('a selected context forwards cancellation and dispose removes its parent listener',async()=>{
 const f=fixture(),parent=new AbortController();let context;
 await f.broker.select(id,{signal:parent.signal,verify,routes:[{kind:'wifi',acquire:value=>{context=value;return lease();}}]});
 assert.equal(getEventListeners(parent.signal,'abort').length,1);parent.abort();assert.equal(context.signal.aborted,true);assert.equal(context.isCurrent(),false);assert.equal(getEventListeners(parent.signal,'abort').length,0);
 const second=new AbortController();await f.broker.select(id,{signal:second.signal,verify,routes:[{kind:'wifi',acquire:value=>{context=value;return lease();}}]});
 context.dispose();context.dispose();assert.equal(getEventListeners(second.signal,'abort').length,0);assert.throws(context.guard,error=>error.cancelled);
});

test('forget cancels pending work immediately and prevents its old observation ticket from restoring state',async()=>{
 const f=fixture(),late=deferred();let context,releases=0;
 const request=f.broker.select(id,{verify,routes:[{kind:'mesh',acquire:value=>{context=value;return late.promise;}}]});const rejected=assert.rejects(request,error=>error.cancelled);await settle();
 f.broker.forget(id);await rejected;assert.equal(f.broker.get(id).state,'unknown');assert.equal(f.broker.observe(id,{route:'mesh',raw:raw(),generation:context.generation}),false);
 late.resolve(lease(()=>{releases++;}));await settle();assert.equal(releases,1);
});

test('invalidate retires an accepted persistent route and makes its sample unavailable',async()=>{
 const {broker}=fixture();let context;await broker.select(id,{verify,routes:[{kind:'wifi',acquire:value=>{context=value;return lease();}}]});broker.observe(id,{raw:raw(),route:'wifi'});
 broker.invalidate(id);assert.equal(context.signal.aborted,true);assert.equal(context.isCurrent(),false);assert.equal(broker.get(id).available,false);assert.equal(broker.get(id).raw.deviceId,id);
});

test('public observations retain display and group state but never credentials or control secrets',()=>{
 const f=fixture(),value=raw();Object.assign(value,{password:'private-password',token:'private-token',fleetKey:'private-fleet',address:'private-address'});
 value.sync={version:3,role:1,leader:id,maxMembers:32,maxSupportedMembers:32,incarnation:'a'.repeat(32),key:'private-key',invite:'private-invite',session:'private-session',order:[{id,name:'Sonata Left',online:true,password:'private-row'}],peers:[{id:other,name:'Sonata Right',address:'private-peer'}]};
 const catalog=[{id:1,name:'Fire',category:'fire',speed:true,token:'private-catalog'}];
 assert.equal(f.broker.observe(id,{raw:value,catalog,route:'mesh'}),true);const sample=f.broker.get(id),encoded=JSON.stringify(sample);
 assert.equal(encoded.includes('private-'),false);assert.equal(sample.raw.sync.order[0].id,id);assert.equal(sample.catalog[0].name,'Fire');assert.equal(sample.raw.leds,128);
 value.name='Changed externally';catalog[0].name='Changed catalog';assert.equal(sample.raw.name,'Sonata Left');assert.equal(f.broker.get(id).catalog[0].name,'Fire');
 assert.throws(()=>{sample.raw.sync.order.push({id:other});},TypeError);
});

test('wrong identity, malformed state, stale or future observations cannot replace a verified sample',()=>{
 const f=fixture();assert(f.broker.observe(id,{raw:raw(),route:'wifi'}));f.advance(5);
 for(const change of [{raw:{...raw(),deviceId:other}},{raw:{...raw(),mode:0}},{raw:{...raw(),sync:{version:3,role:1,leader:other,maxMembers:32}}},{checkedAt:99},{checkedAt:106},{catalog:[{id:2,name:'bad'}]}])assert.equal(f.broker.observe(id,{raw:raw('Rejected'),route:'mesh',...change}),false);
 assert.equal(f.broker.get(id).raw.name,'Sonata Left');assert.equal(f.broker.get(id).route,'wifi');
});

test('confirmed samples expire without erasing the last known lamp state',()=>{
 const f=fixture({ttl:15});f.broker.observe(id,{raw:raw(),route:'mesh'});f.advance(14);assert.equal(f.broker.get(id).fresh,true);f.advance(1);
 const value=f.broker.get(id);assert.equal(value.state,'stale');assert.equal(value.fresh,false);assert.equal(value.verified,false);assert.equal(value.available,false);assert.equal(value.raw.mode,4);
});

test('older route failures cannot overwrite a newer independently confirmed sample',async()=>{
 const f=fixture(),late=deferred();const request=f.broker.select(id,{verify,routes:[{kind:'mesh',acquire:()=>late.promise}]});const rejected=assert.rejects(request,error=>error.noRoute);await settle();
 f.advance(1);assert(f.broker.observe(id,{raw:raw('New read'),route:'wifi'}));late.reject(fail({noRoute:true}));await rejected;
 assert.equal(f.broker.get(id).state,'ready');assert.equal(f.broker.get(id).raw.name,'New read');
});

test('an older concurrent selection cannot publish its state after a newer selection',async()=>{
 const f=fixture(),old=deferred();let older,newer;
 const a=f.broker.select(id,{routes:[{kind:'mesh',acquire:context=>{older=context;return old.promise;}}],verify:()=>true});await settle();
 await f.broker.select(id,{routes:[{kind:'wifi',acquire:context=>{newer=context;return lease();}}],verify:(value,context)=>f.broker.observe(id,{raw:raw('New selection'),route:'wifi',generation:context.generation})});
 assert.equal(f.broker.observe(id,{raw:raw('Late old selection'),route:'mesh',generation:older.generation}),false);
 old.resolve(lease());await a;assert.equal(f.broker.get(id).raw.name,'New selection');assert.equal(f.broker.get(id).route,'wifi');older.dispose();newer.dispose();
});

test('presentation errors cannot reopen routes or turn one verified acquisition into a retry',async()=>{
 const f=fixture({onStatus:()=>{throw Error('Render failed.');}});let count=0;
 await f.broker.select(id,{verify,onStatus:()=>{throw Error('View changed.');},routes:[{kind:'mesh',acquire:()=>{count++;return lease();}},{kind:'wifi',acquire:()=>{count++;return lease();}}]});assert.equal(count,1);assert.equal(f.broker.get(id).state,'ready');
});

test('invalid or already-cancelled selections never contact a provider',async()=>{
 const {broker}=fixture();let called=0;const options={verify,routes:[{kind:'mesh',acquire:()=>{called++;return lease();}}]};
 await assert.rejects(broker.select('wrong-id',options));await assert.rejects(broker.select(id,{...options,isCurrent:()=>false}),error=>error.cancelled);
 const controller=new AbortController();controller.abort();await assert.rejects(broker.select(id,{...options,signal:controller.signal}),error=>error.cancelled);assert.equal(called,0);
});

test('a caller-known read-only acquisition can classify uncertainty without mutating its source error',async()=>{
 const details={httpStatus:503},source=Object.assign(new TypeError('Read response lost.'),{uncertain:true,confirmed:false,details,needsPassword:true});
 const converted=readOnlyConnectionFailure(source);
 assert(converted instanceof Error);assert.notEqual(converted,source);assert.equal(converted.name,'TypeError');assert.equal(converted.message,source.message);
 assert.equal(converted.cause,source);assert.equal(converted.details,details);assert.equal(converted.confirmed,false);assert.equal(converted.needsPassword,true);
 assert.equal(converted.uncertain,false);assert.equal(converted.readUncertain,true);assert.equal(source.uncertain,true);assert.equal(source.readUncertain,undefined);assert.equal(source.cause,undefined);
 const {broker}=fixture(),calls=[];await broker.select(id,{verify,routes:[{kind:'mesh',acquire:()=>{calls.push('mesh');throw converted;}},{kind:'wifi',acquire:()=>{calls.push('wifi');return lease();}}]});assert.deepEqual(calls,['mesh','wifi']);
});

for(const fields of [{cancelled:true},{name:'AbortError'},{identity:true},{identityChanged:true},{stale:true},{needsAuthorization:true},{settingsUnavailable:true},{resourceRefusal:true},{targetResourceRefusal:true}])test('read-only classification preserves a terminal refusal: '+Object.keys(fields).join(','),()=>{
 const source=fail({uncertain:true,...fields});assert.equal(readOnlyConnectionFailure(source),source);assert.equal(source.uncertain,true);assert.equal(source.readUncertain,undefined);
});

test('unknown acquisition uncertainty remains terminal unless its caller explicitly classifies the read boundary',async()=>{
 for(const error of [Error('Ordinary read failure'),undefined,null,'failure'])assert.equal(readOnlyConnectionFailure(error),error);
 const {broker}=fixture(),source=fail({uncertain:true});let calls=0;
 await assert.rejects(broker.select(id,{verify,routes:[{kind:'mesh',acquire:()=>{throw source;}},{kind:'wifi',acquire:()=>{calls++;return lease();}}]}),value=>value===source);assert.equal(calls,0);assert.equal(source.uncertain,true);
});
