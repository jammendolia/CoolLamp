import test from 'node:test';
import assert from 'node:assert/strict';
import {lampDescriptor,effectSchemaPage,commandReceipt,revisionSnapshot,LampExperienceSession} from '../src/experience-contracts.js';
const target='aabbccddeeff',boot='1122334455667788';
const state={version:1,target,bootSession:boot,revision:1,nextCommandId:'0000000000000001',mode:4,brightness:100,power:true};
const descriptor=()=>({descriptorVersion:2,deviceId:target,firmwareVersion:'1.15.0',model:{version:1,id:'future-coil-2070',displayName:'Future Coil',artworkFamily:'future-art',hardwareRevision:'rev-z',preconfigured:true},state:{...state},limits:{groupMembers:32,legacyGroupMembers:9,localPresence:16,forwardingHops:4,bleConnections:1,bleBonds:3,requestBytes:1024,responseBytes:8192,schemaPageEntries:4,schemaPageBytes:4096,receipts:8,receiptLifetimeMs:120000,appearanceWriteIntervalMs:2000},capabilities:{catalogVersions:[1,2],sceneVersions:[2,3],control:['command-receipts-v1'],persistence:['per-effect-appearance-v2'],updates:['https-pinned'],commissioning:['physical-comparison-v2']}});

test('Edison descriptor preserves its model identity and selects its explicitly known artwork',()=>{
 const value=descriptor();value.model={version:1,id:'edison-v1',displayName:'CoolLamp Edison',artworkFamily:'edison',hardwareRevision:'unspecified',preconfigured:true};
 const parsed=lampDescriptor(value,target);assert.equal(parsed.model.id,'edison-v1');assert.equal(parsed.model.artwork,'edison');
 const future=lampDescriptor({...value,model:{...value.model,id:'future-edison-9',artworkFamily:'future-art'}},target);
 assert.equal(future.model.id,'future-edison-9');assert.equal(future.model.artwork,'generic');
});

test('Sonata factory descriptor retains identity and trusted Sonata artwork without accepting unknown execution metadata',()=>{
 const value=descriptor();value.model={version:1,id:'sonata-v1',displayName:'CoolLamp Sonata',artworkFamily:'sonata',hardwareRevision:'unspecified',preconfigured:true,renderer:'untrusted'};
 const parsed=lampDescriptor(value,target);assert.equal(parsed.model.id,'sonata-v1');assert.equal(parsed.model.artwork,'sonata');assert.equal(parsed.model.renderer,undefined);
});
const receipt=(outcome='executed')=>({version:1,target,bootSession:boot,requestBoot:boot,commandId:state.nextCommandId,revision:2,executionRevision:2,outcome,executed:outcome==='uncertain'?null:outcome!=='rejected',persisted:outcome==='uncertain'?null:outcome==='persisted',httpStatus:200});
test('future model identity survives generic artwork and limits never inflate firmware',()=>{const value=lampDescriptor(JSON.stringify(descriptor()),target);assert.equal(value.model.id,'future-coil-2070');assert.equal(value.model.artwork,'generic');for(const field of ['deviceId','model','limits']){const bad=descriptor();if(field==='deviceId')bad.deviceId='112233445566';if(field==='model')bad.model.id='<script>';if(field==='limits')bad.limits.forwardingHops=6;assert.throws(()=>lampDescriptor(bad,target));}assert.throws(()=>lampDescriptor(' '.repeat(8193),target));});
test('descriptor and saved model use the exact firmware record limits and omit unrelated metadata',()=>{
 const raw=descriptor();Object.assign(raw.model,{id:'m'.repeat(48),artworkFamily:'a'.repeat(32),hardwareRevision:'h'.repeat(32),secret:'private'});
 const parsed=lampDescriptor(raw,target);assert.equal(parsed.model.id,raw.model.id);assert.equal(parsed.model.secret,undefined);
 for(const [field,size] of [['id',49],['artworkFamily',33],['hardwareRevision',33]])assert.throws(()=>lampDescriptor({...raw,model:{...raw.model,[field]:'x'.repeat(size)}},target),/descriptor/);
});
test('current appearance revision tuples are complete, typed, immutable and optional for older firmware',()=>{
 const color=[1,2,3,4],options=[50,100,0,255,0,20];const value=revisionSnapshot({...state,currentColor:color,currentOptions:options},target);
 assert.deepEqual(value.currentColor,color);assert.deepEqual(value.currentOptions,options);assert(Object.isFrozen(value.currentColor));assert(Object.isFrozen(value.currentOptions));
 color[0]=0;options[0]=1;assert.equal(value.currentColor[0],1);assert.equal(value.currentOptions[0],50);
 assert.equal(revisionSnapshot(state,target).currentColor,undefined);
 for(const broken of [
  {currentColor:[1,2,3,4]}, {currentOptions:[50,100,0,255,0,20]},
  {currentColor:[true,2,3,4],currentOptions:[50,100,0,255,0,20]},
  {currentColor:[1,2,3,256],currentOptions:[50,100,0,255,0,20]},
  {currentColor:[1,2,3,4],currentOptions:[0,100,0,255,0,20]},
  {currentColor:[1,2,3,4],currentOptions:[50,101,0,255,0,20]},
  {currentColor:[1,2,3,4],currentOptions:[50,100,2,255,0,20]},
  {currentColor:[1,2,3,4],currentOptions:[50,100,0,255,0,20,7]},
  {currentColor:new Array(4),currentOptions:[50,100,0,255,0,20]}
 ])assert.throws(()=>revisionSnapshot({...state,...broken},target),/appearance revision/);
});
test('future effect and parameter stay data; malformed ranges and fixed palette rejected',()=>{const page={schemaVersion:2,target,kind:'effects',offset:0,next:1,total:1,entries:[{key:'effect.future',localId:198,motion:false,parameters:[{key:'future-param',type:'future-type',units:'percent',semanticRole:'glow'}],palette:{modes:['automatic','custom'],colorRoles:['primary']},audio:{required:false,source:'none'},persistence:'per-effect'}]};const value=effectSchemaPage(page,target);assert.equal(value.entries[0].localId,198);assert.equal(value.entries[0].parameters[0].supported,false);page.entries[0].parameters=[{key:'speed',type:'integer',min:1,max:100,step:1,default:101,units:'percent',semanticRole:'motion'}];assert.throws(()=>effectSchemaPage(page,target));page.entries[0].parameters=[];page.entries[0].palette.modes=['javascript'];assert.throws(()=>effectSchemaPage(page,target));});
test('receipt fences target/session/ID and unknown never becomes executed',()=>{assert.equal(commandReceipt(receipt(),target,boot,state.nextCommandId).outcome,'executed');for(const field of ['target','requestBoot','commandId']){const bad=receipt();bad[field]='0000000000000000';assert.throws(()=>commandReceipt(bad,target,boot,state.nextCommandId));}const unknown=receipt('uncertain');unknown.bootSession='8877665544332211';assert.equal(commandReceipt(unknown,target,boot,state.nextCommandId).executed,null);unknown.executed=true;assert.throws(()=>commandReceipt(unknown,target,boot,state.nextCommandId));});
test('scope-bound stale drafts reject before write and fields stay partial',async()=>{let writes=0,payload;const transport={request:async(path,data)=>{if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;writes++;payload=data;return receipt();}};const session=new LampExperienceSession(transport,target);await session.negotiate();const draft=session.draft(state,{brightness:33});await session.patch(draft);assert.equal(writes,1);assert.equal(payload.brightness,33);assert.equal('mode' in payload,false);assert.equal('power' in payload,false);await assert.rejects(session.patch({...draft,expectedRevision:5}),/changed/);assert.equal(writes,1);assert.throws(()=>session.draft(state,{reset:1}));});
test('lost reply pins request, alternate route only reconciles, reboot/expiry remains unknown',async()=>{let writes=0;const transport={request:async(path)=>{if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;writes++;throw Error('Lost reply');}};const session=new LampExperienceSession(transport,target);await session.negotiate();await assert.rejects(session.patch(session.draft(state,{power:0})),e=>e.uncertain);assert.equal(writes,1);await assert.rejects(session.save(4),e=>e.uncertain);assert.equal(writes,1);const paths=[];let result=receipt('uncertain');const alternate={request:async(path)=>{paths.push(path);return path==='/api/descriptor'?descriptor():result;}};assert.equal((await session.reconcile(alternate)).outcome,'uncertain');assert(session.pending);result=receipt();assert.equal((await session.reconcile(alternate)).outcome,'executed');assert.equal(session.pending,null);assert.deepEqual(paths,['/api/descriptor','/api/receipt','/api/descriptor','/api/receipt']);assert.equal(writes,1);});
test('confirmed save failure is durable=false and never retried implicitly',async()=>{let writes=0;const transport={request:async(path)=>{if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;writes++;throw Object.assign(Error(JSON.stringify({...receipt('save-failed'),httpStatus:503})),{confirmed:true});}};const session=new LampExperienceSession(transport,target);await session.negotiate();const result=await session.save(4);assert.equal(result.persisted,false);assert.equal(session.pending,null);assert.equal(writes,1);});
test('quiet policy uses target/session receipts and a distinct persisted policy revision',async()=>{let writes=0,payload;const policy={window:true,startMinute:1320,endMinute:360,timezone:'CST6CDT,M3.2.0/2,M11.1.0/2',deferDuringUse:true,idleSeconds:900};const transport={request:async(path,body)=>{if(path==='/api/descriptor'){const value=descriptor();value.capabilities.updates.push('quiet-policy-v1');return value;}if(path==='/api/revision')return state;if(body.action==='read'){assert.equal(body.target,target);assert.equal(body.bootSession,boot);return {version:1,target,bootSession:boot,policy:{version:1,valid:true,revision:8,...policy}};}writes++;payload=body;throw Error('Lost policy reply');}};const session=new LampExperienceSession(transport,target);await session.negotiate();assert.equal((await session.readUpdatePolicy()).revision,8);await assert.rejects(session.saveUpdatePolicy(policy,8),e=>e.uncertain);assert.equal(writes,1);assert.equal(payload.expectedPolicyRevision,8);assert.equal(payload.expectedRevision,1);assert.equal(payload.window,1);await assert.rejects(session.saveUpdatePolicy(policy,8),e=>e.uncertain);assert.equal(writes,1);assert.equal((await session.reconcile({request:async path=>path==='/api/descriptor'?descriptor():receipt('persisted')})).persisted,true);assert.equal(writes,1);});
test('policy drafts cannot cross reboot or skip a verified policy read',async()=>{let writes=0,reboot=false;const policy={window:false,startMinute:0,endMinute:60,timezone:'UTC0',deferDuringUse:false,idleSeconds:900};const transport={request:async(path,body)=>{if(path==='/api/descriptor'){const value=descriptor();value.capabilities.updates.push('quiet-policy-v1');return value;}if(path==='/api/revision')return {...state,bootSession:reboot?'8877665544332211':boot};if(body.action==='read')return {version:1,target,bootSession:boot,policy:{version:1,valid:true,revision:2,...policy}};writes++;return receipt('persisted');}};const session=new LampExperienceSession(transport,target);await session.negotiate();assert.throws(()=>session.saveUpdatePolicy(policy,2),/Read/);await session.readUpdatePolicy();reboot=true;await assert.rejects(session.saveUpdatePolicy(policy,2),e=>e.conflict);assert.equal(writes,0);});

test('an immediate partial change has exactly one fresh admission read and no full snapshot',async()=>{
 const calls=[];let payload;
 const session=new LampExperienceSession({request:async(path,fields)=>{
  calls.push(path);if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return {...state,mode:7};
  payload=fields;return receipt();
 }},target);
 await session.negotiate();assert.equal((await session.change({brightness:33})).executed,true);
 assert.deepEqual(calls,['/api/descriptor','/api/revision','/api/state/patch']);
 assert.equal(payload.brightness,33);assert.equal(payload.expectedRevision,1);assert.equal(payload.bootSession,boot);
 assert.equal('mode' in payload,false);assert.equal('power' in payload,false);assert.equal(session.pending,null);
});

test('effect-bound immediate tuning rejects a concurrent effect change before submission',async()=>{
 let writes=0;const session=new LampExperienceSession({request:async path=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return {...state,mode:7};writes++;return receipt();
 }},target);
 await session.negotiate();await assert.rejects(session.change({mode:4,intensity:25},{expectedMode:4}),error=>error.conflict&&error.confirmed);
 assert.equal(writes,0);assert.equal(session.pending,null);
 await assert.rejects(session.change({mode:4},{expectedMode:0}),/expected effect/);assert.equal(writes,0);
});

test('a knob or other phone winning compare-and-set yields a confirmed rejection without retry',async()=>{
 let reads=0,writes=0;const session=new LampExperienceSession({request:async(path,fields)=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision'){reads++;return state;}
  writes++;assert.equal(fields.expectedRevision,1);return {...receipt('rejected'),revision:2,httpStatus:409};
 }},target);
 await session.negotiate();assert.equal((await session.change({brightness:22})).outcome,'rejected');
 assert.equal(reads,1);assert.equal(writes,1);assert.equal(session.pending,null);
});

test('a failed admission read never creates an outstanding mutation',async()=>{
 let writes=0;const session=new LampExperienceSession({request:async path=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')throw Object.assign(Error('Read resources unavailable. Nothing changed.'),{status:503,confirmed:true});
  writes++;return receipt();
 }},target);
 await session.negotiate();await assert.rejects(session.change({brightness:22}),/Read resources/);
 assert.equal(writes,0);assert.equal(session.pending,null);
});

test('concurrent callers cannot overwrite or resend the in-flight command',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);let writes=0;
 const session=new LampExperienceSession({request:async path=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;
  writes++;await held;return receipt();
 }},target);
 await session.negotiate();const first=session.change({brightness:22});const second=session.change({mode:46});
 await assert.rejects(second,error=>error.uncertain);assert.equal(writes,1);assert.equal(session.pending.brightness,22);
 release();assert.equal((await first).executed,true);assert.equal(session.pending,null);
});

test('a new explicit change reconciles the exact previous command before using a new ID',async()=>{
 const calls=[],writes=[];let lost=true;
 const session=new LampExperienceSession({request:async(path,fields)=>{
  calls.push(path);
  if(path==='/api/descriptor')return descriptor();
  if(path==='/api/revision')return {...state,revision:lost?1:2,nextCommandId:lost?state.nextCommandId:'0000000000000002'};
  if(path==='/api/receipt'){assert.deepEqual(fields,{target,bootSession:boot,commandId:state.nextCommandId});return receipt();}
  writes.push(fields);if(lost){lost=false;throw Error('Lost reply');}return {...receipt(),commandId:fields.commandId,revision:3};
 }},target);
 await session.negotiate();await assert.rejects(session.change({brightness:30}),error=>error.uncertain);
 assert.equal(session.pending.commandId,state.nextCommandId);assert.equal(writes.length,1);
 assert.equal((await session.change({mode:46})).executed,true);
 assert.deepEqual(calls,['/api/descriptor','/api/revision','/api/state/patch','/api/receipt','/api/revision','/api/state/patch']);
 assert.equal(writes.length,2);assert.equal(writes[0].brightness,30);assert.equal(writes[1].mode,46);
 assert.equal(writes[1].commandId,'0000000000000002');assert.equal('brightness' in writes[1],false);assert.equal(session.pending,null);
});

for(const reason of ['expired','reboot','lost-receipt','wrong-target'])test('unresolved '+reason+' never releases or replays the previous change',async()=>{
 let writes=0,receiptReads=0;const paths=[];
 const session=new LampExperienceSession({request:async(path,fields)=>{
  paths.push(path);if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;
  if(path==='/api/receipt'){
   receiptReads++;assert.equal(fields.commandId,state.nextCommandId);
   if(reason==='lost-receipt')throw Error('Receipt unavailable');
   if(reason==='wrong-target')return {...receipt(),target:'112233445566'};
   return {...receipt('uncertain'),bootSession:reason==='reboot'?'8877665544332211':boot};
  }
  writes++;throw Error('Lost reply');
 }},target);
 await session.negotiate();await assert.rejects(session.change({power:0}),error=>error.uncertain);
 const original=session.pending;await assert.rejects(session.change({mode:46}));
 assert.equal(writes,1);assert.equal(receiptReads,1);assert.equal(session.pending,original);
 assert.equal(paths.at(-1),'/api/receipt');assert.equal(paths.filter(path=>path==='/api/descriptor').length,1);
});

for(const message of [
 'Control resources unavailable. No command executed.',
 'Control resources unavailable. This request was not executed.',
 'Another response is pending. This request was not executed.',
 'HTTP resources unavailable. No command was executed.',
 'Request memory unavailable. No command was executed.'
])test('exact protected preexecution refusal releases only the never-executed submission: '+message,async()=>{
 let writes=0;const session=new LampExperienceSession({request:async path=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;
  writes++;throw Object.assign(Error(message),{status:503,confirmed:true});
 }},target);
 await session.negotiate();await assert.rejects(session.change({brightness:70}),error=>error.preexecution&&error.confirmed&&!error.uncertain);
 assert.equal(writes,1);assert.equal(session.pending,null);
});

for(const failure of [
 {message:'State response memory unavailable. Nothing changed.',status:503,confirmed:true},
 {message:'Lamp rejected settings.',status:503,confirmed:true},
 {message:'Control resources unavailable. No command executed.',status:500,confirmed:true},
 {message:'Control resources unavailable. No command executed.',status:503,confirmed:false},
 {message:'Control resources unavailable. No command executed.',status:503,confirmed:true,uncertain:true},
 {message:'Control resources unavailable. No command executed. ',status:503,confirmed:true}
])test('unproven refusal retains honest uncertainty: '+JSON.stringify(failure),async()=>{
 let writes=0;const session=new LampExperienceSession({request:async path=>{
  if(path==='/api/descriptor')return descriptor();if(path==='/api/revision')return state;
  writes++;const {message,...properties}=failure;throw Object.assign(Error(message),properties);
 }},target);
 await session.negotiate();await assert.rejects(session.change({brightness:70}),error=>error.uncertain);
 assert.equal(writes,1);assert.equal(session.pending.commandId,state.nextCommandId);
});


test('optional group role revision is additive for old clients and validates its bounds',()=>{
 const current=revisionSnapshot({...state,syncRole:0},target);assert.equal(current.syncRole,0);
 assert.equal(revisionSnapshot(state,target).syncRole,undefined);
 for(const fields of [{syncRole:3},{syncRole:-1},{syncRole:null},{syncRole:'0'},{syncRole:true}])
  assert.throws(()=>revisionSnapshot({...state,...fields},target),/group scope revision/);
});
