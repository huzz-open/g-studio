"""Public parameter boundaries without loading models or touching live jobs."""
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HOME = tempfile.TemporaryDirectory(prefix='generation-limits-')
os.environ.update(GEN_HOME=HOME.name, GEN_SKIP_MODEL='1')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/generation-python'))
from PIL import Image
import server
import generate
from providers import PROVIDERS


class LimitsTests(unittest.IsolatedAsyncioTestCase):
    async def test_advertised_limits_are_accepted_and_excess_rejected(self):
        service = server.Service()
        service.provider_states['hunyuan-mini']['acceptsJobs'] = True
        stream = io.BytesIO()
        Image.new('RGBA', (2, 2), (255, 0, 0, 255)).save(stream, format='PNG')
        image = stream.getvalue()
        caps = service.capabilities()
        self.assertEqual(caps['targetFaces']['max'], 1_000_000)
        self.assertEqual(caps['targetFaces']['default'], 40_000)
        for provider in PROVIDERS.values():
            if provider.needs_model:
                self.assertEqual(provider.parameters['resolution']['default'], 128)
                self.assertEqual(provider.parameters['resolution']['max'], 512)
        request = dict(protocolVersion=1, providerId='hunyuan-mini', clientRequestId='upper',
                       inputSha256=hashlib.sha256(image).hexdigest(), targetFaces=1_000_000,
                       parameters={'resolution': 512})
        job = await service.submit(request, image)
        self.assertEqual(job['status'], 'queued')
        defaults_request = {**request, 'clientRequestId': 'default-faces'}
        del defaults_request['targetFaces']
        default_job = await service.submit(defaults_request, image)
        self.assertEqual(default_job['parameters']['targetFaces'], 40_000)
        for extra in [dict(targetFaces=1_000_001), dict(parameters={'resolution': 513}),
                      dict(parameters={'resolution': 1024})]:
            with self.assertRaises(server.Fault) as error:
                await service.submit({**request, **extra, 'clientRequestId': 'invalid'}, image)
            self.assertEqual(error.exception.code, 'INVALID_PARAMETER')

    def test_staged_inference_uses_new_default_but_preserves_explicit_resolution(self):
        with tempfile.TemporaryDirectory(dir=HOME.name) as directory:
            folder = Path(directory)
            (folder / 'input.png').write_bytes(b'fixture')
            for parameters, expected in [({}, '128'), ({'resolution': 256}, '256')]:
                with patch('generate.subprocess.run') as run:
                    generate.hunyuan(folder, {'providerId': 'hunyuan-mini', 'parameters': parameters})
                self.assertEqual(run.call_count, 3)
                for call in run.call_args_list:
                    args = call.args[0]
                    self.assertEqual(args[args.index('--resolution') + 1], expected)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        HOME.cleanup()
