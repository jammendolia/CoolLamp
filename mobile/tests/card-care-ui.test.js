import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {availableCardRelease} from '../src/card-firmware.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function cardFirmwareButton('),source.indexOf('function fleetSeenTime('));
const release=parsePhoneManifest('COOLLAMP-OTA-1\n1.14.0\nesp32c3\ndual-ota-2031616\n288\n'+'a'.repeat(64)+'\n');
const entry={id:'aabbccddeeff',name:'Reading corner'};
function fixture(overrides={}){
 const calls=[],context={availableCardRelease,publicFirmware:release,publicFirmwareFresh:true,cardInstalledVersion:()=> '1.13.0',fleetRefreshRun:null,publicFirmwareRun:null,
  connecting:false,cardFirmwareTasks:new Map(),bluetoothFirmwareTask:null,fleetUpdating:false,powerLaneBusy:()=>false,fleetLampInstalling:()=>false,cardFirmwareUnconfirmed:new Map(),
  updateLampCard:value=>calls.push(['update',value.id]),refreshPublicFirmware:options=>calls.push(['release-check',options.force]),refreshLampFirmware:()=>calls.push(['version-check']),
  document:{createElement:()=>({dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;}})},...overrides};
 runInNewContext(helper+'\nglobalThis.makeButton=cardFirmwareButton;',context);
 return {button:context.makeButton(entry),calls};
}

test('a known newer release has a visible accessible update action for its lamp',()=>{
 const {button,calls}=fixture();assert.equal(button.dataset.connection,'update');assert.match(button.innerHTML,/<span>Update<\/span>/);
 assert.match(button.attributes['aria-label'],/Reading corner.*1\.14\.0/);assert.equal(button.disabled,false);
 button.onclick();assert.deepEqual(calls,[['update',entry.id]]);
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
 for(const overrides of [{connecting:true},{cardFirmwareTasks:new Map([[entry.id,{}]])},{bluetoothFirmwareTask:{}},{fleetUpdating:true},{powerLaneBusy:()=>true},{fleetLampInstalling:()=>true},{cardFirmwareUnconfirmed:new Map([[entry.id,'1.14.0']])}])assert.equal(fixture(overrides).button.disabled,true);
 const {button}=fixture({publicFirmware:null,publicFirmwareRun:Promise.resolve()});assert.equal(button.disabled,true);assert.match(button.innerHTML,/<span>Checking…<\/span>/);
});
