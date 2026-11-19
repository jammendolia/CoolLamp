const canonical=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const transaction=value=>typeof value==='string'&&/^[0-9a-f]{16}$/.test(value)&&!/^0+$/.test(value);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const phases=new Set(['idle','accepted','looking','reconnecting','checking','complete','failed']);
const activePhases=new Set(['accepted','looking','reconnecting','checking']);
const results=new Set(['none','improved','already-best','still-weak','inconclusive']);
const errors=new Set(['none','response-not-released','scan-failed','reconnect-start-failed','reconnect-timed-out','security-changed']);
const phaseCodes=['idle','accepted','looking','reconnecting','checking','complete','failed'];
const resultCodes=['none','improved','already-best','still-weak','inconclusive'];
const errorCodes=['none','response-not-released','scan-failed','reconnect-start-failed','reconnect-timed-out','security-changed'];
const accessPoint=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const address=value=>typeof value==='string'&&value.split('.').length===4&&value.split('.').every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);
const scope=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
const radio=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.available!=='boolean'||
    !integer(value.rssi,-127,0)||!integer(value.channel,0,14)||!accessPoint(value.accessPoint))throw Error('Invalid lamp connection status.');
  return Object.freeze({available:value.available,rssi:value.rssi,channel:value.channel,accessPoint:value.accessPoint});
};
const compactFlag=value=>value===0||value===1;
const compactRadio=value=>{
  if(!Array.isArray(value)||value.length!==4||!compactFlag(value[0])||!integer(value[1],-127,0)||
    !integer(value[2],0,14)||!accessPoint(value[3]))throw Error('Invalid lamp connection status.');
  return {available:value[0]===1,rssi:value[1],channel:value[2],accessPoint:value[3]};
};
function expandCompact(value){
  if(value.v!==1||!canonical(value.d)||!transaction(value.b)||value.o!==null&&!transaction(value.o)||!transaction(value.n)||
    !integer(value.p,0,phaseCodes.length-1)||!integer(value.r,0,resultCodes.length-1)||!integer(value.e,0,errorCodes.length-1)||
    !compactFlag(value.c)||value.x!==0||!address(value.ip)||!Array.isArray(value.t)||value.t.length!==3||
    !value.t.every(item=>integer(item,0,0xffffffff))||!compactFlag(value.co)||!Array.isArray(value.q)||value.q.length!==4)
    throw Error('Invalid lamp connection status.');
  const radios=value.q.map(compactRadio),phase=phaseCodes[value.p],before=radios[1],after=radios[3];
  return {version:1,deviceId:value.d,bootSession:value.b,operationId:value.o,nextOperationId:value.n,
    phase,result:resultCodes[value.r],error:errorCodes[value.e],active:activePhases.has(phase),connected:value.c===1,
    credentialsChanged:false,address:value.ip,acceptedAt:value.t[0],startedAt:value.t[1],updatedAt:value.t[2],minimumGain:10,
    currentObserved:value.co===1,current:radios[0],before,candidate:radios[2],after,
    accessPointChanged:before.available&&after.available&&before.accessPoint!==after.accessPoint};
}

export const WIFI_RESELECT_JOURNAL_KEY='coollamp-wifi-reselect-v1';

export function parseWifiReselect(raw,expectedId=null){
  let value;try{value=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Invalid lamp connection status.');}
  if(value?.v===1)value=expandCompact(value);
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!canonical(value.deviceId)||
    expectedId&&value.deviceId!==expectedId||!transaction(value.bootSession)||
    value.operationId!==null&&!transaction(value.operationId)||!transaction(value.nextOperationId)||
    !phases.has(value.phase)||!results.has(value.result)||!errors.has(value.error)||
    typeof value.active!=='boolean'||typeof value.connected!=='boolean'||value.credentialsChanged!==false||!address(value.address)||
    !integer(value.acceptedAt,0,0xffffffff)||!integer(value.startedAt,0,0xffffffff)||!integer(value.updatedAt,0,0xffffffff)||
    value.minimumGain!==10||typeof value.currentObserved!=='boolean'||typeof value.accessPointChanged!=='boolean')
    throw Error('Invalid lamp connection status.');
  const current=radio(value.current),before=radio(value.before),candidate=radio(value.candidate),after=radio(value.after);
  const active=activePhases.has(value.phase),idle=value.phase==='idle',complete=value.phase==='complete',failed=value.phase==='failed';
  if(value.active!==active||idle!==(value.operationId===null)||!idle&&value.operationId===value.nextOperationId||
    (complete?value.result==='none'||value.error!=='none':value.result!=='none')||
    (failed?value.error==='none':value.error!=='none')||value.accessPointChanged&&(!before.available||!after.available||before.accessPoint===after.accessPoint)||
    value.result==='improved'&&!value.accessPointChanged)throw Error('Invalid lamp connection status.');
  return Object.freeze({...value,current,before,candidate,after});
}

export function wifiReselectPresentation(value){
  if(!value)return Object.freeze({supported:false,visible:false,working:false,message:'',action:'Improve connection'});
  const base={supported:true,visible:true,working:value.active,action:'Improve connection'};
  if(value.phase==='accepted'||value.phase==='looking')return Object.freeze({...base,message:'Looking for a better connection…'});
  if(value.phase==='reconnecting')return Object.freeze({...base,message:'Reconnecting…'});
  if(value.phase==='checking')return Object.freeze({...base,message:'Checking the new connection…'});
  if(value.phase==='complete'){
    const final=value.after.available?value.after:value.before;
    const live=value.connected&&value.current.available&&final.available&&value.current.accessPoint===final.accessPoint;
    const improvementLive=value.result!=='improved'||value.current.rssi>=value.before.rssi+5;
    if(!live||!improvementLive)return Object.freeze({...base,working:false,
      message:value.connected?'The connection changed after the check.':'The lamp is not connected right now.',
      detail:value.connected?'Check again to see which connection it is using.':'Keep the lamp powered, then check again nearby.',
      action:'Check again',recovery:'Use Bluetooth'});
  }
  if(value.phase==='complete'&&value.result==='improved')return Object.freeze({...base,working:false,message:'Connection improved.',detail:'The lamp is now using a stronger connection.'});
  if(value.phase==='complete'&&value.result==='already-best')return Object.freeze({...base,working:false,message:'This is the best connection the lamp found.',detail:value.current.rssi<=-70?'The signal is still weak. Check that the nearby mesh point is powered and uses the same home Wi-Fi.':''});
  if(value.phase==='complete'&&value.result==='still-weak')return Object.freeze({...base,working:false,message:'The lamp reconnected, but improvement wasn’t confirmed.',detail:'If control still feels unreliable, keep the nearby mesh point powered and try again.'});
  if(value.phase==='complete'&&value.result==='inconclusive')return Object.freeze({...base,working:false,message:'A better connection could not be confirmed.',detail:'Keep the lamp and nearby mesh point powered, then try again.',action:'Try again'});
  if(value.phase==='failed')return Object.freeze({...base,working:false,message:value.error==='scan-failed'?'Nearby connections could not be checked.':value.error==='security-changed'?'The new connection could not be verified safely.':'The lamp did not finish reconnecting.',detail:'Keep the lamp powered. Check its connection again, or use Bluetooth nearby.',action:'Check again',recovery:'Use Bluetooth'});
  const weak=value.connected&&value.current.rssi<=-70;
  return Object.freeze({...base,visible:weak,working:false,message:weak?'This lamp’s Wi-Fi signal is weak.':'',detail:weak?'A nearby mesh point may provide a better connection.':''});
}

function journalRecord(value){
  if(!value||value.version!==1||!scope(value.homeId)||!canonical(value.deviceId)||!transaction(value.bootSession)||
    !transaction(value.operationId)||!Number.isSafeInteger(value.issuedAt)||value.issuedAt<0)throw Error('The saved connection check needs review.');
  return Object.freeze({version:1,homeId:value.homeId,deviceId:value.deviceId,bootSession:value.bootSession,operationId:value.operationId,issuedAt:value.issuedAt});
}
const sameRecord=(a,b)=>Boolean(a&&b&&a.version===b.version&&a.homeId===b.homeId&&a.deviceId===b.deviceId&&a.bootSession===b.bootSession&&a.operationId===b.operationId&&a.issuedAt===b.issuedAt);

export class WifiReselectJournal{
  constructor(storage=globalThis.localStorage,key=WIFI_RESELECT_JOURNAL_KEY){if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function')throw Error('Connection recovery storage is unavailable.');this.storage=storage;this.key=key;}
  read(){const raw=this.storage.getItem(this.key);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{throw Error('The saved connection check needs review.');}return journalRecord(value);}
  begin(value){const record=journalRecord(value),existing=this.read();if(existing&&!sameRecord(existing,record))throw Object.assign(Error('Finish checking the other lamp’s connection first.'),{pending:existing});if(!existing){this.storage.setItem(this.key,JSON.stringify(record));const saved=this.read();if(!sameRecord(saved,record))throw Error('The connection check could not be saved. Nothing was sent.');}return record;}
  clear(value){const record=journalRecord(value),existing=this.read();if(!existing)return true;if(!sameRecord(existing,record))return false;this.storage.removeItem(this.key);return this.storage.getItem(this.key)===null;}
}

export function wifiReselectRelation(value,record){
  const status=parseWifiReselect(value,record?.deviceId),saved=journalRecord(record);
  if(status.bootSession!==saved.bootSession)return Object.freeze({kind:'restarted',terminal:true,status});
  if(status.operationId===saved.operationId)return Object.freeze({kind:status.active?'active':status.phase==='complete'||status.phase==='failed'?'terminal':'unknown',terminal:!status.active,status});
  if(status.nextOperationId===saved.operationId)return Object.freeze({kind:'not-started',terminal:true,status});
  return Object.freeze({kind:'unknown',terminal:false,status});
}
