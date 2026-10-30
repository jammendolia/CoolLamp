import test from 'node:test';
import assert from 'node:assert/strict';
import {LampStore} from '../src/lamps.js';

const id='aabbccddeeff',deviceId='authorized-native-device';
const routeFields={meshOnline:true,meshHops:1,meshBridgeId:'112233445566',meshRoutes:[{gatewayId:'112233445566',targetId:id,expiresAt:Infinity,key:'never-persist'}],meshObservedAt:1000,meshExpiresAt:16000};
const display={id,deviceId,name:'Sonata Left',room:'Downstairs',phoneLampStyle:'sonata',favorites:[4,53],firmwareVersion:'1.15.7',accessoryManaged:true,meshEnrolled:true};
function fixture(value=[]){
 const values=new Map([['coollamp-lamps',JSON.stringify(value)],['unrelated-preference','keep'],['credential-reference','native-vault-only']]),writes=[];
 return {values,writes,storage:{getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,value);},removeItem(key){values.delete(key);}}};
}
function assertClean(entry){for(const field of Object.keys(routeFields))assert.equal(Object.hasOwn(entry,field),false,field);}

test('loading old mesh freshness strips only ephemeral fields without clearing or rewriting saved settings',()=>{
 const saved={...display,...routeFields},f=fixture([saved]),original=f.values.get('coollamp-lamps'),store=new LampStore(f.storage);
 assert.deepEqual(store.items,[display]);assertClean(store.items[0]);assert.deepEqual(f.writes,[]);assert.equal(f.values.get('coollamp-lamps'),original);
 assert.equal(f.values.get('unrelated-preference'),'keep');assert.equal(f.values.get('credential-reference'),'native-vault-only');
});

test('foreground mesh upsert never persists a route snapshot, freshness or private nested fields',()=>{
 const f=fixture([display]),store=new LampStore(f.storage),entry={...display,...routeFields},before=structuredClone(entry);
 const result=store.upsert(entry);assertClean(result);assert.deepEqual(result,display);assert.deepEqual(entry,before,'caller snapshots are not mutated');
 assert.deepEqual(JSON.parse(f.values.get('coollamp-lamps')),[display]);assert(!f.values.get('coollamp-lamps').includes('never-persist'));
});

test('native identity migration retains names and user metadata while removing mesh hints from both records',()=>{
 const prior={...display,id:'ble:placeholder',...routeFields},f=fixture([prior]),store=new LampStore(f.storage);
 const result=store.upsert({id,deviceId,...routeFields});assert.equal(store.items.length,1);assert.deepEqual(result,display);assertClean(result);
 assert.equal(f.values.get('credential-reference'),'native-vault-only');
});

test('save sanitizes directly introduced legacy fields and leaves clean record identities unchanged',()=>{
 const f=fixture([display]),store=new LampStore(f.storage),clean=store.items[0];store.save();assert.equal(store.items[0],clean);
 Object.assign(store.items[0],routeFields);store.save();assertClean(store.items[0]);assert.deepEqual(store.items[0],display);assertClean(JSON.parse(f.values.get('coollamp-lamps'))[0]);
});

test('Wi-Fi nickname preservation and subsequent style/firmware saves use the same clean record',()=>{
 const f=fixture([display]),store=new LampStore(f.storage),entry=store.upsertWifi({...display,name:'CoolLamp-eeff11',...routeFields});
 assert.equal(entry.name,'Sonata Left');assertClean(entry);assert.equal(store.items[0],entry);
 store.rememberFirmware(id,{version:'1.15.8',checkedAt:1000});assert.equal(store.items[0],entry);assert.equal(entry.firmwareVersion,'1.15.8');assertClean(JSON.parse(f.values.get('coollamp-lamps'))[0]);
});
