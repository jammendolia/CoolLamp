import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validateLegacyCoolStripScheduleStatus,legacyCoolStripScheduleSnapshot,selectScheduleCoordinator,
 initialAutomationState,checkingAutomationState,failedAutomationState,LegacyCoolStripScheduleClient
} from '../src/schedule-service.js';
import {COORDINATOR_MODEL} from '../src/bridge-accessory.js';
import {sharedLocalRequestOwner} from '../src/bridge-management.js';

const id='aabbccddeeff',fleetId='0123456789abcdef',token='0'.repeat(31)+'1';
const accessory=Object.freeze({id,modelId:COORDINATOR_MODEL,address:'192.168.1.45',fleetId});
const valid=Object.freeze({automatic:true,locationConfigured:true,timeValid:true,sunsetValid:true,inWindow:false,manualOverride:false,storageFault:false,sunset:'17:33',timezone:'America/Chicago',checks:42});
const text=value=>JSON.stringify(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const flush=async()=>{for(let turn=0;turn<8;turn++)await Promise.resolve();};

function fixture({status=valid,identity={},timeout=100,finalUrl,password='correct horse',gatePath=null}={}){
 const calls=[],gate=gatePath?deferred():null,http={request:async options=>{
  calls.push(options);const path=new URL(options.url).pathname;if(path===gatePath)await gate.promise;
  const data=path==='/api/bridge/status'?{role:'bridge',deviceId:id,fleetId,meshEnabled:true,token,...identity}:status;
  return {status:200,url:finalUrl||options.url,data:text(data)};
 }};
 const client=new LegacyCoolStripScheduleClient({http,accessory,getPassword:async()=>password,timeout});
 return {client,http,calls,gate};
}

test('legacy CoolStrip status is exact, bounded, detached and deeply frozen',()=>{
 const source=text(valid),value=validateLegacyCoolStripScheduleStatus(source);
 assert.deepEqual(value,valid);assert(Object.isFrozen(value));assert.equal(source,text(valid));
 for(const invalid of [
  valid,{...valid,token:'secret'},{...valid,sunset:'5:33 PM'},{...valid,timezone:'UTC'},{...valid,checks:-1},{...valid,automatic:1}
 ])assert.throws(()=>validateLegacyCoolStripScheduleStatus(invalid===valid?invalid:text(invalid)),error=>error.code==='invalid-response');
 assert.throws(()=>validateLegacyCoolStripScheduleStatus('x'.repeat(2049)),error=>error.code==='invalid-response');
});

test('semantic projection never claims physical output or a last run',()=>{
 const snapshot=legacyCoolStripScheduleSnapshot(text(valid),{checkedAt:1234}),schedule=snapshot.schedules[0];
 assert.equal(snapshot.state,'ready');assert.equal(snapshot.lastUpdatedAt,1234);assert.deepEqual(schedule.nextEvent,{action:'turn-on',when:{kind:'clock',value:'17:33'}});assert.equal(schedule.state,'on');
 assert(Object.isFrozen(snapshot));assert(Object.isFrozen(schedule));assert.equal(schedule.lastRun,undefined);assert.doesNotMatch(JSON.stringify(snapshot),/completed|power|address|token/i);
 const changed=legacyCoolStripScheduleSnapshot(text({...valid,inWindow:true,manualOverride:true}));assert.equal(changed.schedules[0].state,'changed');assert.deepEqual(changed.schedules[0].nextEvent,{action:'turn-off',when:{kind:'midnight'}});
 const paused=legacyCoolStripScheduleSnapshot(text({...valid,automatic:false}));assert.equal(paused.schedules[0].state,'paused');
 const attention=legacyCoolStripScheduleSnapshot(text({...valid,locationConfigured:false,sunsetValid:false,sunset:'--:--'}));assert.equal(attention.schedules[0].reasonCode,'home-location-needed');
});

test('provider selection fails closed unless one verified coordinator belongs to the sole Home',()=>{
 const homeContext={activeHomeId:'home',homes:[{id:'home',name:'Home'}]};
 assert.equal(selectScheduleCoordinator({homeContext,accessories:[accessory]}).state,'ready');
 assert.equal(selectScheduleCoordinator({homeContext,accessories:[{...accessory,fleetId:undefined}]}).reasonCode,'schedule-household-proof-needed');
 assert.equal(selectScheduleCoordinator({homeContext,accessories:[]}).state,'not-configured');
 assert.equal(selectScheduleCoordinator({homeContext,accessories:[accessory,{...accessory,id:'112233445566'}]}).reasonCode,'schedule-provider-choice-needed');
 assert.equal(selectScheduleCoordinator({homeContext:{...homeContext,homes:[...homeContext.homes,{id:'lake'}]},accessories:[accessory]}).reasonCode,'schedule-home-assignment-needed');
 assert.equal(selectScheduleCoordinator({homeContext,accessories:[{...accessory,modelId:'unknown'}]}).state,'not-configured');
});

test('automation request states preserve only a prior sanitized schedule',()=>{
 const selection=selectScheduleCoordinator({homeContext:{activeHomeId:'home',homes:[{id:'home'}]},accessories:[accessory]}),initial=initialAutomationState(selection);
 assert.equal(initial.state,'idle');const previous=legacyCoolStripScheduleSnapshot(text(valid),{checkedAt:10}),checking=checkingAutomationState(previous,{attemptedAt:20});
 assert.equal(checking.state,'checking');assert.equal(checking.lastUpdatedAt,10);assert.equal(checking.schedules[0].id,'coolstrip-sunset-midnight');
 const failed=failedAutomationState(previous,Object.assign(Error(),{scheduleError:true,code:'access-needed'}),{attemptedAt:30});assert.equal(failed.state,'attention');assert.equal(failed.schedules[0].name,'Window display');
 assert.doesNotMatch(JSON.stringify(failed),/password|192\.168/);
});

test('client confirms identity then reads schedule using GET-only bounded requests',async()=>{
 const f=fixture(),snapshot=await f.client.read();
 assert.equal(snapshot.schedules[0].name,'Window display');assert.deepEqual(f.calls.map(call=>new URL(call.url).pathname),['/api/bridge/status','/api/coordinator/schedule']);
 assert(f.calls.every(call=>call.method==='GET'&&call.disableRedirects===true&&call.responseType==='text'&&!Object.hasOwn(call,'data')));
 assert(f.calls.every(call=>/^Basic /.test(call.headers.Authorization)&&!Object.hasOwn(call.headers,'X-Lamp-Token')));
 assert.doesNotMatch(JSON.stringify(snapshot),/192\.168|correct horse|token|fleet/i);
});

test('identity, fleet, access and origin failures stop before schedule acceptance',async()=>{
 assert.throws(()=>new LegacyCoolStripScheduleClient({http:{request(){}},accessory:{...accessory,fleetId:undefined},getPassword:async()=>'correct horse'}),error=>error.code==='route-invalid');
 for(const options of [
  {identity:{deviceId:'112233445566'}},{identity:{fleetId:'fedcba9876543210'}},{password:''},{finalUrl:'http://192.168.1.46/api/bridge/status'}
 ]){
  const f=fixture(options);await assert.rejects(f.client.read(),error=>error.scheduleError===true);assert(f.calls.length<=1);
 }
});

test('cancellation prevents the second request and a late native reply is discarded',async()=>{
 const f=fixture({gatePath:'/api/bridge/status'}),controller=new AbortController(),result=f.client.read({signal:controller.signal});await flush();assert.equal(f.calls.length,1);controller.abort();
 await assert.rejects(result,error=>error.cancelled===true);assert.equal(f.calls.length,1);assert(f.client.nativeFlight);
 f.gate.resolve();await flush();assert.equal(f.client.nativeFlight,null);assert.equal(f.calls.length,1);
});

test('timeout retains shared native ownership until the underlying request settles',async()=>{
 const f=fixture({gatePath:'/api/bridge/status',timeout:25});await assert.rejects(f.client.read(),error=>error.timeout===true);assert(f.client.nativeFlight);assert.equal(f.calls.length,1);
 const second=new LegacyCoolStripScheduleClient({http:f.http,accessory,getPassword:async()=>'correct horse',timeout:25});await assert.rejects(second.read(),error=>error.code==='busy');assert.equal(f.calls.length,1);
 f.gate.resolve();await flush();assert.equal(sharedLocalRequestOwner(f.http).flight,null);
});

test('schedule and bridge readers use the same native request owner',()=>{
 const f=fixture();assert.equal(f.client.nativeOwner,sharedLocalRequestOwner(f.http));
});
