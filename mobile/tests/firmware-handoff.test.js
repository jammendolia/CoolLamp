import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareHandoff} from '../src/firmware-handoff.js';

const id='0123456789abcdef0123456789abcdef';

test('native handoff brackets only the supplied durable operation',async()=>{
 const calls=[],native={
  beginFirmwareHandoff:async value=>{calls.push(['begin',value]);return {active:true};},
  endFirmwareHandoff:async value=>{calls.push(['end',value]);return {active:false};}
 };
 const handoff=new FirmwareHandoff({native,enabled:true});
 const result=await handoff.run(id,async()=>{calls.push(['operation']);return 'accepted';});
 assert.equal(result,'accepted');
 assert.deepEqual(calls,[['begin',{sessionId:id}],['operation'],['end',{sessionId:id}]]);
});

test('native handoff failure prevents the mutation operation',async()=>{
 let ran=false,ended=false;
 const handoff=new FirmwareHandoff({enabled:true,native:{
  beginFirmwareHandoff:async()=>{throw Error('unavailable');},
  endFirmwareHandoff:async()=>{ended=true;}
 }});
 await assert.rejects(handoff.run(id,async()=>{ran=true;}),/unavailable/);
 assert.equal(ran,false);assert.equal(ended,false);
});

test('native handoff always ends and cleanup cannot replace the operation result',async()=>{
 let ended=0;
 const handoff=new FirmwareHandoff({enabled:true,native:{
  beginFirmwareHandoff:async()=>({active:true}),
  endFirmwareHandoff:async()=>{++ended;throw Error('already expired');}
 }});
 assert.equal(await handoff.run(id,async()=>42),42);assert.equal(ended,1);
 const failure=Error('network result uncertain');
 await assert.rejects(handoff.run(id,async()=>{throw failure;}),error=>error===failure);
 assert.equal(ended,2);
});

test('nested work for the same session revalidates one native lease',async()=>{
 const events=[],handoff=new FirmwareHandoff({enabled:true,native:{
  beginFirmwareHandoff:async()=>{events.push('begin');return {active:true};},
  endFirmwareHandoff:async()=>{events.push('end');return {active:false};}
 }});
 await handoff.run(id,async()=>{events.push('outer');await handoff.run(id,async()=>events.push('inner'));});
 assert.deepEqual(events,['begin','outer','begin','inner','end']);
});

test('nested mutation reacquires a native lease that expired during preflight',async()=>{
 let active=false,begins=0,ends=0;
 const handoff=new FirmwareHandoff({enabled:true,native:{
  beginFirmwareHandoff:async()=>{if(!active){active=true;++begins;}return {active:true};},
  endFirmwareHandoff:async()=>{if(active){active=false;++ends;}return {active:false};}
 }});
 await handoff.run(id,async()=>{
  active=false; // Model UIKit expiration while a preflight await is suspended.
  await handoff.run(id,async()=>assert.equal(active,true));
 });
 assert.equal(begins,2);assert.equal(ends,1);assert.equal(active,false);
});

test('disabled handoff runs without a native plugin',async()=>{
 const handoff=new FirmwareHandoff({enabled:false});
 assert.equal(await handoff.run(id,async()=>7),7);
});
