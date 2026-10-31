import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const id='bceeb1a28dcc';
const source=readFileSync(new URL('../src/connection-broker.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const settle=async()=>{for(let i=0;i<20;++i)await Promise.resolve();};

// Node's native timers accept an arbitrary receiver. Execute the real broker
// with Window-like timers that reject the same invalid receiver as WKWebView.
function fixture(){
 const context={AbortController};
 runInNewContext(`
  let time=100,next=0;const timers=new Map(),calls=[];
  globalThis.setTimeout=function(callback,delay){
   if(this!==globalThis)throw TypeError('Can only call Window.setTimeout on instances of Window');
   const handle=++next;timers.set(handle,{callback,at:time+delay});calls.push('set');return handle;
  };
  globalThis.clearTimeout=function(handle){
   if(this!==globalThis)throw TypeError('Can only call Window.clearTimeout on instances of Window');
   calls.push('clear');timers.delete(handle);
  };
  ${source}
  globalThis.broker=new ConnectionBroker({now:()=>time});
  globalThis.clock={timers,calls,advance(ms){
   const until=time+ms;
   for(;;){const due=[...timers].filter(([,value])=>value.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].callback();
   }time=until;
  }};
 `,context);
 return context;
}

test('default browser timers allow an authenticated connection to finish and clear its acquisition deadline',async()=>{
 const {broker,clock}=fixture();let scope,releases=0;
 const value={lamp:{identity:id},release:()=>{releases++;}};
 assert.equal(await broker.select(id,{routes:[{kind:'mesh',acquire:context=>{scope=context;return value;}}],verify:lease=>lease.lamp.identity===id}),value);
 assert.equal(broker.get(id).state,'ready');assert.equal(clock.timers.size,0);assert.equal(releases,0);
 assert(clock.calls.includes('set'));assert(clock.calls.includes('clear'));scope.dispose();assert.equal(broker.active.size,0);
});

test('default browser timer cleanup permits a read-only fallback without a timer receiver error',async()=>{
 const {broker,clock}=fixture(),calls=[];let scope;
 await broker.select(id,{routes:[
  {kind:'mesh',acquire:()=>{calls.push('mesh');throw Object.assign(Error('No route'),{noRoute:true});}},
  {kind:'wifi',acquire:context=>{scope=context;calls.push('wifi');return {lamp:{identity:id},release(){}};}}
 ],verify:lease=>lease.lamp.identity===id});
 assert.deepEqual(calls,['mesh','wifi']);assert.equal(clock.timers.size,0);scope.dispose();
});

test('default browser timeout retires its attempt and releases a late lease once',async()=>{
 const {broker,clock}=fixture();let resolve,old,accepted,releases=0;
 const pending=new Promise(done=>resolve=done);
 const result=broker.select(id,{timeoutMs:100,routes:[
  {kind:'mesh',timeoutMs:10,acquire:context=>{old=context;return pending;}},
  {kind:'wifi',acquire:context=>{accepted=context;return {lamp:{identity:id},release(){}};}}
 ],verify:lease=>lease.lamp.identity===id});
 await settle();clock.advance(10);await settle();await result;
 assert.equal(old.signal.aborted,true);assert.equal(clock.timers.size,0);
 resolve({lamp:{identity:id},release:()=>{releases++;}});await settle();assert.equal(releases,1);accepted.dispose();
});

test('default browser timers preserve parent cancellation and release an acquired verification lease',async()=>{
 const {broker,clock}=fixture(),parent=new AbortController();let releases=0,finish;
 const waiting=new Promise(done=>finish=done);
 const result=broker.select(id,{signal:parent.signal,routes:[{kind:'bluetooth',acquire:()=>({lamp:{identity:id},release:()=>{releases++;}})}],verify:()=>waiting});
 const rejected=assert.rejects(result,error=>error.cancelled===true);
 await settle();parent.abort();await rejected;finish(true);await settle();
 assert.equal(releases,1);assert.equal(clock.timers.size,0);assert.equal(broker.active.size,0);
});
