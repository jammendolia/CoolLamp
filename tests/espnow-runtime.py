"""Host contracts for the actual radio adapter, AEAD wrapper and hybrid service."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from host_compiler import SANITIZERS

SOURCE = '9d669eadb1955d348986b9280156710aaaadf79f'
ARCHIVE_SHA = '45f5e3ca387dfc1dbc41bd221f56971a6d254eb1a88d8a0faadfa9e0d193719d'
PRIMITIVES = ['aes', 'cipher', 'cipher_wrap', 'gcm', 'md', 'sha256', 'platform', 'platform_util', 'constant_time']


def verified_source(cache):
    """Find a completed production cache; verify records and actual source bytes."""
    cache = cache.resolve()
    archive = cache / ('source-' + SOURCE + '.tar.gz')
    if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Pinned Mbed TLS source archive is missing or has an invalid SHA-256; no download was attempted.')
    prefix = 'mbedtls-' + SOURCE
    with tarfile.open(archive, 'r:gz') as bundle:
        records = sorted(cache.glob('*/build.json'), key=lambda entry: entry.stat().st_mtime, reverse=True)
        for record_path in records:
            try:
                record = json.loads(record_path.read_text())
                directory = record_path.parent.resolve()
                directory.relative_to(cache)
                if (record.get('fingerprint') != directory.name or record.get('source') != SOURCE or
                        record.get('sourceSha256') != ARCHIVE_SHA):
                    continue
                library = directory / 'libmbedtls-ota.a'
                if hashlib.sha256(library.read_bytes()).hexdigest() != record.get('sha256'):
                    continue
                source = directory / prefix
                # Reject a modified extraction as well as a corrupt download.
                # Verify every public/private header and every C source compiled
                # by this runner directly against the already hashed archive.
                for member in bundle.getmembers():
                    if not member.isfile() or not member.name.startswith(prefix + '/'):
                        continue
                    relative = Path(member.name[len(prefix) + 1:])
                    selected = (str(relative).replace('\\', '/').startswith('include/') or
                                relative.parts[0] == 'library' and (relative.suffix == '.h' or
                                relative.name in {name + '.c' for name in PRIMITIVES}))
                    if not selected:
                        continue
                    expected = bundle.extractfile(member)
                    if expected is None or (source / relative).read_bytes() != expected.read():
                        raise ValueError('Cached Mbed TLS source differs from the pinned archive.')
                if all((source / 'library' / (name + '.c')).is_file() for name in PRIMITIVES):
                    return source
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                continue
    raise ValueError('No complete SHA-verified production Mbed TLS cache was found; no download was attempted.')


parser = argparse.ArgumentParser()
profile_args = parser.add_mutually_exclusive_group()
profile_args.add_argument('--openssl', action='store_true', help='Use real host AES-GCM in the SDK API adapter')
profile_args.add_argument('--mbedtls-source', type=Path, help='Use actual pinned Mbed TLS sources instead of behavioral adapters')
profile_args.add_argument('--mbedtls-cache', type=Path, help='Locate and verify the existing production TLS source cache; never downloads')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.mbedtls_cache:
    args.mbedtls_source = verified_source(args.mbedtls_cache)
with tempfile.TemporaryDirectory(prefix='coollamp-espnow-') as folder:
    objects = []
    profile = ['-Itests/sync-stubs', '-Itests/stubs']
    defines = []
    if args.mbedtls_source:
        source = args.mbedtls_source.resolve()
        if source.name != 'mbedtls-9d669eadb1955d348986b9280156710aaaadf79f':
            raise ValueError('Use the source directory already SHA-verified by the production TLS helper')
        profile.insert(0, '-I' + str(source / 'include'))
        profile += ['-Itests', '-I' + str(source / 'library')]
        defines = ['-DMBEDTLS_CONFIG_FILE="espnow-host-mbedtls-config.h"']
        for name in PRIMITIVES:
            output = Path(folder) / (name + '.o')
            subprocess.run(['gcc', '-std=c11', *SANITIZERS, *profile, *defines,
                            '-c', str(source / 'library' / (name + '.c')), '-o', str(output)], cwd=root, check=True)
            objects.append(str(output))
    elif not args.openssl:
        defines = ['-DCOOL_LAMP_HOST_BEHAVIOR_CRYPTO']
    for source, extra in [
        ('espnow-radio.cpp', []),
        ('espnow-crypto.cpp', ['LampSyncRadioCrypto.cpp']),
        ('sync-radio-runtime.cpp', ['LampEspNow.cpp', 'LampSyncRadioCrypto.cpp']),
        ('sync-radio-capacity.cpp', ['LampEspNow.cpp', 'LampSyncRadioCrypto.cpp']),
        ('sync-runtime.cpp', ['LampEspNow.cpp', 'LampSyncRadioCrypto.cpp'])
    ]:
        # The included Sync source links inert mesh/commissioning loop hooks
        # through firmware-relay-fixture.h. Their real routing, key exchange and
        # flash behavior stay in the dedicated runtime suites, not these mocks.
        output = Path(folder) / (Path(source).stem + '.exe')
        command = ['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                   *profile, *defines, 'tests/' + source, *extra, *objects, '-o', str(output)]
        if args.openssl:
            command += ['-DCOOL_LAMP_HOST_OPENSSL', '-lcrypto']
        subprocess.run(command, cwd=root, check=True)
        subprocess.run([str(output)], cwd=root, check=True)
