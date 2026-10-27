/** Preparation is separate from hardware validation: CUDA packages can be built on a CPU host. */
export function chooseProfile({ platform, requested = 'auto', skip = false, nvidia = false, bundle } = {}) {
  if (!['auto', 'cpu', 'cuda', 'mps', 'xpu', 'rocm'].includes(requested)) throw Error('GEN_DEVICE must be auto, cpu, cuda or mps');
  if (skip) return { variant: 'base', requested: 'cpu' };
  if (requested === 'auto' && bundle?.platform === platform && ['cpu', 'cu124', 'mps', 'base'].includes(bundle.variant)) {
    const defaults = { cpu: 'cpu', cu124: 'cuda', mps: 'mps', base: 'cpu' };
    const allowed = { cpu: ['cpu'], cu124: ['cpu','cuda'], mps: ['cpu','mps'], base: ['cpu'] };
    requested = allowed[bundle.variant].includes(bundle.preferredDevice) ? bundle.preferredDevice : defaults[bundle.variant];
    if (bundle.variant === 'base') return { variant: 'base', requested: 'cpu' };
  }
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
  // download a second copy of an already complete Mac package.
  if (requested === 'cpu') {
    const packagedCuda = bundle?.platform === platform && bundle.variant === 'cu124' && !platform.startsWith('darwin-');
    return { variant: platform === 'darwin-arm64' ? 'mps' : packagedCuda ? 'cu124' : 'cpu', requested: 'cpu' };
  }
  if (platform === 'darwin-arm64') return { variant: 'mps', requested: 'mps' };
  return nvidia ? { variant: 'cu124', requested: 'cuda' } : { variant: 'cpu', requested: 'cpu', reason: 'No supported NVIDIA CUDA device detected; Intel/AMD GPUs use CPU' };
}
