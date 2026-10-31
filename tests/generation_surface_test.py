"""Thin surfaces must survive empty coarse selection; normal decoding stays exact."""
import sys
from pathlib import Path
import unittest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/generation-python'))
from runtime import initialize
initialize()
from shape20_decoder import SurfaceSafeFlashVDMVolumeDecoding, complete_surface_grid
from hy3dgen.shapegen.models.autoencoders.volume_decoders import FlashVDMVolumeDecoding, VanillaVolumeDecoder


class Field:
    def __init__(self, fn): self.fn, self.processor, self.max_queries = fn, None, 0
    def set_cross_attention_processor(self, processor): self.processor = processor
    def __call__(self, queries, latents):
        self.max_queries = max(self.max_queries, queries.shape[1])
        return self.fn(queries).unsqueeze(-1)


class SurfaceTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(4)
        self.latent = torch.zeros(1, 1, 4)

    def test_thin_slab_missed_by_coarse_grid_is_recovered_at_requested_resolution(self):
        field = Field(lambda q: torch.tanh((.004 - q[..., 2].abs()) * 400))
        options = dict(octree_resolution=128, num_chunks=4096, enable_pbar=False)
        with self.assertRaises(IndexError):
            FlashVDMVolumeDecoding('merge')(self.latent, field, **options)
        decoder = SurfaceSafeFlashVDMVolumeDecoding('merge')
        actual = decoder(self.latent, field, **options)
        expected = VanillaVolumeDecoder()(self.latent, field, **options)
        self.assertTrue(torch.equal(actual, expected))
        self.assertEqual(tuple(actual.shape), (1, 129, 129, 129))
        self.assertEqual(decoder.last_recovery['resolution'], 128)
        self.assertIs(field.processor, decoder.processor)

    def test_regular_shape_is_identical_to_upstream(self):
        field = Field(lambda q: .6 - q.square().sum(-1).sqrt())
        options = dict(octree_resolution=128, num_chunks=4096, enable_pbar=False)
        expected = FlashVDMVolumeDecoding('merge')(self.latent, field, **options)
        decoder = SurfaceSafeFlashVDMVolumeDecoding('merge')
        actual = decoder(self.latent, field, **options)
        torch.testing.assert_close(actual, expected, rtol=0, atol=0, equal_nan=True)
        self.assertIsNone(decoder.last_recovery)

    def test_empty_shape_reports_no_surface_and_restores_processor(self):
        field = Field(lambda q: torch.full_like(q[..., 0], -1))
        decoder = SurfaceSafeFlashVDMVolumeDecoding('merge')
        with self.assertRaisesRegex(ValueError, 'No surface found'):
            decoder(self.latent, field, octree_resolution=128, num_chunks=4096, enable_pbar=False)
        self.assertIs(field.processor, decoder.processor)

    def test_complete_sampling_bounds_queries_and_propagates_errors(self):
        field = Field(lambda q: q[..., 2]); previous = object()
        grid = complete_surface_grid(self.latent, field, 1.01, 16, 37, 0, previous)
        self.assertEqual(tuple(grid.shape), (1, 17, 17, 17))
        self.assertLessEqual(field.max_queries, 37)
        field.fn = lambda q: torch.full_like(q[..., 0], float('nan'))
        with self.assertRaisesRegex(ValueError, 'non-finite'):
            complete_surface_grid(self.latent, field, 1.01, 16, 37, 0, previous)
        self.assertIs(field.processor, previous)
        def fail(q): raise RuntimeError('CUDA out of memory')
        field.fn = fail
        with self.assertRaisesRegex(RuntimeError, 'CUDA out of memory'):
            complete_surface_grid(self.latent, field, 1.01, 16, 37, 0, previous)
        self.assertIs(field.processor, previous)


if __name__ == '__main__': unittest.main()
