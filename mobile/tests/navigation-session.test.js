import test from 'node:test';
import assert from 'node:assert/strict';
import {NAVIGATION_SESSION_KEY,defaultNavigationSession,readNavigationSession,writeNavigationSession,rememberNavigation,resumableLampTask} from '../src/navigation-session.js';

function storage(initial=null){
 const values=new Map(initial===null?[]:[[NAVIGATION_SESSION_KEY,initial]]);
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),value:()=>values.get(NAVIGATION_SESSION_KEY)};
}

test('navigation session keeps only bounded non-sensitive task coordinates',()=>{
 const saved=storage(JSON.stringify({version:1,route:'settings',settingsSection:'network',targetId:'AABBCCDDEEFF',returnRoute:'app-settings',scroll:{settings:318,unknown:99},password:'do-not-read'}));
 assert.deepEqual(readNavigationSession(saved),{version:1,route:'settings',settingsSection:'network',targetId:'aabbccddeeff',returnRoute:'app-settings',scroll:{settings:318}});
});

test('invalid or oversized navigation state falls back to Home',()=>{
 for(const value of ['{bad',JSON.stringify({version:9,route:'settings'}),'x'.repeat(4097)])assert.deepEqual(readNavigationSession(storage(value)),defaultNavigationSession());
});

test('route changes retain per-route scroll but clear a lamp target outside its workspace',()=>{
 let value=rememberNavigation(defaultNavigationSession(),{route:'settings',settingsSection:'design',targetId:'aabbccddeeff',returnRoute:'app-settings'});
 value=rememberNavigation(value,{scrollRoute:'settings',scrollY:452,route:'help'});
 assert.equal(value.scroll.settings,452);assert.equal(value.route,'help');assert.equal(value.targetId,null);
 assert.equal(writeNavigationSession(storage(),value),true);
});

test('only a saved inventory lamp can resume a settings task',()=>{
 const value=rememberNavigation(defaultNavigationSession(),{route:'settings',settingsSection:'hardware',targetId:'aabbccddeeff',returnRoute:'app-settings',scrollRoute:'settings',scrollY:720});
 assert.deepEqual(resumableLampTask(value,[{id:'aabbccddeeff'}]),{id:'aabbccddeeff',section:'hardware',returnRoute:'app-settings',scrollY:720});
 assert.equal(resumableLampTask(value,[{id:'112233445566'}]),null);
});
