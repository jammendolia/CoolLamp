import test from 'node:test';
import assert from 'node:assert/strict';
import {LampExperienceSession} from '../src/experience-contracts.js';
import {applySavedLook,planSavedLook} from '../src/saved-look-apply.js';

const lampId='aabbccddeeff',boot='1122334455667788';
const catalog=[{id:13,name:'Plasma',speed:true,category:'calm'}];
const look=(custom=false)=>({version:1,lampId,name:'Cozy',effect:{localId:13,name:'Plasma'},appearance:{brightness:120,color:[Number(custom),255,60,110],options:[50,100,1,35,160,255]}});
function harness({beforeRead=()=>{},afterWrite=()=>{},lostAt=0,missingExecution=false}={}){
 const state={version:1,target:lampId,bootSession:boot,revision:1,syncRole:0,syncPaused:false,nextCommandId:'0000000000000001',mode:4,brightness:70,power:false};
 let reads=0,id=1;const writes=[],paths=[];
 const transport={request:async(path,fields)=>{
  paths.push(path);
  if(path==='/api/revision'){beforeRead(++reads,state);return {...state,nextCommandId:(id++).toString(16).padStart(16,'0')};}
  assert.equal(path,'/api/state/patch');assert.equal(fields.target,lampId);assert.equal(fields.bootSession,state.bootSession);assert.equal(fields.expectedRevision,state.revision);
  writes.push({...fields});++state.revision;
  const executionRevision=state.revision;afterWrite(writes.length,state);
  if(lostAt===writes.length)throw Error('lost reply');
  return {version:1,target:lampId,bootSession:boot,requestBoot:fields.bootSession,commandId:fields.commandId,revision:state.revision,
   ...(!missingExecution?{executionRevision}:{}),outcome:'executed',executed:true,persisted:false,httpStatus:200};
 }};
 const session=new LampExperienceSession(transport,lampId);session.descriptor={capabilities:{control:['command-receipts-v1','group-revision-v1']}};
 return {state,writes,paths,session,run:(value=look(),extra={})=>applySavedLook(value,{lampId,catalog,session,...extra})};
}
test('custom look is one real receipt-fenced command; never power/startup/hardware/save',async()=>{
 const h=harness(),result=await h.run(look(true));assert.equal(result.outcome,'executed');assert.equal(h.writes.length,1);
 const command=h.writes[0];assert.equal(command.mode,13);assert.equal(command.brightness,120);assert.deepEqual([command.r,command.g,command.b],[255,60,110]);assert.equal(command.dual,1);assert.equal(command.speed,50);
 for(const key of ['power','startupMode','startupBrightness','leds','midpoint','save','resetPalette'])assert.equal(Object.hasOwn(command,key),false,key);
 assert(h.paths.every(path=>['/api/revision','/api/state/patch'].includes(path)));
});
test('automatic palette never sends placeholder primary RGB and chains tuning to execution receipt',async()=>{
 const h=harness(),result=await h.run();assert.equal(result.outcome,'executed');assert.equal(h.writes.length,2);
 const [reset,tuning]=h.writes;assert.equal(reset.resetPalette,1);assert.equal(reset.brightness,120);assert.equal(reset.mode,13);
 for(const key of ['r','g','b','speed','intensity','dual','r2'])assert.equal(Object.hasOwn(reset,key),false);
 assert.equal(tuning.expectedRevision,2);assert.equal(tuning.speed,50);assert.equal(tuning.intensity,100);assert.equal(tuning.dual,1);
 for(const key of ['r','g','b','brightness','power','resetPalette'])assert.equal(Object.hasOwn(tuning,key),false);
});
test('solid or sound-only effects never receive unsupported speed',()=>{
 const value={...look(true),effect:{localId:52,name:'Sound Filament'}};
 const plan=planSavedLook(value,{lampId,catalog:[{id:52,name:'Sound Filament',speed:false}]});assert.equal(Object.hasOwn(plan.patches[0],'speed'),false);
});
test('knob or phone revision change between the two steps stops without overwriting it',async()=>{
 const h=harness({beforeRead:(n,state)=>{if(n===3)++state.revision;}}),result=await h.run();
 assert.equal(result.outcome,'partial');assert.equal(result.appliedSteps,1);assert.equal(h.writes.length,1);assert.equal(h.session.pending,null);
});
test('a revision change before the first write changes nothing',async()=>{
 const h=harness({beforeRead:(n,state)=>{if(n===2)++state.revision;}}),result=await h.run();
 assert.equal(result.outcome,'rejected');assert.equal(h.writes.length,0);
});

test('a lamp becoming a Mirror coordinator before the initial revision cannot receive a per-lamp look',async()=>{
 const h=harness({beforeRead:(n,state)=>{if(n===1){state.syncRole=1;++state.revision;}}}),result=await h.run();
 assert.equal(result.outcome,'rejected');assert.equal(h.writes.length,0);assert.match(result.error.message,/group changed/);
});

for(const turn of [2,3])test('group membership changing before command '+(turn-1)+' is revision fenced',async()=>{
 const h=harness({beforeRead:(n,state)=>{if(n===turn){state.syncRole=1;++state.revision;}}}),result=await h.run();
 assert.equal(result.outcome,turn===2?'rejected':'partial');assert.equal(h.writes.length,turn===2?0:1);
});

test('receipt support without group revision fencing cannot apply a look',async()=>{
 const h=harness();h.session.descriptor.capabilities.control=['command-receipts-v1'];
 await assert.rejects(h.run(),/Update this lamp/);assert.equal(h.paths.length,0);
});
test('current reply revision cannot substitute for an older execution revision',async()=>{
 const h=harness({afterWrite:(n,state)=>{if(n===1)++state.revision;}}),result=await h.run();assert.equal(result.outcome,'partial');assert.equal(h.writes.length,1);
});
test('older receipt without execution fencing cannot continue an automatic two-step look',async()=>{
 const h=harness({missingExecution:true}),result=await h.run();assert.equal(result.outcome,'partial');assert.equal(h.writes.length,1);
});
test('loss of first reply retains exact pending command and never repeats it on another call',async()=>{
 const h=harness({lostAt:1}),result=await h.run();assert.equal(result.outcome,'uncertain');assert.equal(h.writes.length,1);assert(h.session.pending);
 await assert.rejects(h.run(),/previous unconfirmed/);assert.equal(h.writes.length,1);assert(!h.paths.some(path=>path.includes('receipt')));
});
test('loss of second reply does not report the complete look or repeat either step',async()=>{
 const h=harness({lostAt:2}),result=await h.run();assert.equal(result.outcome,'uncertain');assert.equal(result.appliedSteps,1);assert.equal(h.writes.length,2);assert(h.session.pending);
});
test('reboot between steps is a partial result with no cross-boot replay',async()=>{
 const h=harness({beforeRead:(n,state)=>{if(n===3)state.bootSession='9988776655443322';}}),result=await h.run();assert.equal(result.outcome,'partial');assert.equal(h.writes.length,1);
});
test('route/scope guard changing after a confirmed step stops later writes',async()=>{
 let current=true;const h=harness({afterWrite:()=>{current=false;}}),result=await h.run(look(),{guard:()=>{if(!current)throw Error('selection changed');}});
 assert.equal(result.outcome,'partial');assert.equal(result.appliedSteps,1);assert.equal(h.writes.length,1);
});
test('wrong lamp, missing effects, changed local meaning and zone palettes fail before any read or write',async()=>{
 const h=harness();for(const value of [{...look(),lampId:'ffeeddccbbaa'},{...look(),effect:{localId:12,name:'Plasma'}}])await assert.rejects(h.run(value));
 await assert.rejects(h.run(look(),{catalog:[{...catalog[0],name:'New effect'}]}));
 await assert.rejects(h.run({...look(),effect:{localId:46,name:'VU Meter'}},{catalog:[{id:46,name:'VU Meter',speed:true}]}));assert.equal(h.paths.length,0);
});
test('unavailable future effects are never substituted and old receivers get a clear prerequisite',async()=>{
 const h=harness();await assert.rejects(h.run(look(),{catalog:[{...catalog[0],available:false}]}),/not available/);
 h.session.descriptor=null;await assert.rejects(h.run(),/Update this lamp/);assert.equal(h.paths.length,0);
});
