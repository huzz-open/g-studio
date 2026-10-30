"""Async JSON-lines control for a dedicated resident model process."""
import asyncio
import json
import sys
import time
from pathlib import Path

PREFIX = '@generation-worker '
INITIALIZATION_LOG_INTERVAL = 15


class WorkerClient:
    def __init__(self, service, provider, env):
        self.service, self.provider, self.env = service, provider, env
        self.process = None
        self.ready = asyncio.get_running_loop().create_future()
        self.pending = None
        self.folder = None
        self.job = None
        self.closed = False
        self.pump = None
        self.initialization_started = None
        self.phase_started = None

    async def report_initialization(self):
        while True:
            await asyncio.sleep(INITIALIZATION_LOG_INTERVAL)
            if self.ready.done(): return
            now = time.monotonic()
            phase = '预热' if self.service.provider_states[self.provider]['state'] == 'warming' else '加载权重与初始化组件'
            print(f'[模型 {self.provider}] 仍在{phase}，等待完成 | 本阶段 {now-self.phase_started:.0f} 秒 | 初始化累计 {now-self.initialization_started:.0f} 秒', flush=True)

    async def start(self):
        self.initialization_started = self.phase_started = time.monotonic()
        print(f'[模型 {self.provider}] 开始加载权重与初始化组件；完成后还需预热，当前尚未就绪', flush=True)
        self.process = await self.service.spawn(sys.executable, '-u', str(Path(__file__).with_name('resident.py')),
            env=self.env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        self.pump = asyncio.create_task(self.read())
        reporter = asyncio.create_task(self.report_initialization())
        try:
            data = await asyncio.wait_for(asyncio.shield(self.ready), 900)
        except asyncio.TimeoutError:
            phase = self.service.provider_states[self.provider]['state']
            raise RuntimeError(f'Model initialization timed out after 900 seconds (phase: {phase})') from None
        finally:
            reporter.cancel()
            await asyncio.gather(reporter, return_exceptions=True)
        if self.process.returncode is not None: raise RuntimeError('Resident worker exited during initialization')
        return data

    async def read(self):
        tail = []
        try:
            async for raw in self.process.stdout:
                line = raw.decode('utf-8', 'replace').strip()
                if self.folder:
                    with (self.folder / 'execution.log').open('a') as log: log.write(line + '\n')
                elif not line.startswith(PREFIX):
                    print(f'[{self.provider}] {line}', flush=True)
                tail = (tail + [line])[-15:]
                if line.startswith(PREFIX):
                    data = json.loads(line[len(PREFIX):])
                    if data['event'] == 'warming':
                        self.service.provider_states[self.provider]['state'] = 'warming'
                        self.phase_started = time.monotonic()
                        print(f'[模型 {self.provider}] 权重与组件初始化完成，开始预热（测试采样与 VAE 解码）；预热完成后才可生成', flush=True)
                    if data['event'] == 'ready' and not self.ready.done(): self.ready.set_result(data)
                    if data['event'] == 'done' and self.pending and not self.pending.done(): self.pending.set_result(data)
                else:
                    try:
                        data = json.loads(line)
                        if self.job and 'phase' in data:
                            self.job['phase'] = data['phase']
                            self.service.save(self.job)
                    except (ValueError, TypeError): pass
            code = await self.process.wait()
            raise RuntimeError(f'Resident worker exited ({code}): ' + '\n'.join(tail)[-1500:])
        except Exception as error:
            for future in (self.ready, self.pending):
                if future is not None and not future.done(): future.set_exception(error)
            if not self.closed: self.service.provider_failed(self.provider, str(error))

    async def run(self, folder, job):
        if not self.process or self.process.returncode is not None: raise RuntimeError('Resident worker is unavailable')
        self.folder, self.job = folder, job
        self.pending = asyncio.get_running_loop().create_future()
        try:
            self.process.stdin.write((json.dumps({'folder': str(folder)}) + '\n').encode())
            await self.process.stdin.drain()
            return await self.pending
        finally:
            self.folder = self.job = None
            self.pending = None

    async def close(self):
        self.closed = True
        if self.process and self.process.returncode is None:
            # EOF lets an idle Python worker release multiprocessing resources.
            # A busy/stuck worker still has a bounded shutdown deadline.
            if self.process.stdin: self.process.stdin.close()
            try: await asyncio.wait_for(self.process.wait(), 2)
            except asyncio.TimeoutError: await self.service.stop_process(self.process)
        self.service.children.discard(self.process)
        if self.pump: await asyncio.gather(self.pump, return_exceptions=True)
        if self.ready.done() and not self.ready.cancelled(): self.ready.exception()
