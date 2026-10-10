import test from 'node:test';
import assert from 'node:assert/strict';
import {SettingsConnectionRecovery} from '../src/settings-recovery.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(reconnect,options={}){
  const context={id:'lamp-a',name:'Reading lamp',section:'network',navigation:7,active:true,connected:false,blocked:false,hidden:false};
  const statuses=[],failures=[],calls=[];
  const recovery=new SettingsConnectionRecovery({getContext:()=>context,reconnect:async input=>{calls.push(input);return reconnect(input,context);},
    onStatus:value=>statuses.push(value),onFailure:value=>failures.push(value),timeoutMs:200,retryDelayMs:2,maxAttempts:2,...options});
  return {context,statuses,failures,calls,recovery};
}

test('successful settings recovery requires the same scope and a verified connected context',async()=>{
  const f=fixture(async(input,context)=>{assert.equal(input.id,'lamp-a');assert.equal(input.section,'network');assert.equal(input.navigation,7);assert(input.isCurrent());assert.equal(input.signal.aborted,false);context.connected=true;return {connected:true};});
  const result=await f.recovery.check();assert.equal(result.state,'connected');assert.equal(f.recovery.active,false);
  assert.deepEqual(f.statuses.map(value=>value.state),['reconnecting','connected']);assert.equal(f.failures.length,0);assert.equal(f.calls.length,1);
  assert.equal((await f.recovery.check()).state,'idle');assert.equal(f.calls.length,1);f.recovery.dispose();
});

test('simultaneous disconnect checks share one job and cannot duplicate connection attempts',async()=>{
  const pending=deferred(),f=fixture(async(_,context)=>{await pending.promise;context.connected=true;});
  const first=f.recovery.check(),second=f.recovery.check(),third=f.recovery.check();
  assert.equal(first,second);assert.equal(second,third);assert.equal(f.recovery.active,true);await tick();assert.equal(f.calls.length,1);
  pending.resolve();assert.equal((await first).state,'connected');f.recovery.dispose();
});

test('a verified state callback keeps adapter ownership until the connection promise completes',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise),running=f.recovery.check();await tick();
  f.context.connected=true;assert.equal(f.recovery.check(),running);assert.equal(f.recovery.active,true);
  assert.equal(f.calls[0].signal.aborted,false);assert.equal(f.calls[0].isCurrent(),true);
  pending.resolve();assert.equal((await running).state,'connected');assert.equal(f.recovery.active,false);f.recovery.dispose();
});

test('immediate cancellation or an externally established link prevents an unnecessary adapter call',async()=>{
  const cancelled=fixture(async()=>{}),running=cancelled.recovery.check();cancelled.recovery.cancel();
  assert.equal((await running).state,'cancelled');await tick();assert.equal(cancelled.calls.length,0);cancelled.recovery.dispose();
  const connected=fixture(async()=>{}),connecting=connected.recovery.check();connected.context.connected=true;
  assert.equal((await connecting).state,'connected');assert.equal(connected.calls.length,0);connected.recovery.dispose();
});

test('one failed route attempt retries within the original job and deadline',async()=>{
  const f=fixture(async(input,context)=>{if(input.attempt===1)throw Error('Route unavailable');context.connected=true;});
  assert.equal((await f.recovery.check()).state,'connected');assert.deepEqual(f.calls.map(value=>value.attempt),[1,2]);
  assert.deepEqual(f.statuses.map(value=>[value.state,value.attempt]),[['reconnecting',1],['reconnecting',2],['connected',2]]);assert.equal(f.failures.length,0);f.recovery.dispose();
});

test('exhausted attempts call the current scope failure callback exactly once',async()=>{
  const f=fixture(async()=>{throw Error('No verified route');});
  const first=f.recovery.check();assert.equal(first,f.recovery.check());assert.equal((await first).state,'failed');
  assert.equal(f.calls.length,2);assert.equal(f.failures.length,1);assert.equal(f.failures[0].id,'lamp-a');assert.equal(f.failures[0].section,'network');
  assert.equal(f.failures[0].attempt,2);assert.equal(f.failures[0].timeout,false);assert.match(f.failures[0].error.message,/No verified route/);
  assert.equal(f.statuses.at(-1).state,'idle');assert.equal(f.recovery.active,false);f.recovery.dispose();
});

test('a returned success does not replace verified link evidence',async()=>{
  const f=fixture(async()=>({connected:true}));
  const result=await f.recovery.check();assert.equal(result.state,'failed');assert.equal(f.calls.length,2);assert.equal(f.failures[0].error.code,'SETTINGS_LINK_NOT_VERIFIED');f.recovery.dispose();
});

test('global deadline aborts a hanging reconnect and safely consumes a late rejection',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise,{timeoutMs:25,retryDelayMs:2});
  const result=await f.recovery.check();assert.equal(result.state,'failed');assert.equal(result.error.timeout,true);
  assert.equal(f.failures.length,1);assert.equal(f.failures[0].timeout,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[0].isCurrent(),false);
  pending.reject(Error('Late radio error'));await tick();assert.equal(f.failures.length,1);assert.equal(f.statuses.at(-1).state,'idle');f.recovery.dispose();
});

test('retry delay does not extend the overall recovery deadline',async()=>{
  const f=fixture(async()=>{throw Error('No route');},{timeoutMs:20,retryDelayMs:100,maxAttempts:5});
  const result=await f.recovery.check();assert.equal(result.error.timeout,true);assert.equal(f.calls.length,1);assert.equal(f.failures.length,1);
  await wait(30);assert.equal(f.calls.length,1);f.recovery.dispose();
});

test('selection, navigation, and settings section changes cancel without reporting failure',async()=>{
  for(const change of [context=>{context.id='lamp-b';},context=>{context.navigation++;},context=>{context.section='hardware';},context=>{context.active=false;}]){
    const pending=deferred(),f=fixture(()=>pending.promise);const running=f.recovery.check();await tick();change(f.context);
    // A newly eligible scope can wait, but may not overlap this old flight.
    const next=f.recovery.check();assert.equal((await running).state,'cancelled');assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[0].isCurrent(),false);
    f.recovery.cancel();pending.reject(Error('Old scope failure'));await tick();await next;
    assert.equal(f.failures.length,0);assert.equal(f.calls.length,1);f.recovery.dispose();
  }
});

test('late success cannot report connection for a different selection',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);const old=f.recovery.check();await tick();f.context.id='lamp-b';f.context.connected=true;
  await f.recovery.check();assert.equal((await old).state,'cancelled');pending.resolve();await tick();
  assert.equal(f.statuses.filter(value=>value.state==='connected').length,0);assert.equal(f.failures.length,0);f.recovery.dispose();
});

test('an old aborted native promise retains its lane until it settles',async()=>{
  const oldFlight=deferred();let nativeActive=0,peak=0;
  const f=fixture(async(input,context)=>{nativeActive++;peak=Math.max(peak,nativeActive);try{if(input.id==='lamp-a')await oldFlight.promise;else context.connected=true;}finally{nativeActive--;}});
  const old=f.recovery.check();await tick();f.context.id='lamp-b';f.context.name='Window lamp';f.context.navigation++;
  const next=f.recovery.check();assert.equal((await old).state,'cancelled');await tick();assert.equal(f.calls.length,1);assert.equal(f.recovery.active,true);
  oldFlight.resolve();assert.equal((await next).state,'connected');assert.equal(f.calls.length,2);assert.equal(f.calls[1].id,'lamp-b');assert.equal(peak,1);assert.equal(nativeActive,0);f.recovery.dispose();
});

test('a replacement job can time out while waiting without overlapping the ignored abort',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise,{timeoutMs:25});const old=f.recovery.check();await tick();
  f.context.id='lamp-b';f.context.navigation++;const next=f.recovery.check();assert.equal((await old).state,'cancelled');
  assert.equal((await next).state,'failed');assert.equal(f.calls.length,1);assert.equal(f.failures.length,1);assert.equal(f.failures[0].id,'lamp-b');
  pending.resolve();await tick();assert.equal(f.calls.length,1);assert.equal(f.failures.length,1);f.recovery.dispose();
});

test('firmware or intentional connection ownership prevents recovery and cancels an existing job quietly',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise);f.context.blocked=true;
  assert.equal((await f.recovery.check()).state,'idle');assert.equal(f.calls.length,0);
  f.context.blocked=false;const running=f.recovery.check();await tick();f.context.blocked=true;
  assert.equal((await f.recovery.check()).state,'idle');assert.equal((await running).state,'cancelled');assert.equal(f.calls[0].signal.aborted,true);
  pending.reject(Error('Connection superseded'));await tick();assert.equal(f.failures.length,0);f.recovery.dispose();
});

test('hiding settings cancels quietly and foreground check starts fresh after the old flight settles',async()=>{
  const old=deferred(),f=fixture(async(input,context)=>{if(f.calls.length===1)await old.promise;else context.connected=true;});
  const backgroundJob=f.recovery.check();await tick();f.context.hidden=true;
  assert.equal((await f.recovery.check()).state,'idle');assert.equal((await backgroundJob).state,'cancelled');assert.equal(f.failures.length,0);
  f.context.hidden=false;const foregroundJob=f.recovery.check();assert.notEqual(foregroundJob,backgroundJob);await tick();assert.equal(f.calls.length,1);
  old.resolve();assert.equal((await foregroundJob).state,'connected');assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].signal,f.calls[1].signal);f.recovery.dispose();
});

test('deadline suppresses failure when the view has become hidden even without another check',async()=>{
  const pending=deferred(),f=fixture(()=>pending.promise,{timeoutMs:20});const running=f.recovery.check();await tick();f.context.hidden=true;
  assert.equal((await running).state,'cancelled');assert.equal(f.failures.length,0);assert.equal(f.calls[0].signal.aborted,true);
  pending.resolve();await tick();f.recovery.dispose();
});

test('manual cancel and disposal settle jobs, suppress late callbacks, and clear retry timers',async()=>{
  const f=fixture(async()=>{throw Error('Retry later');},{retryDelayMs:50});const running=f.recovery.check();await tick();f.recovery.cancel();
  assert.equal((await running).state,'cancelled');await wait(60);assert.equal(f.calls.length,1);assert.equal(f.failures.length,0);
  f.recovery.dispose();assert.equal((await f.recovery.check()).state,'idle');assert.equal(f.calls.length,1);f.recovery.dispose();
});

test('synchronous adapter throws and throwing UI callbacks cannot leak a public rejection',async()=>{
  const f=fixture(()=>{throw Error('Synchronous radio failure');},{onStatus:()=>{throw Error('UI failure');},onFailure:()=>{throw Error('UI failure');},maxAttempts:1});
  assert.equal((await f.recovery.check()).state,'failed');assert.equal(f.recovery.active,false);f.recovery.dispose();
});
