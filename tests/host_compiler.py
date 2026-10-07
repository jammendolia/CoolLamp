"""Native Windows GCC lacks ASan/UBSan; Linux/macOS CI retain both."""
import sys

SANITIZERS = [] if sys.platform == 'win32' else ['-fsanitize=address,undefined']
