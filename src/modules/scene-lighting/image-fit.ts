import { FORWARD, RIGHT, UP, type Mesh } from './model'
import { type Vec3 } from '../experiments/umbrella/math'

/** Similarity registration preserves proportions in all three dimensions. */
export function fitMeshProjection(mesh: Mesh, target: [number, number, number, number], ratios: Vec3, projection: Vec3 = [0, 0, 0]): Mesh {
  let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity,minY=Infinity
  const source=mesh.vertices
  for(let i=0;i<source.length;i+=9){
    const px=source[i],py=source[i+1],pz=source[i+2]
    const x=px*RIGHT[0]+py*RIGHT[1]+pz*RIGHT[2],y=px*UP[0]+py*UP[1]+pz*UP[2]
    left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);minY=Math.min(minY,py)
  }
  if(right-left<1e-8||top-bottom<1e-8)throw new Error('Cannot align a degenerate model projection')
  const uniform=Math.min(target[2]/(right-left),target[3]/(top-bottom))*Math.exp(projection[0])
  const tx=target[0]+target[2]*(.5+projection[1])-(left+right)/2*uniform
  const ty=target[1]+target[3]*(.5+projection[2])-(bottom+top)/2*uniform
  // RIGHT/UP/FORWARD form an orthonormal basis. Uniform scaling in that
  // basis is uniform world scaling; only the translation needs conversion.
  const shift=RIGHT.map((v,i)=>v*tx+UP[i]*ty) as Vec3
  const depthShift=-(minY*uniform+shift[1])/FORWARD[1]
  for(let i=0;i<3;i++)shift[i]+=FORWARD[i]*depthShift
  const point=(p:Vec3):Vec3=>[(p[0]*uniform+shift[0])*ratios[0],(p[1]*uniform+shift[1])*ratios[1],(p[2]*uniform+shift[2])*ratios[2]]
  const vertices=source.slice()
  for(let i=0;i<vertices.length;i+=9){
    vertices[i]=(source[i]*uniform+shift[0])*ratios[0]
    vertices[i+1]=(source[i+1]*uniform+shift[1])*ratios[1]
    vertices[i+2]=(source[i+2]*uniform+shift[2])*ratios[2]
    const x=source[i+3]/ratios[0],y=source[i+4]/ratios[1],z=source[i+5]/ratios[2],length=Math.hypot(x,y,z)||1
    vertices[i+3]=x/length;vertices[i+4]=y/length;vertices[i+5]=z/length
  }
  return {vertices,triangles:mesh.triangles.map(tri=>tri.map(point))}
}

/** Pixel edges, not pixel centers. Match the renderer's alpha discard (0.08). */
export function visiblePixelBounds(pixels: { width: number; height: number; data: Uint8ClampedArray }) {
  let left = pixels.width, top = pixels.height, right = 0, bottom = 0
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    if (pixels.data[(y * pixels.width + x) * 4 + 3] / 255 < .08) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1)
  }
  if (right <= left || bottom <= top) throw new Error('Image has no visible pixels')
  return { left: left / pixels.width, bottom: 1 - bottom / pixels.height, width: (right - left) / pixels.width, height: (bottom - top) / pixels.height }
}
