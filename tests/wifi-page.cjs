const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const {generatePassword,setupSecrets}=require('../tools/setup-secrets.cjs');
for(let i=0;i<1000;i++){const p=generatePassword();assert.match(p,/^[a-z]+(-[a-z]+){1}$/);assert.equal(new Set(p.split('-')).size,2);assert(p.length>=8&&p.length<=63)}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lamp-secret-test-'));
try{const dest=path.join(dir,'LampSecrets.h');assert(setupSecrets(dest));const before=fs.readFileSync(dest,'utf8');assert.equal(setupSecrets(dest),false);assert.equal(fs.readFileSync(dest,'utf8'),before)}finally{fs.rmSync(dir,{recursive:true})}
const page=fs.readFileSync(path.join(__dirname,'../LampPage.h'),'utf8');
assert(page.includes('minlength="8"'));
const elements={};
function el(id){return elements[id]??={value:'',dataset:{},options:[],add(o){this.options.push(o)},replaceChildren(...o){this.options=o},addEventListener(){}}}
let scanState='complete'; const colorRequests=[];
const unusual='<img src=x onerror=alert(1)> & "network"';
const context={document:{getElementById:el},Option:function(text,value){this.text=text;this.value=value;this.dataset={}},Date,Error,URLSearchParams,AbortSignal,setTimeout:fn=>setImmediate(fn),fetch:async(url,options)=>{if(url==='/api/color')colorRequests.push(Object.fromEntries(options.body));return({ok:true,text:async()=>'',json:async()=>url==='/api/state'?{token:'token',power:true,mode:3,effects:['Pacifica','Aurora','Rain'],colors:[[0,255,60,110],[0,255,60,110],[0,128,160,255]],ssid:'saved'}:{status:scanState,networks:[{ssid:unusual,rssi:-40,open:false},{ssid:'Guest',rssi:-70,open:true}]}})}};
vm.runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
(async()=>{
 await new Promise(r=>setImmediate(r));
 el('mode').value='3';el('color').value='#ff2300';await el('applyColor').onclick();
 assert.deepEqual(colorRequests.at(-1),{mode:'3',r:'255',g:'35',b:'0'});
 el('mode').value='2';el('mode').onchange();assert.equal(el('color').value,'#ff3c6e');
 el('mode').value='3';el('mode').onchange();assert.equal(el('color').value,'#ff2300');
 await el('resetColor').onclick();assert.equal(colorRequests.at(-1).reset,'1');assert.equal(el('color').value,'#80a0ff');
 await el('scan').onclick();assert.equal(el('networks').options.length,3);assert.equal(el('networks').options[1].value,unusual);
 el('networks').selectedOptions=[el('networks').options[2]];el('networks').onchange();assert.equal(el('ssid').value,'Guest');assert.equal(el('openNetwork').checked,true);
 el('networks').selectedOptions=[el('networks').options[1]];el('networks').onchange();assert.equal(el('ssid').value,unusual);assert.equal(el('openNetwork').checked,false);
 scanState='failed';await el('scan').onclick();assert.equal(el('scan').disabled,false);assert.match(el('scanStatus').textContent,/could not finish/);
 console.log('PASS: two-word password generation, existing secret preserved, network selection, literal SSID rendering, open-network selection, scan failure recovery, and per-effect color apply/restore.');
})().catch(e=>{console.error(e);process.exitCode=1});
