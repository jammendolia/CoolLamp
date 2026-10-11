"""Read-only, explicit-target physical HTTP continuity probe. No lamp/router writes.

Run with an animated effect already selected and USB diagnostics recording.
Secrets and response bodies are never printed or written. Results cannot prove
the original phone incident's transport or physical continuity without hardware.
"""
import argparse
import base64
import concurrent.futures
import getpass
import json
import socket
import threading
import time
from pathlib import Path

REQUEST_SECONDS = 7
TRIAL_SECONDS = 8
PROFILE_SECONDS = TRIAL_SECONDS + REQUEST_SECONDS
MAX_ROUNDS = 8
# Attribution only: match the bounded server header and largest API response.
# The existing 64 KiB read cap and success/error gates below are unchanged.
OBSERVE_HEADER_BYTES = 512
OBSERVE_BODY_BYTES = 12288
OBSERVE_FIELDS = ('headerSeen', 'statusCode', 'contentLength', 'bodyBytesReceived',
                  'fullBodyAtMs', 'recvErrorAtMs')
PROFILES = ("partial-line", "trickled-line", "partial-header", "trickled-header",
            "stalled-body", "stalled-reader", "stalled-state-reader", "abrupt-disconnect")


class ReadFailure(ValueError):
    """Machine-readable read failure; never retain a response or exception text."""
    def __init__(self, category, status_code=None):
        super().__init__(category)
        self.category, self.status_code = category, status_code


class ResponseObservation:
    """Bounded numeric metadata; retains no received header/body or peer text."""
    def __init__(self, timing, started):
        self.timing, self.started = timing, started
        self.header_end, self.header_exhausted = None, False
        if timing is not None:
            timing['headerSeen'] = False

    def receive(self, buffered, chunk, now):
        if self.timing is None:
            return
        if self.header_end is None and not self.header_exhausted:
            head = bytes(buffered[:OBSERVE_HEADER_BYTES])
            head += chunk[:OBSERVE_HEADER_BYTES-len(head)]
            boundary = head.find(b'\r\n\r\n')
            if boundary >= 0:
                self.header_end = boundary + 4
                self.timing['headerSeen'] = True
                lines = head[:boundary].split(b'\r\n')
                status = lines[0].split(b' ', 2)
                if (len(lines[0]) <= 96 and len(status) >= 2 and
                        status[0] in (b'HTTP/1.0', b'HTTP/1.1') and
                        len(status[1]) == 3 and status[1].isdigit()):
                    code = int(status[1])
                    if 100 <= code <= 599:
                        self.timing['statusCode'] = code
                lengths = []
                for line in lines[1:]:
                    key, colon, value = line.partition(b':')
                    if colon and key.lower() == b'content-length':
                        lengths.append(value.strip())
                if (len(lengths) == 1 and 1 <= len(lengths[0]) <= 5 and
                        lengths[0].isdigit()):
                    length = int(lengths[0])
                    if length <= OBSERVE_BODY_BYTES:
                        self.timing['contentLength'] = length
            elif len(head) == OBSERVE_HEADER_BYTES:
                self.header_exhausted = True
        if self.header_end is not None:
            # buffered+chunk is already limited by the existing 64 KiB reader.
            self.timing['bodyBytesReceived'] = max(0, len(buffered)+len(chunk)-self.header_end)
            if ('contentLength' in self.timing and 'fullBodyAtMs' not in self.timing and
                    self.timing['bodyBytesReceived'] >= self.timing['contentLength']):
                self.timing['fullBodyAtMs'] = round((now-self.started)*1000, 3)

    def recv_error(self, now):
        if self.timing is not None:
            self.timing['recvErrorAtMs'] = round((now-self.started)*1000, 3)


def read_failure(error):
    categories = {'response-limit', 'invalid-framing', 'http-status', 'invalid-json',
                  'invalid-shape', 'identity-mismatch', 'precondition-failed', 'launch-window-expired'}
    if isinstance(error, ReadFailure):
        result = dict(errorCategory=error.category if error.category in categories else 'invalid-response')
        if isinstance(error.status_code, int) and 100 <= error.status_code <= 599:
            result['statusCode'] = error.status_code
        return result
    if isinstance(error, TimeoutError):
        category = 'timeout'
    elif isinstance(error, ConnectionResetError):
        category = 'connection-reset'
    elif isinstance(error, ConnectionRefusedError):
        category = 'connection-refused'
    elif isinstance(error, BrokenPipeError):
        category = 'connection-closed'
    elif isinstance(error, OSError):
        category = 'network-error'
    elif isinstance(error, (json.JSONDecodeError, UnicodeDecodeError)):
        category = 'invalid-json'
    elif isinstance(error, KeyError):
        category = 'invalid-shape'
    else:
        category = 'invalid-response'
    return dict(errorCategory=category)


def observed_read(host, path, authorization, label, deadline=None, verify=None,
                  timing_origin=None, launch_deadline=None):
    started = time.monotonic()
    timing = {}
    try:
        data = request(host, path, authorization, deadline=deadline, timing=timing,
                       launch_deadline=launch_deadline)
        if verify and not verify(data):
            raise ReadFailure('identity-mismatch', 200)
        outcome = dict(ok=True, read=label, statusCode=200)
    except (OSError, ValueError, KeyError) as error:
        data = None
        outcome = dict(ok=False, read=label, **read_failure(error))
    outcome['latencyMs'] = round((time.monotonic()-started)*1000, 1)
    if timing:
        origin = timing_origin if timing_origin is not None else timing['started']
        outcome.update(requestStartedMs=round((timing['started']-origin)*1000, 3),
                       requestEndedMs=round((time.monotonic()-origin)*1000, 3),
                       effectiveDeadlineMs=round((timing['deadline']-origin)*1000, 3),
                       effectiveBudgetMs=round(timing['budget']*1000, 3),
                       shortenedBudget=timing['shortened'], launched=timing['launched'])
        # These timestamps are elapsed from this request's entry, matching its
        # latencyMs. Only known numeric/boolean fields reach the saved report.
        outcome.update({key: timing[key] for key in OBSERVE_FIELDS if key in timing})
    return data, outcome


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise TimeoutError("bounded HTTP deadline reached")
    return seconds


def request(host, path, authorization, deadline=None, timing=None, launch_deadline=None):
    # One lifetime covers connection, send and all response fragments. Shrink
    # every I/O timeout; a peer sending occasional bytes cannot renew it. Python
    # hostname resolution itself remains OS-controlled: use verified IPv4
    # targets when a strict wall-clock connection bound is required.
    started = time.monotonic()
    natural_deadline = started + REQUEST_SECONDS
    deadline = min(natural_deadline, deadline) if deadline is not None else natural_deadline
    launched = launch_deadline is None or started < launch_deadline
    if timing is not None:
        timing.update(started=started, deadline=deadline, budget=max(0, deadline-started),
                      shortened=deadline<natural_deadline, launched=launched)
    observation = ResponseObservation(timing, started)
    # Recheck at actual request entry, including host scheduling delays after
    # the caller's launch check. An expired launch never opens a socket and
    # remains an explicit failed fixture outcome.
    if not launched:
        raise ReadFailure('launch-window-expired')
    with socket.create_connection((host, 80), timeout=remaining(deadline)) as client:
        client.settimeout(remaining(deadline))
        client.sendall((f"GET {path} HTTP/1.1\r\nHost: lamp\r\nAuthorization: {authorization}\r\nConnection: close\r\n\r\n").encode())
        result = bytearray()
        while len(result) < 65536:
            client.settimeout(remaining(deadline))
            try:
                chunk = client.recv(min(4096, 65536-len(result)))
            except OSError:
                observation.recv_error(time.monotonic())
                raise
            observation.receive(result, chunk, time.monotonic())
            remaining(deadline)
            if not chunk:
                break
            result.extend(chunk)
        head, separator, body = bytes(result).partition(b"\r\n\r\n")
        if len(result) >= 65536:
            raise ReadFailure('response-limit')
        if not separator:
            raise ReadFailure('invalid-framing')
        parts = head.split(b"\r\n", 1)[0].split(b" ", 2)
        if len(parts) < 2 or parts[0] not in (b"HTTP/1.0", b"HTTP/1.1"):
            raise ReadFailure('invalid-framing')
        try:
            code = int(parts[1])
        except ValueError:
            raise ReadFailure('invalid-framing') from None
        if not 100 <= code <= 599:
            raise ReadFailure('invalid-framing')
        if code != 200:
            raise ReadFailure('http-status', code)
        try:
            data = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise ReadFailure('invalid-json', code) from None
        if not isinstance(data, dict) and not (path == "/api/effects" and isinstance(data, list)
                                              and all(isinstance(effect, dict) for effect in data)):
            raise ReadFailure('invalid-shape', code)
        remaining(deadline)
        return data


def one_lamp(host, authorization, expected=None, rounds=1, progress=None):
    if isinstance(rounds, bool) or not isinstance(rounds, int) or not 1 <= rounds <= MAX_ROUNDS:
        raise ValueError("rounds must be an integer from one to eight")
    state = request(host, "/api/state", authorization)
    identity = state.get("deviceId")
    if not identity or (expected and identity != expected):
        raise ReadFailure('identity-mismatch', 200)
    firmware = state.get('firmware')
    if not isinstance(firmware, dict) or not isinstance(firmware.get('version'), str):
        raise ReadFailure('invalid-shape', 200)
    version = firmware['version']
    if state.get("power") is not True:
        raise ReadFailure('precondition-failed', 200)
    revision = request(host, "/api/revision", authorization)
    if revision.get("target") != identity or not revision.get("bootSession"):
        raise ReadFailure('identity-mismatch', 200)
    boot = revision["bootSession"]
    report = dict(deviceId=identity, firmwareVersion=version, bootSession=boot, testedRoute="direct-http",
                  rounds=rounds, trialSeconds=TRIAL_SECONDS, requestDeadlineSeconds=REQUEST_SECONDS,
                  launchWindowSeconds=TRIAL_SECONDS, profileLifetimeSeconds=PROFILE_SECONDS,
                  schedulingVersion=2,
                  completed=False, passed=False, trials=[])
    for round_index, profile in ((r, p) for r in range(rounds) for p in PROFILES):
        trial = dict(roundIndex=round_index+1, profile=profile, complete=False,
                     trafficComplete=False, normalTraffic=[], timing=None, bootUnchanged=None,
                     diagnosticsRead=None, revisionRead=None)
        report['trials'].append(trial)
        report['activeTrial']=dict(roundIndex=round_index+1,profile=profile)
        if progress:progress(report)
        sockets = []
        results = trial['normalTraffic']
        stop = threading.Event()
        trickler = None
        began = time.monotonic()
        launch_end = began + TRIAL_SECONDS
        profile_end = began + PROFILE_SECONDS
        trial.update(profileStartedAtMonotonicSeconds=round(began, 6),
                     launchWindowEndMs=TRIAL_SECONDS*1000, profileLifetimeLimitMs=PROFILE_SECONDS*1000)
        try:
            # Two slow slots leave the third slot for normal status/catalog traffic.
            for _ in range(2):
                client = socket.create_connection((host, 80), timeout=min(3, remaining(launch_end)))
                client.settimeout(.5)
                sockets.append(client)
                if profile in ("partial-line", "trickled-line"):
                    client.sendall(b"GET /api/st")
                elif profile in ("partial-header", "trickled-header"):
                    client.sendall(b"GET /api/state HTTP/1.1\r\nHost: la")
                elif profile == "stalled-body":
                    # Deliberately incomplete AND semantically invalid. Even if
                    # delivered in full, it contains no valid lamp mutation.
                    client.sendall(b"POST /api/state/patch HTTP/1.1\r\nContent-Length: 512\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\nbad")
                elif profile in ("stalled-reader", "stalled-state-reader"):
                    client.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 256)
                    # Exercise both flash-backed HTML and heap-backed JSON.
                    # The request is read-only; never print its credentials.
                    path = "/" if profile == "stalled-reader" else "/api/state"
                    client.sendall((f"GET {path} HTTP/1.1\r\nAuthorization: {authorization}\r\n\r\n").encode())
                else:
                    client.sendall(b"GET /api/state HTTP/1.1\r\n")
                    client.close()
            if profile.startswith("trickled"):
                def trickle():
                    # Independent of a blocked normal request, including on
                    # the old firmware. One helper per lamp, bounded lifetime.
                    while not stop.wait(1) and time.monotonic() < profile_end:
                        for client in sockets:
                            try:
                                client.sendall(b"a")
                            except OSError:
                                pass
                trickler = threading.Thread(target=trickle)
                trickler.start()
            for index in range(TRIAL_SECONDS):
                if time.monotonic() >= launch_end:
                    break
                launched_at = time.monotonic()
                state_read = index % 2 == 0
                _, outcome = observed_read(host, "/api/state" if state_read else "/api/effects", authorization,
                                           'state' if state_read else 'effects', deadline=profile_end,
                                           launch_deadline=launch_end, timing_origin=began,
                                           verify=(lambda value: isinstance(value, dict) and value.get('deviceId') == identity) if state_read else None)
                results.append(outcome)
                if progress:progress(report)
                # Do not burst missed one-second slots after a slow response.
                # Launches stop at8s; an already launched request retains its
                # own7s lifetime and the slow clients stay present until done.
                time.sleep(max(0, min(launch_end, max(began + index + 1, launched_at + 1))-time.monotonic()))
            trial['trafficComplete'] = True
        except (OSError, ValueError, KeyError) as error:
            trial['setupFailure'] = read_failure(error)
        finally:
            trial['activePhaseEndedMs'] = round((time.monotonic()-began)*1000, 3)
            stop.set()
            if trickler:
                trickler.join(max(0, min(2, profile_end-time.monotonic())))
            for client in sockets:
                client.close()
        trial['trialElapsedMs'] = round((time.monotonic()-began)*1000, 1)
        trial.update(profileEndedMs=round((time.monotonic()-began)*1000, 3),
                     profileDeadlineOverrunMs=round(max(0,time.monotonic()-profile_end)*1000,3),
                     launchedNormalReads=sum(item.get('launched') is True for item in results),
                     shortenedNormalBudgets=sum(item.get('shortenedBudget') is True for item in results),
                     missedLaunchWindow=sum(item.get('launched') is False for item in results))
        if progress:progress(report)
        post_deadline = time.monotonic()+REQUEST_SECONDS
        diagnostics, trial['diagnosticsRead'] = observed_read(host, '/api/diagnostics', authorization, 'diagnostics',
                                                            deadline=post_deadline, timing_origin=began,
                                                            verify=lambda value: isinstance(value, dict) and value.get('deviceId') == identity)
        if diagnostics is not None:
            trial.update(timing=diagnostics.get('timing'), uptimeMs=diagnostics.get('uptimeMs'),
                         freeHeap=diagnostics.get('freeHeap'), minFreeHeap=diagnostics.get('minFreeHeap'),
                         largestFreeBlock=diagnostics.get('largestFreeBlock'),
                         loopStackMinimumBytes=diagnostics.get('loopStackMinimumBytes'),
                         httpCloseStackMinimumBytes=diagnostics.get('httpCloseStackMinimumBytes'))
            reset_reason = diagnostics.get('resetReason')
            if isinstance(reset_reason, int) and not isinstance(reset_reason, bool) and 0<=reset_reason<=0xffffffff:
                trial['resetReason'] = reset_reason
        if progress:progress(report)
        fresh, trial['revisionRead'] = observed_read(host, '/api/revision', authorization, 'revision',
                                                    deadline=post_deadline, timing_origin=began,
                                                    verify=lambda value: isinstance(value, dict) and value.get('target') == identity and bool(value.get('bootSession')))
        if fresh is not None:
            trial['bootUnchanged'] = fresh['bootSession'] == boot
        trial['complete'] = True
        trial['passed'] = bool(trial['trafficComplete'] and results and all(item['ok'] for item in results)
                               and trial['diagnosticsRead']['ok'] and trial['revisionRead']['ok'] and trial['bootUnchanged']
                               and not trial['shortenedNormalBudgets'] and not trial['missedLaunchWindow']
                               and not trial['profileDeadlineOverrunMs'])
        if progress:progress(report)
    report['activeTrial']=None
    report['completed'] = True
    report['passed'] = all(trial['passed'] for trial in report['trials'])
    report["measurementLimits"] = "Version2 uses an8-second request-launch window and each launched normal read has its own7-second connection/send/receive deadline. Slow clients remain through the last in-flight read; the whole profile has a15-second absolute limit and measured overruns remain failures. Trial duration may exceed8seconds and is recorded. Diagnostics/revision separately share one7-second budget. Host scheduling, progress-file I/O and DNS resolution use OS limits; numeric timing records expose actual launch/end/budget without credentials or bodies. Compare per-boot firmware timing with continuous USB capture; no native-phone or original-incident reproduction is inferred."
    if progress:progress(report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", action="append", required=True, help="Explicit lamp IPv4/hostname; repeat for physical fleet")
    parser.add_argument("--expected-device", help="Canonical identity, required for a single target")
    parser.add_argument("--rounds", type=int, choices=range(1, MAX_ROUNDS+1), default=1,
                        help="Repeat every eight-second profile one to eight times; eight rounds gives 64 seconds per profile")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not 1 <= len(args.target) <= 32:
        parser.error("one to 32 explicit targets required")
    if len(args.target) == 1 and not args.expected_device:
        parser.error("single-target testing requires --expected-device")
    password = getpass.getpass("Lamp access password (never logged): ")
    authorization = "Basic " + base64.b64encode(("lamp:"+password).encode()).decode()
    password = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(20, len(args.target))) as pool:
        futures = [pool.submit(one_lamp, host, authorization, args.expected_device if len(args.target) == 1 else None,
                               args.rounds) for host in args.target]
        results = []
        for future in futures:
            try:
                results.append(future.result())
            except (OSError, ValueError, KeyError) as error:
                results.append(dict(completed=False, passed=False, errorStage='preflight', **read_failure(error)))
    authorization = None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(physicalTargetsRequested=len(args.target), routerChanged=False, lampSettingsChanged=False, results=results), indent=2)+"\n")
    print(f"Wrote privacy-filtered results for {len(results)} requested physical targets to {args.output}")
    return 0 if all(result.get('passed') is True for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
