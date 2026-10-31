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

# Adapted from pinned Hunyuan3D-2 f8db63096c82. Normal FlashVDM path
# is unchanged; empty refinement gets complete sampling of the SAME shape.
from typing import Union, Tuple, List
import numpy as np
import torch
from torch import nn
from einops import repeat
from tqdm import tqdm
from hy3dgen.shapegen.models.autoencoders.attention_blocks import CrossAttentionDecoder
from hy3dgen.shapegen.models.autoencoders.volume_decoders import generate_dense_grid_points, extract_near_surface_volume_fn
from hy3dgen.shapegen.models.autoencoders.attention_processors import CrossAttentionProcessor, FlashVDMCrossAttentionProcessor, FlashVDMTopMCrossAttentionProcessor
from hy3dgen.shapegen.utils import logger


def complete_surface_grid(latents, geo_decoder, bounds, resolution, num_chunks, level, previous_processor):
    """Bound GPU query memory; keep the full output grid on CPU for marching cubes.

    Uses upstream dense-grid coordinates, same VAE features/device/precision.
    Does not resample, change seeds, thicken model, or retry unrelated errors.
    """
    if isinstance(bounds, (int, float)):
        bounds = [-bounds] * 3 + [bounds] * 3
    side = int(resolution) + 1
    axes = [np.linspace(bounds[i], bounds[i + 3], side, dtype=np.float32) for i in range(3)]
    count = side ** 3
    result = torch.empty((latents.shape[0], count), dtype=torch.float32, device='cpu')
    geo_decoder.set_cross_attention_processor(CrossAttentionProcessor())
    try:
        for start in range(0, count, num_chunks):
            indices = np.arange(start, min(start + num_chunks, count))
            points = np.stack([axes[0][indices // (side * side)],
                               axes[1][indices // side % side], axes[2][indices % side]], axis=-1)
            queries = torch.from_numpy(points).to(device=latents.device, dtype=latents.dtype)
            queries = queries.unsqueeze(0).expand(latents.shape[0], -1, -1)
            values = geo_decoder(queries=queries, latents=latents).squeeze(-1)
            if not torch.isfinite(values).all():
                raise ValueError('Shape decoder produced non-finite surface values')
            result[:, start:start + len(indices)] = values.float().cpu()
    finally:
        geo_decoder.set_cross_attention_processor(previous_processor)
    for sample in result:
        if not (sample.min() < level and sample.max() > level):
            raise ValueError('No surface found at the requested resolution after complete sampling; try another seed or a higher resolution')
    return result.reshape(latents.shape[0], side, side, side)


class SurfaceSafeFlashVDMVolumeDecoding:
    def __init__(self, topk_mode='mean'):
        if topk_mode not in ['mean', 'merge']:
            raise ValueError(f'Unsupported topk_mode {topk_mode}, available: {["mean", "merge"]}')

        if topk_mode == 'mean':
            self.processor = FlashVDMCrossAttentionProcessor()
        else:
            self.processor = FlashVDMTopMCrossAttentionProcessor()

    @torch.no_grad()
    def __call__(
        self,
        latents: torch.FloatTensor,
        geo_decoder: CrossAttentionDecoder,
        bounds: Union[Tuple[float], List[float], float] = 1.01,
        num_chunks: int = 10000,
        mc_level: float = 0.0,
        octree_resolution: int = None,
        min_resolution: int = 63,
        mini_grid_num: int = 4,
        enable_pbar: bool = True,
        **kwargs,
    ):
        requested_resolution = octree_resolution
        self.last_recovery = None
        processor = self.processor
        geo_decoder.set_cross_attention_processor(processor)

        device = latents.device
        dtype = latents.dtype

        resolutions = []
        if octree_resolution < min_resolution:
            resolutions.append(octree_resolution)
        while octree_resolution >= min_resolution:
            resolutions.append(octree_resolution)
            octree_resolution = octree_resolution // 2
        resolutions.reverse()
        resolutions[0] = round(resolutions[0] / mini_grid_num) * mini_grid_num - 1
        for i, resolution in enumerate(resolutions[1:]):
            resolutions[i + 1] = resolutions[0] * 2 ** (i + 1)

        logger.info(f"FlashVDMVolumeDecoding Resolution: {resolutions}")

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

        # 2. latents to 3d volume
        xyz_samples = torch.from_numpy(xyz_samples).to(device, dtype=dtype)
        batch_size = latents.shape[0]
        mini_grid_size = xyz_samples.shape[0] // mini_grid_num
        xyz_samples = xyz_samples.view(
            mini_grid_num, mini_grid_size,
            mini_grid_num, mini_grid_size,
            mini_grid_num, mini_grid_size, 3
        ).permute(
            0, 2, 4, 1, 3, 5, 6
        ).reshape(
            -1, mini_grid_size * mini_grid_size * mini_grid_size, 3
        )
        batch_logits = []
        num_batchs = max(num_chunks // xyz_samples.shape[1], 1)
        for start in tqdm(range(0, xyz_samples.shape[0], num_batchs),
                          desc=f"FlashVDM Volume Decoding", disable=not enable_pbar):
            queries = xyz_samples[start: start + num_batchs, :]
            batch = queries.shape[0]
            batch_latents = repeat(latents.squeeze(0), "p c -> b p c", b=batch)
            processor.topk = True
            logits = geo_decoder(queries=queries, latents=batch_latents)
            batch_logits.append(logits)
        grid_logits = torch.cat(batch_logits, dim=0).reshape(
            mini_grid_num, mini_grid_num, mini_grid_num,
            mini_grid_size, mini_grid_size,
            mini_grid_size
        ).permute(0, 3, 1, 4, 2, 5).contiguous().view(
            (batch_size, grid_size[0], grid_size[1], grid_size[2])
        )

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

            query_grid_num = 6
            if next_points.shape[0] == 0:
                # A thin surface may lie between every coarse-grid sample.
                # Preserve the generated shape and requested resolution; inspect
                # the full grid instead of taking min/max of an empty tensor.
                self.last_recovery = {'reason': 'empty_refinement', 'resolution': requested_resolution}
                logger.warning('Empty coarse surface selection; evaluating full grid at resolution %s', requested_resolution)
                del next_index, next_logits, grid_logits, curr_points, next_points
                return complete_surface_grid(latents, geo_decoder, bounds, requested_resolution,
                                             num_chunks, mc_level, processor)
            min_val = next_points.min(axis=0).values
            max_val = next_points.max(axis=0).values
            vol_queries_index = (next_points - min_val) / (max_val - min_val) * (query_grid_num - 0.001)
            index = torch.floor(vol_queries_index).long()
            index = index[..., 0] * (query_grid_num ** 2) + index[..., 1] * query_grid_num + index[..., 2]
            index = index.sort()
            next_points = next_points[index.indices].unsqueeze(0).contiguous()
            unique_values = torch.unique(index.values, return_counts=True)
            grid_logits = torch.zeros((next_points.shape[1]), dtype=latents.dtype, device=latents.device)
            input_grid = [[], []]
            logits_grid_list = []
            start_num = 0
            sum_num = 0
            for grid_index, count in zip(unique_values[0].cpu().tolist(), unique_values[1].cpu().tolist()):
                if sum_num + count < num_chunks or sum_num == 0:
                    sum_num += count
                    input_grid[0].append(grid_index)
                    input_grid[1].append(count)
                else:
                    processor.topk = input_grid
                    logits_grid = geo_decoder(queries=next_points[:, start_num:start_num + sum_num], latents=latents)
                    start_num = start_num + sum_num
                    logits_grid_list.append(logits_grid)
                    input_grid = [[grid_index], [count]]
                    sum_num = count
            if sum_num > 0:
                processor.topk = input_grid
                logits_grid = geo_decoder(queries=next_points[:, start_num:start_num + sum_num], latents=latents)
                logits_grid_list.append(logits_grid)
            logits_grid = torch.cat(logits_grid_list, dim=1)
            grid_logits[index.indices] = logits_grid.squeeze(0).squeeze(-1)
            next_logits[nidx] = grid_logits
            grid_logits = next_logits.unsqueeze(0)

        grid_logits[grid_logits == -10000.] = float('nan')

        return grid_logits
