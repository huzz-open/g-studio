import { PITCH } from './model'
import type { Vec3 } from '../experiments/umbrella/math'

// Stand the inspection reference upright without changing its projection at the
// source camera angle. Lighting sprites retain their original camera-plane basis.
export const REFERENCE_UP: Vec3 = [0, 1 / Math.cos(PITCH * Math.PI / 180), 0]
