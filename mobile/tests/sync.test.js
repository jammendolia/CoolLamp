import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGroupCode,createGroupCode,groupStatus,groupMemberLimit,supportsGroupProtocol} from '../src/sync.js';
import {WifiTransport} from '../src/wifi.js';
const id='aabbccddeeff',other='112233445566',key='0123456789abcdef0123456789abcdef';
const code=`CL1-${id}-${key}`;
test('group credentials are strict, case insensitive, and created with secure random bytes',()=>{
 assert.deepEqual(parseGroupCode(' '+code.toUpperCase()+' '),{leader:id,key});
 for(const input of ['',code+'extra',code.slice(1),code.replace('CL1','CL2'),code.replace('aabb','xxbb')])assert.throws(()=>parseGroupCode(input),/complete group code/);
 let called=false;const generated=createGroupCode(id,{getRandomValues:a=>{called=true;return a.fill(171);}});
 assert(called);assert.equal(generated,`CL1-${id}-${'ab'.repeat(16)}`);
 assert.throws(()=>createGroupCode('not-an-id'),/identity/);
});
test('versioned expanded group codes and advertised bounds negotiate without inventing legacy capacity',()=>{
 assert.deepEqual(parseGroupCode(`CL3-${id}-${key}`),{leader:id,key,protocol:3});
 assert.equal(createGroupCode(id,{getRandomValues:bytes=>bytes.fill(171)},3),`CL3-${id}-${'ab'.repeat(16)}`);
 assert.equal(groupMemberLimit({version:2,maxMembers:32}),9);
 assert.equal(groupMemberLimit({version:3,maxMembers:32}),32);
 for(const maxMembers of [0,33,1.5,'32',undefined])assert.equal(groupMemberLimit({version:3,maxMembers}),0);
 assert(supportsGroupProtocol({version:2,protocolVersions:[2,3]},3));
 assert(!supportsGroupProtocol({version:2},3));assert(!supportsGroupProtocol({version:3,protocolVersions:[2,3]},4));
});
test('group status explains local fallback and pause',()=>{
 assert.match(groupStatus({role:2}),/Waiting.*local/);
 assert.match(groupStatus({role:2,paused:true}),/Paused.*local/);
 assert.match(groupStatus({role:2,active:true}),/Following/);
 assert.match(groupStatus({role:1,members:1}),/1 lamp following/);
});
function fixture(){
 const requests=[];let count=38;
 const raw={token:'test-token',deviceId:other,hostname:'coollamp-test.local',mode:1,brightness:100,power:true,catalogVersion:1,sync:{version:1,role:0}};
 const http={request:async request=>{
  requests.push(request);const path=new URL(request.url).pathname;
  if(request.method==='POST')return {status:200,data:'Saved'};
  if(path==='/api/effects')return {status:200,data:Array.from({length:count},(_,i)=>({id:i+1,name:'Effect '+(i+1),category:i>=38?'audio':'calm',speed:true}))};
  return {status:200,data:{...raw,effects:Array.from({length:count},(_,i)=>'Effect '+(i+1))}};
 }};
 return {lamp:new WifiTransport(http),requests,raw,setCount:v=>count=v};
}
test('join/leave use authenticated POST; invalid roles, self join and wrong coordinator never send',async()=>{
 const {lamp,requests}=fixture();await lamp.connect('192.168.1.5','password');
 try{
  const n=requests.length;
  await assert.rejects(lamp.configureSync(3,code),/role/);
  await assert.rejects(lamp.configureSync(1,code),/coordinator/);
  await assert.rejects(lamp.configureSync(2,code.replace(id,other)),/itself/);
  assert.equal(requests.length,n);
  await lamp.configureSync(2,code);
  const post=requests.find(r=>r.method==='POST');
  assert.equal(post.data,`role=2&leader=${id}&key=${key}`);assert.equal(post.headers['X-Lamp-Token'],'test-token');assert(post.headers.Authorization);
  await lamp.configureSync(0);assert.equal(requests.filter(r=>r.method==='POST').at(-1).data,'role=0');
 }finally{await lamp.disconnect();}
});
test('a mic-free follower reloads its audio catalog on join and loss, without reconnecting',async()=>{
 const {lamp,raw,setCount,requests}=fixture();await lamp.connect('192.168.1.5','password');
 try{
  assert.equal(lamp.catalog.length,38);
  setCount(47);Object.assign(raw,{mode:46,sync:{version:1,role:2,active:true}});await lamp.refresh();
  assert.equal(lamp.catalog.length,47);assert.equal(lamp.state.mode,46);
  const before=requests.length;await assert.rejects(lamp.command('color',{mode:46,r:1,g:2,b:3}),/coordinator/);assert.equal(requests.length,before);
  setCount(38);Object.assign(raw,{mode:1,sync:{version:1,role:2,active:false}});await lamp.refresh();
  assert.equal(lamp.catalog.length,38);assert.equal(lamp.state.mode,1);
 }finally{await lamp.disconnect();}
});
test('older firmware rejects group operations locally',async()=>{
 const {lamp,raw,requests}=fixture();delete raw.sync;await lamp.connect('192.168.1.5','password');
 try{const before=requests.length;await assert.rejects(lamp.configureSync(2,code),/Update lamp firmware/);assert.equal(requests.length,before);}finally{await lamp.disconnect();}
});
test('optional incarnation CAS is forwarded by the production HTTP and protected BLE shared method',async()=>{
 const f=fixture();await f.lamp.connect('192.168.1.5','password');const expected='ab'.repeat(16);
 try{
  await f.lamp.configureSync(0,'',expected);assert.equal(f.requests.filter(row=>row.method==='POST').at(-1).data,'role=0&expectedIncarnation='+expected);
  for(const bad of ['aa','AB'.repeat(16),null,4])await assert.rejects(f.lamp.configureSync(0,'',bad),/identity fence/);
  const {LampTransport}=await import('../src/transport.js');const requests=[];
  const protectedLink=Object.create(LampTransport.prototype);Object.assign(protectedLink,{raw:{deviceId:other,sync:{version:3}},request:async(path,body)=>{requests.push({path,body});return 'Saved';},refresh:async()=>{}});
  await protectedLink.configureSync(0,'',expected);assert.deepEqual(requests,[{path:'/api/sync',body:{role:0,expectedIncarnation:expected}}]);
 }finally{await f.lamp.disconnect();}
});

function guardedFixture({active=false,loseReply=false,accept=true,leader=id}={}){
 const model=fixture(),request=model.lamp.http.request;
 model.lamp.http.request=async options=>{
  if(options.method==='POST'&&new URL(options.url).pathname==='/api/sync'){
   model.requests.push(options);
   if(accept)model.raw.sync={version:2,role:2,leader,active,paused:false};
   if(loseReply)throw Error('Simulated lost reply');
   return {status:200,data:'Saved'};
  }
  return request(options);
 };
 return model;
}
const targetSnapshot=lamp=>({id:lamp.identity,address:lamp.base,epoch:lamp.epoch,wireVersion:lamp.raw.sync?.version,leader:id});

test('direct join refreshes the target token, verifies saved membership, and distinguishes waiting from following',async()=>{
 for(const active of [false,true]){
  const {lamp,raw,requests}=guardedFixture({active});await lamp.connect('192.168.1.5','password');
  try{
   const expected=targetSnapshot(lamp);raw.token='fresh-target-token';
   const result=await lamp.joinCoordinator(code,expected);
   const posts=requests.filter(request=>request.method==='POST');
   assert.equal(posts.length,1);assert.equal(posts[0].headers['X-Lamp-Token'],'fresh-target-token');
   assert.equal(result.active,active);assert.equal(result.leader,id);
   assert.equal(lamp.raw.sync.role,2);assert.equal(lamp.identity,other);
  }finally{await lamp.disconnect();}
 }
});

test('uncertain direct join reads back accepted settings once without replay, and never claims unaccepted joins',async()=>{
 for(const accept of [false,true]){
  const {lamp,requests}=guardedFixture({loseReply:true,accept});await lamp.connect('192.168.1.5','password');
  try{
   const operation=lamp.joinCoordinator(code,targetSnapshot(lamp));
   if(accept)assert.equal((await operation).active,false);
   else await assert.rejects(operation,/did not respond/);
   assert.equal(requests.filter(request=>request.method==='POST').length,1);
  }finally{await lamp.disconnect();}
 }
});

test('direct joins reject a changed selection before and after a deferred target refresh',async()=>{
 const {lamp,raw,requests}=guardedFixture();await lamp.connect('192.168.1.5','password');
 const expected=targetSnapshot(lamp);await lamp.disconnect();
 await assert.rejects(lamp.joinCoordinator(code,expected),/Connect|changed/);
 await lamp.connect('192.168.1.5','password');
 const snapshot=targetSnapshot(lamp),original=lamp.http.request;
 let release,ready;const started=new Promise(resolve=>ready=resolve);
 let held=false;
 lamp.http.request=options=>{
  if(!held&&options.method==='GET'&&new URL(options.url).pathname==='/api/state'){
   held=true;
   return new Promise(resolve=>{release=()=>resolve({status:200,data:{...raw,effects:Array.from({length:38},(_,i)=>'Effect '+(i+1))}});ready();});
  }
  return original(options);
 };
 const join=lamp.joinCoordinator(code,snapshot),rejected=assert.rejects(join,/changed/);
 await started;await lamp.disconnect();release();await rejected;
 assert.equal(requests.filter(request=>request.method==='POST').length,0);
});

test('fresh target membership, setup, updater state and invitation leader are guarded before any join POST',async()=>{
 for(const change of [raw=>raw.sync={...raw.sync,role:1},raw=>raw.sync={...raw.sync,role:2},
  raw=>raw.calibration={active:true},raw=>raw.firmware={phase:3},raw=>delete raw.sync]){
  const {lamp,raw,requests}=guardedFixture();await lamp.connect('192.168.1.5','password');
  try{const expected=targetSnapshot(lamp);change(raw);await assert.rejects(lamp.joinCoordinator(code,expected),/group|setup|firmware/);
   assert.equal(requests.filter(request=>request.method==='POST').length,0);
  }finally{await lamp.disconnect();}
 }
 const {lamp,requests}=guardedFixture();await lamp.connect('192.168.1.5','password');
 try{assert.throws(()=>lamp.joinCoordinator(code,{...targetSnapshot(lamp),leader:other}),/invitation/);
  assert.equal(requests.filter(request=>request.method==='POST').length,0);
 }finally{await lamp.disconnect();}
});

test('a target protocol change after invitation discovery rejects the join without a POST',async()=>{
 const {lamp,raw,requests}=guardedFixture();raw.sync.version=2;await lamp.connect('192.168.1.5','password');
 try{
  const expected=targetSnapshot(lamp);raw.sync={version:1,role:0};
  await assert.rejects(lamp.joinCoordinator(code,expected),/protocol changed/);
  assert.equal(requests.filter(request=>request.method==='POST').length,0);
 }finally{await lamp.disconnect();}
});

test('a successful HTTP join reply cannot acknowledge different saved group membership',async()=>{
 const {lamp,requests}=guardedFixture({leader:other});await lamp.connect('192.168.1.5','password');
 try{
  await assert.rejects(lamp.joinCoordinator(code,targetSnapshot(lamp)),/did not confirm/);
  assert.equal(requests.filter(request=>request.method==='POST').length,1);
 }finally{await lamp.disconnect();}
});
