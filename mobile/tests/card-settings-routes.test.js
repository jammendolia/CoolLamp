import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampAddress} from '../src/lamps.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function extract(start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert(first>=0&&last>first,'The actual settings route implementation is available.');
 return source.slice(first,last);
}
const openSource=extract('async function openCardSettings(','\nconst openCardWifiSettings=');
const completeSource=extract('function completeCardSettings(','\nfunction cancelMeshSelection(');
const bluetoothSource=extract('async function connectCardBluetooth(','\nfunction completeCardSettings(');
const meshSource=extract('async function connectMeshCard(','\nasync function connectCardWifiAsync(');
const meshLeaseSource=extract('async function createMeshLampLease(','\nasync function connectMeshCard(');
const id='aabbccddeeff',other='112233445566';

for(const mode of ['offline-fleet','healthy-wifi','active-bridge'])test('bounded mesh recovery prioritizes '+mode+' without starving a saved Bluetooth bridge',async()=>{
 const entries=Array.from({length:20},(_,index)=>({id:(index+1).toString(16).padStart(12,'0'),address:'http://bridge-'+index+'.local',deviceId:'peripheral-'+index,accessoryManaged:true,firmwareVersion:'1.15.0'}));
 const active=mode==='active-bridge'?{identity:other,epoch:3}:null;
 const context={entries,active,selectMeshRecoveryCandidates,phonePlatform:'ios',lamp:active,groupRemovedIds:new Set(),
  fleetLampInstalling:()=>false,compareFirmwareVersions:()=>0,mergedLampEntries:()=>entries,meshBridgeSupported:()=>true,
  connectivity:{get:()=>({wifi:{fresh:mode==='healthy-wifi',state:mode==='healthy-wifi'?'connected':'disconnected'}})},
  acquireMeshLamp:async options=>options};
 runInNewContext(meshLeaseSource+';globalThis.plan=()=>createMeshLampLease("'+id+'",{recoveryOnly:true});',context);
 const plan=await context.plan();assert.equal(plan.candidates.length,2);
 assert.equal(plan.options.stopOnTimeout,true);assert.equal(plan.options.totalTimeout,10000);
 assert.equal(plan.candidates[0].transport===active&&Boolean(active)?'active':plan.candidates[0].kind,
  mode==='active-bridge'?'active':mode==='healthy-wifi'?'wifi':'bluetooth');
 assert(plan.candidates.some(candidate=>candidate.kind==='bluetooth'));
});

function routeFixture({active=null,activeId=id,offlineControl=true,paired=true,authorized=true,wifiState='unknown',wifiFresh=false,
 fleetState='unknown',inventoryCount=1,outcomes={},afterAttempt}={}){
 const calls=[],entry={id,name:'Pink Corkscrew',address:'http://pink-corkscrew.local',
  ...(paired?{deviceId:'saved-peripheral',accessoryManaged:authorized}:{})};
 const controller=new AbortController();
 const context={entry,calls,lampAddress,AbortController,controller,active,activeId,offlineControl,wifiState,wifiFresh,fleetState,
  inventory:Array.from({length:inventoryCount},(_,index)=>index===0?entry:{id:index.toString(16).padStart(12,'0'),
   name:'Other lamp '+index,address:'http://other-'+index+'.local',deviceId:'peripheral-'+index,accessoryManaged:true}),
  $:key=>({focus:()=>calls.push({kind:'focus',key})}),bluetoothFirmwareOwner:()=>null,
  firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},fleetLampInstalling:()=>false,
  status:message=>calls.push({kind:'message',message}),cancelMeshSelection:()=>{},
  promptWifiPassword:()=>calls.push({kind:'password'}),renderSettings(){},renderOptions(){},
  invoke:async(kind,target,options)=>{
   calls.push({kind,id:target.id,options});
   const result=outcomes[kind]??{connected:true,id:target.id};
   if(result?.connected)context.ui.adopt(kind,target);
   afterAttempt?.(context.ui,kind,controller);
   return result;
  }
 };
 runInNewContext(`
  let busy=false,connecting=false,wifiSettingsTarget=null,cardSettingsSerial=0,navigationSerial=3,
   bluetoothFirmwareConnectionSerial=7,settingsView='network',selected=null,state=null;
  const phonePlatform='ios',bleLamp={identity:null,deviceIdentity:null,epoch:1,supportsOfflineControl:offlineControl},
   wifiLamp={identity:null,epoch:1,base:''};
  let lamp={epoch:1};
  const fleetStatuses=new Map([[entry.id,{state:fleetState}]]),connectivity={get:()=>({wifi:{state:wifiState,fresh:wifiFresh}})};
  const mergedLampEntries=()=>inventory;
  const verifiedSelectedLamp=()=>Boolean(!connecting&&state&&selected&&lamp.identity===selected.id);
  function settingsSection(section){settingsView=section;calls.push({kind:'section',section});}
  function page(name){calls.push({kind:'page',name});navigationSerial++;wifiSettingsTarget=null;}
  function adopt(kind,target){
   selected={...target};state={mode:4,power:true};
   if(kind==='wifi'){lamp=wifiLamp;wifiLamp.identity=target.id;wifiLamp.base=lampAddress(target.address);}
   else if(kind==='bluetooth'){lamp=bleLamp;bleLamp.identity=target.id;bleLamp.deviceIdentity=target.id;}
   else lamp={identity:target.id,isMesh:true,epoch:1};
  }
  const connectCardWifiAsync=(target,intent)=>invoke('wifi',target,intent);
  const connectCardBluetooth=(target,options)=>invoke('bluetooth',target,options);
  const connectMeshCard=(target,intent)=>invoke('mesh',target,intent);
  ${completeSource}
  ${openSource}
  if(active)adopt(active,{...entry,id:activeId});
  globalThis.ui={adopt,open:options=>openCardSettings(entry,{section:'hardware',navigate:false,signal:controller.signal,...options}),
   change(kind){if(kind==='navigation')navigationSerial++;else if(kind==='inventory')inventory=[...inventory.slice(1)];},
   snapshot:()=>({id:selected?.id,section:settingsView,intent:wifiSettingsTarget})};`,context);
 return {...context.ui,calls,entry,controller};
}
const attempts=f=>f.calls.filter(call=>['wifi','bluetooth','mesh'].includes(call.kind));

for(const route of ['bluetooth','mesh']){
 test('verified active '+route+' opens LED settings with Wi-Fi preference without reconnecting',async()=>{
  const f=routeFixture({active:route}),result=await f.open({preferWifi:true});
  assert.equal(result?.connected,true);assert.equal(result.id,id);assert.equal(f.snapshot().section,'hardware');
  assert.deepEqual(attempts(f),[]);
 });
 test('verified '+route+' for another lamp is never reused for the selected lamp',async()=>{
  const f=routeFixture({active:route,activeId:other}),result=await f.open({preferWifi:true});
  assert.equal(result?.connected,true);assert.equal(f.snapshot().id,id);
  assert.deepEqual(attempts(f).map(call=>call.kind),['bluetooth']);
 });
}

test('fresh confirmed Wi-Fi is attempted before the saved paired target',async()=>{
 const f=routeFixture({wifiFresh:true,wifiState:'connected',outcomes:{wifi:{connected:false}}});
 assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['wifi','bluetooth']);
 assert.equal(attempts(f)[1].options.readOnlyReconnect,true);
});

for(const wifi of [{wifiFresh:false,wifiState:'connected'},{wifiFresh:true,wifiState:'disconnected'},{wifiFresh:false,wifiState:'unknown'}]){
 test('paired target wins before mesh and unconfirmed Wi-Fi '+JSON.stringify(wifi),async()=>{
  const f=routeFixture({...wifi,outcomes:{bluetooth:{connected:false},wifi:{connected:false}}});
  assert.equal((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>call.kind),['bluetooth','wifi','mesh']);
  assert(attempts(f).every(call=>call.id===id));
 });
}

test('stale offline inventory cannot suppress direct Wi-Fi after paired Bluetooth fails',async()=>{
 const f=routeFixture({wifiFresh:false,wifiState:'disconnected',fleetState:'offline',outcomes:{bluetooth:{connected:false}}});
 assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['bluetooth','wifi']);
});

for(const inventoryCount of [1,20]){
 test(inventoryCount+' lamp inventory uses only the selected saved Bluetooth route when it succeeds',async()=>{
  const f=routeFixture({inventoryCount});assert.equal((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>[call.kind,call.id]),[['bluetooth',id]]);
  assert.equal(attempts(f)[0].options.readOnlyReconnect,true);
 });
}

test('an iOS lamp without existing accessory authorization is not silently reconnected over Bluetooth',async()=>{
 const f=routeFixture({authorized:false});assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['wifi']);
});

for(const interruptedBy of ['abort','navigation','inventory']){
 test('cancellation by '+interruptedBy+' between stages stops all later connection attempts',async()=>{
  const f=routeFixture({outcomes:{bluetooth:{connected:false}},afterAttempt:(ui,kind,controller)=>{
   if(kind!=='bluetooth')return;if(interruptedBy==='abort')controller.abort();else ui.change(interruptedBy);
  }});
  assert.notEqual((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>call.kind),['bluetooth']);assert.equal(f.snapshot().section,'network');
 });
}

function bluetoothFixture({automaticReconnect=false,readOnlyReconnect=false}={}){
 const calls=[],entry={id,name:'Pink Corkscrew',deviceId:'saved-peripheral',accessoryManaged:true},controller=new AbortController();
 const context={entry,calls,AbortController,controller,automaticReconnect,
  bluetoothFirmwareOwner:()=>null,firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},fleetLampInstalling:()=>false,
  status:message=>calls.push({kind:'message',message}),pairCardBluetooth:async()=>{calls.push({kind:'pair'});return true;},
  connect:async(target,options)=>{calls.push({kind:'connect',id:target.id,options});return {connected:true,id:target.id};}
 };
 runInNewContext(`
  let busy=false,connecting=false,navigationSerial=3,selected=null;
  const bleLamp={};let lamp={};
  const mergedLampEntries=()=>[entry],verifiedSelectedLamp=()=>false;
  const current=()=>true;
  let wifiSettingsTarget={id:entry.id,navigation:3,automaticReconnect,signal:controller.signal,isCurrent:current};
  ${bluetoothSource}
  globalThis.open=()=>connectCardBluetooth(entry,{forCardSettings:true,readOnlyReconnect:${readOnlyReconnect}});
 `,context);
 return {open:context.open,calls,controller};
}

test('actual paired settings reconnect passes read-only mode, exact identity and cancellation to the transport',async()=>{
 const f=bluetoothFixture({readOnlyReconnect:true});assert.equal((await f.open())?.connected,true);
 assert.equal(f.calls.filter(call=>call.kind==='pair').length,0);
 const {options,id:targetId}=f.calls.find(call=>call.kind==='connect');
 assert.equal(targetId,id);assert.equal(options.expectedId,id);assert.equal(options.readOnlyReconnect,true);
 assert.equal(options.automaticReconnect,true);assert.equal(options.navigate,false);assert.equal(options.preserveWifiIntent,true);
 assert.equal(options.signal,f.controller.signal);assert.equal(options.isCurrent(),true);
});

function meshFixture(automaticReconnect){
 const calls=[],entry={id,name:'Pink Corkscrew',meshBridgeId:other};
 const target={identity:id,epoch:1,bridge:{},lease:{borrowed:false},state:{mode:4,power:true},raw:{mode:4,firmware:{}},
  guard:()=>calls.push({kind:'guard'}),schedule:()=>calls.push({kind:'schedule'})};
 const context={entry,target,calls,AbortController,automaticReconnect,
  cancelMeshSelection(){},renderLamps(){},renderPower(){},renderFirmware(){},renderSettings(){},
  status:message=>calls.push({kind:'message',message}),bluetoothFirmwareOwner:()=>null,
  bindRecoveryAbort:(task,intent)=>{const abort=()=>task.abort.abort();intent.signal?.addEventListener('abort',abort,{once:true});return ()=>intent.signal?.removeEventListener('abort',abort);},
  createMeshLampLease:async(targetId,options)=>{calls.push({kind:'lease',id:targetId,options});return {lamp:target,release:async()=>calls.push({kind:'release'})};},
  stopGroupInspection:async targetId=>calls.push({kind:'stop-inspection',id:targetId}),
  transportCallbacks:()=>({}),connected:(_,options)=>calls.push({kind:'connected',options}),$:()=>({hidden:true})
 };
 runInNewContext(`
  let meshSelection=null,selected=null,navigationSerial=3,bluetoothFirmwareConnectionSerial=7;
  let lamp={disconnect:async()=>calls.push({kind:'disconnect'})};
  const callbacks={onState(){},onFirmware(){},onOptions(){}};
  const store={items:[entry],upsert:value=>value},mergedLampEntries=()=>[entry];
  let wifiSettingsTarget={id:entry.id,navigation:3,firmwareSerial:7,automaticReconnect,isCurrent:()=>true};
  ${meshSource}
  globalThis.open=()=>connectMeshCard(entry,wifiSettingsTarget);
 `,context);
 return {open:context.open,calls,target};
}

for(const automaticReconnect of [false,true]){
 test('actual '+(automaticReconnect?'automatic':'manual')+' mesh settings uses existing routes without provisioning',async()=>{
  const f=meshFixture(automaticReconnect);assert.equal((await f.open())?.connected,true);
  const lease=f.calls.find(call=>call.kind==='lease');assert.equal(lease.id,id);assert.equal(lease.options.bridgeId,other);
  assert.equal(lease.options.recoveryOnly,true);assert.equal(lease.options.isCurrent(),false);
  assert.equal(f.calls.filter(call=>call.kind==='lease').length,1);assert.equal(f.calls.filter(call=>call.kind==='schedule').length,1);
 });
}
