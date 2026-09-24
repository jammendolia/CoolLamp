// Optional browser regression check. Run from repo root with Playwright available.
// Build mobile/dist first; all lamp requests are intercepted, never sent to hardware.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(), dist=path.join(root,'mobile/dist');
const names=[...fs.readFileSync('LampNetwork.ino','utf8').match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const raw={token:'test-token',deviceId:'aabbccddeeff',hostname:'coollamp-test.local',name:'Studio lamp',ssid:'Studio',leds:134,milliamps:500,midpoint:40,mode:41,brightness:170,startupMode:41,startupBrightness:170,power:true,apiVersion:2,catalogVersion:1,effects:names,colors:names.map((_,i)=>[i>=40?0:1,255,80,0]),effectOptions:names.map(()=>[50,85,1,65,35,255]),vuColors:[[0,255,0],[255,255,0],[255,0,0]],audio:{installed:true,gain:30,gate:32,scale:120,liveTuning:true},firmware:{version:'1.6.1',phase:0,wifi:true,automatic:false}};
const catalog=names.map((name,i)=>({id:i+1,name,category:i>=38?'audio':i>=3&&i<=11?'fire':i>=20&&i<=28?'color':'calm',speed:!(i>=20&&i<=28)}));
fs.mkdirSync(path.join(root,'.build/ui-check'),{recursive:true});
const requests=[],errors=[];
const server=http.createServer((req,res)=>{const pathname=req.url.split('?')[0];const file=path.join(dist,pathname==='/'?'index.html':pathname);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://192.168.1.42/**',async route=>{
   const req=route.request(),url=new URL(req.url()),data=Object.fromEntries(new URLSearchParams(req.postData()||''));
   let body='Saved';
   if(req.method()==='POST'){
    requests.push({path:url.pathname,data});
    if(url.pathname==='/api/preview'){raw.mode=Number(data.mode);raw.brightness=Number(data.brightness);}
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
  assert(await page.locator('#effectAudio').isVisible());
  assert.equal(await page.locator('#primaryColorLabel').textContent(),'Bass color');
  const slider=async(id,value)=>page.locator('#'+id).evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await slider('audioGain',42);await page.waitForTimeout(2800);
  assert.equal(await page.locator('#audioGain').inputValue(),'42','poll must not overwrite unapplied tuning');
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-effect="42"]').click();await page.waitForFunction(()=>document.getElementById('effectTitle').textContent==='Bass Launch');
  assert.equal(await page.locator('#effectTitle').textContent(),'Bass Launch');
  assert.equal(await page.locator('#speedLabel').textContent(),'Pulse speed');
  assert.equal(await page.locator('#audioGain').inputValue(),'42');
  await page.locator('#applyAudio').click();await page.waitForTimeout(100);
  assert.equal(raw.audio.gain,42);assert(await page.locator('#effectPane').isVisible());
  assert(requests.some(r=>r.path==='/api/audio/tuning' && r.data.gain==='42'));
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-effect="41"]').click();await page.waitForFunction(()=>document.getElementById('effectTitle').textContent==='Spectrum Rise');
  await page.locator('#effectPane').screenshot({path:'.build/ui-check/audio-pane.png',style:'nav { visibility:hidden; }'});
  await page.locator('#effect-tab-look').click();await page.waitForTimeout(250);assert.equal(await page.locator('[data-effect-tab][aria-selected=true]').count(),1);await page.locator('#effectPane').screenshot({path:'.build/ui-check/palette-pane.png',style:'nav { visibility:hidden; }'});
  await page.locator('#effect-tab-sound').click();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.build/ui-check/phone-light.png',fullPage:true});
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-effect="22"]').click();await page.waitForFunction(()=>document.getElementById('effectTitle').textContent==='Red');
  assert.equal(await page.locator('#effectTitle').textContent(),'Red');
  assert(!(await page.locator('#effectTabs').isVisible()));assert(!(await page.locator('#motionControls').isVisible()));assert(!(await page.locator('#effectAudio').isVisible()));
  await page.locator('#effectPane').screenshot({path:'.build/ui-check/solid-pane.png',style:'nav { visibility:hidden; }'});
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-effect="30"]').click();await page.waitForFunction(()=>document.getElementById('effectTitle').textContent==='Bouncing droplets - rising');
  assert.equal(await page.locator('#intensityLabel').textContent(),'Density & glow');await page.locator('#effect-tab-motion').click();
  await page.locator('#speed').evaluate(el=>{el.value='74';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(100);assert.equal(raw.effectOptions[29][0],74);
  assert(requests.some(r=>r.path==='/api/effect-options' && r.data.mode==='30'));
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow at '+width);}
  await page.setViewportSize({width:393,height:852});
  await page.locator('[data-page=settings]').click();
  await page.locator('#networkSettings').evaluate(el=>el.closest('details').open=true);
  assert.equal(await page.locator('#audioSettings input').count(),1);
  assert.equal(await page.locator('#networkSettings #audioGain').count(),0);
  await page.locator('[data-page=light]').click();
  await page.locator('#effect-tab-look').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#effect-tab-motion').getAttribute('aria-selected'),'true');
  await page.locator('[data-page=settings]').click();
  await page.locator('#audioSettings').screenshot({path:'.build/ui-check/hardware-setting.png'});
  await page.locator('[data-page=light]').click();
  await page.locator('#effectLibrary').evaluate(e=>e.open=true);await page.locator('[data-effect="46"]').click();await page.waitForFunction(()=>document.getElementById('effectTitle').textContent==='VU Meter');
  await page.locator('#effect-tab-look').click();assert(await page.locator('#vuControls').isVisible());assert(!(await page.locator('#colorControls').isVisible()));
  await page.locator('#vuLow').fill('#123456');await page.waitForTimeout(2800);assert.equal(await page.locator('#vuLow').inputValue(),'#123456');
  await page.locator('#applyVu').click();await page.waitForTimeout(150);assert.deepEqual(raw.vuColors[0],[18,52,86]);
  await page.locator('#resetVu').click();await page.waitForTimeout(150);assert.deepEqual(raw.vuColors,[[0,255,0],[255,255,0],[255,0,0]]);
  await page.locator('#effectPane').screenshot({path:'.build/ui-check/vu-pane.png',style:'nav { visibility:hidden; }'});
  delete raw.effectOptions;await page.waitForTimeout(2800);
  await page.locator('[data-page=light]').click();assert(!(await page.locator('#effect-tab-motion').isVisible()));
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile effect panes, shared tuning, dirty-state polling, live apply, effect-specific option writes, solid controls, hardware-only audio settings, 320/393/768px overflow checks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
