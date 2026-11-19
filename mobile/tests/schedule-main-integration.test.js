import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {COORDINATOR_MODEL} from '../src/bridge-accessory.js';
import {selectScheduleCoordinator,initialAutomationState,checkingAutomationState,failedAutomationState} from '../src/schedule-service.js';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=main.indexOf("let automationSelectionKey=''");
const end=main.indexOf('\nappV2=mountAppV2({',start);
const source=main.slice(start,end)+'\nglobalThis.scheduleApi={automationModel,refreshAutomationStatus,cancelAutomationRefresh};';
const accessory={id:'aabbccddeeff',modelId:COORDINATOR_MODEL,address:'192.168.1.45',fleetId:'0123456789abcdef'};
const snapshot=Object.freeze({version:1,state:'ready',lastUpdatedAt:123,schedules:Object.freeze([Object.freeze({id:'coolstrip-sunset-midnight',name:'Window display',state:'on',enabled:true,manualHold:false,nextEvent:Object.freeze({action:'turn-off',when:Object.freeze({kind:'midnight'})})})])});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let turn=0;turn<8;turn++)await Promise.resolve();};

function fixture(){
 const reads=[],observations=[],gates=[],homeContext={activeHomeId:'home',homes:[{id:'home',name:'Home'}]};let context;
 class Client{
  constructor(options){this.options=options;}
  read({signal}){const gate=deferred();gates.push(gate);reads.push({signal});return gate.promise;}
 }
 context={AbortController,LegacyCoolStripScheduleClient:Client,selectScheduleCoordinator,initialAutomationState,checkingAutomationState,failedAutomationState,
  bridgeAccessories:{items:[accessory]},readHomeContext:()=>homeContext,localStorage:{},CapacitorHttp:{request(){}},credential:async()=>({value:'password'}),appV2:null};
 runInNewContext(source,context);context.appV2={refresh(){observations.push({state:context.scheduleApi.automationModel().state,reads:reads.length});}};
 return {api:context.scheduleApi,reads,observations,gates,homeContext};
}

test('main publishes checking before the first network read and coalesces duplicate taps',async()=>{
 const f=fixture();assert.equal(f.api.automationModel().state,'idle');
 const first=f.api.refreshAutomationStatus();assert.deepEqual(f.observations[0],{state:'checking',reads:0});assert.equal(f.reads.length,1);
 void f.api.refreshAutomationStatus();assert.equal(f.reads.length,1);
 f.gates[0].resolve(snapshot);await first;assert.equal(f.api.automationModel().state,'ready');assert.equal(f.api.automationModel().schedules[0].name,'Window display');
});

test('navigation cancellation and Home changes fence late schedule replies',async()=>{
 const f=fixture(),pending=f.api.refreshAutomationStatus();assert.equal(f.api.automationModel().state,'checking');f.api.cancelAutomationRefresh();assert.equal(f.reads[0].signal.aborted,true);assert.equal(f.api.automationModel().state,'idle');
 f.gates[0].resolve(snapshot);await pending;assert.equal(f.api.automationModel().state,'idle');
 const second=f.api.refreshAutomationStatus();f.homeContext.homes.push({id:'lake',name:'Lake'});assert.equal(f.api.automationModel().reasonCode,'schedule-home-assignment-needed');f.gates[1].resolve(snapshot);await second;assert.equal(f.api.automationModel().state,'attention');assert.equal(f.api.automationModel().schedules.length,0);
});

test('a failed refresh keeps the last sanitized schedule and exposes no raw error',async()=>{
 const f=fixture(),first=f.api.refreshAutomationStatus();f.gates[0].resolve(snapshot);await first;
 const second=f.api.refreshAutomationStatus();f.gates[1].reject(Object.assign(Error('password at 192.168.1.45'),{scheduleError:true,code:'unreachable'}));await second;await settle();
 const value=f.api.automationModel();assert.equal(value.state,'unreachable');assert.equal(value.schedules[0].name,'Window display');assert.doesNotMatch(JSON.stringify(value),/password|192\.168/);
});
