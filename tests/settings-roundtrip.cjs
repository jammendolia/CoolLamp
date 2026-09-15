const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const pass=fs.readFileSync(path.join(root,'LampSecrets.h'),'utf8').match(/DEFAULT_ADMIN_PASSWORD "([^"]+)"/)[1];
const headers={Authorization:'Basic '+Buffer.from('lamp:'+pass).toString('base64')};
(async()=>{
  let state;
  for(let attempt=0;attempt<15;attempt++){try{const r=await fetch('http://192.168.4.1/api/state',{headers,signal:AbortSignal.timeout(3000)});state=await r.json();break}catch(e){if(attempt===14)throw e;await new Promise(r=>setTimeout(r,1000))}}
  const restore=process.argv.includes('--restore');
  if(restore){assert.equal(state.leds,133);assert.equal(state.brightness,99);assert.equal(state.mode,2);console.log('PASS: LED count, brightness, and startup effect survived restart.');}
  const data={leds:restore?134:133,brightness:restore?100:99,mode:restore?4:2,milliamps:500,ssid:'',wifiPassword:'',adminPassword:''};
  const r=await fetch('http://192.168.4.1/api/config',{method:'POST',headers:{...headers,'X-Lamp-Token':state.token},body:new URLSearchParams(data),signal:AbortSignal.timeout(5000)});
  assert.equal(r.status,200,await r.text());
  console.log(restore?'Original 134-LED / brightness 100 / Fire startup settings restored; restarting.':'Test settings saved; restarting for persistence check.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
