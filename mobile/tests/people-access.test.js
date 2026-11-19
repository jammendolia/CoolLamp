import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePeopleAccess,PEOPLE_ACCESS_STATES} from '../src/people-access.js';

const ids={
 home:'10000000000000000000000000000001',joe:'30000000000000000000000000000001',lisa:'30000000000000000000000000000002',sam:'30000000000000000000000000000003',
 joePhone:'50000000000000000000000000000001',lisaPhone:'50000000000000000000000000000002',lisaPad:'50000000000000000000000000000003',invite:'80000000000000000000000000000001'
};
const home=()=>({id:ids.home,name:'Primary home'});
const scope=(kind='home',targetNames=[])=>({kind,targetNames});
const phone=(id,name,status='active')=>({id,name,status});
const person=({id=ids.joe,name='Joe',role='owner',status='active',expiresAt=null,accessScope=scope(),phones=[phone(ids.joePhone,"Joe's iPhone")]}={})=>({id,name,role,status,expiresAt,scope:accessScope,phones});
const base=(overrides={})=>({version:1,state:'ready',home:home(),viewer:{personId:ids.joe,installationId:ids.joePhone,canManagePeople:true},people:[person()],invitations:[],pendingTargets:[],activity:null,...overrides});
const invite=(overrides={})=>({id:ids.invite,recipientName:'Lisa',role:'member',state:'issued',expiresAt:'2026-11-26T15:00:30.000Z',accessExpiresAt:null,scope:scope(),...overrides});

test('compiler exposes the exact bounded page-state vocabulary',()=>{
 assert.deepEqual(PEOPLE_ACCESS_STATES,['checking','not-configured','unavailable','ready','revoked','failed','uncertain','recovery-required','owner-help-required']);
 assert(Object.isFrozen(PEOPLE_ACCESS_STATES));
});

test('names remain inert data for the renderer to escape and outputs are detached and frozen',()=>{
 const malicious='<img src=x onerror=steal()>',source=base({home:{...home(),name:malicious},people:[person({name:'<script>bad()</script>',phones:[phone(ids.joePhone,'<b>phone</b>')]})]});
 const view=compilePeopleAccess(source);
 assert.equal(view.home.name,malicious);assert.equal(view.people[0].name,'<script>bad()</script>');assert.equal(view.people[0].phones[0].name,'<b>phone</b>');
 assert.doesNotMatch(JSON.stringify(view),/&lt;|&gt;/);assert(Object.isFrozen(view));assert(Object.isFrozen(view.people[0].phones));
 source.home.name='Changed';source.people[0].phones[0].name='Changed';assert.equal(view.home.name,malicious);assert.equal(view.people[0].phones[0].name,'<b>phone</b>');
});

test('roles have concise plain-language summaries and owner access cannot be removed',()=>{
 const people=[
  person(),
  person({id:ids.lisa,name:'Lisa',role:'admin',phones:[phone(ids.lisaPhone,"Lisa's iPhone")]}),
  person({id:ids.sam,name:'Sam',role:'member',phones:[]}),
  person({id:'30000000000000000000000000000004',name:'Taylor',role:'guest',expiresAt:'2026-11-23T12:00:00.000Z',accessScope:scope('targets',['Edison']),phones:[]})
 ],view=compilePeopleAccess(base({people}));
 assert.deepEqual(view.people.map(row=>row.roleLabel),['Owner','Administrator','Member','Guest']);
 assert.match(view.people[0].summary,/Manages this Home/);assert.equal(view.people[0].removeAction,null);
 assert.match(view.people[1].summary,/except its owner/);assert.equal(view.people[1].removeAction.label,"Remove Lisa's access");
 assert.match(view.people[2].summary,/control lights, Scenes, and schedules/);assert.match(view.people[3].summary,/Edison until/);
});

test('one-phone removal remains distinct from whole-person removal',()=>{
 const lisa=person({id:ids.lisa,name:'Lisa',role:'member',phones:[phone(ids.lisaPhone,"Lisa's iPhone"),phone(ids.lisaPad,"Lisa's iPad")]}),view=compilePeopleAccess(base({people:[person(),lisa]})),row=view.people[1];
 assert.equal(row.removeAction.label,"Remove Lisa's access");assert.equal(row.phones[0].action.label,'Remove this phone');assert.equal(row.phones[1].action.label,'Remove this phone');
 assert.equal(row.phones[0].action.installationId,ids.lisaPhone);assert.equal(row.removeAction.personId,ids.lisa);
 assert.notEqual(row.phones[0].action.id,row.removeAction.id);
});

test('invitations describe role and lifecycle without claiming the phone is ready',()=>{
 const issued=compilePeopleAccess(base({invitations:[invite()]})).invitations[0];
 assert.equal(issued.status,'Invitation sent');assert.match(issued.detail,/Member access to Primary home/);assert.equal(issued.action.label,'Cancel invitation');
 const accepting=compilePeopleAccess(base({invitations:[invite({state:'accepting'})]})).invitations[0];assert.equal(accepting.status,'Joining Primary home…');assert.equal(accepting.action.label,'Check progress');
 const expired=compilePeopleAccess(base({invitations:[invite({state:'expired'})]})).invitations[0];assert.equal(expired.status,'Expired');assert.equal(expired.action.label,'Invite again');
 assert.throws(()=>compilePeopleAccess(base({invitations:[invite({role:'owner'})]})),/cannot transfer Home ownership/);
});

test('temporary Guest invitations require named targets and an access expiry',()=>{
 const guest=invite({role:'guest',scope:scope('targets',['Edison','Window display']),accessExpiresAt:'2026-12-01T00:00:00.000Z'}),row=compilePeopleAccess(base({invitations:[guest]})).invitations[0];
 assert.deepEqual(row.scope.targetNames,['Edison','Window display']);assert.equal(row.roleLabel,'Guest');
 assert.throws(()=>compilePeopleAccess(base({invitations:[{...guest,accessExpiresAt:null}]})),/temporary and name their lights/);
});

test('confirmed partial propagation names every unfinished product and offers safe follow-up',()=>{
 const activity={kind:'revoke-membership',phase:'confirmed',personName:'Lisa',phoneName:null,targets:[
  {id:'a10000000001',name:'Reading lamp',outcome:'applied'},
  {id:'a10000000002',name:'Edison',outcome:'unavailable'},
  {id:'a10000000003',name:'Window display',outcome:'uncertain'}
 ]},view=compilePeopleAccess(base({activity}));
 assert.equal(view.notice.title,"Lisa's access was removed.");assert.match(view.notice.detail,/2 lights still need/);assert.equal(view.notice.action.label,'Check again');
 assert.deepEqual(view.notice.followUps.map(row=>row.name),['Edison','Window display']);assert.match(view.notice.followUps[0].message,/Keep it powered on/);assert.match(view.notice.followUps[1].message,/before trying the change again/);
});

test('checking, unavailable, not-configured and revoked states remain visible and actionable',()=>{
 const checking=compilePeopleAccess(base({state:'checking'}));assert.equal(checking.notice.busy,true);assert.match(checking.notice.title,/Checking people and access/);
 const unavailable=compilePeopleAccess(base({state:'unavailable'}));assert.equal(unavailable.notice.action.label,'Try again');assert.match(unavailable.notice.detail,/powered on/);
 const notConfigured=compilePeopleAccess(base({state:'not-configured',home:{id:null,name:'Primary home'},viewer:null,people:[]}));assert.equal(notConfigured.notice.action,null);assert.match(notConfigured.notice.detail,/nothing to manage/);assert.equal(notConfigured.canInvite,false);
 const revoked=compilePeopleAccess(base({state:'revoked',viewer:null,people:[],invitations:[]}));assert.match(revoked.notice.title,/no longer has access to Primary home/);assert.equal(revoked.notice.action.label,'Ask an owner for access');
 assert.throws(()=>compilePeopleAccess(base({state:'revoked',viewer:null,invitations:[]})),/cannot retain people/);
});

test('stale access stays readable but disables changes and names unfinished lights',()=>{
 const stale=compilePeopleAccess(base({state:'unavailable',invitations:[invite()],pendingTargets:[{id:'a10000000002',name:'Edison',outcome:'unavailable'}],people:[person(),person({id:ids.lisa,name:'Lisa',role:'member',phones:[phone(ids.lisaPhone,"Lisa's iPhone")]})]}));
 assert.equal(stale.invitations.length,1);assert.equal(stale.people[1].removeAction,null);assert.equal(stale.people[1].phones[0].action,null);
 assert.deepEqual(stale.notice.followUps.map(row=>row.name),['Edison']);assert.match(stale.notice.followUps[0].message,/Keep it powered on/);
});

test('phone identity recovery gives the actual next step instead of a retry',()=>{
 const view=compilePeopleAccess(base({state:'recovery-required',home:{id:null,name:'Primary home'},viewer:null,people:[],invitations:[],pendingTargets:[]}));
 assert.equal(view.notice.action,null);assert.match(view.notice.title,/needs to be added again/);assert.match(view.notice.detail,/reinstall CoolLamp/);
});

test('unverified phones cannot retain Home names and owner help is not presented as retryable',()=>{
 assert.throws(()=>compilePeopleAccess(base({state:'unavailable',home:{id:null,name:'Primary home'},viewer:null,people:[],invitations:[],pendingTargets:[{id:'a10000000002',name:'Private bedroom lamp',outcome:'unavailable'}]})),/cannot retain Home details/);
 const view=compilePeopleAccess(base({state:'owner-help-required',home:{id:null,name:'Primary home'},viewer:null,people:[],invitations:[],pendingTargets:[]}));
 assert.equal(view.notice.action,null);assert.match(view.notice.detail,/Home owner/);
});

test('failed and uncertain changes say what is safe and never imply an automatic replay',()=>{
 const change={kind:'revoke-installation',phase:'failed',personName:'Lisa',phoneName:"Lisa's iPhone",targets:[]};
 const failed=compilePeopleAccess(base({state:'failed',activity:change}));assert.equal(failed.notice.title,"Lisa's iPhone still has access.");assert.equal(failed.notice.action.label,'Try again');
 const uncertain=compilePeopleAccess(base({state:'uncertain',activity:{...change,phase:'uncertain'}}));assert.match(uncertain.notice.title,/may have been removed/);assert.equal(uncertain.notice.action.label,'Check again');assert.doesNotMatch(uncertain.notice.detail,/retry|resend|again automatically/i);
 assert.throws(()=>compilePeopleAccess(base({state:'uncertain',activity:{...change,phase:'failed'}})),/does not match/);
});

test('strict boundary rejects unknown fields, oversized arrays, invalid IDs and unauthorized invitation visibility',()=>{
 assert.throws(()=>compilePeopleAccess({...base(),password:'secret'}),/unsupported field/);
 assert.throws(()=>compilePeopleAccess(base({people:Array.from({length:65},()=>person())})),/bounded list/);
 assert.throws(()=>compilePeopleAccess(base({home:{id:'local-home',name:'Home'}})),/Home ID is invalid/);
 assert.throws(()=>compilePeopleAccess(base({state:'ready',home:{id:null,name:'Home'}})),/requires a Home ID/);
 assert.throws(()=>compilePeopleAccess(base({viewer:{personId:ids.joe,installationId:ids.joePhone,canManagePeople:false},invitations:[invite()]})),/people-management access/);
});

test('recipient copy does not expose implementation terminology',()=>{
 const view=compilePeopleAccess(base({invitations:[invite()],activity:{kind:'accept-invitation',phase:'confirmed',personName:'Lisa',phoneName:null,targets:[{id:'a10000000002',name:'Edison',outcome:'pending'}]}}));
 const copy=[];const visit=value=>{if(typeof value==='string')copy.push(value);else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')for(const [key,entry]of Object.entries(value))if(!/(?:^|I)d$|personId|installationId|deviceId|state|kind|role|scope|expiresAt|accessExpiresAt/.test(key))visit(entry);};visit(view);
 assert.doesNotMatch(copy.join(' '),/\b(?:transport|authority|authorization|grant|receipt|revision|route|credential|binding|endpoint|protocol|cloud|remote session)\b/i);
});
