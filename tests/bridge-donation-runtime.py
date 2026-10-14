"""Bridge cache/sender contracts with the production pinned AES-GCM and SHA-256."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
# Reuse only the existing source-integrity checker, without running its suite.
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body if
         isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
         isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
             target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'pinned_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')
profile = ['-I' + str(source / 'include'), '-I' + str(source / 'library'), '-Itests', '-I.']
defines = ['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-') as folder:
    objects = []
    for name in scope['PRIMITIVES']:
        output = Path(folder) / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *profile, *defines,
                        '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], cwd=ROOT, check=True)
        objects.append(str(output))
    output = Path(folder) / 'bridge-donation.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                    *profile, *defines, 'tests/bridge-donation-runtime.cpp',
                    'bridge/BridgeArtifact.cpp', 'bridge/BridgeDonation.cpp',
                    'LampFirmwareRelayCrypto.cpp', *objects, '-o', str(output)], cwd=ROOT, check=True)
    subprocess.run([str(output)], cwd=ROOT, check=True)
