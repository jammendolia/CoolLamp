import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMeshRecoveryCandidates} from '../src/settings-recovery.js';

test('fresh observed gateway survives a large stale Wi-Fi inventory and reserves saved Bluetooth',()=>{
 const stale=Array.from({length:20},(_,id)=>({kind:'wifi',id}));
 const observed={kind:'wifi',id:21,observation:{hops:1}},bluetooth={kind:'bluetooth',id:22};
 assert.deepEqual(selectMeshRecoveryCandidates([...stale,observed,bluetooth]),[observed,bluetooth]);
});

test('a live authorized gateway stays ahead of advertised routes',()=>{
 const observed={kind:'wifi',observation:{hops:1}},active={transport:{}},bluetooth={kind:'bluetooth'};
 assert.deepEqual(selectMeshRecoveryCandidates([observed,bluetooth,active]),[active,bluetooth]);
});

test('a single available observed route is never duplicated',()=>{
 const observed={kind:'bluetooth',observation:{hops:1}};
 assert.deepEqual(selectMeshRecoveryCandidates([observed]),[observed]);
});
