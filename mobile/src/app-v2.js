import './app-v2.css';
import {lampArtworkSvg} from './lamp-artwork.js';
import {resolveLampStyle} from './lamp-style.js';
import {OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp,GUIDE_STORAGE_LIMIT} from './onboarding.js';
import {HELP_TOPICS} from './help.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preferenceWrites=new WeakSet();
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${({home:'<path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/>',lamps:'<path d="M10 3c12 3-7 5 4 8s-6 5-1 8M7 21h10"/>',effects:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 5"/>'})[name]||''}</svg>`;
export function lampDrawing(style='helix'){
 return lampArtworkSvg(style,{className:'v2-lamp-drawing'});
}
export const lampDrawingStyle=lamp=>resolveLampStyle(lamp?.lampStyle,lamp?.phoneLampStyle).id;
export function readAppPreferences(storage){
 try{const raw=storage.getItem('coollamp-app2')||'{}';if(raw.length>GUIDE_STORAGE_LIMIT)throw Error('Preferences too large');const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Unsupported preferences');const value=parsed,result={...value,rooms:value.rooms&&typeof value.rooms==='object'&&!Array.isArray(value.rooms)?value.rooms:{},groups:value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups)?value.groups:{},theme:['light','dark','system'].includes(value.theme)?value.theme:'system'};preferenceWrites.add(result);return result;}catch{return {rooms:{},groups:{},theme:'system'};}
}
export function mountAppV2(api){
 const preferences=readAppPreferences(localStorage),home=document.getElementById('v2HomeContent'),dialog=document.getElementById('v2Dialog');
 let route='home',lastHome='',setupStep=0,setupName='',setupRoom='Living room',setupStyle='helix',setupAutomatic=false,working=false,setupId=null,selectionTask=null,workingTask=null,disposed=false;
 const persist=()=>{try{if(!preferenceWrites.has(preferences))throw Error('Read unavailable');const text=JSON.stringify(preferences);if(text.length>GUIDE_STORAGE_LIMIT)throw Error('Preferences too large');localStorage.setItem('coollamp-app2',text);return true;}catch{api.message('This phone could not remember the guide preferences. Your lamp’s confirmed changes are kept.');return false;}};
 let storedPreferences=true;try{storedPreferences=localStorage.getItem('coollamp-app2')!==null;}catch{}
 const guide=new OnboardingGuide(preferences,persist,{ownedIds:ownedGuideIds(api.model()),stored:storedPreferences});
 let setupNeedsReview=false,guideGeneration=0,audioGuideStep=0,setupAutomaticInitial=false,setupAutomaticKnown=false;
 const room=(id)=>api.model().lamps?.find(l=>l.id===id)?.room||(typeof preferences.rooms[id]==='string'?preferences.rooms[id]:'My home');
 const groupName=(id,fallback)=>typeof preferences.groups[id]==='string'?preferences.groups[id]:fallback||'Lamp group';
 const applyTheme=()=>{document.documentElement.dataset.appTheme=preferences.theme;document.getElementById('v2Theme').value=preferences.theme;};applyTheme();
 function cancelSelection(){const task=selectionTask;if(!task)return;selectionTask=null;task.controller.abort();delete dialog.dataset.selectionLoading;for(const button of dialog.querySelectorAll('[data-v2="select-settings"]'))button.disabled=false;task.button.removeAttribute('aria-busy');if(task.hint)task.hint.textContent=task.originalHint;}
 function clearWorkingPresentation(owner){
  if(!owner)return;
  for(const [control,disabled]of owner.controls)control.disabled=disabled;
  owner.controls.clear();owner.body?.removeAttribute('aria-busy');
  if(owner.presenting){delete dialog.dataset.operationLoading;delete dialog.dataset.operation;owner.presenting=false;}
  if(owner.status){delete owner.status.dataset.operation;if(owner.status.dataset.state==='working'){delete owner.status.dataset.state;owner.status.textContent='';}}
 }
 const close=()=>{cancelSelection();clearWorkingPresentation(workingTask);if(dialog.open)dialog.close();dialog.replaceChildren();};
 function sheet(title,body){cancelSelection();clearWorkingPresentation(workingTask);dialog.innerHTML=`<div class="v2-sheet-title"><h2>${esc(title)}</h2><button type="button" data-v2="close" aria-label="Close">×</button></div><p id="v2DialogStatus" role="status" aria-live="polite" aria-atomic="true"></p><div class="v2-sheet-body">${body}</div>`;if(!dialog.open)dialog.showModal();dialog.querySelector('input,button')?.focus();}
 // Semantic keys are localizable display metadata; only explicit client work
 // selects a stage. They never authorize or replay a lamp operation.
 const workMessages={pairing:'Connecting to your lamp…','saving-details':'Saving your lamp’s name and design…',
  'saving-name':'Saving your lamp’s name…','saving-style':'Saving your lamp’s design…','saving-room':'Remembering its room…',
  'saving-preference':'Saving your update preference…','finishing-setup':'Finishing your setup…',
  'finding-lamps':'Looking for your lamps…','checking-groups':'Checking which lamps can play together…',
  'creating-group':'Connecting your group…','joining-group':'Adding lamps to your group…','checking-group':'Checking your group’s connections…',
  'opening-group':'Opening your group…','changing-power':'Changing your light…'};
 async function run(task,{stage='pairing',targetId=null}={}){
  if(working||disposed)return;
  working=true;const owner={generation:guideGeneration,controls:new Map(),presenting:false,status:null,body:null};workingTask=owner;
  const current=()=>!disposed&&workingTask===owner&&owner.generation===guideGeneration&&(!targetId||api.model().selected?.id===targetId);
  const setStage=key=>{if(!current()||!Object.hasOwn(workMessages,key))return;
   const status=document.getElementById('v2DialogStatus');if(!status||!dialog.open)return;
   owner.status=status;owner.body=dialog.querySelector('.v2-sheet-body');owner.presenting=true;
   dialog.dataset.operationLoading='true';dialog.dataset.operation=key;
   owner.body?.setAttribute('aria-busy','true');
   for(const control of dialog.querySelectorAll('button,input,select')){if(!owner.controls.has(control))owner.controls.set(control,control.disabled);control.disabled=true;}
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
 function refresh(force=false){
  if(document.hidden&&!force)return;
  const model=api.model(),lamps=model.lamps||[],groups=model.groups||[],independent=lamps.filter(l=>!groups.some(g=>g.id===l.id||g.followers?.some(f=>f.id===l.id)));
  const key=JSON.stringify([lamps.map(l=>[l.id,l.name,l.room,l.firmwareVersion,lampDrawingStyle(l),model.statuses?.[l.id]?.lighting?.power,model.statuses?.[l.id]?.lighting?.fresh]),groups.map(g=>[g.id,g.name,g.followers?.length,g.available,g.pendingRemovalIds?.length]),model.connected,preferences.rooms,preferences.groups]);
  if(!force&&key===lastHome)return;lastHome=key;
  const focused=home.contains(document.activeElement)?{action:document.activeElement.dataset.v2,id:document.activeElement.dataset.id}:null;
  document.getElementById('v2HomeSubtitle').textContent=lamps.length?`${lamps.length} ${lamps.length===1?'lamp':'lamps'} · Your home`:'Make room for a little light';
  home.innerHTML=lamps.length?`<section class="v2-hero"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>A softer<br>kind of evening.</h2><p>Your light. Your way.</p><button data-v2="choose-light">Find your feeling ${icon('arrow')}</button></div>${lampDrawing('helix')}</section><div class="v2-section-title"><h2>Your groups</h2><button class="text-button" data-v2="create-group">+ New group</button></div><div class="v2-home-groups">${groups.length?groups.map(g=>`<button class="v2-home-group" data-v2="open-group" data-id="${esc(g.id)}"><span class="v2-group-art" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>${esc(groupName(g.id,g.name))}</strong><small>${1+(g.followers?.length||0)} lamps · ${g.available?'Ready to control':'Waiting for a connection'}${g.pendingRemovalIds?.length?' · Removal needs attention':''}</small></span>${icon('arrow')}</button>`).join(''):'<div class="v2-empty-small"><p>Your lamps work individually. Bring two or more together whenever you like.</p></div>'}</div><div class="v2-section-title"><h2>Individual lamps</h2><button class="text-button" data-v2="lamps">View all</button></div><div class="v2-individual-list">${independent.length?independent.map(l=>`<button data-v2="open-lamp" data-id="${esc(l.id)}">${lampDrawing(lampDrawingStyle(l))}<span><strong>${esc(l.name||'CoolLamp')}</strong><small>${esc(room(l.id))} · Tap to control</small></span>${icon('arrow')}</button>`).join(''):'<p class="hint">Your lamps are playing in groups. Open a group to control them.</p>'}</div><button class="v2-care-card" data-v2="updates">${icon('check')}<span><strong>A little care, handled for you.</strong><small>Updates and automatic update preferences</small></span>${icon('arrow')}</button>`:`<section class="v2-welcome">${lampDrawing('helix')}<p class="eyebrow">WELCOME TO COOLLAMP</p><h2>A little light.<br>A lovely beginning.</h2><p>Add your first lamp. We’ll take you through it, one simple step at a time.</p><button data-v2="add">Add your first lamp</button><button class="secondary" data-v2="discover">Find lamps already at home</button></section><p class="v2-private">Your lamps work locally. No account required.</p>`;
  for(const button of home.querySelectorAll('[data-v2="open-group"],[data-v2="open-lamp"]')){
    const id=button.dataset.id,observed=model.statuses?.[id],group=groups.find(g=>g.id===id),entry=lamps.find(l=>l.id===id);
    if(!observed?.lighting?.fresh||!observed?.group?.fresh||!entry)continue;
    const wrapper=document.createElement('div');wrapper.className='v2-home-power-row';button.replaceWith(wrapper);wrapper.append(button);
    const power=document.createElement('button');power.type='button';power.className='v2-home-power';power.dataset.v2='power';power.dataset.id=id;power.setAttribute('aria-pressed',String(observed.lighting.power));power.setAttribute('aria-label',(observed.lighting.power?'Turn off ':'Turn on ')+(group?groupName(id,group.name):entry.name));power.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M7 5a8 8 0 1 0 10 0"/></svg>';wrapper.append(power);
  }
  if(focused?.action){const replacement=[...home.querySelectorAll('[data-v2]')].find(button=>button.dataset.v2===focused.action&&button.dataset.id===focused.id);replacement?.focus({preventScroll:true});}
  document.getElementById('v2Version').textContent='CoolLamp 2.0.5';
 }
 function chooseLight(section='lighting'){
  const model=api.model();sheet('Choose your lights',`<p>Choose a lamp. We’ll find its best available connection.</p>${section==='lighting'?(model.groups||[]).map(g=>`<button class="v2-choice" data-v2="open-group" data-id="${esc(g.id)}"><strong>${esc(groupName(g.id,g.name))}</strong><small>Shared group lighting</small>${icon('arrow')}</button>`).join(''):''}${(model.lamps||[]).map(l=>`<button class="v2-choice" data-v2="select-settings" data-section="${section}" data-id="${esc(l.id)}"><strong>${esc(l.name)}</strong><small>${esc(room(l.id))}</small>${icon('arrow')}</button>`).join('')||'<p>Add a lamp to get started.</p>'}<button class="secondary" data-v2="add">Add a lamp</button>`);
 }
 function openSettings(id,section='overview'){
  if(working||selectionTask)return;
  const target=api.model().lamps?.find(lamp=>lamp.id===id);if(!target){api.message('This lamp is no longer in your inventory.');return;}
  sheet('Lamp settings',`${lampDrawing(lampDrawingStyle(target))}<p>This can take a moment. You can close this window at any time.</p><button type="button" data-v2="select-settings" data-retry="true" data-section="${esc(section)}" data-id="${esc(id)}" hidden>Try again</button>`);
  void selectLight(dialog.querySelector('[data-v2="select-settings"]'));
 }
 function setup(){
  if(setupStep===0)sheet('A little more light',`${lampDrawing('helix')}<h3>Let’s meet your lamp.</h3><p>Plug it in and keep your phone nearby.</p><button data-v2="setup-next">Get started</button><button class="secondary" data-v2="mesh-setup">Add through another lamp</button><p class="hint">Already set up? <button class="text-button" data-v2="discover">Find lamps on home Wi-Fi</button></p>`);
  else if(setupStep===1)sheet('Make your lamp discoverable',`${lampDrawing('helix')}<div class="v2-step">1 of 3 · Connect</div><h3>Hold until blue.<br>Then let go.</h3><p>Press the knob for about six seconds. Release as soon as the whole lamp flashes blue.</p><p class="hint">Your phone will show a nearby lamp picker. Choose the lamp in front of you.</p><button data-v2="pair" ${working?'disabled':''}>Find my lamp</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else if(setupNeedsReview)sheet('Let’s check what your lamp kept',`<p>Some setup steps may already be saved. Open this lamp’s settings to see its current choices. We will keep the earlier change unconfirmed and will not repeat it.</p><button data-v2="select-settings" data-id="${esc(setupId)}" data-section="overview">Check this lamp</button><button class="secondary" data-v2="guide-keep-current">Keep current settings and finish the guide</button><button class="text-button" data-v2="close">Finish later</button>`);
  else if(setupStep===2)sheet('Make it yours',`<div class="v2-step">2 of 3 · Name</div><label for="v2SetupName">Lamp name</label><input id="v2SetupName" maxlength="32" value="${esc(setupName)}" placeholder="e.g. Reading corner" autocomplete="off"><label for="v2SetupRoom">Room</label><input id="v2SetupRoom" maxlength="48" value="${esc(setupRoom)}" autocomplete="off"><label for="v2SetupStyle">Lamp design</label><select id="v2SetupStyle"><option value="helix">Helix</option><option value="large-helix">Large helix</option><option value="corkscrew">Corkscrew</option>${!['helix','large-helix','corkscrew'].includes(setupStyle)?`<option value="${esc(setupStyle)}">Keep this lamp’s current design</option>`:''}</select><p class="hint">Your existing hardware settings stay as configured.</p><button data-v2="setup-save">Continue</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else sheet('Your lamp is ready',`<div class="v2-step">3 of 3 · Ready</div><div class="v2-success">${icon('check')}</div><h3>Hello, ${esc(setupName)}.</h3><p>You can start using it now. Home Wi-Fi lets your lamp stay connected without your phone nearby.</p><label class="check"><input id="v2SetupAutomatic" type="checkbox" ${setupAutomatic?'checked':''}>Keep this lamp up to date automatically</label><p class="hint">${setupAutomaticKnown?'You can change this later.':'Keep its current preference unless you choose to turn automatic updates on.'} Phone transfers need you nearby with the app open.</p><button data-v2="setup-wifi">Connect to home Wi-Fi</button><button class="secondary" data-v2="setup-done">Start using my lamp</button>`);
  if(setupStep===2&&!setupNeedsReview)document.getElementById('v2SetupStyle').value=setupStyle;
 }
 function beginSetup(){++guideGeneration;setupStep=0;setupName='';setupRoom='Living room';setupStyle='helix';setupId=null;setupAutomatic=false;setupNeedsReview=false;setup();}
 const helpActions=new Set(['setup','lamps','effects','settings','groups','audio-guide','center-settings','updates']);
 function renderHelp(){
  const content=document.getElementById('v2HelpContent');if(!content)return;
  content.innerHTML=`<div class="v2-help-topics">${HELP_TOPICS.map(topic=>`<details class="v2-help-topic" id="help-${esc(topic.id)}"><summary><span><strong>${esc(topic.title)}</strong><small>${esc(topic.summary)}</small></span><span class="v2-help-chevron" aria-hidden="true">›</span></summary><div class="v2-help-content">${(topic.paragraphs||[]).map(text=>`<p>${esc(text)}</p>`).join('')}${topic.steps?.length?`<ol>${topic.steps.map(text=>`<li>${esc(text)}</li>`).join('')}</ol>`:''}${(topic.paragraphsAfter||[]).map(text=>`<p>${esc(text)}</p>`).join('')}${helpActions.has(topic.action?.id)?`<button type="button" data-v2="help-action" data-help-action="${esc(topic.action.id)}">${esc(topic.action.label)}</button>`:''}</div></details>`).join('')}</div><section class="panel v2-help-guides" aria-labelledby="v2GuideChoice"><h3 id="v2GuideChoice">A little help each time</h3><label class="check"><input id="v2LaterGuides" type="checkbox" ${guide.state.laterGuides?'checked':''}>Offer guided setup when I add more lamps</label><button type="button" class="secondary" data-v2="guide-preference">Save guide preference</button><p class="hint" id="v2GuideFeedback" role="status" aria-live="polite" aria-atomic="true"></p></section>`;
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
 function findLamps(groups=false){sheet(groups?'Finding your groups':'Finding your lamps',`<p>Keep your lamps powered on. We’re checking which ones are available.</p><button class="secondary" data-v2="${groups?'discover-groups':'discover'}">Try again</button>`);
  void run(async({isCurrent})=>{await (groups?api.refreshGroups():api.discover());if(!isCurrent())return;close();api.navigate(groups?'groups':'lamps');},{stage:groups?'checking-groups':'finding-lamps'});
 }
 document.addEventListener('click',event=>{if(disposed)return;const button=event.target.closest('[data-v2]');if(!button)return;const action=button.dataset.v2;
  if(action==='close'){if(!working)close();return;}if(working||selectionTask)return;
  if(action==='add'){add();}
  else if(action==='guide-add'){if(guide.state.pending&&Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(guide.state.pending.target))add();else beginSetup();}
  else if(action==='add-direct')void run(directAdd,{stage:'pairing'});
  else if(action==='setup-next'){setupStep++;setup();}
  else if(action==='setup-back'){if(setupStep===2){setupName=document.getElementById('v2SetupName').value;setupRoom=document.getElementById('v2SetupRoom').value;}setupStep=Math.max(0,setupStep-1);setup();}
  else if(action==='pair')void run(async({isCurrent})=>{const generation=guideGeneration,result=await api.pair(),model=api.model();if(generation!==guideGeneration||!isCurrent())return;if(!confirmedGuideTarget(model,result))throw result?.error||Error('Pairing did not finish for your owned lamp. Keep the lamp flashing blue and try again.');setupId=model.selected.id;setupName=model.selected.name||'My lamp';setupStyle=model.selected.lampStyle?.id||model.selected.phoneLampStyle||'helix';setupRoom=model.selected.room||'Living room';setupAutomaticKnown=typeof model.selectedAutomatic==='boolean';setupAutomatic=setupAutomaticInitial=setupAutomaticKnown?model.selectedAutomatic:false;guide.paired(setupId);setupStep=2;setup();},{stage:'pairing'});
  else if(action==='setup-save')void run(async({setStage,isCurrent})=>{setupName=document.getElementById('v2SetupName').value.trim();setupRoom=document.getElementById('v2SetupRoom').value.trim();setupStyle=document.getElementById('v2SetupStyle').value;if(!setupName)throw Error('Give your lamp a name.');const id=setupId,generation=guideGeneration,roomValue=setupRoom;try{await api.setupDetails({id,name:setupName,room:setupRoom,style:setupStyle,onProgress:setStage});}catch(error){guide.review(id);if(generation!==guideGeneration||!isCurrent())return;setupNeedsReview=true;setup();throw Object.assign(Error('Some choices may already be saved. Choose “Check this lamp” to see what it kept.'),{guideReview:true,uncertain:error.uncertain});}preferences.rooms[id]=roomValue||'My home';guide.details(id);persist();if(generation!==guideGeneration||!isCurrent())return;setupStep=3;setup();},{stage:'saving-details',targetId:setupId});
  else if(action==='setup-done'||action==='setup-wifi')void run(async({setStage,isCurrent})=>{setupAutomatic=Boolean(document.getElementById('v2SetupAutomatic').checked);const id=setupId,generation=guideGeneration;try{if(setupAutomatic!==setupAutomaticInitial){setStage('saving-preference');await api.setAutomatic(setupAutomatic,id);}}catch(error){guide.review(id);if(generation!==guideGeneration||!isCurrent())return;setupNeedsReview=true;setup();throw Object.assign(Error('Your name and room were kept. We could not confirm the update preference. Choose “Check this lamp” to see its current choice.'),{guideReview:true,uncertain:error.uncertain});}guide.complete(id);if(generation!==guideGeneration||!isCurrent())return;close();api.navigate(action==='setup-wifi'?'settings':'effects',action==='setup-wifi'?'network':'lighting');if(action==='setup-done')offerSecondGuide();},{stage:'finishing-setup',targetId:setupId});
  else if(action==='guide-keep-current'){if(Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(setupId)){guide.complete(setupId);setupNeedsReview=false;close();api.message('The guide is finished. The earlier save remains unconfirmed until the lamp’s settings are checked.');}}
  else if(action==='mesh-setup'){close();api.navigate('lamps');api.findNewLamps();api.message('Keep the new lamp near one you already own. New lamps appear above your inventory.');}
  else if(action==='discover'){findLamps();}
  else if(action==='discover-groups'){findLamps(true);}
  else if(action==='lamps'){close();api.navigate('lamps');}
  else if(action==='choose-light'){chooseLight();}
  else if(action==='open-lamp'||action==='select-settings'){if(!dialog.open)chooseLight(button.dataset.section||'lighting');const choice=[...dialog.querySelectorAll('[data-v2="select-settings"]')].find(value=>value.dataset.id===button.dataset.id)||button;void selectLight(choice);}
  else if(action==='open-group'){close();api.navigate('groups');void api.openGroup(button.dataset.id);}
  else if(action==='power')void run(()=>api.power(button.dataset.id),{stage:'changing-power'});
  else if(action==='create-group'){sheet('Finding your lamps','<p>We’re checking which lamps are ready to play together. This can take a little time when a lamp is out of reach.</p>');void run(async({isCurrent})=>{await api.refreshGroups();if(isCurrent())createGroup();},{stage:'checking-groups'});}
  else if(action==='create-group-save')void run(async({setStage,isCurrent})=>{const name=document.getElementById('v2GroupName').value.trim(),ids=[...dialog.querySelectorAll('[name="v2GroupMember"]:checked')].map(input=>input.value);if(!name)throw Error('Give your group a name.');if(ids.length<2)throw Error('Choose at least two lamps.');const generation=guideGeneration;let result;try{result=await api.createGroup(ids,{onProgress:setStage});}catch(error){if(generation!==guideGeneration||!isCurrent())return;sheet('Let’s check your group',`<p>Some lamps may already be playing together. Open Groups to see which lamps confirmed joining and finish the remaining steps.</p><p>${esc(error.message||'A lamp has not confirmed joining.')}</p><button data-v2="group-guide-review">Check my groups</button><button class="secondary" data-v2="close">Finish later</button>`);throw Object.assign(Error('Choose “Check my groups” to finish the existing group. We will not create it again.'),{guideReview:true,uncertain:error.uncertain});}preferences.groups[result.id]=name;persist();if(generation!==guideGeneration||!isCurrent())return;close();api.navigate('groups');await api.openGroup(result.id);},{stage:'creating-group'});
  else if(action==='updates'){close();api.navigate('lamps');document.getElementById('v2CarePanel').scrollIntoView({block:'start'});}
  else if(action==='lamp-settings'){chooseLight('overview');}
  else if(action==='network'){chooseLight('network');}
  else if(action==='hardware'){chooseLight('hardware');}
  else if(action==='appearance'){chooseLight('design');}
  else if(action==='help'){help();}
  else if(action==='help-action'){
   const key=button.dataset.helpAction;if(!helpActions.has(key))return;
   if(key==='setup'){if(guide.state.pending&&Array.isArray(api.model().ownedLampIds)&&api.model().ownedLampIds.includes(guide.state.pending.target))add();else beginSetup();}
   else if(key==='audio-guide'){audioGuideStep=0;audioGuide();}
   else if(key==='center-settings')chooseLight('hardware');
   else if(key==='effects')chooseLight();
   else{close();api.navigate(key==='settings'?'app-settings':key==='updates'?'lamps':key);if(key==='updates')document.getElementById('v2CarePanel').scrollIntoView({block:'start'});}
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
 dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else cancelSelection();});
 dialog.addEventListener('close',()=>cancelSelection());
 document.getElementById('v2Theme').addEventListener('change',event=>{preferences.theme=event.target.value;persist();applyTheme();});
 document.getElementById('v2LampSearch').addEventListener('input',event=>{const query=event.target.value.trim().toLowerCase();document.querySelectorAll('#lampList .lamp-entry').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});});
 const interval=setInterval(()=>refresh(),1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
 refresh(true);
 function startWelcome(){if(guide.welcome())beginSetup();}
 return {groupName,room,refresh,chooseLight,openSettings,startWelcome,navigate(name){const offerGroup=name==='home'&&!working&&!selectionTask&&!dialog.open&&!api.model().connecting;++guideGeneration;if(dialog.open)close();route=name;document.body.dataset.v2Page=name;document.getElementById('v2ScopeButton').hidden=name!=='effects';document.getElementById('v2ScopeButton').textContent=api.model().selected?.name||'Choose a lamp';document.querySelectorAll('nav [data-page]').forEach(button=>{if(button.dataset.page===(['settings','app-settings'].includes(name)?'app-settings':name==='groups'?'home':name))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});document.querySelector('#page-settings .settings-navigation').hidden=name==='effects';if(name==='effects'&&!api.model().connected&&!api.model().connecting)chooseLight();if(name==='help')renderHelp();refresh();if(offerGroup)offerSecondGuide();},destroy(){disposed=true;++guideGeneration;cancelSelection();clearWorkingPresentation(workingTask);clearInterval(interval);}};
}
