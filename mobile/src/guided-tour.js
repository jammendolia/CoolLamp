// Presentation only: this controller never reads, connects to, or changes a lamp.
// The caller supplies trusted selectors and a synchronous, presentation-only
// onStep callback. Native modal inertness protects the real controls underneath.
export const GUIDED_TOUR_MAX_STEPS=12;
export const GUIDED_TOUR_TARGET_WAIT_MS=750;
const tours=new WeakMap(),margin=12,targetPadding=6;
let sequence=0;
const finite=value=>Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const swallow=value=>{if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});};

function checkedSteps(value){
 if(!Array.isArray(value)||!value.length||value.length>GUIDED_TOUR_MAX_STEPS)throw new RangeError('A tour needs one to twelve steps.');
 const ids=new Set();
 return Object.freeze(value.map(step=>{
  if(!step||Object.getPrototypeOf(step)!==Object.prototype||Object.keys(step).some(key=>!['id','selector','title','text'].includes(key))||
   typeof step.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(step.id)||ids.has(step.id)||
   typeof step.selector!=='string'||!step.selector.trim()||step.selector.length>256||
   typeof step.title!=='string'||!step.title.trim()||step.title.length>120||
   typeof step.text!=='string'||!step.text.trim()||step.text.length>1000)throw new TypeError('Tour steps must contain bounded plain text and known selectors.');
  ids.add(step.id);return Object.freeze({...step});
 }));
}

export function startGuidedTour({steps,onStep,onClose,isCurrent=()=>true,document=globalThis.document,window=globalThis.window}={}){
 const plan=checkedSteps(steps);
 if(typeof isCurrent!=='function'||onStep!==undefined&&typeof onStep!=='function'||onClose!==undefined&&typeof onClose!=='function')throw new TypeError('Invalid tour callback.');
 let active=true,index=0,target=null,missingAt=0,frame=null,timer=null,observer=null,closing=false,announced='';
 const shown=new Set(),listeners=[],clock=()=>window?.performance?.now?.()??Date.now();
 let dialog=null,bubble=null,controls=null,title=null,description=null,note=null,progress=null,back=null,next=null,skip=null,outline=null,shades=[];
 const previous=document?.activeElement;
 const controller={close,get active(){return active;}};
 function notify(reason){try{swallow(onClose?.({reason,completed:reason==='done'&&shown.size===plan.length,shownStepIds:Object.freeze([...shown])}));}catch{}}
 function close(reason='closed'){
  if(!active||closing)return;closing=true;active=false;
  if(frame!==null)window?.cancelAnimationFrame?.(frame);
  if(timer!==null)window?.clearTimeout?.(timer);
  observer?.disconnect();for(const [surface,event,handler,options]of listeners)surface.removeEventListener(event,handler,options);
  if(tours.get(document)===controller)tours.delete(document);
  try{if(dialog?.open)dialog.close();dialog?.remove();}catch{}
  notify(reason);
  // The caller may restore the previous presentation route in onClose. Focus
  // afterward, and never steal focus from a new tour opened by that callback.
  try{if(previous?.isConnected&&!document?.hidden&&!tours.has(document))previous.focus({preventScroll:true});}catch{}
  closing=false;
 }
 function current(){
  if(!active)return false;
  try{if(document.hidden){close('hidden');return false;}if(!isCurrent()){close('invalid');return false;}}catch{close('invalid');return false;}
  return true;
 }
 if(!document?.body||!window?.setTimeout||!window?.requestAnimationFrame){close('invalid');return controller;}
 if(!current())return controller;
 tours.get(document)?.close('replaced');tours.set(document,controller);
 const make=(tag,className,parent)=>{const value=document.createElement(tag);value.className=className;if(parent)parent.append(value);return value;};
 const listen=(surface,event,handler,options)=>{surface?.addEventListener(event,handler,options);if(surface)listeners.push([surface,event,handler,options]);};
 try{
  dialog=make('dialog','guided-tour');dialog.dataset.tour='active';dialog.setAttribute('aria-modal','true');
  for(let count=0;count<4;++count)shades.push(make('div','guided-tour-shade',dialog));
  outline=make('div','guided-tour-outline',dialog);outline.setAttribute('aria-hidden','true');outline.hidden=true;
  bubble=make('section','guided-tour-bubble',dialog);
  const copy=make('div','guided-tour-copy',bubble);
  progress=make('p','guided-tour-progress',copy);
  title=make('h2','guided-tour-title',copy);title.id=`guided-tour-title-${++sequence}`;
  description=make('p','guided-tour-description',copy);description.id=`guided-tour-description-${sequence}`;
  note=make('p','guided-tour-note',copy);note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.setAttribute('aria-atomic','true');
  controls=make('div','guided-tour-controls',bubble);
  back=make('button','secondary',controls);back.type='button';back.textContent='Back';
  next=make('button','',controls);next.type='button';
  skip=make('button','text-button guided-tour-skip',controls);skip.type='button';skip.textContent='Skip tour';
  dialog.setAttribute('aria-labelledby',title.id);dialog.setAttribute('aria-describedby',description.id);
  document.body.append(dialog);
  if(typeof dialog.showModal!=='function')throw Error('Modal tour unavailable.');
  dialog.showModal();
 }catch{close('invalid');return controller;}

 function viewport(){
  const visual=window.visualViewport;
  const width=finite(visual?.width)&&visual.width>0?visual.width:window.innerWidth||document.documentElement.clientWidth||320;
  const height=finite(visual?.height)&&visual.height>0?visual.height:window.innerHeight||document.documentElement.clientHeight||568;
  return {x:finite(visual?.offsetLeft)?visual.offsetLeft:0,y:finite(visual?.offsetTop)?visual.offsetTop:0,width:clamp(width,1,16384),height:clamp(height,1,16384)};
 }
 function box(value,x,y,width,height){Object.assign(value.style,{left:`${x}px`,top:`${y}px`,width:`${Math.max(0,width)}px`,height:`${Math.max(0,height)}px`});}
 function position(rect){
  const view=viewport();box(dialog,view.x,view.y,view.width,view.height);
  delete dialog.dataset.overlap;
  let contentHeight=view.height;
  try{const navigation=document.querySelector('nav[aria-label="Main navigation"]'),area=navigation?.getBoundingClientRect();
   if(navigation&&!navigation.hidden&&area&&area.height>0&&area.top>view.y&&area.top<view.y+view.height)contentHeight=area.top-view.y;
  }catch{}
  const safe=margin,available=Math.max(1,view.width-safe*2);
  let heightLimit=Math.max(1,contentHeight-safe*2);
  if(rect){const above=rect.top-view.y-targetPadding-safe-12,below=contentHeight-(rect.bottom-view.y+targetPadding)-safe-12;
   const controlsHeight=controls.getBoundingClientRect().height||120;
   const minimum=Math.min(heightLimit,Math.max(180,controlsHeight+120));
   const room=Math.max(above,below);if(room>=minimum)heightLimit=Math.min(heightLimit,room);
  }
  bubble.style.width=`${Math.min(360,available)}px`;bubble.style.maxHeight=`${heightLimit}px`;
  const size=bubble.getBoundingClientRect();const height=Math.min(size.height||240,Math.max(1,contentHeight-safe*2));const width=Math.min(size.width||360,available);
  let top=(contentHeight-height)/2,left=(view.width-width)/2;
  if(rect){
   const x=clamp(rect.left-view.x-targetPadding,0,view.width),y=clamp(rect.top-view.y-targetPadding,0,view.height);
   const right=clamp(rect.right-view.x+targetPadding,0,view.width),bottom=clamp(rect.bottom-view.y+targetPadding,0,view.height);
   box(shades[0],0,0,view.width,y);box(shades[1],0,bottom,view.width,view.height-bottom);
   box(shades[2],0,y,x,bottom-y);box(shades[3],right,y,view.width-right,bottom-y);
   box(outline,x,y,right-x,bottom-y);outline.hidden=false;
   const gap=12;
   if(contentHeight-bottom-gap>=height+safe)top=bottom+gap;
   else if(y-gap>=height+safe)top=y-gap-height;
   else if(view.width-right-gap>=width+safe){left=right+gap;top=clamp(y,safe,Math.max(safe,contentHeight-height-safe));}
   else if(x-gap>=width+safe){left=x-gap-width;top=clamp(y,safe,Math.max(safe,contentHeight-height-safe));}
   else{
    // Large targets can occupy most of a small screen. Keep all tour controls
    // usable and disclose overlap instead of pretending the whole target is visible.
    top=y>=contentHeight-bottom?safe:Math.max(safe,contentHeight-height-safe);dialog.dataset.overlap='true';
   }
  }else{box(shades[0],0,0,view.width,view.height);for(const shade of shades.slice(1))box(shade,0,0,0,0);outline.hidden=true;delete dialog.dataset.overlap;}
  bubble.style.left=`${clamp(left,safe,Math.max(safe,view.width-width-safe))}px`;
  bubble.style.top=`${clamp(top,safe,Math.max(safe,contentHeight-height-safe))}px`;
 }
 function status(value){note.hidden=!value;if(value!==announced||note.textContent!==value){note.textContent=value;announced=value;}}
 function resolve(){
  if(!current())return;
  let found=null,rect=null;
  try{
   found=document.querySelector(plan[index].selector);
   if(found&&!dialog.contains(found)&&found.isConnected&&!found.hidden){
    const style=window.getComputedStyle?.(found);
    const value=found.getBoundingClientRect();
    if(style?.display!=='none'&&style?.visibility!=='hidden'&&[value.left,value.top,value.right,value.bottom,value.width,value.height].every(finite)&&value.width>0&&value.height>0)rect=value;
   }
  }catch{close('invalid');return;}
  if(rect&&target!==found){target=found;try{target.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});}catch{try{target.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});}catch{}}
   try{rect=target.getBoundingClientRect();}catch{rect=null;}schedule();
  }
  if(rect){const view=viewport();if(rect.right<=view.x||rect.left>=view.x+view.width||rect.bottom<=view.y||rect.top>=view.y+view.height)rect=null;}
  if(rect){
   shown.add(plan[index].id);dialog.dataset.state='showing';next.disabled=false;position(rect);
   status(dialog.dataset.overlap?'The highlighted control is partly behind this explanation.':'');
  }else{
   if(!found||!found.isConnected)target=null;position(null);
   if(clock()-missingAt>=GUIDED_TOUR_TARGET_WAIT_MS){dialog.dataset.state='missing';next.disabled=false;status('This control is not available on this screen. You can continue to the next step or skip the tour.');}
   else{dialog.dataset.state='waiting';next.disabled=true;status('Finding this control…');}
  }
 }
 function schedule(){if(active&&frame===null)frame=window.requestAnimationFrame(()=>{frame=null;resolve();});}
 function show(value){
  if(!current())return;index=value;target=null;missingAt=clock();announced='';delete dialog.dataset.overlap;
  const step=plan[index];dialog.dataset.step=step.id;title.textContent=step.title;description.textContent=step.text;
  progress.textContent=`Step ${index+1} of ${plan.length}`;back.disabled=index===0;next.textContent=index===plan.length-1?'Done':'Next';
  try{const result=onStep?.(step);if(result&&typeof result.then==='function'){swallow(result);close('invalid');return;}}catch{close('invalid');return;}
  if(!current())return;resolve();if(active)(next.disabled?skip:next).focus({preventScroll:true});
 }
 function tick(){timer=null;if(!current())return;resolve();if(active)timer=window.setTimeout(tick,125);}
 listen(back,'click',()=>{if(current()&&index>0)show(index-1);});
 listen(next,'click',()=>{if(!current()||next.disabled)return;if(index===plan.length-1)close('done');else show(index+1);});
 listen(skip,'click',()=>close('skip'));
 listen(dialog,'cancel',event=>{event.preventDefault();close('escape');});
 listen(dialog,'close',()=>{if(active)close('closed');});
 listen(document,'visibilitychange',()=>{if(document.hidden)close('hidden');});
 listen(document,'keydown',event=>{
  if(!current())return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close('escape');return;}
  if(event.key==='Tab'){
   event.preventDefault();event.stopImmediatePropagation();const buttons=[back,next,skip].filter(button=>!button.disabled);
   const currentIndex=buttons.indexOf(document.activeElement),move=event.shiftKey?-1:1;
   buttons[(currentIndex+move+buttons.length)%buttons.length].focus({preventScroll:true});return;
  }
  if(!bubble.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();skip.focus({preventScroll:true});}
 },true);
 listen(document,'focusin',event=>{if(current()&&!bubble.contains(event.target))skip.focus({preventScroll:true});},true);
 for(const event of ['pointerdown','click','touchstart'])listen(document,event,eventValue=>{if(current()&&!bubble.contains(eventValue.target)){eventValue.preventDefault();eventValue.stopImmediatePropagation();}}, {capture:true,passive:false});
 for(const surface of [window,window.visualViewport])for(const event of ['resize','scroll'])listen(surface,event,schedule,{passive:true});
 try{if(window.MutationObserver){observer=new window.MutationObserver(records=>{if(records.some(record=>!dialog.contains(record.target)))schedule();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','style','aria-hidden']});}}catch{observer=null;}
 show(0);if(active)timer=window.setTimeout(tick,125);
 return controller;
}
