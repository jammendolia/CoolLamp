import { BleClient } from '@capacitor-community/bluetooth-le';
import { LampTransport } from './transport.js';
import { firmwareMessage } from './protocol.js';
import './style.css';
import { configurationPayload } from './settings.js';
import { effectSettings } from './effect-settings.js';
import { availableGroupScenes, groupScenes, groupSceneSettings, moveGroupLamp } from './group-scenes.js';
import { createGroupCode, parseGroupCode, groupStatus } from './sync.js';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { LampStore, LampDiscoverySession, lampAddress, lampFirmwareLabel, validFirmwareVersion } from './lamps.js';
import { WifiTransport } from './wifi.js';
import { FirmwareFleet } from './firmware-fleet.js';
import { GroupDiscovery } from './group-discovery.js';
import { BluetoothGroups, initializeGroupRadio } from './bluetooth-groups.js';
import { Groups } from './groups.js';
import { GroupLightingUi } from './group-lighting-ui.js';
import { LampConnectivity, lightingObservation } from './lamp-connectivity.js';
import { LAMP_STYLES, styleDefinition, styleLabel, resolveLampStyle, recommendedEffects } from './lamp-style.js';
import { wifiSetupMessage } from './wifi-setup.js';
import { LampPairing, rememberAccessories, pairingLabel, pairingInstructions, pairingError } from './pairing.js';
const native = registerPlugin('LampNetwork');
const accessoryNative = registerPlugin('LampAccessory');
const store = new LampStore(localStorage);
const discovery = new LampDiscoverySession();
let selected = null, lamp = null, connecting = false, discovered = [], category = 'all';
let effectListKey = '', settingsView = 'lighting';
let bleWifiStatus=null, wifiSetupAbort=null, wifiSetupSerial=0;
let wifiScanning=false,wifiScanSerial=0;
let resetTarget=null;
let pairingRecoveryTarget=null;
const removedAccessoryIds=new Set();
let centerStatus=null,centerTimer=null,centerSerial=0,centerWasActive=false;
const bluetoothWifiAvailable=()=>lamp===bleLamp&&bleLamp.supportsWifiSetup&&Boolean(state);
const advancedAvailable=()=>Boolean(state&&lamp?.raw&&(lamp===wifiLamp||lamp===bleLamp&&bleLamp.supportsOfflineControl));
const groupsAvailable=()=>advancedAvailable()&&(lamp===wifiLamp||bleLamp.supportsOfflineGroups);
const isNative = Capacitor.isNativePlatform();
const sessionPasswords = new Map();
const wifiFailures = new Map();
const fleetStatuses = new Map();
let fleet=null, fleetRefreshRun=null, fleetRefreshQueued=false, fleetUpdating=false;
let fleetSummary='Versions refresh in the background. Updates start only when you choose Update all lamps.';
const groupCoordinatorStatuses=new Map();
let groupDiscovery=null,groupScanRun=null,groupScanQueued=false,groupNativePending=false,nativeDiscoveryRun=null;
let groupTaskSerial=0,groupJoinPending=null,groupJoinResult=null,groupPasswordTarget=null,groupScanMessage='';
let bluetoothGroups=null;
let roomGroups=null,groupsSnapshot={lamps:[],groups:[],ungrouped:[],unavailable:[],scanning:false};
let roomGroupsRun=null,groupEditor=null,groupEditorSerial=0,groupLightingUi=null;
const groupActions=new Set();
const groupConnections=new Map();
const groupRemovedIds=new Set();
const groupDestinations=new Map();
const liveGroupBluetooth=new Map();
let connectivity=null,lampStatusTimer=null;
let wifiSettingsTarget=null;
let cardSettingsSerial=0,navigationSerial=0;
let bleConnectivityRead=null;
let groupFocusSerial=0,pendingGroupFocus=null,roomGroupsRefreshQueued=false,roomGroupsGeneration=0,roomGroupsCompleted=0;
let effectStyleFilter='all',styleDraftIdentity=null,styleDraftDirty=false,styleSaving=null;
const lampStyleSeenAt=new Map();
async function credential(id, value) {
  if (isNative) return native.credential({id, ...(value === undefined ? {} : {value})});
  if (value !== undefined) sessionPasswords.set(id,value);
  return {value:sessionPasswords.get(id)||''};
}
function page(name,{preserveGroupFocus=false,preserveCardSettings=false}={}) {
  if(name==='light'){name='settings';settingsView='lighting';}
  ++navigationSerial;if(!preserveCardSettings)wifiSettingsTarget=null;
  if(name!=='groups'||!preserveGroupFocus){++groupFocusSerial;pendingGroupFocus=null;}
  if(name!=='settings')hideWifiPassword();
  if(name!=='groups')closeGroupEditor();
  if(name==='lamps'){$('status').textContent=state&&selected?'Connected to '+selected.name+'.':'Find a lamp on Wi-Fi, or add one using Bluetooth.';renderLamps();refreshLampFirmware();refreshBasicBluetoothTelemetry();}
  for (const item of ['lamps','groups','settings']) $('page-'+item).hidden=item!==name;
  scheduleLampStatusRefresh();
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===(name==='settings'?'lamps':name))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(name==='settings'){renderSettings();if(settingsView==='groups')refreshGroupCoordinators();}
  if(name==='groups'){$('status').textContent='Manage groups over Wi-Fi or authorized Bluetooth connections.';renderRoomGroups();refreshRoomGroups();}
  window.scrollTo(0,0);
  $('page-'+name).querySelector('h2')?.focus({preventScroll:true});
}


const $ = id => document.getElementById(id);
$('settingsLampHeading').replaceChildren($('lampRoom'),$('lampTitle'));
$('page-light').querySelector('.section-title').remove();
$('page-light').dataset.settingsPanel='lighting';$('settingsLighting').append($('page-light'));
let toastTimer;
const status = message => { $('status').textContent = message; $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); };
let state = null, editingBrightness = false, busy = false;
let firmware = null;
let firmwareReceivedAt = 0;
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
  const groupActive=groupsAvailable() && state?.sync?.scene>0;
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
  const vu=advancedAvailable()?lamp.raw?.vuColors:null;
  $('vuFields').disabled=!vu||busy;
  if(!vu)$('vuFeedback').textContent='Connect over Wi-Fi to firmware 1.6.2 or newer to set meter colors.';
  if(vu&&!vuDirty){['vuLow','vuMid','vuPeak'].forEach((id,i)=>$(id).value='#'+vu[i].map(v=>v.toString(16).padStart(2,'0')).join(''));paintVu();}

  $('fountainControls').hidden=!profile.fountain||effectTab!=='look';
  const fountain=advancedAvailable()?lamp.raw?.fountainColors:null;
  $('fountainFields').disabled=!fountain||busy;
  if(!fountain)$('fountainFeedback').textContent='Connect over Wi-Fi to firmware 1.6.6 or newer to set fountain colors.';
  if(fountain&&!fountainDirty){['fountainLow','fountainMid','fountainPeak'].forEach((id,i)=>$(id).value='#'+fountain[i].map(v=>v.toString(16).padStart(2,'0')).join(''));paintFountain();}

  const audio=advancedAvailable()?lamp.raw?.audio:null;
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

function updatingLamp() { return Boolean(firmware&&[1,3,4].includes(firmware.phase))||fleetLampInstalling(selected?.id); }
function independentLightingAllowed(){
  if(!verifiedSelectedLamp())return false;
  if([0,1,2].includes(state?.sync?.role))return state.sync.role===0;
  const group=connectivity?.get(selected.id).group;
  if(group?.fresh)return group.state==='independent';
  return legacyWithoutGroups(firmware?.version);
}
function renderPower() {
  const sync=groupsAvailable()?state?.sync:null;
  const scope=sync?.role===1?'group':sync?.role===2?'this lamp':'lamp';
  $('power').textContent='Turn '+scope+(state?.power?' off':' on');
  $('power').setAttribute('aria-pressed',String(Boolean(state?.power)));
  $('power').disabled=!state||busy||connecting||updatingLamp()||!independentLightingAllowed()||Boolean(state?.calibration?.active);
  $('brightness').disabled=!state||busy||connecting||updatingLamp()||!independentLightingAllowed()||Boolean(sync?.active)||Boolean(state?.calibration?.active);
  $('controls').disabled=!state||busy||connecting||updatingLamp()||!independentLightingAllowed()||Boolean(state?.calibration?.active);
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
  const updating = updatingLamp();
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
    const unsupported=panel.id==='hardwareForm'||panel.id==='bluetoothManagement'?!advancedAvailable():
      panel.id==='wifiSetupActions'?!bluetoothWifiAvailable():
      panel.id==='geometrySettings'?!state||(advancedAvailable()?lamp.raw?.midpoint===undefined:!(state.capabilities&128)):
      panel.id==='audioSettings'?!advancedAvailable()||!lamp.raw?.audio:
      panel.id==='calibrationPane'?!advancedAvailable()||!state?.calibration:false;
    panel.hidden=panel.dataset.settingsPanel!==settingsView||unsupported;
  }
  const observedGroup=selected?connectivity?.get(selected.id).group:null;
  const selectedRole=[0,1,2].includes(state?.sync?.role)?state.sync.role:null;
  const grouped=Boolean(state&&(selectedRole!==null?selectedRole>0:observedGroup?.fresh&&['leader','follower'].includes(observedGroup.state)));
  const membershipUnknown=Boolean(state&&lamp===bleLamp&&selectedRole===null&&!observedGroup?.fresh&&!legacyWithoutGroups(firmware?.version));
  $('page-light').hidden=settingsView!=='lighting'||grouped||membershipUnknown;
  $('lampGroupLighting').hidden=settingsView!=='lighting'||!grouped&&!membershipUnknown;
  $('lampGroupLightingTitle').textContent=membershipUnknown?'Verify this lamp’s group status':'Lighting belongs to its group';
  $('lampGroupLightingHint').textContent=(selectedRole!==null?selectedRole===1:observedGroup?.state==='leader')?'This lamp coordinates the group. Manage shared power, brightness, scenes and Mirror effects in Groups.':'This lamp follows a coordinator. Manage the group, pause its sync or leave it in Groups before choosing independent lighting.';
  if(membershipUnknown)$('lampGroupLightingHint').textContent='This Bluetooth firmware cannot report fresh group membership. Connect over Wi-Fi or update to firmware 1.10.0 or newer to verify that this lamp is independent before changing its lighting.';
  $('openLampGroupLighting').textContent=membershipUnknown?'Open Groups':'Open group controls';$('connectLampLightingWifi').hidden=!membershipUnknown;
  $('connectLampLightingWifi').textContent=selected?.address?'Connect over Wi-Fi':'Open Wi-Fi settings';
  $('settingsHint').textContent=!state?'Connect to a lamp to manage its settings.':lamp!==wifiLamp&&settingsView==='network'&&!bluetoothWifiAvailable()?'Wi-Fi setup over Bluetooth needs firmware 1.9.0 or newer. For a lamp already on your network, refresh the Wi-Fi list in Lamps and tap its card again. For first-time setup, hold the knob for three seconds to use its hotspot.':!advancedAvailable()&&settingsView==='hardware'&&(state.capabilities&128)?'Fine-tune the center over Bluetooth. Other hardware settings need Wi-Fi.':!advancedAvailable()&&['groups','hardware'].includes(settingsView)?'Update this lamp to firmware 1.10.0 for full Bluetooth settings and offline groups, or use Wi-Fi.':'';
  if(state&&lamp===bleLamp&&['network','groups'].includes(settingsView)&&wifiFailures.has(selected?.id))$('settingsHint').textContent=wifiFailures.get(selected.id)+' '+$('settingsHint').textContent;
  if(lamp===bleLamp&&advancedAvailable()&&['groups','hardware'].includes(settingsView))$('settingsHint').textContent=settingsView==='groups'?
    'Nearby lamp groups work without a router. Pair the coordinator with this phone before joining it.':'Full lamp settings are available over encrypted Bluetooth.';
  $('settingsHint').hidden=!$('settingsHint').textContent;
  for(const button of document.querySelectorAll('[data-settings-section]'))button.setAttribute('aria-pressed',String(button.dataset.settingsSection===settingsView));
  $('summaryVersion').textContent=state?(firmware?.version||'Unavailable'):'—';
  $('summaryLeds').textContent=advancedAvailable()?lamp.raw.leds+' LEDs':'—';
  $('summaryTransport').textContent=state?(lamp===wifiLamp?'Wi-Fi':'Bluetooth'):'Offline';
  const bleNetwork=bluetoothWifiAvailable();
  $('networkSettings').disabled=!state||(!advancedAvailable()&&!bleNetwork)||busy||updatingLamp();
  $('wifiSecurityControls').hidden=bleNetwork&&!advancedAvailable();
  $('wifiSettingsHint').textContent=bleNetwork?'Start with Find Wi-Fi networks, then choose your 2.4 GHz home network. Your phone stays connected over Bluetooth. Settings are saved only after the lamp connects.':'To choose a different network, start with Find Wi-Fi networks. The lamp’s hotspot remains available for recovery.';
  $('scanWifi').textContent=wifiScanning?'Scanning…':'Find Wi-Fi networks';
  $('scanWifi').setAttribute('aria-busy',String(wifiScanning));
  $('scanWifi').disabled=wifiScanning||busy||connecting||updatingLamp()||!state||(!bleNetwork&&lamp!==wifiLamp);
  $('saveWifi').textContent=bleNetwork&&!$('adminPassword').value&&!$('forgetWifi').checked?'Connect lamp to Wi-Fi':'Save & restart lamp';
  $('wifiPassword').disabled=$('openNetwork').checked;
  $('toggleWifiPassword').disabled=$('wifiPassword').disabled||busy||connecting||!state;
  if($('wifiPassword').disabled)hideWifiPassword();
  $('cancelWifiSetup').hidden=!wifiSetupAbort;
  $('switchToWifi').hidden=!bleNetwork||!bleWifiStatus?.connected||!bleWifiStatus?.ssid||busy;
  $('saveIdentity').disabled=!selected||busy||connecting||updatingLamp();
  $('forgetLamp').disabled=!selected||busy||connecting||fleetLampInstalling(selected?.id);
  $('bluetoothIdentity').hidden=settingsView!=='overview'||!selected?.deviceId;
  $('bluetoothIdentity').textContent=selected?.deviceId?'Phone pairing: '+pairingLabel(selected)+
    (selected.bluetoothName&&selected.bluetoothName!==pairingLabel(selected)?' · Device: '+selected.bluetoothName:''):'';
  $('factoryReset').disabled=!state||!selected||busy||connecting||updatingLamp()||!(state.capabilities&128);
  $('factoryResetHint').textContent=!state?'Connect to the lamp to reset it.':!(state.capabilities&128)?'Update this lamp to firmware 1.9.1 or newer for factory reset.':'Available over Bluetooth or Wi-Fi. Only this lamp will be reset.';
  $('lampName').disabled=!selected||busy||connecting;
  $('room').disabled=!selected||busy||connecting;
  renderLampStyleSettings();
  renderCenterTool();
}
function resolvedStyle(entry=selected) {
  const raw=entry&&entry.id===selected?.id&&verifiedSelectedLamp()?lamp.raw?.lampStyle:null;
  const reported=reportedLampStyle(raw)?raw:null,cached=reportedLampStyle(entry?.lampStyle)?entry.lampStyle:null;
  return resolveLampStyle(cached??reported,entry?.phoneLampStyle);
}
const reportedLampStyle=value=>value&&typeof value==='object'&&!Array.isArray(value)?styleDefinition(value):null;
$('lampStyle').replaceChildren(...LAMP_STYLES.map(style=>new Option(style.label,style.id)));
function rememberLampStyle(id,value,seenAt=Date.now()) {
  if(!reportedLampStyle(value)||!Number.isFinite(seenAt)||seenAt<(lampStyleSeenAt.get(id)||0))return;
  const entry=store.setLampStyle(id,value,{source:'lamp'});if(!entry)return;
  lampStyleSeenAt.set(id,seenAt);if(selected?.id===id)selected=entry;
}
function lampStyleIllustration(value) {
  const definition=styleDefinition(value),id=definition?.id||'unspecified',span=document.createElement('span');
  span.className='lamp-design';span.dataset.style=id;span.title=styleLabel(id);span.setAttribute('aria-label','Lamp style: '+styleLabel(id));span.setAttribute('role','img');
  const helix='<path class="design-back" d="M24 7c18 0 18 10 0 10s-18 10 0 10 18 10 0 10-18 10 0 10"/><path class="design-light" d="M24 7c-18 0-18 10 0 10s18 10 0 10-18 10 0 10 18 10 0 10"/>';
  const drawing=id==='helix'?helix:id==='large-helix'?'<g transform="translate(-4 0) scale(1.16 1)">'+helix+'</g>':id==='corkscrew'?'<path class="design-back" d="M24 6v44"/><path class="design-light" d="M28 7c-24 0-24 10 0 10s24 10 0 10-24 10 0 10 24 10 0 10"/>':'<path class="design-neutral" d="M15 49V17a9 9 0 0 1 18 0v32"/><path class="design-neutral" d="M24 21v11m0 6v1"/>';
  span.innerHTML='<svg viewBox="0 0 48 64" aria-hidden="true" focusable="false">'+drawing+'<path class="design-base" d="M12 53h24l3 5H9z"/></svg>';return span;
}
function renderLampStyleSettings() {
  const resolution=resolvedStyle(),reported=reportedLampStyle(lamp.raw?.lampStyle);
  const brokenBluetooth=lamp===bleLamp&&firmware?.version==='1.10.1',locked=brokenBluetooth&&reported?.id!=='unspecified';
  const supported=verifiedSelectedLamp()&&Boolean(reported)&&!brokenBluetooth;
  const identity=state&&selected?selected.id+'|'+lamp.epoch:null;
  if(identity!==styleDraftIdentity){styleDraftIdentity=identity;styleDraftDirty=false;$('lampStyleFeedback').textContent='';}
  if(!styleDraftDirty)$('lampStyle').value=resolution.id;
  $('lampStylePreview').replaceChildren(lampStyleIllustration($('lampStyle').value));
  $('lampStyleScope').textContent=!state||!selected?'Connect to a lamp to choose its physical design.':supported?
    resolution.source==='phone'?'Saved on this phone. Save to store this design on the lamp.':resolution.source==='lamp'?'Saved on this lamp. Changing its design keeps the current lighting and settings.':'Choose a design to save on this lamp. Its current lighting and settings stay intact.':
    'Saved on this phone. Update to firmware 1.10.1 to keep this design on the lamp.';
  $('lampStyleFields').disabled=!verifiedSelectedLamp()||!/^[0-9a-f]{12}$/.test(selected?.id||'')||busy||connecting||updatingLamp()||styleSaving?.id===selected?.id;
  if(brokenBluetooth){$('lampStyleScope').textContent=locked?'This design is saved on the lamp. Connect over Wi-Fi or update to firmware 1.10.2 to change it.':'Saved on this phone. Connect over Wi-Fi or update to firmware 1.10.2 to save its design on the lamp.';if(locked)$('lampStyleFields').disabled=true;}
  if(state&&selected&&!/^[0-9a-f]{12}$/.test(selected.id))$('lampStyleScope').textContent='Reconnect over Wi-Fi or update this lamp so its identity can be verified before choosing a design.';
}
function settingsSection(name,{preserveCardSettings=false}={}) { if(!preserveCardSettings&&wifiSettingsTarget){wifiSettingsTarget=null;++navigationSerial;}if(name==='groups'){settingsView='lighting';page('groups');return;}if(name!=='network')hideWifiPassword();settingsView=name;renderSettings(); }
function legacyWithoutGroups(version){const parts=validFirmwareVersion(version)?.split('.').map(Number);return Boolean(parts&&parts[0]===1&&(parts[1]<6||parts[1]===6&&parts[2]<=6));}
for(const button of document.querySelectorAll('[data-settings-section]'))button.onclick=()=>settingsSection(button.dataset.settingsSection);
for(const button of document.querySelectorAll('[data-goto]'))button.onclick=()=>page(button.dataset.goto);
let savedDevice = null;
try { const saved = JSON.parse(localStorage.getItem('coollamp-device')); if (typeof saved?.deviceId === 'string') savedDevice = saved; } catch {}
$('reconnect').hidden = !savedDevice;
if (savedDevice) status('Reconnect to your saved lamp. There is no need to enter pairing mode again.');
const callbacks = {
  onOptions(next) { effectOptions = next; renderOptions(); },
  onFirmware(next) {
    const previousLabel=selected?lampFirmwareLabel(selected,{connected:verifiedSelectedLamp(),firmware,firmwareReceivedAt,
      observation:fleetStatuses.get(selected.id)}):null;
    firmware = next;
    firmwareReceivedAt = Date.now();
    // Connect callbacks precede assignment of the newly verified selected lamp.
    // Save initial metadata after connect completes, never against the old card.
    if(verifiedSelectedLamp()) {
      observeLampWifi(selected.id,next?.wifi,'firmware');
      store.rememberFirmware(selected.id,next);
      const nextLabel=lampFirmwareLabel(selected,{connected:true,firmware,firmwareReceivedAt,observation:fleetStatuses.get(selected.id)});
      if(previousLabel!==nextLabel)renderLamps();
    }
    renderFirmware();
  },
  onState(next,metadata) {
    if(lamp===bleLamp&&!bleLamp.supportsOfflineControl&&centerStatus?.active)next.calibration={active:true,kind:'center',position:centerStatus.position};
    if(state?.mode!==next.mode){editingOptions=false;editingBrightness=false;}
    state = next;
    if(verifiedSelectedLamp()&&(lamp===wifiLamp||metadata?.freshControl||lamp===bleLamp&&!bleLamp.supportsOfflineControl&&legacyWithoutGroups(firmware?.version)))observeLampLighting(selected.id,{...next,deviceId:selected.id},lamp.catalog);
    if(verifiedSelectedLamp()&&lamp.raw?.lampStyle)rememberLampStyle(selected.id,lamp.raw.lampStyle);
    if(lamp===wifiLamp&&verifiedSelectedLamp())observeLampWifi(selected.id,next.connected,'state');
    $('defaultPasswordNotice').hidden=next.usingDefaultPassword!==true;
    $('controls').disabled=busy||!independentLightingAllowed()||Boolean(next.sync?.active)||Boolean(next.calibration?.active);
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
    invalidateGroupTasks();
    wifiScanning=false;++wifiScanSerial;hideWifiPassword();
    if($('wifiNetworksDialog').open){$('wifiNetworksDialog').returnValue='cancel';$('wifiNetworksDialog').close();}
    clearTimeout(centerTimer);centerTimer=null;centerStatus=null;centerWasActive=false;++centerSerial;$('centerFeedback').textContent='';
    resetTarget=null;
    if($('factoryResetDialog').open){$('factoryResetDialog').returnValue='cancel';$('factoryResetDialog').close();}
    wifiSetupAbort?.abort();wifiSetupAbort=null;bleWifiStatus=null;++wifiSetupSerial;busy=false;
    $('wifiSetupFeedback').textContent='';$('networks').replaceChildren(new Option('Choose a network or enter its name below',''));
    firmware = null; firmwareReceivedAt = 0; effectOptions = null; vuDirty=false;fountainDirty=false;audioDirty=false;paneMode=null;$('audioFeedback').textContent='';$('vuFeedback').textContent='';$('fountainFeedback').textContent='';
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
    renderSettings();
    renderLamps();
    if (!connecting) status('Disconnected. Choose a lamp to reconnect.');
  }
};
const phonePlatform=Capacitor.getPlatform();
const pairing=new LampPairing({platform:phonePlatform,native:accessoryNative,knownDevices:()=>[...store.items,savedDevice].filter(Boolean)});
async function rememberAuthorizedAccessories() {
  if(phonePlatform!=='ios')return;
  const result=await accessoryNative.list();
  if(!result.supported)return;
  rememberAccessories(store,result.devices,removedAccessoryIds);
  renderLamps();renderSettings();
}
const bleLamp = new LampTransport(BleClient, {...callbacks,
  ...(phonePlatform==='ios'?{selectDevice:device=>pairing.select(device),onRadioReady:()=>{pairing.radioStarted=true;},
    onDeviceSelected:device=>{
      if(!device.accessoryManaged)return;
      if(device.newAuthorization)removedAccessoryIds.delete(device.deviceId.toLowerCase());
      rememberAccessories(store,[device],removedAccessoryIds);renderLamps();
      status('Authorized '+device.name+'. Connecting to the lamp…');
    }}:{})});
const wifiLamp = new WifiTransport(CapacitorHttp, {...callbacks,onError:async e=>{
  if(selected?.deviceId&&!connecting&&!e.needsPassword){await connect(selected,{navigate:false});if(state&&lamp===bleLamp)reportWifiFallback(e);}
  else {if(e.needsPassword)promptWifiPassword(selected);status(e.message);}
}});
lamp=bleLamp;
fleet=new FirmwareFleet({http:CapacitorHttp,credential,getLamps:mergedLampEntries,onStatus:(id,value)=>{
  if(!mergedLampEntries().some(entry=>entry.id===id))return;
  fleetStatuses.set(id,value);
  if(value.verified&&value.fresh){
    connectivity?.observe(id,{deviceId:id,wifi:value.wifi,checkedAt:value.wifiObservedAt,source:'diagnostics'});
    if(value.group)connectivity?.observeGroup(id,{deviceId:id,group:value.group,checkedAt:value.groupObservedAt,source:'diagnostics'});
    else connectivity?.invalidateGroup(id,{attemptedAt:value.wifiObservedAt??value.attemptedAt});
    if(value.lighting)connectivity?.observeLighting(id,{deviceId:id,lighting:value.lighting,checkedAt:value.lightingObservedAt});
    else connectivity?.invalidateLighting(id,{attemptedAt:value.wifiObservedAt??value.attemptedAt});
  }else if(value.state!=='checking'){connectivity?.invalidate(id,{attemptedAt:value.attemptedAt});connectivity?.invalidateGroup(id,{attemptedAt:value.attemptedAt});connectivity?.invalidateLighting(id,{attemptedAt:value.attemptedAt});}
  if(value.verified&&value.fresh)store.rememberFirmware(id,{version:value.installedVersion,checkedAt:value.checkedAt});
  if(value.verified&&value.fresh&&value.lampStyle)rememberLampStyle(id,value.lampStyle,value.styleObservedAt);
  renderLamps();
  // Fleet tasks never select a lamp or set the app's global busy state.
  // Only the lamp actually installing needs its controls refreshed/disabled.
  if(id===selected?.id){renderPower();renderFirmware();renderOptions();renderSettings();}
}});
connectivity=new LampConnectivity({getLamps:mergedLampEntries,onStatus:()=>renderLamps()});
groupDiscovery=new GroupDiscovery({http:CapacitorHttp,credential,getLamps:mergedLampEntries,getTarget:getGroupTarget,
  onStatus:(id,value)=>{groupCoordinatorStatuses.set(id,value);renderGroupCoordinators();}});
bluetoothGroups=new BluetoothGroups({ble:BleClient,getTarget:()=>lamp===bleLamp&&verifiedSelectedLamp()?bleLamp:null,
  getLamps:()=>store.items,acquire:acquireGroupLamp,onStatus:(id,value)=>{groupCoordinatorStatuses.set(id,value);renderGroupCoordinators();}});
roomGroups=new Groups({getLamps:groupInventoryEntries,acquire:acquireGroupLamp,discover:async()=>{
  if(!isNative)return [];
  const result=await readNativeLampDiscovery();discovered=discovery.remember(result.lamps);renderLamps();return groupInventoryEntries();
},onStatus:snapshot=>{groupsSnapshot=snapshot;
  for(const row of snapshot.lamps)if(row.available&&row.verified)connectivity.observeGroup(row.id,{deviceId:row.id,group:{role:row.role,leader:row.leader},checkedAt:row.checkedAt,source:'groups'});
  renderRoomGroups();if(groupEditor)renderGroupScenes();}});
$('globalGroupEditor').append($('groupScenePane'),$('groupOrderPane'));
$('globalGroupEditor').insertBefore($('groupScenePane'),$('groupLightingControls'));
groupLightingUi=new GroupLightingUi({root:$('groupLightingControls'),getEditor:()=>groupEditor,run:action=>groupSceneAction(action,{outsideQueue:true})});
const selectedGroupRecovery=document.querySelector('.sync-panel');selectedGroupRecovery.removeAttribute('data-settings-panel');$('groupRecoveryContent').append(selectedGroupRecovery);
$('page-groups').append($('groupCoordinatorPasswordDialog'));
$('groupRecovery').ontoggle=()=>{if($('groupRecovery').open){renderSync();refreshGroupCoordinators();}};

function brightnessLabel() { $('brightnessValue').value = Math.round(Number($('brightness').value) * 100 / 255) + '%';paintRanges(); }
async function change(operation, value, activatePalette = false) {
  if (busy||fleetLampInstalling(selected?.id)) return;
  if(['power','brightness','effect','saveDefaults','color','resetColor','effectOptions'].includes(operation)&&!independentLightingAllowed()){status('Use Groups for grouped lighting, or connect over Wi-Fi to verify this lamp’s membership.');return;}
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
async function connect(saved = null,{expectedId=null,preserveWifiIntent=false,navigate=true}={}) {
  const startedNavigation=navigationSerial;
  if(!preserveWifiIntent)wifiSettingsTarget=null;
  const id=saved?.id||saved?.lampId||store.items.find(entry=>entry.deviceId===saved?.deviceId)?.id;
  if(connecting||busy||fleetLampInstalling(id))return;
  connecting=true; $('connect').disabled=true; status('Connecting over Bluetooth…');
  await stopGroupInspection(id);
  await lamp.disconnect(); lamp=bleLamp;
  const previousExpected=bleLamp.expectedDeviceIdentity;bleLamp.expectedDeviceIdentity=expectedId;
  try {
    const device=await lamp.connect(saved?.deviceId?saved:null);
    removedAccessoryIds.delete(device.deviceId.toLowerCase());
    const prior=store.items.find(x=>x.id===device.lampId || x.deviceId===device.deviceId);
    selected=store.upsert({...prior,id:device.lampId||prior?.id||'ble:'+device.deviceId,deviceId:device.deviceId,name:prior?.name||device.name||'CoolLamp',
      bluetoothName:device.bluetoothName,accessoryName:device.accessoryName,accessoryManaged:Boolean(device.accessoryManaged)});
    groupRemovedIds.delete(selected.id);roomGroups?.allow?.(selected.id);
    store.rememberFirmware(selected.id,firmware);
    $('pairingRecovery').hidden=true;pairingRecoveryTarget=null;
    savedDevice=device; connected('Bluetooth',{navigate:navigate&&navigationSerial===startedNavigation});
    return {connected:true,id:selected.id};
  } catch(e) {
    // Authorization may have succeeded even if GATT setup did not. Keep that
    // OS accessory available as a saved card for reconnect/removal.
    await rememberAuthorizedAccessories().catch(()=>{});
    const error=pairingError(e,saved);status(error.message);
    if(error.recovery)showPairingRecovery(error.device);
    return {connected:false,error:e};
  }
  finally {bleLamp.expectedDeviceIdentity=previousExpected;connecting=false; $('connect').disabled=false;
    if(verifiedSelectedLamp())observeLampWifi(selected.id,firmware?.wifi,'firmware');renderLamps();renderPower();}
}
function connected(kind,{navigate=true}={}) {
  $('addLamp').open=false;
  category='all'; $('effectSearch').value='';
  effectStyleFilter='all';styleDraftDirty=false;
  if(lamp.raw?.lampStyle)rememberLampStyle(selected.id,lamp.raw.lampStyle);
  if(lamp.raw&&lamp.catalog)observeLampLighting(selected.id,lamp.raw,lamp.catalog);
  else if(lamp===bleLamp&&legacyWithoutGroups(firmware?.version)&&lamp.catalog)observeLampLighting(selected.id,{...state,deviceId:selected.id},lamp.catalog);
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
  $('identify').disabled=!advancedAvailable()||!lamp.raw?.apiVersion;
  $('networkSettings').disabled=kind!=='Wi-Fi'&&!bluetoothWifiAvailable();
  if(advancedAvailable())fillNetwork();
  status('Connected to '+selected.name+'.');renderLamps(); filterEffects();if(navigate){settingsView='lighting';page('settings');}renderSettings();
  if(kind==='Bluetooth'&&bluetoothWifiAvailable()) {
    const epoch=bleLamp.epoch;
    bleLamp.readWifiSetup().then(value=>{
      if(lamp!==bleLamp||epoch!==bleLamp.epoch)return;
      if(busy)return;
      bleWifiStatus=value;if(!$('ssid').value)$('ssid').value=value.ssid;
      if(verifiedSelectedLamp())observeLampWifi(selected.id,value.connected,'ble-wifi');
      $('wifiSetupFeedback').textContent=wifiSetupMessage(value);
      renderSettings();
    }).catch(e=>{if(lamp===bleLamp&&epoch===bleLamp.epoch)$('wifiSetupFeedback').textContent=e.message;});
  }
  if(kind==='Bluetooth'&&!advancedAvailable()&&(state?.capabilities&128)) {
    const epoch=bleLamp.epoch;
    bleLamp.calibrateCenter('status').then(value=>{
      if(lamp!==bleLamp||epoch!==bleLamp.epoch)return;
      setCenterStatus(value);if(value.active)pollCenter();
    }).catch(e=>{if(lamp===bleLamp&&epoch===bleLamp.epoch)$('centerFeedback').textContent=e.message;});
  }
}
async function connectWifi(entry,password,{navigate=true,settingsIntent=null}={}) {
  const startedNavigation=navigationSerial;
  if(connecting||busy||fleetLampInstalling(entry.id))return;
  connecting=true;status('Connecting over Wi-Fi…');
  await stopGroupInspection(entry.id);
  await lamp.disconnect(); lamp=wifiLamp;
  try {
    if(password===undefined && entry.id) password=(await credential(entry.id)).value;
    if(!password)throw Object.assign(new Error('Enter the lamp access password to connect over Wi-Fi.'),{needsPassword:true});
    const raw=await wifiLamp.connect(entry.address,password,entry.id);
    const id=raw.deviceId||raw.hostname.replace(/\.local$/,'');
    const prior=store.items.find(x=>x.id===id || x.id===entry.id);
    selected=store.upsertWifi({...prior,id,address:lampAddress(entry.address),hostname:raw.hostname,name:raw.name||prior?.name||entry.name||'CoolLamp'},entry.id);
    groupRemovedIds.delete(id);roomGroups?.allow?.(id);
    store.rememberFirmware(selected.id,raw.firmware);
    let warning='';try {await credential(id,password);}catch(e){warning=e.message;}
    wifiFailures.delete(entry.id);wifiFailures.delete(id);
    $('password').value='';connected('Wi-Fi',{navigate:navigate&&navigationSerial===startedNavigation});if(warning)status('Connected. '+warning);
    return {connected:true};
  } catch(e) { if(e.needsPassword&&navigationSerial===(settingsIntent?.navigation??startedNavigation)&&(!settingsIntent||wifiSettingsTarget===settingsIntent))promptWifiPassword(entry);status(e.message);return {connected:false,error:e}; }
  finally { connecting=false;if(verifiedSelectedLamp())observeLampWifi(selected.id,wifiLamp.raw?.connected??firmware?.wifi,'state');renderLamps();renderPower(); }
}
function promptWifiPassword(entry) {
  const intent=wifiSettingsTarget;
  $('address').value=entry.address;$('password').value='';$('addLamp').open=true;page('lamps',{preserveCardSettings:Boolean(intent)});if(intent)intent.navigation=navigationSerial;$('password').focus();
}
function reportWifiFallback(error) {
  wifiFailures.set(selected.id,'Wi-Fi connection failed: '+error.message);
  status('Connected over Bluetooth. Wi-Fi failed: '+error.message+(bleLamp.supportsOfflineGroups?' Offline controls and nearby lamp groups remain available.':' Update this lamp to firmware 1.10.0 for full offline settings and groups.'));
  renderSettings();
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

function verifiedSelectedLamp() {
  if(connecting||!state||!selected)return false;
  if(lamp===wifiLamp)return wifiLamp.identity===selected.id;
  return lamp===bleLamp&&bleLamp.id===selected.deviceId&&
    (!bleLamp.deviceIdentity||bleLamp.deviceIdentity===selected.id);
}
function mergedLampEntries() {
  const merged=new Map(store.items.map(entry=>[entry.id,entry]));
  for(const entry of discovered)merged.set(entry.id,{...entry,...merged.get(entry.id),address:entry.address});
  return [...merged.values()];
}
function fleetLampInstalling(id) { return ['updating','restarting'].includes(fleetStatuses.get(id)?.state); }
function fleetSeenTime(value) {
  return Number.isFinite(value)&&value>0?new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
}
function fleetCardStatus(value,entry) {
  if(!value)return '';
  if(value.state==='checking')return value.message||'Reading installed firmware…';
  if(value.state==='updating')return (value.message||'Installing firmware…')+(Number.isInteger(value.progress)?' '+value.progress+'%':'');
  if(value.state==='restarting')return value.message||'Waiting for restart…';
  if(value.state==='needs-password')return 'Access password needed · tap to enter';
  if(['offline','failed','unsupported'].includes(value.state)) {
    const seen=fleetSeenTime(value.checkedAt||entry.firmwareSeenAt);
    return (value.message||value.error||'Unable to read this lamp.')+(seen?' Last seen '+seen+'.':'');
  }
  const checked=fleetSeenTime(value.checkedAt);
  const message=value.message||(value.available&&value.latestVersion?'Update '+value.latestVersion+' available':'Reachable');
  return message+(checked?' · Checked '+checked:'');
}
function renderFleetControls() {
  const entries=mergedLampEntries(),reachable=entries.some(entry=>entry.address);
  $('refreshLampFirmware').disabled=Boolean(fleetRefreshRun)||fleetUpdating||!entries.length;
  $('refreshLampFirmware').textContent=fleetRefreshRun&&!fleetUpdating?'Refreshing versions…':'Refresh versions';
  $('updateAllLamps').disabled=fleetUpdating||!reachable;
  $('updateAllLamps').textContent=fleetUpdating?'Updating lamps…':'Update all lamps';
  $('fleetFirmwareStatus').textContent=fleetSummary;
}
function refreshLampFirmware({newDiscovery=false}={}) {
  if(!fleet||fleetUpdating)return;
  if(fleetRefreshRun){fleetRefreshQueued ||= newDiscovery;return;}
  fleetSummary='Reading each lamp’s installed version in the background…';
  const run=fleet.refresh();fleetRefreshRun=run;renderFleetControls();
  run.then(result=>{
    if(result.cancelled||result.busy||fleetUpdating)return;
    const live=result.results.filter(value=>value.verified&&value.fresh).length;
    const attention=result.results.filter(value=>['offline','failed','needs-password','unsupported'].includes(value.state)).length;
    fleetSummary='Versions refreshed · '+live+' reachable'+(attention?' · '+attention+' need attention':'')+'.';
  }).catch(error=>{if(!fleetUpdating)fleetSummary=error.message||'Could not refresh lamp versions.';})
    .finally(()=>{
      if(fleetRefreshRun===run)fleetRefreshRun=null;
      renderFleetControls();
      if(fleetRefreshQueued&&!fleetUpdating){fleetRefreshQueued=false;refreshLampFirmware();}
    });
}
async function updateAllLamps() {
  if(fleetUpdating)return;
  fleetUpdating=true;fleetRefreshQueued=false;
  fleetSummary='Checking and updating lamps one at a time. You can keep using the app.';
  renderFleetControls();
  try {
    const result=await fleet.updateAll();
    const updated=result.results.filter(value=>value.state==='updated').length;
    const current=result.results.filter(value=>value.state==='ready').length;
    const attention=result.results.filter(value=>['offline','failed','needs-password','unsupported'].includes(value.state)).length;
    fleetSummary=(result.cancelled?'Stopped':'Finished')+' · '+updated+' updated · '+current+' already up to date'+
      (attention?' · '+attention+' need attention':'')+'.';
  }catch(error){fleetSummary=error.message||'Updates could not finish. Review each lamp before trying again.';}
  finally{fleetUpdating=false;renderLamps();renderPower();renderFirmware();renderOptions();renderSettings();}
}
$('refreshLampFirmware').onclick=()=>refreshLampFirmware();
$('updateAllLamps').onclick=()=>updateAllLamps();
function observeLampWifi(id,wifi,source) {
  if(typeof wifi==='boolean')wifi={connected:wifi};
  if(wifi&&typeof wifi.connected==='boolean')connectivity?.observe(id,{deviceId:id,wifi,checkedAt:Date.now(),source});
}
function observeLampLighting(id,raw,catalog,checkedAt=Date.now()){
  const lighting=lightingObservation(raw,catalog);
  if(lighting)connectivity?.observeLighting(id,{deviceId:id,lighting,checkedAt});
}
function scheduleLampStatusRefresh() {
  clearTimeout(lampStatusTimer);lampStatusTimer=null;
  if(document.hidden||$('page-lamps').hidden)return;
  lampStatusTimer=setTimeout(()=>{if(!document.hidden&&!$('page-lamps').hidden){renderLamps();refreshLampFirmware();refreshBasicBluetoothTelemetry();scheduleLampStatusRefresh();}},20000);
}
function refreshBasicBluetoothTelemetry() {
  if(bleConnectivityRead||connecting||busy||lamp!==bleLamp||!verifiedSelectedLamp()||bleLamp.supportsOfflineControl||!(state.capabilities&4)||updatingLamp())return;
  const id=selected.id,epoch=bleLamp.epoch,attemptedAt=Date.now(),run=bleLamp.refreshFirmware();bleConnectivityRead=run;
  run.catch(()=>{if(bleLamp.epoch===epoch&&selected?.id===id)connectivity.invalidate(id,{attemptedAt});})
    .finally(()=>{if(bleConnectivityRead===run)bleConnectivityRead=null;});
}
document.addEventListener('visibilitychange',scheduleLampStatusRefresh);
function activeCardBluetooth(entry) {
  const matches=transport=>transport instanceof LampTransport&&transport.id&&
    transport.identity===entry.id&&entry.deviceId?.toLowerCase()===transport.id.toLowerCase();
  if(lamp===bleLamp&&verifiedSelectedLamp()&&selected.id===entry.id&&
    entry.deviceId?.toLowerCase()===bleLamp.id?.toLowerCase())return true;
  const link=liveGroupBluetooth.get(entry.id);
  return Boolean(link&&matches(link.transport)&&link.epoch===link.transport.epoch);
}
function wifiCardIcon(entry) {
  const wifi=connectivity.get(entry.id).wifi,known=wifi.fresh&&wifi.state!=='unknown';
  const state=known?wifi.state:'unknown',strength=state==='connected'&&wifi.strengthKnown,arcs=strength?wifi.arcs:0;
  const button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-wifi';
  button.dataset.connection='wifi';button.dataset.state=state;button.dataset.arcs=String(arcs);
  const name=entry.name||'CoolLamp',description=state==='disconnected'?'Wi-Fi disconnected':state==='unknown'?'Wi-Fi status unknown':strength?'Wi-Fi connected · '+wifi.rssi+' dBm':'Wi-Fi connected · strength unknown';
  button.title=description+' · Open Wi-Fi settings';button.setAttribute('aria-label',description+'. Open '+name+' Wi-Fi settings');
  const paths=['M2.5 8a16 16 0 0 1 19 0','M5.5 11.5a11 11 0 0 1 13 0','M8.5 15a6 6 0 0 1 7 0'];
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths.map((path,index)=>'<path class="wifi-arc'+(strength&&arcs>=3-index?' active':'')+'" d="'+path+'"/>').join('')+
    '<circle class="wifi-dot'+(state==='connected'?' active':'')+'" cx="12" cy="18.5" r="1.25"/>'+
    (state==='disconnected'?'<g class="wifi-slash"><circle cx="12" cy="12" r="10"/><path d="m5 19 14-14"/></g>':!strength?'<g class="wifi-question"><circle cx="19" cy="18" r="5"/><text x="19" y="21.5" text-anchor="middle">?</text></g>':'')+'</svg>';
  button.disabled=busy||connecting||fleetLampInstalling(entry.id);button.onclick=()=>openCardWifiSettings(entry);
  return button;
}
function bluetoothCardIcon(entry) {
  const active=activeCardBluetooth(entry),button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-bluetooth'+(active?' is-active':'');
  button.dataset.connection='bluetooth';button.setAttribute('aria-pressed',String(active));
  const name=entry.name||'CoolLamp';button.title=(active?'Bluetooth connected':'Bluetooth not connected')+' · Connect to '+name;
  button.setAttribute('aria-label',(active?'Bluetooth connected. ':'')+'Connect '+name+' by Bluetooth');
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 2v20l7-6L7 7m0 10L18 8l-7-6"/></svg>';
  button.disabled=busy||connecting||fleetLampInstalling(entry.id);button.onclick=()=>connectCardBluetooth(entry);
  return button;
}
function groupCardIcon(entry) {
  const group=connectivity.get(entry.id).group,state=group.fresh?group.state:'unknown';
  const name=entry.name||'CoolLamp',leader=mergedLampEntries().find(lamp=>lamp.id===group.leader)?.name;
  const description=state==='leader'?name+' leads a group':state==='follower'?name+' is a member of '+(leader?leader+'’s group':'a coordinator’s group'):state==='independent'?name+' is independent':name+' group membership is unknown';
  const button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-group';button.dataset.connection='group';button.dataset.state=state;
  button.title=description+' · Open Groups';button.setAttribute('aria-label',description+'. Open Groups');
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10.5 8.5-3.5 7m6.5-7 3.5 7M8 18h8"/><circle class="group-leader" cx="12" cy="5.5" r="3"/><circle cx="5" cy="18" r="3"/><circle class="group-follower" cx="19" cy="18" r="3"/></svg>';
  button.disabled=connecting;button.onclick=()=>openCardGroups(entry);return button;
}
function openCardGroups(entry) {
  if(!mergedLampEntries().some(lamp=>lamp.id===entry.id))return;
  const serial=++groupFocusSerial;pendingGroupFocus={id:entry.id,name:entry.name||'CoolLamp',serial,requestedAt:Date.now(),generation:roomGroupsGeneration+1};
  if(roomGroupsRun)roomGroupsRefreshQueued=true;
  page('groups',{preserveGroupFocus:true});focusPendingCardGroup();
}
function focusPendingCardGroup() {
  const pending=pendingGroupFocus;if(!pending||pending.serial!==groupFocusSerial||$('page-groups').hidden)return;
  if(!mergedLampEntries().some(lamp=>lamp.id===pending.id)){pendingGroupFocus=null;return;}
  // Only a completed scan started after this card click may determine its destination.
  if(roomGroupsCompleted<pending.generation||groupsSnapshot.scanning||roomGroupsRun||roomGroupsRefreshQueued)return;
  const row=groupsSnapshot.lamps.find(lamp=>lamp.id===pending.id);
  const fresh=row?.verified&&row.available&&row.checkedAt>=pending.requestedAt;
  let target;
  if(fresh){
    const container=row.role===0?$('ungroupedLamps'):$('groupsList');
    target=row.role===1?[...container.querySelectorAll('[data-group-id]')].find(group=>group.dataset.groupId===pending.id):
      [...container.querySelectorAll('[data-group-lamp-id]')].find(lamp=>lamp.dataset.groupLampId===pending.id);
  }else if(!groupsSnapshot.scanning&&!roomGroupsRun&&!roomGroupsRefreshQueued){
    target=[...$('groupsUnavailableList').querySelectorAll('[data-group-lamp-id]')].find(lamp=>lamp.dataset.groupLampId===pending.id);
    if(target)$('groupsUnavailable').open=true;
    else{target=$('groupsFeedback');target.textContent='Current group membership for '+pending.name+' could not be verified. Refresh or connect to that lamp.';}
  }
  if(!target)return;
  $('page-groups').querySelectorAll('.group-focus-target').forEach(element=>element.classList.remove('group-focus-target'));
  target.classList.add('group-focus-target');target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});
  if(!groupsSnapshot.scanning&&!roomGroupsRun&&!roomGroupsRefreshQueued)pendingGroupFocus=null;
}
for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,()=>{if(pendingGroupFocus){++groupFocusSerial;pendingGroupFocus=null;}},{capture:true,passive:true});
async function pairCardBluetooth(entry) {
  if(!/^[0-9a-f]{12}$/.test(entry.id)){status('Add this lamp by Bluetooth first so its identity can be verified.');return false;}
  const dialog=document.createElement('dialog'),form=document.createElement('form'),title=document.createElement('h2'),instructions=document.createElement('p'),actions=document.createElement('div');
  dialog.className='card-pairing-dialog';form.method='dialog';title.textContent='Pair '+(entry.name||'this lamp');
  instructions.textContent='Hold this lamp’s knob for six seconds until it flashes blue, then select it in the Bluetooth picker. We’ll verify its identity before opening controls.';
  actions.className='dialog-actions';
  for(const [value,text] of [['cancel','Cancel'],['pair','Choose this lamp']]){const button=document.createElement('button');button.value=value;button.textContent=text;if(value==='cancel')button.className='secondary';actions.append(button);}
  form.append(title,instructions,actions);dialog.append(form);document.body.append(dialog);
  const choice=new Promise(resolve=>dialog.addEventListener('close',()=>{const chosen=dialog.returnValue==='pair';dialog.remove();resolve(chosen);},{once:true}));dialog.showModal();return choice;
}
async function connectCardBluetooth(entry,{forWifiSettings=false,forCardSettings=false}={}) {
  if(busy||connecting||fleetLampInstalling(entry.id))return;
  if(!forWifiSettings&&!forCardSettings)return openCardSettings(entry,{section:'lighting',bluetooth:true});
  const current=mergedLampEntries().find(value=>value.id===entry.id);if(!current){status('This lamp was removed. Find it again before connecting.');return;}
  if(wifiSettingsTarget?.id!==entry.id)wifiSettingsTarget=null;
  const intent=wifiSettingsTarget;
  if(lamp===bleLamp&&verifiedSelectedLamp()&&selected.id===entry.id)return {connected:true,id:entry.id};
  if(!current.deviceId&&!await pairCardBluetooth(current)){wifiSettingsTarget=null;return;}
  if(intent&&(wifiSettingsTarget!==intent||navigationSerial!==intent.navigation))return;
  if(!mergedLampEntries().some(value=>value.id===entry.id)){status('This lamp was removed. Find it again before connecting.');return;}
  const result=await connect(current,{expectedId:/^[0-9a-f]{12}$/.test(entry.id)?entry.id:null,preserveWifiIntent:true,navigate:false});
  if(!result?.connected&&!forCardSettings)wifiSettingsTarget=null;return result;
}
function completeCardSettings(intent) {
  const current=mergedLampEntries().find(entry=>entry.id===intent.id);
  if(wifiSettingsTarget!==intent||navigationSerial!==intent.navigation||!current||current.address!==intent.address||current.deviceId!==intent.deviceId||!verifiedSelectedLamp()||selected.id!==intent.id)return false;
  if(lamp===wifiLamp&&(!intent.address||lamp.base!==lampAddress(intent.address)))return false;
  const epoch=lamp.epoch,target=lamp;
  settingsSection(intent.section,{preserveCardSettings:true});if(lamp!==target||target.epoch!==epoch||!verifiedSelectedLamp()||selected.id!==intent.id)return false;
  page('settings');$('lampTitle').focus({preventScroll:true});return true;
}
async function openCardSettings(entry,{section='overview',bluetooth=false,preferWifi=false}={}) {
  if(busy||connecting||fleetLampInstalling(entry.id))return;
  let current=mergedLampEntries().find(value=>value.id===entry.id);if(!current)return;
  const intent={id:current.id,address:current.address,deviceId:current.deviceId,section,serial:++cardSettingsSerial,navigation:navigationSerial};
  wifiSettingsTarget=intent;
  const pending=()=>wifiSettingsTarget===intent&&navigationSerial===intent.navigation&&mergedLampEntries().some(value=>value.id===intent.id&&value.address===intent.address&&value.deviceId===intent.deviceId);
  if(!(verifiedSelectedLamp()&&selected.id===entry.id&&(!bluetooth||lamp===bleLamp)&&(!preferWifi||lamp===wifiLamp||!current.address))){
    let result,wifiResult;
    if(current.address&&!bluetooth)result=wifiResult=await connectWifi(current,undefined,{navigate:false,settingsIntent:intent});
    if(!pending())return result;
    if(!result?.connected){
      current=mergedLampEntries().find(value=>value.id===entry.id);if(!current)return;
      if(current.deviceId||!current.address||bluetooth)result=await connectCardBluetooth(current,{forCardSettings:true});
    }
    if(result?.connected&&!intent.deviceId&&wifiSettingsTarget===intent&&lamp===bleLamp&&bleLamp.deviceIdentity===intent.id&&selected?.id===intent.id)intent.deviceId=selected.deviceId;
    if(!pending())return result;
    if(!result?.connected){if(wifiResult?.error?.needsPassword)return wifiResult;if(!result?.error?.needsPassword)wifiSettingsTarget=null;return result;}
  }
  if(!completeCardSettings(intent)){if(wifiSettingsTarget===intent)wifiSettingsTarget=null;return;}
  return {connected:true,id:entry.id};
}
const openCardWifiSettings=entry=>openCardSettings(entry,{section:'network'});
function renderLamps() {
  const focused=document.activeElement?.closest('.lamp-entry');
  const focusedId=focused?.dataset.lampId,focusedRemove=document.activeElement?.classList.contains('lamp-remove'),focusedConnection=document.activeElement?.dataset.connection;
  $('discover').textContent=discovery.scanned?'Refresh Wi-Fi list':'Find on Wi-Fi';
  $('lampList').replaceChildren();
  const entries=mergedLampEntries();
  $('emptyLamps').hidden=entries.length>0;
  for(const entry of entries) {
    const wrapper=document.createElement('div');wrapper.className='lamp-entry';wrapper.dataset.lampId=entry.id;
    const button=document.createElement('button');button.className='lamp-card';
    const title=document.createElement('strong');title.textContent=entry.name||'CoolLamp';
    const detail=document.createElement('span');detail.textContent=[entry.room,discovered.some(x=>x.id===entry.id)?'Found on Wi-Fi':entry.address?'Saved Wi-Fi lamp':'Saved Bluetooth lamp'].filter(Boolean).join(' · ');
    const connected=verifiedSelectedLamp()&&entry.id===selected.id;
    const version=document.createElement('small');version.className='lamp-firmware';
    const observation=fleetStatuses.get(entry.id);
    version.textContent=lampFirmwareLabel(entry,{connected,firmware,firmwareReceivedAt,observation});
    const activeAt=connected&&validFirmwareVersion(firmware?.version)?firmwareReceivedAt:0;
    const pingAt=observation?.verified&&observation.fresh&&validFirmwareVersion(observation.installedVersion)&&
      Number.isFinite(observation.checkedAt)?observation.checkedAt:0;
    const seen=Math.max(activeAt,pingAt)||observation?.checkedAt||entry.firmwareSeenAt;
    if(seen)version.title='Last verified '+new Date(seen).toLocaleString();
    button.append(lampStyleIllustration(resolvedStyle(entry).id),title,detail,version);button.disabled=connecting||busy||fleetLampInstalling(entry.id);
    const lighting=connectivity.get(entry.id).lighting,note=document.createElement('small');note.className='lamp-current-effect';note.textContent=lighting?.label||'Effect unavailable';note.dataset.state=lighting?.state||'unknown';
    if(lighting?.checkedAt)note.title='Last verified '+new Date(lighting.checkedAt).toLocaleString();button.append(note);
    const updateStatus=fleetCardStatus(observation,entry);
    if(updateStatus){const note=document.createElement('small');note.className='lamp-update-status';note.textContent=updateStatus;button.append(note);}
    if(fleetLampInstalling(entry.id)){
      const progress=document.createElement('progress');progress.className='lamp-update-progress';progress.max=100;
      if(observation.state==='updating'&&Number.isInteger(observation.progress))progress.value=observation.progress;
      progress.setAttribute('aria-label',(entry.name||'Lamp')+' firmware update progress');button.append(progress);
    }
    button.setAttribute('aria-current',String(connected));
    if(connected)detail.textContent=(entry.room?entry.room+' · ':'')+'Connected · '+(lamp===wifiLamp?'Wi-Fi':entry.address?'Bluetooth · Tap to retry Wi-Fi':'Bluetooth');
    button.onclick=()=>openCardSettings(entry,{section:'lighting',preferWifi:true});
    const remove=document.createElement('button');remove.type='button';remove.className='lamp-remove';
    remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    remove.setAttribute('aria-label','Remove '+(entry.name||'CoolLamp')+' from this phone');remove.disabled=busy||connecting||fleetLampInstalling(entry.id);
    remove.onclick=e=>{e.stopPropagation();removeLampFromPhone(entry).catch(()=>{});};
    const gear=document.createElement('button');gear.type='button';gear.className='lamp-connection lamp-settings';gear.dataset.connection='settings';gear.title='Settings for '+(entry.name||'CoolLamp');gear.setAttribute('aria-label',gear.title);
    gear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 3-.6 2.1-2 .9-2-.5-2 3.5 1.4 1.6v2.8L2.4 15l2 3.5 2-.5 2 .9L9 21h4l.6-2.1 2-.9 2 .5 2-3.5-1.4-1.6v-2.8l1.4-1.6-2-3.5-2 .5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3.4"/></svg>';
    gear.disabled=busy||connecting||fleetLampInstalling(entry.id);gear.onclick=()=>openCardSettings(entry,{section:'overview'});
    const links=document.createElement('div');links.className='lamp-connections';links.append(wifiCardIcon(entry),bluetoothCardIcon(entry),groupCardIcon(entry));
    wrapper.append(button,links,gear,remove);$('lampList').append(wrapper);
    if(focusedId===entry.id){const control=focusedConnection==='settings'?gear:focusedConnection?links.querySelector('[data-connection="'+focusedConnection+'"]'):focusedRemove?remove:button;if(control&&!control.disabled)control.focus({preventScroll:true});}
  }
  renderFleetControls();
}
async function discover(includeForgotten=false) {
  const startedNavigation=navigationSerial;
  if(!isNative){status('Automatic discovery is available in the iPhone and Android app. You can enter a lamp address here.');return;}
  $('discover').disabled=true;status('Looking for lamps on your Wi-Fi…');
  if(includeForgotten)discovery.beginRefresh();
  try {
    const result=await readNativeLampDiscovery();discovered=discovery.remember(result.lamps);
    renderLamps();status(discovered.length?'Choose a lamp to connect.':'No lamps found. Check Local Network permission and that your phone and lamp use the same home network. You can also enter its address or use Bluetooth.');
    refreshLampFirmware({newDiscovery:true});
    const remembered=store.items.find(x=>x.id===localStorage.getItem('coollamp-selected'));
    const available=remembered&&discovered.find(x=>x.id===remembered.id);
    if(available&&!state&&!connecting)await connectWifi({...remembered,address:available.address},undefined,{navigate:navigationSerial===startedNavigation});
  }catch(e){status(e.message);}finally{$('discover').disabled=false;}
}
$('discover').onclick=()=>discover(true);
$('wifiConnect').onsubmit=async e=>{
  e.preventDefault();const address=$('address').value.trim();let normalized;try{normalized=lampAddress(address);}catch(e){status(e.message);return;}
  const target=wifiSettingsTarget?.address===normalized?wifiSettingsTarget:null;
  const entry=target?mergedLampEntries().find(value=>value.id===target.id&&value.address===normalized):
    discovered.find(value=>value.address===normalized)||store.items.find(value=>value.address===normalized)||{address:normalized};
  if(!entry){wifiSettingsTarget=null;status('This lamp’s address changed. Choose its Wi-Fi icon again.');return;}
  if(!target)wifiSettingsTarget=null;else target.navigation=navigationSerial;
  const result=await connectWifi(entry,$('password').value||undefined,{navigate:!target,settingsIntent:target});
  if(target&&result?.connected)completeCardSettings(target);
};
$('openLampGroupLighting').onclick=()=>{if(selected&&verifiedSelectedLamp())openCardGroups(selected);};
$('connectLampLightingWifi').onclick=()=>{if(selected&&verifiedSelectedLamp())openCardSettings(selected,{section:selected.address?'lighting':'network',preferWifi:Boolean(selected.address)});};
for(const button of document.querySelectorAll('[data-page]'))button.onclick=()=>page(button.dataset.page);
function filterEffects() {
  const query=$('effectSearch').value.trim().toLowerCase();
  const catalog=state ? lamp?.catalog || [] : [];
  const design=resolvedStyle(),knownStyle=design.id!=='unspecified';
  if(!knownStyle)effectStyleFilter='all';
  const styleCatalog=effectStyleFilter==='recommended'?recommendedEffects(catalog,design.id):catalog;
  $('styleEffectsHint').textContent=knownStyle?'Recommendations for '+styleLabel(design.id)+'. All effects remain available.':'Choose a lamp design in Settings to see recommendations.';
  for(const button of document.querySelectorAll('[data-style-filter]')){button.setAttribute('aria-pressed',String(button.dataset.styleFilter===effectStyleFilter));if(button.dataset.styleFilter==='recommended')button.disabled=!knownStyle;}
  $('libraryCount').textContent=catalog.length?catalog.length+' effects':'Explore the collection';
  $('currentEffect').textContent=state?'Current: '+(catalog.find(x=>x.id===state.mode)?.name || 'Loading effects…'):'Choose a lamp to browse its effects.';
  document.querySelector('[data-category=audio]').hidden=!catalog.some(entry=>entry.category==='audio');
  if(category==='audio' && !catalog.some(entry=>entry.category==='audio')) {
    category='all';document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.category==='all')));
  }
  const key=JSON.stringify([catalog,query,category,selected?.favorites,state?.mode,effectStyleFilter,design.id]);
  if(key===effectListKey)return;
  effectListKey=key;
  const focused=document.activeElement?.dataset.effect;
  $('effectGrid').replaceChildren();
  $('effect').replaceChildren();
  styleCatalog.forEach(({id:mode,name,category:group})=>{if((!query||name.toLowerCase().includes(query))&&(category==='all'||(category==='favorites'?selected?.favorites?.includes(mode):group===category)))$('effect').add(new Option(name,mode));});
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
for(const button of document.querySelectorAll('[data-style-filter]'))button.onclick=()=>{effectStyleFilter=button.dataset.styleFilter;filterEffects();};
for(const button of document.querySelectorAll('[data-category]'))button.onclick=()=>{category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));filterEffects();};
$('favoriteEffect').onclick=()=>{if(!selected||!state)return;const favorites=new Set(selected.favorites||[]);if(favorites.has(state.mode))favorites.delete(state.mode);else favorites.add(state.mode);selected=store.upsert({...selected,favorites:[...favorites]});$('favoriteEffect').setAttribute('aria-pressed',String(favorites.has(state.mode)));$('favoriteEffect').textContent=favorites.has(state.mode)?'♥':'♡';filterEffects();};
function fillNetwork() {
  const raw=lamp.raw;
  $('geometrySettings').hidden=raw.midpoint===undefined;
  $('midpoint').max=Math.max(0,raw.leds-1);$('midpoint').value=raw.midpoint?Math.min(raw.midpoint,raw.leds-1):0;
  $('audioSettings').hidden=!raw.audio;
  if(raw.audio){$('microphoneInstalled').checked=raw.audio.installed;renderEffectPane();}
  for(const id of ['ssid','leds','milliamps'])$(id).value=raw[id];
  $('startupMode').replaceChildren(...lamp.catalog.map(x=>new Option(x.name,x.id)));
  $('startupMode').value=raw.startupMode||raw.mode;$('startupBrightness').value=raw.startupBrightness||raw.brightness;
  for(const id of ['wifiPassword','adminPassword'])$(id).value='';
  for(const id of ['openNetwork','forgetWifi'])$(id).checked=false;
  renderSettings();
}
async function networkAction(action) {
  if(busy||connecting||!advancedAvailable())return;
  busy=true;$('networkSettings').disabled=true;renderPower();renderSettings();
  try{await lamp.enqueue(action);}catch(e){if(e.uncertain)await lamp.disconnect();status(e.message);}finally{busy=false;$('networkSettings').disabled=!advancedAvailable();renderOptions();renderSettings();}
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
    if(advancedAvailable()&&lamp.raw.apiVersion)await lamp.enqueue(()=>lamp.request('/api/name',{name}));
    selected=store.upsert({...selected,name,room});$('lampTitle').textContent=name;$('lampRoom').textContent=room||'YOUR LAMP';renderLamps();status(advancedAvailable()&&lamp.raw?.apiVersion?'Lamp name saved. Room saved on this phone.':'Name and room saved on this phone.');
  }catch(e){status(e.message);}finally{busy=false;}
};
$('lampStyle').onchange=()=>{styleDraftDirty=true;$('lampStyleFeedback').textContent='';renderLampStyleSettings();};
$('lampStyleForm').onsubmit=async event=>{
  event.preventDefault();if(!verifiedSelectedLamp()||!/^[0-9a-f]{12}$/.test(selected?.id||'')||styleSaving||busy||connecting||updatingLamp())return;
  const definition=styleDefinition($('lampStyle').value);if(!definition)return;
  const target=lamp,id=selected.id,epoch=target.epoch,supported=Boolean(reportedLampStyle(target.raw?.lampStyle));
  const brokenBluetooth=target===bleLamp&&firmware?.version==='1.10.1';
  if(brokenBluetooth&&reportedLampStyle(target.raw?.lampStyle)?.id!=='unspecified')return;
  const saveOnLamp=supported&&!brokenBluetooth;
  styleSaving={id,epoch};renderLampStyleSettings();
  const guard=()=>{if(lamp!==target||selected?.id!==id||target.epoch!==epoch||!verifiedSelectedLamp())throw Error('The selected lamp changed. Choose its design again.');};
  try{
    if(saveOnLamp){await target.enqueue(async()=>{guard();await target.configureLampStyle(definition.id);guard();});guard();rememberLampStyle(id,target.raw.lampStyle);if(!store.setLampStyle(id,'unspecified',{source:'phone'}))throw Error('This lamp’s identity could not be saved. Reconnect before choosing its design.');}
    else{guard();if(!store.setLampStyle(id,definition.id,{source:'phone'}))throw Error('This lamp’s identity could not be saved. Reconnect before choosing its design.');}
    selected=store.items.find(entry=>entry.id===id)||selected;styleDraftDirty=false;
    $('lampStyleFeedback').textContent=saveOnLamp?'Lamp design saved on this lamp.':'Lamp design saved on this phone.';renderLamps();filterEffects();
  }catch(error){if(lamp===target&&selected?.id===id&&target.epoch===epoch)$('lampStyleFeedback').textContent=error.uncertain?'Design was not confirmed. Reconnect to verify it before trying again.':error.message;}
  finally{styleSaving=null;renderLampStyleSettings();}
};
$('identify').onclick=()=>networkAction(async()=>status(await lamp.request('/api/identify',{})));
$('pairingStatus').onclick=()=>networkAction(async()=>{const result=await lamp.request('/api/bluetooth');const value=typeof result==='string'?JSON.parse(result):result;status(value.pairing?'Pairing is open.':'Pairing is closed. Hold the knob for six seconds to open it.');});
$('forgetPhones').onclick=()=>{if(confirm('Remove every phone paired with this lamp? Hold its knob for six seconds to open pairing first.'))networkAction(async()=>status(await lamp.request('/api/bluetooth/forget',{})));};
function showWifiNetworks(networks) {
  $('networks').replaceChildren(new Option('Choose a network or enter its name below',''),...networks.map(x=>{
    const strength=typeof x.rssi==='number'?(x.rssi>=-60?'Strong signal':x.rssi>=-75?'Good signal':'Weak signal'):'';
    const option=new Option(x.ssid+(x.open?' (open)':'')+(strength?' · '+strength:''),x.ssid);option.dataset.open=String(x.open);return option;
  }));
  const message=networks.length?'Scan complete — '+networks.length+' network'+(networks.length===1?'':'s')+' found. Choose your network.':
    'Scan complete — no nearby networks found. Try again or enter a hidden network name.';
  $('wifiSetupFeedback').textContent=message;status(message);
  $('wifiNetworkChoices').replaceChildren(...Array.from($('networks').options).slice(1).map(option=>{
    const button=document.createElement('button');button.type='button';button.className='wifi-network-choice';
    const name=document.createElement('strong');name.textContent=option.value;
    const detail=document.createElement('span');detail.textContent=(option.dataset.open==='true'?'Password-free':'Password required')+
      (option.textContent.includes(' · ')?' · '+option.textContent.split(' · ').at(-1):'');
    button.append(name,detail);button.onclick=()=>{
      $('networks').value=option.value;$('networks').dispatchEvent(new Event('change'));
      $('wifiNetworksDialog').returnValue='selected';$('wifiNetworksDialog').close();
    };return button;
  }));
  if(networks.length&&settingsView==='network'&&!$('page-settings').hidden) {
    $('wifiNetworksDescription').textContent=networks.length+' nearby network'+(networks.length===1?'':'s')+'. Select your 2.4 GHz home Wi-Fi.';
    $('wifiNetworksDialog').showModal();
  }
}
$('wifiNetworksDialog').addEventListener('close',()=>{
  if($('wifiNetworksDialog').returnValue==='manual')$('ssid').focus();
  if($('wifiNetworksDialog').returnValue==='selected'&&!$('openNetwork').checked)$('wifiPassword').focus();
});
function hideWifiPassword() {
  const input=$('wifiPassword'),button=$('toggleWifiPassword');if(!input||!button)return;
  input.type='password';button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','Show Wi-Fi password');
  button.querySelector('[data-password-slash]').setAttribute('hidden','');
}
$('toggleWifiPassword').onpointerdown=e=>e.preventDefault();
$('toggleWifiPassword').onclick=()=>{
  const input=$('wifiPassword'),shown=input.type==='password';input.type=shown?'text':'password';
  $('toggleWifiPassword').setAttribute('aria-pressed',String(shown));
  $('toggleWifiPassword').setAttribute('aria-label',shown?'Hide Wi-Fi password':'Show Wi-Fi password');
  $('toggleWifiPassword').querySelector('[data-password-slash]').toggleAttribute('hidden',!shown);
};
$('scanWifi').onclick=async()=>{
  if(busy||connecting||!state||wifiScanning||(!bluetoothWifiAvailable()&&lamp!==wifiLamp))return;
  const serial=++wifiScanSerial;wifiScanning=true;renderSettings();
  $('wifiSetupFeedback').textContent='Please wait, scanning nearby 2.4 GHz Wi-Fi networks…';
  try {
    if(bluetoothWifiAvailable())await bluetoothNetworkAction(async options=>{
      status('Finding nearby Wi-Fi networks…');const networks=await bleLamp.scanWifi(options);
      if(!options.signal.aborted&&serial===wifiScanSerial)showWifiNetworks(networks);
    });
    else await networkAction(async()=>{
      status('Scanning Wi-Fi networks…');await wifiLamp.request('/api/scan',{});
      const epoch=wifiLamp.epoch;
      for(let attempt=0;attempt<25;attempt++) {
        await new Promise(r=>setTimeout(r,1000));if(epoch!==wifiLamp.epoch)throw new Error('Connection changed.');
        const result=await wifiLamp.request('/api/scan');const scan=typeof result==='string'?JSON.parse(result):result;
        if(scan.status==='failed')throw new Error('Wi-Fi scan failed. Try again.');
        if(scan.status==='complete'){if(serial===wifiScanSerial)showWifiNetworks(scan.networks);return;}
      }throw new Error('Wi-Fi scan timed out. Try again.');
    });
  }finally{if(serial===wifiScanSerial){wifiScanning=false;renderSettings();}}
};
$('networks').onchange=()=>{if($('networks').value){$('ssid').value=$('networks').value;$('openNetwork').checked=$('networks').selectedOptions[0].dataset.open==='true';if($('openNetwork').checked)$('wifiPassword').value='';renderSettings();}};
$('openNetwork').onchange=()=>{if($('openNetwork').checked)$('wifiPassword').value='';renderSettings();};
$('adminPassword').oninput=renderSettings;$('forgetWifi').onchange=renderSettings;
for(const [id,section] of [['networkForm','network'],['hardwareForm','hardware']])$(id).onsubmit=e=>{
  if(section==='network'&&bluetoothWifiAvailable()&&(!advancedAvailable()||!$('adminPassword').value&&!$('forgetWifi').checked)) {
    e.preventDefault();if(busy||connecting)return;
    const ssid=$('ssid').value,password=$('wifiPassword').value,open=$('openNetwork').checked;
    hideWifiPassword();
    $('wifiPassword').value='';
    status('Connecting the lamp to Wi-Fi…');
    bluetoothNetworkAction(options=>bleLamp.configureWifi(ssid,password,open,options)).then(value=>{
      if(!value)return;
      bleWifiStatus=value;$('wifiSetupFeedback').textContent=wifiSetupMessage(value);status(wifiSetupMessage(value));renderSettings();
      return handoffBluetoothWifi();
    }).catch(e=>status(e.message));return;
  }
  e.preventDefault();if(!advancedAvailable()||!confirm('Save '+(section==='hardware'?'strip and startup':'Wi-Fi and security')+' settings and restart this lamp?'))return;
  const draft={};for(const field of ['ssid','wifiPassword','adminPassword','leds','milliamps','startupMode','startupBrightness'])draft[field]=$(field).value;
  for(const field of ['openNetwork','forgetWifi'])draft[field]=$(field).checked;
  const data=configurationPayload(lamp.raw,section,draft);
  networkAction(async()=>{
    const message=await lamp.request('/api/config',data);
    if(data.adminPassword)await credential(selected.id,data.adminPassword);
    await lamp.disconnect();status(message+' Find the lamp again after it restarts.');
  });
};
$('geometryForm').onsubmit=e=>{
  e.preventDefault();networkAction(async()=>{
    status(await lamp.configureGeometry(Number($('midpoint').value)));
  });
};
function renderCenterTool(){
  const wifi=advancedAvailable(),raw=wifi?lamp.raw:null,c=raw?.calibration;
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
  if(lamp===bleLamp&&state&&!advancedAvailable())state={...state,calibration:value.active?{active:true,kind:'center',position:value.position}:undefined};
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
    const result=advancedAvailable()?await target.enqueue(()=>target.calibrateCenter(action)):await bleLamp.calibrateCenter(action);
    if(target!==lamp||epoch!==lamp.epoch)return;
    if(target===bleLamp&&!advancedAvailable())setCenterStatus(result);
    else if(action==='save')$('midpoint').value=lamp.raw.midpoint;
    $('centerFeedback').textContent=action==='save'?'Center saved. Normal lighting restored.':action==='cancel'?'Previous center kept. Normal lighting restored.':'Turn the knob to move the blinking white marker.';
  }catch(e){$('centerFeedback').textContent=e.message;}
  finally{busy=false;renderOptions();if(lamp===bleLamp&&!advancedAvailable()&&centerStatus?.active)pollCenter();}
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
  if(busy || connecting || !advancedAvailable())return;
  const tuning={gain:Number($('audioGain').value),gate:Number($('audioGate').value),...(lamp.raw.audio.scale===undefined?{}:{scale:Number($('audioScale').value)})};
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try {
    const message=await lamp.enqueue(()=>lamp.tuneAudio(tuning));
    audioDirty=false;$('audioFeedback').textContent=message;status(message);
  }catch(e){if(e.uncertain)await lamp.disconnect();$('audioFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=!advancedAvailable();renderOptions();}
};
$('audioForm').onsubmit=e=>{
  e.preventDefault();
  networkAction(async()=>{
    const message=await lamp.configureAudio({enabled:Number($('microphoneInstalled').checked),gain:lamp.raw.audio.gain,gate:lamp.raw.audio.gate,...(lamp.raw.audio.scale===undefined?{}:{scale:lamp.raw.audio.scale})});
    status(message+' Reconnect after the lamp restarts.');
  });
};
async function removeLampFromPhone(entry,confirmed=false) {
  if(!entry||busy||connecting||fleetLampInstalling(entry.id))return;
  if(!confirmed&&!confirm('Remove '+(entry.name||'this lamp')+' from this phone? '+
    (phonePlatform==='ios'?'Its iPhone pairing will also be removed where supported.':'You may also need to forget its pairing in Bluetooth settings.')+
    ' The lamp’s settings stay unchanged.'))return;
  busy=true;connecting=true;renderLamps();renderSettings();
  try {
    groupRemovedIds.add(entry.id);invalidateGroupTasks();roomGroups?.forget?.(entry.id);fleet?.forget(entry.id);connectivity?.forget(entry.id);
    await stopGroupInspection(entry.id);
    if(selected?.id===entry.id&&state)await lamp.disconnect();
    let result;
    try { result=await pairing.remove(entry); }
    catch(error) {
      if(!error.manualPairingRemoval||!confirm('The old iPhone pairing could not be authorized for automatic removal. Remove this lamp from the app only? You will need to forget its pairing in Bluetooth settings.'))throw error;
      result=await pairing.remove(entry,{appOnly:true});
    }
    if(entry.deviceId)removedAccessoryIds.add(entry.deviceId.toLowerCase());
    await credential(entry.id,'');
    store.remove(entry.id);discovered=discovery.forget(entry.id);fleetStatuses.delete(entry.id);
    if(localStorage.getItem('coollamp-selected')===entry.id)localStorage.removeItem('coollamp-selected');
    if(savedDevice&&(savedDevice.lampId===entry.id||savedDevice.deviceId===entry.deviceId)){savedDevice=null;localStorage.removeItem('coollamp-device');$('reconnect').hidden=true;}
    if(selected?.id===entry.id)selected=null;
    page('lamps');status(result.removed?'Lamp and iPhone pairing removed. The lamp’s settings are unchanged.':
      result.manual?'Lamp removed from this app. Finish clearing its phone pairing below.':'Lamp removed from this app. The lamp’s settings are unchanged.');
    $('pairingRecovery').hidden=true;pairingRecoveryTarget=null;
    if(result.manual)showPairingRecovery(entry);
    return result;
  }catch(e){if(store.items.some(item=>item.id===entry.id)){groupRemovedIds.delete(entry.id);roomGroups?.allow?.(entry.id);}status('Could not finish removing the lamp: '+e.message);throw e;}
  finally{connecting=false;busy=false;renderLamps();renderSettings();}
}
function showPairingRecovery(device={}) {
  page('lamps');
  pairingRecoveryTarget=device;
  $('pairingRecovery').hidden=false;
  $('pairingRecoverySteps').textContent=pairingInstructions(phonePlatform,device);
  $('repairPairing').hidden=phonePlatform!=='ios'||!device.deviceId;
  $('openBluetoothSettings').hidden=phonePlatform!=='android';
  $('pairingRecovery').scrollIntoView({block:'nearest'});
}
$('dismissPairingRecovery').onclick=()=>{$('pairingRecovery').hidden=true;pairingRecoveryTarget=null;};
$('openBluetoothSettings').onclick=()=>BleClient.openBluetoothSettings().catch(()=>status('Open your phone’s Settings → Bluetooth to forget the lamp.'));
$('repairPairing').onclick=async()=>{
  const target=pairingRecoveryTarget;if(!target||busy||connecting)return;
  busy=true;$('repairPairing').disabled=true;renderLamps();
  try {
    await bleLamp.disconnect();
    const result=await pairing.remove(target);
    if(!result.removed){status('This old pairing needs to be forgotten in iPhone Settings. Follow the steps below.');return;}
    const record=store.items.find(d=>d.deviceId===target.deviceId);
    if(record)store.upsert({...record,accessoryManaged:true});
    status('Old pairing removed. Keep the lamp flashing blue and select it again.');
    $('pairingRecovery').hidden=true;pairingRecoveryTarget=null;
    busy=false;await connect();
  }catch(e){status(pairingError(e,target).message);}
  finally{busy=false;$('repairPairing').disabled=false;renderLamps();renderSettings();}
};
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
  let resetConfirmed=false;
  try {
    await target.factoryReset();resetConfirmed=true;busy=false;
    const result=await removeLampFromPhone(entry,true);
    status(result?.manual?'Factory reset started. Clear the phone’s old pairing using the steps below.':
      'Factory reset started. Hold the knob for six seconds until blue to pair again.');
  }catch(e){
    status(resetConfirmed?'Factory reset started, but phone pairing cleanup did not finish. '+e.message:
      e.confirmed?e.message:'Factory reset was not confirmed. Check the lamp before retrying. '+e.message);
    if(resetConfirmed)showPairingRecovery(entry);
  }
  finally{busy=false;renderSettings();}
});
paintRanges();renderLamps();refreshLampFirmware();scheduleLampStatusRefresh();
if(phonePlatform==='ios')rememberAuthorizedAccessories().catch(()=>{});
if(isNative)discover();

function paintVu(){const [a,b,c]=['vuLow','vuMid','vuPeak'].map(id=>$(id).value);$('vuPreview').style.background=`linear-gradient(to right,${a} 0 65%,${b} 65% 80%,${c} 80% 100%)`;}
for(const id of ['vuLow','vuMid','vuPeak'])$(id).oninput=()=>{vuDirty=true;paintVu();$('vuFeedback').textContent='Unsaved meter colors';};
async function saveVu(reset=false){
  if(busy||connecting||!advancedAvailable())return;
  const colors=reset?null:['vuLow','vuMid','vuPeak'].map(id=>$(id).value.slice(1).match(/../g).map(v=>parseInt(v,16)));
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try{const message=await lamp.enqueue(()=>lamp.configureVuColors(colors));vuDirty=false;$('vuFeedback').textContent=message;status(message);}
  catch(e){if(e.uncertain)await lamp.disconnect();$('vuFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=!advancedAvailable();renderOptions();}
}
$('applyVu').onclick=()=>saveVu();$('resetVu').onclick=()=>saveVu(true);

function paintFountain(){const [a,b,c]=['fountainLow','fountainMid','fountainPeak'].map(id=>$(id).value);$('fountainPreview').style.background=`linear-gradient(to right,${a} 0 33.33%,${b} 33.33% 66.67%,${c} 66.67% 100%)`;}
for(const id of ['fountainLow','fountainMid','fountainPeak'])$(id).oninput=()=>{fountainDirty=true;paintFountain();$('fountainFeedback').textContent='Unsaved fountain colors';};
async function saveFountain(reset=false){
  if(busy||connecting||!advancedAvailable())return;
  const colors=reset?null:['fountainLow','fountainMid','fountainPeak'].map(id=>$(id).value.slice(1).match(/../g).map(v=>parseInt(v,16)));
  busy=true;$('controls').disabled=true;$('networkSettings').disabled=true;
  try{const message=await lamp.enqueue(()=>lamp.configureFountainColors(colors));fountainDirty=false;$('fountainFeedback').textContent=message;status(message);}
  catch(e){if(e.uncertain)await lamp.disconnect();$('fountainFeedback').textContent=e.message;status(e.message);}
  finally{busy=false;$('controls').disabled=!state||Boolean(state?.sync?.active);$('networkSettings').disabled=!advancedAvailable();renderOptions();}
}
$('applyFountain').onclick=()=>saveFountain();$('resetFountain').onclick=()=>saveFountain(true);


let syncIdentity=null;
function readNativeLampDiscovery() {
  if(nativeDiscoveryRun)return nativeDiscoveryRun;
  const run=native.discover();nativeDiscoveryRun=run;
  run.finally(()=>{if(nativeDiscoveryRun===run)nativeDiscoveryRun=null;}).catch(()=>{});
  return run;
}
function groupInventoryEntries() {
  const entries=new Map(mergedLampEntries().filter(entry=>!groupRemovedIds.has(entry.id)).map(entry=>[entry.id,{...entry}]));
  const sources=[lamp?.raw?.sync,groupEditor?.lamp?.raw?.sync,...groupsSnapshot.lamps.map(row=>row.sync)];
  for(const source of sources)for(const peer of source?.peers||[]){
    if(!/^[0-9a-f]{12}$/.test(peer.id)||groupRemovedIds.has(peer.id)||discovery.forgotten.has(peer.id))continue;
    const previous=entries.get(peer.id)||{},value={id:peer.id,name:peer.name,...previous};
    if(!value.address&&peer.address){try{value.address=lampAddress(peer.address);}catch{}}
    entries.set(peer.id,value);
  }
  return [...entries.values()];
}
async function acquireGroupLamp(id,options={}) {
  if(groupRemovedIds.has(id))throw Object.assign(Error('Connect to this lamp again to authorize group management.'),{needsAuthorization:true});
  const current=groupInventoryEntries().find(entry=>entry.id===id);
  if(!current)throw Object.assign(Error('Find or pair this lamp again before managing its groups.'),{needsAuthorization:true});
  options={...options,entry:current};
  if(verifiedSelectedLamp()&&lamp.identity===id&&advancedAvailable())return {lamp,release:async()=>{}};
  if(groupEditor?.lamp?.identity===id)return {lamp:groupEditor.lamp,release:async()=>{}};
  let connection=groupConnections.get(id);
  if(!connection){connection={refs:0,closed:false,promise:createGroupLampLease(id,options)};groupConnections.set(id,connection);}
  ++connection.refs;
  try{
    const lease=await connection.promise;
    if(connection.closed)throw Error('Lamp connection changed. Refresh Groups.');
    let released=false;
    return {lamp:lease.lamp,release:async()=>{
      if(released)return;released=true;
      if(connection.closed)return;
      if(--connection.refs===0){connection.closed=true;if(groupConnections.get(id)===connection)groupConnections.delete(id);await lease.release();}
    }};
  }catch(error){if(--connection.refs===0&&groupConnections.get(id)===connection)groupConnections.delete(id);throw error;}
}
async function stopGroupInspection(id) {
  roomGroups?.cancel();
  if(groupEditor?.id===id)await closeGroupEditor();
  const connection=groupConnections.get(id);if(!connection)return;
  connection.closed=true;groupConnections.delete(id);
  try{const lease=await connection.promise;await lease.release();}catch{}
}
async function createGroupLampLease(id,{entry}={}) {
  entry=groupInventoryEntries().find(value=>value.id===id);
  if(!entry||!/^[0-9a-f]{12}$/.test(id))throw Error('Find or pair this lamp before managing its groups.');
  let wifiError;
  if(entry.address&&!(lamp===bleLamp&&state&&bleLamp.supportsOfflineGroups&&entry.deviceId)){
    const transport=new WifiTransport(CapacitorHttp);
    try{
      const password=(await credential(id)).value||'coollamp';
      await transport.connect(entry.address,password,id);clearTimeout(transport.timer);
      return {lamp:transport,release:()=>transport.disconnect()};
    }catch(error){wifiError=error;await transport.disconnect();}
  }
  if(lamp===bleLamp&&bleLamp.id&&bleLamp.identity===id)
    throw Object.assign(Error('Keep using this lamp’s Bluetooth controls. Full group management needs firmware 1.10.0 or a working Wi-Fi connection.'),{incompatible:true});
  if(!entry.deviceId||phonePlatform==='ios'&&!entry.accessoryManaged){
    if(wifiError)throw wifiError;
    throw Object.assign(Error('Pair this lamp first. Hold its knob for six seconds and add it by Bluetooth.'),{needsPairing:true});
  }
  await initializeGroupRadio({transport:bleLamp,ble:BleClient,platform:phonePlatform,pairing,accessories:accessoryNative,
    knownDevices:()=>[...store.items,savedDevice].filter(Boolean),onAuthorized:devices=>rememberAccessories(store,devices,removedAccessoryIds)});
  let transport;
  const clearLink=()=>{if(liveGroupBluetooth.get(id)?.transport===transport){liveGroupBluetooth.delete(id);renderLamps();}};
  transport=new LampTransport(BleClient,{sharedInitialization:bleLamp.initialization,expectedDeviceIdentity:id,controlOnly:true,onDisconnect:clearLink});
  try{
    await transport.connect({...entry,lampId:id});
    if(!transport.supportsOfflineGroups)throw Error('Update this lamp to firmware 1.10.0 for offline groups.');
    observeLampWifi(id,transport.raw?.firmware?.wifi,'firmware');
    liveGroupBluetooth.set(id,{transport,epoch:transport.epoch});renderLamps();
    return {lamp:transport,release:()=>{clearLink();return transport.disconnect();}};
  }catch(error){await transport.disconnect();throw error;}
}
function refreshRoomGroups() {
  if(!roomGroups)return;if(roomGroupsRun)return roomGroupsRun;
  const generation=++roomGroupsGeneration;
  const run=roomGroups.refresh();roomGroupsRun=run;renderRoomGroups();
  run.catch(error=>{$('groupsFeedback').textContent=error.message;}).finally(()=>{
    if(roomGroupsRun===run){roomGroupsRun=null;roomGroupsCompleted=generation;}renderRoomGroups();
    if(roomGroupsRefreshQueued){roomGroupsRefreshQueued=false;refreshRoomGroups();}
  });return run;
}
async function roomGroupAction(id,action) {
  if(groupActions.has(id))return;
  groupActions.add(id);$('groupsFeedback').textContent='Saving group settings…';renderRoomGroups();
  try{
    const result=await action();
    $('groupsFeedback').textContent=result?.message||(result?.phase==='joined'||result?.phase==='already-member'?
      result.active?'Following coordinator.':'Group settings saved. Waiting for coordinator.':result?.phase==='left'?'Lamp left its group.':result?.phase==='created'?'Coordinator ready. Add lamps below.':'Group settings saved.');
    if(groupEditor)renderGroupScenes();
  }catch(error){$('groupsFeedback').textContent=error.leftPrevious?error.message:error.uncertain?'Change was not confirmed. Refresh this lamp before trying again.':error.message;}
  finally{groupActions.delete(id);renderRoomGroups();}
}
function groupLampRow(row,{follower=false}={}) {
  const item=document.createElement('div');item.className='room-group-lamp';item.dataset.groupLampId=row.id;
  const copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');
  name.textContent=row.name||row.id;
  detail.textContent=!row.available?(row.message||'Offline · last seen'):row.role===2?(row.sync?.paused?'Paused · local settings':row.sync?.active?'Following coordinator':'Waiting for coordinator'):row.role===1?'Coordinator':'Independent';
  copy.append(name,detail);item.append(copy);
  const usable=row.available&&row.verified&&!groupActions.has(row.id);
  if(row.state==='needs-pairing'){
    const pair=document.createElement('button');pair.type='button';pair.className='secondary compact';pair.textContent='Pair to manage';
    pair.onclick=()=>{page('lamps');status('Hold '+(row.name||'this lamp')+'’s knob for six seconds until it flashes blue, then choose Add using Bluetooth.');};item.append(pair);
  }
  if(row.state==='needs-identity'){
    const verify=document.createElement('button');verify.type='button';verify.className='secondary compact';verify.textContent='Connect to verify';
    verify.onclick=()=>connect(store.items.find(entry=>entry.id===row.id));item.append(verify);
  }
  if(row.role===2){
    const leave=document.createElement('button');leave.type='button';leave.className='text-button';leave.textContent='Leave';leave.disabled=!usable;
    leave.onclick=()=>roomGroupAction(row.id,()=>roomGroups.leave(row.id));item.append(leave);
    const pause=document.createElement('button');pause.type='button';pause.className='text-button';pause.textContent=row.sync?.paused?'Resume':'Pause';pause.disabled=!usable;
    pause.onclick=()=>roomGroupAction(row.id,()=>row.sync?.paused?roomGroups.resume(row.id):roomGroups.pause(row.id));item.append(pause);
  }
  if(row.role===0){
    const lead=document.createElement('button');lead.type='button';lead.className='secondary compact';lead.textContent='Lead a new group';lead.disabled=!usable;
    lead.onclick=()=>roomGroupAction(row.id,()=>roomGroups.create(row.id));item.append(lead);
  }
  if(row.role===0||follower){
    const destinations=groupsSnapshot.groups.filter(group=>group.id!==row.leader&&group.id!==row.id&&group.available&&group.leader.verified&&group.remaining>0);
    const controls=document.createElement('div');controls.className='room-group-destination';
    const select=document.createElement('select');select.setAttribute('aria-label',(follower?'Move ':'Join ')+(row.name||'lamp')+' to group');select.add(new Option(follower?'Choose another group':'Choose a group',''));
    for(const group of destinations)select.add(new Option(group.name,group.id));
    select.disabled=!usable||destinations.length===0;
    const draft=groupDestinations.get(row.id);if(destinations.some(group=>group.id===draft))select.value=draft;else groupDestinations.delete(row.id);
    const move=document.createElement('button');move.type='button';move.className='secondary compact';move.textContent=follower?'Move':'Join';move.disabled=!usable||!select.value;
    select.onchange=()=>{groupDestinations.set(row.id,select.value);move.disabled=!usable||!select.value;};
    move.onclick=()=>roomGroupAction(row.id,()=>follower?roomGroups.move(row.id,select.value):roomGroups.join(row.id,select.value));
    controls.append(select,move);item.append(controls);
  }
  return item;
}
function renderRoomGroups() {
  if(!$('groupsList'))return;
  const active=document.activeElement,focusedId=active?.closest('[data-group-lamp-id]')?.dataset.groupLampId;
  const focusedTag=active?.tagName,focusedText=active?.textContent;
  $('groupsList').replaceChildren();$('ungroupedLamps').replaceChildren();$('groupsUnavailableList').replaceChildren();
  for(const group of groupsSnapshot.groups){
    const card=document.createElement('section');card.className='panel room-group';card.dataset.groupId=group.id;
    const heading=document.createElement('div');heading.className='section-title';
    const title=document.createElement('div'),kicker=document.createElement('p'),name=document.createElement('h3');kicker.className='eyebrow';kicker.textContent='COORDINATOR';name.textContent=group.name||'Lamp group';title.append(kicker,name);heading.append(title);
    const effects=document.createElement('button');effects.type='button';effects.className='secondary compact';effects.textContent='Effects';effects.disabled=!group.available||!group.leader.verified||groupActions.has(group.id);
    effects.onclick=()=>openGroupEditor(group.id);heading.append(effects);card.append(heading);
    const detail=document.createElement('p');detail.className='hint';detail.textContent=group.available?group.followers.length+' following · '+group.remaining+' spaces available':group.placeholder?'Coordinator unavailable. Its followers keep their saved membership.':'Coordinator offline · last seen';card.append(detail);
    const members=document.createElement('div');members.className='group-lamp-list';
    for(const row of group.followers)members.append(groupLampRow(row,{follower:true}));
    if(!group.followers.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Ready for lamps. Choose this group beside an independent lamp below.';members.append(empty);}card.append(members);$('groupsList').append(card);
  }
  for(const row of groupsSnapshot.ungrouped)$('ungroupedLamps').append(groupLampRow(row));
  const legacy=store.items.filter(entry=>entry.deviceId&&!/^[0-9a-f]{12}$/.test(entry.id)).map(entry=>({...entry,verified:false,available:false,role:null,
    state:'needs-identity',message:'Connect once by Bluetooth to verify this lamp’s identity before managing its groups.'}));
  const unavailable=[...groupsSnapshot.unavailable,...legacy];
  for(const row of unavailable)$('groupsUnavailableList').append(groupLampRow(row));
  $('ungroupedEmpty').hidden=groupsSnapshot.ungrouped.length>0;
  $('groupsUnavailable').hidden=unavailable.length===0;$('groupsUnavailableCount').textContent=unavailable.length;
  $('refreshAllGroups').disabled=Boolean(roomGroupsRun)||groupsSnapshot.scanning;$('refreshAllGroups').textContent=roomGroupsRun||groupsSnapshot.scanning?'Refreshing…':'Refresh';
  $('groupsInventoryStatus').textContent=groupsSnapshot.scanning?'Checking lamps in the background. You can keep using the app.':
    groupsSnapshot.groups.length?groupsSnapshot.groups.length+' '+(groupsSnapshot.groups.length===1?'group':'groups')+' · '+groupsSnapshot.ungrouped.length+' independent lamps.':'Create a group from an independent lamp below. Pair nearby lamps or find lamps on Wi-Fi to add them here.';
  if(focusedId){const row=$('page-groups').querySelector('[data-group-lamp-id="'+focusedId+'"]');
    const control=focusedTag==='SELECT'?row?.querySelector('select'):[...row?.querySelectorAll('button')||[]].find(button=>button.textContent===focusedText);
    if(control&&!control.disabled)control.focus({preventScroll:true});}
  focusPendingCardGroup();
}
async function closeGroupEditor() {
  ++groupEditorSerial;const previous=groupEditor;groupEditor=null;$('globalGroupEditor').hidden=true;
  if(previous)await previous.release();renderGroupScenes();
}
async function openGroupEditor(id) {
  const closing=closeGroupEditor(),serial=groupEditorSerial;await closing;if(serial!==groupEditorSerial)return;$('groupsFeedback').textContent='Opening group effects…';
  let lease;
  try{
    lease=await acquireGroupLamp(id);if(serial!==groupEditorSerial){await lease.release();return;}
    await lease.lamp.enqueue(()=>lease.lamp.refresh(id));
    if(serial!==groupEditorSerial){await lease.release();return;}
    if(lease.lamp.raw.sync?.role!==1)throw Error('This lamp is no longer a coordinator. Refresh the group list.');
    groupEditor={...lease,id,epoch:lease.lamp.epoch,busy:false};
    sceneChoicesKey='';groupOrderKey='';groupSceneDirty=false;groupAudioDirty=false;
    $('globalGroupEditorTitle').textContent=(lease.lamp.raw.name||'Group')+' · effects';$('globalGroupEditor').hidden=false;$('groupsFeedback').textContent='';renderGroupScenes();
    $('globalGroupEditor').scrollIntoView({block:'start'});
    $('globalGroupEditorTitle').tabIndex=-1;$('globalGroupEditorTitle').focus({preventScroll:true});
  }catch(error){await lease?.release();$('groupsFeedback').textContent=error.message;}
}
async function groupSceneAction(action,{outsideQueue=false}={}) {
  const editor=groupEditor;if(!editor||editor.busy)return;editor.busy=true;$('globalGroupEditorStatus').textContent='Updating this group…';renderGroupScenes();
  try{
    const guard=()=>{if(groupEditor!==editor||editor.lamp.epoch!==editor.epoch||editor.lamp.identity!==editor.id)throw Error('The group changed. Open its effects again.');};
    const queued=await editor.lamp.enqueue(async()=>{guard();await editor.lamp.refresh(editor.id);guard();if(editor.lamp.raw.sync?.role!==1)throw Error('This lamp is no longer a coordinator.');return outsideQueue?null:action(editor.lamp);});
    guard();const result=outsideQueue?await action(editor.lamp):queued;
    guard();$('groupSceneFeedback').textContent=result||'Group updated.';$('globalGroupEditorStatus').textContent='Changes applied to this group.';refreshRoomGroups();
  }catch(error){if(groupEditor===editor){$('groupSceneFeedback').textContent=error.message;$('globalGroupEditorStatus').textContent=error.uncertain?'Change was not confirmed. Refresh this group before trying again.':error.message;}}
  finally{editor.busy=false;renderGroupScenes();}
}
$('refreshAllGroups').onclick=refreshRoomGroups;$('closeGroupEditor').onclick=closeGroupEditor;
function getGroupTarget() {
  if(!groupsAvailable()||!verifiedSelectedLamp())return null;
  return {id:lamp.identity,address:lamp.base,epoch:lamp.epoch,sync:lamp.raw?.sync,wireVersion:lamp.raw?.sync?.version};
}
function sameGroupTarget(expected) {
  const target=getGroupTarget();
  return Boolean(target&&expected&&target.id===expected.id&&target.address===expected.address&&target.epoch===expected.epoch);
}
function groupJoinForCurrent() { return Boolean(groupJoinPending&&sameGroupTarget(groupJoinPending.target)); }
function invalidateGroupTasks() {
  ++groupTaskSerial;groupDiscovery?.cancel();bluetoothGroups?.cancel();groupScanRun=null;groupScanQueued=false;groupNativePending=false;
  groupJoinPending=null;groupJoinResult=null;groupPasswordTarget=null;groupCoordinatorStatuses.clear();groupScanMessage='';
  $('groupCoordinatorPassword').value='';
  if($('groupCoordinatorPasswordDialog').open)$('groupCoordinatorPasswordDialog').close();
}
function groupJoinReason() {
  const target=getGroupTarget();
  if(!target)return lamp===bleLamp&&state?'Update this lamp to firmware 1.10.0 for offline groups, or connect over Wi-Fi.':'Connect to this lamp to join a coordinator.';
  if(![1,2].includes(target.sync?.version))return 'Update this lamp’s firmware to use lamp groups.';
  if(target.sync.role!==0)return 'Leave this lamp’s current group before joining a different coordinator.';
  if(groupJoinForCurrent())return 'Joining this lamp. You can keep using other pages and lamps.';
  if(busy||connecting||updatingLamp()||state?.calibration?.active)return 'Finish this lamp’s setup or update before joining a group.';
  return '';
}
function renderGroupCoordinators() {
  const active=document.activeElement?.closest('.group-coordinator');
  const focused=active?.dataset.coordinatorId;
  $('syncPeers').replaceChildren();
  const reason=groupJoinReason();$('groupJoinEligibility').textContent=reason;$('groupJoinEligibility').hidden=!reason;
  let verified=0,attention=0;
  for(const [id,value] of groupCoordinatorStatuses){
    if(id===selected?.id||value.state==='not-coordinator')continue;
    if(!['checking','coordinator','needs-password','needs-pairing','offline','failed'].includes(value.state))continue;
    if(value.state==='coordinator'&&(!value.verified||value.role!==1))continue;
    const known=mergedLampEntries().find(entry=>entry.id===id);
    const row=document.createElement('div');row.className='group-coordinator';row.dataset.coordinatorId=id;
    const text=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('span');
    name.textContent=known?.name||value.name||'CoolLamp';
    if(value.state==='coordinator'){
      ++verified;detail.textContent=[known?.room,value.message||('Coordinator · '+(value.members??0)+' following')].filter(Boolean).join(' · ');
    }else if(value.state==='needs-pairing'){++attention;detail.textContent='Pair this coordinator with this phone first. Hold its knob for six seconds, connect by Bluetooth, then return to this lamp.';}
    else if(value.state==='needs-password'){++attention;detail.textContent='Enter its access password to verify the coordinator.';}
    else {if(['offline','failed'].includes(value.state))++attention;detail.textContent=value.message||'Checking this lamp…';}
    text.append(name,detail);row.append(text);
    const button=document.createElement('button');button.type='button';button.className='secondary compact';
    const retry=['offline','failed'].includes(value.state);
    button.textContent=value.state==='needs-pairing'?'Pair first':value.state==='needs-password'?'Enter password':value.state==='coordinator'?'Join':retry?'Retry':'Checking';
    button.disabled=retry?Boolean(groupScanRun)||groupNativePending:Boolean(reason)||!['coordinator','needs-password'].includes(value.state)||
      (value.state==='coordinator'&&value.joinable===false);
    button.onclick=()=>retry?refreshGroupCoordinators():value.state==='needs-password'?askGroupCoordinatorPassword(id):joinGroupCoordinator(id);
    row.append(button);$('syncPeers').append(row);
    if(focused===id&&!button.disabled)button.focus({preventScroll:true});
  }
  $('refreshGroupCoordinators').disabled=Boolean(groupScanRun)||groupNativePending||groupJoinForCurrent();
  $('refreshGroupCoordinators').textContent=groupScanRun||groupNativePending?'Looking for coordinators…':'Refresh coordinators';
  $('syncDiscoveryHint').textContent=groupScanRun||groupNativePending?'Finding coordinators in the background. You can keep using the app.':
    groupScanMessage||(verified?'Choose Join beside a coordinator. Your selected lamp stays selected.'+(attention?' Some lamps need attention.':''):
      attention?'No coordinator verified yet. Check the lamps needing attention, or refresh.':'No coordinators found yet. Make another lamp a coordinator, then refresh.');
}
function refreshGroupCoordinators({useNative=true}={}) {
  if(!groupDiscovery||groupJoinForCurrent())return;
  const serial=groupTaskSerial;
  if(lamp===bleLamp){
    if(groupScanRun||!bleLamp.supportsOfflineGroups)return;
    const run=bluetoothGroups.scan();groupScanRun=run;groupScanMessage='';renderGroupCoordinators();
    run.catch(error=>{if(serial===groupTaskSerial)groupScanMessage=error.message;}).finally(()=>{
      if(groupScanRun===run)groupScanRun=null;if(serial===groupTaskSerial)renderGroupCoordinators();
    });return;
  }
  if(useNative&&isNative&&!groupNativePending){
    groupNativePending=true;renderGroupCoordinators();
    readNativeLampDiscovery().then(result=>{
      if(serial!==groupTaskSerial)return;
      discovered=discovery.remember(result.lamps);renderLamps();
      if(groupScanRun)groupScanQueued=true;else refreshGroupCoordinators({useNative:false});
    }).catch(error=>{if(serial===groupTaskSerial)groupScanMessage=error.message||'Wi-Fi discovery could not finish. Saved lamps are still checked.';})
      .finally(()=>{if(serial===groupTaskSerial){groupNativePending=false;renderGroupCoordinators();}});
  }
  if(groupScanRun)return;
  groupScanMessage='';const run=groupDiscovery.scan();groupScanRun=run;renderGroupCoordinators();
  run.then(result=>{if(serial===groupTaskSerial&&!result.cancelled&&result.coordinators.length===0&&
    !result.results.some(value=>['needs-password','offline','failed'].includes(value.state)))
      groupScanMessage='No coordinators found yet. Make another lamp a coordinator, then refresh.';
  }).catch(error=>{if(serial===groupTaskSerial)groupScanMessage=error.message||'Could not check coordinators.';})
    .finally(()=>{
      if(groupScanRun===run)groupScanRun=null;
      if(serial!==groupTaskSerial)return;
      renderGroupCoordinators();
      if(groupScanQueued){groupScanQueued=false;refreshGroupCoordinators({useNative:false});}
    });
}
function askGroupCoordinatorPassword(id) {
  const reason=groupJoinReason();if(reason){$('syncFeedback').textContent=reason;return;}
  const value=groupCoordinatorStatuses.get(id);if(!value)return;
  groupPasswordTarget={id,target:getGroupTarget()};
  $('groupCoordinatorPasswordTitle').textContent='Join '+(mergedLampEntries().find(entry=>entry.id===id)?.name||value.name||'coordinator');
  $('groupCoordinatorPasswordFeedback').textContent='';$('groupCoordinatorPassword').value='';
  $('groupCoordinatorPasswordDialog').showModal();$('groupCoordinatorPassword').focus();
}
async function joinGroupCoordinator(id,password,expected=getGroupTarget()) {
  const reason=groupJoinReason();if(reason){$('syncFeedback').textContent=reason;return;}
  if(!sameGroupTarget(expected)){$('syncFeedback').textContent='The selected lamp changed. Choose Join again.';return;}
  const serial=groupTaskSerial;groupJoinPending={id,target:expected};
  $('syncFeedback').textContent='Getting the coordinator’s invitation…';renderSync();
  try{
    const invitation=await (lamp===bleLamp?bluetoothGroups:groupDiscovery).invite(id,password);
    if(serial!==groupTaskSerial||!sameGroupTarget(expected))throw Error('The selected lamp changed. Choose Join again.');
    const fields=parseGroupCode(invitation.code);
    if(invitation.id!==id||invitation.targetId!==expected.id||fields.leader!==id)throw Error('The coordinator invitation changed. Refresh and try again.');
    let passwordWarning='';
    if(password!==undefined){try{await credential(id,password);}catch{passwordWarning=' The coordinator password could not be saved on this phone.';}}
    if(serial!==groupTaskSerial||!sameGroupTarget(expected))throw Error('The selected lamp changed. Choose Join again.');
    const result=await lamp.joinCoordinator(invitation.code,{...expected,leader:id});
    if(serial!==groupTaskSerial||!sameGroupTarget(expected))return;
    groupJoinResult={target:expected,leader:id,passwordWarning};
    $('syncFeedback').textContent=(result.active?'Following coordinator · shared light and sound.':
      'Group settings saved. Waiting for coordinator; using local settings.')+passwordWarning;
    renderOptions();
  }catch(error){
    if(serial!==groupTaskSerial||!sameGroupTarget(expected))return;
    if(error.needsPassword){groupJoinPending=null;askGroupCoordinatorPassword(id);}
    else $('syncFeedback').textContent=error.uncertain?'Join was not confirmed. Check this lamp before trying again.':error.message;
  }finally{
    if(serial===groupTaskSerial){groupJoinPending=null;renderSync();}
  }
}
$('refreshGroupCoordinators').onclick=()=>refreshGroupCoordinators();
$('groupCoordinatorPasswordForm').onsubmit=event=>{
  event.preventDefault();const pending=groupPasswordTarget,password=$('groupCoordinatorPassword').value;
  $('groupCoordinatorPassword').value='';$('groupCoordinatorPasswordDialog').close();groupPasswordTarget=null;
  if(pending)joinGroupCoordinator(pending.id,password,pending.target);
};
$('cancelGroupCoordinatorPassword').onclick=()=>{$('groupCoordinatorPasswordDialog').close();};
$('groupCoordinatorPasswordDialog').addEventListener('close',()=>{$('groupCoordinatorPassword').value='';groupPasswordTarget=null;});
function renderGroupScenes() {
  groupLightingUi?.render();
  const lamp=groupEditor?.lamp,state=lamp?.state||lamp?.raw,busy=Boolean(groupEditor?.busy);
  const updatingLamp=()=>Boolean(state?.firmware&&[1,3,4].includes(state.firmware.phase));
  const sync=state?.sync;
  const ready=sync?.version===2 && sync.role>0,controller=ready&&sync.role===1;
  $('groupScenePane').hidden=!ready;
  $('groupOrderPane').hidden=!controller;
  if(!ready)return;
  $('groupSceneLibrary').hidden=!controller;
  const scene=groupScenes.find(x=>x.id===sync.scene)||groupScenes[0];
  const sceneFirmware=scene.id>26?'1.9.6':scene.id>18?'1.9.5':scene.id>8?'1.8.1':'1.8.0';
  $('groupSceneTitle').textContent=scene.id?scene.name:'Group scenes';
  $('groupSceneSpeedLabel').textContent=scene.speedLabel||({3:'Flow speed',4:'Bloom speed',6:'Storm pace',8:'Wave speed'})[scene.id]||'Travel speed';
  $('groupSceneDescription').textContent=scene.description+(scene.id>8?' Requires firmware '+sceneFirmware+' or newer on every lamp.':'')+(controller?'':' Choose and tune scenes on the coordinator.');
  $('groupScenePosition').textContent=Number.isInteger(sync.count)&&sync.count>0&&Number.isInteger(sync.position)&&sync.position>=0?
    'Lamp '+(sync.position+1)+' of '+sync.count:'';
  $('groupSceneWaiting').hidden=!controller||sync.members>=1;
  $('groupSceneWaiting').textContent='Join a second lamp to see the scene. Each lamp needs firmware '+sceneFirmware+' or newer.';
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
      button.onclick=async()=>{await groupSceneAction(async target=>{const result=await target.configureGroupScene({scene:item.id});groupSceneDirty=false;groupAudioDirty=false;return result;});if(groupEditor?.lamp.raw?.sync?.scene===item.id){$('groupSceneLibrary').open=false;$('groupSceneTitle').focus({preventScroll:true});}};
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
      label.textContent=(index+1)+'. '+(entry.id===lamp.identity?state.name:entry.name||entry.id)+(entry.online?'':' · offline');
      row.append(label);
      for(const [direction,text] of [[-1,'↑'],[1,'↓']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;button.className='secondary';
        button.setAttribute('aria-label','Move '+(entry.name||entry.id)+(direction<0?' earlier':' later'));
        button.dataset.edge=String(index+direction<0||index+direction>=sync.order.length);
        button.onclick=()=>groupSceneAction(target=>target.configureGroupOrder(moveGroupLamp(target.raw.sync.order,entry.id,direction)));
        row.append(button);
      }
      if(!entry.online&&entry.id!==lamp.identity){
        const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.className='text-button';
        remove.onclick=()=>groupSceneAction(target=>target.configureGroupOrder(target.raw.sync.order.filter(x=>x.id!==entry.id).map(x=>x.id)));row.append(remove);
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
  const sync=groupsAvailable()?state?.sync:null;
  const identity=groupsAvailable()?lamp.identity:null;
  if(syncIdentity!==identity){
    syncIdentity=identity;groupSceneDirty=false;groupAudioDirty=false;sceneChoicesKey='';groupOrderKey='';$('groupSceneFeedback').textContent='';$('syncCode').value='';$('syncCodeArea').hidden=true;
    $('syncJoinCode').value='';$('syncFeedback').textContent='';
  }
  const syncMessage=groupStatus(sync);if($('syncStatus').textContent!==syncMessage)$('syncStatus').textContent=syncMessage;
  $('syncFields').disabled=!sync||busy||updatingLamp()||groupJoinForCurrent();
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
  renderGroupCoordinators();
  renderGroupScenes();
  if(groupJoinResult&&sameGroupTarget(groupJoinResult.target)){
    if(sync?.role!==2||sync.leader!==groupJoinResult.leader)groupJoinResult=null;
    else $('syncFeedback').textContent=(sync.paused?'Group settings saved. Following is paused; using local settings.':
      sync.active===true?'Following coordinator · shared light and sound.':'Group settings saved. Waiting for coordinator; using local settings.')+
        groupJoinResult.passwordWarning;
  }
}
async function syncAction(action) {
  if(busy||connecting||!advancedAvailable()||groupJoinForCurrent())return;
  groupJoinResult=null;$('syncFeedback').textContent='';
  busy=true;renderSync();
  try {const result=await lamp.enqueue(action);$('syncFeedback').textContent=result||'Group updated.';$('groupSceneFeedback').textContent=result||'Group updated.';}
  catch(e){if(e.uncertain)await lamp.disconnect();$('syncFeedback').textContent=e.message;$('groupSceneFeedback').textContent=e.message;}
  finally{busy=false;renderOptions();}
}
$('manageSync').onclick=()=>page('groups');
$('createSync').onclick=()=>syncAction(async()=>{
  const code=createGroupCode(lamp.identity);
  await lamp.configureSync(1,code);$('syncCode').value='';$('syncCodeArea').hidden=true;
  return 'Coordinator ready. Select another lamp, open Groups and choose this coordinator.';
});
$('showSyncCode').onclick=()=>syncAction(async()=>{$('syncCode').value=await lamp.syncInvite();$('syncCodeArea').hidden=false;return 'Copy this code to join other lamps.';});
$('copySyncCode').onclick=async()=>{
  try{await navigator.clipboard.writeText($('syncCode').value);$('syncFeedback').textContent='Group code copied.';}
  catch{$('syncCode').focus();$('syncCode').select();$('syncFeedback').textContent='Code selected. Choose Copy to share it.';}
};
$('syncJoinForm').onsubmit=e=>{e.preventDefault();const code=$('syncJoinCode').value;syncAction(async()=>{parseGroupCode(code);const result=await lamp.configureSync(2,code);$('syncJoinCode').value='';return result+' '+groupStatus(lamp.raw.sync)+'.';});};
$('pauseSync').onclick=()=>syncAction(()=>lamp.syncAction('pause'));
$('resumeSync').onclick=()=>syncAction(()=>lamp.syncAction('resume'));
$('leaveSync').onclick=()=>syncAction(async()=>{const result=await lamp.configureSync(0);$('syncCode').value='';$('syncCodeArea').hidden=true;return result;});
renderSync();

$('changeDefaultPassword').onclick=()=>{
  settingsSection('network');page('settings');
  $('adminPassword').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('adminPassword').focus();
};

for(const id of ['groupSceneSpeed','groupSceneIntensity','groupScenePrimary','groupSceneSecondary'])$(id).oninput=()=>{groupSceneDirty=true;groupSceneLabels();paintRanges();};
for(const id of ['groupAudioGain','groupAudioGate','groupAudioScale'])$(id).oninput=()=>{groupAudioDirty=true;groupSceneLabels();paintRanges();};
$('applyGroupScene').onclick=()=>groupSceneAction(async target=>{
  const rgb=id=>[1,3,5].map(i=>parseInt($(id).value.slice(i,i+2),16));
  const result=await target.configureGroupScene({speed:Number($('groupSceneSpeed').value),intensity:Number($('groupSceneIntensity').value),primary:rgb('groupScenePrimary'),secondary:rgb('groupSceneSecondary')});
  groupSceneDirty=false;return result;
});
$('applyGroupAudio').onclick=()=>groupSceneAction(async target=>{
  const result=await target.tuneAudio({gain:Number($('groupAudioGain').value),gate:Number($('groupAudioGate').value),scale:Number($('groupAudioScale').value)});
  groupAudioDirty=false;return result;
});

// Drafts belong to a lamp identity, never to the previously selected device.
var playbackIdentity=null, rotationDirty=false;
function renderPlaybackTools() {
  renderPower();
  $('controls').disabled=busy||updatingLamp()||!state||!independentLightingAllowed()||Boolean(state?.sync?.active)||Boolean(state?.calibration?.active);
  const raw=groupsAvailable()?state:null;
  const identity=raw?lamp.identity:null;
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
  e.preventDefault();if(busy||connecting||!advancedAvailable())return;
  const value={enabled:$('rotationEnabled').checked,random:$('rotationOrder').value==='random',category:Number($('rotationCategory').value),seconds:Number($('rotationInterval').value)*Number($('rotationUnit').value)};
  busy=true;renderPlaybackTools();
  try{const message=await lamp.enqueue(()=>lamp.configureRotation(value));rotationDirty=false;$('rotationFeedback').textContent=message;}
  catch(e){$('rotationFeedback').textContent=e.message;}
  finally{busy=false;renderPlaybackTools();}
};
async function calibrationAction(action,position){
  if(busy||connecting||!advancedAvailable())return;
  busy=true;renderPlaybackTools();
  try{
    const message=await lamp.enqueue(()=>lamp.calibrateLeds(action,position));
    $('calibrationFeedback').textContent=message;
    if(action==='save'){await lamp.disconnect();status(message+' Reconnect after it restarts.');}
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
