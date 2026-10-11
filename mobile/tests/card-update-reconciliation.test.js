import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {updateCardFirmware} from '../src/card-firmware.js';
import {BluetoothFirmwareTransfer,parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {FirmwareAttemptJournal,reconcileFirmwareAttempt,classifyFirmwareSnapshot} from '../src/firmware-attempt.js';
import {FirmwareFleet} from '../src/firmware-fleet.js';

const identity='f0b950b2f180';
function fixture({loseFinalReply=false,reinstall=false,failAcquire=0,failSnapshot=0}={}){
 const image=new Uint8Array(2048);image[0]=0xe9;
 const digest=createHash('sha256').update(image).digest('hex');
 const manifest=parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.1\nesp32c3\ndual-ota-2031616\n2048\n${digest}\n`);
 const storage=new Map(),journal=new FirmwareAttemptJournal({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)});
 let installed=reinstall?'1.15.1':'1.13.0',acquisitions=0,downloads=0,transfers=0,clock=1000,snapshots=0;
 const operations=[],progress=[],state={phase:0,error:0,session:0,size:0,offset:0,ack:0};
 const ble={getMtu:async()=>247,read:async()=>{
  const out=new DataView(new ArrayBuffer(20));out.setUint8(0,1);out.setUint8(1,state.phase);out.setUint8(2,state.error);out.setUint8(3,state.phase===4?1:0);
  for(const [offset,key]of [[4,'session'],[8,'size'],[12,'offset']])out.setUint32(offset,state[key],true);
  out.setUint16(16,state.ack,true);out.setUint16(18,232,true);return out;
 },write:async(_device,_service,_characteristic,frame)=>{
  const op=frame.getUint8(1);operations.push(op);state.session=frame.getUint32(2,true);state.ack=frame.getUint16(6,true);
  if(op===2){state.phase=2;state.size=image.length;}
  if(op===3){assert.equal(frame.getUint32(8,true),state.offset);state.offset+=frame.byteLength-12;}
  if(op===4){assert.equal(state.offset,image.length);state.phase=4;installed=manifest.version;if(loseFinalReply)throw Error('Final native reply lost.');}
  if(op===5){state.phase=5;state.error=8;}
 }};
 const acquire=async()=>{
  if(++acquisitions===failAcquire)throw Error('Not connected to device.');
  return {lamp:{identity,refreshFirmware:async()=>({version:installed,phase:0}),
   readFirmwareUpdateSnapshot:async options=>{
    assert(options?.isCurrent?.()!==false);if(++snapshots===failSnapshot)throw Error('Not connected to device.');
    return {identity,observedAt:Date.now(),firmware:{version:installed,phase:0},state:{mode:46,effectCount:47,brightness:55,power:true},receiver:{...state,committed:state.phase===4}};
   },updateOverBluetooth:async(prepared,notify,options)=>{
    transfers++;const sender=new BluetoothFirmwareTransfer({ble,deviceId:'saved',onProgress:notify,delay:async ms=>{clock+=ms;},now:()=>clock});
    return sender.send(prepared,{onBeforeWrite:options.onBeforeWrite});
   }},release:async()=>{state.phase=0;state.error=0;state.session=0;state.size=0;state.offset=0;state.ack=0;}};
 };
 const run=(overrides={})=>updateCardFirmware({entry:{id:identity,deviceId:'saved'},manifest,attemptJournal:journal,allowReinstall:reinstall,
  acquireBluetooth:acquire,download:async selected=>{downloads++;assert.equal(selected.text,manifest.text);return {manifest:selected,image};},
  onProgress:value=>progress.push(value),reconcile:(attempt,options)=>reconcileFirmwareAttempt({attempt,...options,acquire,maxAttempts:1,delay:async()=>{}}),...overrides});
 return {run,journal,operations,progress,manifest,get acquisitions(){return acquisitions;},get downloads(){return downloads;},get transfers(){return transfers;}};
}
test('actual card, sender and durable journal confirm installed version after protected reconnect',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(result.installedVersion,'1.15.1');
 assert.equal(f.downloads,1);assert.equal(f.transfers,1);assert.equal(f.acquisitions,3);assert.equal(f.operations.filter(op=>op===4).length,1);
 assert.equal(f.journal.pending().length,0);assert.equal(f.journal.get(identity).commitAcknowledged,true);
 assert(f.progress.some(value=>value.stage==='transferring'&&value.acknowledgedBytes===2048));
});
test('a failed final receipt save records transfer-stage evidence and fences another installation after acknowledged Finish',async()=>{
 const f=fixture(),save=f.journal.storage.setItem,failures=[];
 f.journal.storage.setItem=(key,text)=>{if(JSON.parse(text).records.some(value=>value.commitAcknowledged))throw Error('Storage full after reply.');save(key,text);};
 await assert.rejects(f.run({onFailure:(error,context)=>failures.push({error,stage:context.stage})}),error=>error.journalFailure&&error.commitAcknowledged&&error.beforeMutation===false);
 assert.equal(f.operations.filter(value=>value===4).length,1);assert.equal(f.journal.pending().length,1);assert.equal(f.journal.get(identity).commitAttempted,true);
 assert.equal(failures.at(-1).stage,'bluetooth-transfer');assert.equal(failures.at(-1).error.journalFailure,true);
});
for(const field of ['failAcquire','failSnapshot'])test('known zero-write '+field+' recovers once with the same verified download',async()=>{
 const f=fixture({[field]:2});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.downloads,1);assert.equal(f.transfers,1);
 assert.equal(f.acquisitions,4);assert.equal(f.operations.filter(op=>op===2).length,1);assert.equal(f.operations.filter(op=>op===4).length,1);
 assert(f.progress.some(value=>value.stage==='recovering-connection'));
});
test('lost final native reply is resolved by protected installed-version reads, never another Finish',async()=>{
 const f=fixture({loseFinalReply:true});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.transfers,1);
 assert.equal(f.operations.filter(op=>op===4).length,1);assert.equal(f.journal.get(identity).commitAcknowledged,false);
 assert.equal(result.artifactDigestVerified,false);assert.equal(result.bootHealthVerified,false);
});
test('same-version repair with a lost final reply stays fenced despite an equal running version',async()=>{
 const f=fixture({loseFinalReply:true,reinstall:true});const result=await f.run();assert.equal(result.pending,true);
 assert.equal(f.journal.pending().length,1);assert.equal(f.operations.filter(op=>op===4).length,1);assert.equal(f.transfers,1);
});
test('same-version repair requires its matching receipt and fresh protected inactive receiver',async()=>{
 const f=fixture({reinstall:true});const result=await f.run();assert.equal(result.outcome,'installed');assert.equal(f.journal.get(identity).commitAcknowledged,true);
 assert.equal(f.transfers,1);assert.equal(f.operations.filter(op=>op===4).length,1);
});

test('explicit retries retain protected BLE after reconciled Wi-Fi and zero-write phone failures, then reset after success',async()=>{
 const f=fixture(),entry={id:identity,deviceId:'saved',address:'192.168.1.222'},requests=[],failures=[];
 let attempt,checkRejected=false;
 const firmware={version:'1.13.0',phase:0,latest:'0.0.0',error:0,progress:0,automatic:true,wifi:true,available:false};
 const fleet=new FirmwareFleet({getLamps:()=>[entry],credential:async()=>({value:'fixture-password'}),
  beforeMutation:({path})=>f.journal.beforeWifi(attempt,path),http:{request:async options=>{
   const path=new URL(options.url).pathname;requests.push({path,method:options.method});
   if(path==='/api/diagnostics'||path==='/api/state')return {status:200,data:JSON.stringify({deviceId:identity,firmware,token:'fixture-token',uptimeMs:100000})};
   if(path==='/api/firmware/check'){checkRejected=true;return {status:409,data:'Updater busy.'};}
   assert.equal(path,'/api/firmware');assert(checkRejected);
   return {status:200,data:JSON.stringify({...firmware,phase:5,error:3})};
  }}});
 const first=await f.run({entry,wifi:(target,version)=>fleet.updateLamp(target,version),onAttempt:value=>attempt=value,
  onFailure:(error,context)=>failures.push({stage:context.stage,message:error.message})});
 assert.equal(first.outcome,'installationNotStarted');assert.equal(first.installedVersion,'1.13.0');
 assert.equal(f.downloads,0);assert.equal(f.transfers,0);assert.deepEqual(f.operations,[]);
 assert.equal(f.journal.get(identity).wifiCheckAttempted,true);assert.equal(f.journal.pending().length,0);
 assert.deepEqual(requests.map(value=>value.method+' '+value.path),['GET /api/diagnostics','GET /api/diagnostics','GET /api/state','POST /api/firmware/check','GET /api/firmware']);
 assert.deepEqual(failures.map(value=>value.stage),['wifi-preflight']);
 const priorAttempt=f.journal.get(identity).attemptId,requestCount=requests.length;let retryWifiCalls=0;
 let failedPhoneAcquisitions=0,failedPhoneReleases=0;
 await assert.rejects(f.run({entry,wifi:async()=>{retryWifiCalls++;throw Error('Wi-Fi must not be retried.');},
  acquireBluetooth:async()=>{failedPhoneAcquisitions++;return {lamp:{identity,refreshFirmware:async()=>({version:'1.13.0',phase:0}),
   readFirmwareUpdateSnapshot:async()=>{throw Error('Protected read timed out.');}},release:async()=>{failedPhoneReleases++;}};}}),/Protected read timed out/);
 assert.equal(failedPhoneAcquisitions,2);assert.equal(failedPhoneReleases,2);assert.equal(retryWifiCalls,0);
 assert.equal(f.journal.get(identity).outcome,'installationNotStarted');assert.equal(f.journal.get(identity).wifiCheckAttempted,false);
 assert.equal(f.journal.get(identity).metadataIssued,false);assert.equal(f.journal.get(identity).beginAttempted,false);
 assert.equal(f.downloads,0);assert.equal(f.transfers,0);assert.deepEqual(f.operations,[]);
 const failedPhoneAttempt=f.journal.get(identity).attemptId;assert.notEqual(failedPhoneAttempt,priorAttempt);
 const result=await f.run({entry,wifi:async()=>{retryWifiCalls++;throw Error('Wi-Fi must not be retried.');}});
 assert.equal(result.outcome,'installed');assert.equal(result.installedVersion,f.manifest.version);
 assert.equal(retryWifiCalls,0);assert.equal(requests.length,requestCount);
 assert.notEqual(f.journal.get(identity).attemptId,failedPhoneAttempt);assert.equal(f.journal.get(identity).wifiCheckAttempted,false);
 assert.equal(f.downloads,1);assert.equal(f.transfers,1);assert.equal(f.acquisitions,4);
 assert.equal(f.operations.filter(op=>op===2).length,1);assert.equal(f.operations.filter(op=>op===4).length,1);
 assert.equal(f.journal.get(identity).sha256,f.manifest.sha256);assert.equal(f.journal.get(identity).size,f.manifest.size);
 const nextRelease=parsePhoneManifest(f.manifest.text.replace('1.15.1','1.16.0'));
 const next=await f.run({entry,manifest:nextRelease,wifi:async(target,version)=>{retryWifiCalls++;assert.equal(target.id,identity);assert.equal(version,nextRelease.version);
  return {id:identity,state:'updated',verified:true,fresh:true,installedVersion:version};}});
 assert.equal(next.outcome,'installed');assert.equal(next.path,'wifi');assert.equal(retryWifiCalls,1);
 assert.equal(f.downloads,1);assert.equal(f.transfers,1);assert.equal(f.acquisitions,4);
});

async function checkedWiFiAttempt(f,{metadata=false}={}){
 const token=f.journal.begin(identity,f.manifest);f.journal.beforeWifi(token,'/api/firmware/check');
 if(metadata)f.journal.beforeWrite(token,1,42);
 const result=await reconcileFirmwareAttempt({attempt:f.journal.get(identity),maxAttempts:1,acquire:async()=>({
  lamp:{identity,readFirmwareUpdateSnapshot:async()=>({identity,observedAt:Date.now(),firmware:{version:'1.13.0',phase:0},
   state:{mode:46,effectCount:47,brightness:55,power:true},receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}})},release:async()=>{}})});
 f.journal.settle(f.journal.get(identity),result);return result;
}

for(const kind of ['missing-device','metadata-issued'])test('explicit retry retains normal Wi-Fi preference for '+kind,async()=>{
 const f=fixture();await checkedWiFiAttempt(f,{metadata:kind==='metadata-issued'});
 const entry={id:identity,address:'192.168.1.222',...(kind==='missing-device'?{}:{deviceId:'saved'})};let wifiCalls=0;
 const result=await f.run({entry,wifi:async()=>{wifiCalls++;return {id:identity,state:'updated',verified:true,fresh:true,installedVersion:f.manifest.version};}});
 assert.equal(result.outcome,'installed');assert.equal(wifiCalls,1);assert.equal(f.downloads,0);assert.equal(f.transfers,0);assert.equal(f.acquisitions,0);
});

for(const boundary of ['wifi-install','begin','commit'])test('an unresolved '+boundary+' cannot become an explicit BLE retry',async()=>{
 const f=fixture(),token=f.journal.begin(identity,f.manifest);f.journal.beforeWifi(token,'/api/firmware/check');
 if(boundary==='wifi-install')f.journal.beforeWifi(token,'/api/firmware/install');
 else{f.journal.beforeWrite(token,1,42);f.journal.beforeWrite(token,2,42);if(boundary==='commit')f.journal.beforeWrite(token,4,42);}
 let wifiCalls=0;
 await assert.rejects(f.run({entry:{id:identity,address:'192.168.1.222',deviceId:'saved'},wifi:async()=>{wifiCalls++;}}),error=>error.requiresReconciliation===true);
 assert.equal(wifiCalls,0);assert.equal(f.downloads,0);assert.equal(f.transfers,0);assert.equal(f.acquisitions,0);
});

test('failure observers cannot replace the safe reconciled Wi-Fi outcome',async()=>{
 for(const onFailure of [()=>{throw Error('Observer failed.');},async()=>{throw Error('Observer failed.');}]){
  const f=fixture();let attempt;
  const result=await f.run({entry:{id:identity,address:'192.168.1.222',deviceId:'saved'},onAttempt:value=>attempt=value,
   wifi:async()=>{f.journal.beforeWifi(attempt,'/api/firmware/check');throw Error('Wi-Fi check reply failed.');},onFailure});
  assert.equal(result.outcome,'installationNotStarted');assert.equal(f.transfers,0);assert.equal(f.downloads,0);
 }
});

test('restored terminal Wi-Fi check proof retains its explicit retry route after app restart',async()=>{
 const f=fixture();await checkedWiFiAttempt(f);
 const memory=new Map([['coollamp-firmware-attempts-v1',JSON.stringify({version:1,records:[f.journal.get(identity)]})]]);
 const restored=new FirmwareAttemptJournal({getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)});
 let wifiCalls=0;
 const result=await f.run({attemptJournal:restored,entry:{id:identity,address:'192.168.1.222',deviceId:'saved'},wifi:async()=>{wifiCalls++;}});
 assert.equal(result.outcome,'installed');assert.equal(wifiCalls,0);assert.equal(f.downloads,1);assert.equal(f.transfers,1);
 assert.equal(restored.get(identity).wifiCheckAttempted,false);assert.equal(restored.pending().length,0);
});

for(const invalid of ['identity','bootstrap'])test('saved BLE retry still verifies protected '+invalid+' before downloading or sending',async()=>{
 const f=fixture();await checkedWiFiAttempt(f);let wifiCalls=0,releases=0;
 await assert.rejects(f.run({entry:{id:identity,address:'192.168.1.222',deviceId:'saved'},wifi:async()=>{wifiCalls++;},
  acquireBluetooth:async()=>({lamp:{identity:invalid==='identity'?'aabbccddeeff':identity,
   refreshFirmware:async()=>({version:'1.10.0',phase:0})},release:async()=>{releases++;}})}),error=>invalid==='identity'?error.identity===true:error.bootstrapRequired===true);
 assert.equal(wifiCalls,0);assert.equal(f.downloads,0);assert.equal(f.transfers,0);assert.equal(releases,1);
});

for(const busyAt of ['preflight','after-download'])test('automatic available firmware blocks the '+busyAt+' BLE retry guard',async()=>{
 const f=fixture();await checkedWiFiAttempt(f);let acquisitions=0,wifiCalls=0;
 const ready={version:'1.13.0',phase:0},armed={...ready,phase:2,automatic:true,available:true,latest:f.manifest.version};
 const observed=firmware=>({identity,observedAt:Date.now(),firmware,state:{mode:46,effectCount:47,brightness:55,power:true},
  receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}});
 const result=await f.run({entry:{id:identity,address:'192.168.1.222',deviceId:'saved'},wifi:async()=>{wifiCalls++;},
  acquireBluetooth:async()=>{const firmware=busyAt==='preflight'||++acquisitions===2?armed:ready;return {
   lamp:{identity,refreshFirmware:async()=>firmware,readFirmwareUpdateSnapshot:async()=>observed(firmware),
    updateOverBluetooth:async()=>assert.fail('An armed automatic installer must not receive BLE update frames.')},release:async()=>{}};},
  reconcile:async attempt=>classifyFirmwareSnapshot(attempt,observed(armed))});
 assert.equal(result.pending,true);assert.equal(result.outcome,'unresolved');assert.equal(wifiCalls,0);
 assert.equal(f.downloads,busyAt==='preflight'?0:1);assert.equal(f.transfers,0);
 assert.equal(f.journal.get(identity).metadataIssued,false);assert.equal(f.journal.get(identity).beginAttempted,false);
});
