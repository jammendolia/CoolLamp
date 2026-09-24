import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, legacyCatalog } from '../src/catalog.js';
import { effects, encodeCommand, decodeState } from '../src/protocol.js';

test('microphone variants keep existing IDs and expose audio only in the advertised catalog', () => {
  const base=legacyCatalog(effects);
  const audio=validateCatalog([...base,{id:39,name:'Sound glow',category:'audio',speed:true},
    {id:40,name:'Sound meter',category:'audio',speed:true},...['Spectrum Rise','Bass Launch','Spectral Embers','Beat Bloom','Three-band Fountain','VU Meter'].map((name,i)=>({id:41+i,name,category:'audio',speed:true}))],46);
  assert.deepEqual(audio.slice(0,38),base);
  assert(audio.slice(38).every(e=>e.category==='audio'));
  assert(base.every(e=>e.category!=='audio'));
  assert.throws(()=>encodeCommand(1,'effect',39,38));
  assert.equal(encodeCommand(1,'effect',40,40).getUint8(3),40);
  for(const count of [38,40,45,46]) {
    const packet=new DataView(Uint8Array.of(1,0,0,count,100,1,count,63,0,0,0,0,1,255,60,110).buffer);
    assert.equal(decodeState(packet).effectCount,count);
  }
});
