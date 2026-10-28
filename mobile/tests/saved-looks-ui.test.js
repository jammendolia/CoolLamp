import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSavedLooks} from '../src/saved-looks-ui.js';

class Element {
 constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.value='';this.disabled=false;this.open=false;this.ownText='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];this.ownText='';}
 set textContent(value){this.ownText=String(value);this.children=[];}
 get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('');}
 set innerHTML(_){throw Error('Untrusted markup must not be rendered.');}
 setAttribute(name,value){this.attributes[name]=String(value);}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(callbacks={}){
 const document={createElement(tag){return new Element(tag,document);}},root=new Element('section',document);root.id='savedLooks';
 const ui=mountSavedLooks(root,callbacks);
 const nodes=()=>{const all=[];const walk=node=>{all.push(node);node.children.forEach(walk);};walk(root);return all;};
 const find=predicate=>nodes().find(predicate),button=kind=>find(node=>node.dataset.lookAction===kind);
 const model={lampId:'aabbccddeeff',lampName:'Desk lamp',looks:[{id:'one',name:'Cozy Plasma',effect:{name:'Plasma'},appearance:{brightness:120}}],saveAllowed:true,applyAllowed:true,busy:false};
 ui.render(model);return {root,ui,model,nodes,find,button,input:find(node=>node.tagName==='input')};
}
test('names are plain text, fields are labelled, and cards show the effect and brightness',()=>{
 const f=fixture();f.ui.render({...f.model,looks:[{...f.model.looks[0],name:'<img onerror="bad">'}]});
 assert(f.root.textContent.includes('<img onerror="bad">'));assert(f.root.textContent.includes('Plasma · 47% brightness'));
 assert.equal(f.find(n=>n.tagName==='label').htmlFor,f.input.id);assert.equal(f.find(n=>n.attributes.role==='status').attributes['aria-live'],'polite');
 assert.equal(f.find(n=>n.tagName==='details').open,false);assert.equal(f.button('apply').attributes['aria-label'],'Use <img onerror="bad">');
});
test('save is disabled until a name is entered and prevents double clicks immediately',async()=>{
 let count=0,payload;const pending=deferred(),f=fixture({onSave:(...args)=>{++count;payload=args;return pending.promise;}});
 assert(f.button('save').disabled);f.input.value=' Cozy ';f.input.oninput();assert(!f.button('save').disabled);
 const run=f.button('save').onclick();await f.button('save').onclick();assert.equal(count,1);assert.deepEqual(payload,['Cozy',{lampId:f.model.lampId}]);
 assert.equal(f.root.attributes['aria-busy'],'true');assert(f.button('apply').disabled);pending.resolve();await run;
 assert.equal(f.input.value,'');assert.equal(f.root.attributes['aria-busy'],'false');assert(f.root.textContent.includes('saved on this phone'));
});
test('storage failure keeps the name and existing cards and does not announce success',async()=>{
 const f=fixture({onSave:()=>{throw Error('Phone storage is full.');}});f.input.value='Cozy';f.input.oninput();await f.button('save').onclick();
 assert.equal(f.input.value,'Cozy');assert(f.root.textContent.includes('Phone storage is full.'));assert(f.root.textContent.includes('Cozy Plasma'));assert(!f.root.textContent.includes('Look saved on this phone.'));
});
test('removal failure retains the saved card without claiming it was removed',async()=>{
 const f=fixture({onRemove:()=>{throw Error('Cannot save this removal.');}});await f.button('remove').onclick();assert(f.root.textContent.includes('Cozy Plasma'));assert(f.root.textContent.includes('Cannot save this removal.'));assert(!f.root.textContent.includes('Saved look removed from this phone.'));
});
test('Use look announces execution only for a confirmed result and locks every action while running',async()=>{
 const pending=deferred();let calls=0;const f=fixture({onApply:()=>{++calls;return pending.promise;}}),run=f.button('apply').onclick();
 assert(f.button('save').disabled);assert(f.button('remove').disabled);await f.button('apply').onclick();assert.equal(calls,1);
 pending.resolve({outcome:'executed',message:'Look applied. Startup stays unchanged.'});await run;assert(f.root.textContent.includes('Look applied. Startup stays unchanged.'));
});
test('unconfirmed results do not appear as a successful application',async()=>{
 const f=fixture({onApply:()=>{throw Error('The lamp has not confirmed this look.');}});await f.button('apply').onclick();assert(f.root.textContent.includes('not confirmed'));assert(!f.root.textContent.includes('Look applied.'));
});
test('scope changes discard old completion messages and detached handlers',async()=>{
 const pending=deferred();let calls=0;const f=fixture({onSave:()=>pending.promise,onApply:()=>++calls});
 const oldApply=f.button('apply').onclick;f.input.value='Old name';f.input.oninput();const run=f.button('save').onclick();
 f.ui.render({...f.model,lampId:'001122334455',lampName:'Other lamp'});await oldApply();assert.equal(calls,0);pending.resolve({message:'Old success'});await run;
 assert(!f.root.textContent.includes('Old success'));assert.equal(f.input.value,'');assert(f.root.textContent.includes('Other lamp'));
});
test('unsupported/disconnected states explain why actions are disabled; corrupt storage never looks empty',()=>{
 const f=fixture();f.ui.render({...f.model,saveAllowed:false,applyAllowed:false,reason:'Connect to this lamp first.'});assert(f.button('save').disabled);assert(f.button('apply').disabled);assert(f.root.textContent.includes('Connect to this lamp first.'));
 f.ui.render({...f.model,looks:[],saveAllowed:false,applyAllowed:false,error:'Stored looks could not be read.'});assert(f.root.textContent.includes('Stored looks could not be read.'));assert(!f.root.textContent.includes('No saved looks'));
});
