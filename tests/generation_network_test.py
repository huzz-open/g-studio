"""Direct networking: interface Host checks, exact CORS and token authentication."""
import asyncio
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/generation-python'))
from network import allowed_origins, host_allowed, listen_host, service_urls


class NetworkPolicy(unittest.TestCase):
    def test_interface_hosts_and_rebinding(self):
        self.assertTrue(host_allowed('192.168.1.20:8765', '192.168.1.20'))
        self.assertFalse(host_allowed('192.168.1.21:8765', '192.168.1.20'))
        self.assertFalse(host_allowed('evil.test:8765', '192.168.1.20'))
        self.assertFalse(host_allowed('[2001:db8::1]:8765', '::1'))
        self.assertTrue(host_allowed('[::1]:8765', '::1'))
        self.assertFalse(host_allowed('localhost@evil.test:8765', '127.0.0.1'))
        self.assertFalse(host_allowed('localhost:invalid', '127.0.0.1'))

    def test_network_configuration(self):
        with patch.dict(os.environ, {'GEN_HOST': '0.0.0.0', 'GEN_PORT': '9876', 'GEN_ORIGINS': 'http://localhost:5173,https://site.example'}):
            self.assertEqual(listen_host(), '0.0.0.0')
            self.assertIn('http://127.0.0.1:9876', service_urls())
            self.assertEqual(allowed_origins(), ['http://localhost:5173', 'https://site.example'])
        for origin in ['*', 'http://*', 'null', 'https://site.example/path', 'https://user:pass@site.example']:
            with patch.dict(os.environ, {'GEN_ORIGINS': origin}):
                with self.assertRaises(ValueError): allowed_origins()


class DirectHTTP(unittest.IsolatedAsyncioTestCase):
    async def test_wildcard_listener_still_checks_origins_host_and_token(self):
        from aiohttp import web, ClientSession
        from aiohttp.test_utils import TestServer
        with tempfile.TemporaryDirectory(prefix='g-direct-policy-') as directory:
            with patch.dict(os.environ, {'GEN_HOME': directory, 'GEN_DATA_HOME': directory, 'GEN_HOST': '0.0.0.0', 'GEN_ORIGINS': 'https://site.example'}):
                from server import security, config
                config['token'] = 'test-direct-token'
                app = web.Application(middlewares=[security])
                async def info(request): return web.json_response({'ok': True})
                app.router.add_route('*', '/v1/info', info)
                async with TestServer(app, host='0.0.0.0') as server:
                    url = f'http://127.0.0.1:{server.port}/v1/info'
                    headers = {'Origin': 'https://site.example', 'Authorization': 'Bearer test-direct-token'}
                    async with ClientSession() as client:
                        async with client.get(url, headers=headers) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://site.example')
                        async with client.options(url, headers={'Origin': 'https://site.example'}) as response:
                            self.assertEqual(response.status, 200)
                        async with client.get(url, headers={**headers, 'Authorization': 'Bearer wrong'}) as response:
                            self.assertEqual(response.status, 401)
                        async with client.get(url, headers={**headers, 'Origin': 'https://evil.test'}) as response:
                            self.assertEqual(response.status, 403)
                        async with client.get(url, headers={**headers, 'Host': 'evil.test'}) as response:
                            self.assertEqual(response.status, 403)


if __name__ == '__main__': unittest.main()
