// Phone-local presentation only. The caller owns fresh reads, target fencing,
// persistence and execution receipts; opening or rendering this view sends nothing.
export function mountSavedLooks(root,{onSave,onApply,onRemove}={}) {
 if(!root?.ownerDocument)throw Error('A saved looks container is required.');
 const document=root.ownerDocument;
 const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
 const heading=element('h3',null,'Saved looks');
 const description=element('p','hint','Keep an effect, its colors, brightness and tuning on this phone. Your startup settings stay as chosen.');
 const label=element('label',null,'Look name'),input=element('input');
 input.id=(root.id||'savedLooks')+'Name';input.type='text';input.maxLength=64;input.required=true;input.placeholder='e.g. Cozy Plasma';label.htmlFor=input.id;
 const save=element('button',null,'Save look');save.type='button';save.dataset.lookAction='save';
 const editor=element('div','saved-look-editor');editor.append(label,input,save);
 const details=element('details','saved-look-library'),summary=element('summary'),list=element('div','saved-look-list');
 details.append(summary,list);
 const note=element('p','hint saved-look-hint'),feedback=element('p','hint saved-look-feedback');
 feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.setAttribute('aria-atomic','true');
 feedback.id=(root.id||'savedLooks')+'Feedback';input.setAttribute('aria-describedby',feedback.id);
 root.append(heading,description,editor,details,note,feedback);
 let model={lampId:null,looks:[],saveAllowed:false,applyAllowed:false},generation=0,pending=null,rows=[],listKey='',ownMessage='',ownState='idle';
 const waiting=()=>Boolean(model.busy||pending);
 function paint(){
  const busy=waiting();root.setAttribute('aria-busy',String(busy));input.disabled=busy||!model.saveAllowed;
  save.disabled=busy||!model.saveAllowed||!input.value.trim();save.textContent=pending?.action==='save'?'Saving…':'Save look';
  for(const row of rows){row.apply.disabled=busy||!model.applyAllowed;row.remove.disabled=busy;}
  const externalWorking=model.busy&&model.workingLabel;
  feedback.textContent=externalWorking||model.error||ownMessage;
  feedback.dataset.state=externalWorking||pending?'working':model.error?'error':ownState;
 }
 function current(scope){return model.lampId===scope.lampId&&generation===scope.generation;}
 async function action(kind,lookId=null){
  if(waiting()||!model.lampId||kind==='save'&&(!model.saveAllowed||!input.value.trim())||kind==='apply'&&!model.applyAllowed)return;
  if(lookId&&!model.looks.some(look=>look.id===lookId))return;
  const callback=kind==='save'?onSave:kind==='apply'?onApply:onRemove;if(typeof callback!=='function')return;
  const scope={lampId:model.lampId,generation},task={...scope,action:kind};pending=task;
  ownMessage=kind==='save'?'Saving this look on your phone…':kind==='apply'?'Applying your saved look…':'Removing this saved look…';ownState='working';paint();
  try{
   const result=await callback(kind==='save'?input.value.trim():lookId,{lampId:scope.lampId});
   if(!current(scope))return;
   if(kind==='save')input.value='';
   ownMessage=typeof result?.message==='string'?result.message:kind==='save'?'Look saved on this phone.':kind==='remove'?'Saved look removed from this phone.':result?.outcome==='executed'?'Look applied.':'Look request finished. Check your lamp’s status.';
   ownState='idle';
  }catch(error){if(current(scope)){ownMessage=error?.message||'This look could not be saved or applied. Try again when the lamp is ready.';ownState='error';}}
  finally{if(pending===task)pending=null;paint();}
 }
 save.onclick=()=>action('save');input.oninput=paint;
 function render(next={}){
  const id=typeof next.lampId==='string'?next.lampId:null;
  if(id!==model.lampId){++generation;input.value='';ownMessage='';ownState='idle';details.open=false;}
  model={...next,lampId:id,looks:Array.isArray(next.looks)?next.looks:[]};root.hidden=!id;
  heading.textContent=next.lampName?'Saved looks for '+next.lampName:'Saved looks';
  note.textContent=next.reason||'';note.hidden=!note.textContent;
  summary.textContent='Saved looks ('+model.looks.length+')';
  const key=JSON.stringify([id,model.error||'',model.looks.map(look=>[look.id,look.name,look.effect?.name,look.appearance?.brightness])]);
  if(key!==listKey){
   listKey=key;rows=[];const children=[];
   for(const look of model.looks){
    const card=element('div','saved-look-card'),copy=element('div','saved-look-copy');
    const name=element('strong',null,look.name),effect=typeof look.effect?.name==='string'?look.effect.name:'Saved effect';
    const brightness=look.appearance?.brightness;
    copy.append(name,element('small',null,effect+(Number.isInteger(brightness)&&brightness>=1&&brightness<=255?' · '+Math.round(brightness*100/255)+'% brightness':'')));
    const actions=element('div','saved-look-actions'),apply=element('button',null,'Use look'),remove=element('button','secondary','Remove');
    const rowScope={lampId:id,generation};
    for(const [button,kind] of [[apply,'apply'],[remove,'remove']]){
     button.type='button';button.dataset.lookAction=kind;button.dataset.lookId=look.id;
     button.setAttribute('aria-label',(kind==='apply'?'Use ':'Remove ')+look.name+(kind==='remove'?' from this phone':''));
     button.onclick=()=>current(rowScope)?action(kind,look.id):undefined;
    }
    actions.append(apply,remove);card.append(copy,actions);children.push(card);rows.push({apply,remove});
   }
   if(!children.length&&!model.error)children.push(element('p','hint','No saved looks for this lamp yet.'));
   list.replaceChildren(...children);
  }
  paint();
 }
 render();
 return {render};
}
