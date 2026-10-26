"""Regression checks for coordinate conventions and deterministic shadow outputs."""
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
import trimesh

from render import basis, render, export_maps
from run import prepare_image


class PipelineTests(unittest.TestCase):
    def test_camera_basis_is_orthonormal(self):
        for azimuth in (0,90,180,270):
            matrix = basis(azimuth,20)
            np.testing.assert_allclose(matrix@matrix.T,np.eye(3),atol=1e-12)
            self.assertGreater(np.linalg.det(matrix),.999)

    def test_marching_cubes_keeps_xyz_axes(self):
        import torch
        from compat import install
        install(Path(__file__).resolve().parent)
        from tsr.models.isosurface import MarchingCubeHelper
        resolution = 32
        x,y,z = np.meshgrid(*[np.linspace(0,1,resolution)]*3,indexing='ij')
        density = 1 - ((x-.3)/.12)**2 - ((y-.5)/.20)**2 - ((z-.65)/.25)**2
        vertices, faces = MarchingCubeHelper(resolution)(-torch.tensor(density,dtype=torch.float32))
        bounds = np.array([vertices.numpy().min(0),vertices.numpy().max(0)])
        np.testing.assert_allclose(bounds.mean(0),[.3,.5,.65],atol=.01)
        np.testing.assert_allclose(bounds[1]-bounds[0],[.24,.4,.5],atol=.01)
        self.assertGreater(len(faces),100)

    def test_light_height_changes_ground_shadow(self):
        mesh = trimesh.creation.box(extents=[.8,.8,1.6])
        mesh.apply_translation([0,0,.8])
        _,low = render(mesh,azimuth=50,light_azimuth=-80,light_elevation=20,size=128,extent=6)
        _,high = render(mesh,azimuth=50,light_azimuth=-80,light_elevation=65,size=128,extent=6)
        _,off = render(mesh,azimuth=50,shadows=False,size=128)
        self.assertFalse(off['shadow'].any())
        def distance(data):
            points = data['position'][data['shadow'] & (data['position'][...,2] < -.01)]
            self.assertGreater(len(points),5)
            return np.linalg.norm(points[:,:2],axis=1).max()
        self.assertGreater(distance(low),distance(high)+.3)

    def test_depth_export_roundtrip_and_alpha(self):
        mesh = trimesh.creation.icosphere(subdivisions=1,radius=.75)
        mesh.apply_translation([0,0,.75])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            meta = export_maps(mesh,path,35,20)
            raw = np.load(path/'surface.npz')
            encoded = np.asarray(Image.open(path/'depth16.png'))
            mask = raw['mask']
            d = meta['depth16']
            decoded = d['min']+(encoded[mask].astype(float)-1)/65534*(d['max']-d['min'])
            np.testing.assert_allclose(decoded,raw['depth'][mask],atol=3e-5)
            self.assertTrue(np.all(encoded[~mask] == 0))
            self.assertTrue(np.isnan(raw['depth'][~mask]).all())
            self.assertTrue(np.array_equal(np.asarray(Image.open(path/'normal-world.png'))[:,:,3]>0,mask))
            raw.close()

    def test_transparent_input_preprocessing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            input_image = Image.new('RGBA',(10,20),(0,0,0,0))
            for x in range(3,7):
                for y in range(2,18):
                    input_image.putpixel((x,y),(255,30,0,255))
            input_image.save(path/'test.png')
            prepared = prepare_image(path/'test.png',path)
            self.assertEqual(prepared.getpixel((0,0)),(128,128,128))
            self.assertEqual(prepared.getpixel((256,256)),(255,30,0))
            Image.new('RGBA',(8,8),(0,0,0,0)).save(path/'empty.png')
            with self.assertRaisesRegex(ValueError,'completely transparent'):
                prepare_image(path/'empty.png',path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
