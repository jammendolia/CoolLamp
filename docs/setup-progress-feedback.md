# Setup and settings activity feedback

This client change addresses first-lamp setup steps that previously appeared
frozen while the app waited for a lamp. It changes presentation and scoped client
progress callbacks; it adds no firmware command, ownership policy, retry, or
transport downgrade.

## Visible behavior

The mounted guide in `mobile/src/app-v2.js` shows a spinner and a plain-language
status before awaiting pairing, details saves, automatic-update preference saves,
discovery, or group creation. Details saves report the actual current step:
“Saving your lamp’s name…”, “Saving your lamp’s design…”, then “Remembering its
room…”. The room remains a phone-side label. Group status distinguishes checking,
creating, joining, and checking the confirmed connections.

Normal Settings forms use the same activity styling. Name and design saves show
progress immediately and disable their submit controls. Bluetooth Wi-Fi setup
first says “Sending your Wi-Fi details…”, before its first lamp reply; the
existing receiver phases then supply association and storage outcomes. Once Wi-Fi
is saved, the bounded connection check says “Wi-Fi is saved. Checking the
connection…”. The existing Bluetooth control fallback remains available if the
Wi-Fi probe fails. The Wi-Fi cancellation action remains usable during credential
submission. A cancellation request alone is not a confirmed rollback or save.

## Ownership and outcomes

`main.js` exposes optional, presentation-only `onProgress(stageKey)` callbacks on
`setupDetails()` and `createGroup()`. Callback exceptions and rejected promises
cannot interrupt, authorize, or repeat a mutation. Unknown stage keys are ignored
by the guide. These callbacks are local code metadata, not executable lamp data.

An operation owns its controls and status until it settles. Duplicate taps do
not start another send. Navigation, target changes, epoch changes and obsolete
Wi-Fi callbacks cannot overwrite the next lamp’s feedback or report a false
success. The name/design adapters retain the verified target and its session.

An accepted name followed by a failed design save stays a partial outcome. The
guide offers to check what the lamp kept; it does not replay the earlier change.
An uncertain reply remains unconfirmed. Group partial joins retain the existing
group and review flow. The two-lamp creation minimum and confirmed dissolution
contracts are unchanged.

`mobile/index.html` supplies polite, atomic live status regions. Progress status
is outside an `aria-busy` ancestor; only the guide body or an individual submit
button is marked busy. `mobile/src/app-v2.css` supplies the decorative spinner.
Reduced motion uses a static ring with the same text. Status remains readable
with narrow screens and large text; no percentage or remaining time is invented.

## Verification and release evidence

- `mobile/tests/app-v2-navigation.test.js` exercises the mounted production guide
  with delayed operations, duplicate actions, progress stages, cancellation,
  partial results and stale callbacks after navigation or destruction.
- `mobile/tests/setup-main-progress.test.js` executes the production main
  handlers and adapters in controlled VM fixtures. It covers pending name/design
  saves, callback failures, lost replies, target/session changes, Wi-Fi
  cancellation, delayed credential/probe results and partial group joins.
- The existing Settings integration fixtures load the new scoped presentation
  state and real helper. Their firmware reconciliation behavior is unchanged.
- Complete working mobile results are recorded in
  `.build/setup-feedback-mobile-tests-20261012.log`; the production build is in
  `.build/setup-feedback-mobile-build-20261012.log`. The isolated release export
  must pass the same complete test count and production build.
- `.build/setup-feedback-visual-20261012/result.json` records Chromium checks of
  the production HTML, CSS and mounted guide with deferred UI-only adapters.
  Inspected screenshots cover 390-pixel pairing/name saves, 320-pixel design saves
  with 200% text, reduced motion, and the partial-save review. They establish
  browser layout and feedback behavior, not physical BLE or native approval.
- `.build/setup-feedback-app-release-20261012/` pins only the reviewed web UI,
  tests and this document onto the published app 69 source. Native transports,
  dependencies, signing workflow and firmware remain inherited unchanged.
  `plan.json`, `validation.json`, `dispatch.json` and the exact Apple status
  artifact are the publication evidence when present.

## Physical acceptance

No lamp reset or renewed ownership enrollment is needed to check the ordinary
Settings feedback. On the released iPhone build, open a working lamp’s Settings,
save its existing name/design once, and confirm that progress appears immediately,
duplicate taps are disabled, the result is clear, and the animation keeps moving.
On the next genuine first-lamp setup, observe pairing, naming, design and Wi-Fi
submission with normal native approval prompts. Confirm success, a cancelled
Wi-Fi attempt, and an unavailable-lamp outcome without claiming a durable save
before confirmation. Test VoiceOver and native enlarged text separately.

Actual first-time iPhone/Android setup and screen-reader acceptance remain
physical/native gates. The sister’s lamp must not be reset merely to repeat this
test. This UI change requires no OTA release, reflash, or router change.
