"""Local USB bridge setup. Never prints Wi-Fi credentials or fleet key material."""
import argparse
import getpass
import hashlib
import hmac
import json
from pathlib import Path
import time
import serial


def read_reply(port, timeout=6):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        line = port.readline(8193)
        if len(line) > 8192:
            continue
        try:
            reply = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(reply, dict):
            return reply
    raise RuntimeError('USB reply not confirmed; query status before retrying.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('port')
    parser.add_argument('command', choices=('status', 'diagnostics', 'setup', 'wifi', 'trust', 'cache'))
    parser.add_argument('--expect-id', required=True)
    parser.add_argument('--fleet-file', type=Path)
    args = parser.parse_args()
    # Avoid an auto-reset pulse. Only one reader/flasher may own the port.
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, 115200, 0.3
    port.dtr, port.rts = False, False
    port.open()
    with port:
        port.reset_input_buffer()
        port.write(b'status\n')
        current = read_reply(port)
        if current.get('role') != 'bridge' or current.get('deviceId') != args.expect_id:
            raise RuntimeError('USB device identity does not match the expected bridge.')
        command = args.command
        if command == 'wifi':
            ssid = input('Home Wi-Fi name: ').encode('utf-8')
            password = getpass.getpass('Wi-Fi password (blank only for an open network): ').encode('utf-8')
            if not 1 <= len(ssid) <= 32 or len(password) > 64 or 0 < len(password) < 8:
                raise RuntimeError('Wi-Fi input exceeds supported limits.')
            command = 'wifi ' + ssid.hex() + ' ' + (password.hex() if password else '-')
        elif command == 'trust':
            if not args.fleet_file or args.fleet_file.stat().st_size > 4096:
                raise RuntimeError('An existing private household credential file is required.')
            value = json.loads(args.fleet_file.read_text(encoding='utf-8-sig'))
            key = bytes.fromhex(value.get('fleetKeyHex', ''))
            if len(key) != 16 or not any(key):
                raise RuntimeError('Private household credential is invalid.')
            fleet = hmac.new(key, b'CoolLamp fleet identifier v1', hashlib.sha256).digest()[:8].hex()
            if value.get('fleetId') != fleet:
                raise RuntimeError('Household credential does not match its declared identity.')
            command = 'trust ' + args.expect_id + ' ' + fleet + ' ' + key.hex()
            del key, value
        if args.command == 'status':
            print(json.dumps(current, indent=2))
        else:
            port.write(command.encode('ascii') + b'\n')
            del command
            print(json.dumps(read_reply(port), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, serial.SerialException):
        raise SystemExit('Bridge USB operation failed or was not confirmed. No private input was printed; read status before retrying.')
