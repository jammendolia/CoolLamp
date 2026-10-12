import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampUpdatePresentation} from '../src/lamp-update-progress.js';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {FirmwareFeedback} from '../src/firmware-feedback.js';
import {FirmwareAttemptJournal,classifyFirmwareSnapshot} from '../src/firmware-attempt.js';
import {parsePhoneManifest} from '../src/bluetooth-firmware.js';
import {firmwareUpdatePresentation,firmwareUpdateResultPresentation} from '../src/firmware-update-ui.js';
import {acknowledgedBluetoothUpdateSource} from '../src/update-source.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const markup=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');
const id='aabbccddeeff',other='112233445566';
function extract(start,end,offset=0){
 const first=source.indexOf(start,offset),last=source.indexOf(end,first+start.length);
 assert(first>=0&&last>first,`Production segment ${start} exists`);
 return source.slice(first,last);
}
const views=extract('function lampUpdateView(', '\nfunction resolvedStyle(');
const settingsRender=extract('function renderSettings() {','\nfunction lampUpdateView(');
const firmwareRender=extract('function renderFirmware() {','\nfunction verifiedOlderBluetoothSettings(');
const playbackRender=extract('function renderPlaybackTools() {',"\n$('rotationForm').oninput=");
const progressCallback=extract('  const progress=value=>','\n  const result=await updateCardFirmware',source.indexOf('async function updateLampCard('));

// Only DOM presentation and unrelated controls are stubbed. The selected-target
// resolver, Settings renderer, firmware renderer and sender callback are real.
function fixture({task=true,stage='transferring',percent=7,verified=false,path='bluetooth'}={}){
 class Element {
  constructor(tag='div'){this.tag=tag;this.attributes={};this.dataset={};this.children=[];this.className='';this.hidden=false;this.textContent='';this.innerHTML='';this.style={};this._value=undefined;
   this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');},contains:name=>this.className.split(' ').includes(name)};
  }
  set value(value){this._value=value;this.attributes.value=String(value);}
  get value(){return this._value;}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='value')this._value=Number(value);}
  removeAttribute(name){delete this.attributes[name];if(name==='value')this._value=undefined;}
  getAttribute(name){return this.attributes[name]??null;}
  hasAttribute(name){return Object.hasOwn(this.attributes,name);}
  append(...values){this.children.push(...values);}
  replaceChildren(...values){this.children=[...values];}
  querySelector(selector){return selector==='[data-update-result-action]'?this.children.find(child=>child.dataset?.updateResultAction==='true')||null:null;}
 }
 const roots=new Map();
 const $=name=>{if(!roots.has(name))roots.set(name,new Element());return roots.get(name);};
 for(const match of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
  const element=$(match[3]);element.tag=match[1];
  for(const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/gi))element.setAttribute(attribute[1],attribute[2]);
  element.hidden=/(?:^|\s)hidden(?:\s|$)/.test(match[2]);
 }
 $('page-settings').hidden=false;
 const feedback=new FirmwareFeedback({getItem:()=>null,setItem(){}});
 const durable=new Map(),journal=new FirmwareAttemptJournal({getItem:key=>durable.get(key)??null,setItem:(key,value)=>durable.set(key,value)});
 const owned={id,name:'Pink Corkscrew',phoneLampStyle:'corkscrew'};
 const tasks=new Map(),statuses=new Map(),pending=new Map();
 const sender={id,entry:owned,stage,path,abort:new AbortController(),feedback:feedback.begin(id)};
 if(task){tasks.set(id,sender);feedback.update(sender.feedback,firmwareUpdatePresentation({stage,progress:percent}));}
 let connected=verified,cardRenders=0;
 const wifiLamp={raw:null},bleLamp={raw:null};
 const context={$,document:{hidden:false,createElement:tag=>new Element(tag),querySelectorAll:()=>[]},selected:owned,lamp:bleLamp,wifiLamp,bleLamp,
  cardFirmwareTasks:tasks,bluetoothFirmwareTask:null,firmwareFeedback:feedback,firmwareAttempts:journal,cardFirmwareUnconfirmed:pending,fleetStatuses:statuses,
  firmware:null,firmwareReceivedAt:0,settingsRestartWaitUntil:0,verifiedSelectedLamp:()=>connected,
  firmwareConnectionBusy:()=>Boolean(tasks.size||context.bluetoothFirmwareTask||[...statuses.values()].some(value=>['updating','restarting'].includes(value.state))),
  lampUpdatePresentation,lampArtworkSvg,resolvedStyle:entry=>({id:entry.phoneLampStyle||'unspecified'}),
  updatingLamp:()=>tasks.has(context.selected?.id),publicFirmwareFresh:false,publicFirmwareRun:null,publicFirmwareError:'',publicFirmware:null,
  state:null,busy:false,availableCardRelease:()=>null,validFirmwareVersion:()=>false,firmwareMessage:()=>'',
  renderFirmwareFeedback(){},renderBluetoothFirmwareControls(){},renderPower(){},renderLampStyleSettings(){},renderCenterTool(){},
  connectivity:{get:()=>({group:null})},settingsView:'overview',wifiFailures:new Map(),advancedAvailable:()=>false,
  bluetoothWifiAvailable:()=>false,legacyWithoutGroups:()=>false,verifiedOlderBluetoothSettings:()=>false,
  wifiScanning:false,connecting:false,wifiSetupAbort:null,bleWifiStatus:null,hideWifiPassword(){},
  groupsAvailable:()=>false,independentLightingAllowed:()=>true,playbackIdentity:null,rotationDirty:false,
  renderLamps:()=>{cardRenders++;},
  task:sender,current:()=>tasks.get(id)===sender,release:{version:'1.15.2'},bluetoothFirmwareConnectionSerial:0,
  acknowledgedBluetoothUpdateSource,firmwareUpdatePresentation,mergedLampEntries:()=>[owned],page:name=>pages.push(name)};
 const pages=[];
 runInNewContext(views+'\n'+settingsRender+'\n'+playbackRender+'\n'+firmwareRender+'\n'+progressCallback+'\nthis.ui={render:renderSettingsConnection,view:lampUpdateView,progress};',context);
 context.ui.render();
 return {context,$,feedback,tasks,statuses,pending,sender,roots,journal,pages,render:context.ui.render,progress:context.ui.progress,
  view:()=>context.ui.view(context.selected),cardRenders:()=>cardRenders,
  selectOther(){context.selected={id:other,name:'Other lamp',phoneLampStyle:'helix'};connected=false;context.ui.render();},
  receiver(snapshot,{observedAt=Date.now(),connectedTarget=false,state='updating'}={}){
   if(connectedTarget){connected=true;context.lamp=bleLamp;bleLamp.raw=snapshot;context.firmware=snapshot.firmware;context.firmwareReceivedAt=observedAt;}
   else statuses.set(id,{state,receiverSnapshot:snapshot,receiverSnapshotAt:observedAt});
   context.ui.render();
  },
  complete(){tasks.delete(id);pending.delete(id);statuses.delete(id);connected=true;context.lamp=wifiLamp;context.firmware={version:'1.15.2',phase:0};context.ui.render();},
  stopped({outcome='transferStopped',target=id,commit=false}={}){
   const manifest=parsePhoneManifest(`COOLLAMP-OTA-1\n1.15.3\nesp32c3\ndual-ota-2031616\n288\n${'a'.repeat(64)}\n`);
   journal.begin(target,manifest);
   if(outcome==='transferStopped'||commit){journal.beforeWrite(journal.get(target),1,77);journal.beforeWrite(journal.get(target),2,77);journal.beforeWrite(journal.get(target),3,77);journal.noteProgress(journal.get(target),8);}
   if(commit)journal.beforeWrite(journal.get(target),4,77);
   const result=classifyFirmwareSnapshot(journal.get(target),{identity:target,observedAt:Date.now(),firmware:{version:'1.15.2',phase:0},
    state:{mode:1,effectCount:47,power:true,brightness:100},receiver:{phase:0,error:0,committed:false,session:0,size:0,offset:0}});
   journal.settle(journal.get(target),result);
   tasks.delete(id);pending.delete(id);statuses.delete(id);
   if(commit)pending.set(id,'1.15.3');
   feedback.update(sender.feedback,{message:firmwareUpdateResultPresentation(result),terminal:true,...(commit?{outcome:'verification-required',targetVersion:'1.15.3'}:{})});
   context.ui.render();return result;
  }};
}
const ack=percent=>({stage:'transferring',version:'1.15.2',progress:percent,acknowledgedBytes:percent*10,total:1000});
const receiver=(fields={},target=id)=>({deviceId:target,firmware:{updateContractVersion:2,receiver:true,phase:3,route:1,progress:50,writtenOffset:500,totalBytes:1000,...fields}});
function assertNeutral(f){
 assert.equal(f.$('settingsUpdatePercent').textContent,'');
 assert.equal(f.$('settingsUpdateProgress').hasAttribute('value'),false);
 assert(!f.$('settingsUpdateArt').innerHTML.includes('data-update-progress'));
}

test('unverified Settings shows the selected receiving model, acknowledged percentage and accessible progress',()=>{
 const f=fixture();
 assert.equal(f.$('page-settings').dataset.connectionRecovering,'true');
 assert.equal(f.$('settingsUpdate').hidden,false);assert.equal(f.$('settingsRecovery').hidden,true);
 assert.equal(f.$('connectionBadge').textContent,'Updating');
 assert.equal(f.$('settingsUpdateTitle').textContent,'Updating Pink Corkscrew');
 assert.match(f.$('settingsUpdateArt').innerHTML,/data-lamp-artwork="corkscrew"/);
 assert.match(f.$('settingsUpdateArt').innerHTML,/data-update-progress="7"/);
 assert.equal(f.$('settingsUpdatePercent').textContent,'7%');
 assert.equal(f.$('settingsUpdateProgress').value,7);assert.equal(f.$('settingsUpdateProgress').max,100);
 assert.equal(f.$('settingsUpdateProgress').getAttribute('aria-label'),'Pink Corkscrew update progress');
 assert.match(f.$('settingsUpdateHint').textContent,/Keep CoolLamp open.*near your lamp/);
});

test('real acknowledged callbacks refresh Settings in place and fence retired sender callbacks',()=>{
 const f=fixture();
 f.progress(ack(19));
 assert.equal(f.$('settingsUpdatePercent').textContent,'19%');
 assert.equal(f.$('settingsUpdateProgress').value,19);
 assert.equal(f.$('settingsUpdateMessage').textContent,'Updating your lamp · 19%');
 assert.equal(f.$('settingsUpdateSource').textContent,'From your phone');
 assert.match(f.$('settingsUpdateArt').innerHTML,/data-update-source="bluetooth"/);
 f.progress(ack(65));assert.equal(f.$('settingsUpdateProgress').value,65);
 const rendered=f.cardRenders();f.tasks.delete(id);f.progress(ack(80));
 assert.equal(f.cardRenders(),rendered);assert.equal(f.$('settingsUpdateProgress').value,65);
});

test('a complete phone download stays indeterminate and does not borrow a lamp-written fill',()=>{
 const f=fixture();f.progress({...ack(100),stage:'downloading'});
 assert.equal(f.$('settingsUpdate').hidden,false);
 assert.equal(f.$('settingsUpdateMessage').textContent,'Getting the update on your phone…');
 assertNeutral(f);assert.equal(f.$('settingsUpdateSource').hidden,true);
});

test('restart, cancellation and pending final receipts never become a hundred-percent success icon',()=>{
 for(const kind of ['restarting','cancel','pending','reconciling']){
  const f=fixture({percent:100});
  if(kind==='restarting')f.progress({...ack(100),stage:'restarting'});
  else{if(kind==='cancel')f.sender.cancelRequested=true;if(kind==='pending')f.pending.set(id,'1.15.2');if(kind==='reconciling')f.sender.reconciling=true;f.render();}
  assert.equal(f.$('settingsUpdate').hidden,false);assertNeutral(f);
  assert(!/Your lamp is updated/.test(f.$('settingsUpdateMessage').textContent));
  if(kind==='cancel')assert.match(f.$('settingsUpdateMessage').textContent,/Stopping/);
  if(kind==='pending'||kind==='reconciling')assert.match(f.$('settingsUpdateMessage').textContent,/Checking/);
 }
});

test('another lamp using the updater connection does not claim this selected lamp is updating',()=>{
 const f=fixture();f.selectOther();
 assert.equal(f.$('settingsUpdate').hidden,true);assert.equal(f.$('settingsRecovery').hidden,false);
 assert.equal(f.$('connectionBadge').textContent,'Waiting');
 assert.equal(f.$('settingsRecoveryTitle').textContent,'Waiting to reconnect');
 assert.match(f.$('settingsRecoveryHint').textContent,/An update is using the connection/);
 assert(!f.$('settingsRecoveryHint').textContent.includes('Your update is still in progress'));
 f.progress(ack(30));assert.equal(f.$('settingsUpdate').hidden,true);
});

test('fresh verified receiver progress uses target identity, written-offset consistency and a bounded lifetime',()=>{
 const f=fixture({task:false});f.receiver(receiver());
 assert.equal(f.$('settingsUpdate').hidden,false);assert.equal(f.$('settingsUpdateProgress').value,50);
 assert.equal(f.$('settingsUpdateSource').textContent,'From the internet');
 for(const invalid of [
  receiver({},other),receiver({writtenOffset:499}),receiver({progress:101}),receiver({totalBytes:2031617}),
  receiver({receiver:false}),receiver({updateContractVersion:1}),receiver({phase:4})
 ]){const f=fixture({task:false});f.receiver(invalid);assertNeutral(f);}
 for(const observedAt of [Date.now()-5001,Date.now()+10000,0,NaN]){
  const f=fixture({task:false});f.receiver(receiver(),{observedAt});assertNeutral(f);
 }
});

test('connected receiver evidence also remains neutral for a different target or expired snapshot',()=>{
 for(const [snapshot,observedAt] of [[receiver({},other),Date.now()],[receiver(),Date.now()-5001]]){
  const f=fixture({task:false,verified:true});f.receiver(snapshot,{observedAt,connectedTarget:true});assertNeutral(f);
 }
 const f=fixture({task:false,verified:true});f.receiver(receiver(),{connectedTarget:true});
 assert.equal(f.$('settingsUpdateProgress').value,50);
});

test('receiver evidence expiry removes an already visible fill rather than retaining its old percentage',()=>{
 const f=fixture({task:false});f.receiver(receiver());
 assert.equal(f.$('settingsUpdateProgress').value,50);
 f.receiver(receiver(),{observedAt:Date.now()-5001});
 assert.equal(f.$('settingsUpdate').hidden,false);assertNeutral(f);
 assert.equal(f.$('settingsUpdateSource').hidden,true);
 assert.match(f.$('settingsUpdateMessage').textContent,/Checking/);
});

test('a retained app-hidden precommit outcome explains the stop without erasing installation uncertainty',()=>{
 const f=fixture({task:false});f.pending.set(id,'1.15.2');
 const token=f.feedback.begin(id),message=firmwareUpdateResultPresentation({outcome:'unresolved'},
  {stages:[{code:'app-hidden',commitAttempted:false}]});
 f.feedback.update(token,{message,terminal:true,outcome:'verification-required',targetVersion:'1.15.2'});f.render();
 assert.equal(f.$('settingsUpdate').hidden,false);assert.equal(f.$('settingsUpdateMessage').textContent,message);
 assert.match(message,/Sending stopped when CoolLamp left the screen/);
 assertNeutral(f);assert(!/unchanged|installed|try again/i.test(f.$('settingsUpdateMessage').textContent));
});

test('successful fresh completion hides update presentation and restores verified Settings',()=>{
 const f=fixture();f.progress(ack(100));f.complete();
 assert.equal(f.$('settingsUpdate').hidden,true);assert.equal(f.$('settingsRecovery').hidden,true);
 assert.equal(f.$('page-settings').dataset.connectionRecovering,'false');
 assert.equal(f.$('connectionBadge').textContent,'Wi-Fi');
 assert.equal(f.$('settingsConnection').textContent,'Pink Corkscrew · Wi-Fi');
});

for(const outcome of ['transferStopped','installationNotStarted'])test('durably confirmed '+outcome+' stays visible in selected Settings without ongoing progress',()=>{
 const f=fixture();f.stopped({outcome});
 assert.equal(f.journal.get(id).outcome,outcome);
 assert.equal(f.$('settingsUpdate').hidden,false);assert.equal(f.$('page-settings').dataset.updateActive,'false');
 assert.equal(f.$('settingsUpdateTitle').textContent,outcome==='transferStopped'?'Update stopped':'Update did not start');
 assert.match(f.$('settingsUpdateMessage').textContent,outcome==='transferStopped'?/transfer stopped before installation/i:/did not start/i);
 assertNeutral(f);assert.equal(f.$('settingsUpdateProgress').hidden,true);assert.equal(f.$('settingsUpdateSource').hidden,true);
 assert(!/Keep CoolLamp open|restarts|Updating|100%/.test(f.$('settingsUpdateHint').textContent));
 const action=f.$('settingsUpdate').querySelector('[data-update-result-action]');assert(action&&!action.hidden);
 action.onclick();assert.deepEqual(f.pages,['lamps']);assert.equal(f.tasks.size,0);assert.equal(f.journal.pending().length,0);
});

test('a saved result survives a render but another target, pending commit, or new attempt cannot borrow it',()=>{
 const f=fixture();f.stopped();f.render();assert.equal(f.$('settingsUpdate').hidden,false);
 const action=f.$('settingsUpdate').querySelector('[data-update-result-action]');
 const manifest=parsePhoneManifest(f.journal.get(id).text);f.journal.begin(id,manifest);action.onclick();assert.deepEqual(f.pages,[]);
 f.render();assert.equal(f.$('settingsUpdate').hidden,true);
 const different=fixture();different.stopped({target:other});assert.equal(different.$('settingsUpdate').hidden,true);
 const switched=fixture();switched.stopped();const oldAction=switched.$('settingsUpdate').querySelector('[data-update-result-action]');
 switched.selectOther();assert.equal(switched.$('settingsUpdate').hidden,true);oldAction.onclick();assert.deepEqual(switched.pages,[]);
 const uncertain=fixture();uncertain.stopped({commit:true});assert.equal(uncertain.journal.get(id).outcome,'pending');
 assert.equal(uncertain.$('settingsUpdate').hidden,false);assert.match(uncertain.$('settingsUpdateTitle').textContent,/Checking/);
 assert.equal(uncertain.$('settingsUpdateProgress').hidden,false);assertNeutral(uncertain);
 assert.equal(uncertain.$('settingsUpdate').querySelector('[data-update-result-action]'),null);
});

test('Settings progress stays accessible above hidden controls and decorative artwork does not announce twice',()=>{
 const f=fixture();
 assert.equal(f.$('settingsUpdateArt').getAttribute('aria-hidden'),'true');
 assert.equal(f.$('settingsUpdatePercent').getAttribute('aria-hidden'),'true');
 assert.equal(f.$('settingsUpdateMessage').getAttribute('role'),'status');
 assert.equal(f.$('settingsUpdateMessage').getAttribute('aria-live'),'polite');
 assert.equal(f.$('settingsUpdateMessage').getAttribute('aria-atomic'),'true');
 assert.equal(f.$('settingsUpdate').hasAttribute('aria-busy'),false);
 const hiddenRules=css.split('\n').filter(line=>line.includes('data-connection-recovering=true')).join('\n');
 assert(!hiddenRules.includes('#settingsUpdate'),'The update panel is not part of recovery-hidden controls');
 assert(!/<section\b[^>]*id="settingsUpdate"[^>]*data-settings-panel/.test(markup));
});
