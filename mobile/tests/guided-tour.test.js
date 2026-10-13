import test from 'node:test';
import assert from 'node:assert/strict';
import {startGuidedTour,GUIDED_TOUR_MAX_STEPS,GUIDED_TOUR_TARGET_WAIT_MS} from '../src/guided-tour.js';

// These fixtures supply browser geometry, timers and events to the production
// controller. They contain no lamp, navigation, command or tour state machine.
class Events{
 constructor(){this.listeners=new Map();}
 addEventListener(name,handler){const list=this.listeners.get(name)||new Set();list.add(handler);this.listeners.set(name,list);}
 removeEventListener(name,handler){this.listeners.get(name)?.delete(handler);}
 emit(name,extra={}){const event={target:this,key:'',shiftKey:false,prevented:false,stopped:false,
  preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
  for(const handler of [...this.listeners.get(name)||[]]){handler(event);if(event.stopped)break;}return event;}
 count(){return [...this.listeners.values()].reduce((total,list)=>total+list.size,0);}
}
function fixture(){
 let now=0,serial=0,document;
 const timers=new Map(),selectors=new Map(),observers=[],closed=[],steps=[];
 class Element extends Events{
  constructor(tag){super();this.tagName=tag;this.className='';this.dataset={};this.style={};this.attributes={};this.children=[];this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.scrolls=[];this.rect={left:40,top:120,width:180,height:48};}
  get isConnected(){return this===document.body||Boolean(this.parent?.isConnected);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  contains(child){return child===this||this.children.some(value=>value.contains(child));}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;this.modal=true;}
  close(){this.open=false;this.emit('close');}
  scrollIntoView(value){this.scrolls.push(value);if(this.afterScroll)this.rect=this.afterScroll;}
  getBoundingClientRect(){
   const rect=this.className==='guided-tour-bubble'?{left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:parseFloat(this.style.width)||360,height:Math.min(this.bubbleHeight||220,parseFloat(this.style.maxHeight)||220)}:this.rect;
   return {...rect,right:rect.left+rect.width,bottom:rect.top+rect.height};
  }
 }
 document=new Events();document.hidden=false;document.documentElement={clientWidth:390,clientHeight:844};document.body=new Element('body');document.activeElement=null;
 document.createElement=tag=>new Element(tag);
 document.querySelector=selector=>{if(selector==='[')throw new SyntaxError('Invalid selector');return selectors.get(selector)||null;};
 const window=new Events();window.innerWidth=390;window.innerHeight=844;window.visualViewport=new Events();Object.assign(window.visualViewport,{width:390,height:844,offsetTop:0,offsetLeft:0});
 window.performance={now:()=>now};window.getComputedStyle=element=>({display:element.hidden?'none':'block',visibility:element.visibility||'visible'});
 window.setTimeout=(callback,delay)=>{const id=++serial;timers.set(id,{callback,at:now+delay,type:'timer'});return id;};window.clearTimeout=id=>timers.delete(id);
 window.requestAnimationFrame=callback=>{const id=++serial;timers.set(id,{callback,at:now+16,type:'frame'});return id;};window.cancelAnimationFrame=id=>timers.delete(id);
 window.MutationObserver=class{constructor(callback){this.callback=callback;this.active=false;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}};
 const add=(selector,rect)=>{const value=new Element('button');if(rect)value.rect=rect;document.body.append(value);selectors.set(selector,value);return value;};
 const all=()=>{const list=[],walk=element=>{list.push(element);element.children.forEach(walk);};walk(document.body);return list;};
 const find=className=>all().find(element=>element.className===className);
 const button=label=>all().find(element=>element.tagName==='button'&&element.textContent===label);
 const advance=milliseconds=>{const end=now+milliseconds;let runs=0;while(true){const due=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert.ok(++runs<=1000,'Bounded timer work');timers.delete(due[0]);now=due[1].at;due[1].callback();}now=end;};
 const start=(plan,options={})=>startGuidedTour({steps:plan,document,window,onStep:step=>steps.push(step.id),onClose:result=>closed.push(result),...options});
 return {document,window,add,selectors,find,button,advance,start,closed,steps,timers,observers,
  mutate(target=document.body){for(const observer of observers)if(observer.active)observer.callback([{target}]);},
  dialog:()=>find('guided-tour'),outline:()=>find('guided-tour-outline'),bubble:()=>find('guided-tour-bubble')};
}
const plan=Object.freeze([
 Object.freeze({id:'lamp',selector:'#lamp',title:'Choose your lamp',text:'These are the real controls for the selected lamp.'}),
 Object.freeze({id:'effect',selector:'#effect',title:'Choose an effect',text:'The tour explains this control without changing the lamp.'})
]);

test('tour highlights real anchors with escaped text and invokes presentation-only steps once',()=>{
 const f=fixture(),lamp=f.add('#lamp'),effect=f.add('#effect');
 const tour=f.start(plan);assert.equal(tour.active,true);assert.equal(f.dialog().modal,true);
 assert.equal(f.dialog().attributes['aria-modal'],'true');assert.match(f.dialog().attributes['aria-labelledby'],/^guided-tour-title-/);
 assert.equal(f.find('guided-tour-title').textContent,plan[0].title);assert.equal(f.find('guided-tour-description').textContent,plan[0].text);
 assert.equal(f.outline().hidden,false);assert.equal(lamp.scrolls.length,1);assert.equal(f.document.activeElement,f.button('Next'));
 f.button('Next').emit('click');assert.deepEqual(f.steps,['lamp','effect']);assert.equal(effect.scrolls.length,1);
 assert.equal(f.find('guided-tour-progress').textContent,'Step 2 of 2');assert.equal(f.button('Done').disabled,false);
 f.advance(500);assert.deepEqual(f.steps,['lamp','effect']);f.button('Done').emit('click');
 assert.equal(tour.active,false);assert.deepEqual(f.closed,[{reason:'done',completed:true,shownStepIds:['lamp','effect']}]);
 const unsafe=f.start([{...plan[0],title:'<img src=x>',text:'<script>do not execute</script>'}]);
 assert.equal(f.find('guided-tour-title').textContent,'<img src=x>');assert.equal(f.find('guided-tour-description').children.length,0);unsafe.close();
});

test('underlying controls cannot receive tour pointer or keyboard input and focus is trapped',()=>{
 const f=fixture(),lamp=f.add('#lamp');f.add('#effect');const previous=f.add('#help');previous.focus();const tour=f.start(plan);
 for(const name of ['pointerdown','click','touchstart']){const event=f.document.emit(name,{target:lamp});assert.equal(event.prevented,true);assert.equal(event.stopped,true);}
 const input=f.document.emit('keydown',{target:lamp,key:'Enter'});assert.equal(input.prevented,true);assert.equal(f.document.activeElement,f.button('Skip tour'));
 f.document.emit('keydown',{target:f.button('Skip tour'),key:'Tab'});assert.equal(f.document.activeElement,f.button('Next'));
 f.document.emit('keydown',{target:f.button('Next'),key:'Tab',shiftKey:true});assert.equal(f.document.activeElement,f.button('Skip tour'));
 f.document.emit('focusin',{target:lamp});assert.equal(f.document.activeElement,f.button('Skip tour'));
 tour.close('skip');assert.equal(f.document.activeElement,previous);assert.equal(f.closed[0].reason,'skip');
});

test('missing anchors have one bounded deadline and an honest usable fallback',()=>{
 const f=fixture();const tour=f.start(plan);assert.equal(f.dialog().dataset.state,'waiting');assert.equal(f.button('Next').disabled,true);
 f.advance(GUIDED_TOUR_TARGET_WAIT_MS-1);assert.equal(f.button('Next').disabled,true);
 f.advance(1);assert.equal(f.dialog().dataset.state,'missing');assert.equal(f.outline().hidden,true);assert.equal(f.button('Next').disabled,false);
 assert.match(f.find('guided-tour-note').textContent,/not available/);
 f.button('Next').emit('click');f.advance(GUIDED_TOUR_TARGET_WAIT_MS);f.button('Done').emit('click');
 assert.equal(tour.active,false);assert.equal(f.closed[0].completed,false);assert.deepEqual(f.closed[0].shownStepIds,[]);
});

test('a newly mounted or replaced anchor is re-resolved without repeating onStep',()=>{
 const f=fixture(),tour=f.start(plan);f.advance(250);const lamp=f.add('#lamp');f.mutate();f.advance(16);
 assert.equal(f.dialog().dataset.state,'showing');assert.equal(f.outline().hidden,false);assert.deepEqual(f.steps,['lamp']);
 lamp.remove();const replacement=f.add('#lamp',{left:20,top:500,width:140,height:50});f.mutate();f.advance(32);
 assert.equal(replacement.scrolls.length,1);assert.equal(parseFloat(f.outline().style.top),494);assert.deepEqual(f.steps,['lamp']);tour.close();
});

test('offscreen or hidden anchors do not count as shown and scrolling is bounded per target',()=>{
 const f=fixture(),lamp=f.add('#lamp',{left:40,top:2000,width:100,height:40});const tour=f.start(plan);
 f.advance(1000);assert.equal(f.dialog().dataset.state,'missing');assert.equal(lamp.scrolls.length,1);assert.equal(f.outline().hidden,true);
 lamp.rect={left:40,top:200,width:100,height:40};f.mutate();f.advance(16);assert.equal(f.dialog().dataset.state,'showing');
 lamp.hidden=true;f.mutate();f.advance(16);assert.equal(f.outline().hidden,true);tour.close('skip');assert.deepEqual(f.closed[0].shownStepIds,['lamp']);
 const scrolled=fixture(),target=scrolled.add('#lamp',{left:40,top:2000,width:100,height:40});target.afterScroll={left:40,top:200,width:100,height:40};
 const second=scrolled.start(plan);assert.equal(scrolled.dialog().dataset.state,'showing');assert.equal(scrolled.outline().style.top,'194px');second.close();
});

test('resize and visual viewport changes coalesce layout work and keep the bubble above navigation',()=>{
 const f=fixture();f.add('#lamp',{left:24,top:100,width:280,height:50});f.add('#effect');f.add('nav[aria-label="Main navigation"]',{left:0,top:760,width:390,height:84});
 const tour=f.start(plan);f.advance(32);
 const bubble=f.bubble();assert.ok(parseFloat(bubble.style.top)+bubble.getBoundingClientRect().height<=748);
 Object.assign(f.window.visualViewport,{width:320,height:600,offsetTop:20,offsetLeft:4});
 for(let count=0;count<40;++count)f.window.visualViewport.emit('resize');
 assert.equal([...f.timers.values()].filter(value=>value.type==='frame').length,1);f.advance(16);
 assert.equal(f.dialog().style.left,'4px');assert.equal(f.dialog().style.width,'320px');assert.ok(parseFloat(bubble.style.left)>=12);assert.ok(parseFloat(bubble.style.width)<=296);tour.close();
});

test('Back revisits the real previous step and an overlap note clears after the target shrinks',()=>{
 const f=fixture(),lamp=f.add('#lamp',{left:0,top:0,width:390,height:844});f.add('#effect');const tour=f.start(plan);
 assert.equal(f.dialog().dataset.overlap,'true');assert.match(f.find('guided-tour-note').textContent,/partly behind/);
 lamp.rect={left:30,top:100,width:120,height:40};f.mutate();f.advance(16);assert.equal(f.dialog().dataset.overlap,undefined);
 f.button('Next').emit('click');f.button('Back').emit('click');assert.deepEqual(f.steps,['lamp','effect','lamp']);tour.close();
});

test('Escape, hidden app and invalid-current fencing clean up every timer, observer and listener',()=>{
 for(const reason of ['escape','hidden','invalid']){
  const f=fixture();f.add('#lamp');let valid=true;const tour=f.start(plan,{isCurrent:()=>valid});
  if(reason==='escape')f.document.emit('keydown',{key:'Escape',target:f.button('Next')});
  if(reason==='hidden'){f.document.hidden=true;f.document.emit('visibilitychange');}
  if(reason==='invalid'){valid=false;f.advance(125);}
  assert.equal(tour.active,false);assert.equal(f.closed[0].reason,reason);assert.equal(f.timers.size,0);
  assert.equal(f.document.count(),0);assert.equal(f.window.count(),0);assert.equal(f.window.visualViewport.count(),0);assert.ok(f.observers.every(value=>!value.active));
  tour.close('done');assert.equal(f.closed.length,1);
 }
});

test('callbacks fail closed and asynchronous presentation callbacks cannot race the tour',()=>{
 for(const onStep of [()=>{throw Error('Route removed');},()=>Promise.reject(Error('Async route'))]){
  const f=fixture();f.add('#lamp');const tour=f.start(plan,{onStep});assert.equal(tour.active,false);assert.equal(f.closed[0].reason,'invalid');assert.equal(f.timers.size,0);
 }
 const f=fixture();f.add('#lamp');const tour=f.start(plan,{isCurrent:()=>{throw Error('Disposed');}});assert.equal(tour.active,false);assert.equal(f.dialog(),undefined);
 assert.doesNotThrow(()=>f.start(plan,{onClose:()=>{throw Error('Consumer closed');}}).close());
});

test('only one tour owns a document and close restores focus after the caller restores its route',()=>{
 const f=fixture(),help=f.add('#help');f.add('#lamp');help.focus();let restored=false;
 const first=f.start(plan,{onClose:()=>{restored=true;help.rect={left:0,top:0,width:40,height:40};}});
 const second=f.start(plan);assert.equal(first.active,false);assert.equal(second.active,true);assert.equal(restored,true);assert.equal(f.document.body.children.filter(value=>value.tagName==='dialog').length,1);
 second.close();assert.equal(f.timers.size,0);
});

test('invalid metadata, unsupported modal environments and initially hidden apps create no active tour',()=>{
 assert.equal(GUIDED_TOUR_MAX_STEPS,12);
 for(const steps of [[],Array(13).fill(plan[0]),[plan[0],plan[0]],[{...plan[0],command:'power'}],[{...plan[0],text:'x'.repeat(1001)}],[{...plan[0],selector:''}]]){
  const f=fixture();assert.throws(()=>f.start(steps));assert.equal(f.document.body.children.length,0);
 }
 const f=fixture();f.document.hidden=true;assert.equal(f.start(plan).active,false);assert.equal(f.closed[0].reason,'hidden');
 const unsupported=fixture(),create=unsupported.document.createElement;unsupported.document.createElement=tag=>{const value=create(tag);if(tag==='dialog')value.showModal=null;return value;};
 assert.equal(unsupported.start(plan).active,false);assert.equal(unsupported.document.body.children.length,0);
 const selector=fixture();assert.equal(selector.start([{...plan[0],selector:'['}]).active,false);assert.equal(selector.closed[0].reason,'invalid');
});
