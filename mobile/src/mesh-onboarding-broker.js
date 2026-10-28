const canonical=value=>typeof value==='string'&&/^[a-f0-9]{12}$/.test(value);
const cancelled=()=>Object.assign(Error('New-device discovery changed.'),{cancelled:true,confirmed:true});
const expired=()=>Object.assign(Error('The saved lamp did not connect before the discovery deadline.'),{routeTimeout:true,confirmed:true});
const routeNames={wifi:'Wi-Fi',bluetooth:'saved Bluetooth',mesh:'the lamp network'};

// Enrollment discovery has a small read-only budget. It must not spend that
// budget on stale HTTP settings before trying an already authorized radio.
export async function acquireOnboardingBroker({entry,active=null,wifiFresh=false,bluetoothAuthorized=false,
 acquireRoute,onRouteRetired=()=>{},signal,isCurrent=()=>true,now=Date.now,timeoutMs=7500,routeTimeoutMs=4000}={}){
 if(!canonical(entry?.id)||typeof acquireRoute!=='function')throw Error('Choose an existing saved lamp for discovery.');
 const deadline=now()+Math.min(7500,Math.max(1,timeoutMs));
 const guard=()=>{if(signal?.aborted||!isCurrent())throw cancelled();if(now()>=deadline)throw expired();};
 guard();
 if(active?.verified===true&&active.isCurrent?.()!==false){
  if(active.lamp?.identity!==entry.id||typeof active.lamp.request!=='function')throw Object.assign(Error('The active discovery lamp has a different identity.'),{identity:true,confirmed:true});
  return {lamp:active.lamp,release:async()=>{}};
 }
 const routes=[];
 if(entry.address&&wifiFresh)routes.push('wifi');
 if(entry.deviceId&&bluetoothAuthorized)routes.push('bluetooth');
 if(entry.address&&!wifiFresh)routes.push('wifi');
 routes.push('mesh');
 const failures=[],released=new WeakSet();
 const release=async lease=>{if(!lease||typeof lease!=='object'||released.has(lease))return;released.add(lease);try{await lease.release?.();}catch{}};
 for(const route of routes){
  guard();
  const controller=new AbortController(),remaining=Math.min(Math.max(1,routeTimeoutMs),deadline-now());
  let timer,abort,retired=false,lease;
  const current=()=>!controller.signal.aborted&&!signal?.aborted&&isCurrent()&&now()<deadline;
  const pending=Promise.resolve().then(()=>{guard();return acquireRoute(route,{readOnly:true,onboardingRoute:route,
   signal:controller.signal,isCurrent:current,timeoutMs:remaining});});
  pending.then(value=>{if(retired)void release(value);},()=>{});
  try{
   lease=await Promise.race([pending,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(expired()),remaining);abort=()=>reject(cancelled());
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
   })]);
   guard();
   if(lease?.lamp?.identity!==entry.id||typeof lease.lamp.request!=='function')throw Object.assign(Error('A different lamp answered discovery.'),{identity:true,confirmed:true});
   return lease;
  }catch(error){
   retired=true;controller.abort();try{onRouteRetired(route,controller.signal);}catch{}await release(lease);
   if(signal?.aborted||!isCurrent()||error.cancelled&&!error.routeTimeout)throw cancelled();
   if(error.identity)throw error;
   // Never put a raw HTTP response or parser excerpt into the setup screen.
   const reason=error.routeTimeout?' did not respond in time.':error.needsPassword?' needs its saved access password.':
    route==='wifi'&&error instanceof SyntaxError?' returned incomplete or invalid settings.':' could not be read.';
   failures.push(routeNames[route]+reason);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 guard();throw Object.assign(Error(failures.join(' ')),{discoveryFailure:true,confirmed:true});
}

export function onboardingDiscoveryMessage(result,failures=[]){
 if(result?.cancelled)return '';
 if(result?.candidates?.length)return 'Choose the new device shown above your lamps.';
 if(failures.length)return 'No new device was confirmed. '+failures.slice(0,3).map(value=>{
  const name=String(value.name||'Saved lamp').replace(/[\x00-\x1f\x7f]/g,'').slice(0,64);
  const reason=value.error?.discoveryFailure===true?value.error.message:value.error?.routeTimeout?
   'The saved connection did not respond in time.':'Could not read its new-device list.';
  return name+': '+reason;
 }).join(' ')+' Connect a saved lamp by Bluetooth, then try Add through another lamp again.';
 return 'No new device was found nearby. Keep it near an existing lamp, connect that saved lamp by Bluetooth, then try again.';
}
