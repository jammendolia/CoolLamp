import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {acquireOnboardingBroker} from '../src/mesh-onboarding-broker.js';
import {discoverBridgePage} from '../src/bridge-discovery.js';
import {BRIDGE_MODEL,BridgeAccessoryStore} from '../src/bridge-accessory.js';
import {MeshInventorySession} from '../src/mesh.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
// Execute production handlers; only native acquisition, descriptor I/O, clock
// and presentation APIs are adapters. Pagination/admission logic is imported.
function handler(name){
 const match=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').exec(source);assert(match,'Missing actual handler '+name);
 const start=match.index+(source[match.index]==='\n'?1:0);let quote=null,escape=false,line=false,block=false,parens=0,body=-1,depth=0;
 for(let i=source.indexOf('(',start);i<source.length;i++){
  const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='/'&&next==='/'){line=true;i++;continue;}if(c==='/'&&next==='*'){block=true;i++;continue;}
  if(body<0){if(c==='(')parens++;else if(c===')')parens--;else if(c==='{'&&parens===0){body=i;depth=1;}}
  else if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 assert.fail('Unterminated actual handler '+name);
}
const brokerId='5894af4aec24',secondId='f0b950b2f180',fleetId='c8d27ebafed5d956';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const peerId=index=>(index+2).toString(16).padStart(12,'0');
function fixture({peers=6,acquire,descriptor,status,fresh=false}={}){
 const calls=[],elements=new Map(),timers=new Map(),storage=new Map(),leases=[],entries=[brokerId,secondId,'112233445566','223344556688'].map((id,index)=>({id,deviceId:'paired-'+index,accessoryManaged:true,name:'Owned lamp '+index,address:'192.168.1.'+(42+index)}));
 const now={value:100000};let nextTimer=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:id!=='page-bridges',textContent:'',querySelector:()=>({focus:()=>calls.push('focus:'+id)})});return elements.get(id);};
 const accessories=new BridgeAccessoryStore({getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)});
 const inventory=id=>({version:1,deviceId:id,available:true,fleetId,boot:'000000000000000b',peers:Array.from({length:peers},(_,index)=>({id:peerId(index),boot:(index+30).toString(16).padStart(16,'0'),online:true,hops:1,name:'Device '+index}))});
 const makeLease=id=>{
  let released=0;
  const lease={lamp:{identity:id,epoch:7,base:'ble:paired-'+id,async request(path,fields,epoch,guard,stillCurrent){
   calls.push(['read',id,path]);assert.equal(path,'/api/mesh/status');assert.equal(fields,undefined);assert.equal(epoch,7);assert.equal(guard,stillCurrent);guard();const result=status?await status(id,inventory(id)):inventory(id);guard();return result;
  }},async release(){released++;calls.push(['release',id]);},get released(){return released;}};
  leases.push(lease);return lease;
 };
 const denied=name=>()=>assert.fail('Discovery attempted '+name);
 const context={Error,Map,Set,Promise,Object,AbortController,JSON,
  Date:{now:()=>now.value},setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
  navigationSerial:1,bridgeFindTask:null,bridgeFindCursor:null,foregroundConnectionHold:null,firmwareBackgroundGeneration:0,
  appTourActive:false,bluetoothFirmwareTask:null,cardFirmwareTasks:new Map(),fleetUpdating:false,connecting:false,firmware:null,fleetStatuses:new Map(),
  wifiSettingsTarget:null,groupRemovedIds:new Set(),groupConnections:new Map(),groupScanRun:null,groupJoinPending:null,
  store:{items:entries,upsert:denied('lamp settings/card write'),rememberFirmware:denied('firmware settings write')},
  bridgeAccessories:accessories,meshInventory:new MeshInventorySession({now:()=>now.value}),phonePlatform:'ios',lamp:null,verifiedSelectedLamp:()=>false,advancedAvailable:()=>false,
  connectivity:{get:()=>({wifi:{fresh,state:'connected'}})},meshNetworkMessages:new Map(),renderLamps(){},
  fleet:{cancelRefresh:()=>calls.push('cancel-fleet')},meshOnboarding:{cancelDiscover:()=>calls.push('cancel-new-devices')},
  roomGroups:{cancel:()=>calls.push('cancel-groups')},groupDiscovery:{cancelScan:()=>calls.push('cancel-coordinators')},bluetoothGroups:{cancel:()=>calls.push('cancel-radio-scan')},
  acquireOnboardingBroker:options=>acquireOnboardingBroker({...options,now:()=>now.value}),
  acquireGroupLamp:async(id,options)=>{
   calls.push(['acquire',id,options.onboardingRoute]);assert.equal(options.readOnly,true);assert(options.isCurrent());
   assert.equal(context.foregroundConnectionHold?.intent,context.bridgeFindTask);
   const lease=makeLease(id);return acquire?acquire(id,options,lease):lease;
  },closeGroupConnection:denied('unrelated connection retirement'),
  discoverBridgePage:options=>discoverBridgePage({...options,now:()=>now.value,readDescriptor:async(peer,guard)=>{
   calls.push(['descriptor',peer.id]);guard();const result=descriptor?await descriptor(peer,guard):{deviceId:peer.id,role:'bridge',model:{id:BRIDGE_MODEL},name:'Bridge '+peer.id,firmwareVersion:'0.3.0',capabilities:['mesh-control','trusted-cached-donation']};guard();return result;
  }}),
  provisionFirmwareFleet:denied('fleet provisioning'),firmwareFleetTrust:{provision:denied('fleet provisioning')},
  initializeGroupRadio:denied('radio configuration'),rememberAccessories:denied('accessory enrollment'),
  $:element,document:{hidden:false,querySelectorAll:()=>[]},
  appV2:{endTour:reason=>calls.push('end-tour:'+reason),navigate:name=>calls.push('navigate:'+name)},
  settingsView:'lighting',groupFocusSerial:0,pendingGroupFocus:null,meshWizard:null,
  cancelMeshSelection:()=>calls.push('cancel-selection'),hideWifiPassword:()=>calls.push('hide-password'),closeGroupEditor:()=>calls.push('close-group-editor'),
  scheduleLampStatusRefresh:()=>calls.push('schedule-status'),settingsRecovery:{check:()=>calls.push('check-recovery')},window:{scrollTo:()=>calls.push('scroll')},
  bridgeManagementUi:{refresh:()=>{assert.equal(element('page-bridges').hidden,false);calls.push('refresh-bridge-panel');}},
  renderSettings:denied('lamp settings'),refreshGroupCoordinators:denied('group coordinator discovery'),
  refreshLampFirmware:denied('firmware polling'),refreshPublicFirmware:denied('release polling'),refreshBasicBluetoothTelemetry:denied('unrelated Bluetooth polling'),refreshNewMeshLamps:denied('new device enrollment'),
  renderRoomGroups:denied('group page'),refreshRoomGroups:denied('group polling'),mergedLampEntries:()=>entries,
 };
 runInNewContext(['firmwareBackgroundWorkAllowed','pauseFirmwareBackgroundWork','beginForegroundConnection','firmwareConnectionBusy','acquireOnboardingBridge','findHouseholdBridges','page'].map(handler).join('\n'),context);
 return {context,calls,entries,accessories,leases,timers,now,element};
}
function clean(f){assert.equal(f.context.bridgeFindTask,null);assert.equal(f.context.foregroundConnectionHold,null);assert.equal(f.timers.size,0);}

test('actual bridge page navigation shows its panel and refreshes it without opening lamp settings or provisioning',()=>{
 const f=fixture();f.element('page-settings').hidden=false;f.context.page('bridges');
 for(const name of ['home','lamps','groups','settings','app-settings','help'])assert.equal(f.element('page-'+name).hidden,true);
 assert.equal(f.element('page-bridges').hidden,false);assert(f.calls.includes('refresh-bridge-panel')&&f.calls.includes('navigate:bridges')&&f.calls.includes('focus:page-bridges'));
 assert.equal(f.context.navigationSerial,2);assert.equal(f.leases.length,0);assert.equal(f.accessories.items.length,0);
});
test('actual Find admits its own tracked foreground intent, examines four descriptors and preserves lamp records',async()=>{
 const f=fixture(),before=JSON.stringify(f.entries);const result=await f.context.findHouseholdBridges();
 assert.equal(result.bridges.length,4);assert.equal(result.cursor,4);assert.equal(f.calls.filter(value=>Array.isArray(value)&&value[0]==='descriptor').length,4);
 assert.equal(f.leases.length,1);assert.equal(f.leases[0].released,1);assert.equal(JSON.stringify(f.entries),before);assert.equal(f.accessories.items.length,4);
 assert.equal(f.context.bridgeFindCursor.brokerId,brokerId);assert.equal(f.context.bridgeFindCursor.cursor,4);clean(f);
});
test('Continue pins the original broker and takes only the next four-descriptor page',async()=>{
 const f=fixture({peers:8});await f.context.findHouseholdBridges();f.calls.length=0;
 const result=await f.context.findHouseholdBridges({continue:true});assert.equal(result.bridges.length,4);assert.equal(result.cursor,null);
 assert.deepEqual(f.calls.filter(value=>Array.isArray(value)&&value[0]==='descriptor').map(value=>value[1]),[4,5,6,7].map(peerId));
 assert.deepEqual([...new Set(f.calls.filter(value=>Array.isArray(value)&&value[0]==='acquire').map(value=>value[1]))],[brokerId]);assert.equal(f.accessories.items.length,8);clean(f);
});
test('broker recovery is limited to two existing household lamps, never an entire fleet sweep',async()=>{
 const f=fixture({acquire:async()=>{throw Error('Unavailable');}});await assert.rejects(f.context.findHouseholdBridges());
 assert.deepEqual([...new Set(f.calls.filter(value=>Array.isArray(value)&&value[0]==='acquire').map(value=>value[1]))],[brokerId,secondId]);
 assert.equal(f.calls.some(value=>Array.isArray(value)&&value[0]==='descriptor'),false);assert.equal(f.accessories.items.length,0);clean(f);
});
test('Continue does not silently switch brokers after the pinned page loses its route',async()=>{
 let unavailable=false;const f=fixture({acquire:async(_id,_options,lease)=>{if(unavailable)throw Error('Unavailable');return lease;}});
 await f.context.findHouseholdBridges();unavailable=true;f.calls.length=0;
 await assert.rejects(f.context.findHouseholdBridges({continue:true}));
 assert.deepEqual([...new Set(f.calls.filter(value=>Array.isArray(value)&&value[0]==='acquire').map(value=>value[1]))],[brokerId]);assert.equal(f.accessories.items.length,4);clean(f);
});
test('unrelated foreground ownership does not authorize read-only broker acquisition',async()=>{
 const f=fixture();f.context.foregroundConnectionHold={intent:{id:'another-task'},refs:1};
 await assert.rejects(f.context.acquireOnboardingBridge(brokerId,{bridgeIntent:{id:'not-the-owner'},isCurrent:()=>true}),error=>error.cancelled);
 assert.equal(f.leases.length,0);assert.equal(f.context.foregroundConnectionHold.intent.id,'another-task');
});
test('Find on a hidden bridge panel aborts before native acquisition',async()=>{
 const f=fixture();f.element('page-bridges').hidden=true;await assert.rejects(f.context.findHouseholdBridges(),error=>error.cancelled);assert.equal(f.leases.length,0);clean(f);
});
test('normal lamp descriptors never create bridge cards or read effects/settings',async()=>{
 const f=fixture({peers:4,descriptor:async peer=>({deviceId:peer.id,role:'lamp'})});const result=await f.context.findHouseholdBridges();
 assert.equal(result.bridges.length,0);assert.equal(f.accessories.items.length,0);assert.equal(f.calls.filter(value=>Array.isArray(value)&&value[0]==='descriptor').length,4);assert.equal(f.leases[0].released,1);clean(f);
});
for(const kind of ['bluetooth','card','fleet','firmware','fleet-status','tour'])test('Find is fenced before acquisition by '+kind+' ownership',async()=>{
 const f=fixture();if(kind==='bluetooth')f.context.bluetoothFirmwareTask={id:brokerId};if(kind==='card')f.context.cardFirmwareTasks.set(brokerId,{});if(kind==='fleet')f.context.fleetUpdating=true;if(kind==='firmware')f.context.firmware={phase:3};if(kind==='fleet-status')f.context.fleetStatuses.set(brokerId,{state:'updating'});if(kind==='tour')f.context.appTourActive=true;
 await assert.rejects(f.context.findHouseholdBridges(),/Finish the current task/);assert.equal(f.leases.length,0);clean(f);
});
for(const kind of ['signal','hidden','navigation','deadline','firmware'])test('late native lease after '+kind+' cancellation is released without reads/classification',async()=>{
 const gate=deferred(),controller=new AbortController(),f=fixture({acquire:()=>gate.promise});const run=f.context.findHouseholdBridges({signal:controller.signal});await tick();
 if(kind==='signal')controller.abort();if(kind==='hidden')f.context.document.hidden=true;if(kind==='navigation')++f.context.navigationSerial;
 if(kind==='deadline'){f.now.value+=18000;const taskTimer=[...f.timers.values()].find(value=>value.delay===18000);assert(taskTimer);taskTimer.callback();}
 if(kind==='firmware')f.context.cardFirmwareTasks.set(secondId,{path:'bluetooth'});
 gate.resolve(f.leases[0]);await assert.rejects(run,error=>error.cancelled||error.routeTimeout);await tick();
 assert.equal(f.leases[0].released,1);assert.equal(f.calls.some(value=>Array.isArray(value)&&['read','descriptor'].includes(value[0])),false);assert.equal(f.accessories.items.length,0);clean(f);
});
for(const kind of ['signal','hidden','navigation','firmware','tour'])test('descriptor read interrupted by '+kind+' cannot save bridge metadata',async()=>{
 const gate=deferred(),controller=new AbortController(),f=fixture({descriptor:()=>gate.promise});const run=f.context.findHouseholdBridges({signal:controller.signal});await tick();
 assert(f.calls.some(value=>Array.isArray(value)&&value[0]==='descriptor'));
 if(kind==='signal')controller.abort();if(kind==='hidden')f.context.document.hidden=true;if(kind==='navigation')++f.context.navigationSerial;
 if(kind==='firmware')f.context.cardFirmwareTasks.set(secondId,{path:'bluetooth'});if(kind==='tour')f.context.appTourActive=true;
 gate.resolve({deviceId:peerId(0),role:'bridge',model:{id:BRIDGE_MODEL},name:'Bridge',firmwareVersion:'0.3.0',capabilities:['mesh-control','trusted-cached-donation']});
 await assert.rejects(run,error=>error.cancelled);assert.equal(f.accessories.items.length,0);assert.equal(f.leases[0].released,1);clean(f);
});
test('the actual 18-second discovery task aborts a stalled descriptor and releases foreground ownership',async()=>{
 const gate=deferred(),f=fixture({descriptor:()=>gate.promise});const run=f.context.findHouseholdBridges();await tick();
 f.now.value+=18000;const taskTimer=[...f.timers.values()].find(value=>value.delay===18000);assert(taskTimer);taskTimer.callback();
 await assert.rejects(run,error=>error.cancelled);assert.equal(f.accessories.items.length,0);assert.equal(f.leases[0].released,1);gate.resolve(null);await tick();clean(f);
});
test('second Find cannot take over an existing intent and original cancellation releases its only lease',async()=>{
 const gate=deferred(),controller=new AbortController(),f=fixture({descriptor:()=>gate.promise});const run=f.context.findHouseholdBridges({signal:controller.signal});await tick();
 await assert.rejects(f.context.findHouseholdBridges(),/Finish the current task/);assert.equal(f.leases.length,1);controller.abort();await assert.rejects(run,error=>error.cancelled);gate.resolve(null);await tick();clean(f);
});
