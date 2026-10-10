import {effectSettings} from './effect-settings.js';
import {groupScenes, availableGroupScenes} from './group-scenes.js';
import {effectSchemaPage} from './experience-contracts.js';
import {groupMemberLimit, supportsGroupProtocol} from './sync.js';

// Presentation only: metadata cannot choose a URL, command, executable adapter,
// or HTML. Wire IDs always come from this target's catalog/schema.
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const rgb=value=>Array.isArray(value)&&value.length===3&&value.every(channel=>integer(channel,0,255));
const readable=value=>typeof value==='string'&&value.trim()&&new TextEncoder().encode(value).length<=96&&!/[\x00-\x1f\x7f]/.test(value)?value.trim():null;
const color=value=>rgb(value)?value.slice():null;
const hex=value=>rgb(value)?'#'+value.map(channel=>channel.toString(16).padStart(2,'0')).join(''):null;
const effectKeys=['pacifica','aurora','rain','fire','split-fire-rising','split-fire-falling','split-fire-rising-reversed-colors','blue-gas-fire','witch-fire','purple-fire','embers','lava','plasma','rainbow','rainbow-glitter','confetti','comet-collision','sinelon','bpm','juggle','white','red','green','blue','purple','pink','yellow','cyan','custom-solid','droplets-rising','lightning-storm','color-tide','fireflies','heartbeat','shooting-stars','breathing-glow','lava-blobs','droplets-falling','sound-glow','sound-meter','spectrum-rise','bass-launch','spectral-embers','beat-bloom','three-band-fountain','vu-meter','rainbow-embers'];
const effectNames=['Pacifica','Aurora','Rain','Fire','Split fire - rising','Split fire - falling','Split fire - rising, reversed colors','Blue gas fire','Witch fire','Purple fire','Embers','Lava','Plasma','Rainbow','Rainbow with glitter','Confetti','Comet collision','Sinelon','BPM','Juggle','White','Red','Green','Blue','Purple','Pink','Yellow','Cyan','Custom solid','Bouncing droplets - rising','Lightning storm','Color tide','Fireflies','Heartbeat','Shooting stars','Breathing glow','Lava blobs','Bouncing droplets - falling','Sound glow','Sound meter','Spectrum Rise','Bass Launch','Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter','Rainbow Embers'];
const namesByKey=new Map(effectKeys.map((key,index)=>['effect.'+key,effectNames[index]]));
const sceneKeys=['mirror','portal','ping-pong','stereo-fountain','duet','orbit','storm-front','ember-exchange','color-wave','newtons-cradle','conversation','constellation','tidal-basin','firefly-courtship','rocket-relay','prism-split','rhythm-section','beat-chase','shared-heartbeat','bass-cathedral','spectrum-loom','resonant-rings','velvet-thunder','prism-chorus','twin-vortex','electric-bloom','room-groove','chromatic-screw','mercury-ribbon','bass-turbine','prism-torque','echo-coils','aurora-braid'];
const scenesByKey=new Map(sceneKeys.map((key,index)=>['scene.'+key,groupScenes.find(scene=>scene.id===index)]));
const oldNames={'Split fire':'Split fire - rising','Split fire - outward':'Split fire - falling','Split fire - reversed colors':'Split fire - rising, reversed colors','Bouncing droplets':'Bouncing droplets - rising'};

function localId(entry){return entry?.localId??entry?.id;}
function kindOf(context){return context.kind==='scene'||context.kind==='scenes'?'scene':'effect';}
function schemaFor(entry,context={}){
  const id=localId(entry),kind=kindOf(context),target=context.targetId;
  const sources=[context.schema,context.schemas,kind==='scene'?context.sceneSchemas:null].filter(Boolean);
  for(const source of sources){
    let entries;
    if(Array.isArray(source))entries=source;
    else if(Array.isArray(source.entries)){
      // Raw pages must pass the existing wire contract and target fence.
      if(source.target!==target||source.kind!==(kind==='scene'?'scenes':'effects'))continue;
      try{entries=effectSchemaPage(source,target).entries;}catch{continue;}
    }else entries=[source];
    const match=entries.find(value=>value?.localId===id);
    if(!match||context.schemaTarget&&context.schemaTarget!==target)continue;
    if(match.target&&match.target!==target)continue;
    if(typeof match.key!=='string'||!match.key.startsWith(kind+'.'))continue;
    try{
      const owner=target||'000000000000';
      // The contract reader deliberately strips unknown parameter semantics.
      // Re-reading an already parsed page must retain that unavailable field.
      const normalized={...match,parameters:Array.isArray(match.parameters)?match.parameters.map(parameter=>parameter?.supported===false&&parameter.type!=='integer'?
        {...parameter,units:parameter.units||'unknown',semanticRole:parameter.semanticRole||'unknown'}:parameter):match.parameters};
      return effectSchemaPage({schemaVersion:2,target:owner,kind:kind==='scene'?'scenes':'effects',offset:0,next:1,total:1,entries:[normalized]},owner).entries[0];
    }catch{continue;}
  }
  return null;
}

export function effectDisplayName(entry){
  const explicit=readable(entry?.name)||readable(entry?.displayName);
  if(explicit)return explicit;
  const known=namesByKey.get(entry?.key)||scenesByKey.get(entry?.key)?.name;
  if(known)return known;
  const id=localId(entry);
  return integer(id,0,255)?'Effect '+id:'Choose an effect';
}

function profileFor(entry,schema,kind){
  if(kind==='scene'){
    const scene=schema?scenesByKey.get(schema.key):groupScenes.find(value=>value.id===localId(entry));
    return {description:scene?.description||readable(entry?.description)||'Light moves across your arranged lamps.',motion:localId(entry)!==0,
      intensity:localId(entry)!==0,speedLabel:scene?.speedLabel||'Flow speed',speedHint:'Set the pace across your lamps.',intensityLabel:'Scene glow',
      intensityHint:'The light level within this scene. Overall group brightness stays separate.',audio:scene?.audio===true,
      optionalAudio:scene?.optionalAudio===true,fixedColors:scene?.fixedColors===true,colorLabel:'First color',secondaryLabel:'Second color'};
  }
  const semanticName=namesByKey.get(schema?.key)||oldNames[entry?.name]||entry?.name;
  return effectSettings({...entry,name:semanticName});
}

function normalizedOptions(value,id){
  if(Array.isArray(value)&&value.length===6)value={mode:id,speed:value[0],intensity:value[1],dual:value[2],r:value[3],g:value[4],b:value[5]};
  if(value?.mode!==id||!integer(value.speed,1,100)||!integer(value.intensity,0,100)||![0,1,false,true].includes(value.dual)||!rgb([value.r,value.g,value.b]))return null;
  return {mode:id,speed:value.speed,intensity:value.intensity,dual:Boolean(value.dual),secondary:[value.r,value.g,value.b]};
}

// Missing values remain null; black, zero intensity, and off are valid values.
export function normalizeEffectAppearance(context={}){
  const state=context.state||context.raw||{},raw=context.raw||state,entry=context.entry,id=localId(entry)??state.mode,kind=kindOf(context),sync=context.sync||state.sync||raw.sync;
  const options=kind==='scene'?null:normalizedOptions(context.options,id)||normalizedOptions(raw.effectOptions?.[id-1],id);
  const slot=raw.colors?.[id-1];
  const activeColor=state.mode===id&&state.color&&typeof state.color.enabled==='boolean'&&rgb([state.color.r,state.color.g,state.color.b])?
    {enabled:state.color.enabled,rgb:[state.color.r,state.color.g,state.color.b]}:null;
  const savedColor=Array.isArray(slot)&&slot.length===4&&[0,1].includes(slot[0])&&rgb(slot.slice(1))?{enabled:Boolean(slot[0]),rgb:slot.slice(1)}:null;
  const primary=kind==='scene'?color(sync?.scenePrimary):(activeColor||savedColor)?.rgb||null;
  const secondary=kind==='scene'?color(sync?.sceneSecondary):options?.secondary||null;
  const palette=value=>Array.isArray(value)&&value.length===3&&value.every(rgb)?value.map(color):null;
  return {id,power:typeof state.power==='boolean'?state.power:null,brightness:integer(state.brightness,1,255)?state.brightness:null,
    speed:kind==='scene'?(integer(sync?.sceneSpeed,1,100)?sync.sceneSpeed:null):options?.speed??null,
    intensity:kind==='scene'?(integer(sync?.sceneIntensity,0,100)?sync.sceneIntensity:null):options?.intensity??null,
    custom:kind==='scene'?true:(activeColor||savedColor)?.enabled??null,dual:kind==='scene'?true:options?.dual??null,
    primary:color(primary),secondary:color(secondary),vuColors:palette(raw.vuColors),fountainColors:palette(raw.fountainColors)};
}

function microphoneFor(context,source){
  if(typeof context.microphone==='boolean')return context.microphone;
  const candidates=source==='coordinator'?[context.coordinator?.audio?.installed,context.state?.audio?.installed,context.raw?.audio?.installed]:
    [context.state?.audio?.installed,context.raw?.audio?.installed,context.descriptor?.hardware?.microphone];
  return candidates.find(value=>typeof value==='boolean')??null;
}

function audioFor(entry,schema,profile,context,kind){
  const required=schema?schema.audio.required:profile.audio&&!profile.optionalAudio;
  const optional=schema?schema.audio.optional===true:profile.optionalAudio===true;
  const source=schema?.audio.source||(kind==='scene'?'coordinator':required?'local-or-coordinator':'none');
  const available=microphoneFor(context,source),audio=context.audio||context.raw?.audio||context.state?.audio;
  const hasTuning=audio&&integer(audio.gain,1,64)&&integer(audio.gate,0,1024);
  const controls=hasTuning?[
    {key:'gain',label:'Sensitivity',hint:'How strongly the lamp reacts to sound.',min:1,max:64,step:1,value:audio.gain},
    {key:'gate',label:'Ignore quiet sounds',hint:'Raise this to ignore background noise.',min:0,max:1024,step:1,value:audio.gate},
    ...(integer(audio.scale,100,400)?[{key:'scale',label:'Sound contrast',hint:'The difference between soft and strong sounds.',min:100,max:400,step:1,value:audio.scale}]:[])
  ]:[];
  return {required,optional,source,available,visible:required||optional,shared:true,
    scope:kind==='scene'?'All sound effects in this group':'All sound effects using this microphone',
    editable:hasTuning&&available===true&&context.canConfigureAudio!==false,
    restarts:hasTuning&&audio.liveTuning!==true,controls,
    hint:available===false&&required?'Choose a lamp with a microphone.':hasTuning?'These settings are shared across sound effects.':'Connect to read this lamp’s sound settings.'};
}

export function effectCompatibility(entry,context={}){
  const kind=kindOf(context),schema=schemaFor(entry,context),id=localId(entry),profile=profileFor(entry,schema,kind),audio=audioFor(entry,schema,profile,context,kind);
  const issues=[];
  const issue=(code,message,status='blocked',ids=[])=>issues.push({code,message,status,ids});
  if(!integer(id,kind==='scene'?0:1,255))issue('invalid-effect','This lamp did not report a supported effect.');
  if(audio.required&&audio.available!==true)issue('microphone',audio.available===false?'This effect needs a lamp with a microphone.':'Connect to check the sound source.',audio.available===false?'blocked':'unknown');
  if(kind==='scene'&&id>0){
    const sync=context.sync||context.state?.sync||context.raw?.sync;
    const groupSize=context.groupSize??sync?.count;
    if(integer(groupSize,0,32)&&groupSize<2)issue('group-size','Add a second lamp to use effects across the room.');
    const count=context.sceneCount??sync?.sceneCount;
    if(Number.isInteger(count)&&id>count)issue('scene-version','Update the main lamp to use this scene.');
    const members=Array.isArray(context.members)?context.members:[];
    const incompatible=[],unknown=[];
    for(const member of members){
      const memberSync=member.sync||member.raw?.sync;
      if(member.verified!==true||member.available!==true||!Number.isInteger(memberSync?.sceneCount)){unknown.push(member.id);continue;}
      const protocol=schema?.requirements?.sceneProtocol||2;
      const expanded=integer(groupSize,10,32)?schema?.requirements?.expandedSceneProtocol||3:protocol;
      if(id>memberSync.sceneCount||!supportsGroupProtocol(memberSync,expanded)||integer(groupSize,1,32)&&groupSize>groupMemberLimit(memberSync))incompatible.push(member.id);
    }
    if(incompatible.length)issue('member-version',`Update ${incompatible.length} ${incompatible.length===1?'lamp':'lamps'} to use this scene.`, 'blocked',incompatible);
    if(unknown.length)issue('member-unverified',`Connect to check ${unknown.length} ${unknown.length===1?'lamp':'lamps'} before applying this scene.`, 'unknown',unknown);
    if(integer(groupSize,2,32)&&members.length<groupSize)issue('member-inventory','Some group lamps have not been checked.','unknown');
  }
  const status=issues.some(value=>value.status==='blocked')?'blocked':issues.length?'unknown':'ready';
  return {status,allowed:status==='ready',issues,message:issues[0]?.message||'Ready to use'};
}

function parameterModel(parameter,profile,appearance,kind){
  const ranges={speed:[1,100],intensity:[0,100]},range=ranges[parameter?.key];
  if(!range||parameter.type!=='integer'||parameter.supported===false||!integer(parameter.min,...range)||!integer(parameter.max,parameter.min,range[1])||
    !integer(parameter.step,1,100)||!integer(parameter.default,parameter.min,parameter.max)||(parameter.default-parameter.min)%parameter.step)return null;
  const speed=parameter.key==='speed',labels={'density-and-glow':'Density & glow','activity-and-glow':'Activity & glow','glow':kind==='scene'?'Scene glow':'Effect glow'};
  const value=appearance[parameter.key];
  const genericAudio=parameter.semanticRole==='audio-response'&&profile.speedLabel==='Motion speed';
  return {key:parameter.key,type:'range',label:speed?genericAudio?'Response speed':profile.speedLabel:labels[parameter.semanticRole]||'Effect level',
    hint:speed?genericAudio?'How quickly the light follows changes in sound.':profile.speedHint:parameter.semanticRole==='density-and-glow'?'Adds more particles and increases their brightness.':parameter.semanticRole==='activity-and-glow'?'Brighter and more frequent accents.':profile.intensityHint,
    min:parameter.min,max:parameter.max,step:parameter.step,default:parameter.default,units:parameter.units==='percent'?'%':'',
    value:integer(value,parameter.min,parameter.max)?value:null,role:parameter.semanticRole};
}

const roleLabels={primary:'Light color',secondary:'Second color','zone-low':'Low level','zone-middle':'Middle level','zone-high':'Peak level','band-bass':'Bass color','band-mid':'Midrange color','band-treble':'Treble color'};
function paletteFor(schema,profile,appearance,context,kind){
  const zone=profile.vu?'vu':profile.fountain?'fountain':null;
  const legacyRoles=zone==='vu'?['zone-low','zone-middle','zone-high']:zone==='fountain'?['band-bass','band-mid','band-treble']:kind==='scene'&&appearance.id===0?[]:['primary','secondary'];
  const roles=schema?schema.palette.colorRoles:profile.fixedColors?[]:legacyRoles;
  const modes=schema?schema.palette.modes.filter(mode=>['automatic','custom','fixed'].includes(mode)):profile.fixedColors?['fixed']:zone==='vu'?['custom']:['automatic','custom'];
  const supportsColor=context.state?.supportsColor??Boolean(appearance.primary);
  const fixed=modes.length===1&&modes[0]==='fixed';
  const values=roles.map((role,index)=>{
    const zoneRole=role.startsWith('zone-'),bandRole=role.startsWith('band-');
    const saved=zoneRole?appearance.vuColors?.[index]:bandRole?appearance.fountainColors?.[index]:role==='primary'?appearance.primary:role==='secondary'?appearance.secondary:null;
    const defaults=schema?.palette.defaults?.[index];
    const adapter=zoneRole&&['zone-low','zone-middle','zone-high'].includes(role)?'vu-colors':bandRole&&['band-bass','band-mid','band-treble'].includes(role)?'fountain-colors':role==='primary'?'primary-color':role==='secondary'?'secondary-color':null;
    const canWrite=adapter&&(zoneRole||bandRole?Boolean(saved)&&context.canConfigureZones!==false:kind==='scene'||supportsColor);
    return {key:role,label:role==='primary'?profile.spectrum?'Bass color':profile.colorLabel:role==='secondary'?profile.spectrum?'Treble color':profile.secondaryLabel:roleLabels[role]||'Color',
      rgb:color(saved),hex:hex(saved),default:color(defaults),adapter,editable:Boolean(canWrite)&&!fixed};
  });
  const custom=zone?null:appearance.custom===true;
  return {modes:modes.slice(),fixed,roles:roles.slice(),colors:values,custom,
    secondaryToggle:kind==='effect'&&!zone&&(schema?schema.palette.secondaryToggle===true:true),dual:appearance.dual,
    canReset:!fixed&&values.some(value=>value.editable),
    label:fixed?'Fixed palette':zone==='vu'?'Meter colors':profile.spectrum&&!custom||zone==='fountain'?'Frequency colors':custom?'Your colors':'Original colors',
    hint:fixed?'This scene uses its own spectrum.':profile.vu?'Three colors show low, middle, and peak sound levels.':profile.fountain?'Bass, midrange, and treble each have a color.':
      custom?'Your palette is active.':'Keep the original palette, or choose colors of your own.'};
}

export function adaptiveEffectModel(entry,context={}){
  if(!entry)return null;
  const kind=kindOf(context),schema=schemaFor(entry,context),profile=profileFor(entry,schema,kind),id=localId(entry);
  const appearance=normalizeEffectAppearance({...context,entry,kind});
  const parameterDefaults=[...(profile.motion?[{key:'speed',type:'integer',min:1,max:100,step:1,default:50,units:'percent',semanticRole:'motion'}]:[]),
    ...(profile.intensity?[{key:'intensity',type:'integer',min:0,max:100,step:1,default:kind==='scene'?85:100,units:'percent',semanticRole:profile.intensityLabel==='Density & glow'?'density-and-glow':profile.intensityLabel==='Activity & glow'?'activity-and-glow':'glow'}]:[])];
  const parameters=schema?schema.parameters:parameterDefaults;
  const controls=parameters.map(parameter=>parameterModel(parameter,profile,appearance,kind)).filter(Boolean)
    .filter(control=>control.key!=='speed'||(schema?schema.motion:profile.motion));
  const supportsOptions=kind==='scene'||schema||Boolean(context.state?.capabilities&8)||appearance.speed!==null;
  const unsupportedParameters=parameters.filter(parameter=>!parameterModel(parameter,profile,appearance,kind)).map(parameter=>({key:readable(parameter.key)||'unknown',message:'This control needs a newer app.'}));
  const persistence=schema?.persistence||(kind==='scene'?'shared-group':'legacy-startup');
  const separateSave=context.descriptor?.capabilities?.persistence?.includes('per-effect-appearance-v2')===true;
  return {id,kind,name:effectDisplayName({...entry,key:schema?.key||entry.key}),key:schema?.key||null,
    description:profile.description,category:kind==='scene'?'group':entry.category||'other',schemaVersion:schema?2:1,
    motion:controls.some(value=>value.key==='speed'),intensity:controls.some(value=>value.key==='intensity'),
    controls:controls.map(control=>({...control,editable:Boolean(supportsOptions)&&control.value!==null})),unsupportedParameters,
    appearance,palette:paletteFor(schema,profile,appearance,context,kind),audio:audioFor(entry,schema,profile,context,kind),
    persistence:{scope:persistence,separateAppearanceSave:kind==='effect'&&separateSave,
      label:kind==='scene'?'Shared by group scenes':separateSave?'Save this effect’s appearance':'Use current light at startup',
      hint:kind==='scene'?'These appearance settings are shared between group scenes.':separateSave?'Saves this effect without changing the startup light.':'Live changes need a startup save to survive a restart.'},
    compatibility:effectCompatibility(entry,{...context,kind}),flashing:['effect.lightning-storm','scene.storm-front'].includes(schema?.key)||['Lightning storm','Storm front'].includes(entry.name)};
}

export function currentEffectModel(context={}){
  const raw=context.raw||context.state,state=context.state||(raw?.render?{...raw,...raw.render}:raw),id=state?.mode;
  if(!state||!integer(id,1,255)||typeof state.power!=='boolean'||context.targetId&&raw?.deviceId&&context.targetId!==raw.deviceId)return null;
  const sync=context.sync||state.sync||raw?.sync;
  if(sync&&(![1,2,3].includes(sync.version)||![0,1,2].includes(sync.role)))return null;
  const owner=context.targetId||raw?.deviceId;
  if(sync?.role>0&&/^[a-f0-9]{12}$/.test(owner||'')&&(!/^[a-f0-9]{12}$/.test(sync.leader||'')||sync.role===1&&sync.leader!==owner||sync.role===2&&sync.leader===owner))return null;
  const groupPlayback=sync?.role===1&&sync.paused!==true||sync?.role===2&&sync.active===true&&sync.paused!==true;
  const scene=groupPlayback&&integer(sync?.scene,1,255)?sync.scene:0;
  let entry;
  if(scene){
    const rich=schemaFor({id:scene},{...context,kind:'scene'}),semantic=rich?scenesByKey.get(rich.key):null;
    entry=rich?{...semantic,id:scene,key:rich.key,name:readable(rich.name)||readable(rich.displayName)||semantic?.name||'Group scene '+scene}:availableGroupScenes(sync).find(value=>value.id===scene);
    if(!entry)entry={id:scene,name:'Group scene '+scene};
  }else entry=Array.isArray(context.catalog)?context.catalog.find(value=>value.id===id):null;
  if(!entry&&readable(raw?.effects?.[id-1]))entry={id,name:raw.effects[id-1],category:'other',speed:false};
  if(!entry)entry={id,name:'Effect '+id,category:'other',speed:false};
  const model=adaptiveEffectModel(entry,{...context,state,raw,sync,kind:scene?'scene':'effect'});
  return {...model,power:state.power,groupPlayback:Boolean(groupPlayback),following:sync?.role===2&&sync.active===true&&sync.paused!==true,
    label:!state.power?'Off · '+model.name:groupPlayback&&!scene?'Together · '+model.name:model.name};
}

const presets=[
  {id:'candlelight',name:'Candlelight',colors:[[255,174,94],[255,98,54],[255,215,155]]},
  {id:'ocean',name:'Ocean',colors:[[56,170,218],[94,214,195],[111,142,235]]},
  {id:'meadow',name:'Meadow',colors:[[116,183,128],[224,211,112],[80,150,142]]},
  {id:'sunset',name:'Sunset',colors:[[245,141,107],[174,118,192],[249,190,130]]},
  {id:'moonlight',name:'Moonlight',colors:[[178,200,245],[194,172,229],[154,200,205]]},
  {id:'aurora',name:'Aurora',colors:[[91,207,173],[171,135,221],[118,163,236]]}
];
// Return fresh data, adapted to supported RGB roles; these are app suggestions,
// not an additional firmware palette mode or a fixed-palette override.
export function effectPalettePresets(rolesOrCount=2){
  const count=Array.isArray(rolesOrCount)?rolesOrCount.length:rolesOrCount;
  if(!integer(count,1,3))return [];
  return presets.map(preset=>({id:preset.id,name:preset.name,colors:preset.colors.slice(0,count).map(color),hex:preset.colors.slice(0,count).map(hex)}));
}
