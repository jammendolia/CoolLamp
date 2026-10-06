# Wiring image generation record

Created with the built-in image generation tool from the supplied ESP32-C3 and INMP441 photographs. Device imagery is AI-rendered from those references. Pin labels and connection table were visually reviewed against the proposed mapping. This is a proposal, not a tested assembly.

## Initial prompt

Use case: infographic-diagram. Create a high-resolution landscape photographic wiring guide for CoolLamp using the attached actual device photos, preserving the distinctive devices, not generic replacement modules. Clean white background, excellent readable typography, ample space, tidy thin color-coded wires with unambiguous endpoint dots.
Inputs: image1 actual black ESP32-C3 SuperMini board front with USB-C top; image2 actual round black INMP441 breakout labeled solder face; image3 reverse view for identification only.
Title: "CoolLamp • INMP441 wiring"
Subtitle: "Proposed audio connections — existing GPIO0–4 wiring stays unchanged"
Place enlarged ESP32 board on left, USB at top. Show round microphone labeled face on right, rotate photo so labels readable: GND,VDD,SD row on top left-to-right and L/R,WS,SCK row on bottom left-to-right (equivalently preserve photo original orientation if clearer and attach by labels). Do not mirror or invent the six terminals. Preserve photographic component detail.
ESP32 physical front-view terminal layout with USB up: left edge top-to-bottom GPIO5,GPIO6,GPIO7,GPIO8,GPIO9,GPIO10,GPIO20,GPIO21. Right edge top-to-bottom 5V,GND,3V3,GPIO4,GPIO3,GPIO2,GPIO1,GPIO0. External callout labels must be readable. Only connect new audio wiring to 5,6,7,3V3,GND. Mark unused5V "Do not use for microphone". No wire from5V.
Exact connections (six mic terminals, five ESP terminals): red from ESP3V3 to micVDD; black ESP GND to micGND with a clearly dotted branch to mic L/R; orange ESPGPIO5 to micSCK; blue ESPGPIO6 to micWS; green ESPGPIO7 to micSD. Every wire must terminate at correct actual pad, never board body or adjacent pin. Avoid crossings where possible; crossing wires without dot are not junctions. Include wire labels giving both endpoints.
Along bottom include compact authoritative table:
"ESP32-C3 → INMP441"
"3V3 → VDD | GND → GND and L/R"
"GPIO5 → SCK | GPIO6 → WS | GPIO7 → SD"
And separate small gray note:
"Existing connections: GPIO0 LED DIN • GPIO4 encoder A • GPIO3 encoder B • GPIO2 encoder SW • GPIO1 encoder reference (unchanged)"
Do not invent encoder physical wiring or extra resistors. Do not show encoder or strip devices; this guide focuses on the microphone addition while listing existing assignments.
Footer: "3.3 V only • L/R to GND selects left channel • Match printed pin labels before wiring"
Small status line: "Wiring proposal; audio firmware not yet implemented."
This is a precise engineering diagram: prioritize accurate pad connections over decorative wiring. Do not connect mic to GPIO0–4 or5V.

## Final correction prompt

Correct this wiring guide. Preserve the two photographed devices, all titles, footer, and both correct tables. REMOVE ALL LONG COLORED WIRES between boards, all colored dots and stray wire endpoints from previous draft. Replace them with short labeled leaders that attach directly to the actual solder pads; matching labels show connections without ambiguous crossing lines.
ESP32 left edge top three actual gold holes: top GPIO5 ORANGE short line to label "GPIO5 → SCK"; next GPIO6 BLUE short line to label "GPIO6 → WS"; next GPIO7 GREEN short line to label "GPIO7 ← SD". ESP32 right edge top hole5V leave unwired with "5V — not used"; second hole black short line "GND → GND + L/R"; third hole red short line "3V3 → VDD". The unused other ESP pin labels stay neutral.
Microphone as currently pictured has TOP row pads LEFT GND, CENTER VDD, RIGHT SD. Bottom row pads LEFT L/R, CENTER WS, RIGHT SCK. Add clearly separated short individual leaders AT THESE SIX PADS, each with its exact destination text:
top-left GND black label "GND → ESP GND"
top-center VDD red label "VDD → ESP 3V3"
top-right SD green label "SD → GPIO7"
bottom-left L/R black label "L/R → ESP GND"
bottom-center WS blue label "WS → GPIO6"
bottom-right SCK orange label "SCK → GPIO5".
Use generous space around microphone by resizing if necessary. No leader ends on board edge; each at corresponding round solder joint. No electrical connection between any differently named pins. Show only these short leaders, NO continuous wires between devices. Make the device labels fully readable. Leave existing correct bottom mapping tables unchanged. This is a pin-by-pin connection guide.

