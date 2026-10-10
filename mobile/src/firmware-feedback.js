const key='coollamp-firmware-feedback-v1';
const identity=value=>typeof value==='string'&&/^(?:[0-9a-f]{12}|ble:[^\s]{1,120})$/.test(value);
const progress=value=>Number.isInteger(value)&&value>=0&&value<=100;
// Only human-readable results and acknowledged progress are retained. Session
// handles, firmware bytes, credentials and native response objects stay out.
export class FirmwareFeedback {
 constructor(storage){
  this.storage=storage;this.records=new Map();this.attempts=new Map();
  try{const rows=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(rows))for(const row of rows.slice(-32))if(identity(row?.id)&&typeof row.message==='string'&&row.message.length<=1200&&row.terminal===true)this.records.set(row.id,{message:row.message,terminal:true,...(progress(row.progress)?{progress:row.progress}:{})});}catch{}
 }
 get(id){return this.records.get(id);}
 begin(id){
  if(!identity(id))throw Error('Invalid lamp identity for update feedback.');
  const token=Object.freeze({id});this.attempts.set(id,token);this.records.delete(id);this.persist();return token;
 }
 update(token,{message,progress:percent,terminal=false}={}){
  if(this.attempts.get(token?.id)!==token||typeof message!=='string')return false;
  this.records.set(token.id,{message:message.slice(0,1200),terminal:Boolean(terminal),...(progress(percent)?{progress:percent}:{})});
  if(terminal){this.attempts.delete(token.id);this.persist();}return true;
 }
 remove(id){this.attempts.delete(id);this.records.delete(id);this.persist();}
 persist(){try{this.storage?.setItem(key,JSON.stringify([...this.records].filter(([,value])=>value.terminal).slice(-32).map(([id,value])=>({id,...value}))));}catch{}}
}
