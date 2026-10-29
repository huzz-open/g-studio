function tetrahedron(height = 2) {
  const vertices = new Float32Array([-1,0,-1, 1,0,-1, 0,height,0, 1,0,-1, 0,0,1, 0,height,0, 0,0,1, -1,0,-1, 0,height,0, -1,0,-1, 0,0,1, 1,0,-1])
  const binary = Buffer.from(vertices.buffer)
  const doc = { asset:{ version:'2.0' }, buffers:[{byteLength:binary.length}], bufferViews:[{buffer:0,byteLength:binary.length}], accessors:[{bufferView:0,componentType:5126,count:12,type:'VEC3'}], meshes:[{primitives:[{attributes:{POSITION:0}}]}], nodes:[{mesh:0}], scenes:[{nodes:[0]}], scene:0 }
  const jsonText = JSON.stringify(doc), json = Buffer.from(jsonText + ' '.repeat((4-jsonText.length%4)%4))
  const data = Buffer.alloc(28+json.length+binary.length)
  data.writeUInt32LE(0x46546c67,0); data.writeUInt32LE(2,4); data.writeUInt32LE(data.length,8)
  data.writeUInt32LE(json.length,12); data.writeUInt32LE(0x4e4f534a,16); json.copy(data,20)
  data.writeUInt32LE(binary.length,20+json.length); data.writeUInt32LE(0x004e4942,24+json.length); binary.copy(data,28+json.length)
  return data
}



module.exports={tetrahedron}
