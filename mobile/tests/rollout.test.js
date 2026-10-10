import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRolloutStatus,rolloutRequest,rolloutEndpoint} from '../src/rollout.js';
const base={version:1,storageReady:true,distributedAutomaticService:false,requiresPhoneOrCoordinatorOrchestration:true,coordinatorLast:true,ticket:'0000000000000001',lease:'0000000000000002',phase:2,members:32,armedMask:0xffffffff,completedMask:0,releasedMask:0,target:'112233445566',receiverTicket:'0000000000000000',receiverLease:'0000000000000000',receiverPhase:0,permitLifetimeMs:300000,uncertainLease:true};
test('32-member rollout status preserves unsigned masks and honest orchestrator-only service',()=>{
  const result=parseRolloutStatus(JSON.stringify(base));assert.equal(result.armedMask,0xffffffff);assert.equal(result.phaseName,'reserved');assert.equal(result.automaticDistribution,false);assert.equal(result.uncertainLease,true);
  for(const bad of [{version:2},{distributedAutomaticService:true},{members:33},{armedMask:-1},{members:20,armedMask:0xffffffff},{uncertainLease:false},{phase:9},{lease:'0000000000000000'},{target:'wrong'}])assert.throws(()=>parseRolloutStatus({...base,...bad}));
});
test('rollout request builders pin exact fields, proof sizes, sessions and command bounds',()=>{
  assert.equal(rolloutEndpoint,'/api/firmware/rollout');
  assert.deepEqual(rolloutRequest('reserve',{ticket:base.ticket,target:base.target,targetBoot:base.lease,command:0xffffffff}),{action:'reserve',ticket:base.ticket,target:base.target,targetBoot:base.lease,command:0xffffffff});
  for(const [action,bytes] of [['arm',116],['arm-reconcile',92],['accept',144],['reconcile',144],['finish',116]]){
    assert.equal(rolloutRequest(action,{proof:'a'.repeat(bytes*2)}).proof.length,bytes*2);assert.throws(()=>rolloutRequest(action,{proof:'a'.repeat(bytes*2-1)}));
  }
  for(const command of [0,-1,0x100000000,1.5,'1'])assert.throws(()=>rolloutRequest('start',{manifest:'signed bytes',command}));
  assert.throws(()=>rolloutRequest('start',{manifest:'a'.repeat(513),command:1}));assert.throws(()=>rolloutRequest('start',{manifest:'&'.repeat(512),command:1}));
  assert.throws(()=>rolloutRequest('accept',{proof:'A'.repeat(288)}));assert.throws(()=>rolloutRequest('clear',{}));assert.throws(()=>rolloutRequest('reserve',{ticket:base.ticket,target:base.target,targetBoot:'0000000000000000',command:1}));
  assert.throws(()=>rolloutRequest('health',{success:true}));assert.deepEqual(rolloutRequest('health'),{action:'health'});
});
test('explicit recovery requests forward same-lease proofs and require bounded new commands',()=>{
  assert.deepEqual(rolloutRequest('renew-proof'),{action:'renew-proof'});
  const proof='b'.repeat(288);assert.deepEqual(rolloutRequest('renew',{proof,command:7}),{action:'renew',proof,command:7});
  assert.equal(rolloutRequest('renew-accept',{proof:'c'.repeat(296)}).proof.length,296);
  for(const fields of [{proof},{proof,command:0},{proof,command:1,target:base.target},{proof:'b'.repeat(286),command:1}])assert.throws(()=>rolloutRequest('renew',fields));
  assert.throws(()=>rolloutRequest('renew-proof',{abort:true}));assert.throws(()=>rolloutRequest('renew-accept',{proof:'c'.repeat(288)}));
  assert.equal(parseRolloutStatus({...base,receiverPhase:7}).receiverPhaseName,'renew-ready');
});
