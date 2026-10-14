const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements={},requests=[],reads=[];
const el=id=>elements[id]??={value:'',options:[],add(option){this.options.push(option)},addEventListener(){}};
const identity='f0b950b2f180';
const projection=(mode,color,options)=>({stateView:1,deviceId:identity,token:'lamp-token',effects:Array(38).fill('Effect'),mode,power:true,brightness:100,leds:180,milliamps:500,midpoint:0,
 colors:Array.from({length:38},(_,i)=>i===mode-1?color:null),effectOptions:Array.from({length:38},(_,i)=>i===mode-1?options:null)});
let reject=false,current=projection(30,[1,255,60,110],[50,100,1,35,160,255]);
const context={document:{getElementById:el},Option:function(){},URLSearchParams,AbortSignal,
 fetch:async(url,options)=>{
  if(options?.method==='POST'){requests.push({url,token:options.headers['X-Lamp-Token'],data:Object.fromEntries(options.body)});return{ok:!reject,text:async()=>reject?'Busy':'Applied'};}
  reads.push(url);assert(['/api/state/current','/api/firmware'].includes(url));
  return{ok:true,json:async()=>url==='/api/state/current'?current:{phase:0,wifi:false}};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('LampPage.h','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));assert.deepEqual(reads,['/api/state/current','/api/firmware']);assert.equal(el('mode').options.length,38);assert.equal(el('speed').value,50);
 el('speed').value='83';el('intensity').value='0';el('dual').checked=true;el('secondaryColor').value='#00ff7f';await el('applyOptions').onclick();
 assert.deepEqual(requests.at(-1),{url:'/api/effect-options',token:'lamp-token',data:{mode:'30',speed:'83',intensity:'0',dual:'1',r:'0',g:'255',b:'127'}});
 el('mode').value='38';el('mode').onchange();assert.equal(el('speed').disabled,true);assert.equal(el('applyOptions').disabled,true);
 const unknownWrites=requests.length;await el('applyOptions').onclick();assert.equal(requests.length,unknownWrites);
 el('mode').value='30';el('mode').onchange();assert.equal(el('speed').value,83);assert.equal(el('secondaryColor').value,'#00ff7f');
 reject=true;el('speed').value='99';await el('applyOptions').onclick();el('mode').onchange();assert.equal(el('speed').value,83);assert.equal(el('status').textContent,'Busy');reject=false;
 // Reset and preview read the current lamp's actual sparse tuple. Distinct
 // returned values detect the former guessed browser defaults.
 current=projection(30,[0,31,32,33],[70,12,0,41,42,43]);await el('resetColor').onclick();assert.equal(el('speed').value,70);assert.equal(el('intensity').value,12);assert.equal(el('color').value,'#1f2021');assert.equal(reads.at(-1),'/api/state/current');
 el('mode').value='31';el('mode').onchange();assert.equal(el('applyOptions').disabled,true);current=projection(31,[0,190,215,255],[55,35,0,21,22,23]);await el('preview').onclick();
 assert.deepEqual(requests.at(-1),{url:'/api/preview',token:'lamp-token',data:{mode:'31',brightness:'100'}});assert.equal(el('intensity').value,35);assert.equal(el('color').value,'#bed7ff');assert.equal(el('mode').options.length,38);
 current=projection(31,[0,11,12,13],[61,24,0,14,15,16]);await el('resetColor').onclick();assert.equal(el('intensity').value,24);assert.equal(el('color').value,'#0b0c0d');
 el('mode').value='29';current=projection(29,[1,1,2,3],[50,100,0,4,5,6]);await el('preview').onclick();assert.equal(el('speed').disabled,true);
 current={...projection(29,[1,11,22,33],[99,99,1,77,88,99]),deviceId:'aabbccddeeff'};await el('resetColor').onclick();assert.match(el('status').textContent,/state not confirmed/);assert.equal(el('applyOptions').disabled,true);assert.equal(el('mode').options.length,38);
 console.log('PASS: production async verified current-state initialization; sparse per-effect options, authenticated submission, failure recovery, real reset/preview readback and target fencing.');
})().catch(e=>{console.error(e);process.exitCode=1});
