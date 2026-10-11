import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FirmwareFleet} from '../src/firmware-fleet.js';
import {updateCardFirmware} from '../src/card-firmware.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';

const ids=['f0b950b2f180','74b950b2f180','aabbccddeeff'];
const status=(phase=0,latest='0.0.0',error=0)=>({version:'1.13.0',phase,latest,error,progress:0,automatic:true,wifi:true,available:phase===2});
const reply=(data,status=200)=>({status,data:typeof data==='string'?data:JSON.stringify(data)});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(count=1){
 let now=1000,entries=ids.slice(0,count).map((id,index)=>({id,address:'192.168.1.'+(20+index)}));
 const calls=[],changes=[],credentials=[],devices=entries.map(entry=>({...entry,firmware:status(),stateReads:0,diagnosticReads:0,handler:null}));
 const fleet=new FirmwareFleet({getLamps:()=>entries,credential:async id=>{credentials.push(id);return {value:'fixture-password'};},
  http:{request:async options=>{
   calls.push(options);const url=new URL(options.url),device=devices.find(value=>value.address===url.hostname);
   assert(device);assert.equal(options.disableRedirects,true);
   if(url.pathname==='/api/state')device.stateReads++;
   if(url.pathname==='/api/diagnostics')device.diagnosticReads++;
   const overridden=await device.handler?.(options,url.pathname);if(overridden!==undefined)return overridden;
   if(url.pathname==='/api/diagnostics')return reply({deviceId:device.id,firmware:device.firmware,uptimeMs:100000});
   if(url.pathname==='/api/state')return reply({deviceId:device.id,firmware:device.firmware,token:'fixture-token'});
   if(url.pathname==='/api/firmware')return reply(device.firmware);
   assert.equal(options.method,'POST');assert.equal(options.headers['X-Lamp-Token'],'fixture-token');
   if(url.pathname==='/api/firmware/check'){device.firmware=status(1);return reply('Checking',202);}
   if(url.pathname==='/api/firmware/install'){device.firmware=status(3,'1.15.1');return reply('Installing',202);}
   assert.fail('Unexpected request.');
  }},onStatus:(id,value)=>changes.push({id,...value}),now:()=>now,sleep:async ms=>{now+=ms;},
  requestTimeout:5,pollInterval:5,checkTimeout:20,updateTimeout:30});
 return {fleet,calls,changes,credentials,devices,entries:()=>entries,setEntries:value=>entries=value,
  update:()=>fleet.updateLamp({...entries[0]},'1.15.1')};
}
const posts=f=>f.calls.filter(call=>call.method==='POST').map(call=>new URL(call.url).pathname);

test('verified diagnostics plus hung initial token snapshot enables BLE fallback with zero POSTs',async()=>{
 const f=fixture();f.devices[0].handler=(_,path)=>path==='/api/state'?new Promise(()=>{}):undefined;
 await assert.rejects(f.update(),error=>error.offline===true&&error.safeBluetoothFallback===true&&!error.uncertain);
 assert.equal(f.devices[0].diagnosticReads,2);assert.equal(f.devices[0].stateReads,1);
 assert.deepEqual(posts(f),[]);assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/diagnostics','/api/diagnostics','/api/state']);
});

test('production card update reaches its verified BLE lease after real fleet preflight fails before any POST',async()=>{
 const f=fixture(),events=[],image=new Uint8Array(512),digest=createHash('sha256').update(image).digest('hex');
 const manifest=parsePhoneManifest('COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n512\n'+digest+'\n');
 f.devices[0].handler=(_,path)=>{events.push(path);if(path==='/api/state')return new Promise(()=>{});};
 const entry={...f.entries()[0],deviceId:'saved-authorized-peripheral'};let senderCalls=0,pinned;
 const result=await updateCardFirmware({entry,manifest,wifi:(target,version)=>f.fleet.updateLamp(target,version),
  acquireBluetooth:async target=>{
   assert.equal(target.id,ids[0]);assert.deepEqual(posts(f),[]);events.push('acquire-bluetooth');
   return {lamp:{identity:ids[0],refreshFirmware:async()=>{events.push('protected-firmware-status');return {version:'1.13.0',phase:0};},
    updateOverBluetooth:async prepared=>{events.push('send-pinned-image');senderCalls++;assert.equal(prepared.manifest,pinned);
     assert.equal(prepared.manifest.text,manifest.text);assert.equal(prepared.image,image);return {committed:true,version:'1.15.1'};}},
    release:async()=>events.push('release-bluetooth')};
  },download:async selected=>{events.push('download-pinned-release');pinned=selected;assert.equal(selected.text,manifest.text);return {manifest:selected,image};}});
 assert.equal(result.path,'bluetooth');assert.equal(result.state,'restarting');assert.equal(result.committed,true);assert.equal(senderCalls,1);
 assert.deepEqual(posts(f),[]);assert.deepEqual(events,['/api/diagnostics','/api/diagnostics','/api/state','acquire-bluetooth',
  'protected-firmware-status','release-bluetooth','download-pinned-release','acquire-bluetooth','protected-firmware-status','send-pinned-image','release-bluetooth']);
});

test('malformed initial read and missing boot token remain proven pre-POST failures',async()=>{
 for(const value of ['{"deviceId":',reply({deviceId:ids[0],firmware:status()}),
  reply({deviceId:ids[0],firmware:status(),token:''}),reply({deviceId:ids[0],firmware:status(),token:'x'.repeat(129)}),
  reply({deviceId:ids[0],firmware:{...status(),version:'invalid'},token:'fixture-token'})]){
  const f=fixture();f.devices[0].handler=(_,path)=>path==='/api/state'?(typeof value==='string'?reply(value):value):undefined;
  await assert.rejects(f.update(),error=>error.safeBluetoothFallback===true&&(error.invalidRead||error.missingUpdateToken));
  assert.deepEqual(posts(f),[]);assert.equal(f.devices[0].diagnosticReads,2);
 }
});

test('wrong identity, HTTP authentication and redirected initial token reads never permit rerouting',async()=>{
 for(const value of [reply({deviceId:ids[1],firmware:status(),token:'fixture-token'}),reply('Unauthorized',401),reply('Forbidden',403),reply('Moved',302),reply('Busy',409)]){
  const f=fixture();f.devices[0].handler=(_,path)=>path==='/api/state'?value:undefined;
  await assert.rejects(f.update(),error=>!error.safeBluetoothFallback);assert.deepEqual(posts(f),[]);
 }
});

for(const action of ['cancel','remove','address'])test('late initial token read after '+action+' cannot enable fallback or a POST',async()=>{
 const f=fixture(),gate=deferred(),started=deferred();f.devices[0].handler=(_,path)=>{if(path==='/api/state'){started.resolve();return gate.promise;}};
 const pending=f.update();await started.promise;
 if(action==='cancel')f.fleet.cancel();else if(action==='remove')f.setEntries([]);else f.setEntries([{...f.entries()[0],address:'192.168.1.29'}]);
 gate.resolve(reply({deviceId:ids[0],firmware:status(),token:'fixture-token'}));
 await assert.rejects(pending,error=>!error.safeBluetoothFallback&&(error.cancelled||error.stale));assert.deepEqual(posts(f),[]);
});

test('a busy initial updater is observed without beginning another route',async()=>{
 const f=fixture();f.devices[0].handler=(_,path)=>path==='/api/state'?reply({deviceId:ids[0],firmware:status(3,'1.15.1'),token:'fixture-token'}):
  path==='/api/firmware'?reply(status(3,'1.15.1')):undefined;
 await assert.rejects(f.update(),error=>!error.safeBluetoothFallback);assert.deepEqual(posts(f),[]);
});

test('install-token read failure after an accepted check never enables BLE fallback',async()=>{
 const f=fixture();f.devices[0].handler=(_,path)=>path==='/api/state'&&f.devices[0].stateReads===2?new Promise(()=>{}):
  path==='/api/firmware'?reply(status(2,'1.15.1')):undefined;
 await assert.rejects(f.update(),error=>error.offline&&!error.safeBluetoothFallback);
 assert.deepEqual(posts(f),['/api/firmware/check']);assert.equal(f.devices[0].stateReads,2);
});

test('uncertain or busy check replies cannot convert later read failures into safe BLE fallback',async()=>{
 for(const kind of ['uncertain','busy']){
  const f=fixture();f.devices[0].handler=(_,path)=>{
   if(path==='/api/firmware/check'){if(kind==='uncertain')throw Error('Native reply lost.');return reply('Busy',409);}
   if(path==='/api/firmware')throw Error('Later GET lost.');
  };
  await assert.rejects(f.update(),error=>!error.safeBluetoothFallback);assert.deepEqual(posts(f),['/api/firmware/check']);
 }
});

test('uncertain install remains unreplayed and cannot switch to BLE',async()=>{
 const f=fixture();let polls=0;f.devices[0].handler=(_,path)=>{
  if(path==='/api/firmware')return reply(++polls===1?status(2,'1.15.1'):status(0));
  if(path==='/api/state'&&f.devices[0].stateReads===2)return reply({deviceId:ids[0],firmware:status(2,'1.15.1'),token:'fixture-token'});
  if(path==='/api/firmware/install')throw Error('Final reply lost.');
 };
 await assert.rejects(f.update(),error=>!error.safeBluetoothFallback);assert.deepEqual(posts(f),['/api/firmware/check','/api/firmware/install']);
});

test('passive exclusions skip only that deduped workload and preserve owned records and status',async()=>{
 const f=fixture(3),entries=f.entries();f.setEntries([...entries,{...entries[1]}]);
 const previous={state:'updating',verified:true};f.fleet.statuses.set(ids[0],previous);
 const result=await f.fleet.refresh({excludeIds:new Set([ids[0],ids[0]])});
 assert.deepEqual(result.results.map(value=>value.id).sort(),ids.slice(1).sort());assert.equal(f.credentials.length,2);
 assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.method==='GET'&&!call.url.startsWith('http://192.168.1.20/')));
 assert.equal(f.entries().length,4);assert.equal(f.fleet.statuses.get(ids[0]),previous);assert(!f.changes.some(value=>value.id===ids[0]));
});

test('passive refresh reads another lamp while its excluded Wi-Fi update retains full-inventory fencing',async()=>{
 const f=fixture(2),gate=deferred(),started=deferred();f.devices[0].handler=(_,path)=>{
  if(path==='/api/state'){started.resolve();return gate.promise;}if(path==='/api/firmware')return reply(status(5,'0.0.0',6));
 };
 const update=f.update();await started.promise;
 assert.deepEqual(await f.fleet.refresh(),{results:[],cancelled:false,busy:true});
 const result=await f.fleet.refresh({excludeIds:[ids[0]]});assert.equal(result.results.length,1);assert.equal(result.results[0].id,ids[1]);
 gate.resolve(reply({deviceId:ids[0],firmware:status(),token:'fixture-token'}));
 await assert.rejects(update,error=>!error.stale&&!error.safeBluetoothFallback);assert.deepEqual(posts(f),['/api/firmware/check']);
});

test('exclusions never hide target removal from an active update or admit a late mutation',async()=>{
 const f=fixture(2),gate=deferred(),started=deferred();f.devices[0].handler=(_,path)=>{if(path==='/api/state'){started.resolve();return gate.promise;}};
 const update=f.update();await started.promise;await f.fleet.refresh({excludeIds:[ids[0]]});f.setEntries(f.entries().filter(entry=>entry.id!==ids[0]));
 gate.resolve(reply({deviceId:ids[0],firmware:status(),token:'fixture-token'}));
 await assert.rejects(update,error=>error.stale&&!error.safeBluetoothFallback);assert.deepEqual(posts(f),[]);
});

test('replacement excluded refresh discards cancelled late results without mixing sessions',async()=>{
 const f=fixture(2),gate=deferred(),started=deferred();let first=true;f.devices[1].handler=(_,path)=>{
  if(path==='/api/diagnostics'&&first){first=false;started.resolve();return gate.promise;}
 };
 const old=f.fleet.refresh({excludeIds:[ids[0]]});await started.promise;
 const current=await f.fleet.refresh({excludeIds:[ids[0]]});gate.resolve(reply({deviceId:ids[1],firmware:status()}));
 assert.equal((await old).cancelled,true);assert.equal(current.results.length,1);assert.equal(current.results[0].id,ids[1]);
 assert.equal(f.changes.filter(value=>value.verified).length,1);assert.deepEqual(posts(f),[]);
});

test('bulk ownership remains exclusive even when every lamp is passively excluded',async()=>{
 const f=fixture(2);f.fleet.bulkRun=f.fleet.run();
 assert.deepEqual(await f.fleet.refresh({excludeIds:ids}),{results:[],cancelled:false,busy:true});assert.deepEqual(f.calls,[]);
});

test('a durable mutation observer failure prevents the production fleet from sending a POST',async()=>{
 const f=fixture();let observed=0;f.fleet.beforeMutation=async value=>{observed++;assert.equal(value.identity,ids[0]);assert.equal(value.path,'/api/firmware/check');throw Object.assign(Error('Phone storage failed.'),{journalFailure:true});};
 await assert.rejects(f.update(),error=>error.journalFailure&&!error.uncertain);assert.equal(observed,1);assert.deepEqual(posts(f),[]);
});
test('bulk exclusion visibly retains a pending target without any target reads or writes',async()=>{
 const f=fixture();const result=await f.fleet.updateAll('1.15.1',{excludeIds:[ids[0]]});
 assert.equal(result.results.length,1);assert.equal(result.results[0].state,'pending');assert.equal(result.results[0].id,ids[0]);
 assert.deepEqual(f.calls,[]);assert.equal(f.entries().length,1);
});
