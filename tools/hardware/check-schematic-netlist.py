#!/usr/bin/env python3
"""Audit exported hardware nets against the current firmware pin assignments."""
import re
from pathlib import Path
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
p=ROOT/'hardware/pcb/rev-a/review/CoolLamp-RevA.net.xml'
r=ET.parse(p).getroot()
nets={n.get('name').lstrip('/'):{(p.get('ref'),p.get('pin')) for p in n.findall('node')} for n in r.findall('./nets/net')}
fw=(ROOT/'CoolLamp.ino').read_text();audio=(ROOT/'LampAudio.h').read_text()
pad={0:'12',1:'13',2:'5',3:'6',4:'18',5:'19',6:'20',7:'21',18:'26',19:'27'}
checks=[('DATA_PIN','LED_DATA_3V3',('J2','2')),('DO_ENCODER_VCC','ENC_REF_GPIO1',('ENC1','2')),('DI_ENCODER_SW','ENC_SW',('ENC1','3')),('DI_ENCODER_B','ENC_B',('ENC1','4')),('DI_ENCODER_A','ENC_A',('ENC1','5')),('LAMP_AUDIO_SCK','MIC_SCK',('J3','3')),('LAMP_AUDIO_WS','MIC_WS',('J3','4')),('LAMP_AUDIO_SD','MIC_SD',('J3','5'))]
for const,net,endpoint in checks:
    m=re.search(r'\b'+const+r'\s*(?:=\s*)?(\d+)', fw+'\n'+audio)
    assert m, f'Missing firmware definition: {const}'
    gpio=int(m[1]);assert {('U1',pad[gpio]),endpoint}<=nets[net], (const,net)
for p in {1,2,11,14,*range(36,54)}: assert ('U1',str(p)) in nets['GND'],f'Ground pad {p}'
for p in {4,7,9,10,15,17,24,25,28,29,32,33,34,35}:
    for name,pins in nets.items():
        if ('U1',str(p)) in pins:
            assert name.startswith('unconnected-') and pins=={('U1',str(p))},f'NC pad connected: {p}'
for side,resistor,pin,portpin in [('DM','R4','26','2'),('DP','R5','27','3')]:
    a=nets['USB_'+side+'_PORT'];b=nets['USB_'+side+'_CHIP']
    assert {(resistor,'1'),('J1',portpin)}<=a
    assert {(resistor,'2'),('U1',pin)}<=b
    assert not a&b
assert ('ENC1','1') in nets['GND']
assert ('TP1','1') in nets['ENC_REF_GPIO1']
assert not {'ENC_COMMON_TBD','ENC_SW_RETURN_TBD'} & nets.keys()
print('PASS: 8 firmware GPIOs, USB D+/D−, all module grounds/NCs and HW-040 header mapping.')
