import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandedDetailsNeedsReveal,mountViewportSafety} from '../src/viewport-safety.js';

test('expanded details request a reveal only when their useful content leaves the safe viewport',()=>{
 assert.equal(expandedDetailsNeedsReveal({summaryTop:64,firstControlBottom:500,topLimit:55,bottomLimit:700}),false);
 assert.equal(expandedDetailsNeedsReveal({summaryTop:40,firstControlBottom:500,topLimit:55,bottomLimit:700}),true);
 assert.equal(expandedDetailsNeedsReveal({summaryTop:64,firstControlBottom:720,topLimit:55,bottomLimit:700}),true);
});

test('opening an offscreen accordion scrolls its summary above persistent navigation',()=>{
 let toggle,scrollOptions;
 const summary={getBoundingClientRect:()=>({top:400}),scrollIntoView:value=>{scrollOptions=value;},nextElementSibling:null};
 const control={hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({bottom:760})};
 const details={tagName:'DETAILS',open:true,isConnected:true,querySelector:value=>value==='summary'?summary:null,querySelectorAll:()=>[control],closest:()=>null};
 const document={addEventListener:(name,handler)=>{if(name==='toggle')toggle=handler;},removeEventListener(){},getElementById:id=>id==='app'?{}:id==='toast'?{hidden:true}:null,querySelector:()=>({getBoundingClientRect:()=>({top:700})})};
 const window={innerHeight:800,requestAnimationFrame:callback=>callback(),matchMedia:()=>({matches:false}),getComputedStyle:()=>({paddingTop:'47px'})};
 const dispose=mountViewportSafety({document,window});
 toggle({target:details});
 assert.deepEqual(scrollOptions,{block:'start',behavior:'smooth'});
 dispose();
});

test('daily lamp controls and effect editing precede password maintenance',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const hero=html.indexOf('<section class="light-hero"');
 const effects=html.indexOf('id="effectLibrary"');
 const savedLooks=html.indexOf('id="savedLooks"');
 const rotation=html.indexOf('id="rotationPane"');
 const password=html.indexOf('id="defaultPasswordNotice"');
 assert(hero>=0&&effects>hero&&savedLooks>effects&&rotation>savedLooks&&password>rotation);
 const settingsStart=html.indexOf('<section id="page-settings"');
 assert(password<settingsStart,'password maintenance belongs at the end of the lamp workspace');
});

test('app shell reserves both system safe areas and persistent navigation',()=>{
 const css=readFileSync(new URL('../src/app-v2.css',import.meta.url),'utf8');
 assert.match(css,/scroll-padding-block-start:calc\(env\(safe-area-inset-top\) \+ 16px\)/);
 assert.match(css,/padding-bottom:calc\(140px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/body::before\{[^}]*height:env\(safe-area-inset-top\)/);
 assert.match(css,/dialog\{[^}]*inset-block-start:max\(12px,env\(safe-area-inset-top\)\)/);
});
