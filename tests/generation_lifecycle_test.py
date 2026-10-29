"""Control-plane tests with synthetic workers; not geometry-quality acceptance."""
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/generation-python'))
IMPORT_HOME = tempfile.TemporaryDirectory()
os.environ.update(GEN_DATA_HOME=IMPORT_HOME.name, GEN_SKIP_MODEL='1', GEN_DEVICE='cpu')
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image
import server
from policy import plan, GIB


class PolicyTests(unittest.TestCase):
    def test_estimates_do_not_reject_or_change_strategy_on_any_backend(self):
        ids = ['hunyuan-mini', 'hunyuan-turbo', 'hunyuan-2-1']
        for backend, precision in [('cpu', 'fp32'), ('cuda', 'fp16'), ('mps', 'fp16')]:
            for mode in ['auto', 'resident', 'staged']:
                with self.subTest(backend=backend, mode=mode):
                    result = plan(ids, backend, precision, dict(systemAvailable=0, deviceAvailable=0), mode)
                    expected = 'staged' if mode == 'staged' else 'resident'
                    self.assertEqual(result['strategies'], {id: expected for id in ids})
                    self.assertEqual(result['precision'], precision)
                    self.assertGreater(result['plannedPeakBytes'], result['budgetBytes'])
        self.assertEqual(plan(ids, 'cuda', 'fp16', {})['strategies'], {id: 'resident' for id in ids})

    def test_diagnostic_estimates_keep_distinct_cuda_and_shared_mps_budgets(self):
        cuda = plan(['hunyuan-mini'], 'cuda', 'fp16', dict(systemAvailable=5*GIB, deviceAvailable=10*GIB))
        self.assertEqual(cuda['budgetBytes'], 10*GIB)
        result = plan(['hunyuan-mini', 'hunyuan-turbo'], 'mps', 'fp16', dict(systemAvailable=20*GIB, deviceAvailable=24*GIB))
        self.assertEqual(result['strategies'], {'hunyuan-mini':'resident', 'hunyuan-turbo':'resident'})
        self.assertEqual(result['budgetBytes'], 18*GIB)
        self.assertEqual(result['residentWorkspaceBytes'], 14*GIB)
        self.assertGreater(result['plannedPeakBytes'], result['budgetBytes'])

    def test_invalid_configuration_still_fails(self):
        with self.assertRaises(ValueError):
            plan(['hunyuan-mini'], 'cuda', 'fp16', {}, 'invalid')
        with self.assertRaises(ValueError):
            plan(['hunyuan-mini'], 'cpu', 'fp16', dict(systemAvailable=64*GIB))


class FakeResident:
    def __init__(self):
        self.instance = 'one-instance'
        self.calls = []
        self.started = asyncio.Event()
        self.release = asyncio.Event(); self.release.set()
        self.error = None
        self.invalid = False

    async def run(self, folder, job):
        self.calls.append(job['id']); self.started.set()
        await self.release.wait()
        if (folder/'cancel').exists(): return {'status':'cancelled'}
        if self.error: return {'status':'failed', 'error':self.error}
        # Small self-contained fixture; no inference is performed in these tests.
        import trimesh
        mesh = trimesh.creation.box()
        mesh.export(folder/'raw.glb')
        from generate import finish
        meta = finish(folder, job['parameters']); meta['instanceId'] = self.instance
        (folder/'output.json').write_text(json.dumps(meta))
        if self.invalid: (folder/'shadow.glb').write_bytes(b'invalid')
        return {'status':'succeeded'}

    async def close(self): pass


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(server, 'JOBS', Path(self.temp.name)); self.patch.start()
        self.service = server.Service()
        self.global_patch = patch.object(server, 'service', self.service); self.global_patch.start()
        self.service.device, self.service.backend, self.service.precision = 'gpu', 'mps', 'fp16'
        self.fake = FakeResident()
        self.service.residents['hunyuan-mini'] = self.fake
        self.state = self.service.provider_states['hunyuan-mini']
        self.state.update(state='loading', acceptsJobs=True, strategy='resident', tags=['快速'])
        self.service.tasks = [asyncio.create_task(self.service.worker())]
        app = web.Application()
        app.add_routes([web.get('/health',server.health), web.get('/v1/capabilities',server.capabilities), web.post('/v1/jobs',server.submit),
            web.get('/v1/jobs/{id}',server.status),web.post('/v1/jobs/{id}/cancel',server.cancel)])
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        image = io.BytesIO(); Image.new('RGBA',(8,8),(128,128,128,255)).save(image,format='PNG'); self.image=image.getvalue()
        self.index=0

    async def asyncTearDown(self):
        self.fake.release.set()
        await self.service.close(); await self.client.close()
        self.global_patch.stop(); self.patch.stop(); self.temp.cleanup()

    async def submit(self, provider='hunyuan-mini'):
        self.index+=1
        data=FormData();data.add_field('request',json.dumps(dict(protocolVersion=1,providerId=provider,clientRequestId=str(self.index),inputSha256=hashlib.sha256(self.image).hexdigest())))
        data.add_field('image',self.image,filename='input.png',content_type='image/png')
        response=await asyncio.wait_for(self.client.post('/v1/jobs',data=data),.5)
        self.assertEqual(response.status,202)
        return await response.json()

    def ready(self):
        self.state['state']='ready'; self.service.wake.set()

    async def terminal(self,id):
        for _ in range(200):
            job=self.service.get(id)
            if job['status'] in server.TERMINAL:return job
            await asyncio.sleep(.01)
        self.fail('Job remained pending')

    async def test_loading_http_responsive_cancel_does_not_restart_shared_load(self):
        load_count=0; loading=asyncio.Event()
        async def prepare():
            nonlocal load_count
            load_count+=1;await loading.wait();self.ready()
        self.service.tasks.append(asyncio.create_task(prepare()))
        first,second=await asyncio.gather(self.submit(),self.submit())
        for url in ['/health','/v1/capabilities','/v1/jobs/'+first['id']]:
            self.assertEqual((await asyncio.wait_for(self.client.get(url),.3)).status,200)
        cancelled=await (await self.client.post('/v1/jobs/'+first['id']+'/cancel')).json()
        self.assertEqual(cancelled['status'],'cancelled')
        self.assertEqual(cancelled['timings']['executionSeconds'],0)
        self.assertEqual(load_count,1);self.assertFalse(self.fake.calls)
        loading.set(); completed=await self.terminal(second['id'])
        self.assertEqual(completed['status'],'succeeded')
        third=await self.submit();again=await self.terminal(third['id'])
        self.assertEqual(completed['result']['instanceId'],again['result']['instanceId'])
        self.assertEqual(load_count,1);self.assertEqual(len(self.fake.calls),2)

    async def test_running_cancel_keeps_resident_for_next_task(self):
        self.ready();self.fake.release.clear()
        first=await self.submit();await self.fake.started.wait()
        cancelled=await (await self.client.post('/v1/jobs/'+first['id']+'/cancel')).json()
        self.assertEqual(cancelled['status'],'cancel_requested')
        second=await self.submit();self.fake.release.set()
        self.assertEqual((await self.terminal(first['id']))['status'],'cancelled')
        self.assertEqual((await self.terminal(second['id']))['status'],'succeeded')
        self.assertIs(self.service.residents['hunyuan-mini'],self.fake)

    async def test_ready_model_bypasses_waiting_model_and_failure_finishes_queue(self):
        first=await self.submit()
        self.service.provider_states['hunyuan-turbo'].update(state='ready',acceptsJobs=True,strategy='resident')
        self.service.residents['hunyuan-turbo']=self.fake
        second=await self.submit('hunyuan-turbo')
        self.assertEqual((await self.terminal(second['id']))['status'],'succeeded')
        self.assertEqual(self.service.get(first['id'])['status'],'queued')
        self.service.provider_failed('hunyuan-mini','Offline resource missing')
        self.assertEqual(self.service.get(first['id'])['error']['code'],'PREPARATION_FAILED')
        self.assertFalse(self.state['acceptsJobs'])

    async def test_queue_capacity_counts_live_tasks_and_execution_waits_for_lock(self):
        jobs=[await self.submit() for _ in range(8)]
        with self.assertRaises(server.Fault) as error:
            request=dict(protocolVersion=1,providerId='hunyuan-mini',clientRequestId='overflow',inputSha256=hashlib.sha256(self.image).hexdigest())
            await self.service.submit(request,self.image)
        self.assertEqual(error.exception.code,'QUEUE_FULL')
        await self.service.cancel(jobs[0]['id']);extra=await self.submit()
        await self.service.compute_lock.acquire();self.ready();await asyncio.sleep(.02)
        self.assertEqual(self.service.get(extra['id'])['status'],'queued')
        await self.service.cancel(extra['id']);self.service.compute_lock.release()
        self.assertEqual(self.service.get(extra['id'])['timings']['executionSeconds'],0)

    async def test_oom_and_invalid_output_fail_without_backend_or_strategy_change(self):
        self.ready();self.fake.error='MPS out of memory'
        first=await self.submit();failed=await self.terminal(first['id'])
        self.assertEqual(failed['status'],'failed')
        self.assertIn('MPS out of memory', failed['error']['message'])
        self.fake.error=None;self.fake.invalid=True
        second=await self.submit();self.assertEqual((await self.terminal(second['id']))['status'],'failed')
        self.assertEqual(self.service.backend,'mps');self.assertEqual(self.state['strategy'],'resident')
        self.assertEqual(len(self.fake.calls),2)  # No automatic retries.

    async def prepare_with_low_memory(self, load_error=None, diagnostics_error=False):
        self.service.enabled = ['hunyuan-mini']
        process = Mock()
        process.wait = AsyncMock(return_value=0)
        client = Mock()
        client.start = AsyncMock(side_effect=load_error, return_value={'event': 'ready', 'loadCount': 1})
        client.close = AsyncMock()
        diagnostics = RuntimeError('Memory query unavailable') if diagnostics_error else dict(systemAvailable=0, deviceAvailable=0)
        with patch.dict(os.environ, GEN_PRECISION='fp16', GEN_STRATEGY='auto'), \
             patch.object(self.service, 'read_json', AsyncMock(side_effect=[dict(deviceType='gpu', backend='cuda', reason='CUDA passed'), diagnostics])), \
             patch.object(self.service, 'spawn', AsyncMock(return_value=process)), \
             patch.object(self.service, 'print_table'), \
             patch.object(self.service, 'staged', AsyncMock()) as staged, \
             patch.object(server, 'WorkerClient', return_value=client) as factory:
            await self.service.prepare()
            client.start.assert_awaited_once()
            staged.assert_not_awaited()
            self.assertEqual(factory.call_args.args[2]['GEN_DEVICE'], 'cuda')
            self.assertEqual(factory.call_args.args[2]['GEN_PRECISION'], 'fp16')
        self.assertEqual(self.service.backend, 'cuda')
        self.assertEqual(self.state['strategy'], 'resident')
        self.assertEqual(self.state['precision'], 'fp16')
        return client

    async def test_low_memory_estimate_still_attempts_resident_loading(self):
        await self.prepare_with_low_memory()
        self.assertEqual(self.state['state'], 'ready')
        self.assertTrue(self.state['acceptsJobs'])

    async def test_missing_memory_diagnostics_do_not_block_loading(self):
        await self.prepare_with_low_memory(diagnostics_error=True)
        self.assertEqual(self.state['state'], 'ready')

    async def test_actual_loading_oom_fails_model_and_queue_without_fallback(self):
        job = await self.submit()
        client = await self.prepare_with_low_memory(RuntimeError('CUDA out of memory'))
        self.assertEqual(self.state['state'], 'failed')
        self.assertFalse(self.state['acceptsJobs'])
        self.assertIn('CUDA out of memory', self.state['error'])
        failed = await self.terminal(job['id'])
        self.assertEqual(failed['status'], 'failed')
        self.assertIn('CUDA out of memory', failed['error']['message'])
        client.close.assert_awaited_once()

    async def test_shutdown_and_restart_preserve_interrupted_semantics(self):
        first=await self.submit();await self.service.close()
        self.assertEqual(self.service.get(first['id'])['phase'],'interrupted')
        restarted=server.Service()
        self.assertEqual(restarted.get(first['id'])['error']['code'],'INTERRUPTED')
        unfinished = dict(restarted.get(first['id']), status='running', phase='sample')
        self.service.save(unfinished)  # Simulate an abrupt stop before terminal persistence.
        crashed = server.Service()
        self.assertEqual(crashed.get(first['id'])['status'], 'failed')
        self.assertEqual(crashed.get(first['id'])['phase'], 'interrupted')


if __name__=='__main__': unittest.main(verbosity=2)
