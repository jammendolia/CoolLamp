const record=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const text=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;

export const DEFAULT_LOCAL_HOME=Object.freeze({
 id:'local-home',
 name:'My home',
 mode:'local-only'
});

export function microphoneProvisioningDefault(productKind,explicit){
 if(typeof explicit==='boolean')return explicit;
 return productKind==='lamp'||productKind==='super-lamp';
}

export function normalizeHomeContext(value){
 const source=record(value)?value:{};
 const homes=Array.isArray(source.homes)?source.homes.filter(record).map(home=>({
  id:text(home.id),name:text(home.name,'My home'),mode:['local-only','hybrid','account-linked'].includes(home.mode)?home.mode:'local-only'
 })).filter(home=>home.id):[];
 if(!homes.length)homes.push({...DEFAULT_LOCAL_HOME});
 const active=homes.find(home=>home.id===source.activeHomeId)||homes[0];
 return Object.freeze({version:1,activeHomeId:active.id,homes:Object.freeze(homes.map(Object.freeze)),active:Object.freeze({...active})});
}

export function readHomeContext(storage){
 try{
  const raw=storage?.getItem?.('coollamp-ecosystem-v1');
  if(!raw)return normalizeHomeContext();
  if(raw.length>16384)throw Error('Home record too large');
  return normalizeHomeContext(JSON.parse(raw));
 }catch{return normalizeHomeContext();}
}

const roomFor=(lamp,rooms)=>text(lamp?.room,text(rooms?.[lamp?.id],'My home'));
const groupMembers=group=>[group?.leader||group,...(Array.isArray(group?.followers)?group.followers:[])].filter(record);

export function buildLightsOverview(model,{rooms={},groupNames={}}={}){
 const lamps=Array.isArray(model?.lamps)?model.lamps.filter(record):[];
 const groups=Array.isArray(model?.groups)?model.groups.filter(record):[];
 const devices=lamps.map(lamp=>Object.freeze({
  id:lamp.id,
  name:text(lamp.name,'CoolLamp'),
  room:roomFor(lamp,rooms),
  kind:text(lamp.productKind,lamp.role==='bridge'?'bridge':'lamp'),
  lampStyle:record(lamp.lampStyle)?Object.freeze({...lamp.lampStyle}):lamp.lampStyle,
  phoneLampStyle:text(lamp.phoneLampStyle)
 }));
 const roomMap=new Map();
 for(const device of devices){
  const list=roomMap.get(device.room)||[];list.push(device);roomMap.set(device.room,list);
 }
 const roomRows=[...roomMap].map(([name,devices])=>Object.freeze({name,devices:Object.freeze([...devices])})).sort((a,b)=>a.name.localeCompare(b.name));
 const groupRows=groups.map(group=>{
  const members=groupMembers(group),separate=members.filter(member=>member?.sync?.paused===true||member?.sync?.active===false&&member?.sync?.role===2).length;
  return Object.freeze({
   id:group.id,
   name:text(groupNames?.[group.id],text(group.name,'Light group')),
   count:Math.max(1,members.length),
   separate,
   available:group.available===true,
   attention:Boolean(group.removalPending||group.pendingRemovalIds?.length)
  });
 });
 return Object.freeze({rooms:Object.freeze(roomRows),groups:Object.freeze(groupRows),devices:Object.freeze(devices)});
}

export function automationPresentation(value,{now=Date.now()}={}){
 const service=record(value)?value:{},pageStates=new Set(['idle','checking','ready','unreachable','attention','not-configured']);
 const pageState=pageStates.has(service.state)?service.state:'not-configured';
 const clockLabel=value=>{
  if(value?.kind==='midnight')return 'midnight';
  if(value?.kind!=='clock'||typeof value.value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.value))return null;
  const [rawHour,minute]=value.value.split(':').map(Number),suffix=rawHour<12?'AM':'PM',hour=rawHour%12||12;
  return `${hour}:${String(minute).padStart(2,'0')} ${suffix}`;
 };
 const rows=(Array.isArray(service.schedules)?service.schedules:[]).filter(record).slice(0,16).map(source=>{
  const state=['on','paused','changed','attention'].includes(source.state)?source.state:'attention',when=clockLabel(source.nextEvent?.when);
  const next=pageState==='ready'&&when&&['turn-on','turn-off'].includes(source.nextEvent?.action)?Object.freeze({action:source.nextEvent.action,when,label:`${source.nextEvent.action==='turn-on'?'On':'Off'} at ${when}`}):null;
  let status='On',detail='Every day · Sunset to midnight';
  if(state==='paused'){status='Paused';detail='It won’t run until resumed.';}
  else if(state==='changed'){status='Changed';detail=when?`Changed until ${when}`:'Changed until the next scheduled time';}
  else if(state==='attention'){
   status='Needs attention';
   detail=source.reasonCode==='home-location-needed'?'Home location is needed.':source.reasonCode==='schedule-time-not-ready'?'The schedule time needs attention.':source.reasonCode==='sunset-time-unavailable'?'Sunset time needs attention.':'This schedule needs attention.';
  }
  if(pageState!=='ready'&&Number.isSafeInteger(service.lastUpdatedAt)){detail=`${status} · ${detail}`;status='Last checked';}
  let action=null;
  if(pageState==='ready'&&state==='attention'){
   if(source.primaryAction==='check-again'||source.primaryAction==='check-home-location')action=Object.freeze({id:'retry-automations',label:'Check again'});
   else if(source.primaryAction==='set-home-location')action=Object.freeze({id:'automation-location-help',label:'Set up location'});
   else action=Object.freeze({id:'automation-storage-help',label:'View recovery'});
  }
  return Object.freeze({
   id:text(source.id).slice(0,64),name:text(source.name,'Saved schedule').slice(0,64),state,status,detail,next,
   manualHold:source.manualHold===true,reasonCode:text(source.reasonCode).slice(0,64),primaryAction:text(source.primaryAction).slice(0,64),action
  });
 }).filter(row=>row.id);
 const lastUpdatedAt=Number.isSafeInteger(service.lastUpdatedAt)&&service.lastUpdatedAt>=0&&service.lastUpdatedAt<=now?service.lastUpdatedAt:null;
 const age=lastUpdatedAt===null?null:Math.max(0,now-lastUpdatedAt),lastUpdatedLabel=age===null?null:age<60000?'just now':age<3600000?`${Math.floor(age/60000)} minute${Math.floor(age/60000)===1?'':'s'} ago`:age<86400000?`${Math.floor(age/3600000)} hour${Math.floor(age/3600000)===1?'':'s'} ago`:'more than a day ago';
 let notice=null,empty=null;
 if(pageState==='checking')notice=Object.freeze({kind:'checking',title:'Checking schedules…',detail:rows.length?`Last updated ${lastUpdatedLabel||'earlier'}. We’re checking again now.`:'This can take a moment.',action:null});
 else if(pageState==='unreachable')notice=Object.freeze({kind:'problem',title:'Schedules couldn’t be refreshed.',detail:rows.length?`Last updated ${lastUpdatedLabel||'earlier'}. Your saved schedule is still listed below.`:'Keep your display powered on, then try again.',action:Object.freeze({id:'retry-automations',label:'Try again'})});
 else if(pageState==='attention'){
  const connection=['access-needed','identity-changed','invalid-response','update-needed','route-invalid','schedule-home-assignment-needed','schedule-provider-choice-needed','schedule-household-proof-needed'].includes(service.reasonCode);
  notice=Object.freeze({kind:'problem',title:connection?'Schedule setup needs attention.':'Schedule status needs attention.',detail:connection?'Check this Home’s saved connection in Settings.':'Try checking the schedule again.',action:Object.freeze({id:connection?'automation-recovery':'retry-automations',label:connection?'Open Settings':'Try again'})});
 }else if(pageState==='idle')notice=Object.freeze({kind:'quiet',title:'Schedule status has not been checked.',detail:'Check now to see what is coming next.',action:Object.freeze({id:'retry-automations',label:'Check schedules'})});
 else if(pageState==='not-configured')empty=Object.freeze({title:'Schedules are coming soon.',detail:'When schedules are available for this Home, they’ll appear here.'});
 const nextRow=rows.find(row=>row.next&&(row.state==='on'||row.state==='changed'));
 const next=nextRow?Object.freeze({scheduleId:nextRow.id,label:nextRow.state==='changed'?`${nextRow.name} returns to its schedule at ${nextRow.next.when}`:`${nextRow.name} turns ${nextRow.next.action==='turn-on'?'on':'off'} at ${nextRow.next.when}`}):null;
 return Object.freeze({state:pageState,lastUpdatedAt,lastUpdatedLabel,notice,empty,next,schedules:Object.freeze(rows)});
}
