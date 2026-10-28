import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {moveGroupLamp} from '../src/group-scenes.js';

const source=readFileSync(process.env.COOLLAMP_GROUP_UI_SOURCE||new URL('../src/main.js',import.meta.url),'utf8');
function block(start){
  const at=source.indexOf(start);assert(at>=0,start);let signature=source.indexOf('(',at)+1,parameters=1;
  for(;parameters&&signature<source.length;signature++){if(source[signature]==='(')parameters++;else if(source[signature]===')')parameters--;}
  const open=source.indexOf('{',signature);let depth=1,end=open+1;
  for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
  assert.equal(depth,0,start);return source.slice(at,end);
}
const renderer=block('function renderGroupScenes()');
const action=block('async function groupSceneAction(');
const remove=source.includes('async function removeGroupOrderMember(')?block('async function removeGroupOrderMember('):'';
const ids=['aabbccddeeff','112233445566','223344556677','334455667788'];
const incarnation='a'.repeat(32);
const clone=value=>JSON.parse(JSON.stringify(value));
const settled=async run=>{
  let timer;
  try{return await Promise.race([Promise.resolve(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Removal deadlocked in the editor queue')),250);})]);}
  finally{clearTimeout(timer);}
};
class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.value='';this.disabled=false;this.hidden=false;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(name,value){this.attributes[name]=value;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='button'&&child.tagName==='button'?[child]:[]),...(child.querySelectorAll?.(selector)||[])]);}
  focus(){}
}
function harness({pending=false,online=false,legacy=false,stopped=false}={}){
  const elements=new Map(),calls=[],closed=[],reads=[];let outcome={phase:pending?'removal-pending':'member-removed',target:ids[1],saved:!pending,pending:pending?[{id:ids[1]}]:[],confirmed:pending?[]:[ids[1]],coordinatorStopped:stopped};
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context={$:element,document:{createElement:tag=>new Element(tag),querySelector:()=>element('colors')},moveGroupLamp,confirm:()=>true,
    groupScenes:[{id:0,name:'Mirror',description:'Shared light',audio:false}],availableGroupScenes:()=>[],groupSceneSettings:()=>({speed:50,intensity:100,primary:[1,2,3],secondary:[4,5,6]}),
    groupSceneLabels(){},paintRanges(){},filterScenes(){},renderLamps(){},renderOptions(){},groupLightingUi:null,
    async refreshRoomGroups(){},async closeGroupEditor(){closed.push(context.ui.editor()?.id);context.ui.setEditor(null);},
    roomGroups:{async removeMember(id,target,options){
      calls.push({op:'remove',id,target,options:clone(options)});
      const editor=context.ui.editor();return editor.lamp.enqueue(async()=>{
        calls.push({op:'service-queue',id:editor.id});
        const raw=editor.lamp.raw;
        if(outcome.phase==='removal-pending'){
          if(outcome.pruned)raw.sync.order=raw.sync.order.filter(row=>row.id!==target);
          context.ui.pending(id,[target]);
        }
        else {raw.sync.order=raw.sync.order.filter(row=>row.id!==target);if(outcome.coordinatorStopped)raw.sync.role=0;}
        return clone(outcome);
      });
    }},
  };
  const coordinator=id=>{
    const raw={deviceId:id,name:'Coordinator',firmware:{phase:0},audio:{installed:false},sync:{version:legacy?2:3,role:1,leader:id,
      incarnation:legacy?'':incarnation,session:legacy?'':'0000000000000001',dissolutionV1:!legacy,scene:0,sceneCount:32,count:3,position:0,members:0,
      order:[{id,name:'Main',online:true},{id:ids[1],name:'Guest',online},{id:ids[3],name:'Third',online:true}]}},lamp={identity:id,epoch:7,raw,tail:Promise.resolve(),
      enqueue(work){const run=this.tail.then(work);this.tail=run.catch(()=>{});return run;},
      async refresh(expected){assert.equal(expected,id);reads.push(id);return raw;},
      async configureGroupOrder(order){calls.push({op:'order',id,order:clone(order)});return 'Order saved';},
    };
    return {id,epoch:7,lamp,busy:false};
  };
  context.initial=coordinator(ids[0]);
  runInNewContext(`
    let groupEditor=initial,sceneChoicesKey='',groupOrderKey='',groupSceneDirty=false,groupAudioDirty=false;
    const groupEditorMutations=new Set(),cardPowerTasks=new Set();
    let groupsSnapshot={groups:[{id:initial.id,pendingRemovalIds:[],removalPending:false}]};
    const lamp={identity:'ffffffffffff'},selected={id:'ffffffffffff'},state={sync:{role:0}};
    ${action}
    ${remove}
    ${renderer}
    globalThis.ui={editor:()=>groupEditor,setEditor:value=>{groupEditor=value;},render:renderGroupScenes,
      pending(id,targets){groupsSnapshot.groups=[{id,pendingRemovalIds:targets,removalPending:targets.length>0}];},
      switchId(){return lamp.identity;},runGroupSceneAction:groupSceneAction};
    renderGroupScenes();`,context);
  return {calls,reads,closed,elements,coordinator,ui:context.ui,setOutcome:next=>{outcome={...outcome,...next};},
    row:()=>element('groupOrder').children.find(row=>row.children[0]?.textContent.includes('Guest')),
    removeButton:()=>element('groupOrder').querySelectorAll('button').find(button=>/Remove|Retry removal|Confirm removal/.test(button.textContent)),
  };
}

test('production offline Remove uses confirmed per-member removal outside the editor queue',async()=>{
  const f=harness();await settled(f.removeButton().onclick());
  const removal=f.calls.find(call=>call.op==='remove');assert(removal,'Removal must use the confirmed member contract');
  assert.deepEqual(removal,{op:'remove',id:ids[0],target:ids[1],options:{expectedIncarnation:incarnation}});
  assert.equal(f.calls.filter(call=>call.op==='order').length,0);assert.equal(f.calls.filter(call=>call.op==='service-queue').length,1);
  assert.equal(f.ui.switchId(),'ffffffffffff');assert.equal(f.ui.editor().id,ids[0]);
});

test('an old rendered Remove button cannot operate a newly opened group containing the same member',async()=>{
  const f=harness(),old=f.removeButton();f.ui.setEditor(f.coordinator(ids[2]));f.ui.render();await settled(old.onclick());
  assert.equal(f.calls.length,0);assert.equal(f.ui.editor().id,ids[2]);
});

test('an old row cannot authorize removal after the same coordinator recreates its group',async()=>{
  const f=harness(),old=f.removeButton();f.ui.editor().lamp.raw.sync.incarnation='b'.repeat(32);await settled(old.onclick());
  assert.equal(f.calls.length,0);assert.equal(f.ui.editor().lamp.raw.sync.order.length,3);
});

test('an obsolete editor epoch cannot dispatch member removal',async()=>{
  const f=harness();f.ui.editor().lamp.epoch++;await settled(f.removeButton().onclick());assert.equal(f.calls.length,0);
});

test('pending removal remains visible and offers an explicit retry even after the member is online',async()=>{
  const f=harness({pending:true});await settled(f.removeButton().onclick());
  assert.equal(f.ui.editor().lamp.raw.sync.order.length,3);assert.match(f.elements.get('groupSceneFeedback').textContent,/pending|reach|confirm/i);
  assert.match(f.row().children[0].textContent,/pending/i);
  f.ui.editor().lamp.raw.sync.order[1].online=true;f.ui.render();
  const retry=f.removeButton();assert(retry);assert.equal(retry.disabled,false);assert.match(retry.textContent,/retry|confirm/i);
  f.setOutcome({phase:'member-removed',saved:true,pending:[],confirmed:[ids[1]]});await settled(retry.onclick());
  assert.equal(f.calls.filter(call=>call.op==='remove').length,2);assert.deepEqual(f.ui.editor().lamp.raw.sync.order.map(row=>row.id),[ids[0],ids[3]]);
});

test('pending member removal never reports the generic changes-applied success',async()=>{
  const f=harness({pending:true});await settled(f.removeButton().onclick());
  const message=f.elements.get('globalGroupEditorStatus').textContent;assert.match(message,/needs confirmation/i);assert.doesNotMatch(message,/changes applied|place.*kept/i);
  assert.equal(f.ui.editor().lamp.raw.sync.order.length,3);assert.equal(f.closed.length,0);
});

for(const [flag,advice]of [['storageFailed',/restore phone storage/i],['needsReconfirmation',/changed.*review/i],['needsAuthorization',/connect.*authorize/i]]){
  test('pending '+flag+' after pruning keeps confirmation status honest and gives specific recovery advice',async()=>{
    const f=harness({pending:true});f.setOutcome({pruned:true,pending:[{id:ids[1],[flag]:true}]});await settled(f.removeButton().onclick());
    assert.deepEqual(f.ui.editor().lamp.raw.sync.order.map(row=>row.id),[ids[0],ids[3]]);assert.equal(f.row(),undefined);
    const status=f.elements.get('globalGroupEditorStatus').textContent,feedback=f.elements.get('groupSceneFeedback').textContent;
    assert.match(status,/needs confirmation/i);assert.doesNotMatch(status,/changes applied|place.*kept|\bcompleted\b/i);
    assert.match(feedback,advice);assert.doesNotMatch(feedback,/place.*kept|lamp was removed|remaining group stays together/i);
    if(flag==='storageFailed')assert.doesNotMatch(feedback,/turn.*on|reconnect/i);
    assert.equal(f.closed.length,0);
  });
}

test('unsupported legacy removal is disabled instead of shortening its order',()=>{
  const f=harness({legacy:true}),button=f.removeButton();assert(button);assert.equal(button.disabled,true);
  assert.match(button.title,/update/i);assert.equal(f.calls.length,0);
});

test('unavailable removal capability, group identity or valid session keeps removal disabled',()=>{
  for(const mutate of [sync=>{sync.dissolutionV1=false;},sync=>{sync.incarnation='';},sync=>{sync.session='';},
    sync=>{sync.session='0000000000000000';},sync=>{sync.session='A'.repeat(16);}]){
    const f=harness();mutate(f.ui.editor().lamp.raw.sync);f.ui.render();const button=f.removeButton();
    assert(button);assert.equal(button.disabled,true);assert.match(button.title,/update/i);assert.equal(f.calls.length,0);
  }
});

test('a coordinator update or staged membership lock disables member removal',()=>{
  for(const mutate of [raw=>{raw.firmware.phase=3;},raw=>{raw.sync.membershipLocked=true;}]){
    const f=harness();mutate(f.ui.editor().lamp.raw);f.ui.render();const button=f.removeButton();
    assert(button);assert.equal(button.disabled,true);assert.equal(f.calls.length,0);
  }
});

test('ordinary order arrows keep all group positions and still use the reorder operation',async()=>{
  const f=harness(),earlier=f.row().children.find(child=>child.attributes['aria-label']==='Move Guest earlier');
  assert(earlier);await settled(earlier.onclick());
  assert.deepEqual(f.calls,[{op:'order',id:ids[0],order:[ids[1],ids[0],ids[3]]}]);
});

test('the editor closes only after confirmed removal also stops the coordinator',async()=>{
  const f=harness({stopped:true});await settled(f.removeButton().onclick());assert.deepEqual(f.closed,[ids[0]]);assert.equal(f.ui.editor(),null);
});
