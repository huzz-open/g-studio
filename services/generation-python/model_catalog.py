"""Pinned shape-only profiles. Parameter counts verified against every tensor."""
import os

MODELS = {
    'hunyuan-mini': dict(key='mini', name='Hunyuan3D-2mini-Turbo', series='2.0',
        revision='f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6', tag='快速', steps=5, max_steps=10,
        dit='hunyuan3d-dit-v2-mini-turbo', vae='hunyuan3d-vae-v2-mini-turbo',
        counts=(560508992, 1136480768, 203690497)),
    'hunyuan-turbo': dict(key='turbo', name='Hunyuan3D-2-Turbo', series='2.0',
        revision='9cd649ba6913f7a852e3286bad86bfa9a2d83dcf', tag='均衡', steps=5, max_steps=10,
        dit='hunyuan3d-dit-v2-0-turbo', vae='hunyuan3d-vae-v2-0-turbo',
        counts=(1114587200, 1136480768, 203690497)),
    'hunyuan-2-1': dict(key='2.1', name='Hunyuan3D-2.1 Shape', series='2.1',
        revision='0b94677654c57bb9a6b6845cd7b704ccf551d327', tag='精细', steps=50, max_steps=100,
        dit='hunyuan3d-dit-v2-1', vae=None,
        counts=(3050758720, 304368640, 327746177)),
}


def enabled_models():
    if os.environ.get('GEN_SKIP_MODEL') == '1':
        return []
    value = os.environ.get('GEN_MODELS', 'mini')
    if value == 'all':
        return list(MODELS)
    aliases = {v['key']: k for k, v in MODELS.items()}
    result = []
    for key in value.split(','):
        key = aliases.get(key.strip(), key.strip())
        if key not in MODELS:
            raise ValueError('GEN_MODELS must contain mini,turbo,2.1 or all')
        if key not in result:
            result.append(key)
    return result


def image_encoder_precision(provider, backend, precision):
    # MPS FP16 DINO-giant at 1022 produced finite but incorrect conditioning in
    # the real 2026-10-28 comparison. Fix this before loading, never on error.
    return 'fp32' if provider == 'hunyuan-mini' and backend == 'mps' else precision
