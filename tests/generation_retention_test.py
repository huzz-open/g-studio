"""Result retention and explicit deletion, without loading generation models."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/generation-python'))
IMPORT_HOME = tempfile.TemporaryDirectory()
os.environ.update(GEN_DATA_HOME=IMPORT_HOME.name, GEN_SKIP_MODEL='1', GEN_DEVICE='cpu')
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import server


class ResultRetentionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.job_patch = patch.object(server, 'JOBS', self.root)
        self.job_patch.start()
        self.service = server.Service()
        self.service_patch = patch.object(server, 'service', self.service)
        self.service_patch.start()
        self.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        folder = self.root / self.id
        folder.mkdir()
        self.data = b'generated-model-result'
        (folder / 'shadow.glb').write_bytes(self.data)
        (folder / 'input.png').write_bytes(b'input')
        self.job = dict(id=self.id, status='succeeded', phase='complete', createdAt=1)
        self.service.jobs[self.id] = self.job
        self.service.complete(self.job)
        app = web.Application(middlewares=[])
        app.add_routes([web.get('/v1/jobs/{id}', server.status),
                        web.get('/v1/jobs/{id}/outputs/{output}', server.output),
                        web.delete('/v1/jobs/{id}', server.delete_job)])
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.service_patch.stop()
        self.job_patch.stop()
        self.temp.cleanup()

    async def test_results_survive_arbitrary_time_reloads_and_repeated_downloads(self):
        self.assertNotIn('expiresAt', self.job)
        self.assertFalse(hasattr(self.service, 'cleanup'))
        with patch.object(server.time, 'time', return_value=4102444800):
            reloaded = server.Service()
            self.assertEqual(reloaded.get(self.id)['status'], 'succeeded')
            self.assertEqual((self.root / self.id / 'shadow.glb').read_bytes(), self.data)
            for _ in range(2):
                response = await self.client.get(f'/v1/jobs/{self.id}/outputs/shadow')
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.read(), self.data)
            self.assertTrue((self.root / self.id / 'input.png').exists())
        self.assertEqual((await (await self.client.get(f'/v1/jobs/{self.id}')).json())['status'], 'succeeded')

    async def test_explicit_deletion_removes_files_and_is_idempotent(self):
        for _ in range(2):
            response = await self.client.delete(f'/v1/jobs/{self.id}')
            self.assertEqual(response.status, 200)
        self.assertFalse((self.root / self.id).exists())
        self.assertNotIn(self.id, self.service.jobs)
        self.assertNotIn(self.id, server.Service().jobs)

    async def test_running_tasks_cannot_be_deleted_during_generation(self):
        self.job['status'] = 'running'
        with self.assertRaises(server.Fault) as error:
            self.service.delete(self.id)
        self.assertEqual(error.exception.status, 409)
        self.assertTrue((self.root / self.id / 'shadow.glb').exists())
        self.job['status'] = 'cancelled'
        self.service.delete(self.id)
        self.assertFalse((self.root / self.id).exists())

    async def test_failed_and_cancelled_metadata_also_have_no_timer(self):
        for status in ['failed', 'cancelled']:
            self.job.update(status=status)
            self.job.pop('_logged', None)
            self.service.complete(self.job)
            self.assertNotIn('expiresAt', self.job)
            with patch.object(server.time, 'time', return_value=4102444800):
                self.assertEqual(server.Service().get(self.id)['status'], status)
            self.assertTrue((self.root / self.id / 'shadow.glb').exists())


if __name__ == '__main__':
    unittest.main()
