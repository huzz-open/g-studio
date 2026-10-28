"""Fixed precision and noise policy; execution errors never change backends."""
import os


def inference_dtype(torch, device):
    precision = os.environ.get('GEN_PRECISION', 'fp32' if device == 'cpu' else 'fp16')
    if precision not in ('fp16', 'fp32') or (device == 'cpu' and precision != 'fp32'):
        raise ValueError('Unsupported fixed inference precision')
    return torch.float16 if precision == 'fp16' else torch.float32


def noise_generator(torch, device, seed):
    return torch.Generator(device='cpu' if device == 'mps' else device).manual_seed(seed)
