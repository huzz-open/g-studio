"""One startup decision using aggregate resident weights and peak staged weights.

Estimates are conservative planning limits, not measured peak-memory promises.
MPS shares system memory: its recommended budget is a cap, never extra RAM.
"""
import itertools
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


def plan(ids, backend, precision, memory, mode='auto'):
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
    available = max(0, memory['systemAvailable'] - system_reserve)
    if backend != 'cpu':
        available = min(available, memory['deviceAvailable'])
    weights = {k: [count * (4 if i == 1 and image_encoder_precision(k, backend, precision) == 'fp32' else size)
                   for i, count in enumerate(MODELS[k]['counts'])] for k in ids}
    resident = {k: int(sum(weights[k]) * 1.05) for k in ids}
    staged = {k: int(max(weights[k]) * 1.05) for k in ids}
    eligible = [k for k in ids if staged[k] + workspaces[k] + loading <= available]
    errors = {k: 'Insufficient startup capacity even for staged inference; free memory or explicitly configure a smaller enabled set/precision and restart.' for k in ids if k not in eligible}

    def cost(group):
        remaining = [staged[k] + workspaces[k] for k in eligible if k not in group]
        # Isolated resident processes may retain graph/host allocator caches.
        # Reserve a workspace for EACH resident, plus one shared staged phase.
        return (sum(resident[k] + workspaces[k] for k in group)
                + (max(remaining) if remaining else 0) + loading)

    chosen = ()
    if mode == 'resident':
        if errors or cost(eligible) > available:
            raise ValueError('Aggregate resident models exceed startup capacity; no strategy was substituted')
        chosen = tuple(eligible)
    elif mode == 'auto':
        for count in range(len(eligible), -1, -1):
            chosen = next((group for group in itertools.combinations(eligible, count) if cost(group) <= available), None)
            if chosen is not None:
                break
        chosen = chosen or ()
    return dict(strategies={k: ('resident' if k in chosen else 'staged') for k in eligible}, errors=errors,
        precision=precision, budgetBytes=available, plannedPeakBytes=cost(chosen) if eligible else 0,
        residentBytes=sum(resident[k] for k in chosen), systemReserveBytes=system_reserve,
        workspaceReserveBytes=max(workspaces.values(), default=0), workspaceByModel=workspaces, residentWorkspaceBytes=sum(workspaces[k] for k in chosen), loadingReserveBytes=loading, mode=mode)


if __name__ == '__main__':
    print(json.dumps(snapshot(os.environ['GEN_DEVICE']), ensure_ascii=False))
