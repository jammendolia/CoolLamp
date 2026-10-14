#!/usr/bin/env python3
"""Physically approved bridge enrollment through one already-owned lamp.

Only public session metadata is journaled. No fleet credential leaves firmware.
Every journal permits at most one start POST; resuming always queries that tuple.
The first state response must be complete, including identity and the boot token.
"""
import argparse
import base64
import getpass
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import time
from urllib.parse import urlencode

REQUEST_SECONDS = 8
MAX_HEADER = 4096
MAX_BODY = 16384
MAX_REQUEST = 2048
MAX_JOURNAL = 4096
CANDIDATE_MS = 12000
COLORS = ("Red", "Orange", "Yellow", "Lime", "Green", "Mint", "Cyan",
          "Sky blue", "Blue", "Violet", "Purple", "Magenta", "Pink",
          "Warm white", "Cool white", "White")
PHASES = ("exchange", "confirm", "approved", "complete", "failed")
HEX_ID = re.compile(r"[0-9a-f]{12}\Z")
HEX_BOOT = re.compile(r"[0-9a-f]{16}\Z")
HEX_TOKEN = re.compile(r"[0-9a-f]{32}\Z")
JOURNAL_KEYS = frozenset(("schema", "host", "broker", "target", "fleetId",
    "requestId", "comparisonVersion", "normalBrokerBoot", "targetAdvertBoot",
    "outcome", "errorCategory", "commissionBrokerBoot", "expiresAt", "pattern",
    "phase", "approved", "uncertain", "confirmedAbsent", "targetMeshBoot"))
OUTCOMES = ("prepared", "pending", "complete", "confirmed-absent", "uncertain")
ERRORS = frozenset(("timeout", "connection-reset", "connection-closed",
    "network-error", "response-limit", "request-limit", "invalid-framing",
    "http-status", "invalid-json", "invalid-shape", "identity-mismatch",
    "fleet-mismatch", "boot-changed", "candidate-unavailable", "candidate-stale",
    "target-boot-changed", "transcript-changed", "missing-receipt", "broker-reboot",
    "journal-invalid", "journal-write-failed", "precondition-failed"))


class EnrollError(ValueError):
    """Only a fixed category and numeric status may reach diagnostics."""
    def __init__(self, category, status=None):
        super().__init__(category)
        self.category = category if category in ERRORS else "invalid-shape"
        self.status = status


def uint32(value):
    return type(value) is int and 0 <= value <= 0xffffffff


def hex_value(value, pattern, nonzero=True):
    return isinstance(value, str) and bool(pattern.fullmatch(value)) and (
        not nonzero or int(value, 16) != 0)


def identity(value):
    # Canonical IDs reverse the STA MAC bytes; its first radio byte is last.
    return (hex_value(value, HEX_ID) and value != "ffffffffffff" and
            not int(value[-2:], 16) & 1)


def host_value(value):
    try:
        return str(ipaddress.IPv4Address(value)) == value
    except (ValueError, TypeError):
        return False


def require(condition, category="invalid-shape"):
    if not condition:
        raise EnrollError(category)


def remaining(deadline):
    left = deadline - time.monotonic()
    if left <= 0:
        raise EnrollError("timeout")
    return left


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EnrollError("invalid-json")
        result[key] = value
    return result


def decode_json(data):
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=unique_object,
                           parse_constant=lambda _: (_ for _ in ()).throw(
                               EnrollError("invalid-json")))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        raise EnrollError("invalid-json") from None
    require(type(value) is dict, "invalid-shape")
    return value


class HttpClient:
    """IPv4-only, no redirects, one shrinking deadline for all socket I/O.

    The firmware emits Content-Length. Unsupported/chunked/ambiguous framing is
    rejected rather than accepting a partial token or an unbounded response.
    """
    def __init__(self, host, password, port=80):
        require(host_value(host), "precondition-failed")
        require(isinstance(password, str) and 1 <= len(password.encode("utf-8")) <= 128,
                "precondition-failed")
        require(type(port) is int and 1 <= port <= 65535, "precondition-failed")
        self.host, self.port = host, port
        self.authorization = "Basic " + base64.b64encode(
            ("lamp:" + password).encode("utf-8")).decode("ascii")

    def request(self, method, path, fields=None, token=None, deadline=None):
        require(method in ("GET", "POST") and path in (
            "/api/state", "/api/mesh/status", "/api/mesh/new",
            "/api/mesh/enroll/start", "/api/mesh/enroll/status"), "precondition-failed")
        require((method == "POST") == (fields is not None), "precondition-failed")
        if method == "POST":
            require(hex_value(token, HEX_TOKEN, nonzero=False), "precondition-failed")
        deadline = min(time.monotonic() + REQUEST_SECONDS, deadline) if deadline is not None else time.monotonic() + REQUEST_SECONDS
        body = urlencode(fields).encode("ascii") if fields is not None else b""
        headers = (f"{method} {path} HTTP/1.1\r\nHost: {self.host}\r\n"
                   f"Authorization: {self.authorization}\r\nConnection: close\r\n")
        if method == "POST":
            headers += (f"X-Lamp-Token: {token}\r\n"
                        "Content-Type: application/x-www-form-urlencoded\r\n"
                        f"Content-Length: {len(body)}\r\n")
        request = headers.encode("ascii") + b"\r\n" + body
        require(len(request) <= MAX_REQUEST, "request-limit")
        try:
            with socket.create_connection((self.host, self.port), remaining(deadline)) as conn:
                conn.settimeout(remaining(deadline))
                conn.sendall(request)
                received = bytearray()
                boundary = -1
                while boundary < 0:
                    conn.settimeout(remaining(deadline))
                    chunk = conn.recv(min(1024, MAX_HEADER + 4 - len(received)))
                    if not chunk:
                        raise EnrollError("connection-closed")
                    received.extend(chunk)
                    boundary = received.find(b"\r\n\r\n")
                    if boundary < 0 and len(received) >= MAX_HEADER:
                        raise EnrollError("response-limit")
                require(boundary <= MAX_HEADER, "response-limit")
                lines = bytes(received[:boundary]).split(b"\r\n")
                require(bool(re.fullmatch(rb"HTTP/1\.[01] [1-5][0-9]{2}(?: [\x20-\x7e]*)?", lines[0])), "invalid-framing")
                code = int(lines[0].split(b" ")[1])
                # No redirection is followed, even for the same host.
                if 300 <= code < 400:
                    raise EnrollError("http-status", code)
                values = {}
                for line in lines[1:]:
                    name, colon, value = line.partition(b":")
                    require(colon and re.fullmatch(rb"[A-Za-z0-9-]+", name) and
                            all(32 <= c < 127 or c == 9 for c in value), "invalid-framing")
                    name = name.lower()
                    require(name not in values, "invalid-framing")
                    values[name] = value.strip()
                length = values.get(b"content-length", b"")
                require(re.fullmatch(rb"[0-9]{1,5}", length) and
                        b"transfer-encoding" not in values, "invalid-framing")
                size = int(length)
                require(size <= MAX_BODY, "response-limit")
                data = bytearray(received[boundary + 4:])
                require(len(data) <= size, "invalid-framing")
                while len(data) < size:
                    conn.settimeout(remaining(deadline))
                    chunk = conn.recv(min(4096, size - len(data)))
                    if not chunk:
                        raise EnrollError("connection-closed")
                    data.extend(chunk)
                require(remaining(deadline) > 0, "timeout")
                if values.get(b"content-type", b"").split(b";", 1)[0].strip().lower() != b"application/json":
                    raise EnrollError("http-status" if code >= 400 else "invalid-framing", code)
                try:
                    parsed = decode_json(data)
                except EnrollError as error:
                    # Some legacy error handlers label a plain-text failure as
                    # JSON. Preserve the status so reconciliation can recognize
                    # a missing receipt without accepting malformed content.
                    raise EnrollError(error.category, code) from None
                return code, parsed
        except (socket.timeout, TimeoutError):
            raise EnrollError("timeout") from None
        except ConnectionResetError:
            raise EnrollError("connection-reset") from None
        except (BrokenPipeError, ConnectionAbortedError):
            raise EnrollError("connection-closed") from None
        except OSError:
            raise EnrollError("network-error") from None


def check_context(host, broker, target, fleet):
    require(host_value(host) and identity(broker) and identity(target) and
            target != broker and hex_value(fleet, HEX_BOOT), "precondition-failed")
    return dict(host=host, broker=broker, target=target, fleetId=fleet)


def check_state(data, broker):
    require(data.get("deviceId") == broker, "identity-mismatch")
    require(hex_value(data.get("token"), HEX_TOKEN, nonzero=False) and
            uint32(data.get("uptimeMs")))
    return data["token"]


def check_mesh(data, context, boot=None, available=False):
    require(data.get("deviceId") == context["broker"], "identity-mismatch")
    require(data.get("fleetId") == context["fleetId"], "fleet-mismatch")
    require(data.get("version") == 1 and type(data.get("version")) is int and
            type(data.get("available")) is bool and
            hex_value(data.get("boot"), HEX_BOOT) and uint32(data.get("snapshotUptimeMs")))
    require(boot is None or data["boot"] == boot, "boot-changed")
    require(not available or data["available"], "precondition-failed")
    peers = data.get("peers")
    require(type(peers) is list and len(peers) <= 16)
    seen = set()
    for peer in peers:
        require(type(peer) is dict and identity(peer.get("id")) and
                peer["id"] not in seen and type(peer.get("online")) is bool and
                hex_value(peer.get("boot"), HEX_BOOT) and type(peer.get("hops")) is int and
                1 <= peer["hops"] <= 4)
        seen.add(peer["id"])
    return data


def check_candidate(data, context, snapshot_ms, expected_boot=None):
    require(type(data.get("version")) is int and data["version"] == 1 and
            data.get("broker") == context["broker"], "identity-mismatch")
    candidates = data.get("candidates")
    require(type(candidates) is list and len(candidates) <= 8)
    ids = set()
    match = None
    for candidate in candidates:
        require(type(candidate) is dict and identity(candidate.get("id")) and
                candidate["id"] not in ids and candidate.get("broker") == context["broker"] and
                candidate.get("online") is True and candidate.get("claimed") is False and
                uint32(candidate.get("observedAt")) and
                hex_value(candidate.get("targetBoot"), HEX_BOOT) and
                type(candidate.get("comparisonVersion")) is int and
                candidate["comparisonVersion"] in (1, 2))
        ids.add(candidate["id"])
        if candidate["id"] == context["target"]:
            match = candidate
    require(match is not None, "candidate-unavailable")
    require(((snapshot_ms - match["observedAt"]) & 0xffffffff) < CANDIDATE_MS,
            "candidate-stale")
    require(expected_boot is None or match["targetBoot"] == expected_boot, "target-boot-changed")
    return match


def check_journal(data):
    require(type(data) is dict and set(data) <= JOURNAL_KEYS and
            type(data.get("schema")) is int and data["schema"] == 1, "journal-invalid")
    try:
        check_context(data.get("host"), data.get("broker"), data.get("target"), data.get("fleetId"))
        require(hex_value(data.get("requestId"), HEX_BOOT) and
                type(data.get("comparisonVersion")) is int and data["comparisonVersion"] == 1 and
                hex_value(data.get("normalBrokerBoot"), HEX_BOOT) and
                hex_value(data.get("targetAdvertBoot"), HEX_BOOT) and data.get("outcome") in OUTCOMES)
        for key in ("commissionBrokerBoot", "targetMeshBoot"):
            require(key not in data or hex_value(data[key], HEX_BOOT))
        require("expiresAt" not in data or uint32(data["expiresAt"]))
        require("phase" not in data or data["phase"] in PHASES)
        require("errorCategory" not in data or (isinstance(data["errorCategory"], str) and data["errorCategory"] in ERRORS))
        require("pattern" not in data or pattern_ok(data["pattern"]))
        for key in ("approved", "uncertain", "confirmedAbsent"):
            require(key not in data or type(data[key]) is bool)
        if data["outcome"] in ("pending", "complete", "confirmed-absent"):
            require(all(key in data for key in ("commissionBrokerBoot", "expiresAt", "phase",
                                                "approved", "uncertain", "confirmedAbsent")))
        if data["outcome"] == "complete":
            require(data["phase"] == "complete" and data["approved"] and
                    not data["uncertain"] and not data["confirmedAbsent"] and "pattern" in data)
        elif data["outcome"] == "confirmed-absent":
            require(data["phase"] == "failed" and data["confirmedAbsent"] and not data["uncertain"])
        elif data["outcome"] == "pending":
            require(data["phase"] in ("exchange", "confirm", "approved") and
                    not data["uncertain"] and not data["confirmedAbsent"] and
                    data["approved"] == (data["phase"] == "approved") and
                    (data["phase"] == "exchange" or "pattern" in data))
    except EnrollError:
        raise EnrollError("journal-invalid") from None
    return data


def read_journal(path):
    try:
        with Path(path).open("rb") as file:
            raw = file.read(MAX_JOURNAL + 1)
        require(len(raw) <= MAX_JOURNAL, "journal-invalid")
        return check_journal(decode_json(raw))
    except (OSError, EnrollError):
        raise EnrollError("journal-invalid") from None


def write_journal(path, data, create=False):
    check_journal(data)
    raw = (json.dumps(data, sort_keys=True, indent=2) + "\n").encode("utf-8")
    require(len(raw) <= MAX_JOURNAL, "journal-invalid")
    path = Path(path)
    temporary = None
    try:
        if create:
            # Exclusive creation is the single-start gate. Flush BEFORE HTTP.
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        else:
            temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(8))
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as file:
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        if temporary is not None:
            os.replace(temporary, path)
        # POSIX directory durability; Windows fsync above commits file data.
        if os.name != "nt":
            dir_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
    except FileExistsError:
        if create:
            raise
        raise EnrollError("journal-write-failed") from None
    except OSError:
        raise EnrollError("journal-write-failed") from None
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def pattern_ok(value):
    return type(value) is list and len(value) == 4 and all(
        type(symbol) is int and 0 <= symbol <= 15 for symbol in value)


def accept_receipt(data, journal):
    require(data.get("target") == journal["target"] and
            data.get("broker") == journal["broker"] and
            data.get("requestId") == journal["requestId"], "identity-mismatch")
    require(data.get("fleetId") == journal["fleetId"], "fleet-mismatch")
    require(data.get("targetBoot") == journal["targetAdvertBoot"], "target-boot-changed")
    comparison = data.get("comparison")
    require(type(data.get("version")) is int and data["version"] == 1 and
            type(comparison) is dict and type(comparison.get("version")) is int and
            comparison["version"] == 1 and type(comparison.get("entropyBits")) is int and
            comparison["entropyBits"] == 16 and data.get("phase") in PHASES and
            hex_value(data.get("brokerBoot"), HEX_BOOT) and
            uint32(data.get("expiresAt")) and pattern_ok(data.get("pattern")))
    for field in ("approved", "uncertain", "confirmedAbsent"):
        require(type(data.get(field)) is bool)
    require(not (data["uncertain"] and data["confirmedAbsent"]))
    require(data["phase"] not in ("exchange", "confirm") or (
        not data["approved"] and not data["uncertain"] and not data["confirmedAbsent"]))
    require(data["phase"] not in ("approved", "complete") or (
        data["approved"] and not data["uncertain"] and not data["confirmedAbsent"]))
    require(data["phase"] != "failed" or data["uncertain"] != data["confirmedAbsent"])
    for receipt_key, journal_key in (("brokerBoot", "commissionBrokerBoot"), ("expiresAt", "expiresAt")):
        require(journal_key not in journal or journal[journal_key] == data[receipt_key], "transcript-changed")
    if "pattern" in journal:
        require(journal["pattern"] == data["pattern"], "transcript-changed")
    if journal.get("phase") == "complete":
        require(data["phase"] == "complete", "transcript-changed")
    journal.update(commissionBrokerBoot=data["brokerBoot"], expiresAt=data["expiresAt"],
        phase=data["phase"], approved=data["approved"], uncertain=data["uncertain"],
        confirmedAbsent=data["confirmedAbsent"])
    if data["phase"] in ("confirm", "approved", "complete"):
        journal["pattern"] = data["pattern"][:]
    journal["outcome"] = ("complete" if data["phase"] == "complete" else
        "confirmed-absent" if data["confirmedAbsent"] else
        "uncertain" if data["uncertain"] or data["phase"] == "failed" else "pending")
    journal.pop("errorCategory", None)


def public_view(journal, mesh=None):
    view = {key: journal[key] for key in ("broker", "target", "fleetId", "requestId",
        "normalBrokerBoot", "targetAdvertBoot", "outcome", "phase", "errorCategory",
        "commissionBrokerBoot", "approved", "uncertain", "confirmedAbsent") if key in journal}
    view["comparisonVersion"] = 1
    if journal["outcome"] == "pending" and journal.get("phase") == "confirm":
        view["colors"] = [COLORS[symbol] for symbol in journal["pattern"]]
        view["instruction"] = "Compare all four colors in order with the bridge OLED. Press PRG briefly only if every color matches."
    if mesh is not None and mesh["available"]:
        for peer in mesh["peers"]:
            if peer["id"] == journal["target"] and peer["online"]:
                view["fleetPresence"] = dict(verified=True, normalTargetBoot=peer["boot"], hops=peer["hops"])
                break
    if journal["outcome"] == "uncertain":
        view["instruction"] = "Enrollment outcome is uncertain. Keep this journal and query status; do not start a new attempt."
    elif journal["outcome"] in ("complete", "confirmed-absent") and "errorCategory" in journal:
        view["instruction"] = "The original terminal receipt is retained. Current session or fleet presence could not be verified."
    return view


class Enrollment:
    def __init__(self, client, emit=None):
        self.client, self.emit = client, emit or (lambda _: None)

    def get(self, path, deadline):
        status, data = self.client.request("GET", path, deadline=deadline)
        if status != 200:
            raise EnrollError("http-status", status)
        return data

    def owner(self, context, deadline, available=False):
        token = check_state(self.get("/api/state", deadline), context["broker"])
        mesh = check_mesh(self.get("/api/mesh/status", deadline), context, available=available)
        return token, mesh

    def inspect(self, context, expected_boot=None, deadline=None):
        deadline = time.monotonic() + REQUEST_SECONDS * 4 if deadline is None else deadline
        _, initial = self.owner(context, deadline, available=True)
        candidates = self.get("/api/mesh/new", deadline)
        fresh = check_mesh(self.get("/api/mesh/status", deadline), context,
                           boot=initial["boot"], available=True)
        candidate = check_candidate(candidates, context, fresh["snapshotUptimeMs"], expected_boot)
        return dict(context, normalBrokerBoot=fresh["boot"], targetAdvertBoot=candidate["targetBoot"],
                    comparisonVersion=1, candidateAgeMs=(fresh["snapshotUptimeMs"] - candidate["observedAt"]) & 0xffffffff)

    def uncertain(self, journal, path, category, mesh=None):
        # A later transport failure cannot revoke an already confirmed receipt.
        if journal["outcome"] not in ("complete", "confirmed-absent"):
            journal["outcome"] = "uncertain"
        journal["errorCategory"] = category
        result = public_view(journal, mesh)
        try:
            write_journal(path, journal)
        except EnrollError:
            # The durable prepared/original record still prevents a replay.
            result["journalWriteConfirmed"] = False
        self.emit(result)
        return result

    def query(self, journal, token, path, deadline):
        fields = {key: journal[key] for key in ("target", "requestId", "broker")}
        try:
            status, data = self.client.request("POST", "/api/mesh/enroll/status", fields, token, deadline)
        except EnrollError as error:
            # Production missing receipts are 404 text/plain, intentionally
            # rejected as JSON by the reader. Preserve that safe classification.
            if error.status == 404:
                raise EnrollError("missing-receipt", 404) from None
            raise
        if status == 404:
            raise EnrollError("missing-receipt", status)
        if status != 200:
            raise EnrollError("http-status", status)
        accept_receipt(data, journal)
        write_journal(path, journal)
        result = public_view(journal)
        self.emit(result)
        return result

    def poll(self, journal, path, wait, deadline, token=None):
        until = min(deadline, time.monotonic() + wait)
        last = None
        while True:
            mesh = None
            try:
                # Refresh identity/token each query; no start POST can occur here.
                token, mesh = self.owner(journal, deadline)
                if mesh["boot"] != journal["normalBrokerBoot"]:
                    return self.uncertain(journal, path, "broker-reboot", mesh)
                last = self.query(journal, token, path, deadline)
                if last["outcome"] in ("complete", "confirmed-absent", "uncertain") or wait == 0:
                    if last["outcome"] == "complete":
                        # Re-read after release of commissioning radio for fresh
                        # normal mesh possession proof, never compare its boot
                        # with the unrelated commissioning advertisement nonce.
                        mesh = check_mesh(self.get("/api/mesh/status", deadline), journal)
                        if mesh["boot"] != journal["normalBrokerBoot"]:
                            return self.uncertain(journal, path, "broker-reboot", mesh)
                        final = public_view(journal, mesh)
                        if "fleetPresence" in final:
                            journal["targetMeshBoot"] = final["fleetPresence"]["normalTargetBoot"]
                            write_journal(path, journal)
                        self.emit(final)
                        return final
                    return last
            except EnrollError as error:
                return self.uncertain(journal, path, error.category, mesh)
            if time.monotonic() >= until:
                return last
            time.sleep(min(1, max(0, until - time.monotonic())))

    def status(self, path, context=None, wait=0):
        journal = read_journal(path)
        if context is not None:
            require(all(journal[key] == context[key] for key in ("host", "broker", "target", "fleetId")), "identity-mismatch")
        require(self.client.host == journal["host"], "identity-mismatch")
        require(type(wait) in (int, float) and 0 <= wait <= 120, "precondition-failed")
        return self.poll(journal, path, wait, time.monotonic() + REQUEST_SECONDS * 4 + wait)

    def start(self, context, path, expected_boot=None, wait=0):
        require(self.client.host == context["host"], "identity-mismatch")
        require(type(wait) in (int, float) and 0 <= wait <= 120, "precondition-failed")
        if Path(path).exists():
            return self.status(path, context, wait)
        deadline = time.monotonic() + REQUEST_SECONDS * 6 + wait
        token, initial = self.owner(context, deadline, available=True)
        candidates = self.get("/api/mesh/new", deadline)
        fresh = check_mesh(self.get("/api/mesh/status", deadline), context, boot=initial["boot"], available=True)
        candidate = check_candidate(candidates, context, fresh["snapshotUptimeMs"], expected_boot)
        request_id = secrets.token_hex(8)
        while int(request_id, 16) == 0:
            request_id = secrets.token_hex(8)
        journal = dict(context, schema=1, requestId=request_id, comparisonVersion=1,
                       normalBrokerBoot=fresh["boot"], targetAdvertBoot=candidate["targetBoot"], outcome="prepared")
        try:
            write_journal(path, journal, create=True)
        except FileExistsError:
            return self.status(path, context, wait)
        fields = {key: journal[key] for key in ("target", "requestId", "broker", "comparisonVersion")}
        try:
            status, data = self.client.request("POST", "/api/mesh/enroll/start", fields, token, deadline)
            # Some post-allocation failures are exact public session receipts.
            # They are interpreted by transcript, never assumed absent by code.
            if status not in (200, 202, 400, 409):
                raise EnrollError("http-status", status)
            accept_receipt(data, journal)
            write_journal(path, journal)
            result = public_view(journal)
            self.emit(result)
        except EnrollError as error:
            return self.uncertain(journal, path, error.category)
        if wait and result["outcome"] == "pending":
            return self.poll(journal, path, wait, deadline)
        return result


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("command", choices=("inspect", "start", "status"))
    result.add_argument("--host", help="Verified owned lamp IPv4 address; never a bridge address")
    result.add_argument("--broker", help="Exact canonical owned-lamp ID (12 lowercase hex)")
    result.add_argument("--target", help="Exact canonical bridge ID (12 lowercase hex)")
    result.add_argument("--fleet", help="Expected public fleet fingerprint (16 lowercase hex)")
    result.add_argument("--journal", type=Path, help="Nonsecret durable session record, required for start/status")
    result.add_argument("--expected-advert-boot", help="Optional inspected commissioning targetBoot guard")
    result.add_argument("--wait", type=int, default=0, help="Poll original status up to 120 seconds; never replays start")
    password = result.add_mutually_exclusive_group()
    password.add_argument("--password-env", metavar="NAME", help="Read private broker password from this process environment")
    password.add_argument("--prompt-password", action="store_true", help="Prompt privately instead of the existing public coollamp default")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        require(0 <= args.wait <= 120, "precondition-failed")
        require(args.expected_advert_boot is None or hex_value(args.expected_advert_boot, HEX_BOOT), "precondition-failed")
        supplied = (args.host, args.broker, args.target, args.fleet)
        if args.command == "status":
            require(args.journal is not None and (all(supplied) or not any(supplied)), "precondition-failed")
            stored = read_journal(args.journal)
            context = check_context(*supplied) if all(supplied) else {key: stored[key] for key in ("host", "broker", "target", "fleetId")}
        else:
            require(all(supplied) and (args.command != "start" or args.journal is not None), "precondition-failed")
            require(args.command != "inspect" or args.wait == 0, "precondition-failed")
            context = check_context(*supplied)
        if args.password_env:
            password = os.environ.get(args.password_env)
            require(password is not None, "precondition-failed")
        elif args.prompt_password:
            password = getpass.getpass("Owned lamp password: ")
        else:
            password = "coollamp"
        enrollment = Enrollment(HttpClient(context["host"], password),
                                lambda value: print(json.dumps(value, sort_keys=True), flush=True))
        if args.command == "inspect":
            result = enrollment.inspect(context, args.expected_advert_boot)
            print(json.dumps(result, sort_keys=True), flush=True)
        elif args.command == "start":
            result = enrollment.start(context, args.journal, args.expected_advert_boot, args.wait)
        else:
            result = enrollment.status(args.journal, context, args.wait)
        return 2 if result.get("outcome") == "uncertain" or result.get("errorCategory") else 0
    except (EnrollError, KeyboardInterrupt) as error:
        category = error.category if isinstance(error, EnrollError) else "interrupted"
        print(json.dumps(dict(ok=False, errorCategory=category)), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
