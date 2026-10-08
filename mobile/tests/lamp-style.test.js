import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  LAMP_STYLES,styleDefinition,normalizeLampStyle,styleFamily,styleLabel,resolveLampStyle,
  effectRecommendation,effectRecommended,recommendedEffects
} from '../src/lamp-style.js';

const descriptor = id => {
  const {code,family}=styleDefinition(id);
  return {version:1,id,code,family};
};
const effect = (name,id=1,extra={}) => ({id,name,category:'other',speed:true,...extra});
const source=readFileSync(new URL('../../LampNetwork.ino',import.meta.url),'utf8');
const catalogBlock=source.match(/const char\* const effectNames\[\] = \{([\s\S]*?)\};/);
assert(catalogBlock,'Read the actual lamp catalog rather than constructing an app replacement.');
const actualCatalog=[...catalogBlock[1].matchAll(/"([^"]*)"/g)].map((match,index)=>effect(match[1],index+1));

test('stable physical choices expose only trusted labels and immutable definitions',()=>{
  assert.deepEqual(LAMP_STYLES.map(({id,code,family,label})=>[id,code,family,label]),[
    ['unspecified',0,'unspecified','Not specified'],['helix',1,'helix','Helix'],
    ['large-helix',2,'helix','Large helix'],['corkscrew',3,'corkscrew','Corkscrew']
  ]);
  assert(Object.isFrozen(LAMP_STYLES));
  for(const value of LAMP_STYLES)assert(Object.isFrozen(value));
  assert.throws(()=>{styleDefinition('helix').label='Wrong';});
  assert.equal(styleLabel('<img onerror="unsafe">'),'Not specified');
  assert.equal(styleFamily('large-helix'),'helix');
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
