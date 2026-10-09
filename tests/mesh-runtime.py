"""Transport-independent production mesh with real, pinned AES-GCM/HMAC."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
# Reuse the SHA-verified production source finder without executing the radio
# runner's command-line entry point or downloading any library.
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body
         if isinstance(node, ast.FunctionDef) and node.name == 'verified_source'
         or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
            and target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'verified_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')
with tempfile.TemporaryDirectory(prefix='coollamp-mesh-', dir=ROOT / '.build') as temporary:
    folder = Path(temporary)
    includes = ['-I' + str(ROOT), '-I' + str(ROOT / 'tests'),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
    objects = []
    for name in scope['PRIMITIVES']:
        output = folder / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines,
                        '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    binary = folder / 'mesh.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    *SANITIZERS, *includes, *defines,
                    str(ROOT / 'tests/mesh-runtime.cpp'), str(ROOT / 'LampMeshCrypto.cpp'),
                    str(ROOT / 'LampMeshCore.cpp'), *objects, '-o', str(binary)], check=True)
    scenarios = ['crypto', 'chain', 'lost-ack', 'lost-fragment', 'reorder-duplicate',
                 'sequential', 'deadline-replay', 'boot-rollover', 'wrong-fleet',
                 'wrong-target-trust', 'peer-expiry', 'ttl', 'pause', 'capacity',
                 'send-backpressure', 'nonce-restart', 'malformed-noop',
                 'target-deadline-before-service', 'changed-request-id']
    for scenario in scenarios:
        subprocess.run([str(binary), scenario], check=True)
    print(f'PASS: {len(scenarios)} production mesh scenarios; real pinned AES-GCM/HMAC; no network access')
