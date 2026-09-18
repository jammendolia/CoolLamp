import { BleClient } from '@capacitor-community/bluetooth-le';
import { LampTransport } from './transport.js';
import { effects, firmwareMessage } from './protocol.js';
import './style.css';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { LampStore, lampAddress } from './lamps.js';
import { WifiTransport } from './wifi.js';
const native = registerPlugin('LampNetwork');
const store = new LampStore(localStorage);
let selected = null, lamp = null, connecting = false, discovered = [], category = 'all';
const isNative = Capacitor.isNativePlatform();
const sessionPasswords = new Map();
async function credential(id, value) {
  if (isNative) return native.credential({id, ...(value === undefined ? {} : {value})});
  if (value !== undefined) sessionPasswords.set(id,value);
  return {value:sessionPasswords.get(id)||''};
}
function page(name) {
  for (const item of ['lamps','light','settings']) $('page-'+item).hidden=item!==name;
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  window.scrollTo(0,0);
}


const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
let state = null, editingBrightness = false, busy = false;
let firmware = null;
let effectOptions = null, editingOptions = false;
function renderOptions() {
  const supported = Boolean(state?.capabilities & 8);
  $('effectOptions').hidden = !supported;
  const ready = supported && effectOptions?.mode === state.mode;
  $('effectOptions').disabled = !ready;
  if (!ready || editingOptions) return;
  $('speed').value = effectOptions.speed;
  $('intensity').value = effectOptions.intensity;
  $('speedValue').value = effectOptions.speed + '%';
  $('intensityValue').value = effectOptions.intensity + '%';
  $('speed').disabled = state.mode >= 21 && state.mode <= 29;
  $('dual').checked = Boolean(effectOptions.dual);
  $('secondaryColor').disabled = !effectOptions.dual;
  $('secondaryColor').value = '#' + [effectOptions.r,effectOptions.g,effectOptions.b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function renderFirmware() {
  const updating = firmware && [1,3,4].includes(firmware.phase);
  $('firmwareVersion').textContent = state ? firmware?.version || 'Older firmware' : 'Connect to view';
  $('firmwareStatus').textContent = state ? firmwareMessage(firmware) : 'Connect to view update status.';
  $('firmwareControls').disabled = !state || !firmware || busy || updating;
  $('autoUpdate').checked = Boolean(firmware?.automatic);
  $('checkFirmware').disabled = !firmware?.wifi;
  $('installFirmware').disabled = !firmware?.wifi || !firmware?.available;
}
let savedDevice = null;
try { const saved = JSON.parse(localStorage.getItem('coollamp-device')); if (typeof saved?.deviceId === 'string') savedDevice = saved; } catch {}
$('reconnect').hidden = !savedDevice;
if (savedDevice) status('Reconnect to your saved lamp. There is no need to enter pairing mode again.');
const callbacks = {
  onOptions(next) { effectOptions = next; renderOptions(); },
  onFirmware(next) { firmware = next; renderFirmware(); },
  onState(next) {
    state = next;
    filterEffects();
    $('colorControls').hidden = !next.supportsColor;
    $('colorUpgrade').hidden = next.supportsColor;
    if (next.color) {
      $('color').value = '#' + [next.color.r,next.color.g,next.color.b].map(v => v.toString(16).padStart(2,'0')).join('');
      $('colorHint').textContent = next.color.enabled ? 'Your color is active for this effect.' : 'Original colors are active. Pick a color to customize this effect.';
      $('resetColor').textContent = next.capabilities & 8 ? 'Restore effect defaults' : next.mode === 29 ? 'Reset color' : 'Restore original colors';
    }
    $('power').textContent = next.power ? 'Turn off' : 'Turn on';
    $('power').setAttribute('aria-pressed', String(next.power));
    if (!editingBrightness) { $('brightness').value = next.brightness; brightnessLabel(); }
    $('effect').value = next.mode;
    document.documentElement.style.setProperty('--lamp-color', next.color?.enabled ? $('color').value : '#70e1c9');
    $('favoriteEffect').setAttribute('aria-pressed',String(Boolean(selected?.favorites?.includes(next.mode))));
    renderOptions();
  },
  onDisconnect() {
    firmware = null; effectOptions = null;
    state = null; $('controls').disabled = true; $('disconnect').hidden = true;
    renderFirmware();
    renderOptions();
    $('connect').hidden = false; editingBrightness = false;
    $('reconnect').hidden = !savedDevice;
    $('connectionBadge').textContent='Not connected';
    $('networkSettings').disabled=true;
    $('identify').disabled=true;
    if (!connecting) status('Disconnected. Choose a lamp to reconnect.');
  }
};
const bleLamp = new LampTransport(BleClient, callbacks);
const wifiLamp = new WifiTransport(CapacitorHttp, {...callbacks,onError:e=>{status(e.message); if(selected?.deviceId && !connecting) connect(selected);}});
lamp=bleLamp;
effects.forEach((name, i) => $('effect').add(new Option(name, i + 1)));
function brightnessLabel() { $('brightnessValue').value = Math.round(Number($('brightness').value) * 100 / 255) + '%'; }
async function change(operation, value) {
  if (busy) return;
  busy = true; $('controls').disabled = true; renderFirmware();
  try { await lamp.command(operation, value); status(operation === 'saveDefaults' ? 'Startup settings saved.' : 'Connected • Changes applied.'); }
  catch (error) { status(error.message); }
  finally { busy = false; $('controls').disabled = !state; renderFirmware(); }
}
async function connect(saved = null) {
  if(connecting||busy)return;
  connecting=true; $('connect').disabled=true; status('Connecting over Bluetooth…');
  await lamp.disconnect(); lamp=bleLamp;
  try {
    const device=await lamp.connect(saved?.deviceId?saved:null);
    const prior=store.items.find(x=>x.id===device.lampId || x.deviceId===device.deviceId);
    selected=store.upsert({...prior,id:device.lampId||prior?.id||'ble:'+device.deviceId,deviceId:device.deviceId,name:prior?.name||device.name||'CoolLamp'});
    savedDevice=device; connected('Bluetooth');
  } catch(e) { status(e.message||'Could not connect over Bluetooth.'); }
  finally { connecting=false; $('connect').disabled=false; }
}
function connected(kind) {
  localStorage.setItem('coollamp-selected',selected.id);
  $('controls').disabled=false; $('disconnect').hidden=false;
  $('connectionBadge').textContent=kind; $('lampTitle').textContent=selected.name;
  $('lampRoom').textContent=selected.room||'YOUR LAMP';
  $('lampName').value=selected.name; $('room').value=selected.room||'';
  $('settingsConnection').textContent=selected.name+' · '+kind;
  $('identify').disabled=kind!=='Wi-Fi'||!wifiLamp.raw?.apiVersion;
  $('networkSettings').disabled=kind!=='Wi-Fi';
  if(kind==='Wi-Fi')fillNetwork();
  status('Connected to '+selected.name+'.');renderLamps(); filterEffects();page('light');
}
async function connectWifi(entry,password) {
  if(connecting||busy)return;
  connecting=true;status('Connecting over Wi-Fi…');
  await lamp.disconnect(); lamp=wifiLamp;
  try {
    if(password===undefined) password=(await credential(entry.id)).value;
    if(!password){$('address').value=entry.address;$('addLamp').open=true;page('lamps');$('password').focus();throw new Error('Enter the lamp access password to connect.');}
    const raw=await wifiLamp.connect(entry.address,password,entry.id);
    const id=raw.deviceId||raw.hostname.replace(/\.local$/,'');
    const prior=store.items.find(x=>x.id===id);
    selected=store.upsert({...prior,id,address:lampAddress(entry.address),hostname:raw.hostname,name:raw.name||prior?.name||entry.name||'CoolLamp'});
    let warning='';try {await credential(id,password);}catch(e){warning=e.message;}
    $('password').value='';connected('Wi-Fi');if(warning)status('Connected. '+warning);
  } catch(e) { status(e.message); }
  finally { connecting=false; }
}
$('connect').onclick=()=>connect();
$('reconnect').onclick=()=>connect(savedDevice);
$('disconnect').onclick=()=>lamp.disconnect();
$('power').onclick = () => change('power', state.power ? 0 : 1);
$('effect').onchange = () => change('effect', Number($('effect').value));
$('brightness').oninput = () => { editingBrightness = true; brightnessLabel(); };
$('brightness').onchange = async () => { const value = Number($('brightness').value); editingBrightness = false; await change('brightness', value); };
$('save').onclick = () => change('saveDefaults');
$('color').onchange = () => {
  const hex = $('color').value.slice(1);
  change('color', {mode: state.mode, r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16)});
};
$('resetColor').onclick = () => change('resetColor', state.mode);
$('checkFirmware').onclick = () => change('checkFirmware');
$('installFirmware').onclick = () => change('installFirmware');
$('autoUpdate').onchange = () => change('autoUpdate', Number($('autoUpdate').checked));
for (const id of ['speed','intensity']) $(id).oninput = () => { editingOptions=true; $(id+'Value').value = $(id).value + '%'; };
for (const id of ['speed','intensity','dual','secondaryColor']) $(id).onchange = async () => {
  if (!state || effectOptions?.mode !== state.mode) return;
  const hex = $('secondaryColor').value.slice(1);
  await change('effectOptions', {mode:state.mode, speed:Number($('speed').value), intensity:Number($('intensity').value),
    dual:Number($('dual').checked),r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)});
  editingOptions=false;
  renderOptions();
};

function renderLamps() {
  $('lampList').replaceChildren();
  const merged=new Map(store.items.map(x=>[x.id,x]));
  for(const entry of discovered)merged.set(entry.id,{...entry,...merged.get(entry.id),address:entry.address});
  $('emptyLamps').hidden=merged.size>0;
  for(const entry of merged.values()) {
    const button=document.createElement('button');button.className='lamp-card';
    const title=document.createElement('strong');title.textContent=entry.name||'CoolLamp';
    const detail=document.createElement('span');detail.textContent=[entry.room,discovered.some(x=>x.id===entry.id)?'Found on Wi-Fi':entry.address?'Saved Wi-Fi lamp':'Saved Bluetooth lamp'].filter(Boolean).join(' · ');
    button.append(title,detail);button.disabled=connecting;
    button.onclick=async()=>{
      if(entry.address) {
        await connectWifi(entry);
        if(!state&&entry.deviceId)await connect(entry);
      } else await connect(entry);
    };$('lampList').append(button);
  }
}
async function discover() {
  if(!isNative){status('Automatic discovery is available in the iPhone and Android app. You can enter a lamp address here.');return;}
  $('discover').disabled=true;status('Looking for lamps on your Wi-Fi…');
  try {
    const result=await native.discover();discovered=result.lamps.filter(x=>{try{lampAddress(x.address);return typeof x.id==='string'&&x.id.length<=128;}catch{return false;}});
    renderLamps();status(discovered.length?'Choose a lamp to connect.':'No lamps found. Check Local Network permission and that your phone and lamp use the same home network. You can also enter its address or use Bluetooth.');
    const remembered=store.items.find(x=>x.id===localStorage.getItem('coollamp-selected'));
    const available=remembered&&discovered.find(x=>x.id===remembered.id);
    if(available&&!state&&!connecting)await connectWifi({...remembered,address:available.address});
  }catch(e){status(e.message);}finally{$('discover').disabled=false;}
}
$('discover').onclick=discover;
$('wifiConnect').onsubmit=e=>{e.preventDefault();const address=$('address').value.trim();let normalized;try{normalized=lampAddress(address);}catch(e){status(e.message);return;}const entry=discovered.find(x=>x.address===normalized)||store.items.find(x=>x.address===normalized)||{address:normalized};connectWifi(entry,$('password').value||undefined);};
for(const button of document.querySelectorAll('[data-page]'))button.onclick=()=>page(button.dataset.page);
function filterEffects() {
  const query=$('effectSearch').value.trim().toLowerCase();
  const names=lamp===wifiLamp&&wifiLamp.raw?wifiLamp.raw.effects:effects.slice(0,state?.effectCount||effects.length);
  const ids={calm:[1,2,3,13,30,32,33,36,37],fire:[4,5,6,7,8,9,10,11,12],color:[14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,31,34,35]};
  $('effect').replaceChildren();
  names.forEach((name,i)=>{const mode=i+1;if((!query||name.toLowerCase().includes(query))&&(category==='all'||(category==='favorites'?selected?.favorites?.includes(mode):ids[category]?.includes(mode))))$('effect').add(new Option(name,mode));});
  if(state)$('effect').value=state.mode;
  if(!$('effect').options.length){const option=new Option('No matching effects','');option.disabled=true;$('effect').add(option);}
}
$('effectSearch').oninput=filterEffects;
for(const button of document.querySelectorAll('[data-category]'))button.onclick=()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));filterEffects();};
$('favoriteEffect').onclick=()=>{if(!selected||!state)return;const favorites=new Set(selected.favorites||[]);if(favorites.has(state.mode))favorites.delete(state.mode);else favorites.add(state.mode);selected=store.upsert({...selected,favorites:[...favorites]});$('favoriteEffect').setAttribute('aria-pressed',String(favorites.has(state.mode)));filterEffects();};
function fillNetwork() {
  const raw=wifiLamp.raw;
  for(const id of ['ssid','leds','milliamps'])$(id).value=raw[id];
  $('startupMode').replaceChildren(...raw.effects.map((x,i)=>new Option(x,i+1)));
  $('startupMode').value=raw.startupMode||raw.mode;$('startupBrightness').value=raw.startupBrightness||raw.brightness;
  for(const id of ['wifiPassword','adminPassword'])$(id).value='';
  for(const id of ['openNetwork','forgetWifi'])$(id).checked=false;
}
async function networkAction(action) {
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  busy=true;$('networkSettings').disabled=true;
  try{await wifiLamp.enqueue(action);}catch(e){if(e.uncertain)await wifiLamp.disconnect();status(e.message);}finally{busy=false;$('networkSettings').disabled=lamp!==wifiLamp||!state;}
}
$('identityForm').onsubmit=async e=>{
  e.preventDefault();if(!selected||busy||connecting)return;
  const name=$('lampName').value.trim(),room=$('room').value.trim();if(!name)return;
  if(new TextEncoder().encode(name).length>48){status('Use a lamp name of at most 48 UTF-8 bytes.');return;}
  busy=true;
  try {
    if(lamp===wifiLamp&&state&&wifiLamp.raw.apiVersion)await wifiLamp.enqueue(()=>wifiLamp.request('/api/name',{name}));
    selected=store.upsert({...selected,name,room});$('lampTitle').textContent=name;$('lampRoom').textContent=room||'YOUR LAMP';renderLamps();status(lamp===wifiLamp&&wifiLamp.raw?.apiVersion?'Lamp name saved. Room saved on this phone.':'Name and room saved on this phone.');
  }catch(e){status(e.message);}finally{busy=false;}
};
$('identify').onclick=()=>networkAction(async()=>status(await wifiLamp.request('/api/identify',{})));
$('pairingStatus').onclick=()=>networkAction(async()=>{const result=await wifiLamp.request('/api/bluetooth');const value=typeof result==='string'?JSON.parse(result):result;status(value.pairing?'Pairing is open.':'Pairing is closed. Hold the knob for six seconds to open it.');});
$('forgetPhones').onclick=()=>{if(confirm('Remove every phone paired with this lamp? Hold its knob for six seconds to open pairing first.'))networkAction(async()=>status(await wifiLamp.request('/api/bluetooth/forget',{})));};
$('scanWifi').onclick=()=>networkAction(async()=>{
  status('Scanning Wi-Fi networks…');await wifiLamp.request('/api/scan',{});
  const epoch=wifiLamp.epoch;
  for(let attempt=0;attempt<25;attempt++) {
    await new Promise(r=>setTimeout(r,1000));if(epoch!==wifiLamp.epoch)throw new Error('Connection changed.');
    const result=await wifiLamp.request('/api/scan');const scan=typeof result==='string'?JSON.parse(result):result;
    if(scan.status==='failed')throw new Error('Wi-Fi scan failed. Try again.');
    if(scan.status==='complete'){$('networks').replaceChildren(new Option('Choose a network or enter its name below',''),...scan.networks.map(x=>{const o=new Option(x.ssid+(x.open?' (open)':''),x.ssid);o.dataset.open=String(x.open);return o;}));status('Wi-Fi scan complete.');return;}
  }throw new Error('Wi-Fi scan timed out. Try again.');
});
$('networks').onchange=()=>{if($('networks').value){$('ssid').value=$('networks').value;$('openNetwork').checked=$('networks').selectedOptions[0].dataset.open==='true';}};
$('networkForm').onsubmit=e=>{
  e.preventDefault();if(!confirm('Save these settings and restart this lamp?'))return;
  networkAction(async()=>{
    const data={};for(const id of ['ssid','wifiPassword','adminPassword','leds','milliamps'])data[id]=$(id).value;
    data.mode=$('startupMode').value;data.brightness=$('startupBrightness').value;data.openNetwork=Number($('openNetwork').checked);data.forgetWifi=Number($('forgetWifi').checked);
    const message=await wifiLamp.request('/api/config',data);
    if(data.adminPassword)await credential(selected.id,data.adminPassword);
    await wifiLamp.disconnect();status(message+' Find the lamp again after it restarts.');
  });
};
$('forgetLamp').onclick=async()=>{if(!selected||!confirm('Remove this lamp from this phone? The lamp’s own settings stay saved.'))return;const id=selected.id;await lamp.disconnect();try{await credential(id,'');}catch(e){status(e.message);return;}store.remove(id);selected=null;renderLamps();page('lamps');status('Lamp removed from this phone.');};
renderLamps();
if(isNative)discover();
