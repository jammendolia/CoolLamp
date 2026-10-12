const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const script=fs.readFileSync('LampPage.h','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const identity='f0b950b2f180',boot='0000000000000001',nextBoot='0000000000000002',ticket='12345678'.repeat(4);
function fixture({holdInitial=false}={}){
 const elements={},requests=[],xhrs=[],intervals=[];let now=0,yields=0,cancelAtYield=Infinity,statusIndex=0,stateIndex=0,releaseInitial;
 const initialGate=holdInitial?new Promise(resolve=>releaseInitial=resolve):null;
 const el=id=>elements[id]??={value:'',files:[],options:[],add(option){this.options.push(option)},addEventListener(){},disabled:false,hidden:false};
 const state={version:'1.15.1',latest:'1.15.1',wifi:false,phase:0,error:0};
 const lampState={stateView:1,deviceId:identity,token:'test-token',effects:['Fire','VU Meter'],colors:[[1,11,22,33],null],effectOptions:[[60,44,1,9,8,7],null],mode:1,brightness:80,power:true,leds:205,milliamps:500,midpoint:102,sync:{role:0}};
 const control={prepareTarget:identity,statuses:[],states:[],offline:false,releaseInitial:()=>releaseInitial?.()};
 class Form{constructor(){this.parts=[];}append(...part){this.parts.push(part);}}
 class Xhr{constructor(){this.upload={};this.headers={};xhrs.push(this);}open(method,path){this.method=method;this.path=path;}setRequestHeader(k,v){this.headers[k]=v;}send(body){this.body=body;}abort(){this.onabort();}}
 const context={document:{getElementById:el},Option:function(name,value){this.name=name;this.value=value},URLSearchParams,AbortSignal,Uint8Array,Uint32Array,DataView,FormData:Form,XMLHttpRequest:Xhr,setInterval:fn=>intervals.push(fn),
  Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;yields++;if(yields===cancelAtYield)el('cancelUpload').onclick();setImmediate(fn);},
  fetch:async(path,options)=>{
   requests.push({path,options});
   if(path==='/api/state/current'){if(initialGate)await initialGate;const value=control.states.length?control.states[Math.min(stateIndex++,control.states.length-1)]:lampState;return{ok:true,json:async()=>value};}
   if(path==='/api/firmware')return{ok:true,json:async()=>state};
   if(options?.method==='POST'&&['/api/preview','/api/color','/api/effect-options'].includes(path))return{ok:true,text:async()=>'Applied.'};
   if(path==='/api/firmware/upload/prepare')return{ok:true,text:async()=>JSON.stringify({deviceId:control.prepareTarget,boot,ticket})};
   if(control.offline)throw Error('offline');
   assert.equal(path,'/api/firmware/upload/status');const status=control.statuses[Math.min(statusIndex++,control.statuses.length-1)];return{ok:true,json:async()=>status};
  }};
 vm.createContext(context);vm.runInContext(script,context);
 return{context,el,control,requests,xhrs,intervals,get yields(){return yields;},cancelAfterFirstYield(){cancelAtYield=yields+1;}};
}
const settle=()=>new Promise(r=>setImmediate(r));
function firmware(size=512,markerAt=300){const bytes=Buffer.alloc(size);bytes[0]=0xe9;bytes.writeUInt16LE(5,12);bytes.writeUInt32LE(0xabcd5432,32);bytes.write('COOLLAMP-PUBLIC-1.15.1\0',markerAt);return bytes;}
function file(bytes){const counters={reads:0,maxSlice:0};return{size:bytes.length,counters,slice(at,end){const selected=bytes.subarray(at,end);counters.reads++;counters.maxSlice=Math.max(counters.maxSlice,selected.length);return{arrayBuffer:async()=>selected.buffer.slice(selected.byteOffset,selected.byteOffset+selected.length)};},arrayBuffer(){throw Error('Production must not retain a whole image');}};}
async function submit(f,selected,metadata){f.el('image').files=[selected];f.el('imageManifest').files=metadata?[metadata]:[];await f.el('firmware').onsubmit({preventDefault(){}});}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function proof(bytes,session=nextBoot){return{deviceId:identity,boot:session,installedKnown:true,healthy:true,receiving:false,version:'1.15.1',size:bytes.length,sha256:digest(bytes)};}
(async()=>{
 // Drive the actual page startup and sparse-appearance handlers. A held
 // Settings read must finish before any firmware-status poll, including an
 // interval tick; these are read-only fixtures with no lamp or credentials.
 const initial=fixture({holdInitial:true});await settle();assert.deepEqual(initial.requests.map(r=>r.path),['/api/state/current']);
 await initial.intervals[0]();assert.equal(initial.requests.length,1);initial.control.releaseInitial();await settle();await settle();
 assert.deepEqual(initial.requests.map(r=>r.path),['/api/state/current','/api/firmware']);assert.equal(initial.el('mode').options.length,2);
 assert.equal(initial.el('color').value,'#0b1621');assert.equal(initial.el('speed').value,60);
 initial.el('mode').value='2';initial.el('mode').onchange();assert.match(initial.el('colorHint').textContent,/Preview.*saved colors and settings/);
 for(const id of ['color','applyColor','speed','intensity','dual','secondaryColor','applyOptions'])assert(initial.el(id).disabled,id+' must not imply known inactive settings');
 const noWrites=initial.requests.length;await initial.el('applyOptions').onclick();await initial.el('applyColor').onclick();assert.equal(initial.requests.length,noWrites);
 // Preview explicitly changes the lamp, then one fresh projection loads its
 // actual tuple. It does not duplicate options or manufacture other modes.
 const current={stateView:1,deviceId:identity,power:true,mode:2,colors:[null,[1,45,46,47]],effectOptions:[null,[77,88,0,71,72,73]]};
 initial.control.states=[current];await initial.el('preview').onclick();assert.equal(initial.el('mode').options.length,2);
 assert.equal(initial.el('color').value,'#2d2e2f');assert.equal(initial.el('speed').value,77);assert.equal(initial.el('intensity').value,88);assert.equal(initial.el('secondaryColor').value,'#474849');assert(!initial.el('applyOptions').disabled);
 assert.deepEqual(initial.requests.slice(-2).map(r=>r.path),['/api/preview','/api/state/current']);assert.equal(initial.requests.at(-2).options.body.get('mode'),'2');
 await initial.el('applyOptions').onclick();const tuned=initial.requests.at(-1);assert.equal(tuned.path,'/api/effect-options');assert.equal(tuned.options.body.get('speed'),'77');assert.equal(tuned.options.body.get('intensity'),'88');
 // Reset success never substitutes the old guessed defaults. The real
 // current tuple must be read before its controls can be used again.
 initial.control.states=[{...current,colors:[null,[0,31,32,33]],effectOptions:[null,[70,12,0,41,42,43]]}];await initial.el('resetColor').onclick();
 assert.deepEqual(initial.requests.slice(-2).map(r=>r.path),['/api/color','/api/state/current']);assert.equal(initial.requests.at(-2).options.body.get('reset'),'1');assert.equal(initial.el('speed').value,70);assert.equal(initial.el('intensity').value,12);
 // A different target or unmarked response cannot turn missing tuples into
 // writable settings. A failed readback never repeats the preview command.
 for(const change of [{deviceId:'aabbccddeeff'},{stateView:0}]){
  const changed=fixture();await settle();changed.el('mode').value='2';changed.el('mode').onchange();changed.control.states=[{...current,...change}];
  await changed.el('preview').onclick();assert.match(changed.el('status').textContent,/state not confirmed/);assert(changed.el('applyOptions').disabled);
  assert.equal(changed.requests.filter(r=>r.path==='/api/preview').length,1);const writes=changed.requests.length;await changed.el('applyOptions').onclick();assert.equal(changed.requests.length,writes);
 }
 const f=fixture();await settle();
 // FIPS/NIST standard vectors, followed by native-SHA cross-checks at every
 // padding/chunk boundary used by the production implementation.
 const vectors=[['','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],['a'.repeat(1000000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']];
 let hashes=0;
 for(const [input,expected] of vectors){f.context.bytes=Buffer.from(input);const value=vm.runInContext('(()=>{const h=new BrowserFileHash();h.update(bytes);return h.finish();})()',f.context);assert.equal(value,expected);assert.equal(value,digest(f.context.bytes));++hashes;}
 for(const length of [1,2,55,56,63,64,65,127,128,1023,16384,2031616])for(const chunk of [1,3,7,63,64,65,509,16384]){
  const bytes=Buffer.alloc(length);for(let i=0;i<length;i++)bytes[i]=(i*67+3)&255;f.context.bytes=bytes;f.context.chunk=chunk;
  const value=vm.runInContext('(()=>{const h=new BrowserFileHash();for(let at=0;at<bytes.length;at+=chunk)h.update(bytes.subarray(at,at+chunk));if(h.tail.length!==64||h.w.length!==64||h.h.length!==8)throw Error("Unbounded hash state");return h.finish();})()',f.context);
  assert.equal(value,digest(bytes));++hashes;
 }
 const large=file(firmware(2031616,16377));f.context.selected=large;
 const inspected=await vm.runInContext('inspectBrowserFirmware(selected,()=>true)',f.context);
 assert.equal(inspected.version,'1.15.1');assert.equal(inspected.sha256,digest(firmware(2031616,16377)));assert.equal(large.counters.maxSlice,16384);assert.equal(large.counters.reads,124);assert(f.yields>=124);
 const canceled=fixture();await settle();canceled.cancelAfterFirstYield();const canceledFile=file(firmware(32768));await submit(canceled,canceledFile);
 assert.equal(canceledFile.counters.reads,1);assert.match(canceled.el('status').textContent,/stopped.*Nothing was sent/);assert.equal(canceled.xhrs.length,0);assert(!canceled.requests.some(r=>r.path.endsWith('prepare')));
 // Exact manifest approval and one multipart ticket, never a fallback upload.
 const successful=fixture();await settle();const bytes=firmware(),selected=file(bytes);await submit(successful,selected);
 const preparation=successful.requests.find(r=>r.path.endsWith('prepare'));assert.equal(preparation.options.headers['X-Lamp-Token'],'test-token');assert.equal(preparation.options.body.get('deviceId'),identity);assert.equal(preparation.options.body.get('manifest'),`COOLLAMP-OTA-1|1.15.1|esp32c3|dual-ota-2031616|512|${digest(bytes)}|`);assert(!preparation.options.body.toString().includes('%0A'));
 assert.equal(successful.xhrs.length,1);const xhr=successful.xhrs[0];assert.equal(xhr.body.parts[0][0],'firmware-'+ticket);assert.equal(xhr.body.parts[0][1],selected);assert.equal(xhr.headers['X-Lamp-Token'],'test-token');assert.equal(xhr.timeout,180000);
 xhr.upload.onprogress({lengthComputable:true,loaded:100,total:100});assert.match(successful.el('status').textContent,/verifying/);assert(!successful.el('status').textContent.includes('is updated'));
 // Same-version reinstall must see a fresh boot, not the old healthy image.
 successful.control.statuses=[proof(bytes,boot),proof(bytes,nextBoot)];xhr.status=200;xhr.onload();for(let i=0;i<5;i++)await settle();assert.match(successful.el('status').textContent,/updated to 1.15.1/);assert.equal(successful.requests.filter(r=>r.path.endsWith('status')).length,2);assert.equal(successful.xhrs.length,1);
 // Real C3 postboot measurement starts after35s and hashes512-byte slices.
 // A responsive lamp with a not-yet-known fingerprint is still being checked.
 const delayed=fixture();await settle();await submit(delayed,file(bytes));
 delayed.control.statuses=[...Array.from({length:70},()=>({...proof(bytes),installedKnown:false,size:0,sha256:''})),proof(bytes)];
 delayed.xhrs[0].status=200;delayed.xhrs[0].onload();for(let i=0;i<55;i++)await settle();
 assert.match(delayed.el('status').textContent,/Checking/);assert.doesNotMatch(delayed.el('status').textContent,/updated to|could not be confirmed/);assert(delayed.el('upload').disabled);
 for(let i=0;i<30;i++)await settle();assert.match(delayed.el('status').textContent,/updated to/);assert.equal(delayed.xhrs.length,1);assert.equal(delayed.requests.filter(r=>r.path.endsWith('prepare')).length,1);
 for(const problem of ['error','timeout','abort','boot-write-uncertain']){
  const lost=fixture();await settle();await submit(lost,file(bytes));lost.control.offline=true;const transfer=lost.xhrs[0];
  if(problem==='boot-write-uncertain'){transfer.status=400;transfer.responseText='Installation result is unconfirmed. Keep the lamp powered.';transfer.onload();}else transfer['on'+problem]();
  for(let i=0;i<140;i++)await settle();assert.match(lost.el('status').textContent,/Installation could not be confirmed/);assert(lost.el('upload').disabled);assert.equal(lost.xhrs.length,1);assert(lost.requests.filter(r=>r.path.endsWith('status')).length<=120);assert.equal(lost.requests.filter(r=>r.path.endsWith('prepare')).length,1);
 }
 const foreign=fixture();await settle();foreign.control.prepareTarget='aabbccddeeff';await submit(foreign,file(bytes));assert.equal(foreign.xhrs.length,0);assert.match(foreign.el('status').textContent,/approval could not be verified/);
 const mismatch=fixture();await settle();await submit(mismatch,file(bytes),{size:10,text:async()=> 'wrong metadata'});assert.equal(mismatch.xhrs.length,0);assert.match(mismatch.el('status').textContent,/does not match/);
 const badFile=fixture();await settle();const wrongChip=firmware();wrongChip[12]=0;await submit(badFile,file(wrongChip));assert.equal(badFile.xhrs.length,0);assert.match(badFile.el('status').textContent,/ESP32-C3/);
 console.log(`PASS production browser page: serial initial Settings/firmware reads, no guessed sparse appearance writes, preview/reset fresh target tuples without duplicate catalog or replay; ${hashes} standard/native SHA vectors across chunk/padding/max-file boundaries; 16KiB slices, cancellation after one slice, exact file/manifest/ticket/identity, fresh-boot healthy digest proof, bounded uncertain reconciliation, no automatic upload/commit replay.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
