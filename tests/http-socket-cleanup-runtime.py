"""Exercise the production detached socket shim/owner/worker with bounded fixtures."""
from pathlib import Path
import subprocess
import tempfile
import hashlib
import json
import re
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
POLICY_SCENARIOS=('policy-owner-ack-3.6','policy-owner-ack-rollover','policy-owner-no-progress-absolute','policy-owner-copied-idle-bulk','policy-owner-cancel-and-equal')
SCENARIOS=('normal-ack-and-fd-reuse','ack-between-observation-and-abort','zero-window-idle-and-absolute','cancel-and-upload-lifetime',
           'rollover','close-failure-retains-ownership','listener-nontcp-disconnected-and-busy',
           'production-worker-queue-and-bounded-backoff','creation-failures','transmit-credit-ack-partial-and-cap','transmit-credit-contention-errors-and-fd-reuse','html-custom-lifetime-and-fd-reuse','last-data-ack-loss-recovers-at-three-seconds','partial-ack-progress-total-cancel-and-rollover','delayed-first-partial-known-flight-baseline')+POLICY_SCENARIOS
with tempfile.TemporaryDirectory(prefix='http-cleanup-',dir=ROOT/'.build') as folder:
    binary=Path(folder)/'cleanup.exe'
    command=['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
             *SANITIZERS,'-I'+str(ROOT/'tests/http-socket-cleanup-stubs'),'-I'+str(ROOT),
             str(ROOT/'tests/http-socket-cleanup-runtime.cpp'),str(ROOT/'LampHttpSocketCleanup.cpp'),'-o',str(binary)]
    subprocess.run(command,check=True)
    for scenario in SCENARIOS:
        subprocess.run([str(binary),scenario],check=True,timeout=10)
    for version in ('ESP_ARDUINO_VERSION=0','ESP_IDF_VERSION=0'):
        failed=subprocess.run(command[:-2]+['-D'+version,'-o',str(binary)],capture_output=True,text=True)
        assert failed.returncode and 'Re-audit the CoolLamp detached HTTP socket shim' in failed.stderr
    print('pinned platform mismatch guards passed')
    legacy=Path(folder)/'legacy-policy';legacy.mkdir()
    old,count=re.subn(r'(AckWaitTimeoutMs\s*=\s*)5000;',r'\g<1>3500;',
                      (ROOT/'LampHttpSocketCleanup.h').read_text())
    assert count==1
    (legacy/'LampHttpSocketCleanup.h').write_text(old)
    (legacy/'LampHttpSocketCleanup.cpp').write_bytes((ROOT/'LampHttpSocketCleanup.cpp').read_bytes())
    comparison=legacy/'cleanup.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    '-DLAMP_HTTP_LEGACY_ACK_POLICY_FIXTURE',*SANITIZERS,'-I'+str(legacy),
                    '-I'+str(ROOT/'tests/http-socket-cleanup-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-socket-cleanup-runtime.cpp'),str(legacy/'LampHttpSocketCleanup.cpp'),
                    '-o',str(comparison)],check=True)
    for scenario in POLICY_SCENARIOS:
        subprocess.run([str(comparison),scenario],check=True,timeout=10)
    report=dict(hostOnly=True,hardwareTouched=False,currentScenariosPassed=len(SCENARIOS),
                policyComparisonCasesPassed=2*len(POLICY_SCENARIOS),currentCopiedIdleMs=5000,
                formerCopiedIdleMs=3500,originalApiTotalMs=5000,htmlTotalMs=15000,uploadTotalMs=180000,
                pinnedCore='3.3.11',pinnedIdf='5.5.5',pinnedEspLwipCommit='fd432e4ee2cfb7f7f1c7eb7227e0173412e7b84e',
                noPhysicalAttribution=True,notGuaranteedTcpRetry=True,
                sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in
                         ('LampHttpSocketCleanup.h','LampHttpSocketCleanup.cpp','tests/http-socket-cleanup-runtime.cpp')})
    (ROOT/'.build/http-cleanup-ack-policy-runtime.json').write_text(json.dumps(report,indent=2)+'\n')
