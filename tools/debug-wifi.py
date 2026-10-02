#!/usr/bin/env python3
"""Read CoolLamp diagnostics over the LAN; never changes lamp settings."""
import argparse
import base64
import getpass
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def lamp_url(host):
    parsed = urllib.parse.urlsplit(host if '://' in host else 'http://' + host)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username is not None or parsed.password is not None or
            parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError('Use a lamp IP address or hostname, without credentials or a path.')
    return parsed.scheme + '://' + parsed.netloc


def get_json(base, path, password):
    auth = base64.b64encode(('lamp:' + password).encode()).decode()
    request = urllib.request.Request(base + path, headers={
        'Authorization': 'Basic ' + auth, 'Cache-Control': 'no-cache'})
    # Do not forward lamp credentials through redirects or environment proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=8) as response:
        payload = response.read(65537)
    if len(payload) > 65536:
        raise ValueError('Unexpectedly large diagnostic response.')
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError('Invalid diagnostic response.')
    return data


def snapshot(base, password):
    try:
        return get_json(base, '/api/diagnostics', password)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    # Older lamps already expose useful telemetry. Never return /api/state's
    # session token, network name, or other unneeded configuration fields.
    state = get_json(base, '/api/state', password)
    fields = ('deviceId', 'hostname', 'firmware', 'audio', 'sync', 'connected',
              'address', 'mode', 'brightness', 'power', 'leds', 'midpoint')
    return {'diagnosticsVersion': 0, **{key: state[key] for key in fields if key in state}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('hosts', nargs='+', help='Lamp IP addresses or .local hostnames')
    passwords = parser.add_mutually_exclusive_group()
    passwords.add_argument('--factory-password', action='store_true', help='Use the factory password coollamp')
    passwords.add_argument('--password-env', help='Read the password from this environment variable')
    parser.add_argument('--samples', type=int, default=1, help='Snapshots per lamp (1–300)')
    parser.add_argument('--interval', type=float, default=2, help='Seconds between rounds (minimum 1)')
    args = parser.parse_args()
    if not 1 <= args.samples <= 300 or not 1 <= args.interval <= 3600:
        parser.error('Use 1–300 samples and a 1–3600 second interval.')
    try:
        bases = [lamp_url(host) for host in args.hosts]
    except ValueError as error:
        parser.error(str(error))
    if args.factory_password:
        password = 'coollamp'
    elif args.password_env:
        password = os.environ.get(args.password_env)
        if not password:
            parser.error('The password environment variable is empty or missing.')
    else:
        password = getpass.getpass('Lamp access password (not saved): ')
    failed = False
    for sample in range(args.samples):
        for base in bases:
            report = {'host': base, 'sample': sample + 1, 'timestamp': time.time()}
            try:
                report['diagnostics'] = snapshot(base, password)
            except urllib.error.HTTPError as error:
                report['error'] = 'Access password rejected.' if error.code == 401 else 'HTTP error ' + str(error.code)
                failed = True
            except (OSError, ValueError, urllib.error.URLError):
                report['error'] = 'Cannot read lamp diagnostics. Check its address and Wi-Fi connection.'
                failed = True
            print(json.dumps(report), flush=True)
        if sample + 1 < args.samples:
            time.sleep(args.interval)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
