// Readable guidance only. Actions name existing app destinations; they cannot
// contain commands, targets, HTML or executable lamp-supplied metadata.
// Claims were checked against the current production handlers and firmware:
// app-v2.js, main.js, groups.js, onboarding.js, LampKnob.ino, LampGestures.h,
// LampGeometry.cpp, LampAudio.cpp, LampUpdate.cpp and LampUpdateCue.h.
export const HELP_INTRO='Open a topic and follow its steps at your own pace. Reading Help does not change the lamp’s settings.';

export const HELP_ACTION_IDS=Object.freeze([
 'setup','lamps','effects','settings','groups','audio-guide','center-settings','updates'
]);

const topics=[
 {
  id:'setup',title:'Set up a lamp',summary:'Connect a new lamp and make it yours.',
  paragraphs:['The setup guide connects your phone, then helps you name the lamp. No account is needed. Home Wi-Fi is optional; Bluetooth lets you control it nearby.'],
  steps:[
   'Plug in the lamp. Keep your phone nearby, open Lamps, and choose Add a lamp.',
   'Hold the lamp’s knob for about six seconds. As soon as the whole lamp flashes blue, let go. Do not keep holding after blue, because a longer hold can reset the lamp.',
   'Choose your lamp from the phone’s picker. Allow Bluetooth and Local Network access if asked.',
   'Save its name and room. Finished lamps have their design set. Add home Wi-Fi for control from farther away; use a 2.4 GHz network.'
  ],
  sections:[
   {title:'Optional: Add through another lamp',paragraphs:[
    'Choose this before Bluetooth pairing, while the new lamp is still unpaired. An existing lamp you own helps with setup. Normal Bluetooth setup does not use color matching.'
   ],steps:[
    'Keep the new lamp powered and near your existing lamp.',
    'Choose Add through another lamp in the setup guide, then select the new lamp the app finds.',
    'The app shows four colors. Watch the new lamp flash and check that the colors appear in the same order.',
    'If they match, click the new lamp’s knob once. If they differ, choose Cancel. Wait until the app confirms the lamp was added.'
   ]}
  ],
  paragraphsAfter:['A spinner means the app is working; wait for confirmation. You can finish later and return to the guide.'],
  action:{id:'setup',label:'Open the setup guide'}
 },
 {
  id:'light',title:'Power and brightness',summary:'Turn a lamp on or off and choose its light level.',
  paragraphs:['Tap Lamps in the bottom bar to see the lamps you have added. Each card shows a lamp’s name and room. Use that card’s Lamp power button to turn its light on or off. Turning the light off keeps the lamp connected to the app.'],
  steps:[
   'For brightness, tap the lamp’s card to open its lighting controls. Wait for the connection check, then check the lamp’s name at the top.',
   'Tap Lamp power to turn it on or off. Check its displayed state if your tap was unconfirmed.',
   'Move Brightness lower for softer light or higher for stronger light. This changes the overall light level.'
  ],
  paragraphsAfter:['Group power changes the whole group. Followers may take brightness from the main lamp; choose Use separately before adjusting a follower’s own light. Effect intensity, glow or density changes the pattern’s strength or activity, and may brighten its particles.'],
  action:{id:'lamps',label:'Open Lamps'}
 },
 {
  id:'effects',title:'Effects and colors',summary:'Choose a pattern, then make its colors feel right.',
  paragraphs:['An effect is the lamp’s pattern, such as a steady color, moving fire or a response to music. Each lamp supplies its available effects, so choices may differ between lamps.'],
  steps:[
   'Choose a lamp or group, then open Effects. Tap the effect you want to try.',
   'Use the controls shown. Motion speed changes movement; intensity, glow or density changes the pattern’s strength or activity.',
   'Choose Your colors for a custom palette. Restore effect defaults or Restore original colors brings back original colors, depending on the lamp’s software.'
  ],
  paragraphsAfter:['Solid effects do not need motion speed, and fixed-rainbow effects keep their rainbow. Automatic spectrum colors continue until you select custom colors. Style recommendations are suggestions. The heart remembers a favorite on this phone; it does not save tuning to the lamp. Rotate effects automatically changes standalone effects without your phone; choose its interval and collection.'],
  action:{id:'effects',label:'Open Effects'}
 },
 {
  id:'saved-light',title:'Save your favorite light',summary:'Understand what is saved and what returns after power-up.',
  paragraphs:['A slider can preview a change without making it permanent. Supported lamps separate saving tuning from choosing the startup effect and brightness: the pattern and light level your lamp uses when you plug it in.'],
  steps:[
   'Choose an effect and adjust it to your liking.',
   'Where offered, choose Remember this effect’s tuning to save that effect’s appearance. Your chosen startup effect and brightness stay as they were.',
   'Choose Use these settings at startup for the current effect and brightness after power-up. Wait for saved confirmation.'
  ],
  paragraphsAfter:['Older software may combine these saves; read the save button. Group appearance is shared across its scenes. Sound tuning saves separately across sound effects. If saving is unconfirmed, check what the lamp kept before another change.'],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'organization',title:'Names, rooms and designs',summary:'Make every lamp easy to find and recognize.',
  paragraphs:['A familiar name helps you choose the right lamp. Rooms organize your phone’s list. Putting lamps in the same room does not make their effects play together; use a group for that.'],
  steps:[
   'In Settings, choose Lamp details. Select the lamp and give it a name such as Reading lamp or Bedroom lamp.',
   'Choose a room to find it among your other lamps. Save and wait for confirmation.',
   'Open Lamp designs to check its physical shape. Finished lamps have a factory design that cannot be changed here. Older or unfinished lamps may let you choose their shape for the picture and recommendations.'
  ],
  paragraphsAfter:['LED count and the saved center are separate from the physical design. Finished lamps should already have correct hardware settings. Use advanced strip settings only when the physical lamp needs correction.'],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'groups',title:'Groups',summary:'Play together, use a lamp separately, or remove a group.',
  paragraphs:['A group shares light and movement. One main lamp keeps it together and supplies sound response when needed. The lamps keep their individual settings.'],
  sections:[
   {title:'Create and use a group',steps:[
    'On Home, choose New group with at least two ready lamps. Name it and wait for each lamp to confirm joining.',
    'Arrange the lamps’ order to match their positions in the room. An offline lamp keeps its saved position.',
    'Use separately pauses a follower without removing it. Return to group makes it follow again.'
   ]},
   {title:'Remove or move lamps',paragraphs:[
    'Remove group releases followers first and the main lamp last. Each lamp keeps its individual settings. Unreachable lamps remain visibly pending until removal is confirmed.',
    'Moving the last follower also finishes removing its old group once confirmed; an unreachable main lamp can keep this pending. Two lamps are required for creation, never removal. Older software may need updating.'
   ]}
  ],
  paragraphsAfter:['Waiting for the main lamp means shared controls are unavailable. The group stays saved; reconnect its main lamp or use individual lamps separately.'],
  action:{id:'groups',label:'Open Groups'}
 },
 {
  id:'sound',title:'Sound effects',summary:'Let light respond to music and tune it only if needed.',
  paragraphs:['Sound effects use a microphone. Groups use the main lamp’s sound response; followers need no microphones. No recordings are saved or audio sent to the Internet. Lamps share sound levels and rhythm locally.'],
  steps:[
   'Choose a sound effect. Try music or speak at a comfortable volume. The defaults work without tuning.',
   'Increase Sensitivity to respond more to quiet sounds. Raise Ignore quiet sounds to reduce background flicker.',
   'Adjust Sound contrast to change the difference between soft and strong sounds. Save using the button shown; older lamps may restart after saving.'
  ],
  paragraphsAfter:['Tuning applies across sound effects using that microphone. VU Meter uses colors for low, middle and peak levels; Fountain uses bass, midrange and treble colors. Supported lamps let you turn microphone use off. Silence alone does not prove a missing or broken microphone.'],
  action:{id:'audio-guide',label:'Try the sound guide'}
 },
 {
  id:'center',title:'The effect center',summary:'Choose where mirrored movements meet or use one full path.',
  paragraphs:['Some effects split the strip into two sides, meeting at an effect center. The usual center is halfway along the LEDs. Adjusting it can improve mirrored movement without changing the LED count.'],
  steps:[
   'Open center settings. Meet at the center uses the split. Use the whole strip makes supported centered effects follow one path instead, while retaining your saved center.',
   'Choose Fine-tune center if the split needs adjusting. The lamp shows a blinking white marker. Turn the knob to move that marker.',
   'Click the knob once, or choose Set this center, to save. Cancel or wait ten seconds without adjusting to keep the previous center.'
  ],
  paragraphsAfter:['These choices affect supported centered effects, not every effect or group scene. Normal light returns when adjustment ends. LED count is a separate setting.'],
  action:{id:'center-settings',label:'Open center settings'}
 },
 {
  id:'knob',title:'Use the knob',summary:'Change the light without opening your phone.',
  paragraphs:['How you press the knob changes its job. A click is a quick press and release. Two or three clicks should follow each other quickly.'],
  sections:[
   {title:'Everyday light',steps:[
    'Turn the knob to choose another effect.',
    'Click once, then turn for brightness. Click again or wait five seconds to return to effects.',
    'Double-click, then turn to choose a color where the effect supports it.',
    'Triple-click to turn the light off. When it is off, click once to turn it on.'
   ]},
   {title:'Connection help',paragraphs:[
    'Hold about three seconds to open or close the lamp’s setup Wi-Fi. Hold about six seconds until blue, then release, to allow phone pairing. Release at blue; do not continue toward the ten-second red reset cue.'
   ]}
  ],
  paragraphsAfter:['Using a follower’s knob pauses group following so it can play separately. The knob is unavailable while the lamp is updating.']
 },
 {
  id:'updates',title:'Updates',summary:'Install new software and understand the progress display.',
  paragraphs:['Updates improve the lamp’s software. Keep it powered during sending, restarting and checking. The app chooses a supported path; you usually do not need to choose Bluetooth or Wi-Fi.'],
  sections:[
   {title:'Update now',steps:[
    'Open Connection & care on the lamp’s card and choose Update.',
    'For a phone Bluetooth transfer, stay nearby and keep CoolLamp on screen. Switching apps can stop sending; background transfer is not guaranteed.',
    'Wait through restart and checking. After an interruption, let the app check the installed software before retrying.'
   ]},
   {title:'Automatic updates',paragraphs:[
    'Automatic updates start off. Turn them on in Lamp care so the lamp can check and retry by itself. It can use the Internet or an approved nearby lamp. Being close or in the same group is not enough. The lamp may wait for an allowed update time or for its group to be ready. If automatic updating cannot work, use the phone update offered on the card.'
   ]},
   {title:'Colors on the lamp',paragraphs:[
    'Blue means phone Bluetooth, green means Internet, amber means a trusted donor, and purple means a computer file. Only the receiving lamp shows progress, if it was on at update start. Older software may show an older animation.'
   ]}
  ],
  action:{id:'updates',label:'Open Lamp care'}
 },
 {
  id:'connection',title:'Connection help',summary:'Find the lamp and check an unconfirmed change.',
  paragraphs:['A slow connection does not mean the lamp needs resetting. The app may be checking several paths. Keep it powered, tap its card, and wait while the connection message or spinner shows.'],
  steps:[
   'For home Wi-Fi, allow Local Network access and use a network that reaches the lamp. Joining Wi-Fi does not guarantee phone reachability.',
   'For Bluetooth, allow Bluetooth access and move nearby. Disconnect another phone’s Bluetooth first: the lamp accepts one connection at a time.',
   'If a change is unconfirmed, choose the offered Check action. The change may already have happened; checking reads the result before you make another change.'
  ],
  paragraphsAfter:['Do not repeatedly press the same command or reset for slowness. Nearby lamps can help only through a trusted, compatible route; being close is not enough.'],
  action:{id:'lamps',label:'Check your lamps'}
 },
 {
  id:'comfort',title:'Make the app easier to read',summary:'Use larger text, less motion, or a different appearance.',
  paragraphs:['CoolLamp follows your phone’s text-size setting to make instructions easier to read. These choices change the app’s presentation, not the lamp’s lighting settings.'],
  steps:[
   'Open your phone’s accessibility settings and increase text size. Return to CoolLamp to see larger text.',
   'Use your phone’s Reduced Motion setting if moving app displays are uncomfortable. Progress also has a written status, so you can still tell when the app is working.',
   'In CoolLamp Settings, choose Light, Dark, or Follow my phone. Follow my phone uses your phone’s current light or dark appearance.'
  ],
  paragraphsAfter:['Bottom buttons have names and icons. Help stays at the right; open one topic at a time. Reading Help does not send changes to a lamp.'],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'recovery',title:'Reset and ownership',summary:'Know what removing a card or resetting a lamp will do.',
  paragraphs:['Removing a card forgets it on this phone. It does not clear lamp settings or remove another phone’s access. Reset when you deliberately want to start over or give the lamp to someone else.'],
  sections:[
   {title:'Reset this lamp',steps:[
    'Leave or remove this lamp’s group first. This avoids other lamps waiting for an unavailable main lamp.',
    'In Lamp details, choose Factory reset and read the confirmation before accepting.',
    'Alternatively, hold the knob about ten seconds until red, then release to reset. For normal phone pairing, release at blue instead.',
    'The lamp restarts. Its Wi-Fi, phone pairing, name, group and user lighting choices are cleared. Physical hardware settings remain.'
   ]}
  ],
  paragraphsAfter:['The new owner can use Add a lamp. Remove old cards or pairings on the previous phone if needed. For slowness, check before resetting.'],
  action:{id:'settings',label:'Open Settings'}
 },
 {
  id:'computer',title:'Update from a computer',summary:'Use a firmware file when ordinary app updating cannot help.',
  paragraphs:['This advanced option needs the correct CoolLamp application firmware file. Use ordinary Update on the lamp’s card when it works; unrelated ESP32 files are unsuitable.'],
  steps:[
   'Hold the knob about three seconds to enable setup Wi-Fi. Connect your computer to it using the lamp’s access password.',
   'Open a browser and enter http://192.168.4.1. Sign in with username lamp and the lamp’s access password. The password is coollamp only if it has not been changed.',
   'Choose Update from your computer. Select the matching application .bin file and matching signed release information if required. Do not use a bootloader, partition file or merged image.',
   'Choose Install this file and keep the lamp powered. Wait through file checking, installation, restart and result checking.'
  ],
  paragraphsAfter:['Joining setup Wi-Fi does not erase saved home Wi-Fi. If it closes or the result is unconfirmed, check installed software in CoolLamp before sending again. Reconnect your computer to its usual network afterward.'],
  action:{id:'updates',label:'Open Lamp care'}
 }
];

const freezeText=values=>Object.freeze([...values]);
const freezeSection=section=>Object.freeze({
 ...section,
 ...(section.paragraphs?{paragraphs:freezeText(section.paragraphs)}:{}),
 ...(section.steps?{steps:freezeText(section.steps)}:{})
});
export const HELP_TOPICS=Object.freeze(topics.map(topic=>Object.freeze({
 ...topic,
 ...(topic.steps?{steps:freezeText(topic.steps)}:{}),
 ...(topic.paragraphs?{paragraphs:freezeText(topic.paragraphs)}:{}),
 ...(topic.paragraphsAfter?{paragraphsAfter:freezeText(topic.paragraphsAfter)}:{}),
 ...(topic.sections?{sections:Object.freeze(topic.sections.map(freezeSection))}:{}),
 ...(topic.action?{action:Object.freeze({...topic.action})}:{})
})));
