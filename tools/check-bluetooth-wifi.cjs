// Browser check of the real app and Web Bluetooth transport using a fake GATT device.
// No physical lamp is connected or configured by this check.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const dist=path.resolve('mobile/dist'),errors=[],requests=[];
const names=[...fs.readFileSync('LampNetwork.ino','utf8').match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const server=http.createServer((req,res)=>{const file=path.join(dist,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
function fakeBluetooth(capabilities){
 const serviceId='7b610001-6e2b-4f3d-9a71-28e45c001001',stateId='7b610003-6e2b-4f3d-9a71-28e45c001001';
 const wifiId='7b610008-6e2b-4f3d-9a71-28e45c001001';
 const model=window.__ble={phase:0,scanId:1,ssid:'',reply:{},bytes:[],ssidLength:0,fail:true,writes:[],capabilities,factoryResets:0,
   center:{version:1,active:false,position:103,midpoint:0,leds:205},centerExpires:0};
 const packet=id=>new DataView(Uint8Array.of(1,id,0,4,100,1,28,model.capabilities,1,0,0,0).buffer);
 const status=()=>({version:1,phase:model.phase,error:model.phase===5?2:0,count:2,scanId:model.scanId,connected:model.phase===4,
  ssid:model.ssid,address:model.phase===4?'192.168.1.42':'0.0.0.0',hostname:'coollamp-e2ea24.local',deviceId:'24eae26e9e9c',usingDefaultPassword:true});
 const json=value=>new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);
 const device=new EventTarget();device.id='test-device';device.name='Larger helix';
 const service={uuid:serviceId,device};const characteristics=new Map();
 class Characteristic extends EventTarget {
  constructor(uuid){super();this.uuid=uuid;this.service=service;this.value=packet(0);}
  async readValue(){
   if(this.uuid===stateId)return packet(0);
   if(this.uuid===wifiId)return json(model.reply);
   if(this.uuid==='7b610009-6e2b-4f3d-9a71-28e45c001001')return json(model.center);
   if(this.uuid==='7b610006-6e2b-4f3d-9a71-28e45c001001')return new DataView(new TextEncoder().encode('24eae26e9e9c').buffer);
   throw Error('Unsupported characteristic');
  }
  async writeValueWithResponse(buffer){
   const b=Array.from(buffer instanceof DataView?new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength):new Uint8Array(buffer));model.writes.push(b);const op=b[2],v=b[3];
   if(op===14){if(v===1)model.phase=1;if(v===2)model.phase=0;if(v===0&&model.phase===1)model.phase=2;
    if(v===0&&model.phase===3)model.phase=model.fail?5:4;model.reply=status();}
   if(op===15)model.reply={version:1,scanId:1,index:v,ssid:v?'Guest':'Home test',rssi:-50,open:Boolean(v)};
   if(op===16){model.bytes=[];model.ssidLength=v;}
   if(op===17)model.bytes.push(...b.slice(4));
   if(op===18){model.ssid=new TextDecoder().decode(Uint8Array.from(model.bytes.slice(0,model.ssidLength)));model.phase=3;model.reply=status();}
   if(op===19){if(v!==165)throw Error('Missing reset confirmation');++model.factoryResets;}
   if(op===20){
    if(v===0){model.center.active=true;model.center.position=model.center.midpoint||103;model.centerExpires=Date.now()+10000;}
    if(v===1){model.center.midpoint=model.center.position;model.center.active=false;}
    if(v===2||v===3&&Date.now()>=model.centerExpires)model.center.active=false;
   }
   if(op===21){model.center.position=v|(b[4]<<8);model.centerExpires=Date.now()+10000;}
   const state=await service.getCharacteristic(stateId);state.value=packet(b[1]);state.dispatchEvent(new Event('characteristicvaluechanged'));
  }
  async startNotifications(){return this;}async stopNotifications(){return this;}
 }
 service.getCharacteristic=async uuid=>{if(!characteristics.has(uuid))characteristics.set(uuid,new Characteristic(uuid));return characteristics.get(uuid);};
 device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return device.gatt;},getPrimaryService:async()=>service,
  disconnect:()=>{device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
 Object.defineProperty(navigator,'bluetooth',{value:{getAvailability:async()=>true,requestDevice:async()=>device,getDevices:async()=>[device]}});
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:393,height:852}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(fakeBluetooth,193);let reachable=false;
  const raw={token:'test-token',deviceId:'24eae26e9e9c',hostname:'coollamp-e2ea24.local',name:'Larger helix',ssid:'Home test',leds:205,milliamps:500,
    mode:4,startupMode:4,startupBrightness:100,brightness:100,power:true,effects:names.slice(0,38),usingDefaultPassword:true,factoryReset:true,
    midpoint:0,effectiveMidpoint:103,calibration:{active:false,kind:'leds',position:205,centerSupported:true}};
  await page.route('http://192.168.1.42/**',async route=>{
   requests.push(route.request().method());if(route.request().method()==='OPTIONS')return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
   return route.fulfill({status:reachable?200:503,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'text/plain'},body:reachable?JSON.stringify(raw):'Unreachable'});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#addLamp').evaluate(el=>el.open=true);await page.locator('#connect').click();
  await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Bluetooth',{},{timeout:8000}).catch(async()=>{
    throw Error(JSON.stringify(await page.evaluate(()=>({status:document.getElementById('status').textContent,writes:window.__ble.writes})))+' '+JSON.stringify(errors));
  });
  await page.locator('[data-page=settings]').click();await page.locator('[data-settings-section=network]').click();
  assert(await page.locator('#scanWifi').isEnabled());assert(await page.locator('#wifiSecurityControls').isHidden());assert(await page.locator('#bluetoothManagement').isHidden());
  await page.locator('#scanWifi').click();assert(await page.locator('#scanWifi').isDisabled());assert.equal(await page.locator('#scanWifi').textContent(),'Scanning…');
  await page.waitForFunction(()=>document.querySelector('#networks option[value="Home test"]'));
  assert(await page.locator('#wifiNetworksDialog').isVisible());assert((await page.locator('#wifiSetupFeedback').textContent()).includes('Scan complete'));
  assert.equal(requests.length,0,'network scans use Bluetooth, without hotspot HTTP');
  await page.locator('.wifi-network-choice').filter({hasText:'Home test'}).click();assert(await page.locator('#wifiNetworksDialog').isHidden());
  await page.locator('#wifiPassword').fill('wrong-pass');await page.locator('#toggleWifiPassword').click();
  assert.equal(await page.locator('#wifiPassword').getAttribute('type'),'text');assert.equal(await page.locator('#wifiPassword').inputValue(),'wrong-pass');
  await page.locator('#toggleWifiPassword').click();assert.equal(await page.locator('#wifiPassword').getAttribute('type'),'password');
  await page.locator('#saveWifi').click();
  await page.waitForFunction(()=>document.getElementById('wifiSetupFeedback').textContent.includes('timed out'));
  assert.equal(await page.locator('#connectionBadge').textContent(),'Bluetooth');assert(await page.locator('#scanWifi').isEnabled());
  assert.equal(await page.locator('#wifiPassword').inputValue(),'');
  await page.evaluate(()=>window.__ble.fail=false);await page.locator('#wifiPassword').fill('test-password');await page.locator('#saveWifi').click();
  await page.waitForFunction(()=>document.getElementById('wifiSetupFeedback').textContent.includes('Bluetooth control remains'));
  assert.equal(await page.locator('#connectionBadge').textContent(),'Bluetooth');assert(await page.locator('#switchToWifi').isVisible());
  assert(!(await page.locator('#status').textContent()).includes('Could not join'),'a successful retry clears the old failure message');
  assert((await page.evaluate(()=>window.__ble.writes)).every(frame=>frame.length<=20));
  const axePath=require.resolve('axe-core/axe.min.js');await page.addScriptTag({path:axePath});
  const audit=await page.evaluate(()=>axe.run(document.querySelector('#app'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
  assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[]);
  fs.mkdirSync('.build/ui-check',{recursive:true});await page.locator('#toast').evaluate(el=>el.hidden=true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.build/ui-check/bluetooth-wifi.png',fullPage:true});
  await page.setViewportSize({width:320,height:740});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  reachable=true;await page.locator('#switchToWifi').click();await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Wi-Fi');
  assert.equal(await page.locator('#ssid').inputValue(),'Home test');assert.equal(await page.locator('#leds').inputValue(),'205');
  assert.deepEqual(errors,[]);
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('[data-page=lamps]').click();await page.locator('.lamp-remove').click();
  assert.equal(await page.locator('.lamp-card').count(),0);assert(await page.locator('#reconnect').isHidden());
  assert.equal(await page.evaluate(()=>localStorage.getItem('coollamp-selected')),null);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('coollamp-lamps'))),[]);
  await page.locator('#addLamp').evaluate(el=>el.open=true);await page.locator('#connect').click();
  await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Bluetooth');
  await page.locator('[data-page=settings]').click();await page.locator('[data-settings-section=hardware]').click();
  await page.locator('#startCenter').click();await page.waitForFunction(()=>!document.getElementById('centerPosition').hidden);
  await page.evaluate(()=>{window.__ble.center.position=150;window.__ble.centerExpires=Date.now()+10000;});
  await page.waitForFunction(()=>document.getElementById('centerPosition').textContent.includes('150'));
  await page.evaluate(()=>{window.__ble.center.midpoint=150;window.__ble.center.active=false;});
  await page.waitForFunction(()=>!document.getElementById('startCenter').hidden);
  await page.locator('#startCenter').click();await page.waitForFunction(()=>!document.getElementById('centerPosition').hidden);
  await page.evaluate(()=>{window.__ble.center.position=170;window.__ble.centerExpires=Date.now()-1;});
  await page.waitForFunction(()=>!document.getElementById('startCenter').hidden);
  assert.equal(await page.evaluate(()=>window.__ble.center.midpoint),150,'inactivity keeps the saved center');
  await page.locator('[data-settings-section=overview]').click();await page.locator('#factoryReset').click();
  assert(await page.locator('#factoryResetDialog').isVisible());await page.locator('#factoryResetDialog button[value=cancel]').click();
  assert.equal(await page.evaluate(()=>window.__ble.factoryResets),0);
  await page.locator('#factoryReset').click();await page.addScriptTag({path:axePath});
  const modalAudit=await page.evaluate(()=>axe.run(document.querySelector('#factoryResetDialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
  assert.deepEqual(modalAudit.violations.map(v=>v.id),[]);
  await page.screenshot({path:'.build/ui-check/factory-reset-dialog.png'});
  await page.locator('#factoryResetDialog button[value=reset]').click();await page.waitForFunction(()=>document.querySelectorAll('.lamp-card').length===0);
  assert.equal(await page.evaluate(()=>window.__ble.factoryResets),1);assert(await page.locator('#reconnect').isHidden());
  const legacy=await browser.newPage();await legacy.addInitScript(fakeBluetooth,1);await legacy.goto('http://127.0.0.1:'+server.address().port);
  await legacy.locator('#addLamp').evaluate(el=>el.open=true);await legacy.locator('#connect').click();await legacy.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Bluetooth');
  await legacy.locator('[data-page=settings]').click();await legacy.locator('[data-settings-section=network]').click();
  assert(await legacy.locator('#scanWifi').isDisabled());assert((await legacy.locator('#settingsHint').textContent()).includes('1.9.0'));
  assert.deepEqual(errors,[]);
  console.log('PASS: Bluetooth Wi-Fi, retries/handoff, removal, center preview/save/timeout, confirmed factory reset, legacy fallback, narrow layout and accessibility');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
