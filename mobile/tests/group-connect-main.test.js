import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampAddress} from '../src/lamps.js';
import {ConnectionBroker,readOnlyConnectionFailure} from '../src/connection-broker.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function extract(start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert(first>=0&&last>first,'Production source exists: '+start);return source.slice(first,last);
}
const helper=extract('async function connectRoomGroupLamp(','\nfunction groupLampRow(');
const renderer=extract('function groupLampRow(','\nfunction renderRoomGroups(');
const refresh=extract('function refreshRoomGroups(','\nasync function roomGroupAction(');
const open=extract('async function openCardSettings(','\nconst openCardWifiSettings=');
const complete=extract('function completeCardSettings(','\nfunction cancelMeshSelection(');
const prompt=extract('function promptWifiPassword(','\nfunction reportWifiFallback(');
const connectWifi=extract('async function connectWifi(','\nfunction promptWifiPassword(');
const foregroundWifi=extract('async function connectCardWifiAsync(','\nfunction renderNewMeshLamps(');
const bindAbort=source.split('\n').find(line=>line.startsWith('function bindRecoveryAbort('));
const submit=extract("$('wifiConnect').onsubmit=async e=>{","\n$('openLampGroupLighting')");
const section=source.split('\n').find(line=>line.startsWith('function settingsSection('));
const left='bceeb1a28dcc',right='5432e99205d4';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.textContent='';this.hidden=false;this.value='';this.disabled=false;this.classList={add(){}};}
 append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 add(option){this.append(option);}
 setAttribute(key,value){this.attributes[key]=value;}
 matches(selector){
  const attribute=selector.match(/^\[data-([\w-]+)="([^"]+)"\]$/);
  if(attribute){const key=attribute[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return this.dataset[key]===attribute[2];}
  return this.tagName===selector.toUpperCase();
 }
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
 focus(){this.focused=true;}
 scrollIntoView(){this.scrolled=true;}
}
function fixture({state='needs-password',owned=true,known=true,canonical=true,realWifi=false,attempt,scan}={}){
 const calls=[],mutations=[],listeners=new Map(),elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const id=canonical?left:'ble:peripheral-left';
 const entry={id,name:'Sonata Left <img src=x>',address:'http://sonata-left.local',deviceId:'peripheral-left',accessoryManaged:true};
 const original={id,name:entry.name,state,available:false,verified:false,role:null,checkedAt:null,message:state==='needs-password'?'Enter this lamp’s access password.':'Lamp could not be verified.'};
 const settings={ledCount:128,powerLimitMa:500,middleSplit:false,startup:{mode:4,brightness:100}};
 const context={AbortController,lampAddress,Date:{now:()=>1000},connectionBroker:new ConnectionBroker(),readOnlyConnectionFailure,observeBrokerConnection(){},document:{createElement:tag=>new Element(tag),
   addEventListener(event,handler,options){if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(handler);options?.signal?.addEventListener('abort',()=>listeners.set(event,listeners.get(event).filter(value=>value!==handler)),{once:true});}},
  $:element,entry,calls,mutations,settings,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},
  inventory:!owned&&known?[entry]:[],
  store:{items:owned?[entry]:[],upsertWifi(value){calls.push({kind:'store-upsert',id:value.id});const at=this.items.findIndex(item=>item.id===value.id);if(at>=0)this.items[at]=value;else this.items.push(value);return value;},rememberFirmware(){}},
  mergedLampEntries:()=>[...new Map([...context.inventory,...context.store.items].map(value=>[value.id,value])).values()],groupActions:new Set(),cardPowerTasks:new Map(),groupRemovedIds:new Set(),groupDestinations:new Map(),
  groupEditor:null,busy:false,connecting:false,navigationSerial:3,bluetoothFirmwareConnectionSerial:7,settingsView:'lighting',
  roomGroupsRun:null,roomGroupsGeneration:0,roomGroupsCompleted:0,roomGroupsRefreshQueued:false,
  fleetLampInstalling:()=>context.installing===true,bluetoothFirmwareOwner:()=>context.owner||null,firmwareBackgroundWorkAllowed:()=>true,
  firmwareConnectionSelectionAllowed:()=>true,firmwareConnectionNotice(){},cancelMeshSelection(){},beginForegroundConnection:()=>()=>{},
  renderLamps(){},renderSettings(){},renderOptions(){},renderPower(){},renderFirmware(){},hideWifiPassword(){},
  lampStyleIllustration:()=>new Element('art'),resolvedStyle:()=>({id:'sonata'}),
  wifiSettingsTarget:null,cardSettingsSerial:0,meshSelection:null,phonePlatform:'ios',connectivity:{get:()=>({wifi:{state:'unknown',fresh:false}})},
  selected:null,state:null,firmware:null,lamp:{epoch:1,async disconnect(){}},bleLamp:{epoch:2,supportsOfflineControl:true},meshLamp:{epoch:4,isMesh:true},
  wifiLamp:{epoch:3,schedule(){},async disconnect(){},async connect(address,password,expected){calls.push({kind:'password-connect',address,password,expected});this.identity=expected;this.base=address;context.state={mode:4};return {deviceId:expected,name:entry.name,hostname:'sonata-left.local',firmware:{version:'1.15.7'}};}},
  wifiFailures:new Map(),discovered:[],validFirmwareVersion:()=>true,compareFirmwareVersions:()=>0,
  stopGroupInspection:async()=>{},credential:async()=>({value:''}),observeLampWifi(){},
  callbacks:{onState:value=>{context.state=value;},onFirmware(){},onOptions(){}},CapacitorHttp:{},setTimeout,clearTimeout,
  WifiTransport:class{
   async connect(address,password,expected,{guard}){assert.equal(guard(),true);calls.push({kind:'foreground-wifi',address,password,expected});this.base=address;this.identity=expected;this.raw={deviceId:expected,name:entry.name,hostname:'sonata-left.local',mode:4,firmware:{version:'1.15.7'}};this.state={mode:4,...settings};this.catalog=[];}
   async disconnect(){}
  },
  status:message=>{calls.push({kind:'status',message});element('status').textContent=message;},
  connected(label,options){calls.push({kind:'connected',label,options});if(options?.navigate)context.page('settings');},
  verifiedSelectedLamp:()=>Boolean(!context.connecting&&context.selected&&context.state&&context.lamp.identity===context.selected.id),
  page(name,{preserveCardSettings=false}={}){context.navigationSerial++;if(!preserveCardSettings)context.wifiSettingsTarget=null;element('page-groups').hidden=name!=='groups';element('page-lamps').hidden=name!=='lamps';calls.push({kind:'page',name});},
  roomGroupAction(){mutations.push('group-action');},connect(){calls.push({kind:'legacy-connect'});},
  groupsSnapshot:{lamps:[original],groups:[{id:right,name:'Sonata group',available:true,remaining:8,leader:{verified:true,sync:{}}}],ungrouped:[],unavailable:[original],scanning:false},
 };
 element('page-groups').append(element('groupsList'),element('ungroupedLamps'),element('groupsUnavailable'),element('groupsFeedback'));
 element('groupsUnavailable').tagName='DETAILS';element('groupsUnavailable').append(element('groupsUnavailableList'));element('groupsUnavailable').open=true;element('page-lamps').hidden=true;
 context.roomGroups={allow(target){calls.push({kind:'allow',target});context.groupsSnapshot.lamps=context.groupsSnapshot.lamps.filter(row=>row.id!==target);},async refresh(){
  calls.push({kind:'scan'});if(scan)return scan(context,calls.filter(value=>value.kind==='scan').length);
  context.groupsSnapshot.lamps=[{...original,state:'online',available:true,verified:true,role:0,checkedAt:1000,message:''}];
 }};
 const invoke=async(kind,target,options)=>{
  calls.push({kind,id:target.id,options});const result=attempt?await attempt(context,kind,target,options):kind==='mesh'?{connected:false,error:Object.assign(Error('No mesh route'),{noRoute:true,confirmed:true})}:kind==='wifi'?{connected:false,error:Object.assign(Error('Enter the lamp access password.'),{needsPassword:true,confirmed:true})}:{connected:true,id:target.id};
  if(result?.connected){context.lamp=kind==='bluetooth'?context.bleLamp:kind==='mesh'?context.meshLamp:context.wifiLamp;context.lamp.identity=target.id;context.lamp.raw={deviceId:target.id};context.selected={...target};context.state={mode:4,...settings};context.roomGroups.allow(target.id);}
  return result;
 };
 context.connectCardBluetooth=(target,options)=>invoke('bluetooth',target,options);
 context.connectCardWifiAsync=(target,options)=>invoke('wifi',target,options);
 context.connectMeshCard=(target,options)=>invoke('mesh',target,options);
 context.renderRoomGroups=()=>{
  for(const id of ['groupsList','ungroupedLamps','groupsUnavailableList'])element(id).replaceChildren();
  for(const row of context.groupsSnapshot.lamps){
   if(row.available&&row.verified&&row.role===1){const card=new Element();card.dataset.groupId=row.id;element('groupsList').append(card);}
   else (row.available&&row.verified&&row.role===0?element('ungroupedLamps'):element('groupsUnavailableList')).append(context.ui.row(row));
  }
 };
 runInNewContext(`${section}\n${complete}\n${prompt}\n${connectWifi}\n${realWifi?bindAbort+'\n'+foregroundWifi:''}\n${open}\n${refresh}\n${helper}\n${renderer}\n${submit}
  const originalRefresh=roomGroups.refresh;
  roomGroups.refresh=async()=>originalRefresh();
  const actualOpenCardSettings=openCardSettings;
  openCardSettings=async(entry,options)=>{calls.push({kind:'open',id:entry.id,options});return actualOpenCardSettings(entry,options);};
  this.ui={connect:connectRoomGroupLamp,row:groupLampRow,refresh:refreshRoomGroups};`,context);
 context.renderRoomGroups();
 return {context,calls,mutations,elements,entry,original,settings,
  button:()=>element('page-groups').querySelector('[data-group-action="connect"]'),
  feedback:()=>element('groupsFeedback').textContent,
  fire:event=>{for(const handler of [...listeners.get(event)||[]])handler();},
  submit:()=>element('wifiConnect').onsubmit({preventDefault(){}}),
 };
}

for(const state of ['needs-password','offline','failed'])test('the real Other lamps row connects an owned '+state+' Sonata before offering membership controls',async()=>{
 const f=fixture({state}),before=JSON.stringify(f.settings);assert.equal(f.button().textContent,'Connect lamp');
 assert.equal(f.button().attributes['aria-label'],'Connect '+f.entry.name+' to check its group');
 const name=f.elements.get('groupsUnavailableList').children[0].children[1].children[0];assert.equal(name.textContent,f.entry.name);assert.equal(name.children.length,0);
 await f.button().onclick();
 const request=f.calls.find(value=>value.kind==='open');assert.equal(request.options.navigate,false);assert.equal(request.options.section,'lighting');
 const bluetooth=f.calls.find(value=>value.kind==='bluetooth');assert.equal(bluetooth.options.forCardSettings,true);assert.equal(bluetooth.options.readOnlyReconnect,true);
 assert.equal(f.calls.filter(value=>value.kind==='scan').length,1);assert.match(f.feedback(),/is ready.*Choose a group/);
 assert.equal(f.context.navigationSerial,3,'the actual section and completion functions keep Groups current');assert.equal(f.elements.get('page-groups').hidden,false);
 const row=f.elements.get('ungroupedLamps').children[0];assert.equal(row.focused,true);assert(row.querySelector('[data-group-action="transfer"]'));
 assert.equal(f.context.groupActions.size,0);assert.equal(JSON.stringify(f.settings),before);assert.deepEqual(f.mutations,[]);
});

test('peer-only and legacy rows retain authorization recovery without an invented Connect route',async()=>{
 for(const options of [{owned:false,known:false},{canonical:false},{state:'needs-pairing'},{state:'needs-identity'}]){
  const f=fixture(options);assert.equal(f.button(),null);await f.context.ui.connect(f.entry.id);assert.equal(f.calls.filter(value=>value.kind==='open').length,0);
  if(options.state==='needs-pairing')assert(f.elements.get('page-groups').querySelector('[data-group-action="pair"]'));
  if(options.state==='needs-identity')assert(f.elements.get('page-groups').querySelector('[data-group-action="verify"]'));
 }
});

test('a discovered canonical lamp uses actual authenticated foreground Wi-Fi and is saved before membership becomes usable',async()=>{
 const f=fixture({owned:false,realWifi:true,scan:context=>{
  assert(context.store.items.some(entry=>entry.id===left),'canonical ownership is saved before the membership scan');
  context.groupsSnapshot.lamps=[{...f.original,verified:true,available:true,role:0,checkedAt:1000}];
 }});
 delete f.entry.deviceId;delete f.entry.accessoryManaged;
 f.context.store.items.push({id:'ble:authorized-peripheral',deviceId:'authorized-peripheral',name:f.entry.name,accessoryManaged:true});
 f.context.credential=async id=>{assert.equal(id,left);return {value:'known-access-password'};};
 assert(f.button());await f.button().onclick();
 const route=f.calls.find(value=>value.kind==='foreground-wifi');assert.equal(route.expected,left);assert.equal(route.password,'known-access-password');
 assert.equal(f.calls.some(value=>value.kind==='bluetooth'),false,'a matching name cannot select the native placeholder');
 assert.equal(f.context.store.items.find(entry=>entry.id===left).deviceId,undefined);
 assert(f.calls.findIndex(value=>value.kind==='store-upsert')<f.calls.findIndex(value=>value.kind==='scan'));assert.match(f.feedback(),/is ready/);assert.deepEqual(f.mutations,[]);
});

test('busy, power, firmware and stale rendered navigation guards cannot start Connect',async()=>{
 for(const guard of ['busy','connecting','group','power','installing','firmware','navigation','removed','verified']){
  const f=fixture(),button=f.button();
  if(guard==='group')f.context.groupActions.add(left);else if(guard==='power')f.context.cardPowerTasks.set(left,{});
  else if(guard==='firmware')f.context.owner={id:right};else if(guard==='navigation')f.context.navigationSerial++;
  else if(guard==='removed')f.context.store.items=[];else if(guard==='verified')Object.assign(f.original,{verified:true,available:true,role:0});else f.context[guard]=true;
  await button.onclick();assert.equal(f.calls.filter(value=>value.kind==='open').length,0,guard);assert.deepEqual(f.mutations,[]);
 }
});

test('a cancelled previous scan settles through the production finalizer before a genuinely fresh membership read',async()=>{
 const old=deferred();const f=fixture({scan:async(context,count)=>{
  if(count===1){await old.promise;return;}
  context.groupsSnapshot.lamps=[{...f.original,verified:true,available:true,role:0,checkedAt:1000}];
 },attempt:async()=>{old.resolve();return {connected:true,id:left};}});
 f.context.ui.refresh();await f.button().onclick();
 assert.equal(f.calls.filter(value=>value.kind==='scan').length,2);assert.match(f.feedback(),/is ready/);assert.equal(f.context.roomGroupsRun,null);
});

test('successful connection cannot claim ready from missing, unavailable, stale or invalid membership',async()=>{
 for(const result of [null,{available:false,verified:false},{available:true,verified:true,role:0,checkedAt:999},{available:true,verified:true,role:null,checkedAt:1000}]){
  const f=fixture({scan:context=>{context.groupsSnapshot.lamps=result?[{...f.original,...result}]:[];}});await f.button().onclick();
  assert.match(f.feedback(),/could not be verified/);assert.doesNotMatch(f.feedback(),/is ready/);assert.deepEqual(f.mutations,[]);
 }
});

for(const role of [1,2])test('fresh role '+role+' is shown as existing membership without creating or joining a group',async()=>{
 const f=fixture({scan:context=>{context.groupsSnapshot.lamps=[{...f.original,verified:true,available:true,role,checkedAt:1000}];}});await f.button().onclick();
 assert.match(f.feedback(),role===1?/already keeps a group/:/already belongs to a group/);assert.deepEqual(f.mutations,[]);
});

test('navigation, removal and firmware changes fence delayed foreground results',async()=>{
 for(const change of ['navigation','removed','firmware']){
  const wait=deferred(),f=fixture({attempt:async()=>{await wait.promise;return {connected:true,id:left};}}),run=f.button().onclick();
  if(change==='navigation')f.context.page('lamps');else if(change==='removed')f.context.store.items=[];else f.context.bluetoothFirmwareConnectionSerial++;
  f.elements.get('groupsFeedback').textContent='New view owns the message';wait.resolve();await run;
  assert.equal(f.calls.filter(value=>value.kind==='scan').length,0,change);assert.equal(f.feedback(),'New view owns the message');assert.equal(f.context.groupActions.size,0);assert.deepEqual(f.mutations,[]);
 }
});

test('changing the selected lamp or epoch during membership verification cannot publish late readiness',async()=>{
 for(const change of ['selected','epoch']){
  const waiting=deferred(),started=deferred(),f=fixture({scan:async context=>{started.resolve();await waiting.promise;context.groupsSnapshot.lamps=[{...f.original,verified:true,available:true,role:0,checkedAt:1000}];}});
  const run=f.button().onclick();await started.promise;
  if(change==='selected')f.context.selected={id:right};else f.context.lamp.epoch++;
  f.elements.get('groupsFeedback').textContent='Another control owns the message';waiting.resolve();await run;assert.equal(f.feedback(),'Another control owns the message');
  const row=f.elements.get('ungroupedLamps').children[0];assert.notEqual(row.focused,true);assert.notEqual(row.scrolled,true);
 }
});

test('interacting elsewhere on Groups prevents delayed connection from stealing focus or scroll',async()=>{
 for(const event of ['pointerdown','keydown','wheel']){
  const wait=deferred(),f=fixture({attempt:async()=>{await wait.promise;return {connected:true,id:left};}}),run=f.button().onclick();
  f.fire(event);wait.resolve();await run;const row=f.elements.get('ungroupedLamps').children[0];assert.notEqual(row.focused,true,event);assert.notEqual(row.scrolled,true,event);
 }
});

test('the actual password prompt and form remain visible and usable after leaving the Groups recovery',async()=>{
 const f=fixture({attempt:async(context,kind)=>({connected:false,error:Object.assign(Error('Enter the lamp access password.'),kind==='wifi'?{needsPassword:true}:{})})});
 await f.button().onclick();
 assert.equal(f.elements.get('page-lamps').hidden,false);assert.equal(f.elements.get('page-groups').hidden,true);assert.equal(f.elements.get('addLamp').open,true);assert.equal(f.elements.get('password').focused,true);
 assert.equal(f.context.wifiSettingsTarget.id,left);assert.equal(f.calls.filter(value=>value.kind==='scan').length,0);
 f.elements.get('password').value='entered-password';await f.submit();
 const call=f.calls.find(value=>value.kind==='password-connect');assert.equal(call.expected,left);assert.equal(call.password,'entered-password');assert.equal(f.context.selected.id,left);
 assert.equal(f.context.wifiSettingsTarget,null,'the actual form and completeCardSettings finish the preserved intent');assert.equal(f.elements.get('page-lamps').hidden,false,'manual password completion does not steal the view');assert.deepEqual(f.mutations,[]);
});

test('late password form completion cannot reopen Groups or settings after the user navigates away',async()=>{
 const f=fixture({attempt:async(context,kind)=>({connected:false,error:Object.assign(Error('Enter the lamp access password.'),kind==='wifi'?{needsPassword:true}:{})})});
 await f.button().onclick();f.elements.get('password').value='entered-password';
 const waiting=deferred(),started=deferred(),connect=f.context.wifiLamp.connect.bind(f.context.wifiLamp);
 f.context.wifiLamp.connect=async(...args)=>{started.resolve();await waiting.promise;return connect(...args);};
 const run=f.submit();await started.promise;f.context.page('home');const navigation=f.context.navigationSerial;waiting.resolve();await run;
 assert.equal(f.context.navigationSerial,navigation);assert.equal(f.calls.filter(value=>value.kind==='page').at(-1).name,'home');assert.equal(f.context.wifiSettingsTarget,null);assert.deepEqual(f.mutations,[]);
});

test('failed and uncertain connection attempts are reported once without replay or group mutation',async()=>{
 let attempts=0;const f=fixture({attempt:async()=>{attempts++;throw Object.assign(Error('Connection not confirmed.'),{uncertain:true});}});
 await f.button().onclick();assert.equal(attempts,1);assert.match(f.feedback(),/not confirmed/);assert.equal(f.context.groupActions.size,0);assert.deepEqual(f.mutations,[]);
});
