import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {styleDefinition,styleLabel,resolveLampStyle} from '../src/lamp-style.js';
import {firmwareUpdatePresentation} from '../src/firmware-update-ui.js';
import {lampUpdatePresentation} from '../src/lamp-update-progress.js';
import {acknowledgedBluetoothUpdateSource,observedReceiverUpdate,updateSourceLabel,automaticUpdateCardMessage} from '../src/update-source.js';

const normalDigests={
 helix:'b96a5ed1279f82009bf515c83a06f8925d437b0a343f583466445512933eefd2',
 'large-helix':'e0bcdc9566f9a6af20ba6d9fc2d6ba5f4be2fb63caffd0480757149db1bc643b',
 corkscrew:'9b0165c38f45d324a5d0def7b027c031cc210f43d2debbc67c0d390479881c13',
 knot:'e82455443ed45fe7f84819b60b2e8a985ad218309cbc769ed51319e8211c5def',
 unspecified:'8c48200fb5833888f4358fa94e9b71379943fbbd5a1c103d68f0d2c15a645def'
};
const digest=value=>createHash('sha256').update(value).digest('hex');

test('ordinary model artwork remains byte identical to its existing public output',()=>{
 for(const [style,expected] of Object.entries(normalDigests))assert.equal(digest(lampArtworkSvg(style,{idPrefix:'test-normal'})),expected);
 assert.equal(lampArtworkSvg('future-model',{idPrefix:'test-normal'}),lampArtworkSvg('unspecified',{idPrefix:'test-normal'}));
});

test('actual model drawings fill from bottom to top at zero, half and full written progress',()=>{
 for(const style of [...Object.keys(normalDigests),'edison','sonata'])for(const progress of [0,50,100]){
  const value=lampArtworkSvg(style,{idPrefix:'test-update',updateProgress:progress});
  assert.match(value,new RegExp(`data-update-progress="${progress}"`));
  const clip=value.match(/<clipPath[^>]+><rect x="0" y="(-?[\d.]+)" width="120" height="([\d.]+)"\/><\/clipPath>/);
  const span=style==='edison'?210:180;
  assert(clip);assert.equal(Number(clip[1]),180-span*progress/100);assert.equal(Number(clip[2]),span*progress/100);
  assert.equal((value.match(/class="lamp-artwork-base"/g)||[]).length,1,'The base is not copied into the colored fill.');
  assert.match(value,/<g class="lamp-artwork-update-fill" clip-path="url\(#test-update-update-clip\)">/);
 }
});

test('Edison has its own larger bulb-and-coil silhouette, accessible name, themes and no external image',()=>{
 const value=lampArtworkSvg('edison',{idPrefix:'test-edison'});
 assert.match(value,/data-lamp-artwork="edison"/);assert.match(value,/aria-label="Edison lamp"/);
 assert.match(value,/lamp-artwork-edison-bulb/);assert.match(value,/lamp-artwork-support/);assert.match(value,/lamp-artwork-coil-back/);
 assert.notEqual(value,lampArtworkSvg('helix',{idPrefix:'test-edison'}));
 assert(!/<image\b|href=|https?:\/\//.test(value.replace('http://www.w3.org/2000/svg','')));
 assert.match(lampArtworkSvg('edison',{theme:'dark',lit:false}),/#93a196/);
 const source=readFileSync(new URL('../src/lamp-artwork.js',import.meta.url),'utf8');
 const drawing=source.slice(source.indexOf('function edison('),source.indexOf('function generic('));
 assert.match(drawing,/C35 -1 68 -2 91 17/);assert.match(drawing,/C119 40 115 75 89 94/);
 assert.match(value,/viewBox="0 -30 120 230"/);assert.match(value,/preserveAspectRatio="xMidYMax meet"/);
 assert.match(value,/lamp-artwork-edison-bulb-group" transform="translate\(0 -23\.92\) scale\(1 1\.23\)"/);
 assert.match(value,/lamp-artwork-edison-threads" transform="translate\(0 8\)"/);
 const css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');
 assert.match(css,/\.v2-lamp-entry \.lamp-design\.v2-card-art\[data-style=edison\]\{height:124px\}/);
 assert.match(css,/\.v2-individual-list \.v2-lamp-drawing\[data-lamp-artwork=edison\]\{height:76px\}/);
});

test('Sonata has an open S curve, two inward tips and its own rectangular base and knob',()=>{
 const value=lampArtworkSvg('sonata',{idPrefix:'test-sonata'});
 assert.match(value,/data-lamp-artwork="sonata"/);assert.match(value,/aria-label="Sonata lamp"/);
 assert.match(value,/lamp-artwork-sonata-curve/);assert.match(value,/lamp-artwork-sonata-tip/);assert.match(value,/lamp-artwork-sonata-knob/);
 assert.notEqual(value,lampArtworkSvg('helix',{idPrefix:'test-sonata'}));
 assert(!/<image\b|href=|https?:\/\//.test(value.replace('http://www.w3.org/2000/svg','')));
 assert.match(lampArtworkSvg('sonata',{theme:'dark',lit:false}),/#93a196/);
 assert.match(value,/viewBox="0 0 120 200"/);
});

test('unknown or malformed percentages never create an inferred fill',()=>{
 for(const progress of [undefined,null,NaN,Infinity,-1,101,50.5,'50',{},true]){
  const value=lampArtworkSvg('helix',{idPrefix:'test-normal',updateProgress:progress});
  assert.equal(digest(value),normalDigests.helix);
 }
 assert.match(lampArtworkSvg('future-design',{updateProgress:65}),/data-lamp-artwork="unspecified"/);
});

test('twenty cards have independent clips and labels are escaped without executable metadata',()=>{
 const values=Array.from({length:20},(_,index)=>lampArtworkSvg(index%2?'corkscrew':'helix',{updateProgress:index*5}));
 const ids=values.map(value=>value.match(/<clipPath id="([^"]+)"/)[1]);
 assert.equal(new Set(ids).size,20);
 for(let index=0;index<values.length;index++)assert(values[index].includes(`clip-path="url(#${ids[index]})"`));
 const unsafe=lampArtworkSvg('<script>',{label:'<script>" & secret',idPrefix:'x" onclick="unsafe',updateProgress:65});
 assert.match(unsafe,/data-lamp-artwork="unspecified"/);assert(!unsafe.includes('<script>'));assert(!unsafe.includes('onclick='));
 assert.match(unsafe,/aria-label="&lt;script&gt;&quot; &amp; secret"/);
 const decorative=lampArtworkSvg('helix',{updateProgress:65,decorative:true});
 assert.match(decorative,/aria-hidden="true"/);assert(!decorative.includes('role="img"'));assert(!decorative.includes('aria-label='));
});

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const illustration=source.slice(source.indexOf('function lampStyleIllustration('),source.indexOf('function renderLampStyleSettings('));
const render=source.slice(source.indexOf('function renderLamps()'),source.indexOf('async function discover(',source.indexOf('function renderLamps()')));
const updateView=source.slice(source.indexOf('function lampUpdateView('),source.indexOf('function renderSettingsUpdate('));
const id='aabbccddeeff',other='112233445566';

test('the production UI model exposes owned IDs from storage without adopting discovery or mesh inventory',()=>{
 const start=source.indexOf(' model:()=>(',source.indexOf('appV2=mountAppV2(')),end=source.indexOf('\n tourNavigate:',start);
 const owned=[{id},{id:'ble:legacy-phone-record'}],discovered=[{id},{id:other}];
 const context={store:{items:owned},mergedLampEntries:()=>discovered,connectivity:null,groupsSnapshot:{groups:[],lamps:[]},selected:null,firmware:null,connecting:false,verifiedSelectedLamp:()=>false,state:null,tourBlocked:()=>false,independentLightingAllowed:()=>false};
 runInNewContext('this.model=({'+source.slice(start,end)+'}).model;',context);
 const model=context.model();assert.deepEqual(Array.from(model.ownedLampIds),[id,'ble:legacy-phone-record']);assert.equal(model.lamps,discovered);
 assert(!model.ownedLampIds.includes(other));assert.deepEqual(owned,[{id},{id:'ble:legacy-phone-record'}]);
 assert.equal(model.selectedAutomatic,null);context.verifiedSelectedLamp=()=>true;
 for(const automatic of [true,false,null,undefined,'true']){context.firmware={automatic};assert.equal(context.model().selectedAutomatic,typeof automatic==='boolean'?automatic:null);}
 context.verifiedSelectedLamp=()=>false;context.firmware={automatic:true};assert.equal(context.model().selectedAutomatic,null);
});

test('the production pair adapter retains an immutable connected target rather than a newly selected identity',async()=>{
 const start=source.indexOf(' pair:',source.indexOf('appV2=mountAppV2(')),end=source.indexOf(',discover:',start);
 let result={connected:true,id},selected={id:other};const context={connect:async()=>result,selected};
 runInNewContext('this.pair=({'+source.slice(start,end)+'}).pair;',context);
 const protectedResult=await context.pair();assert(Object.isFrozen(protectedResult));assert.equal(protectedResult.id,id);assert.notEqual(protectedResult.id,selected.id);
 result.id=other;assert.equal(protectedResult.id,id);
 for(const invalid of [{connected:false,id},{connected:true,id:'ble:legacy'},undefined]){result=invalid;assert.equal(await context.pair(),invalid);}
});

// Run the production card renderer. This small DOM supplies presentation APIs
// only; no rewritten update logic or connection/firmware handler is substituted.
function fixture({stage='transferring',progress=65,pending=false,task=true,observation=null,style='corkscrew',second=true,cancelRequested=false,reconciling=false,focusCancel=false,updateSource=null,receiverSnapshot=null,receivedAt=Date.now()}={}){
 let document;
 class Element{
  constructor(tag='div'){this.tag=tag;this.dataset={};this.attributes={};this.children=[];this.className='';this.textContent='';this.innerHTML='';this.value=undefined;this.disabled=false;this.open=false;this.parent=null;
   this.classList={add:(...values)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...values])].join(' ');},contains:value=>this.className.split(' ').includes(value)};
  }
  append(...values){for(const value of values){value.parent=this;this.children.push(value);}}
  replaceChildren(...values){this.children=[];this.append(...values);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  contains(value){return this===value||this.children.some(child=>child.contains(value));}
  matches(selector){
   if(selector==='[data-lamp-id]')return Boolean(this.dataset.lampId);
   const connection=selector.match(/^\[data-connection="([^"]+)"\]$/);if(connection)return this.dataset.connection===connection[1];
   const className=selector.match(/^\.([\w-]+)(\[open\])?$/);return Boolean(className&&this.classList.contains(className[1])&&(!className[2]||this.open));
  }
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){document.activeElement=this;}
 }
 const roots=new Map(['discover','lampList','emptyLamps','v2LampSearch'].map(name=>[name,new Element()]));roots.get('v2LampSearch').value='';
 document={activeElement:null,createElement:tag=>new Element(tag)};
 const entries=[{id,name:'My lamp',phoneLampStyle:style},...(second?[{id:other,name:'Other lamp',phoneLampStyle:'helix'}]:[])];
 const tasks=new Map(task?[[id,{stage,cancelRequested,reconciling,updateSource}]]:[]),feedback=new Map([[id,firmwareUpdatePresentation({stage,progress})]]),statuses=new Map(observation?[[id,observation]]:[]);
 const cancel=new Element('button');cancel.className='secondary v2-card-update-cancel';cancel.dataset.connection='cancel-update';let cancelClicks=0;cancel.onclick=()=>cancelClicks++;
 if(focusCancel){const old=new Element('article');old.className='lamp-entry';old.dataset.lampId=id;old.append(cancel);document.activeElement=cancel;}
 const control=connection=>{const element=new Element('button');element.dataset.connection=connection;return element;};
 const receiverLamp=receiverSnapshot?{raw:receiverSnapshot}:null;
 const context={document,$:name=>roots.get(name),discovery:{scanned:true},mergedLampEntries:()=>entries,verifiedSelectedLamp:()=>Boolean(receiverSnapshot),selected:receiverSnapshot?entries[0]:null,lamp:receiverLamp,wifiLamp:receiverLamp,
  connectivity:{get:()=>null},fleetStatuses:statuses,cardFirmwareTasks:tasks,firmwareFeedback:{get:key=>feedback.get(key)},cardFirmwareUnconfirmed:new Map(pending?[[id,'1.15.1']]:[]),
  resolvedStyle:entry=>resolveLampStyle(entry.lampStyle,entry.phoneLampStyle),styleDefinition,styleLabel,lampArtworkSvg,observedReceiverUpdate,updateSourceLabel,automaticUpdateCardMessage,lampUpdatePresentation,bluetoothFirmwareTask:null,
  connecting:false,busy:false,meshSelection:null,fleetLampInstalling:key=>tasks.has(key),firmwareConnectionSelectionAllowed:()=>true,groupsSnapshot:{groups:[]},
  openCardSettings(){},cardPowerButton:()=>control('power'),cardFirmwareButton:()=>control('update'),cardFirmwareReinstallButton:()=>null,
  cardFirmwareCancelButton:entry=>entry.id===id&&task?cancel:null,cardPowerTasks:new Map(),
  lampFirmwareLabel:()=> 'Firmware 1.15.1',firmware:receiverSnapshot?.firmware??null,firmwareReceivedAt:receiverSnapshot?receivedAt:0,validFirmwareVersion:()=>false,
  publicFirmwareRun:null,publicFirmwareError:'',publicFirmwareFresh:false,updateDiagnosticDetails:()=>null,
  wifiCardIcon:()=>control('wifi'),bluetoothCardIcon:()=>control('bluetooth'),groupCardIcon:()=>control('group'),bluetoothFirmwareOwner:()=>null,
  removeLampFromPhone:async()=>{},cardPowerMessages:new Map(),cardConnectionMessages:new Map(),cardFirmwareMessages:new Map(),meshNetworkMessages:new Map(),
  fleetCardStatus:()=>null,activeCardBluetooth:()=>false,renderFleetControls(){}};
 runInNewContext(illustration+'\n'+updateView+'\n'+render+'\nthis.render=renderLamps;',context);context.render();
 const card=key=>roots.get('lampList').children.find(value=>value.dataset.lampId===key);
 return {card:card(id),otherCard:card(other),cancel,document,cancelClicks:()=>cancelClicks};
}

test('production cards show only the receiving model with a visible percentage and native accessible bar',()=>{
 for(const progress of [0,50,100]){
  const view=fixture({progress}),art=view.card.querySelector('.v2-card-art'),bar=view.card.querySelector('.lamp-update-progress');
  assert.match(art.innerHTML,/data-lamp-artwork="corkscrew"/);assert.match(art.innerHTML,new RegExp(`data-update-progress="${progress}"`));
  assert.equal(art.querySelector('.v2-card-update-percent').textContent,progress+'%');assert.equal(art.attributes['aria-hidden'],'true');assert.equal(art.attributes.role,undefined);
  assert.equal(bar.value,progress);assert.equal(bar.max,100);assert.equal(bar.attributes['aria-label'],'My lamp update progress');
  assert(!view.otherCard.querySelector('.v2-card-art').innerHTML.includes('data-update-progress'));
  assert.equal(view.otherCard.querySelector('.lamp-update-progress'),null);
 }
});

test('downloaded, unconfirmed, stopping and restart cards never borrow a hundred-percent fill',()=>{
 for(const options of [
  ...['downloading','downloaded','preparing','connecting','verifying','restarting','checking-result'].map(stage=>({stage,progress:100})),
  {pending:true,progress:100},{reconciling:true,progress:100},{cancelRequested:true,progress:65},
  ...[undefined,NaN,-1,101,50.5,'65'].map(progress=>({progress}))
 ]){
  // Passing undefined explicitly models a sender with no offset, rather than
  // the fixture's valid default percentage.
  if(Object.hasOwn(options,'progress')&&options.progress===undefined)options.progress=null;
  const view=fixture(options),art=view.card.querySelector('.v2-card-art'),bar=view.card.querySelector('.lamp-update-progress');
  assert(!art.innerHTML.includes('data-update-progress'));assert.equal(art.querySelector('.v2-card-update-percent'),null);assert.equal(bar.value,undefined);
 }
});

test('fleet percentages require both fresh target verification and an updating phase',()=>{
 for(const observation of [null,{state:'updating',progress:65},{state:'updating',progress:65,verified:true,fresh:false},{state:'updating',progress:65,verified:false,fresh:true},{state:'restarting',progress:100,verified:true,fresh:true}]){
  const view=fixture({task:false,observation});assert(!view.card.querySelector('.v2-card-art').innerHTML.includes('data-update-progress'));
 }
 const ready=fixture({task:false,observation:{state:'updating',progress:65,verified:true,fresh:true}});
 assert.match(ready.card.querySelector('.v2-card-art').innerHTML,/data-update-progress="65"/);assert.equal(ready.card.querySelector('.lamp-update-progress').value,65);
});

test('unknown card designs stay generic and rendering retains the same Cancel control and focus',()=>{
 const view=fixture({style:'future-design',focusCancel:true});assert.match(view.card.querySelector('.v2-card-art').innerHTML,/data-lamp-artwork="unspecified"/);
 assert.equal(view.card.querySelector('.v2-card-update-cancel'),view.cancel);assert.equal(view.document.activeElement,view.cancel);view.cancel.onclick();assert.equal(view.cancelClicks(),1);
});

test('theme, clipping, numeric legibility and reduced motion are covered by the production stylesheet',()=>{
 const css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');
 assert.match(css,/\.v2-card-update-art>svg\{[^}]*overflow:hidden/);
 assert.match(css,/\.v2-card-update-art>\.v2-card-update-percent\{[^}]*font-size:1rem[^}]*color:var\(--ink\)/);
 assert.match(css,/\.lamp-artwork-update-fill path\{stroke:var\(--lamp-update-fill,#686868\)/);
 assert.match(css,/html\[data-app-theme=dark\]\{--lamp-update-fill:#cecece\}/);
 assert.match(css,/@media\(prefers-color-scheme:dark\)\{html\[data-app-theme=system\]\{--lamp-update-fill:#cecece\}/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{[^\n]*animation:none!important/);
 assert(!/\.lamp-artwork-update-(?:fill|rest)\{[^}]*animation:/.test(css),'Confirmed progress does not fake movement between acknowledged offsets.');
});

test('the actual owned progress callback colors only acknowledged pinned phone writes, never download or route suggestions',()=>{
 const start=source.indexOf('  const progress=value=>',source.indexOf('async function updateLampCard('));
 const end=source.indexOf('\n  const result=await updateCardFirmware',start),task={abort:new AbortController()},records=[];
 const context={task,current:()=>true,release:{version:'1.15.1'},bluetoothFirmwareConnectionSerial:0,document:{hidden:false},
  acknowledgedBluetoothUpdateSource,firmwareUpdatePresentation,firmwareFeedback:{update:(_token,value)=>records.push(value)},renderLamps(){},renderFirmware(){}};
 runInNewContext(source.slice(start,end)+'\nthis.progress=progress;',context);
 const ack={stage:'transferring',version:'1.15.1',progress:65,acknowledgedBytes:650,total:1000};
 context.progress({...ack,stage:'downloading',progress:100});assert.equal(task.updateSource,null);assert.equal(records.at(-1).progress,undefined);
 context.progress({...ack,stage:'wifi'});assert.equal(task.path,'wifi');assert.equal(task.updateSource,null);
 context.progress(ack);assert.equal(task.updateSource,'bluetooth');assert.equal(records.at(-1).progress,65);
 context.progress({...ack,version:'1.15.2'});assert.equal(task.updateSource,null);
 context.progress({...ack,acknowledgedBytes:649});assert.equal(task.updateSource,null);
 context.progress({...ack,stage:'restarting',progress:100});assert.equal(task.updateSource,null);assert.equal(records.at(-1).progress,undefined);
});

test('the production receiving card exposes a plain source label beside decorative blue phone artwork',()=>{
 const view=fixture({updateSource:'bluetooth'}),art=view.card.querySelector('.v2-card-art');
 assert.match(art.innerHTML,/data-update-source="bluetooth"/);assert.equal(art.attributes['aria-hidden'],'true');
 assert.equal(view.card.querySelector('.v2-card-update-source').textContent,'From your phone');
 assert.match(view.card.querySelector('.lamp-update-progress').attributes['aria-label'],/from your phone/);
 assert.equal(view.otherCard.querySelector('.v2-card-update-source'),null);
 for(const options of [{stage:'downloading',progress:100},{stage:'restarting',progress:100},{pending:true},{cancelRequested:true},{reconciling:true}]){
  const neutral=fixture({...options,updateSource:'bluetooth'});assert.equal(neutral.card.querySelector('.v2-card-update-source'),null);assert(!neutral.card.querySelector('.v2-card-art').innerHTML.includes('data-update-source'));
 }
});

test('verified fresh active target snapshots show Internet/donation source; compact missing identity and old snapshots do not',()=>{
 const firmware={version:'1.15.1',updateContractVersion:2,phase:3,receiver:true,route:1,progress:50,writtenOffset:500,totalBytes:1000};
 for(const [route,label,color] of [[1,'From the internet','internet'],[3,'From another trusted lamp','donation'],[4,'From your computer','manual-upload']]){
  const view=fixture({task:false,receiverSnapshot:{deviceId:id,firmware:{...firmware,route}}});
  assert.match(view.card.querySelector('.v2-card-art').innerHTML,new RegExp(`data-update-source="${color}"`));
  assert.equal(view.card.querySelector('.v2-card-update-source').textContent,label);assert.equal(view.card.querySelector('.lamp-update-progress').value,50);
  assert.equal(view.card.querySelector('.v2-card-status').textContent,'Updating your lamp');
 }
 for(const snapshot of [{firmware},{deviceId:other,firmware},{deviceId:id,firmware:{...firmware,phase:4}},{deviceId:id,firmware:{...firmware,receiver:false}},{deviceId:id,firmware:{...firmware,totalBytes:0}}]){
  const view=fixture({task:false,receiverSnapshot:snapshot});assert.equal(view.card.querySelector('.v2-card-update-source'),null);assert(!view.card.querySelector('.v2-card-art').innerHTML.includes('data-update-source'));
 }
 const stale=fixture({task:false,receiverSnapshot:{deviceId:id,firmware},receivedAt:Date.now()-5001});assert.equal(stale.card.querySelector('.v2-card-update-source'),null);
});

test('unknown future and legacy source evidence keeps generic progress without an Internet color',()=>{
 const firmware={updateContractVersion:2,phase:3,receiver:true,progress:50,writtenOffset:500,totalBytes:1000};
 for(const route of [0,99,undefined,'internet']){
  const view=fixture({task:false,receiverSnapshot:{deviceId:id,firmware:{...firmware,route}}});
  assert.equal(view.card.querySelector('.lamp-update-progress').value,50);assert.equal(view.card.querySelector('.v2-card-update-source'),null);
  assert(!view.card.querySelector('.v2-card-art').innerHTML.includes('data-update-source'));
 }
 const legacy=fixture({updateSource:null});assert.equal(legacy.card.querySelector('.lamp-update-progress').value,65);assert.equal(legacy.card.querySelector('.v2-card-update-source'),null);
});

test('legacy active computer uploads show their source without an invented percentage',()=>{
 for(const phase of [0,3]){
  const view=fixture({task:false,receiverSnapshot:{deviceId:id,firmware:{updateContractVersion:2,receiver:true,route:4,phase,writtenOffset:500,totalBytes:0,progress:0}}});
  assert.equal(view.card.querySelector('.v2-card-update-source').textContent,'From your computer');assert.equal(view.card.querySelector('.lamp-update-progress').value,undefined);
  assert(!view.card.querySelector('.v2-card-art').innerHTML.includes('data-update-progress'));
 }
});

test('retained automatic attention never competes with a pending receipt or active receiving progress',()=>{
 const observation={automaticEnabled:true,automaticAttention:{target:id,checkedAt:Date.now(),kind:'attention',offerPhone:true,service:{reason:14,phoneFallback:true}}};
 const ordinary=fixture({task:false,observation});assert.match(ordinary.card.querySelector('.v2-card-auto-attention').textContent,/Tap Update/);
 assert.equal(fixture({pending:true,task:false,observation}).card.querySelector('.v2-card-auto-attention'),null);
 assert.equal(fixture({task:true,observation}).card.querySelector('.v2-card-auto-attention'),null);
 assert.equal(fixture({task:false,observation:{...observation,automaticEnabled:false}}).card.querySelector('.v2-card-auto-attention'),null);
 const receiver={deviceId:id,firmware:{updateContractVersion:2,receiver:true,phase:3,route:1,progress:50,writtenOffset:500,totalBytes:1000}};
 assert.equal(fixture({task:false,observation,receiverSnapshot:receiver}).card.querySelector('.v2-card-auto-attention'),null);
});
