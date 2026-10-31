"""Strict, fixed-source shape adapters shared by resident and phased execution."""
import gc
import importlib
import json
import os
from pathlib import Path
import sys
import types
import time
from compute import inference_dtype, noise_generator
from model_catalog import MODELS, DEFAULT_RESOLUTION, image_encoder_precision

ROOT = Path(os.environ.get('GEN_HOME', Path(__file__).resolve().parents[2] / 'runtime/generation')).resolve()
PROFILE = MODELS[os.environ.get('GEN_PROVIDER', 'hunyuan-mini')]
SOURCE = ROOT / ('vendor/Hunyuan3D-2.1/hy3dshape' if PROFILE['series'] == '2.1' else 'vendor/Hunyuan3D-2')
MODEL = ROOT / 'models' / PROFILE['dit']
VAE = ROOT / 'models' / PROFILE['vae'] if PROFILE['vae'] else MODEL
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', HY3DGEN_DEBUG='0', USE_SAGEATTN='0')


def initialize():
    sys.path.insert(0, str(SOURCE))
    name = 'hy3dshape' if PROFILE['series'] == '2.1' else 'hy3dgen.shapegen'
    # Avoid upstream optional texture/MeshLab imports; use pinned shape modules.
    if name == 'hy3dgen.shapegen': import hy3dgen
    if name not in sys.modules:
        package = types.ModuleType(name)
        package.__path__ = [str(SOURCE / name.replace('.', '/'))]
        package.__package__ = name
        sys.modules[name] = package
    import torch
    import yaml
    torch.set_num_threads(4)
    pipeline = importlib.import_module(name + '.pipelines')
    config = yaml.safe_load((MODEL / 'config.yaml').read_text())
    return torch, pipeline.Hunyuan3DDiTFlowMatchingPipeline, pipeline.instantiate_from_config, config


def load_module(config, filename, prefix, instantiate, dtype_override=None):
    import torch
    from accelerate import init_empty_weights
    from safetensors import safe_open
    start = time.monotonic()
    device = os.environ.get('GEN_DEVICE', 'cpu')
    dtype = dtype_override or inference_dtype(torch, device)
    # Preserve real, deterministic nonpersistent Fourier buffers. Only parameters
    # are meta; to_empty() would leave those buffers uninitialized.
    with init_empty_weights(include_buffers=False):
        module = instantiate(config)
    if prefix == '' and config['target'].endswith('ShapeVAE'):
        module.encoder = module.pre_kl = None  # 2.0 Turbo decoder-only checkpoint.
    expected = module.state_dict()

    def assign(source):
        if set(source) != set(expected):
            raise RuntimeError(f'Checkpoint mismatch: missing={set(expected)-set(source)}, extra={set(source)-set(expected)}')
        loaded = {}
        for key in expected:
            tensor = source[key]()
            if tensor.shape != expected[key].shape: raise RuntimeError('Wrong shape: ' + key)
            loaded[key] = tensor.to(device=device, dtype=dtype if tensor.is_floating_point() else tensor.dtype)
        module.load_state_dict(loaded, strict=True, assign=True)
    if filename.suffix == '.ckpt':
        checkpoint = torch.load(filename, map_location='cpu', mmap=True, weights_only=True)
        values = checkpoint[prefix.rstrip('.')]
        assign({k: (lambda k=k: values[k]) for k in values})
        del values, checkpoint
    else:
        with safe_open(str(filename), framework='pt', device='cpu') as checkpoint:
            assign({k[len(prefix):]: (lambda k=k: checkpoint.get_tensor(k)) for k in checkpoint.keys() if k.startswith(prefix)})
    del expected
    module = module.to(device=device, dtype=dtype).eval().requires_grad_(False)
    print(f'Loaded {prefix or "vae"}: {sum(p.numel() for p in module.parameters()):,} parameters in {time.monotonic()-start:.2f}s', flush=True)
    return module


def fixed_image_forward(encoder, image, mask=None, value_range=(-1, 1), **kwargs):
    """Always preprocess on CPU FP32, before fixed-device transformer execution.

    This is an input adapter selected at initialization, never error-triggered
    CPU fallback. It preserves upstream antialiased resize/crop/normalization.
    """
    import torch
    image = image.to(device='cpu', dtype=torch.float32)
    if value_range is not None:
        low, high = value_range
        image = (image-low)/(high-low)
    inputs = encoder.transform(image).to(device=encoder.model.device, dtype=encoder.model.dtype)
    hidden = encoder.model(inputs).last_hidden_state
    return hidden if encoder.use_cls_token else hidden[:, 1:, :]


def progress(phase):
    print(json.dumps({'phase': phase}), flush=True)


class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, phase=None):
        import yaml
        self.torch, Pipeline, self.instantiate, self.config = initialize()
        self.device = os.environ.get('GEN_DEVICE', 'cpu')
        self.cancel_file = None
        self.pipeline = p = Pipeline.__new__(Pipeline)
        p.device = self.torch.device(self.device)
        p.dtype = inference_dtype(self.torch, self.device)
        p.kwargs = {}
        p.image_processor = self.instantiate(self.config['image_processor'])
        self.vae_config = self.config['vae'] if PROFILE['series'] == '2.1' else yaml.safe_load((VAE / 'config.yaml').read_text())
        checkpoint = MODEL / ('model.fp16.ckpt' if PROFILE['series'] == '2.1' else 'model.fp16.safetensors')
        if phase in (None, 'encode'):
            encoder_precision = image_encoder_precision(os.environ.get('GEN_PROVIDER', 'hunyuan-mini'), self.device, os.environ.get('GEN_PRECISION', 'fp32' if self.device == 'cpu' else 'fp16'))
            p.conditioner = load_module(self.config['conditioner'], checkpoint, 'conditioner.', self.instantiate,
                self.torch.float32 if encoder_precision == 'fp32' else self.torch.float16)
            encoder = p.conditioner.main_image_encoder
            encoder.forward = types.MethodType(fixed_image_forward, encoder)
            for block in encoder.model.encoder.layer:
                block.register_forward_pre_hook(lambda *_: self.check_cancel())
        if phase in (None, 'sample'):
            p.model = load_module(self.config['model'], checkpoint, 'model.', self.instantiate)
            p.scheduler = self.instantiate(self.config['scheduler'])
        if phase in (None, 'mesh'):
            p.vae = load_module(self.vae_config, checkpoint if PROFILE['series'] == '2.1' else VAE / 'model.fp16.safetensors',
                                'vae.' if PROFILE['series'] == '2.1' else '', self.instantiate)
            if PROFILE['series'] == '2.1':
                from shape21_decoder import FullShapeVolumeDecoder
                p.vae.volume_decoder = FullShapeVolumeDecoder()
            else:
                p.vae.enable_flashvdm_decoder(enabled=True, adaptive_kv_selection=True, topk_mode='merge', mc_algo='mc')
                from shape20_decoder import SurfaceSafeFlashVDMVolumeDecoding
                p.vae.volume_decoder = SurfaceSafeFlashVDMVolumeDecoding(topk_mode='merge')
            p.vae.geo_decoder.register_forward_pre_hook(lambda *_: self.check_cancel())
        else:
            p.vae = types.SimpleNamespace(latent_shape=(self.vae_config['params']['num_latents'], self.vae_config['params']['embed_dim']))

    def check_cancel(self):
        if self.cancel_file and self.cancel_file.exists(): raise Cancelled('Task cancellation acknowledged')

    def encode(self, image, folder=None):
        self.check_cancel()
        p = self.pipeline
        prepared = p.prepare_image(image)
        if folder:
            import numpy as np
            from PIL import Image
            preview = prepared['image'][0].permute(1, 2, 0).cpu().float().numpy()
            Image.fromarray(np.clip((preview+1)*127.5, 0, 255).astype('uint8')).save(folder / 'input.png')
        condition = p.encode_cond(prepared['image'], {k: v for k, v in prepared.items() if k != 'image'}, PROFILE['series'] == '2.1', False)
        condition = {key: value.to(p.dtype) for key, value in condition.items()}
        return {'prepared': prepared, 'condition': condition}

    def sample(self, cache, steps, seed):
        self.check_cancel()
        p = self.pipeline
        prepare, encode = p.prepare_image, p.encode_cond
        p.prepare_image = lambda *_, **__: dict(cache['prepared'])
        p.encode_cond = lambda **_: cache['condition']
        def callback(step, *_):
            self.check_cancel()
            print(f'Diffusion step {step+1}/{steps}', flush=True)
        try:
            return p(image=None, num_inference_steps=steps, guidance_scale=5., generator=noise_generator(self.torch, self.device, seed),
                     output_type='latent', callback=callback, callback_steps=1, enable_pbar=False)
        finally:
            p.prepare_image, p.encode_cond = prepare, encode

    def mesh(self, latents, resolution, chunks=2048):
        self.check_cancel()
        mesh = self.pipeline._export(latents, output_type='trimesh', octree_resolution=resolution,
                                     num_chunks=chunks, mc_algo='mc', enable_pbar=False)[0]
        self.check_cancel()
        if mesh is None or not len(mesh.faces): raise ValueError('No valid surface extracted')
        return mesh

    def warmup(self):
        from PIL import Image, ImageDraw
        image = Image.new('RGBA', (128, 128))
        ImageDraw.Draw(image).ellipse((24, 16, 104, 112), fill=(180, 160, 140, 255))
        with self.torch.inference_mode():
            cache = self.encode(image)
            latent = self.sample(cache, 1, 0)
            vae = self.pipeline.vae
            features = vae(latent / vae.scale_factor)
            grid = vae.volume_decoder(features, vae.geo_decoder, octree_resolution=15, num_chunks=512, enable_pbar=False)
            if not self.torch.isfinite(grid).any(): raise ValueError('Nonfinite warmup volume')
        self.synchronize()
        del cache, latent, features, grid
        self.release_cache()

    def synchronize(self):
        if self.device != 'cpu': getattr(self.torch, self.device).synchronize()

    def release_cache(self):
        gc.collect()
        if self.device != 'cpu': getattr(self.torch, self.device).empty_cache()

    def generate(self, folder, request):
        from PIL import Image
        import shutil
        self.cancel_file = folder / 'cancel'
        if not (folder / 'original.png').exists(): shutil.copyfile(folder / 'input.png', folder / 'original.png')
        try:
            with self.torch.inference_mode():
                progress('encode')
                cache = self.encode(Image.open(folder / 'original.png').convert('RGBA'), folder)
                progress('sample')
                latent = self.sample(cache, request.get('parameters', {}).get('steps', PROFILE['steps']), request.get('seed', 12345))
                del cache
                progress('mesh')
                mesh = self.mesh(latent, request.get('parameters', {}).get('resolution', DEFAULT_RESOLUTION))
                mesh.export(folder / 'raw.glb')
                self.synchronize()
        finally:
            self.cancel_file = None


def write_stats(folder, phase, start, extra=None):
    stats = {'phase': phase, 'elapsed_seconds': time.monotonic()-start, **(extra or {})}
    (folder / f'{phase}-stats.json').write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats), flush=True)
