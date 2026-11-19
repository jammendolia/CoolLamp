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
 const context={
  store:{items:[entry]},localStorage:{},readHomeContext:()=>({activeHomeId}),mergedLampEntries:()=>[entry],cardPowerExpected:()=>({power:true,group:{role:0,leader:null}}),
  changeCardPower:async(_entry,_expected,options)=>{calls++;scopeCurrent=options.isScopeCurrent;return {outcome:'confirmed'};}
 };
 runInNewContext(`const api={${property}};globalThis.power=api.power;`,context);
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'change'})).outcome,'confirmed');assert.equal(calls,1);assert.equal(scopeCurrent(),true);
 context.store.items=[];assert.equal(scopeCurrent(),false,'removing the saved target must revoke a queued command');
 context.store.items=[entry];activeHomeId='home-b';assert.equal(scopeCurrent(),false,'switching Home must revoke a queued command');
 assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'toggle'})).outcome,'failed');assert.equal(calls,1,'an unsupported mode must not reach the command lane');
 context.store.items=[];activeHomeId='home-a';assert.equal((await context.power({homeId:'home-a',deviceId:id,mode:'change'})).outcome,'failed');assert.equal(calls,1,'a discovered-only target must not reach the command lane');
});

function commandFixture(){
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
 const activeElement={dataset:{},closest:()=>null};
 const context={runLampPower,legacyWithoutGroups:legacyPowerWithoutGroups,connectivity,entry,console,Map,Set,Date,
  acquireGroupLamp:async()=>({lamp,release:async()=>{releaseCalls++;}}),mergedLampEntries:()=>[entry],
  powerLaneBusy:()=>false,fleetLampInstalling:()=>false,renderLamps(){},renderRoomGroups(){},renderGroupScenes(){},status(){},
  document:{activeElement,body:{},addEventListener(){},removeEventListener(){}},$:()=>({hidden:true,querySelectorAll:()=>[]})};
 const handler=extract('async function changeCardPower(','\nasync function openSelectedLampGroup(');
 runInNewContext(`let busy=false,connecting=false,selected=null,navigationSerial=1,groupEditor=null;
  const cardPowerTasks=new Map(),cardPowerMessages=new Map(),groupRemovedIds=new Set();
  function cardPowerExpected(){return {power:true,group:{role:0,leader:null}};}
  ${handler}
  globalThis.change=changeCardPower;`,context);
 return {lamp,writes,invalidations,events,releaseCalls:()=>releaseCalls,setScope:value=>scope=value,scope:()=>scope,change:options=>context.change(entry,{power:true,group:{role:0,leader:null}},{...options,isScopeCurrent:()=>scope})};
}

test('Home ambiguity starts at the actual write boundary and invalidates even after its presentation scope closes',async()=>{
 const f=commandFixture();let queueReadyAt=0,sendingAt=0;
 f.lamp.beforeCommand=async()=>{await new Promise(resolve=>setTimeout(resolve,12));queueReadyAt=Date.now();};
 f.lamp.onWrite=()=>f.setScope(false);
 const result=await f.change({onProgress:stage=>{if(stage==='sending')sendingAt=Date.now();}});
 assert.equal(result.outcome,'uncertain');assert.equal(f.writes.length,1);assert.equal(f.releaseCalls(),1);assert.equal(f.invalidations.length,2);
 for(const value of f.invalidations){assert(Number.isFinite(value.attemptedAt));assert(value.attemptedAt>=queueReadyAt);assert(value.attemptedAt>=sendingAt);}
});
