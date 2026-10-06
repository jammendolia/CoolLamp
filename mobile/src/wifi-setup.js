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
  if(data&&'join' in data) {
    if(!Array.isArray(data.join)||data.join.length!==4||!integer(data.join[0],0,3)||
      !integer(data.join[1],0,65535)||!integer(data.join[2],0,1)||!integer(data.join[3],0,1))throw Error('Invalid Wi-Fi join diagnostics.');
    data={...data,lastJoinError:data.join[0],wifiReason:data.join[1],associated:Boolean(data.join[2]),gotIp:Boolean(data.join[3])};
  }
  if(!data||data.version!==1||!integer(data.scanId,0,65535)||
     typeof data.ssid!=='string'||new TextEncoder().encode(data.ssid).length>32||data.ssid.includes('\0'))throw Error('Invalid Wi-Fi setup response.');
  if('index' in data) {
    if(!integer(data.index,0,15)||!integer(data.rssi,-128,0)||typeof data.open!=='boolean'||!data.ssid)throw Error('Invalid Wi-Fi network response.');
  } else if(!integer(data.phase,0,5)||!integer(data.error,0,3)||!integer(data.count,0,16)||
    typeof data.connected!=='boolean'||typeof data.usingDefaultPassword!=='boolean'||
    typeof data.address!=='string'||typeof data.hostname!=='string'||!/^coollamp-[a-z0-9-]+\.local$/.test(data.hostname)||
    !/^[0-9a-f]{12}$/.test(data.deviceId)||expectedId&&data.deviceId!==expectedId)throw Error('Invalid Wi-Fi setup status or lamp identity.');
  if('wifiReason' in data&&!integer(data.wifiReason,0,65535)||
     'lastJoinError' in data&&!integer(data.lastJoinError,0,3)||
     'associated' in data&&typeof data.associated!=='boolean'||
     'gotIp' in data&&typeof data.gotIp!=='boolean')throw Error('Invalid Wi-Fi join diagnostics.');
  return data;
}
function wifiJoinFailure(s) {
  const reason=s.wifiReason;
  if([210,211].includes(reason))return 'The lamp could not find that network with compatible security (Wi-Fi reason '+reason+'). Check the router’s personal WPA2/WPA3 settings.';
  if(reason===201)return 'The lamp could not find that network while joining (Wi-Fi reason 201). Check its signal and 2.4 GHz availability.';
  if(reason===212)return 'The network’s signal was below the connection threshold (Wi-Fi reason 212). Try moving the lamp closer to the router.';
  if(reason===2)return 'The router did not finish the initial Wi-Fi authentication exchange (reason 2). Retry with the lamp closer to the router. This timeout does not confirm an incorrect password.';
  if([6,15,16,23,202,204].includes(reason))return 'Wi-Fi authentication did not complete (Wi-Fi reason '+reason+'). Verify the password and the router’s security settings.';
  if(s.associated&&!s.gotIp)return 'The lamp joined the router, but did not receive an IP address. Check the router’s DHCP settings or device limit.';
  if(reason)return 'The lamp could not finish joining Wi-Fi (reason '+reason+'). Check the router and signal, then retry.';
  return 'Wi-Fi joining timed out. The lamp did not report a specific failure reason. Check the router, signal and network settings, then retry.';
}
export function wifiSetupMessage(s) {
  if(s?.phase===1)return 'Finding nearby 2.4 GHz Wi-Fi networks…';
  if(s?.phase===3)return 'Connecting the lamp to Wi-Fi…';
  if(s?.phase===4&&s.connected)return 'Connected to '+s.ssid+'. Wi-Fi settings saved.';
  if(s?.phase===5)return ['','Wi-Fi scan failed. Try again.',wifiJoinFailure(s),'The lamp connected but could not save Wi-Fi settings. Please retry.'][s.error]||'Wi-Fi setup failed. Try again.';
  if(s?.phase===2)return s.count?'Choose a network below.':'No nearby networks found. Try again or enter a hidden network name.';
  return s?.connected?'Currently connected to '+s.ssid+'.':'Choose your home Wi-Fi. Your phone stays connected over Bluetooth.';
}
