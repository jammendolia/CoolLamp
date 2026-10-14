from pathlib import Path
import subprocess
from host_compiler import SANITIZERS
root=Path(__file__).resolve().parents[1]
output=root/'.build'/'bridge-usb-protocol-test.exe'
subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,str(root/'tests'/'bridge-usb-protocol.cpp'),'-o',str(output)],check=True)
subprocess.run([str(output)],check=True)
print('Bridge USB bounded parsing and secret erasure: PASS')
