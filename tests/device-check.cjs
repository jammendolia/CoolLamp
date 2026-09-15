// Live tests against the user's lamp; no home Wi-Fi credentials are read.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const password=process.env.LAMP_PASSWORD||fs.readFileSync(path.join(root,'LampSecrets.h'),'utf8').match(/DEFAULT_ADMIN_PASSWORD "([^"]+)"/)[1];
const base='http://192.168.4.1';
const authorization='Basic '+Buffer.from('lamp:'+password).toString('base64');
let token,original;
async function getState(){const r=await fetch(base+'/api/state',{headers:{Authorization:authorization},signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json()}
async function post(url,data,includeToken=true){return fetch(base+url,{method:'POST',headers:{Authorization:authorization,...(includeToken?{'X-Lamp-Token':token}:{})},body:new URLSearchParams(data),signal:AbortSignal.timeout(5000)})}
(async()=>{
  for(let attempt=0;attempt<15;attempt++){try{original=await getState();break}catch(e){if(attempt===14)throw e;await new Promise(r=>setTimeout(r,1000))}}
  token=original.token;
  assert.equal(original.effects.length,28);assert.equal(original.leds,134);
  console.log('PASS: authenticated device state, 28 effects, 134 active LEDs.');
  let response=await fetch(base+'/api/state',{signal:AbortSignal.timeout(5000)});assert.equal(response.status,401);
  response=await post('/api/preview',{mode:2,brightness:100},false);assert.equal(response.status,403);
  console.log('PASS: login and per-boot request-token protection.');
  response=await post('/api/scan',{},false);assert.equal(response.status,403);
  for(let scan=0;scan<2;scan++){
    response=await post('/api/scan',{});assert.equal(response.status,202);
    const deadline=Date.now()+30000;let result;
    do{
      await new Promise(r=>setTimeout(r,750));
      await getState();
      response=await fetch(base+'/api/scan',{headers:{Authorization:authorization},signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200);result=await response.json();
    }while(result.status==='scanning'&&Date.now()<deadline);
    assert.equal(result.status,'complete');assert(result.networks.length<=32);
    for(let i=1;i<result.networks.length;i++)assert(result.networks[i-1].rssi>=result.networks[i].rssi);
    console.log('PASS: hotspot stayed reachable during scan '+(scan+1)+'; '+result.networks.length+' networks returned in signal order.');
  }
  for(const length of [7,8]){
    response=await post('/api/config',{leds:original.leds,milliamps:original.milliamps,brightness:original.brightness,mode:original.mode,ssid:original.ssid==='test-validation'?'other-validation':'test-validation',adminPassword:'a'.repeat(length)});
    assert.equal(response.status,400);const message=await response.text();
    assert(message.includes(length===7?'access passwords':'Enter the new network password'));
  }
  console.log('PASS: seven-character access password rejected; eight characters pass password validation without changing saved settings.');
  response=await post('/api/config',{leds:0,milliamps:500,brightness:100,mode:4});assert.equal(response.status,400);
  response=await post('/api/config',{leds:1025,milliamps:500,brightness:100,mode:4});assert.equal(response.status,400);
  console.log('PASS: invalid strip lengths rejected without saving.');
  try{
    response=await post('/api/preview',{mode:2,brightness:80});assert.equal(response.status,200);
    const preview=await getState();assert.equal(preview.mode,2);assert.equal(preview.brightness,80);
    console.log('PASS: live effect/brightness preview.');
  }finally{
    await post('/api/preview',{mode:original.mode,brightness:original.brightness});
    if(!original.power)await post('/api/power',{on:0});
  }
  async function uploadImage(bytes,name){
    const boundary='----CoolLampTestBoundary';
    const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="firmware"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return fetch(base+'/update',{method:'POST',headers:{Authorization:authorization,'X-Lamp-Token':token,'Content-Type':'multipart/form-data; boundary='+boundary},body,signal:AbortSignal.timeout(30000)});
  }
  response=await uploadImage(Buffer.alloc(400),'invalid.bin');
  assert.equal(response.status,400);assert((await response.text()).includes('ESP32-C3'));
  await getState();console.log('PASS: invalid OTA image rejected; current firmware remains responsive.');
  if(process.argv.includes('--ota')){
    response=await uploadImage(fs.readFileSync(path.join(root,'firmware','CoolLamp.ino.bin')),'CoolLamp.ino.bin');
    const message=await response.text();assert.equal(response.status,200,message);assert(message.includes('verified'));
    console.log('PASS: actual Wi-Fi firmware upload verified; lamp restarting.');
  }})().catch(error=>{console.error('DEVICE TEST FAILED:',error.message,error.cause?.code||'');process.exitCode=1});
