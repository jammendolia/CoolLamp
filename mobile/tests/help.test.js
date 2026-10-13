import test from 'node:test';
import assert from 'node:assert/strict';
import {HELP_INTRO,HELP_TOPICS,HELP_ACTION_IDS} from '../src/help.js';

const blocks=value=>[...value.paragraphs||[],...value.steps||[],...value.paragraphsAfter||[]];
const text=value=>[value.title,value.summary,...blocks(value),...value.sections?.flatMap(section=>[section.title,...blocks(section)])||[],value.action?.label||''].join(' ');
const topic=id=>{const value=HELP_TOPICS.find(row=>row.id===id);assert.ok(value,`Missing help topic: ${id}`);return text(value);};
const has=(value,phrases)=>{for(const phrase of phrases)assert.ok(value.toLowerCase().includes(phrase.toLowerCase()),`Missing guidance: ${phrase}`);};

test('help provides complete task explanations within explicit reading and byte bounds',()=>{
 assert.ok(Object.isFrozen(HELP_TOPICS));assert.equal(HELP_TOPICS.length,14);
 assert.ok(HELP_INTRO.length<=160);assert.ok(Buffer.byteLength(JSON.stringify(HELP_TOPICS),'utf8')<=24*1024);
 let words=HELP_INTRO.split(/\s+/).length;
 const ids=new Set();
 for(const value of HELP_TOPICS){
  assert.ok(Object.isFrozen(value));assert.match(value.id,/^[a-z][a-z-]{0,31}$/);assert.ok(!ids.has(value.id));ids.add(value.id);
  assert.ok(value.title.length<=48);assert.ok(value.summary.length<=80);
  const count=text(value).split(/\s+/).length;assert.ok(count>=100&&count<=250,`${value.id}: ${count} words`);words+=count;
  assert.ok(value.paragraphs?.length,'Each task begins with an explanation.');
  for(const key of ['paragraphs','steps','paragraphsAfter'])if(value[key]){
   assert.ok(Object.isFrozen(value[key]));assert.ok(value[key].length<=6);
   for(const line of value[key])assert.ok(typeof line==='string'&&line.length>0&&line.length<=500);
  }
 }
 assert.ok(words<=2500,`Help contains ${words} words`);
 assert.throws(()=>{HELP_TOPICS[0].title='Changed';},TypeError);
 assert.throws(()=>{HELP_TOPICS[0].steps.push('Changed');},TypeError);
});

test('titled task sections have known plain fields and are deeply immutable',()=>{
 let count=0;
 for(const value of HELP_TOPICS)if(value.sections){
  assert.ok(Object.isFrozen(value.sections));assert.ok(value.sections.length<=4);
  for(const section of value.sections){
   ++count;assert.ok(Object.isFrozen(section));assert.ok(Object.keys(section).every(key=>['title','paragraphs','steps'].includes(key)));
   assert.ok(typeof section.title==='string'&&section.title.length>0&&section.title.length<=64);
   assert.ok(blocks(section).length>0);
   for(const key of ['paragraphs','steps'])if(section[key]){
    assert.ok(Object.isFrozen(section[key]));assert.ok(section[key].length<=6);
    for(const line of section[key])assert.ok(typeof line==='string'&&line.length>0&&line.length<=500);
    assert.throws(()=>{section[key].push('Changed');},TypeError);
   }
   assert.throws(()=>{section.title='Changed';},TypeError);
  }
 }
 assert.ok(count>=6,'Groups, knob, updates and reset have distinct explained subsections.');
});

test('help actions remain known navigation destinations with no executable or target authority',()=>{
 assert.deepEqual(HELP_ACTION_IDS,['setup','lamps','effects','settings','groups','audio-guide','center-settings','updates']);
 assert.ok(Object.isFrozen(HELP_ACTION_IDS));
 for(const value of HELP_TOPICS){
  assert.ok(Object.keys(value).every(key=>['id','title','summary','paragraphs','steps','paragraphsAfter','sections','action'].includes(key)));
  if(value.action){
   assert.ok(Object.isFrozen(value.action));assert.deepEqual(Object.keys(value.action).sort(),['id','label']);
   assert.ok(HELP_ACTION_IDS.includes(value.action.id));assert.ok(value.action.label.length<=40);
  }
  assert.doesNotMatch(text(value),/<[^>]*>|javascript:|GPIO|NVS|MTU|SHA-256/);
 }
});

test('phone text size, reduced motion and theme belong only to their own comfort topic',()=>{
 const guidance=/text[- ]size|larger text|Reduced Motion|Follow my phone|choose Light, Dark/i;
 assert.match(topic('comfort'),guidance);
 has(topic('comfort'),['accessibility settings','Reduced Motion','written status','lighting settings']);
 for(const value of HELP_TOPICS)if(value.id!=='comfort')assert.doesNotMatch(text(value),guidance,`Misplaced app comfort guidance in ${value.id}`);
 assert.doesNotMatch(topic('light'),/accessibility|theme|dark/i);
 assert.doesNotMatch(topic('organization'),/accessibility|theme|dark/i);
});

test('setup and knob separate everyday clicks, blue pairing and red release-to-reset',()=>{
 has(topic('setup'),['six seconds','flashes blue','let go','Do not keep holding','2.4 GHz','No account']);
 has(topic('knob'),['quick press and release','Turn the knob','Click once','brightness','five seconds','Double-click','color','Triple-click','off','three seconds','six seconds','blue, then release','pauses group following','unavailable']);
 const reset=topic('recovery');
 has(reset,['ten seconds','until red, then release','release at blue','hardware settings remain']);
 assert.doesNotMatch(reset,/click.*confirm.*reset/);
});

test('color matching belongs only to the named optional setup-through-another-lamp instructions',()=>{
 const setup=HELP_TOPICS.find(value=>value.id==='setup'),normal=blocks(setup).join(' ');
 assert.doesNotMatch(normal,/compar|four colors|color matching|approve/i);
 const alternate=setup.sections.find(value=>value.title==='Optional: Add through another lamp');assert.ok(alternate);
 has(text(alternate),['before Bluetooth pairing','new lamp is still unpaired','existing lamp you own','Normal Bluetooth setup does not use color matching','new lamp powered','Add through another lamp','app shows four colors','same order','new lamp’s knob once','If they differ, choose Cancel','confirms the lamp was added']);
});

test('effects and saving distinguish real controls, previews, phone favorites and startup',()=>{
 has(topic('light'),['Lamps in the bottom bar','name and room','card’s Lamp power','For brightness, tap the lamp’s card','lighting controls','connection check','lamp’s name at the top','softer light','stronger light']);
 assert.doesNotMatch(topic('light'),/Choose the lamp before changing its light/);
 has(topic('light'),['overall light','pattern’s strength','brighten its particles','Use separately']);
 has(topic('effects'),['Solid effects','do not need motion speed','fixed-rainbow','Automatic spectrum','until you select custom colors','favorite on this phone','does not save tuning','standalone effects']);
 has(topic('saved-light'),['preview','without making it permanent','Remember this effect’s tuning','startup effect and brightness stay','Use these settings at startup','Older software may combine','Group appearance','Sound tuning','unconfirmed']);
});

test('groups explain confirmation, paused members, offline positions and dissolution boundaries',()=>{
 has(topic('groups'),['at least two ready lamps','confirm joining','offline lamp','saved position','Use separately','pause','without removing','Return to group','followers first','main lamp last','individual settings','visibly pending','removal is confirmed','last follower','once confirmed','unreachable main lamp','creation, never removal','Older software','group stays saved']);
});

test('sound and center do not guess microphone absence or discard saved calibration',()=>{
 has(topic('sound'),['microphone','followers need no microphones','No recordings','audio sent to the Internet','Sensitivity','Ignore quiet sounds','Sound contrast','defaults','older lamps may restart','turn microphone use off','Silence alone does not prove']);
 has(topic('center'),['two sides','halfway','LED count','Meet at the center','Use the whole strip','retaining your saved center','blinking white marker','Click the knob once','Set this center','ten seconds without adjusting','not every effect or group scene']);
});

test('updates explain consent, foreground lifetime, checking and source-dependent cues',()=>{
 const value=topic('updates');
 has(value,['Keep it powered','Connection & care','Update','stay nearby','keep CoolLamp on screen','background transfer is not guaranteed','check the installed software before retrying','Automatic updates start off','Turn them on in Lamp care','check and retry by itself','approved nearby lamp','same group is not enough','may wait for an allowed update time','Blue means phone Bluetooth','green means Internet','amber means a trusted donor','purple means a computer file','Only the receiving lamp','on at update start','Older software']);
 assert.doesNotMatch(value,/always.*background|automatically resume|every.*group.*immediately|guaranteed.*mesh/i);
});

test('connection and ownership check uncertainty without duplicate mutation or a reset reflex',()=>{
 has(topic('connection'),['Local Network','Bluetooth access','one connection at a time','does not guarantee phone reachability','unconfirmed','offered Check','may already have happened','before you make another change','Do not repeatedly press','trusted, compatible route']);
 has(topic('recovery'),['Removing a card forgets it on this phone','does not clear lamp settings','another phone’s access','give the lamp','group first','unavailable main lamp','Wi-Fi, phone pairing','user lighting choices are cleared','new owner','old cards or pairings']);
 assert.doesNotMatch(topic('connection'),/reset.*fixes|repeat.*until.*works/i);
});

test('computer upload is separate and explains exact file requirements plus uncertain-result recovery',()=>{
 has(topic('computer'),['advanced','ordinary Update','three seconds','setup Wi-Fi','http://192.168.4.1','username lamp','access password','coollamp only if','Update from your computer','application .bin','signed release information if required','Do not use a bootloader','partition file','merged image','keep the lamp powered','result checking','does not erase saved home Wi-Fi','result is unconfirmed','check installed software','before sending again']);
 assert.doesNotMatch(topic('recovery'),/192\.168|\.bin|computer/i);
 assert.doesNotMatch(topic('updates'),/192\.168|username|\.bin/i);
});
