import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {resolveLampStyle} from '../src/lamp-style.js';

// Exercise the mounted UI and its real delegated click handler. The small DOM
// fixture supplies only browser presentation APIs; connection results and time
// are controlled explicitly, without a lamp or a browser process.
const source=readFileSync(new URL('../src/app-v2.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const settle=async()=>{for(let turn=0;turn<12;turn++)await Promise.resolve();};
const lamp={id:'aabbccddeeff',name:'New reading lamp',room:'Bedroom',phoneLampStyle:'helix'};

function fixture(select=async()=>({connected:true})){
 const elements=new Map(),listeners=new Map(),timers=new Map(),messages=[],navigations=[],selections=[];
 let nextTimer=0,now=0,document;
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.attributes={};this.hidden=false;this.open=false;this.disabled=false;this.children=[];this.listeners=new Map();this.textContent='';this.value='';this._html='';}
  set innerHTML(value){
   this._html=value;this.children=[];
   if(this.id==='v2Dialog'){
    elements.delete('v2DialogStatus');
    if(value.includes('id="v2DialogStatus"'))elements.set('v2DialogStatus',new Element('v2DialogStatus'));
    for(const tag of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
     const button=new Element();button._html=tag[2];
     for(const attribute of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)){
      const [,name,attributeValue]=attribute;
      if(name.startsWith('data-'))button.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=attributeValue;
      else button.setAttribute(name,attributeValue);
     }
     button.disabled=/\bdisabled\b/.test(tag[1]);this.children.push(button);
    }
   }
  }
  get innerHTML(){return this._html;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(name,callback){const handlers=this.listeners.get(name)||[];handlers.push(callback);this.listeners.set(name,handlers);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  replaceChildren(){this._html='';this.children=[];if(this.id==='v2Dialog')elements.delete('v2DialogStatus');}
  querySelector(selector){
   if(selector==='small'){
    if(!this._html.includes('<small>'))return null;
    if(!this.small){this.small=new Element();this.small.textContent=this._html.match(/<small>(.*?)<\/small>/)?.[1]||'';}return this.small;
   }
   return this.children[0]||null;
  }
  querySelectorAll(selector){return this.children.filter(child=>selector==='button'||selector==='[data-v2]'||selector.includes(`data-v2="${child.dataset.v2}"`));}
  closest(){return this;}
  contains(value){return this===value||this.children.includes(value);}
  focus(){document.activeElement=this;}
  scrollIntoView(){}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
 document={hidden:false,activeElement:null,documentElement:element('root'),body:element('body'),
  getElementById(id){return id==='v2DialogStatus'?elements.get(id)||null:element(id);},
  querySelector:()=>element('settings-navigation'),querySelectorAll:()=>[],createElement:()=>new Element(),
  addEventListener(name,callback){const handlers=listeners.get(name)||[];handlers.push(callback);listeners.set(name,handlers);}};
 const context={document,AbortController,DOMException,lampArtworkSvg,resolveLampStyle,
  localStorage:{getItem:()=>null,setItem(){}},
  setInterval:()=>++nextTimer,clearInterval(){},
  setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 const api={model:()=>({lamps:[lamp],groups:[],statuses:{},connected:false,connecting:false}),
  message:message=>messages.push(message),navigate:(...args)=>navigations.push(args),
  select(id,section,options){selections.push({id,section,options});return select(id,section,options);}};
 runInNewContext(source+'\nglobalThis.mount=mountAppV2;',context);
 const ui=context.mount(api),dialog=element('v2Dialog');
 return {ui,dialog,messages,navigations,selections,
  status:()=>elements.get('v2DialogStatus')?.textContent||'',
  click(action,dataset={}){const button=dialog.children.find(candidate=>candidate.dataset.v2===action&&Object.entries(dataset).every(([name,value])=>candidate.dataset[name]===value))||new Element();button.dataset={v2:action,...dataset};for(const callback of listeners.get('click')||[])callback({target:button});},
  cancel(){let prevented=false;const event={preventDefault(){prevented=true;}};for(const callback of dialog.listeners.get('cancel')||[])callback(event);if(!prevented)dialog.close();return prevented;},
  advance(milliseconds){now+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}},
  dispose(){ui.destroy();}
 };
}

function choose(ui,section='design'){
 ui.ui.chooseLight(section);ui.click('select-settings',{id:lamp.id,section});
}

for(const result of [undefined,{connected:false}])test(`an unsuccessful lamp selection (${result?'disconnected':'missing result'}) gives a visible retry message`,async()=>{
 const ui=fixture(async()=>result);choose(ui);await settle();
 assert.equal(ui.dialog.open,true);assert.match(ui.status(),/connect|reach|try|again/i);assert.equal(ui.navigations.length,0);
 assert.notEqual(ui.dialog.getAttribute('aria-busy'),'true');ui.dispose();
});

test('a rejected selection displays the failure and does not navigate',async()=>{
 const ui=fixture(async()=>{throw Error('The lamp is out of reach. Try again.');});choose(ui);await settle();
 assert.match(ui.status(),/out of reach/);assert.equal(ui.dialog.open,true);assert.equal(ui.navigations.length,0);ui.dispose();
});

test('a pending selection immediately shows progress and Close cancels it',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);
 assert.match(ui.status(),/connect|find|check|opening|prepare/i);assert.equal(ui.dialog.getAttribute('aria-busy'),'true');
 await settle();
 assert.ok(ui.selections[0].options.signal);assert.equal(ui.selections[0].options.isCurrent(),true);
 ui.click('close');assert.equal(ui.dialog.open,false);assert.equal(ui.selections[0].options.signal.aborted,true);assert.equal(ui.selections[0].options.isCurrent(),false);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,0);ui.dispose();
});

test('system dismissal cancels a pending selection without blocking the chooser',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);await settle();
 assert.equal(ui.cancel(),false);assert.equal(ui.dialog.open,false);assert.equal(ui.selections[0].options.signal.aborted,true);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,0);ui.dispose();
});

for(const section of ['design','hardware'])test(`a successful ${section} selection closes the chooser and opens that lamp section`,async()=>{
 const ui=fixture();choose(ui,section);await settle();
 assert.equal(ui.selections[0].id,lamp.id);assert.equal(ui.selections[0].section,section);assert.equal(ui.dialog.open,false);
 assert.deepEqual(ui.navigations,[['settings',section]]);ui.dispose();
});

test('changing pages cancels selection and fences a late success',async()=>{
 const gate=deferred(),ui=fixture(()=>gate.promise);choose(ui);await settle();ui.ui.navigate('lamps');
 assert.equal(ui.selections[0].options.signal.aborted,true);gate.resolve({connected:true});await settle();
 assert.equal(ui.navigations.length,0);ui.dispose();
});

test('a selection that stalls times out, aborts, and permits a fresh attempt',async()=>{
 const gate=deferred();let calls=0;const ui=fixture(()=>++calls===1?gate.promise:Promise.resolve({connected:true}));choose(ui);await settle();
 ui.advance(25000);await settle();
 assert.equal(ui.selections[0].options.signal.aborted,true);assert.match(ui.status(),/connect|reach|try|again|time/i);assert.equal(ui.dialog.open,true);
 ui.click('select-settings',{id:lamp.id,section:'design'});await settle();
 assert.equal(calls,2);assert.deepEqual(ui.navigations,[['settings','design']]);
 gate.resolve({connected:true});await settle();assert.equal(ui.navigations.length,1);ui.dispose();
});

test('a failed selection leaves the lamp selectable for retry',async()=>{
 let calls=0;const ui=fixture(async()=>++calls===1?{connected:false,error:Error('Try your lamp again.')}:({connected:true,id:lamp.id}));choose(ui);await settle();
 assert.match(ui.status(),/Try your lamp again/);assert.equal(ui.dialog.querySelectorAll('[data-v2="select-settings"]')[0].disabled,false);
 ui.click('select-settings',{id:lamp.id,section:'design'});await settle();assert.equal(calls,2);assert.deepEqual(ui.navigations,[['settings','design']]);ui.dispose();
});

test('a connection for a different lamp cannot open its settings as the chosen lamp',async()=>{
 const ui=fixture(async()=>({connected:true,id:'112233445566'}));choose(ui);await settle();
 assert.match(ui.status(),/different lamp/);assert.equal(ui.dialog.open,true);assert.equal(ui.navigations.length,0);ui.dispose();
});
