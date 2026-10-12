import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {resolveLampStyle} from '../src/lamp-style.js';
import {OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT} from '../src/onboarding.js';

// Exercise the mounted UI and its real delegated click handler. The small DOM
// fixture supplies only browser presentation APIs; connection results and time
// are controlled explicitly, without a lamp or a browser process.
const source=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let turn=0;turn<12;turn++)await Promise.resolve();};
const lamp={id:'aabbccddeeff',name:'New reading lamp',room:'Bedroom',phoneLampStyle:'helix'};

function fixture(select=async()=>({connected:true}),options={}){
 const elements=new Map(),listeners=new Map(),timers=new Map(),messages=[],navigations=[],selections=[];
 let nextTimer=0,now=0,document;
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.attributes={};this.hidden=false;this.open=false;this.disabled=false;this.children=[];this.listeners=new Map();this.textContent='';this.value='';this._html='';}
  set innerHTML(value){
   this._html=value;this.children=[];
   if(this.id==='v2Dialog'){
    elements.delete('v2DialogStatus');
    const statusTag=value.match(/<p\b([^>]*\bid="v2DialogStatus"[^>]*)>/);
    if(statusTag){const status=new Element('v2DialogStatus');for(const [,name,text] of statusTag[1].matchAll(/([\w-]+)="([^"]*)"/g))status.setAttribute(name,text);elements.set('v2DialogStatus',status);}
    for(const tag of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
     const button=new Element();button._html=tag[2];
     for(const attribute of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)){
      const [,name,attributeValue]=attribute;
      if(name.startsWith('data-'))button.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attributeValue;
      else button.setAttribute(name,attributeValue);
     }
     button.disabled=/\bdisabled\b/.test(tag[1]);button.hidden=/\bhidden\b/.test(tag[1]);this.children.push(button);
    }
    for(const tag of value.matchAll(/<(?:input|select)\b([^>]*)>/g)){
     const id=tag[1].match(/\bid="([^"]+)"/)?.[1],input=id?element(id):new Element();
     input.value=tag[1].match(/\bvalue="([^"]*)"/)?.[1]||'';input.name=tag[1].match(/\bname="([^"]*)"/)?.[1]||'';input.checked=/\bchecked\b/.test(tag[1]);this.children.push(input);
    }
   }
  }
  get innerHTML(){return this._html;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,callback){const handlers=this.listeners.get(name)||[];handlers.push(callback);this.listeners.set(name,handlers);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  replaceChildren(){this._html='';this.children=[];if(this.id==='v2Dialog')elements.delete('v2DialogStatus');}
  querySelector(selector){
   if(selector==='small'){
    if(!this._html.includes('<small>'))return null;
    if(!this.small){this.small=new Element();this.small.textContent=this._html.match(/<small>(.*?)<\/small>/)?.[1]||'';}return this.small;
   }
   if(selector==='[data-v2="select-settings"]')return this.children.find(child=>child.dataset.v2==='select-settings')||null;
   return this.children[0]||null;
  }
  querySelectorAll(selector){return this.children.filter(child=>selector==='[name="v2GroupMember"]:checked'?child.name==='v2GroupMember'&&child.checked:selector==='button'||selector==='[data-v2]'||selector.includes(`data-v2="${child.dataset.v2}"`));}
  closest(){return this;}
  contains(value){return this===value||this.children.includes(value);}
  focus(){document.activeElement=this;}
  scrollIntoView(){}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 document={hidden:false,activeElement:null,documentElement:element('root'),body:element('body'),
  getElementById(id){return id==='v2DialogStatus'?elements.get(id)||null:element(id);},
  querySelector:()=>element('settings-navigation'),querySelectorAll:()=>[],createElement:()=>new Element(),
  addEventListener(name,callback){const handlers=listeners.get(name)||[];handlers.push(callback);listeners.set(name,handlers);}};
 let preferenceValue=options.preferences??null;
 const context={document,AbortController,DOMException,lampArtworkSvg,resolveLampStyle,OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT,
  localStorage:{getItem:()=>preferenceValue,setItem(key,value){if(options.failStorage)throw Error('Storage full');preferenceValue=value;}},
  setInterval:()=>++nextTimer,clearInterval(){},
  setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const api={model:()=>options.model||({lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false}),
  message:message=>messages.push(message),navigate:(...args)=>navigations.push(args),
  select(id,section,options){selections.push({id,section,options});return select(id,section,options);},...options.api};
 runInNewContext(source+'\nglobalThis.mount=mountAppV2;',context);
 const ui=context.mount(api),dialog=element('v2Dialog');
 return {ui,dialog,messages,navigations,selections,element,preferences:()=>preferenceValue,
  status:()=>elements.get('v2DialogStatus')?.textContent||'',
  click(action,dataset={}){const button=dialog.children.find(candidate=>candidate.dataset.v2===action&&Object.entries(dataset).every(([name,value])=>candidate.dataset[name]===value))||new Element();button.dataset={...button.dataset,v2:action,...dataset};for(const callback of listeners.get('click')||[])callback({target:button});},
  cancel(){let prevented=false;const event={preventDefault(){prevented=true;}};for(const callback of dialog.listeners.get('cancel')||[])callback(event);if(!prevented)dialog.close();return prevented;},
  advance(milliseconds){now+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}},
  dispose(){ui.destroy();}
 };
}

function choose(ui,section='design'){
 ui.ui.chooseLight(section);ui.click('select-settings',{id:lamp.id,section});
}

test('the card gear immediately opens persistent accessible progress through a twenty-second connection',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);
 // Execute the actual card click assignment, then the actual mounted UI.
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),assignment=main.match(/gear\.onclick=([^;]+);/)[0];
 const gear={};runInNewContext(assignment,{gear,appV2:ui.ui,entry:lamp});gear.onclick();
 assert.equal(ui.dialog.open,true);assert.match(ui.status(),/Connecting to New reading lamp.*reading its settings/);
 const feedback=ui.element('v2DialogStatus');assert.equal(feedback.dataset.state,'opening');assert.equal(feedback.getAttribute('role'),'status');assert.equal(feedback.getAttribute('aria-live'),'polite');assert.equal(feedback.getAttribute('aria-atomic'),'true');
 assert.notEqual(ui.dialog.getAttribute('aria-busy'),'true');assert(ui.dialog.innerHTML.indexOf('id="v2DialogStatus"')<ui.dialog.innerHTML.indexOf('v2-sheet-body'));
 assert.equal(ui.dialog.querySelector('[data-v2="select-settings"]').hidden,true);
 await settle();ui.advance(20000);await settle();assert.equal(ui.status(),feedback.textContent);assert.equal(feedback.dataset.state,'opening');assert.equal(ui.selections.length,1);assert.equal(ui.navigations.length,0);
 gate.resolve({connected:true,id:lamp.id});await settle();assert.equal(ui.dialog.open,false);assert.equal(ui.dialog.dataset.selectionLoading,undefined);assert.deepEqual(ui.navigations,[['settings','overview']]);ui.dispose();
});

test('direct Settings failure stops progress and exposes a working retry',async()=>{
 let calls=0;const ui=fixture(async()=>++calls===1?{connected:false,error:Error('Your lamp is not responding yet.')}:{connected:true,id:lamp.id});
 ui.ui.openSettings(lamp.id);await settle();assert.equal(ui.element('v2DialogStatus').dataset.state,'error');assert.match(ui.status(),/not responding/);assert.equal(ui.dialog.dataset.selectionLoading,undefined);
 const retry=ui.dialog.querySelector('[data-v2="select-settings"]');assert.equal(retry.hidden,false);assert.equal(retry.disabled,false);assert.notEqual(retry.getAttribute('aria-busy'),'true');
 ui.click('select-settings',{id:lamp.id,section:'overview'});assert.equal(retry.hidden,true);await settle();assert.equal(calls,2);assert.deepEqual(ui.navigations,[['settings','overview']]);ui.dispose();
});

test('closing direct Settings fences a late result while another target opens',async()=>{
 const first=deferred(),second=deferred(),other={id:'112233445566',name:'Other lamp'},model={lamps:[lamp,other],groups:[],statuses:{}};
 const ui=fixture(id=>id===lamp.id?first.promise:second.promise,{model});ui.ui.openSettings(lamp.id);await settle();ui.click('close');
 assert.equal(ui.selections[0].options.signal.aborted,true);ui.ui.openSettings(other.id,'design');await settle();
 first.resolve({connected:true,id:lamp.id});await settle();assert.equal(ui.dialog.open,true);assert.match(ui.status(),/Other lamp/);assert.equal(ui.navigations.length,0);
 second.resolve({connected:true,id:other.id});await settle();assert.deepEqual(ui.navigations,[['settings','design']]);ui.dispose();
});

test('direct Settings timeout is route neutral and duplicate taps do not start another connection',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);ui.ui.openSettings(lamp.id);ui.ui.openSettings(lamp.id);await settle();assert.equal(ui.selections.length,1);
 ui.advance(25000);await settle();assert.match(ui.status(),/Keep the lamp powered on/);assert.doesNotMatch(ui.status(),/closer|Bluetooth/);assert.equal(ui.selections[0].options.signal.aborted,true);assert.equal(ui.element('v2DialogStatus').dataset.state,'error');
 gate.resolve({connected:true,id:lamp.id});await settle();assert.equal(ui.navigations.length,0);ui.dispose();
});

for(const result of [undefined,{connected:false}])test(`an unsuccessful lamp selection (${result?'disconnected':'missing result'}) gives a visible retry message`,async()=>{
 const ui=fixture(async()=>result);choose(ui);await settle();
 assert.equal(ui.dialog.open,true);assert.match(ui.status(),/connect|reach|try|again/i);assert.equal(ui.navigations.length,0);
 assert.notEqual(ui.dialog.getAttribute('aria-busy'),'true');ui.dispose();
});

test('a rejected selection displays the failure and does not navigate',async()=>{
 const ui=fixture(async()=>{throw Error('The lamp is out of reach. Try again.');});choose(ui);await settle();
 assert.match(ui.status(),/out of reach/);assert.equal(ui.dialog.open,true);assert.equal(ui.navigations.length,0);ui.dispose();
});

test('a pending selection immediately shows progress and Close cancels it',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);
 assert.match(ui.status(),/connect|find|check|opening|prepare/i);assert.equal(ui.dialog.dataset.selectionLoading,'true');assert.notEqual(ui.dialog.getAttribute('aria-busy'),'true');
 await settle();
 assert.ok(ui.selections[0].options.signal);assert.equal(ui.selections[0].options.isCurrent(),true);
 ui.click('close');assert.equal(ui.dialog.open,false);assert.equal(ui.selections[0].options.signal.aborted,true);assert.equal(ui.selections[0].options.isCurrent(),false);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,0);ui.dispose();
});

test('system dismissal cancels a pending selection without blocking the chooser',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);await settle();
 assert.equal(ui.cancel(),false);assert.equal(ui.dialog.open,false);assert.equal(ui.selections[0].options.signal.aborted,true);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,0);ui.dispose();
});

for(const section of ['design','hardware'])test(`a successful ${section} selection closes the chooser and opens that lamp section`,async()=>{
 const ui=fixture();choose(ui,section);await settle();
 assert.equal(ui.selections[0].id,lamp.id);assert.equal(ui.selections[0].section,section);assert.equal(ui.dialog.open,false);
 assert.deepEqual(ui.navigations,[['settings',section]]);ui.dispose();
});

test('changing pages cancels selection and fences a late success',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);await settle();ui.ui.navigate('lamps');
 assert.equal(ui.selections[0].options.signal.aborted,true);gate.resolve({connected:true});await settle();
 assert.equal(ui.navigations.length,0);ui.dispose();
});

test('a selection that stalls times out, aborts, and permits a fresh attempt',async()=>{
 const gate=deferred();let calls=0;const ui=fixture(()=>++calls===1?gate.promise:Promise.resolve({connected:true}));choose(ui);await settle();
 ui.advance(25000);await settle();
 assert.equal(ui.selections[0].options.signal.aborted,true);assert.match(ui.status(),/connect|reach|try|again|time/i);assert.equal(ui.dialog.open,true);
 ui.click('select-settings',{id:lamp.id,section:'design'});await settle();
 assert.equal(calls,2);assert.deepEqual(ui.navigations,[['settings','design']]);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,1);ui.dispose();
});

test('a failed selection leaves the lamp selectable for retry',async()=>{
 let calls=0;const ui=fixture(async()=>++calls===1?{connected:false,error:Error('Try your lamp again.')}:({connected:true,id:lamp.id}));choose(ui);await settle();
 assert.match(ui.status(),/Try your lamp again/);assert.equal(ui.dialog.querySelectorAll('[data-v2="select-settings"]')[0].disabled,false);
 ui.click('select-settings',{id:lamp.id,section:'design'});await settle();assert.equal(calls,2);assert.deepEqual(ui.navigations,[['settings','design']]);ui.dispose();
});

test('a connection for a different lamp cannot open its settings as the chosen lamp',async()=>{
 const ui=fixture(async()=>({connected:true,id:'112233445566'}));choose(ui);await settle();
 assert.match(ui.status(),/different lamp/);assert.equal(ui.dialog.open,true);assert.equal(ui.navigations.length,0);ui.dispose();
});

function setupFixture({count=0,error,gate,automaticGate,automatic=false,failStorage=false}={}){
 const other={id:'112233445566',name:'First lamp'},model={lamps:count?[other]:[],ownedLampIds:count?[other.id]:[],groups:[],statuses:{},selected:null,connected:false,selectedAutomatic:automatic};
 const writes=[],pairs=[],api={pair:async()=>{pairs.push(true);if(gate)await gate.promise;model.lamps.push(lamp);model.ownedLampIds.push(lamp.id);model.selected={...lamp,lampStyle:{id:'future-design'}};model.connected=true;return {connected:true,id:lamp.id};},setupDetails:async value=>{writes.push(['details',value]);if(error)throw error;},setAutomatic:async(...values)=>{writes.push(['automatic',...values]);if(automaticGate)await automaticGate.promise;}};
 const ui=fixture(undefined,{model,api,failStorage});return {...ui,model,writes,pairs};
}
test('genuinely fresh first-use opens guide once and never pairs or mutates without a button',()=>{
 const ui=setupFixture();assert.equal(ui.dialog.open,true);assert.match(ui.dialog.innerHTML,/Let’s meet/);assert.equal(ui.pairs.length+ui.writes.length,0);
 const saved=ui.preferences();ui.click('close');assert.equal(ui.dialog.open,false);ui.dispose();
 const reload=fixture(undefined,{model:{lamps:[],ownedLampIds:[],groups:[],statuses:{},connected:false},preferences:saved});assert.equal(reload.dialog.open,false);reload.dispose();
});
test('confirmed setup keeps future design, persists guide and preserves existing automatic opt-in',async()=>{
 const ui=setupFixture({automatic:true});ui.click('setup-next');ui.click('pair');await settle();assert.match(ui.dialog.innerHTML,/Keep this lamp’s current design/);
 ui.click('setup-save');await settle();assert.equal(ui.writes[0][1].style,'future-design');assert.equal(ui.element('v2SetupAutomatic').checked,true);
 ui.click('setup-done');await settle();assert.equal(ui.writes.length,1);assert.equal(JSON.parse(ui.preferences()).onboarding.firstComplete,true);assert.equal(ui.dialog.open,false);ui.dispose();
});
test('second verified owned lamp offers group guide once and Skip leaves both lamps unchanged',async()=>{
 const ui=setupFixture({count:1});ui.click('add');ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();ui.click('setup-done');await settle();
 assert.match(ui.dialog.innerHTML,/One main lamp/);const before=ui.writes.length;ui.click('group-guide-skip');assert.equal(ui.writes.length,before);assert.equal(JSON.parse(ui.preferences()).onboarding.secondGroupSeen,true);assert.equal(ui.dialog.open,false);
 ui.click('add');assert.match(ui.dialog.innerHTML,/Connect without the guide/);ui.dispose();
});
test('second-lamp WiFi branch defers group guide until an idle Home navigation with verified target',async()=>{
 const ui=setupFixture({count:1});ui.click('add');ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();ui.click('setup-wifi');await settle();assert.equal(ui.dialog.open,false);assert.deepEqual(ui.navigations,[['settings','network']]);
 ui.model.connected=false;ui.ui.navigate('home');assert.equal(ui.dialog.open,false);ui.model.connected=true;ui.ui.navigate('home');assert.match(ui.dialog.innerHTML,/One main lamp/);ui.click('group-guide-skip');ui.ui.navigate('home');assert.equal(ui.dialog.open,false);assert.equal(ui.writes.length,1);ui.dispose();
});
test('Home during an unfinished WiFi-guide preference save cannot offer a group or reopen a late guide',async()=>{
 const automaticGate=deferred(),ui=setupFixture({count:1,automaticGate});ui.click('add');ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();ui.element('v2SetupAutomatic').checked=true;ui.click('setup-wifi');await settle();ui.ui.navigate('home');assert.equal(ui.dialog.open,false);automaticGate.resolve();await settle();assert.equal(ui.dialog.open,false);assert.equal(ui.navigations.length,0);ui.ui.navigate('home');assert.match(ui.dialog.innerHTML,/One main lamp/);assert.equal(ui.writes.length,2);ui.dispose();
});
test('partial setup save becomes review-only and interrupted reload cannot replay it',async()=>{
 const ui=setupFixture({error:Object.assign(Error('Style reply lost'),{uncertain:true})});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();
 assert.match(ui.dialog.innerHTML,/Check this lamp/);assert.doesNotMatch(ui.dialog.innerHTML,/data-v2="setup-save"/);assert.equal(ui.writes.length,1);assert.equal(JSON.parse(ui.preferences()).onboarding.pending.needsReview,true);
 const saved=ui.preferences(),model=ui.model;ui.dispose();const replay=[];const reload=fixture(undefined,{model,preferences:saved,api:{pair:async()=>replay.push('pair'),setupDetails:async()=>replay.push('write')}});reload.click('add');assert.match(reload.dialog.innerHTML,/Check this lamp/);assert.equal(replay.length,0);reload.dispose();
});
test('late pairing cannot advance the guide after navigation',async()=>{
 const gate=deferred(),ui=setupFixture({gate});ui.click('setup-next');ui.click('pair');await settle();ui.ui.navigate('lamps');gate.resolve();await settle();assert.doesNotMatch(ui.dialog.innerHTML,/Make it yours/);assert.equal(ui.writes.length,0);assert.equal(JSON.parse(ui.preferences()).onboarding.pending,null);ui.dispose();
});
test('full local storage never changes a successful lamp save into a failed mutation',async()=>{
 const ui=setupFixture({failStorage:true});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();assert.match(ui.dialog.innerHTML,/Your lamp is ready/);assert.equal(ui.writes.length,1);assert.match(ui.messages.join(' '),/could not remember/);ui.dispose();
});
test('Help offers optional sound steps and center guidance with no hidden lamp commands',()=>{
 const ui=setupFixture({count:1});ui.click('help');assert.match(ui.dialog.innerHTML,/Each lamp can play on its own/);ui.click('guide-center');assert.match(ui.dialog.innerHTML,/blinking white marker/);ui.click('help');ui.click('guide-audio');assert.match(ui.dialog.innerHTML,/No saved audio recordings/);ui.click('guide-audio-next');assert.match(ui.dialog.innerHTML,/usual quiet room/);assert.equal(ui.pairs.length+ui.writes.length,0);ui.dispose();
});
test('preference migration preserves unknown fields and cannot overwrite unreadable records',()=>{
 const value={rooms:{[lamp.id]:'Den'},groups:{future:'Retain group'},theme:'dark',future:{version:8}},ui=fixture(undefined,{preferences:JSON.stringify(value)});
 ui.click('help');ui.element('v2LaterGuides').checked=false;ui.click('guide-preference');const saved=JSON.parse(ui.preferences());assert.deepEqual(saved.future,value.future);assert.deepEqual(saved.rooms,value.rooms);assert.deepEqual(saved.groups,value.groups);ui.dispose();
 for(const raw of ['{malformed',JSON.stringify({future:'x'.repeat(32768)})]){const bad=fixture(undefined,{preferences:raw});bad.click('help');bad.click('guide-preference');assert.equal(bad.preferences(),raw);bad.dispose();}
});
test('lost automatic opt-in reply becomes review-only without replaying the preference',async()=>{
 const ui=setupFixture();ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();ui.element('v2SetupAutomatic').checked=true;
 // The successful adapter is replaced before the next mounted setup run.
 ui.dispose();
 const model=ui.model,preferences=JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:false,secondGroupSeen:false,laterGuides:true,pending:null}}),writes=[];
 const second=fixture(undefined,{model,preferences,api:{pair:async()=>({connected:true,id:lamp.id}),setupDetails:async()=>{},setAutomatic:async(value,id)=>{writes.push([value,id]);throw Object.assign(Error('Lost ACK'),{uncertain:true});}}});
 second.click('guide-add');second.click('setup-next');second.click('pair');await settle();second.click('setup-save');await settle();second.element('v2SetupAutomatic').checked=true;second.click('setup-done');await settle();assert.equal(writes.length,1);assert.match(second.dialog.innerHTML,/Check this lamp/);assert.doesNotMatch(second.dialog.innerHTML,/data-v2="setup-done"/);second.dispose();
});
test('partial group creation routes to existing group review and never repeats creation',async()=>{
 const other={...lamp,id:'112233445566'},model={lamps:[lamp,other],ownedLampIds:[lamp.id,other.id],groups:[],statuses:{},available:[lamp,other].map(entry=>({...entry,verified:true,available:true,role:0})),connected:false};let creations=0,refreshes=0;
 const ui=fixture(undefined,{model,api:{refreshGroups:async()=>{refreshes++;},createGroup:async()=>{creations++;throw Object.assign(Error('Main lamp ready; follower pending'),{uncertain:true});}}});
 ui.click('guide-group');ui.click('create-group');await settle();ui.element('v2GroupName').value='Evening';for(const input of ui.dialog.children)if(input.name==='v2GroupMember')input.checked=true;
 ui.click('create-group-save');await settle();assert.equal(creations,1);assert.match(ui.dialog.innerHTML,/Check my groups/);assert.doesNotMatch(ui.dialog.innerHTML,/data-v2="create-group-save"/);ui.click('group-guide-review');await settle();assert.equal(creations,1);assert.equal(refreshes,2);assert.deepEqual(ui.navigations,[['groups']]);ui.dispose();
});
