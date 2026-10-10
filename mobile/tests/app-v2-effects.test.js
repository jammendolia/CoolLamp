import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveEffectModel,currentEffectModel,effectCompatibility,effectDisplayName,normalizeEffectAppearance,effectPalettePresets} from '../src/app-v2-effects.js';

const target='aabbccddeeff',other='112233445566';
const parameters=[
  {key:'speed',type:'integer',min:1,max:100,step:1,default:50,units:'percent',semanticRole:'motion'},
  {key:'intensity',type:'integer',min:0,max:100,step:1,default:100,units:'percent',semanticRole:'glow'}
];
const schema=(patch={})=>({key:'effect.rain',localId:3,motion:true,parameters:structuredClone(parameters),
  palette:{modes:['automatic','custom'],colorRoles:['primary','secondary'],secondaryToggle:true,defaults:[[128,160,255],[35,160,255]]},
  audio:{required:false,optional:false,source:'none'},persistence:'per-effect',...patch});
const page=(entry,owner=target,kind='effects')=>({schemaVersion:2,target:owner,kind,offset:0,next:1,total:1,entries:[entry]});
const fixture=(id=3)=>{
  const raw={deviceId:target,mode:id,power:false,brightness:55,colors:[],effectOptions:[],sync:{version:2,role:0},audio:{installed:true,gain:16,gate:0,scale:100,liveTuning:true}};
  raw.colors[id-1]=[1,0,0,0];raw.effectOptions[id-1]=[70,0,1,0,0,0];
  const state={...raw,supportsColor:true,capabilities:8,color:{enabled:true,r:0,g:0,b:0}};
  return {raw,state,targetId:target};
};
const members=(size=2,version=2)=>Array.from({length:size},(_,index)=>({id:index?'00000000000'+index:target,verified:true,available:true,
  sync:{version,sceneCount:32,...(version===3?{maxMembers:32,protocolVersions:[2,3]}:{})}}));

test('legacy semantics use the reported name rather than this lamp’s numerical ID',()=>{
  const solid=adaptiveEffectModel({id:199,name:'Red',category:'color',speed:false},fixture(199));
  assert.equal(solid.id,199);assert.equal(solid.name,'Red');assert.deepEqual(solid.controls,[]);
  const rain=adaptiveEffectModel({id:21,name:'Rain',category:'calm',speed:true},fixture(21));
  assert.equal(rain.controls[0].label,'Fall speed');assert.equal(rain.appearance.intensity,0);
  const old=adaptiveEffectModel({id:2,name:'Split fire - outward',category:'fire',speed:true},fixture(2));
  assert.equal(old.name,'Split fire - outward');assert.match(old.description,/flame/i);
});

test('rich schema follows immutable keys and retains the exact catalog wire ID and display name',()=>{
  const context=fixture(197),entry={id:197,name:'Rain in my room',category:'calm',speed:true};
  const model=adaptiveEffectModel(entry,{...context,schema:page(schema({localId:197,key:'effect.droplets-rising',parameters:[parameters[0],{...parameters[1],semanticRole:'density-and-glow'}]}))});
  assert.equal(model.schemaVersion,2);assert.equal(model.id,197);assert.equal(model.name,'Rain in my room');
  assert.equal(model.controls[0].label,'Travel speed');assert.equal(model.controls[1].label,'Density & glow');
  assert.match(model.controls[1].hint,/particles/);
});

test('schema pages cannot cross target or effect/scene boundaries',()=>{
  const entry={id:3,name:'Rain',category:'calm',speed:true},context=fixture();
  const hostile=page(schema({motion:false,parameters:[],palette:{modes:['fixed'],colorRoles:[]}}),other);
  assert.equal(adaptiveEffectModel(entry,{...context,schema:hostile}).schemaVersion,1);
  assert.equal(adaptiveEffectModel(entry,{...context,schema:page(schema(),target,'scenes')}).schemaVersion,1);
  assert.equal(adaptiveEffectModel(entry,{...context,schema:schema(),schemaTarget:other}).schemaVersion,1);
  assert.equal(adaptiveEffectModel(entry,{...context,schema:page(schema({localId:4}))}).schemaVersion,1);
});

test('unknown rich parameters are preserved as unavailable, never converted to guessed controls',()=>{
  const data=schema({parameters:[...parameters,{key:'sparks',type:'future-type',units:'percent',semanticRole:'future-density'}]});
  const model=adaptiveEffectModel({id:3,name:'Future rain',category:'other',speed:true},{...fixture(),schema:page(data)});
  assert.deepEqual(model.controls.map(value=>value.key),['speed','intensity']);
  assert.deepEqual(model.unsupportedParameters,[{key:'sparks',message:'This control needs a newer app.'}]);
  assert.equal(model.schemaVersion,2);
});

test('schema ranges must be compatible with current wire adapters',()=>{
  const incompatible=schema({parameters:[{...parameters[0],min:0,max:200,default:50}]});
  const model=adaptiveEffectModel({id:3,name:'Rain',speed:true},{...fixture(),schema:page(incompatible)});
  assert.deepEqual(model.controls,[]);assert.equal(model.unsupportedParameters[0].key,'speed');
  const broken=schema({parameters:[{...parameters[0],default:101}]});
  assert.equal(adaptiveEffectModel({id:3,name:'Rain',speed:true},{...fixture(),schema:page(broken)}).schemaVersion,1);
});

test('rich motion and parameter omissions override broad legacy profiles',()=>{
  const model=adaptiveEffectModel({id:3,name:'Rain',category:'calm',speed:true},{...fixture(),schema:page(schema({motion:false,parameters:[]}))});
  assert.equal(model.motion,false);assert.equal(model.intensity,false);assert.deepEqual(model.controls,[]);
  const disabledSpeed=adaptiveEffectModel({id:3,name:'Rain',speed:true},{...fixture(),schema:page(schema({motion:false}))});
  assert(!disabledSpeed.controls.some(value=>value.key==='speed'));
});

test('future effects use explicit schema audio-response semantics without guessed family details',()=>{
  const data=schema({key:'effect.future-audio',parameters:[{...parameters[0],semanticRole:'audio-response'}],audio:{required:true,source:'local-or-coordinator'}});
  const model=adaptiveEffectModel({id:3,name:'Future listening',category:'other',speed:true},{...fixture(),schema:page(data)});
  assert.equal(model.controls[0].label,'Response speed');assert.equal(model.audio.visible,true);assert.equal(model.audio.required,true);
});

test('normalization preserves black palettes, zero intensity, and an off lamp',()=>{
  const value=normalizeEffectAppearance({...fixture(),entry:{id:3}});
  assert.equal(value.power,false);assert.equal(value.intensity,0);assert.equal(value.speed,70);
  assert.deepEqual(value.primary,[0,0,0]);assert.deepEqual(value.secondary,[0,0,0]);assert.equal(value.dual,true);
  const model=adaptiveEffectModel({id:3,name:'Rain',speed:true},fixture());
  assert.equal(model.palette.colors[0].hex,'#000000');assert.equal(model.controls[1].value,0);assert.equal(model.controls[1].editable,true);
});

test('a late Bluetooth options callback cannot replace the selected effect’s saved slot',()=>{
  const context=fixture(),late={mode:2,speed:1,intensity:100,dual:0,r:255,g:255,b:255};
  assert.equal(normalizeEffectAppearance({...context,entry:{id:3},options:late}).speed,70);
  delete context.raw.effectOptions;
  assert.equal(normalizeEffectAppearance({...context,entry:{id:3},options:late}).speed,null);
});

test('incomplete values stay unavailable instead of silently writing defaults',()=>{
  const state={mode:3,power:true,brightness:50,supportsColor:true,capabilities:8};
  const model=adaptiveEffectModel({id:3,name:'Rain',speed:true},{state,schema:schema()});
  assert.equal(model.controls[0].value,null);assert.equal(model.controls[0].editable,false);
  assert.equal(model.appearance.custom,null);assert.equal(model.palette.colors[0].hex,null);
  assert.deepEqual(model.palette.colors[0].default,[128,160,255]);
});

test('fixed palettes have no color editors, presets, or reset affordance',()=>{
  const context=fixture();context.state.sync={version:2,role:1,leader:target,scene:15,sceneCount:32,count:2,sceneSpeed:50,sceneIntensity:85};
  const model=adaptiveEffectModel({id:15,name:'Prism split'},{...context,kind:'scene',members:members(),schema:page(schema({key:'scene.prism-split',localId:15,
    palette:{modes:['fixed'],colorRoles:[]},audio:{required:false,source:'coordinator'},persistence:'shared-group'}),target,'scenes')});
  assert.equal(model.palette.fixed,true);assert.deepEqual(model.palette.colors,[]);assert.equal(model.palette.canReset,false);
  assert.equal(model.palette.secondaryToggle,false);assert.equal(model.compatibility.allowed,true);
});

test('VU and fountain palette editors use their dedicated three-color adapters',()=>{
  const context=fixture(46);context.raw.vuColors=[[0,255,0],[255,255,0],[255,0,0]];
  const vu=adaptiveEffectModel({id:46,name:'VU Meter',category:'audio',speed:true},{...context,schema:page(schema({key:'effect.vu-meter',localId:46,
    palette:{modes:['custom'],colorRoles:['zone-low','zone-middle','zone-high']},audio:{required:true,source:'local-or-coordinator'}}))});
  assert.deepEqual(vu.palette.colors.map(value=>value.adapter),['vu-colors','vu-colors','vu-colors']);
  assert.deepEqual(vu.palette.colors.map(value=>value.label),['Low level','Middle level','Peak level']);
  assert.equal(vu.palette.secondaryToggle,false);
  const fountainContext=fixture(45);fountainContext.raw.fountainColors=[[255,65,0],[0,230,130],[75,30,255]];
  const fountain=adaptiveEffectModel({id:45,name:'Three-band Fountain',category:'audio',speed:true},fountainContext);
  assert.deepEqual(fountain.palette.colors.map(value=>value.adapter),['fountain-colors','fountain-colors','fountain-colors']);
  assert.equal(fountain.palette.colors[2].label,'Treble color');assert.equal(fountain.palette.label,'Frequency colors');
});

test('unknown color roles have no executable editor adapter',()=>{
  const model=adaptiveEffectModel({id:3,name:'Future color',speed:true},{...fixture(),schema:page(schema({palette:{modes:['custom'],colorRoles:['future-hue']}}))});
  assert.equal(model.palette.colors[0].adapter,null);assert.equal(model.palette.colors[0].editable,false);
});

test('audio controls disclose shared scope and preserve zero noise gate',()=>{
  const model=adaptiveEffectModel({id:3,name:'Sound glow',category:'audio',speed:true},fixture());
  assert.equal(model.audio.required,true);assert.equal(model.audio.available,true);assert.equal(model.audio.editable,true);assert.equal(model.audio.restarts,false);
  assert.equal(model.audio.controls.find(value=>value.key==='gate').value,0);assert.match(model.audio.scope,/All sound effects/);
  const old=fixture();old.raw.audio.liveTuning=false;
  assert.equal(adaptiveEffectModel({id:3,name:'Sound glow',category:'audio',speed:true},old).audio.restarts,true);
});

test('optional Ping-pong sound stays usable without a microphone, required sound does not',()=>{
  const sync={version:2,sceneCount:32,count:2},base={kind:'scene',microphone:false,sync,members:members()};
  assert.equal(effectCompatibility({id:2,name:'Ping-pong'},base).allowed,true);
  const required=effectCompatibility({id:29,name:'Bass turbine'},base);
  assert.equal(required.status,'blocked');assert.match(required.message,/microphone/);
  const optionalSchema=schema({key:'scene.ping-pong',localId:2,audio:{required:false,optional:true,source:'coordinator'},persistence:'shared-group'});
  const model=adaptiveEffectModel({id:2,name:'Ping-pong'},{...base,schema:page(optionalSchema,target,'scenes'),targetId:target});
  assert.equal(model.audio.visible,true);assert.equal(model.audio.required,false);assert.equal(model.audio.optional,true);
});

test('scene compatibility checks every member and the two-lamp minimum',()=>{
  assert.equal(effectCompatibility({id:1},{kind:'scene',groupSize:1,sceneCount:32}).status,'blocked');
  const rows=members();rows[1].sync.sceneCount=8;
  const mixed=effectCompatibility({id:27,name:'Chromatic screw'},{kind:'scene',groupSize:2,sceneCount:32,members:rows});
  assert.equal(mixed.status,'blocked');assert.deepEqual(mixed.issues.find(value=>value.code==='member-version').ids,[rows[1].id]);
  rows[1].sync.sceneCount=32;rows[1].available=false;
  assert.equal(effectCompatibility({id:27},{kind:'scene',groupSize:2,sceneCount:32,members:rows}).status,'unknown');
  assert.equal(effectCompatibility({id:27},{kind:'scene',groupSize:2,sceneCount:32,members:[]}).status,'unknown');
});

test('expanded groups require protocol 3 and each member’s negotiated capacity',()=>{
  const rows=members(20,3),context={kind:'scene',groupSize:20,sceneCount:32,members:rows};
  assert.equal(effectCompatibility({id:27},context).allowed,true);
  rows[19].sync={version:2,sceneCount:32};
  assert.equal(effectCompatibility({id:27},context).status,'blocked');
  rows[19].sync={version:3,sceneCount:32,maxMembers:9,protocolVersions:[2,3]};
  assert.equal(effectCompatibility({id:27},context).status,'blocked');
});

test('appearance persistence never claims that a legacy save leaves startup untouched',()=>{
  const entry={id:3,name:'Rain',speed:true};
  assert.equal(adaptiveEffectModel(entry,fixture()).persistence.label,'Use current light at startup');
  const current=adaptiveEffectModel(entry,{...fixture(),descriptor:{capabilities:{persistence:['per-effect-appearance-v2']}},schema:schema()});
  assert.equal(current.persistence.separateAppearanceSave,true);assert.match(current.persistence.hint,/without changing/);
  const group=adaptiveEffectModel({id:5,name:'Orbit'},{kind:'scene'});
  assert.match(group.persistence.hint,/shared between group scenes/);
});

test('current effect names come from the selected catalog and actual rendering, never another local ID list',()=>{
  const context=fixture();context.raw.render={mode:21,power:true};
  delete context.state;
  const model=currentEffectModel({...context,catalog:[{id:3,name:'Not running',speed:true},{id:21,name:'My new effect',speed:false}]});
  assert.equal(model.id,21);assert.equal(model.name,'My new effect');assert.equal(model.power,true);
  assert.equal(currentEffectModel({...fixture(),targetId:other,catalog:[]}),null);
  assert.equal(currentEffectModel({state:{mode:0,power:true}}),null);
});

test('current group scene, mirror, paused follower, and stale follower remain distinct',()=>{
  const context=fixture(),catalog=[{id:3,name:'Local rain',category:'calm',speed:true}];
  context.state.sync={version:3,role:2,leader:other,active:true,paused:false,scene:27,sceneCount:32,count:2};
  const scene=currentEffectModel({...context,catalog});
  assert.equal(scene.kind,'scene');assert.equal(scene.name,'Chromatic screw');assert.equal(scene.following,true);assert.equal(scene.power,false);
  context.state.sync.scene=0;
  assert.equal(currentEffectModel({...context,catalog}).label,'Off · Local rain');
  context.state.power=true;
  assert.equal(currentEffectModel({...context,catalog}).label,'Together · Local rain');
  context.state.sync.paused=true;
  assert.equal(currentEffectModel({...context,catalog}).groupPlayback,false);
  context.state.sync.paused=false;context.state.sync.active=false;context.state.sync.scene=27;
  assert.equal(currentEffectModel({...context,catalog}).name,'Local rain');
});

test('current rich scenes resolve immutable keys without borrowing legacy scene ID names',()=>{
  const context=fixture();context.state.sync={version:3,role:1,leader:target,scene:3,sceneCount:32,count:2};
  const rich=schema({key:'scene.aurora-braid',localId:3,audio:{required:true,source:'coordinator'},persistence:'shared-group'});
  const moved=currentEffectModel({...context,sceneSchemas:page(rich,target,'scenes')});
  assert.equal(moved.id,3);assert.equal(moved.name,'Aurora braid');
  rich.key='scene.future';rich.audio.required=false;
  assert.equal(currentEffectModel({...context,sceneSchemas:page(rich,target,'scenes')}).name,'Group scene 3');
});

test('Mirror effects has no invented scene adjustment or palette controls',()=>{
  const model=adaptiveEffectModel({id:0,name:'Mirror effects'},{kind:'scene'});
  assert.deepEqual(model.controls,[]);assert.deepEqual(model.palette.colors,[]);
  assert.equal(model.palette.secondaryToggle,false);
});

test('invalid group identity cannot turn a local effect into an apparent group scene',()=>{
  const context=fixture();context.state.sync={version:3,role:2,leader:target,active:true,paused:false,scene:27,sceneCount:32};
  assert.equal(currentEffectModel(context),null);
  context.state.sync={...context.state.sync,role:1,leader:other};assert.equal(currentEffectModel(context),null);
});

test('unknown effect naming is honest, metadata stays data, and helpers never mutate inputs',()=>{
  assert.equal(effectDisplayName({localId:198,key:'effect.future'}),'Effect 198');
  assert.equal(effectDisplayName({localId:198,key:'effect.rain'}),'Rain');
  assert.equal(effectDisplayName({id:3,name:'<script>rain</script>'}),'<script>rain</script>');
  assert.equal(effectDisplayName({id:3,name:'bad\u0000name'}),'Effect 3');
  const context=fixture(),entry={id:3,name:'Rain',speed:true},rich=page(schema()),before=structuredClone({context,entry,rich});
  const model=adaptiveEffectModel(entry,{...context,schema:rich});
  model.appearance.primary[0]=255;model.palette.colors[0].default[0]=0;
  assert.deepEqual({context,entry,rich},before);
});

test('palette suggestions adapt to actual role count and return independent RGB data',()=>{
  const two=effectPalettePresets(['primary','secondary']),three=effectPalettePresets(3);
  assert.equal(two.length,6);assert(two.every(value=>value.colors.length===2));assert(three.every(value=>value.colors.length===3));
  assert(two.every(value=>value.hex.every(color=>/^#[0-9a-f]{6}$/.test(color))));
  two[0].colors[0][0]=0;assert.equal(effectPalettePresets(2)[0].colors[0][0],255);
  assert.deepEqual(effectPalettePresets(0),[]);assert.deepEqual(effectPalettePresets(4),[]);
});
