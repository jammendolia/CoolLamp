import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampAddress} from '../src/lamps.js';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';
import {meshRouteCandidates} from '../src/mesh-route-candidates.js';
import {ConnectionBroker,readOnlyConnectionFailure} from '../src/connection-broker.js';
import {MeshInventorySession} from '../src/mesh.js';
import {Groups} from '../src/groups.js';

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
const observeSource=extract('function observeBrokerConnection(','\nfunction fleetLampInstalling(');
const verifiedSource=extract('function verifiedSelectedLamp(','\nfunction mergedLampEntries(');
const id='aabbccddeeff',other='112233445566';

for(const mode of ['offline-fleet','healthy-wifi','active-bridge'])test('bounded mesh recovery prioritizes '+mode+' without starving a saved Bluetooth bridge',async()=>{
 const entries=Array.from({length:20},(_,index)=>({id:(index+1).toString(16).padStart(12,'0'),address:'http://bridge-'+index+'.local',deviceId:'peripheral-'+index,accessoryManaged:true,firmwareVersion:'1.15.0'}));
 const active=mode==='active-bridge'?{identity:other,epoch:3,request(){},raw:{mesh:{version:1,available:true}}}:null;
 const context={entries,active,selectMeshRecoveryCandidates,meshRouteCandidates,readOnlyConnectionFailure,meshInventory:new MeshInventorySession(),bridgeAccessories:{items:[]},phonePlatform:'ios',lamp:active,groupRemovedIds:new Set(),firmwareBackgroundWorkAllowed:()=>true,firmwareBackgroundGeneration:0,
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

for(const recoveryOnly of [false,true])test('mesh acquisition uncertainty is read-only only inside the verified recovery boundary '+recoveryOnly,async()=>{
 const error=Object.assign(Error('Target read was not confirmed.'),{uncertain:true,confirmed:false});
 const context={lamp:null,mergedLampEntries:()=>[],groupRemovedIds:new Set(),fleetLampInstalling:()=>false,
  compareFirmwareVersions:()=>0,meshRouteCandidates:()=>[],selectMeshRecoveryCandidates,readOnlyConnectionFailure,bridgeAccessories:{items:[]},
  phonePlatform:'ios',connectivity:null,meshInventory:new MeshInventorySession(),firmwareBackgroundWorkAllowed:()=>true,
  acquireMeshLamp:async()=>{throw error;}};
 runInNewContext(meshLeaseSource+';globalThis.open=()=>createMeshLampLease("'+id+'",{recoveryOnly:'+recoveryOnly+'});',context);
 await assert.rejects(context.open(),value=>recoveryOnly?value.readUncertain===true&&value.uncertain===false&&value.cause===error:value===error&&value.uncertain===true);
});

for(const field of ['cancelled','identity','identityChanged','stale','needsAuthorization','settingsUnavailable','resourceRefusal','targetResourceRefusal'])
 test('mesh recovery keeps '+field+' terminal even when its read result is uncertain',async()=>{
  const error=Object.assign(Error('Recovery refused.'),{uncertain:true,[field]:true});
  const context={lamp:null,mergedLampEntries:()=>[],groupRemovedIds:new Set(),fleetLampInstalling:()=>false,
   compareFirmwareVersions:()=>0,meshRouteCandidates:()=>[],selectMeshRecoveryCandidates,readOnlyConnectionFailure,bridgeAccessories:{items:[]},
   phonePlatform:'ios',connectivity:null,meshInventory:new MeshInventorySession(),firmwareBackgroundWorkAllowed:()=>true,
   acquireMeshLamp:async()=>{throw error;}};
  runInNewContext(meshLeaseSource+';globalThis.open=()=>createMeshLampLease("'+id+'",{recoveryOnly:true});',context);
  await assert.rejects(context.open(),value=>value===error&&value.uncertain===true&&!value.readUncertain);
 });

function routeFixture({active=null,activeId=id,offlineControl=true,paired=true,authorized=true,wifiState='unknown',wifiFresh=false,
 fleetState='unknown',inventoryCount=1,outcomes={},afterAttempt,connectionMessage=''}={}){
 const calls=[],entry={id,name:'Pink Corkscrew',address:'http://pink-corkscrew.local',
  ...(paired?{deviceId:'saved-peripheral',accessoryManaged:authorized}:{})};
 const controller=new AbortController();
 const context={entry,calls,lampAddress,AbortController,ConnectionBroker,connectionBroker:new ConnectionBroker(),controller,active,activeId,offlineControl,wifiState,wifiFresh,fleetState,
  inventory:Array.from({length:inventoryCount},(_,index)=>index===0?entry:{id:index.toString(16).padStart(12,'0'),
   name:'Other lamp '+index,address:'http://other-'+index+'.local',deviceId:'peripheral-'+index,accessoryManaged:true}),
  $:key=>({focus:()=>calls.push({kind:'focus',key})}),bluetoothFirmwareOwner:()=>null,
  firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},fleetLampInstalling:()=>false,
  status:message=>calls.push({kind:'message',message}),cancelMeshSelection:()=>{},
  beginForegroundConnection:()=>()=>{},groupRemovedIds:new Set(),meshInventory:new MeshInventorySession(),roomGroups:null,
  cardConnectionMessages:new Map(connectionMessage?[[id,connectionMessage]]:[]),
  observeLampLighting(){},observeLampWifi(){},
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
   lamp.raw={deviceId:target.id,mode:4,power:true,brightness:100,firmware:{version:'1.15.7'}};
  }
  const connectCardWifiAsync=(target,intent)=>invoke('wifi',target,intent);
  const connectCardBluetooth=(target,options)=>invoke('bluetooth',target,options);
  const connectMeshCard=(target,intent)=>invoke('mesh',target,intent);
  ${observeSource}
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
  assert.deepEqual(attempts(f).map(call=>call.kind),['mesh']);
 });
}

test('mesh is attempted before fresh Wi-Fi and the authorized paired target',async()=>{
 const f=routeFixture({wifiFresh:true,wifiState:'connected',outcomes:{mesh:{connected:false},wifi:{connected:false}}});
 assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['mesh','wifi','bluetooth']);
 assert.equal(attempts(f)[2].options.readOnlyReconnect,true);
});

for(const wifi of [{wifiFresh:false,wifiState:'connected'},{wifiFresh:true,wifiState:'disconnected'},{wifiFresh:false,wifiState:'unknown'}]){
 test('mesh-first selection ignores unconfirmed Wi-Fi telemetry '+JSON.stringify(wifi),async()=>{
  const f=routeFixture({...wifi});
  assert.equal((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>call.kind),['mesh']);
  assert(attempts(f).every(call=>call.id===id));
 });
}

test('stale offline inventory cannot suppress direct Wi-Fi after mesh fails',async()=>{
 const f=routeFixture({wifiFresh:false,wifiState:'disconnected',fleetState:'offline',outcomes:{mesh:{connected:false}}});
 assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['mesh','wifi']);
});

for(const refusedRoute of ['mesh','wifi','bluetooth'])test('a verified settings resource refusal over '+refusedRoute+' ends route recovery after the target answers',async()=>{
 const error=Object.assign(Error('Control resources unavailable. No command executed.'),{confirmed:true,status:503});
 const refusal={connected:false,settingsUnavailable:true,error};
 const outcomes={mesh:{connected:false},wifi:{connected:false},bluetooth:{connected:false},[refusedRoute]:refusal};
 const connectionMessage='Your lamp answered, but it does not have enough free memory to open settings.';
 const f=routeFixture({outcomes,connectionMessage});
 const result=await f.open();assert.equal(result?.connected,false);assert.equal(result?.settingsUnavailable,true);assert.equal(result?.error,error);
 assert.deepEqual(attempts(f).map(call=>call.kind),['mesh','wifi','bluetooth'].slice(0,['mesh','wifi','bluetooth'].indexOf(refusedRoute)+1));
 assert(f.calls.some(call=>call.kind==='message'&&call.message===connectionMessage));
 assert.equal(f.snapshot().intent,null);assert.equal(f.snapshot().section,'network');
});

for(const inventoryCount of [1,20]){
 test(inventoryCount+' lamp inventory requests only the selected target while falling back to saved Bluetooth',async()=>{
  const f=routeFixture({inventoryCount,outcomes:{mesh:{connected:false},wifi:{connected:false}}});assert.equal((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>[call.kind,call.id]),[['mesh',id],['wifi',id],['bluetooth',id]]);
  assert.equal(attempts(f)[2].options.readOnlyReconnect,true);
 });
}

test('an iOS lamp without existing accessory authorization is not silently reconnected over Bluetooth',async()=>{
 const f=routeFixture({authorized:false,outcomes:{mesh:{connected:false}}});assert.equal((await f.open())?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['mesh','wifi']);
});

for(const interruptedBy of ['abort','navigation','inventory']){
 test('cancellation by '+interruptedBy+' between stages stops all later connection attempts',async()=>{
  const f=routeFixture({outcomes:{mesh:{connected:false}},afterAttempt:(ui,kind,controller)=>{
   if(kind!=='mesh')return;if(interruptedBy==='abort')controller.abort();else ui.change(interruptedBy);
  }});
  assert.notEqual((await f.open())?.connected,true);
  assert.deepEqual(attempts(f).map(call=>call.kind),['mesh']);assert.equal(f.snapshot().section,'network');
 });
}

test('normal lamp-card Wi-Fi preference remains a hint and cannot bypass mesh-first selection',async()=>{
 const f=routeFixture({wifiFresh:true,wifiState:'connected'});assert.equal((await f.open({preferWifi:true}))?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['mesh']);
});

test('an explicit Bluetooth request stays on that route',async()=>{
 const f=routeFixture();assert.equal((await f.open({bluetooth:true}))?.connected,true);
 assert.deepEqual(attempts(f).map(call=>call.kind),['bluetooth']);
});

test('an uncertain mesh acquisition is never followed by another route or a repeated operation',async()=>{
 const error=Object.assign(Error('The mesh result was not confirmed.'),{uncertain:true});
 const f=routeFixture({outcomes:{mesh:{connected:false,error}}});
 assert.notEqual((await f.open())?.connected,true);assert.deepEqual(attempts(f).map(call=>call.kind),['mesh']);
});

function legacyFixture({migrate=true}={}){
 const calls=[],entry={id:'ble:saved-peripheral',deviceId:'saved-peripheral',accessoryManaged:true,name:'Old reading lamp'};
 const context={entry,calls,lampAddress,AbortController,bluetoothFirmwareOwner:()=>null,fleetLampInstalling:()=>false,
  firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},bridgeAccessories:{has:()=>false},cancelMeshSelection(){},
  beginForegroundConnection:()=>()=>{},status(){},renderSettings(){},renderOptions(){},
  $:()=>({focus:()=>calls.push('focus')}),pairCardBluetooth:()=>assert.fail('A saved native association must not pair again'),
  connect:async(value,options)=>{assert.equal(value.deviceId,entry.deviceId);assert.equal(options.expectedId,null);assert.equal(options.readOnlyReconnect,true);
   assert.equal(options.isCurrent(),true);calls.push('bluetooth');context.ui.adopt(migrate?'aabbccddeeff':entry.id);return {connected:true,id:migrate?'aabbccddeeff':entry.id};}};
 runInNewContext(`let busy=false,connecting=false,wifiSettingsTarget=null,cardSettingsSerial=0,navigationSerial=3,bluetoothFirmwareConnectionSerial=7,
  settingsView='network',selected={...entry},state=null;
  const phonePlatform='ios',store={items:[entry]},bleLamp={epoch:1,supportsOfflineControl:false},wifiLamp={};let lamp={};
  const mergedLampEntries=()=>store.items;
  ${verifiedSource}
  function settingsSection(value){settingsView=value;calls.push('section:'+value);}
  function page(value){navigationSerial++;wifiSettingsTarget=null;calls.push('page:'+value);}
  ${bluetoothSource}
  ${completeSource}
  ${openSource}
  globalThis.ui={open:()=>openCardSettings(entry,{section:'hardware'}),
   adopt(target){selected={...entry,id:target};store.items=[selected];lamp=bleLamp;bleLamp.id=entry.deviceId;
    bleLamp.deviceIdentity=target===entry.id?null:target;state={mode:4,power:true};},
   state:()=>({selected,settingsView,wifiSettingsTarget,navigationSerial})};`,context);
 return {...context.ui,calls,entry};
}

for(const migrate of [false,true])test('a saved native placeholder '+(migrate?'migrates through protected canonical identity':'retains old native-only identity')+' and opens its requested settings',async()=>{
 const f=legacyFixture({migrate}),result=await f.open();
 assert.equal(result.connected,true);assert.equal(result.id,migrate?id:f.entry.id);assert.equal(f.state().selected.id,result.id);
 assert.equal(f.state().settingsView,'hardware');assert.equal(f.state().wifiSettingsTarget,null);assert.equal(f.state().navigationSerial,4);
 assert.deepEqual(f.calls,['bluetooth','section:hardware','page:settings','focus']);
});

function observationFixture(){
 const events=[],entry={id,name:'Sonata Right'},raw={deviceId:id,name:entry.name,mode:4,power:true,brightness:100,token:'fixture-only',
  firmware:{version:'1.15.7',wifi:true},sync:{version:3,role:1,leader:id,maxMembers:32,maxSupportedMembers:32,protocolVersions:[2,3],order:[],peers:[]}};
 const catalog=Array.from({length:4},(_,index)=>({id:index+1,name:'Fixture '+(index+1),category:'calm',speed:true}));
 const broker=new ConnectionBroker(),groups=new Groups({getLamps:()=>[entry],acquire:()=>assert.fail('An observation cannot open another route')});
 const context={connectionBroker:broker,roomGroups:groups,groupRemovedIds:new Set(),meshInventory:new MeshInventorySession(),mergedLampEntries:()=>[entry],
  observeLampLighting:(...values)=>events.push(['light',...values]),observeLampWifi:(...values)=>events.push(['wifi',...values])};
 runInNewContext(observeSource+';globalThis.observe=observeBrokerConnection;',context);
 return {context,broker,groups,raw,catalog,events,observe:(value=raw,scope={})=>context.observe(id,{raw:value,catalog},'mesh',scope)};
}

test('the production broker observer supplies verified foreground membership to Groups and light telemetry',()=>{
 const f=observationFixture();f.observe();
 const row=f.groups.snapshot().groups[0];assert.equal(row.id,id);assert.equal(row.available,true);assert.equal(row.leader.verified,true);
 assert.equal(f.broker.get(id).raw.sync.role,1);assert.equal(f.broker.get(id).raw.token,undefined);
 assert.deepEqual(f.events.map(event=>event[0]),['light','wifi']);assert.equal(f.events[0][1],id);assert.equal(f.events[0][2],f.raw);
});

test('the production broker observer rejects a different device before changing Groups or telemetry',()=>{
 const f=observationFixture();f.observe({...f.raw,deviceId:other});
 assert.equal(f.groups.snapshot().lamps.length,0);assert.equal(f.broker.get(id).verified,false);assert.deepEqual(f.events,[]);
});

test('an older selection generation cannot republish group membership or light telemetry',async()=>{
 const f=observationFixture(),scopes=[];
 const select=()=>f.broker.select(id,{routes:[{kind:'mesh',acquire:scope=>{scopes.push(scope);return {};}}],verify:()=>true});
 await select();await select();f.observe(f.raw,scopes[0]);assert.equal(f.groups.snapshot().lamps.length,0);assert.deepEqual(f.events,[]);
 f.observe(f.raw,scopes[1]);assert.equal(f.groups.snapshot().groups[0].id,id);assert.deepEqual(f.events.map(event=>event[0]),['light','wifi']);
 for(const scope of scopes)scope.dispose();
});

test('a rejected replacement projection cannot renew the preceding cached device state',async()=>{
 const f=observationFixture();f.observe();const malformed={raw:{...f.raw,brightness:0},catalog:f.catalog};let retained;
 await f.broker.select(id,{routes:[{kind:'mesh',acquire:scope=>{retained=scope;return malformed;}}],verify:(transport,scope)=>{
  f.context.observe(id,transport,'mesh',scope);return true;
 }});
 assert.equal(f.broker.get(id).raw,undefined);assert.equal(f.events.length,2);retained.dispose();
});

function bluetoothFixture({automaticReconnect=false,readOnlyReconnect=false}={}){
 const calls=[],entry={id,name:'Pink Corkscrew',deviceId:'saved-peripheral',accessoryManaged:true},controller=new AbortController();
 const context={bridgeAccessories:{has:()=>false},entry,calls,AbortController,controller,automaticReconnect,
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
 assert.equal(options.automaticReconnect,false);assert.equal(options.navigate,false);assert.equal(options.preserveWifiIntent,true);
 assert.equal(options.signal,f.controller.signal);assert.equal(options.isCurrent(),true);
});

function meshFixture(automaticReconnect,bridgeScope=false){
 const calls=[],entry={id,name:'Pink Corkscrew',meshBridgeId:other};
 const target={isMesh:true,identity:id,epoch:1,bridge:bridgeScope?{isBridge:true,adoptScope:options=>{options.guard();calls.push({kind:'broker-scope',options});}}:{},lease:{borrowed:false},state:{mode:4,power:true},raw:{mode:4,firmware:{}},
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

test('main promotes the bridge broker to the adopted leaf owner after checking the live target lease',async()=>{
 const f=meshFixture(false,true);assert.equal((await f.open())?.connected,true);
 const acquisition=f.calls.find(call=>call.kind==='lease'),adoption=f.calls.find(call=>call.kind==='broker-scope');
 assert.equal(acquisition.options.isCurrent(),false);assert.equal(adoption.options.isCurrent(),true);
 assert.doesNotThrow(()=>adoption.options.guard());
 assert(f.calls.findIndex(call=>call.kind==='broker-scope')<f.calls.findIndex(call=>call.kind==='schedule'));
});

for(const automaticReconnect of [false,true]){
 test('actual '+(automaticReconnect?'automatic':'manual')+' mesh settings uses existing routes without provisioning',async()=>{
  const f=meshFixture(automaticReconnect);assert.equal((await f.open())?.connected,true);
  const lease=f.calls.find(call=>call.kind==='lease');assert.equal(lease.id,id);assert.equal(lease.options.bridgeId,other);
  assert.equal(lease.options.recoveryOnly,true);assert.equal(lease.options.isCurrent(),false);
  assert.equal(f.calls.filter(call=>call.kind==='lease').length,1);assert.equal(f.calls.filter(call=>call.kind==='schedule').length,1);
 });
}
