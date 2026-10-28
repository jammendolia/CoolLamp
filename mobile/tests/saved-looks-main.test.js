import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {SavedLooksStore,captureSavedLook} from '../src/saved-looks.js';
import {applySavedLook} from '../src/saved-look-apply.js';
import {LampExperienceSession} from '../src/experience-contracts.js';
import {effectSettings} from '../src/effect-settings.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const handlers=extract('function savedLookControlsBusy(', 'appV2=mountAppV2(');
const guards=extract('function app2TargetMatches(', 'async function reconcileApp2Pending(');
const id='aabbccddeeff',other='112233445566',boot='0123456789abcdef';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({storageFailure=false,readGate,readError=false,refreshError=false,lostAt=0,modern=true}={}){
 let stored=null,sequence=0;const calls=[],renders=[],writes=[];
 const storage={getItem:()=>stored,setItem:(_key,value)=>{if(storageFailure)throw Error('full');stored=value;}};
 const store=new SavedLooksStore(storage,{id:()=>`look-${++sequence}`,now:()=>1000+sequence});
 const catalog=[{id:13,name:'Plasma',speed:true}],raw={deviceId:id,mode:13,brightness:120,power:false,token:'fixture',
  colors:Array.from({length:13},()=>[0,255,60,110]),effectOptions:Array.from({length:13},()=>[50,100,0,35,160,255]),sync:{role:0,scene:0}};
 const revision={version:1,target:id,bootSession:boot,revision:1,syncRole:0,syncPaused:false,nextCommandId:'0000000000000001',mode:13,brightness:120,power:false};let command=0;
 const session=new LampExperienceSession({request:async(path,fields)=>{
  calls.push(path);if(path==='/api/revision')return {...revision,nextCommandId:(++command).toString(16).padStart(16,'0')};
  assert.equal(path,'/api/state/patch');assert.equal(fields.expectedRevision,revision.revision);writes.push(fields);++revision.revision;
  if(writes.length===lostAt)throw Error('reply lost');
  return {version:1,target:id,bootSession:boot,requestBoot:boot,commandId:fields.commandId,revision:revision.revision,executionRevision:revision.revision,outcome:'executed',executed:true,persisted:false,httpStatus:200};
 }},id);session.descriptor={capabilities:{control:['command-receipts-v1','group-revision-v1']}};
 const target={identity:id,epoch:1,catalog,raw,
  enqueue:action=>Promise.resolve().then(()=>{calls.push('queue');return action();}),
  async refresh(expected,retry,guard){assert.equal(expected,id);assert.equal(retry,false);calls.push('full-read');guard();if(readGate)await readGate.promise;guard();if(readError)throw Error('Read unavailable.');context.ui.update(raw);return raw;},
  async refreshLight(expected){assert.equal(expected,id);calls.push('light-read');if(refreshError)throw Error('Read unavailable.');}
 };
 const context={SavedLooksStore,captureSavedLook,applySavedLook,effectSettings,savedLooks:store,target,raw,id,other,
  mountSavedLooks:(_root,callbacks)=>{context.callbacks=callbacks;return {render:model=>renders.push(model)};},
  $:()=>({}),updatingLamp:()=>false,
  loadApp2Experience:async()=>{calls.push('negotiate');return {id,target,epoch:target.epoch,token:target.raw.token,supported:modern,session};},
  verifiedSelectedLamp:()=>context.ui?.selected()===id,
  independentLightingAllowed:()=>context.ui?.state().sync.role===0,
  renderOptions:()=>context.ui?.render()};
 runInNewContext(`let selected={id,name:'Desk lamp'},lamp=target,state=raw,busy=false,connecting=false,savedLooksUi=null,savedLookTask=null,app2Experience=null;
 let liveLight={pending:false},editingBrightness=false,editingOptions=false,vuDirty=false,fountainDirty=false,audioDirty=false;
 const app2Pending=new Map(),settingsUnconfirmedIds=new Set();
 ${guards}
 ${handlers}
 globalThis.ui={save:saveCurrentLook,use:useSavedLook,remove:removeSavedLook,render:renderSavedLooks,selected:()=>selected?.id,state:()=>state,
  update(value){state=value;},select(value){selected={id:value,name:'Other lamp'};},scope(){return {lampId:selected.id};},
  pending:()=>app2Pending.get(id),busy:()=>busy,live(value){liveLight.pending=value;},dirty(){editingOptions=true;},
  group(){raw.sync={role:1,scene:0};state={...state,sync:raw.sync};},unconfirmed(){settingsUnconfirmedIds.add(id);},
  oldSupport(){app2Experience={id,target,epoch:target.epoch,token:target.raw.token,supported:true,session:{descriptor:{capabilities:{control:['command-receipts-v1']}}}};}};`,context);
 return {...context.ui,context,store,session,target,raw,calls,writes,renders,contents:()=>stored,
  seed:()=>store.save(captureSavedLook({lampId:id,state:raw,catalog,name:'Cozy Plasma'}))};
}

test('production Save look queues a fresh target read, saves actual appearance, and issues no mutation',async()=>{
 const f=fixture(),result=await f.save('Cozy Plasma',f.scope());assert.match(result.message,/Nothing changed/);
 assert.deepEqual(f.calls,['queue','full-read']);assert.equal(f.writes.length,0);assert.equal(f.store.list(id)[0].appearance.brightness,120);
 assert.deepEqual(f.store.list(id)[0].appearance.color,[0,255,60,110]);assert.equal(f.busy(),false);
});

test('production read-only save failure never stores stale settings or claims a mutation is pending',async()=>{
 const f=fixture({readError:true});await assert.rejects(f.save('Cozy',f.scope()),/Read unavailable/);assert.equal(f.contents(),null);assert.equal(f.pending(),undefined);assert.equal(f.busy(),false);
});

test('switching lamps while saving cancels before phone storage and double saves are blocked',async()=>{
 const gate=deferred(),f=fixture({readGate:gate}),run=f.save('Old',f.scope());await Promise.resolve();
 await assert.rejects(f.save('Again',f.scope()),/current change/);f.select(other);gate.resolve();await assert.rejects(run,/selected lamp changed/);
 assert.equal(f.contents(),null);assert.equal(f.writes.length,0);
});

test('a phone storage failure preserves previous looks and clears working state',async()=>{
 const f=fixture({storageFailure:true});await assert.rejects(f.save('Cozy',f.scope()),/could not be saved/);assert.equal(f.contents(),null);assert.equal(f.busy(),false);assert.equal(f.writes.length,0);
});

for(const block of ['live','dirty','unconfirmed'])test('production save refuses '+block+' controls before any read',async()=>{
 const f=fixture();f[block](true);await assert.rejects(f.save('Cozy',f.scope()),/current change/);assert.equal(f.calls.length,0);
});

test('group appearance can be saved, but Use look never silently alters its whole group',async()=>{
 const f=fixture(),look=f.seed();f.group();await f.save('Group fallback',f.scope());
 await assert.rejects(f.use(look.id,f.scope()),/outside a group/);assert.equal(f.writes.length,0);
});

test('production Use look negotiates and runs real receipt commands without power, startup, or NVS writes',async()=>{
 const f=fixture(),look=f.seed(),result=await f.use(look.id,f.scope());assert.equal(result.outcome,'executed');assert.match(result.message,/Turn the lamp on/);
 assert.equal(f.writes.length,2);assert(f.calls.includes('full-read'));assert.equal(f.calls.at(-1),'light-read');
 for(const value of f.writes)for(const field of ['power','startupMode','startupBrightness','save','ledCount','midpoint','r','g','b'])assert.equal(field in value,false);
 assert.equal(f.pending(),undefined);assert.equal(f.busy(),false);
});

test('a confirmed look remains applied when the later state refresh fails',async()=>{
 const f=fixture({refreshError:true}),look=f.seed(),result=await f.use(look.id,f.scope());assert.equal(result.outcome,'executed');assert.match(result.message,/latest settings could not be refreshed/);assert.equal(f.writes.length,2);assert.equal(f.pending(),undefined);
});

test('unconfirmed look keeps its exact session for Check and prevents another apply',async()=>{
 const f=fixture({lostAt:1}),look=f.seed();await assert.rejects(f.use(look.id,f.scope()),error=>error.uncertain);
 assert.equal(f.pending(),f.session);assert.equal(f.writes.length,1);await assert.rejects(f.use(look.id,f.scope()),/current change/);assert.equal(f.writes.length,1);
});

test('older firmware cannot fall through to a legacy whole-state write',async()=>{
 const f=fixture({modern:false}),look=f.seed();await assert.rejects(f.use(look.id,f.scope()),/Update this lamp/);assert.deepEqual(f.calls,['negotiate']);assert.equal(f.writes.length,0);
});

test('an older negotiated lamp can save a copy but explains why Use look is disabled',()=>{
 const f=fixture();f.seed();f.oldSupport();f.render();const view=f.renders.at(-1);
 assert.equal(view.saveAllowed,true);assert.equal(view.applyAllowed,false);assert.match(view.reason,/Update this lamp’s software/);assert.equal(f.calls.length,0);
});

test('Remove is phone-local, lamp-scoped and needs no connected target',()=>{
 const f=fixture(),look=f.seed();assert.throws(()=>f.remove(look.id,{lampId:other}),/selected lamp changed/);
 const result=f.remove(look.id,f.scope());assert.match(result.message,/lamp was not changed/);assert.equal(f.store.list(id).length,0);assert.equal(f.calls.length,0);
});
