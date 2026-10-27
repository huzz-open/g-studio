"""Backend policy shared by inference phases and service fallback handling."""
def inference_dtype(torch, device):
    # CUDA follows the official FP16 path. MPS starts conservatively in FP32.
    return torch.float16 if device == "cuda" else torch.float32


def noise_generator(torch, device, seed):
    # Deliberately use CPU noise on MPS to share seed handling with the CPU path.
    # diffusers.randn_tensor supports generating on CPU then transferring it;
    # this is a compatibility choice, not a claim that MPS lacks a generator.
    return torch.Generator(device="cpu" if device == "mps" else device).manual_seed(seed)


def recoverable_accelerator_error(backend, message):
    text = message.lower()
    shared = ("out of memory", "not implemented for")
    specific = {
        "cuda": ("cuda error", "cublas", "no kernel image", "invalid device function"),
        "mps": ("mps backend", "mps device", "mps tensor", "mpsndarray", "mps does not support"),
    }
    return backend in specific and any(term in text for term in shared + specific[backend])
