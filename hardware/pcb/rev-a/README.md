# CoolLamp PCB revision A — first electrical review

## HW-040 encoder update — 2026-09-30

The selected encoder is now the owner's photographed HW-040 breakout, with onboard
R2/R3 marked 103 (10 kΩ); R1 appears unpopulated. Front header, pins downward:
**GND, +, SW, DT, CLK** left to right. The code-compatible mapping is GND→GND,
+→GPIO1, SW→GPIO2, DT→GPIO3, CLK→GPIO4. GPIOs and firmware remain unchanged.
GPIO1 is driven HIGH by the existing library; do not feed the breakout from 5 V.
Resistor trace routing and SW bias still need measurement. See [wiring documentation](../../../docs/wiring.md).

This supersedes the bare-encoder assumption. The earlier 4.5 mm seating-plane and
direct-soldered encoder mounting studies are historical; remeasure the breakout
outline, mounting holes, header clearance and panel-to-board stack before using
them for a PCB/insert. No breakout mounting footprint is released.



## Owner-selected onboard microphone — 2026-09-28

Owner prefers the microphone soldered to the MAIN PCB, potentially near the encoder, aligned with a small sound opening drilled in the metal lamp base. This supersedes the separate microphone daughterboard architecture. Eliminate the microphone harness/connector from the final design once a specific onboard microphone is selected. Maintain GPIO5 SCK, GPIO6 WS and GPIO7 SD and support unpopulated microphone variants through the existing installed setting.

Reserve an acoustic/component area near the encoder, but do not freeze location or drill size yet. Exact microphone port orientation, PCB acoustic hole, panel aperture and any short acoustic seal/channel must be coordinated with the 4.5 mm panel-to-PCB spacing and selected package. A bottom-port microphone needs a PCB sound hole; placement side must ensure that hole leads toward the panel opening rather than being obstructed by the PCB or encoder. A top-port candidate would require a different mechanical path and verified electrical compatibility. Keep the port clear of adhesive, flux/cleaning contamination and clamping hardware; use the selected microphone's assembly guidance.

Consider mechanical noise from encoder turns/button presses and keep LED power-current returns/regulator noise away from the microphone area. Validate audio response in the closed base after assembly. A small guide/seal integrated into the spacer may be useful; dimensions must be based on the selected microphone and enclosure, not an arbitrary pinhole.

Schematic status: J3 in the current A0 draft still represents the SUPERSEDED daughterboard interface. It must be replaced by the selected microphone, local decoupling and channel-select circuitry before schematic release; do not fabricate/order from the A0 parts-review CSV. No microphone substitution or firmware change has been made.

Open `CoolLamp-RevA.kicad_pro` in KiCad, then open its schematic. Created and checked with KiCad 10.0.6 on 2026-09-28. This is an editable electrical draft, **not a fabrication package**. No routed `.kicad_pcb`, Gerbers, or order-ready BOM are supplied.

## What is included

- Full 53-pad ESP32-C3-MINI-1 module symbol with physical pad numbering from Espressif. All ground pads connected; NC pads marked; unused GPIO10 deliberately unconnected. Exact 4 MB ordering code and land pattern are pending. Do not substitute the development-board footprint.
- Existing four-wire side USB inlet, USB series-resistor candidates, and native USB GPIO18/19 routing.
- Proposed fused 5 V distribution and AP2112K-3.3 regulator with input/output capacitance, module bypassing, EN RC, BOOT/RESET buttons and UART recovery access.
- Direct GPIO0 LED data as in the prototype; LED power bypasses the 3.3 V regulator. Connector ratings and LED data margins still need validation.
- Short five-signal interface for an optional INMP441 microphone daughterboard. This is not yet the capsule/daughterboard schematic. Local microphone decoupling and L/R configuration belong on that board; acoustic opening and sourcing remain open.
- HW-040 assembly interface, GND and GPIO1 reference connected; optional R6–R8 remain DNP. Physical mounting and switch bias unresolved.
- Project-local editable symbols, PDF/SVG exports, netlist, ERC report and a parts-review CSV.

Open `review/CoolLamp-RevA.pdf` for a view without KiCad. Named nets connect matching labels anywhere on this single sheet. The MCU is the bare castellated module, not the present C3 Mini development board.

## Pin compatibility

| Function | GPIO | MINI-1 pad |
| --- | --- | --- |
| LED data | 0 | 12 |
| Encoder reference assignment | 1 | 13 |
| Encoder switch | 2 | 5 |
| Encoder B | 3 | 6 |
| Encoder A | 4 | 18 |
| Microphone SCK | 5 | 19 |
| Microphone WS | 6 | 20 |
| Microphone SD | 7 | 21 |
| USB D− | 18 | 26 |
| USB D+ | 19 | 27 |

GPIO1 now connects to ENC1 `+` and TP1. ENC1 represents the whole HW-040 assembly;
its numbered interface is 1 GND, 2 +, 3 SW, 4 DT, 5 CLK, matching the front photo
with pins downward. These are interface identifiers pending a physical connector
footprint and mounting review; they are not bare encoder contact numbers.

## Encoder bias review

R2/R3 on the photographed breakout are 10 kΩ; R1 appears unpopulated. Their exact
routing remain unverified. Firmware 1.9.1 uses SW_FLOAT, selecting plain INPUT
for A/B and an internal INPUT_PULLUP for the GPIO2 button. Verify idle/pressed levels and button-held
GPIO2 boot behavior. R6–R8 remain DNP candidates, not installed prototype parts.
The former unresolved common/return nets are replaced by the labeled module GND
and + interface. GPIO assignments are unchanged; the firmware switch bias was
updated when adding the long-press factory reset.

## Required work before layout/release

1. Verify HW-040 switch bias and create a sample-verified header/mounting arrangement. Preserve GPIO assignments. Verify GPIO2 boot strapping with the button held.
2. Select exact module ordering code and qualified footprint, microphone source/daughterboard, connectors, switches and passive manufacturer part numbers. `parts-review.csv` is not a purchasing BOM.
3. Complete USB ESD protection and input protection/inrush design. The current fuse is a placeholder with no rating selected. Retain the owner's functioning inlet/supply baseline; verify data enumeration/flashing in both plug orientations. No CC wires are assumed.
4. Establish hardware current rating and startup/programming behaviour: 5 V / 2.4 A is the existing wall supply rating, not a guarantee for a computer USB port or every source. Firmware currently restores saved brightness/effect, so a guaranteed LED-off programming mode must not be claimed. The initial 500 mA LED software budget does not include every controller load and is not hardware input-current protection.
5. Review AP2112 input range, effective capacitance, transients and thermal loss: `(5−3.3) × I` watts. At 300 mA this is 0.51 W; at 600 mA it is 1.02 W. Its electrical current rating alone does not establish thermal suitability in the closed base. Change regulator/package if thermal analysis requires it.
6. Set board shape around the central stem and encoder mounting plane. Verify clamp insulation/load path, thread engagement, wire exit, antenna clearance, microphone opening and assembly access. Existing study shapes are not final PCB outlines.
7. Complete schematic review, ERC, PCB layout/DRC, assembly review and a small fit/function pilot before ordering the batch.

LED count remains a saved per-lamp setting (software range 1–1024, existing default 134; owner estimates 132 for the helix). Supported full-brightness load is a separate electrical limit.

## Verification and regeneration

KiCad parsed and exported the schematic to PDF, SVG and XML netlist. A rasterized PDF was visually inspected. A1 ERC has **0 errors and 0 warnings**; module GND and reference connections are now explicit. This is connectivity checking only, not circuit validation or approval for fabrication. No project ERC suppressions were added for this update.

`python3 tools/hardware/check-schematic-netlist.py` validates critical exported connections against firmware GPIO definitions and the module pad map. Re-export the netlist after editing before running it. It also checks module grounds/NCs and USB isolation through the series resistors.

`tools/hardware/create-schematic-draft.py` is the initial creation script. It refuses to overwrite an existing schematic. Edit the resulting project in KiCad; do not delete your edits to rerun the generator. After edits, regenerate the review exports and ERC report using KiCad. The project currently uses generic project-local symbols for several candidate parts; exact footprints must be assigned as sourcing and mechanics are resolved.

## Primary references

- [Espressif MINI-1 module datasheet and pad definitions](https://documentation.espressif.com/esp32-c3-mini-1_datasheet_en.html)
- [Espressif hardware schematic guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/schematic-checklist.html)
- [AP2112 datasheet](https://www.diodes.com/datasheet/download/AP2112.pdf)
- [INMP441 datasheet](https://invensense.tdk.com/wp-content/uploads/2015/02/INMP441.pdf)
- [Owner's encoder purchase reference](https://www.amazon.com/dp/B07D3DF8TK)
