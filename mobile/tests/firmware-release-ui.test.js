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

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const cardHandler=source.slice(source.indexOf('async function updateLampCard('),source.indexOf('function cardFirmwareButton('));
const release=version=>parsePhoneManifest(`COOLLAMP-OTA-1\n${version}\nesp32c3\ndual-ota-2031616\n288\n${'a'.repeat(64)}\n`);
function harness({available=release('1.15.0'),accept=true,wifiFailure=null,installed='1.13.0',onCheck}={}){
 const entry={id:'aabbccddeeff',name:'Reading corner',address:'192.168.1.20',deviceId:'paired'},calls=[],messages=[];
 let inventory=[entry],running=installed;
 const data=new Map(),firmwareAttempts=new FirmwareAttemptJournal({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)});
 const tasks=new Map(),cardMessages=new Map();
 const context={AbortController,availableCardRelease,updateCardFirmware,cardFirmwareTasks:tasks,cardFirmwareMessages:cardMessages,pauseFirmwareBackgroundWork(){assert.equal(tasks.size,1);},
  firmwareAttempts,firmwareDiagnostics:new FirmwareUpdateDiagnostics({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)}),FirmwareScreenAwake,native:{},firmwareUpdatePresentation,firmwareUpdateFailurePresentation,firmwareUpdateResultPresentation,rememberVerifiedUpdateResult(){},
  reconcileFirmwareAttempt:options=>reconcileFirmwareAttempt({...options,maxAttempts:1}),
  cardFirmwareUnconfirmed:new Map(),groupRemovedIds:new Set(),legacyFirmwareReceipts:new Map(),entry,calls,messages,
  powerLaneBusy:()=>false,fleetLampInstalling:()=>false,cardInstalledVersion:()=>installed,
  mergedLampEntries:()=>inventory,renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},refreshLampFirmware:()=>{},
  refreshPublicFirmware:async options=>{calls.push(['check',options.force]);await onCheck?.(()=>{inventory=[];});return available;},
  cardUpdateConfirmation:async(_entry,manifest,options)=>{calls.push(['confirm',manifest.version,options.previousVersion]);return accept;},
  firmwareFeedback:{begin:()=>1,update:(_id,value)=>messages.push(value.message)},
  bluetoothFirmwareFailureMessage:error=>error.message,status:message=>messages.push(message),
  validFirmwareVersion:value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value),
  fleet:{updateLamp:async(_entry,version)=>{calls.push(['wifi',version]);if(wifiFailure){if(wifiFailure.uncertain)firmwareAttempts.beforeWifi(firmwareAttempts.get(entry.id),'/api/firmware/install');throw wifiFailure;}running=version;return {id:entry.id,state:'updated',verified:true,fresh:true,installedVersion:version};}},
  acquireCardFirmwareBluetooth:async()=>{calls.push(['ble']);return {lamp:{identity:entry.id,refreshFirmware:async()=>({version:running,phase:0}),
   readFirmwareUpdateSnapshot:async()=>({identity:entry.id,observedAt:Date.now(),firmware:{version:running,phase:0},state:{mode:1,effectCount:38,power:true,brightness:100},receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}}),
   updateOverBluetooth:async pkg=>{calls.push(['transfer',pkg.manifest.version]);running=pkg.manifest.version;return {version:pkg.manifest.version,committed:true};}},release:async()=>calls.push(['release'])};},
  downloadPhoneFirmware:async(_http,options)=>{calls.push(['download',options.expectedManifest.version]);return {manifest:options.expectedManifest,image:new Uint8Array(288)};},
  CapacitorHttp:{},document:{hidden:false},isNative:false};
 runInNewContext(`let publicFirmware=${JSON.stringify(release('1.14.0'))},publicFirmwareFresh=true,publicFirmwareError='Phone offline';
 let connecting=false,bluetoothFirmwareTask=null,fleetUpdating=false,bluetoothFirmwareConnectionSerial=0;
 ${cardHandler}
 globalThis.update=()=>updateLampCard(entry);`,context);
 return {update:context.update,calls,messages,tasks,cardMessages,attempts:firmwareAttempts};
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
test('offline lamp uses the same freshly confirmed global manifest over Bluetooth',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('Offline'),{safeBluetoothFallback:true})});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['ble'],['release'],['download','1.15.0'],['ble'],['transfer','1.15.0'],['release'],['ble'],['release']]);
});
test('removed target during public release check cannot show confirmation or start an update',async()=>{
 const ui=harness({onCheck:remove=>remove()});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert.equal(ui.tasks.size,0);
});
test('unknown installed version cannot be called up to date or begin an update',async()=>{
 const ui=harness({installed:null});await ui.update();assert.deepEqual(ui.calls,[['check',true]]);assert(ui.messages.some(message=>/did not start/.test(message)));
});
test('lost Wi-Fi install acknowledgment never falls back or installs the confirmed release twice',async()=>{
 const ui=harness({wifiFailure:Object.assign(Error('Unconfirmed request'),{uncertain:true,safeBluetoothFallback:true})});await ui.update();
 assert.deepEqual(ui.calls,[['check',true],['confirm','1.15.0','1.14.0'],['wifi','1.15.0'],['ble'],['release']]);assert(ui.messages.some(message=>/not confirmed/.test(message)));assert(!ui.calls.some(call=>call[0]==='transfer'));
});
