"""Standalone bridge control against real production AES-GCM and a two-hop lamp."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body
         if isinstance(node, ast.FunctionDef) and node.name == 'verified_source'
         or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
            and target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verified_source', 'exec'), scope)
scope['PRIMITIVES'] += ['base64']
source = scope['verified_source'](ROOT / '.build/tls-library')
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-control-', dir=ROOT / '.build') as temporary:
    folder = Path(temporary)
    (folder / 'bridge-mbedtls-config.h').write_text(
        '#pragma once\n#include "espnow-host-mbedtls-config.h"\n#define MBEDTLS_BASE64_C\n')
    includes = ['-I' + str(ROOT / 'tests/control-stubs'), '-I' + str(ROOT),
                '-I' + str(ROOT / 'tests'), '-I' + str(folder),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="bridge-mbedtls-config.h"']
    objects = []
    for name in scope['PRIMITIVES']:
        output = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines,
                        '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    binary = folder / 'bridge-control.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pthread',
                    *SANITIZERS, *includes, *defines,
                    str(ROOT / 'tests/bridge-control-runtime.cpp'),
                    str(ROOT / 'bridge/BridgeControl.cpp'), str(ROOT / 'LampMeshCore.cpp'),
                    str(ROOT / 'LampMeshCrypto.cpp'), str(ROOT / 'LampSyncRadioCrypto.cpp'),
                    *objects, '-o', str(binary)], check=True)
    scenarios = ['read-only-diagnostics', 'result-query-diagnostics', 'excluded-origin-request', 'excluded-reconciliation', 'missing-credential', 'wrong-fleet', 'queue-bound-stale', 'concurrent-copy',
                 'honest-inventory', 'forward-http400', 'pages-retention', 'retention-deadline',
                 'target-boot', 'lost-replies', 'blocked', 'local-descriptor',
                 'local-mutation-denied', 'peer-expiry', 'channel-hold-idle-expiry',
                 'channel-hold-block-reboot', 'channel-hold-rollover-work', 'channel-hold-no-false-peer']
    for scenario in scenarios:
        subprocess.run([str(binary), scenario], check=True)
    print(f'PASS: {len(scenarios)} standalone bridge scenarios; pinned production AES-GCM; no network')
