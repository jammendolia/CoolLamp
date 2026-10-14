const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const header=fs.readFileSync('bridge/BridgePage.h','utf8');
const page=header.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/)[1];
assert(Buffer.byteLength(page)+1<=32768,'bridge page exceeds its deliberate 32 KiB bound');
assert(header.includes('sizeof(COOLLAMP_BRIDGE_PAGE)<=32768'));
assert(page.includes('id="wifiFind" type="button"'));
assert(page.includes('id="wifiScanState" class="details" role="status" aria-live="polite"'));
assert(page.includes('You can enter a hidden network here.'));
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<10;++i)await new Promise(done=>setTimeout(done,1));};
function fixture(){
 const elements={},listeners={},calls=[],f={clock:100000,mode:'ready',scanGeneration:1,networkPatch:{},clockAdvance:0};
 const element=id=>elements[id]??={value:'',textContent:'',disabled:false,children:[],events:{},
  classList:{values:new Set(),toggle(key,force){if(force)this.values.add(key);else this.values.delete(key);}},
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(event,handler){this.events[event]=handler;},setAttribute(name,value){(this.attributes??={})[name]=String(value);},focus(){}};
 const document={hidden:false,getElementById:element,createElement:()=>element('option-'+crypto.randomUUID()),
  addEventListener:(event,handler)=>{listeners[event]=handler;}};
 const status={role:'bridge',deviceId:'040302010002',name:'Bridge',version:'0.1.0',
  token:'0123456789abcdef0123456789abcdef',wifiConnected:false,setupAp:true,storageFault:false,
  configurationUncertain:false,wifiSave:'not-requested',cache:{phase:'empty'},donation:{enabled:false}};
 const networks=[{ssid:'Kitchen <img>',rssi:-43,channel:6,secure:true,supported:true},
  {ssid:'Office enterprise',rssi:-50,channel:6,secure:true,supported:false},
  {ssid:'Open network',rssi:-75,channel:1,secure:false,supported:true}];
 const snapshot=()=>({phase:'ready',generation:f.scanGeneration,networks,truncated:false,error:'',...f.networkPatch});
 const context={document,crypto,URLSearchParams,Uint8Array,TextDecoder,TextEncoder,AbortController,DOMException,
  Date:class extends Date{static now(){return f.clock;}},atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:(handler,delay)=>{const handle=setTimeout(()=>{if(delay<=350)f.clock+=delay;handler();},delay<=350?0:delay);if(delay>350)handle.unref();return handle;},clearTimeout,
  fetch:async(url,options)=>{
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   const fields=options.body?Object.fromEntries(new URLSearchParams(options.body)):{};
   calls.push({path:url,fields,method:options.method||'GET'});
   if(options.method==='POST')assert.equal(options.headers['X-Lamp-Token'],status.token);
   let value;
   if(url==='/api/bridge/status')value=status;
   else if(url==='/api/mesh/status')value={version:1,deviceId:status.deviceId,available:false,peers:[]};
   else if(url==='/api/bridge/wifi/scan'){
    assert.deepEqual(fields,{});if(f.mode==='lost')throw Error('Search reply unavailable');
    value={accepted:true,generation:f.scanGeneration,...f.startPatch};
   }else if(url==='/api/bridge/wifi/networks'){
    f.readCount=(f.readCount||0)+1;
    if(f.gate)await f.gate.promise;
    f.clock+=f.clockAdvance;
    value=f.networkRead?f.networkRead(snapshot(),f.readCount):snapshot();
   }else if(url==='/api/bridge/wifi')value={accepted:true,saved:false};
   else throw Error('Unexpected page route '+url);
   return {ok:true,text:async()=>JSON.stringify(value)};
  }};
 vm.createContext(context);vm.runInContext(script,context);
 return Object.assign(f,{document,elements,listeners,calls,status,networks,element,
  click:()=>element('wifiFind').onclick(),
  posts:()=>calls.filter(call=>call.path==='/api/bridge/wifi/scan'),
  reads:()=>calls.filter(call=>call.path==='/api/bridge/wifi/networks'),
  resume:async()=>{document.hidden=true;listeners.visibilitychange();document.hidden=false;listeners.visibilitychange();await flush();},
  dispose:()=>{document.hidden=true;listeners.visibilitychange();}});
}

(async()=>{
 const normal=fixture();await flush();
 assert.equal(normal.posts().length,0);assert.equal(normal.reads().length,0,'status GETs must never initiate a search');
 assert.equal(normal.element('wifiFind').textContent,'Find Wi-Fi');
 normal.element('ssid').value='Typed hidden name';normal.element('wifiPassword').value='typed-password';
 await normal.click();assert.equal(normal.posts().length,1);assert.equal(normal.reads().length,1);
 assert.equal(normal.element('wifiFind').textContent,'Refresh');assert.equal(normal.element('ssid').value,'Typed hidden name');
 assert.equal(normal.element('wifiPassword').value,'typed-password');
 const options=normal.element('wifiNetworks').children;assert.equal(options.length,4);
 assert.equal(options[1].textContent,'Kitchen <img> — secured · strong signal');assert.equal(options[2].disabled,true);
 assert.match(options[2].textContent,/unsupported security/);assert.match(options[3].textContent,/open/);
 assert(options.every(option=>!Object.hasOwn(option,'innerHTML')),'network names must use text nodes');
 normal.element('wifiNetworks').value='1';normal.element('wifiNetworks').events.change();assert.equal(normal.element('ssid').value,'Typed hidden name');
 normal.element('wifiNetworks').value='0';normal.element('wifiNetworks').events.change();assert.equal(normal.element('ssid').value,'Kitchen <img>');
 assert.equal(normal.element('wifiPassword').value,'typed-password');
 normal.element('ssid').value='Another hidden name';await normal.click();assert.equal(normal.posts().length,2);
 assert.equal(normal.element('ssid').value,'Another hidden name');
 normal.element('wifiForm').onsubmit({preventDefault(){}});await flush();
 const saved=normal.calls.find(call=>call.path==='/api/bridge/wifi');assert.equal(saved.fields.ssid,'Another hidden name');
 assert.equal(saved.fields.password,'typed-password');assert.equal(normal.element('wifiPassword').value,'');
 assert(!normal.element('message').textContent.includes('typed-password'));normal.dispose();

 const delayed=fixture();await flush();delayed.networkRead=(value,index)=>index===1?{...value,phase:'queued'}:index===2?{...value,phase:'scanning'}:value;
 const delayedRun=delayed.click();assert.equal(delayed.element('wifiFind').disabled,true);assert.equal(delayed.element('wifiNetworks').disabled,true);
 assert.equal(delayed.element('wifiSave').disabled,true);await delayedRun;
 assert.equal(delayed.posts().length,1);assert.equal(delayed.reads().length,3);assert.equal(delayed.element('wifiNetworks').disabled,false);delayed.dispose();

 const truncated=fixture();await flush();truncated.networkPatch={networks:[],truncated:true};await truncated.click();
 assert.match(truncated.element('wifiScanState').textContent,/No visible networks.*enter a network name/);
 assert.equal(truncated.element('wifiNetworks').disabled,true);assert.equal(truncated.element('ssid').disabled,false);truncated.dispose();

 for(const patch of [{generation:2},{networks:Array.from({length:21},()=>normal.networks[0])},
  {networks:[{...normal.networks[0],ssid:'🌈'.repeat(9)}]},
  {networks:[{...normal.networks[0],ssid:''}]},{networks:[{...normal.networks[0],secure:'true'}]},
  {networks:[{...normal.networks[0],channel:15}]},{phase:'complete'}]){
  const bad=fixture();await flush();bad.networkPatch=patch;await bad.click();assert.equal(bad.posts().length,1);
  assert.equal(bad.reads().length,1);assert.equal(bad.element('wifiNetworks').children.length,0);
  assert.match(bad.element('wifiScanState').textContent,/not confirmed/);bad.dispose();
 }

 const failed=fixture();await flush();failed.networkPatch={phase:'error',error:'Radio is busy'};await failed.click();
 assert.match(failed.element('wifiScanState').textContent,/Wi-Fi search failed.*Radio is busy/);assert.equal(failed.posts().length,1);failed.dispose();

 const deadline=fixture();await flush();deadline.networkPatch={phase:'scanning'};const began=deadline.clock;await deadline.click();
 assert(deadline.clock-began>=15000&&deadline.clock-began<=15350);assert.equal(deadline.posts().length,1);
 assert.match(deadline.element('wifiScanState').textContent,/timed out/);assert.equal(deadline.element('wifiFind').disabled,false);deadline.dispose();

 const background=fixture();await flush();background.gate=deferred();background.element('ssid').value='Preserved manual name';
 const pending=background.click();while(!background.reads().length)await flush();
 background.document.hidden=true;background.listeners.visibilitychange();background.gate.resolve();await pending;
 assert.equal(background.element('wifiNetworks').children.length,0,'late ready response after background cancellation was adopted');
 assert.equal(background.element('ssid').value,'Preserved manual name');assert.match(background.element('wifiScanState').textContent,/paused/);
 const initialPosts=background.posts().length;background.document.hidden=false;background.listeners.visibilitychange();await flush();
 assert.equal(background.posts().length,initialPosts,'foreground resume replayed a scan');assert.equal(background.reads().length,1);background.dispose();

 const lost=fixture();await flush();lost.mode='lost';await lost.click();assert.equal(lost.posts().length,1);assert.equal(lost.reads().length,0);
 await lost.resume();assert.equal(lost.posts().length,1,'unconfirmed search was automatically replayed');lost.dispose();

 for(const field of ['storageFault','configurationUncertain']){
  const fault=fixture();await flush();fault.status[field]=true;await fault.resume();assert.equal(fault.element('wifiFind').disabled,true);
  await fault.click();assert.equal(fault.posts().length,0);assert.equal(fault.element('wifiNetworks').disabled,true);fault.dispose();
 }
 const token=fixture();await flush();delete token.status.token;await token.resume();await token.click();assert.equal(token.posts().length,0);
 assert.match(token.element('wifiScanState').textContent,/Refresh bridge status/);token.dispose();
 console.log('PASS bridge Wi-Fi picker: explicit token POST, pure cached generation reads, delayed readiness, manual/hidden preservation, safe network text, unsupported security, 20-entry/UTF-8 bounds, deadline, lost reply and background cancellation without scan replay.');
})().catch(error=>{console.error(error);process.exitCode=1;});
