import test from 'node:test';
import assert from 'node:assert/strict';
import {availableCardRelease,updateCardFirmware,FirmwareReleaseCache} from '../src/card-firmware.js';
import {parsePhoneManifest,fetchPhoneManifest,downloadPhoneFirmware} from '../src/bluetooth-firmware.js';
const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.12.0\nesp32c3\ndual-ota-2031616\n288\n'+'a'.repeat(64)+'\n');
function setup(){
 const calls=[],entry={id:'aabbccddeeff',address:'192.168.1.20',deviceId:'paired'};
 const lamp={identity:entry.id,refreshFirmware:async()=>({version:'1.11.0'}),updateOverBluetooth:async()=>{calls.push('transfer');return {committed:true,version:'1.12.0'};}};
 const options={entry,manifest,wifi:async()=>{calls.push('wifi');return {state:'updated'};},acquireBluetooth:async()=>{calls.push('ble');return {lamp,release:async()=>calls.push('release')};},download:async()=>{calls.push('download');return {manifest,image:new Uint8Array(288)};}};
 return {calls,lamp,options};
}
test('badge requires valid known installed version and strictly newer release',()=>{assert(availableCardRelease('1.11.0',manifest));for(const version of ['1.12.0','1.13.0',undefined,'bad'])assert.equal(availableCardRelease(version,manifest),null);assert.equal(availableCardRelease('1.11.0',null),null);});
test('Wi-Fi is preferred without connecting Bluetooth or downloading image',async()=>{const {calls,options}=setup();assert.equal((await updateCardFirmware(options)).path,'wifi');assert.deepEqual(calls,['wifi']);});
test('confirmed pre-install Wi-Fi failure selects Bluetooth and releases its lease',async()=>{const {calls,options}=setup();options.wifi=async()=>{calls.push('wifi');throw Object.assign(Error('TLS failed'),{safeBluetoothFallback:true});};assert.equal((await updateCardFirmware(options)).path,'bluetooth');assert.deepEqual(calls,['wifi','ble','download','transfer','release']);});
test('uncertain, wrong identity, stale, or rejected Wi-Fi installation never falls back',async()=>{for(const fields of [{uncertain:true,safeBluetoothFallback:true},{identity:true,safeBluetoothFallback:true},{stale:true,safeBluetoothFallback:true},{}]){const {calls,options}=setup();options.wifi=async()=>{throw Object.assign(Error('failure'),fields);};await assert.rejects(updateCardFirmware(options));assert.deepEqual(calls,[]);}});
test('offline entry uses Bluetooth; wrong protected identity sends nothing',async()=>{const {calls,options,lamp}=setup();delete options.entry.address;lamp.identity='different';await assert.rejects(updateCardFirmware(options),/identity/);assert.deepEqual(calls,['ble','release']);});
test('old firmware requires bootstrap without downloading or transferring',async()=>{const {calls,options,lamp}=setup();delete options.entry.address;lamp.refreshFirmware=async()=>({version:'1.10.2'});await assert.rejects(updateCardFirmware(options),/installed once/);assert.deepEqual(calls,['ble','release']);});
test('reconciles already-updated Bluetooth lamp without resending firmware',async()=>{const {calls,options,lamp}=setup();delete options.entry.address;lamp.refreshFirmware=async()=>({version:'1.12.0'});assert.equal((await updateCardFirmware(options)).state,'ready');assert.deepEqual(calls,['ble','release']);});
test('fresh BLE status catches another update before any image is sent',async()=>{for(const phase of [1,3,4]){const {calls,options,lamp}=setup();delete options.entry.address;lamp.refreshFirmware=async()=>({version:'1.11.0',phase});await assert.rejects(updateCardFirmware(options),/in progress/);assert.deepEqual(calls,['ble','release']);}});
test('target removal during phone download prevents transfer and releases lease',async()=>{const {calls,options}=setup();delete options.entry.address;let current=true;options.isCurrent=()=>current;options.download=async()=>{current=false;return {manifest};};await assert.rejects(updateCardFirmware(options),/changed/);assert.deepEqual(calls,['ble','release']);});
test('manifest refresh is GET only, bypasses cached Latest redirects and does not download firmware',async()=>{const calls=[];const http={request:async options=>{calls.push(options);return {status:200,data:new TextEncoder().encode(manifest.text)};}};assert.equal((await fetchPhoneManifest(http)).version,'1.12.0');assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');const url=new URL(calls[0].url);assert(url.pathname.endsWith('latest/download/coollamp-manifest.txt'));assert(url.searchParams.has('check'));assert.equal(calls[0].headers['Cache-Control'],'no-cache, no-store, max-age=0');});
test('pinned phone download rejects altered release manifest before fetching image',async()=>{const calls=[];const http={request:async options=>{calls.push(options.url);return {status:200,data:new TextEncoder().encode(manifest.text.replace('288','289'))};}};await assert.rejects(downloadPhoneFirmware(http,{expectedManifest:manifest}),/release changed/);assert.equal(calls.length,1);assert(calls[0].includes('firmware-v1.12.0/coollamp-manifest.txt'));});

test('forced public check replaces stale 1.14 offer with 1.15 independently of lamp diagnostics',async()=>{
 let now=1000;const calls=[],releases=['1.14.0','1.15.0'];
 const cache=new FirmwareReleaseCache({request:async options=>{calls.push(options);return {status:200,data:new TextEncoder().encode(manifest.text.replace('1.12.0',releases.shift()))};}},{now:()=>now});
 assert.equal((await cache.refresh()).version,'1.14.0');assert(cache.fresh);assert.equal(cache.checkedAt,1000);
 now=2000;assert.equal((await cache.refresh()).version,'1.14.0');assert.equal(calls.length,1);
 assert.equal((await cache.refresh({force:true})).version,'1.15.0');assert.equal(cache.checkedAt,2000);assert(cache.fresh);
 assert.equal(calls.length,2);assert.notEqual(calls[0].url,calls[1].url);assert(calls.every(row=>row.method==='GET'));
 now+=300000;assert.equal(cache.fresh,false);
});
test('failed or malformed public refresh never refreshes old offer freshness or timestamp',async()=>{
 for(const failure of ['offline','invalid']){
  let now=1000,calls=0;const cache=new FirmwareReleaseCache({request:async()=>{if(++calls>1){if(failure==='offline')throw Error('Phone offline');return {status:200,data:new TextEncoder().encode('invalid')};}return {status:200,data:new TextEncoder().encode(manifest.text)};}},{now:()=>now});
  await cache.refresh();now=2000;await assert.rejects(cache.refresh({force:true}));
  assert.equal(cache.manifest.version,'1.12.0');assert.equal(cache.checkedAt,1000);assert.equal(cache.fresh,false);assert(cache.error);
 }
});
test('concurrent forced release checks share one uncached request and cannot interleave offers',async()=>{
 let complete,calls=0;const cache=new FirmwareReleaseCache({request:()=>{calls++;return new Promise(resolve=>complete=resolve);}});
 const first=cache.refresh({force:true}),second=cache.refresh({force:true});assert.equal(first,second);assert.equal(calls,1);assert.equal(cache.fresh,false);
 complete({status:200,data:new TextEncoder().encode(manifest.text)});await first;assert(cache.fresh);
});
