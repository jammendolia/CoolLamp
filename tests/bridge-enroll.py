"""Host regressions exercise the real enrollment driver and bounded HTTP reader.

All requests are mocked or loopback-only. No lamp, bridge, USB, or credentials.
"""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bridge_enroll", ROOT / "tools/bridge-enroll.py")
enroll = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(enroll)
CONTEXT = enroll.check_context("192.0.2.20", "5894af4aec24", "8c4856dab734", "c8d27ebafed5d956")
NORMAL_BOOT = "1111111111111111"
ADVERT_BOOT = "7973bcd80b26a279"
COMMISSION_BOOT = "2222222222222222"
TARGET_MESH_BOOT = "3333333333333333"
TOKEN = "abcdef0123456789abcdef0123456789"


class Broker:
    host = CONTEXT["host"]

    def __init__(self):
        self.calls = []
        self.state = dict(deviceId=CONTEXT["broker"], token=TOKEN, uptimeMs=10000)
        self.mesh = dict(version=1, deviceId=CONTEXT["broker"], fleetId=CONTEXT["fleetId"],
                         available=True, boot=NORMAL_BOOT, snapshotUptimeMs=10000, peers=[])
        self.new = dict(version=1, broker=CONTEXT["broker"], candidates=[dict(
            id=CONTEXT["target"], broker=CONTEXT["broker"], online=True, claimed=False,
            observedAt=9990, comparisonVersion=2, targetBoot=ADVERT_BOOT)])
        self.phase = "exchange"
        self.pattern = [0, 7, 13, 15]
        self.start_error = None
        self.start_change = None
        self.status_error = None
        self.status_code = 200
        self.receipt = None
        self.journal_path = None

    def request(self, method, path, fields=None, token=None, deadline=None):
        self.calls.append((method, path, copy.deepcopy(fields), token))
        if path == "/api/state":
            return 200, copy.deepcopy(self.state)
        if path == "/api/mesh/status":
            return 200, copy.deepcopy(self.mesh)
        if path == "/api/mesh/new":
            return 200, copy.deepcopy(self.new)
        assert token == TOKEN
        if path == "/api/mesh/enroll/start":
            assert fields["comparisonVersion"] == 1
            # The file must already exist, be complete and explicitly prepared
            # when the actual driver's only start POST reaches transport.
            journal = enroll.read_journal(self.journal_path)
            assert journal["outcome"] == "prepared"
            assert fields["requestId"] == journal["requestId"]
            self.receipt = dict(version=1, broker=fields["broker"], target=fields["target"],
                requestId=fields["requestId"], fleetId=CONTEXT["fleetId"],
                targetBoot=ADVERT_BOOT, brokerBoot=COMMISSION_BOOT, expiresAt=130000,
                phase="exchange", pattern=[0, 0, 0, 0], approved=False, uncertain=False,
                confirmedAbsent=False, comparison=dict(version=1, entropyBits=16))
            if self.start_change:
                self.receipt.update(self.start_change)
            if self.start_error:
                raise enroll.EnrollError(self.start_error)
            return 202, copy.deepcopy(self.receipt)
        assert path == "/api/mesh/enroll/status"
        if self.status_error:
            raise enroll.EnrollError(self.status_error)
        if self.status_code != 200:
            return self.status_code, {}
        assert set(fields) == {"broker", "target", "requestId"}
        assert all(fields[key] == self.receipt[key] for key in fields)
        reply = copy.deepcopy(self.receipt)
        reply.update(phase=self.phase, pattern=self.pattern[:], approved=self.phase in ("approved", "complete"))
        return 200, reply

    def count_start(self):
        return sum(path == "/api/mesh/enroll/start" for _, path, _, _ in self.calls)


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "enrollment.json"
        self.broker = Broker()
        self.broker.journal_path = self.path
        self.output = []
        self.driver = enroll.Enrollment(self.broker, self.output.append)

    def start(self):
        return self.driver.start(CONTEXT, self.path, ADVERT_BOOT)

    def assert_error(self, category, call):
        with self.assertRaises(enroll.EnrollError) as caught:
            call()
        self.assertEqual(caught.exception.category, category)

    def test_inspect_pins_fresh_advert_separate_from_normal_boot(self):
        result = self.driver.inspect(CONTEXT, ADVERT_BOOT)
        self.assertEqual(result["comparisonVersion"], 1)
        self.assertEqual(result["normalBrokerBoot"], NORMAL_BOOT)
        self.assertEqual(result["targetAdvertBoot"], ADVERT_BOOT)
        self.assertEqual(result["candidateAgeMs"], 10)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.broker.count_start(), 0)

    def test_durable_single_start_success_colors_and_fleet_proof(self):
        result = self.start()
        self.assertEqual(result["phase"], "exchange")
        self.assertNotIn("colors", result)
        self.broker.phase = "confirm"
        result = self.driver.status(self.path)
        self.assertEqual(result["colors"], ["Red", "Sky blue", "Warm white", "White"])
        self.assertIn("PRG", result["instruction"])
        # Already-existing start is strictly status-only, even when the new
        # candidate inventory disappears after joining the household.
        self.broker.new["candidates"] = []
        self.broker.phase = "complete"
        self.broker.mesh["peers"] = [dict(id=CONTEXT["target"], online=True, hops=1, boot=TARGET_MESH_BOOT)]
        result = self.start()
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["fleetPresence"]["normalTargetBoot"], TARGET_MESH_BOOT)
        self.assertEqual(self.broker.count_start(), 1)
        saved = enroll.read_journal(self.path)
        self.assertEqual(saved["targetMeshBoot"], TARGET_MESH_BOOT)
        self.assertEqual(saved["commissionBrokerBoot"], COMMISSION_BOOT)
        for forbidden in (TOKEN, "coollamp", "password", "authorization", "fleetKey"):
            self.assertNotIn(forbidden, self.path.read_text())
            self.assertNotIn(forbidden, json.dumps(self.output))

    def test_all_red_confirmation_is_valid_not_exchange(self):
        self.start()
        self.broker.phase = "confirm"
        self.broker.pattern = [0, 0, 0, 0]
        result = self.driver.status(self.path)
        self.assertEqual(result["colors"], ["Red"] * 4)

    def test_lost_start_and_repeated_invocation_never_replay(self):
        self.broker.start_error = "connection-reset"
        result = self.start()
        self.assertEqual(result["outcome"], "uncertain")
        self.broker.phase = "confirm"
        result = self.start()
        self.assertEqual(result["phase"], "confirm")
        self.assertEqual(self.broker.count_start(), 1)
        last = self.broker.calls[-1]
        self.assertEqual(last[1], "/api/mesh/enroll/status")
        self.assertEqual(last[2]["requestId"], enroll.read_journal(self.path)["requestId"])

    def test_unavailable_mesh_during_status_is_accepted_without_false_proof(self):
        self.start()
        self.broker.mesh["available"] = False
        self.broker.mesh["peers"] = [dict(id=CONTEXT["target"], online=True, hops=1, boot=TARGET_MESH_BOOT)]
        self.broker.phase = "confirm"
        result = self.driver.status(self.path)
        self.assertIn("colors", result)
        self.assertNotIn("fleetPresence", result)

    def test_normal_broker_reboot_does_not_query_replacement_session(self):
        self.start()
        self.broker.mesh["boot"] = "4444444444444444"
        self.broker.mesh["peers"] = [dict(id=CONTEXT["target"], online=True, hops=1, boot=TARGET_MESH_BOOT)]
        before = len(self.broker.calls)
        result = self.start()
        self.assertEqual(result["errorCategory"], "broker-reboot")
        self.assertEqual(result["outcome"], "uncertain")
        self.assertTrue(result["fleetPresence"]["verified"])
        self.assertFalse(any("enroll/" in path for _, path, _, _ in self.broker.calls[before:]))
        self.assertEqual(self.broker.count_start(), 1)

    def test_missing_receipt_is_not_absence(self):
        self.start()
        self.broker.status_code = 404
        result = self.driver.status(self.path)
        self.assertEqual(result["errorCategory"], "missing-receipt")
        self.assertEqual(result["outcome"], "uncertain")
        self.assertFalse(result["confirmedAbsent"])
        self.assertEqual(self.broker.count_start(), 1)

    def test_identity_fleet_token_and_candidate_guards_before_journal(self):
        cases = [
            ("identity-mismatch", lambda: self.broker.state.update(deviceId="8c4856dab734")),
            ("invalid-shape", lambda: self.broker.state.update(token=None)),
            ("fleet-mismatch", lambda: self.broker.mesh.update(fleetId="7777777777777777")),
            ("precondition-failed", lambda: self.broker.mesh.update(available=False)),
            ("candidate-unavailable", lambda: self.broker.new.update(candidates=[])),
            ("candidate-stale", lambda: self.broker.new["candidates"][0].update(observedAt=(10000-12000) & 0xffffffff)),
            ("target-boot-changed", lambda: self.broker.new["candidates"][0].update(targetBoot="5555555555555555")),
            ("invalid-shape", lambda: self.broker.new["candidates"].append(copy.deepcopy(self.broker.new["candidates"][0]))),
            ("invalid-shape", lambda: self.broker.new["candidates"][0].update(comparisonVersion=True)),
            ("invalid-shape", lambda: self.broker.new["candidates"][0].update(observedAt=True)),
            ("invalid-shape", lambda: self.broker.new["candidates"][0].update(claimed=True)),
        ]
        for category, mutate in cases:
            with self.subTest(category=category):
                self.broker = Broker()
                self.broker.journal_path = self.path
                self.driver = enroll.Enrollment(self.broker)
                mutate()
                self.assert_error(category, self.start)
                self.assertEqual(self.broker.count_start(), 0)
                self.assertFalse(self.path.exists())

    def test_candidate_uptime_rollover_is_fresh(self):
        self.broker.mesh["snapshotUptimeMs"] = 3
        self.broker.new["candidates"][0]["observedAt"] = 0xfffffff9
        self.assertEqual(self.driver.inspect(CONTEXT)["candidateAgeMs"], 10)

    def test_target_boot_change_after_start_suppresses_colors_and_never_replays(self):
        self.broker.start_change = dict(targetBoot="6666666666666666", phase="confirm", pattern=[1, 2, 3, 4])
        result = self.start()
        self.assertEqual(result["outcome"], "uncertain")
        self.assertEqual(result["errorCategory"], "target-boot-changed")
        self.assertNotIn("colors", result)
        self.start()
        self.assertEqual(self.broker.count_start(), 1)

    def test_original_broker_boot_and_pattern_are_pinned(self):
        self.start()
        self.broker.phase = "confirm"
        self.driver.status(self.path)
        self.broker.pattern[0] = 1
        result = self.driver.status(self.path)
        self.assertEqual(result["errorCategory"], "transcript-changed")
        self.assertNotIn("colors", result)
        self.broker.pattern[0] = 0
        self.broker.receipt["brokerBoot"] = "8888888888888888"
        result = self.driver.status(self.path)
        self.assertEqual(result["errorCategory"], "transcript-changed")

    def test_identity_or_token_failure_on_resume_cannot_start(self):
        self.start()
        self.broker.state["deviceId"] = CONTEXT["target"]
        result = self.start()
        self.assertEqual(result["errorCategory"], "identity-mismatch")
        self.assertEqual(self.broker.count_start(), 1)

    def test_journal_creation_failure_prevents_start(self):
        with patch.object(enroll.os, "fsync", side_effect=OSError("private exception text")):
            self.assert_error("journal-write-failed", self.start)
        self.assertEqual(self.broker.count_start(), 0)
        # A failed flush may leave a prepared journal; it still forbids replay.
        self.broker.status_code = 404
        result = self.start()
        self.assertEqual(result["outcome"], "uncertain")
        self.assertEqual(self.broker.count_start(), 0)

    def test_journal_context_tampering_and_secret_fields_rejected(self):
        self.start()
        wrong = dict(CONTEXT, target="aabbccddee24")
        self.assert_error("identity-mismatch", lambda: self.driver.start(wrong, self.path))
        saved = enroll.read_journal(self.path)
        saved["token"] = TOKEN
        self.path.write_text(json.dumps(saved))
        self.assert_error("journal-invalid", lambda: self.driver.status(self.path))
        self.assertEqual(self.broker.count_start(), 1)

    def test_json_failures_are_safe_and_ambiguous_objects_rejected(self):
        for raw in (b'{"deviceId":"a","deviceId":"b"}', b'{"token":NaN}', b'{"token":Infinity}', b'{"token":', b'\xff'):
            self.assert_error("invalid-json", lambda: enroll.decode_json(raw))
        for invalid in ("8c4856dab735", "000000000000", "FFFFFFFFFFFF"):
            self.assertFalse(enroll.identity(invalid))

    def test_poll_timeout_is_uncertain_without_replay(self):
        self.start()
        self.broker.status_error = "timeout"
        result = self.driver.status(self.path, wait=120)
        self.assertEqual(result["errorCategory"], "timeout")
        self.assertEqual(self.broker.count_start(), 1)

    def test_malformed_receipt_types_and_wire_bounds(self):
        for change in (dict(pattern=[True, 1, 2, 3]), dict(pattern=[16, 1, 2, 3]),
                       dict(approved=1), dict(expiresAt=True), dict(version=True),
                       dict(phase="complete", approved=False),
                       dict(phase="confirm", approved=True),
                       dict(phase="approved", approved=True, confirmedAbsent=True),
                       dict(phase="failed", uncertain=False, confirmedAbsent=False)):
            with self.subTest(change=change):
                self.broker = Broker()
                self.broker.journal_path = self.path
                self.broker.start_change = change
                self.driver = enroll.Enrollment(self.broker)
                result = self.start()
                self.assertEqual(result["outcome"], "uncertain")
                self.assertNotIn("colors", result)
                self.path.unlink()

    def test_authenticated_failed_receipt_preserves_explicit_absence(self):
        self.broker.start_change = dict(phase="failed", confirmedAbsent=True)
        self.assertEqual(self.start()["outcome"], "confirmed-absent")
        self.assertEqual(self.broker.count_start(), 1)

    def test_completed_receipt_survives_later_mesh_read_loss_and_reboot(self):
        self.start()
        self.broker.phase = "complete"
        original = self.broker.request
        meshes = 0

        def failed_presence(*args, **kwargs):
            nonlocal meshes
            if args[1] == "/api/mesh/status":
                meshes += 1
                if meshes == 2:
                    raise enroll.EnrollError("connection-reset")
            return original(*args, **kwargs)

        self.broker.request = failed_presence
        result = self.driver.status(self.path)
        self.assertEqual(result["outcome"], "complete")
        self.assertFalse(result["uncertain"])
        self.assertEqual(result["errorCategory"], "connection-reset")
        self.assertEqual(enroll.read_journal(self.path)["outcome"], "complete")
        self.broker.request = original
        self.broker.mesh["boot"] = "4444444444444444"
        result = self.driver.status(self.path)
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["errorCategory"], "broker-reboot")
        self.assertEqual(self.broker.count_start(), 1)

    def test_post_send_journal_failure_is_explicit_and_never_replays(self):
        original = enroll.write_journal

        def fail_update(path, data, create=False):
            if not create:
                raise enroll.EnrollError("journal-write-failed")
            return original(path, data, create)

        with patch.object(enroll, "write_journal", side_effect=fail_update):
            result = self.start()
        self.assertEqual(result["outcome"], "uncertain")
        self.assertFalse(result["journalWriteConfirmed"])
        self.broker.phase = "confirm"
        self.start()
        self.assertEqual(self.broker.count_start(), 1)


class Loopback:
    """One local server response; never opens an external connection."""
    def __init__(self, parts, pauses=None):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]
        self.parts, self.pauses = parts, pauses or [0] * len(parts)
        self.request = b""
        self.thread = threading.Thread(target=self.serve, daemon=True)

    def serve(self):
        try:
            self.listener.settimeout(2)
            client, _ = self.listener.accept()
            with client:
                client.settimeout(1)
                while b"\r\n\r\n" not in self.request:
                    self.request += client.recv(2048)
                for chunk, pause in zip(self.parts, self.pauses):
                    time.sleep(pause)
                    client.sendall(chunk)
        except OSError:
            pass

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.listener.close()
        self.thread.join(timeout=2)


def response(body, headers=b"", code=200, length=None):
    return (f"HTTP/1.1 {code} OK\r\nContent-Type: application/json\r\nContent-Length: {len(body) if length is None else length}\r\n".encode()
            + headers + b"\r\n" + body)


class HttpTests(unittest.TestCase):
    def read(self, wire, method="GET", fields=None, token=None, deadline=None):
        with Loopback([wire]) as local:
            result = enroll.HttpClient("127.0.0.1", "test private password", local.port).request(
                method, "/api/mesh/enroll/status" if method == "POST" else "/api/state",
                fields, token, deadline)
            return result, local.request

    def test_actual_reader_complete_state_and_post_guard(self):
        (code, data), _ = self.read(response(json.dumps(dict(deviceId=CONTEXT["broker"], token=TOKEN, uptimeMs=100)).encode()))
        self.assertEqual(code, 200)
        self.assertEqual(enroll.check_state(data, CONTEXT["broker"]), TOKEN)
        fields = dict(target=CONTEXT["target"], requestId=ADVERT_BOOT, broker=CONTEXT["broker"])
        (_, _), request = self.read(response(b'{}'), "POST", fields, TOKEN)
        self.assertIn(b"X-Lamp-Token: " + TOKEN.encode() + b"\r\n", request)
        self.assertIn(b"target=8c4856dab734", request)
        client = enroll.HttpClient("127.0.0.1", "private", 9)
        with self.assertRaises(enroll.EnrollError) as caught:
            client.request("POST", "/api/mesh/enroll/status", fields)
        self.assertEqual(caught.exception.category, "precondition-failed")

    def test_truncated_state_never_accepts_partial_token(self):
        partial = b'{"deviceId":"5894af4aec24","token":"' + TOKEN.encode() + b'"'
        with self.assertRaises(enroll.EnrollError) as caught:
            self.read(response(partial, length=len(partial) + 2))
        self.assertEqual(caught.exception.category, "connection-closed")

    def test_actual_plaintext_missing_receipt_becomes_uncertain(self):
        # LampNetwork's legacy wrapper labels this plain-text 404 as JSON.
        # Both variants must retain the status and never restart enrollment.
        for content_type in ("text/plain", "application/json"):
            with self.subTest(content_type=content_type), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "attempt.json"
                broker = Broker()
                broker.journal_path = path
                enroll.Enrollment(broker).start(CONTEXT, path)
                journal = enroll.read_journal(path)
                body = b"Commissioning session not found"
                wire = (f"HTTP/1.1 404 Not Found\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n".encode() + body)
                with Loopback([wire]) as local:
                    driver = enroll.Enrollment(enroll.HttpClient("127.0.0.1", "private", local.port))
                    with self.assertRaises(enroll.EnrollError) as caught:
                        driver.query(journal, TOKEN, path, time.monotonic() + 1)
                    self.assertEqual(caught.exception.category, "missing-receipt")
                    self.assertEqual(caught.exception.status, 404)
                    self.assertEqual(broker.count_start(), 1)

    def test_redirect_oversize_duplicate_length_and_malformed_json(self):
        cases = [(response(b'{}', b"Location: http://127.0.0.1/other\r\n", 302), "http-status"),
                 (response(b'', length=enroll.MAX_BODY + 1), "response-limit"),
                 (response(b'{}', b"Content-Length: 2\r\n"), "invalid-framing"),
                 (response(b'{}', b"Transfer-Encoding: chunked\r\n"), "invalid-framing"),
                 (response(b'{"token":"a","token":"b"}'), "invalid-json"),
                 (response(b'{"token":'), "invalid-json"),
                 (b"HTTP/1.1 200 OK\r\nX-Fill: " + b"x" * enroll.MAX_HEADER, "response-limit")]
        for wire, category in cases:
            with self.subTest(category=category):
                with self.assertRaises(enroll.EnrollError) as caught:
                    self.read(wire)
                self.assertEqual(caught.exception.category, category)

    def test_trickle_cannot_extend_absolute_deadline(self):
        header = response(b'', length=4)
        with Loopback([header, b'{', b'}'], [0, .06, .08]) as local:
            started = time.monotonic()
            with self.assertRaises(enroll.EnrollError) as caught:
                enroll.HttpClient("127.0.0.1", "private", local.port).request(
                    "GET", "/api/state", deadline=started + .1)
            self.assertEqual(caught.exception.category, "timeout")
            self.assertLess(time.monotonic() - started, .3)

    def test_partial_state_in_actual_driver_never_journals_or_starts(self):
        partial = b'{"deviceId":"5894af4aec24","token":"' + TOKEN.encode() + b'"'
        with tempfile.TemporaryDirectory() as folder, Loopback([response(partial, length=len(partial) + 20)]) as local:
            context = dict(CONTEXT, host="127.0.0.1")
            path = Path(folder) / "attempt.json"
            with self.assertRaises(enroll.EnrollError):
                enroll.Enrollment(enroll.HttpClient("127.0.0.1", "private", local.port)).start(context, path)
            self.assertFalse(path.exists())
            self.assertTrue(local.request.startswith(b"GET /api/state "))

    def test_cli_errors_do_not_echo_private_exceptions_or_password(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), patch.object(enroll.HttpClient, "request", side_effect=enroll.EnrollError("connection-reset")), patch.dict(enroll.os.environ, {"BRIDGE_BROKER_TEST_PASSWORD": "do-not-log-me"}):
            code = enroll.main(["inspect", "--host", CONTEXT["host"], "--broker", CONTEXT["broker"],
                "--target", CONTEXT["target"], "--fleet", CONTEXT["fleetId"], "--password-env", "BRIDGE_BROKER_TEST_PASSWORD"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(err.getvalue())["errorCategory"], "connection-reset")
        self.assertNotIn("do-not-log-me", err.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
