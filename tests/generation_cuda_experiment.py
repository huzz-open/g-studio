"""Measured CUDA comparison of pinned upstream Pipeline and project adapter.

Use the generation Python. Extra optional upstream dependencies may be supplied
with PYTHONPATH. Runs one model per process; never retries on another device.
JSON is saved after each run, including failures. Raw geometry is retained.
"""
import argparse
import functools
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import threading
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'runtime/generation'
sys.path.insert(0, str(ROOT / 'services/generation-python'))
from model_catalog import MODELS


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(args):
    if args.compare_decoders and (args.path != 'project' or args.model != 'hunyuan-2-1'):
        raise ValueError('--compare-decoders requires --path project --model hunyuan-2-1')
    args.output.mkdir(parents=True, exist_ok=True)
    profile = MODELS[args.model]
    os.environ.update(GEN_DEVICE='cuda', GEN_PRECISION='fp16', GEN_PROVIDER=args.model,
                      HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', USE_SAGEATTN='0', HY3DGEN_DEBUG='0')
    import psutil
    import torch
    from PIL import Image
    if args.threads:
        torch.set_num_threads(args.threads)
    report = {'arguments': vars(args) | {'output': str(args.output)}, 'model': profile,
              'environment': {'python': sys.version, 'platform': platform.platform(),
                  'torch': torch.__version__, 'cuda': torch.version.cuda,
                  'gpu': torch.cuda.get_device_name(0), 'gpuBytes': torch.cuda.get_device_properties(0).total_memory,
                  'systemMemory': dict(psutil.virtual_memory()._asdict()),
                  'dependencies': {n: importlib.metadata.version(n) for n in
                                   ['torchvision','transformers','diffusers','accelerate','numpy','trimesh']}},
              'runs': [], 'sourceVerification': [], 'harnessSha256': digest(Path(__file__))}
    def save():
        path = args.output / 'report.json'
        path.with_suffix('.tmp').write_text(json.dumps(report, indent=2), encoding='utf-8')
        path.with_suffix('.tmp').replace(path)
    proc = psutil.Process()
    monitoring = threading.Event()
    memory = {'peakRssBytes': 0, 'peakPrivateBytes': 0, 'minimumSystemAvailableBytes': psutil.virtual_memory().available}
    def monitor():
        while not monitoring.wait(.1):
            info = proc.memory_info()
            memory['peakRssBytes'] = max(memory['peakRssBytes'], info.rss)
            memory['peakPrivateBytes'] = max(memory['peakPrivateBytes'], getattr(info, 'private', info.vms))
            memory['minimumSystemAvailableBytes'] = min(memory['minimumSystemAvailableBytes'], psutil.virtual_memory().available)
    threading.Thread(target=monitor, daemon=True).start()
    def gpu_stats():
        return {'allocatedBytes': torch.cuda.memory_allocated(), 'reservedBytes': torch.cuda.memory_reserved(),
                'peakAllocatedBytes': torch.cuda.max_memory_allocated(), 'peakReservedBytes': torch.cuda.max_memory_reserved(),
                'freeTotalBytes': list(torch.cuda.mem_get_info()), **memory}
    save()
    try:
        series21 = profile['series'] == '2.1'
        manifest = ROOT / 'services/generation-python/bundled' / ('wheels-2.1' if series21 else 'wheels') / 'source-manifest.json'
        source_manifest = json.loads(manifest.read_text())
        report['sourceRevision'] = source_manifest['revision']
        for entry in source_manifest['files']:
            if not entry['path'].endswith('.py'):
                continue
            file = HOME / entry['path']
            actual = digest(file)
            if actual != entry['sha256']:
                raise ValueError('Upstream source hash mismatch: ' + str(file))
            report['sourceVerification'].append({'path': entry['path'], 'sha256': actual})
        source = HOME / ('vendor/Hunyuan3D-2.1/hy3dshape' if series21 else 'vendor/Hunyuan3D-2')
        sys.path.insert(0, str(source))
        started = time.perf_counter()
        if args.path == 'project':
            from runtime import Engine
            engine = Engine()
            pipe = engine.pipeline
        else:
            if series21:
                from hy3dshape import Hunyuan3DDiTFlowMatchingPipeline as Pipeline
            else:
                from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline as Pipeline
                from hy3dgen.shapegen.models.autoencoders import ShapeVAE
            pipe = Pipeline.from_pretrained(str(HOME / 'models'), subfolder=profile['dit'],
                use_safetensors=not series21, variant='fp16', dtype=torch.float16,
                device='cpu' if args.offload else 'cuda')
            if not series21:
                # Local cache layout differs from HF repository names. Explicitly
                # load the corresponding VAE through its upstream public loader.
                pipe.vae = ShapeVAE.from_pretrained(str(HOME / 'models'), subfolder=profile['vae'],
                    device='cpu' if args.offload else 'cuda', dtype=torch.float16)
                pipe.enable_flashvdm(replace_vae=False, topk_mode=args.topk)
            if args.offload:
                pipe.enable_model_cpu_offload()
        torch.cuda.synchronize()
        report['loadSeconds'] = time.perf_counter() - started
        report['afterLoad'] = gpu_stats()
        report['instanceId'] = str(id(pipe))
        report['loadCount'] = 1
        report['torchThreads'] = torch.get_num_threads()
        print('LOADED', report['loadSeconds'], report['afterLoad'], flush=True)
        save()
        timings = {}
        def instrument(obj, name, label):
            original = getattr(obj, name)
            @functools.wraps(original)
            def measured(*a, **kw):
                torch.cuda.synchronize()
                start = time.perf_counter()
                try:
                    return original(*a, **kw)
                finally:
                    torch.cuda.synchronize()
                    timings[label] = timings.get(label, 0) + time.perf_counter() - start
            setattr(obj, name, measured)
        instrument(pipe, 'prepare_image', 'preprocess')
        instrument(pipe, 'encode_cond', 'condition')
        instrument(pipe, '_export', 'export')
        instrument(pipe.vae, 'forward', 'vae')
        cases = [(name, chunks, topk, args.resolution) for topk in (args.topk_list or args.topk).split(',')
                 for chunks in [int(x) for x in (args.chunks_list or str(args.chunks)).split(',')]
                 for name in args.inputs.split(',')]
        if args.extra_default_runs:
            cases.extend([('vase', 8000, 'mean', 384)] * 2)
        for index, (name, chunks, topk, resolution) in enumerate(cases):
            if args.path == 'official' and not series21:
                pipe.enable_flashvdm(replace_vae=False, topk_mode=topk)
            image_path = ROOT / 'public/scene-lighting' / (name + '.png')
            folder = args.output / f'{index}-{name}'
            folder.mkdir(exist_ok=True)
            record = {'input': name, 'inputSha256': digest(image_path), 'instanceId': str(id(pipe)),
                      'steps': args.steps or profile['steps'], 'seed': args.seed, 'resolution': resolution,
                      'chunks': chunks, 'topk': ('merge' if args.path == 'project' else topk) if not series21 else None,
                      'timings': {}}
            report['runs'].append(record)
            timings.clear()
            memory['peakRssBytes'] = proc.memory_info().rss
            memory['peakPrivateBytes'] = getattr(proc.memory_info(), 'private', proc.memory_info().vms)
            memory['minimumSystemAvailableBytes'] = psutil.virtual_memory().available
            torch.cuda.reset_peak_memory_stats()
            start = time.perf_counter()
            try:
                image = Image.open(image_path).convert('RGBA')
                with torch.inference_mode():
                    if args.path == 'project':
                        cache = engine.encode(image)
                        latent = engine.sample(cache, record['steps'], args.seed)
                        del cache
                        mesh = engine.mesh(latent, resolution, chunks=chunks)
                        if not args.compare_decoders:
                            del latent
                    else:
                        mesh = pipe(image=image, num_inference_steps=record['steps'], guidance_scale=5.,
                            octree_resolution=resolution, num_chunks=chunks,
                            generator=torch.Generator(device='cuda').manual_seed(args.seed),
                            output_type='trimesh', mc_algo='mc')[0]
                torch.cuda.synchronize()
                record['inferenceSeconds'] = time.perf_counter() - start
                record['timings'] = dict(timings)
                record['sampleAndOverheadSeconds'] = record['inferenceSeconds'] - sum(timings.get(k, 0) for k in ['preprocess','condition','export'])
                record['memory'] = gpu_stats()
                if mesh is None or not len(mesh.faces):
                    raise ValueError('No mesh')
                mesh.export(folder / 'raw.glb')
                import numpy as np
                record['geometry'] = {'faces': len(mesh.faces), 'vertices': len(mesh.vertices),
                    'bounds': mesh.bounds.tolist(), 'extents': mesh.extents.tolist(),
                    'watertight': bool(mesh.is_watertight), 'volume': float(mesh.volume),
                    'finite': bool(np.isfinite(mesh.vertices).all()), 'sha256': digest(folder / 'raw.glb')}
                record['status'] = 'succeeded'
                del mesh
                if args.compare_decoders:
                    if args.path != 'project' or not series21:
                        raise ValueError('--compare-decoders requires project Hunyuan3D-2.1')
                    from hy3dshape.models.autoencoders.volume_decoders import HierarchicalVolumeDecoding, VanillaVolumeDecoder
                    original_decoder = pipe.vae.volume_decoder
                    torch.save(latent.cpu(), folder / 'latent.pt')
                    record['latentSha256'] = digest(folder / 'latent.pt')
                    record['decoderComparison'] = []
                    # All three see exactly the same latent, VAE, extraction
                    # algorithm, precision, resolution and chunk size. These
                    # are preplanned comparisons, not failure-triggered retries.
                    for label, decoder in [('project-hierarchical', original_decoder),
                                           ('official-hierarchical', HierarchicalVolumeDecoding()),
                                           ('official-dense', VanillaVolumeDecoder())]:
                        pipe.vae.volume_decoder = decoder
                        torch.cuda.synchronize()
                        torch.cuda.reset_peak_memory_stats()
                        extra = {'decoder': label, 'chunks': 8000, 'resolution': resolution}
                        decode_start = time.perf_counter()
                        try:
                            with torch.inference_mode():
                                other = engine.mesh(latent, resolution, chunks=8000)
                            torch.cuda.synchronize()
                            extra.update(seconds=time.perf_counter()-decode_start,
                                         peakAllocatedBytes=torch.cuda.max_memory_allocated())
                            other.export(folder / (label + '.glb'))
                            extra.update(status='succeeded', faces=len(other.faces),
                                         bounds=other.bounds.tolist(), volume=float(other.volume),
                                         sha256=digest(folder / (label + '.glb')))
                            del other
                        except Exception:
                            extra.update(status='failed', seconds=time.perf_counter()-decode_start,
                                         error=traceback.format_exc())
                        record['decoderComparison'].append(extra)
                        save()
                        print('DECODER', json.dumps(extra), flush=True)
                    pipe.vae.volume_decoder = original_decoder
                    del latent
            except Exception:
                record.update(status='failed', error=traceback.format_exc(), wallSeconds=time.perf_counter()-start,
                              memory=gpu_stats(), timings=dict(timings))
                print(record['error'], flush=True)
                # No automatic device/precision/strategy fallback or OOM retry.
                break
            finally:
                save()
                print('RESULT', json.dumps(record), flush=True)
    except Exception:
        report['fatalError'] = traceback.format_exc()
        print(report['fatalError'], flush=True)
    finally:
        monitoring.set()
        report['processMemory'] = memory
        save()
    return not report.get('fatalError') and bool(report['runs']) and all(r.get('status') == 'succeeded' for r in report['runs'])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model', choices=list(MODELS), required=True)
    p.add_argument('--path', choices=['official', 'project'], default='official')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--inputs', default='vase,vase,chair,umbrella,bonsai,vase')
    p.add_argument('--resolution', type=int, default=256)
    p.add_argument('--chunks', type=int, default=8000)
    p.add_argument('--topk', choices=['mean','merge'], default='mean')
    p.add_argument('--chunks-list', help='Controlled sweep of comma-separated chunk sizes on the same loaded Pipeline')
    p.add_argument('--topk-list', help='Controlled sweep: mean,merge (official 2.0 only)')
    p.add_argument('--threads', type=int, help='Explicit CPU thread count, recorded for controlled comparisons')
    p.add_argument('--extra-default-runs', action='store_true', help='Append two vase runs at upstream default resolution 384 and chunks 8000')
    p.add_argument('--compare-decoders', action='store_true', help='After each project 2.1 run, compare three decoders on the identical saved latent')
    p.add_argument('--offload', action='store_true')
    p.add_argument('--steps', type=int)
    p.add_argument('--seed', type=int, default=12345)
    raise SystemExit(0 if main(p.parse_args()) else 1)
