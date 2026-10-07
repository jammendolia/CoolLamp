"""Check serial line setup and cleanup without touching a USB device."""
import pathlib
import runpy
import sys
import types
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'audio-usb.py'


class SerialTests(unittest.TestCase):
    def test_lines_are_configured_before_open_and_port_is_closed(self):
        events = []

        class Port:
            def __init__(self, **kwargs):
                self.assertions = kwargs
                events.append(('create', kwargs))

            def open(self):
                events.append(('open', self.port, self.dtr, self.rts))

            def write(self, data):
                events.append(('write', data))

            def close(self):
                events.append(('close',))

        with patch.dict(sys.modules, {'serial': types.SimpleNamespace(Serial=Port)}):
            with patch.object(sys, 'argv', [str(SCRIPT), 'COM4', 'd', '--seconds', '0']):
                runpy.run_path(str(SCRIPT), run_name='__main__')
        self.assertIsNone(events[0][1]['port'])
        self.assertEqual(events[1:], [('open', 'COM4', True, False), ('write', b'd'), ('close',)])


if __name__ == '__main__':
    unittest.main()
