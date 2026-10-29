import { RIGHT, UP, FORWARD } from './model'
import type { Vec3 } from '../experiments/umbrella/math'

/** Z-buffer visibility in source-triangle coordinates. Area weighting prevents
 * tessellation density or projected foreshortening from dominating the prior. */
export function visibleSurface(positions: Float32Array, matrix: number[], resolution = 128) {
  const n = resolution, projected = new Float64Array(positions.length)
  const axis = (a: Vec3) => [a[0]*matrix[0]+a[1]*matrix[3]+a[2]*matrix[6],a[0]*matrix[1]+a[1]*matrix[4]+a[2]*matrix[7],a[0]*matrix[2]+a[1]*matrix[5]+a[2]*matrix[8]]
  const axes = [axis(RIGHT),axis(UP),axis(FORWARD)]
  let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity
  for(let i=0;i<positions.length;i+=3){
    for(let j=0;j<3;j++)projected[i+j]=axes[j][0]*positions[i]+axes[j][1]*positions[i+1]+axes[j][2]*positions[i+2]
    left=Math.min(left,projected[i]);right=Math.max(right,projected[i]);bottom=Math.min(bottom,projected[i+1]);top=Math.max(top,projected[i+1])
  }
  const weights=new Float64Array(positions.length/9)
  if(right-left<1e-8||top-bottom<1e-8)return weights
  for(let i=0;i<projected.length;i+=3){projected[i]=(projected[i]-left)/(right-left)*(n-2)+1;projected[i+1]=(projected[i+1]-bottom)/(top-bottom)*(n-2)+1}
  const depth=new Float64Array(n*n).fill(Infinity),ids=new Int32Array(n*n).fill(-1),areas=new Float64Array(weights.length),screenAreas=new Float64Array(weights.length)
  for(let i=0,t=0;i<projected.length;i+=9,t++){
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=projected.subarray(i,i+9)
    const denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
    if(Math.abs(denominator)<1e-9)continue
    screenAreas[t]=Math.abs(denominator)/2
    const u=[0,1,2].map(j=>positions[i+3+j]-positions[i+j]),v=[0,1,2].map(j=>positions[i+6+j]-positions[i+j])
    areas[t]=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2
    for(let y=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5));y<=Math.min(n-1,Math.floor(Math.max(ay,by,cy)-.5));y++){
      for(let x=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5));x<=Math.min(n-1,Math.floor(Math.max(ax,bx,cx)-.5));x++){
        const a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/denominator,b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/denominator,c=1-a-b
        if(a<0||b<0||c<0)continue
        const z=a*az+b*bz+c*cz,index=y*n+x
        if(z<depth[index]){depth[index]=z;ids[index]=t}
      }
    }
  }
  for(const id of ids)if(id>=0)weights[id]++
  let sum=0
  for(let t=0;t<weights.length;t++){weights[t]=areas[t]*Math.min(1,weights[t]/Math.max(screenAreas[t],1e-9));sum+=weights[t]}
  if(sum)for(let t=0;t<weights.length;t++)weights[t]/=sum
  return weights
}

/** Histogram intersection of normalized visible source-surface areas. */
export function surfaceRetention(reference: Float64Array, candidate: Float64Array) {
  let overlap=0
  for(let i=0;i<reference.length;i++)overlap+=Math.min(reference[i],candidate[i])
  return overlap
}
