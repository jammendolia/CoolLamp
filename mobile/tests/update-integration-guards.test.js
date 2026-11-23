import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareAttemptJournal} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),identity='f0b950b2f180';
const marker='beforeMutation:({identity,path,expectedVersion})=>{',start=source.indexOf(marker),end=source.indexOf('\n},aroundJobStart:',start);
assert(start>=0&&end>start);const hook=source.slice(start+marker.length,end);
const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n512\n'+'a'.repeat(64)+'\n');
function fixture(){
 const rows=new Map(),journal=new FirmwareAttemptJournal({getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)});
 const context={Error,firmwareAttempts:journal,legacyFirmwareReceipts:new Map(),cardFirmwareTasks:new Map(),fleetUpdateAttempts:new Map(),fleetUpdating:false,fleetApprovedRelease:manifest};
 runInNewContext('globalThis.hook=({identity,path,expectedVersion})=>{'+hook+'};',context);return {context,journal,invoke:path=>context.hook({identity,path,expectedVersion:manifest.version})};
}
test('central production guard blocks every fleet route while another attempt is pending',()=>{
 const f=fixture(),attempt=f.journal.begin(identity,manifest);f.journal.beforeWrite(attempt,{operation:1,session:77});
 assert.throws(()=>f.invoke('/api/firmware/install'),error=>error.requiresReconciliation);
 f.context.fleetUpdating=true;assert.throws(()=>f.invoke('/api/firmware/check'),error=>error.requiresReconciliation);
 assert.equal(f.journal.get(identity).wifiInstallAttempted,false);assert.equal(f.context.fleetUpdateAttempts.size,0);
});
test('central production guard persists bulk intent against the exact approved artifact before POST',()=>{
 const f=fixture();f.context.fleetUpdating=true;f.invoke('/api/firmware/check');f.invoke('/api/firmware/install');
 const attempt=f.journal.get(identity);assert.equal(attempt.text,manifest.text);assert.equal(attempt.wifiInstallAttempted,true);
 assert.equal(f.context.fleetUpdateAttempts.get(identity).attemptId,attempt.attemptId);
});
test('central production guard also fences a legacy uncertain receipt before a fleet POST',()=>{
 const f=fixture();f.context.legacyFirmwareReceipts.set(identity,{targetVersion:'1.15.1',outcome:'verification-required'});f.context.fleetUpdating=true;
 assert.throws(()=>f.invoke('/api/firmware/install'),error=>error.requiresReconciliation);assert.equal(f.journal.get(identity),null);assert.equal(f.context.fleetUpdateAttempts.size,0);
});
test('legacy Bluetooth button delegates to the shared update coordinator or read-only pending check',async()=>{
 const first=source.indexOf("$('installBluetoothFirmware').onclick=async()=>{"),last=source.indexOf('\n};',first),calls=[],entry={id:identity};
 const context={selected:entry,busy:false,connecting:false,fleetUpdating:false,lamp:'same',bleLamp:'same',
  firmwareAttempts:{pending:()=>[]},legacyFirmwareReceipts:new Map(),mergedLampEntries:()=>[entry],bluetoothFirmwareOwner:()=>null,updatingLamp:()=>false,verifiedSelectedLamp:()=>true,
  checkLampUpdateResult:async value=>calls.push(['check',value.id]),updateLampCard:async(value,options)=>calls.push(['update',value.id,{...options}]),$:()=>({checked:true})};
 runInNewContext('globalThis.run=async()=>{'+source.slice(first+"$('installBluetoothFirmware').onclick=async()=>{".length,last)+'};',context);
 await context.run();assert.deepEqual(calls,[['update',identity,{bluetoothOnly:true,allowReinstall:true}]]);
 calls.length=0;context.firmwareAttempts.pending=()=>[{identity}];await context.run();assert.deepEqual(calls,[['check',identity]]);
 calls.length=0;context.firmwareAttempts.pending=()=>[];context.legacyFirmwareReceipts.set(identity,{targetVersion:'1.15.1',outcome:'verified-restarting'});await context.run();assert.deepEqual(calls,[['check',identity]]);
});
test('a generic equal-version status cannot clear a legacy or journal reconciliation fence',()=>{
 const first=source.indexOf('function confirmInstalledFirmware('),last=source.indexOf('\nfunction independentLightingAllowed(',first),calls=[],context={
  firmwareAttempts:{get:()=>null,pending:()=>[]},legacyFirmwareReceipts:new Map([[identity,{targetVersion:'1.15.1'}]]),
  firmwareFeedback:{confirmInstalled:()=>{calls.push('confirmed');return true;}},renderLamps:()=>{},cardFirmwareUnconfirmed:new Map([[identity,'1.15.1']]),validFirmwareVersion:()=>true,compareFirmwareVersions:()=>0};
 runInNewContext(source.slice(first,last)+';globalThis.confirm=confirmInstalledFirmware;',context);
 context.confirm(identity,{version:'1.15.1',verified:true,fresh:true});assert.equal(calls.length,0);assert.equal(context.cardFirmwareUnconfirmed.has(identity),true);
 context.legacyFirmwareReceipts.clear();context.firmwareAttempts={get:()=>({identity}),pending:()=>[{identity}]};context.confirm(identity,{version:'1.15.1',verified:true,fresh:true});assert.equal(calls.length,0);
});
test('only verified installed reconciliation immediately updates the card version',()=>{
 const first=source.indexOf('function rememberVerifiedUpdateResult('),last=source.indexOf('\nasync function checkLampUpdateResult(',first),calls=[],statuses=new Map([[identity,{installedVersion:'1.13.0'}]]);
 const context={Date,validFirmwareVersion:value=>/^\d+\.\d+\.\d+$/.test(value||''),store:{rememberFirmware:(id,value)=>calls.push({id,...value})},fleetStatuses:statuses};
 runInNewContext(source.slice(first,last)+';globalThis.remember=rememberVerifiedUpdateResult;',context);
 context.remember(identity,{outcome:'unresolved',installedVersion:'1.15.1'});assert.equal(calls.length,0);
 context.remember(identity,{outcome:'installed',installedVersion:'1.15.1',controlResponsive:true,receiverInactive:true});
 assert.equal(calls[0].version,'1.15.1');assert.equal(statuses.get(identity).installedVersion,'1.15.1');
});
test('automatic recovery never checks or schedules non-job and legacy uncertainty, including on foreground return',()=>{
 const first=source.indexOf('const firmwareResultCheckAt=new Map();'),last=source.indexOf('\nfunction resumeCompletedCardFirmwareTask(',first);
 const calls=[],timers=new Map(),listeners=[];let timerId=0;const document={hidden:false,addEventListener:(name,listener)=>{assert.equal(name,'visibilitychange');listeners.push(listener);}};
 const context={Map,Set,Promise,clearTimeout:id=>timers.delete(id),setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},performance:{now:()=>0},document,connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  firmwareAttempts:{pending:()=>[{identity,wifiJobAttempted:false}]},legacyFirmwareReceipts:new Map([['aabbccddeeff',{targetVersion:'1.15.1'}]]),
  mergedLampEntries:()=>[{id:identity},{id:'aabbccddeeff'}],checkLampUpdateResult:entry=>{calls.push(entry.id);}};
 runInNewContext(source.slice(first,last)+';globalThis.resume=resumePendingFirmwareChecks;',context);
 context.resume();assert.deepEqual(calls,[]);assert.equal(timers.size,0);assert.equal(listeners.length,1);
 document.hidden=true;listeners[0]();document.hidden=false;listeners[0]();assert.deepEqual(calls,[]);assert.equal(timers.size,0);
});
test('durable jobs keep reconciling every ten seconds on a detail route until terminal',async()=>{
 const first=source.indexOf('const firmwareResultCheckAt=new Map();'),last=source.indexOf("\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePendingFirmwareChecks();});",first);
 const timers=new Map(),calls=[];let timerId=0,now=0,pending=[{identity,wifiJobAttempted:true}];
 const context={Map,Set,Promise,clearTimeout:id=>timers.delete(id),setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn:()=>{timers.delete(id);fn();},delay});return id;},performance:{now:()=>now},document:{hidden:false},connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  firmwareAttempts:{pending:()=>pending},legacyFirmwareReceipts:new Map(),mergedLampEntries:()=>[{id:identity}],
  // A route lookup here would make this test fail: reconciliation must not be
  // coupled to page-lamps being visible.
  $:()=>{throw Error('inventory route must not be consulted');},
  checkLampUpdateResult:async entry=>{calls.push(entry.id);if(calls.length===2)pending=[];}};
 runInNewContext(source.slice(first,last)+';globalThis.resume=resumePendingFirmwareChecks;',context);
 context.resume();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls,[identity]);assert.equal([...timers.values()][0].delay,10000);
 now=10000;const next=[...timers.values()][0];next.fn();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[identity,identity]);assert.equal(timers.size,0);
});
test('a newly accepted single-card job starts reconciliation when its task releases',()=>{
 const first=source.indexOf('function resumeCompletedCardFirmwareTask('),last=source.indexOf('\nasync function updateLampCard(',first),calls=[];
 assert(first>=0&&last>first);
 const context={resumePendingFirmwareChecks:()=>calls.push('resume')};
 runInNewContext(source.slice(first,last)+';globalThis.completed=resumeCompletedCardFirmwareTask;',context);
 context.completed(undefined);context.completed('cancel');context.completed('wifi');
 assert.deepEqual(calls,['resume']);
 const updateStart=source.indexOf('async function updateLampCard('),updateEnd=source.indexOf('\nfunction cardFirmwareButton(',updateStart);
 assert.match(source.slice(updateStart,updateEnd),/cardFirmwareTasks\.delete\(entry\.id\);resumeCompletedCardFirmwareTask\(routeFollowup\)/);
});
test('background lifecycle preserves an active sender task but aborts non-resumable preflight work',async()=>{
 const first=source.indexOf("document.addEventListener('visibilitychange',()=>{if(document.hidden){void cancelBluetoothFirmware('app-hidden')"),last=source.indexOf('\nfunction waitForFirmwareForeground(',first);
 assert(first>=0&&last>first);const listeners={},calls=[];
 const sender={commitAttempted:false},active={path:'bluetooth',abort:new AbortController(),transport:{bluetoothUpdate:sender}},preflight={path:'bluetooth',abort:new AbortController(),transport:{}},paused={path:'bluetooth',backgroundPaused:true,abort:new AbortController(),transport:{}},wifi={path:'wifi',abort:new AbortController(),transport:{}};
 const context={document:{hidden:true,addEventListener:(name,listener)=>listeners[name]=listener},cardFirmwareTasks:new Map([['active',active],['preflight',preflight],['paused',paused],['wifi',wifi]]),cancelBluetoothFirmware:async reason=>calls.push(reason)};
 runInNewContext(source.slice(first,last),context);listeners.visibilitychange();await Promise.resolve();
 assert.deepEqual(calls,['app-hidden']);assert.equal(active.abort.signal.aborted,false);assert.equal(paused.abort.signal.aborted,false);assert.equal(wifi.abort.signal.aborted,false);
 assert.equal(preflight.abort.signal.aborted,true);assert.equal(preflight.abort.signal.reason,'app-hidden');
});
test('the foreground resume gate is visibility, ownership and AbortSignal bounded and cleans up its listeners',async()=>{
 const first=source.indexOf('function waitForFirmwareForeground('),last=source.indexOf("\nfor (const id of ['speed','intensity'])",first);assert(first>=0&&last>first);
 const listeners=new Set(),document={hidden:true,addEventListener:(name,listener)=>{assert.equal(name,'visibilitychange');listeners.add(listener);},removeEventListener:(name,listener)=>{assert.equal(name,'visibilitychange');listeners.delete(listener);}};
 const context={Error,Promise,Object,document};runInNewContext(source.slice(first,last)+';globalThis.wait=waitForFirmwareForeground;',context);
 const controller=new AbortController();let current=true,settled=false;const waiting=context.wait({signal:controller.signal,isCurrent:()=>current}).then(()=>settled=true);
 await Promise.resolve();assert.equal(settled,false);assert.equal(listeners.size,1);document.hidden=false;for(const listener of [...listeners])listener();await waiting;assert.equal(settled,true);assert.equal(listeners.size,0);
 document.hidden=true;const aborted=new AbortController(),cancelled=context.wait({signal:aborted.signal,isCurrent:()=>true});aborted.abort('user');await assert.rejects(cancelled,error=>error.cancelled&&error.stopReason==='user');assert.equal(listeners.size,0);
 const replaced=context.wait({signal:new AbortController().signal,isCurrent:()=>current});current=false;document.hidden=false;for(const listener of [...listeners])listener();await assert.rejects(replaced,error=>error.cancelled);assert.equal(listeners.size,0);
});
test('hidden progress asks an active sender to pause without aborting the retained card task',async()=>{
 const first=source.indexOf('  const progress=value=>',source.indexOf('async function updateLampCard(')),last=source.indexOf('\n  const result=await updateCardFirmware',first);assert(first>=0&&last>first);
 const sender={commitAttempted:false},task={abort:new AbortController(),transport:{bluetoothUpdate:sender}},calls=[];
 const context={task,entry:{id:identity},current:()=>true,release:{version:'1.15.1'},bluetoothFirmwareConnectionSerial:0,document:{hidden:true},acknowledgedBluetoothUpdateSource:()=>null,
  cancelBluetoothFirmware:async(reason,id)=>{calls.push([reason,id]);task.backgroundPaused=true;},firmwareUpdatePresentation:value=>({message:value.stage,progress:value.progress}),firmwareFeedback:{update(){}},renderLamps(){},renderFirmware(){}};
 runInNewContext(source.slice(first,last)+'\nthis.progress=progress;',context);context.progress({stage:'transferring',progress:42});await Promise.resolve();
 assert.deepEqual(calls,[['app-hidden',identity]]);assert.equal(task.abort.signal.aborted,false);assert.equal(task.backgroundPaused,true);
});
