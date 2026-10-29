"""Fixed execution strategy with advisory memory estimates.

Estimates are diagnostic references, never admission limits or peak-memory promises.
MPS shares system memory: its recommended budget is a cap, never extra RAM.
"""
import json
import os
import platform
import subprocess
from model_catalog import MODELS, image_encoder_precision

GIB = 1024 ** 3


def snapshot(backend):
    import psutil
    mem = psutil.virtual_memory()
    data = dict(os=platform.platform(), processor=platform.processor() or '未知',
                systemTotal=mem.total, systemAvailable=mem.available, deviceAvailable=None)
    if platform.system() == 'Darwin':
        result = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            data['processor'] = result.stdout.strip()
    if backend != 'cpu':
        import torch
        if backend == 'mps':
            data['deviceAvailable'] = torch.mps.recommended_max_memory()
        else:
            data['deviceAvailable'] = torch.cuda.mem_get_info()[0]
            data['gpu'] = torch.cuda.get_device_name()
    return data


def plan(ids, backend, precision, memory, mode='resident'):
    if mode not in ('auto', 'resident', 'staged'):
        raise ValueError('GEN_STRATEGY must be auto, resident or staged')
    if precision not in ('fp16', 'fp32') or (backend == 'cpu' and precision != 'fp32'):
        raise ValueError('GEN_PRECISION must be fp16/fp32; CPU requires fp32')
    size = 2 if precision == 'fp16' else 4
    system_reserve = 2 * GIB
    # FP32 MPS encoder driver overhead was ~8.5 GiB in the current real probe.
    workspaces = {k: ((9 if image_encoder_precision(k, backend, precision) == 'fp32' else 5) * GIB
                      if backend == 'mps' else 4 * GIB) for k in ids}
    loading = GIB
    system_available = memory.get('systemAvailable')
    system_budget = max(0, system_available - system_reserve) if system_available is not None else None
    device_budget = memory.get('deviceAvailable')
    # CUDA has dedicated VRAM. MPS shares system memory; do not add its budgets.
    available = device_budget if backend == 'cuda' else system_budget
    if backend == 'mps' and system_budget is not None and device_budget is not None:
        available = min(system_budget, device_budget)
    weights = {k: [count * (4 if i == 1 and image_encoder_precision(k, backend, precision) == 'fp32' else size)
                   for i, count in enumerate(MODELS[k]['counts'])] for k in ids}
    resident = {k: int(sum(weights[k]) * 1.05) for k in ids}
    staged = {k: int(max(weights[k]) * 1.05) for k in ids}

    def cost(group):
        remaining = [staged[k] + workspaces[k] for k in ids if k not in group]
        # Isolated resident processes may retain graph/host allocator caches.
        # Reserve a workspace for EACH resident, plus one shared staged phase.
        return (sum(resident[k] + workspaces[k] for k in group)
                + (max(remaining) if remaining else 0) + loading)

    # Legacy "auto" now means the default resident strategy, never a capacity fallback.
    chosen = () if mode == 'staged' else tuple(ids)
    return dict(strategies={k: ('resident' if k in chosen else 'staged') for k in ids},
        precision=precision, budgetBytes=available, plannedPeakBytes=cost(chosen) if ids else 0,
        residentBytes=sum(resident[k] for k in chosen), systemReserveBytes=system_reserve,
        workspaceReserveBytes=max(workspaces.values(), default=0), workspaceByModel=workspaces, residentWorkspaceBytes=sum(workspaces[k] for k in chosen), loadingReserveBytes=loading, mode=mode)


if __name__ == '__main__':
    print(json.dumps(snapshot(os.environ['GEN_DEVICE']), ensure_ascii=False))
