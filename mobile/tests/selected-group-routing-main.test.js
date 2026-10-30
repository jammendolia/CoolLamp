import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Groups} from '../src/groups.js';
import {MeshTransport} from '../src/mesh.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),app=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function extract(source,start,end){const first=source.indexOf(start),last=source.indexOf(end,first+start.length);assert(first>=0&&last>first,start);return source.slice(first,last);}
const selectedRoute=extract(main,'async function openSelectedLampGroup(','\nfunction openCardGroups(');
const editor=extract(main,'async function closeGroupEditor(','\nasync function groupSceneAction(');
const acquire=extract(main,'async function acquireGroupLamp(','\nasync function stopGroupInspection(');
const foreground=extract(main,'function pauseFirmwareBackgroundWork(','\nfunction firmwareConnectionNotice(');
const page=extract(main,'function page(name,','\n\n\nconst $ =');
const refresh=extract(main,'function refreshRoomGroups(','\nasync function roomGroupAction(');
const verified=extract(main,'function verifiedSelectedLamp(','\nfunction mergedLampEntries(');
const addState=extract(app,'export function groupAddState(','\nexport function readAppPreferences(').replace('export ','');
const handler=main.split('\n').find(line=>line.startsWith("$('openLampGroupLighting').onclick="));
const addHandler=main.split('\n').find(line=>line.startsWith("$('addGroupEditorLamps').onclick="));
const right='5432e99205d4',left='bceeb1a28dcc',third='112233445566',oldLeader='001122334455';
const incarnation='a'.repeat(32),clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function fixture({role=1,leader=role===2?left:right,read,acquireHook}={}){
 const calls=[],elements=new Map(),timers=new Map(),leases=[],models=new Map();let nextTimer=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',dataset:{},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},querySelector(){return null;}});return elements.get(id);};
 const raw=(id,role,leader=role?id:'')=>({deviceId:id,name:id===right?'Sonata Right':id===left?'Sonata Left':'Saved follower',leds:128,milliamps:500,midpoint:0,startupMode:4,startupBrightness:100,firmware:{version:'1.15.7'},audio:{installed:true},
  sync:{version:2,protocolVersions:[2,3],role,leader,incarnation,order:role===1?[{id,name:'Main',online:true}]:[],peers:[],members:0,scene:0,sceneCount:32}});
 models.set(right,raw(right,role,leader));models.set(left,raw(left,role===2?1:0));models.set(third,raw(third,2,oldLeader));
 const entries=[{id:right,name:'Sonata Right',deviceId:'peripheral-right',accessoryManaged:true},{id:left,name:'Sonata Left',deviceId:'peripheral-left',accessoryManaged:true},{id:third,name:'Saved follower'},
  {id:'ble:old-right-alias',name:'Sonata Right',deviceId:'old-right-alias',accessoryManaged:true}];
 let context;
 const transports=new Map();
 const transport=id=>{
  if(transports.has(id))return transports.get(id);
  const value={identity:id,deviceIdentity:id,id:'peripheral-'+(id===right?'right':'left'),epoch:7,raw:clone(models.get(id)),tail:Promise.resolve(),reads:0,
   enqueue(action){const pending=this.tail.then(action);this.tail=pending.catch(()=>{});return pending;},
   async refresh(expected,retry,guard){assert.equal(expected,id);assert.equal(retry,true);assert.equal(typeof guard,'function');guard();calls.push({op:'read',id,count:++this.reads});
    const result=read?await read(context,id,this.reads,models):undefined;guard();this.raw=clone(result||models.get(id));return this.raw;},
   async configureSync(){calls.push({op:'WRITE'});},async configureGroupScene(){calls.push({op:'WRITE'});},async configureGroupOrder(){calls.push({op:'WRITE'});},
  };transports.set(id,value);return value;
 };
 const selectedTransport=transport(right);
 context={$:element,calls,document:{querySelectorAll:()=>[]},window:{scrollTo(){}},settingsView:'lighting',navigationSerial:3,wifiSettingsTarget:null,
  groupFocusSerial:0,pendingGroupFocus:null,settingsRecovery:{check(){}},meshWizard:null,bridgeManagementUi:null,appTourActive:false,
  selected:entries[0],lamp:selectedTransport,bleLamp:selectedTransport,wifiLamp:{},state:{sync:{role}},busy:false,connecting:false,
  bluetoothFirmwareTask:null,bluetoothFirmwareConnectionSerial:4,foregroundConnectionHold:null,firmwareBackgroundGeneration:0,
  cardFirmwareTasks:new Map(),fleetUpdating:false,cardPowerTasks:new Map(),groupActions:new Set(),groupRemovedIds:new Set(),groupConnections:new Map(),
  groupEditor:null,groupEditorSerial:0,sceneChoicesKey:'',groupOrderKey:'',groupSceneDirty:false,groupAudioDirty:false,
  roomGroupsRun:null,roomGroupsGeneration:0,roomGroupsCompleted:0,roomGroupsRefreshQueued:false,
  groupScanRun:null,groupJoinPending:null,bluetoothGroups:null,fleet:{cancelRefresh(){calls.push({op:'pause-fleet'});}},meshOnboarding:null,groupDiscovery:null,
  store:{items:entries},mergedLampEntries:()=>context.store.items,groupInventoryEntries:()=>context.store.items,
  advancedAvailable:()=>true,legacyWithoutGroups:()=>false,bluetoothFirmwareOwner:()=>context.owner||null,fleetLampInstalling:()=>context.installing===true,
  firmwareBackgroundWorkAllowed:()=>!context.foregroundConnectionHold&&!context.connecting&&!context.bluetoothFirmwareTask&&!context.cardFirmwareTasks.size&&!context.fleetUpdating,
  cancelMeshSelection(){},hideWifiPassword(){},scheduleLampStatusRefresh(){},renderSettings(){},renderOptions(){},renderLamps(){},
  refreshLampFirmware(){},refreshPublicFirmware(){},refreshBasicBluetoothTelemetry(){},refreshNewMeshLamps(){},resumePendingFirmwareChecks(){},
  renderRoomGroups(){calls.push({op:'render-groups'});},renderGroupScenes(){if(context.groupEditor)calls.push({op:'controls',id:context.groupEditor.id});},
  status:message=>{element('status').textContent=message;calls.push({op:'status',message});},
  setTimeout(handler,delay){const id=++nextTimer;timers.set(id,{handler,delay});return id;},clearTimeout:id=>timers.delete(id),
  createGroupLampLease:async(id,options)=>{
   assert.equal(options.readOnly,true,'opening controls never provisions or changes a lamp');assert.equal(context.foregroundConnectionHold,null,'a different authorized link is admitted after releasing the foreground hold');
   calls.push({op:'acquire',id});await acquireHook?.(context,id,options);
   if(!options.isCurrent())throw Object.assign(Error('Selection changed'),{cancelled:true});
   const lease={lamp:transport(id),released:false,async release(){assert.equal(this.released,false);this.released=true;calls.push({op:'release',id});}};leases.push(lease);return lease;
  },
  appV2:{endTour(){},navigate:name=>calls.push({op:'page',name}),addGroupLamps(id){calls.push({op:'add-picker',id});context.lastAdd=context.ui.addState({lamps:context.store.items,ownedLampIds:context.store.items.map(entry=>entry.id),available:context.groupsSnapshot.lamps,groups:context.groupsSnapshot.groups},id);}},
 };
 const groups=new Groups({getLamps:()=>context.store.items,acquire:(id,options)=>context.acquireGroupLamp(id,options),onStatus:snapshot=>{context.groupsSnapshot=snapshot;},now:()=>1234});context.roomGroups=groups;
 groups.remember(models.get(third),third,entries[2]);groups.remember(models.get(left),left,entries[1]);
 runInNewContext(`${verified}\n${foreground}\n${acquire}\n${refresh}\n${page}\n${selectedRoute}\n${editor}\n${addState}\n${handler}\n${addHandler}
  this.ui={open:()=>$('openLampGroupLighting').onclick(),close:closeGroupEditor,add:()=>$('addGroupEditorLamps').onclick(),addState:groupAddState,page};`,context);
 return {context,calls,elements,models,leases,groups,transport:transport(right),
  open:()=>context.ui.open(),add:()=>context.ui.add(),close:()=>context.ui.close(),
  timeout(){const pending=[...timers.values()].find(value=>value.delay===25000);assert(pending,'direct opening has an overall deadline');pending.handler();},timers};
}
const reads=f=>f.calls.filter(value=>value.op==='read').map(value=>value.id);
const writes=f=>f.calls.filter(value=>value.op==='WRITE');

test('the real selected Sonata Right handler opens and adds to its exact fresh group despite a stale placeholder and duplicate name',async()=>{
 const f=fixture();assert.equal(f.groups.snapshot().groups[0].id,oldLeader);await f.open();
 assert.deepEqual(reads(f),[right,right]);assert.equal(f.context.groupEditor.id,right);assert.equal(f.context.groupEditor.lamp.identity,right);assert.equal(f.context.groupEditor.lamp,f.transport);
 assert(f.calls.some(value=>value.op==='controls'&&value.id===right));assert.deepEqual(f.calls.filter(value=>value.op==='page').map(value=>value.name),['groups']);
 const group=f.groups.snapshot().groups.find(value=>value.id===right);assert.equal(group.available,true);assert.equal(group.placeholder,false);
 f.add();assert.equal(f.calls.find(value=>value.op==='add-picker').id,right);assert.equal(f.context.lastAdd.group.id,right);assert.equal(f.context.lastAdd.candidates.some(value=>value.lamp.id===right),false);
 assert.equal(f.calls.some(value=>['acquire','read'].includes(value.op)&&value.id==='ble:old-right-alias'),false);
 assert.equal(f.context.foregroundConnectionHold,null);assert.equal(f.context.busy,false);assert.equal(f.timers.size,0);assert.deepEqual(writes(f),[]);
});

test('a selected follower opens only the leader from its freshly validated membership using a read-only lease',async()=>{
 const f=fixture({role:2});await f.open();assert.deepEqual(reads(f),[right,left]);assert.equal(f.context.groupEditor.id,left);
 assert.deepEqual(f.calls.filter(value=>value.op==='acquire').map(value=>value.id),[left]);assert.equal(f.groups.snapshot().groups.find(value=>value.id===left).placeholder,false);assert.deepEqual(writes(f),[]);
});

test('a published mesh editor owns its persistent guard after the temporary opening task finishes',async()=>{
 let leaseCurrent;const f=fixture({role:2,acquireHook:async(context,id,options)=>{leaseCurrent=options.isCurrent;}});await f.open();
 const mesh=new MeshTransport();Object.assign(mesh,{bridge:{identity:right,epoch:7},bridgeIdentity:right,bridgeEpoch:7,isCurrent:leaseCurrent});
 assert.doesNotThrow(()=>mesh.guard(),'the actual mesh request guard remains usable after the opening deadline is retired');
 f.context.bluetoothFirmwareConnectionSerial++;assert.throws(()=>mesh.guard(),error=>error.cancelled,'a firmware connection change still fences the owned lease');
 f.context.bluetoothFirmwareConnectionSerial--;await f.close();assert.throws(()=>mesh.guard(),error=>error.cancelled,'closing the editor retires its lease');assert.deepEqual(writes(f),[]);
});

test('a newly independent selected lamp updates the actual Groups model and stays on its own controls',async()=>{
 const f=fixture({role:0});await f.open();assert.deepEqual(reads(f),[right]);assert.equal(f.groups.snapshot().ungrouped.some(value=>value.id===right),true);
 assert.equal(f.context.groupEditor,null);assert.equal(f.calls.some(value=>value.op==='page'),false);assert.match(f.elements.get('status').textContent,/currently independent/);assert.deepEqual(writes(f),[]);
});

test('read failures and incompatible identities or memberships never open the cached placeholder',async()=>{
 for(const failure of ['read','identity','membership']){
  const f=fixture({read:async(context,id,count,models)=>{if(failure==='read')throw Error('Bluetooth read failed');const raw=clone(models.get(id));if(failure==='identity')raw.deviceId=left;else raw.sync.leader=left;return raw;}});
  await f.open();assert.equal(f.context.groupEditor,null);assert.equal(f.calls.some(value=>value.op==='page'),false);assert.match(f.elements.get('status').textContent,/Bluetooth read failed|identity changed|incompatible group/);
  assert.equal(f.context.busy,false);assert.equal(f.context.foregroundConnectionHold,null);assert.deepEqual(writes(f),[]);
 }
});

test('navigation, target, epoch and firmware changes fence a delayed selected read before seeding or routing',async()=>{
 for(const change of ['navigation','target','epoch','firmware','removed']){
  const waiting=deferred(),started=deferred(),f=fixture({read:async()=>{started.resolve();await waiting.promise;}}),run=f.open();await started.promise;
  if(change==='navigation')f.context.ui.page('help');else if(change==='target')f.context.selected=f.context.store.items[1];else if(change==='epoch')f.transport.epoch++;else if(change==='firmware')f.context.bluetoothFirmwareConnectionSerial++;else f.context.groupRemovedIds.add(right);
  f.elements.get('status').textContent='The new view owns this message';waiting.resolve();await run;
  assert.equal(f.groups.snapshot().lamps.some(value=>value.id===right),false,change);assert.equal(f.context.groupEditor,null);assert.equal(f.elements.get('status').textContent,'The new view owns this message');assert.equal(f.context.busy,false);assert.equal(f.context.foregroundConnectionHold,null);
 }
});

test('closing or navigating while the coordinator lease opens prevents hidden controls and releases the late lease',async()=>{
 for(const change of ['close','navigation']){
  const waiting=deferred(),started=deferred(),f=fixture({role:2,acquireHook:async()=>{started.resolve();await waiting.promise;}}),run=f.open();await started.promise;
  if(change==='close')await f.close();else f.context.ui.page('help');waiting.resolve();await run;await settle();
  assert.equal(f.context.groupEditor,null);assert.notEqual(f.elements.get('globalGroupEditorTitle')?.focused,true);assert.equal(f.context.busy,false);assert.equal(f.context.groupConnections.size,0);assert.deepEqual(writes(f),[]);
 }
});

test('the editor seeds its own latest incarnation instead of leaving Add lamps pinned to the first read',async()=>{
 const latest='b'.repeat(32),f=fixture({read:async(context,id,count,models)=>{if(id===right&&count===2)models.get(right).sync.incarnation=latest;}});await f.open();f.add();
 assert.equal(f.context.groupEditor.lamp.raw.sync.incarnation,latest);assert.equal(f.context.lastAdd.group.leader.sync.incarnation,latest);assert.deepEqual(writes(f),[]);
});

test('the 25-second deadline releases a hung selected read and fences its eventual result',async()=>{
 const waiting=deferred(),started=deferred(),f=fixture({read:async()=>{started.resolve();await waiting.promise;}}),run=f.open();await started.promise;f.timeout();await run;
 assert.equal(f.context.busy,false);assert.equal(f.context.foregroundConnectionHold,null);assert.match(f.elements.get('status').textContent,/could not open Sonata Right/);
 waiting.resolve();await settle();assert.equal(f.context.groupEditor,null);assert.equal(f.groups.snapshot().lamps.some(value=>value.id===right),false);assert.equal(f.calls.some(value=>value.op==='page'),false);assert.deepEqual(writes(f),[]);
});

test('the deadline also bounds coordinator acquisition and prevents late controls after it resolves',async()=>{
 const waiting=deferred(),started=deferred(),f=fixture({role:2,acquireHook:async()=>{started.resolve();await waiting.promise;}}),run=f.open();await started.promise;f.timeout();await run;
 assert.equal(f.context.busy,false);assert.equal(f.context.foregroundConnectionHold,null);waiting.resolve();await settle();assert.equal(f.context.groupEditor,null);assert.equal(f.context.groupConnections.size,0);assert.deepEqual(writes(f),[]);
});

test('a late editor refresh after navigation cannot publish a replacement incarnation or focus controls',async()=>{
 const waiting=deferred(),started=deferred(),f=fixture({read:async(context,id,count,models)=>{if(id===right&&count===2){started.resolve();await waiting.promise;models.get(id).sync.incarnation='c'.repeat(32);}}}),run=f.open();await started.promise;
 f.context.ui.page('help');waiting.resolve();await run;assert.equal(f.context.groupEditor,null);assert.equal(f.groups.snapshot().groups.find(value=>value.id===right).leader.sync.incarnation,incarnation);assert.notEqual(f.elements.get('globalGroupEditorTitle')?.focused,true);
});

test('busy and update guards reject duplicate opening without touching the selected connection',async()=>{
 for(const change of ['busy','connecting','firmware','installing','power','group']){
  const f=fixture();if(change==='firmware')f.context.owner={id:right};else if(change==='power')f.context.cardPowerTasks.set(right,{});else if(change==='group')f.context.groupActions.add(right);else f.context[change]=true;
  await f.open();assert.deepEqual(reads(f),[]);assert.equal(f.context.foregroundConnectionHold,null);assert.deepEqual(writes(f),[]);
 }
});
