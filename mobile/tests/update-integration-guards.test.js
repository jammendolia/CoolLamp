import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareAttemptJournal} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),identity='f0b950b2f180';
const marker='beforeMutation:({identity,path,expectedVersion})=>{',start=source.indexOf(marker),end=source.indexOf('\n},onStatus:',start);
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
test('automatic recovery rotates between unreachable lamps even when the first 45-second check expires its cooldown',()=>{
 const first=source.indexOf('const firmwareResultCheckAt=new Map();'),last=source.indexOf("\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePendingFirmwareChecks();});",first);
 const ids=[identity,'aabbccddeeff','112233445566'],calls=[],context={Map,Set,performance:{now:()=>0},document:{hidden:false},connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  firmwareAttempts:{pending:()=>ids.map(identity=>({identity}))},legacyFirmwareReceipts:new Map(),mergedLampEntries:()=>ids.map(id=>({id})),checkLampUpdateResult:entry=>{calls.push(entry.id);}};
 runInNewContext(source.slice(first,last)+';globalThis.resume=resumePendingFirmwareChecks;',context);
 context.resume();context.performance.now=()=>65000;context.resume();context.performance.now=()=>130000;context.resume();context.performance.now=()=>195000;context.resume();
 assert.deepEqual(calls,[...ids,identity]);context.document.hidden=true;context.resume();assert.equal(calls.length,4);
});
