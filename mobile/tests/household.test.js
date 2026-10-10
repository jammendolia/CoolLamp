import test from 'node:test';
import assert from 'node:assert/strict';
import {HouseholdVault,HouseholdClient,householdAdoptionProof,householdCommandProof,householdResponseProof,validateHouseholdGrant} from '../src/household.js';
const grant={version:1,deviceId:'050403020102',targetMac:'020102030405',phone:'0102030405060708',secret:'000102030405060708090a0b0c0d0e0f',epoch:7,bootSession:'0102030405060708',requestId:'1112131415161718',expiresAtUptimeMs:121000};
const challenge={version:1,deviceId:grant.deviceId,targetMac:grant.targetMac,phone:grant.phone,epoch:7,bootSession:grant.bootSession,nonce:'101112131415161718191a1b1c1d1e1f'};
const authorization={sequence:9,requestId:grant.requestId,endpoint:42,method:2};
const exchange={receiveAuthenticatedInvitation:async()=>({authenticated:true,confidential:true,grant})};
function storage(){const map=new Map();return {map,credential:async(id,value)=>{if(value!==undefined)map.set(id,value);return {value:map.get(id)||''};}};}
async function fixture(){
 const saved=storage(),vault=new HouseholdVault({credential:saved.credential,isNative:true});await vault.importAuthenticated(exchange);const calls=[];let mutationCount=0;
 const http={async request(options){const fields=Object.fromEntries(new URLSearchParams(options.data));calls.push({...fields,url:options.url});
  if(options.url.endsWith('/challenge'))return {status:200,data:JSON.stringify(fields.action==='adopt'?{outcome:'persisted'}:challenge)};
  const auth={sequence:Number(fields.sequence),requestId:fields.requestId,endpoint:Number(fields.endpoint),method:Number(fields.method)};
  assert.equal(fields.proof,await householdCommandProof(grant,challenge,auth,fields.body));if(auth.method===2)mutationCount++;
  const data=JSON.stringify({deviceId:grant.deviceId,power:true}),proof=await householdResponseProof(grant,challenge,auth,200,data);
  return {status:200,data:JSON.stringify({version:1,deviceId:grant.deviceId,phone:grant.phone,epoch:grant.epoch,bootSession:grant.bootSession,sequence:auth.sequence,requestId:auth.requestId,status:200,bodyEncoding:'base64',body:btoa(data),proof})};
 }};
 const client=new HouseholdClient({http,vault,deviceId:grant.deviceId,phone:grant.phone,address:'http://192.168.1.9',nextRequest:()=>grant.requestId});
 return {saved,vault,http,client,calls,mutationCount:()=>mutationCount};
}
test('WebCrypto framing matches production C++ verified-mbedTLS adoption, command and response vectors',async()=>{
 assert.equal(await householdCommandProof(grant,challenge,authorization,'power=1&brightness=99'),'0c18e7558e6aadaa8c438f367597acbf4072777972f6072258dd397b3ed34b50');
 assert.equal(await householdAdoptionProof(grant,challenge),'930cf2f7460afd53df3f1543261e60cb5ec7e2ed1be6214b85de0e75e4beb49a');
 assert.equal(await householdResponseProof(grant,challenge,authorization,200,'{"deviceId":"050403020102","power":true}'),'c5ccc071ebf444a45becf9ce9900e5a2e496e3e270314a80fd84e4bf1436a6b8');
});
test('household vault requires native storage and authenticated confidential sharing; preserves unknown target errors',async()=>{
 assert.throws(()=>new HouseholdVault({credential:storage().credential}),/native/);
 const saved=storage(),vault=new HouseholdVault({credential:saved.credential,isNative:true});
 await assert.rejects(vault.importAuthenticated({receiveAuthenticatedInvitation:async()=>({authenticated:false,confidential:true,grant})}));assert.equal(saved.map.size,0);
 assert.throws(()=>validateHouseholdGrant({...grant,deviceId:'aaaaaaaaaaaa'}));assert.throws(()=>validateHouseholdGrant({...grant,secret:'0'.repeat(32)}));
 await vault.importAuthenticated(exchange);assert.deepEqual(await vault.removeFromPhone(grant.deviceId,grant.phone),{removedFromPhone:true,revoked:false});assert.equal(await vault.load(grant.deviceId,grant.phone),null);
});
test('a second phone adopts once and confirms authority only through fresh authenticated target state',async()=>{
 const f=await fixture(),result=await f.client.adopt();assert.equal(result.adopted,true);assert.equal(result.verified,true);assert.equal(result.deviceId,grant.deviceId);
 assert.equal(f.calls.filter(call=>call.action==='adopt').length,1);assert.equal(f.calls.filter(call=>call.endpoint==='1').length,1);assert.equal(f.mutationCount(),0);
 assert(!f.calls.some(call=>call.body?.includes(grant.secret)));assert(f.calls.every(call=>!Object.hasOwn(call,'Authorization')));
});
test('unsigned 200, forged result/tag, wrong session/identity/sequence, oversized or malformed base64 never confirm',async()=>{
 for(const patch of [{proof:'f'.repeat(64)},{deviceId:'aaaaaaaaaaaa'},{bootSession:'ffffffffffffffff'},{sequence:99},{body:'%%%='},{body:'A'.repeat(10928)},{proof:undefined}]){
  const f=await fixture(),request=f.http.request.bind(f.http);f.http.request=async options=>{const value=await request(options);if(options.url.endsWith('/control'))value.data=JSON.stringify({...JSON.parse(value.data),...patch});return value;};
  await assert.rejects(f.client.control(42,2,'power=1'),error=>error.uncertain===true);assert.equal(f.mutationCount(),1);
 }
});
test('lost mutation reply is never retransmitted; explicit read obtains fresh signed state',async()=>{
 const f=await fixture(),request=f.http.request.bind(f.http);let lose=true;
 f.http.request=async options=>{const reply=await request(options);if(options.url.endsWith('/control')&&lose){lose=false;throw Error('lost execution reply');}return reply;};
 await assert.rejects(f.client.control(42,2,'power=1'),error=>error.uncertain===true);assert.equal(f.mutationCount(),1);assert.equal((await f.client.control(1,1)).verified,true);assert.equal(f.mutationCount(),1);
});
test('native reserved counter blocks survive app restart and independent per-lamp command serialization',async()=>{
 const saved=storage(),a=new HouseholdVault({credential:saved.credential,isNative:true});await a.importAuthenticated(exchange);
 assert.deepEqual(await Promise.all([a.nextSequence(grant.deviceId,grant.phone,grant.bootSession),a.nextSequence(grant.deviceId,grant.phone,grant.bootSession)]),[1,2]);
 const b=new HouseholdVault({credential:saved.credential,isNative:true});assert.equal(await b.nextSequence(grant.deviceId,grant.phone,grant.bootSession),65);
 await b.importAuthenticated(exchange);assert.equal(await b.nextSequence(grant.deviceId,grant.phone,grant.bootSession),129);
 assert.equal(await b.nextSequence(grant.deviceId,grant.phone,'ffffffffffffffff'),1);
});
test('native storage failure prevents submission and request/body bounds reject before a control write',async()=>{
 const f=await fixture();f.vault.credential=async()=>{throw Error('vault locked');};await assert.rejects(f.client.control(42,2,'power=1'));assert(!f.calls.some(call=>call.url.endsWith('/control')));
 const g=await fixture();await assert.rejects(g.client.control(42,2,'é'.repeat(513)));assert(!g.calls.some(call=>call.url.endsWith('/control')));
});
