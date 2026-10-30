import test from 'node:test';
import assert from 'node:assert/strict';
import {firmwareEffectCatalog} from './fixtures/firmware-catalog.js';
import {
  LAMP_STYLES,styleDefinition,normalizeLampStyle,normalizeLampModel,lampStyleLocked,lampDesignLabel,lampStyleUsesWholeStrip,styleFamily,styleLabel,resolveLampStyle,
  effectRecommendation,effectRecommended,recommendedEffects
} from '../src/lamp-style.js';

const descriptor = id => {
  const {code,family}=styleDefinition(id);
  return {version:1,id,code,family};
};
const effect = (name,id=1,extra={}) => ({id,name,category:'other',speed:true,...extra});
const actualCatalog=firmwareEffectCatalog.map(({id,name})=>effect(name,id));

test('stable physical choices expose only trusted labels and immutable definitions',()=>{
  assert.deepEqual(LAMP_STYLES.map(({id,code,family,label})=>[id,code,family,label]),[
    ['unspecified',0,'unspecified','Not specified'],['helix',1,'helix','Helix'],
    ['large-helix',2,'helix','Large helix'],['corkscrew',3,'corkscrew','Corkscrew'],
    ['edison',4,'edison','Edison'],['sonata',5,'sonata','Sonata']
  ]);
  assert(Object.isFrozen(LAMP_STYLES));
  for(const value of LAMP_STYLES)assert(Object.isFrozen(value));
  assert.throws(()=>{styleDefinition('helix').label='Wrong';});
  assert.equal(styleLabel('<img onerror="unsafe">'),'Not specified');
  assert.equal(styleFamily('large-helix'),'helix');
});

test('Edison is independent display metadata, with no invented geometry or effect restrictions',()=>{
  const value={...descriptor('edison'),locked:true,factoryStyle:'edison',model:{version:1,id:'edison-v1',displayName:'CoolLamp Edison',artworkFamily:'edison',hardwareRevision:'unspecified',preconfigured:true}};
  assert.deepEqual(normalizeLampStyle(value),value);
  assert.equal(styleLabel(value),'Edison');assert.equal(styleFamily(value),'edison');
  assert.deepEqual(resolveLampStyle(value,'helix'),{id:'edison',source:'lamp'});
  assert.equal(lampDesignLabel(value),'CoolLamp Edison');assert.equal(lampStyleLocked(value),true);
  assert(!Object.hasOwn(styleDefinition('edison'),'ledCount'));assert(!Object.hasOwn(styleDefinition('edison'),'midpoint'));
  assert.equal(effectRecommendation(effect('Rain'),'edison'),'general');
  const supported=effect('Future Edison effect',99,{styles:['edison']});
  assert.equal(effectRecommendation(supported,'edison'),'recommended');
  assert.equal(supported.id,99);
});

test('Sonata appends its own style without inferring LED count, stored center or a firmware capability from a phone choice',()=>{
  const value=descriptor('sonata');assert.deepEqual(normalizeLampStyle(value),value);
  assert.equal(styleLabel(value),'Sonata');assert.equal(styleFamily(value),'sonata');
  assert(lampStyleUsesWholeStrip(value));
  for(const untrusted of ['sonata',{id:'sonata'},{...value,code:4},{...value,family:'helix'},descriptor('helix'),null])assert.equal(lampStyleUsesWholeStrip(untrusted),false);
  assert(!Object.hasOwn(styleDefinition('sonata'),'ledCount'));assert(!Object.hasOwn(styleDefinition('sonata'),'midpoint'));
  assert.deepEqual(resolveLampStyle(value,'edison'),{id:'sonata',source:'lamp'});
  const catalog=[effect('Aria',53),effect('Duet',54),effect('Cadenza',55),effect('Color tide',32),effect('Rain',3),effect('Future',99)];
  assert.deepEqual(recommendedEffects(catalog,'sonata').map(entry=>entry.id),[53,54,55,32]);
  assert.deepEqual(recommendedEffects(catalog.slice(4),'sonata'),[],'Style does not add unadvertised effects.');
  assert.deepEqual(recommendedEffects(catalog,'edison'),[]);
});

test('firmware descriptors require consistent version, numeric code, string ID and family',()=>{
  for(const value of LAMP_STYLES)assert.equal(styleDefinition(descriptor(value.id)),value);
  for(const bad of [null,undefined,1,{},[],{id:'helix'},
    {version:2,code:1,id:'helix',family:'helix'},
    {version:1,code:'1',id:'helix',family:'helix'},
    {version:1,code:1,id:1,family:'helix'},
    {version:1,code:2,id:'helix',family:'helix'},
    {version:1,code:1,id:'helix',family:'corkscrew'},
    {version:1,code:4,id:'future',family:'helix'}])assert.equal(styleDefinition(bad),null);
  assert.equal(styleDefinition('Helix'),null);
  assert.equal(styleDefinition(' helix'),null);
});

test('normalization accepts only stable IDs or consistent descriptors and copies public fields only',()=>{
  for(const {id} of LAMP_STYLES) {
    const expected=descriptor(id);
    assert.deepEqual(normalizeLampStyle(id),expected);
    const supplied={...expected,label:'<img>',password:'private',key:'private',nested:{token:'private'}};
    const normalized=normalizeLampStyle(supplied);
    assert.deepEqual(normalized,expected);assert.notEqual(normalized,supplied);
    assert(!JSON.stringify(normalized).includes('private'));
    normalized.id='mutated';assert.equal(styleDefinition(id).id,id);
  }
  for(const bad of [null,undefined,[],0,1,true,'1','Helix','unknown',{},
    {...descriptor('helix'),version:2},{...descriptor('helix'),code:2},
    {...descriptor('helix'),code:'1'},{...descriptor('helix'),family:'corkscrew'}])
    assert.equal(normalizeLampStyle(bad),null);
});

test('a valid explicit lamp style takes precedence and strips untrusted descriptor extras',()=>{
  assert.deepEqual(resolveLampStyle({...descriptor('corkscrew'),label:'Injected',key:'private'},'helix'),{id:'corkscrew',source:'lamp'});
  assert.deepEqual(resolveLampStyle('large-helix','corkscrew'),{id:'large-helix',source:'lamp'});
  assert.equal(styleDefinition({...descriptor('helix'),label:'Injected'}).label,'Helix');
});

test('factory design metadata preserves bounded future identity without guessing artwork or accepting secrets',()=>{
  const model={version:1,id:'future-coil-2070',displayName:'Future Coil',artworkFamily:'future-art',hardwareRevision:'rev-z',preconfigured:true};
  const raw={...descriptor('unspecified'),locked:true,factoryStyle:'future-coil',model:{...model,password:'private'},token:'private'};
  const normalized=normalizeLampStyle(raw);
  assert.deepEqual(normalized,{...descriptor('unspecified'),locked:true,factoryStyle:'future-coil',model});
  assert.equal(lampStyleLocked(normalized),true);assert.equal(lampDesignLabel(normalized),'Future Coil');
  assert.deepEqual(resolveLampStyle(normalized,'corkscrew'),{id:'unspecified',source:'lamp'});
  assert(!JSON.stringify(normalized).includes('private'));assert.notEqual(normalized.model,raw.model);
  assert.equal(lampStyleLocked(descriptor('helix')),false);assert.equal(lampStyleLocked({...descriptor('helix'),locked:'true'}),false);
  for(const bad of [{...model,id:'<script>'},{...model,id:'a'.repeat(65)},{...model,displayName:'a'.repeat(65)},{...model,displayName:'bad\nname'},{...model,version:2},{...model,preconfigured:1}]){
    assert.equal(normalizeLampModel(bad),null);
    const locked=normalizeLampStyle({...raw,model:bad});assert.equal(locked.locked,true);assert.equal(locked.model,undefined);
    assert.deepEqual(resolveLampStyle(locked,'helix'),{id:'unspecified',source:'lamp'});
  }
  const unavailable=normalizeLampStyle({...descriptor('unspecified'),locked:true,factoryStatus:'unavailable'});
  assert.equal(lampDesignLabel(unavailable),'Factory design unavailable');assert.equal(unavailable.factoryStatus,'unavailable');
});

test('model limits match the firmware record byte capacities exactly',()=>{
  const model={version:1,id:'m'.repeat(48),displayName:'é'.repeat(32),artworkFamily:'a'.repeat(32),hardwareRevision:'h'.repeat(32),preconfigured:true};
  assert.deepEqual(normalizeLampModel(model),model);
  for(const [field,value] of [['id','m'.repeat(49)],['displayName','é'.repeat(33)],['artworkFamily','a'.repeat(33)],['hardwareRevision','h'.repeat(33)]])assert.equal(normalizeLampModel({...model,[field]:value}),null,field);
});

test('legacy or unspecified lamp style uses only a validated phone choice',()=>{
  for(const raw of [undefined,null,descriptor('unspecified'),{...descriptor('helix'),version:2},
    {version:1,code:1,id:'helix',family:'wrong'}]) {
    assert.deepEqual(resolveLampStyle(raw,'corkscrew'),{id:'corkscrew',source:'phone'});
  }
  for(const phone of [undefined,null,1,descriptor('helix'),'future','unspecified'])
    assert.deepEqual(resolveLampStyle(undefined,phone),{id:'unspecified',source:'unspecified'});
});

test('names, LED counts and identity-like fields never infer a physical style',()=>{
  for(const raw of [{name:'Big Ass CoolLamp',ledCount:500},{name:'Corkscrew',id:'corkscrew'},
    {style:'helix'},{code:3},{id:'aabbccddeeff',family:'helix'}]) {
    assert.equal(styleDefinition(raw),null);
    assert.deepEqual(resolveLampStyle(raw,undefined),{id:'unspecified',source:'unspecified'});
  }
});

test('unspecified filtering copies the authoritative catalog without changing objects, IDs or order',()=>{
  const catalog=Object.freeze([Object.freeze(effect('Future',99)),Object.freeze(effect('White',5)),Object.freeze(effect('Rain',31))]);
  const result=recommendedEffects(catalog,'unspecified');
  assert.deepEqual(result,catalog);assert.notEqual(result,catalog);
  result.forEach((entry,index)=>assert.equal(entry,catalog[index]));
  assert.deepEqual(recommendedEffects(catalog,'future'),catalog);
});

test('reviewed height patterns are highlighted on both designs; uniform effects remain general',()=>{
  for(const style of ['helix','large-helix','corkscrew']) {
    for(const name of ['Rain','Comet collision','Split fire - falling','Bouncing droplets - rising','VU Meter','Beat Bloom'])
      assert.equal(effectRecommendation(effect(name),style),'recommended');
    for(const name of ['White','Custom solid','Breathing glow','Sound glow','Confetti']) {
      assert.equal(effectRecommendation(effect(name),style),'general');
      assert.equal(effectRecommended(effect(name),style),false);
    }
  }
  assert.equal(effectRecommendation(effect('Sinelon'),'corkscrew'),'recommended');
  assert.equal(effectRecommendation(effect('Sinelon'),'helix'),'general');
});

test('recommendations meaningfully narrow the real 47-effect catalog and share helix-family results',()=>{
  const reviewed=actualCatalog.slice(0,47);assert.equal(reviewed.length,47);
  const helix=recommendedEffects(reviewed,'helix'),large=recommendedEffects(reviewed,'large-helix'),corkscrew=recommendedEffects(reviewed,'corkscrew');
  assert.equal(helix.length,19);assert.equal(corkscrew.length,31);
  assert.deepEqual(large,helix);assert.notDeepEqual(corkscrew,helix);
  for(const style of ['helix','large-helix','corkscrew'])
    assert(reviewed.every(entry=>effectRecommendation(entry,style)!=='unclassified'));
});

test('the five real Edison effects are recommended only for Edison without changing wire IDs or order',()=>{
  const edison=actualCatalog.slice(47,52);
  assert.deepEqual(edison.map(({name})=>name),['Filament','Eureka','Orbit','Induction','Sound Filament']);
  assert.deepEqual(edison.map(({id})=>id),[48,49,50,51,52]);
  assert.deepEqual(recommendedEffects(actualCatalog,'edison'),edison);
  for(const entry of edison){
    assert.equal(effectRecommendation(entry,'edison'),'recommended');
    assert.equal(effectRecommendation(effect(entry.name.toUpperCase(),220),'edison'),'recommended');
    for(const style of ['helix','large-helix','corkscrew'])assert.equal(effectRecommendation(entry,style),'general');
  }
  assert.deepEqual(recommendedEffects(edison,'helix'),[]);
  assert.deepEqual(recommendedEffects(edison,'corkscrew'),[]);
  recommendedEffects(actualCatalog,'edison').forEach((entry,index)=>assert.equal(entry,edison[index]));
  assert.deepEqual(recommendedEffects(actualCatalog,'unspecified'),actualCatalog);
});

test('firmware recommendation metadata overrides Edison name fallbacks',()=>{
  assert.equal(effectRecommendation(effect('Filament',48,{styles:[]}),'edison'),'general');
  assert.equal(effectRecommendation(effect('Orbit',50,{styles:['corkscrew']}),'edison'),'general');
  assert.equal(effectRecommendation(effect('Orbit',50,{styles:['corkscrew']}),'corkscrew'),'recommended');
  assert.equal(effectRecommendation(effect('Eureka',49,{styles:['future']}),'edison'),'unclassified');
});

test('classification uses actual names rather than local wire IDs or categories',()=>{
  assert.equal(effectRecommendation(effect('Unseen effect',3,{category:'fire'}),'helix'),'unclassified');
  assert.equal(effectRecommended(effect('Rain',220),'helix'),true);
  assert.equal(effectRecommended(effect('Rain renamed',3),'helix'),false);
  assert.equal(effectRecommended(effect('RAIN',200),'helix'),true);
});

test('legacy labels retain their reviewed recommendation with arbitrary IDs',()=>{
  for(const name of ['Split fire','Split fire - outward','Split fire - reversed colors','Bouncing droplets'])
    assert.equal(effectRecommended(effect(name,201),'helix'),true);
});

test('explicit style metadata takes precedence over local name fallback for known and new entries',()=>{
  const future=effect('Unknown future scene',99,{styles:['helix']});
  assert.equal(effectRecommendation(future,'helix'),'recommended');
  assert.equal(effectRecommendation(future,'corkscrew'),'general');
  assert.equal(effectRecommendation(effect('Rain',3,{styles:['corkscrew']}),'helix'),'general');
  assert.equal(effectRecommendation(effect('Rain',3,{styles:[]}),'corkscrew'),'general');
});

test('explicit small and large helix recommendations both apply to the shared helix family',()=>{
  for(const advertised of ['helix','large-helix'])for(const actual of ['helix','large-helix'])
    assert.equal(effectRecommendation(effect('Future',99,{styles:[advertised]}),actual),'recommended');
});

test('unknown or malformed explicit styles stay unclassified without overwriting firmware intent',()=>{
  for(const styles of [null,undefined,'helix',['future'],['helix','future'],['unspecified'],[1],[descriptor('helix')],Array(17).fill('helix')]) {
    const entry=Object.freeze(effect('Rain',3,{styles}));
    assert.equal(effectRecommendation(entry,'helix'),'unclassified');
    assert.equal(effectRecommended(entry,'helix'),false);
    assert.deepEqual(recommendedEffects([entry],'unspecified'),[entry]);
  }
});

test('future effects remain in All and filtering retains sparse IDs, repeated entries and their order',()=>{
  const future=effect('Future effect',224),rain=Object.freeze(effect('Rain',80)),bloom=Object.freeze(effect('Beat Bloom',16));
  const catalog=Object.freeze([future,rain,effect('White',4),bloom,rain]);
  assert.equal(effectRecommendation(future,'corkscrew'),'unclassified');
  assert.deepEqual(recommendedEffects(catalog,'helix'),[rain,bloom,rain]);
  assert.deepEqual(recommendedEffects(catalog,'unspecified'),catalog);
  assert.deepEqual(catalog.map(entry=>entry.id),[224,80,4,16,80]);
});

test('empty, absent and unknown-style inputs do not manufacture effects or recommendations',()=>{
  assert.deepEqual(recommendedEffects([],descriptor('helix')),[]);
  for(const value of [undefined,null,{},'Rain'])assert.deepEqual(recommendedEffects(value,'helix'),[]);
  for(const style of [undefined,'future',1,{version:9,id:'helix'}])
    assert.equal(effectRecommendation(effect('Rain'),style),'unclassified');
  assert.equal(effectRecommendation(null,'helix'),'unclassified');
});
