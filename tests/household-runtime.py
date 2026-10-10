"""Real household authorization/storage handlers and verified pinned HMAC/SHA."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS
ROOT=Path(__file__).resolve().parents[1]
tree=ast.parse((ROOT/'tests/espnow-runtime.py').read_text())
nodes=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='verified_source' or isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id in ('SOURCE','ARCHIVE_SHA','PRIMITIVES') for target in node.targets)]
scope=dict(Path=Path,hashlib=hashlib,json=json,tarfile=tarfile)
exec(compile(ast.Module(body=nodes,type_ignores=[]),'verified_source','exec'),scope)
source=scope['verified_source'](ROOT/'.build/tls-library')
reset=ast.parse((ROOT/'tests/factory-reset-runtime.py').read_text())
preferences=next(ast.literal_eval(node.value) for node in reset.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='PREFERENCES' for target in node.targets))
preferences=preferences.replace('inline static bool failWrites=false;','inline static bool failWrites=false,failRead=false;').replace('size_t getBytes(const char* key,void* out,size_t n){','size_t getBytes(const char* key,void* out,size_t n){if(failRead)return 0;')
with tempfile.TemporaryDirectory(prefix='coollamp-household-',dir=ROOT/'.build') as temporary:
    folder=Path(temporary)
    (folder/'Preferences.h').write_text('#pragma once\n#include "Arduino.h"\n'+preferences)
    (folder/'esp_mac.h').write_text('#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n')
    (folder/'esp_random.h').write_text('#pragma once\n#include <stdint.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nuint32_t esp_random(void);\n#ifdef __cplusplus\n}\n#endif\n')
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests/control-stubs'),'-I'+str(ROOT/'tests'),'-I'+str(source/'include'),'-I'+str(source/'library')]
    defines=['-DMBEDTLS_CONFIG_FILE="commission-host-mbedtls-config.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        output=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/(name+'.c')),'-o',str(output)],check=True)
        objects.append(str(output))
    binary=folder/'household.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*defines,str(ROOT/'tests/household-runtime.cpp'),str(ROOT/'LampHousehold.cpp'),*objects,'-o',str(binary)],check=True)
    scenarios=['proof-vector','adopt','auth-binding','revoke','expired','rollover','reboot-pending','capacity','storage-failures','readback-failure','invite-interruption','interruption','malformed','reset']
    for scenario in scenarios:subprocess.run([str(binary),scenario],check=True)
    print(f'PASS: {len(scenarios)} real household HMAC/storage/authorization scenarios; physical/native acceptance pending')
