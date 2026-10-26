"""Explicit CPU marching-cubes adapter, no edits to official TripoSR source."""
import sys
import types
from pathlib import Path


def install(root: Path):
    import numpy as np
    import torch
    from skimage.measure import marching_cubes as sk_marching_cubes
    adapter = types.ModuleType('torchmcubes')

    def marching_cubes(volume, level):
        vertices, faces, _, _ = sk_marching_cubes(volume.detach().cpu().numpy(), level=level)
        # torchmcubes returns Z,Y,X for an X,Y,Z tensor. Upstream flips it back.
        return (torch.from_numpy(np.ascontiguousarray(vertices[:, ::-1])),
                torch.from_numpy(faces.copy().astype(np.int64)))
    adapter.marching_cubes = marching_cubes
    sys.modules['torchmcubes'] = adapter
    # Upstream utils eagerly imports background removal, although inference never
    # calls it for our transparent PNG inputs. Avoid another model/runtime startup.
    background = types.ModuleType('rembg')
    def no_background_removal(*args, **kwargs):
        raise RuntimeError('This experiment uses existing PNG alpha; automatic background removal is disabled.')
    background.remove = no_background_removal
    sys.modules['rembg'] = background
    sys.path.insert(0, str(root/'vendor'/'TripoSR'))
    import tsr.models.tokenizers.image as tokenizer
    def local_config(repo_id, filename, **kwargs):
        if repo_id != 'facebook/dino-vitb16' or filename != 'config.json':
            raise ValueError(f'Unexpected remote dependency: {repo_id}/{filename}')
        return str(root/'models'/'dino-config.json')
    tokenizer.hf_hub_download = local_config
