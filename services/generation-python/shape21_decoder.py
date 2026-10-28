# Hunyuan 3D is licensed under the TENCENT HUNYUAN NON-COMMERCIAL LICENSE AGREEMENT
# except for the third-party components listed below.
# Hunyuan 3D does not impose any additional limitations beyond what is outlined
# in the repsective licenses of these third-party components.
# Users must comply with all terms and conditions of original licenses of these third-party
# components and must ensure that the usage of the third party components adheres to
# all relevant laws and regulations.

# For avoidance of doubts, Hunyuan 3D means the large language models and
# their software and algorithms, including trained model weights, parameters (including
# optimizer states), machine-learning model code, inference-enabling code, training-enabling code,
# fine-tuning enabling code and other elements of the foregoing made publicly available
# by Tencent in accordance with TENCENT HUNYUAN COMMUNITY LICENSE AGREEMENT.

# Adapted from fixed Hunyuan3D-2.1 revision 82920d643c0d.
# Keep grid spacing/bounds floating-point: integer index dtype truncates them.
# Full VAE hierarchical evaluation, without Turbo weights or KV selection.
from typing import Callable, Tuple, Union, List
import numpy as np
import torch
from torch import nn
from einops import repeat
from tqdm import tqdm
from hy3dshape.models.autoencoders.volume_decoders import generate_dense_grid_points, extract_near_surface_volume_fn

class FullShapeVolumeDecoder:
    @torch.no_grad()
    def __call__(
        self,
        latents: torch.FloatTensor,
        geo_decoder: Callable,
        bounds: Union[Tuple[float], List[float], float] = 1.01,
        num_chunks: int = 10000,
        mc_level: float = 0.0,
        octree_resolution: int = None,
        min_resolution: int = 63,
        enable_pbar: bool = True,
        **kwargs,
    ):
        device = latents.device
        dtype = latents.dtype

        resolutions = []
        if octree_resolution < min_resolution:
            resolutions.append(octree_resolution)
        while octree_resolution >= min_resolution:
            resolutions.append(octree_resolution)
            octree_resolution = octree_resolution // 2
        resolutions.reverse()

        # 1. generate query points
        if isinstance(bounds, float):
            bounds = [-bounds, -bounds, -bounds, bounds, bounds, bounds]
        bbox_min = np.array(bounds[0:3])
        bbox_max = np.array(bounds[3:6])
        bbox_size = bbox_max - bbox_min

        xyz_samples, grid_size, length = generate_dense_grid_points(
            bbox_min=bbox_min,
            bbox_max=bbox_max,
            octree_resolution=resolutions[0],
            indexing="ij"
        )

        dilate = nn.Conv3d(1, 1, 3, padding=1, bias=False, device=device, dtype=dtype)
        dilate.weight = torch.nn.Parameter(torch.ones(dilate.weight.shape, dtype=dtype, device=device))

        grid_size = np.array(grid_size)
        xyz_samples = torch.from_numpy(xyz_samples).to(device, dtype=dtype).contiguous().reshape(-1, 3)

        # 2. latents to 3d volume
        batch_logits = []
        batch_size = latents.shape[0]
        for start in tqdm(range(0, xyz_samples.shape[0], num_chunks),
                          desc=f"Hierarchical Volume Decoding [r{resolutions[0] + 1}]", disable=not enable_pbar):
            queries = xyz_samples[start: start + num_chunks, :]
            batch_queries = repeat(queries, "p c -> b p c", b=batch_size)
            logits = geo_decoder(queries=batch_queries, latents=latents)
            batch_logits.append(logits)

        grid_logits = torch.cat(batch_logits, dim=1).view((batch_size, grid_size[0], grid_size[1], grid_size[2]))

        for octree_depth_now in resolutions[1:]:
            grid_size = np.array([octree_depth_now + 1] * 3)
            resolution = bbox_size / octree_depth_now
            next_index = torch.zeros(tuple(grid_size), dtype=dtype, device=device)
            next_logits = torch.full(next_index.shape, -10000., dtype=dtype, device=device)
            curr_points = extract_near_surface_volume_fn(grid_logits.squeeze(0), mc_level)
            curr_points += grid_logits.squeeze(0).abs() < 0.95

            if octree_depth_now == resolutions[-1]:
                expand_num = 0
            else:
                expand_num = 1
            for i in range(expand_num):
                curr_points = dilate(curr_points.unsqueeze(0).to(dtype)).squeeze(0)
            (cidx_x, cidx_y, cidx_z) = torch.where(curr_points > 0)
            next_index[cidx_x * 2, cidx_y * 2, cidx_z * 2] = 1
            for i in range(2 - expand_num):
                next_index = dilate(next_index.unsqueeze(0)).squeeze(0)
            nidx = torch.where(next_index > 0)

            next_points = torch.stack(nidx, dim=1)
            next_points = (next_points * torch.tensor(resolution, dtype=torch.float32, device=device) +
                           torch.tensor(bbox_min, dtype=torch.float32, device=device))
            batch_logits = []
            for start in tqdm(range(0, next_points.shape[0], num_chunks),
                              desc=f"Hierarchical Volume Decoding [r{octree_depth_now + 1}]", disable=not enable_pbar):
                queries = next_points[start: start + num_chunks, :]
                batch_queries = repeat(queries, "p c -> b p c", b=batch_size)
                logits = geo_decoder(queries=batch_queries.to(latents.dtype), latents=latents)
                batch_logits.append(logits)
            grid_logits = torch.cat(batch_logits, dim=1)
            next_logits[nidx] = grid_logits[0, ..., 0]
            grid_logits = next_logits.unsqueeze(0)
        grid_logits[grid_logits == -10000.] = float('nan')

        return grid_logits
