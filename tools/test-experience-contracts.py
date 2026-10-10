"""Host-only contract gate. Requires the pinned TLS cache and gcc/g++/node.

No device, USB, router, credential, release or network operation is invoked.
Windows: dot-source tools/windows-env.ps1 first. Linux: build firmware first.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ['node', '--test', 'tests/publisher-trust.test.cjs'],
    *[[sys.executable, 'tests/' + name + '.py'] for name in [
        'experience-runtime', 'household-runtime', 'household-adapter-runtime',
        'commission-runtime', 'mesh-runtime', 'mesh-adapter-runtime',
        'control-http-adapter', 'factory-reset-runtime', 'bluetooth-runtime',
        'ble-control-runtime', 'ble-update-runtime', 'ble-update-radio-runtime',
        'update-policy-runtime', 'update-cue-runtime', 'rollout-recovery-preflight',
        'update-handoff-runtime', 'update-publisher-runtime',
        'update-attempt-runtime',
        'update-publisher-receiver-runtime', 'firmware-relay-runtime',
    ]],
    [sys.executable, 'tests/firmware-relay-runtime.py', '--publisher'],
    [sys.executable, 'tests/espnow-runtime.py', '--mbedtls-cache', '.build/tls-library'],
]


def main():
    report = dict(hostOnly=True, hardwareTouched=False, publicationPerformed=False,
                  sources={}, results=[])
    # Provenance covers production firmware, protocol clients, and this gate.
    paths = sorted([*ROOT.glob('*.h'), *ROOT.glob('*.cpp'), *ROOT.glob('*.ino'),
                    *ROOT.glob('mobile/src/*.js'), Path(__file__).resolve()])
    for path in paths:
        report['sources'][path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    output = ROOT / '.build/experience-contract-tests.json'
    output.parent.mkdir(exist_ok=True)
    temporary = output.parent / 'experience-host-temp'
    temporary.mkdir(exist_ok=True)
    environment = dict(os.environ, TEMP=str(temporary), TMP=str(temporary), TMPDIR=str(temporary))
    failed = False
    try:
        for argv in CASES:
            print('Running ' + ' '.join(argv), flush=True)
            started = time.monotonic()
            result = subprocess.run(argv, cwd=ROOT, env=environment)
            report['results'].append(dict(argv=argv, exitCode=result.returncode,
                                         elapsedSeconds=round(time.monotonic() - started, 3)))
            failed |= bool(result.returncode)
    finally:
        report['allPassed'] = not failed and len(report['results']) == len(CASES)
        output.write_text(json.dumps(report, indent=2) + '\n')
    print(f"Contract gate: {len(report['results'])} commands; allPassed={report['allPassed']}", flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
