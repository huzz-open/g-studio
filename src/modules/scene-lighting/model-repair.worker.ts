import { repairModel } from './model-repair'
import { buildPartModel } from './part-model'
self.onmessage=event=>{
  try{
    const {part,pixels,spec}=event.data
    const mesh=part?buildPartModel({...part,model:{...part.model,repair:undefined}},pixels):event.data.mesh
    const result=repairModel(mesh,spec);self.postMessage({result},{transfer:[result.mesh.vertices.buffer]})
  }
  catch(error){self.postMessage({error:String(error)})}
}
