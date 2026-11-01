// Bake reference-camera surface attributes from the frozen GS triangle buffer.
const {registrationBasis}=require('../../src/modules/scene-lighting/registered-model.ts')
exports.bakeFields=(mesh,frame,pixels,pitch,toWorld)=>{
 const {width:w,height:h,data}=pixels,basis=registrationBasis(pitch),unit=h/frame.height,dot=(p,a)=>p.reduce((s,v,i)=>s+v*a[i],0),edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]),zbuffer=new Float64Array(w*h).fill(Infinity),positions=new Float32Array(w*h*4),normals=new Float32Array(w*h*4),angle=25*Math.PI/180;
 for(let i=0;i<mesh.vertices.length;i+=27){
  const p=[0,9,18].map(j=>Array.from(mesh.vertices.subarray(i+j,i+j+3))),q=p.map(v=>[(dot(v,basis.right)-frame.left)*unit,(frame.bottom+frame.height-dot(v,basis.up))*unit]),z=p.map(v=>dot(v,basis.forward)),area=edge(q[0],q[1],...q[2]);if(Math.abs(area)<1e-10)continue
  for(let y=Math.max(0,Math.floor(Math.min(...q.map(v=>v[1]))));y<Math.min(h,Math.ceil(Math.max(...q.map(v=>v[1]))));y++)for(let x=Math.max(0,Math.floor(Math.min(...q.map(v=>v[0]))));x<Math.min(w,Math.ceil(Math.max(...q.map(v=>v[0]))));x++){
   const j=y*w+x;if(data[j*4+3]<21)continue;const a=edge(q[1],q[2],x+.5,y+.5)/area,b=edge(q[2],q[0],x+.5,y+.5)/area,c=1-a-b;if(a<0||b<0||c<0)continue
   const depth=a*z[0]+b*z[1]+c*z[2];if(depth>=zbuffer[j])continue;zbuffer[j]=depth
   const world=toWorld([0,1,2].map(k=>a*p[0][k]+b*p[1][k]+c*p[2][k])),n=[0,1,2].map(k=>a*mesh.vertices[i+3+k]+b*mesh.vertices[i+12+k]+c*mesh.vertices[i+21+k]),rot=[Math.cos(angle)*n[0]-Math.sin(angle)*n[2],n[1],Math.sin(angle)*n[0]+Math.cos(angle)*n[2]],length=Math.hypot(...rot)||1;
   positions.set([...world,1],j*4);normals.set([...rot.map(v=>v/length),1],j*4)
  }
 }
 let opaque=0,covered=0;for(let i=0;i<w*h;i++)if(data[i*4+3]>=21){opaque++;if(positions[i*4+3])covered++}
 const floats=a=>Array.from(a,v=>v.toPrecision(9)).join(', ')
 return {coverage:covered/Math.max(1,opaque),text:`[gd_resource type="Resource" format=3]\n[ext_resource type="Script" path="res://addons/gstudio_2d/surface_fields.gd" id="script"]\n[resource]\nscript = ExtResource("script")\nwidth = ${w}\nheight = ${h}\npositions = PackedFloat32Array(${floats(positions)})\nnormals = PackedFloat32Array(${floats(normals)})\n`}
}
