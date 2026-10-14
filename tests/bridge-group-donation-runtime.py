"""Actual bridge sender -> lamp relay/flash receiver -> production rollout gate.

SDK/radio/storage adapters remain host fixtures; this is not physical RF or
postboot acceptance. No copy of the grouped-update admission rule lives here.
"""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'tests/espnow-runtime.py').read_text())
nodes = [node for node in tree.body if
         isinstance(node, ast.FunctionDef) and node.name == 'verified_source' or
         isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
             target.id in ('SOURCE', 'ARCHIVE_SHA', 'PRIMITIVES') for target in node.targets)]
scope = dict(Path=Path, hashlib=hashlib, json=json, tarfile=tarfile)
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'pinned_source', 'exec'), scope)
source = scope['verified_source'](ROOT / '.build/tls-library')
ble_tree = ast.parse((ROOT / 'tests/ble-update-runtime.py').read_text())
sdk_scope = {}
exec(compile(ast.Module(body=[node for node in ble_tree.body if
    isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
        target.id in ('SDK', 'FORMAT') for target in node.targets)], type_ignores=[]),
    'sdk_adapters', 'exec'), sdk_scope)
arduino = (ROOT / 'tests/sync-stubs/Arduino.h').read_text().replace(
    '  using std::string::string;',
    '  using std::string::string;\n  bool startsWith(const char* s)const{return rfind(s,0)==0;}').replace(
    'inline uint32_t fakeNow=0;', 'using std::min;\ninline uint32_t fakeNow=40000;')
sdk = sdk_scope['SDK'] + '''
const esp_partition_t* esp_ota_get_running_partition();
int esp_partition_read(const esp_partition_t*,size_t,void*,size_t);
struct esp_app_desc_t;
int esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t*);
'''
image_format = sdk_scope['FORMAT'].replace(
    'uint8_t magic;uint8_t unused[11];', 'uint8_t magic,segment_count;uint8_t unused[10];').replace(
    'uint8_t tail[10];', 'uint8_t tail[9],hash_appended;').replace(
    'uint32_t address,length;', 'uint32_t address,data_len;')
with tempfile.TemporaryDirectory(prefix='coollamp-bridge-group-') as directory:
    directory = Path(directory)
    adapters = {
        'Arduino.h': arduino,
        'Preferences.h': (ROOT / 'tests/stubs/Preferences.h').read_text(),
        'nvs.h': (ROOT / 'tests/stubs/nvs.h').read_text().replace(
            'constexpr esp_err_t ESP_OK=0,', 'constexpr esp_err_t '),
        'esp_ota_ops.h': sdk,
        'esp_app_format.h': image_format,
        'esp_system.h': '#pragma once\n#include <stdint.h>\nuint32_t esp_random();\n',
        'esp_wifi.h': '#pragma once\n',
        'esp_mac.h': '#pragma once\n#include <stdint.h>\nconstexpr int ESP_MAC_WIFI_STA=0;\nint esp_read_mac(uint8_t*,int);\n',
    }
    for name, content in adapters.items():
        (directory / name).write_text(content)
    includes = ['-I' + str(directory), '-I' + str(ROOT), '-I' + str(ROOT / 'tests'),
                '-I' + str(source / 'include'), '-I' + str(source / 'library')]
    defines = ['-DARDUINO=1', '-DCOOL_LAMP_PUBLIC_RELEASE=1',
               '-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
    objects = []
    for name in scope['PRIMITIVES']:
        output = directory / (name + '.o')
        subprocess.run(['gcc', '-std=c11', *SANITIZERS, *includes, *defines,
                        '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], check=True)
        objects.append(str(output))
    binary = directory / 'bridge-group-donation.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                    *includes, *defines, str(ROOT / 'tests/bridge-group-donation-runtime.cpp'),
                    str(ROOT / 'bridge/BridgeArtifact.cpp'), str(ROOT / 'bridge/BridgeDonation.cpp'),
                    str(ROOT / 'LampFirmwareRelayCrypto.cpp'), str(ROOT / 'LampBleUpdate.cpp'),
                    *objects, '-o', str(binary)], check=True)
    scenarios = ['success', 'paused', 'coordinator', 'expanded-no-permit', 'active-rollout',
                 'storage-unavailable', 'auto-off', 'wrong-fleet', 'lost-data', 'lost-ack',
                 'lost-final-ack', 'duplicate-finish', 'corrupt', 'auto-disabled-midway',
                 'radio-lost', 'attempt-storage', 'boot-error-selected', 'rollover',
                 'receiver-reboot-midway', 'bridge-reboot-midway', 'second-receiver',
                 'offer-clock-skew', 'receive-clock-skew', 'receive-clock-skew-rollover',
                 'startup-gate', 'startup-after-rollover', 'long-uptime-offer', 'retry-zero-deadline']
    selected = sys.argv[1:]
    if any(scenario not in scenarios for scenario in selected):
        raise SystemExit('Unknown bridge-group donation scenario.')
    scenarios = selected or scenarios
    for scenario in scenarios:
        subprocess.run([str(binary), scenario], check=True)
    print(f'PASS: {len(scenarios)} actual bridge/lamp/rollout integration scenarios; '
          'group/settings bytes retained, real pinned AES-GCM/SHA-256; physical acceptance pending')
