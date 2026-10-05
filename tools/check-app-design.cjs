// Optional browser regression check. Run from repo root with Playwright available.
// Build mobile/dist first; all lamp requests are intercepted, never sent to hardware.
const {chromium}=require('playwright');
const axePath=require.resolve('axe-core/axe.min.js');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(), dist=path.join(root,'mobile/dist');
const names=[...fs.readFileSync('LampNetwork.ino','utf8').match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const raw={token:'test-token',deviceId:'aabbccddeeff',hostname:'coollamp-test.local',name:'Studio lamp',ssid:'Studio',leds:134,milliamps:500,midpoint:40,mode:41,brightness:170,startupMode:41,startupBrightness:170,power:true,apiVersion:2,catalogVersion:1,effects:names,colors:names.map((_,i)=>[i>=40?0:1,255,80,0]),effectOptions:names.map(()=>[50,85,1,65,35,255]),fountainColors:[[255,65,0],[0,230,130],[75,30,255]],vuColors:[[0,255,0],[255,255,0],[255,0,0]],audio:{installed:true,gain:30,gate:32,scale:120,liveTuning:true},firmware:{version:'1.8.1',latest:'1.8.1',phase:0,progress:0,error:0,available:false,wifi:true,automatic:false}};
const catalog=names.map((name,i)=>({id:i+1,name,category:i>=38?'audio':i>=3&&i<=11?'fire':i>=20&&i<=28?'color':'calm',speed:!(i>=20&&i<=28)}));
fs.mkdirSync(path.join(root,'.build/ui-check'),{recursive:true});
raw.sync={version:2,sceneCount:18,scene:0,sceneSpeed:50,sceneIntensity:85,scenePrimary:[70,220,255],sceneSecondary:[255,65,170],position:0,count:2,members:1,order:[{id:'aabbccddeeff',name:'Studio lamp',online:true},{id:'112233445566',name:'Second lamp',online:true}],role:0,peers:[{id:'112233445566',name:'Living room',role:1,microphone:true}]};
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
    if(url.pathname==='/api/firmware/check')Object.assign(raw.firmware,{available:true,latest:'1.8.2',phase:2});
    if(url.pathname==='/api/firmware/install')Object.assign(raw.firmware,{phase:3,progress:28});
    if(url.pathname==='/api/firmware/automatic')raw.firmware.automatic=data.enabled==='1';
    if(url.pathname==='/api/config')Object.assign(raw,{ssid:data.ssid,leds:Number(data.leds),milliamps:Number(data.milliamps),startupMode:Number(data.mode),startupBrightness:Number(data.brightness)});
    if(url.pathname==='/api/geometry')raw.midpoint=Number(data.midpoint);
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
    if(url.pathname==='/api/power'){raw.power=data.on==='1';if(raw.sync.active)Object.assign(raw.sync,{active:false,paused:true});}
    if(url.pathname==='/api/preview'){raw.mode=Number(data.mode);raw.brightness=Number(data.brightness);}
    if(url.pathname==='/api/fountain-colors')raw.fountainColors=data.reset?[[255,65,0],[0,230,130],[75,30,255]]:[0,1,2].map(i=>['r','g','b'].map(k=>Number(data[k+i])));
    if(url.pathname==='/api/vu-colors')raw.vuColors=data.reset?[[0,255,0],[255,255,0],[255,0,0]]:[0,1,2].map(i=>['r','g','b'].map(k=>Number(data[k+i])));
    if(url.pathname==='/api/audio/tuning')Object.assign(raw.audio,{gain:Number(data.gain),gate:Number(data.gate),scale:Number(data.scale)});
    if(url.pathname==='/api/color')raw.colors[Number(data.mode)-1]=[1,Number(data.r),Number(data.g),Number(data.b)];
    if(url.pathname==='/api/effect-options')raw.effectOptions[Number(data.mode)-1]=['speed','intensity','dual','r','g','b'].map(k=>Number(data[k]));
   }else body=JSON.stringify(url.pathname==='/api/scan'?{status:'complete',networks:[{ssid:'Home test',open:false}]}:url.pathname==='/api/effects'?catalog:raw);
   await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'text/plain'},body});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('[data-page=light]').click();assert(await page.locator('#lightEmpty').isVisible());assert(await page.locator('#brightness').isDisabled());
  await page.locator('[data-page=settings]').click();assert(await page.locator('#saveIdentity').isDisabled());
  await page.locator('[data-page=lamps]').click();
  await page.locator('#addLamp').evaluate(e=>e.open=true);
  await page.locator('#address').fill('192.168.1.42');await page.locator('#password').fill('test-password');
  await page.locator('#wifiConnect button').click();
  await page.locator('#effectTitle').filter({hasText:'Spectrum Rise'}).waitFor();

  const audit=async name=>{
    await page.addScriptTag({path:axePath});
    const result=await page.evaluate(async()=>await axe.run(document.querySelector('#app'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    fs.writeFileSync('.build/ui-redesign/axe-'+name+'.json',JSON.stringify(result,null,2));
    assert.deepEqual(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[],name+' accessibility violations');
  };
  const screenshot=async name=>{await page.locator('#toast').evaluate(e=>e.hidden=true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({animations:'disabled',path:'.build/ui-redesign/'+name+'.png'});};
  await audit('audio');await screenshot('phone-light');
  assert(await page.locator('#brightness').isVisible(),'brightness remains visible on Sound tab');
  await page.locator('#effect-tab-motion').click();assert(await page.locator('#brightness').isVisible());
  await page.locator('#brightness').fill('128');await page.locator('#brightness').dispatchEvent('change');
  await page.waitForFunction(()=>!document.getElementById('brightness').disabled);
  assert.equal(raw.brightness,128);assert(requests.some(r=>r.path==='/api/preview'&&r.data.keepPower==='1'&&r.data.mode==='41'));
  await page.locator('#effect-tab-sound').click();
  await page.locator('#audioGain').fill('43');await page.locator('#audioGain').dispatchEvent('input');
  await page.locator('[data-page=lamps]').click();await screenshot('phone-lamps');await audit('lamps');
  await page.locator('.lamp-card').filter({hasText:'Studio lamp'}).click();assert.equal(await page.locator('#audioGain').inputValue(),'43','returning to current lamp retains its sound draft');
  await page.locator('#favoriteEffect').click();
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-category=favorites]').click();
  assert.equal(await page.locator('[data-effect]:not(:disabled)').count(),1);
  await page.locator('[data-category=all]').click();await page.locator('#effectSearch').fill('fountain');
  assert.equal(await page.locator('[data-effect]:not(:disabled)').count(),1);
  await page.locator('#effectSearch').fill('');await screenshot('phone-library');await audit('library');
  await page.locator('#effectLibrary').evaluate(e=>e.open=false);
  await page.locator('[data-page=settings]').click();await screenshot('phone-overview');await audit('overview');
  await page.locator('[data-settings-section=hardware]').click();assert(await page.locator('#geometrySettings').isVisible());
  await page.waitForTimeout(2700);assert(await page.locator('#networkForm').isHidden());
  await screenshot('phone-hardware');await audit('hardware');
  assert.equal(await page.locator('#leds').evaluate(el=>el.form.id),'hardwareForm');
  await page.locator('#midpoint').fill('38');await page.locator('#geometryForm button').click();
  await page.waitForFunction(()=>!document.getElementById('networkSettings').disabled);assert.equal(raw.midpoint,38);
  await page.locator('#leds').fill('88');
  await page.locator('[data-settings-section=network]').click();
  assert(await page.locator('#geometrySettings').isHidden());await page.waitForTimeout(2700);assert(await page.locator('#geometrySettings').isHidden(),'polls must not reveal hardware in network');
  await page.locator('#scanWifi').click();await page.waitForFunction(()=>document.querySelector('#networks option[value="Home test"]'));
  await page.locator('#networks').selectOption('Home test');assert.equal(await page.locator('#ssid').inputValue(),'Home test');
  await page.locator('#wifiPassword').fill('network-pass');
  await screenshot('phone-network');await audit('network');
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#networkForm button:not([type=button])').last().click();
  await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Not connected');
  assert.equal(await page.locator('#leds').inputValue(),'','disconnected hardware must not display the previous lamp’s values');
  const networkSave=requests.findLast(r=>r.path==='/api/config').data;
  assert.equal(networkSave.leds,'134','network form cannot save an unfinished hardware draft');assert.equal(networkSave.ssid,'Home test');
  await page.locator('[data-page=lamps]').click();await page.locator('.lamp-card').filter({hasText:'Studio lamp'}).click();
  await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Wi-Fi');
  await page.locator('[data-page=settings]').click();await page.locator('[data-settings-section=network]').click();
  await page.locator('#adminPassword').fill('unapplied-pass');await page.locator('#forgetWifi').check();
  await page.locator('[data-settings-section=hardware]').click();await page.locator('#leds').fill('88');
  await page.locator('#hardwareForm button').click();await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Not connected');
  const hardwareSave=requests.findLast(r=>r.path==='/api/config').data;
  assert.equal(hardwareSave.ssid,'Home test');assert.equal(hardwareSave.leds,'88');assert(!('adminPassword' in hardwareSave));assert(!('forgetWifi' in hardwareSave));
  await page.locator('[data-page=lamps]').click();await page.locator('.lamp-card').filter({hasText:'Studio lamp'}).click();
  await page.waitForFunction(()=>document.getElementById('connectionBadge').textContent==='Wi-Fi');
  await page.locator('[data-page=settings]').click();await page.locator('[data-settings-section=updates]').click();
  await page.locator('#autoUpdate').check();await page.waitForFunction(()=>!document.getElementById('firmwareControls').disabled);assert(raw.firmware.automatic);
  await page.locator('#checkFirmware').click();await page.waitForFunction(()=>document.getElementById('firmwareStatus').textContent.includes('1.8.2'));
  await screenshot('phone-updates');await audit('updates');
  await page.locator('#installFirmware').click();await page.waitForFunction(()=>!document.getElementById('firmwareProgress').hidden);
  assert.equal(await page.locator('#firmwareProgress').getAttribute('value'),'28');assert(await page.locator('#checkFirmware').isDisabled());
  Object.assign(raw.firmware,{phase:5,error:3,available:true});await page.waitForFunction(()=>document.getElementById('firmwareStatus').textContent.includes('release server'));
  assert(await page.locator('#checkFirmware').isEnabled());assert(await page.locator('#installFirmware').isEnabled());
  await screenshot('phone-update-error');
  Object.assign(raw.firmware,{phase:0,error:0,available:false});
  await page.locator('[data-settings-section=groups]').click();await page.locator('#createSync').click();
  await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Coordinating'));await audit('group-settings');
  await page.locator('[data-page=light]').click();await page.locator('#groupSceneLibrary').evaluate(e=>e.open=true);
  await page.locator('#sceneSearch').fill('prism');assert.equal(await page.locator('#groupSceneChoices button:visible').count(),1);
  await page.locator('#sceneSearch').fill('unmatched scene');assert(await page.locator('#sceneSearchEmpty').isVisible());
  await page.locator('#sceneSearch').fill('');await page.locator('[data-scene="1"]').click();
  await page.waitForFunction(()=>document.getElementById('groupSceneTitle').textContent==='Portal');
  assert(await page.locator('#groupSceneLibrary').evaluate(e=>!e.open));assert(await page.locator('#brightness').isEnabled());
  await screenshot('phone-group');await audit('group-scene');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [320,393,768,1280]){
    await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
    await page.locator('[data-page=settings]').click();
    for(const section of ['overview','groups','hardware','network','updates']){await page.locator('[data-settings-section='+section+']').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'settings overflow '+section+' at '+width);}
    await page.locator('[data-page=light]').click();
  }
  assert.equal(await page.locator('#power').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.setViewportSize({width:393,height:852});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  for(const target of ['light','settings','lamps']){await page.locator('[data-page='+target+']').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% text overflow on '+target);}
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.locator('[data-page=light]').click();
  await page.setViewportSize({width:768,height:1024});await screenshot('tablet-group');
  await page.setViewportSize({width:393,height:852});
  await page.locator('#groupSceneLibrary').evaluate(e=>e.open=true);await page.locator('[data-scene="0"]').click();
  await page.waitForFunction(()=>!document.getElementById('effectPane').hidden);
  await page.locator('#effect-tab-motion').click();
  await page.locator('#effect-tab-look').focus();await page.keyboard.press('End');
  assert.equal(await page.locator('#effect-tab-sound').getAttribute('aria-selected'),'true');
  assert(await page.locator('#effect-tab-sound').evaluate(el=>el.getBoundingClientRect().bottom<document.querySelector('nav').getBoundingClientRect().top),'keyboard focus is above navigation');
  await page.locator('#effectPane').screenshot({animations:'disabled',path:'.build/ui-redesign/audio-detail.png',style:'nav,#toast {visibility:hidden}'});
  assert.deepEqual(errors,[]);
  console.log('PASS: redesign navigation, favorites/search, global brightness, draft isolation, Wi-Fi scanning, firmware updates/errors, accessible labels/contrast, reduced motion and 320/393/768/1280px layouts');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
