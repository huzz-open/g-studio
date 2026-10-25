import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('moge_eval',Path(__file__).resolve().parents[1]/'scripts/evaluate-moge.py')
moge=importlib.util.module_from_spec(spec);spec.loader.exec_module(moge)


class MogeEvaluationTests(unittest.TestCase):
    def test_recovers_camera_shift_and_reprojects_pixel_centers(self):
        h,w=79,121
        uv=moge.uv_grid(h,w)
        z=3+uv[...,0]**2+uv[...,1]*.3
        focal,shift=1.4,.7
        points=np.concatenate([uv/focal*z[...,None],(z-shift)[...,None]],-1).astype(np.float32)
        raw=dict(points=points[None],mask=np.ones((1,h,w)),metric_scale=np.array([2.5]))
        xyz,mask,result=moge.postprocess(raw)
        self.assertAlmostEqual(result['focal_relative_diagonal'],focal,places=4)
        self.assertAlmostEqual(result['shift'],shift,places=4)
        np.testing.assert_allclose(xyz[...,2],z*2.5,rtol=1e-5)
        np.testing.assert_allclose(xyz[...,:2]/xyz[...,2:]*result['focal_relative_diagonal'],uv,atol=1e-7)
        self.assertTrue(mask.all())

    def test_insufficient_mask_fails_explicitly(self):
        with self.assertRaises(ValueError):
            moge.recover(np.zeros((32,32,3)),np.zeros((32,32),bool))

    def test_comparison_does_not_hide_shape_change_with_offset_fit(self):
        uv=moge.uv_grid(32,32)
        a=np.concatenate([uv,(2+uv[...,0])[...,None]],-1)
        b=a.copy();b[...,2]+=5
        result=moge.compare(a,b,np.ones((32,32),bool))
        self.assertGreater(result['depth_rmse_after_scale_over_range'],.1)


if __name__=='__main__':unittest.main()
