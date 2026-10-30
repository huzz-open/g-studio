"""Initialization reporting uses worker events and stops when startup ends."""
import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/generation-python'))
import worker_client


class WorkerLoggingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stream = asyncio.StreamReader()
        process = SimpleNamespace(stdout=self.stream, returncode=None, wait=AsyncMock(return_value=1))
        self.service = SimpleNamespace(
            spawn=AsyncMock(return_value=process),
            provider_states={'hunyuan-mini': {'state': 'loading'}},
            provider_failed=Mock(),
        )
        self.client = worker_client.WorkerClient(self.service, 'hunyuan-mini', {})

    async def asyncTearDown(self):
        if self.client.pump:
            self.client.pump.cancel()
            await asyncio.gather(self.client.pump, return_exceptions=True)

    async def test_reports_loading_then_warmup_and_stops_on_ready(self):
        loading, warming = asyncio.Event(), asyncio.Event()
        lines = []

        def record(line, **kwargs):
            lines.append(line)
            if '仍在加载' in line: loading.set()
            if '仍在预热' in line: warming.set()

        with patch.object(worker_client, 'INITIALIZATION_LOG_INTERVAL', .005), patch('builtins.print', side_effect=record):
            task = asyncio.create_task(self.client.start())
            try:
                await asyncio.wait_for(loading.wait(), 1)
                self.stream.feed_data(b'Loaded model: component only\n')
                self.stream.feed_data(b'@generation-worker {"event":"warming"}\n')
                await asyncio.wait_for(warming.wait(), 1)
                self.assertEqual(self.service.provider_states['hunyuan-mini']['state'], 'warming')
                self.assertFalse(task.done(), 'warming is not ready')
                self.stream.feed_data(b'@generation-worker {"event":"ready","loadSeconds":2,"warmupSeconds":3}\n')
                result = await asyncio.wait_for(task, 1)
                count = len(lines)
                await asyncio.sleep(.02)
                self.assertEqual(len(lines), count, 'reporter must stop after readiness')
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self.assertEqual(result['warmupSeconds'], 3)
        self.assertTrue(any('开始预热' in line for line in lines))
        self.assertTrue(any('Loaded model' in line for line in lines))
        self.assertFalse(any('@generation-worker' in line for line in lines))
        self.service.provider_failed.assert_not_called()

    async def test_worker_failure_stops_waiting_and_reporting(self):
        with patch.object(worker_client, 'INITIALIZATION_LOG_INTERVAL', .005), patch('builtins.print') as log:
            self.stream.feed_data(b'Cannot load VAE\n')
            self.stream.feed_eof()
            with self.assertRaisesRegex(RuntimeError, 'Cannot load VAE'):
                await asyncio.wait_for(self.client.start(), 1)
            count = log.call_count
            await asyncio.sleep(.02)
            self.assertEqual(log.call_count, count)
        self.service.provider_failed.assert_called_once()


if __name__ == '__main__': unittest.main(verbosity=2)
