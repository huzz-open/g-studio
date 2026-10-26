"""Optional stress test of smoothing; preserves the original baseline meshes."""
import json
import time
import trimesh
from experiment import ROOT,VARIANTS,save_result,summarize


def main():
    from pathlib import Path
    out=Path(json.loads((ROOT/'latest.json').read_text(encoding='utf-8'))['output'])
    manifest=json.loads((out/'results.json').read_text(encoding='utf-8'))
    for item,variants in manifest['records'].items():
        base=trimesh.load(out/item/'baseline96'/'raw.glb',force='mesh',process=False)
        mesh=base.copy();start=time.perf_counter()
        trimesh.smoothing.filter_taubin(mesh,lamb=.5,nu=.51,iterations=320)
        elapsed=time.perf_counter()-start
        config={**variants['baseline96']['settings'],'smoothing':{'algorithm':'Taubin','lamb':.5,'nu':.51,'iterations':320}}
        variants['taubin320']=save_result(mesh,base,out,item,'taubin320',config,{'postprocess':elapsed},2/max(base.extents))
    manifest['stress_test_note']='320 smoothing steps added after reviewing persistent large bumps at 80 steps; no new network inference.'
    (out/'results.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    VARIANTS['taubin320']='强平滑 320 步'
    summarize(out,manifest['records'])


if __name__=='__main__':
    main()
