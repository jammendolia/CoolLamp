'use strict';
const el=id=>document.getElementById(id),canonical=v=>typeof v==='string'&&/^[a-f0-9]{12}$/.test(v),transaction=v=>typeof v==='string'&&/^[a-f0-9]{16}$/.test(v)&&!/^[0]+$/.test(v);
let configBlocked=false,busy=false,controller=null,timer=null,bridge=null,neighbors=[],selected=null,fresh=null,generation=0,pending=null;
let wifiNetworks=[],wifiScanPhase='idle',wifiScanRun=null,wifiScanStarted=false;
let ownerPasswordRequired=false,passwordSaving=false,setupStopped=false,backgroundRead=false,deferredForeground=null,inventoryChoices='';
let activeFeedback=null,wifiEditing=false,wifiSnapshot=null,wifiSubmission=null,cacheRequested=false;
const used=new Set(),say=text=>{el('message').textContent=text;},visible=()=>!document.hidden;
function foregroundBusy(){return busy&&!backgroundRead||!!deferredForeground;}
function controls(){
 const blocked=foregroundBusy()||configBlocked||ownerPasswordRequired||setupStopped,connecting=!!wifiSubmission||bridge?.wifiSave==='connecting',live=selected&&neighbors.some(p=>p.id===selected.id&&p.boot===selected.boot&&p.online),safe=fresh&&fresh.id===selected?.id&&fresh.boot===selected?.boot&&Date.now()-fresh.at<10000;
 for(const id of ['wifiSave','ssid','wifiPassword','wifiReconfigure','wifiCancel'])el(id).disabled=blocked||connecting;
 el('cacheCheck').disabled=blocked||connecting||cacheRequested||['checking','downloading','validating'].includes(bridge?.cache?.phase);el('donationToggle').disabled=blocked;
 el('wifiFind').disabled=blocked||connecting||!bridge;el('wifiNetworks').disabled=blocked||connecting||wifiScanPhase!=='ready'||!wifiNetworks.length;
 el('readLamp').disabled=blocked||!live;el('on').disabled=el('off').disabled=blocked||!live||!safe||!!pending;el('reconcile').disabled=blocked;el('reconcile').classList.toggle('hide',!pending);
 for(const id of ['ownerPassword','ownerPasswordConfirm','ownerPasswordSave'])el(id).disabled=foregroundBusy()||configBlocked||setupStopped||!ownerPasswordRequired;
 const feedback=deferredForeground?.feedback||(!backgroundRead&&busy?activeFeedback:null),labels={ownerPasswordSave:'Save password',wifiFind:wifiScanStarted?'Refresh':'Find Wi-Fi',wifiSave:'Connect and save',cacheCheck:'Check for an update',donationToggle:bridge?.donation?.enabled?'Disable update sharing':'Enable update sharing',readLamp:'Read lamp state',on:'Turn on',off:'Turn off',reconcile:'Check last command'};
 for(const [id,label]of Object.entries(labels)){const active=feedback?.id===id||id==='wifiSave'&&connecting||id==='cacheCheck'&&(cacheRequested||['checking','downloading','validating'].includes(bridge?.cache?.phase));el(id).setAttribute('aria-busy',String(active));el(id).textContent=feedback?.id===id?feedback.text:id==='wifiSave'&&connecting?'Connecting and saving…':id==='cacheCheck'&&active?'Checking update…':label;}
 el('lampState').setAttribute('aria-busy',String(feedback?.id==='readLamp'));
 const loading=!bridge&&busy,operation=feedback?.text||(loading?'Connecting to the bridge…':'');el('operationBusy').classList.toggle('hide',!operation);el('operationText').textContent=deferredForeground?operation+' Waiting for the current check to finish.':operation;
 el('wifiBusy').classList.toggle('hide',!connecting);el('wifiBusyText').textContent=wifiSubmission==='uncertain'?'Checking whether your Wi-Fi change was saved…':'Connecting and saving Wi-Fi…';el('wifiSection').setAttribute('aria-busy',String(connecting));
 el('ownerPasswordBusy').classList.toggle('hide',!passwordSaving);el('passwordSetup').hidden=!bridge||!ownerPasswordRequired&&!setupStopped;el('bridgeFeatures').hidden=!bridge||ownerPasswordRequired||setupStopped;if(ownerPasswordRequired&&configBlocked&&!passwordSaving&&!setupStopped)el('ownerPasswordState').textContent=el('storageState').textContent;
}
function schedule(){clearTimeout(timer);if(visible()&&!setupStopped&&!ownerPasswordRequired&&!busy&&!deferredForeground)timer=setTimeout(poll,2000);}
async function api(path,fields,signal){if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(ownerPasswordRequired&&!['/api/bridge/status','/api/bridge/password'].includes(path))throw Error('Choose a bridge password before continuing.');const options={signal,credentials:'same-origin',cache:'no-store'};if(fields!==undefined){if(!/^[a-f0-9]{32}$/.test(bridge?.token||''))throw Error('Refresh bridge status before changing settings.');options.method='POST';options.headers={'Content-Type':'application/x-www-form-urlencoded','X-Lamp-Token':bridge.token};options.body=new URLSearchParams(fields).toString();}const response=await fetch(path,options),text=await response.text();if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(!response.ok)throw Error(text||'Bridge could not accept the request.');try{return JSON.parse(text);}catch{return text;}}
function cancelDeferred(message){const queued=deferredForeground;if(!queued)return;deferredForeground=null;clearTimeout(queued.timer);queued.resolve(false);if(message)say(message);}
async function run(action,quiet=false,feedback=null){
 if(!visible()||setupStopped)return false;
 if(busy){
  if(quiet||!backgroundRead||deferredForeground)return false;
  return new Promise(resolve=>{const queued={action,resolve,feedback,deviceId:bridge?.deviceId,token:bridge?.token,generation};deferredForeground=queued;queued.timer=setTimeout(()=>{if(deferredForeground===queued){cancelDeferred('Bridge status is still busy. Try again when it finishes.');controls();}},6000);say('Waiting for bridge status to finish…');controls();});
 }
 busy=true;backgroundRead=quiet;activeFeedback=feedback;controller=new AbortController();const owned=controller,timeout=setTimeout(()=>owned.abort(),18000);controls();
 try{await action(owned.signal);return true;}
 catch(error){if(!quiet||error.name!=='AbortError')say(pending?'Reply unconfirmed. Check the last command before retrying.':error.name==='AbortError'?'Request paused. Refresh to check state.':error.message);return false;}
 finally{
  clearTimeout(timeout);if(controller===owned)controller=null;busy=false;backgroundRead=false;activeFeedback=null;
  const queued=deferredForeground;
  if(queued){
   deferredForeground=null;clearTimeout(queued.timer);
   if(!visible()||setupStopped||configBlocked||queued.deviceId!==bridge?.deviceId||queued.token!==bridge?.token||queued.generation!==generation){queued.resolve(false);say('Bridge or selection changed. No request was sent.');controls();schedule();}
   else void run(queued.action,false,queued.feedback).then(queued.resolve);
  }else{controls();schedule();}
 }
}
function progress(id,written,total,active){const node=el(id);node.classList.toggle('hide',!active);node.max=Number(total)>0?Number(total):1;node.value=Math.max(0,Math.min(Number(written)||0,node.max));}
function renderWifiStatus(value){
 const wifi=value.wifi;
 if(wifi!==undefined&&wifi!==null){
  const name=text=>typeof text==='string'&&new TextEncoder().encode(text).length<=32;
  if(wifi.version!==1||typeof wifi.configured!=='boolean'||typeof wifi.connected!=='boolean'||!name(wifi.savedName)||!name(wifi.connectedName)||wifi.configured&&!wifi.savedName||wifi.connected&&!wifi.connectedName||wifi.rssi!==null&&(!Number.isInteger(wifi.rssi)||wifi.rssi<-127||wifi.rssi>0))throw Error('Wi-Fi connection details were not confirmed.');
  wifiSnapshot={...wifi};
 }else wifiSnapshot={configured:value.wifiConfigured===true,connected:value.wifiConnected===true,savedName:'',connectedName:'',rssi:null};
 if(wifiSubmission&&value.wifiSave!=='connecting'){
  if(value.wifiSave==='saved'){wifiSubmission=null;wifiEditing=false;el('wifiPassword').value='';say('Home Wi-Fi connected and saved.');}
  else if(['failed-previous-kept','save-failed-previous-kept','save-uncertain-restart','not-requested'].includes(value.wifiSave))wifiSubmission=null;
 }
 const configured=wifiSnapshot.configured,connected=wifiSnapshot.connected,rssi=wifiSnapshot.rssi,arcs=connected&&Number.isInteger(rssi)?rssi>=-60?3:rssi>=-75?2:1:0,strength=arcs===3?'Strong signal':arcs===2?'Good signal':arcs===1?'Weak signal':'Signal not available';
 el('wifiName').textContent=wifiSnapshot.connectedName||wifiSnapshot.savedName||'Saved home Wi-Fi';el('wifiConnection').textContent=connected?'Connected · '+strength:'Saved network · Reconnecting when available';el('wifiSignal').setAttribute('aria-label',connected?'Wi-Fi: '+strength.toLowerCase():'Wi-Fi disconnected');
 for(let arc=1;arc<=3;arc++)el('wifiArc'+arc).classList.toggle('lit',arc<=arcs);el('wifiDot').classList.toggle('lit',connected);el('wifiSummary').hidden=!configured;el('wifiEditor').hidden=configured&&!wifiEditing;el('wifiCancel').hidden=!configured;
}
function renderStatus(value){if(!value||value.role!=='bridge'||!canonical(value.deviceId))throw Error('Invalid bridge identity.');if(bridge&&bridge.deviceId!==value.deviceId){generation++;fresh=null;selected=null;pending=null;throw Error('Bridge identity changed. Reload this page.');}bridge=value;ownerPasswordRequired=value.passwordSet===false;configBlocked=value.storageFault===true||value.configurationUncertain===true;el('storageState').textContent=value.configurationUncertain?'Settings save unconfirmed. Restart the bridge to check saved settings. Configuration changes are blocked.':value.storageFault?'Stored settings could not be read. Restart and check the bridge. Configuration changes are blocked.':'';el('identity').textContent=[value.name||'CoolLamp bridge','ID '+value.deviceId,'Bridge firmware '+(value.version||'unknown')].join('\n');el('trust').textContent=transaction(value.fleetId)&&value.meshEnabled?'Enrolled household '+value.fleetId:'Household access unavailable.';renderWifiStatus(value);const saved={connecting:'Connecting; settings are not saved yet.',saved:'Network connection and settings saved.','failed-previous-kept':'Connection failed. Previous saved network kept.','save-failed-previous-kept':'Settings were not saved. Previous network kept.','save-uncertain-restart':'Network save unconfirmed. Restart to check saved network.','not-requested':'No network change requested.'};el('wifiState').textContent=(value.wifiConnected?'Wi-Fi connected.':value.setupAp?'Setup network active.':'Wi-Fi disconnected.')+' '+(saved[value.wifiSave]||'Save status not reported.');const c=value.cache||{},d=value.donation||{};if(['empty','checking','downloading','validating','ready','error'].includes(c.phase))cacheRequested=false;el('cache').textContent=['Phase: '+(c.phase??'unknown'),c.version?'Lamp firmware '+c.version:'No verified lamp version.',(Number(c.written)||0)+' / '+(Number(c.bytes)||0)+' bytes checked',c.error?'Cache issue: '+c.error:''].filter(Boolean).join('\n');progress('cacheProgress',c.written,c.bytes,(Number(c.bytes)||0)>0&&(Number(c.written)||0)<Number(c.bytes));el('donation').textContent=[d.enabled?'Update sharing is enabled.':'Update sharing is off.',d.sending?'Sending: '+(Number(d.written)||0)+' / '+(Number(d.total)||0)+' bytes':'No active transfer.',(Number(d.completed)||0)+' completed transfers'].join('\n');el('donationToggle').textContent=d.enabled?'Disable update sharing':'Enable update sharing';progress('donationProgress',d.written,d.total,d.sending===true);el('diagnostics').textContent=['Radio channel: '+(value.channel??'unknown'),'Heap bytes: '+(value.heap??'unknown'),value.http?'HTTP: '+JSON.stringify(value.http):''].filter(Boolean).join('\n');}
function renderInventory(value){if(!bridge||value?.version!==1||value.deviceId!==bridge.deviceId||!Array.isArray(value.peers))throw Error('Invalid bridge neighborhood inventory.');neighbors=value.peers.slice(0,16).filter(p=>canonical(p.id)&&p.id!==bridge.deviceId&&transaction(p.boot)&&typeof p.online==='boolean'&&Number.isInteger(p.hops)&&p.hops>=1&&p.hops<=4);if(selected&&!neighbors.some(p=>p.id===selected.id&&p.boot===selected.boot&&p.online)){generation++;selected=null;fresh=null;el('lampState').textContent='Device offline or restarted. Select it again.';}const choices=JSON.stringify(neighbors.map(p=>[p.id,p.boot,p.name,p.online,p.hops])),select=el('lamp');if(choices!==inventoryChoices){inventoryChoices=choices;select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a nearby lamp';select.append(placeholder);for(const peer of neighbors){const option=document.createElement('option');option.value=peer.id;option.disabled=!peer.online;option.textContent=(peer.name||peer.id)+' - '+(peer.online?'online':'offline')+' - '+peer.hops+' hop'+(peer.hops===1?'':'s');select.append(option);}select.value=selected?.id||'';}el('inventory').textContent=neighbors.filter(p=>p.online).length+' reachable devices in this bridges local neighborhood. '+(value.available?'Household control is available.':'Household control is temporarily unavailable.');controls();}
function scanSnapshot(value,expected){
 if(!value||!['idle','queued','scanning','ready','error'].includes(value.phase)||!Number.isInteger(value.generation)||value.generation<0||value.generation>0xffffffff||value.generation!==expected||!Array.isArray(value.networks)||value.networks.length>20||typeof value.truncated!=='boolean'||typeof value.error!=='string')throw Error('Wi-Fi search response was not confirmed.');
 for(const network of value.networks)if(typeof network?.ssid!=='string'||!network.ssid||new TextEncoder().encode(network.ssid).length>32||!Number.isInteger(network.rssi)||network.rssi<-127||network.rssi>0||!Number.isInteger(network.channel)||network.channel<1||network.channel>14||typeof network.secure!=='boolean'||typeof network.supported!=='boolean')throw Error('Wi-Fi search response was not confirmed.');
 return value;
}
function renderWifiNetworks(value){
 wifiNetworks=value.networks.map(network=>({...network}));wifiScanPhase='ready';
 const select=el('wifiNetworks');select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=wifiNetworks.length?'Choose a network, or enter its name below':'No visible networks found';select.append(placeholder);
 for(const [index,network] of wifiNetworks.entries()){
  const option=document.createElement('option');option.value=String(index);option.disabled=!network.supported;
  const strength=network.rssi>=-60?'strong signal':network.rssi>=-75?'good signal':'weak signal';
  option.textContent=network.ssid+' — '+(!network.supported?'unsupported security':network.secure?'secured':'open')+' · '+strength;select.append(option);
 }
 select.value='';el('wifiScanState').textContent=(wifiNetworks.length?'Choose your network.': 'No visible networks found. You can enter a network name below.')+(value.truncated?' Showing the strongest 20 networks.':'');controls();
}
function scanPause(signal,delay){return new Promise((resolve,reject)=>{
 const done=()=>{clearTimeout(wait);signal.removeEventListener('abort',abort);},abort=()=>{done();reject(new DOMException('Aborted','AbortError'));},wait=setTimeout(()=>{done();resolve();},delay);
 if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
});}
async function findWifi(){
 if(foregroundBusy()||configBlocked||ownerPasswordRequired||setupStopped||!visible())return;
 return run(async signal=>{
  wifiScanStarted=true;wifiScanPhase='queued';wifiScanRun=signal;const deviceId=bridge?.deviceId,owned=controller,deadline=Date.now()+15000,limit=setTimeout(()=>owned.abort(),15000);
  const guard=()=>{if(signal.aborted||!visible()||wifiScanRun!==signal)throw new DOMException('Aborted','AbortError');if(bridge?.deviceId!==deviceId)throw Error('Bridge identity changed. Reload this page.');if(Date.now()>=deadline)throw Error('Wi-Fi search timed out. Refresh to search again.');};
  el('wifiScanState').textContent='Finding nearby Wi-Fi…';controls();
  try{
   guard();const reply=await api('/api/bridge/wifi/scan',{},signal);guard();
   if(reply?.accepted!==true||!Number.isInteger(reply.generation)||reply.generation<0||reply.generation>0xffffffff)throw Error('Wi-Fi search was not confirmed. Refresh to search again.');
   for(;;){
    guard();const value=scanSnapshot(await api('/api/bridge/wifi/networks',undefined,signal),reply.generation);guard();
    wifiScanPhase=value.phase;
    if(value.phase==='ready'){renderWifiNetworks(value);return;}
    if(value.phase==='error')throw Error('Wi-Fi search failed. '+value.error.slice(0,120));
    el('wifiScanState').textContent=value.phase==='scanning'?'Searching nearby Wi-Fi…':'Waiting to search Wi-Fi…';
    await scanPause(signal,Math.min(350,Math.max(1,deadline-Date.now())));
   }
  }catch(error){wifiScanPhase='idle';el('wifiScanState').textContent=error.name==='AbortError'?'Search paused. Use Refresh to search again.':error.message;throw error;}
  finally{clearTimeout(limit);if(wifiScanRun===signal)wifiScanRun=null;}
 },false,{id:'wifiFind',text:'Finding Wi-Fi…'});
}
async function poll(){if(setupStopped||ownerPasswordRequired&&bridge)return;if(busy||!visible()){schedule();return;}await run(async signal=>{renderStatus(await api('/api/bridge/status',undefined,signal));if(ownerPasswordRequired){say('Open setup Wi-Fi. Choose your bridge password to continue.');controls();return;}renderInventory(await api('/api/mesh/status',undefined,signal));if(el('message').textContent==='Connecting to the bridge...')say('Bridge ready. Choose a lamp or review its setup.');},true);}
function requestId(){for(let i=0;i<8;i++){const bytes=crypto.getRandomValues(new Uint8Array(8)),id=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');if(transaction(id)&&!used.has(id)){used.add(id);return id;}}throw Error('Could not create a fresh request. Reload the page.');}
function current(context){if(context.generation!==generation||selected?.id!==context.target||selected?.boot!==context.targetBoot)throw Error('Lamp selection changed.');}
function readFeedback(context,text){if(context.generation===generation&&selected?.id===context.target&&selected?.boot===context.targetBoot)el('lampState').textContent=text;}
function readError(error){return error?.name==='AbortError'?'Read paused. Tap Read lamp state to check again.':'Lamp state could not be read. '+(typeof error?.message==='string'?error.message:'The bridge did not return a confirmed reply.').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,240);}
async function collect(reply,context,signal,guard=true){let offset=0,total,status,buffer;const deadline=Date.now()+15500;for(;;){if(signal.aborted)throw new DOMException('Aborted','AbortError');if(guard)current(context);if(Date.now()>=deadline)throw Error('The lamp reply timed out.');if(reply?.version!==1||reply.target!==context.target||reply.requestId!==context.requestId||typeof reply.executed!=='boolean')throw Error('Unconfirmed reply identity.');if(reply.uncertain===true)throw Error('The lamp reply is unconfirmed.');if(reply.status==='no-route'){if(reply.executed)throw Error('The command result is unconfirmed.');throw Error('This lamp is no longer reachable.');}if(reply.status==='rejected'){if(reply.executed)throw Error('The command result is unconfirmed.');if(pending?.requestId===context.requestId)pending=null;throw Error('The bridge rejected the request. Refresh this lamp.');}if(reply.targetBoot&&reply.targetBoot!==context.targetBoot)throw Error('Lamp restarted. Select it again.');if(reply.status==='ok'){if(!reply.executed||reply.targetBoot!==context.targetBoot||!Number.isInteger(reply.httpStatus)||reply.httpStatus<100||reply.httpStatus>599||!Number.isInteger(reply.total)||reply.total<0||reply.total>8192||reply.offset!==offset||typeof reply.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reply.data))throw Error('Invalid lamp result page.');const chunk=Uint8Array.from(atob(reply.data),c=>c.charCodeAt(0));if(chunk.length>256||offset+chunk.length>reply.total||!chunk.length&&offset<reply.total)throw Error('Invalid lamp result size.');if(total===undefined){total=reply.total;status=reply.httpStatus;buffer=new Uint8Array(total);}if(total!==reply.total||status!==reply.httpStatus)throw Error('Response changed between pages.');buffer.set(chunk,offset);offset+=chunk.length;if(offset===total){const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);buffer.fill(0);if(pending?.requestId===context.requestId)pending=null;if(status<200||status>=300)throw Error(text||'The lamp rejected the setting.');return text;}}else if(reply.status==='pending'){await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(wait);signal.removeEventListener('abort',abort);},wait=setTimeout(()=>{done();resolve();},120),abort=()=>{done();reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});});}else throw Error('Unknown lamp result.');const fields=new URLSearchParams({target:context.target,requestId:context.requestId,offset:String(offset),targetBoot:context.targetBoot});reply=await api('/api/mesh/result?'+fields,undefined,signal);}}
async function rpc(endpoint,method,body,signal){if(!selected)throw Error('Select a nearby lamp.');const context={target:selected.id,targetBoot:selected.boot,requestId:requestId(),generation};current(context);if(method===2){pending=context;fresh=null;controls();}const reply=await api('/api/mesh/request',{target:context.target,requestId:context.requestId,endpoint,method,body,targetBoot:context.targetBoot},signal);return collect(reply,context,signal);}
async function readLamp(signal){fresh=null;controls();const context={target:selected?.id,targetBoot:selected?.boot,generation};readFeedback(context,'Reading lamp state…');const state=JSON.parse(await rpc(1,1,'',signal));current(context);if(state.role==='bridge'){fresh=null;el('lampState').textContent='This is a household bridge without lamp effects.';return;}if(state.deviceId!==context.target||typeof state.power!=='boolean'||!Number.isInteger(state.brightness)||!Number.isInteger(state.mode))throw Error('Invalid lamp state.');readFeedback(context,'Lamp answered. Reading available effects…');const catalog=JSON.parse(await rpc(26,1,'',signal));current(context);if(!Array.isArray(catalog)||catalog.length>128||!catalog.every(effect=>Number.isInteger(effect.id)&&typeof effect.name==='string'))throw Error('Invalid lamp effect catalog.');el('lampState').textContent=[state.name||selected.name||state.deviceId,state.power?'Power is on.':'Power is off.','Brightness: '+state.brightness,'Effect: '+(catalog.find(effect=>effect.id===state.mode)?.name||state.mode),'Available effects: '+catalog.map(effect=>effect.name).join(', ')].join('\n');fresh={id:context.target,boot:context.targetBoot,at:Date.now()};controls();}
el('lamp').addEventListener('change',()=>{generation++;controller?.abort();const peer=neighbors.find(p=>p.id===el('lamp').value&&p.online);selected=peer?{...peer}:null;fresh=null;el('lampState').textContent=selected?'Read this lamps state before controlling it.':'Select a lamp to read its state and effects.';controls();});
el('readLamp').onclick=async()=>{
 if(el('readLamp').disabled)return;
 const context={target:selected?.id,targetBoot:selected?.boot,generation};let started=false;
 readFeedback(context,busy&&backgroundRead?'Waiting for the bridge status check to finish…':'Reading lamp state…');
 const ok=await run(async signal=>{
  started=true;
  try{await readLamp(signal);say('Lamp state refreshed.');}
  catch(error){readFeedback(context,readError(error));throw error;}
 },false,{id:'readLamp',text:'Reading lamp…'});
 if(!ok&&!started)readFeedback(context,'Lamp state was not read. '+el('message').textContent.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,240));
};
for(const [id,on] of [['on','1'],['off','0']])el(id).onclick=()=>{controls();if(el(id).disabled)return;return run(async signal=>{if(!fresh||pending)throw Error('Refresh this lamp first.');const reply=await rpc(31,2,'on='+on,signal);say(reply||'Lamp confirmed.');await readLamp(signal);},false,{id,text:on==='1'?'Turning on…':'Turning off…'});};
el('reconcile').onclick=()=>{if(el('reconcile').disabled)return;return run(async signal=>{const context=pending;if(!context)return;const query=new URLSearchParams({target:context.target,requestId:context.requestId,offset:'0',targetBoot:context.targetBoot});const text=await collect(await api('/api/mesh/result?'+query,undefined,signal),context,signal,false);say('Last lamp command confirmed: '+(text||'completed')+'. Refresh before controlling it again.');},false,{id:'reconcile',text:'Checking last command…'});};
el('ownerPasswordForm').onsubmit=event=>{
 event.preventDefault();const fields={password:el('ownerPassword').value,confirm:el('ownerPasswordConfirm').value};el('ownerPassword').value='';el('ownerPasswordConfirm').value='';
 if(foregroundBusy()||configBlocked||setupStopped||!ownerPasswordRequired||!visible()){fields.password=fields.confirm='';return;}
 const bytes=new TextEncoder().encode(fields.password),valid=bytes.length>=8&&bytes.length<=32;bytes.fill(0);
 if(!valid||fields.password!==fields.confirm){el('ownerPasswordState').textContent=!valid?'Use 8 to 32 letters, numbers or punctuation for your password.':'Passwords do not match. Enter them again.';fields.password=fields.confirm='';return;}
 return run(async signal=>{
  const hotspot='CoolLampBridge-'+bridge.deviceId.slice(-4);let submitted=false;passwordSaving=true;el('ownerPasswordState').textContent='Saving your bridge password…';controls();
  try{
   if(!/^[a-f0-9]{32}$/.test(bridge?.token||''))throw Error('Refresh bridge status before choosing a password.');
   submitted=true;const reply=await api('/api/bridge/password',fields,signal);
   if(reply?.saved!==true||reply.reconnect!==true)throw Error('Password save was not confirmed.');
   setupStopped=true;clearTimeout(timer);const message='Password saved. Reconnect to '+hotspot+' with your new password, then reopen 192.168.4.1. Sign in as OWNER using that password.';el('ownerPasswordState').textContent=message;say(message);
  }catch(error){
   if(submitted){setupStopped=true;clearTimeout(timer);const message='Password save unconfirmed. Try joining '+hotspot+' with the password you chose, then reopen 192.168.4.1 to check. Sign in as OWNER using that password. If setup Wi-Fi is still open, reload this page to check before trying again.';el('ownerPasswordState').textContent=message;say(message);}
   else{el('ownerPasswordState').textContent=error.message;say(error.message);}
  }finally{fields.password=fields.confirm='';el('ownerPassword').value='';el('ownerPasswordConfirm').value='';passwordSaving=false;}
 },false,{id:'ownerPasswordSave',text:'Saving password…'}).finally(()=>{fields.password=fields.confirm='';});
};
el('wifiFind').onclick=()=>{if(el('wifiFind').disabled)return;return findWifi();};
el('wifiNetworks').addEventListener('change',()=>{if(el('wifiNetworks').disabled)return;const value=el('wifiNetworks').value,index=Number(value),network=wifiNetworks[index];if(value===''||!Number.isInteger(index)||String(index)!==value||!network?.supported)return;el('ssid').value=network.ssid;});
el('wifiReconfigure').onclick=()=>{if(el('wifiReconfigure').disabled||!wifiSnapshot?.configured)return;wifiEditing=true;el('wifiPassword').value='';el('ssid').value=wifiSnapshot.savedName||wifiSnapshot.connectedName||'';renderWifiStatus(bridge);el('ssid').focus();};
el('wifiCancel').onclick=()=>{if(el('wifiCancel').disabled)return;wifiEditing=false;el('wifiPassword').value='';renderWifiStatus(bridge);el('wifiReconfigure').focus();};
el('wifiForm').onsubmit=event=>{
 event.preventDefault();if(configBlocked||foregroundBusy()||ownerPasswordRequired||setupStopped||wifiSubmission||bridge?.wifiSave==='connecting'||!visible()){el('wifiPassword').value='';return;}
 const fields={ssid:el('ssid').value,password:el('wifiPassword').value};el('wifiPassword').value='';
 const size=new TextEncoder().encode(fields.ssid).length;if(!size||size>32){fields.password='';say('Enter a network name using up to 32 bytes.');return;}
 return run(async signal=>{
  wifiSubmission='posting';controls();
  try{const reply=await api('/api/bridge/wifi',fields,signal);if(reply?.accepted!==true)throw Error('The Wi-Fi change was not accepted. Your saved network is kept.');wifiSubmission='awaiting';say('Connecting to your home Wi-Fi. The new network is not saved yet.');}
  catch(error){wifiSubmission='uncertain';throw error;}
  finally{fields.password='';}
 },false,{id:'wifiSave',text:'Connecting and saving…'}).finally(()=>{fields.password='';});
};
el('cacheCheck').onclick=()=>{if(el('cacheCheck').disabled)return;return run(async signal=>{cacheRequested=true;controls();const reply=await api('/api/bridge/cache/check',{},signal);if(reply?.accepted!==true)throw Error('The update check was not accepted.');say('Update check requested. Watch the cache status.');},false,{id:'cacheCheck',text:'Checking update…'});};
el('donationToggle').onclick=()=>{if(el('donationToggle').disabled)return;return run(async signal=>{const reply=await api('/api/bridge/donation',{enabled:bridge?.donation?.enabled?'0':'1'},signal);if(reply?.saved!==true)throw Error('Update-sharing save was not confirmed. Refresh to check its setting.');say('Update-sharing preference saved.');renderStatus(await api('/api/bridge/status',undefined,signal));},false,{id:'donationToggle',text:'Saving sharing preference…'});};
document.addEventListener('visibilitychange',()=>{if(!visible()){clearTimeout(timer);controller?.abort();cancelDeferred('Request paused. Nothing was sent.');fresh=null;}else if(!ownerPasswordRequired)poll();controls();});controls();poll();
