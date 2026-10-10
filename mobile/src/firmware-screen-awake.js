const cancelled=reason=>Object.assign(Error(reason==='app-hidden'?'Update stopped because the app left the foreground. Keep the app open while updating.':reason==='user'?'Bluetooth update cancelled.':'The update connection changed. Choose this lamp again before updating.'),{cancelled:true,stopReason:reason==='app-hidden'||reason==='user'?reason:'target-changed'});
const tokenValue=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
export class FirmwareScreenAwake {
 constructor({native,enabled=true,timeout=5000,token=tokenValue()}={}){Object.assign(this,{native,enabled,timeout,token});this.requested=false;this.released=false;}
 async bounded(pending,signal){
  let timer,abort;
  try{return await Promise.race([pending,new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('Screen-awake request timed out.')),this.timeout);
   abort=()=>reject(cancelled(signal.reason));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 acquire({signal,isCurrent=()=>true}={}){
  if(this.acquirePromise)return this.acquirePromise;
  this.acquirePromise=(async()=>{
   if(this.released||signal?.aborted||!isCurrent())throw cancelled(signal?.reason);
   if(!this.enabled)return this;
   this.requested=true;
   const pending=Promise.resolve().then(()=>{if(this.released||signal?.aborted||!isCurrent())throw cancelled(signal?.reason);return this.native.setFirmwareScreenAwake({token:this.token,enabled:true});});
   // The native reply can arrive after cancellation or a deadline. Release
   // only this attempt's token; a newer native lease cannot be disabled.
   pending.then(()=>{if(this.released)void Promise.resolve().then(()=>this.native.setFirmwareScreenAwake({token:this.token,enabled:false})).catch(()=>{});},()=>{});
   try{
    const value=await this.bounded(pending,signal);
    if(this.released||signal?.aborted||!isCurrent())throw cancelled(signal?.reason);
    if(value?.active!==true)throw Error('Screen protection was not confirmed.');
    return this;
   }catch(error){await this.release();if(error.cancelled)throw error;throw Error('Could not keep the phone’s screen awake. No firmware was sent. Keep the app open and the screen unlocked, then try again.');}
  })();return this.acquirePromise;
 }
 release(){
  if(this.releasePromise)return this.releasePromise;
  this.released=true;
  this.releasePromise=this.enabled&&this.requested?this.bounded(Promise.resolve().then(()=>this.native.setFirmwareScreenAwake({token:this.token,enabled:false}))).catch(()=>{}):Promise.resolve();
  return this.releasePromise;
 }
}
