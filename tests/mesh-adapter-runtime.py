"""Actual HTTP mesh adapter on three radios, with actual pinned AES-GCM."""
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
scope['PRIMITIVES'] += ['base64']
source=scope['verified_source'](ROOT/'.build/tls-library')
with tempfile.TemporaryDirectory(prefix='coollamp-mesh-adapter-',dir=ROOT/'.build') as temporary:
    folder=Path(temporary)
    (folder/'esp_mac.h').write_text('#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n')
    (folder/'esp_system.h').write_text('#pragma once\n')
    (folder/'esp_random.h').write_text('#pragma once\n#include <stdint.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nuint32_t esp_random(void);\n#ifdef __cplusplus\n}\n#endif\n')
    (folder/'WiFi.h').write_text('#pragma once\nconstexpr int WL_CONNECTED=3;\ninline struct {int state=WL_CONNECTED;int status(){return state;}} WiFi;\n')
    arduino=(ROOT/'tests/control-stubs/Arduino.h').read_text().replace('#include <cstdint>','#include <cstdint>\n#include <algorithm>\nusing std::min;')
    (folder/'Arduino.h').write_text(arduino)
    (folder/'adapter-mbedtls-config.h').write_text('#pragma once\n#include "espnow-host-mbedtls-config.h"\n#define MBEDTLS_BASE64_C\n')
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests'),
              '-I'+str(source/'include'),'-I'+str(source/'library')]
    defines=['-DMBEDTLS_CONFIG_FILE="adapter-mbedtls-config.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        output=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/(name+'.c')),'-o',str(output)],check=True)
        objects.append(str(output))
    binary=folder/'adapter.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',
                    '-Wno-misleading-indentation','-Wno-parentheses',*SANITIZERS,*includes,*defines,
                    str(ROOT/'tests/mesh-adapter-runtime.cpp'),str(ROOT/'LampMeshCore.cpp'),
                    str(ROOT/'LampMeshCrypto.cpp'),str(ROOT/'LampSyncRadioCrypto.cpp'),*objects,'-o',str(binary)],check=True)
    scenarios=['http400','pagination','retention','no-route','same-id-content',
               'wrong-result','lost-receipts','updater-pause','direct-only','remote-direct-only',
               'idle-auth-hold']
    for scenario in scenarios:subprocess.run([str(binary),scenario],check=True)
    print(f'PASS: {len(scenarios)} actual mesh adapter scenarios; SHA-verified AES-GCM/HMAC/base64; no network')
