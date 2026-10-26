import { add, scale, lookAt, orthographic, multiply, type Vec3 } from '../experiments/umbrella/math'
import { roomBounds, type SceneState } from './model'

export function sunDirection(state: SceneState): Vec3 {
  const az=state.sun.azimuth*Math.PI/180, el=state.sun.elevation*Math.PI/180
  return [Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)]
}
export function sunAnchor(state:SceneState):Vec3 {
  const b=roomBounds(state.room)
  return [(b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2]
}
export function directionalShadowCamera(state:SceneState) {
  const b=roomBounds(state.room),direction=sunDirection(state)
  // A sphere enclosing room + tall/scaled props gives a rotation-invariant
  // orthographic frustum. Distance only positions this camera, not attenuation.
  const top=Math.max(b.height,...state.items.map(i=>8*i.scale))
  const center:Vec3=[(b.minX+b.maxX)/2,top/2,(b.minZ+b.maxZ)/2]
  const radius=Math.hypot(state.room.width,state.room.depth,top)/2+2
  const far=radius*4+4,eye=add(center,scale(direction,radius*2+1))
  return {matrix:multiply(orthographic(radius,1,.1,far),lookAt(eye,center,[0,1,0])),direction,far}
}

export function cornerCoordinates(point:Vec3):Vec3 { return [point[0]+5.5,point[1],point[2]+4] }
export function worldCoordinates(point:Vec3):Vec3 { return [point[0]-5.5,point[1],point[2]-4] }
