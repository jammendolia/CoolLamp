import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {WifiTransport} from '../src/wifi.js';

const id='aabbccddeeff',base='http://192.168.1.20';
const busy='Another response is pending. This request was not executed.';
const resourceBusy='Read resources unavailable. Nothing changed.';
const paths=['/api/state','/api/effects','/api/audio','/api/firmware',
  '/api/descriptor','/api/revision','/api/diagnostics','/api/firmware/upload/status'];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const raw=()=>({deviceId:id,token:'fixture-token',hostname:'coollamp-ddeeff.local',mode:1,brightness:100,
  effects:['Rain'],catalogVersion:1,firmware:{version:'1.15.2'}});
const catalog=[{id:1,name:'Rain',category:'calm',speed:true}];
const cancelled=error=>error.cancelled===true&&error.backgroundCancelled===true&&error.confirmed===true;
function fixture(t){
  let time=0,handler=()=>({status:200,data:'OK'}),waitHandler=null;
  const calls=[],waits=[],events=[];
  const lamp=new WifiTransport({request:async options=>{calls.push({...options,at:time});return handler(options,calls.length);}},
    {onState:value=>events.push(value)},
    {now:()=>time,wait:async ms=>{waits.push(ms);if(waitHandler)await waitHandler(ms);time+=ms;}});
  Object.assign(lamp,{base,identity:id,authorization:'Basic fixture',raw:raw()});
  t.after(()=>lamp.disconnect());
  return {lamp,calls,waits,events,handle:fn=>{handler=fn;},onWait:fn=>{waitHandler=fn;},advance:ms=>{time+=ms;},get time(){return time;}};
}

for(const path of paths)for(const text of [busy,resourceBusy])test('only exact busy GET is retried on the same route: '+path+' '+text,async t=>{
  const f=fixture(t);f.handle((_,count)=>count===1?{status:503,data:text}:{status:200,data:'fresh'});
  assert.equal(await f.lamp.request(path),'fresh');assert.deepEqual(f.waits,[500]);
  assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.url===base+path&&call.method==='GET'&&call.headers.Authorization==='Basic fixture'&&call.disableRedirects));
  assert.deepEqual(f.calls.map(call=>[call.connectTimeout,call.readTimeout]),[[5000,8000],[5000,8000]]);
});

test('busy exhaustion has at most six native calls and returns the last confirmed refusal',async t=>{
  const f=fixture(t);f.handle(()=>({status:503,data:busy}));
  await assert.rejects(f.lamp.request('/api/state'),error=>error.status===503&&error.confirmed===true&&!error.uncertain&&error.message===busy);
  assert.equal(f.calls.length,6);assert.deepEqual(f.waits,[500,1000,1500,1000,1000]);assert.equal(f.time,5000);
});

for(const path of ['/api/wifi/scan','/api/scan','/api/firmware/check','/api/firmware/install','/api/firmware/commit',
  '/api/mesh/enroll/start','/api/sync/invite','/api/receipt','/api/effects/schema','/api/state?fresh=1','/api/unknown'])
test('unknown and side-effect-capable GET paths never retry: '+path,async t=>{
  const f=fixture(t);f.handle(()=>({status:503,data:busy}));
  await assert.rejects(f.lamp.request(path),error=>error.status===503&&error.confirmed===true);
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
});

for(const path of [...paths,'/api/power','/api/firmware/install','/api/firmware/upload/commit','/api/mesh/enroll/start'])
test('POST never retries even when the reply says not executed: '+path,async t=>{
  const f=fixture(t);let submitted=0;f.handle(()=>({status:503,data:busy}));
  await assert.rejects(f.lamp.request(path,{on:1},f.lamp.epoch,()=>submitted++),error=>error.status===503&&error.confirmed===true);
  assert.equal(submitted,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'POST');
  assert.equal(f.calls[0].headers['X-Lamp-Token'],'fixture-token');assert.deepEqual(f.waits,[]);
});

for(const [status,data]of [[401,busy],[403,busy],[409,busy],[500,busy],[503,'Updater busy.'],[503,busy+'\n'],[503,{message:busy}],[503,null]])
test('authentication, unrelated refusal and malformed busy data do not retry: '+status+' '+JSON.stringify(data),async t=>{
  const f=fixture(t);f.handle(()=>({status,data}));
  await assert.rejects(f.lamp.request('/api/state'),error=>error.status===status&&error.confirmed===true&&(status!==401||error.needsPassword));
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
});

for(const mutation of [false,true])test('a lost native reply is never retried, mutation='+mutation,async t=>{
  const f=fixture(t);f.handle(()=>{throw Error('Native timeout with private details.');});
  await assert.rejects(f.lamp.request('/api/state',mutation?{on:0}:undefined),error=>error.uncertain===true&&!error.confirmed&& !error.message.includes('private'));
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
});

for(const moment of ['before-native','after-native','before-wait','after-wait'])
test('read admission cancellation fences each native/wait boundary: '+moment,async t=>{
  const f=fixture(t);let allowed=true;
  if(moment==='before-native')allowed=false;
  f.handle(()=>{if(moment==='after-native')allowed=false;return {status:503,get data(){if(moment==='before-wait')allowed=false;return busy;}};});
  const guard=()=>allowed;
  if(moment==='after-wait')f.onWait(()=>{allowed=false;});
  await assert.rejects(f.lamp.request('/api/state',undefined,f.lamp.epoch,null,guard),cancelled);
  assert.equal(f.calls.length,moment==='before-native'?0:1);assert.equal(f.waits.length,moment==='after-wait'?1:0);
});

for(const key of ['epoch','base','identity','authorization','token'])for(const moment of ['native','wait'])
test('target, credentials and session cannot change across retry '+key+' '+moment,async t=>{
  const f=fixture(t);const change=()=>{if(key==='token')f.lamp.raw.token='replacement-token';else if(key==='epoch')f.lamp.epoch++;else f.lamp[key]='replacement';};
  f.handle(()=>{if(moment==='native')change();return {status:503,data:busy};});
  if(moment==='wait')f.onWait(change);
  await assert.rejects(f.lamp.request('/api/state'),/Connection changed/);
  assert.equal(f.calls.length,1);assert.equal(f.waits.length,moment==='wait'?1:0);
});

test('an unexpired last refusal returns immediately when another wait would consume the deadline',async t=>{
  const f=fixture(t);f.handle(()=>{f.advance(100);return {status:503,data:busy};});
  await assert.rejects(f.lamp.request('/api/state',undefined,f.lamp.epoch,null,null,600),error=>error.confirmed===true&&error.status===503);
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);assert.equal(f.time,100);
  assert.equal(f.calls[0].connectTimeout,600);assert.equal(f.calls[0].readTimeout,600);
});

test('remaining native timeout shrinks across every retry rather than restarting the original budget',async t=>{
  const f=fixture(t);f.handle((_,count)=>{f.advance(1000);return count===3?{status:200,data:'fresh'}:{status:503,data:busy};});
  assert.equal(await f.lamp.request('/api/state',undefined,f.lamp.epoch,null,null,6000),'fresh');
  assert.deepEqual(f.calls.map(call=>[call.at,call.connectTimeout,call.readTimeout]),[[0,5000,6000],[1500,4500,4500],[3500,2500,2500]]);
  assert.equal(f.time,4500);
});

test('an expired read is not accepted or retried even if native reports success after its deadline',async t=>{
  const f=fixture(t);f.handle(()=>{f.advance(13000);return {status:200,data:'late'};});
  await assert.rejects(f.lamp.request('/api/state'),error=>error.requestDeadline===true&&error.uncertain===true);
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
});

test('a delayed timer or backgrounded wait cannot start another native read after the total deadline',async t=>{
  const f=fixture(t);f.handle(()=>({status:503,data:busy}));f.onWait(()=>f.advance(6000));
  await assert.rejects(f.lamp.request('/api/state',undefined,f.lamp.epoch,null,null,6000),error=>error.requestDeadline===true);
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[500]);
});

test('a native read that never finishes cannot extend the total deadline, and its late result is ignored',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t),native=deferred();f.handle(()=>native.promise);
  const pending=f.lamp.request('/api/state',undefined,f.lamp.epoch,null,null,6000);
  const rejected=assert.rejects(pending,error=>error.requestDeadline===true&&error.uncertain===true);
  t.mock.timers.tick(6000);await rejected;native.resolve({status:200,data:'late'});await nextTurn();
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);assert.deepEqual(f.events,[]);
});

test('connect shares its six-second deadline across state, busy waits and catalog',async t=>{
  const f=fixture(t);let stateReads=0,catalogReads=0;
  f.handle(options=>{
    if(options.url.endsWith('/api/state')){f.advance(stateReads++?1000:2000);return stateReads===1?{status:503,data:busy}:{status:200,data:JSON.stringify(raw())};}
    f.advance(catalogReads++?1400:500);return catalogReads===1?{status:503,data:resourceBusy}:{status:200,data:catalog};
  });
  const result=await f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:6000});clearTimeout(f.lamp.timer);
  assert.equal(result.deviceId,id);assert.equal(f.time,5900);
  assert.deepEqual(f.calls.map(call=>[new URL(call.url).pathname,call.connectTimeout,call.readTimeout]),[
    ['/api/state',5000,6000],['/api/state',3500,3500],['/api/effects',2500,2500],['/api/effects',1500,1500]]);
  assert.deepEqual(f.waits,[500,500]);assert.equal(f.events.length,1);
});

test('a five-second retained response clears within a shared nine-second state and catalog connection budget',async t=>{
  const f=fixture(t);f.handle(options=>{
    if(options.url.endsWith('/api/state')){
      if(f.time<5000){f.advance(100);return {status:503,data:busy};}
      f.advance(1900);return {status:200,data:JSON.stringify(raw())};
    }
    f.advance(1000);return {status:200,data:catalog};
  });
  const result=await f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:9000});clearTimeout(f.lamp.timer);
  assert.equal(result.deviceId,id);assert.equal(f.time,8400);assert.equal(f.events.length,1);
  assert.deepEqual(f.waits,[500,1000,1500,1000,1000]);
  assert.deepEqual(f.calls.map(call=>[new URL(call.url).pathname,call.at,call.connectTimeout,call.readTimeout]),[
    ['/api/state',0,5000,8000],['/api/state',600,5000,8000],['/api/state',1700,5000,7300],
    ['/api/state',3300,5000,5700],['/api/state',4400,4600,4600],['/api/state',5500,3500,3500],
    ['/api/effects',7400,1600,1600]]);
});

test('persistent busy within a nine-second connection still has a six-call bound and never loads a catalog',async t=>{
  const f=fixture(t);f.handle(()=>{f.advance(100);return {status:503,data:busy};});
  await assert.rejects(f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:9000}),error=>error.status===503&&error.confirmed===true&&!error.uncertain);
  assert.equal(f.calls.length,6);assert.equal(f.time,5600);assert(f.calls.every(call=>call.url.endsWith('/api/state')));
  assert.deepEqual(f.waits,[500,1000,1500,1000,1000]);assert.equal(f.lamp.identity,null);assert.equal(f.lamp.state,null);assert.deepEqual(f.events,[]);
});

test('a late final state after five busy waits cannot extend the nine-second deadline or issue a catalog read',async t=>{
  const f=fixture(t);f.handle((_,count)=>{
    if(count<=5){f.advance(100);return {status:503,data:busy};}
    f.advance(3500);return {status:200,data:JSON.stringify(raw())};
  });
  await assert.rejects(f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:9000}),error=>error.requestDeadline===true&&error.uncertain===true);
  assert.equal(f.time,9000);assert.equal(f.calls.length,6);assert(f.calls.every(call=>call.url.endsWith('/api/state')));
  assert.equal(f.calls.at(-1).connectTimeout,3500);assert.equal(f.calls.at(-1).readTimeout,3500);
  assert.deepEqual(f.waits,[500,1000,1500,1000,1000]);assert.equal(f.lamp.state,null);assert.deepEqual(f.events,[]);
});

test('catalog size reload cannot restart an expired connection budget or enable controls',async t=>{
  const f=fixture(t);f.handle(options=>{
    f.advance(3000);return {status:200,data:options.url.endsWith('/api/state')?JSON.stringify(raw()):[]};
  });
  await assert.rejects(f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:6000}),error=>error.requestDeadline===true);
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(call=>call.readTimeout),[6000,3000]);
  assert.equal(f.lamp.identity,null);assert.equal(f.lamp.state,null);assert.deepEqual(f.events,[]);
});

test('a busy state response does not bypass canonical identity validation before catalog or callbacks',async t=>{
  const f=fixture(t);f.handle((_,count)=>count===1?{status:503,data:busy}:{status:200,data:JSON.stringify({...raw(),deviceId:'ffeeddccbbaa'})});
  await assert.rejects(f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs:6000}),/different lamp/);
  assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.url.endsWith('/api/state')));assert.deepEqual(f.events,[]);assert.equal(f.lamp.state,null);
});

for(const timeoutMs of [0,-1,NaN,Infinity])test('invalid connection budget does no I/O: '+timeoutMs,async t=>{
  const f=fixture(t);await assert.rejects(f.lamp.connect('192.168.1.20','fixture-password',id,{timeoutMs}),/timeout/);assert.deepEqual(f.calls,[]);
});
