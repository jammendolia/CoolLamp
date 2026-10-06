#!/usr/bin/env python3
"""Create the first review schematic. Refuses to overwrite an edited schematic."""
from pathlib import Path
import json, uuid, csv
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'hardware/pcb/rev-a'
NAME = 'CoolLamp-RevA'
if (OUT / (NAME + '.kicad_sch')).exists():
    raise SystemExit('Schematic exists; edit it in KiCad. Generator will not overwrite it.')
OUT.mkdir(parents=True, exist_ok=True)
def uid(): return str(uuid.uuid4())
def q(s): return json.dumps(str(s), ensure_ascii=False)
root_id=uid(); defs={}; items=[]; bom=[]
def effects(size=1.0): return f'(effects (font (size {size} {size})))'
def note(x,y,t,size=1.2):
    items.append(f'(text {q(t)} (at {x} {y} 0) {effects(size)} (uuid {uid()}))')
def symbol(name, pins, width=25.4):
    # pins: (number, name, electrical type, side). Independently stacked columns.
    counts={side:sum(p[3]==side for p in pins) for side in ['L','R']}
    rows=max(counts.values()); h=(rows+1)*2.54; coords={}; body=[]
    indices={'L':0,'R':0}
    for num,label,typ,side in pins:
        i=indices[side];indices[side]+=1
        y=(counts[side]-1)*1.27-i*2.54; x=(-1 if side=='L' else 1)*(width/2+2.54)
        angle=0 if side=='L' else 180
        coords[str(num)]=(x,y)
        body.append(f'(pin {typ} line (at {x} {y} {angle}) (length 2.54) (name {q(label)} {effects(0.8)}) (number {q(num)} {effects(0.8)}))')
    lib=f'''(symbol "CoolLamp:{name}" (pin_names (offset 0.6)) (in_bom yes) (on_board yes)
(property "Reference" "U" (at 0 {h/2+2} 0) {effects()})
(property "Value" {q(name)} (at 0 {-h/2-2} 0) {effects()})
(symbol "{name}_0_1" (rectangle (start {-width/2} {h/2}) (end {width/2} {-h/2}) (stroke (width 0.254) (type default)) (fill (type background))))
(symbol "{name}_1_1" {' '.join(body)}))'''
    defs[name]=(lib,coords,h)

def place(name,ref,value,x,y,nets,foot='',status='Review',dnp=False,ds=''):
    x=round(round(x/1.27)*1.27,4); y=round(round(y/1.27)*1.27,4)
    lib,coords,h=defs[name]; instance=uid()
    props=''.join(f'(property {q(k)} {q(v)} (at {x} {py} 0) {effects(1.0)} {"(hide yes)" if hidden else ""})' for k,v,py,hidden in [('Reference',ref,y-h/2-3,False),('Value',value,y+h/2+3,False),('Footprint',foot,y,True),('Datasheet',ds,y,True),('Design status',status,y,True)])
    items.append(f'''(symbol (lib_id "CoolLamp:{name}") (at {x} {y} 0) (unit 1) (in_bom yes) (on_board yes) (dnp {'yes' if dnp else 'no'}) (uuid {instance}) {props}
(instances (project "{NAME}" (path "/{root_id}" (reference {q(ref)}) (unit 1)))))''')
    for pin,(dx,dy) in coords.items():
        px=round(x+dx,4);py=round(y-dy,4);net=nets.get(pin)
        if net is None:
            items.append(f'(no_connect (at {px} {py}) (uuid {uid()}))');continue
        ex=round(px+(-5.08 if dx<0 else 5.08),4)
        items.append(f'(wire (pts (xy {px} {py}) (xy {ex} {py})) (stroke (width 0) (type default)) (uuid {uid()}))')
        ang=0
        justify="right" if dx<0 else "left"
        items.append(f'(label {q(net)} (at {ex} {py} {ang}) (effects (font (size 0.9 0.9)) (justify {justify} bottom)) (uuid {uid()}))')
    bom.append([ref,value,foot,'DNP' if dnp else 'Candidate',status,ds])

# Full 53-pad module symbol; physical numbers from Espressif MINI-1 datasheet.
grounds={1,2,11,14,*range(36,54)}
ncs={4,7,9,10,15,17,24,25,28,29,32,33,34,35}
gpios={5:2,6:3,12:0,13:1,16:10,18:4,19:5,20:6,21:7,22:8,23:9,26:18,27:19,30:20,31:21}
pins=[]
for n in range(1,54):
    label='GND' if n in grounds else 'NC' if n in ncs else '3V3' if n==3 else 'EN' if n==8 else 'GPIO'+str(gpios[n])
    typ='power_in' if n in grounds or n==3 else 'no_connect' if n in ncs else 'input' if n==8 else 'bidirectional'
    pins.append((str(n),label,typ,'L' if n<=27 else 'R'))
symbol('ESP32_C3_MINI_1',pins,30.48)
symbol('AP2112K_3V3',[('1','VIN','power_in','L'),('3','EN','input','L'),('2','GND','power_in','L'),('5','VOUT','power_out','R'),('4','NC','no_connect','R')])
for name,labels in [('USB_Harness',['VBUS','D-','D+','GND']),('LED_Harness',['5V','DIN','GND']),('MIC_Harness',['3V3','GND','SCK','WS','SD']),('Encoder_HW040',['GND','+','SW','DT','CLK']),('Debug',['GPIO20_RX','GPIO21_TX','GND']),('BootSwitch',['1','2']),('R',['1','2']),('C',['1','2']),('Fuse',['1','2']),('TestPoint',['1'])]:
    symbol(name,[(str(i+1),label,'passive','L' if i<len(labels)/2 else 'R') for i,label in enumerate(labels)],7.62 if len(labels)<=2 else 20.32)

# Conventional passive graphics; keep the same endpoints for net connectivity.
for name in ['R','C','Fuse','BootSwitch']:
    lib,coords,h=defs[name]
    start=lib.index(f'(symbol "{name}_0_1"')
    end=lib.index(f'(symbol "{name}_1_1"')
    def line(points):
        return '(polyline (pts '+ ' '.join(f'(xy {a} {b})' for a,b in points) +') (stroke (width 0.254) (type default)) (fill (type none)))'
    if name=='C':
        graphic=''.join(line(pts) for pts in [[(-3.81,0),(-0.8,0)],[(-0.8,-2.54),(-0.8,2.54)],[(0.8,-2.54),(0.8,2.54)],[(0.8,0),(3.81,0)]])
    elif name=='BootSwitch':
        graphic=line([(-3.81,0),(-2.54,0),(2.54,1.8)])+line([(2.54,0),(3.81,0)])
    else:
        graphic='(rectangle (start -3.81 1.27) (end 3.81 -1.27) (stroke (width 0.254) (type default)) (fill (type none)))'
        if name=='Fuse': graphic+=line([(-3.81,0),(3.81,0)])
    lib=lib[:start]+f'(symbol "{name}_0_1" {graphic})\n'+lib[end:]
    lib=lib.replace('(pin_names (offset 0.6))','(pin_names (offset 0.6) hide) (pin_numbers hide)')
    defs[name]=(lib,coords,h)
symbol('PWR_FLAG',[('1','PWR','power_out','L')],2.54)
place('PWR_FLAG','#FLG01','External 5V',112,112,{'1':'+5V_SYS'},status='External input through F1; power-source ERC declaration')
place('PWR_FLAG','#FLG02','Supply return',112,136,{'1':'GND'},status='External supply ground ERC declaration')
note(210,13,'COOLLAMP REV A — ELECTRICAL REVIEW DRAFT',2)
note(210,20,'NOT FOR FABRICATION — encoder bias review, protection, sourcing and footprints',1.2)
note(68,30,'1. POWER INPUT / 3V3 SUPPLY',1.5)
place('USB_Harness','J1','Existing panel USB-C',48,49,{'1':'VBUS_IN','2':'USB_DM_PORT','3':'USB_DP_PORT','4':'GND'},status='Harness pin order proposed; verify actual sample')
place('Fuse','F1','Fuse: rating TBD',112,46,{'1':'VBUS_IN','2':'+5V_SYS'},status='Select time/current curve, voltage drop and footprint')
place('AP2112K_3V3','U2','AP2112K-3.3 candidate',63,85,{'1':'+5V_SYS','2':'GND','3':'+5V_SYS','5':'+3V3'},'Package_TO_SOT_SMD:SOT-23-5',status='Thermal and transient review required',ds='https://www.diodes.com/datasheet/download/AP2112.pdf')
for ref,x,y,net,val in [('C1',32,115,'+5V_SYS','1uF'),('C2',85,115,'+3V3','1uF'),('C3',32,139,'+3V3','10uF'),('C4',85,139,'+3V3','100nF')]:
    place('C',ref,val,x,y,{'1':net,'2':'GND'},'Capacitor_SMD:C_0805_2012Metric',status='X7R; select voltage rating / DC-bias derating')
note(69,160,'5V / 2.4A adapter reference; LEDs share input.\nAP2112 loss = (5V-3.3V) x controller current.\nProtection/inrush and computer power budget NOT resolved.',1.0)

note(213,30,'2. CONTROLLER — FIXED GPIO MAPPING',1.5)
net_gpio={0:'LED_DATA_3V3',1:'ENC_REF_GPIO1',2:'ENC_SW',3:'ENC_B',4:'ENC_A',5:'MIC_SCK',6:'MIC_WS',7:'MIC_SD',8:'BOOT_STRAP8',9:'BOOT_N',18:'USB_DM_CHIP',19:'USB_DP_CHIP',20:'UART_RX',21:'UART_TX'}
nets={str(n):'GND' for n in grounds};nets.update({'3':'+3V3','8':'CHIP_EN'});nets.update({str(p):net_gpio[g] for p,g in gpios.items() if g in net_gpio})
place('ESP32_C3_MINI_1','U1','ESP32-C3-MINI-1 (4MB TBD)',213,83,nets,status='Exact ordering code and land pattern pending',ds='https://documentation.espressif.com/esp32-c3-mini-1_datasheet_en.html')
for ref,x,y,a,b,val in [('R1',163,141,'+3V3','CHIP_EN','10k'),('R2',213,141,'+3V3','BOOT_N','10k'),('R3',263,141,'+3V3','BOOT_STRAP8','10k')]:
    place('R',ref,val,x,y,{'1':a,'2':b},'Resistor_SMD:R_0805_2012Metric')
place('C','C5','1uF',163,166,{'1':'CHIP_EN','2':'GND'},'Capacitor_SMD:C_0805_2012Metric')
place('BootSwitch','SW1','RESET',213,166,{'1':'CHIP_EN','2':'GND'},status='Momentary button footprint TBD')
place('BootSwitch','SW2','BOOT',263,166,{'1':'BOOT_N','2':'GND'},status='Momentary button footprint TBD')
place('Debug','J4','UART recovery',213,197,{'1':'UART_RX','2':'UART_TX','3':'GND'},status='Optional programming/test header')

note(347,30,'3. USB / LED / MICROPHONE',1.5)
place('R','R4','22R candidate',347,46,{'1':'USB_DM_PORT','2':'USB_DM_CHIP'},'Resistor_SMD:R_0805_2012Metric')
place('R','R5','22R candidate',347,70,{'1':'USB_DP_PORT','2':'USB_DP_CHIP'},'Resistor_SMD:R_0805_2012Metric')
note(347,89,'USB ESD network still to select.\nNo CC wires at existing inlet.',1.0)
place('LED_Harness','J2','WS2812B strip',347,111,{'1':'+5V_SYS','2':'LED_DATA_3V3','3':'GND'},status='Current-rated connector TBD; direct 3.3V data prototype baseline')
place('MIC_Harness','J3','INMP441 daughterboard',347,151,{'1':'+3V3','2':'GND','3':'MIC_SCK','4':'MIC_WS','5':'MIC_SD'},status='Proposed pin order; short harness; daughterboard pending')
note(347,176,'Mic board: 3.3V, local decoupling, L/R=GND.\nAcoustic port and mic sourcing require review.\nNo level shifter added to prototype LED path.',1.0)

note(80,190,'4. HW-040 ENCODER BREAKOUT',1.5)
place('Encoder_HW040','ENC1','HW-040 breakout',64,213,{'1':'GND','2':'ENC_REF_GPIO1','3':'ENC_SW','4':'ENC_B','5':'ENC_A'},status='Front header order GND,+,SW,DT,CLK; footprint and bias verification pending')
place('TestPoint','TP1','GPIO1 reference',146,213,{'1':'ENC_REF_GPIO1'},status='GPIO1 drives breakout + HIGH at begin; not a 5V supply')
for ref,x,net in [('R6',30,'ENC_A'),('R7',85,'ENC_B'),('R8',140,'ENC_SW')]:
    place('R',ref,'10k OPTIONAL',x,247,{'1':'+3V3','2':net},'Resistor_SMD:R_0805_2012Metric',status='DNP until encoder bias / GPIO2 strap verified',dnp=True)
note(88,268,'HW-040: R2/R3 10k fitted; R1 appears unpopulated.\nGPIO1 feeds +; CLK=GPIO4, DT=GPIO3, SW=GPIO2.\nVerify resistor routing / SW bias. R6-R8 remain DNP.',1.0)
note(291,234,'RELEASE BLOCKERS\nHW-040 header footprint, SW bias and GPIO2 boot behaviour\nExact module footprint / antenna placement and mic sourcing\nUSB ESD, input protection, inrush, current limits and thermals\nLED data margins; connector ratings; schematic/PCB review',1.15)
note(325,198,'LED count remains configurable (1–1024 software range).\nApprox. 132 LEDs expected for helix; current limit is separate.\nMechanical: breakout mounting stack must be remeasured.',1.0)

sch=f'''(kicad_sch (version 20250114) (generator "eeschema") (uuid {root_id}) (paper "A3")
(title_block (title "CoolLamp Rev A — review schematic") (date "2026-09-30") (rev "A1-DRAFT") (comment 1 "NOT FOR FABRICATION"))
(lib_symbols {' '.join(d[0] for d in defs.values())})
{' '.join(items)}
(sheet_instances (path "/" (page "1"))) (embedded_fonts no))'''
(OUT/(NAME+'.kicad_sch')).write_text(sch)
(OUT/(NAME+'.kicad_pro')).write_text(json.dumps({'meta':{'filename':NAME+'.kicad_pro','version':1}},indent=2)+'\n')
# Local symbol library supports editing without global library-table dependencies.
(OUT/'CoolLamp.kicad_sym').write_text('(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")\n'+'\n'.join(d[0].replace('"CoolLamp:', '"',1) for d in defs.values())+'\n)')
(OUT/'sym-lib-table').write_text('(sym_lib_table (version 7) (lib (name "CoolLamp") (type "KiCad") (uri "${KIPRJMOD}/CoolLamp.kicad_sym") (options "") (descr "Project-local draft symbols")))\n')
with (OUT/'review/parts-review.csv').open('w') as f:
    w=csv.writer(f);w.writerow(['Reference','Value','Footprint','Populate','Review status','Datasheet']);w.writerows(row for row in bom if not row[0].startswith("#"))
print(f'Created {len(bom)} review components in {OUT}')
