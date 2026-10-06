import { BleClient } from '@capacitor-community/bluetooth-le';
import { LampTransport } from './transport.js';
import { firmwareMessage } from './protocol.js';
import './style.css';
import { configurationPayload } from './settings.js';
import { effectSettings } from './effect-settings.js';
import { availableGroupScenes, groupScenes, groupSceneSettings, moveGroupLamp } from './group-scenes.js';
import { createGroupCode, parseGroupCode, groupStatus } from './sync.js';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { LampStore, LampDiscoverySession, lampAddress } from './lamps.js';
import { WifiTransport } from './wifi.js';
import { wifiSetupMessage } from './wifi-setup.js';
const native = registerPlugin('LampNetwork');
const store = new LampStore(localStorage);
const discovery = new LampDiscoverySession();
let selected = null, lamp = null, connecting = false, discovered = [], category = 'all';
let effectListKey = '', settingsView = 'overview';
let bleWifiStatus=null, wifiSetupAbort=null, wifiSetupSerial=0;
let resetTarget=null;
let centerStatus=null,centerTimer=null,centerSerial=0,centerWasActive=false;
const bluetoothWifiAvailable=()=>lamp===bleLamp&&bleLamp.supportsWifiSetup&&Boolean(state);
const isNative = Capacitor.isNativePlatform();
const sessionPasswords = new Map();
async function credential(id, value) {
  if (isNative) return native.credential({id, ...(value === undefined ? {} : {value})});
  if (value !== undefined) sessionPasswords.set(id,value);
  return {value:sessionPasswords.get(id)||''};
}
function page(name) {
  if(name==='lamps')renderLamps();
  for (const item of ['lamps','light','settings']) $('page-'+item).hidden=item!==name;
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(name==='settings')renderSettings();
  window.scrollTo(0,0);
  $('page-'+name).querySelector('h2')?.focus({preventScroll:true});
}


const $ = id => document.getElementById(id);
let toastTimer;
const status = message => { $('status').textContent = message; $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); };
let state = null, editingBrightness = false, busy = false;
let firmware = null;
let effectOptions = null, editingOptions = false;
let vuDirty = false, fountainDirty = false;
let groupSceneDirty=false,groupAudioDirty=false,sceneChoicesKey='',groupOrderKey='';
let audioDirty = false, effectTab = 'look', paneMode = null;
function paintRanges() {
  for(const slider of document.querySelectorAll('input[type=range]')) {
    const fraction=(Number(slider.value)-Number(slider.min))/(Number(slider.max)-Number(slider.min));
    const label=document.querySelector('label[for="'+slider.id+'"] output');
    if(label)slider.setAttribute('aria-valuetext',label.value||label.textContent);
    slider.style.setProperty('--fill',Math.max(0,Math.min(100,fraction*100))+'%');
  }
}
function renderEffectPane() {
  const entry=state && lamp?.catalog?.find(x=>x.id===state.mode);
  const groupActive=lamp===wifiLamp && state?.sync?.scene>0;
  $('effectPane').hidden=!entry||groupActive;
  if(!entry||groupActive)return;
  const profile=effectSettings(entry);
  if(paneMode!==entry.id){effectTab=profile.audio?'sound':'look';paneMode=entry.id;}
  const motionAvailable=Boolean(state.capabilities&8)&&(profile.motion||profile.intensity);
  $('effect-tab-motion').hidden=!motionAvailable;
  $('effect-tab-sound').hidden=!profile.audio;
  if((effectTab==='sound'&&!profile.audio)||(effectTab==='motion'&&!motionAvailable))effectTab='look';
  $('effectTabs').hidden=!profile.audio&&!motionAvailable;
  for(const tab of document.querySelectorAll('[data-effect-tab]')){tab.setAttribute('aria-selected',String(tab.dataset.effectTab===effectTab));tab.tabIndex=tab.dataset.effectTab===effectTab?0:-1;}
  $('effectBody').setAttribute('aria-labelledby','effect-tab-'+effectTab);
  $('colorControls').hidden=profile.vu||profile.fountain||!state.supportsColor||effectTab!=='look';
  $('colorUpgrade').hidden=state.supportsColor||effectTab!=='look';
  document.querySelector('.palette-options').hidden=profile.vu||profile.fountain||effectTab!=='look'||!state.supportsColor||!(state.capabilities&8);
  $('effectTitle').textContent=entry.name;
  $('effectFamily').textContent=profile.audio?'SOUND & LIGHT':(entry.category||'LIGHT').toUpperCase()+' COLLECTION';
  $('effectDescription').textContent=profile.description;
  $('effectPane').style.setProperty('--effect-accent',profile.audio?'#dac6fa':entry.category==='fire'?'#efc48e':'#d1eead');
  $('motionControls').hidden=!profile.motion||effectTab!=='motion';
  $('intensityControls').hidden=!profile.intensity||effectTab!=='motion';
  $('speedLabel').textContent=profile.speedLabel;$('speedHint').textContent=profile.speedHint;
  $('intensityLabel').textContent=profile.intensityLabel;$('intensityHint').textContent=profile.intensityHint;
  $('primaryColorLabel').textContent=profile.spectrum?'Bass color':profile.colorLabel;
  $('secondaryColorLabel').textContent=profile.spectrum?'Treble color':profile.secondaryLabel;
  $('paletteState').textContent=state.color?.enabled?'Custom':profile.spectrum?'Frequency colors':'Original';
  $('colorHint').textContent=profile.spectrum && !state.color?.enabled?
    'Bass is warm, mids are green, treble is violet. Choose a color to create your own frequency palette.':
    state.color?.enabled?'Your palette is active.':'Original colors are active. Choose a primary color or enable a two-color palette.';
  $('effectAudio').hidden=!profile.audio||effectTab!=='sound';
  $('resetColor').hidden=profile.vu||profile.fountain||!state.supportsColor||effectTab==='sound';
  $('vuControls').hidden=!profile.vu||profile.fountain||effectTab!=='look';
  const vu=lamp===wifiLamp?wifiLamp.raw?.vuColors:null;
  $('vuFields').disabled=!vu||busy;
  if(!vu)$('vuFeedback').textContent='Connect over Wi-Fi to firmware 1.6.2 or newer to set meter colors.';
  if(vu&&!vuDirty){['vuLow','vuMid','vuPeak'].forEach((id,i)=>$(id).value='#'+vu[i].map(v=>v.toString(16).padStart(2,'0')).join(''));paintVu();}

  $('fountainControls').hidden=!profile.fountain||effectTab!=='look';
  const fountain=lamp===wifiLamp?wifiLamp.raw?.fountainColors:null;
  $('fountainFields').disabled=!fountain||busy;
  if(!fountain)$('fountainFeedback').textContent='Connect over Wi-Fi to firmware 1.6.6 or newer to set fountain colors.';
  if(fountain&&!fountainDirty){['fountainLow','fountainMid','fountainPeak'].forEach((id,i)=>$(id).value='#'+fountain[i].map(v=>v.toString(16).padStart(2,'0')).join(''));paintFountain();}

  const audio=lamp===wifiLamp?wifiLamp.raw?.audio:null;
  $('audioTuning').disabled=!audio || busy;
  $('audioScale').disabled=audio?.scale===undefined;
  $('audioConnectionHint').textContent=!audio?'Connect this lamp over Wi-Fi to adjust shared audio response.':
    !audio.liveTuning?'This firmware restarts when audio settings are applied. Update it to tune without restarting the lamp.':'';
  $('audioConnectionHint').hidden=Boolean(audio?.liveTuning);
  $('applyAudio').textContent=audio?.liveTuning?'Apply to all audio effects':'Apply audio settings & restart';
  if(!audio)for(const id of ['audioGainValue','audioGateValue','audioScaleValue'])$(id).value='—';
  if(audio && !audioDirty) {
    $('audioGain').value=audio.gain;$('audioGate').value=audio.gate;$('audioScale').value=audio.scale??100;audioLabels();
  }
  paintRanges();
}

function updatingLamp() { return Boolean(firmware&&[1,3,4].includes(firmware.phase)); }
function renderPower() {
  const sync=lamp===wifiLamp?state?.sync:null;
  const scope=sync?.role===1?'group':sync?.role===2?'this lamp':'lamp';
  $('power').textContent='Turn '+scope+(state?.power?' off':' on');
  $('power').setAttribute('aria-pressed',String(Boolean(state?.power)));
  $('power').disabled=!state||busy||connecting||updatingLamp()||Boolean(state?.calibration?.active);
  $('brightness').disabled=!state||busy||connecting||updatingLamp()||Boolean(sync?.active)||Boolean(state?.calibration?.active);
  document.querySelector('.light-hero').classList.toggle('following',Boolean(sync?.active));
  $('lightEmpty').hidden=Boolean(state);
  document.querySelector('.light-hero').hidden=!state;
  $('controls').hidden=!state;
  $('powerState').textContent=updatingLamp()?'Updating lamp':state?.power?'Light is on':state?'Light is off':'Not connected';
  $('lightModeBadge').textContent=sync?.scene>0?(groupScenes.find(x=>x.id===sync.scene)?.name||'Group scene'):(lamp?.catalog?.find(x=>x.id===state?.mode)?.name||'Choose an effect');
  $('brightnessHelp').textContent=sync?.active?'Brightness follows the coordinator. Pause this lamp’s sync to adjust it here.':'Shared lamp brightness.';
  $('powerHint').textContent=!state?'Connect to a lamp to control its power.':updatingLamp()?'Wait for the firmware update to finish.':state.calibration?.active?'Finish LED setup to use the power control.':sync?.role===1?'Controls this lamp and its connected followers.':sync?.active?'Controls only this lamp and pauses its group sync. Use the controller to turn off the whole group.':sync?.role===2&&sync.paused?'Group sync is paused. Resume it in Settings → Groups when you are ready.':'Turns the light off while keeping the lamp connected.';
}
function renderOptions() {
  renderPower();
  renderPlaybackTools();
  renderSync();
  const supported = Boolean(state?.capabilities & 8);
  renderEffectPane();
  $('effectOptions').hidden = !supported || effectTab==='sound';
  const ready = supported && effectOptions?.mode === state.mode;
  $('effectOptions').disabled = !ready;
  if (!ready || editingOptions) return;
  $('speed').value = effectOptions.speed;
  $('intensity').value = effectOptions.intensity;
  $('speedValue').value = effectOptions.speed + '%';
  $('intensityValue').value = effectOptions.intensity + '%';
  $('speed').disabled = lamp?.catalog?.find(x=>x.id===state.mode)?.speed === false;
  $('dual').checked = Boolean(effectOptions.dual && state.color?.enabled);
  $('dual').disabled = !state.supportsColor;
  $('secondaryColor').disabled = !effectOptions.dual || !state.color?.enabled;
  $('secondaryColorRow').hidden = !effectOptions.dual || !state.color?.enabled;
  $('secondaryColor').value = '#' + [effectOptions.r,effectOptions.g,effectOptions.b].map(v=>v.toString(16).padStart(2,'0')).join('');
  paintRanges();
}
function renderFirmware() {
  const updating = firmware && [1,3,4].includes(firmware.phase);
  $('firmwareVersion').textContent = state ? firmware?.version || 'Older firmware' : 'Connect to view';
  const updateMessage=state?firmwareMessage(firmware):'Connect to view update status.';
  if($('firmwareStatus').textContent!==updateMessage)$('firmwareStatus').textContent=updateMessage;
  $('firmwareControls').disabled = !state || !firmware || busy || updating;
  if(!busy)$('autoUpdate').checked = Boolean(firmware?.automatic);
  $('checkFirmware').disabled = !firmware?.wifi;
  $('installFirmware').disabled = !firmware?.wifi || !firmware?.available;
  $('installFirmware').textContent=firmware?.available?'Install '+firmware.latest:'Update now';
  $('firmwareProgress').hidden=!firmware||![3,4].includes(firmware.phase);
  $('firmwareProgress').value=firmware?.progress??0;
  renderPlaybackTools();
}
function renderSettings() {
  for(const panel of document.querySelectorAll('[data-settings-panel]')) {
    const unsupported=panel.id==='hardwareForm'||panel.id==='bluetoothManagement'?lamp!==wifiLamp||!state:
      panel.id==='wifiSetupActions'?!bluetoothWifiAvailable():
      panel.id==='geometrySettings'?!state||(lamp===wifiLamp?wifiLamp.raw?.midpoint===undefined:!(state.capabilities&128)):
      panel.id==='audioSettings'?lamp!==wifiLamp||!state||!wifiLamp.raw?.audio:
      panel.id==='calibrationPane'?lamp!==wifiLamp||!state?.calibration:false;
    panel.hidden=panel.dataset.settingsPanel!==settingsView||unsupported;
  }
  $('settingsHint').textContent=!state?'Connect to a lamp to manage its settings.':lamp!==wifiLamp&&settingsView==='network'&&!bluetoothWifiAvailable()?'Bluetooth Wi-Fi setup needs firmware 1.9.0 or newer. You can also hold the knob for three seconds and use the lamp’s hotspot.':lamp!==wifiLamp&&settingsView==='hardware'&&(state.capabilities&128)?'Fine-tune the center over Bluetooth. Other hardware settings need Wi-Fi.':lamp!==wifiLamp&&['groups','hardware'].includes(settingsView)?'These controls need a Wi-Fi connection to the lamp. Connect from Lamps using its Wi-Fi address.':'';
  $('settingsHint').hidden=!$('settingsHint').textContent;
  for(const button of document.querySelectorAll('[data-settings-section]'))button.setAttribute('aria-pressed',String(button.dataset.settingsSection===settingsView));
  $('summaryVersion').textContent=state?(firmware?.version||'Unavailable'):'—';
  $('summaryLeds').textContent=lamp===wifiLamp&&state?wifiLamp.raw.leds+' LEDs':'—';
  $('summaryTransport').textContent=state?(lamp===wifiLamp?'Wi-Fi':'Bluetooth'):'Offline';
  const bleNetwork=bluetoothWifiAvailable();
  $('networkSettings').disabled=!state||(lamp!==wifiLamp&&!bleNetwork)||busy||updatingLamp();
  $('wifiSecurityControls').hidden=bleNetwork;
  $('wifiSettingsHint').textContent=bleNetwork?'Choose a 2.4 GHz network. Your phone stays connected over Bluetooth; no lamp hotspot is needed. Wi-Fi settings are saved only after the lamp connects.':'Connect over Wi-Fi to manage network and security settings. The lamp’s hotspot remains available for recovery.';
  $('saveWifi').textContent=bleNetwork?'Connect lamp to Wi-Fi':'Save & restart lamp';
  $('wifiPassword').disabled=bleNetwork&&$('openNetwork').checked;
  $('cancelWifiSetup').hidden=!wifiSetupAbort;
  $('switchToWifi').hidden=!bleNetwork||!bleWifiStatus?.connected||!bleWifiStatus?.ssid||busy;
  $('saveIdentity').disabled=!selected||busy||connecting||updatingLamp();
  $('forgetLamp').disabled=!selected||busy||connecting;
  $('factoryReset').disabled=!state||!selected||busy||connecting||updatingLamp()||!(state.capabilities&128);
  $('factoryResetHint').textContent=!state?'Connect to the lamp to reset it.':!(state.capabilities&128)?'Update this lamp to firmware 1.9.1 or newer for factory reset.':'Available over Bluetooth or Wi-Fi. Only this lamp will be reset.';
  $('lampName').disabled=!selected||busy||connecting;
  $('room').disabled=!selected||busy||connecting;
  renderCenterTool();
}
function settingsSection(name) { settingsView=name;renderSettings(); }
for(const button of document.querySelectorAll('[data-settings-section]'))button.onclick=()=>settingsSection(button.dataset.settingsSection);
for(const button of document.querySelectorAll('[data-goto]'))button.onclick=()=>page(button.dataset.goto);
let savedDevice = null;
try { const saved = JSON.parse(localStorage.getItem('coollamp-device')); if (typeof saved?.deviceId === 'string') savedDevice = saved; } catch {}
$('reconnect').hidden = !savedDevice;
if (savedDevice) status('Reconnect to your saved lamp. There is no need to enter pairing mode again.');
const callbacks = {
  onOptions(next) { effectOptions = next; renderOptions(); },
  onFirmware(next) { firmware = next; renderFirmware(); },
  onState(next) {
    if(lamp===bleLamp&&centerStatus?.active)next.calibration={active:true,kind:'center',position:centerStatus.position};
    if(state?.mode!==next.mode){editingOptions=false;editingBrightness=false;}
    state = next;
    $('defaultPasswordNotice').hidden=next.usingDefaultPassword!==true;
    $('controls').disabled=busy||Boolean(next.sync?.active)||Boolean(next.calibration?.active);
    filterEffects();
    $('colorControls').hidden = !next.supportsColor;
    $('colorUpgrade').hidden = next.supportsColor;
    if (next.color) {
      $('color').value = '#' + [next.color.r,next.color.g,next.color.b].map(v => v.toString(16).padStart(2,'0')).join('');
      $('colorHint').textContent = next.color.enabled ? 'Your color is active for this effect.' : 'Original colors are active. Pick a color to customize this effect.';
      $('resetColor').textContent = next.capabilities & 8 ? 'Restore effect defaults' : 'Restore original colors';
    }
    $('power').textContent = next.power ? 'Turn off' : 'Turn on';
    $('power').setAttribute('aria-pressed', String(next.power));
    $('lampArt').style.opacity=next.power?'1':'.2';
    if (!editingBrightness) { $('brightness').value = next.brightness; brightnessLabel(); }
    $('effect').value = next.mode;
    document.documentElement.style.setProperty('--lamp-color', next.color?.enabled ? $('color').value : '#70e1c9');
    $('favoriteEffect').setAttribute('aria-pressed',String(Boolean(selected?.favorites?.includes(next.mode))));
    $('favoriteEffect').textContent=selected?.favorites?.includes(next.mode)?'♥':'♡';
    renderOptions();
  },
  onDisconnect() {
    clearTimeout(centerTimer);centerTimer=null;centerStatus=null;centerWasActive=false;++centerSerial;$('centerFeedback').textContent='';
    resetTarget=null;
    if($('factoryResetDialog').open){$('factoryResetDialog').returnValue='cancel';$('factoryResetDialog').close();}
    wifiSetupAbort?.abort();wifiSetupAbort=null;bleWifiStatus=null;++wifiSetupSerial;busy=false;
    $('wifiSetupFeedback').textContent='';$('networks').replaceChildren(new Option('Choose a network or enter its name below',''));
    firmware = null; effectOptions = null; vuDirty=false;fountainDirty=false;audioDirty=false;paneMode=null;$('audioFeedback').textContent='';$('vuFeedback').textContent='';$('fountainFeedback').textContent='';
    $('defaultPasswordNotice').hidden=true;
    for(const id of ['ssid','wifiPassword','adminPassword','leds','milliamps','startupBrightness'])$(id).value='';
    $('startupMode').replaceChildren();$('microphoneInstalled').checked=false;$('midpoint').value=0;
    state = null; filterEffects(); $('controls').disabled = true; $('disconnect').hidden = true;
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

function brightnessLabel() { $('brightnessValue').value = Math.round(Number($('brightness').value) * 100 / 255) + '%';paintRanges(); }
async function change(operation, value, activatePalette = false) {
  if (busy) return;
  busy = true; $('controls').disabled = true; renderPower(); renderFirmware();
  try {
    if(activatePalette && !state.color?.enabled){
      const hex=$('color').value.slice(1);
      await lamp.command('color',{mode:value.mode,r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)});
    }
    await lamp.command(operation, value); status(operation === 'saveDefaults' ? 'Startup settings saved.' : 'Connected • Changes applied.'); }
  catch (error) { status(error.message); }
  finally { busy = false; $('controls').disabled = !state || Boolean(state?.sync?.active); renderFirmware();renderOptions(); }
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
  finally { connecting=false; $('connect').disabled=false; renderLamps(); renderPower(); }
}
function connected(kind) {
  $('addLamp').open=false;
  category='all'; $('effectSearch').value='';
  document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.category==='all')));
  renderOptions();
  localStorage.setItem('coollamp-selected',selected.id);
  $('controls').disabled=Boolean(state?.sync?.active); $('disconnect').hidden=false;
  $('favoriteEffect').setAttribute('aria-pressed',String(Boolean(selected.favorites?.includes(state.mode))));
  $('favoriteEffect').textContent=selected.favorites?.includes(state.mode)?'♥':'♡';
  $('connectionBadge').textContent=kind; $('lampTitle').textContent=selected.name;
  $('lampRoom').textContent=selected.room||'YOUR LAMP';
  $('lampName').value=selected.name; $('room').value=selected.room||'';
  $('settingsConnection').textContent=selected.name+' · '+kind;
  $('identify').disabled=kind!=='Wi-Fi'||!wifiLamp.raw?.apiVersion;
  $('networkSettings').disabled=kind!=='Wi-Fi'&&!bluetoothWifiAvailable();
  if(kind==='Wi-Fi')fillNetwork();
  status('Connected to '+selected.name+'.');renderLamps(); filterEffects();page('light');renderSettings();
  if(kind==='Bluetooth'&&bluetoothWifiAvailable()) {
    const epoch=bleLamp.epoch;
    bleLamp.readWifiSetup().then(value=>{
      if(lamp!==bleLamp||epoch!==bleLamp.epoch)return;
      if(busy)return;
      bleWifiStatus=value;if(!$('ssid').value)$('ssid').value=value.ssid;
      $('wifiSetupFeedback').textContent=wifiSetupMessage(value);
      renderSettings();
    }).catch(e=>{if(lamp===bleLamp&&epoch===bleLamp.epoch)$('wifiSetupFeedback').textContent=e.message;});
  }
  if(kind==='Bluetooth'&&(state?.capabilities&128)) {
    const epoch=bleLamp.epoch;
    bleLamp.calibrateCenter('status').then(value=>{
      if(lamp!==bleLamp||epoch!==bleLamp.epoch)return;
      setCenterStatus(value);if(value.active)pollCenter();
    }).catch(e=>{if(lamp===bleLamp&&epoch===bleLamp.epoch)$('centerFeedback').textContent=e.message;});
  }
}
async function connectWifi(entry,password) {
  if(connecting||busy)return;
  connecting=true;status('Connecting over Wi-Fi…');
  await lamp.disconnect(); lamp=wifiLamp;
  try {
    if(password===undefined && entry.id) password=(await credential(entry.id)).value;
    if(!password){$('address').value=entry.address;$('addLamp').open=true;page('lamps');$('password').focus();throw new Error('Enter the lamp access password to connect.');}
    const raw=await wifiLamp.connect(entry.address,password,entry.id);
    const id=raw.deviceId||raw.hostname.replace(/\.local$/,'');
    const prior=store.items.find(x=>x.id===id || x.id===entry.id);
    selected=store.upsert({...prior,id,address:lampAddress(entry.address),hostname:raw.hostname,name:raw.name||prior?.name||entry.name||'CoolLamp'},entry.id);
    let warning='';try {await credential(id,password);}catch(e){warning=e.message;}
    $('password').value='';connected('Wi-Fi');if(warning)status('Connected. '+warning);
  } catch(e) { status(e.message); }
  finally { connecting=false; renderLamps(); renderPower(); }
}
$('connect').onclick=()=>connect();
$('reconnect').onclick=()=>connect(savedDevice);
$('disconnect').onclick=()=>lamp.disconnect();
$('power').onclick = () => { if(state&&!connecting&&!state.calibration?.active)change('power', state.power ? 0 : 1); };
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
for (const id of ['speed','intensity']) $(id).oninput = () => { editingOptions=true; $(id+'Value').value = $(id).value + '%';paintRanges(); };
for (const id of ['speed','intensity','dual','secondaryColor']) $(id).onchange = async () => {
  if (!state || effectOptions?.mode !== state.mode) return;
  const hex = $('secondaryColor').value.slice(1);
  await change('effectOptions', {mode:state.mode, speed:Number($('speed').value), intensity:Number($('intensity').value),
    dual:id==='dual'?Number($('dual').checked):effectOptions.dual,r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)},id==='dual'&&$('dual').checked);
  editingOptions=false;
  renderOptions();
};

function renderLamps() {
  $('discover').textContent=discovery.scanned?'Refresh Wi-Fi list':'Find on Wi-Fi';
  $('lampList').replaceChildren();
  const merged=new Map(store.items.map(x=>[x.id,x]));
  for(const entry of discovered)merged.set(entry.id,{...entry,...merged.get(entry.id),address:entry.address});
  $('emptyLamps').hidden=merged.size>0;
  for(const entry of merged.values()) {
    const wrapper=document.createElement('div');wrapper.className='lamp-entry';
    const button=document.createElement('button');button.className='lamp-card';
    const title=document.createElement('strong');title.textContent=entry.name||'CoolLamp';
    const detail=document.createElement('span');detail.textContent=[entry.room,discovered.some(x=>x.id===entry.id)?'Found on Wi-Fi':entry.address?'Saved Wi-Fi lamp':'Saved Bluetooth lamp'].filter(Boolean).join(' · ');
    button.append(title,detail);button.disabled=connecting||busy;
    button.setAttribute('aria-current',String(Boolean(state&&entry.id===selected?.id)));
    if(state&&entry.id===selected?.id)detail.textContent=(entry.room?entry.room+' · ':'')+'Connected · '+(lamp===wifiLamp?'Wi-Fi':'Bluetooth');
    button.onclick=async()=>{
      if(state&&entry.id===selected?.id){page('light');return;}
      if(entry.address) {
        await connectWifi(entry);
        if(!state&&entry.deviceId)await connect(entry);
      } else await connect(entry);
    };
    const remove=document.createElement('button');remove.type='button';remove.className='lamp-remove text-button';remove.textContent='Remove';
    remove.setAttribute('aria-label','Remove '+(entry.name||'CoolLamp')+' from this phone');remove.disabled=busy||connecting;
    remove.onclick=()=>removeLampFromPhone(entry).catch(()=>{});
    wrapper.append(button,remove);$('lampList').append(wrapper);
  }
}
async function discover(includeForgotten=false) {
  if(!isNative){status('Automatic discovery is available in the iPhone and Android app. You can enter a lamp address here.');return;}
  $('discover').disabled=true;status('Looking for lamps on your Wi-Fi…');
  if(includeForgotten)discovery.beginRefresh();
  try {
    const result=await native.discover();discovered=discovery.remember(result.lamps);
    renderLamps();status(discovered.length?'Choose a lamp to connect.':'No lamps found. Check Local Network permission and that your phone and lamp use the same home network. You can also enter its address or use Bluetooth.');
    const remembered=store.items.find(x=>x.id===localStorage.getItem('coollamp-selected'));
    const available=remembered&&discovered.find(x=>x.id===remembered.id);
    if(available&&!state&&!connecting)await connectWifi({...remembered,address:available.address});
  }catch(e){status(e.message);}finally{$('discover').disabled=false;}
}
$('discover').onclick=()=>discover(true);
$('wifiConnect').onsubmit=e=>{e.preventDefault();const address=$('address').value.trim();let normalized;try{normalized=lampAddress(address);}catch(e){status(e.message);return;}const entry=discovered.find(x=>x.address===normalized)||store.items.find(x=>x.address===normalized)||{address:normalized};connectWifi(entry,$('password').value||undefined);};
for(const button of document.querySelectorAll('[data-page]'))button.onclick=()=>page(button.dataset.page);
function filterEffects() {
  const query=$('effectSearch').value.trim().toLowerCase();
  const catalog=state ? lamp?.catalog || [] : [];
  $('libraryCount').textContent=catalog.length?catalog.length+' effects':'Explore the collection';
  $('currentEffect').textContent=state?'Current: '+(catalog.find(x=>x.id===state.mode)?.name || 'Loading effects…'):'Choose a lamp to browse its effects.';
  document.querySelector('[data-category=audio]').hidden=!catalog.some(entry=>entry.category==='audio');
  if(category==='audio' && !catalog.some(entry=>entry.category==='audio')) {
    category='all';document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.category==='all')));
  }
  const key=JSON.stringify([catalog,query,category,selected?.favorites,state?.mode]);
  if(key===effectListKey)return;
  effectListKey=key;
  const focused=document.activeElement?.dataset.effect;
  $('effectGrid').replaceChildren();
  $('effect').replaceChildren();
  catalog.forEach(({id:mode,name,category:group})=>{if((!query||name.toLowerCase().includes(query))&&(category==='all'||(category==='favorites'?selected?.favorites?.includes(mode):group===category)))$('effect').add(new Option(name,mode));});
  if(state)$('effect').value=state.mode;
  if(!$('effect').options.length){const option=new Option('No matching effects','');option.disabled=true;$('effect').add(option);}
  let previousGroup=null;
  for(const option of $('effect').options) {
    const group=catalog.find(entry=>entry.id===Number(option.value))?.category==='audio'?'Audio effects':'Light effects';
    if(category==='all' && group!==previousGroup) {
      const heading=document.createElement('h4');heading.textContent=group;heading.className='effect-group-heading';$('effectGrid').append(heading);previousGroup=group;
    }
    const button=document.createElement('button');button.type='button';
    const title=document.createElement('strong');title.textContent=option.text;
    const detail=document.createElement('small');const entry=catalog.find(x=>x.id===Number(option.value));detail.textContent=Number(option.value)===state?.mode?'● Active':(entry?.category||'Effect');button.append(title,detail);
    button.disabled=option.disabled;button.dataset.effect=option.value;button.dataset.family=entry?.category||'calm';
    button.setAttribute('aria-pressed',String(Number(option.value)===state?.mode));
    button.onclick=async()=>{await change('effect',Number(option.value));if(state?.mode===Number(option.value)){$('effectLibrary').open=false;$('effectPane').scrollIntoView({block:'start'});$('effectTitle').focus({preventScroll:true});}};$('effectGrid').append(button);
    if(focused===option.value)button.focus({preventScroll:true});
  }
}
for(const tab of document.querySelectorAll('[data-effect-tab]')) {
  tab.onclick=()=>{effectTab=tab.dataset.effectTab;renderOptions();};
  tab.onkeydown=e=>{
    const tabs=[...document.querySelectorAll('[data-effect-tab]')].filter(x=>!x.hidden);
    const index=tabs.indexOf(tab);let next;
    if(e.key==='ArrowRight')next=tabs[(index+1)%tabs.length];
    if(e.key==='ArrowLeft')next=tabs[(index+tabs.length-1)%tabs.length];
    if(e.key==='Home')next=tabs[0];if(e.key==='End')next=tabs.at(-1);
    if(next){e.preventDefault();next.click();next.focus();}
  };
}
$('effectSearch').oninput=filterEffects;
for(const button of document.querySelectorAll('[data-category]'))button.onclick=()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));filterEffects();};
$('favoriteEffect').onclick=()=>{if(!selected||!state)return;const favorites=new Set(selected.favorites||[]);if(favorites.has(state.mode))favorites.delete(state.mode);else favorites.add(state.mode);selected=store.upsert({...selected,favorites:[...favorites]});$('favoriteEffect').setAttribute('aria-pressed',String(favorites.has(state.mode)));$('favoriteEffect').textContent=favorites.has(state.mode)?'♥':'♡';filterEffects();};
function fillNetwork() {
  const raw=wifiLamp.raw;
  $('geometrySettings').hidden=raw.midpoint===undefined;
  $('midpoint').max=Math.max(0,raw.leds-1);$('midpoint').value=raw.midpoint?Math.min(raw.midpoint,raw.leds-1):0;
  $('audioSettings').hidden=!raw.audio;
  if(raw.audio){$('microphoneInstalled').checked=raw.audio.installed;renderEffectPane();}
  for(const id of ['ssid','leds','milliamps'])$(id).value=raw[id];
  $('startupMode').replaceChildren(...wifiLamp.catalog.map(x=>new Option(x.name,x.id)));
  $('startupMode').value=raw.startupMode||raw.mode;$('startupBrightness').value=raw.startupBrightness||raw.brightness;
  for(const id of ['wifiPassword','adminPassword'])$(id).value='';
  for(const id of ['openNetwork','forgetWifi'])$(id).checked=false;
  renderSettings();
}
async function networkAction(action) {
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  busy=true;$('networkSettings').disabled=true;renderPower();renderSettings();
  try{await wifiLamp.enqueue(action);}catch(e){if(e.uncertain)await wifiLamp.disconnect();status(e.message);}finally{busy=false;$('networkSettings').disabled=lamp!==wifiLamp||!state;renderOptions();renderSettings();}
}
async function bluetoothNetworkAction(action) {
  if(busy||connecting||!bluetoothWifiAvailable())return;
  busy=true;const serial=++wifiSetupSerial,controller=new AbortController();wifiSetupAbort=controller;
  renderPower();renderSettings();
  try {
    return await action({signal:controller.signal,onProgress:value=>{
      if(serial!==wifiSetupSerial)return;
      bleWifiStatus=value;$('wifiSetupFeedback').textContent=wifiSetupMessage(value);renderSettings();
    }});
  } catch(e) { if(serial===wifiSetupSerial){$('wifiSetupFeedback').textContent=e.message;status(e.message);} }
  finally { if(serial===wifiSetupSerial){wifiSetupAbort=null;busy=false;renderOptions();renderSettings();} }
}
async function handoffBluetoothWifi() {
  if(busy||connecting||!bluetoothWifiAvailable()||!bleWifiStatus?.connected)return;
  const epoch=bleLamp.epoch,identity=selected.id,info=bleWifiStatus;
  const entry={...selected,address:lampAddress(info.address),hostname:info.hostname};
  const password=info.usingDefaultPassword?'coollamp':(await credential(identity)).value;
  if(!password) {
    selected=store.upsert(entry);renderLamps();$('address').value=entry.address;
    $('addLamp').open=true;page('lamps');$('password').focus();
    status('Wi-Fi is ready. Enter this lamp’s access password to use Wi-Fi control.');return;
  }
  busy=true;renderSettings();
  const probe=new WifiTransport(CapacitorHttp);
  let reachable=false;
  try { await probe.connect(entry.address,password,identity);reachable=true; }
  catch { if(epoch===bleLamp.epoch){$('wifiSetupFeedback').textContent='Wi-Fi settings are saved. Bluetooth control remains available. Put your phone on the same network, then choose Use Wi-Fi control.';status('Wi-Fi setup saved. Bluetooth control remains available.');} }
  finally {await probe.disconnect();busy=false;renderSettings();}
  if(epoch!==bleLamp.epoch||lamp!==bleLamp||selected?.id!==identity)return;
  selected=store.upsert(entry);renderLamps();
  if(reachable) {
    await connectWifi(entry,password);
    if(!state&&lamp===wifiLamp&&entry.deviceId) {
      await connect(entry);
      status('Wi-Fi settings are saved. Reconnected over Bluetooth; try Wi-Fi control again when your phone is on the same network.');
    }
  }
}
$('cancelWifiSetup').onclick=()=>wifiSetupAbort?.abort();
$('switchToWifi').onclick=()=>handoffBluetoothWifi().catch(e=>status(e.message));
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
$('scanWifi').onclick=()=>{
  if(bluetoothWifiAvailable())return bluetoothNetworkAction(async options=>{
    status('Finding nearby Wi-Fi networks…');
    $('wifiSetupFeedback').textContent='Finding nearby 2.4 GHz Wi-Fi networks…';
    const networks=await bleLamp.scanWifi(options);
    if(options.signal.aborted)return;
    $('networks').replaceChildren(new Option('Choose a network or enter its name below',''),...networks.map(x=>{
      const strength=x.rssi>=-60?'Strong signal':x.rssi>=-75?'Good signal':'Weak signal';
      const option=new Option(x.ssid+(x.open?' (open)':'')+' · '+strength,x.ssid);option.dataset.open=String(x.open);return option;
    }));
  });
  return networkAction(async()=>{
  status('Scanning Wi-Fi networks…');await wifiLamp.request('/api/scan',{});
  const epoch=wifiLamp.epoch;
  for(let attempt=0;attempt<25;attempt++) {
    await new Promise(r=>setTimeout(r,1000));if(epoch!==wifiLamp.epoch)throw new Error('Connection changed.');
    const result=await wifiLamp.request('/api/scan');const scan=typeof result==='string'?JSON.parse(result):result;
    if(scan.status==='failed')throw new Error('Wi-Fi scan failed. Try again.');
    if(scan.status==='complete'){$('networks').replaceChildren(new Option('Choose a network or enter its name below',''),...scan.networks.map(x=>{const o=new Option(x.ssid+(x.open?' (open)':''),x.ssid);o.dataset.open=String(x.open);return o;}));status('Wi-Fi scan complete.');return;}
  }throw new Error('Wi-Fi scan timed out. Try again.');
  });
};
$('networks').onchange=()=>{if($('networks').value){$('ssid').value=$('networks').value;$('openNetwork').checked=$('networks').selectedOptions[0].dataset.open==='true';if($('openNetwork').checked)$('wifiPassword').value='';renderSettings();}};
$('openNetwork').onchange=()=>{if($('openNetwork').checked)$('wifiPassword').value='';renderSettings();};
for(const [id,section] of [['networkForm','network'],['hardwareForm','hardware']])$(id).onsubmit=e=>{
  if(section==='network'&&bluetoothWifiAvailable()) {
    e.preventDefault();if(busy||connecting)return;
    const ssid=$('ssid').value,password=$('wifiPassword').value,open=$('openNetwork').checked;
    $('wifiPassword').value='';
    status('Connecting the lamp to Wi-Fi…');
    bluetoothNetworkAction(options=>bleLamp.configureWifi(ssid,password,open,options)).then(value=>{
      if(!value)return;
      bleWifiStatus=value;$('wifiSetupFeedback').textContent=wifiSetupMessage(value);status(wifiSetupMessage(value));renderSettings();
      return handoffBluetoothWifi();
    }).catch(e=>status(e.message));return;
  }
  e.preventDefault();if(!state||lamp!==wifiLamp||!confirm('Save '+(section==='hardware'?'strip and startup':'Wi-Fi and security')+' settings and restart this lamp?'))return;
  const draft={};for(const field of ['ssid','wifiPassword','adminPassword','leds','milliamps','startupMode','startupBrightness'])draft[field]=$(field).value;
  for(const field of ['openNetwork','forgetWifi'])draft[field]=$(field).checked;
  const data=configurationPayload(wifiLamp.raw,section,draft);
  networkAction(async()=>{
    const message=await wifiLamp.request('/api/config',data);
    if(data.adminPassword)await credential(selected.id,data.adminPassword);
    await wifiLamp.disconnect();status(message+' Find the lamp again after it restarts.');
  });
};
$('geometryForm').onsubmit=e=>{
  e.preventDefault();networkAction(async()=>{
    status(await wifiLamp.configureGeometry(Number($('midpoint').value)));
  });
};
function renderCenterTool(){
  const wifi=lamp===wifiLamp,raw=wifi?wifiLamp.raw:null,c=raw?.calibration;
  const value=wifi?{active:Boolean(c?.active&&c.kind==='center'),position:c?.kind==='center'?c.position:raw?.effectiveMidpoint,leds:raw?.leds}:centerStatus;
  const supported=state&&(wifi?c?.centerSupported:Boolean(state.capabilities&128));
  const active=Boolean(value?.active);
  $('geometryForm').hidden=!wifi;
  $('centerControls').disabled=!supported||busy||connecting||updatingLamp()||value?.leds<2;
  $('startCenter').hidden=active;$('saveCenter').hidden=!active;$('cancelCenter').hidden=!active;
  $('centerPosition').hidden=!active;$('centerPosition').textContent=active?'Center after LED '+value.position+' of '+value.leds:'';
  $('midpoint').disabled=active||busy;
  if(centerWasActive&&!active)$('centerFeedback').textContent='Adjustment ended. Normal lighting restored.';
  centerWasActive=active;
  if(state&&!supported)$('centerFeedback').textContent='Update this lamp to firmware 1.9.1 or newer to use the blinking center marker.';
  if(supported&&value?.leds===1)$('centerFeedback').textContent='A single-LED strip has no adjustable center.';
  if(active)$('centerFeedback').textContent='Turn the knob to move the marker. Click to save, or stop for ten seconds to cancel.';
}
function setCenterStatus(value){
  centerStatus=value;
  if(lamp===bleLamp&&state)state={...state,calibration:value.active?{active:true,kind:'center',position:value.position}:undefined};
  renderOptions();
}
function pollCenter(){
  clearTimeout(centerTimer);const serial=++centerSerial,epoch=bleLamp.epoch;
  const poll=async()=>{
    if(serial!==centerSerial||lamp!==bleLamp||epoch!==bleLamp.epoch||!state)return;
    try {
      const value=await bleLamp.calibrateCenter('status');
      if(serial!==centerSerial||lamp!==bleLamp||epoch!==bleLamp.epoch)return;
      setCenterStatus(value);if(value.active)centerTimer=setTimeout(poll,700);
    }catch(e){if(serial===centerSerial)$('centerFeedback').textContent=e.message;}
  };
  centerTimer=setTimeout(poll,700);
}
async function centerAction(action){
  if(!state||busy||connecting||updatingLamp())return;
  clearTimeout(centerTimer);++centerSerial;const target=lamp,epoch=lamp.epoch;
  busy=true;renderSettings();
  try {
    const result=target===wifiLamp?await wifiLamp.enqueue(()=>wifiLamp.calibrateCenter(action)):await bleLamp.calibrateCenter(action);
    if(target!==lamp||epoch!==lamp.epoch)return;
    if(target===bleLamp)setCenterStatus(result);
    else if(action==='save')$('midpoint').value=wifiLamp.raw.midpoint;
    $('centerFeedback').textContent=action==='save'?'Center saved. Normal lighting restored.':action==='cancel'?'Previous center kept. Normal lighting restored.':'Turn the knob to move the blinking white marker.';
  }catch(e){$('centerFeedback').textContent=e.message;}
  finally{busy=false;renderOptions();if(lamp===bleLamp&&centerStatus?.active)pollCenter();}
}
$('startCenter').onclick=()=>centerAction('start');$('saveCenter').onclick=()=>centerAction('save');$('cancelCenter').onclick=()=>centerAction('cancel');
function audioLabels() {
  $('audioGainValue').value=$('audioGain').value+'×';
  $('audioGateValue').value=$('audioGate').value;
  $('audioScaleValue').value=(Number($('audioScale').value)/100).toFixed(2)+'×';
}
for(const id of ['audioGain','audioGate','audioScale'])$(id).oninput=()=>{
  audioDirty=true;audioLabels();paintRanges();$('audioFeedback').textContent='Unapplied changes · shared across audio effects';
};
$('applyAudio').onclick=async()=>{
  if(busy || connecting || lamp!==wifiLamp || !state)return;
  const tuning={gain:Number($('audioGain').value),gate:Number($('audioGate').value),...(wifiLamp.raw.audio.scale===undefined?{}:{scale:Number($('audioScale').value)})};
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try {
    const message=await wifiLamp.enqueue(()=>wifiLamp.tuneAudio(tuning));
    audioDirty=false;$('audioFeedback').textContent=message;status(message);
  }catch(e){if(e.uncertain)await wifiLamp.disconnect();$('audioFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=lamp!==wifiLamp||!state;renderOptions();}
};
$('audioForm').onsubmit=e=>{
  e.preventDefault();
  networkAction(async()=>{
    const message=await wifiLamp.configureAudio({enabled:Number($('microphoneInstalled').checked),gain:wifiLamp.raw.audio.gain,gate:wifiLamp.raw.audio.gate,...(wifiLamp.raw.audio.scale===undefined?{}:{scale:wifiLamp.raw.audio.scale})});
    status(message+' Reconnect after the lamp restarts.');
  });
};
async function removeLampFromPhone(entry,confirmed=false) {
  if(!entry||busy||connecting)return;
  if(!confirmed&&!confirm('Remove '+(entry.name||'this lamp')+' from this app? The lamp’s settings and phone Bluetooth pairing stay unchanged.'))return;
  busy=true;connecting=true;renderLamps();renderSettings();
  try {
    if(selected?.id===entry.id&&state)await lamp.disconnect();
    await credential(entry.id,'');
    store.remove(entry.id);discovered=discovery.forget(entry.id);
    if(localStorage.getItem('coollamp-selected')===entry.id)localStorage.removeItem('coollamp-selected');
    if(savedDevice&&(savedDevice.lampId===entry.id||savedDevice.deviceId===entry.deviceId)){savedDevice=null;localStorage.removeItem('coollamp-device');$('reconnect').hidden=true;}
    if(selected?.id===entry.id)selected=null;
    page('lamps');status('Lamp removed from this app. Its settings and Bluetooth pairing are unchanged.');
  }catch(e){status('Could not finish removing the lamp: '+e.message);throw e;}
  finally{connecting=false;busy=false;renderLamps();renderSettings();}
}
$('forgetLamp').onclick=()=>removeLampFromPhone(selected).catch(()=>{});
$('factoryReset').onclick=()=>{
  if(!selected||!state||busy||connecting||!(state.capabilities&128))return;
  resetTarget={entry:{...selected},transport:lamp,epoch:lamp.epoch};
  $('factoryResetTitle').textContent='Reset '+selected.name+'?';$('factoryResetDialog').returnValue='';$('factoryResetDialog').showModal();
};
$('factoryResetDialog').addEventListener('close',async()=>{
  const reset=resetTarget;resetTarget=null;
  if($('factoryResetDialog').returnValue!=='reset'||!reset||!selected||!state||busy||connecting||
    selected.id!==reset.entry.id||lamp!==reset.transport||lamp.epoch!==reset.epoch)return;
  const entry=reset.entry,target=reset.transport;
  busy=true;renderSettings();
  try {
    await target.factoryReset();busy=false;
    await removeLampFromPhone(entry,true);
    status('Factory reset started. Forget the lamp in your phone’s Bluetooth settings, then pair again.');
  }catch(e){status(e.confirmed?e.message:'Factory reset was not confirmed. Check the lamp before retrying. '+e.message);}
  finally{busy=false;renderSettings();}
});
paintRanges();renderLamps();
if(isNative)discover();

function paintVu(){const [a,b,c]=['vuLow','vuMid','vuPeak'].map(id=>$(id).value);$('vuPreview').style.background=`linear-gradient(to right,${a} 0 65%,${b} 65% 80%,${c} 80% 100%)`;}
for(const id of ['vuLow','vuMid','vuPeak'])$(id).oninput=()=>{vuDirty=true;paintVu();$('vuFeedback').textContent='Unsaved meter colors';};
async function saveVu(reset=false){
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  const colors=reset?null:['vuLow','vuMid','vuPeak'].map(id=>$(id).value.slice(1).match(/../g).map(v=>parseInt(v,16)));
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try{const message=await wifiLamp.enqueue(()=>wifiLamp.configureVuColors(colors));vuDirty=false;$('vuFeedback').textContent=message;status(message);}
  catch(e){if(e.uncertain)await wifiLamp.disconnect();$('vuFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=lamp!==wifiLamp||!state;renderOptions();}
}
$('applyVu').onclick=()=>saveVu();$('resetVu').onclick=()=>saveVu(true);

function paintFountain(){const [a,b,c]=['fountainLow','fountainMid','fountainPeak'].map(id=>$(id).value);$('fountainPreview').style.background=`linear-gradient(to right,${a} 0 33.33%,${b} 33.33% 66.67%,${c} 66.67% 100%)`;}
for(const id of ['fountainLow','fountainMid','fountainPeak'])$(id).oninput=()=>{fountainDirty=true;paintFountain();$('fountainFeedback').textContent='Unsaved fountain colors';};
async function saveFountain(reset=false){
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  const colors=reset?null:['fountainLow','fountainMid','fountainPeak'].map(id=>$(id).value.slice(1).match(/../g).map(v=>parseInt(v,16)));
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try{const message=await wifiLamp.enqueue(()=>wifiLamp.configureFountainColors(colors));fountainDirty=false;$('fountainFeedback').textContent=message;status(message);}
  catch(e){if(e.uncertain)await wifiLamp.disconnect();$('fountainFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=lamp!==wifiLamp||!state;renderOptions();}
}
$('applyFountain').onclick=()=>saveFountain();$('resetFountain').onclick=()=>saveFountain(true);


let syncIdentity=null, peerListKey='';
function renderGroupScenes() {
  const sync=lamp===wifiLamp?state?.sync:null;
  const ready=sync?.version===2 && sync.role>0,controller=ready&&sync.role===1;
  $('groupScenePane').hidden=!ready;
  $('groupOrderPane').hidden=!controller;
  if(!ready)return;
  $('groupSceneLibrary').hidden=!controller;
  const scene=groupScenes.find(x=>x.id===sync.scene)||groupScenes[0];
  $('groupSceneTitle').textContent=scene.id?scene.name:'Group scenes';
  $('groupSceneSpeedLabel').textContent=scene.speedLabel||({3:'Flow speed',4:'Bloom speed',6:'Storm pace',8:'Wave speed'})[scene.id]||'Travel speed';
  $('groupSceneDescription').textContent=scene.description+(scene.id>8?' Requires firmware 1.8.1 or newer on every lamp.':'')+(controller?'':' Choose and tune scenes on the coordinator.');
  $('groupScenePosition').textContent=sync.count?'Lamp '+(sync.position+1)+' of '+sync.count:'';
  $('groupSceneWaiting').hidden=!controller||sync.members>=1;
  $('groupSceneWaiting').textContent='Join a second lamp to see the scene. Each lamp needs firmware '+(scene.id>8?'1.8.1':'1.8.0')+' or newer.';
  $('groupSceneFields').hidden=!controller||!scene.id;
  $('groupSceneFields').disabled=busy||updatingLamp();
  document.querySelector('.group-scene-colors').hidden=Boolean(scene.fixedColors);
  const key=JSON.stringify([sync.scene,sync.sceneCount,controller,Boolean(state.audio?.installed)]);
  if(sceneChoicesKey!==key){
    sceneChoicesKey=key;$('groupSceneChoices').replaceChildren();
    if(controller)for(const item of availableGroupScenes(sync)){
      const button=document.createElement('button');button.type='button';button.textContent=item.name;
      button.setAttribute('aria-pressed',String(item.id===sync.scene));
      button.dataset.needsMic=String(item.audio&&!item.optionalAudio);
      if(item.audio&&!item.optionalAudio)button.title='Requires a microphone in the coordinator';
      button.dataset.scene=String(item.id);button.dataset.sceneName=item.name;
      button.onclick=async()=>{await syncAction(async()=>{const result=await wifiLamp.configureGroupScene({scene:item.id});groupSceneDirty=false;groupAudioDirty=false;return result;});if(state?.sync?.scene===item.id){$('groupSceneLibrary').open=false;$('groupSceneTitle').focus({preventScroll:true});}};
      $('groupSceneChoices').append(button);
    }
  }
  for(const button of $('groupSceneChoices').children)button.disabled=busy||updatingLamp()||(button.dataset.needsMic==='true'&&!state.audio?.installed);
  filterScenes();
  const v=groupSceneSettings(sync);
  if(!groupSceneDirty){
    $('groupSceneSpeed').value=v.speed;$('groupSceneIntensity').value=v.intensity;
    $('groupScenePrimary').value='#'+v.primary.map(n=>n.toString(16).padStart(2,'0')).join('');
    $('groupSceneSecondary').value='#'+v.secondary.map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  const audio=state.audio;
  $('groupSceneAudio').hidden=!controller||!scene.audio||!audio?.installed;
  $('groupSceneAudio').disabled=busy||updatingLamp();
  if(audio&&!groupAudioDirty){$('groupAudioGain').value=audio.gain;$('groupAudioGate').value=audio.gate;$('groupAudioScale').value=audio.scale??100;}
  groupSceneLabels();paintRanges();
  const orderKey=JSON.stringify(sync.order);
  if(controller&&groupOrderKey!==orderKey){
    groupOrderKey=orderKey;$('groupOrder').replaceChildren();
    (sync.order||[]).forEach((entry,index)=>{
      const row=document.createElement('li'),label=document.createElement('span');
      label.textContent=(index+1)+'. '+(entry.id===wifiLamp.identity?state.name:entry.name||entry.id)+(entry.online?'':' · offline');
      row.append(label);
      for(const [direction,text] of [[-1,'↑'],[1,'↓']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;button.className='secondary';
        button.setAttribute('aria-label','Move '+(entry.name||entry.id)+(direction<0?' earlier':' later'));
        button.dataset.edge=String(index+direction<0||index+direction>=sync.order.length);
        button.onclick=()=>syncAction(()=>wifiLamp.configureGroupOrder(moveGroupLamp(wifiLamp.raw.sync.order,entry.id,direction)));
        row.append(button);
      }
      if(!entry.online&&entry.id!==wifiLamp.identity){
        const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.className='text-button';
        remove.onclick=()=>syncAction(()=>wifiLamp.configureGroupOrder(wifiLamp.raw.sync.order.filter(x=>x.id!==entry.id).map(x=>x.id)));row.append(remove);
      }
      $('groupOrder').append(row);
    });
  }
  for(const button of $('groupOrder').querySelectorAll('button'))button.disabled=busy||button.dataset.edge==='true';
}
function groupSceneLabels(){
  $('groupSceneSpeedValue').value=$('groupSceneSpeed').value+'%';
  $('groupSceneIntensityValue').value=$('groupSceneIntensity').value+'%';
  $('groupAudioGainValue').value=$('groupAudioGain').value+'×';
  $('groupAudioGateValue').value=$('groupAudioGate').value;
  $('groupAudioScaleValue').value=(Number($('groupAudioScale').value)/100).toFixed(2)+'×';
}
function renderSync() {
  renderPower();
  const sync=lamp===wifiLamp?state?.sync:null;
  const identity=lamp===wifiLamp?wifiLamp.identity:null;
  if(syncIdentity!==identity){
    syncIdentity=identity;peerListKey='';groupSceneDirty=false;groupAudioDirty=false;sceneChoicesKey='';groupOrderKey='';$('groupSceneFeedback').textContent='';$('syncCode').value='';$('syncCodeArea').hidden=true;
    $('syncJoinCode').value='';$('syncFeedback').textContent='';
  }
  const syncMessage=groupStatus(sync);if($('syncStatus').textContent!==syncMessage)$('syncStatus').textContent=syncMessage;
  $('syncFields').disabled=!sync||busy||updatingLamp();
  $('syncIndependent').hidden=Boolean(sync?.role);
  $('syncCoordinator').hidden=sync?.role!==1;
  $('syncFollower').hidden=sync?.role!==2;
  $('syncJoin').hidden=Boolean(sync?.role);
  $('leaveSync').hidden=!sync?.role;
  $('pauseSync').hidden=Boolean(sync?.paused);
  $('resumeSync').hidden=!sync?.paused;
  $('syncLeaderName').textContent='Coordinator: '+(sync?.peers?.find(p=>p.id===sync.leader)?.name||sync?.leader||'');
  $('syncBanner').hidden=!sync?.role;
  $('syncBannerText').textContent=groupStatus(sync)+(sync?.active?'. Change effects on the coordinator, or pause to control this lamp.':'');
  const peers=(sync?.peers||[]).filter(p=>p.role===1);
  const key=JSON.stringify(peers.map(p=>[p.id,p.name]));
  if(peerListKey!==key){
    peerListKey=key;$('syncPeers').replaceChildren();
    for(const peer of peers){
      const button=document.createElement('button');button.type='button';button.className='secondary sync-peer';
      const title=document.createElement('strong');title.textContent=peer.name||peer.id;
      const detail=document.createElement('span');detail.textContent=(peer.microphone?'Audio coordinator · ':'Coordinator · ')+peer.id;
      button.append(title,detail);button.onclick=()=>{$('syncFeedback').textContent='Open '+(peer.name||peer.id)+' in Lamps → Settings → Groups, show its code, then paste it here.';$('syncJoinCode').focus();};
      $('syncPeers').append(button);
    }
  }
  renderGroupScenes();
  $('syncDiscoveryHint').textContent=peers.length?'Available coordinators on this network. Paste a coordinator’s code to join.':'No coordinators discovered yet. Create one on another lamp, or paste its code. All lamps must share a home network without client isolation.';
}
async function syncAction(action) {
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  busy=true;renderSync();
  try {const result=await wifiLamp.enqueue(action);$('syncFeedback').textContent=result||'Group updated.';$('groupSceneFeedback').textContent=result||'Group updated.';}
  catch(e){if(e.uncertain)await wifiLamp.disconnect();$('syncFeedback').textContent=e.message;$('groupSceneFeedback').textContent=e.message;}
  finally{busy=false;renderOptions();}
}
$('manageSync').onclick=()=>{settingsSection('groups');page('settings');$('syncTitle').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});};
$('createSync').onclick=()=>syncAction(async()=>{
  const code=createGroupCode(wifiLamp.identity);
  const result=await wifiLamp.configureSync(1,code);$('syncCode').value=code;$('syncCodeArea').hidden=false;return result+' Copy the code, connect to another lamp, and choose Join a group.';
});
$('showSyncCode').onclick=()=>syncAction(async()=>{$('syncCode').value=await wifiLamp.syncInvite();$('syncCodeArea').hidden=false;return 'Copy this code to join other lamps.';});
$('copySyncCode').onclick=async()=>{
  try{await navigator.clipboard.writeText($('syncCode').value);$('syncFeedback').textContent='Group code copied.';}
  catch{$('syncCode').focus();$('syncCode').select();$('syncFeedback').textContent='Code selected. Choose Copy to share it.';}
};
$('syncJoinForm').onsubmit=e=>{e.preventDefault();const code=$('syncJoinCode').value;syncAction(async()=>{parseGroupCode(code);const result=await wifiLamp.configureSync(2,code);$('syncJoinCode').value='';return result;});};
$('pauseSync').onclick=()=>syncAction(()=>wifiLamp.syncAction('pause'));
$('resumeSync').onclick=()=>syncAction(()=>wifiLamp.syncAction('resume'));
$('leaveSync').onclick=()=>syncAction(async()=>{const result=await wifiLamp.configureSync(0);$('syncCode').value='';$('syncCodeArea').hidden=true;return result;});
renderSync();

$('changeDefaultPassword').onclick=()=>{
  settingsSection('network');page('settings');
  $('adminPassword').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('adminPassword').focus();
};

for(const id of ['groupSceneSpeed','groupSceneIntensity','groupScenePrimary','groupSceneSecondary'])$(id).oninput=()=>{groupSceneDirty=true;groupSceneLabels();paintRanges();};
for(const id of ['groupAudioGain','groupAudioGate','groupAudioScale'])$(id).oninput=()=>{groupAudioDirty=true;groupSceneLabels();paintRanges();};
$('applyGroupScene').onclick=()=>syncAction(async()=>{
  const rgb=id=>[1,3,5].map(i=>parseInt($(id).value.slice(i,i+2),16));
  const result=await wifiLamp.configureGroupScene({speed:Number($('groupSceneSpeed').value),intensity:Number($('groupSceneIntensity').value),primary:rgb('groupScenePrimary'),secondary:rgb('groupSceneSecondary')});
  groupSceneDirty=false;return result;
});
$('applyGroupAudio').onclick=()=>syncAction(async()=>{
  const result=await wifiLamp.tuneAudio({gain:Number($('groupAudioGain').value),gate:Number($('groupAudioGate').value),scale:Number($('groupAudioScale').value)});
  groupAudioDirty=false;return result;
});

// Drafts belong to a lamp identity, never to the previously selected device.
var playbackIdentity=null, rotationDirty=false;
function renderPlaybackTools() {
  renderPower();
  $('controls').disabled=busy||updatingLamp()||!state||Boolean(state?.sync?.active)||Boolean(state?.calibration?.active);
  const raw=lamp===wifiLamp?state:null;
  const identity=raw?wifiLamp.identity:null;
  if(playbackIdentity!==identity){playbackIdentity=identity;rotationDirty=false;$('rotationFeedback').textContent='';$('calibrationFeedback').textContent='';}
  $('rotationPane').hidden=!raw?.rotation;
  $('calibrationPane').hidden=!raw?.calibration;
  renderSettings();
  const r=raw?.rotation,c=raw?.calibration;
  if(r){
    $('rotationBadge').textContent=r.enabled?(raw.sync?.role===2||raw.sync?.scene||c?.active||!raw.power?'Paused':'Playing'):'Off';
    $('rotationFields').disabled=busy||updatingLamp()||Boolean(c?.active)||raw.sync?.role===2;
    if(!rotationDirty){
      $('rotationEnabled').checked=r.enabled;$('rotationOrder').value=r.random?'random':'sequential';$('rotationCategory').value=r.category;
      const minutes=r.seconds%60===0;$('rotationUnit').value=minutes?'60':'1';$('rotationInterval').value=minutes?r.seconds/60:r.seconds;
    }
  }
  if(c){
    $('startCalibration').hidden=c.active;
    $('calibrationFields').hidden=!c.active||c.kind==='center';
    $('calibrationFields').disabled=busy||updatingLamp();
    $('startCalibration').disabled=busy||updatingLamp();
    $('calibrationPositionLabel').value=c.position;
    if(document.activeElement!==$('calibrationPosition'))$('calibrationPosition').value=c.position;
  }
}
$('rotationForm').oninput=()=>{rotationDirty=true;};
$('rotationForm').onsubmit=async e=>{
  e.preventDefault();if(busy||connecting||lamp!==wifiLamp||!state)return;
  const value={enabled:$('rotationEnabled').checked,random:$('rotationOrder').value==='random',category:Number($('rotationCategory').value),seconds:Number($('rotationInterval').value)*Number($('rotationUnit').value)};
  busy=true;renderPlaybackTools();
  try{const message=await wifiLamp.enqueue(()=>wifiLamp.configureRotation(value));rotationDirty=false;$('rotationFeedback').textContent=message;}
  catch(e){$('rotationFeedback').textContent=e.message;}
  finally{busy=false;renderPlaybackTools();}
};
async function calibrationAction(action,position){
  if(busy||connecting||lamp!==wifiLamp||!state)return;
  busy=true;renderPlaybackTools();
  try{
    const message=await wifiLamp.enqueue(()=>wifiLamp.calibrateLeds(action,position));
    $('calibrationFeedback').textContent=message;
    if(action==='save'){await wifiLamp.disconnect();status(message+' Reconnect after it restarts.');}
  }catch(e){$('calibrationFeedback').textContent=e.message;}
  finally{busy=false;renderPlaybackTools();}
}
$('startCalibration').onclick=()=>calibrationAction('start');
$('saveCalibration').onclick=()=>calibrationAction('save');
$('cancelCalibration').onclick=()=>calibrationAction('cancel');
$('calibrationPosition').onchange=()=>calibrationAction('move',Number($('calibrationPosition').value));
for(const button of document.querySelectorAll('[data-led-step]'))button.onclick=()=>calibrationAction('move',Math.min(1024,Math.max(1,(state?.calibration?.position||1)+Number(button.dataset.ledStep))));

function filterScenes() {
  const query=$('sceneSearch').value.trim().toLowerCase();let count=0;
  for(const button of $('groupSceneChoices').children){button.hidden=!button.dataset.sceneName.toLowerCase().includes(query);if(!button.hidden)count++;}
  $('sceneLibraryCount').textContent=Math.max(0,$('groupSceneChoices').children.length-1)+' scenes + mirror';
  $('sceneSearchEmpty').hidden=count>0;
}
$('sceneSearch').oninput=filterScenes;
renderPower();renderSettings();renderFirmware();

// Keep focused controls above the persistent navigation, including after Tab.
document.addEventListener('focusin',event=>{
  if(!event.target.matches('button,input,select,textarea,summary')||event.target.closest('nav'))return;
  requestAnimationFrame(()=>{
    const rect=event.target.getBoundingClientRect(),navTop=document.querySelector('nav').getBoundingClientRect().top;
    const limit=$('toast').hidden?navTop:Math.min(navTop,$('toast').getBoundingClientRect().top);
    if(rect.bottom>limit-14)window.scrollBy({top:rect.bottom-limit+24,behavior:'instant'});
  });
});
