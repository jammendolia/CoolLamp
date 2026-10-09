const credentialId='coollamp-firmware-fleet-v1';
const valid=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value)&&!/^0+$/.test(value);
export class FirmwareFleetTrust {
 constructor({credential,getPairedLamps}){Object.assign(this,{credential,getPairedLamps});this.keyRun=null;this.tasks=new Map();}
 async key(){
  if(this.keyRun)return this.keyRun;
  this.keyRun=(async()=>{
   let value=(await this.credential(credentialId))?.value;
   if(value&&!valid(value))throw Error('Saved firmware fleet trust is invalid. Existing trust was preserved.');
   if(!value){value=[...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');await this.credential(credentialId,value);if((await this.credential(credentialId))?.value!==value)throw Error('Could not save firmware fleet trust securely.');}
   return value;
  })().catch(error=>{this.keyRun=null;throw error;});return this.keyRun;
 }
 provision(transport,{isCurrent=()=>true}={}){
  if(!transport?.control?.capabilities?.includes('firmware-relay'))return Promise.resolve({supported:false});
  const id=transport.identity,deviceId=transport.id,epoch=transport.epoch;
  const paired=()=>this.getPairedLamps().some(entry=>entry.id===id&&entry.deviceId===deviceId);
  if(!paired())return Promise.reject(Error('Only lamps paired with this phone can join its firmware fleet.'));
  if(this.tasks.has(id))return this.tasks.get(id);
  const current=()=>{if(!isCurrent()||!paired()||transport.identity!==id||transport.id!==deviceId||transport.epoch!==epoch)throw Object.assign(Error('Paired lamp changed. Fleet trust was not sent.'),{cancelled:true,confirmed:true});};
  const task=(async()=>{
   const key=await this.key();current();
   // Idempotent receiver preserves any different existing owner. The key is
   // never returned by the lamp, stored in cards, or sent over local HTTP.
   const reply=await transport.request('/api/firmware/fleet',{key},epoch,current);current();
   let result;try{result=typeof reply==='string'?JSON.parse(reply):reply;}catch{throw Error('Lamp did not confirm its firmware fleet.');}
   if(result?.version!==1||result.paired!==true||!/^[a-f0-9]{16}$/.test(result.fleetId))throw Error('Lamp did not confirm its firmware fleet.');
   return {supported:true,paired:true,fleetId:result.fleetId,automatic:result.automatic===true};
  })().finally(()=>{if(this.tasks.get(id)===task)this.tasks.delete(id);});this.tasks.set(id,task);return task;
 }
}
