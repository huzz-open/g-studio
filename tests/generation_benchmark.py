"""Real HTTP geometry benchmark. Never substitutes silhouette/mock output.

Requires a running service and its private config file. Writes artifacts only to
an explicitly chosen output directory. Use the generation environment's Python.
The API token is read locally and is never included in the result JSON.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.request
import urllib.error
import uuid

ROOT = Path(__file__).resolve().parents[1]


def run(args):
    config = json.loads(args.config.read_text())
    token = config['token']

    def call(path, data=None, headers=None):
        request = urllib.request.Request(args.url.rstrip('/') + path, data=data,
            headers={'Authorization': 'Bearer ' + token, **(headers or {})})
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    args.output.mkdir(parents=True, exist_ok=True)
    report = {'protocol': 1, 'seed': args.seed, 'resolution': args.resolution,
              'targetFaces': args.target_faces, 'runs': [], 'initialCapabilities': call('/v1/capabilities')}
    def save_report():
        temporary = args.output / 'benchmark.json.tmp'
        temporary.write_text(json.dumps(report, indent=2) + '\n')
        temporary.replace(args.output / 'benchmark.json')

    names = args.inputs.split(',')
    if args.repeat_first:
        names.insert(1, names[0])
    for provider_id in args.models.split(','):
        if provider_id == 'silhouette':
            raise ValueError('This benchmark only accepts actual model providers')
        for index, name in enumerate(names):
            image_path = ROOT / 'public/scene-lighting' / (name + '.png')
            image = image_path.read_bytes()
            caps = call('/v1/capabilities')
            provider = next(p for p in caps['providers'] if p['providerId'] == provider_id)
            steps = args.steps or provider['parameters']['steps']['default']
            request = {'protocolVersion': 1, 'clientRequestId': 'benchmark-' + uuid.uuid4().hex,
                       'providerId': provider_id, 'inputSha256': hashlib.sha256(image).hexdigest(),
                       'targetFaces': args.target_faces, 'seed': args.seed,
                       'parameters': {'steps': steps, 'resolution': args.resolution}}
            boundary = uuid.uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n'
                    + json.dumps(request) + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="input.png"\r\nContent-Type: image/png\r\n\r\n').encode()
            body += image + f'\r\n--{boundary}--\r\n'.encode()
            start = time.monotonic()
            try:
                job = call('/v1/jobs', body, {'Content-Type': 'multipart/form-data; boundary=' + boundary})
            except urllib.error.HTTPError as error:
                detail = json.load(error)
                report['runs'].append({'input': name, 'request': request, 'providerAtSubmit': provider,
                    'wallSeconds': time.monotonic()-start, 'job': {'status': 'failed', 'phase': 'rejected', 'error': detail.get('error', detail)}})
                save_report()
                print(provider_id, name, 'submission rejected', detail, flush=True)
                continue
            record = {'input': name, 'inputFile': str(image_path.relative_to(ROOT)), 'request': request,
                      'providerAtSubmit': provider, 'job': job, 'observedPhases': []}
            report['runs'].append(record)
            print(provider_id, name, job['id'], 'submitted', flush=True)
            while job['status'] not in ('succeeded', 'failed', 'cancelled'):
                phase = job['phase']
                if not record['observedPhases'] or record['observedPhases'][-1]['phase'] != phase:
                    record['observedPhases'].append({'phase': phase, 'afterSeconds': time.monotonic() - start})
                if time.monotonic() - start > args.timeout:
                    call('/v1/jobs/' + job['id'] + '/cancel', b'')
                    raise TimeoutError('Task exceeded benchmark timeout; cancellation requested')
                time.sleep(.5)
                job = call('/v1/jobs/' + job['id'])
            record.update(job=job, wallSeconds=time.monotonic() - start)
            folder = args.output / f'{provider_id}-{index}-{name}'
            folder.mkdir(exist_ok=True)
            if job['status'] == 'succeeded':
                result = job['result']
                output = next(v for v in result['outputs'] if v['id'] == 'shadow')
                with urllib.request.urlopen(urllib.request.Request(
                    args.url.rstrip('/') + '/v1/jobs/' + job['id'] + '/outputs/shadow',
                    headers={'Authorization': 'Bearer ' + token}), timeout=30) as response:
                    glb = response.read()
                if len(glb) != output['bytes'] or hashlib.sha256(glb).hexdigest() != output['sha256'] or glb[:4] != b'glTF':
                    raise ValueError('Output integrity validation failed')
                (folder / 'shadow.glb').write_bytes(glb)
            if args.jobs:
                original = args.jobs / job['id']
                for filename in ('raw.glb', 'input.png', 'original.png', 'output.json', 'execution.log', 'encode-stats.json', 'sample-stats.json', 'mesh-stats.json'):
                    if (original / filename).is_file():
                        shutil.copyfile(original / filename, folder / filename)
            record['artifactDirectory'] = folder.name
            save_report()
            print(provider_id, name, job['status'], round(record['wallSeconds'], 2), job.get('error'), flush=True)
    report['finalCapabilities'] = call('/v1/capabilities')
    save_report()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8765')
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--jobs', type=Path, help='Optional local service jobs directory for raw mesh comparison')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--models', default='hunyuan-mini')
    parser.add_argument('--inputs', default='vase,chair,umbrella,bonsai')
    parser.add_argument('--repeat-first', action='store_true')
    parser.add_argument('--steps', type=int, help='Omit to use each provider default; never compare as identical step counts')
    parser.add_argument('--resolution', type=int, default=256)
    parser.add_argument('--target-faces', type=int, default=12000)
    parser.add_argument('--seed', type=int, default=12345)
    parser.add_argument('--timeout', type=float, default=3600)
    run(parser.parse_args())
