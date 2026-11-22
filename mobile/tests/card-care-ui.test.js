import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {availableCardRelease} from '../src/card-firmware.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function cardFirmwareButton('),source.indexOf('function fleetSeenTime('));
const release=parsePhoneManifest('COOLLAMP-OTA-1\n1.14.0\nesp32c3\ndual-ota-2031616\n288\n'+'a'.repeat(64)+'\n');
const entry={id:'aabbccddeeff',name:'Reading corner',address:'192.168.1.20'};
function fixture(overrides={},target=entry){
 const calls=[],context={availableCardRelease,publicFirmware:release,publicFirmwareFresh:true,cardInstalledVersion:()=> '1.13.0',fleetRefreshRun:null,publicFirmwareRun:null,
  firmwareAttempts:{pending:()=>[],get:()=>null},legacyFirmwareReceipts:new Map(),firmwareFeedback:{get:()=>null},checkLampUpdateResult:value=>calls.push(['check-update',value.id]),
  connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,powerLaneBusy:()=>false,fleetLampInstalling:()=>false,cardFirmwareUnconfirmed:new Map(),
  updateLampCard:(value,options)=>calls.push(['update',value.id,options]),cardPhoneFirmwareAvailable:()=>true,
  cardUpdateRouteChoice:async(_value,_evidence)=>'phone',mergedLampEntries:()=>[target],refreshPublicFirmware:options=>calls.push(['release-check',options.force]),refreshLampFirmware:()=>calls.push(['version-check']),
  document:{createElement:()=>({dataset:{},attributes:{},label:{textContent:''},querySelector(){return this.label;},setAttribute(name,value){this.attributes[name]=value;}})},...overrides};
 runInNewContext(helper+'\nglobalThis.makeButton=cardFirmwareButton;',context);
 return {button:context.makeButton(target),calls};
}

test('a known newer release has a visible accessible update action for its lamp',()=>{
 const {button,calls}=fixture();assert.equal(button.dataset.connection,'update');assert.match(button.innerHTML,/<span>Update<\/span>/);
 assert.match(button.attributes['aria-label'],/Reading corner.*1\.14\.0/);assert.equal(button.disabled,false);
 button.onclick();assert.deepEqual(calls,[['update',entry.id,undefined]]);
});

test('checking an unknown or current version never starts an update',()=>{
 for(const cardInstalledVersion of [()=>undefined,()=>'1.14.0']){
  const {button,calls}=fixture({cardInstalledVersion});assert.match(button.innerHTML,/<span>Check<\/span>/);assert.match(button.attributes['aria-label'],/Check firmware updates for Reading corner/);
  button.onclick();assert.deepEqual(calls,[['release-check',true],['version-check']]);
 }
});

test('a cached unverified public release only offers a forced check',()=>{
 const {button,calls}=fixture({publicFirmwareFresh:false});assert.match(button.innerHTML,/<span>Check<\/span>/);button.onclick();assert.deepEqual(calls,[['release-check',true],['version-check']]);
});

test('card care retains operation guards and communicates an active check',()=>{
 for(const overrides of [{connecting:true},{cardFirmwareTasks:new Map([[entry.id,{}]])},{bluetoothFirmwareTask:{}},{fleetUpdating:true},{powerLaneBusy:()=>true},{fleetLampInstalling:()=>true}])assert.equal(fixture(overrides).button.disabled,true);
 const {button}=fixture({publicFirmware:null,publicFirmwareRun:Promise.resolve()});assert.equal(button.disabled,true);assert.match(button.innerHTML,/<span>Checking…<\/span>/);
});
test('an unrelated passive fleet refresh does not masquerade as a public release check',()=>{
 const {button}=fixture({publicFirmware:null,publicFirmwareFresh:false,fleetRefreshRun:Promise.resolve()});
 assert.equal(button.disabled,false);assert.match(button.innerHTML,/<span>Check<\/span>/);
});
test('a reconciled unstarted Internet check offers an explicit phone route instead of silently repeating Wi-Fi',async()=>{
 const attempt={identity:entry.id,version:'1.14.0',outcome:'installationNotStarted',reinstall:false,wifiCheckAttempted:true,wifiInstallAttempted:false,
  metadataIssued:false,beginAttempted:false,commitAttempted:false,commitUnconfirmed:false,dataIssued:false,cancelAttempted:false,resumeAttempted:false};
 const {button,calls}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'installationNotStarted'})}});
 assert.equal(button.label.textContent,'Try again');assert.match(button.attributes['aria-label'],/Choose how to retry/);
 await button.onclick();assert.equal(calls.length,1);assert.equal(calls[0][0],'update');assert.equal(calls[0][1],entry.id);
 assert.deepEqual({...calls[0][2]},{bluetoothOnly:true,approvedRoute:'phone',approvedVersion:'1.14.0'});
});
test('the exact reconciled app-hidden transfer opens a fresh route choice before any new attempt',async()=>{
 const attempt={identity:entry.id,version:'1.14.0',text:release.text,size:release.size,sha256:release.sha256,outcome:'transferStopped',reinstall:false,
  wifiCheckAttempted:false,wifiInstallAttempted:false,metadataIssued:true,beginAttempted:true,dataIssued:true,commitAttempted:false,
  commitUnconfirmed:false,commitAcknowledged:false,cancelAttempted:false,resumeAttempted:false};
 let choose;const gate=new Promise(resolve=>choose=resolve),calls=[];
 const {button}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'transferStopped'})},
  cardPhoneFirmwareAvailable:()=>false,cardUpdateRouteChoice:async(_value,evidence)=>{calls.push(['route',evidence.settledOutcome,evidence.phoneFallbackAvailable]);return gate;},
  updateLampCard:(value,options)=>calls.push(['update',value.id,{...options}])});
 assert.equal(button.label.textContent,'Try again');const work=button.onclick();await Promise.resolve();
 assert.deepEqual(calls,[['route','transferStopped',false]]);choose('wifi');await work;
 assert.deepEqual(calls,[['route','transferStopped',false],['update',entry.id,{bluetoothOnly:false,approvedRoute:'wifi',approvedVersion:'1.14.0'}]]);
});
test('an addressless stopped transfer never offers a nonexistent Internet route',async()=>{
 const target={...entry,address:undefined},attempt={identity:target.id,version:'1.14.0',text:release.text,size:release.size,sha256:release.sha256,outcome:'transferStopped',reinstall:false,
  wifiCheckAttempted:false,wifiInstallAttempted:false,metadataIssued:true,beginAttempted:true,dataIssued:true,commitAttempted:false,
  commitUnconfirmed:false,commitAcknowledged:false,cancelAttempted:false,resumeAttempted:false};
 const {button,calls}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'transferStopped'})},
  cardPhoneFirmwareAvailable:()=>false,cardUpdateRouteChoice:async()=>{calls.push(['route']);return 'wifi';}},target);
 assert.match(button.attributes['aria-label'],/^Update Reading corner/);await button.onclick();
 assert.deepEqual(calls,[['update',target.id,undefined]]);
});
test('an addressless stopped transfer offers only its authorized phone route',async()=>{
 const target={...entry,address:undefined},attempt={identity:target.id,version:'1.14.0',text:release.text,size:release.size,sha256:release.sha256,outcome:'transferStopped',reinstall:false,
  wifiCheckAttempted:false,wifiInstallAttempted:false,metadataIssued:true,beginAttempted:true,dataIssued:true,commitAttempted:false,
  commitUnconfirmed:false,commitAcknowledged:false,cancelAttempted:false,resumeAttempted:false};
 const {button,calls}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'transferStopped'})},
  cardPhoneFirmwareAvailable:()=>true,cardUpdateRouteChoice:async(_value,evidence)=>{calls.push(['route',evidence.directInternetRetryAvailable,evidence.phoneFallbackAvailable]);return 'phone';}},target);
 await button.onclick();assert.deepEqual(calls[0],['route',false,true]);assert.equal(calls[1][0],'update');assert.equal(calls[1][1],target.id);
 assert.deepEqual({...calls[1][2]},{bluetoothOnly:true,approvedRoute:'phone',approvedVersion:'1.14.0'});
});
test('stopped-transfer recovery rejects any broadened or changed safety record',()=>{
 const base={identity:entry.id,version:'1.14.0',text:release.text,size:release.size,sha256:release.sha256,outcome:'transferStopped',reinstall:false,
  wifiCheckAttempted:false,wifiInstallAttempted:false,metadataIssued:true,beginAttempted:true,dataIssued:true,commitAttempted:false,
  commitUnconfirmed:false,commitAcknowledged:false,cancelAttempted:false,resumeAttempted:false};
 for(const patch of [{text:release.text+'x'},{size:289},{sha256:'b'.repeat(64)},{reinstall:true},{wifiCheckAttempted:true},{wifiInstallAttempted:true},
  {metadataIssued:false},{beginAttempted:false},{dataIssued:false},{commitAttempted:true},{commitUnconfirmed:true},{commitAcknowledged:true},
  {cancelAttempted:true},{resumeAttempted:true},{outcome:'unresolved'}]){
  const {button}=fixture({firmwareAttempts:{pending:()=>[],get:()=>({...base,...patch})},firmwareFeedback:{get:()=>({terminal:true,outcome:'transferStopped'})}});
  assert.equal(button.label.textContent,'Try again');assert.match(button.attributes['aria-label'],/^Update Reading corner/);
 }
});
test('the reconciled recovery choice can explicitly retry Internet without a second confirmation',async()=>{
 const attempt={identity:entry.id,version:'1.14.0',outcome:'installationNotStarted',wifiCheckAttempted:true,wifiInstallAttempted:false,
  metadataIssued:false,beginAttempted:false,commitAttempted:false,commitUnconfirmed:false};
 const {button,calls}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'installationNotStarted'})},
  cardUpdateRouteChoice:async()=> 'wifi'});
 await button.onclick();assert.equal(calls.length,1);assert.deepEqual({...calls[0][2]},{bluetoothOnly:false,approvedRoute:'wifi',approvedVersion:'1.14.0'});
});
test('declining or retiring a reconciled recovery target starts no update',async()=>{
 const attempt={identity:entry.id,version:'1.14.0',outcome:'installationNotStarted',wifiCheckAttempted:true,wifiInstallAttempted:false,
  metadataIssued:false,beginAttempted:false,commitAttempted:false,commitUnconfirmed:false};
 for(const overrides of [{cardUpdateRouteChoice:async()=> 'cancel'},{mergedLampEntries:()=>[]}]){
  const {button,calls}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'installationNotStarted'})},...overrides});
  await button.onclick();assert.deepEqual(calls,[]);
 }
});
test('unsafe or unverified attempts never offer the phone route',()=>{
 for(const patch of [{wifiInstallAttempted:true},{commitAttempted:true},{commitUnconfirmed:true},{outcome:'unresolved'},{version:'1.13.9'}]){
  const attempt={identity:entry.id,version:'1.14.0',outcome:'installationNotStarted',wifiCheckAttempted:true,wifiInstallAttempted:false,metadataIssued:false,beginAttempted:false,commitAttempted:false,commitUnconfirmed:false,...patch};
  const {button}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'installationNotStarted'})}});
  assert.equal(button.label.textContent,'Try again');
 }
 const attempt={identity:entry.id,version:'1.14.0',outcome:'installationNotStarted',wifiCheckAttempted:true,wifiInstallAttempted:false};
 const {button}=fixture({firmwareAttempts:{pending:()=>[],get:()=>attempt},firmwareFeedback:{get:()=>({terminal:true,outcome:'installationNotStarted'})},cardPhoneFirmwareAvailable:()=>false});
 assert.equal(button.label.textContent,'Try again');
});
test('a persisted unfinished update offers a status check and never another install',()=>{
 const {button,calls}=fixture({firmwareAttempts:{pending:()=>[{identity:entry.id}]},cardFirmwareUnconfirmed:new Map([[entry.id,'1.14.0']])});
 assert.equal(button.disabled,false);assert.equal(button.label.textContent,'Check update');button.onclick();assert.deepEqual(calls,[['check-update',entry.id]]);
});
test('an older app’s unfinished receipt offers the same read-only check',()=>{
 const {button,calls}=fixture({legacyFirmwareReceipts:new Map([[entry.id,{targetVersion:'1.14.0',outcome:'verification-required'}]])});
 assert.equal(button.disabled,false);assert.equal(button.label.textContent,'Check update');button.onclick();assert.deepEqual(calls,[['check-update',entry.id]]);
});
