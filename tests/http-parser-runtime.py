"""Compile and execute the production incremental HTTP parser, without a lamp."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='http-parser-', dir=ROOT / '.build') as folder:
    binary = Path(folder) / 'parser.exe'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation', *SANITIZERS,
                    '-I' + str(ROOT), str(ROOT / 'tests/http-parser-runtime.cpp'), '-o', str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
