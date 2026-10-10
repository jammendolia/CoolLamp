// Firmware metadata is data only. All commands use this explicit allowlist;
// unknown model/effect keys never select executable adapters or markup.
const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const nonce=value=>typeof value==='string'&&/^[a-f0-9]{16}$/.test(value)&&!/^0+$/.test(value);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const text=(value,max)=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const key=value=>text(value,64)&&/^[a-z0-9._-]+$/.test(value);
function parse(value,max=8192){if(typeof value==='string'){if(new TextEncoder().encode(value).length>max)throw Error('Oversized lamp contract.');return JSON.parse(value);}return value;}
function strings(value,max=16){if(!Array.isArray(value)||value.length>max||!value.every(item=>key(item)))throw Error('Invalid capability list.');return Object.freeze([...new Set(value)]);}
export function revisionSnapshot(raw,target){const value=parse(raw);if(value?.version!==1||value.target!==target||!canonical(target)||!nonce(value.bootSession)||!nonce(value.nextCommandId)||!integer(value.revision,1,0xffffffff)||!integer(value.mode,1,255)||!integer(value.brightness,1,255)||typeof value.power!=='boolean')throw Error('Invalid target revision.');return Object.freeze({...value});}
export function lampDescriptor(raw,target){
 const value=parse(raw),model=value?.model,limits=value?.limits,capabilities=value?.capabilities;
 if(value?.descriptorVersion!==2||!canonical(target)||value.deviceId!==target||model?.version!==1||!key(model.id)||!text(model.displayName,64)||!key(model.artworkFamily)||!key(model.hardwareRevision)||typeof model.preconfigured!=='boolean'||!limits||!capabilities||!/^\d+\.\d+\.\d+$/.test(value.firmwareVersion))throw Error('Invalid lamp descriptor.');
 for(const [name,max] of Object.entries({groupMembers:32,legacyGroupMembers:9,localPresence:16,forwardingHops:4,bleConnections:1,bleBonds:3,requestBytes:1024,responseBytes:8192,schemaPageEntries:4,schemaPageBytes:4096,receipts:8,receiptLifetimeMs:120000,appearanceWriteIntervalMs:2000}))if(!integer(limits[name],1,max))throw Error('Invalid negotiated lamp limit.');
 const versions=name=>{if(!Array.isArray(capabilities[name])||capabilities[name].length>4||!capabilities[name].every(n=>integer(n,1,255)))throw Error('Invalid contract versions.');return Object.freeze(capabilities[name].slice());};
 const artwork=['helix','corkscrew','generic'].includes(model.artworkFamily)?model.artworkFamily:'generic';
 return Object.freeze({deviceId:target,firmwareVersion:value.firmwareVersion,model:Object.freeze({...model,artwork}),limits:Object.freeze({...limits}),state:revisionSnapshot(value.state,target),capabilities:Object.freeze({...capabilities,catalogVersions:versions('catalogVersions'),sceneVersions:versions('sceneVersions'),control:strings(capabilities.control),persistence:strings(capabilities.persistence),updates:strings(capabilities.updates),commissioning:strings(capabilities.commissioning)})});
}
export function effectSchemaPage(raw,target){
 const value=parse(raw,4096);
 if(value?.schemaVersion!==2||value.target!==target||!canonical(target)||!['effects','scenes'].includes(value.kind)||!integer(value.total,1,255)||!integer(value.offset,0,value.total-1)||!integer(value.next,value.offset+1,value.total)||!Array.isArray(value.entries)||value.entries.length>4||value.entries.length!==value.next-value.offset)throw Error('Invalid effect schema page.');
 const ids=new Set(),keys=new Set();const entries=value.entries.map(entry=>{
  if(!key(entry.key)||!integer(entry.localId,value.kind==='scenes'?0:1,255)||ids.has(entry.localId)||keys.has(entry.key)||typeof entry.motion!=='boolean'||!Array.isArray(entry.parameters)||entry.parameters.length>8||!Array.isArray(entry.palette?.modes)||entry.palette.modes.length>4||!entry.palette.modes.every(mode=>['fixed','automatic','custom'].includes(mode))||!Array.isArray(entry.palette.colorRoles)||entry.palette.colorRoles.length>4||!entry.palette.colorRoles.every(key)||typeof entry.audio?.required!=='boolean'||!['none','local-or-coordinator','coordinator'].includes(entry.audio.source)||!key(entry.persistence))throw Error('Invalid effect descriptor.');
  ids.add(entry.localId);keys.add(entry.key);const seen=new Set();const parameters=entry.parameters.map(parameter=>{
   if(!key(parameter.key)||seen.has(parameter.key)||!key(parameter.type)||!key(parameter.semanticRole)||!key(parameter.units))throw Error('Invalid effect parameter.');seen.add(parameter.key);
   if(parameter.type!=='integer')return Object.freeze({key:parameter.key,type:parameter.type,supported:false});
   if(!integer(parameter.min,-65535,65535)||!integer(parameter.max,parameter.min,65535)||!integer(parameter.step,1,65535)||!integer(parameter.default,parameter.min,parameter.max)||(parameter.default-parameter.min)%parameter.step)throw Error('Invalid effect parameter range.');return Object.freeze({...parameter,supported:['speed','intensity'].includes(parameter.key)});
  });return Object.freeze({...entry,parameters:Object.freeze(parameters),palette:Object.freeze({...entry.palette,modes:Object.freeze(entry.palette.modes.slice()),colorRoles:Object.freeze(entry.palette.colorRoles.slice())})});
 });return Object.freeze({...value,entries:Object.freeze(entries)});
}
export function commandReceipt(raw,target,bootSession,commandId){const value=parse(raw);if(value?.version!==1||value.target!==target||value.commandId!==commandId||value.requestBoot!==bootSession||!nonce(value.bootSession)||!integer(value.revision,1,0xffffffff)||!['uncertain','rejected','executed','persisted','save-failed'].includes(value.outcome))throw Error('Invalid target receipt.');if(value.outcome==='uncertain'){if(value.executed!==null||value.persisted!==null)throw Error('Invalid uncertain receipt.');}else if(value.bootSession!==bootSession||typeof value.executed!=='boolean'||typeof value.persisted!=='boolean'||value.persisted!==(value.outcome==='persisted')||value.executed!==(value.outcome!=='rejected')||!integer(value.httpStatus,200,599))throw Error('Invalid execution receipt.');return Object.freeze({...value});}
const patchRanges={mode:[1,255],power:[0,1],brightness:[1,255],speed:[1,100],intensity:[0,100],dual:[0,1],r:[0,255],g:[0,255],b:[0,255],r2:[0,255],g2:[0,255],b2:[0,255],resetPalette:[1,1]};
export function partialLight(patch){if(!patch||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(name=>!patchRanges[name]))throw Error('Invalid partial light change.');for(const [name,value] of Object.entries(patch))if(!integer(value,...patchRanges[name]))throw Error('Partial light value is out of range.');return Object.freeze({...patch});}
function updatePolicyFields(policy){if(!policy||typeof policy.window!=='boolean'||typeof policy.deferDuringUse!=='boolean'||!integer(policy.startMinute,0,1439)||!integer(policy.endMinute,0,1439)||(policy.window&&policy.startMinute===policy.endMinute)||!integer(policy.idleSeconds,1,86400)||!text(policy.timezone,63))throw Error('Invalid update policy.');const {window,startMinute,endMinute,timezone,deferDuringUse,idleSeconds}=policy;return {window,startMinute,endMinute,timezone,deferDuringUse,idleSeconds};}
// One submission owns its target, boot, ID and revision. Route changes are only
// allowed for fresh reads or receipt reconciliation; no automatic replay.
export class LampExperienceSession {
 constructor(transport,target){if(!canonical(target)||typeof transport?.request!=='function')throw Error('Select a verified lamp.');this.transport=transport;this.target=target;this.pending=null;this.descriptor=null;}
 async negotiate(){this.descriptor=lampDescriptor(await this.transport.request('/api/descriptor'),this.target);this.policySnapshot=null;return this.descriptor;}
 async fresh(){return revisionSnapshot(await this.transport.request('/api/revision'),this.target);}
 async schema(offset=0,kind='effects',count=4){if(!this.descriptor?.capabilities.catalogVersions.includes(2))throw Error('This lamp needs effect schema v2.');return effectSchemaPage(await this.transport.request('/api/effects/schema',{offset,kind,count:Math.min(count,this.descriptor.limits.schemaPageEntries)}),this.target);}
 draft(snapshot,patch){if(snapshot?.target!==this.target)throw Error('Draft target changed.');return Object.freeze({target:this.target,bootSession:snapshot.bootSession,expectedRevision:snapshot.revision,patch:partialLight(patch)});}
 async submit(path,fields,snapshot){
  if(this.pending)throw Object.assign(Error('Reconcile the previous lamp command first.'),{uncertain:true});
  if(!this.descriptor?.capabilities.control.includes('command-receipts-v1'))throw Error('Update this lamp for confirmed partial changes.');
  const fresh=await this.fresh();if(snapshot&&(snapshot.bootSession!==fresh.bootSession||snapshot.expectedRevision!==fresh.revision))throw Object.assign(Error('Lamp changed while this draft was open.'),{confirmed:true,conflict:true});
  const command=Object.freeze({target:this.target,bootSession:fresh.bootSession,commandId:fresh.nextCommandId,expectedRevision:fresh.revision,scope:'lamp',...fields});this.pending=command;
  try{const result=commandReceipt(await this.transport.request(path,command),this.target,command.bootSession,command.commandId);if(result.outcome!=='uncertain')this.pending=null;return result;}
  catch(error){let result;try{result=commandReceipt(error.message,this.target,command.bootSession,command.commandId);}catch{ /* keep exact submission for reconciliation */ }
   if(result){if(result.outcome!=='uncertain')this.pending=null;return result;}
   // A structured explicit rejection cannot have executed. All other failures
   // retain the operation; even adapter-confirmed errors may follow execution.
   let rejected;try{rejected=JSON.parse(error.message);}catch{}
   if(error.confirmed&&rejected?.outcome==='rejected'&&['receipt-capacity','revision-conflict','command-id-conflict','invalid-command'].includes(rejected.error)){this.pending=null;throw Object.assign(error,{confirmed:true});}
   throw Object.assign(error,{uncertain:true,command});
  }
 }
 patch(draft){if(draft?.target!==this.target)throw Error('Draft target changed.');return this.submit('/api/state/patch',partialLight(draft.patch),draft);}
 save(mode){if(!integer(mode,1,255))throw Error('Invalid effect.');return this.submit('/api/appearance/save',{mode});}
 async readUpdatePolicy(){if(!this.descriptor?.capabilities.updates.includes('quiet-policy-v1'))throw Error('This lamp does not support quiet policies.');const fresh=await this.fresh();const value=parse(await this.transport.request('/api/firmware/policy',{action:'read',target:this.target,bootSession:fresh.bootSession}));if(value?.version!==1||value.target!==this.target||value.bootSession!==fresh.bootSession||value.policy?.version!==1||!integer(value.policy.revision,1,0xffffffff)||typeof value.policy.valid!=='boolean')throw Error('Invalid target update policy.');updatePolicyFields(value.policy);this.policySnapshot=Object.freeze({...value.policy,bootSession:fresh.bootSession,expectedRevision:fresh.revision});return this.policySnapshot;}
 saveUpdatePolicy(policy,expectedPolicyRevision){if(!this.descriptor?.capabilities.updates.includes('quiet-policy-v1'))throw Error('This lamp does not support quiet policies.');if(!integer(expectedPolicyRevision,1,0xfffffffe)||!policy||Object.keys(policy).some(name=>!['window','startMinute','endMinute','timezone','deferDuringUse','idleSeconds'].includes(name)))throw Error('Invalid update policy.');if(!this.policySnapshot||this.policySnapshot.revision!==expectedPolicyRevision)throw Error('Read this lamp’s policy before changing it.');const fields=updatePolicyFields(policy);return this.submit('/api/firmware/policy',{expectedPolicyRevision,...fields,window:Number(fields.window),deferDuringUse:Number(fields.deferDuringUse)},this.policySnapshot).then(result=>{if(result.outcome!=='uncertain')this.policySnapshot=null;return result;});}
 async reconcile(transport=this.transport){if(!this.pending)throw Error('No outstanding command.');const command=this.pending;const verified=lampDescriptor(await transport.request('/api/descriptor'),this.target);const receipt=commandReceipt(await transport.request('/api/receipt',{target:this.target,bootSession:command.bootSession,commandId:command.commandId}),this.target,command.bootSession,command.commandId);if(receipt.outcome!=='uncertain'){this.pending=null;this.transport=transport;this.descriptor=verified;}return receipt;}
 // Explicit UI recovery after the user reviews a fresh target state. This
 // releases the lane while preserving an honest unknown historical outcome.
 async retireUncertainAfterSnapshot(transport=this.transport){if(!this.pending)throw Error('No outstanding command.');const command=this.pending;const descriptor=lampDescriptor(await transport.request('/api/descriptor'),this.target);const snapshot=revisionSnapshot(await transport.request('/api/revision'),this.target);this.pending=null;this.policySnapshot=null;this.transport=transport;this.descriptor=descriptor;return Object.freeze({outcome:'uncertain',command,snapshot});}
}
