# CoolLamp app design

Implemented October 5, 2026. This is the production app interface in `mobile/`, with existing firmware and transport contracts preserved. The preview images use simulated lamps; their names, settings and available-update version illustrate UI states rather than the status of physical lamps.

## Design direction

CoolLamp is a lighting instrument. The interface gives everyday controls priority, presents effects as a collection, and keeps setup details out of the lighting workspace. Deep blue surfaces, warm white text, mint actions and lilac sound controls create a consistent visual hierarchy. A small, code-rendered helix connects the interface to the actual lamp. It represents power and selected color; it does not claim to visualize live microphone samples or reproduce every effect.

Three persistent destinations define the application:

- **Lamps:** find, connect and switch devices. Saved lamps and the session's discovered devices remain available. The selected connected lamp is marked explicitly. Selecting it returns to Light without reconnecting or discarding a sound draft.
- **Light:** power, shared brightness, active effect, its controls, effect browsing, startup capture and optional automatic rotation.
- **Settings:** Overview, Groups, Hardware, Network and Updates. All five sections remain visible at phone widths; larger screens place them in one row.

Power and brightness remain outside the effect tabs. Audio effects, color customization and group scenes therefore retain a predictable place for these essential controls. Followers show their limited control scope and disable brightness while following; the coordinator controls the group's light. The power control explains whether it affects the lamp or the group.

## Interaction model

Effect settings use **Color**, **Motion** and **Sound** tabs. Unsupported tabs disappear, while firmware or transport limitations explain how to enable the missing capability. Profiles provide relevant labels such as flame speed, density, ripple speed and response speed. A steady solid color has no animation controls.

Effect and group-scene browsers are compact disclosure panels with searchable, bounded collections. Categories and favorites make the single-lamp collection easier to browse. Group scene selection closes its browser and returns focus to the active scene. Fixed-color scenes do not offer ineffective color controls; scenes that require audio disable selection without a coordinator microphone and explain that requirement.

Single-lamp brightness, color and motion changes use the existing immediate command paths. Range controls update their numeric readout during movement and send on release. Shared sound tuning, meter/fountain colors, group tuning and rotation use explicit save/apply actions. Their drafts survive status polling. Switching to another lamp clears the previous lamp's drafts and group identity.

The three brightness-related concepts remain distinct:

| Control | Scope |
| --- | --- |
| Lamp brightness | Shared output level for the connected lamp; a coordinator also distributes it to followers |
| Effect glow | The selected single-lamp effect's intensity |
| Scene brightness | The selected group's scene intensity |

Sound controls consistently use **Sensitivity**, **Quiet cutoff** and **Contrast**. Contrast is the existing scale-factor setting, with a multiplier readout and an explanation of quiet/loud behavior. Audio effects on a lamp share these settings; group audio uses the coordinator's microphone.

Wi-Fi and hardware saves are isolated even though firmware accepts one combined configuration request. The client fills untouched fields from saved lamp telemetry. Saving Network cannot apply an unfinished LED-count draft. Saving Hardware cannot apply an unfinished password change or forget-Wi-Fi toggle. Restarting saves retain the existing explicit confirmation.

## Feature coverage

All 199 existing element IDs were retained without duplicates. The audit below maps each feature to its new location; retained IDs provide a structural check, and behavioral checks verify the important command paths.

| Feature | Location and behavior |
| --- | --- |
| Wi-Fi discovery and refresh | Lamps → Find on Wi-Fi; native iOS/Android discovery remains unchanged |
| Discovery remembered during the app session | Lamps list merges discovered and saved entries; navigation does not initiate another discovery |
| Saved devices and room context | Lamps cards; active connection is marked, identity/address matching remains enforced |
| Manual Wi-Fi connection and lamp password | Lamps → Connect a lamp; the form closes after a successful connection |
| Bluetooth discovery, reconnect and disconnect | Lamps → Connect a lamp, with pairing instructions |
| Default-password reminder | Persistent connected-lamp notice; Change password opens Network directly |
| On/off | Light hero, with explicit group/coordinator/follower scope |
| Shared brightness | Light hero, accessible on every effect tab and group scene; disabled during active following, calibration or updating |
| Effect catalog, search and categories | Light → Change effect, using the lamp's actual catalog |
| Favorites | Active-effect heart and browser Favorites category, saved per lamp |
| Primary and secondary palettes | Color tab; two-color switch is visible before choosing a custom primary color on compatible effects/firmware |
| Original colors and effect defaults | Color/Motion → Restore effect defaults, using the existing firmware operation |
| Effect-specific speed and intensity | Motion tab, with profile-specific labels and appropriate capability checks |
| VU meter's three zones | Color → Low, Mid and Peak colors; save/reset; 65% and 80% boundaries are labeled |
| Three-band Fountain's three colors | Color → Bass, Midrange and Treble colors; save/reset |
| Audio gain, gate and scale factor | Sound → Sensitivity, Quiet cutoff and Contrast; shared scope, draft feedback and live/restart behavior explained |
| Save current lighting as startup | Light → Use these settings at startup |
| Automatic effect rotation | Light → Automatic rotation; enable, random/sequential, collection, interval and seconds/minutes |
| Create a coordinator and share/copy its code | Settings → Groups; sharing remains deliberate and explicit |
| Nearby coordinator discovery and join | Settings → Groups; discovered names plus group-code form; discovery does not silently grant control |
| Follower pause/resume and leave | Settings → Groups; Light → Manage group opens this section directly |
| All 18 group scenes plus Mirror effects | Light → Explore group scenes, with search and firmware-version limits |
| Group speed, intensity and two colors | Active group-scene panel; fixed-palette exceptions remain respected |
| Shared group audio tuning | Active audio group-scene panel, using the coordinator's microphone |
| Group lamp order and offline removal | Settings → Groups → Lamp order, with named up/down controls |
| Rename, room, identify and remove from phone | Settings → Overview; identify remains Wi-Fi-dependent; removal leaves lamp settings intact |
| LED count and power budget | Settings → Hardware → Strip & startup |
| Interactive last-LED probe | Settings → Hardware → Find the last LED; position, ±1/±10, knob instructions, save/cancel and timeout |
| Custom effect center | Settings → Hardware → Effect center; automatic value, current strip boundary and geometry instructions |
| Startup effect and brightness | Settings → Hardware → Strip & startup, with restart save |
| Installed microphone flag | Settings → Hardware → Microphone hardware; sound tuning stays with the effects |
| Wi-Fi scan, SSID and credentials | Settings → Network → Wi-Fi & security; scan results remain selectable |
| Open network, forget Wi-Fi and access password | Settings → Network; independent save with restart |
| Bluetooth pairing state and forgetting paired phones | Settings → Network → Bluetooth pairing, with knob instructions |
| Firmware version, check, install and automatic update | Settings → Updates; available version appears on the install action |
| Update progress, failure and retry | Settings → Updates; actual firmware progress and errors, with incompatible controls disabled during updating |
| Physical knob gestures | Settings → Overview → Using the knob |
| Disconnected and unsupported states | Empty Light workspace, disabled dependent controls, transport hints and original firmware compatibility messages |

No GPIO assignments, lamp firmware, network permissions, credentials storage or radio discovery protocols were changed by this redesign.

## Visual and accessibility system

The CSS is consolidated around shared surface, text, border, action and sound tokens. Controls use consistent corner radii, spacing and interaction states. Text uses relative units; layouts wrap instead of clipping when enlarged. Decorative motion is minimal and transitions are disabled when reduced motion is requested.

Buttons are at least 44 CSS pixels high, with main actions at least 48. Switches use their full-height label as the touch target. Inputs retain native editing and color-picker behavior. Visible focus outlines, arrow/Home/End navigation in the effect tab list, named icon controls and descriptive slider values support keyboard and screen-reader use. Focused controls are scrolled above the persistent navigation and any visible feedback toast. Repeated identical group/update messages are not rewritten into live regions on every poll.

Persistent status text gives screen readers action feedback; a brief visual toast also makes that feedback visible when the status line is outside the viewport. Selected effects, tabs, lamp connections and group roles use text and semantic state in addition to color.

The design follows the principles in [Apple's accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/), including [focus not being obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Gradient backgrounds require additional review because axe cannot resolve every color behind text. Conservative endpoint calculations check muted text against the brightest hero background (at least 4.5:1), primary/sound action labels (over 9:1), and the input/control boundary palette (at least 3:1 on its intended surfaces). Automated audits are evidence about the tested states, not a claim of complete standards conformance.

## Validation and release review

- Production Vite build passes.
- All 54 mobile unit tests pass, including configuration-save isolation.
- Existing effect regression checks cover two-color activation from defaults, VU/fountain colors, shared sound drafts, live apply, option writes, keyboard tabs and older firmware.
- Existing group checks cover every scene, separate lamp roles, group/follower power, scene settings, ordering, rotation, probe calibration and pause/resume.
- The design check covers navigation, favorites/search, persistent brightness, returning to the current lamp, Wi-Fi scanning, configuration saves, actual update progress/error paths and reduced motion.
- Responsive checks cover 320, 393, 768 and 1280 CSS-pixel widths. Text enlargement is checked separately at 200% on the main destinations.
- axe-core checks for WCAG A/AA criteria across nine connected screens found no violations: audio, lamps, library, overview, hardware, network, updates, group settings and group scene.

Browser checks intercept lamp requests; they do not change physical lamps. Before TestFlight release, review the UI on a physical iPhone with VoiceOver, enlarged system text, the software keyboard and iOS safe-area insets. Confirm native Bluetooth, Local Network permission prompts and real discovery/update behavior. TestFlight publication uses the existing iOS upload workflow.

### Reproduce

```sh
npm --prefix mobile test
npm --prefix mobile run build
```

The optional browser checks require Playwright/Chromium. The design audit also requires axe-core. These are testing tools, not app dependencies.

```sh
node tools/check-effect-panes.cjs
node tools/check-sync-ui.cjs
node tools/check-app-design.cjs
```

Raw browser reports and fresh screenshots are written under ignored `.build/ui-redesign/`; effect/group checks also write under `.build/ui-check/`.

The [helix app icon](app-icon.md) uses the same lamp illustration and includes native iOS/Android assets.

## Previews

These are screenshots of the implemented application using simulated lamp responses.

| Screen | Preview |
| --- | --- |
| Lamps | [Phone](previews/phone-lamps.png) |
| Light workspace | [Phone](previews/phone-light.png) |
| Sound tuning | [Effect pane](previews/audio-detail.png) |
| Effect collection | [Phone](previews/phone-library.png) |
| Settings overview | [Phone](previews/phone-overview.png) |
| Hardware | [Phone](previews/phone-hardware.png) |
| Network and security | [Phone](previews/phone-network.png) |
| Available update | [Phone](previews/phone-updates.png) |
| Failed update with retry | [Phone](previews/phone-update-error.png) |
| Group scene | [Phone](previews/phone-group.png), [Tablet](previews/tablet-group.png) |
