"""Real offline HTTP startup failures, without model downloads/inference."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT=Path(__file__).resolve().parents[1]


class StartupTests(unittest.TestCase):
    def run_service(self,device):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            env={**os.environ,'GEN_HOME':str(root/'resources'),'GEN_DATA_HOME':str(root/'data'),'GEN_MODELS':'all',
                 'GEN_DEVICE':device,'GEN_OFFLINE':'1','GEN_PORT':str(port),'GEN_SKIP_MODEL':'0','GEN_PRECISION':'fp32'}
            with (root/'log').open('w') as log:
                process=subprocess.Popen([sys.executable,'-u',str(ROOT/'services/generation-python/server.py')],env=env,stdout=log,stderr=subprocess.STDOUT)
                try:
                    start=time.monotonic();health=None;caps=None
                    for _ in range(200):
                        try:
                            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=.5) as r:health=json.load(r)
                            if health:break
                        except OSError:time.sleep(.05)
                    self.assertEqual(health['status'],'ok');self.assertLess(time.monotonic()-start,5)
                    token=json.loads((root/'data/config.json').read_text())['token']
                    for _ in range(300):
                        request=urllib.request.Request(f'http://127.0.0.1:{port}/v1/capabilities',headers={'Authorization':'Bearer '+token})
                        with urllib.request.urlopen(request,timeout=.5) as r:caps=json.load(r)
                        models=[p for p in caps['providers'] if p['providerId']!='silhouette']
                        if all(p['state']=='failed' for p in models):break
                        time.sleep(.05)
                    self.assertTrue(all(p['state']=='failed' and not p['acceptsJobs'] for p in models),caps)
                    self.assertTrue(all('推荐' not in p['tags'] for p in models))
                    self.assertEqual(next(p for p in caps['providers'] if p['providerId']=='silhouette')['state'],'ready')
                    return models
                finally:
                    process.terminate();process.wait(timeout=15)

    def test_missing_offline_resources_leave_http_and_other_provider_available(self):
        models=self.run_service('cpu')
        self.assertTrue(all('preparation' in p['error'].lower() for p in models))

    @unittest.skipUnless(sys.platform=='darwin','Explicit CUDA unavailable probe is Mac-specific')
    def test_explicit_cuda_on_mac_fails_without_cpu_substitution(self):
        models=self.run_service('cuda')
        self.assertTrue(all('CUDA' in p['error'] for p in models))


if __name__=='__main__':unittest.main(verbosity=2)
