"""Tests for the offline evaluation measurements; no model download or inference."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("evaluation", Path(__file__).resolve().parents[1] / "scripts/evaluate-depth.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class EvaluationTests(unittest.TestCase):
    def test_affine_depth_scale_does_not_count_as_shape_instability(self):
        reference = np.linspace(0, 10, 400, dtype=np.float32).reshape(20, 20)
        stats, _ = evaluation.metrics(reference, reference * 3 + 7, np.ones(reference.shape, dtype=bool))
        self.assertGreater(stats["spearman"], 0.99999)
        self.assertLess(stats["positive_affine_nrmse"], 1e-6)
        self.assertEqual(stats["rank_flip_fraction"], 0)

    def test_reversed_depth_cannot_be_hidden_by_negative_scale_alignment(self):
        reference = np.arange(400, dtype=np.float32).reshape(20, 20)
        stats, _ = evaluation.metrics(reference, -reference, np.ones(reference.shape, dtype=bool))
        self.assertLess(stats["spearman"], -0.999)
        self.assertEqual(stats["alignment_scale"], 0)
        self.assertEqual(stats["rank_flip_fraction"], 1)
        self.assertGreater(stats["positive_affine_nrmse"], 0.2)

    def test_flat_predictions_are_explicitly_flagged(self):
        reference = np.arange(400, dtype=np.float32).reshape(20, 20)
        stats, _ = evaluation.metrics(reference, np.zeros_like(reference), np.ones(reference.shape, dtype=bool))
        self.assertTrue(stats["candidate_flat"])
        self.assertEqual(stats["spearman"], 0)

    def test_background_and_layout_variants_preserve_solid_foreground_colors(self):
        pixels = np.zeros((20, 30, 4), dtype=np.uint8)
        pixels[3:15, 4:24] = [80, 140, 220, 255]
        image = Image.fromarray(pixels)
        mask = pixels[:, :, 3] == 255
        for variant in evaluation.VARIANTS:
            composed, (x, y, w, h), factor = evaluation.compose(image, variant)
            array = np.asarray(composed)
            if variant == "mirror":
                array = array[:, ::-1]
            crop = array[y * factor:(y + h) * factor:factor, x * factor:(x + w) * factor:factor]
            np.testing.assert_array_equal(crop[mask], pixels[:, :, :3][mask])


if __name__ == "__main__":
    unittest.main()
