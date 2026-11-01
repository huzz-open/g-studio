import json,pathlib,numpy as np,hashlib,sys,re
from scipy.spatial import cKDTree
root=pathlib.Path(sys.argv[1]);results=[]
for p in (root/'assets/gstudio').glob('*/export.json'):
 d=json.loads(p.read_text());s=json.loads(pathlib.Path(d['snapshot']).read_text());binary=pathlib.Path(s['vertexFile']).read_bytes();assert hashlib.sha256(binary).hexdigest()==d['geometrySha256']
 e=np.frombuffer(binary,dtype='<f4').reshape(-1,9)[:,:3].reshape(-1,3,3)
 a=np.fromfile(root.parent/'output/gs-snapshot-import'/f'{p.parent.name}.bin',dtype='<f4').reshape(-1,3);m=np.array(d['godotToGS']).reshape(4,4);a=(np.c_[a,np.ones(len(a))]@m.T)[:,:3].reshape(-1,3,3)
 assert a.shape==e.shape
 distance,idx=cKDTree(e.mean(axis=1)).query(a.mean(axis=1));error=np.linalg.norm(a[:,:,None,:]-e[idx][:,None,:,:],axis=-1).min(axis=2).max()
 assert error<2e-6,(p.parent.name,error)
 text=(p.parent/'surface_fields.tres').read_text()
 field=np.fromstring(re.search(r'positions = PackedFloat32Array\((.*?)\)\n',text,re.S).group(1),sep=',').reshape(-1,4)
 valid=field[field[:,3]>.5,:3];assert len(valid)>0
 samples=valid[np.linspace(0,len(valid)-1,min(24,len(valid)),dtype=int)]
 samples=(np.c_[samples,np.ones(len(samples))]@m.T)[:,:3]
 A=e[:,0].astype(float);U=e[:,1]-A;V=e[:,2]-A;N=np.cross(U,V);length=np.linalg.norm(N,axis=1);uu=(U*U).sum(1);uv=(U*V).sum(1);vv=(V*V).sum(1);denom=uu*vv-uv*uv;good=denom>1e-20
 field_error=0.0
 for point in samples:
  D=point-A;du=(D*U).sum(1);dv=(D*V).sum(1)
  b=np.divide(vv*du-uv*dv,denom,out=np.full_like(denom,-10),where=good);c=np.divide(uu*dv-uv*du,denom,out=np.full_like(denom,-10),where=good)
  inside=good&(b>=-.001)&(c>=-.001)&(b+c<=1.001)
  distances=np.abs((D*N).sum(1))/np.maximum(length,1e-20)
  residual=distances[inside].min();assert residual<2e-6,(p.parent.name,'surface field',residual);field_error=max(field_error,float(residual))
 row={'surfaceSamples':len(samples),'maxSurfacePositionError':field_error,'id':p.parent.name,'triangles':len(e),'maxPositionError':float(error),'geometrySha256':d['geometrySha256']};results.append(row);print(row)
assert results, 'No snapshot exports found'
(root.parent/'output/gs-snapshot-import/audit.json').write_text(json.dumps(results,indent=2))
