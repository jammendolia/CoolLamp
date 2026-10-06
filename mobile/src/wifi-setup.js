export const WIFI_SETUP = '7b610008-6e2b-4f3d-9a71-28e45c001001';
export const WIFI_SETUP_CAPABILITY = 64;
const operations = {wifiControl:14,wifiNetwork:15,wifiBegin:16,wifiChunk:17,wifiCommit:18};
export function encodeWifiSetup(id, operation, value) {
  if(!Number.isInteger(id)||id<1||id>255)throw Error('Invalid Wi-Fi setup command.');
  const op=operations[operation];let data;
  if(op===16) {
    if(!value||![value.ssidLength,value.passwordLength,value.open].every(Number.isInteger)||
      value.ssidLength<1||value.ssidLength>32||![0,1].includes(value.open)||
      (value.open?value.passwordLength!==0:value.passwordLength<8||value.passwordLength>63))throw Error('Invalid Wi-Fi credentials.');
    data=[value.ssidLength,value.passwordLength,value.open];
  } else if(op===17) {
    if(!value||!Number.isInteger(value.offset)||value.offset<0||value.offset>=95||
      !(value.bytes instanceof Uint8Array)||value.bytes.length<1||value.bytes.length>16||value.bytes.includes(0))throw Error('Invalid Wi-Fi credential fragment.');
    data=[value.offset,...value.bytes];
  } else {
    if(!op||!Number.isInteger(value)||(op===14?value<0||value>2:op===15?value<0||value>15:value!==0))throw Error('Invalid Wi-Fi setup command.');
    data=[value];
  }
  return new DataView(Uint8Array.from([1,id,op,...data]).buffer);
}
export function wifiCredentials(ssid, password, open=false) {
  if(typeof ssid!=='string'||typeof password!=='string'||typeof open!=='boolean'||ssid.includes('\0')||password.includes('\0'))throw Error('Enter a valid network name and password.');
  const name=new TextEncoder().encode(ssid),key=new TextEncoder().encode(password);
  if(name.length<1||name.length>32)throw Error('Network names must use 1–32 UTF-8 bytes.');
  if(open?key.length!==0:key.length<8||key.length>63)throw Error(open?'Leave the password empty for a password-free network.':'Wi-Fi passwords must use 8–63 UTF-8 bytes.');
  const bytes=new Uint8Array(name.length+key.length);bytes.set(name);bytes.set(key,name.length);key.fill(0);
  return {bytes,ssidLength:name.length,passwordLength:bytes.length-name.length,open:Number(open)};
}
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
export function decodeWifiSetup(data, expectedId) {
  if(!data||data.version!==1||!integer(data.scanId,0,65535)||
     typeof data.ssid!=='string'||new TextEncoder().encode(data.ssid).length>32||data.ssid.includes('\0'))throw Error('Invalid Wi-Fi setup response.');
  if('index' in data) {
    if(!integer(data.index,0,15)||!integer(data.rssi,-128,0)||typeof data.open!=='boolean'||!data.ssid)throw Error('Invalid Wi-Fi network response.');
  } else if(!integer(data.phase,0,5)||!integer(data.error,0,3)||!integer(data.count,0,16)||
    typeof data.connected!=='boolean'||typeof data.usingDefaultPassword!=='boolean'||
    typeof data.address!=='string'||typeof data.hostname!=='string'||!/^coollamp-[a-z0-9-]+\.local$/.test(data.hostname)||
    !/^[0-9a-f]{12}$/.test(data.deviceId)||expectedId&&data.deviceId!==expectedId)throw Error('Invalid Wi-Fi setup status or lamp identity.');
  return data;
}
export function wifiSetupMessage(s) {
  if(s?.phase===1)return 'Finding nearby 2.4 GHz Wi-Fi networks…';
  if(s?.phase===3)return 'Connecting the lamp to Wi-Fi…';
  if(s?.phase===4&&s.connected)return 'Connected to '+s.ssid+'. Wi-Fi settings saved.';
  if(s?.phase===5)return ['','Wi-Fi scan failed. Try again.','Could not join that network. Check the password, signal, and 2.4 GHz support, then retry.','The lamp connected but could not save Wi-Fi settings. Please retry.'][s.error]||'Wi-Fi setup failed. Try again.';
  if(s?.phase===2)return s.count?'Choose a network below.':'No nearby networks found. Try again or enter a hidden network name.';
  return s?.connected?'Currently connected to '+s.ssid+'.':'Choose your home Wi-Fi. Your phone stays connected over Bluetooth.';
}
