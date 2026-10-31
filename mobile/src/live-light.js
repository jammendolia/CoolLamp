// Latest unsent slider values are coalesced; submitted commands are never
// replayed. Scope and the owning UI gate are checked immediately before send.
export class LiveLightQueue {
 constructor({send,current,ready=()=>true,error=()=>{},settled=()=>{},discarded=()=>{},delay=120,set=(...args)=>globalThis.setTimeout(...args),clear=timer=>globalThis.clearTimeout(timer),now=()=>performance.now()}) {
  Object.assign(this,{send,current,ready,error,settled,discarded,delay,set,clear,now});this.values=new Map();this.timer=null;this.running=false;this.generation=0;
 }
 key(operation,option){if(operation==='brightness')return 'brightness';if(operation==='effectOptions'&&['speed','intensity'].includes(option))return option;throw Error('Unsupported live light control.');}
 scopeMatches(a,b){return a?.id===b?.id&&a?.target===b?.target&&a?.epoch===b?.epoch&&a?.token===b?.token&&a?.mode===b?.mode;}
 schedule(scope,operation,value,option=null){
  const key=this.key(operation,option);if(!this.current(scope)){this.discarded(scope,'unavailable');return false;}
  if(this.scope&&!this.scopeMatches(this.scope,scope))this.cancel();this.scope=scope;
  this.values.set(key,{scope,operation,value,option,at:this.now()});this.arm();return true;
 }
 get pending(){return this.running||this.values.size>0;}
 arm(){if(this.timer!==null||this.running||!this.values.size)return;this.timer=this.set(()=>{this.timer=null;void this.run();},this.delay);}
 cancel(){++this.generation;if(this.timer!==null)this.clear(this.timer);this.timer=null;this.values.clear();this.scope=null;}
 async run(){
  if(this.running)return;const entry=this.values.entries().next().value;if(!entry)return;
  const [key,change]=entry;
  const current=this.current(change.scope);
  if(!current||this.now()-change.at>10000){this.cancel();this.discarded(change.scope,current?'expired':'unavailable');return;}
  if(!this.ready()){this.arm();return;}
  const generation=this.generation;this.values.delete(key);this.running=true;
  try{await this.send(change);}
  catch(error){if(generation===this.generation&&this.current(change.scope)){this.cancel();this.error(error);if(this.current(change.scope))this.settled();}}
  finally{this.running=false;this.arm();if(generation===this.generation&&this.current(change.scope)&&!this.values.size)this.settled();}
 }
}
