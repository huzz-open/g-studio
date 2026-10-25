"""Package the standalone offline experiment with local sprite assets."""
import argparse
import base64
import json
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--assets',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).parent
assets={str(i):'data:image/png;base64,'+base64.b64encode((args.assets/f'sprite-{i:02d}.png').read_bytes()).decode() for i in [10,15,17]}
page=(root/'index.html').read_text(encoding='utf-8').replace('/*ASSETS*/','const ASSETS='+json.dumps(assets)+';').replace('/*MATH*/',(root/'math.cjs').read_text(encoding='utf-8'))
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(page,encoding='utf-8')
print(args.output)
