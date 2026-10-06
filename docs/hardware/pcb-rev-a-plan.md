# CoolLamp PCB revision A — execution plan

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


Status: requirements and architecture; not ready to manufacture.

## Objective

Produce an assembly-ready design for 10–20 CoolLamp controllers, preceded by a small prototype batch. Preserve GPIO assignments, existing effects, audio support, OTA and saved-setting formats. Keep the present ESP32-C3 architecture; Matter is out of scope.

## Starting architecture

- ESP32-C3 module with onboard antenna, informed by the working in-base prototype. Exact module/flash ordering code and land pattern must be verified before selection.
- Regulated 3.3 V for the controller and I2S microphone; nominal 5 V USB input and LED supply path.
- INMP441 is the functional microphone reference. Check authorized sourcing and lifecycle before selecting a production part; do not substitute another I2S microphone without validating timing and scaling.
- Off-center panel-mounted pushbutton rotary encoder connected by a short harness. Preserve GPIO1 reference and GPIO2/3/4 connections from the working prototype.
- LED connector with power, ground and GPIO0 data. Define connector current capacity from the confirmed supply and LED load.
- Microphone uses GPIO5/6/7. Plan an unobstructed acoustic path.
- Selected: native USB data through the side-mounted socket. Blue D+ routes to GPIO19 and white D− to GPIO18 through the USB interface/protection circuitry; red/black provide power/ground. Use a keyed four-position connector, verify the actual harness and retain BOOT/RESET access for initial flashing and recovery.
- Insulated mechanical mounting within a 99.06 mm inside-diameter, 25.4 mm deep metal base with a soft bottom closure. Do not assume the entire cavity is free: encoder, stem hardware and inlet consume space. Owner confirms the foam is removable.

## Gate 1: resolve fit and power

Confirmed: removable foam; side-mounted USB-C socket wired for power only; Anker A2620 adapter labeled 5 V/2.4 A (12 W).

Remaining inputs:

1. Inlet identified: XIITIA Amazon ASIN B0D1MQSZL9, four-wire panel socket. Owner confirms it is a passive four-wire pass-through with no electronics or CC termination. Resolve a replacement or socket-side CC solution for USB-C-to-USB-C operation; verify dimensions and current capability on a sample.
2. Encoder: owner reports body extends approximately 8 mm below the top panel. Hole-center position relative to base center, body footprint, and panel thickness remain to be measured. Confirm exact encoder part/terminal mapping before schematic release.
3. Strip: actual LED count, strip model/voltage and desired brightness/current limit for these units.

Deliverable: dimensioned component-placement sketch. Print a 1:1 paper/card outline to check mounting, wire bends, encoder clearance and connector access in the real base before PCB routing. A small rectangular or shaped board remains an option; no board outline has been selected.

## Gate 2: electrical design

Create editable KiCad schematic and BOM with exact manufacturer part numbers. Verify module power/boot circuits, USB implementation, power distribution/protection, microphone decoupling/port, encoder connections and LED data interface. Distinguish any new interface/protection components from the resistor-free prototype. Preserve GPIO compatibility.

Size the LED power path and protection using the confirmed load and source. The adapter label confirms 5 V/2.4 A. That is the source rating, not the LED allocation or a guarantee that any USB-C source/cable combination permits that draw. Reserve controller current and design margin; verify cable/inlet capability and source detection as appropriate. Include a defined startup power budget and programming behavior.

Review the schematic and BOM before layout. Resolve stock/assembly availability with the candidate assembler's parts catalog or a quote; no component availability or price is assumed.

## Gate 3: layout and review

Use manufacturer land patterns, antenna clearance and microphone acoustic/reflow guidance. Route the LED current path away from microphone supply/return where practical. Check connector orientation, silkscreen labels, mounting insulation, encoder fit and antenna position. Run electrical and layout rule checks; inspect plots and assembly views.

Deliverables: editable KiCad project, schematic PDF, board/assembly views, Gerber/drill files, BOM, placement file, fabrication and assembly notes. No files are released for fabrication until fit and design review are complete.

## Gate 4: pilot assembly and test

Request separate quotes for a small pilot (for example 3–5 assembled boards) and 10/20 units. Confirm tooling/setup charges, component overage, shipping, lead time and programming/test scope. Do not place an order or message vendors without the owner's authorization.

Provision each pilot with the proper initial firmware/partition image and device credentials; the public OTA application image alone is not a fresh-board provisioning package. Check power/current and temperatures, boot/recovery, encoder, LEDs, raw microphone response, every audio mode, Wi-Fi/Bluetooth with the bottom fitted and the lamp on a table, and an OTA cycle. Verify acoustic behavior with the final mounting and cover. Record any rework before ordering the remaining quantity.

## Existing reference

See [custom-pcb-brief.md](custom-pcb-brief.md) for confirmed dimensions, GPIO mapping, photographic observations and manufacturer references.

## Mechanical and inlet update — 2026-09-27

Owner supplied a foam-free underside photo and reports encoder intrusion of approximately 8 mm. Photo shows a largely open cavity, a central opening/feature and a side-mounted inlet with leads. The tape and perspective are insufficient to define an exact PCB outline or mounting coordinates; retain the previously reported 99.06 mm inside diameter. The nominal 25.4 mm depth minus 8 mm encoder intrusion leaves 17.4 mm under the encoder before PCB thickness, insulation, mounting and wire allowances. This is not a released component-height limit.

Owner confirms the existing four-wire USB-C socket has no electronics: VBUS, GND, D+ and D− only. Treat CC termination as absent for design planning. The four-wire main-board connector cannot supply missing socket-side CC terminations. Proposed production direction: documented panel socket/daughterboard with separate CC1/CC2 sink terminations, or a harness exposing both CC pins to the controller PCB. Preserve native USB GPIO18/19 and existing GPIO0–7. Socket choice remains open; do not release the current inlet as a general USB-C-compatible production interface. CC attach detection does not authorize the full 2.4 A load; source-current detection/budget remains a separate design task.

## Stem and encoder update — 2026-09-28

Marked paper template identifies a central approximately 10 mm lamp mounting hole carrying the stem and LED wires, with stem intrusion approximately 15 mm. Encoder hole is approximately 8.3 mm, below centre opposite the USB inlet in the underside view. Exact offsets and body/hardware envelopes remain unmeasured. Revise the centred PCB study to clear stem, retaining hardware and wire bends; investigate offset placement or a cutout. See mechanical/README.md for clearance calculations and print-calibration status.

## Confirmed fit inputs — 2026-09-28

- Owner confirms the corrected paper template calibration line measures exactly 50 mm. It can now be used for physical fit checks; the photo still does not provide precise coordinates.
- The encoder hole has NOT been drilled. The drawn mark is a candidate position, not a fixed mounting coordinate. Select encoder position together with PCB placement, knob access, body and terminal clearance. Its proposed approximately 8.3 mm hole diameter must match the actual encoder mounting bushing before drilling.
- Central stem nut measures approximately 15.5 mm at its widest point. Reserve a provisional 20 mm diameter central hardware envelope (2.25 mm radial allowance) for layout studies. This is not a validated wire-bend or tool-access allowance. Nut axial position and wire routing remain to be checked.
- Prefer keeping the electronics insert removable without disturbing the stem fastening. The final cutout/opening and assembly sequence must allow this; a closed ring may need to be split or slotted if it cannot pass the existing hardware/wiring.

Next layout study: compare an offset rectangular PCB and a board with a central clearance cutout, then place the encoder in the remaining accessible area. Retain the side USB inlet and the separate microphone-board concept. Do not freeze the provisional 45 × 35 mm PCB outline or boss positions before component placement and antenna clearance review.

## Proposed shared stem/encoder mounting — 2026-09-28

Owner proposes using the existing centre stem nut/washer to clamp a PCB with a stem cutout against an insulating spacer, and soldering a panel-mounted encoder (including its mechanical anchor tabs) directly to that PCB. The encoder bushing nut then provides a second attachment to the top panel. This is an architecture candidate, not a released mounting stack. It supersedes treating the harness-mounted encoder as the only revision-A option. GPIO assignments remain fixed.

Evaluate this arrangement before finalising a full printed insert. The exact encoder's seating plane fixes the PCB distance from the top panel; size the stem spacer to that same plane so tightening either nut cannot bend the PCB or preload the encoder solder joints. Measure actual encoder geometry rather than deriving the seating plane from the approximately 8 mm body intrusion alone. Verify available stem thread engagement with PCB, insulating spacer and load-spreading washer included. Identify encoder exact part, anchor-tab pattern and bushing dimensions before footprint selection.

Provide an insulated, component-free clamping area around the centre opening, with clearance to copper on both faces and appropriate internal-layer clearance. Define the stem/nut/washer load path and assembly torque so structural lamp loads are carried by appropriate hardware/spacers and not uncontrolled PCB flex or FR-4 crushing. Preserve tool access and prevent the washer from contacting traces, vias or components. A slotted cutout versus closed hole changes retention and assembly sequence; select deliberately after fit review.

The two anchors may permit replacing the full insert with smaller insulating spacers, anti-flex supports and a separate microphone bracket. Check PCB flex during knob presses and rotation. Keep microphone acoustic access and antenna clearance in the combined mechanical/electrical placement study. Do not export the current ring/boss concept as the final mount; it represents the earlier independent-support study.

## Encoder seating distance and shared clamp study — 2026-09-28

Owner confirms **4.5 mm panel-to-PCB distance**, responding to the request for the panel-bearing shoulder to PCB seating surface. Use 4.5 mm as nominal panel-inner-face to encoder-side PCB face for the mounting study. Verify seating against a physical sample before fabrication; this supersedes estimating mounting-plane height from the earlier approximately 8 mm body intrusion.

New underside photograph shows the body and terminal groups beside a millimetre ruler. Three electrical terminals are visible on one side and two on the opposite side. Projection and terminal bends remain insufficiently resolved to release exact drill centres, tab slots or an off-the-shelf footprint; metal features securing the encoder case must not automatically be treated as PCB mounting tabs. Preserve the existing terminal-to-GPIO mapping through sample continuity checks.

Proposed axial stack, measured inward from the inside face of the metal top panel:

| Position | Nominal depth | Status |
| --- | --- | --- |
| Inside panel face | 0 mm | Reference |
| Insulating spacer, panel to PCB | 4.5 mm | Owner seating measurement; adjust if washers are interposed |
| PCB encoder-side face | 4.5 mm | Nominal seating plane |
| PCB opposite face | 6.1 mm | Assuming 1.6 mm PCB |
| Insulating/load-spreading washer and stem nut | Beyond 6.1 mm | Actual washer/nut thickness and thread engagement unverified |
| Stem tip | Approximately 15 mm | Owner measurement |

This leaves a nominal 8.9 mm from PCB opposite face to stem tip before washer/nut thickness and thread engagement allowances. It is not confirmation of adequate engagement. The stem passes through the PCB plane; a centre opening is required.

IMPORTANT: the previous 20 mm diameter hardware envelope is a study keepout, NOT an approved clamping-hole diameter. A nut measuring 15.5 mm across its widest point cannot bridge a 20 mm opening without a suitably larger load-spreading washer. Define hole diameter from actual stem/thread diameter plus assembly clearance; define washer bearing diameter and copper/component keepout separately. Include insulation and prevent structural clamp loads from bowing/crushing the PCB. Determine where strip wires emerge so the spacer/washer cannot pinch them.

The earlier OpenSCAD ring remains an alternative concept, not a model of this axial stack. Next mechanical revision must represent the encoder-supported PCB plane, central spacer/washer/nut and wire path explicitly.
