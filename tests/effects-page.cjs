const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements={},requests=[];
const el=id=>elements[id]??={value:'',options:[],add(){},addEventListener(){}};
let reject=false;
const context={document:{getElementById:el},Option:function(){},URLSearchParams,AbortSignal,
 fetch:async(url,options)=>{
  if(options){requests.push({url,token:options.headers['X-Lamp-Token'],data:Object.fromEntries(options.body)});return{ok:!reject,text:async()=>reject?'Busy':'Applied'};}
  return{ok:true,json:async()=>url==='/api/state'?{token:'lamp-token',effects:Array(38).fill('Effect'),mode:30,colors:Array.from({length:38},()=>[1,255,60,110]),effectOptions:Array.from({length:38},()=>[50,100,1,35,160,255])}:{phase:0,wifi:false}};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('LampPage.h','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));assert.equal(el('speed').value,50);
 el('speed').value='83';el('intensity').value='0';el('dual').checked=true;el('secondaryColor').value='#00ff7f';await el('applyOptions').onclick();
 assert.deepEqual(requests.at(-1),{url:'/api/effect-options',token:'lamp-token',data:{mode:'30',speed:'83',intensity:'0',dual:'1',r:'0',g:'255',b:'127'}});
 el('mode').value='38';el('mode').onchange();assert.equal(el('speed').value,50);
 el('mode').value='30';el('mode').onchange();assert.equal(el('speed').value,83);assert.equal(el('secondaryColor').value,'#00ff7f');
 reject=true;el('speed').value='99';await el('applyOptions').onclick();el('mode').onchange();assert.equal(el('speed').value,83);assert.equal(el('status').textContent,'Busy');reject=false;
 await el('resetColor').onclick();assert.equal(el('speed').value,50);assert.equal(el('intensity').value,100);
 el('mode').value='31';await el('resetColor').onclick();assert.equal(el('intensity').value,35);assert.equal(el('color').value,'#bed7ff');
 el('mode').value='29';el('mode').onchange();assert.equal(el('speed').disabled,true);
 console.log('PASS: web per-effect options, authenticated submission, independent slots, failure recovery and reset defaults.');
})().catch(e=>{console.error(e);process.exitCode=1});
