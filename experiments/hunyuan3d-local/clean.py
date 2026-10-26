"""Separate numerical cleanup copy; no smoothing, hole filling or simplification."""
import json
from pathlib import Path
import sys
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'triposr-local'))
from render import render


def main():
    for manifest in sorted((ROOT/'results').glob('*/result.json')):
        folder=manifest.parent
        if (folder/'cleanup.json').exists() and (folder/'mesh-clean.glb').exists():
            continue
        original=trimesh.load(folder/'mesh.glb',force='mesh',process=False)
        mesh=original.copy()
        counts={}
        keep=mesh.area_faces>1e-12
        counts['near_zero_area_faces_removed']=int((~keep).sum())
        mesh.update_faces(keep)
        _,unique=np.unique(np.sort(mesh.faces,axis=1),axis=0,return_index=True)
        counts['duplicate_faces_removed']=len(mesh.faces)-len(unique)
        mesh.update_faces(np.sort(unique))
        mesh.remove_unreferenced_vertices()
        assert np.isfinite(mesh.vertices).all() and (mesh.area_faces>1e-12).all()
        comparisons={}
        for az in (0,90,180,270):
            _,a=render(original,azimuth=az,size=192,clay=True,ground=False,shadows=False)
            _,b=render(mesh,azimuth=az,size=192,clay=True,ground=False,shadows=False)
            comparisons[str(az)]=int(np.count_nonzero(a['mask']!=b['mask']))
        mesh.export(folder/'mesh-clean.glb')
        report={'method':'Remove area<=1e-12 triangles and identical indexed faces; remove unreferenced vertices. No smoothing or new faces.',
                'original_faces':len(original.faces),'clean_faces':len(mesh.faces),
                'clean_vertices':len(mesh.vertices),'watertight':bool(mesh.is_watertight),
                'winding_consistent':bool(mesh.is_winding_consistent),
                'near_degenerate_faces':int((mesh.area_faces<=1e-12).sum()),
                'changed_silhouette_pixels_at_192px':comparisons,**counts}
        (folder/'cleanup.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(folder.name,json.dumps(report),flush=True)


if __name__=='__main__':main()
