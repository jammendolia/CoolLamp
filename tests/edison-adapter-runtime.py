"""Exercise the actual Edison .ino adapter and actual public model types."""
from pathlib import Path
import subprocess
import tempfile
from host_compiler import SANITIZERS

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='coollamp-edison-adapter-') as directory:
    temporary=Path(directory)
    # The production public headers only need the Arduino String declaration;
    # no Arduino implementation, NVS, radio or renderer is substituted here.
    (temporary/'Arduino.h').write_text('#pragma once\n#include <stdint.h>\nclass String;\n')
    executable=temporary/'edison-adapter.exe'
    subprocess.run(['g++','-std=c++17','-Os','-Wall','-Wextra','-Werror',*SANITIZERS,
                    '-I',str(temporary),'-I',str(ROOT),str(ROOT/'tests/edison-adapter.cpp'),
                    str(ROOT/'LampEdisonEffects.cpp'),'-o',str(executable)],check=True)
    subprocess.run([str(executable)],check=True)
