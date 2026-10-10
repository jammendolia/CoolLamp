const sameScope=(context,job)=>Boolean(context)&&context.id===job.id&&context.section===job.section&&context.navigation===job.navigation;
const usable=context=>Boolean(context&&typeof context.id==='string'&&context.id&&typeof context.section==='string'&&context.section&&
  context.navigation!==undefined&&context.active===true&&context.blocked!==true&&context.hidden!==true);
const timeoutError=()=>Object.assign(Error('The lamp did not reconnect in time.'),{code:'SETTINGS_RECONNECT_TIMEOUT',timeout:true});
const unverifiedError=()=>Object.assign(Error('The lamp connection could not be verified.'),{code:'SETTINGS_LINK_NOT_VERIFIED'});
export function settingsConnectionMessage(message,{active=false,connected=false,name='',unconfirmed=false}={}){
  if(!active||connected||!name||typeof message!=='string'||!/reconnect|disconnected|did not respond/i.test(message))return message;
  return (unconfirmed?'The earlier change was not confirmed. ':'')+'Reconnecting to '+name+'…';
}

// Candidate discovery has already checked which lamps the phone may use. Keep
// that order within each route, but reserve a Bluetooth fallback when Wi-Fi is
// down; a large saved inventory must not consume both bounded attempts on Wi-Fi.
export function selectMeshRecoveryCandidates(candidates){
  if(!Array.isArray(candidates))return [];
  const routes=candidates.filter(candidate=>candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&
    (candidate.transport||['wifi','bluetooth'].includes(candidate.kind)));
  const selected=[];
  const add=candidate=>{if(candidate&&!selected.includes(candidate)&&selected.length<2)selected.push(candidate);};
  add(routes.find(candidate=>candidate.transport)||routes.find(candidate=>candidate.kind==='wifi'));
  add(routes.find(candidate=>candidate.kind==='bluetooth'));
  for(const candidate of routes)add(candidate);
  return selected;
}

// Owns only connection recovery. The reconnect adapter must establish/read a
// route, never replay a lamp command, and honor signal/isCurrent before any
// selection or UI change. One native flight remains reserved until it settles,
// even after cancellation: an ignored abort cannot overlap a new connection.
export class SettingsConnectionRecovery {
  constructor({getContext,reconnect,onStatus=()=>{},onFailure=()=>{},now=Date.now,timeoutMs=25000,retryDelayMs=1200,maxAttempts=2}={}){
    if(typeof getContext!=='function'||typeof reconnect!=='function'||typeof onStatus!=='function'||typeof onFailure!=='function'||typeof now!=='function')
      throw TypeError('Settings recovery needs context, reconnect and callback functions.');
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||!Number.isFinite(retryDelayMs)||retryDelayMs<0||!Number.isInteger(maxAttempts)||maxAttempts<1)
      throw RangeError('Choose a bounded recovery deadline and attempt count.');
    Object.assign(this,{getContext,reconnect,onStatus,onFailure,now,timeoutMs,retryDelayMs,maxAttempts});
    this.job=null;this.flight=null;this.disposed=false;
  }
  get active(){return this.job!==null;}
  context(){try{return this.getContext();}catch{return null;}}
  time(){try{const value=this.now();if(Number.isFinite(value))return value;}catch{}return Date.now();}
  current(job){const context=this.context();return !this.disposed&&this.job===job&&!job.controller.signal.aborted&&usable(context)&&sameScope(context,job);}
  status(job,state){try{this.onStatus({state,id:job.id,name:job.name,attempt:job.attempt});}catch{/* UI callbacks cannot strand a connection lease. */}}
  clearTimers(job){if(job.deadlineTimer!==null)clearTimeout(job.deadlineTimer);if(job.retryTimer!==null)clearTimeout(job.retryTimer);job.deadlineTimer=null;job.retryTimer=null;}
  finish(job,state,error=null){
    if(this.job!==job)return;
    const reportFailure=state==='failed'&&this.current(job);
    this.clearTimers(job);this.job=null;job.finished=true;
    if(!job.controller.signal.aborted)job.controller.abort(state);
    if(reportFailure){try{this.onFailure({id:job.id,name:job.name,section:job.section,navigation:job.navigation,attempt:job.attempt,error,timeout:error?.timeout===true});}catch{/* Still settle the public job. */}}
    this.status(job,state==='connected'?'connected':'idle');
    job.resolve({state,id:job.id,name:job.name,attempt:job.attempt,...(error?{error}:{})});
  }
  expire(job){
    if(this.job!==job)return;
    if(!this.current(job)){this.finish(job,'cancelled');return;}
    const connected=this.context()?.connected===true;
    this.finish(job,connected?'connected':'failed',connected?null:timeoutError());
  }
  check(){
    if(this.disposed)return Promise.resolve({state:'idle'});
    const context=this.context(),existing=this.job;
    if(existing&&(!usable(context)||!sameScope(context,existing))){this.finish(existing,'cancelled');}
    else if(existing){
      if(context.connected===true){
        // A protected state callback can arrive before its connection promise
        // returns. Keep that adapter's ownership fence valid through completion.
        if(this.flight?.job!==existing)this.finish(existing,'connected');
        return existing.promise;
      }
      if(this.time()>=existing.deadline){this.expire(existing);return existing.promise;}
      this.pump(existing);return existing.promise;
    }
    if(!usable(context)||context.connected!==false)return Promise.resolve({state:'idle'});
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const job={id:context.id,name:typeof context.name==='string'&&context.name?context.name:'Your lamp',section:context.section,navigation:context.navigation,
      controller:new AbortController(),attempt:1,startedAttempt:0,deadline:this.time()+this.timeoutMs,deadlineTimer:null,retryTimer:null,finished:false,promise,resolve};
    this.job=job;job.deadlineTimer=setTimeout(()=>this.expire(job),this.timeoutMs);
    this.status(job,'reconnecting');this.pump(job);return promise;
  }
  pump(job){
    if(this.job!==job||job.retryTimer!==null||this.flight)return;
    if(!this.current(job)){this.finish(job,'cancelled');return;}
    if(this.time()>=job.deadline){this.expire(job);return;}
    if(this.context()?.connected===true){this.finish(job,'connected');return;}
    if(job.startedAttempt===job.attempt)return;
    const flight={job,attempt:job.attempt};this.flight=flight;job.startedAttempt=job.attempt;
    // Deferring invocation gives a synchronous navigation/cancel the same fence
    // as an asynchronous one. Both fulfillment and late rejection are consumed.
    const pending=Promise.resolve().then(()=>{
      if(!this.current(job)||this.context()?.connected===true)return;
      return this.reconnect({id:job.id,name:job.name,section:job.section,navigation:job.navigation,signal:job.controller.signal,
        attempt:flight.attempt,isCurrent:()=>this.current(job)});
    });
    pending.then(()=>this.settle(flight,null),error=>this.settle(flight,error)).catch(()=>{/* Defensive consumption of a callback failure. */});
  }
  settle(flight,error){
    if(this.flight!==flight)return;
    this.flight=null;
    const job=flight.job;
    if(this.job===job){
      if(!this.current(job))this.finish(job,'cancelled');
      else if(this.context()?.connected===true)this.finish(job,'connected');
      else if(this.time()>=job.deadline)this.expire(job);
      else if(job.attempt>=this.maxAttempts)this.finish(job,'failed',error||unverifiedError());
      else{
        job.retryTimer=setTimeout(()=>{
          job.retryTimer=null;
          if(!this.current(job)){if(this.job===job)this.finish(job,'cancelled');return;}
          if(this.time()>=job.deadline){this.expire(job);return;}
          if(this.context()?.connected===true){this.finish(job,'connected');return;}
          job.attempt++;this.status(job,'reconnecting');this.pump(job);
        },this.retryDelayMs);
      }
    }
    // A newly selected scope can be waiting behind an old aborted flight.
    if(this.job)this.pump(this.job);
  }
  cancel(){if(this.job)this.finish(this.job,'cancelled');}
  dispose(){if(this.disposed)return;this.disposed=true;this.cancel();}
}
