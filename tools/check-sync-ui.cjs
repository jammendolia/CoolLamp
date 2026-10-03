// Optional browser regression check. Run from repo root with Playwright available.
// Build mobile/dist first; all lamp requests are intercepted, never sent to hardware.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(), dist=path.join(root,'mobile/dist');
const names=[...fs.readFileSync('LampNetwork.ino','utf8').match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const raw={token:'test-token',deviceId:'aabbccddeeff',hostname:'coollamp-test.local',name:'Studio lamp',ssid:'Studio',leds:134,milliamps:500,midpoint:40,mode:41,brightness:170,startupMode:41,startupBrightness:170,power:true,apiVersion:2,catalogVersion:1,effects:names,colors:names.map((_,i)=>[i>=40?0:1,255,80,0]),effectOptions:names.map(()=>[50,85,1,65,35,255]),fountainColors:[[255,65,0],[0,230,130],[75,30,255]],vuColors:[[0,255,0],[255,255,0],[255,0,0]],audio:{installed:true,gain:30,gate:32,scale:120,liveTuning:true},firmware:{version:'1.6.1',phase:0,wifi:true,automatic:false}};
const catalog=names.map((name,i)=>({id:i+1,name,category:i>=38?'audio':i>=3&&i<=11?'fire':i>=20&&i<=28?'color':'calm',speed:!(i>=20&&i<=28)}));
fs.mkdirSync(path.join(root,'.build/ui-check'),{recursive:true});
raw.sync={version:2,scene:0,sceneSpeed:50,sceneIntensity:85,scenePrimary:[70,220,255],sceneSecondary:[255,65,170],position:0,count:2,order:[{id:'aabbccddeeff',name:'Studio lamp',online:true},{id:'112233445566',name:'Second lamp',online:true}],role:0,peers:[{id:'112233445566',name:'Living room',role:1,microphone:true}]};
raw.rotation={enabled:false,random:true,category:0,seconds:30};raw.calibration={active:false,position:134};
const second=structuredClone(raw);Object.assign(second,{deviceId:'112233445566',hostname:'coollamp-second.local',name:'Second lamp'});second.sync={version:2,role:0,peers:[],scene:0,count:1};
const globalRaw=raw;
const requests=[],errors=[];
const server=http.createServer((req,res)=>{const pathname=req.url.split('?')[0];const file=path.join(dist,pathname==='/'?'index.html':pathname);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^http:\/\/192\.168\.1\.(42|43)\//,async route=>{
   const req=route.request(),url=new URL(req.url()),data=Object.fromEntries(new URLSearchParams(req.postData()||''));
   const raw=url.hostname==='192.168.1.43'?second:globalRaw;
   let body='Saved';
   if(req.method()==='POST'){
    requests.push({path:url.pathname,data});
    if(url.pathname==='/api/sync'){
      if(data.action==='pause')Object.assign(raw.sync,{paused:true,active:false});
      else if(data.action==='resume')Object.assign(raw.sync,{paused:false,active:true});
      else Object.assign(raw.sync,{role:Number(data.role),leader:data.leader||'',paused:false,active:data.role==='2'});
    }

    if(url.pathname==='/api/sync/scene')Object.assign(raw.sync,{scene:Number(data.scene),sceneSpeed:Number(data.speed),sceneIntensity:Number(data.intensity),scenePrimary:['r','g','b'].map(k=>Number(data[k])),sceneSecondary:['r2','g2','b2'].map(k=>Number(data[k]))});
    if(url.pathname==='/api/rotation')Object.assign(raw.rotation,{enabled:data.enabled==='1',random:data.random==='1',category:Number(data.category),seconds:Number(data.seconds)});
    if(url.pathname==='/api/calibration'){
      if(data.action==='start')raw.calibration.active=true;
      if(data.action==='move')raw.calibration.position=Number(data.position);
      if(data.action==='cancel'||data.action==='save')raw.calibration.active=false;
    }
    if(url.pathname==='/api/sync/order'){raw.sync.order=data.order.split(',').map(id=>raw.sync.order.find(x=>x.id===id));raw.sync.position=raw.sync.order.findIndex(x=>x.id===raw.deviceId);}
    if(url.pathname==='/api/preview'){raw.mode=Number(data.mode);raw.brightness=Number(data.brightness);}
    if(url.pathname==='/api/fountain-colors')raw.fountainColors=data.reset?[[255,65,0],[0,230,130],[75,30,255]]:[0,1,2].map(i=>['r','g','b'].map(k=>Number(data[k+i])));
    if(url.pathname==='/api/vu-colors')raw.vuColors=data.reset?[[0,255,0],[255,255,0],[255,0,0]]:[0,1,2].map(i=>['r','g','b'].map(k=>Number(data[k+i])));
    if(url.pathname==='/api/audio/tuning')Object.assign(raw.audio,{gain:Number(data.gain),gate:Number(data.gate),scale:Number(data.scale)});
    if(url.pathname==='/api/color')raw.colors[Number(data.mode)-1]=[1,Number(data.r),Number(data.g),Number(data.b)];
    if(url.pathname==='/api/effect-options')raw.effectOptions[Number(data.mode)-1]=['speed','intensity','dual','r','g','b'].map(k=>Number(data[k]));
   }else body=JSON.stringify(url.pathname==='/api/effects'?catalog:raw);
   await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'text/plain'},body});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#addLamp').evaluate(e=>e.open=true);
  await page.locator('#address').fill('192.168.1.42');await page.locator('#password').fill('test-password');
  await page.locator('#wifiConnect button').click();
  await page.locator('#effectTitle').filter({hasText:'Spectrum Rise'}).waitFor();
  await page.locator('[data-page=settings]').click();
  assert(await page.locator('#syncFields').isEnabled());
  assert.match(await page.locator('#syncPeers').textContent(),/Living room/);
  await page.locator('#createSync').click();
  await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Coordinating'));
  const code=await page.locator('#syncCode').inputValue();assert.match(code,/^CL1-aabbccddeeff-[a-f0-9]{32}$/);
  assert(await page.locator('#syncCodeArea').isVisible());
  // Switch to a different device, then back using saved lamp cards.
  await page.locator('[data-page=lamps]').click();
  assert(await page.locator('.lamp-card').filter({hasText:'Studio lamp'}).isEnabled(),'saved lamps must remain selectable after connecting');
  await page.locator('#addLamp').evaluate(e=>e.open=true);
  await page.locator('#address').fill('192.168.1.43');await page.locator('#password').fill('test-password');
  await page.locator('#wifiConnect button').click();
  await page.waitForFunction(()=>document.getElementById('lampTitle').textContent==='Second lamp');
  await page.locator('[data-page=settings]').click();
  assert.match(await page.locator('#syncStatus').textContent(),/Independent/);
  assert(await page.locator('#syncCoordinator').isHidden());
  assert(await page.locator('#syncJoinForm').isVisible());
  assert.equal(await page.locator('#syncCode').inputValue(),'');
  await page.locator('[data-page=lamps]').click();
  await page.locator('.lamp-card').filter({hasText:'Studio lamp'}).click();
  await page.waitForFunction(()=>document.getElementById('lampTitle').textContent==='Studio lamp');
  await page.locator('[data-page=settings]').click();
  assert.match(await page.locator('#syncStatus').textContent(),/Coordinating/);
  assert.equal(second.sync.role,0,'switching must not change another lamp role');
  await page.locator('[data-page=light]').click();
  assert(await page.locator('#groupScenePane').isVisible());
  for(const name of ['Portal','Ping-pong','Stereo fountain','Duet','Orbit','Storm front','Ember exchange','Color wave']){
    await page.locator('#groupSceneChoices button').filter({hasText:new RegExp('^'+name+'$')}).click();
    await page.waitForFunction(name=>document.getElementById('groupSceneTitle').textContent===name,name);
    assert(await page.locator('#effectPane').isHidden());
  }
  await page.locator('#groupSceneChoices button').filter({hasText:'Duet'}).click();
  await page.waitForFunction(()=>document.getElementById('groupSceneTitle').textContent==='Duet');
  assert(await page.locator('#groupSceneAudio').isVisible());
  await page.locator('#groupSceneSpeed').fill('73');await page.locator('#groupSceneSpeed').dispatchEvent('input');
  await page.locator('#applyGroupScene').click();
  await page.waitForFunction(()=>!document.getElementById('groupSceneFields').disabled && document.getElementById('groupSceneFeedback').textContent==='Saved');
  assert.equal(raw.sync.sceneSpeed,73);
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'scene overflow at '+width);}
  await page.setViewportSize({width:393,height:852});
  await page.locator('#groupScenePane').screenshot({path:'.build/ui-check/group-scenes.png'});
  await page.locator('[data-page=settings]').click();
  await page.locator('#groupOrder button').filter({hasText:'↓'}).first().click();
  await page.waitForFunction(()=>document.querySelector('#groupOrder li span').textContent.includes('Second lamp'));
  assert.equal(raw.sync.position,1);
  await page.locator('[data-page=light]').click();
  await page.locator('#groupSceneChoices button').filter({hasText:'Mirror effects'}).click();
  await page.waitForFunction(()=>!document.getElementById('effectPane').hidden);
  await page.locator('[data-page=settings]').click();
  await page.locator('#leaveSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Independent'));
  assert.equal(await page.locator('#syncCode').inputValue(),'');
  // Configure rotation, retain unsaved edits through polls, and walk a probe past the old LED count.
  await page.locator('[data-page=light]').click();
  await page.locator('#rotationPane summary').click();
  await page.locator('#rotationEnabled').check();
  await page.locator('#rotationOrder').selectOption('sequential');
  await page.locator('#rotationInterval').fill('2');await page.locator('#rotationUnit').selectOption('60');
  await page.waitForTimeout(2700);assert.equal(await page.locator('#rotationInterval').inputValue(),'2');
  await page.locator('#rotationForm button').click();
  await page.waitForFunction(()=>document.getElementById('rotationBadge').textContent==='Playing'&&!document.getElementById('rotationFields').disabled);
  assert.equal(raw.rotation.seconds,120);assert.equal(raw.rotation.random,false);
  await page.locator('#rotationPane').screenshot({path:'.build/ui-check/effect-rotation.png'});
  await page.locator('[data-page=settings]').click();
  await page.locator('#calibrationPane').evaluate(e=>{let p=e.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}});
  await page.locator('#startCalibration').click();
  await page.waitForFunction(()=>!document.getElementById('calibrationFields').hidden&&!document.getElementById('calibrationFields').disabled);
  assert(await page.locator('#power').isDisabled());
  await page.locator('[data-led-step="10"]').click();
  await page.waitForFunction(()=>document.getElementById('calibrationPositionLabel').value==='144'&&!document.getElementById('calibrationFields').disabled);
  await page.locator('#calibrationPosition').fill('1024');await page.locator('#calibrationPosition').dispatchEvent('change');
  await page.waitForFunction(()=>document.getElementById('calibrationPositionLabel').value==='1024'&&!document.getElementById('calibrationFields').disabled);
  await page.locator('[data-led-step="1"]').click();
  await page.waitForFunction(()=>!document.getElementById('calibrationFields').disabled);assert.equal(raw.calibration.position,1024);
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'calibration overflow at '+width);}
  await page.setViewportSize({width:393,height:852});
  await page.locator('#calibrationPane').screenshot({path:'.build/ui-check/led-calibration.png'});
  await page.locator('#cancelCalibration').click();
  await page.waitForFunction(()=>document.getElementById('calibrationFields').hidden);
  assert.equal(raw.leds,134);assert(await page.locator('#power').isEnabled());
  await page.locator('#syncJoinCode').fill('CL1-112233445566-0123456789abcdef0123456789abcdef');
  await page.locator('#syncJoinForm button').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Following'));
  assert(await page.locator('#power').isDisabled());
  assert(await page.locator('#rotationFields').evaluate(e=>e.disabled));
  await page.locator('#pauseSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Paused'));
  assert(await page.locator('#power').isEnabled());
  await page.locator('#resumeSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Following'));
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);}
  await page.setViewportSize({width:393,height:852});
  await page.locator('.sync-panel').screenshot({path:'.build/ui-check/sync-group-pane.png'});
  await page.locator('[data-page=light]').click();assert(await page.locator('#syncBanner').isVisible());
  await page.locator('#manageSync').click();assert(await page.locator('#syncStatus').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: group discovery, create/code, leave, join, pause/resume, control locking, rotation, LED calibration and 320/393/768px layouts');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
