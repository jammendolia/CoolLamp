import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {availableCardRelease,updateCardFirmware} from '../src/card-firmware.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {FirmwareScreenAwake} from '../src/firmware-screen-awake.js';
import {FirmwareAttemptJournal,reconcileFirmwareAttempt} from '../src/firmware-attempt.js';
import {firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation} from '../src/firmware-update-ui.js';
import {FirmwareUpdateDiagnostics} from '../src/firmware-update-diagnostics.js';
import {acknowledgedBluetoothUpdateSource} from '../src/update-source.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const cardHandler=source.slice(source.indexOf('async function updateLampCard('),source.indexOf('function cardFirmwareButton('));
const resultCheckHandler=source.slice(source.indexOf('async function checkLampUpdateResult('),source.indexOf('\nconst firmwareResultCheckAt='));
const release=version=>parsePhoneManifest(`COOLLAMP-OTA-1\n${version}\nesp32c3\ndual-ota-2031616\n288\n${'a'.repeat(64)}\n`);
function harness({available=release('1.15.0'),accept=true,wifiFailure=null,routeChoice='phone',installed='1.13.0',onCheck,onConfirm,onTransfer,staleUnconfirmed=false,addressless=false,productionReconcile=false,reconcileFailure=null,settleWriteFailures=0}={}){
 const entry={id:'aabbccddeeff',name:'Reading corner',address:addressless?undefined:'192.168.1.20',deviceId:'paired'},calls=[],messages=[];
 let inventory=[entry],running=installed,remainingWifiFailures=wifiFailure?1:0,remainingSettleWriteFailures=settleWriteFailures,journalWriteFailures=0;
 const data=new Map(),firmwareAttempts=new FirmwareAttemptJournal({getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(journalWriteFailures-- >0)throw Error('Storage unavailable.');data.set(key,value);}});
 const tasks=new Map(),cardMessages=new Map(),messageOwners=new Map();
 const context={AbortController,availableCardRelease,updateCardFirmware,cardFirmwareTasks:tasks,cardFirmwareMessages:cardMessages,cardFirmwareMessageOwners:messageOwners,pauseFirmwareBackgroundWork(){assert.equal(tasks.size,1);},
  firmwareAttempts,firmwareDiagnostics:new FirmwareUpdateDiagnostics({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}),FirmwareScreenAwake,native:{},firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation,acknowledgedBluetoothUpdateSource,rememberVerifiedUpdateResult(){},
  reconcileFirmwareAttempt:options=>reconcileFirmwareAttempt({...options,maxAttempts:1}),
  cardFirmwareUnconfirmed:new Map(staleUnconfirmed?[[entry.id,'1.15.0']]:[]),groupRemovedIds:new Set(),legacyFirmwareReceipts:new Map(),entry,calls,messages,
  powerLaneBusy:()=>false,fleetLampInstalling:()=>false,cardInstalledVersion:()=>installed,
  mergedLampEntries:()=>inventory,renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},refreshLampFirmware:()=>{},
  refreshPublicFirmware:async options=>{calls.push(['check',options.force]);await onCheck?.({remove:()=>{inventory=[];},changeAddress:()=>{inventory=[{...entry,address:'192.168.1.21'}];},hide:()=>tasks.get(entry.id).abort.abort('app-hidden')});return available;},
  cardUpdateConfirmation:async(_entry,manifest,options)=>{calls.push(['confirm',manifest.version,options.previousVersion]);await onConfirm?.({hide:()=>tasks.get(entry.id).abort.abort('app-hidden')});return accept;},
   cardPhoneFirmwareAvailable:()=>true,
  cardUpdateRouteChoice:async(_entry,error)=>{calls.push(['route',routeChoice,error.firmwareError??null]);return routeChoice;},
  checkLampUpdateResult:async()=>{
   calls.push(['reconcile']);const attempt=firmwareAttempts.get(entry.id);
   const result={identity:attempt.identity,attemptId:attempt.attemptId,safetyVersion:attempt.safetyVersion,outcome:'installationNotStarted',
    installedVersion:running,controlResponsive:true,receiverInactive:true,firmwareMayInstall:false,commitUnconfirmed:false};
   firmwareAttempts.settle(attempt,result);cardMessages.delete(entry.id);context.cardFirmwareUnconfirmed.delete(entry.id);return result;
  },
  firmwareFeedback:{begin:()=>1,update:(_id,value)=>messages.push(value.message)},
  bluetoothFirmwareFailureMessage:error=>error.message,status:message=>messages.push(message),
  validFirmwareVersion:value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value),
  fleet:{updateLamp:async(_entry,version)=>{calls.push(['wifi',version]);firmwareAttempts.beforeWifi(firmwareAttempts.get(entry.id),'/api/firmware/check');
   if(remainingWifiFailures-- >0)throw wifiFailure;running=version;if(remainingSettleWriteFailures>0){journalWriteFailures=remainingSettleWriteFailures;remainingSettleWriteFailures=0;}return {id:entry.id,state:'updated',verified:true,fresh:true,installedVersion:version};}},
  acquireCardFirmwareBluetooth:async()=>{calls.push(['ble']);if(reconcileFailure&&tasks.get(entry.id)?.reconciling)throw reconcileFailure;return {lamp:{identity:entry.id,refreshFirmware:async()=>({version:running,phase:0}),
   readFirmwareUpdateSnapshot:async()=>({identity:entry.id,observedAt:Date.now(),firmware:{version:running,phase:0},state:{mode:1,effectCount:38,power:true,brightness:100},receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}}),
   updateOverBluetooth:async(pkg,notify,options)=>{calls.push(['transfer',pkg.manifest.version]);await onTransfer?.({pkg,notify,options,remove:()=>{inventory=[];}});running=pkg.manifest.version;return {version:pkg.manifest.version,committed:true};}},release:async()=>calls.push(['release'])};},
  downloadPhoneFirmware:async(_http,options)=>{calls.push(['download',options.expectedManifest.version]);return {manifest:options.expectedManifest,image:new Uint8Array(288)};},
  CapacitorHttp:{},document:{hidden:false},isNative:false};
 runInNewContext(`let publicFirmware=${JSON.stringify(release('1.14.0'))},publicFirmwareFresh=true,publicFirmwareError='Phone offline';
 let connecting=false,bluetoothFirmwareTask=null,fleetUpdating=false,bluetoothFirmwareConnectionSerial=0;
 ${productionReconcile?resultCheckHandler:''}
 ${cardHandler}
 globalThis.update=()=>updateLampCard(entry);globalThis.check=()=>checkLampUpdateResult(entry);`,context);
 return {update:context.update,check:context.check,calls,messages,tasks,cardMessages,messageOwners,attempts:firmwareAttempts};
}

test('stale 1.14 label gets a fresh 1.15 confirmation and only installs the confirmed release',async()=>{
 const ui=harness();await ui.update();assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0']]);assert.equal(ui.tasks.size,0);
});
test('changed public offer is not installed when its fresh confirmation is cancelled',async()=>{
 const ui=harness({accept:false});await ui.update();assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0']]);assert.match(ui.cardMessages.values().next().value,/cancelled/);assert.equal(ui.tasks.size,0);
});
test('offline public check cannot install the old global or lamp-cached release',async()=>{
 const ui=harness({available:null});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert(ui.messages.some(message=>/did not start/.test(message)));assert.equal(ui.tasks.size,0);assert.equal(ui.attempts.pending().length,0);
});
test('a confirmed unstarted Wi-Fi failure transfers from the phone only after explicit consent',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('Offline'),{safeBluetoothFallback:true})});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['route','phone',null],['reconcile'],
  ['check',true],['ble'],['release'],['download','1.15.0'],['ble'],['transfer','1.15.0'],['release'],['ble'],['release']]);
});
test('choosing Internet retry reconciles first and retries the same release over Wi-Fi',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('No free memory'),{safeBluetoothFallback:true,firmwarePhase:5,firmwareError:8}),routeChoice:'wifi'});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['route','wifi',8],['reconcile'],
  ['check',true],['wifi','1.15.0']]);
 assert(!ui.calls.some(call=>['ble','download','transfer'].includes(call[0])));
});
test('declining the route choice reconciles the lamp but starts no second update',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('No free memory'),{safeBluetoothFallback:true,firmwarePhase:5,firmwareError:8}),routeChoice:'cancel'});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['route','cancel',8],['reconcile']]);
 assert(!ui.calls.some(call=>['ble','download','transfer'].includes(call[0])));
});
test('production reconciliation retires only its owned Wi-Fi fallback message after success or a failed check',async()=>{
 for(const reconcileFailure of [null,Error('Protected check unavailable.')]){
  const transient='The Internet download did not start. Checking that your lamp is unchanged…';
  const ui=harness({wifiFailure:Object.assign(Error('Offline'),{safeBluetoothFallback:true}),routeChoice:'cancel',productionReconcile:true,reconcileFailure});await ui.update();
  assert.equal(ui.cardMessages.has('aabbccddeeff'),false);assert.equal(ui.messageOwners.has('aabbccddeeff'),false);
  assert.notEqual(ui.messages.at(-1),transient);assert(!ui.calls.some(call=>['download','transfer'].includes(call[0])));
 }
});
test('production reconciliation retires an owned pending general-failure message',async()=>{
 const ui=harness({productionReconcile:true,settleWriteFailures:2});
 await ui.update();assert.equal(ui.attempts.pending().length,1,JSON.stringify(ui.calls));
 const transient=ui.cardMessages.get('aabbccddeeff'),owner=ui.messageOwners.get('aabbccddeeff');
 assert.equal(owner?.attemptId,ui.attempts.get('aabbccddeeff').attemptId);assert.equal(owner?.message,transient);
 await ui.update();assert.equal(ui.attempts.pending().length,0);assert.equal(ui.cardMessages.has('aabbccddeeff'),false);assert.equal(ui.messageOwners.has('aabbccddeeff'),false);
 assert.notEqual(ui.messages.at(-1),transient);
});
test('removed target during public release check cannot show confirmation or start an update',async()=>{
 const ui=harness({onCheck:actions=>actions.remove()});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert.equal(ui.tasks.size,0);
 assert(ui.messages.some(message=>/no longer available/i.test(message)&&/No update was started/.test(message)));
});
test('removed addressless target cannot pass the live-entry check through undefined addresses',async()=>{
 const ui=harness({addressless:true,onCheck:actions=>actions.remove()});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert.equal(ui.tasks.size,0);
 assert(ui.messages.some(message=>/no longer available/i.test(message)&&/No update was started/.test(message)));
});
test('app-hidden during the public manifest check reports a stopped preflight and sends nothing',async()=>{
 const ui=harness({onCheck:actions=>actions.hide()});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert.equal(ui.tasks.size,0);
 assert(ui.messages.some(message=>/Update check stopped when CoolLamp left the screen/.test(message)&&/Nothing was sent/.test(message)));
});
test('app-hidden while confirmation resolves false replaces preflight copy instead of reporting a user cancellation',async()=>{
 const ui=harness({accept:false,onConfirm:actions=>actions.hide()});await ui.update();assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0']]);
 assert(ui.messages.some(message=>/Update check stopped when CoolLamp left the screen/.test(message)&&/Nothing was sent/.test(message)));
 assert(![...ui.cardMessages.values()].some(message=>/Update cancelled/.test(message)));
});
test('an address change during release verification reports an honest retry instead of silently returning',async()=>{
 const ui=harness({onCheck:actions=>actions.changeAddress()});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert.equal(ui.tasks.size,0);
 assert(ui.messages.some(message=>/connection changed/i.test(message)&&/Nothing was sent/.test(message)));
});
test('a stale terminal UI fence cannot turn Try again into a silent no-op',async()=>{
 const ui=harness({staleUnconfirmed:true});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0']]);assert.equal(ui.tasks.size,0);
});
test('a safely stopped app-hidden transfer can begin one fresh confirmed attempt',async()=>{
 const ui=harness(),old=ui.attempts.begin('aabbccddeeff',release('1.15.0'));
 ui.attempts.beforeWrite(old,{operation:1,session:77});ui.attempts.beforeWrite(old,{operation:6,session:77});ui.attempts.beforeWrite(old,{operation:3,session:77});
 const current=ui.attempts.get('aabbccddeeff');ui.attempts.settle(current,{identity:current.identity,attemptId:current.attemptId,safetyVersion:current.safetyVersion,
  outcome:'transferStopped',installedVersion:'1.13.0',controlResponsive:true,receiverInactive:true,firmwareMayInstall:false,commitUnconfirmed:false});
 await ui.update();assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0']]);
 assert.equal(ui.attempts.pending().length,0);assert.equal(ui.attempts.get('aabbccddeeff').outcome,'installed');
});
test('unknown installed version cannot be called up to date or begin an update',async()=>{
 const ui=harness({installed:null});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert(ui.messages.some(message=>/did not start/.test(message)));
});
test('lost Wi-Fi install acknowledgment never falls back or installs the confirmed release twice',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('Unconfirmed request'),{uncertain:true,safeBluetoothFallback:true})});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['ble'],['release']]);
 assert(!ui.calls.some(call=>call[0]==='route'));assert(!ui.calls.some(call=>call[0]==='transfer'));
});

test('a mid-transfer native disconnect is reconciled once and announced outside the Lamps card',async()=>{
 const operations=[];
 const ui=harness({available:release('1.15.3'),installed:'1.15.2',wifiFailure:Object.assign(Error('Offline'),{safeBluetoothFallback:true}),
  onTransfer:async({notify,options})=>{
   for(const operation of [1,2,3]){operations.push(operation);await options.onBeforeWrite({operation,session:77});}
   notify({stage:'transferring',progress:2,acknowledgedBytes:8,total:288});
   throw Object.assign(Error('Private native disconnection detail.'),{stopReason:'native-disconnect',
    updateDiagnostic:{stopReason:'native-disconnect',phase:2,error:0,metadataIssued:true,beginAttempted:true,commitAttempted:false,acknowledgedBytes:8,writesAttempted:3}});
  }});
 await ui.update();
 assert.equal(ui.attempts.get('aabbccddeeff').outcome,'transferStopped');assert.equal(ui.attempts.pending().length,0);
 assert.equal(ui.tasks.size,0);assert.deepEqual(operations,[1,2,3]);
 assert.equal(ui.calls.filter(call=>call[0]==='transfer').length,1);assert.equal(ui.calls.filter(call=>call[0]==='ble').length,3);
 assert(ui.messages.some(message=>/^Reading corner: .*connection to your lamp was interrupted/i.test(message)&&message.includes('Your lamp was not updated.')));
 assert(!ui.messages.some(message=>message.includes('Private native')||/Your lamp is updated/.test(message)));
});

test('a retired target cannot announce its result on another current screen or replay a failed transfer',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('Offline'),{safeBluetoothFallback:true}),onTransfer:async({options,remove})=>{
  for(const operation of [1,2,3])await options.onBeforeWrite({operation,session:77});
  remove();throw Object.assign(Error('Link ended.'),{stopReason:'native-disconnect'});
 }});
 await ui.update();assert.equal(ui.tasks.size,0);assert.equal(ui.attempts.pending().length,1);
 assert.equal(ui.calls.filter(call=>call[0]==='transfer').length,1);
 assert(!ui.messages.some(message=>/^Reading corner: /.test(message)));
 assert(![...ui.cardMessages.values()].some(message=>/Nothing was sent|No update was started/.test(message)));
});
