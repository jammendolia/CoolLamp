import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validFirmwareVersion} from '../src/lamps.js';
import {compareFirmwareVersions} from '../src/bluetooth-firmware.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert(first>=0&&last>first);return source.slice(first,last);}
const helper=extract('function verifiedOlderBluetoothSettings(){','\nfunction renderSettings()');
const hints=extract('  const observedGroup=selected?','\n  for(const button of document.querySelectorAll');
const fallback=extract('function reportWifiFallback(','\n$(\'connect\').onclick');
const legacy=extract('function legacyWithoutGroups(','\nfor(const button');
const id='aabbccddeeff';

function fixture({version='1.15.1',connected=true,identity=id,receivedAt=1,sameVersionObject=true,section='groups',advanced=false}={}){
 const elements=new Map(),messages=[];
 const context={version,connected,identity,receivedAt,sameVersionObject,section,advanced,id,messages,validFirmwareVersion,compareFirmwareVersions,
  status:value=>messages.push(value),$:key=>{if(!elements.has(key))elements.set(key,{textContent:'',hidden:false});return elements.get(key);}};
 runInNewContext(`
  const selected={id,name:'Desk lamp',firmwareVersion:'1.9.0'},firmware=version?{version}:null;
  const firmwareReceivedAt=receivedAt,state={capabilities:0};
  const bleLamp={deviceIdentity:identity,supportsOfflineGroups:false,state:{firmware:sameVersionObject?firmware:{version:'1.15.1'}}},wifiLamp={};
  const lamp=bleLamp,settingsView=section,connectivity={get:()=>({group:{fresh:false}})},wifiFailures=new Map();
  const verifiedSelectedLamp=()=>connected,advancedAvailable=()=>advanced,bluetoothWifiAvailable=()=>false;
  ${helper}
  ${legacy}
  function renderSettings(){${hints}}
  ${fallback}
  renderSettings();globalThis.fallback=()=>reportWifiFallback(Error('No Wi-Fi response.'));
 `,context);
 context.fallback();return {messages,settings:elements.get('settingsHint').textContent,membership:elements.get('lampGroupLightingHint').textContent};
}

test('fresh protected target firmware older than 1.10 keeps the applicable lamp firmware hint',()=>{
 const result=fixture({version:'1.9.6'});assert.match(result.settings,/firmware 1\.10\.0/);assert.match(result.membership,/firmware 1\.10\.0/);
 assert.match(result.messages.at(-1),/firmware 1\.10\.0/);
});

for(const options of [{version:'1.15.1'},{version:'1.10.0'},{version:null},{version:'unknown'},{version:'1.9.6',connected:false},
 {version:'1.9.6',identity:'112233445566'},{version:'1.9.6',receivedAt:0},{version:'1.9.6',sameVersionObject:false}])
test('missing settings do not invent a firmware upgrade requirement: '+JSON.stringify(options),()=>{
 const result=fixture(options);assert(!/firmware 1\.10\.0/.test([result.settings,result.membership,...result.messages].join(' ')));
 assert.match(result.settings,/haven’t been read yet/);assert.match(result.messages.at(-1),/haven’t read/);
});

test('modern hardware settings pending a snapshot use the same honest pending message',()=>{
 const result=fixture({section:'hardware',version:'1.15.1'});assert.match(result.settings,/haven’t been read yet/);assert(!/firmware 1\.10/.test(result.settings));
});
