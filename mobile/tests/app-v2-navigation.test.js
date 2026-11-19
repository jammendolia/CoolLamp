import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {resolveLampStyle,lampStyleLocked,lampDesignLabel} from '../src/lamp-style.js';
import {OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT} from '../src/onboarding.js';
import {HELP_TOPICS} from '../src/help.js';
import {startGuidedTour} from '../src/guided-tour.js';
import {readHomeContext,buildLightsOverview,automationPresentation} from '../src/ecosystem-foundation.js';
import {buildHomeExperienceProjectionV1} from '../src/home-experience-adapter.js';
import {compilePeopleAccess} from '../src/people-access.js';

// Exercise the mounted UI and its real delegated click handler. The small DOM
// fixture supplies only browser presentation APIs; connection results and time
// are controlled explicitly, without a lamp or a browser process.
const source=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8')
 .replace(/\r\n/g,'\n').replace(/^import .*;$/gm,'').replace(/\bexport /g,'');
const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const startup=mainSource.slice(mainSource.indexOf("\npage('home');"),mainSource.indexOf('\nsetInterval',mainSource.indexOf("\npage('home');")));
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
    this.body=new Element('v2-sheet-body');
    elements.delete('v2DialogStatus');
    elements.delete('v2SetupStyle');
    const statusTag=value.match(/<p\b([^>]*\bid="v2DialogStatus"[^>]*)>/);
    if(statusTag){const status=new Element('v2DialogStatus');for(const [,name,text] of statusTag[1].matchAll(/([\w-]+)="([^"]*)"/g))status.setAttribute(name,text);elements.set('v2DialogStatus',status);}
    for(const tag of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
     const button=new Element();button._html=tag[2];
     for(const attribute of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)){
      const [,name,attributeValue]=attribute;
      if(name.startsWith('data-'))button.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attributeValue;
      else button.setAttribute(name,attributeValue);
     }
     button.disabled=/(?:^|\s)disabled(?:\s|$|=)/.test(tag[1]);button.hidden=/\bhidden\b/.test(tag[1]);this.children.push(button);
    }
    for(const tag of value.matchAll(/<(?:input|select)\b([^>]*)>/g)){
     const id=tag[1].match(/\bid="([^"]+)"/)?.[1],input=id?element(id):new Element();
     input.value=tag[1].match(/\bvalue="([^"]*)"/)?.[1]||'';input.name=tag[1].match(/\bname="([^"]*)"/)?.[1]||'';input.checked=/\bchecked\b/.test(tag[1]);this.children.push(input);
    }
    this.body.children=this.children.filter(child=>child.dataset.v2!=='close');
    }else if(this.id==='v2HomeContent'&&value.includes('v2-home-v1')){
     for(const tag of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
      const button=new Element();button._html=tag[2];
      for(const attribute of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)){
       const [,name,attributeValue]=attribute;
       if(name.startsWith('data-'))button.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attributeValue;
       else button.setAttribute(name,attributeValue);
      }
      button.disabled=/(?:^|\s)disabled(?:\s|$|=)/.test(tag[1]);this.children.push(button);
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
  replaceChildren(){this._html='';this.children=[];this.body=null;if(this.id==='v2Dialog')elements.delete('v2DialogStatus');}
  querySelector(selector){
   if(selector==='.v2-sheet-body')return this.body||null;
   if(selector==='small'){
    if(!this._html.includes('<small>'))return null;
    if(!this.small){this.small=new Element();this.small.textContent=this._html.match(/<small>(.*?)<\/small>/)?.[1]||'';}return this.small;
   }
   if(selector==='[data-v2="select-settings"]')return this.children.find(child=>child.dataset.v2==='select-settings')||null;
   return this.children[0]||null;
  }
  querySelectorAll(selector){return this.children.filter(child=>selector==='[name="v2GroupMember"]:checked'?child.name==='v2GroupMember'&&child.checked:selector==='button,input,select'||selector==='button'||selector==='[data-v2]'||selector.includes(`data-v2="${child.dataset.v2}"`));}
  closest(){return this;}
  contains(value){return this===value||this.children.includes(value);}
  focus(){document.activeElement=this;}
  scrollIntoView(){}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 document={hidden:false,activeElement:null,documentElement:element('root'),body:element('body'),
  getElementById(id){return ['v2DialogStatus','v2SetupStyle'].includes(id)?elements.get(id)||null:element(id);},
  querySelector:()=>element('settings-navigation'),querySelectorAll:()=>[],createElement:()=>new Element(),
  addEventListener(name,callback){const handlers=listeners.get(name)||[];handlers.push(callback);listeners.set(name,handlers);}};
 let preferenceValue=options.preferences??null;
 const context={document,AbortController,DOMException,lampArtworkSvg,resolveLampStyle,lampStyleLocked,lampDesignLabel,OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT,HELP_TOPICS:options.helpTopics||HELP_TOPICS,startGuidedTour:options.startTour||startGuidedTour,readHomeContext,buildLightsOverview,automationPresentation,buildHomeExperienceProjectionV1,compilePeopleAccess,
  localStorage:{getItem:()=>preferenceValue,setItem(key,value){if(options.failStorage)throw Error('Storage full');preferenceValue=value;}},
  setInterval:()=>++nextTimer,clearInterval(){},
  setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const api={model:()=>options.model||({lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false}),
  message:message=>messages.push(message),navigate:(...args)=>navigations.push(args),
  select(id,section,options){selections.push({id,section,options});return select(id,section,options);},...options.api};
 runInNewContext(source+'\nglobalThis.mount=mountAppV2;globalThis.getTourSteps=appTourSteps;',context);
 const ui=context.mount(api),dialog=element('v2Dialog');
 // Match main's initial navigation before offering the one-time guide.
 runInNewContext(startup,{page:name=>ui.navigate(name),appV2:ui});
  return {ui,dialog,messages,navigations,selections,element,tourSteps:context.getTourSteps,preferences:()=>preferenceValue,active:()=>document.activeElement,
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

function redesignedHomeModel({fresh=true,power=true}={}){
 const checkedAt=Date.now();
 return {lamps:[lamp],ownedLampIds:[lamp.id],groups:[],statuses:{[lamp.id]:{
  wifi:{state:'connected',fresh:true,checkedAt},
  lighting:{kind:'effect',power,mode:4,name:'Fire',fresh,checkedAt},
  group:{state:'independent',leader:null,fresh:true,checkedAt}
 }},connected:false,connecting:false};
}

const peopleState=(state='not-configured',extra={})=>({version:1,state,home:{id:null,name:'Primary home'},viewer:null,people:[],invitations:[],pendingTargets:[],activity:null,...extra});

test('People and access is a Settings destination with visible checking and no unsupported invitation action',()=>{
 const model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:peopleState('checking')},refreshes=[];
 const ui=fixture(undefined,{model,api:{refreshPeopleAccess:()=>refreshes.push(true)}});ui.ui.navigate('people-access');
 assert.match(ui.element('v2PeopleAccessContent').innerHTML,/Checking people and access/);assert.match(ui.element('v2PeopleAccessContent').innerHTML,/aria-busy="true"/);assert.doesNotMatch(ui.element('v2PeopleAccessContent').innerHTML,/Invite someone/);
 ui.click('people-access-retry');assert.equal(refreshes.length,1);
 model.peopleAccess=peopleState();ui.ui.refresh(true);assert.match(ui.element('v2PeopleAccessContent').innerHTML,/Sharing is not set up yet/);assert.doesNotMatch(ui.element('v2PeopleAccessContent').innerHTML,/Set up sharing|data-v2="people-invite"/);ui.dispose();
});

test('People and access escapes names and keeps phone details behind the person row',()=>{
 const personId='5'.repeat(32),phoneId='1'.repeat(32),homeId='4'.repeat(32),model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:{version:1,state:'ready',home:{id:homeId,name:'Primary <home>'},viewer:{personId,installationId:phoneId,canManagePeople:true},people:[{id:personId,name:'Joe <owner>',role:'owner',status:'active',expiresAt:null,scope:{kind:'home',targetNames:[]},phones:[{id:phoneId,name:'This <phone>',status:'active'}]}],invitations:[],pendingTargets:[],activity:null}};
 const ui=fixture(undefined,{model});ui.ui.navigate('people-access');const overview=ui.element('v2PeopleAccessContent').innerHTML;
 assert.match(overview,/Joe &lt;owner&gt; · You/);assert.doesNotMatch(overview,/This &lt;phone&gt;/);assert.doesNotMatch(overview,/<owner>|<home>/);
 ui.click('people-person',{personId});assert.match(ui.dialog.innerHTML,/This &lt;phone&gt;/);assert.doesNotMatch(ui.dialog.innerHTML,/people-remove-person|people-remove-phone/);ui.dispose();
});

test('People and access keeps stale people visible, names unfinished lights, and offers no write controls',()=>{
 const personId='5'.repeat(32),phoneId='1'.repeat(32),otherId='6'.repeat(32),otherPhone='7'.repeat(32),homeId='4'.repeat(32);
 const model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:{version:1,state:'unavailable',home:{id:homeId,name:'Primary home'},viewer:{personId,installationId:phoneId,canManagePeople:true},people:[{id:personId,name:'Joe',role:'owner',status:'active',expiresAt:null,scope:{kind:'home',targetNames:[]},phones:[{id:phoneId,name:'This phone',status:'active'}]},{id:otherId,name:'Lisa',role:'member',status:'active',expiresAt:null,scope:{kind:'home',targetNames:[]},phones:[{id:otherPhone,name:"Lisa's phone",status:'active'}]}],invitations:[],pendingTargets:[{id:'a10000000002',name:'Edison',outcome:'unavailable'}],activity:null}};
 const ui=fixture(undefined,{model,api:{issueHomeInvitation(){},removeHomePhone(){},removeHomePerson(){}}});ui.ui.navigate('people-access');const html=ui.element('v2PeopleAccessContent').innerHTML;
 assert.match(html,/Lisa/);assert.match(html,/Edison still needs the access update/);assert.doesNotMatch(html,/people-invite|people-remove/);ui.dispose();
});

test('a rejected light access update opens the product list for power and connection recovery',()=>{
 const personId='5'.repeat(32),phoneId='1'.repeat(32),homeId='4'.repeat(32);
 const model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:{version:1,state:'ready',home:{id:homeId,name:'Primary home'},viewer:{personId,installationId:phoneId,canManagePeople:true},people:[{id:personId,name:'Joe',role:'owner',status:'active',expiresAt:null,scope:{kind:'home',targetNames:[]},phones:[{id:phoneId,name:'This phone',status:'active'}]}],invitations:[],pendingTargets:[{id:'a10000000002',name:'Edison',outcome:'rejected'}],activity:null}};
 const ui=fixture(undefined,{model});ui.ui.navigate('people-access');const html=ui.element('v2PeopleAccessContent').innerHTML;assert.match(html,/check its power and connection/);assert.match(html,/data-v2="people-access-devices"/);
 ui.click('people-access-devices');assert.deepEqual(ui.navigations.at(-1),['lamps']);ui.dispose();
});

test('People and access shows identity recovery guidance without an ineffective retry',()=>{
 const model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:peopleState('recovery-required')};
 const ui=fixture(undefined,{model});ui.ui.navigate('people-access');const html=ui.element('v2PeopleAccessContent').innerHTML;
 assert.match(html,/phone needs to be added again/);assert.match(html,/reinstall CoolLamp/);assert.doesNotMatch(html,/people-access-retry/);ui.dispose();
});

test('People and access asks for owner help without presenting a retry when retry cannot help',()=>{
 const model={lamps:[],groups:[],statuses:{},connected:false,connecting:false,peopleAccess:peopleState('owner-help-required')};
 const ui=fixture(undefined,{model});ui.ui.navigate('people-access');const html=ui.element('v2PeopleAccessContent').innerHTML;
 assert.match(html,/access needs attention/);assert.match(html,/Home owner/);assert.doesNotMatch(html,/people-access-retry/);ui.dispose();
});

test('the default-off gate preserves the released Home while Home v1 removes marketing and account-status noise',()=>{
 const released=fixture(undefined,{model:redesignedHomeModel()});assert.match(released.element('v2HomeContent').innerHTML,/A softer/);released.dispose();
 const redesigned=fixture(undefined,{model:redesignedHomeModel(),api:{experience:'home-v1'}}),html=redesigned.element('v2HomeContent').innerHTML;
 assert.match(html,/New reading lamp/);assert.match(html,/Bedroom · On · Fire/);assert.match(html,/data-v2="home-power"/);
 assert.doesNotMatch(html,/A softer|permitted lights|This phone can control|Works locally|Remote access ready|Gift readiness|home-review-required/i);
 assert.equal(redesigned.element('v2HomeSubtitle').textContent,'MY HOME');redesigned.dispose();
});

test('Automations visibly checks on entry and keeps the first schedule slice read-only',()=>{
 const calls=[],model={lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false,automations:{version:1,state:'idle',lastUpdatedAt:null,schedules:[]}};
 const ui=fixture(undefined,{api:{model:()=>model,refreshAutomations(){calls.push('refresh');model.automations={version:1,state:'checking',lastUpdatedAt:null,schedules:[]};},cancelAutomationRefresh(){calls.push('cancel');}}});
 ui.ui.navigate('automations');let html=ui.element('v2AutomationsContent').innerHTML;
 assert.equal(calls.filter(value=>value==='refresh').length,1);assert.match(html,/Checking schedules/);assert.match(html,/v2-automation-spinner/);assert.match(html,/role="status"/);assert.match(html,/aria-busy="true"/);
 assert.doesNotMatch(html,/New automation|RUNS AT HOME|home controller|local schedule|last run/i);
 model.automations={version:1,state:'ready',lastUpdatedAt:123,schedules:[{id:'coolstrip-sunset-midnight',name:'Window display',state:'on',enabled:true,nextEvent:{action:'turn-on',when:{kind:'clock',value:'17:33'}}}]};ui.ui.refresh(true);html=ui.element('v2AutomationsContent').innerHTML;
 assert.match(html,/UP NEXT/);assert.match(html,/Window display turns on at 5:33 PM/);assert.match(html,/Every day · Sunset to midnight/);assert.doesNotMatch(html,/completed|current power|last ran/i);ui.dispose();
});

test('Automations failures offer a useful next action without technical details',()=>{
 const calls=[],model={lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false,automations:{version:1,state:'unreachable',reasonCode:'unreachable',lastUpdatedAt:123,schedules:[{id:'coolstrip-sunset-midnight',name:'Window display',state:'on',nextEvent:{action:'turn-off',when:{kind:'midnight'}}}]}};
 const ui=fixture(undefined,{api:{model:()=>model,refreshAutomations(){calls.push('retry');},cancelAutomationRefresh(){},navigate:(...args)=>calls.push(args)}});ui.ui.refresh(true);
 let html=ui.element('v2AutomationsContent').innerHTML;assert.match(html,/Schedules couldn’t be refreshed/);assert.match(html,/Try again/);assert.match(html,/still listed/);assert.match(html,/Last checked/);assert.doesNotMatch(html,/UP NEXT|\bIP\b|password|bridge|coordinator|endpoint|transport/i);
 ui.click('retry-automations');assert.equal(calls.at(-1),'retry');
 model.automations={version:1,state:'attention',reasonCode:'access-needed',lastUpdatedAt:null,schedules:[]};ui.ui.refresh(true);html=ui.element('v2AutomationsContent').innerHTML;assert.match(html,/Open Settings/);ui.click('automation-recovery');assert.deepEqual(calls.at(-1),['bridges']);ui.dispose();
});

test('schedule attention gives distinct location and saved-data recovery guidance',()=>{
 const model={lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false,automations:{version:1,state:'ready',lastUpdatedAt:123,schedules:[{id:'night',name:'Window display',state:'attention',reasonCode:'home-location-needed',primaryAction:'set-home-location'}]}},ui=fixture(undefined,{api:{model:()=>model,refreshAutomations(){},cancelAutomationRefresh(){}}});ui.ui.refresh(true);
 let html=ui.element('v2AutomationsContent').innerHTML;assert.match(html,/Home location is needed/);assert.match(html,/Set up location/);ui.click('automation-location-help');assert.match(ui.dialog.innerHTML,/Sunset schedules need your Home’s location/);assert.match(ui.dialog.innerHTML,/existing schedule was not changed/);ui.click('close');
 model.automations={version:1,state:'ready',lastUpdatedAt:123,schedules:[{id:'night',name:'Window display',state:'attention',reasonCode:'saved-schedule-needs-recovery',primaryAction:'view-recovery'}]};ui.ui.refresh(true);html=ui.element('v2AutomationsContent').innerHTML;assert.match(html,/View recovery/);ui.click('automation-storage-help');assert.match(ui.dialog.innerHTML,/saved schedule could not be read safely/);assert.doesNotMatch(ui.dialog.innerHTML,/location/i);ui.dispose();
});

test('Home v1 shows target-local progress, blocks duplicate taps, and claims success only from a confirmed outcome',async()=>{
 const gate=deferred(),calls=[];let progress;
 const ui=fixture(undefined,{model:redesignedHomeModel(),api:{experience:'home-v1',power:(target,options)=>{calls.push(target);progress=options.onProgress;return gate.promise;}}});
 ui.click('home-power',{id:lamp.id,homeKind:'device'});assert.match(ui.element('v2HomeContent').innerHTML,/Connecting to New reading lamp/);
 ui.click('home-power',{id:lamp.id,homeKind:'device'});assert.equal(calls.length,1);assert.equal(calls[0].homeId,'local-home');assert.equal(calls[0].deviceId,lamp.id);assert.equal(calls[0].mode,'change');
 progress('sending');assert.match(ui.element('v2HomeContent').innerHTML,/Turning New reading lamp off/);
 progress('checking');assert.match(ui.element('v2HomeContent').innerHTML,/Checking the change on New reading lamp/);
 gate.resolve({outcome:'confirmed',power:false,changed:true});await settle();assert.match(ui.element('v2HomeContent').innerHTML,/New reading lamp is now off/);ui.dispose();
});

test('Home v1 uncertainty keeps last-confirmed state and Check current state is read-only',async()=>{
 const requests=[],ui=fixture(undefined,{model:redesignedHomeModel(),api:{experience:'home-v1',power:async target=>{
  requests.push(target);return requests.length===1?{outcome:'uncertain'}:{outcome:'confirmed',power:false,refreshed:true};
 }}});
 ui.click('home-power',{id:lamp.id,homeKind:'device'});await settle();let html=ui.element('v2HomeContent').innerHTML;
 assert.match(html,/may have changed/);assert.match(html,/Last confirmed: On/);assert.match(html,/Check current state/);assert.match(html,/data-v2="home-power"[^>]*aria-disabled="true"/);assert.equal(requests.length,1);
 ui.click('home-power',{id:lamp.id,homeKind:'device'});await settle();assert.equal(requests.length,1);
 ui.click('home-check',{id:lamp.id,homeKind:'device'});await settle();html=ui.element('v2HomeContent').innerHTML;
 assert.equal(requests.length,2);assert.equal(requests[1].mode,'check');assert.match(html,/New reading lamp is off/);ui.dispose();
});

test('Home v1 stale power offers a read-only check instead of inferring a toggle',async()=>{
 const requests=[],ui=fixture(undefined,{model:redesignedHomeModel({fresh:false}),api:{experience:'home-v1',power:async target=>{requests.push(target);return {outcome:'confirmed',power:true,refreshed:true};}}});
 const html=ui.element('v2HomeContent').innerHTML;assert.match(html,/Last confirmed on/);assert.match(html,/data-v2="home-check"/);assert.doesNotMatch(html,/data-v2="home-power"/);
 ui.click('home-check',{id:lamp.id,homeKind:'device'});await settle();assert.equal(requests[0].mode,'check');ui.dispose();
});

test('Home v1 safe failure recovery stays read-only instead of becoming a power toggle',async()=>{
 const requests=[],ui=fixture(undefined,{model:redesignedHomeModel({fresh:false}),api:{experience:'home-v1',power:async target=>{
  requests.push(target);return requests.length===1?{outcome:'failed',safeToRetry:true,message:'We could not check this light. No change was sent.'}:{outcome:'confirmed',power:true,refreshed:true};
 }}});
 ui.click('home-check',{id:lamp.id,homeKind:'device'});await settle();let html=ui.element('v2HomeContent').innerHTML;
 assert.match(html,/No change was sent/);assert.match(html,/Check current state/);assert.doesNotMatch(html,/data-v2="home-power"/);
 ui.click('home-check',{id:lamp.id,homeKind:'device'});await settle();assert.deepEqual(requests.map(request=>request.mode),['check','check']);ui.dispose();
});

test('Home v1 reports a state refresh without claiming that it changed the light',async()=>{
 const ui=fixture(undefined,{model:redesignedHomeModel(),api:{experience:'home-v1',power:async()=>({outcome:'confirmed',power:true,refreshed:true})}});
 ui.click('home-power',{id:lamp.id,homeKind:'device'});await settle();const html=ui.element('v2HomeContent').innerHTML;
 assert.match(html,/Current state: New reading lamp is on\. No change was sent\./);assert.doesNotMatch(html,/is now on/);ui.dispose();
});

test('Home v1 keeps focus on the same light when Check becomes Power',async()=>{
 const model=redesignedHomeModel({fresh:false}),ui=fixture(undefined,{api:{experience:'home-v1',model:()=>model,power:async()=>{
  model.statuses[lamp.id].lighting.fresh=true;model.statuses[lamp.id].lighting.checkedAt=Date.now();return {outcome:'confirmed',power:true,refreshed:true};
 }}}),check=ui.element('v2HomeContent').children.find(button=>button.dataset.v2==='home-check'&&button.dataset.id===lamp.id);
 assert(check);check.focus();ui.click('home-check',{id:lamp.id,homeKind:'device'});await settle();
 assert.equal(ui.active()?.dataset.v2,'home-power');assert.equal(ui.active()?.dataset.id,lamp.id);ui.dispose();
});

test('Home v1 projects only saved Home members, not nearby discovery results',()=>{
 const discovered={id:'112233445566',name:'Nearby lamp',room:'Porch'},model=redesignedHomeModel(),checkedAt=Date.now();
 model.lamps.push(discovered);model.statuses[discovered.id]={wifi:{state:'connected',fresh:true,checkedAt},lighting:{kind:'effect',power:true,mode:1,name:'Rain',fresh:true,checkedAt},group:{state:'independent',leader:null,fresh:true,checkedAt}};
 const ui=fixture(undefined,{model,api:{experience:'home-v1'}}),html=ui.element('v2HomeContent').innerHTML;
 assert.match(html,/New reading lamp/);assert.doesNotMatch(html,/Nearby lamp/);ui.dispose();
});

test('Home v1 keeps one concise separate-light notice and gives accurate group participation counts',()=>{
 const checkedAt=Date.now(),second={id:'112233445566',name:'Edison',room:'Living room'},third={id:'223344556677',name:'Shelf lamp',room:'Den'};
 const memberStatus=(state,leader)=>({wifi:{state:'connected',fresh:true,checkedAt},lighting:{kind:state==='leader'?'group':'effect',power:true,mode:4,name:'Fire',fresh:true,checkedAt},group:{state,leader,active:state==='leader',paused:state==='follower',fresh:true,checkedAt}});
 const model={lamps:[lamp,second,third],ownedLampIds:[lamp.id,second.id,third.id],groups:[{id:lamp.id,name:'Evening lights',leader:{id:lamp.id,verified:true,checkedAt,role:1,sync:{role:1,active:true,paused:false}},followers:[second,third].map(value=>({id:value.id,verified:true,checkedAt,role:2,sync:{role:2,active:false,paused:true}}))}],statuses:{[lamp.id]:memberStatus('leader',lamp.id),[second.id]:memberStatus('follower',lamp.id),[third.id]:memberStatus('follower',lamp.id)},connected:false,connecting:false};
 const ui=fixture(undefined,{model,api:{experience:'home-v1'}}),html=ui.element('v2HomeContent').innerHTML;
 assert.equal((html.match(/class="v2-home-v1-attention"/g)||[]).length,1);assert.match(html,/Edison is playing separately/);assert.match(html,/Open Evening lights to return/);
 assert.match(html,/1 playing · 2 separate/);assert.match(html,/Shelf lamp/);assert.match(html,/Playing separately/);
 assert.equal((html.match(/data-v2="home-power"/g)||[]).length,1);ui.dispose();
});

test('Home v1 leaves bridges off the daily lighting surface and suppresses unrecognized product controls',()=>{
 const checkedAt=Date.now(),requests=[],bridge={id:'112233445566',name:'Home hub',productKind:'bridge',capabilities:{power:true}},unknown={id:'223344556677',name:'Mystery controller',productKind:'coolstrip-controllre',capabilities:{power:true}};
 const model={lamps:[bridge,unknown],ownedLampIds:[bridge.id,unknown.id],groups:[],statuses:{},connected:false,connecting:false};
 for(const row of [bridge,unknown])model.statuses[row.id]={wifi:{state:'connected',fresh:true,checkedAt},lighting:{kind:'effect',power:true,mode:1,name:'Rain',fresh:true,checkedAt},group:{state:'independent',leader:null,fresh:true,checkedAt}};
 const ui=fixture(undefined,{model,api:{experience:'home-v1',power:async request=>requests.push(request)}}),html=ui.element('v2HomeContent').innerHTML;
 assert.doesNotMatch(html,/Home hub/);assert.match(html,/Mystery controller/);assert.doesNotMatch(html,/data-v2="home-power"/);
 ui.click('home-power',{id:bridge.id,homeKind:'device'});ui.click('home-power',{id:unknown.id,homeKind:'device'});assert.equal(requests.length,0);ui.dispose();
});

test('Home v1 command admission rejects hidden group and conflicting-capability mutations',()=>{
 const checkedAt=Date.now(),requests=[],conflict={...lamp,capabilities:{power:true}},duplicate={...lamp,capabilities:{power:false}},model={lamps:[conflict,duplicate],ownedLampIds:[lamp.id],groups:[],statuses:{[lamp.id]:{wifi:{state:'connected',fresh:true,checkedAt},lighting:{kind:'effect',power:true,mode:4,name:'Fire',fresh:true,checkedAt},group:{state:'independent',leader:null,fresh:true,checkedAt}}},connected:false,connecting:false};
 const ui=fixture(undefined,{model,api:{experience:'home-v1',power:async request=>requests.push(request)}}),html=ui.element('v2HomeContent').innerHTML;
 assert.doesNotMatch(html,/data-v2="home-power"/);assert.match(html,/data-v2="home-check"/);
 ui.click('home-power',{id:lamp.id,homeKind:'device'});ui.click('home-power',{id:lamp.id,homeKind:'group'});assert.equal(requests.length,0);ui.dispose();
});

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

function setupFixture({count=0,error,gate,automaticGate,detailsGate,automatic=false,failStorage=false,offer=false,factoryStyle=null}={}){
 const other={id:'112233445566',name:'First lamp'},model={lamps:count?[other]:[],ownedLampIds:count?[other.id]:[],groups:[],statuses:{},selected:null,connected:false,selectedAutomatic:automatic};
 const writes=[],pairs=[],api={pair:async()=>{pairs.push(true);if(gate)await gate.promise;model.lamps.push(lamp);model.ownedLampIds.push(lamp.id);model.selected={...lamp,lampStyle:factoryStyle||{id:'future-design'}};model.connected=true;return {connected:true,id:lamp.id};},setupDetails:async value=>{writes.push(['details',value]);if(detailsGate)await detailsGate.promise;if(error)throw error;},setAutomatic:async(...values)=>{writes.push(['automatic',...values]);if(automaticGate)await automaticGate.promise;}};
 const ui=fixture(undefined,{model,api,failStorage});if(!count&&!offer)ui.click('welcome-skip');return {...ui,model,writes,pairs};
}
test('genuinely fresh first-use opens guide once and never pairs or mutates without a button',()=>{
 const ui=setupFixture({offer:true});assert.equal(ui.dialog.open,true);assert.match(ui.dialog.innerHTML,/Show me around/);assert.match(ui.dialog.innerHTML,/Skip tour and set up my lamp/);assert.equal(ui.pairs.length+ui.writes.length,0);
 ui.ui.startWelcome();assert.equal(ui.dialog.open,true);assert.match(ui.dialog.innerHTML,/Show me around/);
 const saved=ui.preferences();ui.click('close');assert.equal(ui.dialog.open,false);ui.dispose();
 const reload=fixture(undefined,{model:{lamps:[],ownedLampIds:[],groups:[],statuses:{},connected:false},preferences:saved});assert.equal(reload.dialog.open,false);reload.dispose();
});
test('confirmed setup keeps future design, persists guide and preserves existing automatic opt-in',async()=>{
 const ui=setupFixture({automatic:true});ui.click('setup-next');ui.click('pair');await settle();assert.match(ui.dialog.innerHTML,/Keep this lamp’s current design/);
 ui.click('setup-save');await settle();assert.equal(ui.writes[0][1].style,'future-design');assert.equal(ui.element('v2SetupAutomatic').checked,true);
 ui.click('setup-done');await settle();assert.equal(ui.writes.length,1);assert.equal(JSON.parse(ui.preferences()).onboarding.firstComplete,true);assert.equal(ui.dialog.open,false);ui.dispose();
});

test('first-lamp guide displays its factory model read-only and saves name and room without a style request',async()=>{
 const factoryStyle={version:1,code:0,id:'unspecified',family:'unspecified',locked:true,factoryStyle:'future-coil',model:{version:1,id:'future-coil-2070',displayName:'Future Coil',artworkFamily:'future-art',hardwareRevision:'rev-z',preconfigured:true}};
 const ui=setupFixture({factoryStyle});ui.click('setup-next');ui.click('pair');await settle();
 assert.match(ui.dialog.innerHTML,/Lamp design: Future Coil/);assert.match(ui.dialog.innerHTML,/set at the factory/);assert.doesNotMatch(ui.dialog.innerHTML,/id="v2SetupStyle"/);
 ui.click('setup-save');await settle();assert.equal(ui.writes.length,1);assert.equal(ui.writes[0][1].style,null);assert.equal(ui.writes[0][1].id,lamp.id);assert.match(ui.dialog.innerHTML,/Your lamp is ready/);ui.dispose();
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
 assert.match(ui.status(),/Some choices may already be saved/);assert.equal(ui.dialog.innerHTML.includes('id="v2SetupStyle"'),false);
 const saved=ui.preferences(),model=ui.model;ui.dispose();const replay=[];const reload=fixture(undefined,{model,preferences:saved,api:{pair:async()=>replay.push('pair'),setupDetails:async()=>replay.push('write')}});reload.click('add');assert.match(reload.dialog.innerHTML,/Check this lamp/);assert.equal(replay.length,0);reload.dispose();
});
test('late pairing cannot advance the guide after navigation',async()=>{
 const gate=deferred(),ui=setupFixture({gate});ui.click('setup-next');ui.click('pair');await settle();ui.ui.navigate('lamps');gate.resolve();await settle();assert.doesNotMatch(ui.dialog.innerHTML,/Make it yours/);assert.equal(ui.writes.length,0);assert.equal(JSON.parse(ui.preferences()).onboarding.pending,null);ui.dispose();
});
test('full local storage never changes a successful lamp save into a failed mutation',async()=>{
 const ui=setupFixture({failStorage:true});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();assert.match(ui.dialog.innerHTML,/Your lamp is ready/);assert.equal(ui.writes.length,1);assert.match(ui.messages.join(' '),/could not remember/);ui.dispose();
});
test('Help offers optional sound steps and center guidance with no hidden lamp commands',()=>{
 const ui=setupFixture({count:1});ui.click('help');assert.deepEqual(ui.navigations,[['help']]);ui.ui.navigate('help');assert.equal(ui.dialog.open,false);assert.match(ui.element('v2HelpContent').innerHTML,/v2-help-topic/);ui.click('guide-center');assert.match(ui.dialog.innerHTML,/blinking white marker/);ui.click('help');ui.ui.navigate('help');ui.click('help-action',{helpAction:'audio-guide'});assert.match(ui.dialog.innerHTML,/No saved audio recordings/);ui.click('guide-audio-next');assert.match(ui.dialog.innerHTML,/usual quiet room/);assert.equal(ui.pairs.length+ui.writes.length,0);ui.dispose();
});
test('preference migration preserves unknown fields and cannot overwrite unreadable records',()=>{
 const value={rooms:{[lamp.id]:'Den'},groups:{future:'Retain group'},theme:'dark',future:{version:8}},ui=fixture(undefined,{preferences:JSON.stringify(value)});
 ui.click('help');ui.ui.navigate('help');ui.element('v2LaterGuides').checked=false;ui.click('guide-preference');const saved=JSON.parse(ui.preferences());assert.deepEqual(saved.future,value.future);assert.deepEqual(saved.rooms,value.rooms);assert.deepEqual(saved.groups,value.groups);ui.dispose();
 for(const raw of ['{malformed',JSON.stringify({future:'x'.repeat(32768)})]){const bad=fixture(undefined,{preferences:raw});bad.click('help');bad.ui.navigate('help');bad.click('guide-preference');assert.equal(bad.preferences(),raw);bad.dispose();}
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

function assertWorking(ui,key,message){
 const status=ui.element('v2DialogStatus'),body=ui.dialog.querySelector('.v2-sheet-body');
 assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.dataset.operationLoading,'true');assert.equal(ui.dialog.dataset.operation,key);
 assert.equal(status.dataset.state,'working');assert.equal(status.dataset.operation,key);assert.match(status.textContent,message);
 assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-live'),'polite');assert.equal(status.getAttribute('aria-atomic'),'true');
 assert.notEqual(ui.dialog.getAttribute('aria-busy'),'true');assert.equal(body.getAttribute('aria-busy'),'true');assert.equal(body.contains(status),false);
 assert(ui.dialog.querySelectorAll('button,input,select').every(control=>control.disabled));
}
function assertWorkCleared(ui){
 assert.equal(ui.dialog.dataset.operationLoading,undefined);assert.equal(ui.dialog.dataset.operation,undefined);
 assert.notEqual(ui.element('v2DialogStatus').dataset.state,'working');
 assert.notEqual(ui.dialog.querySelector('.v2-sheet-body')?.getAttribute('aria-busy'),'true');
}

test('wizard pairing visibly starts before the native call and duplicate/Back/Close taps send no second command',async()=>{
 const gate=deferred(),ui=setupFixture({gate});ui.click('setup-next');ui.click('pair');
 assert.equal(ui.pairs.length,1);assertWorking(ui,'pairing',/Connecting to your lamp/);
 ui.click('pair');ui.click('setup-back');ui.click('close');assert.equal(ui.cancel(),true);assert.equal(ui.pairs.length,1);
 await settle();assertWorking(ui,'pairing',/Connecting to your lamp/);
 gate.resolve();await settle();assert.match(ui.dialog.innerHTML,/Make it yours/);assertWorkCleared(ui);
 assert.equal(ui.dialog.children.find(button=>button.dataset.v2==='setup-save').disabled,false);assert.equal(ui.writes.length,0);ui.dispose();
});

test('actual wizard save forwards presentation-only stage callbacks and retains busy ownership through each delayed stage',async()=>{
 const detailsGate=deferred(),ui=setupFixture({detailsGate});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');
 assert.equal(ui.writes.length,1);assertWorking(ui,'saving-details',/Saving your lamp’s name and design/);
 const progress=ui.writes[0][1].onProgress;assert.equal(typeof progress,'function');
 for(const [key,message]of [['saving-name',/name/],['saving-style',/design/],['saving-room',/room/]]){progress(key);assertWorking(ui,key,message);}
 const previous=ui.status();progress('<script>guess-a-wire-command</script>');assert.equal(ui.status(),previous);
 ui.click('setup-save');assert.equal(ui.writes.length,1);
 detailsGate.resolve();await settle();assert.match(ui.dialog.innerHTML,/Your lamp is ready/);assertWorkCleared(ui);assert.equal(ui.writes.length,1);ui.dispose();
});

test('unconfirmed delayed setup save clears its indicator and permits review only, without resending any settings',async()=>{
 const detailsGate=deferred(),ui=setupFixture({detailsGate});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');
 assertWorking(ui,'saving-details',/Saving/);detailsGate.reject(Object.assign(Error('Reply was lost after name save'),{uncertain:true}));await settle();
 assertWorkCleared(ui);assert.equal(ui.element('v2DialogStatus').dataset.state,'error');assert.match(ui.status(),/Some choices may already be saved/);
 assert.match(ui.dialog.innerHTML,/Check this lamp/);assert.doesNotMatch(ui.dialog.innerHTML,/data-v2="setup-save"/);
 assert(ui.dialog.querySelectorAll('button,input,select').every(control=>!control.disabled));
 ui.click('setup-save');await settle();assert.equal(ui.writes.length,1);assert.equal(JSON.parse(ui.preferences()).onboarding.pending.needsReview,true);ui.dispose();
});

test('update preference save immediately explains its work and duplicate finish taps do not repeat opt-in',async()=>{
 const automaticGate=deferred(),ui=setupFixture({automaticGate});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');await settle();
 ui.element('v2SetupAutomatic').checked=true;ui.click('setup-done');assertWorking(ui,'saving-preference',/Saving your update preference/);
 ui.click('setup-done');ui.click('setup-wifi');assert.equal(ui.writes.filter(row=>row[0]==='automatic').length,1);
 automaticGate.resolve();await settle();assert.equal(ui.dialog.open,false);assertWorkCleared(ui);assert.deepEqual(ui.navigations,[['effects','lighting']]);ui.dispose();
});

test('native pairing cancellation clears progress and gives a calm explicit result without claiming ownership',async()=>{
 const gate=deferred(),ui=setupFixture({gate});ui.click('setup-next');ui.click('pair');assertWorking(ui,'pairing',/Connecting/);
 gate.reject(Object.assign(Error('Native picker cancelled'),{cancelled:true}));await settle();assertWorkCleared(ui);
 assert.match(ui.status(),/Setup paused/);assert.equal(ui.model.ownedLampIds.length,0);assert.equal(ui.writes.length,0);
 assert.equal(ui.dialog.children.find(button=>button.dataset.v2==='pair').disabled,false);ui.dispose();
});

test('navigation fences old save stage callbacks/errors and clears old controls without altering a new chooser',async()=>{
 const detailsGate=deferred(),ui=setupFixture({detailsGate});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');
 const progress=ui.writes[0][1].onProgress;assertWorking(ui,'saving-details',/Saving/);
 ui.ui.navigate('lamps');ui.ui.chooseLight('overview');assertWorkCleared(ui);assert.equal(ui.status(),'');
 progress('saving-style');detailsGate.reject(Object.assign(Error('Old save reply missing'),{uncertain:true}));await settle();
 assert.equal(ui.status(),'');assert.equal(ui.dialog.children.find(button=>button.dataset.v2==='select-settings').disabled,false);
 assert.equal(ui.writes.length,1);assert(!ui.messages.some(message=>/Some choices may already/.test(message)));ui.dispose();
});

test('a changed selected target fences save-stage updates and cannot advance the original wizard',async()=>{
 const detailsGate=deferred(),ui=setupFixture({detailsGate});ui.click('setup-next');ui.click('pair');await settle();ui.click('setup-save');
 const progress=ui.writes[0][1].onProgress;ui.model.selected={...lamp,id:'112233445566',name:'Another lamp'};progress('saving-style');
 assertWorking(ui,'saving-details',/name and design/);detailsGate.resolve();await settle();assertWorkCleared(ui);
 assert.doesNotMatch(ui.dialog.innerHTML,/Your lamp is ready/);assert.equal(ui.navigations.length,0);assert.equal(ui.writes.length,1);ui.dispose();
});

for(const failed of [false,true])test('home discovery has visible work before its API call, bounded by completion '+(failed?'failure':'success'),async()=>{
 const gate=deferred();let calls=0,ui;
 ui=fixture(undefined,{api:{discover:async()=>{++calls;assertWorking(ui,'finding-lamps',/Looking for your lamps/);await gate.promise;}}});
 ui.click('discover');assertWorking(ui,'finding-lamps',/Looking for your lamps/);ui.click('discover');assert.equal(calls,1);
 if(failed)gate.reject(Error('No response from discovery'));else gate.resolve();await settle();assertWorkCleared(ui);
 if(failed){assert.equal(ui.dialog.open,true);assert.match(ui.status(),/No response/);assert.equal(ui.dialog.children.find(button=>button.dataset.v2==='discover').disabled,false);}
 else{assert.equal(ui.dialog.open,false);assert.deepEqual(ui.navigations,[['lights']]);}
 ui.dispose();
});

test('group wizard scanning/joining use real visible stages and a partial result exposes review without recreating',async()=>{
 const other={...lamp,id:'112233445566'},model={lamps:[lamp,other],ownedLampIds:[lamp.id,other.id],groups:[],statuses:{},available:[lamp,other].map(entry=>({...entry,verified:true,available:true,role:0})),connected:false};
 const finding=deferred(),creating=deferred();let checks=0,creations=0,progress;
 const ui=fixture(undefined,{model,api:{refreshGroups:async()=>{++checks;if(checks===1)await finding.promise;},createGroup:async(_ids,options)=>{++creations;progress=options.onProgress;await creating.promise;}}});
 ui.click('guide-group');ui.click('create-group');assertWorking(ui,'checking-groups',/Checking which lamps/);ui.click('create-group');assert.equal(checks,1);
 finding.resolve();await settle();assertWorkCleared(ui);ui.element('v2GroupName').value='Evening';for(const input of ui.dialog.children)if(input.name==='v2GroupMember')input.checked=true;
 ui.click('create-group-save');assertWorking(ui,'creating-group',/Connecting your group/);progress('joining-group');assertWorking(ui,'joining-group',/Adding lamps/);
 progress('checking-group');assertWorking(ui,'checking-group',/Checking your group/);ui.click('create-group-save');assert.equal(creations,1);
 creating.reject(Object.assign(Error('Follower has not confirmed'),{uncertain:true}));await settle();assertWorkCleared(ui);
 assert.match(ui.dialog.innerHTML,/Check my groups/);assert.doesNotMatch(ui.dialog.innerHTML,/data-v2="create-group-save"/);
 ui.click('group-guide-review');await settle();assert.equal(creations,1);assert.equal(checks,2);assert.deepEqual(ui.navigations,[['groups']]);ui.dispose();
});

test('destroy clears wizard work and fences late failures and delegated clicks from the old mounted UI',async()=>{
 const gate=deferred(),ui=setupFixture({gate});ui.click('setup-next');ui.click('pair');assertWorking(ui,'pairing',/Connecting/);ui.dispose();
 assertWorkCleared(ui);ui.click('pair');gate.reject(Error('Old callback'));await settle();assert.equal(ui.pairs.length,1);assert.equal(ui.messages.length,0);
});

test('Help opens without a lamp, a connection attempt, a setup mutation or a changed guide preference',()=>{
 const ui=fixture(undefined,{model:{lamps:[],groups:[],statuses:{},ownedLampIds:[],connected:false},preferences:JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:false,laterGuides:true},future:{keep:1}})}),before=ui.preferences();
 ui.click('help');assert.deepEqual(ui.navigations,[['help']]);ui.ui.navigate('help');
 assert.equal(ui.dialog.open,false);assert.equal(ui.selections.length,0);assert.equal(ui.preferences(),before);
 const html=ui.element('v2HelpContent').innerHTML;assert.equal((html.match(/class="v2-help-topic"/g)||[]).length,HELP_TOPICS.length);
 assert.match(html,/<details/);assert.match(html,/<summary/);assert.match(html,/role="status" aria-live="polite"/);assert.equal(ui.element('body').dataset.v2Page,'help');
 ui.dispose();
});

test('Help actions only open known destinations and audio guidance never starts a lamp operation',()=>{
 const ui=setupFixture({count:1});ui.ui.navigate('help');ui.click('help-action',{helpAction:'install-now'});assert.equal(ui.navigations.length,0);assert.equal(ui.pairs.length+ui.writes.length,0);
 ui.click('help-action',{helpAction:'audio-guide'});assert.match(ui.dialog.innerHTML,/Optional sound guide/);assert.equal(ui.pairs.length+ui.writes.length,0);
 ui.click('help');assert.equal(ui.navigations.at(-1)[0],'help');ui.ui.navigate('help');ui.click('help-action',{helpAction:'settings'});assert.equal(ui.navigations.at(-1)[0],'app-settings');
 ui.ui.navigate('help');ui.click('help-action',{helpAction:'center-settings'});assert.match(ui.dialog.innerHTML,/data-section="hardware"/);assert.equal(ui.selections.length,0);
 ui.dispose();
});

test('Help renders plain content safely and ignores unsupported action metadata',()=>{
 const ui=fixture(undefined,{helpTopics:[{id:'future',title:'<script>bad()</script>',summary:'A & B',paragraphs:['<img src=x>'],steps:['<b>Step</b>'],sections:[{title:'<b>More & help</b>',paragraphs:['<svg>'],steps:['<script>Still plain</script>']}],paragraphsAfter:['Done & safe'],action:{id:'execute-code',label:'Run'}}]});
 ui.ui.navigate('help');const html=ui.element('v2HelpContent').innerHTML;
 assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; B/);assert.match(html,/&lt;img/);assert.match(html,/&lt;b&gt;Step/);assert.match(html,/<h3>&lt;b&gt;More &amp; help&lt;\/b&gt;<\/h3>/);assert.match(html,/&lt;svg&gt;/);assert.match(html,/Still plain/);assert.match(html,/Done &amp; safe/);assert.doesNotMatch(html,/data-help-action="execute-code"|<script>|<img|<svg>/);ui.dispose();
});

test('the explicit Help setup guide works when automatic later guides are disabled and preserves pending review',()=>{
 const second={...lamp,id:'112233445566'},model={lamps:[lamp,second],groups:[],ownedLampIds:[lamp.id,second.id],selected:lamp,connected:true,statuses:{}},pairs=[];
 const preferences=JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:true,laterGuides:false}}),ui=fixture(undefined,{model,preferences,api:{pair:async()=>pairs.push('pair')}});
 ui.ui.navigate('help');ui.click('help-action',{helpAction:'setup'});assert.match(ui.dialog.innerHTML,/Let’s meet your lamp/);assert.equal(pairs.length,0);ui.dispose();
 const pending=fixture(undefined,{model,preferences:JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:true,laterGuides:false,pending:{target:lamp.id,stage:'paired',needsReview:true}}}),api:{pair:async()=>pairs.push('pair')}});
 pending.ui.navigate('help');pending.click('help-action',{helpAction:'setup'});assert.match(pending.dialog.innerHTML,/Check this lamp/);assert.doesNotMatch(pending.dialog.innerHTML,/data-v2="pair"/);assert.equal(pairs.length,0);pending.dispose();
});

test('the Help route highlights Settings, hides lamp controls and preserves an active update sender',()=>{
 const start=mainSource.indexOf('function page(name,'),end=mainSource.indexOf('\n\nconst $ =',start),calls=[],elements=new Map(),nav=[{dataset:{page:'app-settings'},setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];}}],sender=new AbortController();
 assert(start>=0&&end>start);
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',querySelector:()=>({focus:()=>calls.push('focus-help')}),dataset:{}});return elements.get(id);};
 const context={$:element,settingsView:'network',navigationSerial:0,wifiSettingsTarget:null,groupFocusSerial:0,pendingGroupFocus:null,meshWizard:null,
  cancelMeshSelection:()=>calls.push('cancel-read-only-search'),hideWifiPassword:()=>calls.push('hide-password'),closeGroupEditor:()=>calls.push('close-group-editor'),scheduleLampStatusRefresh:()=>calls.push('schedule-visible-inventory'),
  refreshLampFirmware:()=>calls.push('firmware-read'),refreshPublicFirmware:()=>calls.push('release-read'),refreshBasicBluetoothTelemetry:()=>calls.push('ble-read'),refreshNewMeshLamps:()=>calls.push('mesh-read'),refreshRoomGroups:()=>calls.push('group-read'),
  appV2:{navigate:route=>calls.push('navigate-'+route)},settingsRecovery:{check:()=>calls.push('check-read-only-recovery')},window:{scrollTo(){}},cancelPeopleAccessRefresh:()=>calls.push('cancel-people-access'),refreshPeopleAccess:()=>calls.push('refresh-people-access'),
  document:{querySelectorAll:()=>nav},cardFirmwareTasks:new Map([['aabbccddeeff',{abort:sender}]]),mergedLampEntries:()=>[]};
 runInNewContext(mainSource.slice(start,end)+'\npage("help");',context);
 assert.equal(element('page-help').hidden,false);for(const id of ['home','lights','automations','lamps','groups','settings','app-settings','people-access'])assert.equal(element('page-'+id).hidden,true);
 assert.equal(nav[0]['aria-current'],'page');assert(calls.includes('navigate-help'));assert(calls.includes('focus-help'));assert.equal(sender.signal.aborted,false);assert(!calls.some(value=>value.endsWith('-read')));
});

function tourFixture({first=false,blocked=false,preferences,model:provided}={}){
 const calls=[],model=provided||{lamps:[],ownedLampIds:[],groups:[],statuses:{},connected:false,connecting:false,tourBlocked:blocked};let session;
 const startTour=options=>{session=options;options.onStep(options.steps[0]);let active=true;return {get active(){return active;},close(reason){if(!active)return;active=false;options.onClose({reason,completed:reason==='done'});}};};
 const ui=fixture(undefined,{model,preferences:first?undefined:preferences||JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:false}}),startTour,
  api:{tourNavigate:(name,options)=>calls.push({name,options}),pair:()=>calls.push('pair'),power:()=>calls.push('power'),discover:()=>calls.push('discover')}});
 return {...ui,model,calls,session:()=>session};
}

test('first-use invitation can run a read-only tour then offer the original setup without pairing',()=>{
 const ui=tourFixture({first:true});assert.match(ui.dialog.innerHTML,/Show me around/);ui.click('welcome-tour');
 assert.equal(ui.dialog.open,false);assert.equal(ui.session().steps[0].id,'home');assert.equal(ui.calls[0].name,'home');assert.equal(ui.navigations.length+ui.selections.length,0);
 ui.ui.endTour('done');assert.equal(ui.dialog.open,true);assert.match(ui.dialog.innerHTML,/Let’s meet/);assert(!ui.calls.some(value=>typeof value==='string'));
 const saved=JSON.parse(ui.preferences());assert.equal(saved.onboarding.firstComplete,false);assert.equal(saved.onboarding.pending,null);ui.dispose();
});

test('Help can replay the tour without changing existing guide preferences or pending setup',()=>{
 const preferences=JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:false,laterGuides:false,pending:{target:lamp.id,stage:'paired',needsReview:true}},future:{keep:1}});
 const model={lamps:[lamp],ownedLampIds:[lamp.id],selected:lamp,connected:false,groups:[],statuses:{}};
 const ui=tourFixture({preferences,model});ui.ui.navigate('help');assert.match(ui.element('v2HelpContent').innerHTML,/Give me a tour/);ui.click('tour');
 assert(ui.session());const before=ui.preferences();for(const step of ui.session().steps)ui.session().onStep(step);ui.ui.endTour('skip');
 assert.equal(ui.calls.at(-1).name,'help');assert.equal(ui.calls.at(-1).options.active,false);assert.equal(ui.preferences(),before);assert.equal(ui.navigations.length+ui.selections.length,0);assert.equal(ui.dialog.open,false);ui.dispose();
});

test('active operation blocks tour admission and a later owner or selected-target change invalidates it',()=>{
 const ui=tourFixture({blocked:true});ui.ui.navigate('help');ui.click('tour');assert.equal(ui.session(),undefined);assert.match(ui.element('v2TourFeedback').textContent,/finish the current/);
 ui.model.tourBlocked=false;ui.click('tour');const session=ui.session();assert.equal(session.isCurrent(),true);ui.model.tourBlocked=true;assert.equal(session.isCurrent(),false);ui.ui.endTour('invalid');
 ui.model.tourBlocked=false;ui.click('tour');ui.model.selected=lamp;assert.equal(ui.session().isCurrent(),false);ui.ui.endTour('invalid');assert.equal(ui.navigations.length+ui.selections.length,0);ui.dispose();
});

test('tour step plans use real context and only expose detailed lighting for a verified independent target',()=>{
 const ui=tourFixture();const fresh=ui.tourSteps(ui.model);assert.equal(fresh.length,7);assert(!fresh.some(step=>['power','brightness','patterns','lamp-card'].includes(step.id)));
 const connected=ui.tourSteps({...ui.model,lamps:[lamp,{...lamp,id:'112233445566'}],selected:lamp,connected:true,tourLightingReady:true});assert.equal(connected.length,12);
 assert(connected.some(step=>step.selector==='#brightness'&&/overall light level/.test(step.text)));assert(connected.some(step=>step.id==='groups'));
 const unknown=ui.tourSteps({...ui.model,lamps:[lamp],selected:lamp,connected:true,tourLightingReady:false});assert(!unknown.some(step=>step.id==='brightness'));
 for(const step of connected){assert(step.selector.length<=256);assert(step.text.length<=1000);assert(['home','lights','automations','effects','app-settings'].includes(step.page));}
 ui.dispose();
});

test('actual tour presentation routes only render cached controls and preserve the prior settings section',()=>{
 const start=mainSource.indexOf('function tourPresentation('),end=mainSource.indexOf('\nfunction tourBlocked(',start),calls=[],elements=new Map();assert(start>=0&&end>start);
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false});return elements.get(id);};
 const context={$:element,settingsView:'hardware',appTourActive:false,appTourSettingsView:null,firmwareBackgroundGeneration:3,
  renderLamps:()=>calls.push('cached-lamps'),renderSettings:()=>calls.push('cached-settings'),renderOptions:()=>calls.push('cached-options'),scheduleLampStatusRefresh:()=>calls.push('schedule'),
  appV2:{navigate:(...args)=>calls.push(args)},app2Pending:new Map([[lamp.id,{uncertain:true}]])};
 runInNewContext(mainSource.slice(start,end),context);for(const name of ['home','lights','automations','effects','app-settings','help'])assert.equal(context.tourPresentation(name),true);
 assert.equal(context.appTourActive,true);assert.equal(context.firmwareBackgroundGeneration,4);assert.equal(context.settingsView,'lighting');assert.equal(context.tourPresentation('groups'),false);
 assert.equal(context.tourPresentation('help',{active:false}),true);assert.equal(context.appTourActive,false);assert.equal(context.settingsView,'hardware');assert.equal(context.app2Pending.get(lamp.id).uncertain,true);
 assert.equal(element('page-help').hidden,false);assert(calls.filter(Array.isArray).every(([,options])=>options.tour===true));
 assert(!calls.some(value=>typeof value==='string'&&/read|connect|command|reset|save/.test(value)));
});
function groupAddFixture({unavailable=false,refresh,join,name='Sonata Left',protocol=2,incarnation='a'.repeat(32)}={}){
 const main={id:'112233445566',name:'Sonata Right'},target={...lamp,name},leader={...main,verified:true,available:true,role:1,sync:{version:protocol,role:1,incarnation,order:[{id:main.id}]}},row={...target,verified:!unavailable,available:!unavailable,role:unavailable?null:0,state:unavailable?'needs-password':'ready',message:unavailable?'Open this lamp to check its saved access.':'',checkedAt:100,sync:{version:2,protocolVersions:[2,3],role:0}};
 const group={id:main.id,name:'Downstairs',leader,followers:[],available:true,capacity:8,remaining:8},model={lamps:[main,target],ownedLampIds:[main.id,target.id],groups:[group],available:[leader,row],statuses:{},selected:main,connected:true};
 const joins=[],checks=[];
 const api={refreshGroups:async()=>{checks.push(true);if(refresh)await refresh(model);},addGroupLamp:async(id,leaderId,options)=>{joins.push({id,leaderId,options});if(join)return join(id,leaderId,options,model);Object.assign(row,{role:2,leader:leaderId,sync:{...row.sync,role:2,leader:leaderId}});group.followers.push(row);return {phase:'joined',active:false};}};
 const ui=fixture(undefined,{model,api,preferences:JSON.stringify({onboarding:{version:1,welcomeSeen:true,firstComplete:true,secondGroupSeen:true,laterGuides:false}})});
 return {...ui,model,group,main,target,row,joins,checks,open:()=>ui.ui.addGroupLamps(main.id),add:()=>ui.click('group-add-one',{id:target.id,groupId:main.id})};
}

test('an existing one-lamp Sonata group exposes Add lamps on Home and adds one independent lamp without creating a group',async()=>{
 const ui=groupAddFixture();assert.match(ui.element('v2HomeContent').innerHTML,/data-v2="add-group-lamps"/);
 ui.open();await settle();assert.equal(ui.checks.length,1);assert.equal(ui.joins.length,0);assert.match(ui.dialog.innerHTML,/Add lamps to Downstairs/);assert.match(ui.dialog.innerHTML,/Sonata Left/);assert.match(ui.dialog.innerHTML,/Ready to add/);
 ui.add();await settle();assert.equal(ui.joins.length,1);assert.equal(ui.joins[0].id,ui.target.id);assert.equal(ui.joins[0].leaderId,ui.main.id);assert.equal(ui.joins[0].options.expectedIncarnation,'a'.repeat(32));assert.match(ui.dialog.innerHTML,/Sonata Left added/);assert.match(ui.dialog.innerHTML,/All your saved lamps are already in this group/);ui.dispose();
});

test('unavailable saved lamps stay visible with their reason and actionable connection check',async()=>{
 const ui=groupAddFixture({unavailable:true,name:'Sonata <Left>'});ui.open();await settle();
 assert.match(ui.dialog.innerHTML,/Sonata &lt;Left&gt;/);assert.doesNotMatch(ui.dialog.innerHTML,/<Left>/);assert.match(ui.dialog.innerHTML,/check its saved access/);assert.match(ui.dialog.innerHTML,/Check connections/);
 ui.add();await settle();assert.equal(ui.joins.length,0);
 Object.assign(ui.row,{available:true,verified:true,role:0,checkedAt:101});ui.click('group-add-check',{id:ui.main.id});await settle();ui.add();await settle();assert.equal(ui.joins.length,1);ui.dispose();
});

for(const condition of ['full','locked','removing'])test('existing group Add remains explanatory and cannot join when '+condition,async()=>{
 const ui=groupAddFixture();if(condition==='full')ui.group.remaining=0;if(condition==='locked')ui.group.leader.sync.membershipLocked=true;if(condition==='removing')ui.group.removalPending=true;
 ui.open();await settle();assert.match(ui.dialog.innerHTML,condition==='full'?/group is full/:condition==='locked'?/group’s update/:/pending removal/);ui.add();await settle();assert.equal(ui.joins.length,0);ui.dispose();
});

test('an uncertain addition is not replayed by duplicate taps or a stale connection refresh',async()=>{
 const ui=groupAddFixture({join:async()=>{throw Object.assign(Error('Reply was lost.'),{uncertain:true});}});ui.open();await settle();ui.add();await settle();assert.equal(ui.joins.length,1);assert.match(ui.dialog.innerHTML,/last addition was not confirmed/);
 ui.add();ui.click('group-add-check',{id:ui.main.id});await settle();ui.add();await settle();assert.equal(ui.joins.length,1);assert.equal(ui.checks.length,2);ui.dispose();
});

test('closing or changing pages during an Add picker refresh fences its late presentation without a join',async()=>{
 const gate=deferred(),ui=groupAddFixture({refresh:()=>gate.promise});ui.open();await settle();ui.ui.navigate('lamps');gate.resolve();await settle();assert.equal(ui.dialog.open,false);assert.equal(ui.joins.length,0);ui.dispose();
});

test('a recreated group invalidates the reviewed Add window before any join',async()=>{
 const ui=groupAddFixture();ui.open();await settle();ui.group.leader.sync.incarnation='b'.repeat(32);ui.add();await settle();assert.equal(ui.joins.length,0);assert.match(ui.dialog.innerHTML,/This group changed/);ui.dispose();
});

test('a late join result cannot reopen an Add picker or target another selected group',async()=>{
 const gate=deferred(),ui=groupAddFixture({join:()=>gate.promise});ui.open();await settle();ui.add();await settle();assert.equal(ui.joins[0].options.isCurrent(),true);ui.ui.navigate('lamps');assert.equal(ui.joins[0].options.isCurrent(),false);gate.resolve({phase:'joined',active:true});await settle();assert.equal(ui.dialog.open,false);assert.equal(ui.joins.length,1);ui.dispose();
});

test('legacy version-two groups without an incarnation retain the existing Add path',async()=>{
 const ui=groupAddFixture({incarnation:undefined});delete ui.group.leader.sync.incarnation;ui.open();await settle();ui.add();await settle();assert.equal(ui.joins.length,1);assert.equal(ui.joins[0].options.expectedIncarnation,null);ui.dispose();
});

test('an unavailable lamp has an explicit foreground connection action that returns to the existing group without joining',async()=>{
 const ui=groupAddFixture({unavailable:true});let connected=0;
 // Keep the real adapter path through the fixture's select API.
 ui.open();await settle();assert.match(ui.dialog.innerHTML,/data-v2="group-add-connect"/);
 ui.click('group-add-connect',{id:ui.target.id,groupId:ui.main.id});await settle();
 assert.equal(ui.selections.length,1);assert.equal(ui.selections[0].id,ui.target.id);assert.equal(ui.selections[0].section,'overview');assert.equal(ui.joins.length,0);assert.equal(ui.dialog.open,true);assert.match(ui.dialog.innerHTML,/Add lamps to Downstairs/);assert.equal(ui.checks.length,2);ui.dispose();
});

test('the group card and group editor both expose the same existing-group Add action',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="addGroupEditorLamps"[^>]*>Add lamps/);
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/add\.dataset\.groupAction='add'.*add\.onclick=\(\)=>appV2\?\.addGroupLamps\(group\.id\)/);
 const assigned=main.match(/\$\('addGroupEditorLamps'\)\.onclick=[^\n]+/)[0],button={},calls=[];
 runInNewContext(assigned,{$:()=>button,groupEditor:{id:'aabbccddeeff'},appV2:{addGroupLamps:id=>calls.push(id)}});button.onclick();assert.deepEqual(calls,['aabbccddeeff']);
});

test('Close remains available during a read-only group check and releases its UI ownership immediately',async()=>{
 const gate=deferred(),ui=groupAddFixture({refresh:()=>gate.promise});ui.open();await settle();
 const close=ui.dialog.children.find(button=>button.dataset.v2==='close');assert.equal(close.disabled,false);ui.click('close');assert.equal(ui.dialog.open,false);
 ui.click('help');assert.deepEqual(ui.navigations,[['help']]);gate.resolve();await settle();assert.equal(ui.joins.length,0);assert.doesNotMatch(ui.dialog.innerHTML,/Add lamps to/);ui.dispose();
});

test('a shared-effect preflight failure offers this lamp’s lighting controls without choosing an effect or replaying the join',async()=>{
 const ui=groupAddFixture({join:async(id)=>{throw Object.assign(Error('Choose a shared effect, such as Fire. Your startup settings stay the same.'),{needsSharedEffect:true,targetId:id});}});ui.open();await settle();ui.add();await settle();
 assert.match(ui.dialog.innerHTML,/Choose a shared effect/);ui.click('open-lamp',{id:ui.target.id,section:'lighting'});await settle();assert.equal(ui.joins.length,1);assert.equal(ui.selections.length,1);assert.equal(ui.selections[0].id,ui.target.id);assert.deepEqual(ui.navigations,[['effects','lighting']]);ui.dispose();
});
