const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const header=fs.readFileSync('bridge/BridgePage.h','utf8'),page=header.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/)[1];
assert(Buffer.byteLength(page)+1<=32768);
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<8;++i)await new Promise(done=>setTimeout(done,1));};
function fixture(passwordSet,patch={}){
 const elements={},listeners={},calls=[],timers=new Map(),document={hidden:false,activeElement:null},f={active:0,peak:0,blurred:[]};
 const element=id=>{
  if(elements[id])return elements[id];let disabled=false,value='';
  const node={textContent:'',children:[],events:{},selectionStart:0,
   classList:{values:new Set(),toggle(key,force){if(force)this.values.add(key);else this.values.delete(key);}},
   focus(){if(!disabled)document.activeElement=this;},append(child){this.children.push(child);},
   replaceChildren(){if(document.activeElement===this){document.activeElement=null;f.blurred.push(id+':options');}this.children=[];},
   addEventListener(event,handler){this.events[event]=handler;},setAttribute(name,value){(this.attributes??={})[name]=String(value);}};
  Object.defineProperties(node,{disabled:{get:()=>disabled,set:next=>{next=Boolean(next);if(next&&!disabled&&document.activeElement===node){document.activeElement=null;f.blurred.push(id+':disabled');}disabled=next;}},
   value:{get:()=>value,set:next=>{value=String(next);node.selectionStart=value.length;}}});
  return elements[id]=node;
 };
 Object.assign(document,{getElementById:element,createElement:()=>element('option-'+crypto.randomUUID()),addEventListener:(event,handler)=>{listeners[event]=handler;}});
 const status={role:'bridge',deviceId:'040302010002',version:'0.2.1',token:'0123456789abcdef0123456789abcdef',passwordSet,wifiSave:'not-requested',cache:{phase:'empty'},donation:{enabled:false},...patch};
 const inventory={version:1,deviceId:status.deviceId,available:true,peers:[{id:'060302010002',boot:'1111111111111111',name:'Lamp',online:true,hops:1}]};
 const context={document,crypto,URLSearchParams,Uint8Array,TextDecoder,TextEncoder,AbortController,DOMException,Date,
  atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:(handler,delay)=>{const handle=setTimeout(()=>{timers.delete(handle);handler();},delay<=350?0:delay);timers.set(handle,{handler,delay});if(delay>350)handle.unref();return handle;},
  clearTimeout:handle=>{timers.delete(handle);clearTimeout(handle);},
  fetch:async(url,options)=>{
   f.active++;f.peak=Math.max(f.peak,f.active);const fields=options.body?Object.fromEntries(new URLSearchParams(options.body)):{};
   calls.push({url,method:options.method||'GET',fields});
   try{
    let value;
    if(url==='/api/bridge/status'){if(f.statusGate)await f.statusGate.promise;if(options.signal.aborted)throw new DOMException('Aborted','AbortError');value=status;}
    else if(url==='/api/mesh/status'){assert.notEqual(passwordSet,false);value=inventory;}
    else if(url==='/api/bridge/wifi'){if(f.wifiGate)await f.wifiGate.promise;if(f.wifiError)throw Error(f.wifiError);value={accepted:true,saved:false};}
    else if(url==='/api/bridge/cache/check'){if(f.cacheGate)await f.cacheGate.promise;value={accepted:true};}
    else if(url==='/api/bridge/donation'){if(f.donationGate)await f.donationGate.promise;status.donation.enabled=fields.enabled==='1';value={saved:true};}
    else if(url==='/api/bridge/wifi/scan')value={accepted:true,generation:1};
    else if(url==='/api/bridge/wifi/networks')value={phase:'ready',generation:1,truncated:false,error:'',networks:[{ssid:'Home',rssi:-42,channel:6,secure:true,supported:true}]};
    else throw Error('Unexpected request '+url);
    return {ok:true,text:async()=>JSON.stringify(value)};
   }finally{f.active--;}
  }};
 vm.createContext(context);vm.runInContext(script,context);
 const fire=delay=>{const entry=[...timers.entries()].find(([,value])=>value.delay===delay);assert(entry,'Expected pending '+delay+' ms timer');timers.delete(entry[0]);clearTimeout(entry[0]);return entry[1].handler();};
 return Object.assign(f,{document,elements,listeners,calls,timers,element,status,inventory,fire,
  save:()=>element('wifiForm').onsubmit({preventDefault(){}}),
  wifiPosts:()=>calls.filter(call=>call.url==='/api/bridge/wifi'),
  resume:()=>{document.hidden=true;listeners.visibilitychange();document.hidden=false;listeners.visibilitychange();},
  dispose:()=>{document.hidden=true;listeners.visibilitychange();}});
}

(async()=>{
 const first=fixture(false);await flush();const password=first.element('ownerPassword'),confirm=first.element('ownerPasswordConfirm');
 password.value='first-password';password.focus();password.selectionStart=5;const calls=first.calls.length;
 assert.equal([...first.timers.values()].filter(value=>value.delay===2000).length,0,'password screen scheduled repeated reads');
 await flush();assert.equal(first.document.activeElement,password);assert.equal(password.selectionStart,5);assert.equal(password.value,'first-password');
 confirm.value='first-password';confirm.focus();confirm.selectionStart=7;first.resume();await flush();
 assert.equal(first.calls.length,calls,'password screen resumed background polling');assert.equal(first.document.activeElement,confirm);
 assert.equal(confirm.selectionStart,7);assert.equal(confirm.value,'first-password');assert.equal(first.blurred.length,0);first.dispose();

 const configured=fixture(true);await flush();const ssid=configured.element('ssid'),wifiPassword=configured.element('wifiPassword');
 ssid.value='Manual hidden home';wifiPassword.value='manual-password';ssid.focus();ssid.selectionStart=6;
 await configured.fire(2000);assert.equal(configured.document.activeElement,ssid);assert.equal(ssid.selectionStart,6);
 assert.equal(ssid.value,'Manual hidden home');assert.equal(wifiPassword.value,'manual-password');
 wifiPassword.focus();wifiPassword.selectionStart=4;await configured.fire(2000);
 assert.equal(configured.document.activeElement,wifiPassword);assert.equal(wifiPassword.selectionStart,4);
 configured.element('lamp').value='060302010002';configured.element('lamp').events.change();configured.element('lamp').focus();
 const choices=configured.element('lamp').children;await configured.fire(2000);
 assert.equal(configured.document.activeElement,configured.element('lamp'));assert.equal(configured.element('lamp').children,choices);
 assert.equal(configured.element('lamp').value,'060302010002');
 await configured.element('wifiFind').onclick();configured.element('wifiNetworks').value='0';configured.element('wifiNetworks').events.change();configured.element('wifiNetworks').focus();
 await configured.fire(2000);assert.equal(configured.document.activeElement,configured.element('wifiNetworks'));
 assert.equal(configured.element('wifiNetworks').value,'0');assert.equal(configured.blurred.length,0);configured.dispose();

 const queued=fixture(true);await flush();queued.statusGate=deferred();queued.element('ssid').value='Chosen home';queued.element('wifiPassword').value='saved-intent-password';
 queued.element('ssid').focus();const read=queued.fire(2000);await flush();
 assert.equal(queued.document.activeElement,queued.element('ssid'));assert.equal(queued.element('wifiSave').disabled,false);
 const save=queued.save();assert.equal(queued.element('wifiPassword').value,'');await flush();
 queued.element('wifiPassword').value='duplicate-must-not-send';await queued.save();
 assert.equal(queued.element('wifiSave').attributes['aria-busy'],'true');assert.match(queued.element('operationText').textContent,/Connecting and saving.*current check/);
 assert.equal(queued.wifiPosts().length,0,'mutation overlapped its status read');assert.match(queued.element('message').textContent,/Waiting for bridge status/);
 queued.statusGate.resolve();await read;await save;
 assert.equal(queued.wifiPosts().length,1,'Save clicked during a cached read was dropped');
 assert.equal(queued.wifiPosts()[0].fields.ssid,'Chosen home');assert.equal(queued.wifiPosts()[0].fields.password,'saved-intent-password');
 assert.equal(queued.peak,1,'more than one HTTP request owned the page');queued.dispose();

 const expired=fixture(true);await flush();expired.statusGate=deferred();const readLate=expired.fire(2000);await flush();
 expired.element('ssid').value='Must not be sent';expired.element('wifiPassword').value='expired-intent';const expiredSave=expired.save();
 expired.fire(6000);await expiredSave;assert.match(expired.element('message').textContent,/still busy.*Try again/);
 expired.statusGate.resolve();await readLate;assert.equal(expired.wifiPosts().length,0,'expired foreground intent dispatched late');expired.dispose();

 for(const reason of ['background','configuration','token']){
  const canceled=fixture(true);await flush();canceled.statusGate=deferred();const reading=canceled.fire(2000);await flush();
  canceled.element('ssid').value='Canceled home';canceled.element('wifiPassword').value='canceled-intent';const saving=canceled.save();
  if(reason==='background'){canceled.document.hidden=true;canceled.listeners.visibilitychange();}
  if(reason==='configuration')canceled.status.storageFault=true;
  if(reason==='token')canceled.status.token='ffffffffffffffffffffffffffffffff';
  canceled.statusGate.resolve();await reading;await saving;assert.equal(canceled.wifiPosts().length,0,'changed/canceled read dispatched its mutation');
  assert.equal(canceled.peak,1);canceled.dispose();
 }

 const home={version:1,configured:true,savedName:'Home <img>',connected:true,connectedName:'Home <img>',rssi:-48};
 const summary=fixture(true,{wifiConfigured:true,wifiConnected:true,wifi:home});await flush();
 assert.equal(summary.element('wifiEditor').hidden,true);assert.equal(summary.element('wifiSummary').hidden,false);
 assert.equal(summary.element('wifiName').textContent,'Home <img>');assert(!('innerHTML' in summary.element('wifiName')));
 for(const id of ['wifiArc1','wifiArc2','wifiArc3'])assert.equal(summary.element(id).classList.values.has('lit'),true);
 assert.equal(summary.element('wifiSignal').attributes['aria-label'],'Wi-Fi: strong signal');
 summary.element('wifiReconfigure').onclick();assert.equal(summary.element('wifiEditor').hidden,false);
 assert.equal(summary.document.activeElement,summary.element('ssid'));summary.element('ssid').value='Another hidden network';summary.element('wifiPassword').value='new-private-password';summary.element('ssid').selectionStart=5;
 await summary.fire(2000);assert.equal(summary.document.activeElement,summary.element('ssid'));assert.equal(summary.element('ssid').selectionStart,5);assert.equal(summary.element('ssid').value,'Another hidden network');
 summary.element('wifiCancel').onclick();assert.equal(summary.element('wifiEditor').hidden,true);assert.equal(summary.element('wifiPassword').value,'');
 summary.status.wifi={...home,connected:false,connectedName:'',rssi:null};summary.status.wifiConnected=false;
 await summary.fire(2000);assert.equal(summary.element('wifiEditor').hidden,true);assert.equal(summary.element('wifiName').textContent,'Home <img>');assert.match(summary.element('wifiConnection').textContent,/Saved network.*Reconnecting/);assert.equal(summary.element('wifiArc1').classList.values.has('lit'),false);
 for(const [rssi,expected] of [[-64,2],[-90,1],[null,0]]){summary.status.wifi={...home,rssi};await summary.fire(2000);for(let n=1;n<=3;n++)assert.equal(summary.element('wifiArc'+n).classList.values.has('lit'),n<=expected);}
 summary.dispose();

 const saving=fixture(true,{wifiConfigured:true,wifiConnected:true,wifi:{...home}});await flush();saving.element('wifiReconfigure').onclick();saving.element('ssid').value='New home';saving.element('wifiPassword').value='private-save-value';saving.wifiGate=deferred();
 const pendingSave=saving.save();await flush();assert.equal(saving.wifiPosts().length,1);assert.equal(saving.element('wifiSave').disabled,true);assert.equal(saving.element('wifiSave').attributes['aria-busy'],'true');assert.equal(saving.element('wifiBusy').classList.values.has('hide'),false);
 await saving.save();assert.equal(saving.wifiPosts().length,1);saving.status.wifiSave='connecting';saving.wifiGate.resolve();await pendingSave;
 assert.equal(saving.element('wifiSave').disabled,true,'accepted Wi-Fi connection enabled another save before its result');await saving.fire(2000);assert.equal(saving.element('wifiEditor').hidden,false);
 saving.status.wifiSave='saved';saving.status.wifi={...home,savedName:'New home',connectedName:'New home'};await saving.fire(2000);
 assert.equal(saving.element('wifiEditor').hidden,true);assert.equal(saving.element('wifiName').textContent,'New home');assert.equal(saving.element('wifiBusy').classList.values.has('hide'),true);assert.equal(saving.element('wifiSave').attributes['aria-busy'],'false');assert.match(saving.element('message').textContent,/connected and saved/);saving.dispose();

 for(const result of ['failed-previous-kept','save-failed-previous-kept']){
  const failed=fixture(true,{wifiConfigured:true,wifiConnected:true,wifi:{...home}});await flush();failed.element('wifiReconfigure').onclick();failed.element('ssid').value='Unreachable new home';failed.element('wifiPassword').value='dont-log';await failed.save();
  failed.status.wifiSave=result;await failed.fire(2000);assert.equal(failed.element('wifiEditor').hidden,false);assert.equal(failed.element('wifiSave').disabled,false);assert.equal(failed.element('wifiName').textContent,'Home <img>');assert.match(failed.element('wifiState').textContent,/Previous.*network kept/);failed.dispose();
 }

 const lost=fixture(true,{wifiConfigured:true,wifiConnected:true,wifi:{...home}});await flush();lost.element('wifiReconfigure').onclick();lost.element('ssid').value='New uncertain home';lost.element('wifiPassword').value='dont-show';lost.wifiGate=deferred();
 const lostSave=lost.save();await flush();lost.document.hidden=true;lost.listeners.visibilitychange();lost.wifiGate.resolve();await lostSave;
 assert.equal(lost.wifiPosts().length,1);assert.match(lost.element('wifiBusyText').textContent,/Checking whether/);lost.status.wifiSave='saved';lost.status.wifi={...home,savedName:'New uncertain home',connectedName:'New uncertain home'};
 lost.document.hidden=false;lost.listeners.visibilitychange();await flush();assert.equal(lost.wifiPosts().length,1,'returning to tab replayed an uncertain network save');assert.equal(lost.element('wifiEditor').hidden,true);lost.dispose();

 for(const [id,gate] of [['cacheCheck','cacheGate'],['donationToggle','donationGate']]){
  const primary=fixture(true);await flush();primary[gate]=deferred();const action=primary.element(id).onclick();await flush();
  assert.equal(primary.element(id).disabled,true);assert.equal(primary.element(id).attributes['aria-busy'],'true');assert.equal(primary.element('operationBusy').classList.values.has('hide'),false);
  await primary.element(id).onclick();assert.equal(primary.calls.filter(call=>call.method==='POST').length,1);primary[gate].resolve();await action;
  if(id==='cacheCheck'){
   assert.equal(primary.element(id).attributes['aria-busy'],'true');assert.equal(primary.element(id).disabled,true);await primary.element(id).onclick();assert.equal(primary.calls.filter(call=>call.method==='POST').length,1);
   primary.status.cache.phase='downloading';await primary.fire(2000);assert.equal(primary.element(id).attributes['aria-busy'],'true');primary.status.cache.phase='ready';await primary.fire(2000);
  }
  assert.equal(primary.element(id).attributes['aria-busy'],'false');assert.equal(primary.element('operationBusy').classList.values.has('hide'),true);primary.dispose();
 }
 const invalid=fixture(true,{wifi:{...home,savedName:'x'.repeat(33)}});await flush();assert.match(invalid.element('message').textContent,/details were not confirmed/);invalid.dispose();
 console.log('PASS bridge owner UI: password/manual form focus; serialized queued intent and duplicate clicks; spinners/aria busy; saved network summary, accessible RSSI arcs and safe text; intentional reconfiguration/cancel; association save progress and failure preservation; tab cancellation reconciles without mutation replay.');
})().catch(error=>{console.error(error);process.exitCode=1;});
