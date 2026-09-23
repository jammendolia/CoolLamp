const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const elements={},requests=[];
const el=id=>elements[id]??={value:'',options:[],add(){},addEventListener(){}};
let reject=false;
const context={document:{getElementById:el},Option:function(){},URLSearchParams,AbortSignal,
 fetch:async(url,options)=>{
  if(options){requests.push({url,token:options.headers['X-Lamp-Token'],data:Object.fromEntries(options.body)});return{ok:!reject,text:async()=>reject?'Busy':'Saved; restarting'};}
  return{ok:true,json:async()=>url==='/api/state'?{token:'token',effects:['Fire'],mode:1,audio:{installed:false,gain:8,gate:8}}:{phase:0,wifi:false}};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('LampPage.h','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));
 assert.equal(el('microphoneInstalled').checked,false);assert.equal(el('audioGain').value,8);
 el('microphoneInstalled').checked=true;el('audioGain').value='16';el('audioGate').value='12';el('audioScale').value='200';el('audioScale').oninput();
 assert.equal(el('audioScaleValue').value,'2.00×');
 await el('saveAudio').onclick();
 assert.deepEqual(requests.at(-1),{url:'/api/audio',token:'token',data:{enabled:'1',gain:'16',gate:'12',scale:'200'}});
 assert.equal(el('saveAudio').disabled,true);assert.match(el('audioStatus').textContent,/restarting/);
 reject=true;await el('saveAudio').onclick();assert.equal(el('saveAudio').disabled,false);
 assert.equal(el('audioStatus').textContent,'Busy');
 const before=requests.length;el('audioGain').value='65';await el('saveAudio').onclick();assert.equal(requests.length,before);
 el('audioGain').value='32';el('audioScale').value='401';await el('saveAudio').onclick();assert.equal(requests.length,before);
 console.log('PASS: microphone settings load, authenticated provisioning, bounds and failure recovery.');
})().catch(e=>{console.error(e);process.exitCode=1});
