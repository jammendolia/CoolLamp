import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {FirmwareUpdateDiagnostics} from '../src/firmware-update-diagnostics.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('function updateDiagnosticDetails('),end=source.indexOf('\nfunction fleetSeenTime(',start);
assert(start>=0&&end>start);const handler=source.slice(start,end),identity='f0b950b2f180',attempt='a'.repeat(32);
function fixture({clipboard=true}={}){
 const rows=new Map(),diagnostics=new FirmwareUpdateDiagnostics({getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)}),copied=[];
 const element=tag=>({tag,children:[],dataset:{},style:{},append(...children){this.children.push(...children);}});
 const context={firmwareDiagnostics:diagnostics,document:{createElement:element},navigator:clipboard?{clipboard:{writeText:async value=>copied.push(value)}}:{},fetch(){throw Error('Diagnostic viewing must not contact a lamp.');}};
 runInNewContext(handler+';globalThis.details=updateDiagnosticDetails;',context);
 return {diagnostics,copied,show:()=>context.details({id:identity})};
}
test('empty update details creates no control or transport workload',()=>{assert.equal(fixture().show(),null);});
test('actual diagnostic view shows the stopped step and copies only the sanitized saved report',async()=>{
 const f=fixture();f.diagnostics.begin(identity,attempt);f.diagnostics.failure(identity,attempt,Object.assign(Error('password SECRET SSID'),{httpStatus:409}),{stage:'wifi-preflight',safety:{metadataIssued:false,beginAttempted:false,commitAttempted:false,wifiCheckAttempted:true,wifiInstallAttempted:false}});
 const details=f.show();assert.equal(details.dataset.updateDiagnostic,identity);assert.equal(details.children[0].textContent,'Update details');assert.match(details.children[1].textContent,/Preparing the lamp/);
 const report=details.children.find(value=>value.tag==='pre').textContent;assert.equal(JSON.parse(report).record.stages[0].code,'wifi-check-rejected');assert(!report.includes('SECRET'));
 await details.children.find(value=>value.tag==='button').onclick();assert.deepEqual(f.copied,[report]);
});
test('details remain visible when native clipboard is unavailable',()=>{
 const f=fixture({clipboard:false});f.diagnostics.begin(identity,attempt);f.diagnostics.failure(identity,attempt,Error('Not connected to device.'),{stage:'bluetooth-preflight'});
 const details=f.show();assert.match(details.children[1].textContent,/Connecting to the lamp/);assert(details.children.some(value=>value.tag==='pre'));assert(!details.children.some(value=>value.tag==='button'));
});
test('successful measured transfer has neutral details without inventing a failed stage or exposing identifiers',async()=>{
 const f=fixture();f.diagnostics.begin(identity,attempt);
 f.diagnostics.transfer(identity,attempt,{mtu:247,chunkSize:232,total:2020592,acknowledgedBytes:2020592,
  dataStartOffset:0,dataEndOffset:2020592,dataElapsedMs:100000,monotonicDataTiming:true,dataComplete:true,
  dataWriteMode:'without-response-four',commitAcknowledged:true,session:99,deviceId:'PRIVATE-NATIVE-ID',password:'SECRET'});
 f.diagnostics.complete(identity,attempt,{outcome:'installed',installedVersion:'1.15.1'});
 const details=f.show();assert.equal(details.children[1].textContent,'Recorded Bluetooth transfer measurements.');
 const report=details.children.find(value=>value.tag==='pre').textContent,record=JSON.parse(report).record;
 assert.deepEqual(record.stages,[]);assert.equal(record.outcome,'installed');assert.equal(record.transfer.dataElapsedMs,100000);
 assert.equal(record.transfer.commitAcknowledged,true);assert(!report.includes(identity));assert(!report.includes(attempt));
 assert(!report.includes('PRIVATE-NATIVE-ID'));assert(!report.includes('SECRET'));assert(!report.includes('session'));
 await details.children.find(value=>value.tag==='button').onclick();assert.deepEqual(f.copied,[report]);
});
test('an optional empty record does not show transfer measurements that were never captured',()=>{
 const f=fixture();f.diagnostics.begin(identity,attempt);f.diagnostics.complete(identity,attempt,{outcome:'installed',installedVersion:'1.15.1'});
 assert.equal(f.show(),null);
});
