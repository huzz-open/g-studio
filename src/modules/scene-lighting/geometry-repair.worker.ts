import { repairGeometry } from './geometry-repair'
import { buildPartGeometry } from './part-geometry'
self.onmessage=event=>{
  try{
    const {part,pixels,spec}=event.data
    const mesh=part?buildPartGeometry({...part,geometry:{...part.geometry,repair:undefined}},pixels):event.data.mesh
    const result=repairGeometry(mesh,spec);self.postMessage({result},{transfer:[result.mesh.vertices.buffer]})
  }
  catch(error){self.postMessage({error:String(error)})}
}
