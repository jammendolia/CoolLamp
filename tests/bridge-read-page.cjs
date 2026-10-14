// Exercise the actual generated bridge owner-page script, including the
// physical-sized State1 response. The fixture implements transport pages only;
// parsing, identity checks, deadlines and button ownership run in production JS.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const header=fs.readFileSync('bridge/BridgePage.h','utf8');
const page=header.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/)[1];
const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
const bridgeId='040302010002',lampId='060302010002',secondId='070302010002',boot='0000000000002713';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(done=>setTimeout(done,1));};
function sizedJson(value,bytes){
 const text=JSON.stringify({...value,padding:''}),missing=bytes-Buffer.byteLength(text);
 assert(missing>=0);const answer=JSON.stringify({...value,padding:'x'.repeat(missing)});
 assert.equal(Buffer.byteLength(answer),bytes);return answer;
}
const stateBody=sizedJson({deviceId:lampId,name:'Corkscrew <img>',power:true,mode:40,brightness:127,
 geometry:{count:181,midpoint:83},firmware:{version:'1.15.4'},label:'Quiet light \u2605'},5529);
const catalogBody=JSON.stringify(Array.from({length:47},(_,id)=>({id,name:id===40?'VU Meter':`Effect ${id}`,category:'calm',speed:id!==0})));
function fixture(){
 const elements={},listeners={},timers=new Map(),calls=[],requests=new Map();let now=1000;
 const f={pendingReads:3,resultLatency:20,active:0,peak:0};
 const element=id=>elements[id]??={value:'',textContent:'',disabled:false,children:[],events:{},attributes:{},
  classList:{values:new Set(),toggle(key,force){if(force)this.values.add(key);else this.values.delete(key);}},
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},
  addEventListener(name,handler){this.events[name]=handler;},setAttribute(name,value){this.attributes[name]=String(value);},focus(){}};
 const document={hidden:false,getElementById:element,createElement:()=>element('option-'+crypto.randomUUID()),addEventListener:(name,handler)=>listeners[name]=handler};
 const status={role:'bridge',deviceId:bridgeId,version:'0.2.2',passwordSet:true,token:'0123456789abcdef0123456789abcdef',
  wifiSave:'not-requested',fleetId:'1122334455667788',meshEnabled:true,cache:{phase:'empty'},donation:{enabled:false}};
 const inventory={version:1,deviceId:bridgeId,available:true,peers:[
  {id:lampId,name:'Corkscrew',boot,online:true,hops:1},{id:secondId,name:'Second lamp',boot,online:true,hops:1}]};
 const context={document,crypto,URLSearchParams,Uint8Array,TextDecoder,TextEncoder,AbortController,DOMException,
  Date:class extends Date{static now(){return now;}},atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:(handler,delay)=>{const handle=setTimeout(()=>{timers.delete(handle);if(delay<=120)now+=delay;handler();},delay<=120?0:delay);
   timers.set(handle,{handler,delay});if(delay>120)handle.unref();return handle;},
  clearTimeout:handle=>{timers.delete(handle);clearTimeout(handle);},
  fetch:async(url,options)=>{
   f.active++;f.peak=Math.max(f.peak,f.active);
   try{
    assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    const path=new URL(url,'http://bridge.local'),fields=Object.fromEntries(options.body?new URLSearchParams(options.body):path.searchParams);
    const call={path:path.pathname,fields,method:options.method||'GET'};calls.push(call);
    if(f.fail?.path===path.pathname)return {ok:false,text:async()=>f.fail.text};
    let value;
    if(path.pathname==='/api/bridge/status'){
     if(f.statusGate)await f.statusGate.promise;
     if(options.signal.aborted)throw new DOMException('Aborted','AbortError');value=status;
    }else if(path.pathname==='/api/mesh/status')value=inventory;
    else if(path.pathname==='/api/mesh/request'){
     assert.equal(call.method,'POST');assert.equal(options.headers['X-Lamp-Token'],status.token);
     assert.deepEqual(Object.keys(fields).sort(),['body','endpoint','method','requestId','target','targetBoot']);
     assert.equal(fields.body,'');assert.equal(fields.method,'1');assert.equal(fields.targetBoot,boot);
     assert.match(fields.requestId,/^[0-9a-f]{16}$/);assert(!requests.has(fields.requestId),'read command replayed');
     const body=Buffer.from(fields.endpoint==='1'?stateBody:catalogBody);
     const request={...fields,body,pending:f.pendingReads,pages:[],consumed:false};requests.set(fields.requestId,request);
     value={version:1,target:fields.target,requestId:fields.requestId,status:'pending',executed:false};
    }else if(path.pathname==='/api/mesh/result'){
     assert.equal(call.method,'GET');assert.equal(options.body,undefined);
     assert.deepEqual(Object.keys(fields).sort(),['offset','requestId','target','targetBoot']);
     const request=requests.get(fields.requestId);assert(request);assert.equal(fields.target,request.target);assert.equal(fields.targetBoot,request.targetBoot);
     if(f.resultGate)await f.resultGate.promise;
     if(options.signal.aborted)throw new DOMException('Aborted','AbortError');now+=f.resultLatency;
     if(request.pending-->0)value={version:1,target:request.target,requestId:request.requestId,status:'pending',executed:request.pending===0,targetBoot:boot};
     else{
      const offset=Number(fields.offset);assert(Number.isInteger(offset));assert.equal(offset,request.pages.reduce((n,part)=>n+part.bytes,0));
      const chunk=request.body.subarray(offset,offset+256);request.pages.push({offset,bytes:chunk.length});
      request.consumed=offset+chunk.length===request.body.length;
      value={version:1,target:request.target,requestId:request.requestId,status:'ok',executed:true,targetBoot:boot,
       httpStatus:200,total:request.body.length,offset,data:chunk.toString('base64'),uncertain:false};
      if(f.transform)value=f.transform(value,request);
     }
    }else throw Error('Unexpected route '+path.pathname);
    return {ok:true,text:async()=>JSON.stringify(value)};
   }finally{f.active--;}
  }};
 vm.createContext(context);vm.runInContext(script,context);
 return Object.assign(f,{context,document,listeners,element,status,inventory,calls,requests,
  select:id=>{element('lamp').value=id;element('lamp').events.change();},
  read:()=>element('readLamp').onclick(),
  fire:delay=>{const entry=[...timers.entries()].find(([,timer])=>timer.delay===delay);assert(entry,'Missing '+delay+' ms timer');
   timers.delete(entry[0]);clearTimeout(entry[0]);return entry[1].handler();},
  posts:()=>calls.filter(call=>call.path==='/api/mesh/request'),
  dispose:()=>{document.hidden=true;listeners.visibilitychange();for(const handle of timers.keys())clearTimeout(handle);timers.clear();}});
}
async function ready(){const f=fixture();await flush();f.select(lampId);return f;}
(async()=>{
 const large=await ready();const reading=large.read();
 assert.match(large.element('lampState').textContent,/Reading lamp state/);assert.equal(large.element('readLamp').attributes['aria-busy'],'true');
 assert.equal(large.element('lampState').attributes['aria-busy'],'true');await large.read();await reading;
 assert.equal(large.posts().length,2,'duplicate Read click must not submit a second intent');
 const state=[...large.requests.values()].find(value=>value.endpoint==='1');assert.equal(state.body.length,5529);
 assert.equal(state.pages.length,22);assert.deepEqual(state.pages.map(value=>value.offset),Array.from({length:22},(_,i)=>i*256));
 assert.equal(state.pages.at(-1).bytes,153);assert.equal(state.consumed,true);assert([...large.requests.values()].every(value=>value.consumed));
 assert.match(large.element('lampState').textContent,/Corkscrew <img>.*Power is on.*Brightness: 127.*Effect: VU Meter/s);
 assert(!('innerHTML' in large.element('lampState')));assert.equal(large.element('on').disabled,false);
 assert.equal(large.element('readLamp').attributes['aria-busy'],'false');assert.equal(large.element('lampState').attributes['aria-busy'],'false');
 assert.equal(large.peak,1,'page owns one HTTP request at a time');large.dispose();

 const failures=[
  ['boot mismatch',reply=>({...reply,targetBoot:'1111111111111111'}),/Lamp restarted/],
  ['wrong target',reply=>({...reply,target:secondId}),/Unconfirmed reply identity/],
  ['wrong request',reply=>({...reply,requestId:'1111111111111111'}),/Unconfirmed reply identity/],
  ['wrong offset',reply=>({...reply,offset:reply.offset+1}),/Invalid lamp result page/],
  ['response bound',reply=>({...reply,total:8193}),/Invalid lamp result page/],
  ['oversized page',reply=>({...reply,data:Buffer.alloc(257).toString('base64')}),/Invalid lamp result size/],
  ['bad base64',reply=>({...reply,data:'<img src=x>'}),/Invalid lamp result page/],
  ['changed total',reply=>({...reply,total:reply.offset?reply.total-1:reply.total}),/Response changed between pages/]
 ];
 for(const [name,transform,expected] of failures){
  const failed=await ready();failed.pendingReads=0;failed.transform=transform;await failed.read();
  assert.match(failed.element('lampState').textContent,expected,name);assert.match(failed.element('lampState').textContent,/could not be read/);
  assert.equal(failed.element('on').disabled,true);assert.equal(failed.posts().length,1);assert.equal(failed.element('lampState').attributes['aria-busy'],'false');failed.dispose();
 }
 for(const [path,text] of [['/api/mesh/result','Mesh request result is unavailable.'],['/api/mesh/request','Another mesh request is still active.'],
  ['/api/mesh/request','Open the bridge page again before making changes.']]){
  const failed=await ready();failed.fail={path,text};await failed.read();assert.equal(failed.element('message').textContent,text);
  assert.equal(failed.element('lampState').textContent,'Lamp state could not be read. '+text);assert.equal(failed.posts().length,1);
  assert.equal(failed.element('on').disabled,true);failed.dispose();
 }
 const bounded=await ready();bounded.fail={path:'/api/mesh/result',text:'<script>\u0000'+('x'.repeat(1000))};await bounded.read();
 assert(bounded.element('lampState').textContent.length<300);assert(!bounded.element('lampState').textContent.includes('\u0000'));
 assert(!('innerHTML' in bounded.element('lampState')));bounded.dispose();
 const noToken=await ready();delete noToken.status.token;await noToken.fire(2000);await noToken.read();assert.equal(noToken.posts().length,0);
 assert.match(noToken.element('lampState').textContent,/Refresh bridge status/);noToken.dispose();

 const slow=await ready();slow.pendingReads=0;slow.resultLatency=800;await slow.read();
 assert.match(slow.element('lampState').textContent,/reply timed out/);assert.equal(slow.posts().length,1);
 assert.equal(slow.element('on').disabled,true);assert.equal([...slow.requests.values()][0].consumed,false);slow.dispose();

 const hidden=await ready();hidden.resultGate=deferred();const hiddenRead=hidden.read();await flush();
 hidden.document.hidden=true;hidden.listeners.visibilitychange();hidden.resultGate.resolve();await hiddenRead;
 assert.match(hidden.element('lampState').textContent,/Read paused/);assert.equal(hidden.element('on').disabled,true);
 hidden.document.hidden=false;hidden.listeners.visibilitychange();await flush();assert.equal(hidden.posts().length,1,'foreground return replayed read intent');hidden.dispose();
 const changed=await ready();changed.resultGate=deferred();const changedRead=changed.read();await flush();changed.select(secondId);
 const selectionHint=changed.element('lampState').textContent;changed.resultGate.resolve();await changedRead;
 assert.equal(changed.element('lampState').textContent,selectionHint,'old read overwrote the newly selected lamp');assert.equal(changed.element('on').disabled,true);changed.dispose();

 const queued=await ready();queued.statusGate=deferred();const poll=queued.fire(2000);await flush();
 const queuedRead=queued.read();assert.match(queued.element('lampState').textContent,/Waiting for the bridge status check/);
 await queued.read();assert.equal(queued.posts().length,0);queued.statusGate.resolve();await poll;await queuedRead;
 assert.equal(queued.posts().length,2);assert.equal(queued.peak,1);assert.match(queued.element('lampState').textContent,/VU Meter/);queued.dispose();
 const expired=await ready();expired.statusGate=deferred();const heldPoll=expired.fire(2000);await flush();const expiredRead=expired.read();
 expired.fire(6000);await expiredRead;assert.match(expired.element('lampState').textContent,/not read.*still busy/);
 expired.statusGate.resolve();await heldPoll;assert.equal(expired.posts().length,0);expired.dispose();

 console.log('PASS bridge Read page: physical-sized 5529-byte/22-page State1, 47-effect catalog, pending receipts, exact GET args/boot, duplicate fencing, bounded visible errors, reply limits/deadline, selection/background cancellation and queued-read expiry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
