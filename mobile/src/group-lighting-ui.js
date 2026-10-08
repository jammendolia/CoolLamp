import {effectSettings} from './effect-settings.js';

const integer=(value,low,high)=>Number.isInteger(value)&&value>=low&&value<=high;
const rgb=value=>Array.isArray(value)&&value.length===3&&value.every(channel=>integer(channel,0,255));
const palette=value=>Array.isArray(value)&&value.length===3&&value.every(rgb);
const hex=value=>'#'+value.map(channel=>channel.toString(16).padStart(2,'0')).join('');
const channels=value=>/^#[0-9a-f]{6}$/i.test(value)?[1,3,5].map(index=>parseInt(value.slice(index,index+2),16)):null;
const publicFields=(value,keys)=>value&&typeof value==='object'?Object.fromEntries(keys.filter(key=>['number','boolean'].includes(typeof value[key])).map(key=>[key,value[key]])):null;

// This public view contains no HTTP credentials, group invitations or tokens.
export function coordinatorLightingContext(editor) {
  const lamp=editor?.lamp,raw=lamp?.raw,state=lamp?.state || raw,id=editor?.id;
  if(!/^[0-9a-f]{12}$/.test(id||'')||!lamp||lamp.identity!==id||lamp.epoch!==editor.epoch||raw?.deviceId!==id||
    ![1,2].includes(raw.sync?.version)||raw.sync.role!==1||raw.sync.leader!==id)return null;
  const catalog=lamp.catalog;
  if(!Array.isArray(catalog)||!catalog.length||!catalog.every(entry=>integer(entry?.id,1,255)&&typeof entry.name==='string')||
    !catalog.some(entry=>entry.id===raw.mode)||!integer(raw.brightness,1,255)||typeof raw.power!=='boolean')return null;
  const entry=catalog.find(value=>value.id===raw.mode),saved=raw.colors?.[raw.mode-1],options=raw.effectOptions?.[raw.mode-1];
  const validOptions=Array.isArray(options)&&options.length===6&&integer(options[0],1,100)&&integer(options[1],0,100)&&
    integer(options[2],0,1)&&options.slice(3).every(value=>integer(value,0,255));
  const color=Array.isArray(saved)&&saved.length===4&&[0,1].includes(saved[0])&&saved.slice(1).every(value=>integer(value,0,255))?
    {enabled:Boolean(saved[0]),rgb:saved.slice(1)}:null;
  const entries=catalog.map(({id,name,category,speed})=>({id,name,category,speed}));
  return {id,name:typeof raw.name==='string'?raw.name:'Coordinator',mode:raw.mode,scene:raw.sync.scene??0,
    brightness:raw.brightness,power:raw.power,catalog:entries,entry:entries.find(value=>value.id===entry.id),profile:effectSettings(entry),color,
    supportsColor:Boolean(state?.supportsColor&&color),options:validOptions&&Boolean(state?.capabilities&8)?options.slice():null,
    audio:publicFields(raw.audio,['installed','gain','gate','scale','liveTuning']),rotation:publicFields(raw.rotation,['enabled','random','category','seconds']),vuColors:palette(raw.vuColors)?raw.vuColors.map(value=>value.slice()):null,
    fountainColors:palette(raw.fountainColors)?raw.fountainColors.map(value=>value.slice()):null,
    busy:Boolean(editor.busy),blocked:Boolean(raw.calibration?.active)||[1,3,4].includes(raw.firmware?.phase)};
}

function checkIntent(intent,context) {
  const {action,value}=intent || {};
  if(action==='power'){if(![0,1].includes(value))throw Error('Choose a valid group power setting.');return;}
  if(action==='brightness'){if(!integer(value,1,255))throw Error('Choose brightness from 1 to 255.');return;}
  if(context.scene!==0)throw Error('Choose Mirror effects before editing the coordinator’s local effect.');
  if(action==='effect'){if(!context.catalog.some(entry=>entry.id===value))throw Error('This effect is unavailable on the coordinator.');return;}
  if(action==='color'){if(!context.supportsColor||!rgb(value))throw Error('Choose a supported RGB color.');return;}
  if(action==='resetColor'){if(!context.supportsColor)throw Error('Custom colors are unavailable.');return;}
  if(action==='effectOptions') {
    if(!context.options||!value||!integer(value.speed,1,100)||!integer(value.intensity,0,100)||![0,1].includes(value.dual)||
      !rgb([value.r,value.g,value.b]))throw Error('Choose valid effect options.');
    if(value.dual&&!context.color?.enabled)throw Error('Apply a primary color before enabling two colors.');
    return;
  }
  if(action==='saveDefaults')return;
  if(action==='rotation') {
    if(!context.rotation||!value||typeof value.enabled!=='boolean'||typeof value.random!=='boolean'||
      ![0,1,2].includes(value.category)||!integer(value.seconds,5,86400)||value.enabled&&value.category===2&&!context.audio?.installed)
      throw Error('Choose supported rotation settings from 5 seconds to 24 hours.');
    return;
  }
  if(action==='audio') {
    if(!context.profile.audio||!context.audio?.installed||!context.audio.liveTuning||!value||!integer(value.gain,1,64)||
      !integer(value.gate,0,1024)||value.scale!==undefined&&!integer(value.scale,100,400))throw Error('Live audio tuning is unavailable or invalid.');
    return;
  }
  if(action==='vuColors'||action==='fountainColors') {
    const existing=context[action];
    if(!existing||(value!==null&&!palette(value)))throw Error('Choose three supported palette colors.');
    return;
  }
  throw Error('Unsupported group lighting control.');
}

// run must refresh/verify its coordinator in an enqueue, then invoke this action
// OUTSIDE that enqueue. WifiTransport.command owns its queue; nesting deadlocks.
// The existing command paths handle acknowledgments and never replay uncertainty.
export async function runGroupLighting({getEditor,run},intent) {
  const editor=getEditor(),initial=coordinatorLightingContext(editor);
  if(!initial||initial.busy||initial.blocked)throw Error('Open an available coordinator’s group controls first.');
  checkIntent(intent,initial);
  const target=editor.lamp,id=editor.id,epoch=editor.epoch,address=target.base,mode=initial.mode,scene=initial.scene,action=intent.action;
  const mirror=!['power','brightness'].includes(action);
  // Copy caller-owned drafts before waiting for any connection or queue.
  const value=intent.value===null?null:Array.isArray(intent.value)?structuredClone(intent.value):
    intent.value&&typeof intent.value==='object'?{...intent.value}:intent.value;
  const guard=(beforeWrite=false)=>{
    const current=coordinatorLightingContext(editor);
    if(getEditor()!==editor||editor.lamp!==target||target.epoch!==epoch||target.base!==address||!current||current.id!==id||current.blocked)
      throw Error('The group changed. Open its controls again.');
    if(mirror&&(current.scene!==0||(beforeWrite||action!=='effect')&&current.mode!==mode))throw Error('The mirrored effect changed. Review its controls again.');
    if(!mirror&&beforeWrite&&current.scene!==scene)throw Error('The group scene changed. Review its controls again.');
    return current;
  };
  let invoked=false,error,result;
  await run(async lamp=>{
    invoked=true;
    try{
      if(lamp!==target)throw Error('The coordinator connection changed.');
      const beforeWrite=()=>{
        try{const current=guard(true);checkIntent({action,value},current);}
        catch(failure){throw Object.assign(failure,{confirmed:true,cancelled:true});}
      };
      beforeWrite();
      if(['rotation','audio','vuColors','fountainColors'].includes(action))result=await lamp.enqueue(async()=>{
        beforeWrite();
        return action==='rotation'?lamp.configureRotation(value):action==='audio'?lamp.tuneAudio(value):
          action==='vuColors'?lamp.configureVuColors(value):lamp.configureFountainColors(value);
      });
      else {
        const parameter=action==='color'?{mode,...Object.fromEntries(['r','g','b'].map((channel,index)=>[channel,value[index]]))}:
          action==='resetColor'?mode:action==='effectOptions'?{...value,mode}:value??0;
        // The callback runs inside the actual transport queue immediately before
        // sending; a queued Leave/scene change cannot overtake this validation.
        result=await lamp.command(action,parameter,null,beforeWrite);
        guard();
        // Wi-Fi commands already refresh. Binary BLE acknowledgments need the
        // protected full snapshot for current color/options/startup readback.
        if(lamp.supportsOfflineControl)await lamp.refresh(id);
      }
      const updated=guard();
      if(action==='power'&&updated.power!==Boolean(value)||action==='brightness'&&updated.brightness!==value||
        action==='effect'&&updated.mode!==value||action==='color'&&(!updated.color?.enabled||updated.color.rgb.some((channel,index)=>channel!==value[index]))||
        action==='resetColor'&&(!updated.color||updated.color.enabled)||action==='effectOptions'&&
          (!updated.options||updated.options.some((channel,index)=>channel!==[value.speed,value.intensity,value.dual,value.r,value.g,value.b][index])))
        throw Object.assign(Error('The coordinator did not confirm the lighting change. Refresh before trying again.'),{uncertain:true});
      return typeof result==='string'?result:'Group lighting updated.';
    }catch(failure){error=failure;throw failure;}
  });
  // Main's runner renders errors itself. Retain failure truth for this local
  // component even when that runner catches instead of rejecting its promise.
  if(error)throw error;
  if(!invoked)throw Error('Group controls were cancelled.');
  return typeof result==='string'?result:'Group lighting updated.';
}

export class GroupLightingUi {
  constructor({root,getEditor,run}) {
    Object.assign(this,{root,getEditor,run});this.document=root.ownerDocument;this.dirty=new Set();this.pending=false;
    this.fields={};this.build();
  }
  element(tag,text,className) {
    const element=this.document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;
  }
  input(parent,key,label,{type='range',min,max,step,value}={}) {
    const wrapper=this.element('label',label),field=this.element('input');field.type=type;
    field.setAttribute('aria-label',label);
    if(min!==undefined)field.min=String(min);if(max!==undefined)field.max=String(max);if(step!==undefined)field.step=String(step);if(value!==undefined)field.value=String(value);
    if(type==='checkbox')wrapper.classList.add('toggle');
    wrapper.append(field);parent.append(wrapper);this.fields[key]=field;
    field.oninput=()=>this.dirty.add(key);return field;
  }
  button(parent,label,action) {
    const button=this.element('button',label,'secondary compact');button.type='button';button.onclick=action;parent.append(button);return button;
  }
  select(parent,key,label,options) {
    const wrapper=this.element('label',label),field=this.element('select');wrapper.append(field);parent.append(wrapper);this.fields[key]=field;
    field.setAttribute('aria-label',label);
    this.options(field,options);field.onchange=()=>this.dirty.add(key);return field;
  }
  options(field,options) {
    field.replaceChildren(...options.map(([value,label])=>{const option=this.element('option',label);option.value=String(value);return option;}));
  }
  build() {
    const {root}=this;root.classList.add('panel','group-lighting-controls');
    this.title=this.element('h4','Group power & brightness');root.append(this.title);
    root.append(this.element('p','These controls apply to this coordinator and its connected followers.','hint'));
    this.controls=this.element('fieldset');root.append(this.controls);this.controls.append(this.element('legend','Group lighting','sr-only'));
    this.power=this.button(this.controls,'Turn group on',()=>this.act({action:'power',value:this.context?.power?0:1}));
    this.brightnessLabel=this.element('p','','micro-copy');this.controls.append(this.brightnessLabel);
    this.input(this.controls,'brightness','Group brightness',{min:1,max:255,value:100});
    this.button(this.controls,'Apply group brightness',()=>this.act({action:'brightness',value:Number(this.fields.brightness.value)}));
    this.mirror=this.element('details',undefined,'group-mirror-controls');this.mirror.open=false;this.controls.append(this.mirror);
    this.mirror.append(this.element('summary','Mirror effect, colors & sound'));
    this.mirror.append(this.element('p','Every member mirrors the coordinator’s actual effect. This list comes from that coordinator.','hint'));
    const effect=this.select(this.mirror,'effect','Coordinator effect',[]);effect.onchange=()=>this.act({action:'effect',value:Number(effect.value)});
    this.colors=this.element('div');this.mirror.append(this.colors);
    this.input(this.colors,'primary','Primary color',{type:'color',value:'#ffffff'});
    this.button(this.colors,'Apply primary color',()=>this.act({action:'color',value:channels(this.fields.primary.value)}));
    this.button(this.colors,'Restore effect defaults',()=>this.act({action:'resetColor'}));
    this.optionsFields=this.element('div');this.mirror.append(this.optionsFields);
    this.speedWrapper=this.element('div');this.optionsFields.append(this.speedWrapper);this.input(this.speedWrapper,'speed','Effect speed',{min:1,max:100,value:50});
    this.intensityWrapper=this.element('div');this.optionsFields.append(this.intensityWrapper);this.input(this.intensityWrapper,'intensity','Effect glow',{min:0,max:100,value:100});
    this.twoColors=this.element('div');this.optionsFields.append(this.twoColors);this.input(this.twoColors,'dual','Use two colors',{type:'checkbox'});
    this.input(this.twoColors,'secondary','Secondary color',{type:'color',value:'#ffffff'});
    this.paletteHint=this.element('p','Apply a primary color before enabling two colors.','micro-copy');this.twoColors.append(this.paletteHint);
    this.button(this.optionsFields,'Apply effect settings',()=>{const color=channels(this.fields.secondary.value);this.act({action:'effectOptions',value:{
      speed:Number(this.fields.speed.value),intensity:Number(this.fields.intensity.value),dual:Number(this.fields.dual.checked),r:color?.[0],g:color?.[1],b:color?.[2]}});});
    this.bandColors=this.element('div');this.mirror.append(this.bandColors);this.bandTitle=this.element('h4','Three-color palette');this.bandColors.append(this.bandTitle);
    for(let index=0;index<3;++index)this.input(this.bandColors,'band'+index,['Low / bass','Midrange','Peak / treble'][index],{type:'color',value:'#ffffff'});
    this.button(this.bandColors,'Apply palette',()=>this.act({action:this.context?.profile.vu?'vuColors':'fountainColors',value:[0,1,2].map(index=>channels(this.fields['band'+index].value))}));
    this.button(this.bandColors,'Restore palette',()=>this.act({action:this.context?.profile.vu?'vuColors':'fountainColors',value:null}));
    this.audioFields=this.element('div');this.mirror.append(this.audioFields);this.audioFields.append(this.element('h4','Shared sound response'));
    this.input(this.audioFields,'gain','Sensitivity',{min:1,max:64,value:16});this.input(this.audioFields,'gate','Quiet cutoff',{min:0,max:1024,value:12});
    this.input(this.audioFields,'scale','Contrast',{min:100,max:400,value:100});
    this.button(this.audioFields,'Apply shared sound response',()=>this.act({action:'audio',value:{gain:Number(this.fields.gain.value),gate:Number(this.fields.gate.value),
      ...(this.context?.audio?.scale===undefined?{}:{scale:Number(this.fields.scale.value)})}}));
    this.rotationFields=this.element('div');this.mirror.append(this.rotationFields);this.rotationFields.append(this.element('h4','Rotate mirrored effects'));
    this.input(this.rotationFields,'rotationEnabled','Rotate effects',{type:'checkbox'});
    this.select(this.rotationFields,'rotationOrder','Order',[['sequential','In order'],['random','Random']]);
    this.select(this.rotationFields,'rotationCategory','Collection',[[0,'All effects'],[1,'Non-audio effects'],[2,'Audio effects']]);
    this.input(this.rotationFields,'rotationSeconds','Change every (seconds)',{type:'number',min:5,max:86400,value:30});
    this.button(this.rotationFields,'Save group rotation',()=>this.act({action:'rotation',value:{enabled:this.fields.rotationEnabled.checked,random:this.fields.rotationOrder.value==='random',
      category:Number(this.fields.rotationCategory.value),seconds:Number(this.fields.rotationSeconds.value)}}));
    this.button(this.mirror,'Save startup effect & brightness',()=>this.act({action:'saveDefaults'}));
    this.feedback=this.element('p','','hint');this.feedback.setAttribute('role','status');root.append(this.feedback);
  }
  set(key,value,checked=false) {if(!this.dirty.has(key)){if(checked)this.fields[key].checked=Boolean(value);else this.fields[key].value=String(value);}}
  async act(intent) {
    if(this.pending)return;this.pending=true;this.feedback.textContent='Applying group lighting…';this.render();
    const editor=this.getEditor();
    try{const result=await runGroupLighting(this,intent);if(this.getEditor()===editor){
      const applied={brightness:['brightness'],effect:['effect'],color:['primary'],
        resetColor:['primary','speed','intensity','dual','secondary'],effectOptions:['speed','intensity','dual','secondary'],
        vuColors:['band0','band1','band2'],fountainColors:['band0','band1','band2'],audio:['gain','gate','scale'],
        rotation:['rotationEnabled','rotationOrder','rotationCategory','rotationSeconds']}[intent.action]||[];
      for(const key of applied)this.dirty.delete(key);this.feedback.textContent=result;
    }}
    catch(error){if(this.getEditor()===editor)this.feedback.textContent=error.uncertain?'The change was not confirmed. Refresh this group before trying again.':error.message;}
    finally{this.pending=false;this.render();}
  }
  render() {
    const context=this.context=coordinatorLightingContext(this.getEditor());this.root.hidden=!context;
    if(!context){this.key=null;this.mode=null;this.mirrorIdentity=null;this.dirty.clear();this.feedback.textContent='';return;}
    const mirrorIdentity=JSON.stringify([context.id,this.getEditor().epoch]);
    if(mirrorIdentity!==this.mirrorIdentity){this.mirrorIdentity=mirrorIdentity;this.mirror.open=false;}
    const key=JSON.stringify([context.id,this.getEditor().epoch]);
    if(key!==this.key){this.key=key;this.dirty.clear();this.feedback.textContent='';}
    if(context.mode!==this.mode){this.mode=context.mode;for(const field of ['effect','primary','speed','intensity','dual','secondary','band0','band1','band2'])this.dirty.delete(field);}
    this.title.textContent=context.name+' · group lighting';this.controls.disabled=this.pending||context.busy||context.blocked;
    this.power.textContent=context.power?'Turn group off':'Turn group on';this.power.setAttribute('aria-pressed',String(context.power));
    this.set('brightness',context.brightness);this.brightnessLabel.textContent=Math.round(context.brightness*100/255)+'% shared brightness';
    this.fields.brightness.setAttribute('aria-valuetext',Math.round(Number(this.fields.brightness.value)*100/255)+' percent');
    this.mirror.hidden=context.scene!==0;if(context.scene!==0)return;
    const catalogKey=JSON.stringify(context.catalog.map(entry=>[entry.id,entry.name]));
    if(catalogKey!==this.catalogKey){this.catalogKey=catalogKey;this.options(this.fields.effect,context.catalog.map(entry=>[entry.id,entry.name]));}
    this.set('effect',context.mode);this.colors.hidden=!context.supportsColor||context.profile.vu||context.profile.fountain;
    if(context.color)this.set('primary',hex(context.color.rgb));
    this.optionsFields.hidden=!context.options;
    this.speedWrapper.hidden=!context.profile.motion;this.intensityWrapper.hidden=!context.profile.intensity;
    this.twoColors.hidden=!context.supportsColor||context.profile.vu||context.profile.fountain;
    if(context.options){const [speed,intensity,dual,r,g,b]=context.options;this.set('speed',speed);this.set('intensity',intensity);this.set('dual',dual&&context.color?.enabled,true);this.set('secondary',hex([r,g,b]));}
    this.fields.dual.disabled=!context.color?.enabled;this.paletteHint.hidden=Boolean(context.color?.enabled);
    const colors=context.profile.vu?context.vuColors:context.profile.fountain?context.fountainColors:null;
    this.bandColors.hidden=!colors;if(colors){this.bandTitle.textContent=context.profile.vu?'VU zone colors':'Bass, midrange & treble colors';colors.forEach((value,index)=>this.set('band'+index,hex(value)));}
    this.audioFields.hidden=!context.profile.audio||!context.audio?.installed||!context.audio?.liveTuning;
    if(context.audio){this.set('gain',context.audio.gain);this.set('gate',context.audio.gate);this.set('scale',context.audio.scale??100);this.fields.scale.disabled=context.audio.scale===undefined;}
    this.rotationFields.hidden=!context.rotation;
    if(context.rotation){this.set('rotationEnabled',context.rotation.enabled,true);this.set('rotationOrder',context.rotation.random?'random':'sequential');this.set('rotationCategory',context.rotation.category);this.set('rotationSeconds',context.rotation.seconds);}
  }
}
