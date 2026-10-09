export const SERVICE = '7b610001-6e2b-4f3d-9a71-28e45c001001';
export const COMMAND = '7b610002-6e2b-4f3d-9a71-28e45c001001';
export const STATE = '7b610003-6e2b-4f3d-9a71-28e45c001001';
export const FIRMWARE = '7b610004-6e2b-4f3d-9a71-28e45c001001';
export const EFFECT_OPTIONS = '7b610005-6e2b-4f3d-9a71-28e45c001001';
export const CONTROL = '7b61000a-6e2b-4f3d-9a71-28e45c001001';
export const CONTROL_ENDPOINTS = Object.freeze({state:1,sync:2,invite:3,group:4,scene:5,order:6,
 config:7,audio:8,audioTuning:9,rotation:10,geometry:11,calibration:12,name:13,identify:14,
 vuColors:15,fountainColors:16,audioTest:17,firmware:18,firmwareCheck:19,firmwareInstall:20,
 firmwareAutomatic:21,factoryReset:22,bluetooth:24,style:25,effects:26,firmwareFleet:27,
 meshStatus:28,meshRequest:29,meshResult:30,power:31,preview:32,defaults:33,color:34,effectOptions:35,
 meshNew:36,meshEnrollStart:37,meshEnrollStatus:38,meshEnrollCancel:39});
export const effects = ['Pacifica','Aurora','Rain','Fire','Split fire - rising','Split fire - falling',
  'Split fire - rising, reversed colors','Blue gas fire','Witch fire','Purple fire','Embers','Lava','Plasma',
  'Rainbow','Rainbow with glitter','Confetti','Comet collision','Sinelon','BPM','Juggle',
  'White','Red','Green','Blue','Purple','Pink','Yellow','Cyan','Custom solid',
  'Bouncing droplets - rising','Lightning storm','Color tide','Fireflies','Heartbeat','Shooting stars','Breathing glow','Lava blobs','Bouncing droplets - falling'];
const operations = { power: 1, brightness: 2, effect: 3, saveDefaults: 4, refresh: 5, color: 6, resetColor: 7, checkFirmware: 8, installFirmware: 9, autoUpdate: 10, effectOptions: 11, enableEffects: 12, catalogEntry: 13, factoryReset:19,centerControl:20,centerMove:21 };
export function encodeCommand(id, operation, value = 0, effectCount = effects.length) {
  if(operation.startsWith('control'))return encodeControlCommand(id,operation,value);
  if(operation.startsWith('wifi'))return encodeWifiSetup(id,operation,value);
  const op = operations[operation];
  if(operation==='centerMove') {
    if(!Number.isInteger(id)||id<1||id>255||!Number.isInteger(value)||value<1||value>1023)throw Error('Choose a valid center boundary.');
    return new DataView(Uint8Array.of(1,id,op,value&255,value>>8).buffer);
  }
  if (operation === 'effectOptions') {
    const v = value;
    if (!Number.isInteger(id) || id < 1 || id > 255 || !v ||
        ![v.mode,v.speed,v.intensity,v.dual,v.r,v.g,v.b].every(Number.isInteger) ||
        v.mode < 1 || v.mode > effectCount || v.speed < 1 || v.speed > 100 ||
        v.intensity < 0 || v.intensity > 100 || v.dual < 0 || v.dual > 1 ||
        [v.r,v.g,v.b].some(n => n < 0 || n > 255)) throw new Error('Invalid effect options.');
    return new DataView(Uint8Array.of(1,id,op,v.mode,v.speed,v.intensity,v.dual,v.r,v.g,v.b).buffer);
  }
  if (operation === 'color') {
    if (!Number.isInteger(id) || id < 1 || id > 255 || !value ||
        !Number.isInteger(value.mode) || value.mode < 1 || value.mode > effectCount ||
        ![value.r, value.g, value.b].every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error('Invalid RGB color.');
    return new DataView(Uint8Array.of(1, id, op, value.mode, value.r, value.g, value.b).buffer);
  }
  if (!Number.isInteger(id) || id < 1 || id > 255 || !op || !Number.isInteger(value)) throw new Error('Invalid command.');
  const valid = op === 1 || op === 10 ? value >= 0 && value <= 1 : op === 2 ? value >= 1 && value <= 255 :
    op === 3 || op === 7 || op === 13 ? value >= 1 && value <= effectCount : op === 12 ? (value >= 1 && value <= 3) : op===19?value===0xa5:op===20?value>=0&&value<=3:value === 0;
  if (!valid) throw new Error('Value is outside the lamp’s supported range.');
  return new DataView(Uint8Array.of(1, id, op, value).buffer);
}
export function encodeControlCommand(id,operation,value) {
  const integer=(number,min,max)=>Number.isInteger(number)&&number>=min&&number<=max;
  if(!integer(id,1,255)||!value||!integer(value.tx,0,65535))throw Error('Invalid Bluetooth control transaction.');
  const tx=[value.tx&255,value.tx>>8];let bytes;
  if(operation==='controlBegin'){
    const cancel=value.endpoint===0&&value.method===0&&value.length===0;
    if(!cancel&&(!value.tx||!integer(value.endpoint,1,39)||![1,2].includes(value.method)||!integer(value.length,0,1024)))throw Error('Invalid Bluetooth control request.');
    bytes=[1,id,22,...tx,value.endpoint,value.method,value.length&255,value.length>>8];
  }else if(operation==='controlChunk'){
    if(!value.tx||!integer(value.offset,0,1023)||!(value.bytes instanceof Uint8Array)||value.bytes.length<1||value.bytes.length>13||value.offset+value.bytes.length>1024)throw Error('Invalid Bluetooth control chunk.');
    bytes=[1,id,23,...tx,value.offset&255,value.offset>>8,...value.bytes];
  }else if(operation==='controlCommit'){
    if(!value.tx)throw Error('Invalid Bluetooth control transaction.');bytes=[1,id,24,...tx];
  }else if(operation==='controlPage'){
    if(!value.tx||!integer(value.offset,0,8192))throw Error('Invalid Bluetooth control page.');
    bytes=[1,id,25,...tx,value.offset&255,value.offset>>8];
  }else throw Error('Invalid Bluetooth control operation.');
  return new DataView(Uint8Array.from(bytes).buffer);
}
export function decodeControlPage(data,expected={}) {
  if(!(data instanceof DataView)||data.byteLength<12||data.getUint8(0)!==1)throw Error('Invalid Bluetooth control response.');
  const page={tx:data.getUint16(1,true),endpoint:data.getUint8(3),status:data.getUint16(4,true),
    total:data.getUint16(6,true),offset:data.getUint16(8,true),length:data.getUint16(10,true)};
  if(page.endpoint>39||page.status<100||page.status>599||page.total>8192||page.length>480||
     page.offset+page.length>page.total||data.byteLength!==12+page.length||
     Object.entries(expected).some(([key,value])=>page[key]!==value))throw Error('Invalid Bluetooth control response.');
  page.bytes=new Uint8Array(data.buffer,data.byteOffset+12,page.length).slice();return page;
}
export function decodeControlCapabilities(data) {
  const page=decodeControlPage(data,{tx:0,endpoint:0,status:200,offset:0});
  if(page.length!==page.total)throw Error('Invalid Bluetooth control capabilities.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(page.bytes));}catch{throw Error('Invalid Bluetooth control capabilities.');}
  if(value?.version!==1||!Array.isArray(value.capabilities)||!value.capabilities.includes('control')||
    value.maxRequest!==1024||value.maxResponse!==8192||value.pageBytes!==480||
    typeof value.firmware!=='string'||!/^\d+\.\d+\.\d+$/.test(value.firmware))throw Error('Invalid Bluetooth control capabilities.');
  return value;
}
export function decodeState(data) {
  if (!(data instanceof DataView) || ![12,16].includes(data.byteLength)) throw Object.assign(
    new Error('Invalid response from lamp'+(data instanceof DataView?' ('+data.byteLength+' bytes; expected 12 or 16).':'.')),
    {code:'INVALID_STATE_PACKET'});
  if (data.getUint8(0) !== 1) throw new Error('This lamp needs a different app version.');
  const state = { id: data.getUint8(1), result: data.getUint8(2), mode: data.getUint8(3),
    brightness: data.getUint8(4), power: data.getUint8(5) === 1, effectCount: data.getUint8(6),
    capabilities: data.getUint8(7), revision: data.getUint32(8, true) };
  if (data.getUint8(5) > 1 || state.mode < 1 || state.mode > state.effectCount || state.brightness < 1 || (state.effectCount < 1 || (!(state.capabilities & 32) && ![28,29,37,38].includes(state.effectCount)))) {
    throw new Error('Unsupported lamp state.');
  }
  state.supportsColor = Boolean(state.capabilities & 2);
  if (state.supportsColor) {
    if (data.byteLength !== 16 || data.getUint8(12) > 1) throw new Error('Invalid color response.');
    state.color = { enabled: Boolean(data.getUint8(12)), r: data.getUint8(13), g: data.getUint8(14), b: data.getUint8(15) };
  }
  return state;
}
export function decodeEffectOptions(data, effectCount = effects.length) {
  if (!(data instanceof DataView) || data.byteLength !== 8 || data.getUint8(0) !== 1) throw new Error('Invalid effect options.');
  const [mode,speed,intensity,dual,r,g,b] = Array.from({length:7}, (_,i)=>data.getUint8(i+1));
  const value = {mode,speed,intensity,dual,r,g,b};
  encodeCommand(1,'effectOptions',value,effectCount);
  return value;
}
export function resultError(result) {
  return ['', 'App and lamp protocol do not match.', 'The lamp rejected that value.',
    'Updater busy, starting, or no update is available. Try again shortly.', 'The lamp could not save settings.'][result] || 'The lamp rejected the command.';
}

export function decodeFirmware(data) {
  if (!(data instanceof DataView) || data.byteLength !== 20 || data.getUint8(0) !== 1 ||
      data.getUint8(1) > 5 || data.getUint8(2) > 1 || data.getUint8(3) > 1 ||
      data.getUint8(4) > 100 || data.getUint8(5) > 8 || data.getUint8(18) > 1) throw new Error('Invalid firmware status.');
  const version = offset => [0,2,4].map(n=>data.getUint16(offset+n,true)).join('.');
  return {version:version(6),latest:version(12),phase:data.getUint8(1),automatic:Boolean(data.getUint8(2)),
    wifi:Boolean(data.getUint8(3)),progress:data.getUint8(4),error:data.getUint8(5),available:Boolean(data.getUint8(18))};
}
export function firmwareMessage(s) {
  if (!s) return 'Install the updater firmware once using the lamp’s Wi-Fi page to enable version reporting and online updates.';
  if (s.phase === 3) return `Installing firmware… ${s.progress}%`;
  if (s.phase === 4) return 'Update verified. Lamp restarting; reconnect shortly.';
  if (!s.wifi) return 'Connect the lamp to home Wi-Fi with internet access to check and download updates.';
  if (s.phase === 1) return 'Checking for firmware updates…';
  if (s.phase === 5) return ['','Lamp is offline.','Waiting for internet time. Try again shortly.','Could not reach the release server. Try again later.',
    'Release information was invalid.','This update needs a USB partition upgrade.','Firmware verification or download failed. You can retry manually.',
    'Could not save update settings.','Not enough memory to start the updater.'][s.error] || 'Update failed. Try again later.';
  if (s.available) return `Firmware ${s.latest} is available.`;
  return s.latest === '0.0.0' ? 'No published update detected yet. Use Check for updates to refresh.' : 'Firmware is up to date.';
}
import { encodeWifiSetup } from './wifi-setup.js';
