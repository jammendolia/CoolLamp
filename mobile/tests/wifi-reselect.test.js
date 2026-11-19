import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
 WIFI_RESELECT_JOURNAL_KEY,WifiReselectJournal,parseWifiReselect,wifiReselectPresentation,wifiReselectRelation
} from '../src/wifi-reselect.js';

const id='aabbccddeeff',other='112233445566';
const boot='0123456789abcdef',otherBoot='1111111111111111';
const operation='2222222222222222',next='3333333333333333',unrelated='4444444444444444';
const ap1='a1a2a3a4a5a6',ap2='b1b2b3b4b5b6';
const activePhases=new Set(['accepted','looking','reconnecting','checking']);
const radio=(overrides={})=>({available:true,rssi:-76,channel:11,accessPoint:ap1,...overrides});

test('the production startup task check is safe with no selected lamp or connection task',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),start=source.indexOf('function activeWifiReselectTask('),end=source.indexOf('function clearWifiReselectTimer(',start),context={selected:null,wifiReselectTask:null};
 runInNewContext(source.slice(start,end)+'\nthis.activeWifiReselectTask=activeWifiReselectTask;',context);assert.equal(context.activeWifiReselectTask(),false);
 context.selected={id};context.wifiReselectTask={id,working:true};assert.equal(context.activeWifiReselectTask(),true);context.wifiReselectTask=null;assert.equal(context.activeWifiReselectTask(),false);
});

function status(phase='idle',overrides={}){
 const result=overrides.result??(phase==='complete'?'already-best':'none'),error=overrides.error??(phase==='failed'?'reconnect-timed-out':'none');
 const changed=overrides.accessPointChanged??result==='improved';
 return {version:1,deviceId:id,bootSession:boot,operationId:phase==='idle'?null:operation,nextOperationId:next,
  phase,result,error,active:activePhases.has(phase),connected:true,credentialsChanged:false,address:'192.168.1.42',
  acceptedAt:phase==='idle'?0:100,startedAt:phase==='idle'?0:120,updatedAt:phase==='idle'?0:140,minimumGain:10,currentObserved:true,accessPointChanged:changed,
  current:radio(changed?{rssi:-58,channel:6,accessPoint:ap2}:{}),before:radio(),candidate:radio({rssi:-54,channel:6,accessPoint:ap2}),after:radio(changed?{rssi:-58,channel:6,accessPoint:ap2}:{}),...overrides};
}

const record=(overrides={})=>({version:1,homeId:'home-a',deviceId:id,bootSession:boot,operationId:operation,issuedAt:1700000000000,...overrides});

class MemoryStorage{
 constructor({dropWrite=false,corruptWrite=false,keepOnRemove=false}={}){this.values=new Map();this.calls=[];Object.assign(this,{dropWrite,corruptWrite,keepOnRemove});}
 getItem(key){this.calls.push(['get',key]);return this.values.has(key)?this.values.get(key):null;}
 setItem(key,value){this.calls.push(['set',key,value]);if(!this.dropWrite)this.values.set(key,this.corruptWrite?'{broken':String(value));}
 removeItem(key){this.calls.push(['remove',key]);if(!this.keepOnRemove)this.values.delete(key);}
}

test('status parser strictly binds device, boot session, operation reservation and radio evidence',()=>{
 const parsed=parseWifiReselect(JSON.stringify(status('accepted')),id);
 assert.equal(parsed.deviceId,id);assert.equal(parsed.bootSession,boot);assert.equal(parsed.operationId,operation);assert.equal(parsed.nextOperationId,next);
 assert(Object.isFrozen(parsed));assert(Object.isFrozen(parsed.current));
 const invalid=[
  status('accepted',{deviceId:other}),status('accepted',{bootSession:'0000000000000000'}),status('accepted',{bootSession:'0123456789ABCDEF'}),
  status('accepted',{operationId:'0000000000000000'}),status('accepted',{operationId:'ABCDEF0123456789'}),status('accepted',{nextOperationId:'xyz'}),status('accepted',{operationId:next}),
  status('idle',{operationId:operation}),status('accepted',{operationId:null}),status('accepted',{phase:'scanning'}),
  status('accepted',{credentialsChanged:true}),status('accepted',{address:'192.168.1.256'}),status('accepted',{minimumGain:9}),
  status('accepted',{currentObserved:1}),status('accepted',{current:radio({available:'yes'})}),status('accepted',{current:radio({rssi:-128})}),
  status('accepted',{current:radio({channel:15})}),status('accepted',{current:radio({accessPoint:'not-an-ap'})})
 ];
 for(const value of invalid)assert.throws(()=>parseWifiReselect(value,id),/Invalid lamp connection status/);
 assert.throws(()=>parseWifiReselect('{',id),/Invalid lamp connection status/);
 assert.throws(()=>parseWifiReselect(status('accepted'),other),/Invalid lamp connection status/);
});

test('compact lamp status expands into the same strict app model',()=>{
 const wire={v:1,d:id,b:boot,o:operation,n:next,p:2,r:0,e:0,c:1,x:0,ip:'192.168.1.42',t:[100,120,140],co:1,
  q:[[1,-76,11,ap1],[1,-76,11,ap1],[1,-54,6,ap2],[0,0,0,'000000000000']]};
 const parsed=parseWifiReselect(JSON.stringify(wire),id);
 assert.equal(parsed.phase,'looking');assert.equal(parsed.active,true);assert.equal(parsed.credentialsChanged,false);
 assert.deepEqual(parsed.current,radio());assert.equal(parsed.candidate.accessPoint,ap2);assert.equal(parsed.accessPointChanged,false);
 for(const invalid of [{...wire,p:7},{...wire,c:true},{...wire,x:1},{...wire,t:[1,2]},{...wire,q:wire.q.slice(1)},
  {...wire,q:[[2,-76,11,ap1],...wire.q.slice(1)]}])assert.throws(()=>parseWifiReselect(invalid,id),/Invalid lamp connection status/);
});

test('phase, result and error combinations fail closed while uint32 millis rollover remains valid',()=>{
 const rollover=parseWifiReselect(status('looking',{acceptedAt:0xfffffff0,startedAt:7,updatedAt:2}),id);
 assert.equal(rollover.acceptedAt,0xfffffff0);assert.equal(rollover.startedAt,7);assert.equal(rollover.updatedAt,2);
 const invalid=[
  status('looking',{active:false}),status('idle',{active:true}),status('looking',{result:'improved'}),status('looking',{result:'better'}),status('looking',{error:'unknown'}),status('complete',{result:'none'}),
  status('complete',{result:'already-best',error:'scan-failed'}),status('failed',{error:'none'}),status('failed',{result:'still-weak'}),
  status('complete',{result:'improved',accessPointChanged:false}),
  status('complete',{result:'improved',before:radio({available:false}),accessPointChanged:true}),
  status('complete',{result:'improved',after:radio(),accessPointChanged:true}),
  status('looking',{acceptedAt:-1}),status('looking',{startedAt:0x100000000}),status('looking',{updatedAt:1.5})
 ];
 for(const value of invalid)assert.throws(()=>parseWifiReselect(value,id),/Invalid lamp connection status/);
});

test('presentation covers unsupported, idle, every visible phase, every result and failure recovery',()=>{
 assert.deepEqual(wifiReselectPresentation(null),{supported:false,visible:false,working:false,message:'',action:'Improve connection'});
 let view=wifiReselectPresentation(parseWifiReselect(status('idle',{current:radio({rssi:-60})}),id));assert.equal(view.visible,false);assert.equal(view.working,false);
 view=wifiReselectPresentation(parseWifiReselect(status('idle'),id));assert.equal(view.visible,true);assert.match(view.message,/signal is weak/);
 for(const phase of ['accepted','looking']){view=wifiReselectPresentation(parseWifiReselect(status(phase),id));assert.equal(view.working,true);assert.equal(view.message,'Looking for a better connection…');}
 view=wifiReselectPresentation(parseWifiReselect(status('reconnecting'),id));assert.equal(view.working,true);assert.equal(view.message,'Reconnecting…');
 view=wifiReselectPresentation(parseWifiReselect(status('checking'),id));assert.equal(view.working,true);assert.equal(view.message,'Checking the new connection…');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'improved'}),id));assert.equal(view.working,false);assert.equal(view.message,'Connection improved.');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'improved',connected:false,current:radio({available:false})}),id));assert.match(view.message,/not connected/);assert.equal(view.action,'Check again');assert.equal(view.recovery,'Use Bluetooth');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'improved',current:radio({accessPoint:ap1,rssi:-76})}),id));assert.match(view.message,/changed after/);assert.equal(view.action,'Check again');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'improved',current:radio({accessPoint:ap2,rssi:-75,channel:6})}),id));assert.match(view.message,/changed after/);assert.equal(view.action,'Check again');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'already-best'}),id));assert.match(view.message,/best connection/);assert.match(view.detail,/mesh point/);
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'already-best',current:radio({rssi:-60})}),id));assert.equal(view.detail,'');
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'still-weak'}),id));assert.match(view.message,/improvement wasn’t confirmed/);assert.match(view.detail,/mesh point/);
 view=wifiReselectPresentation(parseWifiReselect(status('complete',{result:'inconclusive'}),id));assert.equal(view.action,'Try again');assert.match(view.detail,/try again/);
 for(const error of ['response-not-released','reconnect-start-failed','reconnect-timed-out']){view=wifiReselectPresentation(parseWifiReselect(status('failed',{error}),id));assert.equal(view.message,'The lamp did not finish reconnecting.');assert.equal(view.action,'Check again');assert.equal(view.recovery,'Use Bluetooth');}
 view=wifiReselectPresentation(parseWifiReselect(status('failed',{error:'security-changed'}),id));assert.match(view.message,/verified safely/);assert.equal(view.action,'Check again');
 view=wifiReselectPresentation(parseWifiReselect(status('failed',{error:'scan-failed'}),id));assert.equal(view.message,'Nearby connections could not be checked.');assert.equal(view.action,'Check again');
});

test('journal persists and reads back the exact record before dispatch can begin',()=>{
 const storage=new MemoryStorage(),journal=new WifiReselectJournal(storage),value=record();let dispatches=0;
 const issue=()=>{const saved=journal.begin(value);dispatches++;return saved;};
 const saved=issue();assert.equal(dispatches,1);assert(Object.isFrozen(saved));assert.deepEqual(saved,value);
 assert.deepEqual(storage.calls.map(call=>call[0]),['get','set','get']);assert.deepEqual(new WifiReselectJournal(storage).read(),value);
 const writes=storage.calls.filter(call=>call[0]==='set').length;journal.begin(value);assert.equal(storage.calls.filter(call=>call[0]==='set').length,writes,'the same pending operation is idempotent');
 for(const options of [{dropWrite:true},{corruptWrite:true}]){
  const failedStorage=new MemoryStorage(options),failedJournal=new WifiReselectJournal(failedStorage);let sent=0;
  assert.throws(()=>{failedJournal.begin(value);sent++;},/saved connection check|could not be saved/i);assert.equal(sent,0);assert.deepEqual(failedStorage.calls.map(call=>call[0]),['get','set','get']);
 }
});

test('journal blocks a different device and clears only the exact persisted operation',()=>{
 const storage=new MemoryStorage(),journal=new WifiReselectJournal(storage),first=record();journal.begin(first);
 assert.throws(()=>journal.begin(record({deviceId:other,operationId:unrelated})),error=>error.pending?.deviceId===id&&/other lamp/.test(error.message));
 assert.equal(storage.calls.filter(call=>call[0]==='set').length,1);assert.deepEqual(journal.read(),first);
 for(const mismatch of [{homeId:'home-b'},{deviceId:other},{bootSession:otherBoot},{operationId:unrelated},{issuedAt:first.issuedAt+1}]){
  assert.equal(journal.clear(record(mismatch)),false);assert.deepEqual(journal.read(),first);
 }
 assert.equal(journal.clear(first),true);assert.equal(journal.read(),null);assert.equal(journal.clear(first),true);
 const sticky=new MemoryStorage({keepOnRemove:true}),stickyJournal=new WifiReselectJournal(sticky);stickyJournal.begin(first);assert.equal(stickyJournal.clear(first),false);assert.deepEqual(stickyJournal.read(),first);
});

test('journal records are strict and storage failures never broaden or erase their scope',()=>{
 assert.throws(()=>new WifiReselectJournal({}),/storage is unavailable/);
 const storage=new MemoryStorage(),journal=new WifiReselectJournal(storage);
 for(const value of [record({homeId:''}),record({homeId:'x'.repeat(129)}),record({deviceId:'bad'}),record({bootSession:'0'.repeat(16)}),record({operationId:null}),record({issuedAt:-1}),record({issuedAt:1.5})])
  assert.throws(()=>journal.begin(value),/saved connection check needs review/);
 storage.values.set(WIFI_RESELECT_JOURNAL_KEY,'{bad');assert.throws(()=>journal.read(),/saved connection check needs review/);
});

test('relation distinguishes active, terminal, reserved-not-started, restarted and unknown operations',()=>{
 const saved=record();
 let relation=wifiReselectRelation(status('looking'),saved);assert.equal(relation.kind,'active');assert.equal(relation.terminal,false);assert.equal(relation.status.phase,'looking');
 for(const value of [status('complete',{result:'improved'}),status('failed',{error:'scan-failed'})]){relation=wifiReselectRelation(value,saved);assert.equal(relation.kind,'terminal');assert.equal(relation.terminal,true);}
 relation=wifiReselectRelation(status('idle',{nextOperationId:operation}),saved);assert.equal(relation.kind,'not-started');assert.equal(relation.terminal,true);
 relation=wifiReselectRelation(status('looking',{bootSession:otherBoot}),saved);assert.equal(relation.kind,'restarted');assert.equal(relation.terminal,true);
 relation=wifiReselectRelation(status('looking',{operationId:unrelated,nextOperationId:next}),saved);assert.equal(relation.kind,'unknown');assert.equal(relation.terminal,false);
 assert.throws(()=>wifiReselectRelation(status('looking'),record({deviceId:other})),/Invalid lamp connection status/);
});
