"""Compile the production streaming browser update parser; no hardware I/O."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
(ROOT / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='http-multipart-', dir=ROOT / '.build') as folder:
    binary = Path(folder) / 'multipart.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', *SANITIZERS,
                    '-I' + str(ROOT), str(ROOT / 'tests/http-multipart-runtime.cpp'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
