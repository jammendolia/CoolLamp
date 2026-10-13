# Accessible in-app Help

The previous Help entry in Settings opened a brief knob guide. The new **Help**
button is the fifth, rightmost bottom navigation item. Settings also links to the
same Help page. Home, Lamps, Effects and Settings retain their existing routes.

## Reading and actions

Help is available without a lamp, an account or an Internet connection. Twelve
native disclosure topics keep the first screen short: setup, power/brightness,
effects/colors, saving light, names/rooms/designs, groups, sound, center, knob,
updates, connection problems and advanced recovery. The full copy is bounded to
900 words and 8 KiB of serialized data. It uses current runtime control labels;
it does not invent household-sharing screens or expose every protocol detail.

`mobile/src/help.js` contains immutable plain text and a small set of known
navigation action IDs. `mobile/src/app-v2.js` escapes all displayed strings and
only routes the whitelisted actions. No Help data is received from a lamp or
executed as a command. Explicit setup guidance respects pending, unconfirmed
setup review while remaining available when automatic later guides are off.
Effects and center shortcuts open a target chooser first; they do not silently
select a different lamp. Guidance itself neither pairs nor sends settings.

`main.js` includes Help in page visibility and focus management. Entering Help
hides lamp controls, stops the visible-inventory polling schedule and makes
Settings recovery inactive. It preserves the firmware sender, update owner and
AbortController. Help does not start state/catalog reads, updates or provisioning.
Choosing a destination such as Lamps or Groups invokes its ordinary read flow.

## Accessibility

The question-mark icon has a visible **Help** label; its SVG is decorative.
Navigation targets remain at least 48 pixels at the verified 320-pixel width.
The heading receives focus after navigation. Native `details`/`summary` topics
work with keyboard activation and expose their expanded state without bespoke
JavaScript controls. Text wraps within its topic; dark mode and reduced motion
use the existing app preferences. Main content grows with phone text size; bottom
labels cap at 16 pixels so all five destinations stay visible without splitting
words or requiring horizontal scrolling.

The guide preference is an explicit phone-side save with an atomic polite status
message. Reading Help does not change guide preferences or prove ownership.

## Verified contracts

Instructions were checked against the current handlers, rather than the older
design audit. Relevant production sources include `LampGestures.h`,
`LampKnob.ino`, `LampGeometry.cpp`, `LampAudio.cpp`, `LampUpdate.cpp`,
`LampUpdateCue.h`, `LampPage.h`, and the mobile group/update/settings handlers.
The copy distinguishes saving effect tuning from startup, paused membership from
removal, pending removal from confirmation, card removal from revocation, and
quiet sound from proof that a microphone is absent. It describes foreground
phone transfers, separate trusted donation, route colors on supported firmware,
and checks after restart. Reset is kept in advanced recovery and explains the
personal settings it clears. Legacy firmware caveats remain explicit.

## Evidence and next check

- `mobile/tests/help.test.js` checks real content bounds, immutability, plain
  metadata and critical source-backed guidance.
- `mobile/tests/app-v2-navigation.test.js` exercises the mounted production Help
  renderer/actions and the real main page function: offline reading, no hidden
  lamp commands, preserved update sender, heading focus, preference migration,
  pending setup review and unknown action handling.
- `.build/help-visual-20261013/result.json` records production HTML/CSS and
  mounted Help checks in Chromium, including 390-pixel layout, native keyboard
  disclosure, 320 pixels at 200% text, dark mode, reduced motion, visible footer
  actions and no lamp reads. Inspected screenshots are in that directory.
- Full mobile tests and production build are saved in
  `.build/help-mobile-tests-20261013.log` and
  `.build/help-mobile-build-20261013.log`. The isolated release must pass the
  exact complete working test count and build before dispatch.
- `.build/help-app-release-20261013/` freezes only reviewed web UI, copy, tests
  and this document onto the published build 70 source. Firmware, native
  transports, dependencies and signing workflow are unchanged. Exact GitHub and
  Apple status artifacts establish TestFlight availability when present.

Physical/native acceptance remains separate: on the released iPhone build, open
Help from the bottom bar, read a topic with VoiceOver and enlarged text, and use
the sound guide or a target chooser without changing settings. Repeat on Android.
No lamp reset, re-enrollment, reflash or router change is needed to test Help.
