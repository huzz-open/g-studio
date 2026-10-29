import { add, camera, scale, type Vec3 } from '../experiments/umbrella/math'
import { PITCH, RIGHT, UP, YAW, type SceneState } from './model'

export const DEFAULT_SCENE_TARGET: Vec3 = [0, 1.15, 0]

export function sceneCamera(state: SceneState, aspect: number) {
  return camera({ yaw: state.mode==='sprites'?YAW:state.inspectionYaw??YAW, pitch: state.mode==='sprites'?PITCH:state.inspectionPitch??PITCH, distance: state.zoom, projection: 'orthographic' }, aspect, state.target ?? DEFAULT_SCENE_TARGET)
}

/** Move the camera opposite the pointer so every world point follows the drag. */
export function panCameraTarget(target: Vec3, zoom: number, viewportHeight: number, dx: number, dy: number): Vec3 {
  const unitsPerPixel = zoom * .8 / Math.max(1, viewportHeight)
  return add(target, add(scale(RIGHT, -dx * unitsPerPixel), scale(UP, dy * unitsPerPixel)))
}
