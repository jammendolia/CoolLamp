import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {wifiSetupMessage} from '../src/wifi-setup.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const id='aabbccddeeff',other='112233445566';
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const turns=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert(first>=0&&last>first);return source.slice(first,last);}
const helpers=extract('async function networkAction(','\n$(\'identityForm\').onsubmit=');
const forms=extract("$('identityForm').onsubmit=","\n$('identify').onclick=");
const network=extract("for(const [id,section] of [['networkForm','network'],['hardwareForm','hardware']])","\n$('geometryForm').onsubmit=");
const adapters=extract(' setupDetails:','\n});');
const identityButtons=extract("  $('saveIdentity').disabled=","\n  $('forgetLamp').disabled=");
const styleButtons=extract("  $('lampStyleFields').disabled=","\n  if(brokenBluetooth)");

function fixture({nameGate,styleGate,wifiGate,credentialGate,probeGate,autoGate,refreshGates=[],createGate,joinGate}={}){
 const elements=new Map(),calls=[],writes=[],stored=[],progress=[],probes=[];
 const node=key=>{if(!elements.has(key))elements.set(key,{value:'',textContent:'',hidden:false,disabled:false,dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},focus(){calls.push({kind:'focus',key});}});return elements.get(key);};
 for(const [key,value] of Object.entries({lampName:'Reading lamp',room:'Bedroom',lampStyle:'corkscrew',ssid:'Home network',wifiPassword:'test-only-password'}))node(key).value=value;
 const original={id:'native-one',identity:id,deviceIdentity:id,epoch:4,supportsWifiSetup:true,raw:{apiVersion:1,lampStyle:{id:'helix'}},
  enqueue:action=>Promise.resolve().then(action),
  async request(path,data,epoch,beforeWrite){beforeWrite?.();writes.push({kind:'name',path,data,epoch});if(nameGate)await nameGate.promise;return 'Lamp name saved.';},
  async configureLampStyle(style){writes.push({kind:'style',style});if(styleGate)await styleGate.promise;this.raw.lampStyle={id:style};return 'Lamp design saved.';},
  async configureWifi(ssid,password,open,options){writes.push({kind:'wifi',ssid,open});this.wifiOptions=options;if(wifiGate)return wifiGate.promise;return {version:1,phase:4,error:0,connected:true,ssid,address:'192.168.1.40',hostname:'lamp.local',usingDefaultPassword:true};},
  async command(op,value,_unused,guard){guard?.();writes.push({kind:'automatic',op,value});if(autoGate)await autoGate.promise;return true;},
  async disconnect(){this.epoch++;}
 };
 const replacement={...original,id:'native-two',identity:other,deviceIdentity:other,epoch:8,raw:{apiVersion:1,lampStyle:{id:'helix'}}};
 const store={items:[{id,deviceId:original.id,name:'Original',room:'Den'}],upsert(entry){stored.push({...entry});this.items=this.items.filter(value=>value.id!==entry.id).concat({...entry});return {...entry};},setLampStyle(target,style){calls.push({kind:'local-style',target,style});return true;}};
 let refreshCalls=0;
 const context={console,Promise,AbortController,TextEncoder,store,original,replacement,calls,writes,stored,progress,probes,$:node,wifiSetupMessage,
  updatingLamp:()=>false,renderPower(){},renderOptions(){},renderLamps(){calls.push({kind:'render-lamps'});},renderFirmware(){calls.push({kind:'render-firmware'});},filterEffects(){},
  status:message=>calls.push({kind:'message',message}),rememberLampStyle(){},reportedLampStyle:value=>value,
  styleDefinition:value=>['helix','corkscrew'].includes(value)?{id:value}:null,
  hideWifiPassword(){},configurationPayload(){throw Error('The browser config path is outside this fixture.');},confirm:()=>true,
  lampAddress:value=>'http://'+value,credential:async()=>credentialGate?credentialGate.promise:{value:'coollamp'},
  connectWifi:async entry=>calls.push({kind:'wifi-connect',id:entry.id}),connect:async entry=>calls.push({kind:'ble-connect',id:entry.id}),page:name=>calls.push({kind:'page',name}),
  WifiTransport:class{constructor(){probes.push(this);}async connect(address,password,identity,options){calls.push({kind:'probe',identity});this.guard=options.guard;if(probeGate)await probeGate.promise;this.guard();}async disconnect(){calls.push({kind:'probe-close'});}},CapacitorHttp:{},
  refreshRoomGroups:async()=>{calls.push({kind:'refresh-group'});const gate=refreshGates[refreshCalls++];if(gate)await gate.promise;},
  groupCreationPlan:lamps=>({leader:lamps[0],followers:lamps.slice(1),protocol:3}),
  roomGroups:{async create(target,options){writes.push({kind:'create',target,options});if(createGate)await createGate.promise;},async join(target,leader){writes.push({kind:'join',target,leader});if(joinGate)await joinGate.promise;}}
 };
 runInNewContext(`
  let lamp=original,selected={...store.items[0]},state={power:true},busy=false,connecting=false,firmware={version:'1.15.3'};
  const bleLamp=original,wifiLamp={};let styleSaving=null,identitySaving=null,styleDraftDirty=true;
  let bleWifiStatus=null,wifiSetupAbort=null,wifiSetupSerial=0,wifiHandoff=null;
  const groupsSnapshot={lamps:[{id:'${id}',name:'Main lamp'},{id:'${other}',name:'Follower'}]};
  const verifiedSelectedLamp=()=>Boolean(state&&selected&&lamp.identity===selected.id);
  const advancedAvailable=()=>Boolean(state&&lamp.raw);
  const bluetoothWifiAvailable=()=>lamp===bleLamp&&Boolean(state)&&bleLamp.supportsWifiSetup;
  function renderSettings(){calls.push({kind:'render-settings',busy});${identityButtons}}
  function renderLampStyleSettings(){calls.push({kind:'render-style',saving:Boolean(styleSaving)});${styleButtons}}
  ${helpers}
  ${forms}
  ${network}
  const api={${adapters}};
  globalThis.ui={
   details:options=>api.setupDetails({id:'${id}',name:'Reading lamp',style:'corkscrew',room:'Bedroom',...options}),
   automatic:value=>api.setAutomatic(value,'${id}'),group:options=>api.createGroup(['${id}','${other}'],options),
   name:()=>$('identityForm').onsubmit({preventDefault(){}}),style:()=>$('lampStyleForm').onsubmit({preventDefault(){}}),
   wifi:()=>$('networkForm').onsubmit({preventDefault(){}}),wifiAction:action=>bluetoothNetworkAction(action),handoff:()=>handoffBluetoothWifi(),
   cancel:()=>$('cancelWifiSetup').onclick(),
   readyWifi(usingDefaultPassword=true){bleWifiStatus={phase:4,connected:true,ssid:'Home network',address:'192.168.1.40',hostname:'lamp.local',usingDefaultPassword};},
   change(kind='target'){if(kind==='epoch')original.epoch++;else if(kind==='same-target-transport'){lamp={...replacement,identity:original.identity,deviceIdentity:original.deviceIdentity,epoch:original.epoch};selected={...store.items[0]};}else{lamp=replacement;selected={id:'${other}',deviceId:replacement.id,name:'Other lamp'};state={power:true};}renderSettings();renderLampStyleSettings();},
   retireWifi(){wifiSetupAbort?.abort();wifiSetupAbort=null;wifiHandoff=null;bleWifiStatus=null;++wifiSetupSerial;busy=false;setupActivity('wifiSetupFeedback','');},
   snapshot:()=>({selected:{...selected},busy,styleSaving:Boolean(styleSaving),identitySaving:Boolean(identitySaving),serial:wifiSetupSerial})
  };`,context);
 return {...context.ui,elements,node,calls,writes,stored,original,replacement,progress,probes};
}

test('real setup adapter announces each stage before its pending operation and disables settings immediately',async()=>{
 const nameGate=deferred(),styleGate=deferred(),f=fixture({nameGate,styleGate}),stages=[];
 const pending=f.details({onProgress:stage=>stages.push(stage)});
 assert.equal(f.snapshot().busy,true);assert.equal(f.calls[0].kind,'render-settings');assert.equal(f.node('saveIdentity').disabled,true);assert.deepEqual(stages,['saving-name']);
 await turns();assert.deepEqual(f.writes.map(value=>value.kind),['name']);
 nameGate.resolve();await turns();assert.deepEqual(stages,['saving-name','saving-style']);assert.deepEqual(f.writes.map(value=>value.kind),['name','style']);
 styleGate.resolve();await pending;assert.deepEqual(stages,['saving-name','saving-style','saving-room']);assert.equal(f.stored.length,1);assert.equal(f.snapshot().busy,false);
});

for(const callback of [()=>{throw Error('Indicator failed.');},()=>Promise.reject(Error('Indicator rejected.'))])test('presentation callback failure cannot interrupt or replay setup mutations',async()=>{
 const f=fixture();await f.details({onProgress:callback});await turns();assert.deepEqual(f.writes.map(value=>value.kind),['name','style']);assert.equal(f.stored.length,1);
});

test('setup duplicate taps and a lost name reply cannot send another name or style mutation',async()=>{
 const nameGate=deferred(),f=fixture({nameGate}),stages=[];const pending=f.details({onProgress:stage=>stages.push(stage)});await turns();
 await assert.rejects(f.details({}),/Reconnect/);nameGate.reject(Object.assign(Error('Name reply was lost.'),{uncertain:true}));await assert.rejects(pending,error=>error.uncertain);
 assert.deepEqual(f.writes.map(value=>value.kind),['name']);assert.deepEqual(stages,['saving-name']);assert.equal(f.stored.length,0);assert.equal(f.snapshot().busy,false);
});

test('setup target change after name acceptance does not save another design or room',async()=>{
 const nameGate=deferred(),f=fixture({nameGate});const pending=f.details({});await turns();f.change();nameGate.resolve();await assert.rejects(pending,/setup lamp changed/);
 assert.deepEqual(f.writes.map(value=>value.kind),['name']);assert.equal(f.stored.length,0);assert.equal(f.snapshot().selected.id,other);
});

test('style failure after name acceptance retains an honest partial outcome without a second save',async()=>{
 const styleGate=deferred(),f=fixture({styleGate}),stages=[];const pending=f.details({onProgress:stage=>stages.push(stage)});await turns();
 styleGate.reject(Object.assign(Error('Design was not confirmed.'),{uncertain:true}));await assert.rejects(pending,error=>error.uncertain);
 assert.deepEqual(f.writes.map(value=>value.kind),['name','style']);assert.deepEqual(stages,['saving-name','saving-style']);assert.equal(f.stored.length,0);
});

test('automatic-update preference disables settings before awaiting its one command',async()=>{
 const autoGate=deferred(),f=fixture({autoGate}),pending=f.automatic(true);assert.equal(f.snapshot().busy,true);assert.equal(f.node('saveIdentity').disabled,true);
 await assert.rejects(f.automatic(true),/Reconnect/);autoGate.resolve();await pending;assert.deepEqual(f.writes.map(value=>value.kind),['automatic']);assert.equal(f.snapshot().busy,false);
});

test('real name submit displays progress synchronously, deduplicates and records accepted save',async()=>{
 const nameGate=deferred(),f=fixture({nameGate}),pending=f.name();assert.equal(f.node('identitySaveFeedback').dataset.state,'working');assert.match(f.node('identitySaveFeedback').textContent,/Saving/);assert.equal(f.node('saveIdentity').attributes['aria-busy'],'true');assert.equal(f.node('saveIdentity').disabled,true);
 await f.name();await turns();assert.equal(f.writes.length,1);nameGate.resolve();await pending;
 assert.equal(f.stored.length,1);assert.equal(f.node('identitySaveFeedback').dataset.state,'idle');assert.match(f.node('identitySaveFeedback').textContent,/Lamp name saved/);assert.equal(f.node('saveIdentity').attributes['aria-busy'],'false');
});

test('lost name reply stops the spinner and remains unconfirmed without replay or local false success',async()=>{
 const nameGate=deferred(),f=fixture({nameGate}),pending=f.name();await turns();nameGate.reject(Object.assign(Error('Native reply lost.'),{uncertain:true}));await pending;
 assert.equal(f.writes.length,1);assert.equal(f.stored.length,0);assert.equal(f.node('identitySaveFeedback').dataset.state,'idle');assert.match(f.node('identitySaveFeedback').textContent,/could not confirm/);
});

for(const kind of ['target','epoch'])test('late name completion after '+kind+' change cannot rename the selected lamp',async()=>{
 const nameGate=deferred(),f=fixture({nameGate}),pending=f.name();await turns();f.change(kind);nameGate.resolve();await pending;
 assert.equal(f.stored.length,0);assert.equal(f.writes.length,1);assert.equal(f.node('identitySaveFeedback').textContent,'');assert.equal(f.calls.filter(value=>value.kind==='message').length,0);
});

test('real design submit shows a pending button and spinner while one protected save is in flight',async()=>{
 const styleGate=deferred(),f=fixture({styleGate}),pending=f.style();assert.equal(f.node('lampStyleFeedback').dataset.state,'working');assert.equal(f.node('saveLampStyle').attributes['aria-busy'],'true');assert.equal(f.node('lampStyleFields').disabled,true);
 await f.style();await turns();assert.deepEqual(f.writes.map(value=>value.kind),['style']);styleGate.resolve();await pending;assert.equal(f.node('lampStyleFeedback').dataset.state,'idle');assert.match(f.node('lampStyleFeedback').textContent,/saved on this lamp/);assert.equal(f.node('saveLampStyle').attributes['aria-busy'],'false');
});

test('uncertain design reply gives the existing review outcome and never resubmits',async()=>{
 const styleGate=deferred(),f=fixture({styleGate}),pending=f.style();await turns();styleGate.reject(Object.assign(Error('Lost design reply.'),{uncertain:true}));await pending;
 assert.deepEqual(f.writes.map(value=>value.kind),['style']);assert.equal(f.node('lampStyleFeedback').dataset.state,'idle');assert.match(f.node('lampStyleFeedback').textContent,/not confirmed/);assert.equal(f.stored.length,0);
});

test('a same-lamp transport handoff with colliding epochs retires only the old design activity',async()=>{
 const styleGate=deferred(),f=fixture({styleGate}),pending=f.style();await turns();assert.equal(f.node('lampStyleFeedback').dataset.state,'working');
 f.change('same-target-transport');assert.equal(f.node('saveLampStyle').attributes['aria-busy'],'false');assert.equal(f.node('saveLampStyle').textContent,'Save lamp design');assert.equal(f.node('lampStyleFeedback').dataset.state,'idle');assert.equal(f.node('lampStyleFeedback').textContent,'');
 styleGate.resolve();await pending;assert.deepEqual(f.writes.map(value=>value.kind),['style']);assert.equal(f.stored.length,0);assert.equal(f.node('lampStyleFeedback').textContent,'');assert.equal(f.snapshot().styleSaving,false);
});

test('retired design completion does not clear a newer visible activity owner',async()=>{
 const styleGate=deferred(),f=fixture({styleGate}),pending=f.style();await turns();f.change('same-target-transport');
 const feedback=f.node('lampStyleFeedback');feedback.setupOwner={};feedback.dataset.state='working';feedback.textContent='New connection activity';
 styleGate.resolve();await pending;assert.equal(feedback.dataset.state,'working');assert.equal(feedback.textContent,'New connection activity');assert.deepEqual(f.writes.map(value=>value.kind),['style']);
});

test('Bluetooth Wi-Fi credentials have visible local progress before their first reply',async()=>{
 const gate=deferred(),f=fixture();const pending=f.wifiAction(async options=>{f.original.wifiOptions=options;return gate.promise;});
 assert.equal(f.node('wifiSetupFeedback').dataset.state,'working');assert.equal(f.node('wifiSetupFeedback').textContent,'Sending your Wi-Fi details…');assert.equal(f.snapshot().busy,true);
 f.original.wifiOptions.onProgress({phase:3});assert.match(f.node('wifiSetupFeedback').textContent,/Connecting/);assert.equal(f.node('wifiSetupFeedback').dataset.state,'working');
 const ready={phase:4,connected:true,ssid:'Home network'};f.original.wifiOptions.onProgress(ready);assert.match(f.node('wifiSetupFeedback').textContent,/saved/);assert.equal(f.node('wifiSetupFeedback').dataset.state,'idle');gate.resolve(ready);assert.equal(await pending,ready);
});

test('cancel remains usable during credential submission and no abandoned callback changes the next lamp',async()=>{
 const gate=deferred(),f=fixture();const pending=f.wifiAction(async options=>{f.original.wifiOptions=options;return gate.promise;});f.cancel();assert.equal(f.original.wifiOptions.signal.aborted,true);assert.match(f.node('wifiSetupFeedback').textContent,/Cancelling/);
 f.change();f.retireWifi();f.original.wifiOptions.onProgress({phase:4,connected:true,ssid:'Private network'});gate.resolve({phase:4,connected:true});assert.equal(await pending,undefined);assert.equal(f.node('wifiSetupFeedback').textContent,'');assert.equal(f.snapshot().busy,false);
});

test('a confirmed credential cancellation stops activity without a retry or handoff',async()=>{
 const gate=deferred(),f=fixture();let submits=0;const pending=f.wifiAction(async options=>{submits++;f.original.wifiOptions=options;return gate.promise;});
 assert.equal(await f.wifiAction(async()=>{submits++;}),undefined);f.cancel();gate.reject(Error('Wi-Fi setup cancelled.'));assert.equal(await pending,undefined);
 assert.equal(submits,1);assert.equal(f.node('wifiSetupFeedback').textContent,'Wi-Fi setup cancelled.');assert.equal(f.node('wifiSetupFeedback').dataset.state,'idle');assert.equal(f.snapshot().busy,false);assert.equal(f.probes.length,0);
});

test('Wi-Fi form late completion cannot probe, store or hand off another lamp',async()=>{
 const wifiGate=deferred(),f=fixture({wifiGate});f.wifi();assert.equal(f.node('wifiPassword').value,'');assert.equal(f.node('wifiSetupFeedback').dataset.state,'working');await turns();f.change();f.retireWifi();
 wifiGate.resolve({phase:4,connected:true,ssid:'Home network',address:'192.168.1.40',usingDefaultPassword:true});await turns();assert.equal(f.probes.length,0);assert.equal(f.stored.length,0);assert.equal(f.writes.length,1);
});

test('Cancel racing a final verified Wi-Fi save keeps its truthful outcome without an automatic handoff',async()=>{
 const wifiGate=deferred(),f=fixture({wifiGate});f.wifi();await turns();f.cancel();assert.equal(f.original.wifiOptions.signal.aborted,true);
 wifiGate.resolve({phase:4,connected:true,ssid:'Home network',address:'192.168.1.40',usingDefaultPassword:true});await turns();
 assert.equal(f.probes.length,0);assert.equal(f.stored.length,0);assert.equal(f.calls.filter(value=>value.kind==='wifi-connect').length,0);assert.equal(f.writes.filter(value=>value.kind==='wifi').length,1);
 assert.equal(f.node('wifiSetupFeedback').dataset.state,'idle');assert.match(f.node('wifiSetupFeedback').textContent,/settings saved/);assert.doesNotMatch(f.node('wifiSetupFeedback').textContent,/cancelled|unchanged/i);assert.equal(f.snapshot().busy,false);
});

test('handoff explains the verified connection check and ignores an obsolete credential reply',async()=>{
 const credentialGate=deferred(),f=fixture({credentialGate});f.readyWifi(false);
 const pending=f.handoff();assert.equal(f.node('wifiSetupFeedback').textContent,'Wi-Fi is saved. Checking the connection…');assert.equal(f.node('wifiSetupFeedback').dataset.state,'working');await turns();
 f.change();f.retireWifi();credentialGate.resolve({value:'coollamp'});await pending;assert.equal(f.stored.length,0);assert.equal(f.calls.filter(value=>value.kind==='wifi-connect').length,0);
});

test('handoff probe failure leaves saved Wi-Fi and Bluetooth control with an idle explanation',async()=>{
 const probeGate=deferred(),f=fixture({probeGate});f.readyWifi();const pending=f.handoff();await turns();assert.equal(f.probes.length,1);assert.equal(f.snapshot().busy,true);probeGate.reject(Error('Phone cannot reach the lamp.'));await pending;
 assert.equal(f.stored.length,1);assert.match(f.node('wifiSetupFeedback').textContent,/settings are saved.*Bluetooth control remains available/);assert.equal(f.node('wifiSetupFeedback').dataset.state,'idle');assert.equal(f.snapshot().busy,false);assert.equal(f.calls.filter(value=>value.kind==='wifi-connect').length,0);
});

test('a late native password failure after leaving the setup lamp stays silent',async()=>{
 const credentialGate=deferred(),f=fixture({credentialGate});f.readyWifi(false);const pending=f.handoff();f.change();f.retireWifi();credentialGate.reject(Error('Old credential lookup failed.'));await pending;
 assert.equal(f.calls.filter(value=>value.kind==='message').length,0);assert.equal(f.probes.length,0);assert.equal(f.node('wifiSetupFeedback').textContent,'');
});

test('group progress precedes checking, creation, each join and final membership check',async()=>{
 const firstRefresh=deferred(),lastRefresh=deferred(),createGate=deferred(),joinGate=deferred(),f=fixture({refreshGates:[firstRefresh,lastRefresh],createGate,joinGate}),stages=[];
 const pending=f.group({onProgress:stage=>stages.push(stage)});assert.deepEqual(stages,['checking-groups']);firstRefresh.resolve();await turns();assert.deepEqual(stages,['checking-groups','creating-group']);assert.deepEqual(f.writes.map(value=>value.kind),['create']);
 createGate.resolve();await turns();assert.deepEqual(stages,['checking-groups','creating-group','joining-group']);assert.deepEqual(f.writes.map(value=>value.kind),['create','join']);joinGate.resolve();await turns();assert.deepEqual(stages,['checking-groups','creating-group','joining-group','checking-group']);lastRefresh.resolve();assert.equal((await pending).id,id);
});

test('group indicator exceptions leave actual membership operations unchanged and partial joins honest',async()=>{
 const joinGate=deferred(),f=fixture({joinGate}),pending=f.group({onProgress(){throw Error('Indicator failed.');}});await turns();joinGate.reject(Object.assign(Error('Join reply lost.'),{uncertain:true}));await assert.rejects(pending,error=>error.uncertain&&/main lamp is ready.*not confirmed/.test(error.message));
 assert.deepEqual(f.writes.map(value=>value.kind),['create','join']);assert.equal(f.calls.filter(value=>value.kind==='refresh-group').length,1);
});
