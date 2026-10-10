import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {SettingsConnectionRecovery} from '../src/settings-recovery.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>{const offset=source.indexOf(start);assert(offset>=0,start+' exists');const limit=source.indexOf(end,offset+start.length);assert(limit>offset,end+' exists');return source.slice(offset,limit);};
const openSource=extract('async function openCardSettings(', '\nconst openCardWifiSettings=');
const bluetoothCardSource=extract('async function connectCardBluetooth(', '\nfunction completeCardSettings(');
const connectSource=extract('async function connect(saved ', '\nfunction connected(');
const connectedSource=extract('function connected(', '\nasync function connectWifi(');
const wifiProbeSource=extract('async function connectCardWifiAsync(', '\nfunction renderNewMeshLamps(');
const bindAbortSource=extract('function bindRecoveryAbort(', '\nasync function createMeshLampLease(');
const cancelMeshSource=extract('function cancelMeshSelection(', '\nfunction bindRecoveryAbort(');
const meshCardSource=extract('async function connectMeshCard(', '\nasync function connectCardWifiAsync(');
const disconnectSource=extract('  onDisconnect() {', '\n};\nconst phonePlatform=');
const recoverySource=extract('settingsRecovery=new SettingsConnectionRecovery({', '\nsetInterval(()=>settingsRecovery.check(),1000);');
const settingsConnectionSource=extract('function renderSettingsConnection(){', '\nfunction resolvedStyle(');
const id='aabbccddeeff',other='112233445566',deviceId='AAAAAAAA-0000-0000-0000-000000000001';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const elements=()=>{const rows=new Map();return {rows,$:key=>{if(!rows.has(key))rows.set(key,{hidden:false,disabled:false,open:false,value:'',textContent:'',style:{},dataset:{},setAttribute(){},focus(){},replaceChildren(){},close(){this.open=false;}});return rows.get(key);}};};

function cardHarness({platform='ios',saved=true,authorized=true,offline=true,wifi,bluetooth,mesh}={}){
  const calls=[],posts=[],view=elements(),entry={id,name:'Reading lamp',address:'http://lamp.fixture',...(saved?{deviceId,accessoryManaged:authorized}:{})};
  const context={AbortController,console,...view,calls,posts,phonePlatform:platform,entry,
    status:message=>calls.push({kind:'status',message}),page:name=>calls.push({kind:'page',name}),
    cancelMeshSelection:()=>{},bluetoothFirmwareOwner:()=>null,fleetLampInstalling:()=>false,firmwareConnectionSelectionAllowed:()=>false,firmwareConnectionNotice:()=>{},
    completeCardSettings:()=>{calls.push({kind:'complete'});return true;},promptWifiPassword:()=>calls.push({kind:'password'}),pairCardBluetooth:async()=>{calls.push({kind:'picker'});return false;},
    renderSettings:()=>calls.push({kind:'render-settings'}),renderOptions:()=>calls.push({kind:'render-options'})};
  context.connectCardWifiAsync=async(value,intent)=>{calls.push({kind:'wifi',id:value.id,intent});const result=wifi?await wifi(value,intent,context.ui):{connected:false,error:Error('Wi-Fi unavailable')};if(result?.connected)context.ui.adopt(value.id,'wifi');return result;};
  context.connect=async(value,options)=>{calls.push({kind:'bluetooth',id:value.id,options});const result=bluetooth?await bluetooth(value,options,context.ui):{connected:false,error:Error('Bluetooth unavailable')};if(result?.connected)context.ui.adopt(value.id,'bluetooth');return result;};
  context.connectMeshCard=async(value,intent)=>{calls.push({kind:'mesh',id:value.id,intent});const result=mesh?await mesh(value,intent,context.ui):{connected:false,error:Error('Mesh unavailable')};if(result?.connected)context.ui.adopt(value.id,'mesh');return result;};
  runInNewContext(`let busy=false,connecting=false,wifiSettingsTarget=null,cardSettingsSerial=0,navigationSerial=7,bluetoothFirmwareConnectionSerial=3;
    let selected={...entry},state=null,settingsView='network',verified=false;
    const bleLamp={},wifiLamp={},offlineLamp={};let lamp=offlineLamp;const fleetStatuses=new Map();
    const connectivity={get:()=>({wifi:{state:${offline?'"disconnected"':'"connected"'}}})};
    const mergedLampEntries=()=>[entry];const verifiedSelectedLamp=()=>verified;
    ${bluetoothCardSource}
    ${openSource}
    globalThis.ui={open:openCardSettings,scope(){return {selected,section:settingsView,navigation:navigationSerial};},
      adopt(target,route){selected={id:target,name:entry.name};verified=true;lamp=route==='bluetooth'?bleLamp:route==='wifi'?wifiLamp:offlineLamp;},
      navigate(){navigationSerial++;verified=false;},remove(){entry.id='removed';},intent(){return wifiSettingsTarget;}};`,context);
  return {...context.ui,calls,posts,entry,context,view};
}

test('actual automatic card recovery probes stale-offline Wi-Fi, then authorized Bluetooth without navigation',async()=>{
  const f=cardHarness({wifi:async()=>({connected:false,error:Object.assign(Error('Read reply lost'),{uncertain:true})}),bluetooth:async()=>({connected:true})});
  const controller=new AbortController(),result=await f.open(f.entry,{section:'network',automaticReconnect:true,signal:controller.signal,isCurrent:()=>true});
  assert.equal(result.connected,true);assert.deepEqual(f.calls.filter(value=>['wifi','bluetooth','mesh'].includes(value.kind)).map(value=>value.kind),['wifi','bluetooth']);
  const call=f.calls.find(value=>value.kind==='bluetooth');assert.equal(call.options.expectedId,id);assert.equal(call.options.automaticReconnect,true);assert.equal(call.options.signal,controller.signal);assert.equal(call.options.navigate,false);assert(call.options.isCurrent());
  assert(!f.calls.some(value=>['complete','page','picker','password'].includes(value.kind)));assert.equal(f.scope().section,'network');assert.equal(f.scope().navigation,7);assert.equal(f.intent(),null);assert.equal(f.posts.length,0);
});

test('actual automatic card recovery continues through trusted mesh after read-only route errors',async()=>{
  const f=cardHarness({bluetooth:async()=>({connected:false,error:Object.assign(Error('Protected read lost'),{uncertain:true})}),mesh:async()=>({connected:true})});
  const result=await f.open(f.entry,{section:'hardware',automaticReconnect:true});assert.equal(result.connected,true);
  assert.deepEqual(f.calls.filter(value=>['wifi','bluetooth','mesh'].includes(value.kind)).map(value=>value.kind),['wifi','bluetooth','mesh']);
  assert.equal(f.calls.find(value=>value.kind==='mesh').intent.automaticReconnect,true);assert(!f.calls.some(value=>['complete','page','picker','password'].includes(value.kind)));assert.equal(f.posts.length,0);
});

test('automatic recovery cannot authorize an unknown or legacy iPhone accessory',async()=>{
  for(const options of [{saved:false},{saved:true,authorized:false}]){
    const f=cardHarness({...options,mesh:async()=>({connected:true})});assert.equal((await f.open(f.entry,{automaticReconnect:true})).connected,true);
    assert.deepEqual(f.calls.filter(value=>['wifi','bluetooth','mesh'].includes(value.kind)).map(value=>value.kind),['wifi','mesh']);
    assert(!f.calls.some(value=>['picker','password'].includes(value.kind)));assert.equal(f.posts.length,0);
  }
});

test('saved Android Bluetooth is eligible without Apple accessory authorization',async()=>{
  const f=cardHarness({platform:'android',authorized:false,bluetooth:async()=>({connected:true})});
  assert.equal((await f.open(f.entry,{automaticReconnect:true})).connected,true);assert(f.calls.some(value=>value.kind==='bluetooth'));
  assert(!f.calls.some(value=>value.kind==='picker'));assert.equal(f.posts.length,0);
});

test('automatic missing-password failure never opens a password form or pairing picker',async()=>{
  const f=cardHarness({saved:false,wifi:async()=>({connected:false,error:Object.assign(Error('Saved access is missing'),{needsPassword:true})})});
  assert.equal((await f.open(f.entry,{automaticReconnect:true})).connected,false);
  assert(!f.calls.some(value=>['password','picker','complete','page'].includes(value.kind)));assert.equal(f.posts.length,0);
});

test('automatic card recovery checks cancellation/navigation before trying another route',async()=>{
  for(const reason of ['signal','navigation','scope']){
    const pending=deferred(),f=cardHarness({wifi:()=>pending.promise}),controller=new AbortController();let current=true;
    const running=f.open(f.entry,{automaticReconnect:true,signal:controller.signal,isCurrent:()=>current});await tick();
    if(reason==='signal')controller.abort();else if(reason==='navigation')f.navigate();else current=false;
    pending.resolve({connected:false,error:Error('Old Wi-Fi failure')});await running;
    assert.deepEqual(f.calls.filter(value=>['wifi','bluetooth','mesh'].includes(value.kind)).map(value=>value.kind),['wifi']);
    assert(!f.calls.some(value=>['page','complete','picker','password'].includes(value.kind)));assert.equal(f.posts.length,0);
  }
});

test('manual card opening retains its explicit completion/navigation contract',async()=>{
  const f=cardHarness({offline:false,wifi:async()=>({connected:true})});assert.equal((await f.open(f.entry,{section:'network'})).connected,true);
  assert.equal(f.calls.filter(value=>value.kind==='complete').length,1);assert.equal(f.posts.length,0);
});

function bluetoothHarness({gate=null,error=null,actualConnected=false}={}){
  const calls=[],posts=[],view=elements(),entry={id,deviceId,name:'Reading lamp',accessoryManaged:true};
  const ble={identity:id,epoch:1,expectedDeviceIdentity:null,raw:null,catalog:null,
    async connect(saved){calls.push({kind:'connect',saved,expected:this.expectedDeviceIdentity});if(gate)await gate.promise;if(error)throw error;context.ui.radioState();return {...saved,lampId:id,bluetoothName:'CoolLamp-A',accessoryName:'Reading lamp'};},
    async disconnect(){calls.push({kind:'disconnect-ble'});this.epoch++;}};
  const context={AbortController,console,...view,calls,posts,bleLamp:ble,
    store:{items:[entry],upsert(value){calls.push({kind:'save-card',id:value.id});return value;},rememberFirmware(){}},
    bluetoothFirmwareOwner:()=>null,fleetLampInstalling:()=>false,firmwareConnectionNotice:()=>{},cancelMeshSelection:()=>{},
    stopGroupInspection:async()=>{},status:message=>calls.push({kind:'status',message}),page:name=>calls.push({kind:'page',name}),
    roomGroups:{allow(){}},removedAccessoryIds:new Set(),groupRemovedIds:new Set(),
    provisionFirmwareFleet:()=>calls.push({kind:'provision'}),rememberAuthorizedAccessories:async()=>calls.push({kind:'authorize'}),
    pairingError:failure=>({message:failure.message,recovery:true,device:entry}),showPairingRecovery:()=>calls.push({kind:'picker-recovery'}),
    renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},renderSettings:()=>calls.push({kind:'render-settings'}),renderOptions:()=>calls.push({kind:'render-options'}),
    observeLampWifi:()=>{},advancedAvailable:()=>false,bluetoothWifiAvailable:()=>false,legacyWithoutGroups:()=>true,observeLampLighting:()=>{},
    document:{querySelectorAll:()=>[]},localStorage:{setItem(){}},filterEffects:()=>{}};
  if(!actualConnected)context.connected=(kind,options)=>calls.push({kind:'connected',route:kind,options});
  runInNewContext(`let lamp={identity:'old',disconnect:async()=>calls.push({kind:'disconnect-old'})},selected={...store.items[0]},state=null;
    let connecting=false,busy=false,navigationSerial=7,wifiSettingsTarget=null,firmware=null,pairingRecoveryTarget=null,savedDevice=null;
    let category='all',effectStyleFilter='all',styleDraftDirty=false,settingsView='network';
    const verifiedSelectedLamp=()=>Boolean(!connecting&&state&&lamp.identity===selected.id);
    ${connectSource}
    ${actualConnected?connectedSource:''}
    globalThis.ui={connect,radioState(){state={mode:4,power:true,capabilities:0,sync:{role:0}};},
      selectOther(){selected={id:'${other}',name:'Window lamp'};navigationSerial++;},state(){return {selected,connecting,section:settingsView};},
      connected:typeof connected==='function'?connected:null};`,context);
  return {...context.ui,calls,posts,entry,context,view,ble};
}

test('actual automatic Bluetooth recovery pins identity, skips prompts/trust provisioning and restores controls in finally',async()=>{
  const f=bluetoothHarness(),controller=new AbortController();
  assert.equal((await f.connect(f.entry,{expectedId:id,automaticReconnect:true,navigate:false,signal:controller.signal})).connected,true);
  const call=f.calls.find(value=>value.kind==='connect');assert.equal(call.expected,id);assert.equal(call.saved.automaticReconnect,true);
  assert(!f.calls.some(value=>['provision','authorize','picker-recovery','page'].includes(value.kind)));
  assert.equal(f.calls.find(value=>value.kind==='connected').options.quiet,true);assert.equal(f.calls.find(value=>value.kind==='connected').options.navigate,false);
  assert(f.calls.some(value=>value.kind==='render-settings'));assert(f.calls.some(value=>value.kind==='render-options'));assert.equal(f.state().connecting,false);assert.equal(f.view.$('connect').disabled,false);assert.equal(f.posts.length,0);
});

test('automatic Bluetooth failure remains silent and preserves the selected settings target',async()=>{
  const f=bluetoothHarness({error:Error('Authorization missing')});assert.equal((await f.connect(f.entry,{expectedId:id,automaticReconnect:true,navigate:false})).connected,false);
  assert(!f.calls.some(value=>['provision','authorize','picker-recovery','status','page','save-card'].includes(value.kind)));
  assert.equal(f.state().selected.id,id);assert.equal(f.state().section,'network');assert.equal(f.state().connecting,false);assert.equal(f.posts.length,0);
});

test('a cancelled or stale Bluetooth result cannot adopt a lamp or complete its old settings',async()=>{
  for(const cancel of [true,false]){
    const gate=deferred(),f=bluetoothHarness({gate}),controller=new AbortController();let current=true;
    const running=f.connect(f.entry,{expectedId:id,automaticReconnect:true,navigate:false,signal:controller.signal,isCurrent:()=>current});await tick();
    if(cancel)controller.abort();else{current=false;f.selectOther();}
    gate.resolve();assert.equal((await running).connected,false);assert(!f.calls.some(value=>['save-card','connected','provision','page'].includes(value.kind)));
    assert.equal(f.state().selected.id,cancel?id:other);assert.equal(f.posts.length,0);
  }
});

test('actual connected callback hides reconnect and keeps the requested settings section in quiet mode',async()=>{
  const f=bluetoothHarness({actualConnected:true});f.view.$('reconnect').hidden=false;
  assert.equal((await f.connect(f.entry,{expectedId:id,automaticReconnect:true,navigate:false})).connected,true);
  assert.equal(f.view.$('reconnect').hidden,true);assert.equal(f.state().section,'network');assert(!f.calls.some(value=>['page','status','provision'].includes(value.kind)));assert.equal(f.posts.length,0);
});

function wifiHarness({gate=null,disconnectGate=null}={}){
  const calls=[],posts=[],view=elements(),entry={id,name:'Reading lamp',address:'http://lamp.fixture',deviceId};
  const target={identity:null,epoch:1,async disconnect(){calls.push('disconnect-destination');},schedule(){calls.push('schedule');}};
  const context={AbortController,console,setTimeout,clearTimeout,CapacitorHttp:{},...view,calls,posts,entry,wifiLamp:target,
    WifiTransport:class{async connect(address,password,expected){calls.push({kind:'probe',address,expected});if(gate)await gate.promise;this.base=address;this.identity=expected;this.authorization='fixture';this.raw={deviceId:expected,hostname:'fixture.local',name:'Reading lamp',mode:4,firmware:{},effectOptions:[[50,100,0,1,2,3],[50,100,0,1,2,3],[50,100,0,1,2,3],[50,100,0,1,2,3]]};this.state={mode:4};this.catalog=[];return this.raw;}async disconnect(){calls.push('disconnect-probe');}},
    credential:async()=>({value:'fixture-only'}),bluetoothFirmwareOwner:()=>null,cancelMeshSelection:()=>{},renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},renderSettings:()=>{},status:()=>{},stopGroupInspection:async()=>{},
    store:{items:[entry],upsertWifi(value){calls.push({kind:'adopt',id:value.id});return value;}},groupRemovedIds:new Set(),roomGroups:{allow(){}},wifiFailures:new Map(),
    callbacks:{onState(){},onFirmware(){},onOptions(){}},connected:(kind,options)=>calls.push({kind:'connected',options})};
  const wired={...context,disconnectGate};
  runInNewContext(`let meshSelection=null,wifiSettingsTarget=null,navigationSerial=7,bluetoothFirmwareConnectionSerial=3,selected={...entry};
    let lamp={disconnect:async()=>{calls.push('disconnect-old');${disconnectGate?'await globalThis.disconnectGate.promise;':''}}};const mergedLampEntries=()=>[entry];
    ${bindAbortSource}${wifiProbeSource}
    globalThis.ui={probe:connectCardWifiAsync,intent(signal,isCurrent=()=>true){const value={id:entry.id,address:entry.address,deviceId:entry.deviceId,navigation:navigationSerial,firmwareSerial:3,automaticReconnect:true,signal,isCurrent};wifiSettingsTarget=value;return value;},move(){navigationSerial++;selected={id:'${other}'};},state(){return {selected,lamp};}};`,wired);
  return {...wired.ui,calls,posts,entry,view};
}

test('actual Wi-Fi probe cannot adopt a delayed response after navigation or abort',async()=>{
  for(const cancel of [true,false]){
    const gate=deferred(),f=wifiHarness({gate}),controller=new AbortController(),intent=f.intent(controller.signal);
    const running=f.probe(f.entry,intent);await tick();if(cancel)controller.abort();else f.move();gate.resolve();
    assert.equal((await running).connected,false);assert(!f.calls.some(value=>value.kind==='adopt'));assert.equal(f.state().selected.id,cancel?id:other);assert.equal(f.posts.length,0);
  }
});

test('actual Wi-Fi probe fences cancellation after disconnecting the old route before adoption',async()=>{
  const disconnectGate=deferred(),f=wifiHarness({disconnectGate}),controller=new AbortController(),intent=f.intent(controller.signal);
  const running=f.probe(f.entry,intent);await tick();assert(f.calls.includes('disconnect-old'));controller.abort();disconnectGate.resolve();
  assert.equal((await running).connected,false);assert(!f.calls.some(value=>value.kind==='adopt'));assert.equal(f.posts.length,0);
});

test('actual automatic Wi-Fi adoption uses the pinned identity and never changes the settings page',async()=>{
  const f=wifiHarness(),intent=f.intent(new AbortController().signal);assert.equal((await f.probe(f.entry,intent)).connected,true);
  assert.equal(f.calls.find(value=>value.kind==='probe').expected,id);assert.equal(f.calls.find(value=>value.kind==='adopt').id,id);
  assert.equal(f.calls.find(value=>value.kind==='connected').options.navigate,false);assert.equal(f.calls.find(value=>value.kind==='connected').options.quiet,true);assert.equal(f.posts.length,0);
});

function recoveryHandoffHarness({route='wifi',disconnectGate=null,leaseGate=null}={}){
  const calls=[],posts=[],view=elements(),entry={id,name:'Reading lamp',address:'http://lamp.fixture'};
  const raw={deviceId:id,hostname:'fixture.local',name:entry.name,mode:4,firmware:{},effectOptions:Array.from({length:4},()=>[50,100,0,1,2,3])};
  const wifi={identity:null,epoch:1,async disconnect(){calls.push('disconnect-wifi');},schedule(){calls.push('schedule-wifi');}};
  const mesh={identity:id,epoch:1,isMesh:true,bridge:{identity:other},lease:{borrowed:false},raw,state:{mode:4},signal:null,isCurrent:null,
    guard(){calls.push('guard-mesh');},schedule(){calls.push('schedule-mesh');}};
  const context={AbortController,console,setTimeout,clearTimeout,CapacitorHttp:{},Option:class{},...view,calls,posts,entry,wifiLamp:wifi,meshLamp:mesh,raw,
    phonePlatform:'ios',document:{hidden:false},SettingsConnectionRecovery:class extends SettingsConnectionRecovery{constructor(options){super({...options,timeoutMs:1000,retryDelayMs:0,maxAttempts:1});}},
    WifiTransport:class{async connect(address,password,expected){calls.push({kind:'probe',expected});Object.assign(this,{base:address,authorization:password,identity:expected,raw,state:{mode:4},catalog:[]});}async disconnect(){calls.push('disconnect-probe');}},
    credential:async()=>({value:route==='wifi'?'fixture-only':null}),bluetoothFirmwareOwner:()=>null,fleetLampInstalling:()=>false,firmwareConnectionBusy:()=>false,
    firmwareConnectionSelectionAllowed:()=>false,firmwareConnectionNotice:()=>{},stopGroupInspection:async()=>{},
    createMeshLampLease:async(target,options)=>{calls.push({kind:'mesh-acquire',target,options});mesh.signal=options.signal;mesh.isCurrent=options.isCurrent;if(leaseGate)await leaseGate.promise;return {lamp:mesh,release:async()=>calls.push('release-mesh')};},
    store:{items:[entry],upsert(value){calls.push({kind:'adopt',route:'mesh',id:value.id});return value;},upsertWifi(value){calls.push({kind:'adopt',route:'wifi',id:value.id});return value;}},
    groupRemovedIds:new Set(),roomGroups:{allow(){}},wifiFailures:new Map(),
    completeCardSettings:()=>calls.push({kind:'complete'}),promptWifiPassword:()=>calls.push({kind:'password'}),pairCardBluetooth:async()=>calls.push({kind:'picker'}),
    renderLamps:()=>{},renderPower:()=>{},renderFirmware:()=>{},renderSettings:()=>{},renderOptions:()=>{},renderSettingsConnection:()=>{},filterEffects:()=>{},
    invalidateGroupTasks:()=>{},hideWifiPassword:()=>{},
    status:message=>calls.push({kind:'status',message}),page:name=>calls.push({kind:'page',name}),
    queueMicrotask:action=>{calls.push('queued-disconnect-check');queueMicrotask(action);},disconnectGate};
  runInNewContext(`let busy=false,connecting=false,meshSelection=null,wifiSettingsTarget=null,cardSettingsSerial=0,navigationSerial=7,bluetoothFirmwareConnectionSerial=3;
    let selected={...entry},state=null,settingsView='network',settingsRecovery=null,styleSaving=false,settingsRestartWaitUntil=0;
    let wifiScanning=false,wifiScanSerial=0,centerTimer=null,centerStatus=null,centerWasActive=false,centerSerial=0,resetTarget=null;
    let wifiSetupAbort=null,bleWifiStatus=null,wifiSetupSerial=0,firmware=null,firmwareReceivedAt=0,effectOptions=null,vuDirty=false,fountainDirty=false,audioDirty=false,paneMode=null,editingBrightness=false,savedDevice=entry;
    const settingsUnconfirmedIds=new Set(),app2Pending=new Map(),fleetStatuses=new Map(),bleLamp={};
    const oldLamp={identity:entry.id,async disconnect(){calls.push('disconnect-old');callbacks.onDisconnect();calls.push({kind:'handoff-context',context:settingsRecovery.context(),active:settingsRecovery.active});settingsRecovery.check();if(disconnectGate)await disconnectGate.promise;}};
    let lamp=oldLamp;const mergedLampEntries=()=>[entry];
    const verifiedSelectedLamp=()=>Boolean(!connecting&&state&&lamp.identity===selected?.id);
    const connectivity={get:()=>({wifi:{state:'disconnected'}})};
    const callbacks={onState(next){state=next;settingsRecovery?.check();},onFirmware(next){firmware=next;},onOptions(){},${disconnectSource}};
    const transportCallbacks=()=>callbacks;
    const connected=(route,options)=>{calls.push({kind:'connected',route,options});$('reconnect').hidden=true;};
    ${cancelMeshSource}${bindAbortSource}
    ${meshCardSource}
    ${wifiProbeSource}
    ${bluetoothCardSource}
    ${openSource}
    ${recoverySource}
    globalThis.ui={recover:()=>settingsRecovery.check(),dispose:()=>settingsRecovery.dispose(),navigate(){navigationSerial++;selected={id:'${other}',name:'Window lamp'};settingsRecovery.check();},
      state(){return {selected,lamp,section:settingsView,navigation:navigationSerial,active:settingsRecovery.active,context:settingsRecovery.context()};},unconfirmed:()=>settingsUnconfirmedIds.has(entry.id)};`,context);
  return {...context.ui,calls,posts,view,mesh,wifi};
}

test('real recovery hooks keep Wi-Fi and mesh handoffs current through the deliberate disconnect callback',async()=>{
  for(const route of ['wifi','mesh']){
    const f=recoveryHandoffHarness({route});
    try{
      const result=await f.recover();assert.equal(result.state,'connected',result.error?.stack);
      const handoff=f.calls.find(value=>value.kind==='handoff-context');assert.equal(handoff.active,true);assert.equal(handoff.context.blocked,false);assert.equal(handoff.context.connected,false);
      assert(!f.calls.includes('queued-disconnect-check'));assert.equal(f.unconfirmed(),false);assert.equal(f.state().selected.id,id);assert.equal(f.state().section,'network');assert.equal(f.state().navigation,7);
      assert.equal(f.calls.filter(value=>value.kind==='adopt').length,1);assert.equal(f.calls.find(value=>value.kind==='connected').options.navigate,false);assert.equal(f.calls.find(value=>value.kind==='connected').options.quiet,true);
      assert(!f.calls.some(value=>['page','complete','password','picker'].includes(value.kind)));assert.equal(f.view.$('reconnect').hidden,true);assert.equal(f.posts.length,0);
      if(route==='mesh'){assert.equal(f.mesh.signal,null);assert(f.mesh.isCurrent());assert.equal(f.calls.find(value=>value.kind==='mesh-acquire').options.recoveryOnly,true);assert(!f.calls.includes('release-mesh'));}
    }finally{f.dispose();}
  }
});

test('real recovery cancellation during Wi-Fi or mesh handoff prevents late route adoption',async()=>{
  for(const route of ['wifi','mesh']){
    const disconnectGate=deferred(),f=recoveryHandoffHarness({route,disconnectGate});
    try{
      const running=f.recover();await tick();assert(f.calls.includes('disconnect-old'));f.navigate();assert.equal((await running).state,'cancelled');disconnectGate.resolve();await tick();
      assert(!f.calls.some(value=>['adopt','connected','page','complete'].includes(value.kind)));assert.equal(f.state().selected.id,other);assert.equal(f.state().active,false);assert.equal(f.posts.length,0);
      if(route==='mesh')assert(f.calls.includes('release-mesh'));
    }finally{disconnectGate.resolve();f.dispose();}
  }
});

test('real recovery cancellation while acquiring a mesh lease releases the late result without retargeting',async()=>{
  const leaseGate=deferred(),f=recoveryHandoffHarness({route:'mesh',leaseGate});
  try{
    const running=f.recover();await tick();assert(f.calls.some(value=>value.kind==='mesh-acquire'));f.navigate();assert.equal((await running).state,'cancelled');leaseGate.resolve();await tick();
    assert(f.calls.includes('release-mesh'));assert(!f.calls.includes('disconnect-old'));assert(!f.calls.some(value=>['adopt','connected','page','complete'].includes(value.kind)));assert.equal(f.state().selected.id,other);assert.equal(f.posts.length,0);
  }finally{leaseGate.resolve();f.dispose();}
});

function settingsConnectionHarness(){
  const view=elements(),context={...view,Date:class extends Date{static now(){return 10000;}}};
  runInNewContext(`let selected={id:'${id}',name:'Reading lamp'},verified=false,held=false,settingsRestartWaitUntil=0;
    const wifiLamp={identity:selected.id},bleLamp={identity:selected.id},meshLamp={identity:selected.id,isMesh:true};let lamp=bleLamp;
    const verifiedSelectedLamp=()=>verified;const firmwareConnectionBusy=()=>held;
    ${settingsConnectionSource}
    globalThis.ui={render:renderSettingsConnection,healthy(route){verified=true;lamp=route==='wifi'?wifiLamp:route==='mesh'?meshLamp:bleLamp;renderSettingsConnection();},
      waiting({firmware=false,restarting=false}={}){verified=false;held=firmware;settingsRestartWaitUntil=restarting?12000:0;renderSettingsConnection();}};`,context);
  return {...context.ui,...view};
}

test('actual settings status restores healthy transport badges and hides the recovery panel after reconnecting',()=>{
  for(const [route,label] of [['wifi','Wi-Fi'],['bluetooth','Bluetooth'],['mesh','ESP-NOW mesh']]){
    const f=settingsConnectionHarness();f.waiting();
    assert.equal(f.$('settingsRecovery').hidden,false);assert.equal(f.$('page-settings').dataset.connectionRecovering,'true');
    assert.equal(f.$('settingsRecoveryTitle').textContent,'Reconnecting to Reading lamp');assert.equal(f.$('connectionBadge').textContent,'Reconnecting');
    assert.equal(f.$('settingsConnection').textContent,'Your settings will return when this lamp’s connection is verified.');
    f.healthy(route);
    assert.equal(f.$('settingsRecovery').hidden,true);assert.equal(f.$('page-settings').dataset.connectionRecovering,'false');
    assert.equal(f.$('connectionBadge').textContent,label);assert.equal(f.$('settingsConnection').textContent,'Reading lamp · '+label);
  }
});

test('actual settings status explains firmware and restart holds then restores the verified connection label',()=>{
  for(const reason of [{firmware:true},{restarting:true}]){
    const f=settingsConnectionHarness();f.waiting(reason);
    assert.equal(f.$('settingsRecovery').hidden,false);assert.equal(f.$('page-settings').dataset.connectionRecovering,'true');
    assert.equal(f.$('settingsRecoveryTitle').textContent,'Waiting for your lamp');assert.equal(f.$('connectionBadge').textContent,'Updating');
    assert.equal(f.$('settingsRecoveryHint').textContent,'Your update is still in progress. We’ll restore the controls when it finishes.');
    f.healthy('wifi');assert.equal(f.$('settingsRecovery').hidden,true);assert.equal(f.$('connectionBadge').textContent,'Wi-Fi');assert.equal(f.$('settingsConnection').textContent,'Reading lamp · Wi-Fi');
  }
});
