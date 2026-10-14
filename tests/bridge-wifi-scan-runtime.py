from pathlib import Path
import json
import subprocess
from host_compiler import SANITIZERS

root = Path(__file__).resolve().parents[1]
output = root / '.build' / 'bridge-wifi-scan-runtime.exe'
subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                '-I', str(root / 'tests' / 'bridge-wifi-scan-stubs'),
                str(root / 'tests' / 'bridge-wifi-scan-runtime.cpp'), '-o', str(output)], check=True)
scenarios = ['normal', 'bounds', 'malformed', 'deadline', 'queued', 'cancel',
             'cancel-queued', 'cancel-completion-race', 'generation-rollover',
             'errors', 'overflow', 'serializer', 'no-event', 'stop-failure', 'registration']
for scenario in scenarios:
    result = subprocess.run([str(output), scenario], check=True, capture_output=True, text=True, encoding='utf-8')
    if result.stdout:
        value = json.loads(result.stdout)
        assert len(value['networks']) <= 20
        assert value['phase'] == 'ready'
        assert all(len(item['ssid'].encode('utf-8')) <= 32 for item in value['networks'])
print(f'Bridge asynchronous Wi-Fi scan: {len(scenarios)} production helper scenarios PASS')
