"""Verify pinned resources and every inference component's tensor keys/shapes.

Run with the generation Python. Does not perform inference or allocate real model
parameters. Full file SHA256 is required; metadata-only checks are not acceptance.
"""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / 'services/generation-python'
sys.path.insert(0, str(SERVICE))


def verify(home, model):
    import torch
    import yaml
    from safetensors import safe_open
    from source_wheel import prepare_source
    manifest_name = {'mini': 'model-manifest.json', 'turbo': 'model-manifest-turbo.json', '2.1': 'model-manifest-2.1.json'}[model]
    manifest = json.loads((SERVICE / manifest_name).read_text())
    checked = []
    for item in manifest['files']:
        path = home / item['path']
        if not path.is_file() or path.stat().st_size != item['size']:
            raise ValueError('Missing/wrong size: ' + str(path))
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != item['sha256']:
            raise ValueError('SHA256 mismatch: ' + str(path))
        checked.append({'path': item['path'], 'size': item['size'], 'sha256': digest})
    source = prepare_source(home, series='2.1' if model == '2.1' else '2.0')
    sys.path.insert(0, str(source))
    package_name = 'hy3dshape' if model == '2.1' else 'hy3dgen.shapegen'
    if model != '2.1':
        import hy3dgen
    package = types.ModuleType(package_name)
    package.__path__ = [str(source / package_name.replace('.', '/'))]
    sys.modules[package_name] = package
    pipeline = importlib.import_module(package_name + '.pipelines')
    subfolder = {'mini': 'hunyuan3d-dit-v2-mini-turbo', 'turbo': 'hunyuan3d-dit-v2-0-turbo', '2.1': 'hunyuan3d-dit-v2-1'}[model]
    config = yaml.safe_load((home / 'models' / subfolder / 'config.yaml').read_text())
    if model == '2.1':
        checkpoint = torch.load(home / 'models' / subfolder / 'model.fp16.ckpt', map_location='cpu', weights_only=True, mmap=True)
        tensors = {name: {k: tuple(v.shape) for k, v in values.items()} for name, values in checkpoint.items()}
        del checkpoint
        vae_config = config['vae']
    else:
        with safe_open(str(home / 'models' / subfolder / 'model.fp16.safetensors'), framework='pt', device='cpu') as checkpoint:
            tensors = {name: {k[len(name)+1:]: tuple(checkpoint.get_slice(k).get_shape()) for k in checkpoint.keys() if k.startswith(name+'.')} for name in ['model', 'conditioner']}
        vae_folder = home / 'models' / subfolder.replace('-dit-', '-vae-')
        vae_config = yaml.safe_load((vae_folder / 'config.yaml').read_text())
        with safe_open(str(vae_folder / 'model.fp16.safetensors'), framework='pt', device='cpu') as checkpoint:
            tensors['vae'] = {k: tuple(checkpoint.get_slice(k).get_shape()) for k in checkpoint.keys()}
    components = {}
    for name in ['model', 'conditioner', 'vae']:
        with torch.device('meta'):
            module = pipeline.instantiate_from_config(vae_config if name == 'vae' else config[name])
        if name == 'vae' and model != '2.1':
            module.encoder = module.pre_kl = None
        expected = module.state_dict()
        actual = tensors[name]  # Missing conditioner is a hard failure.
        if set(expected) != set(actual):
            raise ValueError(f'{name}: missing={set(expected)-set(actual)}, extra={set(actual)-set(expected)}')
        for key, value in expected.items():
            if tuple(value.shape) != actual[key]:
                raise ValueError(f'{name}.{key}: incorrect tensor shape')
        components[name] = {'tensors': len(expected), 'parameters': sum(v.numel() for v in expected.values())}
        del module, expected
    return {'model': manifest['model'], 'revision': manifest['revision'], 'files': checked, 'components': components,
            'vae': vae_config['params'], 'imageProcessor': config['image_processor'], 'scheduler': config['scheduler']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=ROOT / 'runtime/generation')
    parser.add_argument('--model', choices=['mini', 'turbo', '2.1'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HY3DGEN_DEBUG='0', USE_SAGEATTN='0')
    report = verify(args.home, args.model)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report['components']))
