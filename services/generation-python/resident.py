"""One resident model instance. Task cancellation never terminates this process."""
import json
from pathlib import Path
import sys
import time
import uuid
from runtime import Engine, Cancelled
from memory import MemorySample
from generate import finish, progress

PREFIX = '@generation-worker '


def event(kind, **values):
    print(PREFIX + json.dumps({'event': kind, **values}), flush=True)


def main():
    start = time.monotonic()
    engine = Engine()
    load = time.monotonic() - start
    event('warming')
    start = time.monotonic()
    with MemorySample(engine.torch, engine.device) as memory:
        engine.warmup()
    instance = uuid.uuid4().hex
    event('ready', instanceId=instance, loadCount=1, loadSeconds=load, warmupSeconds=time.monotonic()-start,
          warmupScope='synthetic image, one sampling step, full VAE and resolution-15 volume; excludes full-resolution mesh extraction', memory=memory.values)
    for line in sys.stdin:
        command = json.loads(line)
        folder = Path(command['folder'])
        start = time.monotonic()
        try:
            request = json.loads((folder / 'request.json').read_text())
            with MemorySample(engine.torch, engine.device) as memory:
                engine.generate(folder, request)
                if (folder / 'cancel').exists(): raise Cancelled('Task cancellation acknowledged')
                progress('simplifying')
                meta = finish(folder, request)
                if (folder / 'cancel').exists(): raise Cancelled('Task cancellation acknowledged')
            meta.update(elapsedSeconds=time.monotonic()-start, instanceId=instance, memory=memory.values)
            (folder / 'output.json').write_text(json.dumps(meta))
            result = dict(status='succeeded')
        except Cancelled as error:
            result = dict(status='cancelled', error=str(error))
        except Exception as error:
            import traceback
            traceback.print_exc()
            result = dict(status='failed', error=f'{type(error).__name__}: {error}')
        finally:
            engine.release_cache()
        event('done', **result)


if __name__ == '__main__': main()
