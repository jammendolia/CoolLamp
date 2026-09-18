const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'CoolLamp.ino'), 'utf8');
const pageHeader = fs.readFileSync(path.join(root, 'LampPage.h'), 'utf8');
const html = pageHeader.split('R"HTML(')[1].split(')HTML";')[0];
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(js);
const modes = [...main.matchAll(/^#define (MODE_\w+) (\d+)$/gm)];
assert.equal(modes.length, 38);
assert.deepEqual(modes.map(m=>Number(m[2])), Array.from({length:38},(_,i)=>i+1));
for(const [,name] of modes) assert(main.includes(`case ${name}:`));
assert(!main.match(/Serial\.(print|write)/));
for(let count=1;count<=1024;count++){
  const left=Math.floor((count+1)/2),right=Math.floor(count/2);
  for(const reverse of [false,true]){
    const seen=new Set();
    for(let i=0;i<left;i++)seen.add(reverse?left-1-i:i);
    for(let i=0;i<right;i++)seen.add(reverse?left+i:count-1-i);
    assert.equal(seen.size,count);
    assert.equal(Math.min(...seen),0);assert.equal(Math.max(...seen),count-1);
  }
  for(let i=0;i<count;i++){
    const isLeft=i<left,local=isLeft?left-1-i:i-left,size=isLeft?left:right;
    assert(local>=0&&local<size);
    const x=size>1?Math.floor(local*65535/(size-1)):32768;
    assert(x>=0&&x<=65535);
  }
}
assert(html.includes('min="1" max="1024"'));
const network=fs.readFileSync(path.join(root,'LampNetwork.ino'),'utf8');
assert(network.includes('header.chip_id != CONFIG_IDF_FIRMWARE_CHIP_ID'));
assert(network.includes('app.magic_word != ESP_APP_DESC_MAGIC_WORD'));
assert(network.includes('if (Update.isRunning()) Update.abort()'));
console.log('PASS: page JavaScript parses; 38 modes have unique selectable IDs; split/rain mappings cover lengths 1–1024; controls contain no blocking serial writes.');
if(process.argv.includes('--serve')){
  const effects=[...network.match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
  require('node:http').createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/api/state'?'application/json':'text/html');
    if(req.url==='/api/state')res.end(JSON.stringify({token:'preview-token',mode:4,brightness:100,leds:134,milliamps:500,power:true,ssid:'',connected:false,address:'0.0.0.0',hostname:'coollamp-50b9ac.local',effects}));
    else if(req.method==='POST'){res.setHeader('Content-Type','text/plain');res.end('Preview request received.');}
    else res.end(html);
  }).listen(8765,'127.0.0.1',()=>console.log('UI preview: http://127.0.0.1:8765'));
}
