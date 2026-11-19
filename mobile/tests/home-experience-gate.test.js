import test from 'node:test';
import assert from 'node:assert/strict';
import {HOME_EXPERIENCE_ID,homeExperienceEnabled} from '../src/home-experience-gate.js';

test('redesigned Home experience stays off by default',()=>{
  assert.equal(HOME_EXPERIENCE_ID,'home-v1');
  assert.equal(homeExperienceEnabled(),false);
  assert.equal(homeExperienceEnabled({buildValue:'0',search:'?other=value'}),false);
  assert.equal(homeExperienceEnabled({search:'?experience=home-v1'}),false);
});

test('redesigned Home experience can be enabled for an internal build or URL session',()=>{
  assert.equal(homeExperienceEnabled({buildValue:'1'}),true);
  assert.equal(homeExperienceEnabled({buildValue:true}),true);
  assert.equal(homeExperienceEnabled({allowQuery:true,search:'?experience=home-v1'}),true);
  assert.equal(homeExperienceEnabled({allowQuery:true,search:'?other=1&experience=home-v1'}),true);
});

test('only the explicit experience value enables the internal path',()=>{
  assert.equal(homeExperienceEnabled({buildValue:'true'}),false);
  assert.equal(homeExperienceEnabled({allowQuery:true,search:'?experience=home-v2'}),false);
  assert.equal(homeExperienceEnabled({allowQuery:true,search:'%'}),false);
});
