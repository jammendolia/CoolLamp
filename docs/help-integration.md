# Accessible in-app Help

The previous Help entry in Settings opened a brief knob guide. The new **Help**
button is the fifth, rightmost bottom navigation item. Settings also links to the
same Help page. Home, Lamps, Effects and Settings retain their existing routes.

## Reading and actions

Help is available without a lamp, an account or an Internet connection. Fourteen
native disclosure topics keep the first screen easy to scan: setup,
power/brightness, effects/colors, saving light, names/rooms/designs, groups, sound,
center, knob, updates, app readability, connection problems, reset/ownership and
computer updates. Each opens independently.

The revised copy uses complete explanations rather than the earlier compressed
900-word guide. A topic introduces its purpose, gives practical steps and explains
the result or a relevant limitation. Groups, knob use and updates can use titled
subsections so distinct tasks do not run together. Text size, reduced motion and
phone theme belong to app readability, not lamp brightness or physical design.
Reset and computer upload now have separate topics. Static content retains
explicit bounds of 2,500 words, 250 words per topic and 24 KiB serialized UTF-8;
these are resource limits, not a reason to omit useful explanations. Copy uses
current runtime labels without inventing household-sharing screens.

`mobile/src/help.js` contains immutable plain text and a small set of known
navigation action IDs. Optional `sections` contain plain headings, paragraphs and
steps, frozen just like the top-level content. `mobile/src/app-v2.js` escapes
these strings and only routes the whitelisted actions. No Help data is received from a lamp or
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
- `.build/help-refinement-visual-20261013/result.json` records the expanded
  guide's corresponding layout checks, including separate Power/brightness and
  app readability topics, titled task sections and the longer instructions.
- Full mobile tests and production build are saved in
  `.build/help-refinement-mobile-tests-20261013.log` and
  `.build/help-refinement-mobile-build-20261013.log`. The isolated release must pass the
  exact complete working test count and build before dispatch.
- `.build/help-app-release-20261013/` freezes only reviewed web UI, copy, tests
  and this document onto the published build 70 source. Firmware, native
  transports, dependencies and signing workflow are unchanged. Exact GitHub and
  Apple status artifacts establish TestFlight availability when present.
- `.build/help-refinement-app-release-20261013/` freezes the reading refinements
  onto published build 71. It changes content, section rendering/styling, tests and
  this document. Bottom navigation, lamp protocols, firmware, native transports
  and release signing are inherited unchanged. Its journal and exact Apple status
  artifact establish the refined build's availability when present.

Physical/native acceptance remains separate: on the released iPhone build, open
Help from the bottom bar, read a topic with VoiceOver and enlarged text, and use
the sound guide or a target chooser without changing settings. Repeat on Android.
No lamp reset, re-enrollment, reflash or router change is needed to test Help.
