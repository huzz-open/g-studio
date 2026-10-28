"""Small deterministic adapter probes. No downloaded model weights required."""
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/generation-python'))
import torch
from safetensors.torch import save_file
from runtime import load_module
from source_wheel import prepare_source


class Tiny(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.linear=torch.nn.Linear(3,2)
        self.register_buffer('frequencies',2.**torch.arange(8),persistent=False)
        self.register_buffer('flag',torch.tensor([True,False]))


class AdapterTests(unittest.TestCase):
    def test_streamed_assignment_preserves_nonpersistent_buffers_and_integer_types(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,GEN_DEVICE='cpu',GEN_PRECISION='fp32'):
            source=Tiny();file=Path(folder)/'model.safetensors'
            save_file({'model.'+k:v for k,v in source.state_dict().items()},file)
            loaded=load_module({'target':'test.Tiny'},file,'model.',lambda _:Tiny())
            self.assertTrue(torch.equal(loaded.frequencies,source.frequencies))
            self.assertEqual(loaded.flag.dtype,torch.bool)
            self.assertTrue(torch.equal(loaded.linear.weight,source.linear.weight))
            self.assertFalse(any(p.is_meta for p in loaded.parameters()))
            with patch.dict(os.environ, GEN_DEVICE='cpu', GEN_PRECISION='fp32'):
                half = load_module({'target':'test.Tiny'},file,'model.',lambda _:Tiny(), torch.float16)
                self.assertEqual(half.linear.weight.dtype, torch.float16)
                full = load_module({'target':'test.Tiny'},file,'model.',lambda _:Tiny(), torch.float32)
                self.assertTrue(torch.equal(full.linear.weight, source.linear.weight))
            broken=source.state_dict();del broken['linear.bias'];save_file({'model.'+k:v for k,v in broken.items()},file)
            with self.assertRaisesRegex(RuntimeError,'Checkpoint mismatch'):
                load_module({'target':'test.Tiny'},file,'model.',lambda _:Tiny())

    def test_embedded_checkpoint_requires_conditioner_and_exact_shapes(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,GEN_DEVICE='cpu',GEN_PRECISION='fp32'):
            file=Path(folder)/'model.ckpt';source=Tiny()
            torch.save({'conditioner':source.state_dict()},file)
            loaded=load_module({'target':'test.Tiny'},file,'conditioner.',lambda _:Tiny())
            self.assertTrue(torch.equal(source.linear.weight,loaded.linear.weight))
            torch.save({'model':source.state_dict()},file)
            with self.assertRaises(KeyError): load_module({'target':'test.Tiny'},file,'conditioner.',lambda _:Tiny())
            bad=source.state_dict();bad['linear.bias']=torch.ones(7);torch.save({'conditioner':bad},file)
            with self.assertRaisesRegex(RuntimeError,'Wrong shape'):load_module({'target':'test.Tiny'},file,'conditioner.',lambda _:Tiny())

    def test_fixed_preprocessing_matches_cpu_fp32_antialiased_reference(self):
        from runtime import fixed_image_forward
        from torchvision import transforms
        transform=transforms.Compose([transforms.Resize(518,antialias=True),transforms.CenterCrop(518),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
        class Model:
            device='cpu';dtype=torch.float16
            def __call__(self,value):return types.SimpleNamespace(last_hidden_state=value)
        encoder=types.SimpleNamespace(transform=transform,model=Model(),use_cls_token=True)
        image=torch.linspace(-1,1,3*512*512).reshape(1,3,512,512)
        actual=fixed_image_forward(encoder,image)
        expected=transform((image+1)/2).half()
        self.assertTrue(torch.equal(actual,expected))
        self.assertEqual(actual.shape,(1,3,518,518))

    def test_full_21_refinement_preserves_floating_coordinates_and_sphere(self):
        with tempfile.TemporaryDirectory() as folder:
            source=prepare_source(Path(folder),series='2.1');sys.path.insert(0,str(source))
            package=types.ModuleType('hy3dshape');package.__path__=[str(source/'hy3dshape')];sys.modules['hy3dshape']=package
            from shape21_decoder import FullShapeVolumeDecoder
            queries_seen=[]
            def sphere(queries,latents):
                queries_seen.append(float(queries.max()-queries.min()))
                return queries.square().sum(-1,keepdim=True).sqrt()-.6
            torch.set_num_threads(4)
            grid=FullShapeVolumeDecoder()(torch.zeros(1,4,8),sphere,num_chunks=65536,octree_resolution=128,enable_pbar=False)
            self.assertLess(float(grid[0,64,64,64]),0)
            self.assertGreater(float(grid[0,0,64,64]),0)
            self.assertGreater(queries_seen[-1],.1)
            self.assertTrue((grid<0).any() and (grid>0).any())


if __name__=='__main__':unittest.main(verbosity=2)
