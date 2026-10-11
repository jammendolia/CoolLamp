"""Host-only physical-probe helper checks with mocked sockets and clocks."""
import importlib.util
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stall_probe', ROOT / 'tools/http-stall-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Clock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Client:
    def __init__(self, clock, chunks=(), send_seconds=0):
        self.clock, self.chunks, self.send_seconds = clock, list(chunks), send_seconds
        self.timeout = 7
        self.timeouts, self.sent, self.options = [], [], []
        self.closed, self.reads = False, 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def settimeout(self, seconds):
        self.timeout = seconds
        self.timeouts.append(seconds)

    def delay(self, seconds):
        if seconds >= self.timeout:
            self.clock.sleep(self.timeout)
            raise socket.timeout('private response peer error must never enter report')
        self.clock.sleep(seconds)

    def sendall(self, data):
        self.delay(self.send_seconds)
        self.sent.append(data)

    def recv(self, limit):
        self.reads += 1
        seconds, chunk = self.chunks.pop(0) if self.chunks else (0, b'')
        self.delay(seconds)
        if isinstance(chunk, OSError):
            raise chunk
        assert len(chunk) <= limit
        return chunk

    def setsockopt(self, *option):
        self.options.append(option)

    def close(self):
        self.closed = True


class Thread:
    def __init__(self, target):
        self.target = target
        self.started, self.joined = False, False

    def start(self):
        self.started = True  # Normal traffic advances the fake clock; no real thread.

    def join(self, timeout):
        assert 0 <= timeout <= 2
        self.joined = True


class Tests(unittest.TestCase):
    def call_request(self, chunks, send_seconds=0, connect_seconds=0, deadline=None, path='/api/state',
                     timing=None, launch_deadline=None):
        clock = Clock()
        client = Client(clock, chunks, send_seconds)

        def connect(address, timeout):
            self.assertEqual(address, ('192.0.2.1', 80))
            clock.sleep(min(connect_seconds, timeout))
            if connect_seconds >= timeout:
                raise socket.timeout()
            return client

        with patch.object(probe.time, 'monotonic', clock.monotonic), patch.object(probe.socket, 'create_connection', connect):
            try:
                result = probe.request('192.0.2.1', path, 'AUTH-CANARY', deadline=deadline,
                                       timing=timing,launch_deadline=launch_deadline)
                return result, clock, client
            except Exception as error:
                return error, clock, client

    def test_success_and_connection_send_receive_share_deadline(self):
        result, clock, client = self.call_request([(1, b'HTTP/1.1 200 OK\r\n\r\n{"deviceId":"lamp"}'), (0, b'')],
                                                  send_seconds=1, connect_seconds=2)
        self.assertEqual(result, {'deviceId': 'lamp'})
        self.assertEqual(clock.now, 4)
        self.assertEqual(client.timeouts, [5, 4, 3])
        self.assertTrue(client.closed)
        self.assertIn(b'Connection: close', client.sent[0])
        result, clock, client = self.call_request([(6, b'x')], send_seconds=1, connect_seconds=2)
        self.assertIsInstance(result, TimeoutError)
        self.assertEqual(clock.now, 7)
        self.assertTrue(client.closed)

    def test_dribble_cannot_renew_absolute_lifetime(self):
        result, clock, client = self.call_request([(0.9, b'x')] * 30)
        self.assertIsInstance(result, TimeoutError)
        self.assertAlmostEqual(clock.now, 7)
        self.assertLessEqual(client.reads, 8)
        self.assertTrue(all(first >= second for first, second in zip(client.timeouts, client.timeouts[1:])))
        self.assertTrue(client.closed)
        result, clock, _ = self.call_request([(0.9, b'x')] * 30, deadline=3)
        self.assertIsInstance(result, TimeoutError)
        self.assertAlmostEqual(clock.now, 3)
        timing={}
        result,clock,_=self.call_request([(1,b'x')],deadline=.328,timing=timing)
        self.assertIsInstance(result,TimeoutError)
        self.assertAlmostEqual(clock.now,.328)
        self.assertTrue(timing['shortened'])
        self.assertEqual(timing['budget'],.328)
        timing={}
        result,clock,_=self.call_request([],deadline=15,launch_deadline=0,timing=timing)
        self.assertIsInstance(result,probe.ReadFailure)
        self.assertEqual(result.category,'launch-window-expired')
        self.assertFalse(timing['launched'])
        self.assertEqual(clock.now,0)

    def test_response_bytes_and_shapes_are_bounded(self):
        result, _, client = self.call_request([(0, b'x' * 4096)] * 16)
        self.assertIsInstance(result, ValueError)
        self.assertEqual(client.reads, 16)
        self.assertTrue(client.closed)
        for body in (b'bad', b'HTTP/1.1 503 unavailable\r\n\r\n{}',
                     b'invalid 200\r\n\r\n{}', b'HTTP/1.1 200 OK\r\n\r\n[]'):
            result, _, client = self.call_request([(0, body), (0, b'')])
            self.assertIsInstance(result, ValueError)
            self.assertTrue(client.closed)
        result, _, _ = self.call_request([(0, b'HTTP/1.1 200 OK\r\n\r\n[{"id":1,"name":"Rainbow"}]'), (0, b'')], path='/api/effects')
        self.assertEqual(result, [{'id': 1, 'name': 'Rainbow'}])

    def test_read_failure_categories_keep_status_without_private_text(self):
        for body, category, code in (
                (b'HTTP/1.1 503 PRIVATE-CANARY\r\n\r\nSECRET-BODY', 'http-status', 503),
                (b'HTTP/1.1 200 OK\r\n\r\nSECRET-BODY', 'invalid-json', 200),
                (b'HTTP/1.1 200 OK\r\n\r\n[]', 'invalid-shape', 200),
                (b'HTTP/1.1 PRIVATE-CANARY\r\n\r\n{}', 'invalid-framing', None),
                (b'HTTP/1.1 999 PRIVATE-CANARY\r\n\r\n{}', 'invalid-framing', None)):
            error, _, client = self.call_request([(0, body), (0, b'')])
            self.assertIsInstance(error, probe.ReadFailure)
            outcome = probe.read_failure(error)
            self.assertEqual(outcome['errorCategory'], category)
            self.assertEqual(outcome.get('statusCode'), code)
            self.assertNotIn('CANARY', json.dumps(outcome))
            self.assertNotIn('SECRET', json.dumps(outcome))
            self.assertTrue(client.closed)
        for error, category in ((TimeoutError('PRIVATE-CANARY'), 'timeout'),
                                (ConnectionResetError('PRIVATE-CANARY'), 'connection-reset'),
                                (ConnectionRefusedError('PRIVATE-CANARY'), 'connection-refused'),
                                (BrokenPipeError('PRIVATE-CANARY'), 'connection-closed'),
                                (OSError('PRIVATE-CANARY'), 'network-error'),
                                (KeyError('PRIVATE-CANARY'), 'invalid-shape'),
                                (ValueError('PRIVATE-CANARY'), 'invalid-response')):
            outcome = probe.read_failure(error)
            self.assertEqual(outcome, {'errorCategory': category})
            self.assertNotIn('CANARY', json.dumps(outcome))

    def observed_chunks(self, chunks):
        clock = Clock()
        client = Client(clock, chunks)
        with patch.object(probe.time, 'monotonic', clock.monotonic), \
             patch.object(probe.socket, 'create_connection', lambda *_args, **_kwargs: client):
            data, outcome = probe.observed_read('192.0.2.1', '/api/state', 'AUTH-CANARY', 'state')
        self.assertTrue(client.closed)
        self.assertNotIn('CANARY', json.dumps(outcome))
        self.assertNotIn('SECRET', json.dumps(outcome))
        for key in probe.OBSERVE_FIELDS:
            if key in outcome:
                self.assertIsInstance(outcome[key], (bool, int, float))
        return data, outcome, client

    def test_numeric_capture_full_body_then_reset_keeps_failure(self):
        body = b'{"ssid":"SSID-CANARY","token":"TOKEN-CANARY"}'
        head = b'HTTP/1.1 200 OK\r\nX-Private: HEADER-CANARY\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'
        data, outcome, client = self.observed_chunks([
            (.1, head[:-2]), (.2, head[-2:]+body[:5]), (.1, body[5:]),
            (1, ConnectionResetError('PRIVATE-CANARY'))])
        self.assertIsNone(data)
        self.assertFalse(outcome['ok'])
        self.assertEqual(outcome['errorCategory'], 'connection-reset')
        self.assertEqual((outcome['headerSeen'], outcome['statusCode'], outcome['contentLength'],
                          outcome['bodyBytesReceived']), (True, 200, len(body), len(body)))
        self.assertEqual((outcome['fullBodyAtMs'], outcome['recvErrorAtMs']), (400, 1400))
        self.assertEqual(client.reads, 4)  # Full Content-Length never skips EOF.

    def test_numeric_capture_partial_or_no_header_before_reset(self):
        head = b'HTTP/1.1 200 OK\r\nContent-Length: 80\r\n\r\n'
        data, outcome, _ = self.observed_chunks([(.1, head+b'SECRET'), (.2, ConnectionResetError('PRIVATE-CANARY'))])
        self.assertIsNone(data)
        self.assertEqual((outcome['statusCode'], outcome['contentLength'], outcome['bodyBytesReceived']), (200, 80, 6))
        self.assertNotIn('fullBodyAtMs', outcome)
        self.assertEqual(outcome['recvErrorAtMs'], 300)
        _, absent, _ = self.observed_chunks([(.1, b'HTTP/1.1'), (.2, ConnectionResetError('PRIVATE-CANARY'))])
        self.assertFalse(absent['headerSeen'])
        self.assertFalse(any(key in absent for key in ('statusCode', 'contentLength', 'bodyBytesReceived', 'fullBodyAtMs')))
        self.assertEqual(absent['recvErrorAtMs'], 300)

    def test_numeric_capture_header_limits_and_malformed_lengths(self):
        for field in (b'Content-Length: 2\r\nContent-Length: 2', b'Content-Length: -2',
                      b'Content-Length: +2', b'Content-Length: 99999', b'Content-Length: '+b'9'*128):
            _, outcome, _ = self.observed_chunks([(0, b'HTTP/1.1 200 OK\r\n'+field+b'\r\n\r\n{}'),
                                                 (0, ConnectionResetError('PRIVATE-CANARY'))])
            self.assertTrue(outcome['headerSeen'])
            self.assertEqual(outcome['bodyBytesReceived'], 2)
            self.assertNotIn('contentLength', outcome)
            self.assertNotIn('fullBodyAtMs', outcome)
            self.assertFalse(outcome['ok'])
        for header_size in (probe.OBSERVE_HEADER_BYTES, probe.OBSERVE_HEADER_BYTES+1):
            prefix = b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-Padding: '
            wire = prefix+b'a'*(header_size-len(prefix)-4)+b'\r\n\r\n{}'
            _, outcome, _ = self.observed_chunks([(0, wire), (0, ConnectionResetError('PRIVATE-CANARY'))])
            self.assertEqual(outcome['headerSeen'], header_size == probe.OBSERVE_HEADER_BYTES)
            self.assertEqual('contentLength' in outcome, header_size == probe.OBSERVE_HEADER_BYTES)

    def test_numeric_capture_success_still_waits_for_eof_and_deadline(self):
        head = b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n'
        data, outcome, client = self.observed_chunks([(.1, head+b'{}'), (.5, b'')])
        self.assertEqual(data, {})
        self.assertTrue(outcome['ok'])
        self.assertEqual((outcome['fullBodyAtMs'], outcome['latencyMs'], client.reads), (100, 600, 2))
        self.assertNotIn('recvErrorAtMs', outcome)
        data, outcome, _ = self.observed_chunks([(.1, head+b'{}'), (8, b'')])
        self.assertIsNone(data)
        self.assertFalse(outcome['ok'])
        self.assertEqual(outcome['errorCategory'], 'timeout')
        self.assertEqual((outcome['fullBodyAtMs'], outcome['recvErrorAtMs'], outcome['latencyMs']), (100, 7000, 7000))

    def run_rounds(self, rounds, fail_normal=False, wrong_boot=False, diagnostic_error=None,
                   revision_error=None, normal_error=None, setup_error=None, capture_progress=False,
                   diagnostic_delay=0,reset_reason=4):
        clock, clients, threads = Clock(), [], []
        self.progress_reports = []
        identity = 'aabbccddeeff'
        state = dict(deviceId=identity, power=True, firmware={'version': '1.15.1'},
                     ssid='SSID-CANARY', token='TOKEN-CANARY')

        def request(host, path, authorization, deadline=None,timing=None,launch_deadline=None):
            self.assertEqual((host, authorization), ('192.0.2.1', 'AUTH-CANARY'))
            natural=clock.now+probe.REQUEST_SECONDS
            effective=min(natural,deadline) if deadline is not None else natural
            if timing is not None:timing.update(started=clock.now,deadline=effective,budget=max(0,effective-clock.now),
                shortened=effective<natural,launched=launch_deadline is None or clock.now<launch_deadline)
            if launch_deadline is not None and clock.now>=launch_deadline:raise probe.ReadFailure('launch-window-expired')
            deadline=effective if deadline is not None else None
            if deadline is not None and clock.now >= deadline:
                raise TimeoutError('DEADLINE-SECRET-CANARY')
            if deadline is not None and path in ('/api/state','/api/effects') and normal_error:
                raise normal_error
            if path == '/api/state':
                if fail_normal and deadline is not None:
                    clock.sleep(min(7, deadline-clock.now))
                    raise TimeoutError('BODY-SECRET-CANARY')
                return state
            if path == '/api/effects':
                return [{'id': 1, 'name': 'Rainbow'}]  # Actual legacy catalog v1 shape.
            if path == '/api/revision':
                if clock.now and revision_error:
                    raise revision_error
                return {'target': identity, 'bootSession': 'wrong' if wrong_boot and clock.now else 'boot-1'}
            self.assertEqual(path, '/api/diagnostics')
            if diagnostic_delay:
                left = deadline-clock.now
                clock.sleep(min(diagnostic_delay, left))
                if diagnostic_delay >= left:
                    raise TimeoutError('DELAY-SECRET-CANARY')
            if diagnostic_error:
                raise diagnostic_error
            return dict(deviceId=identity, uptimeMs=int(clock.now*1000), timing={'maxAnimationFrameGapUs': 16000},
                        resetReason=reset_reason,
                        freeHeap=20000, minFreeHeap=12000, largestFreeBlock=16000,
                        loopStackMinimumBytes=2048, httpCloseStackMinimumBytes=1024)

        def connect(address, timeout):
            self.assertEqual((address, timeout), (('192.0.2.1', 80), 3))
            if setup_error:
                raise setup_error
            client = Client(clock)
            clients.append(client)
            return client

        def thread(target):
            instance = Thread(target)
            threads.append(instance)
            return instance

        with patch.object(probe, 'request', request), patch.object(probe.time, 'monotonic', clock.monotonic), \
             patch.object(probe.time, 'sleep', clock.sleep), patch.object(probe.socket, 'create_connection', connect), \
             patch.object(probe.threading, 'Thread', thread):
            report = probe.one_lamp('192.0.2.1', 'AUTH-CANARY', identity, rounds=rounds,
                                    progress=(lambda value: self.progress_reports.append(json.loads(json.dumps(value)))) if capture_progress else None)
        return report, clock, clients, threads

    def test_eight_rounds_reopen_every_profile_and_filter_secrets(self):
        report, clock, clients, threads = self.run_rounds(8)
        self.assertEqual((report['rounds'], report['trialSeconds'], report['requestDeadlineSeconds']), (8, 8, 7))
        self.assertEqual(len(report['trials']), 64)
        self.assertEqual(clock.now, 512)
        self.assertEqual(len(clients), 128)
        self.assertTrue(all(client.closed for client in clients))
        self.assertEqual(len(threads), 16)
        self.assertTrue(all(thread.started and thread.joined for thread in threads))
        self.assertEqual(sum(bool(client.options) for client in clients), 32)
        self.assertEqual([trial['roundIndex'] for trial in report['trials']], [r for r in range(1, 9) for _ in range(8)])
        for profile, path in (('stalled-reader', b'GET / HTTP/1.1'),
                              ('stalled-state-reader', b'GET /api/state HTTP/1.1')):
            matching = [clients[index*2:index*2+2] for index, trial in enumerate(report['trials']) if trial['profile'] == profile]
            self.assertEqual(len(matching), 8)
            self.assertTrue(all(client.reads == 0 and path in client.sent[0]
                                for pair in matching for client in pair))
        self.assertTrue(all(trial['trialElapsedMs'] == 8000 and trial['bootUnchanged'] for trial in report['trials']))
        self.assertTrue(all(len(trial['normalTraffic']) == 8 for trial in report['trials']))
        self.assertTrue(report['completed'] and report['passed'])
        self.assertTrue(all(trial['complete'] and trial['passed'] for trial in report['trials']))
        self.assertTrue(all(trial['diagnosticsRead']['statusCode'] == 200 and trial['revisionRead']['statusCode'] == 200 for trial in report['trials']))
        self.assertEqual((report['launchWindowSeconds'],report['profileLifetimeSeconds'],report['schedulingVersion']),(8,15,2))
        self.assertTrue(all(t['launchedNormalReads']==8 and t['shortenedNormalBudgets']==0 and t['resetReason']==4 for t in report['trials']))
        self.assertTrue(all(r['effectiveBudgetMs']==7000 and not r['shortenedBudget'] for t in report['trials'] for r in t['normalTraffic']))
        self.assertNotIn('CANARY', json.dumps(report))

    def test_trial_hard_end_boot_fence_and_default_round(self):
        report, clock, _, _ = self.run_rounds(1, fail_normal=True, wrong_boot=True)
        self.assertEqual(clock.now, 64)
        self.assertTrue(all(trial['trialElapsedMs'] == 8000 for trial in report['trials']))
        self.assertTrue(all(not trial['bootUnchanged'] for trial in report['trials']))
        self.assertTrue(all(not trial['normalTraffic'][0]['ok'] for trial in report['trials']))
        self.assertTrue(report['completed'] and not report['passed'])
        self.assertNotIn('CANARY', json.dumps(report))
        for invalid in (0, 9, -1, True, '8', 1.5):
            with self.subTest(rounds=invalid), patch.object(probe, 'request', side_effect=AssertionError('no I/O expected')):
                with self.assertRaises(ValueError):
                    probe.one_lamp('192.0.2.1', 'AUTH-CANARY', rounds=invalid)

    def test_diagnostic_failure_retains_normal_results_and_revision(self):
        report, clock, clients, _ = self.run_rounds(1, diagnostic_error=probe.ReadFailure('http-status', 503), capture_progress=True)
        self.assertEqual((len(report['trials']), clock.now), (8, 64))
        self.assertTrue(report['completed'] and not report['passed'])
        self.assertTrue(all(client.closed for client in clients))
        for trial in report['trials']:
            self.assertEqual(len(trial['normalTraffic']), 8)
            self.assertTrue(all(item['ok'] for item in trial['normalTraffic']))
            self.assertEqual(trial['diagnosticsRead']['errorCategory'], 'http-status')
            self.assertEqual(trial['diagnosticsRead']['statusCode'], 503)
            self.assertIsNone(trial['timing'])
            self.assertTrue(trial['revisionRead']['ok'] and trial['bootUnchanged'])
            self.assertTrue(trial['complete'] and not trial['passed'])
        # The callback receives the current trial before post-read failure;
        # earlier traffic remains available even if the caller later stops.
        partial = [value['trials'][-1] for value in self.progress_reports if value['trials'] and not value['trials'][-1]['complete']]
        self.assertTrue(any(len(trial['normalTraffic']) == 8 and trial['diagnosticsRead'] is None for trial in partial))
        self.assertTrue(any(trial['diagnosticsRead'] and trial['revisionRead'] is None for trial in partial))
        self.assertTrue(self.progress_reports[-1]['completed'])
        self.assertFalse(self.progress_reports[-1]['passed'])
        self.assertIsNone(self.progress_reports[-1]['activeTrial'])
        self.assertNotIn('CANARY', json.dumps(self.progress_reports))

    def test_revision_and_normal_failures_stay_failed_and_private(self):
        report, _, _, _ = self.run_rounds(1, normal_error=probe.ReadFailure('invalid-json', 200),
                                         revision_error=TimeoutError('BODY-SECRET-CANARY'))
        self.assertTrue(report['completed'] and not report['passed'])
        for trial in report['trials']:
            self.assertEqual(len(trial['normalTraffic']), 8)
            self.assertTrue(all(item['errorCategory'] == 'invalid-json' and item['statusCode'] == 200 and not item['ok'] for item in trial['normalTraffic']))
            self.assertTrue(trial['diagnosticsRead']['ok'])
            self.assertEqual(trial['revisionRead']['errorCategory'], 'timeout')
            self.assertIsNone(trial['bootUnchanged'])  # Unverified differs from a confirmed changed boot.
            self.assertTrue(trial['complete'] and not trial['passed'])
        self.assertNotIn('CANARY', json.dumps(report))
        self.assertNotIn('SECRET', json.dumps(report))

    def test_slow_client_setup_failure_is_retained_without_unbound_clock(self):
        report, _, clients, _ = self.run_rounds(1, setup_error=ConnectionRefusedError('ADDRESS-SECRET-CANARY'))
        self.assertEqual(len(report['trials']), 8)
        self.assertEqual(clients, [])
        self.assertTrue(report['completed'] and not report['passed'])
        for trial in report['trials']:
            self.assertFalse(trial['trafficComplete'])
            self.assertEqual(trial['normalTraffic'], [])
            self.assertEqual(trial['setupFailure'], {'errorCategory': 'connection-refused'})
            self.assertEqual(trial['trialElapsedMs'], 0)
            self.assertTrue(trial['diagnosticsRead']['ok'] and trial['revisionRead']['ok'])
            self.assertTrue(trial['complete'] and not trial['passed'])
        self.assertNotIn('CANARY', json.dumps(report))

    def test_post_reads_share_one_deadline_and_keep_unknown_boot(self):
        report, clock, _, _ = self.run_rounds(1, diagnostic_delay=7)
        self.assertEqual(clock.now, 8*(probe.TRIAL_SECONDS+probe.REQUEST_SECONDS))
        self.assertTrue(report['completed'] and not report['passed'])
        for trial in report['trials']:
            self.assertEqual(trial['trialElapsedMs'], 8000)
            self.assertEqual(trial['diagnosticsRead']['latencyMs'], 7000)
            self.assertEqual(trial['revisionRead']['latencyMs'], 0)
            self.assertEqual(trial['diagnosticsRead']['errorCategory'], 'timeout')
            self.assertEqual(trial['revisionRead']['errorCategory'], 'timeout')
            self.assertIsNone(trial['bootUnchanged'])
            self.assertIsNone(trial['timing'])
            self.assertEqual(len(trial['normalTraffic']), 8)
            self.assertFalse(trial['passed'])
        self.assertNotIn('CANARY', json.dumps(report))

    def test_reset_reason_is_numeric_only(self):
        for value in ('PRIVATE-CANARY',True,-1,0x100000000):
            report,_,_,_=self.run_rounds(1,reset_reason=value)
            self.assertTrue(all('resetReason' not in t for t in report['trials']))
            self.assertNotIn('CANARY',json.dumps(report))

    def _actual_round_last_launch(self,last_delay):
        # Exercise one_lamp + observed_read + request together. Only the wire,
        # clock and thread creation are mocked; deadline/scheduling decisions
        # run through the production helper rather than a fake request method.
        clock=Clock();clients=[];slow=[];threads=[];events=[];normal_counts={}
        identity='aabbccddeeff';real_event=probe.threading.Event
        case=self

        class WireClient(Client):
            def __init__(self,is_slow):
                super().__init__(clock);self.is_slow=is_slow;self.normal=False;self.last_launch=False

            def sendall(self,data):
                super().sendall(data)
                if self.is_slow:return
                path=data.split(b' ',2)[1].decode()
                if path=='/api/state':body={'deviceId':identity,'power':True,'firmware':{'version':'1.15.1'},'ssid':'SSID-CANARY'}
                elif path=='/api/effects':body=[{'id':1,'name':'Rainbow'}]
                elif path=='/api/revision':body={'target':identity,'bootSession':'boot-1'}
                else:body={'deviceId':identity,'resetReason':4}
                if slow and path in ('/api/state','/api/effects'):
                    profile_index=len(slow)//2-1
                    ordinal=normal_counts.get(profile_index,0)
                    normal_counts[profile_index]=ordinal+1
                    self.normal=True;self.last_launch=ordinal==7
                delay=last_delay if self.last_launch else 0
                self.chunks=[(delay,b'HTTP/1.1 200 OK\r\n\r\n'+json.dumps(body).encode()),(0,b'')]

            def recv(self,limit):
                if self.last_launch:
                    profile=probe.PROFILES[len(slow)//2-1]
                    if profile!='abrupt-disconnect':case.assertTrue(all(not c.closed for c in slow[-2:]))
                    if profile.startswith('trickled'):
                        case.assertFalse(events[-1].is_set());case.assertFalse(threads[-1].joined)
                result=super().recv(limit)
                if self.last_launch and probe.PROFILES[len(slow)//2-1]!='abrupt-disconnect':
                    case.assertTrue(all(not c.closed for c in slow[-2:]))
                return result

        def connect(address,timeout):
            self.assertEqual(address,('192.0.2.1',80))
            client=WireClient(timeout<=3);clients.append(client)
            if client.is_slow:slow.append(client)
            return client

        def event():
            value=real_event();events.append(value);return value

        def thread(target):
            value=Thread(target);threads.append(value);return value

        with patch.object(probe.time,'monotonic',clock.monotonic),patch.object(probe.time,'sleep',clock.sleep), \
             patch.object(probe.socket,'create_connection',connect),patch.object(probe.threading,'Event',event), \
             patch.object(probe.threading,'Thread',thread):
            report=probe.one_lamp('192.0.2.1','AUTH-CANARY',identity,rounds=1)
        return report,clock,clients,threads

    def test_actual_request_last_launch_keeps_full_budget_and_slow_clients(self):
        report,clock,clients,threads=self._actual_round_last_launch(6.5)
        self.assertTrue(report['completed'] and report['passed'])
        self.assertEqual(clock.now,108)
        self.assertTrue(all(c.closed for c in clients))
        self.assertTrue(all(t.joined for t in threads))
        for trial in report['trials']:
            self.assertEqual(trial['profileEndedMs'],13500)
            self.assertEqual(trial['activePhaseEndedMs'],13500)
            self.assertEqual(trial['profileDeadlineOverrunMs'],0)
            last=trial['normalTraffic'][-1]
            self.assertEqual((last['requestStartedMs'],last['requestEndedMs'],last['effectiveDeadlineMs']),(7000,13500,14000))
            self.assertEqual(last['effectiveBudgetMs'],7000)
            self.assertFalse(last['shortenedBudget'])
            self.assertTrue(last['launched'])
        self.assertNotIn('CANARY',json.dumps(report))

    def test_actual_last_request_timeout_uses_full_seven_seconds(self):
        report,clock,clients,threads=self._actual_round_last_launch(7)
        self.assertTrue(report['completed'] and not report['passed'])
        self.assertEqual(clock.now,112)
        self.assertTrue(all(c.closed for c in clients) and all(t.joined for t in threads))
        for trial in report['trials']:
            self.assertEqual(trial['profileEndedMs'],14000)
            self.assertEqual(trial['profileDeadlineOverrunMs'],0)
            last=trial['normalTraffic'][-1]
            self.assertFalse(last['ok'])
            self.assertEqual(last['errorCategory'],'timeout')
            self.assertEqual(last['latencyMs'],7000)
            self.assertEqual(last['effectiveBudgetMs'],7000)
            self.assertEqual((last['requestStartedMs'],last['requestEndedMs']),(7000,14000))
            self.assertFalse(last['shortenedBudget'])
            self.assertEqual(trial['shortenedNormalBudgets'],0)


if __name__ == '__main__':
    unittest.main()
