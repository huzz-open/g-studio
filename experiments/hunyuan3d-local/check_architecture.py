"""Check parameter schemas without allocating or pretending to run real inference."""
import json
import types
import yaml
from runtime import ROOT,MODEL,VAE,initialize

torch,Pipeline,instantiate,config=initialize()
main_header=json.loads((ROOT/'hunyuan3d-dit-v2-mini-turbo-header.json').read_text(encoding='utf-8'))
vae_header=json.loads((ROOT/'hunyuan3d-vae-v2-mini-turbo-header.json').read_text(encoding='utf-8'))
for name,cfg,header,prefix in [
    ('conditioner',config['conditioner'],main_header,'conditioner.'),
    ('model',config['model'],main_header,'model.'),
    ('vae',yaml.safe_load((VAE/'config.yaml').read_text()),vae_header,''),
]:
    with torch.device('meta'):module=instantiate(cfg)
    if name=='vae':module.encoder=None;module.pre_kl=None
    expected={k[len(prefix):]:v['shape'] for k,v in header.items() if k!='__metadata__' and k.startswith(prefix)}
    actual={k:list(v.shape) for k,v in module.state_dict().items()}
    assert actual==expected,{'module':name,'missing':list(set(actual)-set(expected))[:8],
                             'extra':list(set(expected)-set(actual))[:8],
                             'wrong_shape':[k for k in actual.keys()&expected.keys() if actual[k]!=expected[k]][:8]}
    print(name,'parameter schema matches official checkpoint',flush=True)
    del module

# The original pipeline is used for the diffusion loop. This smoke check only
# verifies that supplying cached image features and a latent-shape proxy works.
class ZeroModel(torch.nn.Module):
    guidance_embed=True
    def forward(self,x,t,cond,guidance=None):return torch.zeros_like(x)
pipeline=Pipeline.__new__(Pipeline)
pipeline.device=torch.device('cpu');pipeline.dtype=torch.float32
pipeline.model=ZeroModel();pipeline.vae=types.SimpleNamespace(latent_shape=(8,4))
pipeline.scheduler=instantiate(config['scheduler'])
pipeline.prepare_image=lambda _: {'image':torch.zeros(1,3,8,8)}
pipeline.encode_cond=lambda **_: {'main':torch.zeros(1,2,16)}
out=pipeline(image=None,num_inference_steps=5,guidance_scale=5.,generator=torch.Generator().manual_seed(12345),output_type='latent',enable_pbar=False)
assert out.shape==(1,8,4) and torch.isfinite(out).all()
print('Staged diffusion API smoke check passed (synthetic tensors; not a generated model).',flush=True)
