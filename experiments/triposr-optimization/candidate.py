"""A manually selected postprocess candidate for the three inspected test assets."""
import json
from pathlib import Path
import time
import numpy as np
import trimesh
from experiment import ROOT,VARIANTS,save_result,summarize


def main():
    out=Path(json.loads((ROOT/'latest.json').read_text(encoding='utf-8'))['output'])
    manifest=json.loads((out/'results.json').read_text(encoding='utf-8'))
    for item,variants in manifest['records'].items():
        base=trimesh.load(out/item/'baseline96'/'raw.glb',force='mesh',process=False)
        components=trimesh.graph.connected_components(base.face_adjacency,nodes=np.arange(len(base.faces)))
        total=float(base.area)
        # This rule was selected after inspecting these inputs, not claimed general.
        keep=[c for c in components if base.area_faces[c].sum()>=.005*total]
        selected=np.concatenate(keep)
        removed_area=float(total-base.area_faces[selected].sum())
        mesh=base.submesh([selected],append=True,repair=False)
        steps=80 if item=='vase' else 20
        start=time.perf_counter()
        trimesh.smoothing.filter_taubin(mesh,lamb=.5,nu=.51,iterations=steps)
        elapsed=time.perf_counter()-start
        if not np.isfinite(mesh.vertices).all() or np.any(mesh.area_faces<1e-12):
            raise RuntimeError(f'{item}: candidate still contains degenerate faces')
        config={**variants['baseline96']['settings'],
                'cleanup':{'min_component_area_fraction':.005,'removed_components':len(components)-len(keep),
                           'removed_faces':len(base.faces)-len(selected),'removed_area_fraction':removed_area/total},
                'smoothing':{'algorithm':'Taubin','lamb':.5,'nu':.51,'iterations':steps},
                'selection':'Manual choice from this experiment: vase 80 steps, thin objects 20; not a universal preset.'}
        variants['candidate']=save_result(mesh,base,out,item,'candidate',config,{'postprocess':elapsed},2/max(base.extents))
    (out/'results.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    VARIANTS.update({'taubin320':'强平滑 320 步','candidate':'保守后处理候选'})
    summarize(out,manifest['records'])
    # Compact baseline/candidate front and side view to expose unchanged shape errors.
    from PIL import Image,ImageDraw,ImageFont
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
    sheet=Image.new('RGB',(4*320,3*350),(31,36,46));draw=ImageDraw.Draw(sheet)
    from experiment import LABELS
    for row,item in enumerate(manifest['records']):
        for col,(variant,view,label) in enumerate([('baseline96',0,'原始正面'),('candidate',0,'后处理正面'),('baseline96',90,'原始侧面'),('candidate',90,'后处理侧面')]):
            im=Image.open(out/item/variant/f'clay-{view}.png').resize((320,320),Image.Resampling.LANCZOS)
            sheet.paste(im,(col*320,row*350+30));draw.text((col*320+6,row*350+5),LABELS[item]+' · '+label,font=font,fill='white')
    sheet.save(out/'candidate-comparison.png')


if __name__=='__main__':
    main()
