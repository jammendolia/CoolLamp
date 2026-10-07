#!/usr/bin/env python3
"""USB audio provisioning and diagnostics (requires pyserial 3.5)."""
import argparse
import serial
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("port", help="Explicit serial device, e.g. COM4 or /dev/cu.usbmodem80201")
parser.add_argument("command", choices=["?", "a", "s", "w", "b", "p", "q", "d", "c", "j", "u", "t", "m", "n", "g", "v", "f", "+", "-", "1", "2", "3", "4", "5", "6"],
                    help="?: status, d: read-only network/group/runtime diagnostics, a: toggle setup hotspot, s: scan from active hotspot, w: scan diagnostics, u: audio status, t: 10s test, m/n: mic enable/disable + restart, g/v/f: glow/meter/fire, 1–5: spectrum/launch/embers/bloom/fountain, 6: VU meter, +/-: double/halve sensitivity and save")
parser.add_argument("--seconds", type=float, default=4)
parser.add_argument("--poll", action="store_true", help="Poll audio status after the initial command")
parser.add_argument("--poll-command", choices=["u","p","q","d"], default="u", help="Status to poll: u audio, p Wi-Fi setup, q Bluetooth, d network/group/runtime")
parser.add_argument("--interval", type=float, default=1, help="Polling interval in seconds (0.05–10); use 0.05 to catch short sounds")
args = parser.parse_args()
if not 0.05 <= args.interval <= 10:
    parser.error("--interval must be between 0.05 and 10 seconds")
# Set line states before opening: native USB CDC needs DTR; RTS must stay
# deasserted to avoid the ESP32 boot/reset handshake. Do not pulse either line.
port = serial.Serial(port=None, baudrate=115200, timeout=min(0.2, args.interval))
port.dtr = True
port.rts = False
port.port = args.port
try:
    port.open()
    port.write(args.command.encode("ascii"))
    deadline = time.monotonic() + args.seconds
    next_poll = time.monotonic() + args.interval
    while time.monotonic() < deadline:
        if args.poll and time.monotonic() >= next_poll:
            port.write(args.poll_command.encode("ascii"))
            next_poll = time.monotonic() + args.interval
        data = port.read(min(4096, max(1, port.in_waiting)))
        if data:
            print(data.decode("utf-8", errors="replace"), end="", flush=True)
finally:
    port.close()
