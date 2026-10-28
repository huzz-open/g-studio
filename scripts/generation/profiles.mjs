/** Dependency preparation is separate from accelerator hardware validation. */
export function chooseProfile({ platform, requested = 'auto', skip = false, nvidia = false } = {}) {
  if (!['auto', 'cpu', 'cuda', 'mps', 'xpu', 'rocm'].includes(requested)) throw Error('GEN_DEVICE must be auto, cpu, cuda or mps');
  if (skip) return { variant: 'base', requested: 'cpu' };
  if (platform === 'darwin-x64') throw Error('Pinned PyTorch supports Apple Silicon macOS only; use --base on Intel Mac.');
  if (['xpu', 'rocm'].includes(requested)) return { variant: 'cpu', requested: 'cpu', reason: 'Intel/AMD GPU inference is not supported; using CPU' };
  if (requested === 'cuda') {
    if (platform.startsWith('darwin-')) throw Error('CUDA packages are not available for macOS');
    return { variant: 'cu124', requested: 'cuda' };
  }
  if (requested === 'mps') {
    if (platform !== 'darwin-arm64') throw Error('MPS requires an Apple Silicon Mac');
    return { variant: 'mps', requested: 'mps' };
  }
  // The Mac ARM64 wheel contains both CPU and MPS. A CPU override must not
  // download a second copy of an already complete Mac environment.
  if (requested === 'cpu') {
    return { variant: platform === 'darwin-arm64' ? 'mps' : 'cpu', requested: 'cpu' };
  }
  if (platform === 'darwin-arm64') return { variant: 'mps', requested: 'mps' };
  return nvidia ? { variant: 'cu124', requested: 'cuda' } : { variant: 'cpu', requested: 'cpu', reason: 'No supported NVIDIA CUDA device detected; Intel/AMD GPUs use CPU' };
}
