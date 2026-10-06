# CoolLamp insert — concept A

## HW-040 encoder update — 2026-09-30

The selected encoder is now the owner's photographed HW-040 breakout, with onboard
R2/R3 marked 103 (10 kΩ); R1 appears unpopulated. Front header, pins downward:
**GND, +, SW, DT, CLK** left to right. The code-compatible mapping is GND→GND,
+→GPIO1, SW→GPIO2, DT→GPIO3, CLK→GPIO4. GPIOs and firmware remain unchanged.
GPIO1 is driven HIGH by the existing library; do not feed the breakout from 5 V.
Resistor trace routing and SW bias still need measurement. See [wiring documentation](../../wiring.md).

This supersedes the bare-encoder assumption. The earlier 4.5 mm seating-plane and
direct-soldered encoder mounting studies are historical; remeasure the breakout
outline, mounting holes, header clearance and panel-to-board stack before using
them for a PCB/insert. No breakout mounting footprint is released.



## Owner-selected onboard microphone — 2026-09-28

Owner prefers the microphone soldered to the MAIN PCB, potentially near the encoder, aligned with a small sound opening drilled in the metal lamp base. This supersedes the separate microphone daughterboard architecture. Eliminate the microphone harness/connector from the final design once a specific onboard microphone is selected. Maintain GPIO5 SCK, GPIO6 WS and GPIO7 SD and support unpopulated microphone variants through the existing installed setting.

Reserve an acoustic/component area near the encoder, but do not freeze location or drill size yet. Exact microphone port orientation, PCB acoustic hole, panel aperture and any short acoustic seal/channel must be coordinated with the 4.5 mm panel-to-PCB spacing and selected package. A bottom-port microphone needs a PCB sound hole; placement side must ensure that hole leads toward the panel opening rather than being obstructed by the PCB or encoder. A top-port candidate would require a different mechanical path and verified electrical compatibility. Keep the port clear of adhesive, flux/cleaning contamination and clamping hardware; use the selected microphone's assembly guidance.

Consider mechanical noise from encoder turns/button presses and keep LED power-current returns/regulator noise away from the microphone area. Validate audio response in the closed base after assembly. A small guide/seal integrated into the spacer may be useful; dimensions must be based on the selected microphone and enclosure, not an arbitrary pinhole.

Schematic status: J3 in the current A0 draft still represents the SUPERSEDED daughterboard interface. It must be replaced by the selected microphone, local decoupling and channel-select circuitry before schematic release; do not fabricate/order from the A0 parts-review CSV. No microphone substitution or firmware change has been made.

Status: dimensioned study, not ready for manufacture. No PCB footprint, mount position, material or tolerance has been released.

## Files

- `insert-concept.scad`: editable parametric OpenSCAD model in millimetres. An open ring, two rails and four provisional PCB bosses. Reference enclosure and PCB use preview-only geometry and are excluded from exports. Optional encoder, inlet and microphone cradles are disabled until measured; enabled cradles require collision/attachment review and potentially support arms.
- `fit-template.svg`: US Letter page with physical dimensions, a 10 mm grid and a 50 mm scale check. Print at actual size with page fitting disabled. Check the scale before cutting or measuring. Open-underside view; orient the USB socket toward the arrow and use that convention for all coordinates.

## Known dimensions and assumptions

| Item | Dimension | Basis |
| --- | --- | --- |
| Base inside diameter | 99.06 mm | Owner reports 3.9 inches |
| Base depth | 25.4 mm | Owner reports 1 inch; actual free height must be checked |
| Encoder intrusion below top | Approximately 8 mm | Owner measurement; terminals/wires need additional allowance |
| Insert diameter | 97.06 mm | Proposed 1 mm radial clearance; not measured fit |
| Frame thickness | 2.4 mm | Provisional |
| PCB study rectangle | 45 × 35 × 1.6 mm | Placeholder, not an electrical-layout commitment |
| PCB hole spacing | 36 × 26 mm | Placeholder |
| Boss height above rails | 5 mm | Placeholder |
| Boss diameter / pilot | 7 / 2.5 mm | Fastener and printing process unselected |

The ring is not a validated retention mechanism. Select reversible fastening or a captured insert after measuring the rim; do not rely on the soft bottom sticker to hold electronics. Screw lengths must not contact the metal enclosure. Model Z=0 is an arbitrary insert underside; the installed height is unconfirmed. A nominal 17.4 mm below the encoder is not a component-height guarantee.

## Measurements for the next revision

Use the template or a straight-on underside photo with a ruler. Mark component body outlines as well as mounting-hole centres; these are different constraints.

1. Encoder XY position, body width/depth, panel-hole diameter, terminals, and wire exit.
2. USB mounting-hole diameter, panel thickness, inner body projection, and wire bend space. Retain the existing four-wire inlet as baseline.
3. Central stem/hardware footprint and intrusion, and any rim features usable for retention.
4. Sound-hole location and which surface it passes through. The microphone port must align with a clear path to the room, including clearance from the tabletop and bottom closure.

## Microphone and PCB coordination

Study a separate small microphone board connected by a short harness. This is a proposed mechanical architecture, not yet a selected PCB or connector. Preserve the existing I2S GPIOs and validate capture with the final harness. The acoustic aperture in the cradle is only meaningful once the microphone footprint, port offset and orientation are known. A PCB-mounted bottom-port microphone also needs the correct PCB sound hole. Do not cover the port with adhesive or put a fastening screw through its acoustic path.

Reserve antenna clearance before fixing PCB position or adding nearby bosses/metal fasteners. Controller board outline and mounting coordinates must be reconciled with schematic/layout work rather than copied blindly from the study rectangle.

## Export and review

OpenSCAD is not installed in the current workspace, so the model has not been rendered or mesh-validated here. Only SVG XML/physical page geometry has been checked. No STL or STEP is represented as production-ready.

Once dimensions and mounting are resolved, render/check the model and export an STL in millimetres for a pilot print. If the supplier needs STEP, create/export the corresponding solid CAD model; an SCAD source is not a STEP deliverable. Confirm the vendor's process/material/tolerance and quote from the actual files before ordering. Fit one printed insert with the PCB template and real hardware before committing to the 10–20-unit batch.

## Marked-template measurements — 2026-09-28

Owner supplied a marked underside template: USB inlet at the top perimeter; lamp stem centred; encoder hole below centre on approximately the same axis. Confirm the reprinted 50 mm calibration before deriving distances from the grid. The oblique photograph is not a dimensioned coordinate survey.

- Central mounting hole: approximately 10 mm diameter; both lamp stem and strip wires pass through it. Stem projects approximately 15 mm into the cavity from the top panel. The hole diameter is not the nut/washer or wire-bend envelope; measure these separately.
- Encoder panel hole: approximately 8.3 mm diameter. Previously reported body intrusion is approximately 8 mm. Hole diameter does not specify encoder body width or anti-rotation support. Centre-to-centre distance from the stem remains unconfirmed.
- USB inlet remains at the top perimeter in this view. Its exact internal envelope remains unmeasured.
- Nominal space below the stem end is 25.4−15 = 10.4 mm before bottom clearance, insert mounting, PCB and component allowances. The original centred PCB study has its top surface at 9 mm above the arbitrary insert underside, leaving only 1.4 mm to the nominal stem tip if that underside coincides with the cavity bottom. It is not a viable default for populated PCB placement. Hide the study PCB by default; its bosses remain provisional and must be relocated with the final board.

Prefer investigating an offset board or a board with a central clearance cutout rather than crowding the stem and wiring. Do not choose a cutout diameter from the 10 mm panel hole alone. The insert must clear the stem hardware and cable exit, and must not inadvertently become a structural lamp-stem support. Microphone-hole location is still open.

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

## Encoder purchase reference — 2026-09-28

Owner identifies [Amazon B07D3DF8TK](https://www.amazon.com/dp/B07D3DF8TK) as the existing encoder. The retrieved seller listing identifies DIYhz, EC11 with push switch, selected EC11-20mm variant, sold in a ten-pack. Treat this as a purchase reference, not an exact manufacturer drawing or proof of footprint equivalence to an Alps/Bourns part. The 20 mm variant label does not establish panel-to-PCB mounting distance.

Proceed with the proposed direct-to-PCB encoder plus central stem mounting study. Exact signal-pin and anchor-tab geometry, mounting shoulder-to-PCB seating distance, thread dimensions and contact mapping must be verified on a sample or a matching dimensioned drawing before footprint release. Existing approximate 8 mm body intrusion and proposed 8.3 mm panel hole remain owner measurements, not supplier specifications. Preserve GPIO1/2/3/4 connections from the working prototype and verify electrical terminal assignment by continuity rather than generic EC11 orientation.

Next verification artifact: a 1:1 encoder footprint print with signal holes and mechanical tab slots, checked against a spare physical encoder. Do not create manufacturing hole coordinates from the EC11 family name alone. Retain clearance-only body placement until those dimensions are available.

## Encoder caliper photographs — 2026-09-28

Two owner photographs show digital caliper readings of **13.05 mm** and **26.36 mm**. First is an underside/body-width view; the image is consistent with measuring across the encoder body region, but exact contact faces and inclusion of projecting metal features cannot be determined confidently. Second is an axial side view, apparently from the rear/body area to the shaft tip; exact rear contact surface is not unambiguous. Record these as photo reference spans, not toleranced manufacturer dimensions.

Neither reading establishes signal-pin pitch, mechanical-tab centres/slot sizes, or distance from the panel-bearing shoulder to the PCB seating plane. The 26.36 mm reading is not a spacer height. Do not infer an encoder footprint or subtract the listing's nominal 20 mm variant label to derive body height.

Next: measure panel-bearing shoulder to PCB seating surface (not pin tips) to set the centre-stem spacer stack; verify underside signal-hole and anchor-tab geometry with a closer square-on view/sample measurements before producing the footprint fit print. Existing approximately 8 mm body intrusion remains a separate owner observation.

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

## Shared-mount visual study

- `shared-mount-section.svg`: explanatory side section (not to scale), showing the confirmed seating distance and nominal 1.6 mm board stack.
- `shared-mount-study.scad` and identical `.txt`: new parametric assembly study, independent of the old ring insert. Includes provisional spacer, washer, nut, 65 mm circular board envelope and encoder location at 24 mm offset. These outline/location choices are placeholders, not released layout dimensions. Stem diameter 9.5 mm, board opening 11 mm, spacer OD 22 mm, washer OD 20 mm/thickness 1 mm and nut thickness 3 mm are all unmeasured study values.

This model is not an encoder footprint and does not yet model the hollow stem or wire exit. Whole-assembly STL export would combine reference components and must not be ordered as an insert. `part="spacer"` isolates a study spacer only; confirm actual dimensions and assembly loads before printing. OpenSCAD is unavailable locally, so rendering/mesh validity has not been checked. SVG XML parsing passed; no hardware fit is claimed.
