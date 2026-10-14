const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync('bridge/BridgePage.h','utf8');
const page=source.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/)[1];
assert.ok(Buffer.byteLength(page)+1<=32768,'flash page exceeds bounded size');
assert.ok(!/<(?:script|link)[^>]+(?:src|href)\s*=/i.test(page),'external resources in owner page');
const elements={},listeners={},calls=[],requests=new Map();
let mode='confirm',held=null;
const first='060302010002',second='070302010002',bridge='040302010002',boot='0000000000002713';
function element(id){return elements[id]??={value:'',textContent:'',disabled:false,children:[],events:{},
  classList:{values:new Set(),toggle(key,force){if(force)this.values.add(key);else this.values.delete(key);}},
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(event,handler){this.events[event]=handler;},setAttribute(name,value){(this.attributes??={})[name]=String(value);},focus(){}};}
const status={role:'bridge',deviceId:bridge,name:'Hall bridge',version:'0.1.0',wifiConnected:true,
  token:'0123456789abcdef0123456789abcdef',setupAp:false,fleetId:'1122334455667788',meshEnabled:true,
  wifiSave:'not-requested',storageFault:false,configurationUncertain:false,
  cache:{phase:'empty'},donation:{enabled:false,sending:false,completed:0}};
const inventory={version:1,deviceId:bridge,available:true,peers:[
  {id:first,name:'Kitchen <img>',boot,online:true,hops:2},
  {id:second,name:'Bedroom',boot,online:true,hops:1}]};
function envelope(request){const body=request.endpoint==='1'?JSON.stringify({deviceId:request.target,name:'Kitchen <img>',power:true,mode:1,brightness:50}):request.endpoint==='26'?JSON.stringify([{id:1,name:'Quiet <script>',category:'calm',speed:true}]):'Light on.';return {version:1,target:request.target,requestId:request.requestId,status:'ok',executed:true,targetBoot:boot,httpStatus:200,total:Buffer.byteLength(body),offset:0,data:Buffer.from(body).toString('base64'),uncertain:false};}
const document={hidden:false,getElementById:element,createElement:()=>element('option-'+crypto.randomUUID()),addEventListener:(event,handler)=>{listeners[event]=handler;}};
const context={document,crypto,URLSearchParams,Uint8Array,TextDecoder,TextEncoder,AbortController,DOMException,Date,
  atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:(handler,delay)=>{const timer=setTimeout(handler,delay<=120?0:delay);if(delay>120)timer.unref();return timer;},clearTimeout,
  fetch:async(url,options)=>{
    assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    if(options.method==='POST')assert.equal(options.headers['X-Lamp-Token'],status.token);
    const parsed=new URL(url,'http://bridge.local'),fields=options.body?Object.fromEntries(new URLSearchParams(options.body)):Object.fromEntries(parsed.searchParams);
    calls.push({path:parsed.pathname,fields,method:options.method||'GET'});
    let response;
    if(parsed.pathname==='/api/bridge/status')response=status;
    else if(parsed.pathname==='/api/mesh/status')response=inventory;
    else if(parsed.pathname==='/api/mesh/request'){
      assert.equal(fields.targetBoot,boot);assert.match(fields.requestId,/^[a-f0-9]{16}$/);
      assert.ok(!requests.has(fields.requestId),'a mesh request was resubmitted');requests.set(fields.requestId,fields);
      response={version:1,target:fields.target,requestId:fields.requestId,status:'pending',executed:false};
    }else if(parsed.pathname==='/api/mesh/result'){
      const request=requests.get(fields.requestId);assert.ok(request);assert.equal(fields.target,request.target);assert.equal(fields.targetBoot,request.targetBoot);
      if(request.endpoint==='31'&&mode==='lost')throw Error('Reply unavailable');
      if(request.endpoint==='31'&&mode==='hold')return new Promise((resolve,reject)=>{
        held={resolve,request};options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
      response=envelope(request);
    }else if(parsed.pathname==='/api/bridge/wifi'){assert.equal(fields.ssid,'Test network');assert.equal(fields.password,'test-password');response={accepted:true,saved:false};}
    else if(parsed.pathname==='/api/bridge/donation'){status.donation.enabled=fields.enabled==='1';response={saved:true};}
    else if(parsed.pathname==='/api/bridge/cache/check')response={accepted:true};
    else throw Error('Unexpected route '+url);
    return {ok:true,text:async()=>typeof response==='string'?response:JSON.stringify(response)};
  }};
vm.createContext(context);vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
const flush=async()=>{for(let i=0;i<15;++i)await new Promise(resolve=>setTimeout(resolve,2));};
const powerCalls=()=>calls.filter(call=>call.path==='/api/mesh/request'&&call.fields.endpoint==='31');
(async()=>{
  await flush();assert.match(element('identity').textContent,/Hall bridge/);assert.equal(element('on').disabled,true);
  element('lamp').value=first;element('lamp').events.change();await element('readLamp').onclick();await flush();
  assert.equal(element('on').disabled,false);assert.match(element('lampState').textContent,/Quiet <script>/);assert.ok(!('innerHTML' in element('lampState')));
  element('on').onclick();await flush();assert.equal(powerCalls().length,1);assert.equal(powerCalls()[0].fields.body,'on=1');assert.equal(element('on').disabled,false);
  mode='lost';element('off').onclick();await flush();assert.equal(powerCalls().length,2);assert.equal(powerCalls()[1].fields.body,'on=0');assert.equal(element('on').disabled,true);assert.match(element('message').textContent,/unconfirmed/);
  mode='confirm';await element('reconcile').onclick();await flush();assert.equal(powerCalls().length,2,'result reconciliation replayed a mutation');assert.equal(element('on').disabled,true);
  await element('readLamp').onclick();await flush();assert.equal(element('on').disabled,false);
  mode='hold';element('on').onclick();await flush();assert.ok(held);assert.equal(powerCalls().length,3);
  element('lamp').value=second;element('lamp').events.change();await flush();assert.equal(element('on').disabled,true);assert.ok(!element('lampState').textContent.includes('Light on.'));
  mode='confirm';await element('reconcile').onclick();await flush();assert.equal(powerCalls().length,3);assert.equal(element('on').disabled,true);
  await element('readLamp').onclick();await flush();assert.equal(element('on').disabled,false);
  mode='hold';held=null;element('on').onclick();await flush();assert.ok(held);document.hidden=true;listeners.visibilitychange();await flush();assert.equal(element('on').disabled,true);const count=powerCalls().length;
  mode='confirm';document.hidden=false;listeners.visibilitychange();await flush();assert.equal(powerCalls().length,count,'foreground resume replayed a mutation');await element('reconcile').onclick();await flush();
  element('ssid').value='Test network';element('wifiPassword').value='test-password';element('wifiForm').onsubmit({preventDefault(){}});assert.equal(element('wifiPassword').value,'');await flush();assert.ok(!element('message').textContent.includes('test-password'));
  await element('donationToggle').onclick();await flush();assert.equal(status.donation.enabled,true);
  const refreshStatus=async()=>{document.hidden=true;listeners.visibilitychange();document.hidden=false;listeners.visibilitychange();await flush();};
  for(const [value,expected] of Object.entries({connecting:/not saved yet/,saved:/settings saved/,'failed-previous-kept':/Connection failed.*Previous saved network kept/,'save-failed-previous-kept':/not saved.*Previous network kept/,'save-uncertain-restart':/unconfirmed.*Restart/})){
    status.wifiSave=value;await refreshStatus();assert.match(element('wifiState').textContent,expected);
  }
  status.storageFault=true;await refreshStatus();assert.match(element('storageState').textContent,/could not be read/);
  for(const id of ['wifiSave','cacheCheck','donationToggle','ssid','wifiPassword'])assert.equal(element(id).disabled,true);
  let posts=calls.filter(call=>call.method==='POST').length;
  element('wifiPassword').value='must-not-be-sent';element('wifiForm').onsubmit({preventDefault(){}});element('cacheCheck').onclick();element('donationToggle').onclick();await flush();
  assert.equal(element('wifiPassword').value,'');assert.equal(calls.filter(call=>call.method==='POST').length,posts);
  status.storageFault=false;status.configurationUncertain=true;await refreshStatus();assert.match(element('storageState').textContent,/save unconfirmed.*Restart.*blocked/);assert.equal(element('wifiSave').disabled,true);
  status.configurationUncertain=false;status.wifiSave='not-requested';await refreshStatus();assert.equal(element('wifiSave').disabled,false);
  delete status.token;await refreshStatus();posts=calls.filter(call=>call.method==='POST').length;
  element('wifiPassword').value='test-password';element('wifiForm').onsubmit({preventDefault(){}});await flush();assert.equal(calls.filter(call=>call.method==='POST').length,posts,'missing token must reject before sending POST');assert.match(element('message').textContent,/Refresh bridge status/);
  console.log('PASS bridge owner page: bounded flash HTML, exact target/boot, fresh state/catalog, explicit power, result-only reconciliation, selection/background cancellation, blank password, token-gated writes, honest Wi-Fi save/storage guards.');
})().catch(error=>{console.error(error);process.exitCode=1;});
