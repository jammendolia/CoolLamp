import './app-v2.css';
import {lampArtworkSvg} from './lamp-artwork.js';
import {resolveLampStyle,lampStyleLocked,lampDesignLabel} from './lamp-style.js';
import {OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT} from './onboarding.js';
import {HELP_TOPICS} from './help.js';
import {startGuidedTour} from './guided-tour.js';
import {readHomeContext,buildLightsOverview,automationPresentation} from './ecosystem-foundation.js';
import {buildHomeExperienceProjectionV1} from './home-experience-adapter.js';
import {compilePeopleAccess} from './people-access.js';
import {APP_VERSION_LABEL} from './app-version.js';
import './guided-tour.css';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preferenceWrites=new WeakSet();
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${({home:'<path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/>',lamps:'<path d="M10 3c12 3-7 5 4 8s-6 5-1 8M7 21h10"/>',effects:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 5"/>'})[name]||''}</svg>`;
export function lampDrawing(style='unspecified'){
 return lampArtworkSvg(style,{className:'v2-lamp-drawing'});
}
export const lampDrawingStyle=lamp=>resolveLampStyle(lamp?.lampStyle,lamp?.phoneLampStyle).id;
export function groupAddState(model,id){
 const group=model.groups?.find(value=>value.id===id),leader=group?.leader;
 const message=!group?'This group is no longer available. Open Groups and check its lamps.':group.removalPending?'Finish this group’s pending removal before adding lamps.':leader?.sync?.membershipLocked?'Finish this group’s update before adding lamps.':!group.available||!leader?.verified?'Check connections to reach the main lamp before adding.':group.remaining===0?'This group is full. Remove or move a lamp before adding another.':'';
 const members=new Set([id,...(group?.followers||[]).map(value=>value.id),...(leader?.sync?.order||[]).map(value=>value.id)]);
 const owned=Array.isArray(model.ownedLampIds)?new Set(model.ownedLampIds):null;
 const candidates=(model.lamps||[]).filter(value=>!members.has(value.id)&&(!owned||owned.has(value.id))).map(lamp=>{
  const row=model.available?.find(value=>value.id===lamp.id);
  const reason=!/^[0-9a-f]{12}$/.test(lamp.id)?'Open this lamp once to verify its identity.':row?.sync?.membershipLocked?'Finish this lamp’s update before adding it.':row?.verified&&row.role===1?'This lamp already leads another group.':row?.verified&&row.role===2?'This lamp belongs to another group. Remove it there first.':!row?.available||!row?.verified||row.role!==0?row?.message||'Connection not checked. Choose Check connections.':message;
  return {lamp,row,ready:!reason,reason:reason||'Ready to add'};
 });
 return {group,message,candidates};
}
export function readAppPreferences(storage){
 try{const raw=storage.getItem('coollamp-app2')||'{}';if(raw.length>GUIDE_STORAGE_LIMIT)throw Error('Preferences too large');const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Unsupported preferences');const value=parsed,result={...value,rooms:value.rooms&&typeof value.rooms==='object'&&!Array.isArray(value.rooms)?value.rooms:{},groups:value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups)?value.groups:{},theme:['light','dark','system'].includes(value.theme)?value.theme:'system'};preferenceWrites.add(result);return result;}catch{return {rooms:{},groups:{},theme:'system'};}
}
export function appTourSteps(model){
 const steps=[
  {id:'home',page:'home',selector:'nav [data-page="home"]',title:'Welcome home',text:'Home brings your lamps and groups together. The buttons along the bottom take you to different parts of CoolLamp.'},
  {id:'add',page:'home',selector:'#page-home .v2-page-heading [data-v2="add"]',title:'Add a lamp',text:'This plus button starts the setup guide. It helps you connect a lamp, give it a name and choose its room. For now, we’re only looking.'},
  {id:'lights',page:'lights',selector:'nav [data-page="lights"]',title:'Find the light you want',text:'Lights keeps rooms, groups that play together, and individual devices distinct. Tap a light to open its controls.'}
 ];
 if(model.lamps?.length)steps.push({id:'lamp-card',page:'lights',selector:'#v2LightsContent [data-v2="open-lamp"]',title:'One place for each light',text:'The room helps you find it. Open the light before changing its brightness, effect, sound response, or settings.'});
 if(model.tourLightingReady===true&&model.connected&&model.selected?.id)steps.push(
  {id:'power',page:'effects',selector:'#power',title:'Turn the light on or off',text:'This button changes the light on the connected lamp named above. Turning it off keeps the lamp connected. This tour leaves its current light alone.'},
  {id:'brightness',page:'effects',selector:'#brightness',title:'Make it softer or brighter',text:'After the tour, slide Brightness toward Soft for less light or toward Luminous for more light. This changes the overall light level. Effect intensity changes the pattern instead.'},
  {id:'patterns',page:'effects',selector:'#effectLibrary > summary',title:'Explore this lamp’s effects',text:'Open this collection to see the patterns your lamp supports. Tap a pattern to try it. Its color, motion or sound controls appear below, when that effect supports them.'}
 );
 if(model.lamps?.length>=2)steps.push({id:'groups',page:'home',selector:'#v2HomeContent [data-v2="create-group"]',title:'Let lamps play together',text:'New group guides you through choosing at least two lamps to share an effect. Each lamp must confirm joining. You can keep your lamps separate too.'});
 steps.push(
  {id:'automations',page:'automations',selector:'nav [data-page="automations"]',title:'Let lighting follow a routine',text:'Automations show your schedules, what is coming next, and anything that needs your attention.'},
  {id:'settings',page:'app-settings',selector:'#page-app-settings [data-v2="lamp-settings"]',title:'Name and startup effect',text:'Lamp details is where you choose a lamp’s name and room. The startup effect and brightness are the pattern and light level it uses when you plug it in. In Effects, choose Use these settings at startup to remember them.'},
  {id:'designs',page:'app-settings',selector:'#page-app-settings [data-v2="appearance"]',title:'Lamp designs',text:'Lamp designs contains the physical shape and strip setup. A finished lamp normally comes configured. Use these settings only when you want to check or adjust its setup.'},
  {id:'help',page:'app-settings',selector:'#page-app-settings [data-v2="help"]',title:'Help is always here',text:'Help and guides live in Settings. Open a topic for step-by-step instructions, or take this tour again.'}
 );
 return steps;
}
export function mountAppV2(api){
 const preferences=readAppPreferences(localStorage),homeContext=readHomeContext(localStorage),home=document.getElementById('v2HomeContent'),lights=document.getElementById('v2LightsContent'),automations=document.getElementById('v2AutomationsContent'),peopleAccess=document.getElementById('v2PeopleAccessContent'),dialog=document.getElementById('v2Dialog');
 let route='home',lastHome='',lastLights='',lastAutomations='',lastPeopleAccess='',peopleAccessView=null,setupStep=0,setupName='',setupRoom='Living room',setupStyle='helix',setupAutomatic=false,working=false,setupId=null,selectionTask=null,workingTask=null,disposed=false,groupAddReview=null;
 const redesignedHome=api.experience==='home-v1',homeOperations=new Map(),homeOperationTimers=new Map();
 let homeFocusRequest=null;
 const persist=()=>{try{if(!preferenceWrites.has(preferences))throw Error('Read unavailable');const text=JSON.stringify(preferences);if(text.length>GUIDE_STORAGE_LIMIT)throw Error('Preferences too large');localStorage.setItem('coollamp-app2',text);return true;}catch{api.message('This phone could not remember the guide preferences. Your lamp’s confirmed changes are kept.');return false;}};
 let storedPreferences=true;try{storedPreferences=localStorage.getItem('coollamp-app2')!==null;}catch{}
 const guide=new OnboardingGuide(preferences,persist,{ownedIds:ownedGuideIds(api.model()),stored:storedPreferences});
 let setupNeedsReview=false,guideGeneration=0,audioGuideStep=0,setupAutomaticInitial=false,setupAutomaticKnown=false,tour=null,tourStarting=false;
 const room=(id)=>api.model().lamps?.find(l=>l.id===id)?.room||(typeof preferences.rooms[id]==='string'?preferences.rooms[id]:'My home');
 const groupName=(id,fallback)=>typeof preferences.groups[id]==='string'?preferences.groups[id]:fallback||'Lamp group';
 const applyTheme=()=>{document.documentElement.dataset.appTheme=preferences.theme;document.getElementById('v2Theme').value=preferences.theme;};applyTheme();
 document.getElementById('v2Version').textContent=APP_VERSION_LABEL;
 function cancelSelection(){const task=selectionTask;if(!task)return;selectionTask=null;task.controller.abort();delete dialog.dataset.selectionLoading;for(const button of dialog.querySelectorAll('[data-v2="select-settings"]'))button.disabled=false;task.button.removeAttribute('aria-busy');if(task.hint)task.hint.textContent=task.originalHint;}
 function clearWorkingPresentation(owner){
  if(!owner)return;
  for(const [control,disabled]of owner.controls)control.disabled=disabled;
  owner.controls.clear();owner.body?.removeAttribute('aria-busy');
  if(owner.presenting){delete dialog.dataset.operationLoading;delete dialog.dataset.operation;owner.presenting=false;}
  if(owner.status){delete owner.status.dataset.operation;if(owner.status.dataset.state==='working'){delete owner.status.dataset.state;owner.status.textContent='';}}
 }
 const close=()=>{groupAddReview=null;cancelSelection();const owner=workingTask;clearWorkingPresentation(owner);if(owner?.cancellable){owner.cancel?.();workingTask=null;working=false;}if(dialog.open)dialog.close();dialog.replaceChildren();};
 function sheet(title,body){cancelSelection();clearWorkingPresentation(workingTask);dialog.innerHTML=`<div class="v2-sheet-title"><h2>${esc(title)}</h2><button type="button" data-v2="close" aria-label="Close">×</button></div><p id="v2DialogStatus" role="status" aria-live="polite" aria-atomic="true"></p><div class="v2-sheet-body">${body}</div>`;if(!dialog.open)dialog.showModal();dialog.querySelector('input,button')?.focus();}
 // Semantic keys are localizable display metadata; only explicit client work
 // selects a stage. They never authorize or replay a lamp operation.
 const workMessages={pairing:'Connecting to your lamp…','saving-details':'Saving your lamp’s name and design…',
  'saving-name':'Saving your lamp’s name…','saving-style':'Saving your lamp’s design…','saving-room':'Remembering its room…',
  'saving-preference':'Saving your update preference…','finishing-setup':'Finishing your setup…',
  'finding-lamps':'Looking for your lamps…','checking-groups':'Checking which lamps can play together…',
  'creating-group':'Connecting your group…','joining-group':'Adding lamps to your group…','checking-group':'Checking your group’s connections…',
  'opening-group':'Opening your group…','changing-power':'Changing your light…'};
 async function run(task,{stage='pairing',targetId=null,cancellable=false,onCancel=null}={}){
  if(working||disposed)return;
  working=true;const owner={generation:guideGeneration,controls:new Map(),presenting:false,status:null,body:null,cancellable,cancel:onCancel};workingTask=owner;
  const current=()=>!disposed&&workingTask===owner&&owner.generation===guideGeneration&&(!targetId||api.model().selected?.id===targetId);
  const setStage=key=>{if(!current()||!Object.hasOwn(workMessages,key))return;
   const status=document.getElementById('v2DialogStatus');if(!status||!dialog.open)return;
   owner.status=status;owner.body=dialog.querySelector('.v2-sheet-body');owner.presenting=true;
   dialog.dataset.operationLoading='true';dialog.dataset.operation=key;
   owner.body?.setAttribute('aria-busy','true');
   for(const control of dialog.querySelectorAll('button,input,select')){if(owner.cancellable&&control.dataset.v2==='close')continue;if(!owner.controls.has(control))owner.controls.set(control,control.disabled);control.disabled=true;}
   status.dataset.state='working';status.dataset.operation=key;status.textContent=workMessages[key];status.scrollIntoView({block:'nearest'});
  };
  setStage(stage);
  try{if(current())await task({setStage,isCurrent:current});}
  catch(error){if(current()){
   const message=error.guideReview?error.message:error.uncertain?'We could not confirm that change. Check the lamp before trying again.':error.cancelled?'Setup paused. You can continue when you’re ready.':error.message||'This step could not finish. Please try again.';
   const status=document.getElementById('v2DialogStatus');if(status){status.dataset.state='error';status.textContent=message;status.scrollIntoView({block:'nearest'});}api.message(message);
  }}finally{clearWorkingPresentation(owner);if(workingTask===owner){workingTask=null;working=false;}if(!disposed)refresh(true);}
 }
 async function selectLight(button){
  if(working||selectionTask)return;
  const id=button.dataset.id,section=button.dataset.section||'lighting',name=api.model().lamps?.find(lamp=>lamp.id===id)?.name||'your lamp';
  const hint=button.querySelector('small'),task={controller:new AbortController(),button,hint,originalHint:hint?.textContent,timedOut:false};selectionTask=task;
  if(button.dataset.retry==='true')button.hidden=true;
  const current=()=>selectionTask===task&&dialog.open&&!task.controller.signal.aborted;
  const feedback=document.getElementById('v2DialogStatus');if(feedback){feedback.dataset.state='opening';feedback.textContent='Connecting to '+name+' and reading its settings…';feedback.scrollIntoView({block:'nearest'});}
  // Keep the live status outside a busy ancestor so assistive technology can
  // announce progress immediately; only the selected action is busy.
  dialog.dataset.selectionLoading='true';button.setAttribute('aria-busy','true');if(hint)hint.textContent='Opening lamp…';
  for(const choice of dialog.querySelectorAll('[data-v2="select-settings"]'))choice.disabled=true;
  let timer,abort;
  try{
   const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('Lamp selection cancelled.'));task.controller.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{task.timedOut=true;task.controller.abort();},25000);});
   const result=await Promise.race([Promise.resolve().then(()=>api.select(id,section,{signal:task.controller.signal,isCurrent:current})),interrupted]);
   if(!current())return;
   if(!result?.connected)throw result?.error||Error('We couldn’t open '+name+'. Please try again.');
   if(result.id&&result.id!==id)throw Error('The connection opened a different lamp. Please choose your lamp again.');
   close();api.navigate(section==='lighting'?'effects':'settings',section);
  }catch(error){
   if(selectionTask!==task)return;
   const message=task.timedOut?'We couldn’t reach '+name+'. Keep the lamp powered on and try again.':error.uncertain?'We could not confirm the connection. Please choose your lamp again.':error.message||'We couldn’t open '+name+'. Please try again.';
   if(button.dataset.retry==='true')button.hidden=false;
   if(feedback){feedback.dataset.state='error';feedback.textContent=message;feedback.scrollIntoView({block:'nearest'});}api.message(message);
  }finally{clearTimeout(timer);task.controller.signal.removeEventListener('abort',abort);if(selectionTask===task)cancelSelection();}
 }
 function projectRedesignedHome(model,now=Date.now()){
  const owned=new Set(Array.isArray(model.ownedLampIds)?model.ownedLampIds:[]),lamps=(model.lamps||[]).filter(light=>owned.has(light.id)),ids=new Set(lamps.map(light=>light.id));
  const statuses=Object.fromEntries(Object.entries(model.statuses||{}).filter(([id])=>ids.has(id))),groups=(model.groups||[]).filter(group=>owned.has(group.id));
  return buildHomeExperienceProjectionV1({version:1,home:homeContext.active,lamps,groups,statuses,savedLooks:model.savedLooks||[],preferences:{rooms:preferences.rooms,groups:preferences.groups}},{now});
 }
 function homeLightSummary(light){
  const value=light?.lighting;if(!value||value.freshness==='unknown')return 'Status needs a check';
  const state=value.power?value.effect?.name?`On · ${value.effect.name}`:'On':'Off';
  return value.freshness==='fresh'?state:`Last confirmed ${state.toLocaleLowerCase()}`;
 }
 function homeOperationMarkup(targetId,kind){
  const operation=homeOperations.get(targetId),statusId='v2HomeOperation-'+targetId;
  if(!operation)return `<div id="${statusId}" class="v2-home-v1-operation" role="status" aria-live="polite" aria-atomic="true" hidden></div>`;
  const pending=operation.state==='pending';
  const phase=operation.phase==='sending'?(operation.desired===null?`Checking ${operation.name}…`:`Turning ${operation.name} ${operation.desired?'on':'off'}…`):operation.phase==='checking'?(operation.desired===null?`Checking ${operation.name}…`:`Checking the change on ${operation.name}…`):`Connecting to ${operation.name}…`;
  const message=pending?phase:operation.message;
  const followUp=operation.state==='uncertain'||operation.state==='failed'&&operation.safeToRetry?`<button type="button" class="secondary" data-v2="home-check" data-id="${esc(targetId)}" data-home-kind="${esc(kind)}">Check current state</button>`:operation.state==='failed'?`<button type="button" class="secondary" data-v2="${kind==='group'?'open-group':'open-lamp'}" data-id="${esc(targetId)}">Open ${kind==='group'?'group':'light'}</button>`:'';
  return `<div id="${statusId}" class="v2-home-v1-operation" data-state="${esc(operation.state)}" data-home-operation-message="${esc(message)}" role="status" aria-live="polite" aria-atomic="true" aria-busy="${pending}">${pending?'<span class="v2-home-v1-spinner" aria-hidden="true"></span>':''}<span data-home-operation-copy></span>${followUp}</div>`;
 }
 function announceHomeOperations(){
  for(const status of home.querySelectorAll('[data-home-operation-message]')){
   const copy=status.querySelector('[data-home-operation-copy]'),message=status.dataset.homeOperationMessage;delete status.dataset.homeOperationMessage;
   Promise.resolve().then(()=>{if(!disposed&&home.contains(status)&&copy)copy.textContent=message;});
  }
 }
 function homeQuickAction(light,{kind='device',group=null}={}){
  const targetId=light?.actionTargetId,operation=targetId?homeOperations.get(targetId):null,pending=operation?.state==='pending',mutationBlocked=pending||operation?.state==='uncertain';if(!targetId)return '';
   if(kind==='group'||['bridge','unknown'].includes(light.productKind)||light.capabilities.power==='unsupported')return '';
   const canChange=light.capabilities.power==='supported'&&light.lighting.freshness==='fresh'&&(kind==='group'?group?.evidence==='fresh':['independent','separate'].includes(light.group.current));
  if(!canChange&&light.capabilities.power==='supported'&&light.lighting.freshness==='stale'){
   const last=light.lighting.power?'on':'off',disabled=String(mutationBlocked);
   const nativeDisabled=mutationBlocked?' disabled':'';
   return `<div class="v2-home-power-set" role="group" aria-label="Set ${esc(light.name)} power. Last confirmed ${last}."><button type="button" data-v2="home-power-set" data-power="on" data-id="${esc(targetId)}" data-home-kind="${esc(kind)}" aria-disabled="${disabled}" aria-busy="${pending}"${nativeDisabled}>On</button><button type="button" data-v2="home-power-set" data-power="off" data-id="${esc(targetId)}" data-home-kind="${esc(kind)}" aria-disabled="${disabled}" aria-busy="${pending}"${nativeDisabled}>Off</button></div>`;
  }
  if(!canChange)return `<button type="button" class="v2-home-v1-check" data-v2="home-check" data-id="${esc(targetId)}" data-home-kind="${esc(kind)}" aria-disabled="${pending}" aria-busy="${pending}" aria-label="Check ${esc(light.name)} current state"${pending?' disabled':''}>Check</button>`;
  return `<button type="button" class="v2-home-power" data-v2="home-power" data-id="${esc(targetId)}" data-home-kind="${esc(kind)}" aria-disabled="${mutationBlocked}" aria-busy="${pending}" aria-pressed="${light.lighting.power}" aria-label="${operation?.state==='uncertain'?`Check ${esc(light.name)} current state before changing it`:`Turn ${esc(light.name)} ${light.lighting.power?'off':'on'}` }"${mutationBlocked?' disabled':''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 5a8 8 0 1 0 10 0"/></svg></button>`;
 }
 function redesignedHomeCard({kind,id,name,detail,art,light,group}){
  const targetId=light?.actionTargetId||id,action=kind==='group'?'open-group':'open-lamp';
  return `<div class="v2-home-v1-card-wrap" data-target-id="${esc(targetId)}"><div class="v2-home-v1-row"><button type="button" class="v2-home-v1-card" data-v2="${action}" data-id="${esc(targetId)}">${art}<span><strong>${esc(name)}</strong><small>${esc(detail)}</small></span>${icon('arrow')}</button>${homeQuickAction(light?{...light,name}:light,{kind,group})}</div>${homeOperationMarkup(targetId,kind)}</div>`;
 }
 function renderRedesignedHome(model,projection){
  document.getElementById('v2HomeSubtitle').textContent=projection.home.name.toUpperCase();
  const rooms=new Map(projection.rooms.map(value=>[value.id,value.name])),memberIds=new Set(projection.groups.flatMap(group=>group.members.map(member=>member.deviceId)));
  const separate=projection.lights.find(light=>light.productKind!=='bridge'&&light.actionTargetId&&light.group.current==='separate'&&light.group.groupId);
  const separateGroup=separate?projection.groups.find(group=>group.id===separate.group.groupId):null;
  const attention=separate&&separateGroup?.actionTargetId?`<section class="v2-home-v1-attention" aria-label="Needs attention"><strong>${esc(separate.name)} is playing separately</strong><button type="button" class="secondary" data-v2="open-group" data-id="${esc(separateGroup.actionTargetId)}">Open ${esc(separateGroup.name)} to return</button></section>`:'';
  const groupCards=projection.groups.filter(group=>group.actionTargetId).map(group=>{
    const leader=projection.lights.find(light=>light.actionTargetId===group.actionTargetId),playing=group.members.filter(member=>member.current==='playing').length,separateCount=group.members.filter(member=>member.current==='separate').length,needsCheck=group.members.length-playing-separateCount+group.unmatchedMemberCount;
   const counts=[playing?`${playing} playing`:'',separateCount?`${separateCount} separate`:'',needsCheck?`${needsCheck} ${needsCheck===1?'needs':'need'} a check`:''].filter(Boolean).join(' · ')||'Group needs a check';
    return redesignedHomeCard({kind:'group',id:group.actionTargetId,name:group.name,detail:counts,art:'<span class="v2-group-art" aria-hidden="true"><i></i><i></i><i></i></span>',light:leader,group});
  }).join('');
  const deviceCards=projection.lights.filter(light=>light.productKind!=='bridge'&&light.actionTargetId&&light!==separate&&(!memberIds.has(light.id)||light.group.current==='separate')).map(light=>{
   const place=rooms.get(light.roomId),detail=[place,light.group.current==='separate'?'Playing separately':'',homeLightSummary(light)].filter(Boolean).join(' · ');
   return redesignedHomeCard({kind:'device',id:light.actionTargetId,name:light.name,detail,art:lampDrawing(light.lampStyle||'unspecified'),light});
  }).join('');
  const cards=groupCards+deviceCards;
  if(!projection.lights.length){home.innerHTML='<section class="v2-welcome">'+lampDrawing('unspecified')+'<h2>A little light.<br>A lovely beginning.</h2><p>Add your first lamp. We’ll help identify it, name it, and place it in a room.</p><button data-v2="add">Add your first lamp</button><button class="secondary" data-v2="discover">Find lamps already at home</button></section>';return;}
  home.innerHTML=`${attention}<div class="v2-section-title v2-home-v1-title"><h2>Lights</h2><button class="text-button" data-v2="lights">View all</button></div><div class="v2-home-v1-list">${cards||'<div class="v2-empty-small"><p>Your lights will appear here after setup.</p><button type="button" class="secondary" data-v2="lights">Open Lights</button></div>'}</div>`;announceHomeOperations();
 }
 async function runHomePower(targetId,{readOnly=false,kind='device',desired=null}={}){
  const existing=homeOperations.get(targetId);if(!redesignedHome||disposed||existing?.state==='pending'||!readOnly&&existing?.state==='uncertain')return;
  let projection;try{projection=projectRedesignedHome(api.model());}catch{api.message('Home could not be refreshed. Open Lights and try again.');return;}
  const light=projection.lights.find(value=>value.actionTargetId===targetId),group=kind==='group'?projection.groups.find(value=>value.actionTargetId===targetId):null;
  if(!light){api.message('This light is no longer available in this Home. Open Lights to check it.');return;}
   if(kind!=='device'||['bridge','unknown'].includes(light.productKind)){api.message('Open this item to see the controls currently available.');return;}
   if(light.capabilities.power==='unsupported'||!readOnly&&light.capabilities.power!=='supported'){api.message('Check this light before changing its power.');return;}
  const explicit=typeof desired==='boolean',canChange=!readOnly&&(explicit||light.lighting.freshness==='fresh'&&(kind==='group'?group?.evidence==='fresh':['independent','separate'].includes(light.group.current)));
  const active=home.contains(document.activeElement)?document.activeElement:null;
  const focusIntent={action:active?.dataset.v2||((explicit?'home-power-set':readOnly?'home-check':'home-power')),id:targetId,power:active?.dataset.power||(explicit?(desired?'on':'off'):undefined)};
  const operation={targetId,homeId:projection.home.id,kind,name:kind==='group'?group?.name||light.name:light.name,desired:canChange?(explicit?desired:!light.lighting.power):null,lastConfirmed:light.lighting.power,state:'pending',phase:'connecting',focusIntent};
  homeOperations.set(targetId,operation);clearTimeout(homeOperationTimers.get(targetId));homeOperationTimers.delete(targetId);refresh(true);
  const current=()=>{if(disposed||homeOperations.get(targetId)!==operation)return false;try{return projectRedesignedHome(api.model()).home.id===operation.homeId;}catch{return false;}};
  const onProgress=phase=>{if(!current()||!['connecting','sending','checking'].includes(phase))return;operation.phase=phase;refresh(true);};
  let result;
  try{result=await api.power({homeId:operation.homeId,deviceId:targetId,mode:operation.desired===null?'check':explicit?'set':'change',...(explicit?{power:operation.desired}:{})},{onProgress});}
  catch(error){result={outcome:error?.uncertain?'uncertain':'failed',message:error?.message,safeToRetry:Boolean(error?.noMutation)};}
  if(!current()){if(homeOperations.get(targetId)===operation)homeOperations.delete(targetId);return;}
  if(result?.outcome==='confirmed'){
   operation.state='confirmed';operation.message=result.refreshed?`Current state: ${operation.name} is ${result.power?'on':'off'}. No change was sent.`:result.noop?`${operation.name} is already ${result.power?'on':'off'}. No change was sent.`:operation.desired===null?`${operation.name} is ${result.power?'on':'off'}.`:`${operation.name} is now ${result.power?'on':'off'}.`;
   const timer=setTimeout(()=>{if(homeOperations.get(targetId)===operation){homeOperations.delete(targetId);homeOperationTimers.delete(targetId);refresh(true);}},4000);homeOperationTimers.set(targetId,timer);
  }else if(result?.outcome==='uncertain'){
   operation.state='uncertain';operation.message=`${operation.name} may have changed. We couldn’t check it yet.${typeof operation.lastConfirmed==='boolean'?` Last confirmed: ${operation.lastConfirmed?'On':'Off'}.`:''}`;
  }else{
   operation.state='failed';operation.safeToRetry=Boolean(result?.safeToRetry);operation.message=result?.message||`We couldn’t reach ${operation.name}. Keep it powered on, then try again.`;
  }
  const activeAfter=document.activeElement;
  if(route==='home'&&home.contains(activeAfter)&&activeAfter?.dataset.id===targetId)homeFocusRequest=operation.focusIntent;
  refresh(true);homeFocusRequest=null;
 }
 function refresh(force=false){
  if(document.hidden&&!force)return;
  const model=api.model(),lamps=model.lamps||[],groups=model.groups||[],independent=lamps.filter(l=>!groups.some(g=>g.id===l.id||g.followers?.some(f=>f.id===l.id)));
  renderLights(model,force);renderAutomations(model,force);renderPeopleAccess(model,force);
  if(api.experience==='home-v1'){
   let projection;try{projection=projectRedesignedHome(model);}catch{
    document.getElementById('v2HomeSubtitle').textContent='YOUR HOME';home.innerHTML='<section class="v2-home-v1-attention"><strong>Home could not be refreshed</strong><button type="button" class="secondary" data-v2="lights">Open Lights</button></section>';return;
   }
   const key=JSON.stringify([projection.home,projection.rooms,projection.groups,projection.lights,[...homeOperations.entries()].map(([id,value])=>[id,value.state,value.phase,value.message,value.safeToRetry])]);
   if(!force&&key===lastHome)return;lastHome=key;
   const focused=homeFocusRequest||(home.contains(document.activeElement)?{action:document.activeElement.dataset.v2,id:document.activeElement.dataset.id,power:document.activeElement.dataset.power}:null);
   renderRedesignedHome(model,projection);
    if(focused?.action){const controls=[...home.querySelectorAll('[data-v2]')],replacement=controls.find(button=>button.dataset.v2===focused.action&&button.dataset.id===focused.id&&(!focused.power||button.dataset.power===focused.power)&&!button.disabled)||controls.find(button=>button.dataset.id===focused.id&&['home-power','home-check'].includes(button.dataset.v2)&&!button.disabled)||controls.find(button=>button.dataset.id===focused.id&&['open-lamp','open-group'].includes(button.dataset.v2)&&!button.disabled);replacement?.focus({preventScroll:true});}
   return;
  }
  const heroLamp=lamps.find(lamp=>lamp.id===model.selected?.id)||lamps[0],heroStyle=lampDrawingStyle(heroLamp);
  const key=JSON.stringify([heroLamp?.id,heroStyle,lamps.map(l=>[l.id,l.name,l.room,l.firmwareVersion,lampDrawingStyle(l),model.statuses?.[l.id]?.lighting?.power,model.statuses?.[l.id]?.lighting?.fresh]),groups.map(g=>[g.id,g.name,g.followers?.length,g.available,g.pendingRemovalIds?.length]),model.connected,preferences.rooms,preferences.groups]);
  if(!force&&key===lastHome)return;lastHome=key;
  const focused=home.contains(document.activeElement)?{action:document.activeElement.dataset.v2,id:document.activeElement.dataset.id}:null;
  document.getElementById('v2HomeSubtitle').textContent=lamps.length?`${lamps.length} ${lamps.length===1?'lamp':'lamps'} · Your home`:'Make room for a little light';
  home.innerHTML=lamps.length?`<section class="v2-hero"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>A softer<br>kind of evening.</h2><p>Your light. Your way.</p><button data-v2="choose-light">Find your feeling ${icon('arrow')}</button></div>${lampDrawing(heroStyle)}</section><div class="v2-section-title"><h2>Your groups</h2><button class="text-button" data-v2="create-group">+ New group</button></div><div class="v2-home-groups">${groups.length?groups.map(g=>`<div class="v2-home-group-card"><button class="v2-home-group" data-v2="open-group" data-id="${esc(g.id)}"><span class="v2-group-art" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>${esc(groupName(g.id,g.name))}</strong><small>${1+(g.followers?.length||0)} ${(g.followers?.length||0)===0?'lamp':'lamps'} · ${g.available?'Ready to control':'Waiting for a connection'}${g.pendingRemovalIds?.length?' · Removal needs attention':''}</small></span>${icon('arrow')}</button><button type="button" class="secondary v2-home-group-add" data-v2="add-group-lamps" data-id="${esc(g.id)}" aria-label="Add lamps to ${esc(groupName(g.id,g.name))}">Add lamps</button></div>`).join(''):'<div class="v2-empty-small"><p>Your lamps work individually. Bring two or more together whenever you like.</p></div>'}</div><div class="v2-section-title"><h2>Individual lamps</h2><button class="text-button" data-v2="lamps">View all</button></div><div class="v2-individual-list">${independent.length?independent.map(l=>`<button data-v2="open-lamp" data-id="${esc(l.id)}">${lampDrawing(lampDrawingStyle(l))}<span><strong>${esc(l.name||'CoolLamp')}</strong><small>${esc(room(l.id))} · Tap to control</small></span>${icon('arrow')}</button>`).join(''):'<p class="hint">Your lamps are playing in groups. Open a group to control them.</p>'}</div><button class="v2-care-card" data-v2="updates">${icon('check')}<span><strong>A little care, handled for you.</strong><small>Updates and automatic update preferences</small></span>${icon('arrow')}</button>`:`<section class="v2-welcome">${lampDrawing('unspecified')}<p class="eyebrow">WELCOME TO COOLLAMP</p><h2>A little light.<br>A lovely beginning.</h2><p>Add your first lamp. We’ll take you through it, one simple step at a time.</p><button data-v2="add">Add your first lamp</button><button class="secondary" data-v2="discover">Find lamps already at home</button></section>`;
  for(const button of home.querySelectorAll('[data-v2="open-group"],[data-v2="open-lamp"]')){
    const id=button.dataset.id,observed=model.statuses?.[id],group=groups.find(g=>g.id===id),entry=lamps.find(l=>l.id===id);
    if(!observed?.lighting?.fresh||!observed?.group?.fresh||!entry)continue;
    const wrapper=document.createElement('div');wrapper.className='v2-home-power-row';button.replaceWith(wrapper);wrapper.append(button);
    const power=document.createElement('button');power.type='button';power.className='v2-home-power';power.dataset.v2='power';power.dataset.id=id;power.setAttribute('aria-pressed',String(observed.lighting.power));power.setAttribute('aria-label',(observed.lighting.power?'Turn off ':'Turn on ')+(group?groupName(id,group.name):entry.name));power.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 5a8 8 0 1 0 10 0"/></svg>';wrapper.append(power);
  }
  if(focused?.action){const replacement=[...home.querySelectorAll('[data-v2]')].find(button=>button.dataset.v2===focused.action&&button.dataset.id===focused.id);replacement?.focus({preventScroll:true});}
 }
 function renderLights(model,force=false){
  if(!lights)return;
  const view=buildLightsOverview(model,{rooms:preferences.rooms,groupNames:preferences.groups});
  const key=JSON.stringify([homeContext.activeHomeId,homeContext.active.name,view.rooms.map(row=>[row.name,row.devices.map(device=>device.id)]),view.groups,view.devices.map(device=>[device.id,device.name,device.room,lampDrawingStyle(device)])]);
  if(!force&&key===lastLights)return;lastLights=key;
  document.getElementById('v2LightsHome').textContent=homeContext.active.name.toUpperCase();
  const roomCards=view.rooms.map(row=>`<button type="button" class="v2-room-card" data-v2="open-room" data-room="${esc(row.name)}"><span><strong>${esc(row.name)}</strong><small>${row.devices.length} ${row.devices.length===1?'light':'lights'}</small></span>${icon('arrow')}</button>`).join('');
  const groupCards=view.groups.map(group=>`<div class="v2-play-card"><button type="button" data-v2="open-group" data-id="${esc(group.id)}"><span><strong>${esc(group.name)}</strong><small>${group.count} ${group.count===1?'light':'lights'} playing together${group.separate?` · ${group.separate} separate`:''}${group.available?'':' · Last known group'}${group.attention?' · Needs attention':''}</small></span>${icon('arrow')}</button><button type="button" class="secondary" data-v2="add-group-lamps" data-id="${esc(group.id)}">Add lights</button></div>`).join('');
  const deviceCards=view.devices.map(device=>`<button type="button" data-v2="open-lamp" data-id="${esc(device.id)}">${lampDrawing(lampDrawingStyle(device))}<span><strong>${esc(device.name)}</strong><small>${esc(device.room)}${device.kind==='strip'?' · Strip':''}</small></span>${icon('arrow')}</button>`).join('');
  lights.innerHTML=view.devices.length?`<div class="v2-overview-heading"><p>ROOMS</p></div><div class="v2-room-grid">${roomCards}</div><div class="v2-overview-heading"><p>PLAY TOGETHER</p><button type="button" class="text-button" data-v2="create-group">+ New group</button></div><div class="v2-play-list">${groupCards||'<p class="hint">Create a group when two or more lights should share an effect.</p>'}</div><div class="v2-overview-heading"><p>INDIVIDUAL</p></div><div class="v2-individual-list">${deviceCards}</div><button type="button" class="secondary v2-device-care-link" data-v2="devices">Device setup &amp; maintenance</button>`:`<section class="v2-welcome v2-lights-empty">${lampDrawing('unspecified')}<h3>Add your first light</h3><p>We’ll help identify it, name it, and place it in a room.</p><button type="button" data-v2="add">Add a light</button></section>`;
 }
 function renderAutomations(model,force=false){
  if(!automations)return;
  const view=automationPresentation(model.automations),key=JSON.stringify([homeContext.activeHomeId,view]);if(!force&&key===lastAutomations)return;lastAutomations=key;
  document.getElementById('v2AutomationsHome').textContent=homeContext.active.name.toUpperCase();
  const notice=view.notice?`<section class="v2-automation-notice" data-kind="${esc(view.notice.kind)}" role="status" aria-live="polite" aria-busy="${view.notice.kind==='checking'}">${view.notice.kind==='checking'?'<span class="v2-automation-spinner" aria-hidden="true"></span>':''}<div><strong>${esc(view.notice.title)}</strong>${view.notice.detail?`<p>${esc(view.notice.detail)}</p>`:''}</div>${view.notice.action?`<button type="button" class="secondary" data-v2="${esc(view.notice.action.id)}">${esc(view.notice.action.label)}</button>`:''}</section>`:'';
  const upNext=view.next?`<section class="v2-automation-next"><p class="eyebrow">UP NEXT</p><strong>${esc(view.next.label)}</strong></section>`:'';
  const schedules=view.schedules.map(schedule=>{
   const action=schedule.action?`<button type="button" class="secondary" data-v2="${esc(schedule.action.id)}">${esc(schedule.action.label)}</button>`:'';
   return `<article class="v2-automation-row" data-state="${esc(schedule.state)}"><span><strong>${esc(schedule.name)}</strong><small>${esc(schedule.detail)}${schedule.next&&schedule.state==='on'?` · Next: ${esc(schedule.next.label)}`:''}</small></span><span class="v2-automation-chip">${esc(schedule.status)}</span>${action}</article>`;
  }).join('');
  const empty=view.empty?`<section class="v2-automation-empty"><h3>${esc(view.empty.title)}</h3><p>${esc(view.empty.detail)}</p></section>`:'';
  automations.innerHTML=`${notice}${upNext}${schedules?`<div class="v2-overview-heading"><p>SCHEDULES</p></div><div class="v2-automation-list">${schedules}</div>`:''}${empty}`;
 }
 function peopleNoticeAction(action){
  if(!action)return '';
  if(['retry','check-again'].includes(action.id)&&typeof api.refreshPeopleAccess==='function')return `<button type="button" class="secondary" data-v2="people-access-retry">${esc(action.label)}</button>`;
  return '';
 }
 function renderPeopleAccess(model,force=false){
  if(!peopleAccess)return;
  let view;try{view=compilePeopleAccess(model.peopleAccess);}catch{
   view=compilePeopleAccess({version:1,state:'failed',home:{id:null,name:homeContext.active.name},viewer:null,people:[],invitations:[],pendingTargets:[],activity:null});
  }
  const key=JSON.stringify(view);if(!force&&key===lastPeopleAccess)return;lastPeopleAccess=key;peopleAccessView=view;
  const focused=peopleAccess.contains(document.activeElement)?{action:document.activeElement.dataset.v2,id:document.activeElement.dataset.personId}:null;
  document.getElementById('v2PeopleAccessHome').textContent=view.home.name.toUpperCase();
   const notice=view.notice?`<section class="v2-people-notice" data-kind="${esc(view.notice.kind)}" role="status" aria-live="polite" aria-atomic="true" aria-busy="${view.notice.busy}">${view.notice.busy?'<span class="v2-automation-spinner" aria-hidden="true"></span>':''}<div><strong>${esc(view.notice.title)}</strong>${view.notice.detail?`<p>${esc(view.notice.detail)}</p>`:''}</div>${peopleNoticeAction(view.notice.action)}${view.notice.followUps?.length?`<div class="v2-people-follow-ups">${view.notice.followUps.map(item=>`<div><p>${esc(item.message)}</p>${item.action?.id==='open-devices'?`<button type="button" class="secondary" data-v2="people-access-devices">${esc(item.action.label)}</button>`:''}</div>`).join('')}</div>`:''}</section>`:'';
   const invite='';
  const invitations=view.invitations.length?`<div class="v2-overview-heading"><p>INVITATIONS</p></div><div class="v2-people-list">${view.invitations.map(row=>`<article class="v2-person-row"><span><strong>${esc(row.recipientName)}</strong><small>${esc(row.status)} · ${esc(row.detail)}</small></span></article>`).join('')}</div>`:'';
  const people=view.people.length?`<div class="v2-overview-heading"><p>PEOPLE</p></div><div class="v2-people-list">${view.people.map(row=>`<button type="button" class="v2-person-row" data-v2="people-person" data-person-id="${esc(row.id)}" aria-label="${esc(row.action.accessibleLabel)}"><span><strong>${esc(row.name)}${row.isCurrent?' · You':''}</strong><small>${esc(row.roleLabel)} · ${esc(row.summary)}</small></span>${icon('arrow')}</button>`).join('')}</div>`:'';
  const empty=view.empty?`<section class="v2-people-empty"><h3>${esc(view.empty.title)}</h3><p>${esc(view.empty.detail)}</p></section>`:'';
  peopleAccess.innerHTML=`${notice}${invite}${invitations}${people}${empty}`;
  if(focused){peopleAccess.querySelector(`[data-v2="${focused.action}"][data-person-id="${focused.id}"]`)?.focus({preventScroll:true});}
 }
 function openPersonAccess(personId){
  const row=peopleAccessView?.people.find(value=>value.id===personId);if(!row){api.message('This person is no longer listed for this Home.');return;}
   const phones=row.phones.map(phone=>`<article class="v2-phone-row"><span><strong>${esc(phone.name)}</strong><small>${esc(phone.detail)}</small></span></article>`).join('')||'<p class="hint">No active phones are listed.</p>';
   const remove='';
  sheet(row.name+(row.isCurrent?' · You':''),`<p><strong>${esc(row.roleLabel)}</strong></p><p>${esc(row.summary)}</p><div class="v2-overview-heading"><p>PHONES</p></div><div class="v2-phone-list">${phones}</div>${remove}`);
 }
 function openRoom(name){
  const view=buildLightsOverview(api.model(),{rooms:preferences.rooms,groupNames:preferences.groups}),row=view.rooms.find(value=>value.name===name);if(!row){api.message('This room is no longer available.');return;}
  sheet(name,`<p>Rooms help you find lights. A room does not silently turn them into a synchronized group.</p>${row.devices.map(device=>`<button class="v2-choice" type="button" data-v2="select-settings" data-section="lighting" data-id="${esc(device.id)}"><strong>${esc(device.name||'CoolLamp')}</strong><small>Open light controls</small>${icon('arrow')}</button>`).join('')}<button type="button" class="secondary" data-v2="create-group">Make lights play together</button>`);
 }
 function chooseLight(section='lighting'){
  const model=api.model(),copy={
   lighting:['Choose a light','Choose the light you want to control.'],overview:['Choose a lamp to manage','Choose the lamp whose name, room or general settings you want to manage.'],
   network:["Choose a lamp’s Wi-Fi",'Choose the lamp whose home Wi-Fi connection you want to view or change.'],design:['Choose a lamp design','Choose the lamp whose physical design you want to view.'],
   hardware:['Choose a custom lamp','Choose the lamp whose builder-only strip and hardware settings you want to inspect.'],updates:['Choose a lamp to update','Choose the lamp whose installed software you want to check.']
  }[section]||['Choose a lamp','Choose the lamp you want to open.'];
  sheet(copy[0],`<p>${esc(copy[1])}</p>${section==='lighting'?(model.groups||[]).map(g=>`<button class="v2-choice" data-v2="open-group" data-id="${esc(g.id)}"><strong>${esc(groupName(g.id,g.name))}</strong><small>Shared group lighting</small>${icon('arrow')}</button>`).join(''):''}${(model.lamps||[]).map(l=>`<button class="v2-choice" data-v2="select-settings" data-section="${section}" data-id="${esc(l.id)}"><strong>${esc(l.name)}</strong><small>${esc(room(l.id))}</small>${icon('arrow')}</button>`).join('')||'<p>Add a lamp to get started.</p>'}<button class="secondary" data-v2="add">Add a lamp</button>`);
 }
 function openSettings(id,section='overview'){
  if(working||selectionTask)return;
  const target=api.model().lamps?.find(lamp=>lamp.id===id);if(!target){api.message('This lamp is no longer in your inventory.');return;}
  sheet('Lamp settings',`${lampDrawing(lampDrawingStyle(target))}<p>This can take a moment. You can close this window at any time.</p><button type="button" data-v2="select-settings" data-retry="true" data-section="${esc(section)}" data-id="${esc(id)}" hidden>Try again</button>`);
  void selectLight(dialog.querySelector('[data-v2="select-settings"]'));
 }
 function setup(){
  const model=api.model(),target=model.selected?.id===setupId?model.selected:model.lamps?.find(lamp=>lamp.id===setupId),design=target?.lampStyle,designLocked=lampStyleLocked(design),drawingStyle=lampDrawingStyle(target);
  if(setupStep===0)sheet('A little more light',`${lampDrawing(drawingStyle)}<h3>Let’s meet your lamp.</h3><p>Plug it in and keep your phone nearby.</p><button data-v2="setup-next">Get started</button><button class="secondary" data-v2="mesh-setup">Add through another lamp</button><p class="hint">Already set up? <button class="text-button" data-v2="discover">Find lamps on home Wi-Fi</button></p>`);
  else if(setupStep===1)sheet('Make your lamp discoverable',`${lampDrawing(drawingStyle)}<div class="v2-step">1 of 3 · Connect</div><h3>Hold until blue.<br>Then let go.</h3><p>Press the knob for about six seconds. Release as soon as the whole lamp flashes blue.</p><p class="hint">Your phone will show a nearby lamp picker. Choose the lamp in front of you.</p><button data-v2="pair" ${working?'disabled':''}>Find my lamp</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else if(setupNeedsReview)sheet('Let’s check what your lamp kept',`<p>Some setup steps may already be saved. Open this lamp’s settings to see its current choices. We will keep the earlier change unconfirmed and will not repeat it.</p><button data-v2="select-settings" data-id="${esc(setupId)}" data-section="overview">Check this lamp</button><button class="secondary" data-v2="guide-keep-current">Keep current settings and finish the guide</button><button class="text-button" data-v2="close">Finish later</button>`);
  else if(setupStep===2)sheet('Make it yours',`<div class="v2-step">2 of 3 · Name</div><label for="v2SetupName">Lamp name</label><input id="v2SetupName" maxlength="48" value="${esc(setupName)}" placeholder="e.g. Reading corner" autocomplete="off"><label for="v2SetupRoom">Room</label><input id="v2SetupRoom" maxlength="48" value="${esc(setupRoom)}" autocomplete="off">${designLocked?`<p><strong>Lamp design: ${esc(lampDesignLabel(design))}</strong></p><p class="hint">This physical design is set at the factory.</p>`:`<label for="v2SetupStyle">Lamp design</label><select id="v2SetupStyle"><option value="helix">Helix</option><option value="large-helix">Large helix</option><option value="corkscrew">Corkscrew</option><option value="edison">Edison</option><option value="sonata">Sonata</option>${!['helix','large-helix','corkscrew','edison','sonata'].includes(setupStyle)?`<option value="${esc(setupStyle)}">Keep this lamp’s current design</option>`:''}</select>`}<p class="hint">Your existing hardware settings stay as configured.</p><button data-v2="setup-save">Continue</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else sheet('Your lamp is ready',`<div class="v2-step">3 of 3 · Ready</div><div class="v2-success">${icon('check')}</div><h3>Hello, ${esc(setupName)}.</h3><p>You can start using it now. Home Wi-Fi lets your lamp stay connected without your phone nearby.</p><label class="check"><input id="v2SetupAutomatic" type="checkbox" ${setupAutomatic?'checked':''}>Keep this lamp up to date automatically</label><p class="hint">${setupAutomaticKnown?'You can change this later.':'Keep its current preference unless you choose to turn automatic updates on.'} Phone transfers need you nearby with the app open.</p><button data-v2="setup-wifi">Connect to home Wi-Fi</button><button class="secondary" data-v2="setup-done">Start using my lamp</button>`);
  if(setupStep===2&&!setupNeedsReview&&!designLocked)document.getElementById('v2SetupStyle').value=setupStyle;
 }
 function beginSetup(){++guideGeneration;setupStep=0;setupName='';setupRoom='Living room';setupStyle='helix';setupId=null;setupAutomatic=false;setupNeedsReview=false;setup();}
 const helpActions=new Set(['setup','lamps','effects','settings','groups','audio-guide','center-settings','updates']);
 const helpParagraphs=lines=>(lines||[]).map(text=>`<p>${esc(text)}</p>`).join('');
 const helpSteps=lines=>lines?.length?`<ol>${lines.map(text=>`<li>${esc(text)}</li>`).join('')}</ol>`:'';
 const helpSections=sections=>(sections||[]).map(section=>`<section class="v2-help-subsection"><h3>${esc(section.title)}</h3>${helpParagraphs(section.paragraphs)}${helpSteps(section.steps)}</section>`).join('');
 function renderHelp(){
  const content=document.getElementById('v2HelpContent');if(!content)return;
  content.innerHTML=`<section class="panel v2-help-tour"><h3>A quick look around</h3><p>See where to tap, one step at a time. The tour leaves your lamps’ settings alone.</p><button type="button" data-v2="tour">Give me a tour</button><p id="v2TourFeedback" class="hint" role="status" aria-live="polite"></p></section><div class="v2-help-topics">${HELP_TOPICS.map(topic=>`<details class="v2-help-topic" id="help-${esc(topic.id)}"><summary><span><strong>${esc(topic.title)}</strong><small>${esc(topic.summary)}</small></span><span class="v2-help-chevron" aria-hidden="true">›</span></summary><div class="v2-help-content">${helpParagraphs(topic.paragraphs)}${helpSteps(topic.steps)}${helpSections(topic.sections)}${helpParagraphs(topic.paragraphsAfter)}${helpActions.has(topic.action?.id)?`<button type="button" data-v2="help-action" data-help-action="${esc(topic.action.id)}">${esc(topic.action.label)}</button>`:''}</div></details>`).join('')}</div><section class="panel v2-help-guides" aria-labelledby="v2GuideChoice"><h3 id="v2GuideChoice">A little help each time</h3><label class="check"><input id="v2LaterGuides" type="checkbox" ${guide.state.laterGuides?'checked':''}>Offer guided setup when I add more lamps</label><button type="button" class="secondary" data-v2="guide-preference">Save guide preference</button><p class="hint" id="v2GuideFeedback" role="status" aria-live="polite" aria-atomic="true"></p></section>`;
 }
 function endTour(reason='closed'){tour?.close(reason);}
 function beginTour({first=false}={}){
  if(disposed||tourStarting||tour?.active||working||selectionTask)return;
  const model=api.model();
  if(model.tourBlocked||model.connecting||!api.tourNavigate){const message='Please finish the current connection, setup or update, then choose Give me a tour.';const feedback=document.getElementById('v2TourFeedback');if(feedback)feedback.textContent=message;else api.message(message);return;}
  if(dialog.open&&!first)return;
  const originalRoute=['groups','lamps'].includes(route)?'lights':route==='settings'?'app-settings':route,target=model.selected?.id,steps=appTourSteps(model),pages=new Map(steps.map(step=>[step.id,step.page]));
  close();tourStarting=true;
  try{tour=startGuidedTour({steps:steps.map(({page,...step})=>step),onStep:step=>{api.tourNavigate(pages.get(step.id));},
   isCurrent:()=>!disposed&&!working&&!selectionTask&&!api.model().tourBlocked&&!api.model().connecting&&api.model().selected?.id===target,
   onClose:({reason})=>{tour=null;tourStarting=false;if(disposed)return;api.tourNavigate(originalRoute,{active:false});if(first&&['done','skip','escape'].includes(reason))beginSetup();else if(reason!=='navigation'&&!document.hidden)document.querySelector(originalRoute==='help'?'[data-v2="tour"]':'#page-'+(originalRoute==='effects'?'settings':originalRoute)+' h2')?.focus({preventScroll:true});}
  });}catch{tourStarting=false;tour=null;api.tourNavigate(originalRoute,{active:false});api.message('The tour could not open. You can still read every topic in Help.');}
  finally{tourStarting=false;}
 }
 function help(){close();api.navigate('help');}
 function groupGuide(){sheet('Let your lamps play together',`<p>Choose two or more lamps. One main lamp keeps their effects moving together. If you choose sound effects, it supplies the sound response; the other lamps do not need microphones.</p><p>We’ll check each lamp before creating the group. A lamp that cannot confirm joining stays visible for you to finish later.</p><button data-v2="create-group">Choose my lamps</button><button class="secondary" data-v2="group-guide-skip">Keep them individual</button>`);}
 function offerSecondGuide(){if(guide.second(api.model())){guide.offeredGroup();groupGuide();return true;}return false;}
 function audioGuide(){const steps=[['Let your light respond to sound',guideHelp.audio],['Begin with your usual quiet room','Choose a lamp fitted with a microphone. A sound effect learns the room’s background level as it starts. Quiet sound does not prove that the microphone is absent.'],['Try the sounds you enjoy','Play your usual music or speak at a comfortable volume. Look for a light response that feels comfortable. Other lamps in a group can follow the main lamp’s sound response.'],['Make the response feel right',guideHelp.tuning]];const [title,text]=steps[audioGuideStep];sheet(title,`<div class="v2-step">${audioGuideStep+1} of ${steps.length} · Optional sound guide</div><p>${text}</p>${audioGuideStep<steps.length-1?'<button data-v2="guide-audio-next">Continue</button>':'<button data-v2="choose-light">Choose a lamp and open its sound controls</button>'}<button class="secondary" data-v2="help">Back to Help</button>`);}
 function add(){
  const pending=guide.state.pending,owned=ownedGuideIds(api.model());
  if(pending&&Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(pending.target)){setupId=pending.target;setupStep=2;setupNeedsReview=true;setup();return;}
  if(!guide.state.firstComplete&&owned?.length){const selectedId=api.model().selected?.id,id=owned.includes(selectedId)?selectedId:owned.length===1?owned[0]:null;if(id&&/^[0-9a-f]{12}$/.test(id)){guide.review(id);setupId=id;setupStep=2;setupNeedsReview=true;setup();}else chooseLight('overview');return;}
  if(guide.state.firstComplete&&owned?.length>=2){if(!guide.state.laterGuides){sheet('Connecting your lamp','<p>Keep your lamp powered on and your phone nearby.</p>');void run(directAdd,{stage:'pairing'});return;}sheet('Add a little more light',`<p>Use the familiar setup guide, or connect a lamp and keep its existing choices.</p><button data-v2="guide-add">Use the setup guide</button><button class="secondary" data-v2="add-direct">Connect without the guide</button>`);return;}
  beginSetup();
 }
 async function directAdd(){
  const generation=guideGeneration,result=await api.pair(),model=api.model();if(generation!==guideGeneration)return;if(!confirmedGuideTarget(model,result))throw Error('The lamp connection was not confirmed. Check your lamps before trying again.');
  close();api.navigate('effects');offerSecondGuide();
 }
 function createGroup(){const model=api.model();sheet('Let your lamps play together',`<label for="v2GroupName">Group name</label><input id="v2GroupName" maxlength="48" placeholder="e.g. Bedroom"><p>Choose at least two lamps. We’ll choose the main lamp and confirm each connection.</p>${(model.available||[]).filter(l=>l.verified&&l.available&&l.role===0&&!l.sync?.membershipLocked).map(l=>`<label class="v2-select-row"><input type="checkbox" name="v2GroupMember" value="${esc(l.id)}"><span><strong>${esc(l.name)}</strong><small>Ready to join</small></span></label>`).join('')||'<p class="hint">Find two independent lamps first. Existing group members can be moved from group management.</p>'}<button data-v2="create-group-save">Create group</button><button class="text-button" data-v2="discover-groups">Find available lamps</button>`);}
 function groupAddCurrent(review){return !disposed&&groupAddReview===review&&dialog.open&&review.generation===guideGeneration;}
 function renderGroupAdd(review){
  if(groupAddReview!==review||disposed)return;
  const model=api.model(),view=groupAddState(model,review.id),currentIncarnation=view.group?.leader?.sync?.incarnation||null;
  if(review.incarnation&&currentIncarnation&&review.incarnation!==currentIncarnation)review.changed=true;
  if(!review.incarnation&&view.group?.available&&view.group.leader?.verified)review.incarnation=currentIncarnation;
  const reason=review.changed?'This group changed. Close this window and open Add lamps again.':view.message;
  const name=groupName(review.id,view.group?.name);
  sheet('Add lamps to '+name,`<p>Choose a lamp to join ${esc(name)}. Keep both lamps powered on. We’ll confirm each addition.</p>${reason?`<p class="inline-notice">${esc(reason)}</p>`:''}${view.group&&(!view.group.available||!view.group.leader?.verified)?`<button type="button" class="secondary" data-v2="group-add-connect" data-group-id="${esc(review.id)}" data-id="${esc(review.id)}">Connect main lamp</button>`:''}${review.notice?`<p role="status">${esc(review.notice)}</p>`:''}${review.effectTarget?`<button type="button" class="secondary" data-v2="open-lamp" data-id="${esc(review.effectTarget)}" data-section="lighting">Choose a shared effect</button>`:''}<div class="v2-group-add-list">${view.candidates.map(({lamp,row,ready,reason:lampReason})=>{const pending=review.unconfirmed.has(lamp.id),disabled=!ready||Boolean(reason)||pending;return `<div class="v2-group-add-lamp">${lampDrawing(lampDrawingStyle(lamp))}<span><strong>${esc(lamp.name||'Lamp')}</strong><small>${esc(pending?'The last addition was not confirmed. Check connections before trying again.':lampReason)}</small></span><button type="button" data-v2="group-add-one" data-group-id="${esc(review.id)}" data-id="${esc(lamp.id)}" ${disabled?'disabled':''} aria-label="Add ${esc(lamp.name||'lamp')} to ${esc(name)}">Add to group</button>${!row?.available||!row?.verified?`<button type="button" class="secondary" data-v2="group-add-connect" data-group-id="${esc(review.id)}" data-id="${esc(lamp.id)}" aria-label="Connect ${esc(lamp.name||'lamp')}">Connect lamp</button>`:''}</div>`;}).join('')||'<p>All your saved lamps are already in this group.</p>'}</div><button type="button" class="secondary" data-v2="group-add-check" data-id="${esc(review.id)}">Check connections</button><button type="button" class="text-button" data-v2="close">Done</button>`);
 }
 function addGroupLamps(id){
  if(working||selectionTask||disposed)return;
  const view=groupAddState(api.model(),id);if(!view.group){api.message(view.message);return;}
  const review={id,generation:guideGeneration,incarnation:view.group.leader?.sync?.incarnation||null,unconfirmed:new Map(),notice:'',changed:false};groupAddReview=review;renderGroupAdd(review);
  checkGroupAdd(review);
 }
 function checkGroupAdd(review){
  void run(async({isCurrent})=>{await api.refreshGroups();if(!isCurrent()||!groupAddCurrent(review))return;
   for(const [id,seenAt]of review.unconfirmed){const row=api.model().available?.find(value=>value.id===id);if(row?.verified&&row.available&&row.checkedAt>seenAt)review.unconfirmed.delete(id);}
   renderGroupAdd(review);
  },{stage:'checking-groups',cancellable:true});
 }
 function findLamps(groups=false){sheet(groups?'Finding your groups':'Finding your lamps',`<p>Keep your lamps powered on. We’re checking which ones are available.</p><button class="secondary" data-v2="${groups?'discover-groups':'discover'}">Try again</button>`);
   void run(async({isCurrent})=>{await (groups?api.refreshGroups():api.discover());if(!isCurrent())return;close();api.navigate(groups?'groups':'lights');},{stage:groups?'checking-groups':'finding-lamps'});
 }
 document.addEventListener('click',event=>{if(disposed)return;const button=event.target.closest('[data-v2]');if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return;const action=button.dataset.v2;
  if(action==='close'){if(!working||workingTask?.cancellable)close();return;}if(working||selectionTask)return;
  if(action==='tour'||action==='welcome-tour'){beginTour({first:action==='welcome-tour'});}
  else if(action==='welcome-skip'){beginSetup();}
  else if(action==='add'){add();}
  else if(action==='guide-add'){if(guide.state.pending&&Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(guide.state.pending.target))add();else beginSetup();}
  else if(action==='add-direct')void run(directAdd,{stage:'pairing'});
  else if(action==='setup-next'){setupStep++;setup();}
  else if(action==='setup-back'){if(setupStep===2){setupName=document.getElementById('v2SetupName').value;setupRoom=document.getElementById('v2SetupRoom').value;}setupStep=Math.max(0,setupStep-1);setup();}
  else if(action==='pair')void run(async({isCurrent})=>{const generation=guideGeneration,result=await api.pair(),model=api.model();if(generation!==guideGeneration||!isCurrent())return;if(!confirmedGuideTarget(model,result))throw result?.error||Error('Pairing did not finish for your owned lamp. Keep the lamp flashing blue and try again.');setupId=model.selected.id;setupName=model.selected.name||'My lamp';setupStyle=model.selected.lampStyle?.id||model.selected.phoneLampStyle||'helix';setupRoom=model.selected.room||'Living room';setupAutomaticKnown=typeof model.selectedAutomatic==='boolean';setupAutomatic=setupAutomaticInitial=setupAutomaticKnown?model.selectedAutomatic:false;guide.paired(setupId);setupStep=2;setup();},{stage:'pairing'});
  else if(action==='setup-save')void run(async({setStage,isCurrent})=>{if(setupNeedsReview||setupStep!==2)return;setupName=document.getElementById('v2SetupName').value.trim();setupRoom=document.getElementById('v2SetupRoom').value.trim();setupStyle=document.getElementById('v2SetupStyle')?.value??null;if(!setupName)throw Error('Give your lamp a name.');const id=setupId,generation=guideGeneration,roomValue=setupRoom;try{await api.setupDetails({id,name:setupName,room:setupRoom,style:setupStyle,onProgress:setStage});}catch(error){guide.review(id);if(generation!==guideGeneration||!isCurrent())return;setupNeedsReview=true;setup();throw Object.assign(Error('Some choices may already be saved. Choose “Check this lamp” to see what it kept.'),{guideReview:true,uncertain:error.uncertain});}preferences.rooms[id]=roomValue||'My home';guide.details(id);persist();if(generation!==guideGeneration||!isCurrent())return;setupStep=3;setup();},{stage:'saving-details',targetId:setupId});
  else if(action==='setup-done'||action==='setup-wifi')void run(async({setStage,isCurrent})=>{setupAutomatic=Boolean(document.getElementById('v2SetupAutomatic').checked);const id=setupId,generation=guideGeneration;try{if(setupAutomatic!==setupAutomaticInitial){setStage('saving-preference');await api.setAutomatic(setupAutomatic,id);}}catch(error){guide.review(id);if(generation!==guideGeneration||!isCurrent())return;setupNeedsReview=true;setup();throw Object.assign(Error('Your name and room were kept. We could not confirm the update preference. Choose “Check this lamp” to see its current choice.'),{guideReview:true,uncertain:error.uncertain});}guide.complete(id);if(generation!==guideGeneration||!isCurrent())return;close();api.navigate(action==='setup-wifi'?'settings':'effects',action==='setup-wifi'?'network':'lighting');if(action==='setup-done')offerSecondGuide();},{stage:'finishing-setup',targetId:setupId});
  else if(action==='guide-keep-current'){if(Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(setupId)){guide.complete(setupId);setupNeedsReview=false;close();api.message('The guide is finished. The earlier save remains unconfirmed until the lamp’s settings are checked.');}}
  else if(action==='mesh-setup'){close();api.navigate('lamps');api.findNewLamps();api.message('Keep the new lamp near one you already own. New lamps appear above your inventory.');}
  else if(action==='discover'){findLamps();}
  else if(action==='discover-groups'){findLamps(true);}
   else if(action==='lamps'||action==='lights'){close();api.navigate('lights');}
   else if(action==='devices'){close();api.navigate('lamps');}
   else if(action==='people-access'){close();api.navigate('people-access');}
   else if(action==='back-settings'){close();api.navigate('app-settings');}
    else if(action==='people-access-retry'){void api.refreshPeopleAccess?.();}
    else if(action==='people-access-devices'){close();api.navigate('lamps');}
   else if(action==='people-person'){openPersonAccess(button.dataset.personId);}
   else if(action==='open-room'){openRoom(button.dataset.room);}
  else if(action==='choose-light'){chooseLight();}
  else if(action==='open-lamp'||action==='select-settings'){if(!dialog.open)chooseLight(button.dataset.section||'lighting');const choice=[...dialog.querySelectorAll('[data-v2="select-settings"]')].find(value=>value.dataset.id===button.dataset.id)||button;void selectLight(choice);}
  else if(action==='open-group'){close();api.navigate('groups');void api.openGroup(button.dataset.id);}
  else if(action==='add-group-lamps'){addGroupLamps(button.dataset.id);}
  else if(action==='group-add-check'){const review=groupAddReview;if(review?.id===button.dataset.id)checkGroupAdd(review);}
  else if(action==='group-add-connect'){
   const review=groupAddReview,id=button.dataset.id;if(!review||review.id!==button.dataset.groupId||!groupAddCurrent(review))return;
   const view=groupAddState(api.model(),review.id);if(id!==review.id&&!view.candidates.some(value=>value.lamp.id===id))return;
   const controller=new AbortController();
   void run(async({isCurrent})=>{const current=()=>isCurrent()&&groupAddCurrent(review);
    try{const result=await api.select(id,'overview',{signal:controller.signal,isCurrent:current});if(!current())return;
     if(!result?.connected||result.id&&result.id!==id)throw result?.error||Error('This lamp did not confirm its connection. Open Lamps and reconnect it, then return to Add lamps.');
     await api.refreshGroups();if(current())renderGroupAdd(review);
    }catch(error){if(current()){review.notice=error.message||'Open Lamps and reconnect this lamp, then return to Add lamps.';renderGroupAdd(review);}throw error;}
    finally{controller.abort();}
   },{stage:'pairing',cancellable:true,onCancel:()=>controller.abort()});
  }
  else if(action==='group-add-one'){
   const review=groupAddReview,id=button.dataset.id;if(!review||review.id!==button.dataset.groupId||!groupAddCurrent(review))return;
   const view=groupAddState(api.model(),review.id),candidate=view.candidates.find(value=>value.lamp.id===id);
   if(review.incarnation&&view.group?.leader?.sync?.incarnation&&review.incarnation!==view.group.leader.sync.incarnation)review.changed=true;
   if(review.changed||view.message||!candidate?.ready||review.unconfirmed.has(id)){renderGroupAdd(review);return;}
   void run(async({isCurrent})=>{const current=()=>isCurrent()&&groupAddCurrent(review);
    try{const result=await api.addGroupLamp(id,review.id,{isCurrent:current,expectedIncarnation:review.incarnation});if(!current())return;
     if(!['joined','already-member'].includes(result?.phase))throw Object.assign(Error('This lamp has not confirmed joining. Check connections before trying again.'),{uncertain:true});
     review.notice=(candidate.lamp.name||'Lamp')+' added.'+(result.active?'':' It will follow when the main lamp is reachable.');
    }catch(error){if(current()){review.notice=error.message||'This lamp could not join yet.';if(error.needsSharedEffect)review.effectTarget=error.targetId||id;if(error.uncertain)review.unconfirmed.set(id,candidate.row?.checkedAt||0);}throw error;}
    finally{if(current())renderGroupAdd(review);}
   },{stage:'joining-group'});
  }
   else if(action==='home-power')void runHomePower(button.dataset.id,{kind:button.dataset.homeKind||'device'});
  else if(action==='home-power-set')void runHomePower(button.dataset.id,{kind:button.dataset.homeKind||'device',desired:button.dataset.power==='on'});
   else if(action==='home-check')void runHomePower(button.dataset.id,{readOnly:true,kind:button.dataset.homeKind||'device'});
   else if(action==='power')void run(()=>api.power(button.dataset.id),{stage:'changing-power'});
  else if(action==='create-group'){sheet('Finding your lamps','<p>We’re checking which lamps are ready to play together. This can take a little time when a lamp is out of reach.</p>');void run(async({isCurrent})=>{await api.refreshGroups();if(isCurrent())createGroup();},{stage:'checking-groups'});}
  else if(action==='create-group-save')void run(async({setStage,isCurrent})=>{const name=document.getElementById('v2GroupName').value.trim(),ids=[...dialog.querySelectorAll('[name="v2GroupMember"]:checked')].map(input=>input.value);if(!name)throw Error('Give your group a name.');if(ids.length<2)throw Error('Choose at least two lamps.');const generation=guideGeneration;let result;try{result=await api.createGroup(ids,{onProgress:setStage});}catch(error){if(generation!==guideGeneration||!isCurrent())return;sheet('Let’s check your group',`<p>Some lamps may already be playing together. Open Groups to see which lamps confirmed joining and finish the remaining steps.</p><p>${esc(error.message||'A lamp has not confirmed joining.')}</p><button data-v2="group-guide-review">Check my groups</button><button class="secondary" data-v2="close">Finish later</button>`);throw Object.assign(Error('Choose “Check my groups” to finish the existing group. We will not create it again.'),{guideReview:true,uncertain:error.uncertain});}preferences.groups[result.id]=name;persist();if(generation!==guideGeneration||!isCurrent())return;close();api.navigate('groups');await api.openGroup(result.id);},{stage:'creating-group'});
  else if(action==='updates'){close();api.navigate('lamps');document.getElementById('v2CarePanel').scrollIntoView({block:'start'});}
  else if(action==='lamp-settings'){chooseLight('overview');}
  else if(action==='network'){chooseLight('network');}
  else if(action==='bridges'){close();api.navigate('bridges');}
  else if(action==='retry-automations'){void api.refreshAutomations?.();}
  else if(action==='automation-recovery'){close();api.navigate('bridges');}
  else if(action==='automation-location-help')sheet('Home location needed','<p>Sunset schedules need your Home’s location. This app can safely check an existing schedule, but this version does not change its location.</p><p>Your existing schedule was not changed.</p><button type="button" data-v2="automation-recovery">Open connection settings</button>');
  else if(action==='automation-storage-help')sheet('Schedule recovery','<p>The saved schedule could not be read safely. Keep the display powered on and avoid replacing its schedule until its saved connection has been checked.</p><button type="button" data-v2="automation-recovery">Open connection settings</button>');
  else if(action==='hardware'){chooseLight('hardware');}
  else if(action==='appearance'){chooseLight('design');}
  else if(action==='help'){help();}
  else if(action==='help-action'){
   const key=button.dataset.helpAction;if(!helpActions.has(key))return;
   if(key==='setup'){if(guide.state.pending&&Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(guide.state.pending.target))add();else beginSetup();}
   else if(key==='audio-guide'){audioGuideStep=0;audioGuide();}
   else if(key==='center-settings')chooseLight('hardware');
   else if(key==='effects')chooseLight();
    else{close();api.navigate(key==='settings'?'app-settings':key==='updates'?'lamps':key==='lamps'?'lights':key);if(key==='updates')document.getElementById('v2CarePanel').scrollIntoView({block:'start'});}
  }
  else if(action==='guide-preference'){const kept=guide.setLater(document.getElementById('v2LaterGuides').checked);const feedback=document.getElementById('v2GuideFeedback');if(feedback)feedback.textContent=kept?'Guide preference saved on this phone.':'This phone could not save the guide preference.';else close();}
  else if(action==='guide-group'){groupGuide();}
  else if(action==='group-guide-skip'){guide.offeredGroup();close();}
  else if(action==='group-guide-review'){findLamps(true);}
  else if(action==='guide-center')sheet('Find the center that feels right',`<p>${guideHelp.center}</p><p>Your saved center stays in place until you explicitly save an adjustment.</p><button data-v2="hardware">Open a lamp’s center settings</button><button class="secondary" data-v2="help">Back to Help</button>`);
  else if(action==='guide-audio'){audioGuideStep=0;audioGuide();}
  else if(action==='guide-audio-next'){audioGuideStep=Math.min(3,audioGuideStep+1);audioGuide();}
  else if(action==='help-knob')sheet('A familiar little knob',`<div class="v2-help-row"><strong>Turn</strong><p>Choose another effect.</p></div><div class="v2-help-row"><strong>Click, then turn</strong><p>Adjust brightness.</p></div><div class="v2-help-row"><strong>Double-click, then turn</strong><p>Choose a color.</p></div><div class="v2-help-row"><strong>Triple-click</strong><p>Turn off. Click once to turn back on.</p></div><div class="v2-help-row"><strong>Hold until blue, then release</strong><p>About six seconds · Pair a phone.</p></div><p class="hint">A ten-second hold until red arms reset. Release at blue when pairing.</p><button class="secondary" data-v2="help">Back to Help</button>`);
 });
 dialog.addEventListener('cancel',event=>{if(working&&!workingTask?.cancellable)event.preventDefault();else if(workingTask?.cancellable)close();else cancelSelection();});
 dialog.addEventListener('close',()=>{groupAddReview=null;cancelSelection();});
 document.getElementById('v2Theme').addEventListener('change',event=>{preferences.theme=event.target.value;persist();applyTheme();});
 document.getElementById('v2LampSearch').addEventListener('input',event=>{const query=event.target.value.trim().toLowerCase();document.querySelectorAll('#lampList .lamp-entry').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});});
 const interval=setInterval(()=>refresh(),1000);document.addEventListener('visibilitychange',()=>{if(document.hidden)api.cancelAutomationRefresh?.();else refresh(true);});
 refresh(true);
 function startWelcome(){if(guide.welcome())sheet('Welcome to CoolLamp',`<p>Would you like a quick look around? We’ll point out the buttons and explain what they do. Then we’ll help you add your first lamp.</p><button type="button" data-v2="welcome-tour">Show me around</button><button type="button" class="secondary" data-v2="welcome-skip">Skip tour and set up my lamp</button><p class="hint">You can take the tour later from Help.</p>`);}
 return {groupName,room,refresh,chooseLight,openSettings,addGroupLamps,startWelcome,beginTour,endTour,navigate(name,{tour:tourNavigation=false}={}){
  if(!tourNavigation)endTour('navigation');
  const offerGroup=!tourNavigation&&name==='home'&&!working&&!selectionTask&&!dialog.open&&!api.model().connecting;
  ++guideGeneration;if(dialog.open)close();route=name;document.body.dataset.v2Page=name;
  document.getElementById('v2ScopeButton').hidden=name!=='effects';document.getElementById('v2ScopeButton').textContent=api.model().selected?.name||'Choose a lamp';
  const primary=['settings','groups','lamps','lights','effects'].includes(name)?'lights':['app-settings','people-access','bridges','help'].includes(name)?'app-settings':name;
  document.querySelectorAll('nav [data-page]').forEach(button=>{if(button.dataset.page===primary)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelector('#page-settings .settings-navigation').hidden=name==='effects';if(!tourNavigation&&name==='effects'&&!api.model().connected&&!api.model().connecting)chooseLight();if(name==='help')renderHelp();if(!tourNavigation&&name==='automations')void api.refreshAutomations?.();else if(name!=='automations')api.cancelAutomationRefresh?.();refresh();if(offerGroup)offerSecondGuide();
  },destroy(){disposed=true;endTour('disposed');api.cancelAutomationRefresh?.();api.tourNavigate?.(route,{active:false});++guideGeneration;cancelSelection();clearWorkingPresentation(workingTask);clearInterval(interval);for(const timer of homeOperationTimers.values())clearTimeout(timer);homeOperationTimers.clear();homeOperations.clear();}};
}
