"""Physical commissioning state machines, SHA-verified real P256/HKDF/AES-GCM."""
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
# The verifier checks actual bytes for every additional C source against the
# pinned archive, including its private headers. This never downloads code.
scope['PRIMITIVES'] += ['bignum','bignum_core','bignum_mod','bignum_mod_raw',
                       'ecp','ecp_curves','ecp_curves_new','ecdh','hkdf']
source=scope['verified_source'](ROOT/'.build/tls-library')
with tempfile.TemporaryDirectory(prefix='coollamp-commission-',dir=ROOT/'.build') as temporary:
    folder=Path(temporary)
    (folder/'esp_mac.h').write_text('#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n')
    (folder/'esp_system.h').write_text('#pragma once\n')
    (folder/'esp_random.h').write_text('#pragma once\n#include <stdint.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\nuint32_t esp_random(void);\n#ifdef __cplusplus\n}\n#endif\n')
    includes=['-I'+str(folder),'-I'+str(ROOT),'-I'+str(ROOT/'tests/control-stubs'),
              '-I'+str(ROOT/'tests'),'-I'+str(source/'include'),'-I'+str(source/'library')]
    defines=['-DMBEDTLS_CONFIG_FILE="commission-host-mbedtls-config.h"']
    objects=[]
    for name in scope['PRIMITIVES']:
        output=folder/(name+'.o')
        subprocess.run(['gcc','-std=c11',*SANITIZERS,*includes,*defines,'-c',str(source/'library'/(name+'.c')),'-o',str(output)],check=True)
        objects.append(str(output))
    binary=folder/'commission.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',*SANITIZERS,*includes,*defines,
                    str(ROOT/'tests/commission-runtime.cpp'),str(ROOT/'LampCommissionCrypto.cpp'),*objects,'-o',str(binary)],check=True)
    scenarios=['crypto','success','no-app-approval','wrong-pattern','wrong-target-session',
               'cancel','expiry','no-overwrite','nvs-failure','lost-finish','lost-finish-proof',
               'replayed-offer','approval-preserves-state','blocked','backpressure','fresh-only',
               'commitment-hidden','wrong-target-reveal','wrong-broker-reveal',
               'lost-broker-reveal','commit-before-physical']
    for scenario in scenarios:subprocess.run([str(binary),scenario],check=True)
    print(f'PASS: {len(scenarios)} commissioning scenarios; actual verified P256/HKDF/AES-GCM; no network')
