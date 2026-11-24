import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {runLampPower,legacyPowerWithoutGroups} from '../src/lamp-power.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const id='aabbccddeeff',entry={id,name:'Reading lamp',address:'192.168.1.9',deviceId:'native-id'};

function extract(start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert(first>=0&&last>first,`Could not extract ${start}`);return source.slice(first,last);
}

test('Home power admission keeps its Home and saved-target authorization live for the whole command',async()=>{
 const match=source.match(/ power:async\(target,\{onProgress\}=\{\}\)=>\{[\s\S]*?\n \},\n select:/);
 assert(match);const property=match[0].replace(/,\n select:$/,'');
 let activeHomeId='home-a',scopeCurrent=null,calls=0;
 let lastExpected,lastOptions;
 const context={
  store:{items:[entry]},localStorage:{},readHomeContext:()=>({activeHomeId}),mergedLampEntries:()=>[entry],cardPowerExpected:()=>({power:true,group:{role:0,leader:null}}),
  changeCardPower:async(_entry,expected,options)=>{calls++;lastExpected=expected;lastOptions=options;scopeCurrent=options.isScopeCurrent;return {outcome:'confirmed'};}
 };
 runInNewContext(`const api={${property}};globalThis.power=api.power;`,context);
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'change'})).outcome,'confirmed');assert.equal(calls,1);assert.equal(scopeCurrent(),true);
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'set',power:false})).outcome,'confirmed');assert.equal(calls,2);assert.equal(lastExpected,null);assert.equal(lastOptions.requestedPower,false);
 context.store.items=[];assert.equal(scopeCurrent(),false,'removing the saved target must revoke a queued command');
 context.store.items=[entry];activeHomeId='home-b';assert.equal(scopeCurrent(),false,'switching Home must revoke a queued command');
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'set',power:'off'})).outcome,'failed');
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'toggle'})).outcome,'failed');assert.equal(calls,2,'an unsupported mode must not reach the command lane');
 context.store.items=[];activeHomeId='home-a';assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'change'})).outcome,'failed');assert.equal(calls,2,'a discovered-only target must not reach the command lane');
});

test('a stale group card offers explicit one-tap On and Off without inferring a toggle',()=>{
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.disabled=false;this.textContent='';this.className='';}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name);}
  append(...children){this.children.push(...children);}
 }
 const calls=[],context={
  document:{createElement:tag=>new Element(tag)},cardPowerExpected:()=>null,cardPowerTasks:new Map(),powerLaneBusy:()=>false,
  fleetLampInstalling:()=>false,groupRemovedIds:new Set(),busy:false,connecting:false,selected:null,
  changeCardPower:(target,expected,options)=>calls.push({target,expected,options})
 };
 const controlSource=extract('function groupPowerControl(','\nasync function changeCardPower(');
 runInNewContext(`${controlSource}\nglobalThis.makeGroupPower=groupPowerControl;`,context);
 const group={id,available:true,leader:{id,verified:true,role:1,sync:{membershipLocked:false}}};
 const control=context.makeGroupPower(entry,group,'Reading group'),buttons=control.children.filter(child=>child.tagName==='BUTTON');
 assert.equal(control.getAttribute('role'),'group');assert.equal(control.getAttribute('aria-label'),'Set Reading group group power');
 assert.deepEqual(buttons.map(button=>button.textContent),['On','Off']);assert(buttons.every(button=>button.disabled===false));
 buttons[0].onclick();buttons[1].onclick();assert.equal(calls.length,2);
 assert.deepEqual(calls.map(call=>call.options.requestedPower),[true,false]);
 for(const call of calls){assert.equal(call.target,entry);assert.equal(call.expected.group.role,1);assert.equal(call.expected.group.leader,id);assert.equal(Object.hasOwn(call.expected,'power'),false);}
});
function commandFixture({focusConnection=null}={}){
 const raw={deviceId:id,power:true,mode:1,firmware:{version:'1.9.6',phase:0,wifi:true},sync:{version:2,role:0,leader:null,paused:false,active:false},wifi:{connected:true,rssi:-60},calibration:{active:false}};
 const writes=[],invalidations=[],events=[];let tail=Promise.resolve(),scope=true,releaseCalls=0;
 const lamp={identity:id,epoch:3,base:'http://192.168.1.9',raw,catalog:[{id:1,name:'Rain'}],
  enqueue(action){const result=tail.then(action);tail=result.catch(()=>{});return result;},
  async refresh(){return raw;},
  command(action,value,_response,beforeWrite){return this.enqueue(async()=>{if(this.beforeCommand)await this.beforeCommand();beforeWrite?.();writes.push({action,value});if(this.onWrite)await this.onWrite();raw.power=Boolean(value);});}
 };
 const connectivity={
  observeGroup(){},observeLighting(){},observe(){},
  invalidateGroup(_id,options){invalidations.push({kind:'group',...options});},
  invalidateLighting(_id,options){invalidations.push({kind:'lighting',...options});}
 };
 const body={},groupButton={dataset:{connection:focusConnection},disabled:false,focus(){document.activeElement=this;events.push('focus:'+focusConnection);},closest:selector=>selector==='[data-group-id]'?groupCard:null},
  groupCard={dataset:{groupId:id},querySelectorAll:selector=>selector==='[data-connection]'?[groupButton]:[]},groupList={querySelectorAll:selector=>selector==='[data-group-id]'?[groupCard]:[]};
 const document={activeElement:focusConnection?groupButton:{dataset:{},closest:()=>null},body,addEventListener(){},removeEventListener(){}};let groupRenders=0;
 const context={runLampPower,legacyWithoutGroups:legacyPowerWithoutGroups,connectivity,entry,console,Map,Set,Date,
  acquireGroupLamp:async()=>({lamp,release:async()=>{releaseCalls++;}}),mergedLampEntries:()=>[entry],
  powerLaneBusy:()=>false,fleetLampInstalling:()=>false,renderLamps(){},renderRoomGroups(){if(focusConnection&&++groupRenders===1)document.activeElement=body;},renderGroupScenes(){},status(){},document,
  $:name=>name==='page-groups'?{hidden:!focusConnection}:name==='page-lamps'?{hidden:Boolean(focusConnection)}:name==='groupsList'?groupList:{hidden:true,querySelectorAll:()=>[]}};
 const handler=extract('async function changeCardPower(','\nasync function openSelectedLampGroup(');
 runInNewContext(`let busy=false,connecting=false,selected=null,navigationSerial=1,groupEditor=null;
  const cardPowerTasks=new Map(),cardPowerMessages=new Map(),groupRemovedIds=new Set();
  function cardPowerExpected(){return {power:true,group:{role:0,leader:null}};}
  ${handler}
  globalThis.change=changeCardPower;`,context);
 return {lamp,writes,invalidations,events,releaseCalls:()=>releaseCalls,setScope:value=>scope=value,scope:()=>scope,change:options=>context.change(entry,{power:true,group:{role:0,leader:null}},{...options,isScopeCurrent:()=>scope})};
}

test('group power restores focus to the exact explicit action after its pending rerender',async()=>{
 const f=commandFixture({focusConnection:'power-off'}),result=await f.change({requestedPower:false});
 assert.equal(result.outcome,'confirmed');assert.deepEqual(f.events,['focus:power-off']);
});

test('Home ambiguity starts at the actual write boundary and invalidates even after its presentation scope closes',async()=>{
 const f=commandFixture();let queueReadyAt=0,sendingAt=0;
 f.lamp.beforeCommand=async()=>{await new Promise(resolve=>setTimeout(resolve,12));queueReadyAt=Date.now();};
 f.lamp.onWrite=()=>f.setScope(false);
 const result=await f.change({onProgress:stage=>{if(stage==='sending')sendingAt=Date.now();}});
 assert.equal(result.outcome,'uncertain');assert.equal(f.writes.length,1);assert.equal(f.releaseCalls(),1);assert.equal(f.invalidations.length,2);
 for(const value of f.invalidations){assert(Number.isFinite(value.attemptedAt));assert(value.attemptedAt>=queueReadyAt);assert(value.attemptedAt>=sendingAt);}
});
