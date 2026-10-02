// Optional browser regression check. Run from repo root with Playwright available.
// Build mobile/dist first; all lamp requests are intercepted, never sent to hardware.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(), dist=path.join(root,'mobile/dist');
const names=[...fs.readFileSync('LampNetwork.ino','utf8').match(/effectNames\[\] = \{([\s\S]*?)\};/)[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const raw={token:'test-token',deviceId:'aabbccddeeff',hostname:'coollamp-test.local',name:'Studio lamp',ssid:'Studio',leds:134,milliamps:500,midpoint:40,mode:41,brightness:170,startupMode:41,startupBrightness:170,power:true,apiVersion:2,catalogVersion:1,effects:names,colors:names.map((_,i)=>[i>=40?0:1,255,80,0]),effectOptions:names.map(()=>[50,85,1,65,35,255]),fountainColors:[[255,65,0],[0,230,130],[75,30,255]],vuColors:[[0,255,0],[255,255,0],[255,0,0]],audio:{installed:true,gain:30,gate:32,scale:120,liveTuning:true},firmware:{version:'1.6.1',phase:0,wifi:true,automatic:false}};
const catalog=names.map((name,i)=>({id:i+1,name,category:i>=38?'audio':i>=3&&i<=11?'fire':i>=20&&i<=28?'color':'calm',speed:!(i>=20&&i<=28)}));
fs.mkdirSync(path.join(root,'.build/ui-check'),{recursive:true});
raw.sync={version:1,role:0,peers:[{id:'112233445566',name:'Living room',role:1,microphone:true}]};
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
    if(url.pathname==='/api/sync'){
      if(data.action==='pause')Object.assign(raw.sync,{paused:true,active:false});
      else if(data.action==='resume')Object.assign(raw.sync,{paused:false,active:true});
      else Object.assign(raw.sync,{role:Number(data.role),leader:data.leader||'',paused:false,active:data.role==='2'});
    }

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
  await page.locator('#leaveSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Independent'));
  assert.equal(await page.locator('#syncCode').inputValue(),'');
  await page.locator('#syncJoinCode').fill('CL1-112233445566-0123456789abcdef0123456789abcdef');
  await page.locator('#syncJoinForm button').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Following'));
  assert(await page.locator('#power').isDisabled());
  await page.locator('#pauseSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Paused'));
  assert(await page.locator('#power').isEnabled());
  await page.locator('#resumeSync').click();await page.waitForFunction(()=>document.getElementById('syncStatus').textContent.includes('Following'));
  for(const width of [320,393,768]){await page.setViewportSize({width,height:852});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);}
  await page.setViewportSize({width:393,height:852});
  await page.locator('.sync-panel').screenshot({path:'.build/ui-check/sync-group-pane.png'});
  await page.locator('[data-page=light]').click();assert(await page.locator('#syncBanner').isVisible());
  await page.locator('#manageSync').click();assert(await page.locator('#syncStatus').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: group discovery, create/code, leave, join, pause/resume, control locking and 320/393/768px layouts');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
