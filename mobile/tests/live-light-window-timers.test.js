import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LiveLightQueue} from '../src/live-light.js';

const source=readFileSync(new URL('../src/live-light.js',import.meta.url),'utf8').replace('export class LiveLightQueue','class LiveLightQueue');

function windowHarness({fail=false,strictSet=true}={}){
 const context={sent:[],errors:[],discarded:[],timerCalls:[],fail,strictSet};
 runInNewContext(`
  let time=0,nextTimer=0,ready=true;
  const timers=new Map(),scope={id:'aabbccddeeff',target:{},epoch:1,mode:4};
  globalThis.setTimeout=function(callback,delay){
   if(strictSet&&this!==globalThis)throw TypeError('Can only call Window.setTimeout on instances of Window');
   const id=++nextTimer;timers.set(id,{callback,delay});timerCalls.push('set');return id;
  };
  globalThis.clearTimeout=function(id){
   if(this!==globalThis)throw TypeError('Can only call Window.clearTimeout on instances of Window');
   timers.delete(id);timerCalls.push('clear');
  };
  globalThis.performance={now(){if(this!==globalThis.performance)throw TypeError('Invalid Performance receiver');return time;}};
  ${source}
  const queue=new LiveLightQueue({current:()=>true,ready:()=>ready,
   send:async value=>{sent.push(value);if(fail)throw Object.assign(Error('Receipt lost'),{uncertain:true});},
   error:value=>errors.push(value),discarded:(value,reason)=>discarded.push(reason)});
  globalThis.api={queue,schedule:value=>queue.schedule(scope,'brightness',value),
   speed:value=>queue.schedule(scope,'effectOptions',{mode:4,speed:value},'speed'),cancel:()=>queue.cancel(),
   size:()=>timers.size,ready:value=>ready=value,time:value=>time=value,
   async turn(){for(const [id,timer]of [...timers]){timers.delete(id);timer.callback();}await Promise.resolve();await Promise.resolve();}
  };
 `,context);
 return {...context.api,...context};
}

test('default Window timers coalesce continuous slider input and submit its latest value once',async()=>{
 const f=windowHarness();for(let value=1;value<=255;value++)assert.equal(f.schedule(value),true);
 assert.equal(f.size(),1);assert.deepEqual(f.timerCalls,['set']);await f.turn();await f.turn();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].value,255);assert.equal(f.size(),0);assert.equal(f.queue.pending,false);
});

test('default Window timer cancellation removes a queued change before it can be sent',async()=>{
 const f=windowHarness({strictSet:false});f.schedule(20);f.cancel();await f.turn();
 assert.deepEqual(f.timerCalls,['set','clear']);assert.equal(f.size(),0);assert.equal(f.sent.length,0);assert.equal(f.queue.pending,false);
});

test('default Window timers rearm while busy and discard expired input without a write',async()=>{
 const f=windowHarness();f.ready(false);f.schedule(30);await f.turn();
 assert.equal(f.sent.length,0);assert.equal(f.size(),1);assert.deepEqual(f.timerCalls,['set','set']);
 f.time(10001);f.ready(true);await f.turn();
 assert.equal(f.sent.length,0);assert.equal(f.size(),0);assert.equal(f.queue.pending,false);assert.deepEqual(f.discarded,['expired']);
});

test('default Window timers never replay an uncertain submitted change or its queued successor',async()=>{
 const f=windowHarness({fail:true});f.schedule(40);f.speed(50);await f.turn();await f.turn();
 assert.equal(f.sent.length,1);assert.equal(f.errors.length,1);assert.equal(f.errors[0].uncertain,true);
 assert.equal(f.size(),0);assert.equal(f.queue.pending,false);
});

test('custom timer injection retains its scheduler and cancellation contract',()=>{
 const calls=[];let scheduled;
 const queue=new LiveLightQueue({current:()=>true,send:async()=>assert.fail('Cancelled work cannot send'),
  set:function(callback,delay){assert.equal(this,queue);calls.push(['set',delay]);scheduled=callback;return 'custom-timer';},
  clear:function(timer){assert.equal(this,queue);calls.push(['clear',timer]);scheduled=null;},now:()=>0});
 assert.equal(queue.schedule({id:'aabbccddeeff',target:{},epoch:1,mode:4},'brightness',20),true);queue.cancel();
 assert.equal(scheduled,null);assert.deepEqual(calls,[['set',120],['clear','custom-timer']]);assert.equal(queue.pending,false);
});
