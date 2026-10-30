import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('async function addLampToExistingGroup('),end=source.indexOf('\nfunction groupLampRow(',start);
const body=source.slice(start,end);
const target='aabbccddeeff',leader='112233445566';
function fixture({join=async()=>({phase:'joined'}),close=async()=>{}}={}){
 const calls=[],context={groupActions:new Set(),cardPowerTasks:new Map(),fleetLampInstalling:()=>false,bluetoothFirmwareOwner:()=>null,
  renderRoomGroups:()=>calls.push('render-groups'),renderLamps:()=>calls.push('render-lamps'),groupEditor:{id:leader},
  closeGroupEditor:async()=>{calls.push('close-editor');await close();},roomGroups:{join:async(...args)=>{calls.push(args);return join(...args);}}};
 runInNewContext(body+';this.add=addLampToExistingGroup;',context);return {context,calls,add:context.add};
}
test('the real Add adapter forwards the reviewed incarnation and live cancellation guard to the group operation',async()=>{
 const f=fixture(),isCurrent=()=>true,expectedIncarnation='a'.repeat(32);await f.add(target,leader,{isCurrent,expectedIncarnation});
 const call=f.calls.find(Array.isArray);assert.equal(call[0],target);assert.equal(call[1],leader);assert.equal(call[2].isCurrent,isCurrent);assert.equal(call[2].expectedIncarnation,expectedIncarnation);
 assert(f.calls.indexOf('close-editor')<f.calls.indexOf(call));assert.equal(f.context.groupActions.size,0);
});
test('a closed Add picker or busy lamp cannot start a group mutation',async()=>{
 const f=fixture();await assert.rejects(f.add(target,leader,{isCurrent:()=>false}),error=>error.cancelled&&error.confirmed);assert.equal(f.calls.length,0);
 f.context.cardPowerTasks.set(target,{});await assert.rejects(f.add(target,leader),/current lamp change/);assert.equal(f.calls.length,0);assert.equal(f.context.groupActions.size,0);
});
test('closing while the group editor releases prevents a later join and clears both pending markers',async()=>{
 let current=true;const f=fixture({close:async()=>{current=false;}});
 await assert.rejects(f.add(target,leader,{isCurrent:()=>current}),error=>error.cancelled&&error.confirmed);assert.equal(f.calls.filter(Array.isArray).length,0);assert.equal(f.context.groupActions.size,0);
});
test('an uncertain group write is surfaced once and never retried by the adapter',async()=>{
 const f=fixture({join:async()=>{throw Object.assign(Error('Unconfirmed'),{uncertain:true});}});
 await assert.rejects(f.add(target,leader),error=>error.uncertain);assert.equal(f.calls.filter(Array.isArray).length,1);assert.equal(f.context.groupActions.size,0);
});
