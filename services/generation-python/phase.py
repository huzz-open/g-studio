"""Staged policy: independent phase processes release all module allocations."""
import argparse
import time
from PIL import Image
from runtime import Engine, PROFILE, write_stats
from memory import MemorySample


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['encode', 'sample', 'mesh'])
    from pathlib import Path
    parser.add_argument('folder', type=Path)
    parser.add_argument('--steps', type=int, default=PROFILE['steps'])
    parser.add_argument('--resolution', type=int, default=256)
    parser.add_argument('--chunks', type=int, default=2048)
    parser.add_argument('--seed', type=int, default=12345)
    args = parser.parse_args()
    import torch, os
    start = time.monotonic()
    with MemorySample(torch, os.environ.get('GEN_DEVICE', 'cpu')) as memory:
        engine = Engine(args.phase)
        engine.cancel_file = args.folder / 'cancel'
        with torch.inference_mode():
            if args.phase == 'encode':
                cache = engine.encode(Image.open(args.folder / 'original.png').convert('RGBA'), args.folder)
                torch.save(cache, args.folder / 'condition.pt')
            elif args.phase == 'sample':
                cache = torch.load(args.folder / 'condition.pt', map_location=engine.device, weights_only=True)
                latent = engine.sample(cache, args.steps, args.seed)
                torch.save(latent, args.folder / 'latents.pt')
            else:
                latent = torch.load(args.folder / 'latents.pt', map_location=engine.device, weights_only=True)
                engine.mesh(latent, args.resolution, args.chunks).export(args.folder / 'raw.glb')
            engine.synchronize()
    write_stats(args.folder, args.phase, start, {'memory': memory.values})


if __name__ == '__main__': main()
