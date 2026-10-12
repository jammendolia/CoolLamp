import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {updateCardFirmware,availableCardRelease} from '../src/card-firmware.js';
import {parsePhoneManifest,compareFirmwareVersions} from '../src/bluetooth-firmware.js';
import {FirmwareAttemptJournal,reconcileFirmwareAttempt} from '../src/firmware-attempt.js';
import {FirmwareScreenAwake} from '../src/firmware-screen-awake.js';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation} from '../src/firmware-update-ui.js';
import {validFirmwareVersion} from '../src/lamps.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>{const first=source.indexOf(start),last=source.indexOf(end,first);assert(first>=0&&last>first);return source.slice(first,last);};
const handlers=[extract('function cardUpdateConfirmation(','\nasync function acquireCardFirmwareBluetooth('),
 extract('async function updateLampCard(','\nfunction cardFirmwareButton('),
 extract('function cardReinstallTarget(','\nfunction updateDiagnosticDetails(')].join('\n');
const id='f0b950b2f180',other='aabbccddeeff';
const release=version=>parsePhoneManifest(`COOLLAMP-OTA-1\n${version}\nesp32c3\ndual-ota-2031616\n512\n${'a'.repeat(64)}\n`);
function fixture({installed='1.15.1',receiverVersion=installed,afterDownloadVersion,publicRelease=release('1.15.1'),fresh=true,authorized=true,platform='ios',accept=true,scenario='success',onConfirm,onRefresh}={}){
 const calls=[],data=new Map(),messages=[],entry={id,name:'Desk lamp',address:'http://desk.local',deviceId:'AAAAAAAA-0000-0000-0000-000000000001',accessoryManaged:authorized,firmwareVersion:installed};
 let receiverInstalled=receiverVersion;
 const journal=new FirmwareAttemptJournal({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}),tasks=new Map(),saved={...entry};
 const element=tag=>({tag,dataset:{},attributes:{},children:[],setAttribute(key,value){this.attributes[key]=value;},append(...children){this.children.push(...children);},addEventListener(_event,callback){this.close=callback;},remove(){},
  showModal(){calls.push(['confirmation',this.children[0].children[0].textContent,this.children[0].children[1].textContent]);onConfirm?.(context);queueMicrotask(()=>{this.returnValue=accept?'update':'cancel';this.close();});}});
 const context={AbortController,Error,Map,parsePhoneManifest,compareFirmwareVersions,validFirmwareVersion,availableCardRelease,updateCardFirmware,FirmwareScreenAwake,
  firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation,entry,calls,publicFirmware:publicRelease,publicFirmwareFresh:fresh,publicFirmwareError:'',
  firmwareAttempts:journal,legacyFirmwareReceipts:new Map(),cardFirmwareTasks:tasks,cardFirmwareUnconfirmed:new Map(),cardFirmwareMessages:new Map(),
  groupRemovedIds:new Set(),removedAccessoryIds:new Set(),phonePlatform:platform,store:{items:[saved]},mergedLampEntries:()=>context.store.items,
  cardInstalledVersion:()=>installed,powerLaneBusy:()=>false,fleetLampInstalling:()=>false,
  busy:false,connecting:false,bluetoothFirmwareTask:null,fleetUpdating:false,bluetoothFirmwareConnectionSerial:0,
  pauseFirmwareBackgroundWork(){assert.equal(tasks.size,1);},renderLamps(){},renderPower(){},renderFirmware(){},refreshLampFirmware(){},
  refreshPublicFirmware:async()=>{calls.push('public-check');await onRefresh?.(context);return context.publicFirmware;},
  checkLampUpdateResult:value=>{calls.push(['read-only-check',value.id]);},
  firmwareFeedback:{begin:()=>1,update:(_token,value)=>messages.push(value)},
  firmwareDiagnostics:{begin(){},failure(){},complete(){},get:()=>null},rememberVerifiedUpdateResult(){},status:message=>messages.push({message}),
  native:{},isNative:false,CapacitorHttp:{},document:{hidden:false,body:{append(){}},createElement:element},
  fleet:{updateLamp:()=>assert.fail('Reinstall issued a Wi-Fi POST')},
  downloadPhoneFirmware:async(_http,options)=>{calls.push(['download',options.expectedManifest.text]);if(afterDownloadVersion!==undefined)receiverInstalled=afterDownloadVersion;return {manifest:options.expectedManifest,image:new Uint8Array(512)};},
  reconcileFirmwareAttempt:options=>reconcileFirmwareAttempt({...options,maxAttempts:1}),
  acquireCardFirmwareBluetooth:async()=>{calls.push('private-lease');const identity=scenario==='wrong-identity'?other:id;
   const firmware=()=>({version:receiverInstalled,phase:scenario==='busy'?3:0});
   const snapshot=()=>({identity,observedAt:Date.now(),firmware:firmware(),state:{mode:4,effectCount:38,power:true,brightness:55},receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}});
   return {lamp:{identity,refreshFirmware:async()=>{calls.push('protected-firmware');return firmware();},readFirmwareUpdateSnapshot:async()=>{calls.push('protected-snapshot');return snapshot();},
    request:()=>assert.fail('Reinstall requested full settings/control'),refresh:()=>assert.fail('Reinstall requested full settings/catalog'),
    updateOverBluetooth:async(pkg,_progress,options)=>{calls.push(['sender',pkg.manifest.text]);
     for(const operation of [1,2,4]){await options.onBeforeWrite({operation,session:scenario==='wrong-session'&&operation===2?10:9,sequence:44,size:512,version:pkg.manifest.version,sha256:pkg.manifest.sha256});calls.push(['write',operation]);}
     if(scenario==='lost-final-ack')throw Object.assign(Error('Final receipt lost'),{uncertain:true,commitAttempted:true});
     return {committed:true,version:pkg.manifest.version,receipt:{session:9,size:512,offset:512,ack:44,phase:4,error:0,committed:true}};
    }},release:async()=>calls.push('lease-release')};}
 };
 runInNewContext(handlers+';globalThis.make=()=>cardFirmwareReinstallButton(entry);globalThis.direct=()=>updateLampCard(entry,{bluetoothOnly:true,allowReinstall:true});',context);
 return {context,entry,calls,messages,journal,tasks,button:context.make,direct:context.direct};
}

test('the production care button confirms an exact-current reinstall through only protected update reads',async()=>{
 const f=fixture(),button=f.button();assert.equal(button.textContent,'Reinstall current software');assert.equal(button.type,'button');assert.match(button.attributes['aria-label'],/Desk lamp/);
 assert.equal(button.disabled,false);await button.onclick();
 const confirmation=f.calls.find(row=>Array.isArray(row)&&row[0]==='confirmation');assert.match(confirmation[1],/Reinstall/);assert.match(confirmation[2],/same firmware 1.15.1/);assert.match(confirmation[2],/does not promise/);
 assert.equal(f.calls.filter(row=>Array.isArray(row)&&row[0]==='sender').length,1);assert.equal(f.journal.get(id).reinstall,true);assert.equal(f.journal.get(id).commitAcknowledged,true);assert.equal(f.journal.pending().length,0);
 assert(f.calls.includes('protected-snapshot'));assert.equal(f.tasks.size,0);
});

for(const fields of [{fresh:false},{installed:'1.13.0'},{installed:'1.10.0',publicRelease:release('1.10.0')},{authorized:false},{installed:null},{publicRelease:{version:'1.15.1',text:'malformed'}}])test('care does not offer an ineligible reinstall '+JSON.stringify(fields),()=>{
 const f=fixture(fields);assert.equal(f.button(),null);assert.equal(f.calls.length,0);assert.equal(f.journal.pending().length,0);
});

for(const change of ['removed','wrong-id','wrong-peripheral','revoked','new-authorization','no-device'])test('saved target fence prevents reinstall '+change,()=>{
 const f=fixture();if(change==='removed')f.context.groupRemovedIds.add(id);if(change==='wrong-id')f.entry.id=other;if(change==='wrong-peripheral')f.entry.deviceId='other';
 if(change==='revoked')f.context.removedAccessoryIds.add(f.entry.deviceId.toLowerCase());if(change==='new-authorization')f.context.store.items[0].newAuthorization=true;if(change==='no-device')delete f.context.store.items[0].deviceId;
 assert.equal(f.button(),null);assert.equal(f.calls.length,0);
});

test('a saved Android lamp uses its saved target without Apple accessory authorization',()=>{assert(fixture({authorized:false,platform:'android'}).button());});

for(const owner of ['busy','connecting','card','legacy-task','bulk','power','installing'])test('a current operation disables reinstall '+owner,()=>{
 const f=fixture();if(owner==='card')f.tasks.set(other,{});else if(owner==='legacy-task')f.context.bluetoothFirmwareTask={};else if(owner==='bulk')f.context.fleetUpdating=true;
 else if(owner==='power')f.context.powerLaneBusy=()=>true;else if(owner==='installing')f.context.fleetLampInstalling=()=>true;else f.context[owner]=true;
 const button=f.button();assert.equal(button.disabled,true);button.onclick();assert.equal(f.calls.length,0);
});

test('declining the actual reinstall dialog performs no intent write, transfer or target query',async()=>{
 const f=fixture({accept:false});await f.button().onclick();assert.deepEqual(f.calls.map(row=>Array.isArray(row)?row[0]:row),['public-check','confirmation']);
 assert.equal(f.journal.get(id),null);assert.equal(f.tasks.size,0);
});

test('foreground ownership canceled during confirmation cannot acquire a target or create an update intent',async()=>{
 const f=fixture({onConfirm:context=>context.cardFirmwareTasks.get(id).abort.abort('app-hidden')});await f.button().onclick();
 assert.deepEqual(f.calls.map(row=>Array.isArray(row)?row[0]:row),['public-check','confirmation']);assert.equal(f.journal.get(id),null);assert.equal(f.tasks.size,0);
});

test('a changed release before confirmation cannot turn Reinstall into an upgrade',async()=>{
 const f=fixture({onRefresh:context=>context.publicFirmware=release('1.15.2')});await f.button().onclick();assert.deepEqual(f.calls,['public-check']);assert.equal(f.journal.get(id),null);
});

test('a changed public cache after confirmation never replaces the approved artifact',async()=>{
 const original=release('1.15.1'),f=fixture({publicRelease:original,onConfirm:context=>context.publicFirmware=release('1.15.2')});await f.button().onclick();
 assert.equal(f.calls.find(row=>Array.isArray(row)&&row[0]==='download')[1],original.text);assert.equal(f.calls.find(row=>Array.isArray(row)&&row[0]==='sender')[1],original.text);
});

for(const kind of ['modern','modern-commit','legacy'])test('a pending '+kind+' receipt goes only to read-only reconciliation and is never cleared by the service action',async()=>{
 const f=fixture();let pending;if(kind==='legacy')f.context.legacyFirmwareReceipts.set(id,{identity:id,targetVersion:'1.15.1',outcome:'verification-required'});
 else{pending=f.journal.begin(id,release('1.15.1'),{reinstall:true});if(kind==='modern-commit'){f.journal.beforeWrite(pending,{operation:1,session:9});f.journal.beforeWrite(pending,{operation:2,session:9});f.journal.beforeWrite(pending,{operation:4,session:9});}}
 await f.button().onclick();await f.direct();assert.deepEqual(f.calls,[['read-only-check',id],['read-only-check',id]]);
 assert.equal(kind==='legacy'?f.context.legacyFirmwareReceipts.size:f.journal.pending().length,1);assert.equal(f.tasks.size,0);
});

test('a wrong protected identity stops reinstall before any sender or native write',async()=>{
 const f=fixture({scenario:'wrong-identity'});await f.button().onclick();assert(!f.calls.some(row=>Array.isArray(row)&&['sender','write'].includes(row[0])));assert.equal(f.journal.pending().length,0);
});

for(const version of ['1.15.0','1.15.2'])test('a stale card cannot reinstall a different protected receiver version '+version,async()=>{
 const f=fixture({receiverVersion:version});await f.button().onclick();
 assert.equal(f.calls.filter(row=>row==='private-lease').length,1,'version mismatch must not retry the connection');
 assert(!f.calls.some(row=>Array.isArray(row)&&['download','sender','write'].includes(row[0])));
 const saved=f.journal.get(id);assert.equal(saved.outcome,'installationNotStarted');assert.equal(f.journal.pending().length,0);
 for(const field of ['wifiCheckAttempted','wifiInstallAttempted','metadataIssued','beginAttempted','commitAttempted'])assert.equal(saved[field],false);
 assert(f.messages.some(value=>/software changed/i.test(value.message||'')));assert.equal(f.tasks.size,0);
});

for(const version of ['1.15.0','1.15.2'])test('a receiver version change during download fences strict reinstall '+version,async()=>{
 const f=fixture({afterDownloadVersion:version});await f.button().onclick();
 assert.equal(f.calls.filter(row=>row==='private-lease').length,2,'only preflight and fresh transfer preflight acquire a lease');
 assert.equal(f.calls.filter(row=>row==='lease-release').length,2);
 assert.equal(f.calls.filter(row=>Array.isArray(row)&&row[0]==='download').length,1);
 assert(!f.calls.some(row=>Array.isArray(row)&&['sender','write'].includes(row[0])));
 const saved=f.journal.get(id);assert.equal(saved.outcome,'installationNotStarted');assert.equal(f.journal.pending().length,0);
 for(const field of ['wifiCheckAttempted','wifiInstallAttempted','metadataIssued','beginAttempted','commitAttempted'])assert.equal(saved[field],false);
 assert(f.messages.some(value=>/software changed/i.test(value.message||'')));assert.equal(f.tasks.size,0);
});

test('fresh protected update-busy status prevents reinstall and preserves the read-only pending fence',async()=>{
 const f=fixture({scenario:'busy'});await f.button().onclick();assert(!f.calls.some(row=>Array.isArray(row)&&['download','sender','write'].includes(row[0])));
 assert.equal(f.journal.pending().length,1);assert.equal(f.journal.get(id).beginAttempted,false);assert.equal(f.journal.get(id).commitAttempted,false);
});

test('a changed update session fails closed before Begin or Finish can be written',async()=>{
 const f=fixture({scenario:'wrong-session'});await f.button().onclick();assert.deepEqual(f.calls.filter(row=>Array.isArray(row)&&row[0]==='write'),[['write',1]]);
 assert.equal(f.journal.get(id).commitAttempted,false);assert.equal(f.journal.get(id).beginAttempted,false);
});

test('a lost same-version final acknowledgment retains the original pending journal and offers only Check update next',async()=>{
 const f=fixture({scenario:'lost-final-ack'});await f.button().onclick();const pending=f.journal.get(id);assert.equal(pending.commitAttempted,true);assert.equal(pending.commitAcknowledged,false);assert.equal(f.journal.pending().length,1);
 const writes=f.calls.filter(row=>Array.isArray(row)&&row[0]==='write').length;await f.button().onclick();assert.equal(f.calls.filter(row=>Array.isArray(row)&&row[0]==='write').length,writes);assert.deepEqual(f.calls.at(-1),['read-only-check',id]);
 assert.equal(f.journal.get(id).attemptId,pending.attemptId);
});
