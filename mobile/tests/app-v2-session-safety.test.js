import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LampExperienceSession} from '../src/experience-contracts.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const sessionUi=source.slice(source.indexOf('function app2TargetMatches('),source.indexOf('function paintRanges('));
const boot='1122334455667788';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function descriptor(target){
 const state={version:1,target,bootSession:boot,revision:1,nextCommandId:'0000000000000001',mode:4,brightness:100,power:true};
 return {descriptorVersion:2,deviceId:target,firmwareVersion:'1.15.0',model:{version:1,id:'helix',displayName:'Helix',artworkFamily:'helix',hardwareRevision:'rev-a',preconfigured:true},state,
  limits:{groupMembers:32,legacyGroupMembers:9,localPresence:16,forwardingHops:4,bleConnections:1,bleBonds:3,requestBytes:1024,responseBytes:8192,schemaPageEntries:4,schemaPageBytes:4096,receipts:8,receiptLifetimeMs:120000,appearanceWriteIntervalMs:2000},
  capabilities:{catalogVersions:[1,2],sceneVersions:[2,3],control:['command-receipts-v1'],persistence:['per-effect-appearance-v2'],updates:['https-pinned'],commissioning:['physical-comparison-v2']}};
}
function transport(id,{gate,unsupported=false,afterQueue,refreshError=false}={}){
 const started=deferred(),requests=[],writes=[];
 return {identity:id,name:id,epoch:1,raw:{token:'token-'+id},catalog:[{id:4}],requests,writes,started,refreshCalls:0,
  enqueue(action){return Promise.resolve().then(action).then(value=>{afterQueue?.();return value;});},
  async request(path,fields,epoch,beforeWrite){
   beforeWrite?.();
   requests.push(path);
   if(path==='/api/descriptor'){started.resolve();if(gate)await gate.promise;if(unsupported)throw Error('Unsupported descriptor');return descriptor(id);}
   if(path==='/api/revision')return descriptor(id).state;
   writes.push({path,fields});return {version:1,target:id,bootSession:boot,requestBoot:boot,commandId:'0000000000000001',revision:2,executionRevision:2,outcome:path==='/api/appearance/save'?'persisted':'executed',executed:true,persisted:path==='/api/appearance/save',httpStatus:200};
  },
  async refresh(){this.refreshCalls++;if(refreshError)throw Error('State response memory unavailable. Nothing changed.');}
 };
}
function harness(){
 const elements=new Map(),messages=[];
 const context={LampExperienceSession,messages,console,confirm:()=>true,firmwareBackgroundWorkAllowed:()=>true,firmwareBackgroundGeneration:0,
  adaptiveEffectModel:(entry,options)=>({entry,...options}),
  $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'#ff0088'});return elements.get(id);},
  renderOptions:()=>{},status:message=>messages.push(message),updatingLamp:()=>false,independentLightingAllowed:()=>true};
 runInNewContext(`let lamp=null,selected=null,state=null,busy=false,connecting=false,effectOptions=null,liveLightSending=false;
 let app2Experience=null,app2ExperienceRun=null;const app2Pending=new Map();
 const verifiedSelectedLamp=()=>Boolean(lamp&&selected&&state&&lamp.identity===selected.id);
 const advancedAvailable=()=>Boolean(state&&lamp?.raw);
 ${sessionUi}
 globalThis.ui={
  select(target){lamp=target;selected=target?{id:target.identity,name:target.name}:null;state=target?{mode:4,color:{enabled:true}}:null;},
  mode(value){state.mode=value;},
  live(value){liveLightSending=value;},
  load:loadApp2Experience,light:app2LightChange,save:saveApp2Appearance,model:app2EffectModel,
  reconcile:()=>$('reconcileApp2').onclick(),retire:()=>$('retireApp2').onclick(),
  remember(id,session){app2Pending.set(id,session);},pending(id){return app2Pending.get(id);}
 };`,context);
 return {...context.ui,messages,elements};
}

test('effect controls render safely before a lamp has been selected',()=>{
 const ui=harness();const model=ui.model({id:4});assert.equal(model.descriptor,null);assert.equal(model.schema,undefined);
});

test('a new lamp does not join the previous lamp descriptor negotiation',async()=>{
 const ui=harness(),gate=deferred(),first=transport('aabbccddeeff',{gate}),second=transport('112233445566');
 ui.select(first);const old=ui.load().catch(error=>error);await first.started.promise;
 ui.select(second);const current=await ui.load();assert.equal(current.id,second.identity);assert.equal(current.target,second);
 gate.resolve();assert.match((await old).message,/selected lamp changed/);assert.equal(await ui.load(),current);
 assert.equal(first.writes.length+second.writes.length,0);
});

test('selection changing after negotiation cannot fall through to a legacy write',async()=>{
 const ui=harness(),second=transport('112233445566');
 const first=transport('aabbccddeeff',{unsupported:true,afterQueue:()=>ui.select(second)});
 ui.select(first);await assert.rejects(ui.light('brightness',42),/selected lamp changed/);
 assert.equal(first.writes.length+second.writes.length,0);
});

test('saving cannot silently capture a different effect after negotiation',async()=>{
 const ui=harness(),first=transport('aabbccddeeff',{afterQueue:()=>ui.mode(7)});
 ui.select(first);await ui.save();assert.equal(first.writes.length,0);assert.match(ui.messages.at(-1),/effect changed/);
});

test('reconciliation clears a confirmed receipt even if its later refresh fails',async()=>{
 const ui=harness(),first=transport('aabbccddeeff',{refreshError:true});let reads=0;
 ui.select(first);ui.remember(first.identity,{target:first.identity,reconcile:async()=>{reads++;return {outcome:'executed',executed:true};}});
 await ui.reconcile();assert.equal(reads,1);assert.equal(ui.pending(first.identity),undefined);assert.match(ui.messages.at(-1),/State response memory unavailable/);
});

for(const live of [false,true])test('a validated execution receipt with a later '+(live?'live':'explicit')+' read failure stays applied without retry or false uncertainty',async()=>{
 const ui=harness(),first=transport('aabbccddeeff',{refreshError:true}),cache=first.raw;
 ui.select(first);ui.live(live);assert.equal(await ui.light('brightness',42),true);
 assert.equal(first.writes.length,1);assert.equal(first.writes[0].fields.brightness,42);assert.equal(first.refreshCalls,1);assert.equal(first.raw,cache);
 assert.equal(ui.pending(first.identity),undefined);assert.equal(ui.messages.at(-1),'Your change was applied. Current settings could not be refreshed.');
 assert(!ui.messages.some(message=>message.includes('Nothing changed')));
});

test('a known executed change cannot show stale read-failure feedback on a newly selected lamp',async()=>{
 const ui=harness(),second=transport('112233445566');let turns=0;
 const first=transport('aabbccddeeff',{afterQueue:()=>{if(++turns===2)ui.select(second);}});
 ui.select(first);assert.equal(await ui.light('brightness',42),true);
 assert.equal(first.writes.length,1);assert.equal(second.writes.length,0);assert.equal(first.refreshCalls,0);
 assert.equal(ui.pending(first.identity),undefined);assert.equal(ui.messages.length,0);
});

test('production effect tuning sends one fresh revision and only the changed parameter',async()=>{
 const ui=harness(),first=transport('aabbccddeeff');ui.select(first);
 await ui.light('effectOptions',{mode:4,speed:24,intensity:82,dual:1,r:9,g:8,b:7},false,'speed');
 assert.equal(first.writes.length,1);const patch=first.writes[0].fields;
 assert.equal(patch.mode,4);assert.equal(patch.speed,24);assert.equal('intensity' in patch,false);assert.equal('dual' in patch,false);
 for(const field of ['r2','g2','b2'])assert.equal(field in patch,false);
 assert.equal(first.requests.filter(path=>path==='/api/revision').length,1);assert.equal(ui.pending(first.identity),undefined);
});

for(const resolved of [true,false])test('production next-effect command '+(resolved?'reconciles a confirmed receipt before a new mutation':'keeps an unknown original receipt without replay'),async()=>{
 const ui=harness(),first=transport('aabbccddeeff');let receiptReads=0,patchWrites=0;
 const original=first.request.bind(first);
 first.request=async(path,fields,epoch,beforeWrite)=>{
  if(path==='/api/receipt'){
   first.requests.push(path);receiptReads++;assert.equal(fields.target,first.identity);assert.equal(fields.bootSession,boot);assert.equal(fields.commandId,'0000000000000001');
   return {version:1,target:first.identity,bootSession:boot,requestBoot:boot,commandId:fields.commandId,revision:2,executionRevision:2,
    outcome:resolved?'executed':'uncertain',executed:resolved?true:null,persisted:resolved?false:null,httpStatus:200};
  }
  if(path==='/api/revision'){
   first.requests.push(path);return {...descriptor(first.identity).state,revision:receiptReads?2:1,nextCommandId:receiptReads?'0000000000000002':'0000000000000001'};
  }
  if(path==='/api/state/patch'){
   beforeWrite?.();first.requests.push(path);first.writes.push({path,fields});patchWrites++;
   if(patchWrites===1)throw Error('Lost first mutation reply');
   return {version:1,target:first.identity,bootSession:boot,requestBoot:boot,commandId:fields.commandId,revision:3,executionRevision:3,outcome:'executed',executed:true,persisted:false,httpStatus:200};
  }
  return original(path,fields,epoch,beforeWrite);
 };
 ui.select(first);await assert.rejects(ui.light('brightness',33),error=>error.uncertain);const pending=ui.pending(first.identity);assert(pending);
 if(resolved){
  assert.equal(await ui.light('effect',46),true);assert.equal(ui.pending(first.identity),undefined);assert.equal(patchWrites,2);
  assert.equal(first.writes[1].fields.commandId,'0000000000000002');assert.equal(first.writes[1].fields.mode,46);assert.equal('brightness' in first.writes[1].fields,false);
  assert.deepEqual(first.requests,['/api/descriptor','/api/revision','/api/state/patch','/api/receipt','/api/revision','/api/state/patch']);
 }else{
  await assert.rejects(ui.light('effect',46),error=>error.uncertain&&error.requiresReconciliation);assert.equal(ui.pending(first.identity),pending);assert.equal(patchWrites,1);
  assert.deepEqual(first.requests,['/api/descriptor','/api/revision','/api/state/patch','/api/receipt']);
 }
 assert.equal(receiptReads,1);
});

test('production known preexecution refusal does not leave a false unconfirmed-change UI record',async()=>{
 const ui=harness(),first=transport('aabbccddeeff'),request=first.request.bind(first);
 first.request=async(path,fields,epoch,beforeWrite)=>{
  if(path==='/api/state/patch'){beforeWrite?.();throw Object.assign(Error('Control resources unavailable. This request was not executed.'),{confirmed:true,status:503});}
  return request(path,fields,epoch,beforeWrite);
 };
 ui.select(first);await assert.rejects(ui.light('brightness',22),error=>error.preexecution&&error.uncertain===false);assert.equal(ui.pending(first.identity),undefined);
});
