"""Compare same-latent hierarchical/dense decoder artifacts in raw coordinates.

Measures vertex-set distances and face connectivity after removing zero-area
faces. This is not a semantic score or an exact surface/Hausdorff distance.
"""
import argparse,json,pathlib
import numpy as np
import trimesh
from scipy.spatial import cKDTree

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('folder',type=pathlib.Path,help='A completed --compare-decoders experiment directory')
p.add_argument('--output',type=pathlib.Path)
args=p.parse_args()
result={}
for folder in sorted(args.folder.iterdir()):
    if not folder.is_dir():continue
    meshes=[];item={}
    for name in ['project-hierarchical','official-dense']:
        mesh=trimesh.load(folder/(name+'.glb'),force='mesh',process=True)
        original=len(mesh.faces)
        mesh.update_faces(mesh.area_faces>1e-12);mesh.remove_unreferenced_vertices()
        item[name]={'rawFaces':original,'nondegenerateFaces':len(mesh.faces),'vertices':len(mesh.vertices),
                    'bounds':mesh.bounds.tolist(),'watertight':bool(mesh.is_watertight),'volume':float(mesh.volume)}
        meshes.append(mesh)
    # Same latent and coordinate system: no independent rescaling/alignment.
    distances=np.concatenate([cKDTree(meshes[1].vertices).query(meshes[0].vertices)[0],
                              cKDTree(meshes[0].vertices).query(meshes[1].vertices)[0]])
    item['bidirectionalVertexNearestDistance']={'mean':float(distances.mean()),'p95':float(np.percentile(distances,95)),
        'max':float(distances.max()),'fractionWithinOneGridSpacing':float(np.mean(distances<=2.02/256)),
        'gridSpacing':2.02/256,'note':'Vertex-set distance, not exact surface/Hausdorff distance or semantic quality score. Raw common coordinates.'}
    mapped=cKDTree(meshes[1].vertices).query(meshes[0].vertices)[1]
    def canonical(faces):
        faces=np.sort(faces,axis=1)
        return faces[np.lexsort((faces[:,2],faces[:,1],faces[:,0]))]
    item['vertexMappingBijective']=bool(len(np.unique(mapped))==len(meshes[1].vertices)==len(meshes[0].vertices))
    item['sameUndirectedFacesAfterVertexMapping']=bool(np.array_equal(canonical(mapped[meshes[0].faces]),canonical(meshes[1].faces)))
    result[folder.name]=item
(args.output or args.folder/'decoder-comparison.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
