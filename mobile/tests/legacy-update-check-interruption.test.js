import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareFeedback} from '../src/firmware-feedback.js';
import {reconcileLegacyFirmwareReceipt} from '../src/firmware-attempt.js';
import {firmwareUpdatePresentation} from '../src/firmware-update-ui.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('async function checkLampUpdateResult('),end=source.indexOf('\nconst firmwareResultCheckAt=',start),identity='f0b950b2f180';
assert(start>=0&&end>start);
test('two interrupted production legacy checks retain the original durable receipt before app relaunch',async()=>{
 const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)},feedback=new FirmwareFeedback(storage),entry={id:identity,deviceId:'saved'};
 feedback.update(feedback.begin(identity),{message:'Previous result awaits confirmation.',terminal:true,outcome:'verification-required',targetVersion:'1.15.1'});
 let acquisitions=0,releases=0;const context={AbortController,document:{hidden:false},connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,
  firmwareAttempts:{get:()=>null,pending:()=>[]},legacyFirmwareReceipts:new Map([[identity,{identity,targetVersion:'1.15.1',outcome:'verification-required'}]]),firmwareFeedback:feedback,
  mergedLampEntries:()=>[entry],groupRemovedIds:new Set(),fleet:{cancelRefresh(){}},firmwareUpdatePresentation,renderLamps(){},renderFirmware(){},
  reconcileLegacyFirmwareReceipt:options=>reconcileLegacyFirmwareReceipt({...options,maxAttempts:1}),
  acquireCardFirmwareBluetooth:async()=>{acquisitions++;context.cardFirmwareTasks.get(identity).abort.abort('app-hidden');return {lamp:{identity,readFirmwareUpdateSnapshot(){throw Error('Aborted checks must not continue reading.');}},release:async()=>{releases++;}};}};
 runInNewContext(source.slice(start,end)+';globalThis.check=checkLampUpdateResult;',context);
 for(let i=0;i<2;i++){
  await context.check(entry);assert.equal(context.cardFirmwareTasks.size,0);
  const restored=new FirmwareFeedback(storage);assert.equal(restored.get(identity).outcome,'verification-required');assert.equal(restored.get(identity).targetVersion,'1.15.1');
 }
 assert.equal(acquisitions,2);assert.equal(releases,2);
});
