import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {lampArtworkSvg} from '../src/lamp-artwork.js';
import {LAMP_STYLES,normalizeLampStyle,resolveLampStyle} from '../src/lamp-style.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const power=extract('function renderPower() {','\nfunction renderOptions() {');
const resolution=extract('function resolvedStyle(entry=selected) {',"\n$('lampStyle').replaceChildren");
const descriptor=id=>{const {code,family}=LAMP_STYLES.find(style=>style.id===id);return {version:1,code,id,family};};

function fixture(){
 const elements=new Map();let renders=0,html='';
 const node=id=>{if(!elements.has(id))elements.set(id,{dataset:{},style:{},classList:{toggle(){}},setAttribute(){}});return elements.get(id);};
 Object.defineProperty(node('lampArt'),'innerHTML',{get:()=>html,set:value=>{html=value;renders++;}});
 const context={$:node,lampArtworkSvg,normalizeLampStyle,resolveLampStyle,selected:{id:'aabbccddeeff',phoneLampStyle:'helix',lampStyle:descriptor('helix')},
  lamp:{identity:'aabbccddeeff',raw:{lampStyle:descriptor('sonata'),leds:128,budget:500,midpoint:0},catalog:[{id:4,name:'Fire'}],command(){throw Error('Rendering must not write to the lamp');}},
  state:{power:true,mode:4,sync:{role:0}},busy:false,connecting:false,liveLightSending:false,groupScenes:[],
  groupsAvailable:()=>true,updatingLamp:()=>false,independentLightingAllowed:()=>true,document:{querySelector:()=>node('hero')}};
 context.verifiedSelectedLamp=()=>!context.connecting&&context.lamp.identity===context.selected?.id;
 runInNewContext(resolution+'\n'+power+'\nthis.render=renderPower;',context);
 return {context,node,render:context.render,html:()=>html,renders:()=>renders};
}

test('the actual Effects hero draws verified Sonata over stale cached or phone Helix artwork',()=>{
 const f=fixture(),before=structuredClone(f.context.lamp.raw);f.render();
 assert.match(f.html(),/data-lamp-artwork="sonata"/);assert.match(f.html(),/lamp-artwork-sonata-curve/);
 assert.match(f.html(),/lamp-artwork-sonata-knob/);assert.match(f.html(),/aria-hidden="true"/);
 assert.deepEqual(f.context.lamp.raw,before);assert.equal(f.node('powerState').textContent,'Light is on');
 f.render();assert.equal(f.renders(),1,'An unchanged drawing is retained during state polling.');
});

test('switching lamps updates the Effects drawing for every supported design without using the lamp name',()=>{
 const f=fixture();
 for(const style of LAMP_STYLES){
  f.context.selected={id:'112233445566',name:'Sonata Left',lampStyle:descriptor(style.id),phoneLampStyle:'sonata'};
  f.context.lamp.identity='112233445566';f.context.lamp.raw.lampStyle={...descriptor(style.id),locked:true};f.render();
  assert.match(f.html(),new RegExp(`data-lamp-artwork="${style.id}"`));
 }
});

test('an unverified connection cannot replace the selected lamp artwork',()=>{
 const f=fixture();f.context.lamp.identity='112233445566';f.render();assert.match(f.html(),/data-lamp-artwork="helix"/);
 f.context.selected.lampStyle=descriptor('sonata');f.context.connecting=true;f.render();assert.match(f.html(),/data-lamp-artwork="sonata"/);
});

test('Sonata retains its silhouette through power changes and never keeps another lamp after deselection',()=>{
 const f=fixture();f.render();assert.equal(f.node('lampArt').style.opacity,'1');
 f.context.state.power=false;f.render();assert.match(f.html(),/data-lamp-artwork="sonata"/);assert.equal(f.node('lampArt').style.opacity,'.2');
 assert.equal(f.node('powerState').textContent,'Light is off');assert.equal(f.renders(),1);
 f.context.state.power=true;f.render();assert.equal(f.node('lampArt').style.opacity,'1');
 f.context.selected=null;f.context.state=null;f.render();assert.match(f.html(),/data-lamp-artwork="unspecified"/);
});
