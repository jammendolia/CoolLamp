import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeManagementClient,BridgeLinkJournal,bridgeAddress,bridgeLinksSnapshot,bridgeLampRows,mountBridgeManagement} from '../src/bridge-management.js';

const id='040302010002',lamp='060302010002',unknown='070302010002',boot='1111111111111111',fleet='2222222222222222';
const token='0123456789abcdef0123456789abcdef';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=async()=>{for(let n=0;n<12;n++)await new Promise(done=>setTimeout(done,1));};
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem(key,value){if(this.fail)throw Error('storage unavailable');values.set(key,value);}};}
function fixture(options={}){
 const memory=storage(),journal=new BridgeLinkJournal(memory),calls=[],f={mode:'ok',httpStatus:200};let next=1;
 const status={role:'bridge',deviceId:id,fleetId:fleet,meshEnabled:true,token,wifiConnected:true,donation:{enabled:true}};
 const links={version:1,deviceId:id,boot,revision:1,persisted:true,ready:true,storageFault:false,uncertain:false,defaultHouseholdAllowed:true,scope:'this-bridge-serving-only',excluded:[],limits:{excluded:64,receipts:4,receiptLifetimeMs:60000,statusBytes:1536}};
 const mesh={version:1,deviceId:id,fleetId:fleet,boot,available:true,peers:[{id:lamp,boot:'3333333333333333',name:'Owned <lamp>',online:true,hops:1},{id:unknown,boot:'4444444444444444',name:'New <lamp>',online:true,hops:1}]};
 const lamps=[{id:lamp,name:'Kitchen <img>'}];const receipts=new Map();
 const http={request:async request=>{
  calls.push(request);assert.equal(request.disableRedirects,true);assert.equal(request.responseType,'text');assert(request.connectTimeout<=4000&&request.readTimeout<=8000);
  assert.equal(request.headers.Authorization,'Basic '+btoa('OWNER:private-password'));
  const path=new URL(request.url).pathname,fields=request.data?Object.fromEntries(new URLSearchParams(request.data)):{};let value;
  if(f.gate&&f.gatePath===path&&(!f.gateMethod||f.gateMethod===request.method))await f.gate.promise;
  if(path==='/api/bridge/status')value={...status,...f.statusPatch};
  else if(path==='/api/mesh/status')value={...mesh,...f.meshPatch};
  else if(path==='/api/bridge/links'&&request.method==='GET')value={...links,...f.linksPatch};
  else if(path==='/api/bridge/links'&&request.method==='POST'){
   assert.equal(request.headers['X-Lamp-Token'],token);assert.equal(fields.deviceId,id);assert.equal(fields.expectedBoot,links.boot);assert.equal(fields.expectedRevision,String(links.revision));
   assert(memory.getItem('coollamp-bridge-link-pending-v1').includes(fields.requestId),'mutation was sent before its journal');
   if(f.mode==='token-rejected')return {status:403,data:'Open the bridge page again before making changes.',url:request.url};
   const result={version:1,deviceId:id,boot:links.boot,found:true,requestId:fields.requestId,target:fields.target,action:fields.action,revision:links.revision+1,executed:true,persisted:true,uncertain:false,httpStatus:200};
   if(f.mode==='unchanged'){result.executed=false;result.persisted=false;result.revision=links.revision;}
   else if(f.mode==='uncertain'){result.executed=null;result.persisted=false;result.uncertain=true;}
   else{links.excluded=fields.action==='remove'?[...new Set([...links.excluded,fields.target])]:links.excluded.filter(value=>value!==fields.target);links.revision++;}
   receipts.set(fields.requestId,result);if(f.mode==='lost')throw Error('native failed with no exported options');value=result;
  }else if(path==='/api/bridge/links/receipt'){
   assert.equal(request.method,'POST');assert.equal(fields.deviceId,id);assert.equal(fields.expectedBoot,boot);assert.equal(request.headers['X-Lamp-Token'],token);
   value=f.missingReceipt?{version:1,deviceId:id,boot:links.boot,requestId:fields.requestId,found:false,executed:null,persisted:false,uncertain:true}:receipts.get(fields.requestId);
  }else throw Error('unexpected request');
  return {status:f.httpStatus,data:f.raw===undefined?JSON.stringify(value):f.raw,url:f.finalUrl||request.url};
 }};
 const client=new BridgeManagementClient({bridge:{id,address:'192.168.1.197',name:'Bridge'},http,getPassword:async()=>f.password??'private-password',journal,lamps:()=>lamps,nextRequest:()=> (next++).toString(16).padStart(16,'0'),...options});
 Object.assign(f,{memory,journal,calls,client,http,status,links,mesh,lamps,receipts,posts:()=>calls.filter(call=>new URL(call.url).pathname==='/api/bridge/links'&&call.method==='POST')});return f;
}

test('local bridge addresses reject credentials, remote hosts, redirects and URL decorations',()=>{
 for(const address of ['192.168.4.1','http://10.2.3.4/','coollamp-bridge-b734.local'])assert(bridgeAddress(address).startsWith('http://'));
 for(const address of ['https://192.168.4.1','http://owner:pass@192.168.4.1','8.8.8.8','example.com','192.168.1.197/settings','192.168.1.197?q=1','192.168.1.197:8080','192.168.01.197'])assert.throws(()=>bridgeAddress(address));
});
test('a saved bridge household mismatch stops before links or any mutation',async()=>{
 const f=fixture({bridge:{id,address:'192.168.1.197',fleetId:'3333333333333333'}});
 await assert.rejects(f.client.refresh(),error=>error.identity===true);
 assert.equal(f.calls.length,1);assert.equal(f.posts().length,0);
 assert.throws(()=>fixture({bridge:{id,address:'192.168.1.197',fleetId:'0'.repeat(16)}}));
});
test('versioned links negotiate explicit capacity and preserve canonical future lamp identities',()=>{
 const f=fixture();assert.equal(bridgeLinksSnapshot(f.links,id).ready,true);
 for(const patch of [{version:2},{deviceId:lamp},{boot:'0'.repeat(16)},{revision:0},{excluded:[lamp,lamp]},{excluded:Array.from({length:65},()=>lamp)},{ready:false},{persisted:null},{scope:'household'},{limits:{...f.links.limits,excluded:999}}])assert.throws(()=>bridgeLinksSnapshot({...f.links,...patch},id));
 assert.equal(bridgeLinksSnapshot({...f.links,excluded:['ffffffffffff']},id).excluded[0],'ffffffffffff');
});
test('fresh authenticated bridge snapshot reads do not enroll, scan, update or mutate',async()=>{
 const f=fixture();await f.client.refresh();assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/bridge/status','/api/bridge/links','/api/mesh/status']);assert(f.calls.every(call=>call.method==='GET'));assert.equal(f.client.rows()[0].label,'Can use this bridge · Nearby');assert.equal(f.client.rows()[1].label,'Detected · Finish lamp setup');
});
test('password rejection and stale boot token have distinct guidance; neither can mutate',async()=>{
 for(const code of [401,403]){const f=fixture();f.httpStatus=code;await assert.rejects(f.client.refresh(),error=>code===401?error.password===true&&error.session!==true:error.session===true&&error.password!==true);assert.equal(f.posts().length,0);}
});
test('explicit preexecution CSRF rejection reconciles fresh state and permits a new user intent without replay',async()=>{
 const f=fixture();f.mode='token-rejected';const result=await f.client.change(lamp,'remove');assert.equal(result.executed,false);assert.equal(result.sessionChanged,true);assert.equal(f.posts().length,1);assert.equal(f.journal.get(id),null);assert.equal(f.links.excluded.length,0);assert(f.client.snapshot);
 f.mode='ok';await f.client.change(lamp,'remove');assert.equal(f.posts().length,2);assert.notEqual(Object.fromEntries(new URLSearchParams(f.posts()[0].data)).requestId,Object.fromEntries(new URLSearchParams(f.posts()[1].data)).requestId);
});
test('wrong bridge, household or boot fences cannot produce Add or Remove',async()=>{
 for(const [field,patch]of [['statusPatch',{deviceId:lamp}],['statusPatch',{fleetId:'0'.repeat(16)}],['meshPatch',{fleetId:'5555555555555555'}],['meshPatch',{boot:'5555555555555555'}]]){const f=fixture();f[field]=patch;await assert.rejects(f.client.change(lamp,'remove'));assert.equal(f.posts().length,0);}
});
test('twenty owned lamps stay separate from the sixteen-peer radio neighborhood, preserving offline permission',()=>{
 const f=fixture(),lamps=Array.from({length:20},(_,n)=>({id:(0x800000000000+n).toString(16),name:'Lamp '+n,fleetId:fleet}));
 const snapshot={status:f.status,links:f.links,mesh:f.mesh};const rows=bridgeLampRows(snapshot,lamps);assert.equal(rows.filter(row=>row.owned).length,20);assert(rows.filter(row=>row.owned).every(row=>row.label==='Can use this bridge · Not seen nearby'));
});
test('one-tap Remove and Add confirm durable bridge policy without lamp/group/household mutations',async()=>{
 const f=fixture();let result=await f.client.change(lamp,'remove');assert.equal(result.confirmed,true);assert(f.links.excluded.includes(lamp));assert.equal(f.journal.get(id),null);assert.equal(f.client.rows()[0].label,'Not using this bridge');
 result=await f.client.change(lamp,'add');assert.equal(result.confirmed,true);assert.equal(f.links.excluded.length,0);assert.equal(f.posts().length,2);assert(f.calls.every(call=>!/(enroll|power|sync|firmware|wifi)/.test(new URL(call.url).pathname)));
 assert(!f.memory.getItem('coollamp-bridge-link-pending-v1').includes('private-password'));
});
test('unknown/unowned discovery is setup only and does not create authority by Add',async()=>{const f=fixture();await assert.rejects(f.client.change(unknown,'add'));await assert.rejects(f.client.change(unknown,'remove'));assert.equal(f.posts().length,0);assert.equal(f.journal.items.length,0);});
test('duplicate concurrent clicks issue one command and never compose a stale revision',async()=>{
 const f=fixture();f.gate=deferred();f.gatePath='/api/bridge/links';const changing=f.client.change(lamp,'remove');await flush();await assert.rejects(f.client.change(lamp,'remove'),error=>error.busy===true);f.gate.resolve();await changing;assert.equal(f.posts().length,1);
});
test('lost mutation ACK retains a nonsecret journal; reconciliation reads the exact receipt first and never replays',async()=>{
 const f=fixture();f.mode='lost';await assert.rejects(f.client.change(lamp,'remove'),error=>error.uncertain===true);assert(f.journal.get(id));assert.equal(f.posts().length,1);await assert.rejects(f.client.change(lamp,'remove'));
 f.mode='ok';const before=f.calls.length,result=await f.client.reconcile();assert.equal(result.confirmed,true);assert.equal(f.posts().length,1);assert.equal(new URL(f.calls[before+1].url).pathname,'/api/bridge/links/receipt');assert.equal(f.journal.get(id),null);
});
test('expired receipt/reboot can confirm current durable policy honestly, without claiming original execution',async()=>{
 const f=fixture();f.mode='lost';await assert.rejects(f.client.change(lamp,'remove'));f.missingReceipt=true;f.links.boot=f.mesh.boot='5555555555555555';const result=await f.client.reconcile();assert.equal(result.confirmed,true);assert.equal(result.executed,null);assert.equal(result.receiptUnavailable,true);assert.equal(f.posts().length,1);assert.equal(f.journal.get(id),null);
});
test('unknown, missing or uncertain receipt with an unchanged policy remains visibly pending',async()=>{
 const f=fixture();f.mode='uncertain';await assert.rejects(f.client.change(lamp,'remove'));f.missingReceipt=true;let result=await f.client.reconcile();assert.equal(result.pending,true);assert(f.journal.get(id));assert.equal(f.posts().length,1);
 f.links.boot=f.mesh.boot='5555555555555555';result=await f.client.reconcile();assert.equal(result.restarted,true);assert.equal(result.uncertain,true);assert(f.journal.get(id));
});
test('definite target-bound nonexecution receipt clears pending without resubmitting',async()=>{const f=fixture();f.mode='unchanged';const result=await f.client.change(lamp,'remove');assert.equal(result.executed,false);assert.equal(f.journal.get(id),null);assert.equal(f.posts().length,1);assert.equal(f.links.excluded.length,0);});
test('storage fault blocks a command before it can execute, and corrupt journals never silently disappear',async()=>{
 const f=fixture();f.memory.fail=true;await assert.rejects(f.client.change(lamp,'remove'),error=>error.storage===true);assert.equal(f.posts().length,0);
 const memory=storage();memory.setItem('coollamp-bridge-link-pending-v1','not JSON');assert.equal(new BridgeLinkJournal(memory).blocked,true);
});
test('journal reload retains original session and request, with bounded records and no credentials',()=>{
 const memory=storage(),journal=new BridgeLinkJournal(memory);journal.begin({deviceId:id,target:lamp,boot,revision:1,requestId:'7777777777777777',action:'remove',issuedAt:100,extra:'secret',password:'secret'});const reloaded=new BridgeLinkJournal(memory);assert.equal(reloaded.get(id).requestId,'7777777777777777');assert(!memory.getItem('coollamp-bridge-link-pending-v1').includes('secret'));assert.throws(()=>reloaded.begin({...reloaded.get(id)}));
});
test('read timeout/abort and oversized/redirected/malformed replies never start a mutation',async()=>{
 for(const patch of [{raw:'x'.repeat(8193)},{raw:'broken JSON'},{finalUrl:'http://10.0.0.2/api/bridge/status'}]){const f=fixture();Object.assign(f,patch);await assert.rejects(f.client.change(lamp,'remove'));assert.equal(f.posts().length,0);}
 const f=fixture({timeout:25});f.gate=deferred();f.gatePath='/api/bridge/status';await assert.rejects(f.client.change(lamp,'remove'),error=>error.timeout===true);assert.equal(f.posts().length,0);f.gate.resolve();
 const abort=fixture();abort.gate=deferred();abort.gatePath='/api/bridge/status';const controller=new AbortController(),read=abort.client.refresh({signal:controller.signal});await flush();controller.abort();await assert.rejects(read,error=>error.cancelled===true);abort.gate.resolve();assert.equal(abort.posts().length,0);
});
test('cancel after submission keeps the exact pending command until a fresh read reconciles it',async()=>{
 const f=fixture();f.gate=deferred();f.gatePath='/api/bridge/links';f.gateMethod='POST';const controller=new AbortController(),change=f.client.change(lamp,'remove',{signal:controller.signal});await flush();controller.abort();await assert.rejects(change,error=>error.uncertain===true);assert(f.journal.get(id));f.gate.resolve();await flush();await f.client.reconcile();assert.equal(f.posts().length,1);assert.equal(f.journal.get(id),null);
});

function rootFixture(){const listeners={},documentListeners={},root={innerHTML:'',attributes:{},classList:{add(){}},contains:()=>true,setAttribute(key,value){this.attributes[key]=value;},addEventListener:(key,value)=>{listeners[key]=value;},removeEventListener:key=>{delete listeners[key];},ownerDocument:{hidden:false,addEventListener:(key,value)=>{documentListeners[key]=value;},removeEventListener:key=>{delete documentListeners[key];}}};return {root,listeners,documentListeners,click(action,target){listeners.click({target:{closest:()=>({disabled:false,dataset:{bridgeAction:action,bridgeTarget:target}})}});}};}
test('dedicated bridge cards and detail use safe names, busy indicators, one-tap links and setup-only unknown devices',async()=>{
 const f=fixture(),dom=rootFixture();const mount=mountBridgeManagement(dom.root,{bridges:()=>[{id,address:'192.168.1.197',name:'Bridge <img>'}],lamps:()=>f.lamps,http:f.http,getPassword:async()=> 'private-password',storage:f.memory,onSetup:value=>{f.setup=value;},nextRequest:()=> 'aaaaaaaaaaaaaaaa'});
 assert.match(dom.root.innerHTML,/Your bridges/);assert.match(dom.root.innerHTML,/Bridge &lt;img&gt;/);await mount.open(id);assert.match(dom.root.innerHTML,/Can use this bridge/);assert.match(dom.root.innerHTML,/does not mean the lamp is connected through it/);assert.match(dom.root.innerHTML,/Finish lamp setup/);assert(!dom.root.innerHTML.includes('Kitchen <img>'));
 f.gate=deferred();f.gatePath='/api/bridge/links';dom.click('remove',lamp);await flush();assert.equal(dom.root.attributes['aria-busy'],'true');assert.match(dom.root.innerHTML,/Removing lamp/);dom.click('remove',lamp);f.gate.resolve();await flush();assert.equal(f.posts().length,1);assert.match(dom.root.innerHTML,/Not using this bridge/);dom.click('lamp-setup',unknown);assert.deepEqual(f.setup,{lampId:unknown,bridgeId:id});mount.dispose();
});
test('bridge discovery offers bounded Continue, and read cancellation remains separate from mutation controls',async()=>{
 const f=fixture(),dom=rootFixture();let finds=0;const mount=mountBridgeManagement(dom.root,{bridges:()=>[],http:f.http,getPassword:async()=> 'private-password',storage:f.memory,onFind:async options=>{finds++;assert.equal(options.continue,finds>1);return {cursor:finds===1?'next':null};}});
 dom.click('find');await flush();assert.match(dom.root.innerHTML,/Continue searching/);dom.click('find');await flush();assert.equal(finds,2);assert.match(dom.root.innerHTML,/Find a bridge/);mount.dispose();
});
test('saved lamps with unknown/different household authority never look confirmed linked or receive Add/Remove',async()=>{
 const f=fixture();f.lamps.push({id:'080302010002',name:'Other saved lamp',fleetId:'9999999999999999'},{id:'090302010002',name:'Unchecked saved lamp'});await f.client.refresh();
 for(const [target,label]of [['080302010002','Saved lamp · Different household'],['090302010002','Saved lamp · Household not checked']]){const row=f.client.rows().find(row=>row.id===target);assert.equal(row.label,label);assert.equal(row.owned,false);assert.equal(row.usesBridge,false);assert.equal(row.canAdd,false);await assert.rejects(f.client.change(target,'remove'));}
 assert.equal(f.posts().length,0);
});
test('mounted Stop check releases busy UI even if discovery ignores native cancellation; late result is discarded',async()=>{
 const f=fixture(),dom=rootFixture(),gate=deferred();let changes=0;const mount=mountBridgeManagement(dom.root,{bridges:()=>[],http:f.http,getPassword:async()=> 'private-password',storage:f.memory,onFind:()=>gate.promise,onChange:()=>{changes++;}});
 dom.click('find');await flush();assert.equal(dom.root.attributes['aria-busy'],'true');assert.match(dom.root.innerHTML,/Stop check/);dom.click('cancel');await flush();assert.equal(dom.root.attributes['aria-busy'],'false');assert.match(dom.root.innerHTML,/Bridge check stopped/);gate.resolve({cursor:'late'});await flush();assert(!dom.root.innerHTML.includes('Continue searching'));assert.equal(changes,0);mount.dispose();
});
test('mounted mutation cancellation is unavailable after submission, a lost reply stays pending, and returning checks original receipt',async()=>{
 const f=fixture(),dom=rootFixture();const mount=mountBridgeManagement(dom.root,{bridges:()=>[{id,address:'192.168.1.197'}],lamps:()=>f.lamps,http:f.http,getPassword:async()=> 'private-password',storage:f.memory,nextRequest:()=> 'bbbbbbbbbbbbbbbb'});await mount.open(id);
 f.gate=deferred();f.gatePath='/api/bridge/links';f.gateMethod='POST';f.mode='lost';dom.click('remove',lamp);await flush();assert.equal(f.posts().length,1);assert(!dom.root.innerHTML.includes('Stop check'));dom.click('cancel');await flush();assert.equal(dom.root.attributes['aria-busy'],'true');
 dom.root.ownerDocument.hidden=true;dom.documentListeners.visibilitychange();await flush();assert.equal(dom.root.attributes['aria-busy'],'false');assert.match(dom.root.innerHTML,/waiting for this bridge/);assert(!dom.root.innerHTML.includes('Can use this bridge · Nearby'));
 f.gate.resolve();await flush();f.mode='ok';dom.root.ownerDocument.hidden=false;dom.documentListeners.visibilitychange();await flush();assert.equal(f.posts().length,1);assert.match(dom.root.innerHTML,/Not using this bridge/);assert.match(dom.root.innerHTML,/Bridge lamp setting saved/);mount.dispose();
});
test('mounted saved bridge Wi-Fi shows safe network name/RSSI icon; no password/credential body enters UI or journal',async()=>{
 const f=fixture(),dom=rootFixture();f.status.wifi={version:1,configured:true,savedName:'Home <script>',connectedName:'Home <script>',connected:true,rssi:-61};const mount=mountBridgeManagement(dom.root,{bridges:()=>[{id,address:'192.168.1.197'}],lamps:()=>f.lamps,http:f.http,getPassword:async()=> 'private-password',storage:f.memory,onChange:()=>{throw Error('callback must not replace successful status');}});await mount.open(id);
 assert.match(dom.root.innerHTML,/Home &lt;script&gt;/);assert.match(dom.root.innerHTML,/aria-label="Wi-Fi: good signal"/);assert.match(dom.root.innerHTML,/Connection when last checked\. Tap Refresh/);assert.match(dom.root.innerHTML,/Bridge connection checked/);assert(!dom.root.innerHTML.includes('private-password'));assert(!dom.root.innerHTML.includes('Basic '));assert(!dom.root.innerHTML.includes('X-Lamp-Token'));assert.equal(f.memory.values.size,0);mount.dispose();
});
test('ignored native management timeout owns one physical flight across replacement clients until settlement',async()=>{
 const f=fixture({timeout:25});f.gate=deferred();f.gatePath='/api/bridge/status';await assert.rejects(f.client.refresh(),error=>error.timeout===true);assert.equal(f.client.busy,false);assert(f.client.nativeFlight);assert.equal(f.calls.length,1);
 const replacement=new BridgeManagementClient({bridge:{id,address:'192.168.1.197'},http:f.http,getPassword:async()=> 'private-password',journal:f.journal,lamps:()=>f.lamps,timeout:25});
 await assert.rejects(replacement.refresh(),error=>error.busy===true);await assert.rejects(f.client.change(lamp,'remove'),error=>error.busy===true);assert.equal(f.calls.length,1);assert.equal(f.posts().length,0);assert.equal(f.journal.get(id),null);
 f.gate.resolve();await flush();assert.equal(f.client.nativeFlight,null);assert.equal(f.client.snapshot,null,'late timed-out data was adopted');await replacement.refresh();assert.equal(replacement.snapshot.status.deviceId,id);assert.equal(f.calls.length,4);
});
test('ignored native abort keeps the management flight while UI returns, and cannot issue a second mutation',async()=>{
 const f=fixture(),controller=new AbortController();f.gate=deferred();f.gatePath='/api/bridge/status';const result=f.client.refresh({signal:controller.signal}).then(value=>({value}),error=>({error}));await flush();controller.abort();assert.equal((await result).error.cancelled,true);assert(f.client.nativeFlight);
 await assert.rejects(f.client.refresh(),error=>error.busy===true);await assert.rejects(f.client.change(lamp,'remove'),error=>error.busy===true);assert.equal(f.calls.length,1);f.gate.resolve();await flush();assert.equal(f.client.nativeFlight,null);assert.equal(f.client.snapshot,null);
});
