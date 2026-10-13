import test from 'node:test';
import assert from 'node:assert/strict';
import {HELP_INTRO,HELP_TOPICS,HELP_ACTION_IDS} from '../src/help.js';

const text=topic=>[topic.title,topic.summary,...topic.paragraphs||[],...topic.steps||[],...topic.paragraphsAfter||[],topic.action?.label||''].join(' ');
const topic=id=>{const value=HELP_TOPICS.find(row=>row.id===id);assert.ok(value,`Missing help topic: ${id}`);return text(value);};

test('help stays succinct, bounded and immutable for a task-at-a-time reader',()=>{
 assert.ok(Object.isFrozen(HELP_TOPICS));assert.equal(HELP_TOPICS.length,12);
 assert.ok(HELP_INTRO.length<=100);assert.ok(JSON.stringify(HELP_TOPICS).length<=8192);
 let words=HELP_INTRO.split(/\s+/).length;
 const ids=new Set();
 for(const value of HELP_TOPICS){
  assert.ok(Object.isFrozen(value));assert.match(value.id,/^[a-z][a-z-]{0,31}$/);assert.ok(!ids.has(value.id));ids.add(value.id);
  assert.ok(value.title.length<=48);assert.ok(value.summary.length<=64);
  assert.ok(text(value).split(/\s+/).length<=140);words+=text(value).split(/\s+/).length;
  for(const key of ['paragraphs','steps','paragraphsAfter'])if(value[key]){
   assert.ok(Object.isFrozen(value[key]));assert.ok(value[key].length<=6);
   for(const line of value[key])assert.ok(typeof line==='string'&&line.length>0&&line.length<=330);
  }
 }
 assert.ok(words<=900,`Help contains ${words} words`);
 assert.throws(()=>{HELP_TOPICS[0].title='Changed';},TypeError);
 assert.throws(()=>{HELP_TOPICS[0].steps.push('Changed');},TypeError);
});

test('help actions are plain known destinations with no commands or target authority',()=>{
 assert.deepEqual(HELP_ACTION_IDS,['setup','lamps','effects','settings','groups','audio-guide','center-settings','updates']);
 assert.ok(Object.isFrozen(HELP_ACTION_IDS));
 for(const value of HELP_TOPICS){
  assert.ok(Object.keys(value).every(key=>['id','title','summary','paragraphs','steps','paragraphsAfter','action'].includes(key)));
  if(value.action){
   assert.ok(Object.isFrozen(value.action));assert.deepEqual(Object.keys(value.action).sort(),['id','label']);
   assert.ok(HELP_ACTION_IDS.includes(value.action.id));assert.ok(value.action.label.length<=40);
  }
  assert.doesNotMatch(text(value),/<[^>]*>|javascript:|GPIO|NVS|MTU|SHA-256/);
 }
});

test('setup and physical knob guidance keep blue pairing separate from red release-to-reset',()=>{
 assert.match(topic('setup'),/six seconds until blue, then release/);
 assert.match(topic('setup'),/Never keep holding after blue/);
 assert.match(topic('setup'),/pattern only when the lamp matches/);
 const knob=topic('knob');
 for(const pattern of [/Turn: choose another effect/,/Click, then turn: brightness/,/Double-click, then turn: color/,/Triple-click: turn off/,/Click once when off/,/five seconds/,/Hold three seconds/])assert.match(knob,pattern);
 assert.match(knob,/pauses following/);assert.match(knob,/unavailable during updates/);
 assert.match(topic('recovery'),/ten seconds until red, then release/);
 assert.match(topic('recovery'),/hardware settings stay/);assert.doesNotMatch(topic('recovery'),/click.*confirm.*reset|release.*blue.*reset/);
});

test('effect help explains real control availability and separate save scopes',()=>{
 assert.match(topic('effects'),/solids have no speed/);assert.match(topic('effects'),/fixed rainbows keep their rainbow/);
 assert.match(topic('effects'),/Automatic colors continue until you choose custom colors/);
 assert.match(topic('saved-light'),/tuning saves without changing startup/);
 assert.match(topic('saved-light'),/Older software may combine these saves/);
 assert.match(topic('saved-light'),/slider may only preview/);assert.match(topic('saved-light'),/Group appearance is shared/);
});

test('group help covers paused and offline positions plus confirmed dissolution without a removal minimum',()=>{
 const value=topic('groups');
 for(const pattern of [/at least two lamps/,/offline positions stay saved/,/pauses following without leaving/,/Return to group resumes/,
  /followers first, main lamp last/,/keeping individual settings/,/Unreachable lamps stay pending/,/last follower also removes its old group/,
  /Two lamps are required only for creation/,/Older software may need updating/])assert.match(value,pattern);
});

test('sound and center guidance avoids guessed microphone presence or discarded calibration',()=>{
 const sound=topic('sound');
 for(const pattern of [/main lamp’s microphone; followers need none/,/No recordings are saved/,/audio sent to the Internet/,
  /Sensitivity/,/Ignore quiet sounds/,/Sound contrast/,/Tuning is optional/,/microphone use off/,/Silence does not prove/])assert.match(sound,pattern);
 const center=topic('center');
 for(const pattern of [/mirrored movements meet/,/Use the whole strip/,/retaining the saved center/,/group scene/,
  /blinking white marker/,/click to save/,/wait ten seconds/,/LED count stays unchanged/])assert.match(center,pattern);
});

test('update guidance keeps consent, foreground lifetime, route colors and receiving-lamp scope honest',()=>{
 const value=topic('updates');
 for(const pattern of [/Automatic updates start off/,/trusted-lamp retries/,/Proximity or group membership alone is not trust/,
  /policies may defer/,/keep CoolLamp on screen/,/background transfer is not guaranteed/,/check before retrying/,
  /blue phone, green Internet, amber trusted donor, purple computer/,/Only the receiver/,/if on at update start/,
  /Older software may look different/])assert.match(value,pattern);
 assert.doesNotMatch(value,/always.*background|automatically resume|every.*group.*immediately|guaranteed.*mesh/);
 const recovery=topic('recovery');
 for(const pattern of [/192\.168\.4\.1/,/sign in as lamp/,/access password/,/matching application \.bin/,
  /signed release information if required/,/never a bootloader or merged image/])assert.match(recovery,pattern);
});

test('connection and ownership help reconciles uncertainty instead of encouraging reset or duplicate commands',()=>{
 const value=topic('connection');
 for(const pattern of [/Local Network or Bluetooth access/,/only one can connect/,/does not guarantee phone reachability/,
  /trusted, compatible route/,/change may already have happened/,/Use Check before another change/,
  /Do not repeatedly press the command or reset for slowness/])assert.match(value,pattern);
 assert.match(topic('recovery'),/Removing a card only forgets it on this phone, not other phones or lamp settings/);
 assert.match(topic('setup'),/no account needed/);assert.match(topic('light'),/Increase phone text size/);
 assert.match(topic('light'),/Reduced Motion/);assert.match(topic('organization'),/Follow my phone/);
});
