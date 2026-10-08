# CoolLamp assembled PCB — preliminary design brief

## Enclosure Wi-Fi observation — 2026-10-08

Owner reports that a couple of lamps can scan Wi-Fi and report strong signals,
but cannot connect unless the ESP32-C3 development board is pulled slightly out
of the enclosure. Exact affected units, antenna orientation, and whether power
or a restart also changed have not yet been confirmed. This limits the earlier
single-prototype report of reliable Wi-Fi inside the base; it does not establish
reliable enclosed operation for every build.

Antenna shielding/detuning is a leading suspect, while movement of wiring or
mechanical contacts remains an alternative. Compare inside/exposed positions
with the same lamp location, SSID, supply/cable and LED load, checking connection
success and uptime/reset continuity. Do not treat scan RSSI as proof of a
working two-way connection or combine this observation with the separate
same-IoT client-forwarding fault.

Identify the actual development-board antenna before selecting its position.
Reserve antenna clearance from the metal walls, encoder and wiring; verify that
the bottom cover/backing provides a nonconductive RF path. Final antenna/module
selection and board/mount geometry must pass connection, reconnection and data
tests with the complete base closed and on its intended surface. An external
antenna is an option to evaluate if placement cannot provide reliable operation;
no board swap, antenna modification, GPIO or firmware change has been made.

## HW-040 encoder update — 2026-09-30

The selected encoder is now the owner's photographed HW-040 breakout, with onboard
R2/R3 marked 103 (10 kΩ); R1 appears unpopulated. Front header, pins downward:
**GND, +, SW, DT, CLK** left to right. The code-compatible mapping is GND→GND,
+→GPIO1, SW→GPIO2, DT→GPIO3, CLK→GPIO4. GPIOs and firmware remain unchanged.
GPIO1 is driven HIGH by the existing library; do not feed the breakout from 5 V.
Resistor trace routing and SW bias still need measurement. See [wiring documentation](../wiring.md).

This supersedes the bare-encoder assumption. The earlier 4.5 mm seating-plane and
direct-soldered encoder mounting studies are historical; remeasure the breakout
outline, mounting holes, header clearance and panel-to-board stack before using
them for a PCB/insert. No breakout mounting footprint is released.



## Owner-selected onboard microphone — 2026-09-28

Owner prefers the microphone soldered to the MAIN PCB, potentially near the encoder, aligned with a small sound opening drilled in the metal lamp base. This supersedes the separate microphone daughterboard architecture. Eliminate the microphone harness/connector from the final design once a specific onboard microphone is selected. Maintain GPIO5 SCK, GPIO6 WS and GPIO7 SD and support unpopulated microphone variants through the existing installed setting.

Reserve an acoustic/component area near the encoder, but do not freeze location or drill size yet. Exact microphone port orientation, PCB acoustic hole, panel aperture and any short acoustic seal/channel must be coordinated with the 4.5 mm panel-to-PCB spacing and selected package. A bottom-port microphone needs a PCB sound hole; placement side must ensure that hole leads toward the panel opening rather than being obstructed by the PCB or encoder. A top-port candidate would require a different mechanical path and verified electrical compatibility. Keep the port clear of adhesive, flux/cleaning contamination and clamping hardware; use the selected microphone's assembly guidance.

Consider mechanical noise from encoder turns/button presses and keep LED power-current returns/regulator noise away from the microphone area. Validate audio response in the closed base after assembly. A small guide/seal integrated into the spacer may be useful; dimensions must be based on the selected microphone and enclosure, not an arbitrary pinhole.

Schematic status: J3 in the current A0 draft still represents the SUPERSEDED daughterboard interface. It must be replaced by the selected microphone, local decoupling and channel-select circuitry before schematic release; do not fabricate/order from the A0 parts-review CSV. No microphone substitution or firmware change has been made.

## Current design decision — existing inlet and variable LED count

Owner confirms the current inlet/supply combination powers the complete working lamp adequately and wants to retain it. Keep the existing four-wire inlet as the revision-A prototype baseline; purchasing a replacement is not a prerequisite for schematic development. USB 2.0 programming data uses D+/D− alongside VBUS/GND: owner mapping blue D+ → GPIO19, white D− → GPIO18. Verify enumeration and flashing with the actual inlet, in both plug orientations. Observed 5 V operation does not establish the internal CC circuit or USB-PD negotiation; retain that as an unverified compatibility detail rather than treating it as a demonstrated power failure. This supersedes the previous recommendation to require an inlet replacement before proceeding.

Owner estimates approximately 132 LEDs for the current helix and similar lamps. Other geometries will use other counts, so the board and firmware must not hard-code 132. Current code already persists per-lamp LED count, validates 1–1024, and allocates the active strip buffers from that setting at boot. The factory default remains 134 (`LampConfig.h`); do not change it based on an approximate physical count. The software maximum is not a claim that this power path can drive 1024 LEDs at full brightness. Final copper/connector/protection ratings remain based on the supported current budget. Preserve configurable midpoint and existing GPIO assignments.


Updated 2026-09-27. Planning only; not fabrication-ready.

## Confirmed requirements

- Target batch: 10–20 assembled boards, with a smaller fit/function prototype batch first.
- Enclosure: metal circular lamp base, owner reports 1 inch (25.4 mm) depth.
- Owner confirms 3.9 inch (99.06 mm) inside diameter. Bottom closure is a soft sticker, not metal. Verify whether its backing contains foil or other conductive material. Cover/standoff clearance and any internal obstructions still need checking before releasing the outline.
- Existing power source confirmed from label photo: Anker PowerPort mini, model A2620; output 5 V DC, 2.4 A, with label also stating 2.4 A max per port. Treat 12 W as the adapter budget; do not assume 12 W simultaneously from each port. Cable capability and actual intended LED load remain to be verified.
- Owner confirms foam is easily removable. Replace it with a purpose-designed insulated PCB mount.
- Existing inlet is a USB-C socket mounted on the side of the base, wired with 5 V and GND to the development board. Preserve the panel-mounted power-inlet arrangement as the revision-A baseline. Photo shows a round black panel-mount USB-C receptacle with several flying leads. Exact manufacturer/part, mounting dimensions, lead pinout and internal CC implementation remain unknown. Do not assign signals from wire colors or assume unused leads are USB data.
- Rotary knob: working prototype photo confirms a top-mounted, off-center encoder beside the lamp stem, secured at the panel with a nut. Exact hole offset, panel thickness, encoder body dimensions and shaft length remain open.
- Preserve existing GPIO assignments and ESP32-C3 firmware compatibility.

## Working prototype placement (photos reviewed 2026-09-26)

- The owner reported reliable Wi-Fi inside this particular base at the earlier photo checkpoint. The position-sensitive failures reported on 2026-10-08 supersede using that observation as a general design guarantee. Retain the working example for comparison; validate enclosed antenna placement before deciding whether an external antenna is needed.
- The underside photo shows the electronics and wiring in a channel cut through white foam. The owner identifies the development board near the yellow wire, toward the upper-right portion of this particular photo. Its exact antenna end/orientation is obscured; do not infer an RF orientation from the wire colors.
- A microphone is present according to the owner. Its acoustic port orientation and clear path to the room cannot be identified reliably in this photo.
- Foam occupies much of the apparent cavity in the photo; owner subsequently confirmed it is easily removable. Measure the remaining encoder/stem/inlet obstructions with the foam removed before fixing the board outline.
- Retain the encoder's visible off-center top location. A short encoder harness permits a main board elsewhere in the base. A rectangular or shaped board is also an option; there is no requirement to fill the circular cavity.
- Mechanical fixture/standoff design and microphone placement should replace improvised retention only after confirming whether any existing insert supports the lamp stem or other structural parts.

## Proposed architecture, pending mechanical confirmation

Use an ESP32-C3 module on a custom carrier PCB, with assembled 3.3 V supply, microphone, power protection and connectors. Given the nonmetal bottom, evaluate an ESP32-C3-MINI-1 onboard antenna near the PCB edge and exposed toward the underside, with clearance from the metal walls and tabletop. This is conditional on a nonconductive sticker and enclosure-level RF testing. The ESP32-C3-MINI-1U external-antenna module remains an alternative; exact module ordering code, flash size and antenna selection remain to be checked against the firmware and supplier stock. An external antenna connector does not solve shielding if the antenna itself remains enclosed in metal. Locate a suitable antenna outside the metal cavity or behind a sufficiently sized nonmetallic opening, with manufacturer-required clearance and enclosure-level RF testing.

A top-mounted panel encoder connected by a short harness is the preliminary mechanical choice. This gives freedom to locate the PCB below/beside the encoder within the shallow base. Allow for encoder body, connector height, wire bends, bottom cover and insulating standoffs; do not treat the full 25.4 mm as component height.

Provide a dedicated acoustic opening aligned with the microphone port. Microphone part selection and assembly handling remain open; the INMP441 prototype is currently working. Do not bury the acoustic port against the metal base or adhesive.

Use the existing side-mounted USB-C inlet for power and native USB data, as selected by the owner on 2026-09-27. Connect all four documented leads through a keyed main-board harness connector; retain boot/reset access for initial programming and recovery. Specify its attach/current-handling circuitry, ESD protection, cable/source current assumptions and power budget before schematic release. Route strip power through appropriately sized protection, copper and connectors; use a separate regulated 3.3 V branch for the controller and microphone. Preserve access to boot/reset and programming/test points.

A roughly 75–80 mm diameter PCB was an initial study size before seeing the foam insert; do not commit to it. A smaller rectangular or shaped PCB may better fit the existing assembly. Within a 99.06 mm cavity this leaves approximately 9.5–12 mm radial clearance, which does not by itself establish antenna clearance or encoder fit. Final board size depends on the antenna geometry, encoder body, power inlet and mounting details.

## Fixed GPIO mapping

| Function | GPIO |
| --- | --- |
| WS2812B data | 0 |
| Encoder reference (existing firmware arrangement) | 1 |
| Encoder pushbutton | 2 |
| Encoder B | 3 |
| Encoder A | 4 |
| Microphone bit clock | 5 |
| Microphone word select | 6 |
| Microphone data input | 7 |

The encoder reference is not permission to use GPIO1 as a general-purpose power rail. Confirm the actual encoder terminal mapping against the working prototype before schematic capture. Preserve the internal-pullup behavior used in the prototype. Any added LED interface conditioning must be explicitly documented as a PCB design choice, not as an existing prototype component.

## Information still needed

1. Measure usable space and remaining obstructions with the removable foam out; verify sticker backing is nonconductive.
2. Intended LED count/strip variant and brightness requirements; 5 V/2.4 A adapter rating is confirmed.
3. Exact existing USB-C socket/breakout, current rating, CC circuitry and dimensions; inlet is confirmed side-mounted.
4. Encoder mounting position, exact part, body/shaft dimensions, and base top thickness.
5. Acceptable antenna location/nonmetallic opening and microphone opening.

## Manufacturing approach

Obtain comparable quotes at 10 and 20 assembled boards after the BOM and placement are defined. Include setup, component overage, connectors/through-hole assembly, shipping and any programming/test service. A quote cannot be inferred from bare-PCB promotional pricing. Do not order or send design files to a supplier until the manufacturing package and mechanical fit are reviewed.

Sources checked 2026-09-26:
- [Espressif ESP32-C3-MINI-1 / MINI-1U datasheet](https://documentation.espressif.com/esp32-c3-mini-1_datasheet_en.html)
- [Espressif ESP32-C3 PCB layout guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/pcb-layout-design.html)
- [PCBWay assembly ordering and small-quantity guidance](https://www.pcbway.com/blog/PCB_Basic_Information/PCBWay_Q_A_003___Common_Questions_for_PCBA_Ordering_01.html)

## Panel USB-C inlet reference

Owner supplied a photo of the loose inlet on 2026-09-26. Retain this panel-mount/pigtail arrangement as the mechanical concept. Only the previously verified 5 V and GND connections are used in the working lamp. A matching purchase link or manufacturer drawing is needed to specify the same part for assembly; alternatively select a documented equivalent with owner-reviewed mounting dimensions. The image does not establish current rating, USB data support, or whether CC termination is internal.

Main-PCB schematic work can proceed with a named 5 V/GND input connector while the inlet remains a separately specified harness item. Do not order an unidentified socket as a production component. If the panel receptacle has internal CC termination, do not duplicate it blindly; if CC is absent and inaccessible through the leads, adding resistors to the main PCB power connector will not provide USB-C attach detection. Keep unused leads individually insulated until the pinout is verified.

### Inlet package label

Photo reviewed: barcode text `X0047A7337`, secondary code `03546_11`, quantity `8pcs`, made in China. The Chinese description identifies a black round/capped four-wire variant without terminals. This is packaging identification, not an electrical specification. No manufacturer name, current rating, wire-to-pin mapping or CC termination is established by the label. Do not treat four leads as proof of USB data or USB-C-to-USB-C power compatibility.

### Inlet product listing identified

Owner supplied [Amazon ASIN B0D1MQSZL9](https://www.amazon.com/dp/B0D1MQSZL9), reviewed 2026-09-26. Listing identifies XIITIA, an eight-pack of round panel-mount USB-C female four-wire pigtails, without terminals. The seller's feature text identifies red as positive, black as negative, nominal 5 V and maximum 3 A. These are seller claims, not independently verified assembly ratings. The longer description contains inconsistent generic voltage/current figures; do not treat it as a qualified manufacturer datasheet.

No verified CC circuit, remaining-lead mapping, dimensioned mounting drawing or wire gauge was established from the retrieved text. Maintain the working power-only use, subject to sample verification. Before the production harness is released, confirm lead continuity/polarity, installation dimensions, usable current/voltage drop and USB-C source compatibility. Do not infer a capability from the listing's waterproof marketing.

Original power-only interface proposal (superseded by the four-position USB interface below): the separate panel inlet supplied a keyed two-position main-board connector. Route VBUS through input protection to the LED supply and a separate 3.3 V regulator branch. The subsequently selected USB data interface uses both remaining leads; see the current interface below. Keeping the inlet separate allows replacing it with a documented equivalent without rerouting the controller PCB.

### Owner-confirmed lead mapping (2026-09-27)

The owner looked up the harness pinout:

| Lead | Signal |
| --- | --- |
| Red | +V / VBUS (5 V in this lamp) |
| Black | GND |
| Blue | USB D+ |
| White | USB D− |

This supersedes the earlier uncertainty about the two remaining leads. It is owner-supplied documentation, not a continuity or signal-integrity measurement performed here. Existing wiring uses only red/black. The owner subsequently selected the data-capable interface: use a four-position keyed harness for native USB programming and diagnostics. Verify the exact ESP32-C3 module's USB pin mapping, USB data protection/routing and cable performance before drawing that option into the schematic. Provide boot/reset recovery access either way.

Knowing D+/D− does not establish whether the receptacle contains CC pull-downs. Retain that separate compatibility check.

## Selected USB interface (2026-09-27)

USB data at the side socket is a required revision-A feature. ESP32-C3 native USB Serial/JTAG supports initial firmware loading and diagnostics without a separate USB-to-UART IC.

Proposed connector signal order (not yet a selected connector footprint):

| Position | Harness lead | Destination |
| --- | --- | --- |
| 1 | Red, VBUS | Protected 5 V input |
| 2 | White, D− | USB protection/interface network → GPIO18 |
| 3 | Blue, D+ | USB protection/interface network → GPIO19 |
| 4 | Black, GND | Board ground |

Keep D+/D− together with a short harness; route the PCB pair according to Espressif guidance and validate enumeration/flashing using the actual panel receptacle and cable. Connector selection must meet power-current and USB signal requirements. Existing GPIO0–7 assignments remain fixed.

Provide BOOT (GPIO9) and RESET (EN) buttons or equivalent accessible test contacts for first flashing and recovery. Verify all boot straps, including GPIO8 and the existing GPIO2 encoder-button interaction; do not assume automatic download entry will always be available on a blank or misconfigured device.

The side port is the intended single power input. During computer programming, use a conservative programming power state with LEDs off and do not connect the wall adapter as a second supply in parallel. Define initial provisioning to write the bootloader, partition table and application, with device credentials, rather than only the OTA application binary. USB-C CC termination remains unverified and must be checked separately; D+/D− wiring does not replace it.

Reference: [Espressif native USB connection and first-flash instructions](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/get-started/establish-serial-connection.html).

### USB harness routing target

For the prototype, target approximately 5–10 cm from panel socket to board connector, with enough slack for assembly and strain relief; this is a project layout target, not a USB-specified maximum or guarantee. Keep blue D+ and white D− together as a gently twisted, approximately equal-length pair, untwisting only as needed at terminations. Route away from the antenna, LED power bundle and switching-regulator components. Ground remains connected through the black lead.

The ESP32-C3 uses 12 Mbit/s full-speed USB. A short unshielded internal pair may work, but must be validated in the completed lamp; twisting arbitrary wires does not establish controlled impedance or USB compliance. For production, prefer a documented USB harness with a nominal 90-ohm differential pair and appropriate shielding/termination if the existing pigtail cannot be validated. The metal base does not itself establish a proper cable shield connection. Test repeated enumeration and flashing, both USB-C orientations, and diagnostics during changing LED loads. PCB USB routing remains a separate controlled-impedance layout requirement.

References: [ESP32-C3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf), [USB 2.0 specification, hosted by TI](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/196/2656.usb_5F00_20.pdf).

## Latest owner clarification — 2026-09-27

This section supersedes earlier uncertainty about encoder depth and inlet CC components.

- Encoder body extends approximately **8 mm below the top panel**, per owner measurement. Body footprint, exact position, terminal/wire clearance and mounting tolerances remain open.
- Foam-free underside photo shows a largely clear cavity with a central opening/feature and a side-mounted inlet. Do not derive precise coordinates from the oblique tape photo. Retain owner-reported 99.06 mm inside diameter and 25.4 mm depth pending physical template fit.
- USB-C inlet is a **passive four-wire pass-through with no electronics**, per owner. Plan on no CC pull-downs. The existing USB-A wall-adapter arrangement can supply power without Type-C source attach detection, but a compliant USB-C source ordinarily will not enable VBUS without sink CC termination.
- For a basic USB-C sink receptacle, CC1 and CC2 each need their own nominal 5.1 kΩ pull-down to ground (or equivalent sink-controller termination). Do not tie CC1/CC2 together or add these resistors to D+/D−. Because neither CC pin reaches the existing four-wire harness, this cannot be corrected solely on the main PCB.
- Proposed production solution: a documented panel inlet/daughterboard with CC terminations, or a harness exposing CC1/CC2 for a main-board implementation. Final selection and source-current detection remain open. Pull-downs establish attachment; they do not alone authorize 2.4 A from every charger or computer.

Reference: [USB Type-C specification, release 2.4, hosted by TI](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/196/USB-Type_2D00_C-Spec-R2.4-_2D00_-October-2024.pdf).

## Confirmed fit inputs — 2026-09-28

- Owner confirms the corrected paper template calibration line measures exactly 50 mm. It can now be used for physical fit checks; the photo still does not provide precise coordinates.
- The encoder hole has NOT been drilled. The drawn mark is a candidate position, not a fixed mounting coordinate. Select encoder position together with PCB placement, knob access, body and terminal clearance. Its proposed approximately 8.3 mm hole diameter must match the actual encoder mounting bushing before drilling.
- Central stem nut measures approximately 15.5 mm at its widest point. Reserve a provisional 20 mm diameter central hardware envelope (2.25 mm radial allowance) for layout studies. This is not a validated wire-bend or tool-access allowance. Nut axial position and wire routing remain to be checked.
- Prefer keeping the electronics insert removable without disturbing the stem fastening. The final cutout/opening and assembly sequence must allow this; a closed ring may need to be split or slotted if it cannot pass the existing hardware/wiring.

Next layout study: compare an offset rectangular PCB and a board with a central clearance cutout, then place the encoder in the remaining accessible area. Retain the side USB inlet and the separate microphone-board concept. Do not freeze the provisional 45 × 35 mm PCB outline or boss positions before component placement and antenna clearance review.

## Encoder purchase reference — 2026-09-28

Owner identifies [Amazon B07D3DF8TK](https://www.amazon.com/dp/B07D3DF8TK) as the existing encoder. The retrieved seller listing identifies DIYhz, EC11 with push switch, selected EC11-20mm variant, sold in a ten-pack. Treat this as a purchase reference, not an exact manufacturer drawing or proof of footprint equivalence to an Alps/Bourns part. The 20 mm variant label does not establish panel-to-PCB mounting distance.

Proceed with the proposed direct-to-PCB encoder plus central stem mounting study. Exact signal-pin and anchor-tab geometry, mounting shoulder-to-PCB seating distance, thread dimensions and contact mapping must be verified on a sample or a matching dimensioned drawing before footprint release. Existing approximate 8 mm body intrusion and proposed 8.3 mm panel hole remain owner measurements, not supplier specifications. Preserve GPIO1/2/3/4 connections from the working prototype and verify electrical terminal assignment by continuity rather than generic EC11 orientation.

Next verification artifact: a 1:1 encoder footprint print with signal holes and mechanical tab slots, checked against a spare physical encoder. Do not create manufacturing hole coordinates from the EC11 family name alone. Retain clearance-only body placement until those dimensions are available.

## Encoder caliper photographs — 2026-09-28

Two owner photographs show digital caliper readings of **13.05 mm** and **26.36 mm**. First is an underside/body-width view; the image is consistent with measuring across the encoder body region, but exact contact faces and inclusion of projecting metal features cannot be determined confidently. Second is an axial side view, apparently from the rear/body area to the shaft tip; exact rear contact surface is not unambiguous. Record these as photo reference spans, not toleranced manufacturer dimensions.

Neither reading establishes signal-pin pitch, mechanical-tab centres/slot sizes, or distance from the panel-bearing shoulder to the PCB seating plane. The 26.36 mm reading is not a spacer height. Do not infer an encoder footprint or subtract the listing's nominal 20 mm variant label to derive body height.

Next: measure panel-bearing shoulder to PCB seating surface (not pin tips) to set the centre-stem spacer stack; verify underside signal-hole and anchor-tab geometry with a closer square-on view/sample measurements before producing the footprint fit print. Existing approximately 8 mm body intrusion remains a separate owner observation.
