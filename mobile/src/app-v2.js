import './app-v2.css';
import {lampArtworkSvg} from './lamp-artwork.js';
import {resolveLampStyle} from './lamp-style.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${({home:'<path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/>',lamps:'<path d="M10 3c12 3-7 5 4 8s-6 5-1 8M7 21h10"/>',effects:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 5"/>'})[name]||''}</svg>`;
export function lampDrawing(style='helix'){
 return lampArtworkSvg(style,{className:'v2-lamp-drawing'});
}
export const lampDrawingStyle=lamp=>resolveLampStyle(lamp?.lampStyle,lamp?.phoneLampStyle).id;
export function readAppPreferences(storage){
 try{const value=JSON.parse(storage.getItem('coollamp-app2')||'{}');return {rooms:value.rooms&&typeof value.rooms==='object'&&!Array.isArray(value.rooms)?value.rooms:{},groups:value.groups&&typeof value.groups==='object'&&!Array.isArray(value.groups)?value.groups:{},theme:['light','dark','system'].includes(value.theme)?value.theme:'system'};}catch{return {rooms:{},groups:{},theme:'system'};}
}
export function mountAppV2(api){
 const preferences=readAppPreferences(localStorage),home=document.getElementById('v2HomeContent'),dialog=document.getElementById('v2Dialog');
 let route='home',lastHome='',setupStep=0,setupName='',setupRoom='Living room',setupStyle='helix',setupAutomatic=false,working=false,setupId=null,selectionTask=null;
 const persist=()=>localStorage.setItem('coollamp-app2',JSON.stringify(preferences));
 const room=(id)=>api.model().lamps?.find(l=>l.id===id)?.room||(typeof preferences.rooms[id]==='string'?preferences.rooms[id]:'My home');
 const groupName=(id,fallback)=>typeof preferences.groups[id]==='string'?preferences.groups[id]:fallback||'Lamp group';
 const applyTheme=()=>{document.documentElement.dataset.appTheme=preferences.theme;document.getElementById('v2Theme').value=preferences.theme;};applyTheme();
 function cancelSelection(){const task=selectionTask;if(!task)return;selectionTask=null;task.controller.abort();dialog.removeAttribute('aria-busy');for(const button of dialog.querySelectorAll('[data-v2="select-settings"]'))button.disabled=false;task.button.removeAttribute('aria-busy');if(task.hint)task.hint.textContent=task.originalHint;}
 const close=()=>{cancelSelection();if(dialog.open)dialog.close();dialog.replaceChildren();};
 function sheet(title,body){cancelSelection();dialog.innerHTML=`<div class="v2-sheet-title"><h2>${esc(title)}</h2><button type="button" data-v2="close" aria-label="Close">×</button></div><div class="v2-sheet-body">${body}<p id="v2DialogStatus" role="status" aria-live="polite"></p></div>`;if(!dialog.open)dialog.showModal();dialog.querySelector('input,button')?.focus();}
 async function run(task){if(working)return;working=true;dialog.setAttribute('aria-busy','true');try{await task();}catch(error){const message=error.uncertain?'We could not confirm that change. Check the lamp before trying again.':error.message;const target=document.getElementById('v2DialogStatus');if(target)target.textContent=message;api.message(message);}finally{working=false;dialog.removeAttribute('aria-busy');refresh(true);}}
 async function selectLight(button){
  if(working||selectionTask)return;
  const id=button.dataset.id,section=button.dataset.section||'lighting',name=api.model().lamps?.find(lamp=>lamp.id===id)?.name||'your lamp';
  const hint=button.querySelector('small'),task={controller:new AbortController(),button,hint,originalHint:hint?.textContent,timedOut:false};selectionTask=task;
  const current=()=>selectionTask===task&&dialog.open&&!task.controller.signal.aborted;
  const feedback=document.getElementById('v2DialogStatus');if(feedback){feedback.dataset.state='opening';feedback.textContent='Opening '+name+'…';}
  dialog.setAttribute('aria-busy','true');button.setAttribute('aria-busy','true');if(hint)hint.textContent='Opening lamp…';
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
   const message=task.timedOut?'The connection to '+name+' took too long. Bring your phone closer to the lamp and try again.':error.uncertain?'We could not confirm the connection. Please choose your lamp again.':error.message||'We couldn’t open '+name+'. Please try again.';
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
 function setup(){
  if(setupStep===0)sheet('A little more light',`${lampDrawing('helix')}<h3>Let’s meet your lamp.</h3><p>Plug it in and keep your phone nearby.</p><button data-v2="setup-next">Get started</button><button class="secondary" data-v2="mesh-setup">Add through another lamp</button><p class="hint">Already set up? <button class="text-button" data-v2="discover">Find lamps on home Wi-Fi</button></p>`);
  else if(setupStep===1)sheet('Make your lamp discoverable',`${lampDrawing('helix')}<div class="v2-step">1 of 3 · Connect</div><h3>Hold until blue.<br>Then let go.</h3><p>Press the knob for about six seconds. Release as soon as the whole lamp flashes blue.</p><p class="hint">Your phone will show a nearby lamp picker. Choose the lamp in front of you.</p><button data-v2="pair" ${working?'disabled':''}>Find my lamp</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else if(setupStep===2)sheet('Make it yours',`<div class="v2-step">2 of 3 · Name</div><label for="v2SetupName">Lamp name</label><input id="v2SetupName" maxlength="32" value="${esc(setupName)}" placeholder="e.g. Reading corner" autocomplete="off"><label for="v2SetupRoom">Room</label><input id="v2SetupRoom" maxlength="48" value="${esc(setupRoom)}" autocomplete="off"><label for="v2SetupStyle">Lamp design</label><select id="v2SetupStyle"><option value="helix">Helix</option><option value="large-helix">Large helix</option><option value="corkscrew">Corkscrew</option></select><p class="hint">Your existing hardware settings stay as configured.</p><button data-v2="setup-save">Continue</button><button class="text-button" data-v2="setup-back">Back</button>`);
  else sheet('Your lamp is ready',`<div class="v2-step">3 of 3 · Ready</div><div class="v2-success">${icon('check')}</div><h3>Hello, ${esc(setupName)}.</h3><p>You can start using it now. Home Wi-Fi lets your lamp stay connected without your phone nearby.</p><label class="check"><input id="v2SetupAutomatic" type="checkbox" ${setupAutomatic?'checked':''}>Keep this lamp up to date automatically</label><p class="hint">You can change this later. Phone transfers need you nearby with the app open.</p><button data-v2="setup-wifi">Connect to home Wi-Fi</button><button class="secondary" data-v2="setup-done">Start using my lamp</button>`);
  if(setupStep===2)document.getElementById('v2SetupStyle').value=setupStyle;
 }
 function createGroup(){const model=api.model();sheet('Let your lamps play together',`<label for="v2GroupName">Group name</label><input id="v2GroupName" maxlength="48" placeholder="e.g. Bedroom"><p>Choose at least two lamps. We’ll choose the main lamp and confirm each connection.</p>${(model.available||[]).filter(l=>l.verified&&l.available&&l.role===0&&!l.sync?.membershipLocked).map(l=>`<label class="v2-select-row"><input type="checkbox" name="v2GroupMember" value="${esc(l.id)}"><span><strong>${esc(l.name)}</strong><small>Ready to join</small></span></label>`).join('')||'<p class="hint">Find two independent lamps first. Existing group members can be moved from group management.</p>'}<button data-v2="create-group-save">Create group</button><button class="text-button" data-v2="discover-groups">Find available lamps</button>`);}
 document.addEventListener('click',event=>{const button=event.target.closest('[data-v2]');if(!button)return;const action=button.dataset.v2;
  if(action==='close'){if(!working)close();return;}if(working||selectionTask)return;
  if(action==='add'){setupStep=0;setupName='';setupRoom='Living room';setupStyle='helix';setupId=null;setupAutomatic=false;setup();}
  else if(action==='setup-next'){setupStep++;setup();}
  else if(action==='setup-back'){if(setupStep===2){setupName=document.getElementById('v2SetupName').value;setupRoom=document.getElementById('v2SetupRoom').value;}setupStep=Math.max(0,setupStep-1);setup();}
  else if(action==='pair')void run(async()=>{const result=await api.pair();if(!result?.connected)throw result?.error||Error('Pairing did not finish. Keep the lamp flashing blue and try again.');setupId=api.model().selected?.id;setupName=api.model().selected?.name||'My lamp';setupStyle=api.model().selected?.lampStyle?.id||api.model().selected?.phoneLampStyle||'helix';setupRoom=api.model().selected?.room||'Living room';setupStep=2;setup();});
  else if(action==='setup-save')void run(async()=>{setupName=document.getElementById('v2SetupName').value.trim();setupRoom=document.getElementById('v2SetupRoom').value.trim();setupStyle=document.getElementById('v2SetupStyle').value;if(!setupName)throw Error('Give your lamp a name.');await api.setupDetails({id:setupId,name:setupName,room:setupRoom,style:setupStyle});preferences.rooms[setupId]=setupRoom||'My home';persist();setupStep=3;setup();});
  else if(action==='setup-done'||action==='setup-wifi')void run(async()=>{setupAutomatic=document.getElementById('v2SetupAutomatic').checked;await api.setAutomatic(setupAutomatic,setupId);close();api.navigate(action==='setup-wifi'?'settings':'effects',action==='setup-wifi'?'network':'lighting');});
  else if(action==='mesh-setup'){close();api.navigate('lamps');api.findNewLamps();api.message('Keep the new lamp near one you already own. New lamps appear above your inventory.');}
  else if(action==='discover'){close();api.navigate('lamps');void api.discover();}
  else if(action==='discover-groups'){close();api.navigate('groups');void api.refreshGroups();}
  else if(action==='lamps'){close();api.navigate('lamps');}
  else if(action==='choose-light'){chooseLight();}
  else if(action==='open-lamp'||action==='select-settings'){if(!dialog.open)chooseLight(button.dataset.section||'lighting');const choice=[...dialog.querySelectorAll('[data-v2="select-settings"]')].find(value=>value.dataset.id===button.dataset.id)||button;void selectLight(choice);}
  else if(action==='open-group'){close();api.navigate('groups');void api.openGroup(button.dataset.id);}
  else if(action==='power')void run(()=>api.power(button.dataset.id));
  else if(action==='create-group'){sheet('Finding your lamps','<p>We’re checking which lamps are ready to play together. This can take a little time when a lamp is out of reach.</p>');void run(async()=>{await api.refreshGroups();createGroup();});}
  else if(action==='create-group-save')void run(async()=>{const name=document.getElementById('v2GroupName').value.trim(),ids=[...dialog.querySelectorAll('[name="v2GroupMember"]:checked')].map(input=>input.value);if(!name)throw Error('Give your group a name.');if(ids.length<2)throw Error('Choose at least two lamps.');const result=await api.createGroup(ids);preferences.groups[result.id]=name;persist();close();api.navigate('groups');await api.openGroup(result.id);});
  else if(action==='updates'){close();api.navigate('lamps');document.getElementById('v2CarePanel').scrollIntoView({block:'start'});}
  else if(action==='lamp-settings'){chooseLight('overview');}
  else if(action==='network'){chooseLight('network');}
  else if(action==='hardware'){chooseLight('hardware');}
  else if(action==='appearance'){chooseLight('design');}
  else if(action==='help')sheet('A familiar little knob',`<div class="v2-help-row"><strong>Turn</strong><p>Choose another effect.</p></div><div class="v2-help-row"><strong>Click, then turn</strong><p>Adjust brightness.</p></div><div class="v2-help-row"><strong>Double-click, then turn</strong><p>Choose a color.</p></div><div class="v2-help-row"><strong>Triple-click</strong><p>Turn off. Click once to turn back on.</p></div><div class="v2-help-row"><strong>Hold until blue, then release</strong><p>About six seconds · Pair a phone.</p></div><p class="hint">A ten-second hold until red arms reset. Release at blue when pairing.</p><button class="secondary" data-v2="close">Got it</button>`);
 });
 dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else cancelSelection();});
 dialog.addEventListener('close',()=>cancelSelection());
 document.getElementById('v2Theme').addEventListener('change',event=>{preferences.theme=event.target.value;persist();applyTheme();});
 document.getElementById('v2LampSearch').addEventListener('input',event=>{const query=event.target.value.trim().toLowerCase();document.querySelectorAll('#lampList .lamp-entry').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(query);});});
 const interval=setInterval(()=>refresh(),1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
 refresh(true);
 return {groupName,room,refresh,chooseLight,navigate(name){if(selectionTask)close();route=name;document.body.dataset.v2Page=name;document.getElementById('v2ScopeButton').hidden=name!=='effects';document.getElementById('v2ScopeButton').textContent=api.model().selected?.name||'Choose a lamp';document.querySelectorAll('nav [data-page]').forEach(button=>{if(button.dataset.page===(['settings','app-settings'].includes(name)?'app-settings':name==='groups'?'home':name))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});document.querySelector('#page-settings .settings-navigation').hidden=name==='effects';if(name==='effects'&&!api.model().connected&&!api.model().connecting)chooseLight();refresh();},destroy(){cancelSelection();clearInterval(interval);}};
}
