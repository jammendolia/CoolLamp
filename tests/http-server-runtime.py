"""Run actual HTTP transport/control adapter against bounded socket/task fixtures."""
from pathlib import Path
import subprocess
import tempfile
import hashlib
import json
import re
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
POLICY_SCENARIOS=('policy-header-ack-3.6','policy-header-ack-rollover','policy-header-no-progress-absolute','policy-header-no-progress-rollover','policy-header-cancel-uncertain-once')
SCENARIOS=('authentication','released-request-metadata','compact-parser-and-exact-bodies','body-allocation-failure-and-cancel','partial-and-cancel','idle-deadlines','absolute-and-rollover',
           'fairness-and-capacity','slow-reader-and-no-replay','trickled-response-hard-deadline','static-page-heap-guard','static-page-priority','static-page-pressure-deadline','ready-memory-before-mutation','stalled-json-memory-recovery','response-budget','household-compatibility','invalid-json-and-allocation-after-mutation','bounded-work',
           'static-page-shared-floor','static-page-receiving-priority','static-page-input-deadline-resumes','static-page-upload-deadline-resumes',
           'control-memory-before-decode','prepared-releases-before-memory-admission','prepared-raw-form-and-ble-isolation','prepared-single-slot-and-half-close','prepared-form-allocation-failure','prepared-survives-upload-completion','prepared-waits-for-delayed-cleanup','complete-input-total-deadline-and-rollover',
           'transmit-credit-delayed-ack-and-deadline','mapped-page-delayed-ack','single-data-ack-loss-recovers-at-three-seconds','partial-ack-progress-before-drain-and-rollover','partial-ack-equal-contention-and-fd-reuse','partial-ack-segments-total-and-cancel','partial-ack-html-progress-beyond-five','final-flight-baseline-close-backpressure','mapped-page-deadline-rollover-and-cleanup','ack-drain-restores-unsent-idle','mapped-page-idle-cancel-and-request-bound','close-queue-full','stopped-close-queue-full','upload-complete','upload-abort-owner','upload-malformed-and-loss','failed-old-upload-new-owner','upload-final-status-under-response-pressure','fleet-twenty')+POLICY_SCENARIOS
with tempfile.TemporaryDirectory(prefix='http-server-',dir=ROOT/'.build') as folder:
    binary=Path(folder)/'server.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    *SANITIZERS,'-I'+str(ROOT/'tests/http-server-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-server-runtime.cpp'),str(ROOT/'LampHttpServer.cpp'),
                    '-o',str(binary)],check=True)
    for scenario in SCENARIOS:
        subprocess.run([str(binary),scenario],check=True,timeout=15)
    # Same production transport and fixtures, with ONLY its former copied-data
    # policy restored in temporary headers. The normal compile asserts5s, so a
    # silent production revert cannot be mistaken for a passing comparison.
    legacy=Path(folder)/'legacy-policy';legacy.mkdir()
    old,count=re.subn(r'(AckWaitTimeoutMs\s*=\s*)5000;',r'\g<1>3500;',
                      (ROOT/'LampHttpSocketCleanup.h').read_text())
    assert count==1
    (legacy/'LampHttpSocketCleanup.h').write_text(old)
    for name in ('LampHttpServer.h','LampHttpServer.cpp'):
        (legacy/name).write_bytes((ROOT/name).read_bytes())
    comparison=legacy/'server.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    '-DLAMP_HTTP_LEGACY_ACK_POLICY_FIXTURE',*SANITIZERS,'-I'+str(legacy),
                    '-I'+str(ROOT/'tests/http-server-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-server-runtime.cpp'),str(legacy/'LampHttpServer.cpp'),
                    '-o',str(comparison)],check=True)
    for scenario in POLICY_SCENARIOS:
        subprocess.run([str(comparison),scenario],check=True,timeout=15)
    report=dict(hostOnly=True,hardwareTouched=False,currentScenariosPassed=len(SCENARIOS),
                policyComparisonCasesPassed=2*len(POLICY_SCENARIOS),currentCopiedIdleMs=5000,
                formerCopiedIdleMs=3500,originalApiTotalMs=5000,inputIdleMs=1500,
                bulkHtmlSharesControlAdmission=True,acceptedReceiveAndUploadHaveBulkPriority=True,
                bulkHtmlOriginalTotalMs=15000,mappedHtmlByteExact=24012,
                noPhysicalAttribution=True,notGuaranteedTcpRetry=True,
                sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in
                         ('LampHttpServer.h','LampHttpServer.cpp','LampHttpSocketCleanup.h','tests/http-server-runtime.cpp')})
    (ROOT/'.build/http-server-ack-policy-runtime.json').write_text(json.dumps(report,indent=2)+'\n')
