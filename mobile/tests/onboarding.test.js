import test from 'node:test';
import assert from 'node:assert/strict';
import {OnboardingGuide,ownedGuideIds,confirmedGuideTarget,guideHelp} from '../src/onboarding.js';
const first='aabbccddeeff',second='112233445566';
test('fresh guide appears once; existing and legacy inventory never becomes factory-new',()=>{
 const prefs={},guide=new OnboardingGuide(prefs,()=>true,{ownedIds:[],stored:false});assert.equal(guide.welcome(),true);assert.equal(guide.welcome(),false);
 assert.equal(new OnboardingGuide(prefs,()=>true,{ownedIds:[],stored:true}).welcome(),false);
 for(const ids of [[first],['ble:legacy-device'],null])assert.equal(new OnboardingGuide({},()=>true,{ownedIds:ids}).welcome(),false);
});
test('discovery is not ownership and pairing requires exact protected owned target proof',()=>{
 const model={lamps:[{id:first}],ownedLampIds:[],selected:{id:first},connected:true};assert.equal(confirmedGuideTarget(model,{connected:true,id:first}),false);
 model.ownedLampIds=[first];assert.equal(confirmedGuideTarget(model,{connected:true,id:second}),false);assert.equal(confirmedGuideTarget(model,{connected:true}),false);assert.equal(confirmedGuideTarget(model,{connected:true,id:first}),true);
 model.connected=false;assert.equal(confirmedGuideTarget(model,{connected:true,id:first}),false);
 assert.equal(ownedGuideIds({lamps:[{id:first}]}),null);
});
test('partial setup progress is bounded and storage failure never changes the lamp operation',()=>{
 const prefs={rooms:{[first]:'Den'},groups:{[second]:'Evening'},future:{version:9}},guide=new OnboardingGuide(prefs,()=>{throw Error('Quota');},{ownedIds:[]});
 assert.equal(guide.paired(first),false);assert.equal(guide.details(first),false);assert.equal(guide.review(first),false);assert.deepEqual(guide.state.pending,{target:first,stage:'details',needsReview:true});
 assert.equal(guide.complete(first),false);assert.equal(guide.state.firstComplete,true);assert.equal(guide.state.pending,null);assert.deepEqual(prefs.future,{version:9});assert.equal(prefs.rooms[first],'Den');
});
test('future guide records and unknown preference fields survive parsing and manual guides',()=>{
 const future={version:4,pending:{artifact:'future'},extra:'retain'},prefs={onboarding:future,rooms:{},groups:{},unknown:{version:5}},guide=new OnboardingGuide(prefs,()=>{throw Error('Must not write');},{ownedIds:[]});
 assert.equal(guide.welcome(),false);guide.paired(first);guide.setLater(false);assert.equal(prefs.onboarding,future);assert.deepEqual(prefs.unknown,{version:5});
});
test('first verified second lamp offers group guide once without adopting inventory or existing groups',()=>{
 const prefs={},guide=new OnboardingGuide(prefs,()=>true,{ownedIds:[]});guide.paired(first);guide.complete(first);
 const model={ownedLampIds:[first,second],selected:{id:second},connected:false,groups:[]};assert.equal(guide.second(model),false);model.connected=true;assert.equal(guide.second(model),true);
 guide.offeredGroup();assert.equal(guide.second(model),false);
 const old=new OnboardingGuide({},()=>true,{ownedIds:[first],stored:true});assert.equal(old.second(model),true);model.groups=[{id:first}];assert.equal(old.second(model),false);
});
test('invalid or oversized local progress cannot provide ownership or executable controls',()=>{
 const guide=new OnboardingGuide({onboarding:{version:1,pending:{target:'not-a-lamp',stage:'eval'}}},()=>true,{ownedIds:[]});assert.equal(guide.state.pending,null);assert.equal(guide.paired('bad'),false);
 assert.equal(ownedGuideIds({ownedLampIds:Array.from({length:400},(_,i)=>'id-'+i)}).length,256);
 assert.equal(confirmedGuideTarget({selected:{id:first},connected:true,ownedLampIds:[...Array.from({length:400},(_,i)=>'id-'+i),first]},{connected:true,id:first}),true);
});
test('center and optional audio guidance preserve source-backed semantics and privacy',()=>{
 assert.match(guideHelp.center,/ten seconds/);assert.match(guideHelp.center,/does not change the number/);assert.doesNotMatch(guideHelp.center,/disable|automatic.*zero|GPIO/);
 assert.match(guideHelp.audio,/No saved audio recordings/);assert.match(guideHelp.audio,/Internet/);assert.match(guideHelp.audio,/group lamps share sound levels/);assert.match(guideHelp.audio,/not proof/);
});
