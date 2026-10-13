// Readable guidance only. Actions name existing app destinations; they cannot
// contain commands, targets, HTML or executable lamp-supplied metadata.
// Claims were checked against the current production handlers and firmware:
// app-v2.js, main.js, groups.js, onboarding.js, LampKnob.ino, LampGestures.h,
// LampGeometry.cpp, LampAudio.cpp, LampUpdate.cpp and LampUpdateCue.h.
export const HELP_INTRO='Choose a topic. Help is always here.';

export const HELP_ACTION_IDS=Object.freeze([
 'setup','lamps','effects','settings','groups','audio-guide','center-settings','updates'
]);

const topics=[
 {
  id:'setup',title:'Set up a lamp',summary:'Meet your lamp.',
  steps:[
   'Plug it in, keep your phone nearby, and choose Add a lamp.',
   'Hold the knob about six seconds until blue, then release. Choose that lamp on your phone. Never keep holding after blue.',
   'Name it and choose its design. Wi-Fi is optional; no account needed.'
  ],
  paragraphs:['Allow Bluetooth and Local Network access if asked. A spinner means working; wait for confirmation. Approve any comparison pattern only when the lamp matches.'],
  action:{id:'setup',label:'Open the setup guide'}
 },
 {
  id:'light',title:'Power and brightness',summary:'Choose your lamp first.',
  steps:[
   'In Lamps, tap its card and check the name.',
   'Lamp power turns only that lamp on or off. Off keeps it connected.',
   'Brightness changes overall light; effect intensity or density changes the pattern.'
  ],
  paragraphs:['Group power controls the group. Increase phone text size for easier reading. Reduced Motion reduces app animation; progress includes text.'],
  action:{id:'lamps',label:'Choose a lamp'}
 },
 {
  id:'effects',title:'Effects and colors',summary:'Find your favorite look.',
  steps:[
   'Choose a lamp or group, open Effects, then tap an effect.',
   'Your colors chooses a palette. Restore defaults brings back original colors.'
  ],
  paragraphs:['Controls depend on the effect: solids have no speed; fixed rainbows keep their rainbow. Automatic colors continue until you choose custom colors. Style recommendations are suggestions.','Rotate effects automatically changes effects without your phone; choose its interval and collection.'],
  action:{id:'effects',label:'Open Effects'}
 },
 {
  id:'saved-light',title:'Save your favorite light',summary:'Choose what returns next time.',
  paragraphs:[
   'Remember this effect’s tuning saves without changing startup. Group appearance is shared.',
   'Use these settings at startup chooses the light after power-up. Older software may combine these saves; read the button.',
   'Wait for saved confirmation. A slider may only preview.'
  ],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'organization',title:'Names, rooms and designs',summary:'Recognize each lamp.',
  steps:[
   'Lamp details changes name and room. Rooms organize the list, not shared playback.',
   'Lamp designs chooses its shape without changing LED count or the saved center.'
  ],
  paragraphs:['Settings also offers light, dark, or Follow my phone appearance.'],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'groups',title:'Groups',summary:'Let lamps play together.',
  steps:[
   'Choose New group on Home with at least two lamps. Arrange their order; offline positions stay saved.',
   'Use separately pauses following without leaving. Return to group resumes it.'
  ],
  paragraphs:['Waiting for the main lamp means shared controls are unavailable; individual lamps remain usable.','Remove group releases followers first, main lamp last, keeping individual settings. Unreachable lamps stay pending. Moving the last follower also removes its old group. Two lamps are required only for creation. Older software may need updating.'],
  action:{id:'groups',label:'Open Groups'}
 },
 {
  id:'sound',title:'Sound effects',summary:'Respond to music or the room.',
  paragraphs:['Choose a sound effect. Groups use the main lamp’s microphone; followers need none. No recordings are saved or audio sent to the Internet; levels and rhythm are shared locally.'],
  steps:[
   'Try music. Sensitivity changes response; Ignore quiet sounds filters noise; Sound contrast changes light coverage.',
   'Save using the button shown.'
  ],
  paragraphsAfter:['Tuning is optional. Supported lamps allow microphone use off. Silence does not prove a missing microphone.'],
  action:{id:'audio-guide',label:'Try the sound guide'}
 },
 {
  id:'center',title:'The effect center',summary:'Where mirrored movements meet.',
  paragraphs:['In center settings, Meet at the center splits supported effects. Use the whole strip gives them one path, retaining the saved center. This does not change every effect or group scene.'],
  steps:['Fine-tune center: turn the knob to move the blinking white marker; click to save. Cancel or wait ten seconds without adjusting to keep the old center.'],
  paragraphsAfter:['LED count stays unchanged.'],
  action:{id:'center-settings',label:'Open center settings'}
 },
 {
  id:'knob',title:'Use the knob',summary:'Enjoy light without your phone.',
  steps:[
   'Turn: choose another effect.',
   'Click, then turn: brightness. Click again or wait five seconds to return to effects.',
   'Double-click, then turn: color, where supported.',
   'Triple-click: turn off. Click once when off to turn on.',
   'Hold three seconds: open or close setup Wi-Fi.',
   'Hold about six seconds until blue, then release: allow phone pairing.'
  ],
  paragraphs:['A follower’s knob pauses following. The knob is unavailable during updates.']
 },
 {
  id:'updates',title:'Updates',summary:'Keep the lamp powered.',
  steps:[
   'Open Connection & care on its card, then Update.',
   'For phone Bluetooth, stay nearby and keep CoolLamp on screen. Switching apps can stop sending; background transfer is not guaranteed.',
   'Wait for restart and checking. After interruption, let the app check before retrying.'
  ],
  paragraphs:['Automatic updates start off. Enable Internet or trusted-lamp retries in Lamp care. Proximity or group membership alone is not trust. Group and quiet-use policies may defer updates; the card offers phone updating when needed.','Fill colors: blue phone, green Internet, amber trusted donor, purple computer. Only the receiver shows progress, if on at update start. Older software may look different.'],
  action:{id:'updates',label:'Open Lamp care'}
 },
 {
  id:'connection',title:'Connection help',summary:'Check before trying again.',
  steps:[
   'Keep it powered and tap its card. Allow Local Network or Bluetooth access; move nearby for Bluetooth.',
   'Disconnect another phone’s Bluetooth first; only one can connect.'
  ],
  paragraphs:['Joining Wi-Fi does not guarantee phone reachability. Nearby lamps need a trusted, compatible route.','Unconfirmed means a change may already have happened. Use Check before another change. Do not repeatedly press the command or reset for slowness.'],
  action:{id:'lamps',label:'Check your lamps'}
 },
 {
  id:'recovery',title:'Reset or computer recovery',summary:'Recovery only.',
  paragraphs:['Removing a card only forgets it on this phone, not other phones or lamp settings. Before giving it away, review Factory reset.','Reset: hold ten seconds until red, then release. Wi-Fi, phone pairing and user choices clear; hardware settings stay. Release at blue for ordinary pairing.','Computer update: join setup Wi-Fi, open http://192.168.4.1, and sign in as lamp with its access password (coollamp if unchanged). Choose Update from your computer with the matching application .bin and signed release information if required; never a bootloader or merged image.'],
  action:{id:'settings',label:'Open Settings'}
 }
];

export const HELP_TOPICS=Object.freeze(topics.map(topic=>Object.freeze({
 ...topic,
 ...(topic.steps?{steps:Object.freeze([...topic.steps])}:{}),
 ...(topic.paragraphs?{paragraphs:Object.freeze([...topic.paragraphs])}:{}),
 ...(topic.paragraphsAfter?{paragraphsAfter:Object.freeze([...topic.paragraphsAfter])}:{}),
 ...(topic.action?{action:Object.freeze({...topic.action})}:{})
})));
