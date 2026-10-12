// Optional evidence only. This store never authorizes, retries, or blocks an
// update, and shares neither its key nor its records with the safety journal.
export const FIRMWARE_UPDATE_DIAGNOSTICS_KEY='coollamp-firmware-update-diagnostics-v1';
export const FIRMWARE_UPDATE_DIAGNOSTIC_STAGES=Object.freeze(['wifi-preflight','bluetooth-preflight','phone-download','bluetooth-transfer']);
export const FIRMWARE_UPDATE_DIAGNOSTIC_CODES=Object.freeze(['unknown','identity-mismatch','wifi-password-required','authorization-required',
 'target-changed','cancelled','recovery-storage-failure','bootstrap-required','update-busy','invalid-status','missing-update-token',
 'unsupported','wifi-unreachable','mutation-uncertain','timeout','native-not-connected','wifi-check-rejected','firmware-rejected',
 'http-error','receiver-rejected','ack-timeout','native-read-failure','native-write-failure','connection-changed','native-disconnect',
 'transport-disconnect','app-hidden','user','transfer-failed']);
const RECORD_LIMIT=32,STORAGE_LIMIT=32768,REPORT_LIMIT=4096,IMAGE_LIMIT=2031616;
const stages=new Set(FIRMWARE_UPDATE_DIAGNOSTIC_STAGES),codes=new Set(FIRMWARE_UPDATE_DIAGNOSTIC_CODES);
const stops=new Set(['user','app-hidden','transport-disconnect','native-disconnect','target-changed','cancelled','connection-changed',
 'receiver-rejected','ack-timeout','native-read-failure','native-write-failure','journal-write-failure','transfer-failed']);
const outcomes=new Set(['installed','installationNotStarted','transferStopped','pending','unresolved','active','differentVersion']);
const terminal=new Set(['installed','installationNotStarted','transferStopped']);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const identity=value=>typeof value==='string'&&/^[0-9a-f]{12}$/.test(value);
const token=value=>typeof value==='string'&&/^[0-9a-f]{32}$/.test(value);
const version=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(part=>Number(part)<=65535);
// Read data properties only. Never call supplied accessors, toJSON, or methods.
const field=(value,key)=>{try{return Object.getOwnPropertyDescriptor(value,key)?.value;}catch{return undefined;}};
const clock=()=>{const value=Date.now();return integer(value,0,Number.MAX_SAFE_INTEGER)?value:0;};
const booleanFields=['metadataIssued','beginAttempted','commitAttempted','wifiCheckAttempted','wifiInstallAttempted'];
const limits={firmwarePhase:[0,5],error:[0,9],firmwareError:[1,8],httpStatus:[100,599],acknowledgedBytes:[0,IMAGE_LIMIT],writesAttempted:[0,1048576],offset:[0,IMAGE_LIMIT]};
// One optional final snapshot, never a per-frame log or update authority. Values
// outside these bounds are omitted; arbitrary text and transport IDs cannot enter.
const transferLimits={mtu:[23,517],chunkSize:[1,232],total:[1,IMAGE_LIMIT],acknowledgedBytes:[0,IMAGE_LIMIT],
 dataStartOffset:[0,IMAGE_LIMIT],dataEndOffset:[0,IMAGE_LIMIT],dataElapsedMs:[0,86400000],elapsedMs:[0,86400000],
 dataFrames:[0,1048576],dataBytesAttempted:[0,IMAGE_LIMIT],writesAttempted:[0,1048576],bulkWriteCalls:[0,1048576],
 writeTimeMs:[0,86400000],maxWriteMs:[0,86400000],statusReads:[0,1048576],statusTimeMs:[0,86400000],maxStatusMs:[0,86400000],notificationAcks:[0,1048576]};
const transferBooleans=['receiverBulkWrites','commitAcknowledged','dataComplete','monotonicDataTiming'];
const transferEnums={dataWriteMode:new Set(['with-response','without-response-four']),notificationMode:new Set(['polling','notifications']),
 mtuFallback:new Set(['unavailable','invalid']),bulkWriteFallback:new Set(['platform-disabled','receiver-unsupported','sdk-unavailable','service-discovery-failed','service-discovery-pending','characteristic-unavailable','property-unavailable']),
 notificationFallback:new Set(['unsupported','owned','subscribe-failed','missed-ack'])};
export function safeFirmwareTransferMetrics(source){
 const result={};
 for(const [key,[min,max]]of Object.entries(transferLimits)){const value=field(source,key);if(integer(value,min,max))result[key]=value;}
 for(const key of transferBooleans){const value=field(source,key);if(typeof value==='boolean')result[key]=value;}
 for(const [key,values]of Object.entries(transferEnums)){const value=field(source,key);if(values.has(value))result[key]=value;}
 if(result.mtu!==undefined&&result.chunkSize>Math.min(232,result.mtu-15))delete result.chunkSize;
 if(result.total!==undefined){for(const key of ['acknowledgedBytes','dataStartOffset','dataEndOffset','dataBytesAttempted'])if(result[key]>result.total)delete result[key];}
 const dataRange=result.dataStartOffset!==undefined&&result.dataEndOffset!==undefined&&result.dataEndOffset>=result.dataStartOffset;
 if(!dataRange||result.monotonicDataTiming!==true)delete result.dataElapsedMs;
 if(!dataRange)delete result.dataComplete;
 else if(result.dataComplete===true&&(result.total===undefined||result.dataEndOffset!==result.total))delete result.dataComplete;
 return Object.keys(result).length?Object.freeze(result):null;
}
function safeMetrics(source){
 const result={};for(const key of booleanFields){const value=field(source,key);if(typeof value==='boolean')result[key]=value;}
 for(const [key,[min,max]]of Object.entries(limits)){const value=field(source,key);if(integer(value,min,max))result[key]=value;}
 const reason=field(source,'stopReason');if(stops.has(reason))result.stopReason=reason;return result;
}
function inspect(error){
 const nodes=[],seen=new Set();let value=error;
 // The original error and at most two causes. Cycles cannot grow the walk.
 for(let depth=0;depth<=2&&value&&(typeof value==='object'||typeof value==='function')&&!seen.has(value);depth++){
  seen.add(value);nodes.push(value);value=field(value,'cause');
 }
 const metrics={};let transfer=null;for(const node of nodes){
  const diagnostic=field(node,'updateDiagnostic'),safe={...safeMetrics(node),...safeMetrics(diagnostic)};
  transfer??=safeFirmwareTransferMetrics(field(node,'transferDiagnostic'))??safeFirmwareTransferMetrics(diagnostic);
  const phase=field(diagnostic,'phase');if(safe.firmwarePhase===undefined&&integer(phase,0,5))safe.firmwarePhase=phase;
  for(const [key,item]of Object.entries(safe))if(metrics[key]===undefined)metrics[key]=item;
 }
 const flag=name=>nodes.some(node=>field(node,name)===true);
 let code='unknown';
 if(flag('identity'))code='identity-mismatch';
 else if(flag('needsPassword'))code='wifi-password-required';
 else if(flag('unauthorized')||flag('authentication')||metrics.httpStatus===401||metrics.httpStatus===403)code='authorization-required';
 else if(flag('stale'))code='target-changed';
 else if(flag('journalFailure'))code='recovery-storage-failure';
 else if(flag('bootstrapRequired'))code='bootstrap-required';
 else if(flag('firmwareBusy')||flag('receiverBusy'))code='update-busy';
 else if(flag('invalidRead'))code='invalid-status';
 else if(flag('missingUpdateToken'))code='missing-update-token';
 else if(flag('unsupported'))code='unsupported';
 else if(metrics.firmwareError!==undefined)code='firmware-rejected';
 else if(metrics.httpStatus===409)code='wifi-check-rejected';
 else if(flag('offline'))code='wifi-unreachable';
 else if(['user','app-hidden','transport-disconnect','native-disconnect','target-changed','cancelled','connection-changed'].includes(metrics.stopReason))code=metrics.stopReason;
 else if(nodes.some(node=>field(node,'message')==='Not connected to device.'))code='native-not-connected';
 else if(metrics.stopReason)code=metrics.stopReason==='journal-write-failure'?'recovery-storage-failure':metrics.stopReason;
 else if(flag('cancelled'))code='cancelled';
 else if(flag('uncertain'))code='mutation-uncertain';
 else if(flag('timeout'))code='timeout';
 else if(metrics.error>0)code='receiver-rejected';
 else if(metrics.httpStatus!==undefined)code='http-error';
 return {detail:{code,...metrics},transfer};
}
function immutable(value){
 return Object.freeze({...value,...(value.transfer?{transfer:Object.freeze({...value.transfer})}:{}),stages:Object.freeze(value.stages.map(stage=>Object.freeze({...stage})))});
}
function restore(value){
 if(!identity(field(value,'identity'))||!token(field(value,'attemptId'))||!integer(field(value,'startedAt'),0,Number.MAX_SAFE_INTEGER)||
  !integer(field(value,'updatedAt'),field(value,'startedAt'),Number.MAX_SAFE_INTEGER)||!Array.isArray(field(value,'stages'))||field(value,'stages').length>4)
  throw Error('Invalid diagnostic record.');
 const result={identity:value.identity,attemptId:value.attemptId,startedAt:value.startedAt,updatedAt:value.updatedAt,stages:[]},seen=new Set();
 for(const row of value.stages){
  if(!stages.has(field(row,'stage'))||seen.has(row.stage)||!codes.has(field(row,'code'))||!integer(field(row,'at'),result.startedAt,result.updatedAt))throw Error('Invalid diagnostic stage.');
  seen.add(row.stage);const safe=safeMetrics(row);
  for(const key of [...booleanFields,...Object.keys(limits),'stopReason'])if(field(row,key)!==undefined&&safe[key]===undefined)throw Error('Invalid diagnostic metric.');
  result.stages.push({stage:row.stage,at:row.at,code:row.code,...safe});
 }
 if(field(value,'outcome')!==undefined){if(!outcomes.has(value.outcome))throw Error('Invalid diagnostic outcome.');result.outcome=value.outcome;}
 if(field(value,'installedVersion')!==undefined){if(!version(value.installedVersion))throw Error('Invalid diagnostic version.');result.installedVersion=value.installedVersion;}
 if(field(value,'offset')!==undefined){if(!integer(value.offset,0,IMAGE_LIMIT))throw Error('Invalid diagnostic offset.');result.offset=value.offset;}
 const transfer=safeFirmwareTransferMetrics(field(value,'transfer'));if(transfer)result.transfer=transfer;
 return result;
}
export class FirmwareUpdateDiagnostics {
 constructor(storage){
  this.storage=storage;this.records=new Map();this.canPersist=false;
  try{
   if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')return;
   const text=storage.getItem(FIRMWARE_UPDATE_DIAGNOSTICS_KEY);
   if(text===null||text===undefined){this.canPersist=true;return;}
   if(typeof text!=='string'||text.length>STORAGE_LIMIT)throw Error('Invalid diagnostic store.');
   const data=JSON.parse(text);if(data?.version!==1||!Array.isArray(data.records)||data.records.length>RECORD_LIMIT)throw Error('Unsupported diagnostic store.');
   const records=new Map();for(const row of data.records){const value=restore(row);if(records.has(value.identity))throw Error('Duplicate diagnostic target.');records.set(value.identity,value);}
   this.records=records;this.canPersist=true;
  }catch{ /* Corrupt/future optional diagnostics never affect update safety. */ }
 }
 save(value){
  this.records.delete(value.identity);this.records.set(value.identity,value);
  let text=JSON.stringify({version:1,records:[...this.records.values()]});
  while(this.records.size>RECORD_LIMIT||text.length>STORAGE_LIMIT){this.records.delete(this.records.keys().next().value);text=JSON.stringify({version:1,records:[...this.records.values()]});}
  if(this.canPersist)try{this.storage.setItem(FIRMWARE_UPDATE_DIAGNOSTICS_KEY,text);}catch{ /* Best effort; the in-memory evidence remains available. */ }
  return immutable(value);
 }
 begin(id,attemptId){
  if(!identity(id)||!token(attemptId))return null;
  const previous=this.records.get(id);if(previous?.attemptId===attemptId)return immutable(previous);
  const at=clock();return this.save({identity:id,attemptId,startedAt:at,updatedAt:at,stages:[]});
 }
 failure(id,attemptId,error,context={}){
  const previous=this.records.get(id),stage=field(context,'stage');
  if(!previous||previous.attemptId!==attemptId||terminal.has(previous.outcome)||!stages.has(stage))return null;
  const {detail,transfer}=inspect(error),safety=field(context,'safety');
  // Durable intent boundaries outrank a sender diagnostic captured before its
  // attempted write. Nothing else from the safety journal is copied here.
  for(const key of [...booleanFields,'offset']){const value=field(safety,key);if((typeof value==='boolean'&&booleanFields.includes(key))||(key==='offset'&&integer(value,0,IMAGE_LIMIT)))detail[key]=value;}
  const at=Math.max(previous.updatedAt,clock()),nextStages=previous.stages.filter(row=>row.stage!==stage);
  nextStages.push({stage,at,...detail});return this.save({...previous,...(transfer?{transfer}:{}),updatedAt:at,stages:nextStages.slice(-4)});
 }
 transfer(id,attemptId,source){
  const previous=this.records.get(id);
  if(!previous||previous.attemptId!==attemptId||terminal.has(previous.outcome))return null;
  const transfer=safeFirmwareTransferMetrics(source);if(!transfer)return null;
  return this.save({...previous,transfer,updatedAt:Math.max(previous.updatedAt,clock())});
 }
 complete(id,attemptId,result={}){
  const previous=this.records.get(id),outcome=field(result,'outcome');
  if(!previous||previous.attemptId!==attemptId||terminal.has(previous.outcome)||!outcomes.has(outcome))return null;
  const next={...previous,updatedAt:Math.max(previous.updatedAt,clock()),outcome},installed=field(result,'installedVersion'),offset=field(result,'offset');
  if(version(installed))next.installedVersion=installed;if(integer(offset,0,IMAGE_LIMIT))next.offset=offset;return this.save(next);
 }
 get(id){const value=this.records.get(id);return value?immutable(value):null;}
 report(id){const value=this.get(id);if(!value)return null;const {identity,attemptId,...record}=value;const text=JSON.stringify({version:1,record});return text.length<=REPORT_LIMIT?text:null;}
}
