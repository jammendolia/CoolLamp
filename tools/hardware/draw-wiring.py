#!/usr/bin/env python3
"""Deterministic prototype connection drawings; KiCad is the editable PCB schematic."""
from pathlib import Path
from html import escape
ROOT=Path(__file__).resolve().parents[2]
for wiring in [False,True]:
 parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1240" viewBox="0 0 1400 1240" role="img" aria-labelledby="title desc">', '<title id="title">CoolLamp — HW-040 '+('wiring diagram' if wiring else 'connection schematic')+'</title><desc id="desc">Fixed GPIO assignments with photographed HW-040 breakout and INMP441 microphone. Onboard resistor routing and switch bias require verification.</desc>', '<style>text{font-family:Arial,Helvetica,sans-serif;fill:#172b40;font-size:19px}.small{font-size:17px;fill:#526579}.head{font-size:23px;font-weight:bold}.title{font-size:34px;font-weight:bold}</style><rect width="1400" height="1240" fill="white"/>']
 def text(x,y,s,cls='',color=None):parts.append(f'<text x="{x}" y="{y}" class="{cls}"'+(f' style="fill:{color}"' if color else '')+'>'+escape(s)+'</text>')
 def box(x,y,w,h):parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#f5f8fb" stroke="#b8c7d4" stroke-width="2"/>')
 def line(points,color):parts.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="3"/>')
 text(45,55,'CoolLamp / '+('wiring diagram' if wiring else 'connection schematic'),'title')
 text(45,92,'HW-040 breakout • ESP32-C3 SuperMini • INMP441 • GPIO assignments unchanged','small')
 box(45,140,385,885);text(65,180,'ESP32-C3 SuperMini','head')
 box(800,140,550,220);text(825,180,'WS2812B strip','head')
 box(800,395,550,310);text(825,434,'HW-040 encoder breakout','head')
 box(800,740,550,285);text(825,780,'INMP441 microphone','head')
 rows=[(230,'5V / supply +5V','5V','+5V','#bd303a'),(275,'GPIO0','DIN','LED_DATA','#108467'),(320,'GND','GND','GND','#354250'),
 (478,'GPIO4 / encoder A','CLK  (header 5)','ENC_A','#2869ba'),(521,'GPIO3 / encoder B','DT  (header 4)','ENC_B','#8340aa'),(564,'GPIO2 / button','SW  (header 3)','ENC_SW','#ab650e'),(607,'GPIO1 / reference HIGH','+  (header 2)','ENC_REF','#bd303a'),(650,'GND','GND  (header 1)','GND','#354250'),
 (821,'3V3','VDD','+3V3','#bd303a'),(855,'GND','GND','GND','#354250'),(889,'GND','L/R (left channel)','GND','#354250'),(923,'GPIO5','SCK','MIC_SCK','#bc680c'),(957,'GPIO6','WS','MIC_WS','#2869ba'),(991,'GPIO7','SD','MIC_SD','#108467')]
 for y,left,right,net,color in rows:
  text(65,y+6,left);text(825,y+6,right)
  if wiring:line(f'430,{y} 800,{y}',color);text(500,y-8,net,'small',color)
  else:
   line(f'430,{y} 458,{y}',color);text(469,y+6,net,'small',color)
   line(f'765,{y} 800,{y}',color);text(622,y+6,net,'small',color)
 text(45,1060,'Encoder front view, shaft toward you and header pointing down: GND, +, SW, DT, CLK (left → right).','small')
 text(45,1090,'R2/R3: 10 kΩ resistors visible onboard. R1 appears unpopulated; SW pull-up and resistor routing unverified.','small')
 text(45,1120,'GPIO1 supplies only the encoder reference at 3.3 V logic. Never connect encoder + or microphone VDD to 5 V.','small')
 text(45,1150,'No added discrete resistors or LED level shifter shown. Power: shared regulated 5 V input and common ground.','small')
 text(45,1180,'Code-compatible wiring proposal; compare CLK/DT direction with prototype. Module internals are not traced here.','small')
 text(45,1215,'2026-09-30 • docs/wiring.md • KiCad PCB review schematic: hardware/pcb/rev-a/CoolLamp-RevA.kicad_sch','small')
 parts.append('</svg>')
 (ROOT/'docs/hardware'/('coollamp-wiring.svg' if wiring else 'coollamp-schematic.svg')).write_text('\n'.join(parts)+'\n')
