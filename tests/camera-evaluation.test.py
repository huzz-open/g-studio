import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('camera_eval', Path(__file__).resolve().parents[1] / 'scripts/evaluate-camera.py')
camera_eval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(camera_eval)


class CameraEvaluationTests(unittest.TestCase):
    def test_canonical_input_removes_framing_and_hidden_background_changes(self):
        pixels=np.zeros((30,40,4),dtype=np.uint8);pixels[5:24,7:32]=[50,120,200,255]
        self.assertTrue(all(camera_eval.canonical_invariance(Image.fromarray(pixels)).values()))

    def test_fitter_recovers_known_pinhole_parameters_from_exact_fields(self):
        width, height, focal = 96, 64, 85.0
        yy, xx = np.indices((height, width))
        xy = np.column_stack([xx.ravel(), yy.ravel()])
        for roll, pitch in [(0, 0), (0.12, -0.45), (-0.2, 0.25)]:
            up, latitude = camera_eval.render_fields(xy, np.array([width/2, height/2]), focal, camera_eval.up_vector(roll, pitch))
            fields = [up.reshape(height,width,2).transpose(2,0,1)[None], np.ones((1,height,width)),
                      np.arcsin(latitude).reshape(1,1,height,width), np.ones((1,height,width))]
            result = camera_eval.fit_camera(fields)
            self.assertAlmostEqual(result['roll_deg'], np.degrees(roll), places=3)
            self.assertAlmostEqual(result['pitch_deg'], np.degrees(pitch), places=3)
            self.assertAlmostEqual(result['focal_px'], focal, places=2)

    def test_depth_gauge_candidates_do_not_silently_become_a_ground_plane(self):
        depth = np.arange(100, dtype=np.float32).reshape(10,10) + 1
        result = camera_eval.contact_sensitivity(depth, np.full((10,10),255,dtype=np.uint8), (0,0,10,10),
                    dict(scale_x=1,scale_y=1,crop_x=0,crop_y=0), dict(center_px=[5,5],focal_px=10,up_vector=[0,-1,0]))
        self.assertFalse(result['ground_plane_accepted'])
        self.assertEqual(len(result['candidates']),3)


if __name__ == '__main__':
    unittest.main()
