const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const page=fs.readFileSync('LampPage.h','utf8'),elements={};
const el=id=>elements[id]??={value:'',options:[],add(){},addEventListener(){}};
let firmware={version:'1.2.0',latest:'1.3.0',wifi:true,available:true,automatic:false,phase:2,progress:0,error:0};
let unavailable=false,reject=false;const requests=[];
const context={document:{getElementById:el},Option:function(){},URLSearchParams,AbortSignal,
fetch:async(path,options)=>{
  if(options?.method==='POST') {requests.push([path,options.headers,Object.fromEntries(options.body)]);if(path.endsWith('automatic')&&!reject)firmware.automatic=options.body.get('enabled')==='1';return{ok:!reject,text:async()=>reject?'Busy':'Accepted'};}
  if(path==='/api/state')return{ok:true,json:async()=>({token:'test-token',effects:[],colors:[],mode:1})};
  if(unavailable)throw Error('offline');return{ok:true,json:async()=>({...firmware})};
}};
vm.createContext(context);vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));assert.equal(el('firmwareVersion').textContent,'1.2.0');assert.match(el('firmwareStatus').textContent,/1.3.0/);assert.equal(el('installFirmware').disabled,false);
 el('autoUpdate').checked=true;await el('autoUpdate').onchange();assert.equal(firmware.automatic,true);assert.equal(requests.at(-1)[1]['X-Lamp-Token'],'test-token');
 reject=true;el('autoUpdate').checked=false;await el('autoUpdate').onchange();assert.equal(el('autoUpdate').checked,true);assert.equal(el('status').textContent,'Busy');reject=false;
 await el('installFirmware').onclick();assert.equal(requests.at(-1)[0],'/api/firmware/install');
 firmware.phase=3;firmware.progress=42;await vm.runInContext('pollFirmware()',context);assert.match(el('firmwareStatus').textContent,/42%/);assert.match(el('status').textContent,/42%/);assert.equal(el('installFirmware').disabled,true);
 firmware.phase=1;await el('checkFirmware').onclick();assert.match(el('status').textContent,/Checking/);
 firmware.phase=5;firmware.error=3;await vm.runInContext('pollFirmware()',context);assert.equal(el('status').textContent,'Could not reach the release server.');assert.equal(el('checkFirmware').disabled,false);
 firmware.phase=1;await el('checkFirmware').onclick();firmware.phase=0;firmware.available=false;firmware.latest='0.0.0';await vm.runInContext('pollFirmware()',context);assert.match(el('status').textContent,/No published update/);
 vm.runInContext("status('Unrelated settings saved.')",context);await vm.runInContext('pollFirmware()',context);assert.equal(el('status').textContent,'Unrelated settings saved.');
 firmware.phase=2;firmware.wifi=false;await vm.runInContext('pollFirmware()',context);assert.equal(el('checkFirmware').disabled,true);assert.equal(el('autoUpdate').disabled,false);
 firmware.wifi=true;await el('checkFirmware').onclick();unavailable=true;await el('checkFirmware').onclick();assert.equal(el('autoUpdate').disabled,true);assert.equal(el('checkFirmware').disabled,true);assert.match(el('status').textContent,/unavailable/);
 console.log('PASS: web firmware version, availability, token, saved toggle, rejection recovery, progress and offline controls.');
})().catch(e=>{console.error(e);process.exitCode=1});
