import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareScreenAwake} from '../src/firmware-screen-awake.js';
import {initializeGroupRadio} from '../src/bluetooth-groups.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function acquireCardFirmwareBluetooth(');
const end=source.indexOf('\nfunction rememberVerifiedUpdateResult(',start);
assert(start>=0&&end>start);
const handler=source.slice(start,end),id='f0b950b2f180';
function fixture({authorized=true,active=false}={}){
 const calls=[],entry={id,deviceId:'authorized-peripheral',accessoryManaged:authorized};
 let current=true,inspectionHook=async()=>{},radioHook=async()=>{},connectHook=async()=>{};
 const owner={abort:new AbortController(),isCurrent:()=>current},tasks=new Map([[id,owner]]),instances=[];
 const bleLamp={identity:id,initialization:Promise.resolve(),disconnect:async()=>calls.push('active-disconnect')};
 class Transport{
  constructor(ble,options){this.options=options;this.epoch=1;instances.push(this);calls.push('new-transport');}
  async connect(saved,retry,options){this.saved=saved;this.connectOptions=options;calls.push('connect');await connectHook(this);}
  async disconnect(){calls.push('disconnect');}
 }
 const context={AbortController,Error,Map,clearTimeout,FirmwareScreenAwake,LampTransport:Transport,BleClient:{},
  cardFirmwareTasks:tasks,isNative:true,phonePlatform:'ios',native:{setFirmwareScreenAwake:async value=>{calls.push(value.enabled?'awake-on':'awake-off');return {active:value.enabled};}},
  stopGroupInspection:async()=>{calls.push('stop-inspection');await inspectionHook();},
  initializeGroupRadio:async()=>{calls.push('initialize-radio');await radioHook();},bleLamp,
  verifiedSelectedLamp:()=>active,selected:entry,lamp:bleLamp,bluetoothFirmwareTask:null,
  pairing:{},accessoryNative:{},store:{items:[entry]},savedDevice:null,removedAccessoryIds:new Set(),
  rememberAccessories(){throw Error('Unexpected authorization mutation');},renderLamps:()=>calls.push('render'),
  firmwareFleetTrust:{provision(){throw Error('Unexpected fleet/NVS mutation');}},
  liveGroupBluetooth:{set(){throw Error('Restricted update lease exposed as group control');},delete(){throw Error('Unexpected group lease deletion');}}
 };
 runInNewContext(handler+';globalThis.acquire=acquireCardFirmwareBluetooth;',context);
 return {calls,entry,owner,tasks,instances,context,acquire:()=>context.acquire(entry),
  stale:()=>current=false,inspection:fn=>inspectionHook=fn,radio:fn=>radioHook=fn,connect:fn=>connectHook=fn,
  cleanup:()=>owner.screenAwake?.release()};
}
test('actual card updater acquires a restricted firmware connection without fleet provisioning or group registration',async t=>{
 const f=fixture();t.after(f.cleanup);const lease=await f.acquire(),transport=f.instances[0];
 assert.equal(transport.options.firmwareOnly,true);assert.equal(transport.options.controlOnly,undefined);
 assert.equal(transport.options.expectedDeviceIdentity,id);assert.equal(transport.options.firmwareBulkWrites,true);
 assert.equal(transport.saved.lampId,id);assert.equal(transport.connectOptions.signal,f.owner.abort.signal);
 assert.equal(transport.connectOptions.isCurrent,f.owner.isCurrent);assert.equal(f.owner.transport,transport);
 assert.equal(lease.lamp,transport);await lease.release();assert.equal(f.owner.transport,null);
 assert.equal(f.calls.filter(x=>x==='disconnect').length,1);
});
test('healthy target retires its full-state polling and adopts a private lease without waiting on an old unresolved command lane',async t=>{
 const f=fixture({active:true});t.after(f.cleanup);let polled=false;
 f.context.bleLamp.controlTimer=setTimeout(()=>{polled=true;},15);f.context.bleLamp.controlTail=new Promise(()=>{});
 const lease=await f.acquire();assert.notEqual(lease.lamp,f.context.bleLamp);assert.equal(lease.lamp.options.firmwareOnly,true);assert.equal(f.context.bleLamp.controlTimer,null);
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(polled,false);await lease.release();
});
test('an already verified target is retired for private reads without recreating its authorized radio or fleet enrollment',async t=>{
 const f=fixture({active:true});t.after(f.cleanup);const lease=await f.acquire();
 assert.equal(lease.lamp,f.instances[0]);assert.equal(lease.lamp.options.firmwareOnly,true);assert.equal(f.context.bluetoothFirmwareTask,null);
 assert.equal(f.instances.length,1);assert(!f.calls.includes('initialize-radio'));await lease.release();assert.equal(f.owner.transport,null);
 assert.equal(f.calls.filter(x=>x==='active-disconnect').length,1);
});
test('cancellation before acquisition performs no radio work or firmware mutation',async()=>{
 const f=fixture();f.owner.abort.abort('user');await assert.rejects(f.acquire(),error=>error.cancelled);
 assert.deepEqual(f.calls,[]);assert.equal(f.instances.length,0);
});
test('an unauthorized iPhone target cannot start a firmware connection',async t=>{
 const f=fixture({authorized:false});t.after(f.cleanup);
 f.context.lamp={identity:id,disconnect:async()=>{throw Error('Ineligible target lost its selected route');}};
 await assert.rejects(f.acquire(),error=>error.unauthorized&&error.installationNotStarted);
 assert.equal(f.instances.length,0);assert(!f.calls.includes('initialize-radio'));
});
test('a replaced task after screen protection or group inspection cannot adopt a connection',async t=>{
 const f=fixture();t.after(f.cleanup);f.inspection(async()=>f.tasks.set(id,{isCurrent:()=>true}));
 await assert.rejects(f.acquire(),error=>error.cancelled);assert.equal(f.instances.length,0);
});
test('cancellation during native radio setup prevents transport creation',async t=>{
 const f=fixture();t.after(f.cleanup);f.radio(async()=>f.owner.abort.abort('app-hidden'));
 await assert.rejects(f.acquire(),error=>error.cancelled);assert.equal(f.instances.length,0);
});
test('a late connection after target removal is cleaned up and cannot expose restricted controls',async t=>{
 const f=fixture();t.after(f.cleanup);f.connect(async()=>f.stale());
 await assert.rejects(f.acquire(),error=>error.cancelled);assert.equal(f.owner.transport,null);
 assert.equal(f.calls.filter(x=>x==='disconnect').length,1);
});
test('connection failure releases the private transport and its caller can release screen protection exactly once',async t=>{
 const f=fixture();t.after(f.cleanup);f.connect(async()=>{throw Error('Protected identity failed');});
 await assert.rejects(f.acquire(),/Protected identity/);assert.equal(f.owner.transport,null);
 assert.equal(f.calls.filter(x=>x==='disconnect').length,1);await f.cleanup();await f.cleanup();
 assert.equal(f.calls.filter(x=>x==='awake-off').length,1);
});
test('actual native initializer authorizes only the update target despite unrelated legacy cards',async t=>{
 const f=fixture();t.after(f.cleanup);
 f.entry.deviceId='AAAAAAAA-0000-0000-0000-000000000001';
 f.context.store.items.push({id:'112233445566',deviceId:'BBBBBBBB-0000-0000-0000-000000000002'});
 f.context.bleLamp.initialization=null;
 f.context.accessoryNative.list=async()=>({supported:true,devices:[f.entry]});
 f.context.BleClient.initialize=async()=>f.calls.push('native-radio-initialized');
 f.context.rememberAccessories=()=>f.calls.push('authorized-inventory');
 f.context.initializeGroupRadio=initializeGroupRadio;
 const lease=await f.acquire();assert.equal(lease.lamp.saved.deviceId,f.entry.deviceId);
 assert.equal(f.calls.filter(x=>x==='native-radio-initialized').length,1);
 assert.equal(f.context.pairing.radioStarted,true);await lease.release();
});

test('private update retires a selected same-target Wi-Fi or mesh poller before connecting',async t=>{
 const f=fixture();t.after(f.cleanup);f.context.lamp={identity:id,disconnect:async()=>f.calls.push('target-poller-disconnect')};
 const lease=await f.acquire();assert(f.calls.indexOf('target-poller-disconnect')<f.calls.indexOf('connect'));
 assert.equal(f.calls.filter(x=>x==='target-poller-disconnect').length,1);await lease.release();
});
test('private update leaves an unrelated selected transport alone and fences retirement owner loss',async t=>{
 const f=fixture();t.after(f.cleanup);f.context.lamp={identity:'112233445566',disconnect:async()=>{throw Error('Unrelated poller disconnected');}};
 const lease=await f.acquire();await lease.release();
 const stale=fixture();t.after(stale.cleanup);stale.context.lamp={identity:id,disconnect:async()=>stale.stale()};
 await assert.rejects(stale.acquire(),error=>error.cancelled);assert.equal(stale.instances.length,0);
});
