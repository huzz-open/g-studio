"""Optional quadric decimation copy, evaluated against the original projection."""
import json
from pathlib import Path
import sys
import time
import numpy as np
import trimesh
import fast_simplification
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'triposr-local'))
from render import render


def repair_zero_normals(mesh):
    normals=np.asarray(mesh.vertex_normals).copy()
    lengths=np.linalg.norm(normals,axis=1)
    bad=(~np.isfinite(normals).all(axis=1))|(lengths<1e-8)
    for vertex in np.flatnonzero(bad):
        incident=mesh.vertex_faces[vertex]
        incident=incident[incident>=0]
        if not len(incident):raise ValueError('Unreferenced vertex remains')
        normals[vertex]=mesh.face_normals[incident[0]]
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    mesh.vertex_normals=normals
    assert np.isfinite(mesh.vertex_normals).all() and (np.linalg.norm(mesh.vertex_normals,axis=1)>.99).all()
    return int(bad.sum())


def main():
    for path in sorted((ROOT/'results').glob('*/mesh-clean.glb')):
        folder=path.parent
        if (folder/'simplification.json').exists():continue
        source=trimesh.load(path,force='mesh',process=False)
        start=time.perf_counter()
        vertices,faces=fast_simplification.simplify(np.asarray(source.vertices),np.asarray(source.faces),target_count=min(40000,len(source.faces)),agg=7.,preserve_border=True)
        mesh=trimesh.Trimesh(vertices=vertices,faces=faces,process=False)
        mesh.update_faces(mesh.area_faces>1e-12);mesh.remove_unreferenced_vertices()
        mesh.visual=trimesh.visual.ColorVisuals(mesh=mesh,vertex_colors=np.tile([168,196,216,255],(len(mesh.vertices),1)))
        elapsed=time.perf_counter()-start
        if not np.isfinite(mesh.vertices).all():raise ValueError('Invalid simplified mesh')
        scores={}
        for angle in (0,90,180,270):
            _,a=render(source,azimuth=angle,size=256,clay=True,ground=False,shadows=False)
            _,b=render(mesh,azimuth=angle,size=256,clay=True,ground=False,shadows=False)
            scores[str(angle)]=float(np.count_nonzero(a['mask']&b['mask'])/max(1,np.count_nonzero(a['mask']|b['mask'])))
        repaired=repair_zero_normals(mesh)
        mesh.export(folder/'mesh-preview.glb')
        report={'algorithm':'fast-simplification 0.2.0 quadric decimation; preserve_border=True; agg=7',
                'source_faces':len(source.faces),'target_faces':40000,'actual_faces':len(mesh.faces),
                'seconds':elapsed,'zero_or_invalid_vertex_normals_repaired':repaired,'silhouette_iou_vs_clean_mesh_at_256px':scores,
                'all_four_views_above_99_percent':bool(min(scores.values())>=.99),
                'note':'This is separate algorithmic postprocessing. The raw AI mesh is preserved; 2D checks do not prove all 3D details unchanged.'}
        (folder/'simplification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(folder.name,json.dumps(report),flush=True)


if __name__=='__main__':main()
