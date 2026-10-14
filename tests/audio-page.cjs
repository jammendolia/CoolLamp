const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const elements={},requests=[],reads=[];
const el=id=>elements[id]??={value:'',options:[],add(option){this.options.push(option)},addEventListener(){}};
let reject=false;
const context={document:{getElementById:el},Option:function(){},URLSearchParams,AbortSignal,
 fetch:async(url,options)=>{
  if(options?.method==='POST'){requests.push({url,token:options.headers['X-Lamp-Token'],data:Object.fromEntries(options.body)});return{ok:!reject,text:async()=>reject?'Busy':'Saved; restarting'};}
  reads.push(url);assert(['/api/state/current','/api/firmware'].includes(url));
  return{ok:true,json:async()=>url==='/api/state/current'?{stateView:1,deviceId:'f0b950b2f180',token:'token',effects:['Fire'],mode:1,brightness:100,power:true,leds:134,milliamps:500,midpoint:40,audio:{installed:false,gain:8,gate:8,scale:100}}:{phase:0,wifi:false}};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('LampPage.h','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(reads,['/api/state/current','/api/firmware']);assert.equal(el('mode').options.length,1);assert.equal(el('midpoint').value,40);assert.equal(el('midpoint').max,133);
 assert.equal(el('microphoneInstalled').checked,false);assert.equal(el('audioGain').value,8);
 el('microphoneInstalled').checked=true;el('audioGain').value='16';el('audioGate').value='12';el('audioScale').value='200';el('audioScale').oninput();
 assert.equal(el('audioScaleValue').value,'2.00×');el('audioGate').oninput();assert.equal(el('audioGateValue').value,'12');
 await el('saveAudio').onclick();
 assert.deepEqual(requests.at(-1),{url:'/api/audio',token:'token',data:{enabled:'1',gain:'16',gate:'12',scale:'200'}});
 assert.equal(el('saveAudio').disabled,true);assert.match(el('audioStatus').textContent,/restarting/);
 reject=true;await el('saveAudio').onclick();assert.equal(el('saveAudio').disabled,false);
 assert.equal(el('audioStatus').textContent,'Busy');
 const before=requests.length;el('audioGain').value='65';await el('saveAudio').onclick();assert.equal(requests.length,before);
 el('audioGain').value='32';el('audioScale').value='401';await el('saveAudio').onclick();assert.equal(requests.length,before);
 reject=false;el('midpoint').value='50';await el('geometryForm').onsubmit({preventDefault(){}});
 assert.deepEqual(requests.at(-1),{url:'/api/geometry',token:'token',data:{midpoint:'50'}});
 const count=requests.length;el('midpoint').value='134';await el('geometryForm').onsubmit({preventDefault(){}});assert.equal(requests.length,count);
 console.log('PASS: production async verified current-state initialization; microphone settings, authenticated provisioning, bounds, geometry and failure recovery.');
})().catch(e=>{console.error(e);process.exitCode=1});
