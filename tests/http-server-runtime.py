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
SCENARIOS=('mapped-page-low-memory-auth-and-no-copy','mapped-page-low-memory-bounds-and-copy-failure','mapped-page-low-memory-client-fairness','mapped-page-low-memory-absolute-rollover','mapped-page-low-memory-send-allocation-failure','mapped-binary-exact-length','mapped-binary-bounds','browser-preparation-budget','authentication','released-request-metadata','compact-parser-and-exact-bodies','body-allocation-failure-and-cancel','partial-and-cancel','idle-deadlines','absolute-and-rollover',
           'fairness-and-capacity','slow-reader-and-no-replay','trickled-response-hard-deadline','static-page-heap-guard','static-page-priority','static-page-pressure-deadline','ready-memory-before-mutation','stalled-json-memory-recovery','response-budget','household-compatibility','invalid-json-and-allocation-after-mutation','bounded-work',
           'static-page-separate-floor','static-page-receiving-priority','static-page-input-deadline-resumes','static-page-upload-deadline-resumes',
           'control-memory-before-decode','read-memory-admission-and-immediate-denial','read-form-capture-budget','prepared-releases-before-memory-admission','prepared-raw-form-and-ble-isolation','prepared-single-slot-and-half-close','prepared-form-allocation-failure','prepared-survives-upload-completion','prepared-waits-for-delayed-cleanup','complete-input-total-deadline-and-rollover',
           'transmit-credit-delayed-ack-and-deadline','transmit-credit-delayed-ack-reachable','mapped-page-delayed-ack','mapped-page-fast-delayed-ack','mapped-root-delayed-ack','owned-state-two-copy-dma-pressure','single-data-ack-loss-recovers-at-three-seconds','partial-ack-progress-before-drain-and-rollover','partial-ack-equal-contention-and-fd-reuse','partial-ack-segments-total-and-cancel','partial-ack-html-progress-beyond-five','final-flight-baseline-close-backpressure','mapped-page-deadline-rollover-and-cleanup','ack-drain-restores-unsent-idle','mapped-page-idle-cancel-and-request-bound','close-queue-full','stopped-close-queue-full','upload-complete','upload-abort-owner','upload-malformed-and-loss','failed-old-upload-new-owner','upload-final-status-under-response-pressure','fleet-twenty',
           'parser-admission-bounds-and-recovery','parser-admission-retained-ble-pressure','parser-admission-cancel-and-close-queue-full','parser-admission-allocation-failure-and-race')+POLICY_SCENARIOS
with tempfile.TemporaryDirectory(prefix='http-server-',dir=ROOT/'.build') as folder:
    binary=Path(folder)/'server.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    *SANITIZERS,'-I'+str(ROOT/'tests/http-server-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-server-runtime.cpp'),str(ROOT/'LampHttpServer.cpp'),
                    '-o',str(binary)],check=True)
    for scenario in SCENARIOS:
        subprocess.run([str(binary),scenario],check=True,timeout=15)
    # Exercise the actual build-helper gzip bytes, including embedded NULs,
    # on the exact GET / path at the physically observed low-memory profile.
    gzip_folder=Path(folder)/'gzip';gzip_folder.mkdir()
    gzip_report=json.loads(subprocess.check_output(['node','-e',
        "const fs=require('node:fs');const r=require(process.argv[1]).compressedPage(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],r.header);process.stdout.write(JSON.stringify(r.report));",
        str(ROOT/'tools/compress-lamp-page.cjs'),str(ROOT/'LampPage.h'),str(gzip_folder/'LampPageCompressed.h')],text=True))
    gzip_binary=gzip_folder/'server.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    '-DCOOL_LAMP_PAGE_GZIP=1',*SANITIZERS,'-I'+str(gzip_folder),
                    '-I'+str(ROOT/'tests/http-server-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-server-runtime.cpp'),str(ROOT/'LampHttpServer.cpp'),
                    '-o',str(gzip_binary)],check=True)
    gzip_scenarios=SCENARIOS[:5]+('mapped-root-delayed-ack',)
    for scenario in gzip_scenarios:
        subprocess.run([str(gzip_binary),scenario],check=True,timeout=15)
    # Restore only the former flight in temporary headers, driving the same
    # production response owner/send/deadline path. No second request processor
    # or artifact-specific fake success is substituted for the transport.
    former_flight=Path(folder)/'former-flight';former_flight.mkdir()
    old_flight,count=re.subn(r'(MaxTransmitFlightBytes\s*=\s*)384;',r'\g<1>1024;',
                            (ROOT/'LampHttpSocketCleanup.h').read_text())
    assert count==1
    (former_flight/'LampHttpSocketCleanup.h').write_text(old_flight)
    for name in ('LampHttpServer.h','LampHttpServer.cpp'):
        (former_flight/name).write_bytes((ROOT/name).read_bytes())
    former_binary=former_flight/'server.exe'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',
                    '-DLAMP_HTTP_LEGACY_TX_FLIGHT_FIXTURE',*SANITIZERS,'-I'+str(former_flight),
                    '-I'+str(ROOT/'tests/http-server-stubs'),'-I'+str(ROOT),
                    str(ROOT/'tests/http-server-runtime.cpp'),str(former_flight/'LampHttpServer.cpp'),
                    '-o',str(former_binary)],check=True)
    subprocess.run([str(former_binary),'owned-state-two-copy-dma-pressure'],check=True,timeout=15)
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
                bulkHtmlSharesControlAdmission=False,mappedPageGetOnly=True,mappedPageSendHeapBytes=11776,
                mappedPageContiguousWorkspaceBytes=512,mappedPageFlightReserveBytes=3072,
                mappedPageSingleFlightBytes=384,acceptedReceiveAndUploadHaveBulkPriority=True,
                lowMemorySafeReadBudget={'freeHeapBytes':16316,'largestBlockBytes':7668},
                lowMemoryReadDenialImmediate=True,mutationAdmissionUnchanged=True,
                bulkHtmlOriginalTotalMs=15000,mappedHtmlByteExact=len((ROOT/'LampPage.h').read_text(encoding='utf-8').split('R"HTML(',1)[1].rsplit(')HTML";',1)[0].encode('utf-8')),
                mappedGzipLowMemoryScenariosPassed=len(gzip_scenarios),mappedGzip=gzip_report,
                twoCopyPressure=dict(hostModelOnly=True,physicalCauseConfirmed=False,fixtureDmaBlockBytes=1380,
                    currentFlightBytes=384,formerFlightBytes=1024,currentComplete=True,formerAcceptedButUnsent=True,
                    ipv4WirePrefixBytes=54,maximumTcpPbufPrefixBytes=74,pbufBytes=16,tcpSegmentBytes=16,
                    wifiAllocationAdditionalBytes=136,fixtureAllocatorAllowancePerAllocationBytes=16),
                rawHtml250MsAckBoundedCancellation=True,rawHtml100MsAckComplete=True,
                compressedRoot250MsAckComplete=True,lateApi250MsAckBoundedCancellation=True,
                lateApi100MsAckComplete=True,
                parserAdmission=dict(hostModelOnly=True,freeReserveBytes=8704,compiledParserSizeBudgeted=True,
                    conservativeAllocatorRoundingBytes=16,largestBlockCheckedBeforeAllocation=True,
                    shortageReplyStatic=True,handlerNotExecutedOrReplayed=True,postAllocationHeadroomChecked=True,
                    retainedBleLikeReplyBytes=6255,pressureCasesPassed=4,physicalAvailabilityConfirmed=False),
                noPhysicalAttribution=True,notGuaranteedTcpRetry=True,
                sources={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in
                         ('LampControlResourcePolicy.h','LampHttpServer.h','LampHttpServer.cpp','LampHttpSocketCleanup.h','tests/http-server-runtime.cpp')})
    (ROOT/'.build/http-server-ack-policy-runtime.json').write_text(json.dumps(report,indent=2)+'\n')
