import test from 'node:test';
import assert from 'node:assert/strict';
import {LampStore} from '../src/lamps.js';
test('production lamp inventory stores separate versioned group removal intent and propagates storage errors',()=>{
  const values=new Map([['coollamp-lamps',JSON.stringify([{id:'112233445566',name:'Living room'}])]]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const store=new LampStore(storage),before=values.get('coollamp-lamps');assert.equal(store.loadGroupRemovalIntents(),null);
  const intent={version:1,sources:[{source:'112233445566',targets:['aabbccddeeff'],dissolve:true}]};
  assert.equal(store.saveGroupRemovalIntents(intent),true);assert.deepEqual(new LampStore(storage).loadGroupRemovalIntents(),intent);
  assert.equal(values.get('coollamp-lamps'),before);assert.equal(store.items[0].name,'Living room');
  values.set('coollamp-group-removals-v1','{');assert.throws(()=>store.loadGroupRemovalIntents());
  storage.setItem=()=>{throw Error('storage full');};assert.throws(()=>store.saveGroupRemovalIntents(intent),/storage full/);
});
