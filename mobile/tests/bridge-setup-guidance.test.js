import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('const meshConfirmPalette='),handler=source.slice(source.indexOf('function meshSetupStatus('),source.indexOf('\nasync function closeMeshWizard('));
const palette=source.slice(start,source.indexOf('\nasync function findHouseholdBridges(',start));
const names=source.slice(source.indexOf('const meshConfirmNames='),source.indexOf('\nfunction meshSetupStatus('));
function fixture(){
 const nodes=new Map(),node=()=>({children:[],hidden:false,textContent:'',style:{},attributes:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(key,value){this.attributes[key]=value;}});
 const context={task:{candidate:{id:'aabbccddeeff'}},document:{createElement:node},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}};
 runInNewContext('let meshWizard=task;'+palette+names+handler+';globalThis.update=meshSetupStatus;',context);return {...context,nodes};
}
test('real setup comparison displays numbered names and explains the bridge PRG and lamp knob separately',()=>{
 const f=fixture();f.update({target:f.task.candidate.id,phase:'confirm',pattern:[4,15,9,14],message:'Compare'});
 assert.match(f.nodes.get('meshSetupStatus').textContent,/bridge.*color names.*PRG once.*lamp.*knob once.*differs.*cancel/);
 assert.deepEqual(f.nodes.get('meshSetupPattern').children.map(item=>item.children[1].textContent),['1. Green','2. White','3. Violet','4. Cool white']);
 assert(f.nodes.get('meshSetupPattern').children.every(item=>item.children[0].attributes['aria-hidden']==='true'));
 assert.equal(f.nodes.get('meshSetupPattern').hidden,false);
});
test('another target cannot replace the active comparison or approve physical possession',()=>{
 const f=fixture();f.update({target:'112233445566',phase:'confirm',pattern:[1,2,3,4],message:'Wrong target'});assert.equal(f.nodes.size,0);
});
test('a non-comparison phase clears its swatches and leaves uncertainty check visible',()=>{
 const f=fixture();f.update({target:f.task.candidate.id,phase:'confirm',pattern:[0,1,2,3],message:'Compare'});
 f.update({target:f.task.candidate.id,phase:'waiting',message:'Checking original setup',uncertain:true});
 assert.equal(f.nodes.get('meshSetupPattern').children.length,0);assert.equal(f.nodes.get('meshSetupPattern').hidden,true);assert.equal(f.nodes.get('meshSetupRecover').hidden,false);
});
