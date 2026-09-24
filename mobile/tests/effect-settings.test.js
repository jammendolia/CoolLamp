import test from 'node:test';
import assert from 'node:assert/strict';
import { effectSettings } from '../src/effect-settings.js';
test('settings match actual effect behavior without relying on wire IDs',()=>{
  const solid=effectSettings({id:41,name:'Red',category:'color',speed:false});
  assert(!solid.motion && !solid.intensity && !solid.audio);
  const spectrum=effectSettings({id:2,name:'Spectrum Rise',category:'audio',speed:true});
  assert(spectrum.audio && spectrum.spectrum && spectrum.motion);
  assert.equal(spectrum.speedLabel,'Response speed');
  assert.equal(effectSettings({name:'Bass Launch',category:'audio',speed:true}).speedLabel,'Pulse speed');
  assert.equal(effectSettings({name:'Bouncing droplets - rising',speed:true}).intensityLabel,'Density & glow');
  assert.equal(effectSettings({name:'Rain',speed:true}).speedLabel,'Fall speed');
  const unknown=effectSettings({name:'Future effect',category:'audio',speed:false});
  assert(unknown.audio && !unknown.motion && !unknown.spectrum);
});
