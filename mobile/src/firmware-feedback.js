import {compareFirmwareVersions} from './bluetooth-firmware.js';
const key='coollamp-firmware-feedback-v1';
const identity=value=>typeof value==='string'&&/^(?:[0-9a-f]{12}|ble:[^\s]{1,120})$/.test(value);
const progress=value=>Number.isInteger(value)&&value>=0&&value<=100;
const pending=new Set(['verified-restarting','verification-required']);
const validVersion=value=>{try{return typeof value==='string'&&compareFirmwareVersions(value,value)===0;}catch{return false;}};
function receipt(value){
 if(validVersion(value?.targetVersion)&&(pending.has(value.outcome)||value.outcome==='installed')){
  // Unknown/corrupt additive values hold the old receipt conservatively. They
  // never turn a pending installation into a version-only success.
  const commitUnconfirmed=value.commitUnconfirmed!==undefined&&value.commitUnconfirmed!==false;
  return {outcome:commitUnconfirmed&&value.outcome==='installed'?'verification-required':value.outcome,targetVersion:value.targetVersion,commitUnconfirmed};
 }
 // Only the exact old explicit success receipt carries a known target version.
 // Generic failures and unconfirmed results must never be inferred as success.
 const legacy=value?.progress===100&&/^Firmware ([0-9.]+) verified by the lamp\. It is restarting\. Reconnect to confirm the installed version\.$/.exec(value.message||'');
 return legacy&&validVersion(legacy[1])?{outcome:'verified-restarting',targetVersion:legacy[1],commitUnconfirmed:false}:{};
}
// Only human-readable results, acknowledged progress and completion versions are retained. Session
// handles, firmware bytes, credentials and native response objects stay out.
export class FirmwareFeedback {
 constructor(storage){
  this.storage=storage;this.records=new Map();this.attempts=new Map();
  try{const rows=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(rows))for(const row of rows.slice(-32))if(identity(row?.id)&&typeof row.message==='string'&&row.message.length<=1200&&row.terminal===true)this.records.set(row.id,{message:row.message,terminal:true,...(progress(row.progress)?{progress:row.progress}:{}),...receipt(row)});}catch{}
 }
 get(id){return this.records.get(id);}
 begin(id,{preservePending=false}={}){
  if(!identity(id))throw Error('Invalid lamp identity for update feedback.');
  const unresolved=new Set([...this.records].filter(([,value])=>value.terminal&&pending.has(value.outcome)).map(([id])=>id));for(const[id,token]of this.attempts)if(token.pendingReceipt)unresolved.add(id);
  if(!unresolved.has(id)&&unresolved.size>=32)throw Object.assign(Error('Previous lamp updates need confirmation before another update can start.'),{requiresReconciliation:true});
  const current=this.records.get(id),original=current?.terminal&&pending.has(current.outcome)?current:this.attempts.get(id)?.pendingReceipt;
  const pendingReceipt=(preservePending||original?.commitUnconfirmed===true)&&original?Object.freeze({...original}):null;
  const token=Object.freeze({id,...(pendingReceipt?{pendingReceipt}:{})});this.attempts.set(id,token);
  if(!pendingReceipt){this.records.delete(id);this.persist();}return token;
 }
 update(token,{message,progress:percent,terminal=false,outcome,targetVersion,commitUnconfirmed=false}={}){
  if(this.attempts.get(token?.id)!==token||typeof message!=='string')return false;
  const known=token.pendingReceipt,held=commitUnconfirmed===true||known?.commitUnconfirmed===true||this.records.get(token.id)?.commitUnconfirmed===true;
  const completed=outcome==='installed'&&targetVersion===known?.targetVersion&&!held;
  const result=terminal?known&&!completed?{outcome:known.outcome,targetVersion:known.targetVersion,commitUnconfirmed:held}:receipt({message,progress:percent,outcome,targetVersion,commitUnconfirmed:held}):held&&known?{outcome:known.outcome,targetVersion:known.targetVersion,commitUnconfirmed:true}:{};
  this.records.set(token.id,{message:message.slice(0,1200),terminal:Boolean(terminal),...(progress(percent)?{progress:percent}:{}),...result});
  if(terminal){this.attempts.delete(token.id);this.persist();}return true;
 }
 confirmInstalled(id,{version,verified=false,fresh=false}={}){
  const current=this.records.get(id);
  if(!verified||!fresh||current?.commitUnconfirmed===true||this.attempts.has(id)||!current?.terminal||!pending.has(current.outcome)||!validVersion(version))return false;
  if(compareFirmwareVersions(version,current.targetVersion)<0)return false;
  this.records.set(id,{message:'Firmware '+version+' installed.',terminal:true,progress:100,outcome:'installed',targetVersion:current.targetVersion});
  this.persist();return true;
 }
 markCommitUnconfirmed(id,{targetVersion}={}){
  const current=this.records.get(id),known=this.attempts.get(id)?.pendingReceipt||current;
  if(!identity(id)||!validVersion(targetVersion)||!known||known.targetVersion!==targetVersion||!pending.has(known.outcome))
   throw Object.assign(Error('The original update receipt changed. Keep your lamp powered while we check its software.'),{uncertain:true,commitUnconfirmed:true,requiresReconciliation:true});
  this.records.set(id,{message:current?.message||known.message,terminal:true,outcome:known.outcome,targetVersion,commitUnconfirmed:true});
  this.persist(true);return this.get(id);
 }
 remove(id){this.attempts.delete(id);this.records.delete(id);this.persist();}
 persist(requireDurable=false){try{
  const durable=new Map([...this.records].filter(([,value])=>value.terminal));
  for(const[id,token]of this.attempts)if(token.pendingReceipt){const current=this.records.get(id);durable.set(id,current?.commitUnconfirmed===true?{...token.pendingReceipt,commitUnconfirmed:true}:token.pendingReceipt);}
  const unresolved=[...durable].filter(([,value])=>pending.has(value.outcome)),completed=[...durable].filter(([,value])=>!pending.has(value.outcome));
  const rows=[...(unresolved.length<32?completed.slice(-(32-unresolved.length)):[]),...unresolved];
  if(rows.length>32)throw Error('Pending feedback capacity exceeded.');
  const text=JSON.stringify(rows.map(([id,value])=>({id,...value})));this.storage?.setItem(key,text);
  if(requireDurable&&this.storage?.getItem(key)!==text)throw Error('Update receipt was not retained.');
 }catch(error){if(requireDurable)throw Object.assign(Error('The final installation is not confirmed, and this phone could not save that status. Keep your lamp powered while we check it.'),{journalFailure:true,uncertain:true,commitUnconfirmed:true,requiresReconciliation:true,beforeMutation:false,cause:error});}}
}
