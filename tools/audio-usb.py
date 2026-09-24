#!/usr/bin/env python3
"""macOS/Linux USB audio provisioning and diagnostics; requires no Python packages."""
import argparse
import array
import fcntl
import os
import select
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("port", help="Explicit serial device, e.g. /dev/cu.usbmodem80201")
parser.add_argument("command", choices=["?", "u", "t", "m", "n", "g", "v", "f", "+", "-", "1", "2", "3", "4", "5"],
                    help="?: status, u: audio status, t: 10s test, m/n: mic enable/disable + restart, g/v/f: glow/meter/fire, 1–5: spectrum/launch/embers/bloom/fountain, +/-: double/halve sensitivity and save")
parser.add_argument("--seconds", type=float, default=4)
parser.add_argument("--poll", action="store_true", help="Poll audio status after the initial command")
parser.add_argument("--interval", type=float, default=1, help="Polling interval in seconds (0.05–10); use 0.05 to catch short sounds")
args = parser.parse_args()
if not 0.05 <= args.interval <= 10:
    parser.error("--interval must be between 0.05 and 10 seconds")
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = 0
    settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    # Assert DTR for native USB CDC diagnostics; leave RTS unchanged.
    fcntl.ioctl(fd, termios.TIOCMBIS, array.array("i", [termios.TIOCM_DTR]))
    os.write(fd, args.command.encode("ascii"))
    deadline = time.monotonic() + args.seconds
    next_poll = time.monotonic() + args.interval
    while time.monotonic() < deadline:
        if args.poll and time.monotonic() >= next_poll:
            os.write(fd, b"u")
            next_poll = time.monotonic() + args.interval
        if select.select([fd], [], [], min(0.2, args.interval))[0]:
            data = os.read(fd, 4096)
            if data:
                print(data.decode("utf-8", errors="replace"), end="", flush=True)
finally:
    os.close(fd)
