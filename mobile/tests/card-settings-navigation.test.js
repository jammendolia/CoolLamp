import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampAddress} from '../src/lamps.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function extract(start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert(first>=0&&last>first,'The actual card settings functions are available.');
 return source.slice(first,last);
}
const openSource=extract('async function openCardSettings(','\nconst openCardWifiSettings=');
const completeSource=extract('function completeCardSettings(','\nfunction cancelMeshSelection(');
const id='aabbccddeeff',other='112233445566',activeAddress='http://192.168.1.40';

function fixture({address='http://reading-lamp.local',busy=false,connecting=false,installing=false,beforeComplete,duringSection}={}){
 const calls=[],entry={id,name:'New reading lamp',address,deviceId:'saved-bluetooth-id'};
 const context={calls,entry,lampAddress,AbortController,console,
  $:key=>({focus:()=>calls.push({kind:'focus',key})}),
  bluetoothFirmwareOwner:()=>null,firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},fleetLampInstalling:()=>installing,
  status:message=>calls.push({kind:'message',message}),cancelMeshSelection:()=>calls.push({kind:'cancel-selection'}),
  promptWifiPassword:()=>calls.push({kind:'password'}),renderSettings(){},renderOptions(){},
  beforeComplete:(intent)=>beforeComplete?.(context.ui,intent),duringSection:()=>duringSection?.(context.ui),
  connectCardWifiAsync:async()=>{calls.push({kind:'connect-wifi'});throw Error('A verified active route should be reused.');},
  connectCardBluetooth:async()=>{calls.push({kind:'connect-bluetooth'});throw Error('Bluetooth must not reconnect for an active verified lamp.');},
  connectMeshCard:async()=>{calls.push({kind:'connect-mesh'});throw Error('Mesh must not reconnect for an active verified lamp.');}
 };
 runInNewContext(`
  let busy=${busy},connecting=${connecting},wifiSettingsTarget=null,cardSettingsSerial=0,navigationSerial=3,bluetoothFirmwareConnectionSerial=7,settingsView='network';
  let inventory=[entry],selected={...entry},state={mode:4,power:true};
  const bleLamp={},wifiLamp={base:'${activeAddress}',epoch:12,identity:entry.id};let lamp=wifiLamp;
  const phonePlatform='ios',fleetStatuses=new Map(),connectivity={get:()=>({wifi:{state:'connected'}})};
  const mergedLampEntries=()=>inventory;
  const verifiedSelectedLamp=()=>Boolean(!connecting&&state&&selected&&lamp===wifiLamp&&wifiLamp.identity===selected.id);
  function settingsSection(section){settingsView=section;calls.push({kind:'section',section});duringSection();}
  function page(name){calls.push({kind:'page',name});navigationSerial++;wifiSettingsTarget=null;}
  ${completeSource}
  const completeActual=completeCardSettings;
  completeCardSettings=intent=>{beforeComplete(intent);return completeActual(intent);};
  ${openSource}
  globalThis.ui={open:options=>openCardSettings(entry,options),
   snapshot:()=>({id:selected?.id,section:settingsView,navigation:navigationSerial,intent:wifiSettingsTarget,base:lamp.base,epoch:lamp.epoch}),
   change(kind){
    if(kind==='identity')wifiLamp.identity='${other}';
    else if(kind==='selected')selected={id:'${other}',name:'Another lamp'};
    else if(kind==='epoch')wifiLamp.epoch++;
    else if(kind==='active-address')wifiLamp.base='http://192.168.1.41';
    else if(kind==='inventory-address')inventory=[{...entry,address:'http://another-address.local'}];
    else if(kind==='inventory-device')inventory=[{...entry,deviceId:'different-bluetooth-id'}];
    else if(kind==='inventory-target')inventory=[{...entry,id:'${other}'}];
    else if(kind==='navigation')navigationSerial++;
    else if(kind==='display-name')inventory=[{...entry,name:'Renamed reading lamp'}];
   }
  };`,context);
 return {...context.ui,calls,entry};
}
const connections=calls=>calls.filter(value=>value.kind.startsWith('connect-'));

for(const section of ['design','hardware']){
 test('verified Wi-Fi IP and inventory mDNS alias open '+section+' without reconnecting',async()=>{
  const f=fixture(),result=await f.open({section});
  assert.equal(result?.connected,true);assert.equal(result.id,id);assert.equal(f.snapshot().section,section);
  assert.equal(f.snapshot().base,activeAddress);assert.equal(f.snapshot().epoch,12);assert.equal(connections(f.calls).length,0);
  assert.deepEqual(f.calls.filter(value=>value.kind==='page').map(value=>value.name),['settings']);
 });
}

test('matching inventory and active Wi-Fi addresses keep the existing success path',async()=>{
 const f=fixture({address:activeAddress});assert.equal((await f.open({section:'design'}))?.connected,true);
 assert.equal(f.snapshot().section,'design');assert.equal(connections(f.calls).length,0);
});

for(const section of ['design','hardware']){
 test('chooser-owned '+section+' navigation changes the section without opening a page',async()=>{
  const f=fixture(),result=await f.open({section,navigate:false});
  assert.equal(result?.connected,true);assert.equal(result.id,id);assert.equal(f.snapshot().section,section);
  assert.equal(f.snapshot().intent,null);assert.equal(f.snapshot().navigation,3);
  assert.equal(f.calls.filter(value=>value.kind==='page').length,0);assert.equal(connections(f.calls).length,0);
 });
}

test('changed connection or pinned inventory cannot complete a stale lamp selection',async()=>{
 for(const kind of ['identity','selected','epoch','active-address','inventory-address','inventory-device','inventory-target','navigation']){
  const f=fixture({beforeComplete:ui=>ui.change(kind)}),result=await f.open({section:'design',navigate:false});
  assert.notEqual(result?.connected,true,kind+' cannot report success');
  assert.equal(f.snapshot().section,'network',kind+' cannot open another lamp’s design controls');
  assert.equal(f.calls.filter(value=>value.kind==='page').length,0);assert.equal(connections(f.calls).length,0);
 }
});

test('a transport change during section rendering prevents completion and navigation',async()=>{
 for(const kind of ['identity','selected','epoch']){
  const f=fixture({duringSection:ui=>ui.change(kind)}),result=await f.open({section:'hardware'});
  assert.notEqual(result?.connected,true,kind+' cannot complete after rendering');
  assert.equal(f.calls.filter(value=>value.kind==='page').length,0);assert.equal(connections(f.calls).length,0);
 }
});

test('renaming display metadata does not invalidate the verified physical lamp',async()=>{
 const f=fixture({beforeComplete:ui=>ui.change('display-name')});assert.equal((await f.open({section:'design',navigate:false}))?.connected,true);
 assert.equal(f.snapshot().id,id);assert.equal(f.snapshot().section,'design');assert.equal(connections(f.calls).length,0);
});

test('busy, connecting and installing guards remain silent and nonmutating',async()=>{
 for(const options of [{busy:true},{connecting:true},{installing:true}]){
  const f=fixture(options);assert.equal(await f.open({section:'design',navigate:false}),undefined);
  assert.equal(f.calls.length,0);assert.equal(f.snapshot().id,id);assert.equal(f.snapshot().section,'network');assert.equal(f.snapshot().intent,null);
 }
});
