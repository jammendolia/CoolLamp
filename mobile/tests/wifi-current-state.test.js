import test from 'node:test';
import assert from 'node:assert/strict';
import {WifiTransport} from '../src/wifi.js';
import {legacyCatalog} from '../src/catalog.js';

const target='aabbccddeeff',address='192.168.1.42';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function snapshot(current=true){return {deviceId:target,hostname:'coollamp-ddeeff.local',token:'fixture-session',name:'Pink',leds:179,midpoint:73,motionPath:1,
 mode:1,brightness:81,power:true,startupMode:2,startupBrightness:100,catalogVersion:1,effects:['Fire','Rainbow'],
 colors:[[1,10,20,30],current?null:[0,40,50,60]],effectOptions:[[42,75,0,50,60,70],current?null:[50,100,0,0,0,0]],
 firmware:{version:'1.15.3',phase:0},sync:{role:0,scene:0},...(current?{stateView:1}:{})};}
function setup(t,handler){
 let clock=0;const calls=[],states=[],options=[],waits=[];
 const http={request:async request=>{calls.push({...request,startedAt:clock});return handler(request,{advance:ms=>{clock+=ms;},now:()=>clock});}};
 const lamp=new WifiTransport(http,{onState:state=>states.push(state),onOptions:value=>options.push(value)},
  {now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}});
 t.after(async()=>{await lamp.disconnect();});
 return {lamp,calls,states,options,waits,clock:()=>clock};
}
function reply(value){return {status:200,data:typeof value==='string'?value:JSON.stringify(value)};}
function paths(calls){return calls.map(call=>new URL(call.url).pathname);}
function successful(request,current=true){return reply(request.url.endsWith('/api/effects')?legacyCatalog(snapshot().effects):snapshot(current));}

test('initial current-state hint uses an authenticated GET and validates actual identity and marker before adopting settings',async t=>{
 const f=setup(t,request=>successful(request));const raw=await f.lamp.connect(address,'fixture-password',target,{currentStateRead:true});
 assert.deepEqual(paths(f.calls),['/api/state/current','/api/effects']);assert(f.calls.every(call=>call.method==='GET'&&call.data===undefined));
 assert(f.calls.every(call=>call.headers.Authorization.startsWith('Basic ')&&call.headers['X-Lamp-Token']===undefined&&call.disableRedirects===true));
 assert.equal(f.lamp.identity,target);assert.equal(raw.stateView,1);assert.equal(raw.leds,179);assert.equal(raw.midpoint,73);assert.equal(raw.startupMode,2);assert.equal(raw.startupBrightness,100);
 assert.equal(raw.colors.length,2);assert.equal(raw.colors[1],null);assert.equal(f.lamp.catalog.length,2);assert.equal(f.options[0].speed,42);
});

test('legacy default connection keeps the existing full-state GET without an opt-in selector',async t=>{
 const f=setup(t,request=>successful(request,false));await f.lamp.connect(address,'fixture-password',target);
 assert.deepEqual(paths(f.calls),['/api/state','/api/effects']);assert.equal(f.lamp.raw.stateView,undefined);assert.equal(f.lamp.raw.colors[1][1],40);
});

for(const budget of [13000,9000])test('a confirmed 404 fallback and catalog share the original '+budget+' ms connection budget',async t=>{
 const f=setup(t,(request,time)=>{
  if(request.url.endsWith('/api/state/current')){time.advance(2000);return {status:404,data:'Not found'};}
  if(request.url.endsWith('/api/state')){time.advance(5000);return reply(snapshot(false));}
  return reply(legacyCatalog(snapshot().effects));
 });
 await f.lamp.connect(address,'fixture-password',target,{currentStateRead:true,...(budget===9000?{timeoutMs:9000}:{})});
 assert.deepEqual(paths(f.calls),['/api/state/current','/api/state','/api/effects']);
 const [projection,legacy,catalog]=f.calls;
 assert.equal(projection.connectTimeout,5000);assert.equal(projection.readTimeout,8000);
 assert.equal(legacy.connectTimeout,5000);assert.equal(legacy.readTimeout,Math.min(8000,budget-2000));
 assert.equal(catalog.connectTimeout,Math.min(5000,budget-7000));assert.equal(catalog.readTimeout,Math.min(8000,budget-7000));
 assert.equal(f.lamp.currentStateRead,false);assert.equal(f.lamp.raw.stateView,undefined);assert(f.calls.every(call=>call.method==='GET'));
});

for(const budget of [13000,9000])test('expiration during a 404 fallback cannot grant a new catalog or connection budget '+budget,async t=>{
 const f=setup(t,(request,time)=>{
  if(request.url.endsWith('/api/state/current')){time.advance(1000);return {status:404,data:'Not found'};}
  time.advance(budget-1000);return reply(snapshot(false));
 });
 await assert.rejects(f.lamp.connect(address,'fixture-password',target,{currentStateRead:true,...(budget===9000?{timeoutMs:9000}:{})}),error=>error.requestDeadline&&error.uncertain);
 assert.deepEqual(paths(f.calls),['/api/state/current','/api/state']);assert.equal(f.lamp.raw,null);assert.equal(f.states.length,0);
});

test('default standalone refresh retains its single 13-second budget across projection fallback and catalog',async t=>{
 const f=setup(t,request=>successful(request,false));await f.lamp.connect(address,'fixture-password',target);
 f.calls.length=0;f.lamp.currentStateRead=true;f.lamp.catalog=null;
 f.lamp.http.request=async request=>{
  f.calls.push({...request,startedAt:f.clock()});
  if(request.url.endsWith('/api/state/current')){await f.lamp.wait(2000);return {status:404,data:'Not found'};}
  if(request.url.endsWith('/api/state')){await f.lamp.wait(5000);return reply(snapshot(false));}
  return reply(legacyCatalog(snapshot().effects));
 };
 await f.lamp.refresh(target);assert.deepEqual(paths(f.calls),['/api/state/current','/api/state','/api/effects']);assert.equal(f.calls[2].readTimeout,6000);
 // The shared deadline is six seconds after the seven seconds above.
 assert.equal(f.calls[2].connectTimeout,5000);assert.equal(f.calls[2].startedAt,7000);
});

for(const budget of [13000,9000])test('a one-time catalog mismatch retry keeps the original '+budget+' ms current-view budget',async t=>{
 let catalogReads=0;const f=setup(t,(request,time)=>{
  if(request.url.endsWith('/api/state/current')){time.advance(2000);return reply(snapshot());}
  catalogReads++;if(catalogReads===1){time.advance(3000);return reply(legacyCatalog(['Fire']));}
  return reply(legacyCatalog(snapshot().effects));
 });
 await f.lamp.connect(address,'fixture-password',target,{currentStateRead:true,...(budget===9000?{timeoutMs:9000}:{})});
 assert.deepEqual(paths(f.calls),['/api/state/current','/api/effects','/api/state/current','/api/effects']);
 assert.equal(f.calls[2].readTimeout,Math.min(8000,budget-5000));assert.equal(f.calls[3].readTimeout,Math.min(8000,budget-7000));
 assert.equal(catalogReads,2);assert.equal(f.states.length,1);assert(f.calls.every(call=>call.method==='GET'));
});

for(const [name,alter] of [
 ['wrong marker',raw=>{raw.stateView=2;}],['missing marker',raw=>{delete raw.stateView;}],
 ['invalid active pair',raw=>{raw.colors[0]=null;}],['invalid tuning',raw=>{raw.effectOptions[0][0]=0;}],
 ['unmarked inactive pair',raw=>{raw.colors[1]=[0,1,2,3];}],['wrong identity',raw=>{raw.deviceId='112233445566';}],
 ['wrong identity with a matching legacy hostname',raw=>{raw.deviceId='112233445566';raw.hostname=target+'.local';}]
])test('initial hint '+name+' cannot adopt the response or fall back to a different view',async t=>{
 const raw=snapshot();alter(raw);const f=setup(t,()=>reply(raw));
 await assert.rejects(f.lamp.connect(address,'fixture-password',target,{currentStateRead:true}));
 assert.deepEqual(paths(f.calls),['/api/state/current']);assert.equal(f.lamp.raw,null);assert.equal(f.states.length,0);assert.equal(f.options.length,0);
});

for(const [status,data] of [[401,'Unauthorized'],[503,'State response memory unavailable. Nothing changed.'],[500,'Failed'],[200,'{malformed']])test('current-state '+status+' failure is not mistaken for an unsupported 404',async t=>{
 const f=setup(t,()=>({status,data}));await assert.rejects(f.lamp.connect(address,'fixture-password',target,{currentStateRead:true}));
 assert.deepEqual(paths(f.calls),['/api/state/current']);assert.equal(f.lamp.raw,null);assert.equal(f.states.length,0);assert(f.calls.every(call=>call.method==='GET'));
});

test('bounded busy-read retries stay on the current view and never become a full-state fallback or mutation',async t=>{
 const f=setup(t,()=>({status:503,data:'Read resources unavailable. Nothing changed.'}));
 await assert.rejects(f.lamp.connect(address,'fixture-password',target,{currentStateRead:true,timeoutMs:9000}),error=>error.status===503&&error.confirmed);
 assert.equal(f.calls.length,6);assert(f.calls.every(call=>call.url.endsWith('/api/state/current')&&call.method==='GET'));assert.deepEqual(f.waits,[500,1000,1500,1000,1000]);
 assert.equal(f.lamp.raw,null);assert.equal(f.states.length,0);assert(f.calls.at(-1).readTimeout<9000);
});

test('a verified stateView marker selects the current alias for subsequent refreshes without another saved-version hint',async t=>{
 const f=setup(t,request=>successful(request));await f.lamp.connect(address,'fixture-password',target);f.calls.length=0;
 await f.lamp.refresh(target);assert.deepEqual(paths(f.calls),['/api/state/current']);assert.equal(f.lamp.raw.stateView,1);assert.equal(f.states.length,2);
});

test('a cancelled native current-view response cannot update caches or issue a catalog request',async t=>{
 let admitted=true;const started=deferred(),gate=deferred();const f=setup(t,async()=>{started.resolve();await gate.promise;return reply(snapshot());});
 const pending=f.lamp.connect(address,'fixture-password',target,{currentStateRead:true,guard:()=>admitted});await started.promise;admitted=false;gate.resolve();
 await assert.rejects(pending,error=>error.cancelled&&error.confirmed&&error.backgroundCancelled);assert.deepEqual(paths(f.calls),['/api/state/current']);assert.equal(f.states.length,0);assert.equal(f.lamp.raw,null);
});

test('a rejected current-view refresh preserves the previously verified cache and never falls back or mutates',async t=>{
 let invalid=false;const f=setup(t,request=>{const raw=snapshot();if(invalid){raw.colors[0]=null;return reply(raw);}return successful(request);});
 await f.lamp.connect(address,'fixture-password',target,{currentStateRead:true});const previous=f.lamp.raw,state=f.lamp.state;f.calls.length=0;invalid=true;
 await assert.rejects(f.lamp.refresh(target),/Invalid current settings/);assert.equal(f.lamp.raw,previous);assert.equal(f.lamp.state,state);
 assert.deepEqual(paths(f.calls),['/api/state/current']);assert.equal(f.states.length,1);assert.equal(f.options.length,1);
});

test('a new connection resets a prior current-state hint before accessing an older lamp',async t=>{
 let current=true;const f=setup(t,request=>successful(request,current));await f.lamp.connect(address,'fixture-password',target,{currentStateRead:true});await f.lamp.disconnect();
 current=false;f.calls.length=0;await f.lamp.connect(address,'fixture-password',target);assert.deepEqual(paths(f.calls),['/api/state','/api/effects']);assert.equal(f.lamp.currentStateRead,false);
});
