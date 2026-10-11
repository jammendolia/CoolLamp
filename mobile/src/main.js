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
import { MeshInventorySession, acquireMeshLamp, meshBridgeSupported } from './mesh.js';
import { MeshOnboarding } from './mesh-onboarding.js';
import { FirmwareFleet } from './firmware-fleet.js';
import { GroupDiscovery } from './group-discovery.js';
import { BluetoothGroups, initializeGroupRadio } from './bluetooth-groups.js';
import { Groups, groupCreationPlan } from './groups.js';
import { GroupLightingUi } from './group-lighting-ui.js';
import { runLampPower } from './lamp-power.js';
import { downloadPhoneFirmware, compareFirmwareVersions, firmwareBase64, bluetoothFirmwareFailureMessage } from './bluetooth-firmware.js';
import { FirmwareFeedback } from './firmware-feedback.js';
import { FirmwareScreenAwake } from './firmware-screen-awake.js';
import {availableCardRelease,updateCardFirmware,FirmwareReleaseCache} from './card-firmware.js';
import {FirmwareFleetTrust} from './firmware-fleet-trust.js';
import { LampConnectivity, lightingObservation, groupObservation, groupCardPresentation } from './lamp-connectivity.js';
import { LAMP_STYLES, styleDefinition, styleLabel, resolveLampStyle, recommendedEffects } from './lamp-style.js';
import { wifiSetupMessage, wifiCredentials } from './wifi-setup.js';
import { LampPairing, rememberAccessories, pairingLabel, pairingInstructions, pairingError } from './pairing.js';
import { mountAppV2 } from './app-v2.js';
import { adaptiveEffectModel, effectDisplayName } from './app-v2-effects.js';
import { LampExperienceSession } from './experience-contracts.js';
import { SettingsConnectionRecovery, settingsConnectionMessage, selectMeshRecoveryCandidates } from './settings-recovery.js';
import { lampArtworkSvg } from './lamp-artwork.js';
let appV2=null,app2Experience=null,app2ExperienceRun=null;
let settingsRecovery=null;
let settingsRestartWaitUntil=0;
const settingsUnconfirmedIds=new Set();
const app2Pending=new Map();
const native = registerPlugin('LampNetwork');
const accessoryNative = registerPlugin('LampAccessory');
const store = new LampStore(localStorage);
const discovery = new LampDiscoverySession();
const meshInventory=new MeshInventorySession();
let meshSelection=null;
let meshOnboarding=null,meshWizard=null,newMeshCandidates=[];
const meshNetworkMessages=new Map();
let selected = null, lamp = null, connecting = false, discovered = [], category = 'all';
let bluetoothFirmwareTask=null;
let bluetoothFirmwareConnectionSerial=0;
let publicFirmware=null,publicFirmwareCheckedAt=0,publicFirmwareRun=null,publicFirmwareFresh=false,publicFirmwareError='',publicFirmwareExpiry=null;
const publicFirmwareCache=new FirmwareReleaseCache(CapacitorHttp);
const cardFirmwareTasks=new Map(),cardFirmwareMessages=new Map(),cardFirmwareUnconfirmed=new Map();
const firmwareFeedback=new FirmwareFeedback(localStorage);
let effectListKey = '', settingsView = 'lighting';
let bleWifiStatus=null, wifiSetupAbort=null, wifiSetupSerial=0;
let wifiScanning=false,wifiScanSerial=0;
let resetTarget=null;
let pairingRecoveryTarget=null;
const removedAccessoryIds=new Set();
let centerStatus=null,centerTimer=null,centerSerial=0,centerWasActive=false;
const bluetoothWifiAvailable=()=>lamp===bleLamp&&bleLamp.supportsWifiSetup&&Boolean(state);
const advancedAvailable=()=>Boolean(state&&lamp?.raw&&(lamp===wifiLamp||lamp?.isMesh||lamp===bleLamp&&bleLamp.supportsOfflineControl));
const groupsAvailable=()=>advancedAvailable()&&(lamp===wifiLamp||lamp?.isMesh||bleLamp.supportsOfflineGroups);
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
const groupEditorMutations=new Set(),cardPowerTasks=new Map(),cardPowerMessages=new Map();
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
const firmwareFleetTrust=new FirmwareFleetTrust({credential,getPairedLamps:()=>store.items.filter(entry=>entry.deviceId)});
function provisionFirmwareFleet(transport){if(!isNative)return;void firmwareFleetTrust.provision(transport).catch(error=>{cardFirmwareMessages.set(transport.identity,error.message);renderLamps();});}
function page(name,{preserveGroupFocus=false,preserveCardSettings=false}={}) {
  const route=name==='light'||name==='settings'&&settingsView==='lighting'?'effects':name;
  if(name==='effects'||name==='light'){name='settings';settingsView='lighting';}
  cancelMeshSelection();
  ++navigationSerial;if(!preserveCardSettings)wifiSettingsTarget=null;
  if(name!=='groups'||!preserveGroupFocus){++groupFocusSerial;pendingGroupFocus=null;}
  if(name!=='settings')hideWifiPassword();
  if(name!=='groups')closeGroupEditor();
  if(name==='lamps'){$('status').textContent='Choose a lamp’s gear to open its settings, or add a new lamp.';renderLamps();refreshLampFirmware();refreshPublicFirmware();refreshBasicBluetoothTelemetry();refreshNewMeshLamps();}
  else if(meshWizard&&!meshWizard.saving)void closeMeshWizard();
  for (const item of ['home','lamps','groups','settings','app-settings']) $('page-'+item).hidden=item!==name;
  scheduleLampStatusRefresh();
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===(name==='settings'?'lamps':name))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(name==='settings'){renderSettings();if(settingsView==='groups')refreshGroupCoordinators();}
  if(name==='groups'){$('status').textContent='Manage groups over Wi-Fi or authorized Bluetooth connections.';renderRoomGroups();refreshRoomGroups();}
  if(name==='home'&&mergedLampEntries().length){refreshRoomGroups();refreshLampFirmware();}
  appV2?.navigate(route);
  settingsRecovery?.check();
  window.scrollTo(0,0);
  $('page-'+name)?.querySelector('h2')?.focus({preventScroll:true});
}


const $ = id => document.getElementById(id);
$('settingsLampHeading').replaceChildren($('lampRoom'),$('lampTitle'));
$('page-light').querySelector('.section-title').remove();
$('page-light').dataset.settingsPanel='lighting';$('settingsLighting').append($('page-light'));
let toastTimer;
const status = message => { message=settingsConnectionMessage(message,{active:!$('page-settings').hidden,connected:verifiedSelectedLamp(),name:selected?.name,unconfirmed:settingsUnconfirmedIds.has(selected?.id)});$('status').textContent = message; $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000); };
let state = null, editingBrightness = false, busy = false;
let firmware = null;
let firmwareReceivedAt = 0;
let effectOptions = null, editingOptions = false;
let vuDirty = false, fountainDirty = false;
let groupSceneDirty=false,groupAudioDirty=false,sceneChoicesKey='',groupOrderKey='';
let audioDirty = false, effectTab = 'look', paneMode = null;
function app2TargetMatches(record){
  return Boolean(record&&record.target&&record.id&&selected&&record.id===selected.id&&record.target===lamp&&record.epoch===lamp?.epoch&&record.token===lamp?.raw?.token);
}
function assertApp2Target(record){
  if(!app2TargetMatches(record)||!verifiedSelectedLamp())throw Error('The selected lamp changed.');
}
async function loadApp2Experience(){
  if(!verifiedSelectedLamp()||!advancedAvailable()||updatingLamp()||!(/^[a-f0-9]{12}$/.test(selected.id)))return null;
  const target=lamp,id=selected.id,epoch=target.epoch;
  if(app2TargetMatches(app2Experience))return app2Experience;
  if(app2TargetMatches(app2ExperienceRun))return app2ExperienceRun.promise;
  const record={id,target,epoch,token:target.raw?.token,supported:false,schemas:new Map(),mode:null};
  const guard=()=>assertApp2Target(record);
  const transport={request:async(path,fields)=>{guard();const result=await target.request(path,fields,epoch,guard);guard();return result;}};
  record.session=new LampExperienceSession(transport,id);
  record.transport=transport;
  const run={id,target,epoch,token:record.token,promise:target.enqueue(async()=>{guard();try{await record.session.negotiate();guard();record.supported=true;}catch(error){guard();record.error=error.message;}app2Experience=record;return record;})};
  app2ExperienceRun=run;
  try{return await run.promise;}finally{if(app2ExperienceRun===run)app2ExperienceRun=null;}
}
async function loadApp2EffectSchema(){
  const record=await loadApp2Experience();if(!record?.supported||record.loading||!record.session.descriptor.capabilities.catalogVersions.includes(2)||record.mode===state?.mode)return;
  const mode=state.mode,index=lamp.catalog?.findIndex(entry=>entry.id===mode);if(index<0)return;
  record.loading=true;
  try{const page=await record.target.enqueue(()=>record.session.schema(index,'effects',1));if(app2Experience!==record||state?.mode!==mode)return;const schema=page.entries.find(entry=>entry.localId===mode);if(schema)record.schemas.set(mode,schema);record.mode=mode;renderOptions();}
  catch{/* The tested v1 profile remains usable when metadata is unavailable. */}
  finally{record.loading=false;}
}
function app2EffectModel(entry){
  const record=app2TargetMatches(app2Experience)?app2Experience:null;
  return adaptiveEffectModel(entry,{state,raw:lamp?.raw,options:effectOptions,targetId:selected?.id,schema:record?.schemas.get(entry.id),schemaTarget:record?.id,descriptor:record?.supported?record.session.descriptor:null});
}
async function app2LightChange(operation,value,activatePalette,changedOption=null){
  const scope={id:selected?.id,target:lamp,epoch:lamp?.epoch,token:lamp?.raw?.token};
  const record=await loadApp2Experience();if(!app2TargetMatches(scope))throw Error('The selected lamp changed.');if(!record?.supported)return false;
  assertApp2Target(record);
  if(app2Pending.has(record.id))throw Object.assign(Error('Check the previous unconfirmed change before making another.'),{uncertain:true});
  const patch=operation==='power'?{power:Number(value)}:operation==='brightness'?{brightness:value}:operation==='effect'?{mode:value}:operation==='color'?{mode:value.mode,r:value.r,g:value.g,b:value.b}:operation==='resetColor'?{mode:value,resetPalette:1}:operation==='effectOptions'?{mode:value.mode,speed:value.speed,intensity:value.intensity,dual:value.dual,r2:value.r,g2:value.g,b2:value.b}:null;
  if(!patch)return false;
  if(operation==='effectOptions'&&changedOption){for(const key of ['speed','intensity','dual','r2','g2','b2'])if(!(changedOption===key||changedOption==='secondaryColor'&&['r2','g2','b2'].includes(key)))delete patch[key];}
  if(activatePalette&&!state.color?.enabled){const hex=$('color').value.slice(1);Object.assign(patch,{r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)});}
  let result;try{result=await record.target.enqueue(async()=>{const snapshot=await record.session.fresh();if(['color','effectOptions','resetColor'].includes(operation)&&snapshot.mode!==patch.mode)throw Error('The effect changed while you were editing. Review its current controls.');return record.session.patch(record.session.draft(snapshot,patch));});}finally{if(record.session.pending)app2Pending.set(record.id,record.session);}
  if(result.outcome==='uncertain')throw Object.assign(Error('The lamp did not confirm this change. Check its state before trying again.'),{uncertain:true});
  if(result.outcome==='rejected')throw Error('The lamp rejected this change. Refresh its current settings.');
  if(!result.executed)throw Error('This change was not applied.');
  await record.target.enqueue(async()=>{assertApp2Target(record);await record.target.refresh(record.id);assertApp2Target(record);});status('Changes confirmed on '+selected.name+'.');return true;
}
async function saveApp2Appearance(){
 if(busy||connecting||updatingLamp()||!independentLightingAllowed())return;busy=true;
 const scope={id:selected?.id,target:lamp,epoch:lamp?.epoch,token:lamp?.raw?.token},mode=state?.mode;
 try{const record=await loadApp2Experience();if(!app2TargetMatches(scope))throw Error('The selected lamp changed.');if(!record?.supported)throw Error('Update this lamp to remember tuning separately from startup.');assertApp2Target(record);if(state?.mode!==mode)throw Error('The effect changed while you were editing. Review its current controls.');if(app2Pending.has(record.id))throw Error('Check the previous unconfirmed change first.');let result;try{result=await record.target.enqueue(()=>record.session.save(mode));}finally{if(record.session.pending)app2Pending.set(record.id,record.session);}
  assertApp2Target(record);
  if(result.outcome==='persisted')status('Effect tuning saved. Your startup light stays as chosen.');
  else if(result.outcome==='uncertain')throw Object.assign(Error('Saving was not confirmed. Check this lamp before trying again.'),{uncertain:true});
  else throw Error(result.outcome==='save-failed'?'The lamp could not save this tuning. The previous saved tuning is retained.':'This tuning was not saved. Refresh the lamp and try again.');
 }catch(error){status(error.message);}finally{busy=false;renderOptions();}
}
$('saveAppearance').onclick=saveApp2Appearance;
$('reconcileApp2').onclick=async()=>{
 const id=selected?.id,original=app2Pending.get(id);if(!original||busy)return;busy=true;
 const scope={id,target:lamp,epoch:lamp?.epoch,token:lamp?.raw?.token};
 try{const record=await loadApp2Experience();if(!app2TargetMatches(scope))throw Error('The selected lamp changed.');if(!record?.supported||original.target!==id)throw Error('Reconnect to this lamp to check the previous change.');assertApp2Target(record);const receipt=await record.target.enqueue(()=>original.reconcile(record.transport));
  if(receipt.outcome!=='uncertain')app2Pending.delete(id);
  await record.target.enqueue(async()=>{assertApp2Target(record);await record.target.refresh(id);assertApp2Target(record);});
  if(receipt.outcome==='uncertain'){$('retireApp2').hidden=false;status('Current light verified. The earlier change remains unconfirmed. Review this light before continuing.');}
  else{$('retireApp2').hidden=true;status(receipt.outcome==='persisted'?'Previous save confirmed.':receipt.executed?'Previous change confirmed.':'Previous change was rejected.');}
 }catch(error){status(error.message);}finally{busy=false;renderOptions();}
};
$('retireApp2').onclick=async()=>{
 const id=selected?.id,original=app2Pending.get(id);if(!original||busy||!confirm('Continue from this lamp’s verified current light? The earlier change will remain unconfirmed and will not be repeated.'))return;busy=true;
 const scope={id,target:lamp,epoch:lamp?.epoch,token:lamp?.raw?.token};
 try{const record=await loadApp2Experience();if(!app2TargetMatches(scope))throw Error('The selected lamp changed.');if(!record?.supported||original.target!==id)throw Error('Reconnect to this lamp to check the previous change.');assertApp2Target(record);await record.target.enqueue(()=>original.retireUncertainAfterSnapshot(record.transport));app2Pending.delete(id);assertApp2Target(record);$('retireApp2').hidden=true;status('Ready to continue from the lamp’s current light.');}catch(error){status(error.message);}finally{busy=false;renderOptions();}
};
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
  const sync=state?.sync;
  const groupActive=groupsAvailable()&&sync?.scene>0&&sync.paused!==true&&
    (sync.role===1||sync.role===2&&sync.active===true);
  $('effectPane').hidden=!entry||groupActive;
  $('saveAppearance').hidden=true;$('appearanceSaveStatus').hidden=true;
  if(!entry||groupActive)return null;
  const model=app2EffectModel(entry),blocked=busy||connecting||updatingLamp()||app2Pending.has(selected?.id);
  void loadApp2EffectSchema().catch(()=>{});
  if(paneMode!==entry.id){effectTab=model.audio.visible?'sound':'look';paneMode=entry.id;}
  const speed=model.controls.find(control=>control.key==='speed'),intensity=model.controls.find(control=>control.key==='intensity');
  const motionAvailable=Boolean(state.capabilities&8||model.schemaVersion===2)&&Boolean(speed||intensity);
  $('effect-tab-motion').hidden=!motionAvailable;
  $('effect-tab-sound').hidden=!model.audio.visible;
  if((effectTab==='sound'&&!model.audio.visible)||(effectTab==='motion'&&!motionAvailable))effectTab='look';
  $('effectTabs').hidden=!model.audio.visible&&!motionAvailable;
  for(const tab of document.querySelectorAll('[data-effect-tab]')){tab.setAttribute('aria-selected',String(tab.dataset.effectTab===effectTab));tab.tabIndex=tab.dataset.effectTab===effectTab?0:-1;}
  $('effectBody').setAttribute('aria-labelledby','effect-tab-'+effectTab);
  const primary=model.palette.colors.find(value=>value.adapter==='primary-color'),secondary=model.palette.colors.find(value=>value.adapter==='secondary-color');
  const plainPalette=!model.palette.fixed&&Boolean(primary)&&state.supportsColor;
  $('colorControls').hidden=!plainPalette||effectTab!=='look';
  $('colorUpgrade').hidden=model.palette.fixed||!primary||state.supportsColor||effectTab!=='look';
  const paletteOptions=document.querySelector('.palette-options');
  paletteOptions.hidden=!plainPalette||!secondary||effectTab!=='look'||!(state.capabilities&8);
  $('dual').closest('label').hidden=!model.palette.secondaryToggle;
  $('color').disabled=blocked||!primary?.editable;
  if(primary){$('primaryColorLabel').textContent=primary.label;if(primary.hex&&!editingOptions)$('color').value=primary.hex;}
  if(secondary)$('secondaryColorLabel').textContent=secondary.label;
  $('effectTitle').textContent=model.name;
  $('effectFamily').textContent=model.audio.visible?'SOUND & LIGHT':(model.category||'LIGHT').toUpperCase()+' COLLECTION';
  $('effectDescription').textContent=model.description+(model.unsupportedParameters.length?' Some adjustments need a newer app.':'');
  $('effectPane').style.setProperty('--effect-accent',model.audio.visible?'#dac6fa':model.category==='fire'?'#efc48e':'#d1eead');
  $('motionControls').hidden=!speed||effectTab!=='motion';
  $('intensityControls').hidden=!intensity||effectTab!=='motion';
  for(const [key,control] of [['speed',speed],['intensity',intensity]])if(control){
    $(key+'Label').textContent=control.label;$(key+'Hint').textContent=control.hint;
    $(key).min=control.min;$(key).max=control.max;$(key).step=control.step;$(key).disabled=blocked||!control.editable;
  }
  $('paletteState').textContent=model.palette.label;$('colorHint').textContent=model.palette.hint;
  $('effectAudio').hidden=!model.audio.visible||effectTab!=='sound';
  $('resetColor').hidden=!plainPalette||!model.palette.canReset||effectTab==='sound';
  $('resetColor').disabled=blocked||!primary?.editable;
  const setFeedback=(id,message)=>{if($(id).textContent!==message)$(id).textContent=message;};
  for(const [adapter,prefix,roles,inputs,dirty,paint] of [
    ['vu-colors','vu',['zone-low','zone-middle','zone-high'],['vuLow','vuMid','vuPeak'],vuDirty,paintVu],
    ['fountain-colors','fountain',['band-bass','band-mid','band-treble'],['fountainLow','fountainMid','fountainPeak'],fountainDirty,paintFountain]
  ]){
    const colors=roles.map(role=>model.palette.colors.find(value=>value.key===role&&value.adapter===adapter));
    const visible=colors.some(Boolean)&&!model.palette.fixed;
    const ready=advancedAvailable()&&colors.every(value=>value?.editable&&value.hex);
    $(prefix+'Controls').hidden=!visible||effectTab!=='look';$(prefix+'Fields').disabled=blocked||!ready;
    inputs.forEach((id,index)=>{
      const choice=colors[index],label=$(id).closest('label');label.hidden=!choice;
      if(choice){const title=label.querySelector('span');if(title?.firstChild?.nodeType===3)title.firstChild.textContent=choice.label+' ';if(choice.hex&&!dirty)$(id).value=choice.hex;}
    });
    if(visible&&!ready)setFeedback(prefix+'Feedback','Connect to read all three '+(prefix==='vu'?'meter':'frequency')+' colors.');
    else if($(prefix+'Feedback').textContent.startsWith('Connect to read all three '))setFeedback(prefix+'Feedback','');
    if(ready&&!dirty)paint();
  }
  const audioReady=advancedAvailable()&&model.audio.editable;
  $('audioTuning').disabled=!audioReady||blocked;
  const audioHint=!model.audio.editable?model.audio.hint:model.audio.restarts?'This lamp restarts when sound settings are saved.':model.audio.scope+'.';
  setFeedback('audioConnectionHint',audioHint);$('audioConnectionHint').hidden=!model.audio.visible;
  $('applyAudio').textContent=model.audio.restarts?'Save sound settings & restart':'Save shared sound response';
  for(const [key,id] of [['gain','audioGain'],['gate','audioGate'],['scale','audioScale']]){
    const control=model.audio.controls.find(value=>value.key===key),input=$(id),label=document.querySelector('label[for="'+id+'"]'),output=$(id+'Value');
    if(key==='scale'){label.hidden=!control;input.hidden=!control;if(input.nextElementSibling?.classList.contains('micro-copy'))input.nextElementSibling.hidden=!control;}
    input.disabled=blocked||!audioReady||!control;
    if(control){
      if(label.firstChild?.nodeType===3)label.firstChild.textContent=control.label+' ';
      input.min=control.min;input.max=control.max;input.step=control.step;
      if(!audioDirty)input.value=control.value;
    }else output.value='—';
  }
  if(model.audio.controls.length&&!audioDirty){
    audioLabels();
    for(const [key,id] of [['gain','audioGain'],['gate','audioGate'],['scale','audioScale']])if(!model.audio.controls.some(value=>value.key===key))$(id+'Value').value='—';
  }
  const remember=model.persistence.separateAppearanceSave;
  $('saveAppearance').hidden=!remember;$('appearanceSaveStatus').hidden=!remember;
  $('saveAppearance').disabled=blocked||!independentLightingAllowed()||Boolean(state?.calibration?.active);
  if(remember)setFeedback('appearanceSaveStatus',model.persistence.hint);
  paintRanges();
  return model;
}

function updatingLamp() { return Boolean(firmware&&[1,3,4].includes(firmware.phase))||fleetLampInstalling(selected?.id)||bluetoothFirmwareTask?.id===selected?.id&&Boolean(bluetoothFirmwareTask); }
function bluetoothFirmwareOwner(){return bluetoothFirmwareTask||[...cardFirmwareTasks.values()].find(task=>task.path==='bluetooth')||null;}
function firmwareConnectionNotice(){status('Finish or cancel the Bluetooth update before selecting another lamp or changing its connection.');}
function firmwareConnectionSelectionAllowed(entry){const owner=bluetoothFirmwareOwner();return !owner||owner.id===entry.id&&verifiedSelectedLamp()&&selected.id===entry.id&&lamp===(owner.transport||bleLamp);}
function confirmInstalledFirmware(id,value){
  if(firmwareFeedback.confirmInstalled(id,value))renderLamps();
  const pending=cardFirmwareUnconfirmed.get(id);
  if(pending&&value?.verified===true&&value.fresh===true&&validFirmwareVersion(value.version)&&compareFirmwareVersions(value.version,pending)>=0)cardFirmwareUnconfirmed.delete(id);
}
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
  $('reconcileApp2').hidden=!app2Pending.has(selected?.id);
  if(!app2Pending.has(selected?.id))$('retireApp2').hidden=true;
  renderPower();
  renderPlaybackTools();
  renderSync();
  const model=renderEffectPane(),blocked=busy||connecting||updatingLamp()||app2Pending.has(selected?.id);
  const supported=Boolean(model&&(state?.capabilities&8||model.schemaVersion===2));
  const ready=supported&&effectOptions?.mode===state?.mode&&model.controls.every(control=>control.value!==null);
  $('effectOptions').hidden=!supported||!model?.controls.length||effectTab!=='motion';
  $('effectOptions').disabled=blocked||!ready;
  if(!model)return;
  for(const key of ['speed','intensity']){
    const control=model.controls.find(value=>value.key===key),input=$(key);
    input.disabled=blocked||!ready||!control?.editable;
    if(!control){input.min=key==='speed'?1:0;input.max=100;input.step=1;}
    if(!editingOptions&&effectOptions?.mode===state?.mode){input.value=control?.value??effectOptions[key];$(key+'Value').value=control&&control.value===null?'—':input.value+(control?.units??'%');}
  }
  const secondary=model.palette.colors.find(value=>value.adapter==='secondary-color');
  $('dual').disabled=blocked||!ready||!state.supportsColor||!model.palette.secondaryToggle;
  $('secondaryColor').disabled=blocked||!ready||!secondary?.editable||model.palette.secondaryToggle&&!(model.appearance.dual&&model.appearance.custom);
  $('secondaryColorRow').hidden=!secondary||model.palette.fixed||model.palette.secondaryToggle&&!(model.appearance.dual&&model.appearance.custom);
  if(!editingOptions){$('dual').checked=Boolean(model.appearance.dual&&model.appearance.custom);if(secondary?.hex)$('secondaryColor').value=secondary.hex;}
  paintRanges();
}
function renderFirmwareFeedback(){
  const feedback=firmwareFeedback.get(selected?.id);
  $('bluetoothFirmwareStatus').textContent=feedback?.message||(lamp===bleLamp&&verifiedSelectedLamp()?'Ready to update this lamp over Bluetooth.':'Connect to this lamp over Bluetooth to use phone updates.');
  $('bluetoothFirmwareProgress').hidden=!Number.isInteger(feedback?.progress);
  $('bluetoothFirmwareProgress').value=feedback?.progress??0;
}
function firmwareConnectionBusy(){return Boolean(bluetoothFirmwareTask||cardFirmwareTasks.size||fleetUpdating||firmware&&[1,3,4].includes(firmware.phase)||[...fleetStatuses.values()].some(value=>['updating','restarting'].includes(value.state)));}
function renderBluetoothFirmwareControls(){
  const btCurrent=bluetoothFirmwareTask?.id===selected?.id&&Boolean(bluetoothFirmwareTask);
  const direct=lamp===bleLamp&&verifiedSelectedLamp();
  const connect=$('connectBluetoothFirmware');connect.disabled=!selected||busy||connecting||firmwareConnectionBusy()||direct;
  connect.textContent=connecting?'Connecting over Bluetooth…':direct?'Bluetooth connected':'Connect over Bluetooth';
  connect.setAttribute('aria-label',(direct?'Bluetooth connected to ':connecting?'Connecting to ':'Connect by Bluetooth to ')+(selected?.name||'the selected lamp'));
  $('bluetoothFirmwareControls').disabled=!state||!direct||busy||!btCurrent&&updatingLamp();
  const btSupported=validFirmwareVersion(firmware?.version)&&compareFirmwareVersions(firmware.version,'1.11.0')>=0;
  $('installBluetoothFirmware').disabled=Boolean(bluetoothFirmwareTask)||!btSupported;
  $('bluetoothFirmwareHint').textContent=!state?'Connect over Bluetooth above to update this lamp through your phone.':!btSupported?'Install firmware 1.11.0 or newer once using Wi-Fi to enable Bluetooth updates.':!direct?'Connect over Bluetooth above. The phone can use cellular data or Wi-Fi to download firmware.':'Your phone downloads verified firmware and sends it over Bluetooth. The screen stays awake during this update. Keep the app on screen and stay nearby. The lamp can be offline.';
  $('cancelBluetoothFirmware').hidden=!btCurrent;
  $('reinstallBluetoothFirmware').disabled=Boolean(bluetoothFirmwareTask);
}
function renderFirmware() {
  const updating = updatingLamp();
  const release=publicFirmwareFresh?availableCardRelease(firmware?.version,publicFirmware):null;
  $('firmwareVersion').textContent = state ? firmware?.version || 'Older firmware' : 'Connect to view';
  const updateMessage=!state?'Connect to view update status.':firmware&&[1,3,4,5].includes(firmware.phase)?firmwareMessage(firmware):publicFirmwareRun?'Checking the public firmware release…':publicFirmwareError?'Could not check the public release. '+publicFirmwareError:!publicFirmwareFresh?'Check for updates to verify the current public release.':release?'Firmware '+release.version+' is available.':validFirmwareVersion(firmware?.version)?'Your lamp is up to date with public firmware '+publicFirmware.version+'.':firmwareMessage(firmware);
  if($('firmwareStatus').textContent!==updateMessage)$('firmwareStatus').textContent=updateMessage;
  $('firmwareControls').disabled = !state || !firmware || busy || updating;
  if(!busy)$('autoUpdate').checked = Boolean(firmware?.automatic);
  $('checkFirmware').disabled = Boolean(publicFirmwareRun);
  $('installFirmware').disabled = !release;
  $('installFirmware').textContent=release?'Install '+release.version:'Update now';
  $('firmwareProgress').hidden=!firmware||![3,4].includes(firmware.phase);
  $('firmwareProgress').value=firmware?.progress??0;
  renderFirmwareFeedback();
  renderBluetoothFirmwareControls();
  renderPlaybackTools();
}
function renderSettings() {
  renderFirmwareFeedback();
  renderBluetoothFirmwareControls();
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
  $('settingsHint').textContent=!state?'Connect to a lamp to manage its settings.':lamp?.isMesh&&settingsView==='network'?'Enter your Wi-Fi network manually. These settings travel through your trusted mesh; network scanning needs a direct connection.':lamp!==wifiLamp&&settingsView==='network'&&!bluetoothWifiAvailable()?'Wi-Fi setup over Bluetooth needs firmware 1.9.0 or newer. For a lamp already on your network, refresh the Wi-Fi list in Lamps and tap its card again. For first-time setup, hold the knob for three seconds to use its hotspot.':!advancedAvailable()&&settingsView==='hardware'&&(state.capabilities&128)?'Fine-tune the center over Bluetooth. Other hardware settings need Wi-Fi.':!advancedAvailable()&&['groups','hardware'].includes(settingsView)?'Update this lamp to firmware 1.10.0 for full Bluetooth settings and offline groups, or use Wi-Fi.':'';
  if(state&&lamp===bleLamp&&['network','groups'].includes(settingsView)&&wifiFailures.has(selected?.id))$('settingsHint').textContent=wifiFailures.get(selected.id)+' '+$('settingsHint').textContent;
  if(lamp===bleLamp&&advancedAvailable()&&['groups','hardware'].includes(settingsView))$('settingsHint').textContent=settingsView==='groups'?
    'Nearby lamp groups work without a router. Pair the coordinator with this phone before joining it.':'Full lamp settings are available over encrypted Bluetooth.';
  $('settingsHint').hidden=!$('settingsHint').textContent;
  for(const button of document.querySelectorAll('[data-settings-section]'))button.setAttribute('aria-pressed',String(button.dataset.settingsSection===settingsView));
  $('summaryVersion').textContent=state?(firmware?.version||'Unavailable'):'—';
  $('summaryLeds').textContent=advancedAvailable()?lamp.raw.leds+' LEDs':'—';
  $('summaryTransport').textContent=state?(lamp?.isMesh?'ESP-NOW mesh':lamp===wifiLamp?'Wi-Fi':'Bluetooth'):'Offline';
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
  $('forgetLamp').disabled=!selected||busy||connecting||updatingLamp();
  $('bluetoothIdentity').hidden=settingsView!=='overview'||!selected?.deviceId;
  $('bluetoothIdentity').textContent=selected?.deviceId?'Phone pairing: '+pairingLabel(selected)+
    (selected.bluetoothName&&selected.bluetoothName!==pairingLabel(selected)?' · Device: '+selected.bluetoothName:''):'';
  $('factoryReset').disabled=!state||!selected||busy||connecting||updatingLamp()||!(state.capabilities&128);
  $('factoryResetHint').textContent=!state?'Connect to the lamp to reset it.':!(state.capabilities&128)?'Update this lamp to firmware 1.9.1 or newer for factory reset.':'Available over Bluetooth or Wi-Fi. Only this lamp will be reset.';
  $('lampName').disabled=!selected||busy||connecting;
  $('room').disabled=!selected||busy||connecting;
  renderLampStyleSettings();
  renderCenterTool();
  renderSettingsConnection();
}
function renderSettingsConnection(){
  const waiting=!$('page-settings').hidden&&Boolean(selected)&&!verifiedSelectedLamp();
  $('page-settings').dataset.connectionRecovering=String(waiting);
  $('settingsRecovery').hidden=!waiting;
  if(waiting){
    const held=firmwareConnectionBusy()||Date.now()<settingsRestartWaitUntil;
    $('settingsRecoveryTitle').textContent=held?'Waiting for your lamp':'Reconnecting to '+selected.name;
    $('settingsRecoveryHint').textContent=held?'Your update is still in progress. We’ll restore the controls when it finishes.':'We’re finding the best available connection. You can return to Lamps at any time.';
    $('connectionBadge').textContent=held?'Updating':'Reconnecting';
    $('settingsConnection').textContent='Your settings will return when this lamp’s connection is verified.';
  }else if(verifiedSelectedLamp()){
    const kind=lamp?.isMesh?'ESP-NOW mesh':lamp===wifiLamp?'Wi-Fi':'Bluetooth';
    $('connectionBadge').textContent=kind;$('settingsConnection').textContent=selected.name+' · '+kind;
  }
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
  span.innerHTML=lampArtworkSvg(id,{label:styleLabel(id)});return span;
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
      confirmInstalledFirmware(selected.id,{version:next?.version,verified:true,fresh:true});
      const nextLabel=lampFirmwareLabel(selected,{connected:true,firmware,firmwareReceivedAt,observation:fleetStatuses.get(selected.id)});
      if(previousLabel!==nextLabel)renderLamps();
    }
    renderFirmware();
  },
  onState(next,metadata) {
    if(lamp===bleLamp&&!bleLamp.supportsOfflineControl&&centerStatus?.active)next.calibration={active:true,kind:'center',position:centerStatus.position};
    if(state?.mode!==next.mode){editingOptions=false;editingBrightness=false;}
    state = next;
    if(verifiedSelectedLamp()&&(lamp===wifiLamp||lamp?.isMesh||metadata?.freshControl||lamp===bleLamp&&!bleLamp.supportsOfflineControl&&legacyWithoutGroups(firmware?.version)))observeLampLighting(selected.id,{...next,deviceId:selected.id},lamp.catalog);
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
    const settingsOpen=!$('page-settings').hidden&&Boolean(selected);
    if(settingsOpen&&[3,4].includes(firmware?.phase))settingsRestartWaitUntil=Date.now()+3000;
    if(settingsOpen&&busy&&!connecting&&!meshSelection&&!wifiSetupAbort&&!firmwareConnectionBusy())settingsUnconfirmedIds.add(selected.id);
    invalidateGroupTasks();
    wifiScanning=false;++wifiScanSerial;hideWifiPassword();
    if($('wifiNetworksDialog').open){$('wifiNetworksDialog').returnValue='cancel';$('wifiNetworksDialog').close();}
    clearTimeout(centerTimer);centerTimer=null;centerStatus=null;centerWasActive=false;++centerSerial;$('centerFeedback').textContent='';
    resetTarget=null;
    if($('factoryResetDialog').open){$('factoryResetDialog').returnValue='cancel';$('factoryResetDialog').close();}
    const cancelledWifiSetup=Boolean(wifiSetupAbort);wifiSetupAbort?.abort();wifiSetupAbort=null;bleWifiStatus=null;++wifiSetupSerial;if(cancelledWifiSetup)busy=false;
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
    if (!connecting&&!meshSelection) {
      status(settingsOpen?'Connection lost. Reconnecting to '+selected.name+'…':'Disconnected. Choose a lamp to reconnect.');
      queueMicrotask(()=>settingsRecovery?.check());
    }
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
function transportCallbacks(target){return Object.fromEntries(Object.entries(callbacks).map(([name,callback])=>[name,(...args)=>{if(lamp===target())return callback(...args);} ]));}
const bleLamp = new LampTransport(BleClient, {firmwareBulkWrites:isNative&&phonePlatform==='ios',...transportCallbacks(()=>bleLamp),
  ...(phonePlatform==='ios'?{selectDevice:device=>device?.automaticReconnect?pairing.reconnect(device):pairing.select(device),onRadioReady:()=>{pairing.radioStarted=true;},
    onDeviceSelected:device=>{
      if(!device.accessoryManaged)return;
      if(device.automaticReconnect)return;
      if(device.newAuthorization)removedAccessoryIds.delete(device.deviceId.toLowerCase());
      rememberAccessories(store,[device],removedAccessoryIds);renderLamps();
      status('Authorized '+device.name+'. Connecting to the lamp…');
    }}:{})});
const wifiLamp = new WifiTransport(CapacitorHttp, {...transportCallbacks(()=>wifiLamp),onError:async e=>{
  if(lamp!==wifiLamp)return;
  if(!$('page-settings').hidden&&selected){settingsRecovery?.check();return;}
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
  if(value.verified&&value.fresh)confirmInstalledFirmware(id,{version:value.installedVersion,verified:true,fresh:true});
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
roomGroups=new Groups({getLamps:groupInventoryEntries,acquire:acquireGroupLamp,
loadRemovalIntents:()=>store.loadGroupRemovalIntents(),saveRemovalIntents:value=>store.saveGroupRemovalIntents(value),discover:async()=>{
  if(!isNative)return [];
  const result=await readNativeLampDiscovery();discovered=discovery.remember(result.lamps);renderLamps();return groupInventoryEntries();
},onStatus:snapshot=>{groupsSnapshot=snapshot;
  for(const row of snapshot.lamps)if(row.available&&row.verified)connectivity.observeGroup(row.id,{deviceId:row.id,group:row.sync,checkedAt:row.checkedAt,source:'groups'});
  renderRoomGroups();renderLamps();if(groupEditor)renderGroupScenes();}});
$('globalGroupEditor').append($('groupScenePane'),$('groupOrderPane'));
groupLightingUi=new GroupLightingUi({root:$('groupLightingControls'),getEditor:()=>groupEditor,run:action=>groupSceneAction(action,{outsideQueue:true})});
const selectedGroupRecovery=document.querySelector('.sync-panel');selectedGroupRecovery.removeAttribute('data-settings-panel');$('groupRecoveryContent').append(selectedGroupRecovery);
$('page-groups').append($('groupCoordinatorPasswordDialog'));
$('groupRecovery').ontoggle=()=>{if($('groupRecovery').open){renderSync();refreshGroupCoordinators();}};

function brightnessLabel() { $('brightnessValue').value = Math.round(Number($('brightness').value) * 100 / 255) + '%';paintRanges(); }
async function change(operation, value, activatePalette = false,changedOption=null) {
  if (busy||fleetLampInstalling(selected?.id)||bluetoothFirmwareTask?.id===selected?.id) return;
  if(['power','brightness','effect','saveDefaults','color','resetColor','effectOptions'].includes(operation)&&!independentLightingAllowed()){status('Use Groups for grouped lighting, or connect over Wi-Fi to verify this lamp’s membership.');return;}
  busy = true; $('controls').disabled = true; renderPower(); renderFirmware();
  try {
    if(['power','brightness','effect','color','resetColor','effectOptions'].includes(operation)&&await app2LightChange(operation,value,activatePalette,changedOption))return;
    if(activatePalette && !state.color?.enabled){
      const hex=$('color').value.slice(1);
      await lamp.command('color',{mode:value.mode,r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)});
    }
    await lamp.command(operation, value); status(operation === 'saveDefaults' ? 'Startup settings saved.' : 'Connected • Changes applied.'); }
  catch (error) { status(error.message); }
  finally { busy = false; $('controls').disabled = !state || Boolean(state?.sync?.active); renderFirmware();renderOptions(); }
}
async function connect(saved = null,{expectedId=null,preserveWifiIntent=false,navigate=true,automaticReconnect=false,readOnlyReconnect=false,isCurrent=()=>true,signal=null}={}) {
  cancelMeshSelection();
  if(bluetoothFirmwareOwner()){firmwareConnectionNotice();return;}
  const startedNavigation=navigationSerial;
  if(!preserveWifiIntent)wifiSettingsTarget=null;
  const id=saved?.id||saved?.lampId||store.items.find(entry=>entry.deviceId===saved?.deviceId)?.id;
  if(connecting||busy||fleetLampInstalling(id))return;
  const current=()=>!signal?.aborted&&isCurrent();
  if(!current())return;
  const guard=()=>{if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true,confirmed:true});};
  connecting=true; $('connect').disabled=true;if(!automaticReconnect)status('Connecting over Bluetooth…');
  const previousExpected=bleLamp.expectedDeviceIdentity;bleLamp.expectedDeviceIdentity=expectedId;
  let ownsBluetooth=false;
  const abort=()=>{if(ownsBluetooth&&lamp===bleLamp&&connecting)void bleLamp.disconnect().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try {
    await stopGroupInspection(id);guard();await lamp.disconnect();guard();lamp=bleLamp;ownsBluetooth=true;
    const device=await lamp.connect(saved?.deviceId?{...saved,automaticReconnect,readOnlyReconnect}:null);guard();
    removedAccessoryIds.delete(device.deviceId.toLowerCase());
    const prior=store.items.find(x=>x.id===device.lampId || x.deviceId===device.deviceId);
    selected=store.upsert({...prior,id:device.lampId||prior?.id||'ble:'+device.deviceId,deviceId:device.deviceId,name:prior?.name||device.name||'CoolLamp',
      bluetoothName:device.bluetoothName,accessoryName:device.accessoryName,accessoryManaged:Boolean(device.accessoryManaged)});
    groupRemovedIds.delete(selected.id);roomGroups?.allow?.(selected.id);
    store.rememberFirmware(selected.id,firmware);
    $('pairingRecovery').hidden=true;pairingRecoveryTarget=null;
    savedDevice=device; connected('Bluetooth',{navigate:navigate&&navigationSerial===startedNavigation,quiet:automaticReconnect});
    if(!automaticReconnect&&!readOnlyReconnect)provisionFirmwareFleet(bleLamp);
    return {connected:true,id:selected.id};
  } catch(e) {
    if(automaticReconnect)return {connected:false,error:e};
    // Authorization may have succeeded even if GATT setup did not. Keep that
    // OS accessory available as a saved card for reconnect/removal.
    await rememberAuthorizedAccessories().catch(()=>{});
    const error=pairingError(e,saved);status(error.message);
    if(error.recovery)showPairingRecovery(error.device);
    return {connected:false,error:e};
  }
  finally {signal?.removeEventListener('abort',abort);bleLamp.expectedDeviceIdentity=previousExpected;connecting=false; $('connect').disabled=false;
    if(verifiedSelectedLamp())observeLampWifi(selected.id,firmware?.wifi,'firmware');renderLamps();renderPower();renderFirmware();renderSettings();renderOptions();}
}
function connected(kind,{navigate=true,quiet=false}={}) {
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
  $('reconnect').hidden=true;
  $('favoriteEffect').setAttribute('aria-pressed',String(Boolean(selected.favorites?.includes(state.mode))));
  $('favoriteEffect').textContent=selected.favorites?.includes(state.mode)?'♥':'♡';
  $('connectionBadge').textContent=kind; $('lampTitle').textContent=selected.name;
  $('connectionBadge').title=lamp?.isMesh?'Through '+(lamp.bridge.raw?.name||lamp.bridgeIdentity):kind;
  $('lampRoom').textContent=selected.room||'YOUR LAMP';
  $('lampName').value=selected.name; $('room').value=selected.room||'';
  $('settingsConnection').textContent=selected.name+' · '+kind;
  $('identify').disabled=!advancedAvailable()||!lamp.raw?.apiVersion;
  $('networkSettings').disabled=kind!=='Wi-Fi'&&!bluetoothWifiAvailable();
  if(advancedAvailable())fillNetwork();
  if(!quiet)status('Connected to '+selected.name+'.');renderLamps(); filterEffects();if(navigate){settingsView='lighting';page('settings');}renderSettings();
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
  cancelMeshSelection();
  if(bluetoothFirmwareOwner()){firmwareConnectionNotice();return;}
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
  finally { connecting=false;if(verifiedSelectedLamp())observeLampWifi(selected.id,wifiLamp.raw?.connected??firmware?.wifi,'state');renderLamps();renderPower();renderFirmware();renderSettings();renderOptions(); }
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
$('disconnect').onclick=()=>{if(bluetoothFirmwareOwner()){firmwareConnectionNotice();return;}page('lamps');return lamp.disconnect();};
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
$('checkFirmware').onclick = async () => {
  const id=selected?.id;status('Checking the public firmware release…');refreshLampFirmware();
  const manifest=await refreshPublicFirmware({force:true});
  if(selected?.id!==id)return;
  status(manifest?'Public firmware '+manifest.version+' verified.':publicFirmwareError||'Could not check the public firmware release. Try again when your phone is online.');
};
$('installFirmware').onclick = () => {if(verifiedSelectedLamp()&&!busy&&!updatingLamp())return updateLampCard(selected);};
$('autoUpdate').onchange = () => change('autoUpdate', Number($('autoUpdate').checked));
$('connectBluetoothFirmware').onclick=async()=>{
  if(!selected||busy||connecting||firmwareConnectionBusy()||lamp===bleLamp&&verifiedSelectedLamp())return;
  const entry=mergedLampEntries().find(value=>value.id===selected.id);if(!entry)return;
  await openCardSettings(entry,{section:'updates',bluetooth:true});
};
async function cancelBluetoothFirmware(reason='user'){
  const task=bluetoothFirmwareTask;if(!task)return;
  if(bleLamp.bluetoothUpdate?.commitAttempted){status('The lamp is verifying its new firmware. Wait for the result, then reconnect.');return;}
  task.cancelled=true;task.abort.abort(reason);await bleLamp.bluetoothUpdate?.cancel(reason);
}
$('cancelBluetoothFirmware').onclick=()=>cancelBluetoothFirmware('user');
$('installBluetoothFirmware').onclick=async()=>{
  if(bluetoothFirmwareTask||busy||connecting||fleetUpdating||updatingLamp()||!verifiedSelectedLamp()||lamp!==bleLamp||!validFirmwareVersion(firmware?.version)||compareFirmwareVersions(firmware.version,'1.11.0')<0)return;
  const entry={...selected},displayed=publicFirmwareFresh?publicFirmware:null;
  const task={id:selected.id,epoch:bleLamp.epoch,deviceId:bleLamp.id,version:firmware.version,cancelled:false,abort:new AbortController()};
  ++bluetoothFirmwareConnectionSerial;
  task.feedback=firmwareFeedback.begin(task.id);cardFirmwareMessages.delete(task.id);
  task.screenAwake=new FirmwareScreenAwake({native,enabled:isNative});
  const reinstall=$('reinstallBluetoothFirmware').checked;
  bluetoothFirmwareTask=task;
  const current=()=>!task.cancelled&&bluetoothFirmwareTask===task&&selected?.id===task.id&&lamp===bleLamp&&bleLamp.epoch===task.epoch&&bleLamp.id===task.deviceId;
  const progress=value=>{
    if(!current())return;
    task.progress=value.stage==='transferring'||value.stage==='verifying'?value.progress:undefined;
    firmwareFeedback.update(task.feedback,{message:value.stage==='downloading'?'Downloading on your phone…':value.stage==='downloaded'?'Download verified. Preparing this lamp…':value.stage==='verifying'?'Lamp is verifying the complete image. Keep it powered.':'Sending to this lamp · '+value.progress+'%',progress:task.progress});
    if(selected?.id===task.id)$('cancelBluetoothFirmware').disabled=value.stage==='verifying';
    renderFirmware();renderLamps();
  };
  renderFirmware();renderLamps();renderSettings();
  try{
    firmwareFeedback.update(task.feedback,{message:'Checking the current public release…'});
    const release=await refreshPublicFirmware({force:true});if(!current())throw Error('Bluetooth connection changed. No firmware was sent.');
    if(!release)throw Error('Could not verify the current public release. Nothing was sent. '+publicFirmwareError);
    const difference=compareFirmwareVersions(release.version,task.version);
    if(difference<0)throw Error('This lamp has newer firmware than the public release. Downgrades are disabled.');
    if(difference===0&&!reinstall){firmwareFeedback.update(task.feedback,{message:'Already on the latest public release: '+task.version+'.',terminal:true});return;}
    if(!await cardUpdateConfirmation(entry,release,{previousVersion:displayed?.version,bluetoothOnly:true})||!current()){firmwareFeedback.update(task.feedback,{message:'Update cancelled. Nothing was sent.',terminal:true});return;}
    await task.screenAwake.acquire({isCurrent:current,signal:task.abort.signal});
    const packageValue=await downloadPhoneFirmware(CapacitorHttp,{isCurrent:current,signal:task.abort.signal,onProgress:progress,expectedManifest:release,
      ...(isNative?{digest:async bytes=>(await native.firmwareDigest({data:firmwareBase64(bytes)})).sha256}:{})});
    if(!current())throw Error('Bluetooth connection changed. No firmware was sent.');
    // Clear any existing group inspection before reserving this lamp’s command lanes.
    await stopGroupInspection(task.id);
    if(!current())throw Error('Bluetooth connection changed. No firmware was sent.');
    const result=await bleLamp.updateOverBluetooth(packageValue,progress,{signal:task.abort.signal});
    firmwareFeedback.update(task.feedback,{message:result.committed?'Firmware '+result.version+' verified by the lamp. It is restarting. Reconnect to confirm the installed version.':'The connection ended during final verification. Reconnect and check the installed version before retrying.',progress:100,terminal:true,outcome:result.committed?'verified-restarting':'verification-required',targetVersion:result.version});
    await bleLamp.disconnect();
  }catch(error){const message=bluetoothFirmwareFailureMessage(error);if(firmwareFeedback.update(task.feedback,{message,progress:error.updateDiagnostic?.progress??task.progress,terminal:true})&&selected?.id===task.id)status(message);}
  finally{
    await task.screenAwake.release();
    if(bluetoothFirmwareTask===task)bluetoothFirmwareTask=null;
    $('cancelBluetoothFirmware').disabled=false;
    renderFirmware();renderLamps();renderSettings();renderPower();
  }
};
// iOS may suspend Bluetooth operations in the background. Abort an incomplete
// image rather than leave a phone pretending its transfer is still progressing.
document.addEventListener('visibilitychange',()=>{if(document.hidden){void cancelBluetoothFirmware('app-hidden');for(const task of cardFirmwareTasks.values())if(task.path!=='wifi'&&!task.transport?.bluetoothUpdate?.commitAttempted)task.abort.abort('app-hidden');}});
for (const id of ['speed','intensity']) $(id).oninput = () => { editingOptions=true; $(id+'Value').value = $(id).value + '%';paintRanges(); };
for (const id of ['speed','intensity','dual','secondaryColor']) $(id).onchange = async () => {
  if (!state || effectOptions?.mode !== state.mode) return;
  const hex = $('secondaryColor').value.slice(1);
  await change('effectOptions', {mode:state.mode, speed:Number($('speed').value), intensity:Number($('intensity').value),
    dual:id==='dual'?Number($('dual').checked):effectOptions.dual,r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)},id==='dual'&&$('dual').checked,id);
  editingOptions=false;
  renderOptions();
};

function verifiedSelectedLamp() {
  if(connecting||!state||!selected)return false;
  if(lamp?.isMesh)return lamp.identity===selected.id&&lamp.target===selected.id;
  if(lamp===wifiLamp)return wifiLamp.identity===selected.id;
  return lamp===bleLamp&&bleLamp.id===selected.deviceId&&
    (!bleLamp.deviceIdentity||bleLamp.deviceIdentity===selected.id);
}
function mergedLampEntries() {
  const merged=new Map(store.items.map(entry=>[entry.id,entry]));
  for(const entry of meshInventory.items)if(!discovery.forgotten.has(entry.id))merged.set(entry.id,{...entry,...merged.get(entry.id)});
  for(const entry of discovered)merged.set(entry.id,{...entry,...merged.get(entry.id),address:entry.address});
  return [...merged.values()];
}
function fleetLampInstalling(id) { return cardFirmwareTasks.has(id)||['updating','restarting'].includes(fleetStatuses.get(id)?.state); }
function refreshPublicFirmware({force=false}={}){
 if(publicFirmwareRun)return publicFirmwareRun;
 const pending=publicFirmwareCache.refresh({force});publicFirmwareFresh=publicFirmwareCache.fresh;publicFirmwareError=publicFirmwareCache.error;
 const run=pending.then(value=>{publicFirmware=value;publicFirmwareCheckedAt=publicFirmwareCache.checkedAt;publicFirmwareFresh=publicFirmwareCache.fresh;publicFirmwareError='';clearTimeout(publicFirmwareExpiry);publicFirmwareExpiry=setTimeout(()=>{publicFirmwareFresh=publicFirmwareCache.fresh;renderLamps();renderFirmware();},Math.max(0,publicFirmwareCache.checkedAt+publicFirmwareCache.maxAge-Date.now()));return value;})
  .catch(()=>{publicFirmwareFresh=false;publicFirmwareError=publicFirmwareCache.error;return null;})
  .finally(()=>{if(publicFirmwareRun===run)publicFirmwareRun=null;renderLamps();renderFirmware();});
 publicFirmwareRun=run;renderLamps();return run;
}
function cardInstalledVersion(entry){
 const value=fleetStatuses.get(entry.id);
 return verifiedSelectedLamp()&&selected.id===entry.id?firmware?.version:value?.installedVersion||entry.firmwareVersion;
}
function cardUpdateConfirmation(entry,release,{previousVersion=null,bluetoothOnly=false,wifiOnly=false}={}){
 const dialog=document.createElement('dialog'),form=document.createElement('form'),title=document.createElement('h2'),body=document.createElement('p'),actions=document.createElement('div');
 form.method='dialog';title.id='cardFirmwareTitle';title.textContent='Update '+(entry.name||'this lamp')+'?';dialog.setAttribute('aria-labelledby',title.id);
 body.textContent=(previousVersion&&previousVersion!==release.version?'A fresh check found firmware '+release.version+'; the earlier offer was '+previousVersion+'.':'Firmware '+release.version+' is available.')+' '+(bluetoothOnly?'Your phone will send this exact release over your paired Bluetooth connection.':wifiOnly?'The app will update lamps over their home Wi-Fi one at a time.':'The app will use Wi-Fi when it works, or your paired Bluetooth connection.')+' Keep the lamp powered and the app open.';
 actions.className='dialog-actions';
 for(const [value,label] of [['cancel','Cancel'],['update','Continue']]){const button=document.createElement('button');button.value=value;button.textContent=label;if(value==='cancel'){button.className='secondary';button.autofocus=true;}actions.append(button);}
 form.append(title,body,actions);dialog.append(form);document.body.append(dialog);
 const choice=new Promise(resolve=>dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='update';dialog.remove();resolve(accepted);},{once:true}));dialog.showModal();return choice;
}
async function acquireCardFirmwareBluetooth(entry){
 const owner=cardFirmwareTasks.get(entry.id);if(!owner)throw Error('This lamp’s update changed.');
 owner.screenAwake=new FirmwareScreenAwake({native,enabled:isNative});
 await owner.screenAwake.acquire({isCurrent:owner.isCurrent,signal:owner.abort.signal});
 await stopGroupInspection(entry.id);
 if(verifiedSelectedLamp()&&selected.id===entry.id&&lamp===bleLamp){const task=cardFirmwareTasks.get(entry.id);task.transport=bleLamp;bluetoothFirmwareTask=task;return {lamp:bleLamp,release:async()=>{if(bluetoothFirmwareTask===task)bluetoothFirmwareTask=null;await bleLamp.disconnect();}};}
 if(!entry.deviceId||phonePlatform==='ios'&&!entry.accessoryManaged)throw Error('Pair this lamp using its Bluetooth icon before updating without Wi-Fi.');
 await initializeGroupRadio({transport:bleLamp,ble:BleClient,platform:phonePlatform,pairing,accessories:accessoryNative,knownDevices:()=>[...store.items,savedDevice].filter(Boolean),onAuthorized:devices=>rememberAccessories(store,devices,removedAccessoryIds)});
 const transport=new LampTransport(BleClient,{firmwareBulkWrites:isNative&&phonePlatform==='ios',sharedInitialization:bleLamp.initialization,expectedDeviceIdentity:entry.id,controlOnly:true});
 try{await transport.connect({...entry,lampId:entry.id});if(isNative)await firmwareFleetTrust.provision(transport);const task=cardFirmwareTasks.get(entry.id);if(task)task.transport=transport;liveGroupBluetooth.set(entry.id,{transport,epoch:transport.epoch});renderLamps();
  return {lamp:transport,release:async()=>{if(liveGroupBluetooth.get(entry.id)?.transport===transport)liveGroupBluetooth.delete(entry.id);await transport.disconnect();renderLamps();}};
 }catch(error){await transport.disconnect();throw error;}
}
async function updateLampCard(entry){
 if(connecting||cardFirmwareTasks.size||bluetoothFirmwareTask||fleetUpdating||powerLaneBusy(entry.id)||fleetLampInstalling(entry.id))return;
 const displayed=publicFirmwareFresh?availableCardRelease(cardInstalledVersion(entry),publicFirmware):null;if(cardFirmwareUnconfirmed.has(entry.id))return;
 const task={id:entry.id,entry:{...entry},abort:new AbortController()};cardFirmwareTasks.set(entry.id,task);renderLamps();
 const current=()=>cardFirmwareTasks.get(entry.id)===task&&mergedLampEntries().some(value=>value.id===entry.id&&value.deviceId===entry.deviceId&&value.address===entry.address)&&!groupRemovedIds.has(entry.id);
 task.isCurrent=current;
 try{
  cardFirmwareMessages.set(entry.id,'Checking the current public release…');renderLamps();
  const manifest=await refreshPublicFirmware({force:true});if(!current())return;
  if(!manifest)throw Error('Could not verify the current public release. Nothing was sent. '+publicFirmwareError);
  const installed=cardInstalledVersion(entry);if(!validFirmwareVersion(installed))throw Error('Could not verify this lamp’s installed version. Reconnect to the lamp before updating.');
  const release=availableCardRelease(installed,manifest);
  if(!release){cardFirmwareMessages.set(entry.id,'Public firmware '+manifest.version+' verified. This lamp is already up to date.');return;}
  if(!await cardUpdateConfirmation(entry,release,{previousVersion:displayed?.version})||!current()){if(current())cardFirmwareMessages.set(entry.id,'Update cancelled. No update started.');return;}
  task.feedback=firmwareFeedback.begin(entry.id);cardFirmwareMessages.delete(entry.id);
  const progress=value=>{if(!current())return;const path=value.stage==='wifi'?'wifi':'bluetooth';if(path==='bluetooth'&&task.path!=='bluetooth')++bluetoothFirmwareConnectionSerial;task.path=path;if(document.hidden&&task.path==='bluetooth'&&!task.transport?.bluetoothUpdate?.commitAttempted)task.abort.abort('app-hidden');task.progress=value.stage==='transferring'||value.stage==='verifying'?value.progress:undefined;firmwareFeedback.update(task.feedback,{message:value.stage==='wifi'?'Checking Wi-Fi update…':value.stage==='connecting'?'Connecting by Bluetooth…':value.stage==='downloading'?'Downloading firmware on your phone…':value.stage==='verifying'?'Lamp is verifying firmware…':'Sending firmware · '+value.progress+'%',progress:task.progress});renderLamps();renderFirmware();};
  const result=await updateCardFirmware({entry:task.entry,manifest:release,wifi:(entry,version)=>fleet.updateLamp(entry,version),acquireBluetooth:acquireCardFirmwareBluetooth,isCurrent:current,signal:task.abort.signal,onProgress:progress,
   download:(manifest,options)=>downloadPhoneFirmware(CapacitorHttp,{...options,expectedManifest:manifest,...(isNative?{digest:async bytes=>(await native.firmwareDigest({data:firmwareBase64(bytes)})).sha256}:{})})});
  if(result.path==='bluetooth'&&result.state==='restarting')cardFirmwareUnconfirmed.set(entry.id,release.version);
  if(task.feedback&&current())firmwareFeedback.update(task.feedback,{message:result.message||'Firmware updated.',progress:result.path==='bluetooth'?100:undefined,terminal:true,...(result.path==='bluetooth'&&result.state==='restarting'?{outcome:result.committed?'verified-restarting':'verification-required',targetVersion:result.version}:{})});
 }catch(error){if(current()){const message=bluetoothFirmwareFailureMessage(error);cardFirmwareMessages.set(entry.id,message);if(task.feedback)firmwareFeedback.update(task.feedback,{message,progress:error.updateDiagnostic?.progress??task.progress,terminal:true});status(message);}}
 finally{await task.screenAwake?.release();if(cardFirmwareTasks.get(entry.id)===task)cardFirmwareTasks.delete(entry.id);renderLamps();renderPower();renderFirmware();refreshLampFirmware();}
}
function cardFirmwareButton(entry){
 const release=publicFirmwareFresh?availableCardRelease(cardInstalledVersion(entry),publicFirmware):null,checking=!release&&Boolean(fleetRefreshRun||publicFirmwareRun);
 const button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-firmware-update v2-card-update';button.dataset.connection='update';
 button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+(release?'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4':'M20 7v5h-5M20 12a8 8 0 1 0-2.35 5.65')+'"/></svg><span>'+(release?'Update':checking?'Checking…':'Check')+'</span>';
 button.title=release?'Update '+(entry.name||'lamp')+' to firmware '+release.version:'Check firmware updates for '+(entry.name||'lamp');button.setAttribute('aria-label',button.title);
 button.disabled=Boolean(checking||connecting||cardFirmwareTasks.size||bluetoothFirmwareTask||fleetUpdating||powerLaneBusy(entry.id)||fleetLampInstalling(entry.id)||cardFirmwareUnconfirmed.has(entry.id));button.onclick=release?()=>updateLampCard(entry):()=>{refreshPublicFirmware({force:true});refreshLampFirmware();};return button;
}
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
  // Diagnostics prove what is installed, not what GitHub currently offers.
  const message=value.message||'Reachable';
  return message+(checked?' · Lamp checked '+checked:'');
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
  if(fleetUpdating||bluetoothFirmwareTask||cardFirmwareTasks.size){status('Finish the current lamp update before updating all lamps.');return;}
  fleetUpdating=true;fleetRefreshQueued=false;
  const displayed=publicFirmwareFresh?publicFirmware:null;
  fleetSummary='Checking the current public release…';
  renderFleetControls();
  try {
    const release=await refreshPublicFirmware({force:true});
    if(!release)throw Error('Could not verify the current public release. No updates started. '+publicFirmwareError);
    if(!await cardUpdateConfirmation({name:'all lamps'},release,{previousVersion:displayed?.version,wifiOnly:true})){fleetSummary='Updates cancelled. No updates started.';return;}
    fleetSummary='Updating to firmware '+release.version+' one lamp at a time.';renderFleetControls();
    const result=await fleet.updateAll(release.version);
    const updated=result.results.filter(value=>value.state==='updated').length;
    const current=result.results.filter(value=>value.state==='ready').length;
    const attention=result.results.filter(value=>['offline','failed','needs-password','unsupported'].includes(value.state)).length;
    fleetSummary=(result.cancelled?'Stopped':'Finished')+' · '+updated+' updated · '+current+' already up to date'+
      (attention?' · '+attention+' need attention':'')+'.';
  }catch(error){fleetSummary=error.message||'Updates could not finish. Review each lamp before trying again.';}
  finally{fleetUpdating=false;renderLamps();renderPower();renderFirmware();renderOptions();renderSettings();}
}
$('refreshLampFirmware').onclick=()=>{refreshLampFirmware();refreshNewMeshLamps();};
$('updateAllLamps').onclick=()=>updateAllLamps();
function observeLampWifi(id,wifi,source) {
  if(typeof wifi==='boolean')wifi={connected:wifi};
  if(wifi&&typeof wifi.connected==='boolean')connectivity?.observe(id,{deviceId:id,wifi,checkedAt:Date.now(),source});
}
function observeLampLighting(id,raw,catalog,checkedAt=Date.now()){
  if(raw?.deviceId===id){const group=groupObservation(raw);if(group)connectivity?.observeGroup(id,{deviceId:id,group,checkedAt});}
  const lighting=lightingObservation(raw,catalog);
  if(lighting)connectivity?.observeLighting(id,{deviceId:id,lighting,checkedAt});
}
function scheduleLampStatusRefresh() {
  clearTimeout(lampStatusTimer);lampStatusTimer=null;
  if(document.hidden||$('page-lamps').hidden)return;
  lampStatusTimer=setTimeout(()=>{if(!document.hidden&&!$('page-lamps').hidden){renderLamps();refreshLampFirmware();refreshBasicBluetoothTelemetry();refreshNewMeshLamps();scheduleLampStatusRefresh();}},20000);
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
  button.disabled=busy||connecting||fleetLampInstalling(entry.id)||!firmwareConnectionSelectionAllowed(entry);button.onclick=()=>openCardWifiSettings(entry);
  return button;
}
function bluetoothCardIcon(entry) {
  const active=activeCardBluetooth(entry),button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-bluetooth'+(active?' is-active':'');
  button.dataset.connection='bluetooth';button.setAttribute('aria-pressed',String(active));
  const name=entry.name||'CoolLamp';button.title=(active?'Bluetooth connected':'Bluetooth not connected')+' · Connect to '+name;
  button.setAttribute('aria-label',(active?'Bluetooth connected. ':'')+'Connect '+name+' by Bluetooth');
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 2v20l7-6L7 7m0 10L18 8l-7-6"/></svg>';
  button.disabled=busy||connecting||fleetLampInstalling(entry.id)||!firmwareConnectionSelectionAllowed(entry);button.onclick=()=>connectCardBluetooth(entry);
  return button;
}
function groupCardIcon(entry) {
  const group=connectivity.get(entry.id).group,presentation=groupCardPresentation(group),{state,transport}=presentation;
  const name=entry.name||'CoolLamp',leader=mergedLampEntries().find(lamp=>lamp.id===group.leader)?.name;
  const description=state==='leader'?name+' leads a group':state==='follower'?name+' is a member of '+(leader?leader+'’s group':'a coordinator’s group'):state==='independent'?name+' is independent':name+' group membership is unknown';
  const button=document.createElement('button');button.type='button';button.className='lamp-connection lamp-group';button.dataset.connection='group';button.dataset.state=state;button.dataset.transport=transport;
  const detail=description+(presentation.detail?' · '+presentation.detail:'');
  button.title=detail+' · Open Groups';button.setAttribute('aria-label',detail+'. Open Groups');
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m10.5 8.5-3.5 7m6.5-7 3.5 7M8 18h8"/><circle class="group-leader" cx="12" cy="5.5" r="3"/><circle cx="5" cy="18" r="3"/><circle class="group-follower" cx="19" cy="18" r="3"/>'+(presentation.badge?'<path class="group-radio" d="M15 11.5a6 6 0 0 1 8 0m-6 2a3 3 0 0 1 4 0"/>':'')+'</svg>';
  if(presentation.badge){const badge=document.createElement('span');badge.className='group-transport-badge';badge.setAttribute('aria-hidden','true');badge.textContent=presentation.badge;button.append(badge);}
  button.disabled=connecting;button.onclick=()=>openCardGroups(entry);return button;
}
function powerLaneBusy(id){return cardFirmwareTasks.has(id)||bluetoothFirmwareTask?.id===id||groupActions.has(id)||groupEditorMutations.has(id)||groupsSnapshot.busyIds?.includes(id)||groupJoinPending?.target?.id===id;}
function cardPowerExpected(entry){
  const value=connectivity.get(entry.id),light=value.lighting,group=value.group;
  const roles={independent:0,leader:1,follower:2};
  return light?.fresh&&typeof light.power==='boolean'&&group?.fresh&&Object.hasOwn(roles,group.state)?
    {power:light.power,group:{role:roles[group.state],leader:group.leader}}:null;
}
function cardPowerButton(entry){
  const expected=cardPowerExpected(entry),pending=cardPowerTasks.has(entry.id),role=expected?.group.role;
  const label=role===1?'Group power':role===2?'Lamp power':'Power',name=entry.name||'CoolLamp';
  const button=document.createElement('button');button.type='button';button.className='lamp-power';button.dataset.connection='power';button.dataset.powerState=pending?'pending':expected?expected.power?'on':'off':'unknown';
  button.setAttribute('aria-busy',String(pending));
  const action=pending?'Changing or checking '+name+' power':!expected?'Check '+name+' power before changing it':'Turn '+name+(role===1?' group':'')+(expected.power?' off':' on')+(role===2?expected.power?'; controls only this lamp and pauses group following':'; controls only this lamp':'');
  button.title=action;button.setAttribute('aria-label',action);
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v10m-5-7a9 9 0 1 0 10 0"/></svg>';
  const copy=document.createElement('span'),scope=document.createElement('strong'),value=document.createElement('small');scope.textContent=label;value.textContent=pending?'Working…':expected?expected.power?'On':'Off':'Check status';copy.append(scope,value);button.append(copy);
  button.disabled=pending||powerLaneBusy(entry.id)||fleetLampInstalling(entry.id)||groupRemovedIds.has(entry.id)||busy&&selected?.id===entry.id||connecting&&selected?.id===entry.id;
  button.onclick=()=>changeCardPower(entry,cardPowerExpected(entry)?expected:null);return button;
}
async function changeCardPower(entry,expected=cardPowerExpected(entry)){
  if(cardPowerTasks.has(entry.id)||powerLaneBusy(entry.id)||fleetLampInstalling(entry.id)||groupRemovedIds.has(entry.id)||(busy||connecting)&&selected?.id===entry.id)return;
  const current=mergedLampEntries().find(value=>value.id===entry.id);if(!current)return;
  const location=JSON.stringify([current.address??null,current.deviceId??null]),job={cancelled:false,
    restoreFocus:document.activeElement?.dataset.connection==='power'&&document.activeElement.closest('.lamp-entry')?.dataset.lampId===entry.id,navigation:navigationSerial};
  const cancelFocus=event=>{if(event.target?.dataset?.connection!=='power'||event.target.closest('.lamp-entry')?.dataset.lampId!==entry.id)job.restoreFocus=false;};
  for(const type of ['focusin','pointerdown','keydown'])document.addEventListener(type,cancelFocus);
  cardPowerTasks.set(entry.id,job);cardPowerMessages.delete(entry.id);renderLamps();renderRoomGroups();
  const isPresent=()=>!job.cancelled&&cardPowerTasks.get(entry.id)===job&&!groupRemovedIds.has(entry.id)&&
    mergedLampEntries().some(value=>value.id===entry.id&&JSON.stringify([value.address??null,value.deviceId??null])===location);
  const isCurrent=()=>isPresent()&&!powerLaneBusy(entry.id)&&!fleetLampInstalling(entry.id);
  const onSnapshot=snapshot=>{
    if(!isCurrent()||snapshot.id!==entry.id)return;
    if(snapshot.group)connectivity.observeGroup(entry.id,{deviceId:entry.id,group:snapshot.group,checkedAt:snapshot.checkedAt});
    else connectivity.invalidateGroup(entry.id,{attemptedAt:snapshot.checkedAt});
    if(snapshot.lighting&&(snapshot.group||legacyWithoutGroups(snapshot.firmwareVersion)))connectivity.observeLighting(entry.id,{deviceId:entry.id,lighting:snapshot.lighting,checkedAt:snapshot.checkedAt});
    else connectivity.invalidateLighting(entry.id,{attemptedAt:snapshot.checkedAt});
    if(snapshot.wifi)connectivity.observe(entry.id,{deviceId:entry.id,wifi:snapshot.wifi,checkedAt:snapshot.checkedAt,source:'state'});
  };
  try{
    const result=await runLampPower({id:entry.id,expected,acquire:acquireGroupLamp,isCurrent,onSnapshot});
    if(!isCurrent())return;
    const snapshot=result.snapshot,scope=snapshot.group?.role===1?'Group':'Lamp';
    const message=result.refreshed?snapshot.group?scope+' power checked · '+(snapshot.power?'On':'Off')+'.':'Power checked. Connect over Wi-Fi or update firmware to verify group membership.':
      result.noop?scope+' is already '+(snapshot.power?'on':'off')+'.':scope+' turned '+(snapshot.power?'on':'off')+'.'+(snapshot.group?.role===2&&snapshot.paused?' Group following is paused.':'');
    cardPowerMessages.set(entry.id,message);status((current.name||'CoolLamp')+' · '+message);
  }catch(error){
    if(!isPresent())return;
    const message=error.uncertain?'Power was not confirmed. Check this card’s status before trying again.':error.message;
    if(error.uncertain){connectivity.invalidateLighting(entry.id);connectivity.invalidateGroup(entry.id);}
    cardPowerMessages.set(entry.id,message);status((current.name||'CoolLamp')+' · '+message);
  }finally{
    for(const type of ['focusin','pointerdown','keydown'])document.removeEventListener(type,cancelFocus);
    if(cardPowerTasks.get(entry.id)===job)cardPowerTasks.delete(entry.id);renderLamps();renderRoomGroups();if(groupEditor)renderGroupScenes();
    if(job.restoreFocus&&job.navigation===navigationSerial&&!$('page-lamps').hidden&&document.activeElement===document.body){
      const control=[...$('lampList').querySelectorAll('.lamp-entry')].find(card=>card.dataset.lampId===entry.id)?.querySelector('.lamp-power');if(control&&!control.disabled)control.focus({preventScroll:true});
    }
  }
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
async function connectCardBluetooth(entry,{forWifiSettings=false,forCardSettings=false,readOnlyReconnect=false}={}) {
  if(bluetoothFirmwareOwner()){if(!firmwareConnectionSelectionAllowed(entry)){firmwareConnectionNotice();return;}if(!forWifiSettings&&!forCardSettings)return openCardSettings(entry,{section:'lighting',bluetooth:true});return {connected:true,id:entry.id};}
  if(busy||connecting||fleetLampInstalling(entry.id))return;
  if(!forWifiSettings&&!forCardSettings)return openCardSettings(entry,{section:'lighting',bluetooth:true});
  const current=mergedLampEntries().find(value=>value.id===entry.id);if(!current){status('This lamp was removed. Find it again before connecting.');return;}
  if(wifiSettingsTarget?.id!==entry.id)wifiSettingsTarget=null;
  const intent=wifiSettingsTarget;
  if(lamp===bleLamp&&verifiedSelectedLamp()&&selected.id===entry.id)return {connected:true,id:entry.id};
  if(!current.deviceId&&!await pairCardBluetooth(current)){wifiSettingsTarget=null;return;}
  if(intent&&(wifiSettingsTarget!==intent||navigationSerial!==intent.navigation))return;
  if(!mergedLampEntries().some(value=>value.id===entry.id)){status('This lamp was removed. Find it again before connecting.');return;}
  if(readOnlyReconnect&&!intent?.automaticReconnect)status('Connecting to '+(current.name||'your lamp')+' over Bluetooth…');
  const result=await connect(current,{expectedId:/^[0-9a-f]{12}$/.test(entry.id)?entry.id:null,preserveWifiIntent:true,navigate:false,readOnlyReconnect,
    automaticReconnect:readOnlyReconnect||intent?.automaticReconnect===true,isCurrent:intent?.isCurrent||(()=>true),signal:intent?.signal||null});
  if(!result?.connected&&!forCardSettings)wifiSettingsTarget=null;return result;
}
function completeCardSettings(intent) {
  const current=mergedLampEntries().find(entry=>entry.id===intent.id);
  if(wifiSettingsTarget!==intent||navigationSerial!==intent.navigation||!current||current.address!==intent.address||current.deviceId!==intent.deviceId||!verifiedSelectedLamp()||selected.id!==intent.id)return false;
  if(lamp===wifiLamp){
    if(intent.activeWifi){if(lamp.epoch!==intent.activeWifi.epoch||lamp.base!==intent.activeWifi.address)return false;}
    else if(!intent.address||lamp.base!==lampAddress(intent.address))return false;
  }
  const epoch=lamp.epoch,target=lamp;
  settingsSection(intent.section,{preserveCardSettings:true});if(lamp!==target||target.epoch!==epoch||!verifiedSelectedLamp()||selected.id!==intent.id)return false;
  if(intent.navigate===false){wifiSettingsTarget=null;return true;}
  page('settings');$('lampTitle').focus({preventScroll:true});return true;
}
function cancelMeshSelection(){const task=meshSelection;if(!task)return;meshSelection=null;task.abort.abort();renderLamps();}
function bindRecoveryAbort(task,intent){const abort=()=>task.abort.abort();intent.signal?.addEventListener('abort',abort,{once:true});if(intent.signal?.aborted)abort();return ()=>intent.signal?.removeEventListener('abort',abort);}
async function createMeshLampLease(id,{signal,isCurrent=()=>true,bridgeId=null,recoveryOnly=false}={}){
  const candidates=[];
  const activeBridge=lamp?.isMesh?lamp.bridge:lamp;
  if(activeBridge&&activeBridge.identity!==id&&meshBridgeSupported(activeBridge))candidates.push({transport:activeBridge,epoch:activeBridge.epoch,id:activeBridge.identity});
const entries=mergedLampEntries().filter(entry=>entry.id!==id&&!groupRemovedIds.has(entry.id)&&!fleetLampInstalling(entry.id)&&(!entry.firmwareVersion||compareFirmwareVersions(entry.firmwareVersion,'1.12.0')>=0)).sort((a,b)=>(b.id===bridgeId)-(a.id===bridgeId)||Number(Boolean(connectivity?.get(b.id).wifi?.fresh&&connectivity?.get(b.id).wifi?.state==='connected'))-Number(Boolean(connectivity?.get(a.id).wifi?.fresh&&connectivity?.get(a.id).wifi?.state==='connected')));
  for(const entry of entries)if(entry.address)candidates.push({entry,kind:'wifi'});
  for(const entry of entries)if(entry.deviceId&&(phonePlatform!=='ios'||entry.accessoryManaged))candidates.push({entry,kind:'bluetooth'});
  const guard=()=>{if(signal?.aborted||!isCurrent())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true,confirmed:true});};
  return acquireMeshLamp({target:id,candidates:recoveryOnly?selectMeshRecoveryCandidates(candidates):candidates,signal,isCurrent,options:recoveryOnly?{timeout:4000,totalTimeout:10000,stopOnTimeout:true}:{timeout:6000},onInventory:(value,bridge)=>{meshInventory.remember(value,bridge);renderLamps();},acquireBridge:async candidate=>{
    guard();
    if(candidate.transport){if(candidate.transport.epoch!==candidate.epoch||candidate.transport.identity!==candidate.id)throw Error('Bridge connection changed.');return {lamp:candidate.transport,borrowed:true,release:async()=>{}};}
    const entry=candidate.entry;
    if(candidate.kind==='wifi'){
      const bridge=new WifiTransport(CapacitorHttp);
      try{const savedPassword=(await credential(entry.id)).value;guard();if(recoveryOnly&&!savedPassword)throw Error('No saved access for this connection.');const password=savedPassword||'coollamp';await bridge.connect(entry.address,password,entry.id);guard();clearTimeout(bridge.timer);return {lamp:bridge,release:()=>bridge.disconnect()};}
      catch(error){await bridge.disconnect();throw error;}
    }
    await initializeGroupRadio({transport:bleLamp,ble:BleClient,platform:phonePlatform,pairing,accessories:accessoryNative,knownDevices:()=>recoveryOnly?[entry]:[...store.items,savedDevice].filter(Boolean),onAuthorized:devices=>rememberAccessories(store,devices,removedAccessoryIds)});guard();
    const bridge=new LampTransport(BleClient,{firmwareBulkWrites:isNative&&phonePlatform==='ios',sharedInitialization:bleLamp.initialization,expectedDeviceIdentity:entry.id,controlOnly:true,
      ...(recoveryOnly&&phonePlatform==='ios'?{selectDevice:device=>pairing.reconnect(device)}:{})});
    try{await bridge.connect({...entry,lampId:entry.id,automaticReconnect:recoveryOnly});guard();clearTimeout(bridge.controlTimer);if(isNative&&!recoveryOnly)await firmwareFleetTrust.provision(bridge);guard();return {lamp:bridge,release:()=>bridge.disconnect()};}
    catch(error){await bridge.disconnect();throw error;}
  }});
}
async function connectMeshCard(entry,intent){
  cancelMeshSelection();const task={id:entry.id,abort:new AbortController()};meshSelection=task;renderLamps();status('Finding a mesh route to '+(entry.name||'this lamp')+'…');
  const releaseAbort=bindRecoveryAbort(task,intent);
  const current=()=>!task.abort.signal.aborted&&(!intent.isCurrent||intent.isCurrent())&&!bluetoothFirmwareOwner()&&intent.firmwareSerial===bluetoothFirmwareConnectionSerial&&meshSelection===task&&wifiSettingsTarget===intent&&navigationSerial===intent.navigation&&mergedLampEntries().some(value=>value.id===entry.id);
  let lease;
  try{
    // Opening settings only reads existing routes; it must never enroll or
    // provision another lamp while looking for this one.
    lease=await createMeshLampLease(entry.id,{signal:task.abort.signal,isCurrent:current,bridgeId:entry.meshBridgeId,recoveryOnly:true});if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    const transport=lease.lamp,previous=lamp;
    await stopGroupInspection(entry.id);if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    if(previous?.isMesh&&previous.bridge===transport.bridge&&transport.lease.borrowed){const inherited=previous.lease;previous.lease=null;transport.lease.release=()=>inherited?.release?.();await previous.disconnect();}
    else if(previous!==transport.bridge)await previous.disconnect();else if(transport.lease.borrowed)transport.lease.release=()=>previous.disconnect();
    transport.guard();
    if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    meshSelection=null;selected=store.upsert({...store.items.find(value=>value.id===entry.id),...entry,id:transport.identity});lamp=transport;
    transport.signal=null;transport.isCurrent=()=>lamp===transport;transport.callbacks={...transportCallbacks(()=>transport),onError:error=>{if(lamp===transport){if(!$('page-settings').hidden)settingsRecovery?.check();else status(error.message);}}};
    callbacks.onState(transport.state,{freshControl:true});callbacks.onFirmware(transport.raw.firmware);
    const options=transport.raw.effectOptions?.[transport.raw.mode-1];callbacks.onOptions(options?{mode:transport.raw.mode,speed:options[0],intensity:options[1],dual:options[2],r:options[3],g:options[4],b:options[5]}:null);
    transport.schedule();lease=null;connected('ESP-NOW mesh',{navigate:false,quiet:intent.automaticReconnect===true});return {connected:true,id:entry.id};
  }catch(error){if(current()&&!error.cancelled&&!intent.automaticReconnect)status(error.message);return {connected:false,error};}
  finally{releaseAbort();await lease?.release?.();if(meshSelection===task)meshSelection=null;renderLamps();renderPower();renderFirmware();renderSettings();}
}
async function connectCardWifiAsync(entry,intent){
  cancelMeshSelection();const task={id:entry.id,kind:'wifi',abort:new AbortController()},probe=new WifiTransport(CapacitorHttp);meshSelection=task;renderLamps();status('Checking this lamp over Wi-Fi…');
  const releaseAbort=bindRecoveryAbort(task,intent);
  const current=()=>!task.abort.signal.aborted&&(!intent.isCurrent||intent.isCurrent())&&!bluetoothFirmwareOwner()&&intent.firmwareSerial===bluetoothFirmwareConnectionSerial&&meshSelection===task&&wifiSettingsTarget===intent&&navigationSerial===intent.navigation&&mergedLampEntries().some(value=>value.id===entry.id&&value.address===intent.address);
  let timer,abort;
  try{
    const password=(await credential(entry.id)).value;if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    if(!password)throw Object.assign(Error('Enter the lamp access password to connect over Wi-Fi.'),{needsPassword:true});
    const pending=probe.connect(entry.address,password,entry.id);
    await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Lamp did not respond over Wi-Fi.')),6000);abort=()=>reject(Object.assign(Error('Lamp selection changed.'),{cancelled:true}));task.abort.signal.addEventListener('abort',abort,{once:true});})]);
    if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});clearTimeout(probe.timer);
    const value={base:probe.base,authorization:probe.authorization,identity:probe.identity,raw:probe.raw,state:probe.state,catalog:probe.catalog};
    await stopGroupInspection(entry.id);if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    await lamp.disconnect();if(!current())throw Object.assign(Error('Lamp selection changed.'),{cancelled:true});
    if(lamp!==wifiLamp)await wifiLamp.disconnect();Object.assign(wifiLamp,value);lamp=wifiLamp;meshSelection=null;
    const raw=value.raw,prior=store.items.find(value=>value.id===entry.id);selected=store.upsertWifi({...prior,id:raw.deviceId||entry.id,address:entry.address,hostname:raw.hostname,name:raw.name||prior?.name||entry.name},entry.id);
    groupRemovedIds.delete(selected.id);roomGroups?.allow?.(selected.id);wifiFailures.delete(entry.id);callbacks.onState(value.state);callbacks.onFirmware(raw.firmware);
    const options=raw.effectOptions?.[raw.mode-1];callbacks.onOptions(options?{mode:raw.mode,speed:options[0],intensity:options[1],dual:options[2],r:options[3],g:options[4],b:options[5]}:null);
    wifiLamp.schedule();connected('Wi-Fi',{navigate:false,quiet:intent.automaticReconnect===true});return {connected:true,id:selected.id};
  }catch(error){return {connected:false,error};}
  finally{releaseAbort();clearTimeout(timer);task.abort.signal.removeEventListener('abort',abort);await probe.disconnect();if(meshSelection===task)meshSelection=null;renderLamps();renderPower();renderFirmware();renderSettings();}
}
function renderNewMeshLamps(){
  $('newMeshLampList').replaceChildren();const rows=newMeshCandidates.filter(row=>!store.items.some(entry=>entry.id===row.id)&&row.online);
  $('newMeshLamps').hidden=!rows.length||Boolean(meshWizard);
  for(const row of rows){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Set up '+(row.name||'new lamp');button.disabled=busy||connecting;button.onclick=()=>beginMeshSetup(row);$('newMeshLampList').append(button);}
}
function refreshNewMeshLamps(){if(!meshOnboarding||meshWizard||document.hidden)return;void meshOnboarding.discover().catch(()=>{});}
async function acquireOnboardingBridge(id,options={}){
  const current=()=>!options.signal?.aborted&&!groupRemovedIds.has(id)&&store.items.some(entry=>entry.id===id);
  const entry=store.items.find(entry=>entry.id===id);
  let lease=await acquireGroupLamp(id,options);
  if(!current())return lease;
  let inventory;try{const text=await lease.lamp.request('/api/mesh/status');inventory=typeof text==='string'?JSON.parse(text):text;}catch{return lease;}
  if(inventory?.version!==1||inventory.deviceId!==id||inventory.available!==false||typeof inventory.fleetId!=='string'||inventory.fleetId)return lease;
  if(!isNative||!entry?.deviceId||phonePlatform==='ios'&&!entry.accessoryManaged){meshNetworkMessages.set(id,'Enable the lamp network on this existing lamp by connecting its saved Bluetooth card once.');renderLamps();return lease;}
  await lease.release();lease=null;
  if(!current())throw Object.assign(Error('Bridge setup changed.'),{cancelled:true});
  const selectedBridge=lamp===bleLamp&&bleLamp.id===entry.deviceId&&bleLamp.identity===id;
  let bridge;
  if(selectedBridge)bridge=bleLamp;
  else{
    await initializeGroupRadio({transport:bleLamp,ble:BleClient,platform:phonePlatform,pairing,accessories:accessoryNative,knownDevices:()=>[entry],onAuthorized:devices=>rememberAccessories(store,devices,removedAccessoryIds)});
    bridge=new LampTransport(BleClient,{firmwareBulkWrites:isNative&&phonePlatform==='ios',sharedInitialization:bleLamp.initialization,expectedDeviceIdentity:id,controlOnly:true});
  }
  try{
    if(!selectedBridge){await bridge.connect({...entry,lampId:id});clearTimeout(bridge.controlTimer);}
    if(!current())throw Object.assign(Error('Bridge setup changed.'),{cancelled:true});
    const result=await firmwareFleetTrust.provision(bridge,{isCurrent:current});
    if(!result.supported)throw Error('Update this existing lamp to enable its lamp network.');
    meshNetworkMessages.delete(id);
    if(!selectedBridge){liveGroupBluetooth.set(id,{transport:bridge,epoch:bridge.epoch});renderLamps();}
    return {lamp:bridge,release:async()=>{if(selectedBridge)return;if(liveGroupBluetooth.get(id)?.transport===bridge)liveGroupBluetooth.delete(id);await bridge.disconnect();renderLamps();}};
  }catch(error){if(!selectedBridge)await bridge.disconnect();meshNetworkMessages.set(id,'Enable the lamp network by connecting this existing lamp over paired Bluetooth. '+error.message);renderLamps();throw error;}
}
const meshConfirmPalette=[[255,0,0],[255,96,0],[255,220,0],[128,255,0],[0,255,0],[0,255,96],[0,220,255],[0,96,255],[0,0,255],[96,0,255],[180,0,255],[255,0,220],[255,0,96],[255,170,96],[128,180,255],[255,255,255]];
const meshConfirmNames=['Red','Orange','Yellow','Lime','Green','Mint','Cyan','Sky blue','Blue','Violet','Purple','Magenta','Pink','Warm white','Cool white','White'];
function meshSetupStatus(value){
  const task=meshWizard;if(!task||value.target!==task.candidate.id)return;
  $('meshSetupStatus').textContent=value.message+(value.error?' '+value.error:'');
  $('meshSetupPattern').hidden=value.phase!=='confirm';$('meshSetupPattern').replaceChildren();
  if(value.phase==='confirm'){
    $('meshSetupStatus').textContent='Compare this four-color sequence with the new lamp. Only if it matches, click that lamp’s knob once to approve setup. Otherwise cancel.';
    for(const [index,slot] of (value.pattern||[]).entries()){const swatch=document.createElement('span');swatch.style.background='rgb('+meshConfirmPalette[slot].join(',')+')';swatch.title=(index+1)+'. '+meshConfirmNames[slot];swatch.setAttribute('role','img');swatch.setAttribute('aria-label',swatch.title);$('meshSetupPattern').append(swatch);}
  }
  $('meshSetupRecover').hidden=!value.uncertain;
}
async function closeMeshWizard(){
  const task=meshWizard;if(!task)return;meshWizard=null;task.abort.abort();
  $('meshSetup').hidden=true;$('meshSetupForm').hidden=true;$('meshSetupWifiPassword').value='';
  if(task.target)groupEditorMutations.delete(task.target);await meshOnboarding?.cancel();await task.lease?.release?.();renderNewMeshLamps();renderLamps();
}
async function prepareMeshWizard(task,result){
  const current=()=>meshWizard===task&&!task.abort.signal.aborted;
  const lease=await createMeshLampLease(result.target,{signal:task.abort.signal,isCurrent:current,bridgeId:result.bridgeId});
  if(!current()){await lease.release();return;}
  const transport=lease.lamp;if(transport.identity!==result.target||transport.raw.deviceId!==result.target){await lease.release();throw Error('The new lamp’s identity was not confirmed. Check setup before continuing.');}
  task.lease=lease;task.result=result;task.target=result.target;
  const raw=transport.raw,prior=store.items.find(entry=>entry.id===result.target);
  store.upsert({...prior,id:result.target,name:prior?.name||raw.name||task.candidate.name||'CoolLamp',meshEnrolled:true,meshBridgeId:result.bridgeId});
  groupRemovedIds.delete(result.target);roomGroups?.allow?.(result.target);store.rememberFirmware(result.target,raw.firmware);observeLampLighting(result.target,raw,transport.catalog);observeLampWifi(result.target,raw.firmware?.wifi,'firmware');
  groupEditorMutations.add(result.target);
  $('meshSetupName').value=raw.name||'CoolLamp';$('meshSetupStyle').value=reportedLampStyle(raw.lampStyle)?.id||'unspecified';
  $('meshSetupLeds').value=raw.leds;$('meshSetupMilliamps').value=raw.milliamps||500;$('meshSetupMicrophone').checked=raw.audio?.installed===true;$('meshSetupPower').checked=raw.power;
  $('meshSetupWifi').checked=false;$('meshSetupWifiFields').hidden=true;$('meshSetupSsid').required=false;$('meshSetupSsid').value=raw.ssid||'';$('meshSetupWifiPassword').value='';$('meshSetupWifiOpen').checked=false;
  $('meshSetupFields').disabled=false;$('meshSetupForm').hidden=false;$('meshSetupPattern').hidden=true;$('meshSetupRecover').hidden=true;
  $('meshSetupStatus').textContent='Your lamp is approved and connected through the mesh. Choose its settings below.';renderLamps();$('meshSetupName').focus();
}
async function beginMeshSetup(candidate,{recover=false}={}){
  if(busy||connecting)return;cancelMeshSelection();await closeMeshWizard();
  const task={candidate,abort:new AbortController(),saving:false,lease:null};meshWizard=task;meshOnboarding.cancelDiscover();
  $('meshSetup').hidden=false;$('meshSetupForm').hidden=true;$('meshSetupPattern').hidden=true;$('meshSetupRecover').hidden=true;$('meshSetupStatus').textContent='Contacting the new lamp through an existing lamp…';renderNewMeshLamps();$('meshSetupTitle').focus();
  try{const result=recover?await meshOnboarding.recover(candidate.id):await meshOnboarding.start(candidate);if(meshWizard!==task)return;await prepareMeshWizard(task,result);}
  catch(error){if(meshWizard!==task)return;$('meshSetupStatus').textContent=error.message;$('meshSetupRecover').hidden=!error.uncertain;task.uncertain=error.uncertain===true;}
}
$('meshSetupStyle').replaceChildren(...LAMP_STYLES.map(style=>new Option(style.label,style.id)));
$('meshSetupCancel').onclick=()=>closeMeshWizard();
$('meshSetupRecover').onclick=()=>{const candidate=meshWizard?.candidate;if(candidate)void beginMeshSetup(candidate,{recover:true});};
$('meshSetupWifi').onchange=()=>{const enabled=$('meshSetupWifi').checked;$('meshSetupWifiFields').hidden=!enabled;$('meshSetupSsid').required=enabled;};
$('meshSetupWifiOpen').onchange=()=>{$('meshSetupWifiPassword').disabled=$('meshSetupWifiOpen').checked;if($('meshSetupWifiOpen').checked)$('meshSetupWifiPassword').value='';};
$('meshSetupForm').onsubmit=async event=>{
  event.preventDefault();const task=meshWizard;if(!task?.lease||task.saving)return;
  const transport=task.lease.lamp,raw=transport.raw,name=$('meshSetupName').value.trim(),style=$('meshSetupStyle').value;
  const config={ssid:raw.ssid||'',leds:Number($('meshSetupLeds').value),milliamps:Number($('meshSetupMilliamps').value),mode:raw.startupMode||raw.mode,brightness:raw.startupBrightness||raw.brightness,microphoneInstalled:Number($('meshSetupMicrophone').checked)};
  const wifi=$('meshSetupWifi').checked,power=$('meshSetupPower').checked;
  if(!name||name.length>32||!styleDefinition(style)||!Number.isInteger(config.leds)||config.leds<1||config.leds>1024||!Number.isInteger(config.milliamps)||config.milliamps<100||config.milliamps>20000){$('meshSetupStatus').textContent='Check the lamp name, LED count and power limit.';return;}
  if(wifi){try{const credentials=wifiCredentials($('meshSetupSsid').value,$('meshSetupWifiPassword').value,$('meshSetupWifiOpen').checked);credentials.bytes.fill(0);}catch(error){$('meshSetupStatus').textContent=error.message;return;}
    Object.assign(config,{ssid:$('meshSetupSsid').value,wifiPassword:$('meshSetupWifiPassword').value,openNetwork:Number($('meshSetupWifiOpen').checked),forgetWifi:0});}
  task.saving=true;$('meshSetupFields').disabled=true;$('meshSetupStatus').textContent='Saving this lamp’s settings through the mesh…';
  const current=()=>{if(meshWizard!==task||task.abort.signal.aborted||transport.identity!==task.target)throw Object.assign(Error('Lamp setup changed.'),{cancelled:true,confirmed:true});};
  try{
    current();if(name!==raw.name)await transport.enqueue(()=>{current();return transport.request('/api/name',{name});});
    current();if(style!==(reportedLampStyle(transport.raw.lampStyle)?.id||'unspecified'))await transport.enqueue(()=>{current();return transport.configureLampStyle(style);});
    current();if(power!==transport.state.power)await transport.command('power',Number(power),null,current);
    current();const changed=wifi||config.leds!==raw.leds||config.milliamps!==raw.milliamps||Boolean(config.microphoneInstalled)!==Boolean(raw.audio?.installed);
    if(changed)await transport.enqueue(()=>{current();return transport.request('/api/config',config);});
    current();store.upsert({...store.items.find(entry=>entry.id===task.target),name});if(transport.raw.lampStyle)rememberLampStyle(task.target,transport.raw.lampStyle);
    await closeMeshWizard();status(changed?'Lamp settings saved. It is restarting; its card will reconnect through the mesh.':'Your new lamp is ready. Choose its card to open controls.');
  }catch(error){if(meshWizard!==task)return;const message=error.uncertain?'Settings were not confirmed. No request was repeated. Check the lamp’s card before saving again.':error.message;$('meshSetupStatus').textContent=message;status(message);
    $('meshSetupRecover').hidden=true;task.unconfirmed=error.uncertain===true;if(!task.unconfirmed)$('meshSetupFields').disabled=false;
  }finally{delete config.wifiPassword;$('meshSetupWifiPassword').value='';if(meshWizard===task)task.saving=false;}
};
async function openCardSettings(entry,{section='overview',bluetooth=false,preferWifi=false,automaticReconnect=false,signal=null,isCurrent=()=>true,navigate=true}={}) {
  if(signal?.aborted||!isCurrent())return;
  if(bluetoothFirmwareOwner()){
    if(!firmwareConnectionSelectionAllowed(entry)){firmwareConnectionNotice();return;}
    settingsView=section;if(navigate)page('settings');return {connected:true,id:entry.id};
  }
  if(busy||connecting||fleetLampInstalling(entry.id))return;
  cancelMeshSelection();
  let current=mergedLampEntries().find(value=>value.id===entry.id);if(!current)return;
  const intent={id:current.id,address:current.address,deviceId:current.deviceId,section,serial:++cardSettingsSerial,navigation:navigationSerial,firmwareSerial:bluetoothFirmwareConnectionSerial,automaticReconnect,signal,isCurrent,navigate};
  wifiSettingsTarget=intent;
  const pending=()=>!signal?.aborted&&isCurrent()&&!bluetoothFirmwareOwner()&&intent.firmwareSerial===bluetoothFirmwareConnectionSerial&&wifiSettingsTarget===intent&&navigationSerial===intent.navigation&&mergedLampEntries().some(value=>value.id===intent.id&&value.address===intent.address&&value.deviceId===intent.deviceId);
  const reuse=verifiedSelectedLamp()&&selected.id===entry.id&&(!bluetooth||lamp===bleLamp)&&(!preferWifi||lamp!==bleLamp||bleLamp.supportsOfflineControl||!current.address);
  // A verified connection can use an IP while discovery lists its mDNS alias.
  // Keep its exact epoch and address; identity verification already matched it.
  if(reuse&&lamp===wifiLamp)intent.activeWifi={epoch:lamp.epoch,address:lamp.base};
  if(!reuse){
    let result,wifiResult;
    const authorizedBluetooth=Boolean(current.deviceId&&(phonePlatform!=='ios'||current.accessoryManaged));
    const wifi=connectivity?.get(entry.id).wifi;
    // A fresh verified Wi-Fi route is fast. After commissioning, the saved
    // Bluetooth route avoids waiting for Wi-Fi discovery or probing the fleet.
    const wifiFirst=!bluetooth&&current.address&&(!authorizedBluetooth||wifi?.fresh&&wifi.state==='connected');
    if(wifiFirst)result=wifiResult=await connectCardWifiAsync(current,intent);
    if(!pending())return result;
    if(!result?.connected&&authorizedBluetooth)result=await connectCardBluetooth(current,{forCardSettings:true,readOnlyReconnect:true});
    if(!pending())return result;
    // Old offline telemetry must not suppress a direct retry of this lamp.
    if(!result?.connected&&current.address&&!bluetooth&&!wifiFirst)result=wifiResult=await connectCardWifiAsync(current,intent);
    if(!pending())return result;
    if(!result?.connected&&!bluetooth)result=await connectMeshCard(current,intent);
    if(!pending())return result;
    if(!result?.connected&&!automaticReconnect&&!authorizedBluetooth){
      current=mergedLampEntries().find(value=>value.id===entry.id);if(!current)return;
      if(current.deviceId||!current.address||bluetooth)result=await connectCardBluetooth(current,{forCardSettings:true});
    }
    if(result?.connected&&!intent.deviceId&&wifiSettingsTarget===intent&&lamp===bleLamp&&bleLamp.deviceIdentity===intent.id&&selected?.id===intent.id)intent.deviceId=selected.deviceId;
    if(!pending())return result;
    if(!result?.connected){if(wifiResult?.error?.needsPassword&&!automaticReconnect){promptWifiPassword(current);return wifiResult;}wifiSettingsTarget=null;return result||wifiResult;}
  }
  if(automaticReconnect){if(wifiSettingsTarget===intent)wifiSettingsTarget=null;renderSettings();renderOptions();return {connected:verifiedSelectedLamp()&&selected.id===entry.id,id:entry.id};}
  if(!completeCardSettings(intent)){if(wifiSettingsTarget===intent)wifiSettingsTarget=null;return;}
  return {connected:true,id:entry.id};
}
const openCardWifiSettings=entry=>openCardSettings(entry,{section:'network'});
function renderLamps() {
  const focused=document.activeElement?.closest('.lamp-entry');
  const focusedId=focused?.dataset.lampId,focusedRemove=document.activeElement?.classList.contains('lamp-remove'),focusedConnection=document.activeElement?.dataset.connection;
  const openConnections=new Set([...$('lampList').querySelectorAll('.v2-connection-details[open]')].map(item=>item.closest('[data-lamp-id]')?.dataset.lampId));
  $('discover').textContent=discovery.scanned?'Refresh lamps':'Find nearby lamps';
  $('lampList').replaceChildren();
  const entries=mergedLampEntries();$('emptyLamps').hidden=entries.length>0;
  for(const entry of entries) {
    const name=entry.name||'CoolLamp',connected=verifiedSelectedLamp()&&entry.id===selected.id;
    const telemetry=connectivity?.get(entry.id),lighting=telemetry?.lighting,group=telemetry?.group,observation=fleetStatuses.get(entry.id);
    const wrapper=document.createElement('article');wrapper.className='lamp-entry v2-lamp-entry';wrapper.dataset.lampId=entry.id;wrapper.dataset.state=connected||lighting?.fresh?'ready':lighting?.state==='stale'?'last-seen':'unknown';
    const button=document.createElement('button');button.type='button';button.className='lamp-card v2-lamp-card';button.dataset.lampId=entry.id;button.dataset.connection='lighting';
    button.setAttribute('aria-label','Control '+name);button.setAttribute('aria-current',String(connected));
    button.disabled=connecting||busy||fleetLampInstalling(entry.id)||!firmwareConnectionSelectionAllowed(entry);
    const art=lampStyleIllustration(resolvedStyle(entry).id);art.classList.add('v2-card-art');if(lighting?.fresh&&lighting.power===false)art.classList.add('is-off');
    const copy=document.createElement('span');copy.className='v2-card-copy';const title=document.createElement('strong');title.textContent=name;
    const location=document.createElement('span');location.className='v2-card-location';location.textContent=[entry.room,styleLabel(resolvedStyle(entry).id)].filter(Boolean).join(' · ');
    const effect=document.createElement('span');effect.className='lamp-current-effect v2-card-effect';effect.textContent=lighting?.state!=='unknown'&&lighting?.name&&lighting?.label?lighting.label:'Connect to see your light';effect.dataset.state=lighting?.state||'unknown';if(lighting?.checkedAt)effect.title='Last verified '+new Date(lighting.checkedAt).toLocaleString();
    const scope=document.createElement('small');scope.className='v2-card-scope';
    if(group?.fresh&&group.state==='follower'){const source=groupsSnapshot.groups.find(value=>value.id===group.leader);const groupName=source?((typeof appV2!=='undefined'?appV2?.groupName(source.id,source.name):null)||source.name):'its group';scope.textContent=group.paused?'Used separately · '+groupName:'Plays with '+groupName;}
    else if(group?.fresh&&group.state==='leader'){const source=groupsSnapshot.groups.find(value=>value.id===entry.id);scope.textContent='Keeps '+(source?((typeof appV2!=='undefined'?appV2?.groupName(source.id,source.name):null)||source.name):'its group')+' together';}
    else scope.textContent=group?.fresh&&group.state==='independent'?'Your own light':'Group status will be checked before changes';
    copy.append(title,location,effect,scope);button.append(art,copy);button.onclick=()=>openCardSettings(entry,{section:'lighting',preferWifi:true});
    const readiness=document.createElement('div');readiness.className='v2-card-status';
    readiness.textContent=connected?lamp?.isMesh?'Connected through another lamp':lamp===wifiLamp?'Connected on home Wi-Fi':'Nearby connection':activeCardBluetooth(entry)?'Nearby connection':lighting?.fresh?'Ready':lighting?.state==='stale'?'Last seen · Tap to reconnect':'Tap to connect';
    if(meshSelection?.id===entry.id){readiness.textContent='Finding your lamp…';button.setAttribute('aria-busy','true');}
    const actions=document.createElement('div');actions.className='v2-card-actions';
    const power=cardPowerButton(entry);power.classList.add('v2-card-power');
    const gear=document.createElement('button');gear.type='button';gear.className='lamp-connection lamp-settings v2-card-settings';gear.dataset.connection='settings';gear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.11 4.43L10.61 2.1L13.39 2.1L13.89 4.43L16.02 5.31L18.02 4.01L19.99 5.98L18.69 7.98L19.57 10.11L21.9 10.61L21.9 13.39L19.57 13.89L18.69 16.02L19.99 18.02L18.02 19.99L16.02 18.69L13.89 19.57L13.39 21.9L10.61 21.9L10.11 19.57L7.98 18.69L5.98 19.99L4.01 18.02L5.31 16.02L4.43 13.89L2.1 13.39L2.1 10.61L4.43 10.11L5.31 7.98L4.01 5.98L5.98 4.01L7.98 5.31Z"/><circle cx="12" cy="12" r="3"/></svg>';gear.title='Settings for '+name;gear.setAttribute('aria-label',gear.title);
    gear.disabled=busy||connecting||fleetLampInstalling(entry.id)||cardPowerTasks.has(entry.id)||!firmwareConnectionSelectionAllowed(entry);gear.onclick=()=>openCardSettings(entry,{section:'overview'});
    actions.append(power,gear);const update=cardFirmwareButton(entry);
    const connectionDetails=document.createElement('details');connectionDetails.className='v2-connection-details';connectionDetails.open=openConnections.has(entry.id);
    const connectionSummary=document.createElement('summary');connectionSummary.textContent='Connection & care';connectionDetails.append(connectionSummary);
    const version=document.createElement('small');version.className='lamp-firmware';version.textContent=lampFirmwareLabel(entry,{connected,firmware,firmwareReceivedAt,observation});
    const activeAt=connected&&validFirmwareVersion(firmware?.version)?firmwareReceivedAt:0,pingAt=observation?.verified&&observation.fresh&&validFirmwareVersion(observation.installedVersion)&&Number.isFinite(observation.checkedAt)?observation.checkedAt:0,seen=Math.max(activeAt,pingAt)||observation?.checkedAt||entry.firmwareSeenAt;
    if(seen)version.title='Last verified '+new Date(seen).toLocaleString();
    const firmwareRow=document.createElement('div');firmwareRow.className='v2-card-firmware';firmwareRow.append(version,update);connectionDetails.append(firmwareRow);
    const releaseStatus=document.createElement('small');releaseStatus.className='v2-card-release-status';
    releaseStatus.textContent=publicFirmwareRun?'Checking the public release…':publicFirmwareError?'Public release check failed. Tap Check to try again.':publicFirmwareFresh&&publicFirmware?'Latest release '+publicFirmware.version+(publicFirmwareCheckedAt?' · Checked '+new Date(publicFirmwareCheckedAt).toLocaleString():''):'Public release has not been checked.';connectionDetails.append(releaseStatus);
    const links=document.createElement('div');links.className='lamp-connections v2-connection-actions';links.append(wifiCardIcon(entry),bluetoothCardIcon(entry),groupCardIcon(entry));connectionDetails.append(links);
    const remove=document.createElement('button');remove.type='button';remove.className='lamp-connection lamp-remove v2-card-remove';remove.dataset.connection='remove';remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/></svg>';remove.title='Remove '+name+' from this phone';remove.setAttribute('aria-label',remove.title);
    remove.disabled=busy||connecting||fleetLampInstalling(entry.id)||cardPowerTasks.has(entry.id)||bluetoothFirmwareOwner()?.id===entry.id;remove.onclick=e=>{e.stopPropagation();removeLampFromPhone(entry).catch(()=>{});};links.append(remove);
    const feedback=document.createElement('div');feedback.className='v2-card-feedback';
    const messages=[cardPowerMessages.get(entry.id),firmwareFeedback.get(entry.id)?.message||cardFirmwareMessages.get(entry.id),meshNetworkMessages.get(entry.id),fleetCardStatus(observation,entry)].filter(Boolean);
    for(const messageText of [...new Set(messages)]){const message=document.createElement('small');message.className='lamp-update-status';message.textContent=messageText;feedback.append(message);}
    if(['updating','restarting'].includes(observation?.state)){const progress=document.createElement('progress');progress.className='lamp-update-progress';progress.max=100;if(observation.state==='updating'&&Number.isInteger(observation.progress))progress.value=observation.progress;progress.setAttribute('aria-label',name+' firmware update progress');feedback.append(progress);}
    wrapper.append(button,readiness,actions,feedback,connectionDetails);$('lampList').append(wrapper);
    if(focusedId===entry.id){const control=focusedConnection==='power'?power:focusedConnection==='settings'?gear:focusedConnection==='lighting'?button:focusedConnection==='update'?update:focusedRemove||focusedConnection==='remove'?remove:focusedConnection?links.querySelector('[data-connection="'+focusedConnection+'"]'):button;if(control&&!control.disabled){if(connectionDetails.contains(control))connectionDetails.open=true;control.focus({preventScroll:true});}}
  }
  renderFleetControls();
  const search=$('v2LampSearch').value.trim().toLowerCase(); if(search)for(const row of $('lampList').children)row.hidden=!row.textContent.toLowerCase().includes(search);
}
async function discover(includeForgotten=false) {
  if(!isNative){status('Automatic discovery is available in the iPhone and Android app. You can enter a lamp address here.');return;}
  $('discover').disabled=true;status('Looking for lamps on your Wi-Fi…');
  if(includeForgotten)discovery.beginRefresh();
  try {
    const result=await readNativeLampDiscovery();discovered=discovery.remember(result.lamps);
    renderLamps();status(discovered.length?'Tap a lamp’s gear to open its settings.':'No lamps found. Check Local Network permission and that your phone and lamp use the same home network. You can also enter its address or use Bluetooth.');
    refreshLampFirmware({newDiscovery:true});
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
    const title=document.createElement('strong');title.textContent=effectDisplayName(catalog.find(entry=>entry.id===Number(option.value)))||option.text;
    const art=document.createElement('span');art.className='v2-effect-art';art.setAttribute('aria-hidden','true');art.innerHTML='<i></i><i></i><i></i>';button.append(art);
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
  if(entry&&bluetoothFirmwareOwner()?.id===entry.id){firmwareConnectionNotice();return;}
  if(!entry||busy||connecting||fleetLampInstalling(entry.id))return;
  if(!confirmed&&!confirm('Remove '+(entry.name||'this lamp')+' from this phone? '+
    (phonePlatform==='ios'?'Its iPhone pairing will also be removed where supported.':'You may also need to forget its pairing in Bluetooth settings.')+
    ' The lamp’s settings stay unchanged.'))return;
  busy=true;connecting=true;renderLamps();renderSettings();
  cancelMeshSelection();meshInventory.forget(entry.id);
  try {
    const powerTask=cardPowerTasks.get(entry.id);if(powerTask)powerTask.cancelled=true;cardPowerTasks.delete(entry.id);cardPowerMessages.delete(entry.id);
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
    firmwareFeedback.remove(entry.id);cardFirmwareMessages.delete(entry.id);cardFirmwareUnconfirmed.delete(entry.id);
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
  if(lamp?.isMesh){status('Connect directly to this lamp over Bluetooth or Wi-Fi to reset it.');return;}
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
paintRanges();renderLamps();refreshLampFirmware();refreshPublicFirmware();scheduleLampStatusRefresh();
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
  if(cardFirmwareTasks.has(id))throw Error('Wait for this lamp’s firmware update to finish before using its group controls.');
  if(bluetoothFirmwareTask?.id===id)throw Error('Finish or cancel this lamp’s Bluetooth update before using its group controls.');
  if(groupRemovedIds.has(id))throw Object.assign(Error('Connect to this lamp again to authorize group management.'),{needsAuthorization:true});
  const current=groupInventoryEntries().find(entry=>entry.id===id);
  if(!current)throw Object.assign(Error('Find or pair this lamp again before managing its groups.'),{needsAuthorization:true});
  options={...options,entry:current};
  if(cardPowerTasks.has(id)&&options.purpose!=='power'&&options.readOnly!==true)throw Object.assign(Error('Wait for this lamp’s power request to finish before changing its group.'),{confirmed:true,cancelled:true});
  const borrowedBasicPower=options.purpose==='power'&&lamp===bleLamp&&(options.readOnly===true||legacyWithoutGroups(firmware?.version));
  if(verifiedSelectedLamp()&&lamp.identity===id&&(advancedAvailable()||borrowedBasicPower))return {lamp,release:async()=>{}};
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
  try{return await createMeshLampLease(id,{isCurrent:()=>!groupRemovedIds.has(id)&&groupInventoryEntries().some(value=>value.id===id)});}
  catch(error){if(error.cancelled||error.uncertain)throw error;if(!error.noRoute)wifiError=error;}
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
  transport=new LampTransport(BleClient,{firmwareBulkWrites:isNative&&phonePlatform==='ios',sharedInitialization:bleLamp.initialization,expectedDeviceIdentity:id,controlOnly:true,onDisconnect:clearLink});
  try{
    await transport.connect({...entry,lampId:id});
    if(isNative)await firmwareFleetTrust.provision(transport);
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
  if(cardPowerTasks.has(id)){$('groupsFeedback').textContent='Wait for this lamp’s power request to finish before changing its group.';return;}
  groupActions.add(id);$('groupsFeedback').textContent='Saving group settings…';renderRoomGroups();renderLamps();
  try{
    const result=await action();
    $('groupsFeedback').textContent=result?.message||(result?.phase==='joined'||result?.phase==='already-member'?
      result.active?'Following coordinator.':'Group settings saved. Waiting for coordinator.':result?.phase==='left'?'Lamp left its group.':result?.phase==='created'?'Coordinator ready. Add lamps below.':'Group settings saved.');
    if(result?.phase==='stopped-coordinating'&&groupEditor?.id===id)closeGroupEditor();
    if(groupEditor)renderGroupScenes();
  }catch(error){$('groupsFeedback').textContent=error.leftPrevious?error.message:error.uncertain?'Change was not confirmed. Refresh this lamp before trying again.':error.message;}
  finally{groupActions.delete(id);renderRoomGroups();renderLamps();}
}
function groupLampRow(row,{follower=false}={}) {
  const item=document.createElement('div');item.className='room-group-lamp v2-member-row';item.dataset.groupLampId=row.id;item.dataset.state=row.available&&row.verified?'ready':row.state||'unknown';
  const entry=mergedLampEntries().find(value=>value.id===row.id)||{id:row.id,name:row.name};
  const art=lampStyleIllustration(resolvedStyle(entry).id);art.classList.add('v2-member-art');
  const copy=document.createElement('div');copy.className='v2-member-copy';const name=document.createElement('strong');name.textContent=row.name||'Lamp';
  const detail=document.createElement('small');detail.className='v2-member-status';
  detail.textContent=!row.available||!row.verified?(row.message||'Not reachable · Last known membership'):row.role===2?(row.sync?.paused?'Used separately · Group is kept':row.sync?.active?'Playing with this group':'Waiting for the main lamp'):row.role===1?'Keeps this group together':'Ready for your own light';
  copy.append(name,detail);
  if(entry.room){const room=document.createElement('small');room.className='v2-member-room';room.textContent=entry.room;copy.append(room);}
  if(row.available&&row.verified&&row.audio?.installed){const sound=document.createElement('small');sound.className='v2-sound-label';sound.textContent='Microphone fitted';copy.append(sound);}
  item.append(art,copy);const actions=document.createElement('div');actions.className='v2-member-actions';
  const usable=row.available&&row.verified&&!groupActions.has(row.id)&&!cardPowerTasks.has(row.id)&&!fleetLampInstalling(row.id)&&bluetoothFirmwareOwner()?.id!==row.id&&!row.sync?.membershipLocked;
  if(row.state==='needs-pairing'){const pair=document.createElement('button');pair.type='button';pair.className='secondary compact';pair.dataset.groupAction='pair';pair.textContent='Connect nearby';pair.onclick=()=>{page('lamps');status('Hold '+(row.name||'this lamp')+'’s knob until it flashes blue, then release and choose Add a lamp.');};actions.append(pair);}
  if(row.state==='needs-identity'){const verify=document.createElement('button');verify.type='button';verify.className='secondary compact';verify.dataset.groupAction='verify';verify.textContent='Verify this lamp';verify.onclick=()=>connect(store.items.find(entry=>entry.id===row.id));actions.append(verify);}
  if(row.role===2){
    const pause=document.createElement('button');pause.type='button';pause.className='secondary compact';pause.dataset.groupAction='participation';pause.textContent=row.sync?.paused?'Return to group':'Use separately';pause.disabled=!usable;pause.setAttribute('aria-label',pause.textContent+': '+(row.name||'Lamp'));pause.onclick=()=>roomGroupAction(row.id,()=>row.sync?.paused?roomGroups.resume(row.id):roomGroups.pause(row.id));actions.append(pause);
    const leave=document.createElement('button');leave.type='button';leave.className='text-button compact';leave.dataset.groupAction='leave';leave.textContent='Remove from group';leave.disabled=!usable;leave.setAttribute('aria-label','Remove '+(row.name||'lamp')+' from this group');
    leave.onclick=()=>roomGroupAction(row.id,async()=>{const result=await roomGroups.leave(row.id);return {...result,message:result.sourceCleanup?.pending?'This lamp is independent. Its previous group still needs a confirmed cleanup.':'This lamp is now independent.'};});actions.append(leave);
  }
  if(row.role===0){const lead=document.createElement('button');lead.type='button';lead.className='secondary compact';lead.dataset.groupAction='create';lead.textContent='Start a group';lead.disabled=!usable;lead.onclick=()=>roomGroupAction(row.id,()=>roomGroups.create(row.id));actions.append(lead);}
  if(row.role===0||follower){
    const destinations=groupsSnapshot.groups.filter(group=>group.id!==row.leader&&group.id!==row.id&&group.available&&group.leader.verified&&group.remaining>0&&!group.leader.sync?.membershipLocked);
    const controls=document.createElement('div');controls.className='room-group-destination v2-member-destination';
    const select=document.createElement('select');select.setAttribute('aria-label',(follower?'Move ':'Add ')+(row.name||'lamp')+' to a group');select.add(new Option(follower?'Move to another group':'Choose a group',''));
    for(const group of destinations)select.add(new Option((typeof appV2!=='undefined'?appV2?.groupName(group.id,group.name):null)||group.name,group.id));
    select.disabled=!usable||!destinations.length;const draft=groupDestinations.get(row.id);if(destinations.some(group=>group.id===draft))select.value=draft;else groupDestinations.delete(row.id);
    const move=document.createElement('button');move.type='button';move.className='secondary compact';move.dataset.groupAction='transfer';move.textContent=follower?'Move lamp':'Add to group';move.disabled=!usable||!select.value;
    select.onchange=()=>{groupDestinations.set(row.id,select.value);move.disabled=!usable||!select.value;};
    move.onclick=()=>{const destination=select.value;roomGroupAction(row.id,async()=>{const result=follower?await roomGroups.move(row.id,destination):await roomGroups.join(row.id,destination);return {...result,message:(result.active?'Playing with the selected group.':'Membership saved. Waiting for the main lamp.')+(result.sourceCleanup?.pending?' The previous group still needs a confirmed cleanup.':'')};});};
    controls.append(select,move);actions.append(controls);
  }
  item.append(actions);return item;
}
function renderRoomGroups() {
  if(!$('groupsList'))return;
  const active=document.activeElement,focusedId=active?.closest('[data-group-lamp-id]')?.dataset.groupLampId,focusedGroup=active?.closest('[data-group-id]')?.dataset.groupId;
  const focusedTag=active?.tagName,focusedText=active?.textContent,focusedAction=active?.dataset.groupAction,focusedConnection=active?.dataset.connection;
  const expanded=new Set([...$('groupsList').querySelectorAll('.v2-group-members[open]')].map(item=>item.closest('[data-group-id]')?.dataset.groupId));
  $('groupsList').replaceChildren();$('ungroupedLamps').replaceChildren();$('groupsUnavailableList').replaceChildren();
  for(const group of groupsSnapshot.groups){
    const name=(typeof appV2!=='undefined'?appV2?.groupName(group.id,group.name):null)||group.name||'Lamp group',rows=[group.leader,...group.followers];
    const total=Math.max(rows.length,group.leader.sync?.order?.length||0,(group.usedSlots||0)+1);
    const ready=group.available&&group.leader.verified,locked=group.leader.sync?.membershipLocked===true;
    const reachable=rows.filter(row=>row.available&&row.verified).length,paused=group.followers.filter(row=>row.available&&row.verified&&row.sync?.paused).length;
    const card=document.createElement('section');card.className='panel room-group v2-group-card';card.dataset.groupId=group.id;card.dataset.state=ready?'ready':'waiting';
    const heading=document.createElement('div');heading.className='section-title v2-group-heading';
    const title=document.createElement('div'),kicker=document.createElement('p'),label=document.createElement('h3');kicker.className='eyebrow';kicker.textContent='YOUR GROUP · '+total+' '+(total===1?'LAMP':'LAMPS');label.textContent=name;title.append(kicker,label);heading.append(title);
    const entry=mergedLampEntries().find(item=>item.id===group.id)||{id:group.id,name:group.leader.name||name};const power=cardPowerButton(entry);power.classList.add('v2-group-power');heading.append(power);card.append(heading);
    const illustrations=document.createElement('div');illustrations.className='v2-group-art';illustrations.setAttribute('aria-hidden','true');
    for(const row of rows.slice(0,3)){const member=mergedLampEntries().find(entry=>entry.id===row.id)||{id:row.id};illustrations.append(lampStyleIllustration(resolvedStyle(member).id));}card.append(illustrations);
    const detail=document.createElement('p');detail.className='v2-group-status';detail.textContent=locked?'The group is updating · Membership is protected':ready?reachable+' of '+total+' lamps reachable'+(paused?' · '+paused+' used separately':''):group.placeholder?'Waiting for the main lamp · Saved membership is kept':'Not reachable now · Last known group';card.append(detail);
    const sync=group.leader.sync,scene=Number.isInteger(sync?.scene)?sync.scene:null;
    const live=groupEditor?.id===group.id&&groupEditor.lamp?.epoch===groupEditor.epoch&&groupEditor.lamp?.identity===group.id?groupEditor.lamp:verifiedSelectedLamp()&&selected.id===group.id?lamp:null;
    const light=connectivity?.get(group.id).lighting,raw=live?.raw?.deviceId===group.id&&live.raw.sync?.role===1?live.raw:null;
    const effectName=scene>0?availableGroupScenes(sync).find(entry=>entry.id===scene)?.name:raw?live.catalog?.find(entry=>entry.id===raw.mode)?.name:light?.name;
    const summary=document.createElement('div');summary.className='v2-group-summary';const mode=document.createElement('strong'),effect=document.createElement('span'),brightness=document.createElement('small');
    mode.textContent=scene===0?'Together':scene>0?'Across the room':'Shared light';effect.textContent=effectName||'Open controls to see the current effect';
    brightness.textContent=raw&&Number.isInteger(raw.brightness)&&raw.brightness>=1&&raw.brightness<=255?'Group brightness · '+Math.round(raw.brightness*100/255)+'%':'Group power, brightness & effects';summary.append(mode,effect,brightness);card.append(summary);
    const controls=document.createElement('button');controls.type='button';controls.className='primary v2-group-controls';controls.dataset.groupAction='controls';controls.textContent='Control '+name;controls.disabled=!ready||groupActions.has(group.id)||cardPowerTasks.has(group.id)||fleetLampInstalling(group.id)||bluetoothFirmwareOwner()?.id===group.id;controls.onclick=()=>openGroupEditor(group.id);card.append(controls);
    const sound=document.createElement('small');sound.className='v2-sound-label';sound.textContent=ready?group.leader.audio?.installed?'Sound listens at '+(group.leader.name||'the main lamp'):'Choose light effects · The main lamp has no microphone':'Sound source will be checked on reconnect';card.append(sound);
    const members=document.createElement('details');members.className='v2-group-members';members.open=expanded.has(group.id);const memberSummary=document.createElement('summary');memberSummary.textContent='Lamps in this group · '+total;members.append(memberSummary);
    const main=document.createElement('div');main.className='v2-group-main-lamp';const mainName=document.createElement('strong'),mainHint=document.createElement('small');mainName.textContent=group.leader.name||'Main lamp';mainHint.textContent='Keeps this group in time';main.append(mainName,mainHint);members.append(main);
    const list=document.createElement('div');list.className='group-lamp-list v2-group-member-list';for(const row of group.followers)list.append(groupLampRow(row,{follower:true}));
    if(!group.followers.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Add another lamp below to bring this group to life.';list.append(empty);}members.append(list);
    const capacity=document.createElement('p');capacity.className='hint v2-group-capacity';capacity.textContent=ready?group.remaining+' '+(group.remaining===1?'place':'places')+' available · '+(group.capacity+1)+' lamps supported by this group':'Capacity will be checked when the main lamp returns';members.append(capacity);
    if(group.removalPending){const pending=document.createElement('p');pending.className='inline-notice v2-group-removal-pending';pending.textContent=group.removalNeedsReconfirmation?'This group changed since removal began. Review its current lamps before continuing.':group.pendingRemovalIds.length?group.pendingRemovalIds.length+' '+(group.pendingRemovalIds.length===1?'lamp still needs':'lamps still need')+' confirmed departure.'+(group.dissolutionPending?' The main lamp is kept until every departure is confirmed.':' Remaining group members stay together.'):'The group removal still needs its final confirmation.';members.append(pending);members.open=true;}
    const reconfirmRemoval=group.dissolutionPending&&group.removalNeedsReconfirmation&&ready&&/^[0-9a-f]{32}$/.test(sync?.incarnation||'');
    const remove=document.createElement('button');remove.type='button';remove.className='text-button compact v2-group-remove';remove.dataset.groupAction='remove';const fullRemoval=sync?.dissolutionV1===true;remove.textContent=reconfirmRemoval?'Review current group removal':group.removalPending?'Confirm pending removals':fullRemoval?'Remove group':'Stop sharing from the main lamp';
    const removalReady=group.removalPending?store.items.some(item=>item.id===group.id):ready;
    remove.disabled=!removalReady||locked||groupActions.has(group.id)||cardPowerTasks.has(group.id)||fleetLampInstalling(group.id)||bluetoothFirmwareOwner()?.id===group.id;
    remove.onclick=()=>{const currentNames=rows.map(row=>row.name||row.id).join(', ');const message=reconfirmRemoval?'This group changed. Remove '+name+' and its current lamps ('+currentNames+')? Previously unconfirmed lamps will stay pending.':group.removalPending?'Check the saved removals for '+name+'? Unconfirmed lamps will remain pending.':fullRemoval?'Remove '+name+'? Each lamp will return to its own light. Every lamp stays in your home. Unreachable departures will remain pending.':'Stop sharing '+name+'? Followers keep their saved membership. Move or release them separately.';if(!confirm(message))return;roomGroupAction(group.id,async()=>{const result=reconfirmRemoval?await roomGroups.dissolve(group.id,{reconfirm:true,expectedIncarnation:sync.incarnation}):group.removalPending?await roomGroups.reconcileRemovals(group.id):fullRemoval?await roomGroups.dissolve(group.id):await roomGroups.stopCoordinating(group.id);if(result.phase==='dissolution-pending'||result.phase==='removal-pending')return {...result,message:result.pending.length?result.pending.length+' lamps still need confirmed removal.':'The final group removal is still awaiting confirmation.'};if(result.coordinatorStopped||result.phase==='dissolved'){if(groupEditor?.id===group.id)await closeGroupEditor();return {...result,message:name+' removed. Its lamps are ready individually.'};}if(result.phase==='removal-reconciled')return {...result,message:'The saved departures are confirmed. Remaining group members stay together.'};return {...result,message:'The main lamp is independent. Former followers keep their saved membership.'};});};members.append(remove);card.append(members);$('groupsList').append(card);
  }
  for(const row of groupsSnapshot.ungrouped)$('ungroupedLamps').append(groupLampRow(row));
  const legacy=store.items.filter(entry=>entry.deviceId&&!/^[0-9a-f]{12}$/.test(entry.id)).map(entry=>({...entry,verified:false,available:false,role:null,state:'needs-identity',message:'Connect nearby once to verify this lamp before arranging groups.'}));
  const unavailable=[...groupsSnapshot.unavailable,...legacy];for(const row of unavailable)$('groupsUnavailableList').append(groupLampRow(row));
  $('ungroupedEmpty').hidden=groupsSnapshot.ungrouped.length>0;$('groupsUnavailable').hidden=!unavailable.length;$('groupsUnavailableCount').textContent=unavailable.length;
  $('refreshAllGroups').disabled=Boolean(roomGroupsRun)||groupsSnapshot.scanning;$('refreshAllGroups').textContent=roomGroupsRun||groupsSnapshot.scanning?'Finding your groups…':'Refresh groups';
  $('groupsInventoryStatus').textContent=groupsSnapshot.scanning?'Checking your lamps. You can keep using the app.':groupsSnapshot.groups.length?groupsSnapshot.groups.length+' '+(groupsSnapshot.groups.length===1?'group':'groups')+' · '+groupsSnapshot.ungrouped.length+' independent lamps':'Your lamps can work individually. Start a group from a lamp below whenever you want shared light.';
  if(focusedId){const row=$('page-groups').querySelector('[data-group-lamp-id="'+focusedId+'"]');const control=focusedTag==='SELECT'?row?.querySelector('select'):focusedAction?row?.querySelector('[data-group-action="'+focusedAction+'"]'):[...row?.querySelectorAll('button')||[]].find(button=>button.textContent===focusedText);if(control&&!control.disabled){const details=control.closest('details');if(details)details.open=true;control.focus({preventScroll:true});}}
  else if(focusedGroup){const card=$('groupsList').querySelector('[data-group-id="'+focusedGroup+'"]');const control=focusedConnection?card?.querySelector('[data-connection="'+focusedConnection+'"]'):focusedAction?card?.querySelector('[data-group-action="'+focusedAction+'"]'):null;if(control&&!control.disabled){const details=control.closest('details');if(details)details.open=true;control.focus({preventScroll:true});}}
  if(pendingGroupFocus){const target=$('groupsList').querySelector('[data-group-lamp-id="'+pendingGroupFocus.id+'"]');const details=target?.closest('details');if(details)details.open=true;}
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
  const editor=groupEditor;if(!editor||editor.busy)return;if(cardPowerTasks.has(editor.id)){$('globalGroupEditorStatus').textContent='Wait for this group’s power request to finish.';return;}editor.busy=true;groupEditorMutations.add(editor.id);$('globalGroupEditorStatus').textContent='Updating this group…';renderGroupScenes();renderLamps();
  try{
    const guard=()=>{if(groupEditor!==editor||editor.lamp.epoch!==editor.epoch||editor.lamp.identity!==editor.id)throw Error('The group changed. Open its effects again.');};
    const queued=await editor.lamp.enqueue(async()=>{guard();await editor.lamp.refresh(editor.id);guard();if(editor.lamp.raw.sync?.role!==1)throw Error('This lamp is no longer a coordinator.');return outsideQueue?null:action(editor.lamp);});
    guard();const result=outsideQueue?await action(editor.lamp):queued;
    guard();$('groupSceneFeedback').textContent=result||'Group updated.';$('globalGroupEditorStatus').textContent='Changes applied to this group.';refreshRoomGroups();
  }catch(error){if(groupEditor===editor){$('groupSceneFeedback').textContent=error.message;$('globalGroupEditorStatus').textContent=error.uncertain?'Change was not confirmed. Refresh this group before trying again.':error.message;}}
  finally{editor.busy=false;groupEditorMutations.delete(editor.id);renderGroupScenes();renderLamps();}
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
  if(![1,2,3].includes(target.sync?.version))return 'Update this lamp’s firmware to use lamp groups.';
  if(target.sync.role!==0)return 'Leave this lamp’s current group before joining a different coordinator.';
  if(groupJoinForCurrent())return 'Joining this lamp. You can keep using other pages and lamps.';
  if(cardPowerTasks.has(target.id))return 'Wait for this lamp’s power request to finish before joining a group.';
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
  const ready=[2,3].includes(sync?.version) && sync.role>0,controller=ready&&sync.role===1;
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
  if(busy||connecting||!advancedAvailable()||groupJoinForCurrent()||cardPowerTasks.has(selected?.id))return;
  const mutationId=selected.id;groupEditorMutations.add(mutationId);
  groupJoinResult=null;$('syncFeedback').textContent='';
  busy=true;renderSync();renderLamps();
  try {const result=await lamp.enqueue(action);$('syncFeedback').textContent=result||'Group updated.';$('groupSceneFeedback').textContent=result||'Group updated.';}
  catch(e){if(e.uncertain)await lamp.disconnect();$('syncFeedback').textContent=e.message;$('groupSceneFeedback').textContent=e.message;}
  finally{busy=false;groupEditorMutations.delete(mutationId);renderOptions();renderLamps();}
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
appV2=mountAppV2({
 model:()=>({lamps:mergedLampEntries(),statuses:Object.fromEntries(mergedLampEntries().map(entry=>[entry.id,connectivity?.get(entry.id)])),groups:groupsSnapshot.groups,available:groupsSnapshot.lamps,selected,connecting,connected:verifiedSelectedLamp(),state}),
 message:status,navigate:(name,section)=>{if(section)settingsView=section;page(name);},
 pair:()=>connect(null,{navigate:false}),discover:()=>discover(true),refreshGroups:refreshRoomGroups,
 findNewLamps:refreshNewMeshLamps,openGroup:openGroupEditor,
 power:async(id)=>{const entry=mergedLampEntries().find(row=>row.id===id);if(!entry)throw Error('This lamp is no longer available.');return changeCardPower(entry);},
 select:async(id,section,options={})=>{const entry=mergedLampEntries().find(row=>row.id===id);if(!entry)throw Error('This lamp is no longer in your inventory.');if(busy||connecting||fleetLampInstalling(id))throw Error('This lamp is finishing another task. Please try again in a moment.');return openCardSettings(entry,{section,signal:options.signal,isCurrent:options.isCurrent,navigate:false,preferWifi:section==='hardware'&&!advancedAvailable()});},
 setupDetails:async({id,name,style,room})=>{
  if(!verifiedSelectedLamp()||selected.id!==id||busy||updatingLamp())throw Error('Reconnect to the lamp you are setting up.');
  if(new TextEncoder().encode(name).length>48)throw Error('Use a shorter lamp name.');
  const target=lamp,epoch=target.epoch;const guard=()=>{if(lamp!==target||target.epoch!==epoch||selected?.id!==id||!verifiedSelectedLamp())throw Error('The setup lamp changed. Reconnect before saving.');};busy=true;
  try{if(advancedAvailable()&&target.raw.apiVersion)await target.enqueue(async()=>{guard();await target.request('/api/name',{name},epoch,guard);guard();});
   if(styleDefinition(style)&&target.raw?.lampStyle)await target.enqueue(async()=>{guard();await target.configureLampStyle(style);guard();});
   else if(styleDefinition(style))store.setLampStyle(id,style,{source:'phone'});
   guard();selected=store.upsert({...selected,name,room});$('lampName').value=name;$('room').value=room||'';$('lampTitle').textContent=name;renderLamps();
  }finally{busy=false;renderSettings();}
 },
 setAutomatic:async(value,id)=>{if(!verifiedSelectedLamp()||selected.id!==id||busy||updatingLamp())throw Error('Reconnect to your setup lamp to save this preference.');const target=lamp,epoch=target.epoch,guard=()=>{if(target!==lamp||target.epoch!==epoch||selected?.id!==id||!verifiedSelectedLamp())throw Error('The setup connection changed. Check the update preference on this lamp.');};busy=true;try{await target.command('autoUpdate',Number(value),null,guard);guard();}finally{busy=false;renderFirmware();}},
 createGroup:async(ids)=>{await refreshRoomGroups();const plan=groupCreationPlan(ids.map(id=>groupsSnapshot.lamps.find(row=>row.id===id))),leader=plan.leader;
  await roomGroups.create(leader.id,{protocol:plan.protocol});for(const follower of plan.followers){try{await roomGroups.join(follower.id,leader.id);}catch(error){throw Object.assign(Error('The main lamp is ready, but '+follower.name+' has not confirmed joining. Open the group to finish setup.'),{uncertain:error.uncertain});}}
  await refreshRoomGroups();return {id:leader.id};
 }
});
$('page-lamps').append($('v2CarePanel'));
$('addLamp').querySelector('summary').textContent='Advanced connection & recovery';
settingsRecovery=new SettingsConnectionRecovery({
 getContext:()=>{const owned=wifiSettingsTarget?.automaticReconnect===true&&settingsRecovery?.active;
  return {id:selected?.id,name:selected?.name,section:settingsView,navigation:navigationSerial,
   active:!$('page-settings').hidden&&Boolean(selected)&&mergedLampEntries().some(entry=>entry.id===selected.id),connected:verifiedSelectedLamp(),
   blocked:firmwareConnectionBusy()||Date.now()<settingsRestartWaitUntil||Boolean(styleSaving)||!owned&&Boolean(busy||connecting||meshSelection||wifiSettingsTarget),hidden:document.hidden};},
 reconnect:async context=>{const entry=mergedLampEntries().find(value=>value.id===context.id);if(!entry)throw Error('This lamp was removed from the phone.');
  try{const result=await openCardSettings(entry,{section:context.section,automaticReconnect:true,signal:context.signal,isCurrent:context.isCurrent});
   if(!result?.connected)throw result?.error||Error('This lamp is out of reach.');return result;
  }finally{if(wifiSettingsTarget?.automaticReconnect&&wifiSettingsTarget.id===context.id&&wifiSettingsTarget.navigation===context.navigation)wifiSettingsTarget=null;}},
 onStatus:value=>{if(value.state==='idle'&&!settingsRecovery.active&&wifiSettingsTarget?.automaticReconnect&&wifiSettingsTarget.id===value.id){wifiSettingsTarget=null;cancelMeshSelection();}
  renderSettingsConnection();if(value.state==='connected'&&selected?.id===value.id&&!$('page-settings').hidden){
  $('reconnect').hidden=true;renderSettings();renderOptions();renderFirmware();
  const unconfirmed=settingsUnconfirmedIds.has(value.id)||app2Pending.has(value.id);settingsUnconfirmedIds.delete(value.id);
  status('Reconnected to '+value.name+'.'+(unconfirmed?' Check its current settings; the earlier change was not confirmed.':''));}},
 onFailure:value=>{if(selected?.id!==value.id||navigationSerial!==value.navigation||$('page-settings').hidden)return;
  if(wifiSettingsTarget?.automaticReconnect)wifiSettingsTarget=null;cancelMeshSelection();page('lamps');
  status('We couldn’t reconnect to '+value.name+'. Keep it powered on and nearby, then tap its card to try again.');}
});
setInterval(()=>settingsRecovery.check(),1000);
document.addEventListener('visibilitychange',()=>{settingsRecovery.check();if(!document.hidden)renderSettings();});
page('home');
setInterval(()=>{if(!document.hidden&&!busy&&!connecting&&!updatingLamp())void loadApp2EffectSchema().catch(()=>{});},3000);
renderPower();renderSettings();renderFirmware();
meshOnboarding=new MeshOnboarding({getBridges:()=>mergedLampEntries().filter(entry=>/^[a-f0-9]{12}$/.test(entry.id)&&(entry.deviceId||entry.meshEnrolled)&&!groupRemovedIds.has(entry.id)&&!fleetLampInstalling(entry.id)&&validFirmwareVersion(entry.firmwareVersion)&&compareFirmwareVersions(entry.firmwareVersion,'1.13.0')>=0),
 acquireBridge:acquireOnboardingBridge,onCandidates:rows=>{newMeshCandidates=rows;renderNewMeshLamps();},onStatus:meshSetupStatus});
refreshNewMeshLamps();

// Keep focused controls above the persistent navigation, including after Tab.
document.addEventListener('focusin',event=>{
  if(!event.target.matches('button,input,select,textarea,summary')||event.target.closest('nav'))return;
  requestAnimationFrame(()=>{
    const rect=event.target.getBoundingClientRect(),navTop=document.querySelector('nav').getBoundingClientRect().top;
    const limit=$('toast').hidden?navTop:Math.min(navTop,$('toast').getBoundingClientRect().top);
    if(rect.bottom>limit-14)window.scrollBy({top:rect.bottom-limit+24,behavior:'instant'});
  });
});
