const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync('bridge/BridgePage.h','utf8');
const page=source.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/)[1];
assert(Buffer.byteLength(page)+1<=32768,'password-first page exceeds deliberate 32 KiB bound');
assert(page.includes('id="passwordSetup" hidden'));assert(page.includes('id="bridgeFeatures" class="grid" hidden'));
assert(page.includes('class="spinner" aria-hidden="true"'));assert(page.includes('autocomplete="new-password"'));
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<10;++i)await new Promise(done=>setTimeout(done,1));};
function fixture({passwordSet=false,...patch}={}){
 const elements={},listeners={},calls=[],timers=new Map(),f={mode:'saved',reply:{saved:true,reconnect:true}};
 const element=id=>elements[id]??={value:'',textContent:'',disabled:false,children:[],events:{},
  classList:{values:new Set(),toggle(key,force){if(force)this.values.add(key);else this.values.delete(key);}},
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(event,handler){this.events[event]=handler;},setAttribute(name,value){(this.attributes??={})[name]=String(value);},focus(){}};
 const document={hidden:false,getElementById:element,createElement:()=>element('option-'+crypto.randomUUID()),addEventListener:(event,handler)=>{listeners[event]=handler;}};
 const status={role:'bridge',deviceId:'040302010002',version:'0.1.0',token:'0123456789abcdef0123456789abcdef',passwordSet,...patch};
 const context={document,crypto,URLSearchParams,Uint8Array,TextDecoder,TextEncoder,AbortController,DOMException,Date,
  atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:(handler,delay)=>{const handle=setTimeout(()=>{timers.delete(handle);handler();},delay<=350?0:delay);timers.set(handle,{handler,delay});if(delay>350)handle.unref();return handle;},
  clearTimeout:handle=>{timers.delete(handle);clearTimeout(handle);},
  fetch:async(url,options)=>{
   const fields=options.body?Object.fromEntries(new URLSearchParams(options.body)):{};
   calls.push({url,method:options.method||'GET',fields});
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   let value;
   if(url==='/api/bridge/status')value=status;
   else if(url==='/api/mesh/status'){
    assert.notEqual(status.passwordSet,false,'inventory requested before choosing a password');
    value={version:1,deviceId:status.deviceId,available:false,peers:[]};
   }else if(url==='/api/bridge/password'){
    assert.equal(options.method,'POST');assert.equal(options.headers['X-Lamp-Token'],status.token);
    assert.equal(fields.password,fields.confirm);assert.equal(element('ownerPassword').value,'');assert.equal(element('ownerPasswordConfirm').value,'');
    if(f.gate)await f.gate.promise;
    if(f.mode==='lost')throw Error('Password response unavailable');
    if(f.mode==='rejected')return {ok:false,text:async()=> 'Save could not be confirmed'};
    value=f.reply;
   }else throw Error('Unexpected setup request '+url);
   return {ok:true,text:async()=>JSON.stringify(value)};
  }};
 vm.createContext(context);vm.runInContext(script,context);
 return Object.assign(f,{elements,listeners,calls,status,document,timers,element,
  submit:(password,confirm=password)=>{element('ownerPassword').value=password;element('ownerPasswordConfirm').value=confirm;return element('ownerPasswordForm').onsubmit({preventDefault(){}});},
  posts:()=>calls.filter(call=>call.url==='/api/bridge/password'),
  resume:async()=>{document.hidden=true;listeners.visibilitychange();document.hidden=false;listeners.visibilitychange();await flush();},
  dispose:()=>{document.hidden=true;listeners.visibilitychange();}});
}

(async()=>{
 const first=fixture();assert.equal(first.element('bridgeFeatures').hidden,true,'ordinary features briefly appeared before public status');await flush();
 assert.equal(first.element('passwordSetup').hidden,false);assert.equal(first.element('bridgeFeatures').hidden,true);
 assert.match(first.element('message').textContent,/Open setup Wi-Fi/);
 assert(first.calls.every(call=>call.url==='/api/bridge/status'));
 for(const id of ['wifiFind','wifiSave','ssid','wifiPassword','cacheCheck','donationToggle','readLamp','on','off'])assert.equal(first.element(id).disabled,true);
 first.element('wifiFind').onclick();first.element('cacheCheck').onclick();first.element('donationToggle').onclick();await flush();
 assert(first.calls.every(call=>call.url==='/api/bridge/status'),'scan or other endpoint requested before password choice');
 first.gate=deferred();const saving=first.submit('chosen-passphrase');
 assert.equal(first.element('ownerPassword').value,'');assert.equal(first.element('ownerPasswordConfirm').value,'');
 await flush();assert.equal(first.posts().length,1);assert.equal(first.element('passwordSetup').hidden,false);
 assert.equal(first.element('ownerPasswordBusy').classList.values.has('hide'),false);assert.equal(first.element('ownerPasswordSave').disabled,true);
 first.gate.resolve();await saving;assert.equal(first.element('ownerPasswordBusy').classList.values.has('hide'),true);
 assert.match(first.element('ownerPasswordState').textContent,/Password saved\. Reconnect to CoolLampBridge-0002.*reopen 192\.168\.4\.1.*OWNER/);
 assert(!first.element('ownerPasswordState').textContent.includes('chosen-passphrase'));
 assert.equal(first.element('bridgeFeatures').hidden,true);assert.equal(first.element('ownerPasswordSave').disabled,true);
 assert.equal([...first.timers.values()].filter(timer=>timer.delay===2000).length,0,'poll remained scheduled after durable save');
 const savedCalls=first.calls.length;await first.resume();assert.equal(first.calls.length,savedCalls,'resume performed requests after password save');
 await first.submit('another-password');assert.equal(first.posts().length,1,'password mutation replayed after saved result');first.dispose();

 for(const [password,confirm,expected] of [['1234567','1234567',/8 to 32 letters/],['x'.repeat(33),'x'.repeat(33),/8 to 32 letters/],
  ['🌈'.repeat(9),'🌈'.repeat(9),/8 to 32 letters/],['matching-length','different-length',/do not match/]]){
  const invalid=fixture();await flush();await invalid.submit(password,confirm);assert.equal(invalid.posts().length,0);
  assert.match(invalid.element('ownerPasswordState').textContent,expected);assert.equal(invalid.element('ownerPassword').value,'');
  assert.equal(invalid.element('ownerPasswordConfirm').value,'');invalid.dispose();
 }
 for(const password of ['🌈🌈','x'.repeat(32),' leading spaces ']){
  const valid=fixture();await flush();await valid.submit(password);assert.equal(valid.posts().length,1);assert.equal(valid.posts()[0].fields.password,password);
  assert.match(valid.element('ownerPasswordState').textContent,/Password saved/);valid.dispose();
 }

 for(const mode of ['lost','rejected','invalid']){
  const unknown=fixture();await flush();unknown.mode=mode;if(mode==='invalid')unknown.reply={saved:true,reconnect:false};
  await unknown.submit('private-choice');assert.equal(unknown.posts().length,1);
  assert.match(unknown.element('ownerPasswordState').textContent,/save unconfirmed.*Try joining.*reopen.*check.*OWNER/);
  assert(!/unchanged|Password saved\./.test(unknown.element('ownerPasswordState').textContent));
  assert(!unknown.element('ownerPasswordState').textContent.includes('private-choice'));
  assert.equal(unknown.element('ownerPassword').value,'');assert.equal(unknown.element('ownerPasswordConfirm').value,'');
  const count=unknown.calls.length;await unknown.resume();assert.equal(unknown.calls.length,count);
  await unknown.submit('second-attempt');assert.equal(unknown.posts().length,1,'unconfirmed password automatically replayed');unknown.dispose();
 }

 const background=fixture();await flush();background.gate=deferred();background.mode='lost';const mutation=background.submit('background-secret');
 await flush();background.document.hidden=true;background.listeners.visibilitychange();background.gate.resolve();await mutation;
 assert.equal(background.posts().length,1);assert.match(background.element('ownerPasswordState').textContent,/unconfirmed/);
 await background.resume();assert.equal(background.posts().length,1);background.dispose();

 const token=fixture({token:undefined});await flush();await token.submit('token-not-ready');assert.equal(token.posts().length,0);
 assert.match(token.element('ownerPasswordState').textContent,/Refresh bridge status/);token.dispose();
 const fault=fixture({storageFault:true});await flush();assert.equal(fault.element('ownerPasswordSave').disabled,true);
 assert.match(fault.element('ownerPasswordState').textContent,/could not be read/);await fault.submit('fault-not-sent');assert.equal(fault.posts().length,0);fault.dispose();
 for(const passwordSet of [true,undefined]){
  const existing=fixture({passwordSet:true});if(passwordSet===undefined)delete existing.status.passwordSet;
  await flush();assert.equal(existing.element('passwordSetup').hidden,true);
  assert.equal(existing.element('bridgeFeatures').hidden,false);assert(existing.calls.some(call=>call.url==='/api/mesh/status'));
  await existing.submit('must-not-replace');assert.equal(existing.posts().length,0);existing.dispose();
 }
 console.log('PASS first-time bridge password setup: public status only, hidden/gated features, token/exact UTF-8 password confirmation, cleared inputs, visible save spinner, durable acknowledgment reconnect guidance, stopped polling and honest lost-reply reconciliation without replay, configured/legacy compatibility.');
})().catch(error=>{console.error(error);process.exitCode=1;});
