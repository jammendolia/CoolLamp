const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const transaction=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const phases=new Set(['exchange','confirm','approved','complete','failed']);
const messages={exchange:'Contacting the new lamp.',confirm:'Compare these four colors with the lamp, then click its knob once to approve.',approved:'The lamp approved setup. Waiting for saved trust to be confirmed.',complete:'Lamp added. Continue with its settings.',failed:'Lamp setup was not confirmed. Refresh before trying again.'};
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const locator=entry=>JSON.stringify([entry?.id,entry?.address||'',entry?.deviceId||'']);
const frozen=value=>Object.freeze(value);
const randomId=()=>[...crypto.getRandomValues(new Uint8Array(8))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const problem=(message,extra={})=>Object.assign(Error(message),extra);
const changed=()=>problem('Lamp setup changed or was canceled.',{cancelled:true});
const unknown=()=>problem('Lamp setup was not confirmed. Refresh its status before starting another setup.',{uncertain:true});

// Public announcements are untrusted, session-only candidates. They never
// grant a credential, select a control session, or write to the lamp store.
export class MeshOnboarding {
 constructor({getBridges=()=>[],acquireBridge,verifyEnrollment,onStatus=()=>{},onCandidates=()=>{},now=Date.now,id=randomId,
  timeout=120000,requestTimeout=8000,pollInterval=500,scanTimeout=20000,concurrency=2}={}){
  if(typeof acquireBridge!=='function')throw Error('Lamp setup needs a bridge connection factory.');
  Object.assign(this,{getBridges,acquireBridge,verifyEnrollment,onStatus,onCandidates,now,nextId:id});
  this.timeout=Math.min(120000,Math.max(1000,timeout));this.requestTimeout=Math.max(1,requestTimeout);
  this.pollInterval=Math.max(1,pollInterval);this.scanTimeout=Math.max(1,scanTimeout);
  this.concurrency=Math.min(2,Math.max(1,concurrency));this.candidates=new Map();this.usedIds=new Set();
  this.active=null;this.scanRun=null;this.disposed=false;this.unconfirmed=new Map();this.routes=new Map();
 }
 bridges(){
  const found=new Map();for(const entry of this.getBridges()||[])if(canonical(entry?.id)&&!found.has(entry.id))found.set(entry.id,{...entry});
  return [...found.values()];
 }
 currentBridge(entry){return !this.disposed&&this.bridges().some(value=>value.id===entry.id&&locator(value)===locator(entry));}
 publish(run,phase,extra={}){
  if(this.active!==run||this.disposed)return;
  const value={target:run.row.id,bridgeId:run.row.bridgeId,broker:run.row.broker,name:run.row.name,phase,message:messages[phase]||'Lamp setup canceled.'};
  if(extra.pattern)value.pattern=frozen([...extra.pattern]);
  if(extra.error)value.error=extra.error;
  if(extra.uncertain)value.uncertain=true;
  this.onStatus(frozen(value));
 }
 check(run,{allowCancel=false}={}){
  if(this.disposed||this.active!==run||!allowCancel&&run.cancelled||!this.currentBridge(run.entry))throw changed();
  if(run.bridge&&(run.bridge.identity!==run.entry.id||run.bridge.epoch!==run.epoch||run.bridge.base!==run.address))throw changed();
  if(this.now()>=run.deadline)throw unknown();
 }
 async bounded(action,deadline,signal){
  const remaining=Math.min(this.requestTimeout,deadline-this.now());if(remaining<=0)throw unknown();
  let timer,abort;
  try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(unknown()),remaining);abort=()=>reject(changed());
   if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async acquire(entry,deadline,signal){
  let expired=false;
  const pending=Promise.resolve().then(()=>this.acquireBridge(entry.id,{entry:{...entry},readOnly:true,purpose:'onboarding',signal}));
  // A connection factory may finish after cancellation/deadline. Release that
  // late lease without allowing any enrollment request through it.
  pending.then(lease=>{if(expired)void this.release(lease);},()=>{});
  try{return await this.bounded(()=>pending,deadline,signal);}catch(error){expired=true;throw error;}
 }
 async release(lease){try{await lease?.release?.();}catch{ /* Cleanup cannot authorize or replay setup. */ }}
 inventory(value,entry){
  if(value?.version!==1||!Array.isArray(value.candidates))throw problem('Invalid new-lamp discovery response.');
  const rows=[];for(const item of value.candidates.slice(0,32)){
   if(!canonical(item?.id)||item.id===entry.id||!canonical(item.broker)||item.id===item.broker||typeof item.online!=='boolean'||item.claimed!==false)continue;
   const name=typeof item.name==='string'?item.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,64):'New CoolLamp';
   const firmwareVersion=typeof item.firmwareVersion==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(item.firmwareVersion)?item.firmwareVersion:'';
   rows.push(frozen({id:item.id,name:name||'New CoolLamp',firmwareVersion,broker:item.broker,bridgeId:entry.id,online:item.online,claimed:false,observedAt:this.now()}));
  }return rows;
 }
 discover(){
  if(this.disposed)return Promise.resolve({candidates:[],cancelled:true});
  if(this.scanRun)return this.scanRun.promise;
  const run={controller:new AbortController(),deadline:this.now()+this.scanTimeout};this.scanRun=run;
  run.promise=(async()=>{
   const entries=this.bridges(),rows=new Map(),routes=new Map();let index=0;
   const worker=async()=>{while(index<entries.length&&!run.controller.signal.aborted&&this.now()<run.deadline){
    const entry=entries[index++];let lease;
    try{
     lease=await this.acquire(entry,run.deadline,run.controller.signal);
     const bridge=lease?.lamp||lease?.transport,epoch=bridge?.epoch,address=bridge?.base;
     const guard=()=>{if(run.controller.signal.aborted||this.scanRun!==run||!this.currentBridge(entry)||bridge?.identity!==entry.id||bridge.epoch!==epoch||bridge.base!==address||this.now()>=run.deadline)throw changed();};
     guard();if(typeof bridge.request!=='function')continue;
     const value=parse(await this.bounded(()=>bridge.request('/api/mesh/new',undefined,epoch,guard),run.deadline,run.controller.signal));guard();
     for(const row of this.inventory(value,entry))if(!rows.has(row.id)){rows.set(row.id,row);routes.set(row.id,locator(entry));}
     this.candidates=new Map(rows);this.routes=new Map(routes);this.onCandidates(frozen([...rows.values()]));
    }catch{ /* One unreachable or older bridge cannot block other candidates. */ }
    finally{await this.release(lease);}
   }};
   await Promise.all(Array.from({length:this.concurrency},worker));
   const cancelled=run.controller.signal.aborted||this.disposed;
   if(!cancelled&&this.scanRun===run){this.candidates=rows;this.routes=routes;this.onCandidates(frozen([...rows.values()]));}
   return {candidates:[...rows.values()],cancelled};
  })().finally(()=>{if(this.scanRun===run)this.scanRun=null;});return run.promise;
 }
 cancelDiscover(){this.scanRun?.controller.abort();}
 reply(value,run){
  if(value?.version!==1||value.target!==run.row.id||value.requestId!==run.requestId||value.broker!==run.row.broker||!phases.has(value.phase))throw unknown();
  if(value.phase==='confirm'&&(!Array.isArray(value.pattern)||value.pattern.length!==4||value.pattern.some(slot=>!Number.isInteger(slot)||slot<0||slot>15)))throw unknown();
  if(value.phase==='complete'&&!transaction(value.fleetId))throw unknown();
  return value;
 }
 async request(run,path,{allowCancel=false}={}){
  const guard=()=>this.check(run,{allowCancel});guard();
  return this.reply(parse(await this.bounded(()=>run.bridge.request(path,{target:run.row.id,requestId:run.requestId,broker:run.row.broker},run.epoch,guard),run.deadline,allowCancel?undefined:run.controller.signal)),run);
 }
 start(candidate){
  if(this.disposed)return Promise.reject(changed());
  if(this.active)return Promise.reject(problem('Finish or cancel the current lamp setup first.'));
  if(this.unconfirmed.has(candidate?.id))return Promise.reject(problem('Check this lamp’s previous setup before starting another session.',{requiresVerification:true,uncertain:true}));
  const row=this.candidates.get(candidate?.id);
  const entry=this.bridges().find(value=>value.id===row?.bridgeId);
  if(!row||!entry||this.routes.get(row.id)!==locator(entry)||!row.online||candidate.bridgeId!==row.bridgeId||candidate.broker!==row.broker||this.now()-row.observedAt>15000)return Promise.reject(problem('Refresh the new-lamp list before starting setup.'));
  let requestId;for(let i=0;i<8;++i){const value=this.nextId();if(transaction(value)&&!this.usedIds.has(value)){requestId=value;break;}}
  if(!requestId)return Promise.reject(problem('Could not create a fresh lamp setup. Refresh before trying again.'));
  this.usedIds.add(requestId);
  const run={row,entry,requestId,controller:new AbortController(),deadline:this.now()+this.timeout,cancelled:false,submitted:false};this.active=run;
  run.promise=this.enroll(run).finally(()=>{if(this.active===run)this.active=null;});return run.promise;
 }
 async enroll(run){
  let value,lease,readFailures=0;
  try{
   this.publish(run,'exchange');lease=await this.acquire(run.entry,run.deadline,run.controller.signal);this.check(run);
   run.lease=lease;run.bridge=lease?.lamp||lease?.transport;run.epoch=run.bridge?.epoch;run.address=run.bridge?.base;
   this.check(run);if(typeof run.bridge?.request!=='function')throw problem('The bridge cannot set up a new lamp.');
   // Revalidate the exact announced broker before the one explicit start. A
   // refreshed candidate never silently redirects a pending setup elsewhere.
   if(run.recovery){
    if(this.verifyEnrollment){
     try{
      const verified=await this.bounded(()=>this.verifyEnrollment({target:run.row.id,bridgeId:run.row.bridgeId,broker:run.row.broker,requestId:run.requestId,signal:run.controller.signal}),run.deadline,run.controller.signal);this.check(run);
      if(verified?.verified===true&&verified.target===run.row.id&&transaction(verified.fleetId))value={version:1,target:run.row.id,requestId:run.requestId,broker:run.row.broker,phase:'complete',fleetId:verified.fleetId};
     }catch{this.check(run);/* Same-session status remains the only other recovery path. */}
    }
    if(!value)value=await this.request(run,'/api/mesh/enroll/status');
   }else{
    const guard=()=>this.check(run);
    const fresh=this.inventory(parse(await this.bounded(()=>run.bridge.request('/api/mesh/new',undefined,run.epoch,guard),run.deadline,run.controller.signal)),run.entry);
    this.check(run);if(!fresh.some(row=>row.id===run.row.id&&row.broker===run.row.broker&&row.online))throw problem('The new lamp is no longer available. Refresh the list.');
    run.submitted=true;
    try{value=await this.request(run,'/api/mesh/enroll/start');}
    catch(error){this.check(run);if(error.confirmed)throw error;/* Recover by same-session status only; never resend Start. */}
   }
   for(;;){
    this.check(run);
    if(value){
     if(value.phase==='failed'){
      const confirmed=value.confirmedAbsent===true;if(confirmed)this.unconfirmed.delete(run.row.id);
      throw problem('The lamp declined setup or its approval expired.',{confirmed,uncertain:!confirmed});
     }
     if(value.phase==='complete')run.completed=true;
     this.publish(run,value.phase,value.phase==='confirm'?{pattern:value.pattern}:{});
     if(value.phase==='complete'){
      const result=frozen({target:run.row.id,bridgeId:run.row.bridgeId,broker:run.row.broker,requestId:run.requestId,fleetId:value.fleetId});
      this.unconfirmed.delete(run.row.id);this.candidates.delete(run.row.id);this.routes.delete(run.row.id);this.onCandidates(frozen([...this.candidates.values()]));return result;
     }
    }
    await this.bounded(()=>new Promise(resolve=>setTimeout(resolve,this.pollInterval)),run.deadline,run.controller.signal);this.check(run);
    try{value=await this.request(run,'/api/mesh/enroll/status');readFailures=0;}
    catch(error){this.check(run);if(error.confirmed||++readFailures>=3)throw error;value=null;}
   }
  }catch(error){
   const uncertain=run.submitted&&!error.confirmed&&!run.cancelAcknowledged;
   if(uncertain)this.unconfirmed.set(run.row.id,{row:run.row,entry:run.entry,requestId:run.requestId});
   this.publish(run,run.cancelled?'cancelled':'failed',{error:run.cancelled?'Setup canceled. Approval is no longer requested.':uncertain?'Lamp setup was not confirmed. Refresh before starting another setup.':'Lamp setup could not continue. Refresh the new-lamp list.',uncertain});
   throw Object.assign(problem(run.cancelled?'Lamp setup canceled.':uncertain?unknown().message:'Lamp setup could not continue.'),{cancelled:run.cancelled,uncertain,confirmed:!uncertain});
  }finally{if(run.cancelTask)await run.cancelTask;await this.release(lease);run.lease=null;}
 }
 recover(target){
  if(this.disposed)return Promise.reject(changed());
  if(this.active)return Promise.reject(problem('Finish or cancel the current lamp setup first.'));
  const pending=this.unconfirmed.get(target);if(!pending)return Promise.reject(problem('This lamp has no unresolved setup session.'));
  if(!this.currentBridge(pending.entry))return Promise.reject(problem('The original setup bridge changed. Check this lamp through a trusted connection.',{uncertain:true}));
  const run={...pending,recovery:true,submitted:true,cancelled:false,controller:new AbortController(),deadline:this.now()+this.timeout};this.active=run;
  run.promise=this.enroll(run).finally(()=>{if(this.active===run)this.active=null;});return run.promise;
 }
 async cancel(){
  const run=this.active;if(!run)return {cancelled:true,uncertain:false};
  if(run.completed)return {cancelled:false,complete:true,uncertain:false};
  if(run.cancelTask)return run.cancelTask;
  run.cancelled=true;
  run.cancelTask=(async()=>{
   let acknowledged=false;
   if(run.submitted&&run.bridge){
    try{const value=await this.request(run,'/api/mesh/enroll/cancel',{allowCancel:true});acknowledged=value.phase==='failed'&&value.confirmedAbsent===true;}catch{ /* Never replay a cancellation or enrollment. */ }
   }
   run.cancelAcknowledged=acknowledged;if(acknowledged)this.unconfirmed.delete(run.row.id);
   this.publish(run,'cancelled',{error:acknowledged?'Setup canceled.':run.submitted?'Cancellation was not confirmed. Check this lamp before starting another setup.':'Setup canceled.',uncertain:run.submitted&&!acknowledged});
   return {cancelled:true,uncertain:run.submitted&&!acknowledged};
  })();
  run.controller.abort();return run.cancelTask;
 }
 async dispose(){this.cancelDiscover();await this.cancel();this.disposed=true;}
}
