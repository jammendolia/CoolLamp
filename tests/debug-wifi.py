import importlib.util
import io
import pathlib
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('debug_wifi', pathlib.Path(__file__).resolve().parents[1] / 'tools/debug-wifi.py')
debug = importlib.util.module_from_spec(spec)
spec.loader.exec_module(debug)


class DiagnosticsTests(unittest.TestCase):
    def test_addresses_cannot_embed_credentials_or_other_endpoints(self):
        self.assertEqual(debug.lamp_url('192.168.1.25'), 'http://192.168.1.25')
        self.assertEqual(debug.lamp_url('coollamp-50b9f0.local'), 'http://coollamp-50b9f0.local')
        for value in ['http://lamp:secret@host', 'file:///tmp/file', 'host/api/config', 'host?password=x', 'host#x']:
            with self.assertRaises(ValueError):
                debug.lamp_url(value)

    def test_new_firmware_uses_read_only_endpoint(self):
        with patch.object(debug, 'get_json', return_value={'diagnosticsVersion': 1}) as get:
            self.assertEqual(debug.snapshot('http://lamp', 'secret')['diagnosticsVersion'], 1)
            get.assert_called_once_with('http://lamp', '/api/diagnostics', 'secret')

    def test_legacy_fallback_excludes_token_and_network_name(self):
        missing = urllib.error.HTTPError('http://lamp', 404, 'Not Found', {}, None)
        with patch.object(debug, 'get_json', side_effect=[missing, {
            'token': 'private-token', 'ssid': 'private-network', 'adminPassword': 'secret',
            'deviceId': 'lamp-1', 'audio': {'level': 42}}]):
            self.assertEqual(debug.snapshot('http://lamp', 'secret'), {
                'diagnosticsVersion': 0, 'deviceId': 'lamp-1', 'audio': {'level': 42}})

    def test_authentication_failure_does_not_fall_back(self):
        denied = urllib.error.HTTPError('http://lamp', 401, 'Unauthorized', {}, None)
        with patch.object(debug, 'get_json', side_effect=denied) as get:
            with self.assertRaises(urllib.error.HTTPError):
                debug.snapshot('http://lamp', 'secret')
            self.assertEqual(get.call_count, 1)

    def test_redirects_do_not_forward_credentials(self):
        self.assertIsNone(debug.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://other'))

    def test_http_is_get_and_has_bounded_read(self):
        response = io.BytesIO(b'{"diagnosticsVersion":1}')
        with patch.object(debug.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = response
            self.assertEqual(debug.get_json('http://lamp', '/api/diagnostics', 'secret'), {'diagnosticsVersion': 1})
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertIn('Authorization', request.headers)
            self.assertEqual(build.return_value.open.call_args.kwargs['timeout'], 8)


if __name__ == '__main__':
    unittest.main()
