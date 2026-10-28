"""Render the raw GLBs in a CUDA experiment report from four fixed viewpoints.

Uses CPU matplotlib with depth-sorted triangles, orthographic projections and
flat normal shading. Removes zero-area faces only; does not repair geometry.
These inspection images are not a semantic quality score or a texture render.
"""
import argparse,json,pathlib
import numpy as np
import trimesh
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

p=argparse.ArgumentParser();p.add_argument('folder',type=pathlib.Path)
p.add_argument('--indices', default='0,2,3,4')
p.add_argument('--reduce', action='store_true', help='Also inspect pinned upstream FaceReducer output at 12000 faces')
args=p.parse_args()
if args.reduce:
    import sys, time
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'runtime/generation/vendor/Hunyuan3D-2'))
    from hy3dgen.shapegen import FaceReducer
    reducer=FaceReducer()
report=json.loads((args.folder/'report.json').read_text())
runs=[(i,r) for i,r in enumerate(report['runs']) if r.get('status')=='succeeded' and i in {int(x) for x in args.indices.split(',')}]
for i,r in runs:
    folder=args.folder/f"{i}-{r['input']}"
    mesh=trimesh.load(folder/'raw.glb',force='mesh')
    original_faces=len(mesh.faces)
    mesh.update_faces(mesh.area_faces>1e-12);mesh.remove_unreferenced_vertices()
    if args.reduce:
        start=time.perf_counter()
        mesh=reducer(mesh,max_facenum=12000)
        metrics={'rawFaces':original_faces,'reducedFaces':len(mesh.faces),'reductionSeconds':time.perf_counter()-start,'reducer':'Pinned upstream FaceReducer / pymeshlab'}
        mesh.export(folder/'official-reduced.glb')
        (folder/'reduction.json').write_text(json.dumps(metrics,indent=2))
    verts=mesh.vertices.copy();verts-=(verts.min(0)+verts.max(0))/2
    verts/=np.ptp(verts,axis=0).max()/2
    fig,axes=plt.subplots(1,4,figsize=(12,3.4),facecolor='#f2f4f8')
    for ax,(az,el,label) in zip(axes,[(0,0,'Front'),(90,0,'Side'),(180,0,'Back'),(35,25,'Elevated')]):
        az,el=np.radians([az,el]);right=np.array([np.cos(az),0,-np.sin(az)])
        forward=np.array([np.sin(az)*np.cos(el),np.sin(el),np.cos(az)*np.cos(el)])
        up=np.cross(forward,right)
        v=np.stack([verts@right,verts@up,verts@forward],axis=1)
        faces=mesh.faces;depth=v[faces,2].mean(1);order=np.argsort(depth)
        light=np.array([-.4,.7,.6]);light/=np.linalg.norm(light)
        normals=mesh.face_normals@np.stack([right,up,forward],axis=1)
        shade=.28+.72*np.maximum(0,normals@light)
        color=np.array([.52,.66,.82])[None,:]*shade[:,None]
        ax.add_collection(PolyCollection(v[faces[order],:2],facecolors=color[order],edgecolors='none',antialiased=False))
        ax.set(xlim=(-1.15,1.15),ylim=(-1.15,1.15),aspect='equal',title=label);ax.axis('off')
    kind='official reduced' if args.reduce else 'raw'
    filename='reduced-views.png' if args.reduce else 'views.png'
    fig.suptitle(f"{args.folder.name} / {r['input']} / {kind} / {r['inferenceSeconds']:.2f}s")
    fig.tight_layout();fig.savefig(folder/filename,dpi=120);plt.close(fig)
    print(folder/filename,flush=True)
