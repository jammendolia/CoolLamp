import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGroupCode,createGroupCode,groupStatus} from '../src/sync.js';
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
