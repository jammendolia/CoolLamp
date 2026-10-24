"""Compile and exercise the production allocation-free Edison renderer."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='coollamp-edison-') as directory:
    executable=Path(directory)/'edison-effects.exe'
    subprocess.run(['g++','-std=c++17','-Os','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I',str(ROOT),str(ROOT/'tests/edison-effects.cpp'),
                    str(ROOT/'LampEdisonEffects.cpp'),'-o',str(executable)],check=True)
    subprocess.run([str(executable)],check=True)
