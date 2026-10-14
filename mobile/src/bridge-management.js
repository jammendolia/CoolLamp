// A bridge changes only its own permission to serve a lamp. It never enrolls,
// removes household ownership, changes a group or sends firmware by this page.
export const BRIDGE_LINK_LIMIT=64;
export const BRIDGE_LINK_RESPONSE_LIMIT=8192;
const JOURNAL_KEY='coollamp-bridge-link-pending-v1',JOURNAL_LIMIT=4096,BRIDGE_LIMIT=8;
const nativeOwners=new WeakMap();
function nativeOwner(http){let owner=nativeOwners.get(http);if(!owner){owner={flight:null};nativeOwners.set(http,owner);}return owner;}
const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const nonce=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const revision=value=>Number.isInteger(value)&&value>=1&&value<=0xffffffff;
const bytes=value=>new TextEncoder().encode(value).length;
const failure=(message,fields={})=>Object.assign(Error(message),{bridgeError:true,...fields});
const cancelled=()=>failure('Bridge check stopped.',{cancelled:true});
const unconfirmed=()=>failure('The bridge has not confirmed this change. Check its saved result before making another change.',{uncertain:true});
const escaped=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const name=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,64):'';
const lampId=lamp=>canonical(lamp?.deviceId)?lamp.deviceId:canonical(lamp?.id)?lamp.id:null;

export function bridgeAddress(value){
 if(typeof value!=='string'||value.length>128)throw failure('Enter the bridge’s home Wi-Fi address, shown on its screen.');
 const rawHost=value.replace(/^https?:\/\//i,'').split(/[/?#]/,1)[0].replace(/:80$/,'').toLowerCase();
 const url=new URL(/^https?:\/\//i.test(value||'')?value:'http://'+value);
 const host=url.hostname.toLowerCase(),parts=host.split('.').map(Number),ipv4=parts.length===4&&parts.every(part=>Number.isInteger(part)&&part>=0&&part<=255)&&parts.map(String).join('.')===host;
 const local=ipv4&&(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===169&&parts[1]===254)||/^[a-z0-9](?:[a-z0-9-]{0,62})\.local$/.test(host);
 if(url.protocol!=='http:'||!local||rawHost!==host||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||url.port&&url.port!=='80')throw failure('Enter the bridge’s home Wi-Fi address, shown on its screen.');
 return url.origin;
}

export function bridgeLinksSnapshot(value,deviceId){
 if(value?.version!==1||value.deviceId!==deviceId||!canonical(deviceId)||!nonce(value.boot)||!revision(value.revision)||
  !Array.isArray(value.excluded)||value.excluded.length>BRIDGE_LINK_LIMIT||!value.excluded.every(canonical)||new Set(value.excluded).size!==value.excluded.length||
  typeof value.ready!=='boolean'||typeof value.persisted!=='boolean'||typeof value.storageFault!=='boolean'||typeof value.uncertain!=='boolean'||value.ready!==(value.persisted&&!value.storageFault&&!value.uncertain)||value.defaultHouseholdAllowed!==true||value.scope!=='this-bridge-serving-only'||
  value.limits?.excluded!==64||!Number.isInteger(value.limits?.receipts)||value.limits.receipts<1||value.limits.receipts>4||value.limits.receiptLifetimeMs!==60000||value.limits.statusBytes!==1536)throw failure('This bridge needs updated software before lamp links can be managed.',{unsupported:true});
 return Object.freeze({version:1,deviceId,boot:value.boot,revision:value.revision,excluded:Object.freeze([...value.excluded]),ready:value.ready,storageFault:value.storageFault,uncertain:value.uncertain});
}

function bridgeStatus(value,deviceId){
 if(value?.role!=='bridge'||value.deviceId!==deviceId||!canonical(deviceId)||typeof value.token!=='string'||!/^[a-f0-9]{32}$/.test(value.token)||!nonce(value.fleetId)||value.meshEnabled!==true)throw failure('This bridge’s household connection was not confirmed. Open bridge setup to check it.',{identity:true});
 return {...value};
}
function presence(value,status,links){
 if(value?.version!==1||value.deviceId!==status.deviceId||value.fleetId!==status.fleetId||value.boot!==links.boot||typeof value.available!=='boolean'||!Array.isArray(value.peers)||value.peers.length>16)throw failure('Nearby lamps were not confirmed by this bridge.');
 const seen=new Set();const peers=value.peers.map(peer=>{
  if(!canonical(peer?.id)||seen.has(peer.id)||!nonce(peer.boot)||typeof peer.online!=='boolean'||!Number.isInteger(peer.hops)||peer.hops<1||peer.hops>4)throw failure('Nearby lamps were not confirmed by this bridge.');
  seen.add(peer.id);return Object.freeze({id:peer.id,name:name(peer.name)||peer.id,boot:peer.boot,online:peer.online,hops:peer.hops});
 });
 return Object.freeze({available:value.available,peers:Object.freeze(peers)});
}

function pendingRecord(value){
 if(!canonical(value?.deviceId)||!canonical(value.target)||!nonce(value.requestId)||!nonce(value.boot)||!revision(value.revision)||!['add','remove'].includes(value.action)||!Number.isSafeInteger(value.issuedAt)||value.issuedAt<0)return null;
 return Object.freeze({deviceId:value.deviceId,target:value.target,requestId:value.requestId,boot:value.boot,revision:value.revision,action:value.action,issuedAt:value.issuedAt});
}
export class BridgeLinkJournal {
 constructor(storage){
  this.storage=storage;this.items=[];this.blocked=false;
  try{const raw=storage?.getItem(JOURNAL_KEY)||'[]';if(bytes(raw)>JOURNAL_LIMIT)throw Error();const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>BRIDGE_LIMIT)throw Error();
   for(const value of values){const item=pendingRecord(value);if(!item||this.items.some(record=>record.deviceId===item.deviceId))throw Error();this.items.push(item);}
  }catch{this.blocked=true;}
 }
 get(deviceId){return this.items.find(item=>item.deviceId===deviceId)||null;}
 write(items){
  if(this.blocked||!this.storage)throw failure('The phone could not save the bridge check. No change was sent.',{storage:true});
  const raw=JSON.stringify(items);if(bytes(raw)>JOURNAL_LIMIT)throw failure('Too many bridge changes need confirmation. Check them first.',{storage:true});
  try{this.storage.setItem(JOURNAL_KEY,raw);if(this.storage.getItem(JOURNAL_KEY)!==raw)throw Error();this.items=items;}
  catch{this.blocked=true;throw failure('The phone could not verify its saved bridge check.',{storage:true});}
 }
 begin(value){const item=pendingRecord(value);if(!item||this.get(item.deviceId))throw unconfirmed();if(this.items.length>=BRIDGE_LIMIT)throw failure('Check the pending bridge changes before adding another.',{storage:true});this.write([...this.items,item]);return item;}
 clear(deviceId){this.write(this.items.filter(item=>item.deviceId!==deviceId));}
}

function basic(password){const data=new TextEncoder().encode('OWNER:'+password);try{return 'Basic '+btoa(Array.from(data,byte=>String.fromCharCode(byte)).join(''));}finally{data.fill(0);}}
function newRequest(){for(let i=0;i<8;i++){const result=[...crypto.getRandomValues(new Uint8Array(8))].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(nonce(result))return result;}throw failure('Could not start a fresh bridge change.');}
function receipt(value,record){
 if(value?.version!==1||value.deviceId!==record.deviceId||value.requestId!==record.requestId||typeof value.found!=='boolean')throw unconfirmed();
 if(!value.found){if(!nonce(value.boot)||value.executed!==null||value.persisted!==false||value.uncertain!==true)throw unconfirmed();return {found:false};}
 if(value.boot!==record.boot||value.target!==record.target||value.action!==record.action||!revision(value.revision)||!Number.isInteger(value.httpStatus)||value.httpStatus<100||value.httpStatus>599||![true,false,null].includes(value.executed)||typeof value.persisted!=='boolean'||typeof value.uncertain!=='boolean'||value.executed===null&&!value.uncertain||value.persisted&&!value.executed)throw unconfirmed();
 return value;
}

export class BridgeManagementClient {
 constructor({bridge,http,getPassword,journal,lamps=()=>[],now=Date.now,nextRequest=newRequest,timeout=8000}={}){
  if(!canonical(bridge?.id)||typeof http?.request!=='function'||typeof getPassword!=='function'||!(journal instanceof BridgeLinkJournal))throw failure('Bridge connection is unavailable.');
  this.bridge={id:bridge.id,name:name(bridge.name)||'CoolLamp Bridge',address:bridgeAddress(bridge.address||bridge.base||('coollamp-bridge-'+bridge.id.slice(-4)+'.local'))};
  if(bridge.fleetId!==undefined){if(!nonce(bridge.fleetId))throw failure('This bridge’s saved household could not be verified.',{identity:true});this.bridge.fleetId=bridge.fleetId;}
  Object.assign(this,{http,getPassword,journal,lamps,now,nextRequest});this.timeout=Math.max(1,Math.min(8000,timeout));this.busy=false;this.nativeOwner=nativeOwner(http);Object.defineProperty(this,'nativeFlight',{get:()=>this.nativeOwner.flight});this.snapshot=null;
 }
 async owner(signal){
  let value=await this.getPassword(this.bridge.id);if(signal?.aborted)throw cancelled();value=typeof value==='object'?value?.value:value;
  if(typeof value!=='string'||bytes(value)<8||bytes(value)>32)throw failure('Enter the bridge password you chose during setup.',{password:true});
  return basic(value);
 }
 async request(context,path,fields,{onDispatch,allowErrorReceipt=false}={}){
  const guard=()=>{if(context.signal?.aborted)throw cancelled();if(this.now()>=context.deadline)throw failure('The bridge did not answer in time.',{timeout:true});};guard();
  const remaining=Math.max(1,context.deadline-this.now()),options={url:this.bridge.address+path,method:fields===undefined?'GET':'POST',headers:{Authorization:context.authorization},responseType:'text',connectTimeout:Math.min(4000,remaining),readTimeout:remaining,disableRedirects:true};
  if(fields!==undefined){if(!context.token)throw failure('Refresh this bridge before changing lamp links.');options.headers['X-Lamp-Token']=context.token;options.headers['Content-Type']='application/x-www-form-urlencoded';options.data=new URLSearchParams(fields).toString();if(bytes(options.data)>512)throw failure('Bridge request is too large.');}
  let timer,abort;
  try{
   const response=await Promise.race([Promise.resolve().then(()=>{
    guard();if(this.nativeFlight)throw failure('The bridge is finishing its previous request. Wait a moment before checking again.',{busy:true});onDispatch?.();
    // Keep the native socket owner after a JS timeout/cancel. Its late reply is
    // discarded, and another request is refused until actual settlement.
    const native=Promise.resolve(this.http.request(options));this.nativeOwner.flight=native;
    const settled=()=>{if(this.nativeOwner.flight===native)this.nativeOwner.flight=null;};native.then(settled,settled);return native;
   }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('The bridge did not answer in time.',{timeout:true})),remaining);abort=()=>reject(cancelled());context.signal?.addEventListener('abort',abort,{once:true});})]);
   guard();if(response?.url&&new URL(response.url).origin!==this.bridge.address)throw failure('Bridge address changed. Open its saved card again.',{identity:true});
   const text=typeof response?.data==='string'?response.data:JSON.stringify(response?.data);if(typeof text!=='string'||bytes(text)>BRIDGE_LINK_RESPONSE_LIMIT)throw failure('Bridge reply was too large.');
   if(response.status===401)throw failure('The bridge password was not accepted. Check it and try connecting again.',{password:true});
   if(response.status===403)throw failure('The bridge connection changed. Refresh this bridge before changing lamp links.',{session:true});
   let value;try{value=parse(text);}catch{if([404,405,501].includes(response.status))throw failure('Update this bridge’s software to manage lamp links.',{unsupported:true});throw failure('Bridge reply was incomplete.');}
   if([404,405,501].includes(response.status)&&!(allowErrorReceipt&&response.status===404&&value?.version===1&&value.deviceId===this.bridge.id&&value.found===false))throw failure('Update this bridge’s software to manage lamp links.',{unsupported:true});
   if(response.status<200||response.status>=300){if(allowErrorReceipt&&value?.version===1&&value.deviceId===this.bridge.id&&typeof value.found==='boolean')return value;throw failure('The bridge did not accept this change.',{status:response.status});}return value;
  }catch(error){if(error.bridgeError)throw error;throw failure('The bridge did not answer. Keep it powered and check its saved change.');}
  finally{clearTimeout(timer);context.signal?.removeEventListener('abort',abort);}
 }
 async context(signal){
  const deadline=this.now()+this.timeout;let timer,abort;
  try{const authorization=await Promise.race([this.owner(signal),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('The bridge connection did not become ready in time.',{timeout:true})),this.timeout);abort=()=>reject(cancelled());if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});})]);return {signal,deadline,authorization,token:null};}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async read(context){
  const status=bridgeStatus(await this.request(context,'/api/bridge/status'),this.bridge.id);context.token=status.token;
  if(this.bridge.fleetId&&this.bridge.fleetId!==status.fleetId)throw failure('This bridge belongs to a different household. Check its saved card before making changes.',{identity:true});
  const links=bridgeLinksSnapshot(await this.request(context,'/api/bridge/links'),this.bridge.id),mesh=presence(await this.request(context,'/api/mesh/status'),status,links);
  this.snapshot={status,links,mesh,checkedAt:this.now()};return this.snapshot;
 }
 async exclusive(action){if(this.busy||this.nativeFlight)throw failure('This bridge is finishing its previous request. Wait a moment before checking again.',{busy:true});this.busy=true;try{return await action();}finally{this.busy=false;}}
 refresh({signal}={}){return this.exclusive(async()=>this.read(await this.context(signal)));}
 rows(){return bridgeLampRows(this.snapshot,this.lamps(),this.journal.get(this.bridge.id));}
 change(target,action,{signal}={}){
  return this.exclusive(async()=>{
   if(this.journal.blocked||this.journal.get(this.bridge.id))throw unconfirmed();if(!canonical(target)||!['add','remove'].includes(action))throw failure('Choose a saved lamp first.');
   const context=await this.context(signal),snapshot=await this.read(context);if(!snapshot.links.ready||snapshot.links.storageFault||snapshot.links.uncertain)throw failure('The bridge could not confirm its saved settings. Restart it and check again.');
   const row=this.rows().find(value=>value.id===target);if(!row?.owned||action==='add'&&!row.canAdd||action==='remove'&&!row.usesBridge)throw failure('Finish this lamp’s setup in your household before adding it here.');
   const record=this.journal.begin({deviceId:this.bridge.id,target,action,requestId:this.nextRequest(),boot:snapshot.links.boot,revision:snapshot.links.revision,issuedAt:this.now()});let dispatched=false;
   try{
    const value=await this.request(context,'/api/bridge/links',{deviceId:this.bridge.id,target,action,requestId:record.requestId,expectedBoot:record.boot,expectedRevision:String(record.revision)},{onDispatch:()=>{dispatched=true;},allowErrorReceipt:true});
    const result=receipt(value,record);if(result.found&&result.executed===false&&!result.uncertain){const after=await this.read(context);this.journal.clear(this.bridge.id);return {confirmed:false,executed:false,persisted:false,snapshot:after};}if(!result.found||result.uncertain||!result.executed||!result.persisted)throw unconfirmed();
    const after=await this.read(context);if(after.links.boot!==record.boot||after.links.excluded.includes(target)!==(action==='remove'))throw unconfirmed();
    this.journal.clear(this.bridge.id);return {confirmed:true,persisted:true,executed:true,snapshot:after};
   }catch(error){
    if(!dispatched){this.journal.clear(this.bridge.id);throw error;}
    // The production owner/CSRF gate returns 403 before the link handler can
    // execute. Reconcile a fresh snapshot; this is not a lost execution ACK.
    if(error.session){this.journal.clear(this.bridge.id);this.snapshot=null;try{await this.read(context);}catch{/* A later explicit action always reads fresh state. */}return {confirmed:false,executed:false,persisted:false,snapshot:this.snapshot,sessionChanged:true};}
    throw failure('This bridge change is waiting for confirmation. Tap Check change; it will not be sent again.',{uncertain:true});
   }
  });
 }
 reconcile({signal}={}){
  return this.exclusive(async()=>{
   const record=this.journal.get(this.bridge.id);if(!record)return {pending:false,snapshot:await this.read(await this.context(signal))};
   const context=await this.context(signal),status=bridgeStatus(await this.request(context,'/api/bridge/status'),this.bridge.id);context.token=status.token;
   let saved=null;try{saved=receipt(await this.request(context,'/api/bridge/links/receipt',{deviceId:this.bridge.id,requestId:record.requestId,expectedBoot:record.boot},{allowErrorReceipt:true}),record);}catch(error){if(error.identity||error.password)throw error;}
   const snapshot=await this.read(context),matches=snapshot.links.ready&&!snapshot.links.storageFault&&!snapshot.links.uncertain&&snapshot.links.excluded.includes(record.target)===(record.action==='remove');
   if(saved?.found&&saved.executed&&saved.persisted&&!saved.uncertain&&matches){this.journal.clear(this.bridge.id);return {confirmed:true,persisted:true,executed:true,snapshot};}
   if(!saved?.found&&matches&&snapshot.links.revision!==record.revision){this.journal.clear(this.bridge.id);return {confirmed:true,persisted:true,executed:null,receiptUnavailable:true,snapshot};}
   if(saved?.found&&saved.executed===false&&!saved.uncertain){this.journal.clear(this.bridge.id);return {confirmed:false,executed:false,persisted:false,snapshot};}
   return {pending:true,uncertain:true,restarted:snapshot.links.boot!==record.boot,snapshot};
  });
 }
}

export function bridgeLampRows(snapshot,lamps=[],pending=null){
 if(!snapshot)return [];
 const owned=new Map((lamps||[]).filter(lamp=>lamp?.owned!==false&&lampId(lamp)).map(lamp=>[lampId(lamp),lamp])),peers=new Map(snapshot.mesh.peers.map(peer=>[peer.id,peer])),ids=new Set([...owned.keys(),...peers.keys()]);
 return [...ids].filter(id=>id!==snapshot.links.deviceId).slice(0,128).map(id=>{
  const lamp=owned.get(id),peer=peers.get(id),differentFleet=nonce(lamp?.fleetId)&&lamp.fleetId!==snapshot.status.fleetId,sameFleet=!differentFleet&&(lamp?.fleetId===snapshot.status.fleetId||!!peer),known=!!lamp,verified=known&&sameFleet,allowed=!snapshot.links.excluded.includes(id),pendingHere=pending?.target===id;
  return {id,name:name(lamp?.name)||peer?.name||'Lamp '+id,owned:verified,saved:known,online:peer?.online===true,usesBridge:verified&&allowed,canAdd:verified&&!allowed,
   pending:pendingHere,label:pendingHere?'Change waiting for confirmation':!known?'Detected · Finish lamp setup':differentFleet?'Saved lamp · Different household':!sameFleet?'Saved lamp · Household not checked':!allowed?'Not using this bridge':peer?.online?'Can use this bridge · Nearby':'Can use this bridge · Not seen nearby'};
 });
}

const spinner='<span class="bridge-management-spinner" aria-hidden="true"></span>';
function wifiSummary(status){
 const wifi=status.wifi;
 if(wifi?.version!==1||typeof wifi.connected!=='boolean'||typeof wifi.savedName!=='string'||typeof wifi.connectedName!=='string'||bytes(wifi.savedName)>32||bytes(wifi.connectedName)>32)return `<p>Connection when last checked: ${status.wifiConnected?'bridge connected to home Wi-Fi.':'bridge Wi-Fi was disconnected.'} Tap Refresh to check again.</p>`;
 const rssi=wifi.connected&&Number.isInteger(wifi.rssi)&&wifi.rssi<0&&wifi.rssi>=-127?wifi.rssi:null,arcs=rssi===null?0:rssi>=-60?3:rssi>=-75?2:1,strength=arcs===3?'Strong signal':arcs===2?'Good signal':arcs===1?'Weak signal':'Signal not available';
 return `<div class="bridge-management-wifi"><svg viewBox="0 0 48 40" role="img" aria-label="${wifi.connected?'Wi-Fi: '+strength.toLowerCase():'Wi-Fi disconnected'}"><path class="${arcs>=3?'active':''}" d="M4 12Q24-5 44 12"/><path class="${arcs>=2?'active':''}" d="M11 20Q24 9 37 20"/><path class="${arcs>=1?'active':''}" d="M18 28Q24 23 30 28"/><circle class="${wifi.connected?'active':''}" cx="24" cy="35" r="2"/></svg><div><strong>${escaped(wifi.connectedName||wifi.savedName||'Home Wi-Fi')}</strong><small>${wifi.connected?'Connected · '+strength:'Saved network · Reconnecting when available'}</small><small>Connection when last checked. Tap Refresh to check again.</small></div></div>`;
}
// Root supplies saved accessory records and the existing native password vault.
// This module creates no credentials or owned lamp cards from advertisements.
export function mountBridgeManagement(root,{bridges=()=>[],lamps=()=>[],http,getPassword,setPassword,onSetup=()=>{},onFind,onOpenBrowser=url=>globalThis.open?.(url,'_blank','noopener'),onChange=()=>{},storage=globalThis.localStorage,now=Date.now,nextRequest}={}){
 const journal=new BridgeLinkJournal(storage);let selected=null,client=null,busy=false,disposed=false,controller=null,epoch=0,message='',passwordNeeded=false,activeKind='read',activeText='Checking your bridge…',findCursor=null,refreshWhenIdle=false;
 const values=source=>typeof source==='function'?source():source||[];
 const button=(action,text,disabled=false,extra='')=>`<button type="button" data-bridge-action="${action}" ${disabled?'disabled':''} ${extra}>${text}</button>`;
 function render(){
  if(disposed)return;const list=values(bridges).filter(bridge=>canonical(bridge?.id)).slice(0,8),pending=selected&&journal.get(selected.id),snapshot=client?.snapshot;
  root.classList.add('bridge-management');root.setAttribute('aria-busy',String(busy));
  root.innerHTML=`<div class="bridge-management-heading"><h2>${selected?escaped(selected.name||'CoolLamp Bridge'):'Your bridges'}</h2>${selected?button('back','All bridges',busy):button('setup','Add a bridge',busy)}</div><p>A bridge helps nearby lamps stay connected and receive automatic updates. Your lamps keep their household and groups.</p>${message?`<p role="status" aria-live="polite" class="bridge-management-message">${escaped(message)}</p>`:''}${busy?`<div role="status" class="bridge-management-progress">${spinner}<span>${escaped(activeText)}</span>${activeKind==='read'?button('cancel','Stop check'):''}</div>`:''}`;
  if(journal.blocked){root.innerHTML+='<p role="alert">The phone could not read its saved bridge changes. Changing links is blocked until its saved checks can be recovered.</p>';return;}
  if(!selected){if(onFind)root.innerHTML+=button('find',findCursor!==null?'Continue searching':'Find a bridge',busy);root.innerHTML+=list.length?`<div class="bridge-management-cards">${list.map(bridge=>`<button type="button" class="bridge-management-card" data-bridge-id="${bridge.id}" ${busy?'disabled':''}><span class="bridge-management-device" aria-hidden="true">▥</span><strong>${escaped(bridge.name||'CoolLamp Bridge')}</strong><small>${journal.get(bridge.id)?'Change waiting for confirmation':'View lamps and connection'}</small></button>`).join('')}</div>`:'<p>No bridges have been added yet. Add a bridge, then connect it to your home Wi-Fi using its setup page.</p>';return;}
  if(passwordNeeded){root.innerHTML+=`<form data-bridge-password><label>Bridge password<input type="password" name="password" autocomplete="current-password" maxlength="32" required ${busy?'disabled':''}></label><button type="submit" ${busy?'disabled aria-busy="true"':''}>Connect to bridge</button></form>`;return;}
  root.innerHTML+=`<div class="bridge-management-toolbar">${button(pending?'reconcile':'refresh',pending?'Check change':'Refresh',busy)}${button('browser','Open bridge setup',busy)}</div>`;
  if(pending)root.innerHTML+=`<div class="bridge-management-pending" role="status">The ${pending.action==='remove'?'removal':'addition'} is waiting for this bridge’s confirmation. Check change reads its saved result and does not send it again.</div>`;
  if(!snapshot)return;
  const disabled=busy||!!pending||!snapshot.links.ready||snapshot.links.storageFault||snapshot.links.uncertain;
  root.innerHTML+=`${wifiSummary(snapshot.status)}<p>${snapshot.status.donation?.enabled?'Automatic update sharing is on.':'Automatic update sharing is off.'}</p><h3>Lamps for this bridge</h3><p>“Can use this bridge” means this bridge is allowed to help that lamp. It does not mean the lamp is connected through it right now.</p><p>Remove stops only this bridge from helping that lamp. It keeps the lamp’s settings, ownership and group.</p><ul class="bridge-management-lamps">${client.rows().map(row=>`<li><div><strong>${escaped(row.name)}</strong><small>${escaped(row.label)}</small></div>${row.owned?button(row.usesBridge?'remove':'add',row.pending?'Waiting for confirmation':row.usesBridge?'Remove':'Add',disabled||!row.usesBridge&&!row.canAdd,`data-bridge-target="${row.id}"`):button('lamp-setup',row.saved?'Check lamp setup':'Finish lamp setup',busy,`data-bridge-target="${row.id}"`)}</li>`).join('')}</ul>${!client.rows().length?'<p>No lamps were seen by this bridge yet. Keep an owned lamp powered nearby and tap Refresh.</p>':''}`;
 }
 async function perform(action,kind='read',text='Checking your bridge…'){
  if(busy||disposed)return;busy=true;activeKind=kind;activeText=text;controller=new AbortController();const owned=controller,generation=epoch;render();
  let abort;
  try{const result=await Promise.race([Promise.resolve().then(()=>{if(owned.signal.aborted)throw cancelled();return action(owned.signal);}),new Promise((_,reject)=>{abort=()=>reject(cancelled());owned.signal.addEventListener('abort',abort,{once:true});})]);if(disposed||generation!==epoch)return;passwordNeeded=false;if(result?.pending)message='The change is still unconfirmed. Keep the bridge powered and check again.';else if(result?.receiptUnavailable)message='The current bridge setting is confirmed. Its earlier request receipt is no longer available.';else if(result?.confirmed===true)message='Bridge lamp setting saved.';else if(result?.executed===false)message=result.sessionChanged?'The bridge connection changed before this could be saved. Nothing changed. Refresh, then try again.':'The bridge did not make this change. Its current setting is shown below.';else message='Bridge connection checked.';try{onChange(client?.snapshot);}catch{/* A display callback cannot turn a confirmed save into a failed change. */}}
  catch(error){if(!disposed&&generation===epoch){passwordNeeded=error.password===true;message=error.cancelled?'Bridge check stopped.':error.message;}}
  finally{owned.signal.removeEventListener('abort',abort);if(controller===owned)controller=null;busy=false;render();if(refreshWhenIdle&&!disposed&&!root.ownerDocument?.hidden&&selected&&client){refreshWhenIdle=false;void perform(signal=>journal.get(selected.id)?client.reconcile({signal}):client.refresh({signal}));}}
 }
 async function open(id){
  if(busy)return;selected=values(bridges).find(bridge=>bridge.id===id);if(!selected)return;epoch++;message='';passwordNeeded=false;
  try{client=new BridgeManagementClient({bridge:selected,http,getPassword,journal,lamps:()=>values(lamps),now,nextRequest});}catch(error){message=error.message;client=null;render();return;}
  await perform(signal=>journal.get(id)?client.reconcile({signal}):client.refresh({signal}));
 }
 function click(event){
  const node=event.target.closest?.('button');if(!node||!root.contains(node)||node.disabled)return;
  if(node.dataset.bridgeId){void open(node.dataset.bridgeId);return;}
  const action=node.dataset.bridgeAction,target=node.dataset.bridgeTarget;if(action==='cancel'&&busy&&activeKind==='read'){controller?.abort();return;}if(!action||busy)return;
  if(action==='setup'||action==='lamp-setup'){onSetup(target?{lampId:target,bridgeId:selected.id}:{role:'bridge'});return;}
  if(action==='back'){epoch++;controller?.abort();selected=null;client=null;message='';passwordNeeded=false;render();return;}
  if(action==='browser'){onOpenBrowser(client?.bridge.address||selected.address);return;}
  if(action==='find'&&onFind)void perform(async signal=>{const result=await onFind({signal,continue:findCursor!==null});if(signal.aborted)throw cancelled();findCursor=result?.cursor??null;return result;},'read','Looking for bridges…');
  if(action==='refresh')void perform(signal=>client.refresh({signal}));
  if(action==='reconcile')void perform(signal=>client.reconcile({signal}));
  if(action==='add'||action==='remove')void perform(signal=>client.change(target,action,{signal}),'change',action==='remove'?'Removing lamp from this bridge…':'Adding lamp to this bridge…');
 }
 async function submit(event){
  if(!event.target.matches?.('[data-bridge-password]'))return;event.preventDefault();if(busy||!selected||!client)return;
  const input=event.target.querySelector('input[name="password"]'),password=input.value;input.value='';if(bytes(password)<8||bytes(password)>32){message='Enter the bridge password you chose during setup.';render();return;}
  if(typeof setPassword!=='function'){message='Bridge passwords need the phone’s secure storage. Open bridge setup to check the connection.';render();return;}
  await perform(async signal=>{await setPassword(selected.id,password);if(signal.aborted)throw cancelled();return journal.get(selected.id)?client.reconcile({signal}):client.refresh({signal});},'change','Connecting to your bridge…');
 }
 const hidden=()=>{
  if(root.ownerDocument?.hidden){epoch++;controller?.abort();if(client)client.snapshot=null;message=selected?'The bridge will be checked again when you return.':'';render();}
  else if(selected&&client&&!disposed){if(busy)refreshWhenIdle=true;else void perform(signal=>journal.get(selected.id)?client.reconcile({signal}):client.refresh({signal}));}
 };
 root.addEventListener('click',click);root.addEventListener('submit',submit);root.ownerDocument?.addEventListener('visibilitychange',hidden);render();
 return {refresh:render,open,dispose(){disposed=true;epoch++;controller?.abort();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.ownerDocument?.removeEventListener('visibilitychange',hidden);}};
}
