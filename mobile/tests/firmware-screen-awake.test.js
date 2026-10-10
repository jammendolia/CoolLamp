import test from 'node:test';
import assert from 'node:assert/strict';
import {FirmwareScreenAwake} from '../src/firmware-screen-awake.js';
const token='1'.repeat(32),nextToken='2'.repeat(32);
function receiver(){let active=null;const calls=[];return {calls,get active(){return active;},setFirmwareScreenAwake:async value=>{calls.push({...value});if(value.enabled){if(active&&active!==value.token)throw Error('Another lease is active.');active=value.token;}else if(active===value.token)active=null;return {active:active!==null};}};}
test('one Bluetooth attempt keeps the same lease across work and releases exactly once',async()=>{
 const native=receiver(),lease=new FirmwareScreenAwake({native,token});await Promise.all([lease.acquire(),lease.acquire()]);assert.equal(native.active,token);
 await Promise.all([lease.release(),lease.release()]);assert.equal(native.active,null);assert.deepEqual(native.calls,[{token,enabled:true},{token,enabled:false}]);
});
test('Wi-Fi/web paths do not call the native screen API',async()=>{const native=receiver(),lease=new FirmwareScreenAwake({native,enabled:false,token});await lease.acquire();await lease.release();assert.deepEqual(native.calls,[]);});
test('failed screen protection rejects before any transfer can be started and cleans up its token',async()=>{
 const calls=[],native={setFirmwareScreenAwake:async value=>{calls.push(value);if(value.enabled)throw Error('Not foreground.');return {active:false};}},lease=new FirmwareScreenAwake({native,token});
 await assert.rejects(lease.acquire(),/No firmware was sent.*screen unlocked/);assert.deepEqual(calls,[{token,enabled:true},{token,enabled:false}]);
});
test('unconfirmed native protection cannot silently start an update',async()=>{const native={setFirmwareScreenAwake:async()=>({active:false})},lease=new FirmwareScreenAwake({native,token});await assert.rejects(lease.acquire(),/No firmware was sent/);});
test('cancellation before acquisition performs no native action',async()=>{const native=receiver(),abort=new AbortController();abort.abort('app-hidden');await assert.rejects(new FirmwareScreenAwake({native,token}).acquire({signal:abort.signal}),error=>error.cancelled&&error.stopReason==='app-hidden');assert.deepEqual(native.calls,[]);});
test('late native acquisition after app-hidden cancellation is released and cannot orphan screen protection',async()=>{
 const native=receiver(),send=native.setFirmwareScreenAwake,abort=new AbortController();let deliver;
 native.setFirmwareScreenAwake=value=>value.enabled?new Promise(resolve=>deliver=async()=>resolve(await send(value))):send(value);
 const lease=new FirmwareScreenAwake({native,token}),work=lease.acquire({signal:abort.signal});await Promise.resolve();await Promise.resolve();abort.abort('app-hidden');await assert.rejects(work,error=>error.stopReason==='app-hidden');
 assert.equal(native.active,null);await deliver();await Promise.resolve();await Promise.resolve();assert.equal(native.active,null);assert.equal(native.calls.filter(value=>!value.enabled).length,2);
});
test('late release from an old attempt preserves a newer screen-awake lease',async()=>{
 const native=receiver(),lease=new FirmwareScreenAwake({native,token});await lease.acquire();await lease.release();const fresh=new FirmwareScreenAwake({native,token:nextToken});await fresh.acquire();
 await native.setFirmwareScreenAwake({token,enabled:false});assert.equal(native.active,nextToken);await fresh.release();assert.equal(native.active,null);
});
test('a bounded native acquisition timeout fails safely and cleans up its eventual reply',async()=>{
 const native=receiver(),send=native.setFirmwareScreenAwake;let deliver;native.setFirmwareScreenAwake=value=>value.enabled?new Promise(resolve=>deliver=async()=>resolve(await send(value))):send(value);
 const lease=new FirmwareScreenAwake({native,token,timeout:10});await assert.rejects(lease.acquire(),/No firmware was sent/);await deliver();await Promise.resolve();await Promise.resolve();assert.equal(native.active,null);
});
