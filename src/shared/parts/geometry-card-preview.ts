import { BufferGeometry, DirectionalLight, DoubleSide, HemisphereLight, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { buildPartGeometry } from '../../modules/scene-lighting/part-geometry'
import { partPixels } from './images'
import type { PartAsset, PartGeometry } from './schema'

export interface GeometryPreviewTarget { geometry: PartGeometry; canvas: HTMLCanvasElement }

/** One WebGL context feeds all visible card canvases; closing the menu releases it. */
export function createGeometryCardPreview(part: PartAsset, targets: GeometryPreviewTarget[], viewport: HTMLElement) {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0, 0)
  } catch {
    targets.forEach(({ canvas }) => { canvas.dataset.previewState = 'error' })
    return () => {}
  }
  const material = new MeshStandardMaterial({ color: 0xc5d8cb, roughness: .78, side: DoubleSide })
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100)
  scene.add(new HemisphereLight(0xe8f3ff, 0x435348, 2.4))
  const key = new DirectionalLight(0xffedd4, 3.1), fill = new DirectionalLight(0xa9c9ff, 1.4)
  key.position.set(3, 5, 4); fill.position.set(-3, 1, -3); scene.add(key, fill)
  const models: { canvas: HTMLCanvasElement; mesh: Mesh<BufferGeometry, MeshStandardMaterial>; radius: number }[] = []
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false, frame = 0, last = 0, angle = .4

  function draw(time: number) {
    frame = 0
    if (disposed || document.hidden) return
    if (!motion.matches && last && time - last < 1000 / 24) { frame = requestAnimationFrame(draw); return }
    if (!motion.matches && last) angle += Math.min(time - last, 100) * .00045
    last = time
    const clip = viewport.getBoundingClientRect()
    for (const { canvas, mesh, radius } of models) {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.bottom <= clip.top || rect.top >= clip.bottom) continue
      const pixelRatio = Math.min(devicePixelRatio, 1.5)
      const width = Math.round(rect.width * pixelRatio), height = Math.round(rect.height * pixelRatio)
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const ctx = canvas.getContext('2d')
      if (!ctx) { canvas.dataset.previewState = 'error'; continue }
      renderer.setSize(width, height, false)
      const aspect = width / height, extent = radius * 1.18
      camera.left = -extent * Math.max(1, aspect); camera.right = -camera.left
      camera.top = extent * Math.max(1, 1 / aspect); camera.bottom = -camera.top
      camera.position.set(0, radius * 1.5, radius * 4)
      camera.near = radius * .01; camera.far = radius * 10
      camera.lookAt(0, 0, 0); camera.updateProjectionMatrix()
      mesh.rotation.y = angle
      scene.add(mesh); renderer.render(scene, camera); scene.remove(mesh)
      ctx.clearRect(0, 0, width, height); ctx.drawImage(renderer.domElement, 0, 0)
      canvas.dataset.previewState = 'ready'
    }
    if (!motion.matches) frame = requestAnimationFrame(draw)
  }
  function refresh() {
    cancelAnimationFrame(frame); last = 0
    if (!disposed && !document.hidden) frame = requestAnimationFrame(draw)
  }
  // Decode the image only once, and only if a silhouette card needs its alpha mask.
  const pixels = targets.some(target => target.geometry.kind === 'silhouette') ? partPixels(part) : undefined
  for (const target of targets) {
    target.canvas.dataset.previewState = 'loading'
    void (async () => {
      try {
        const data = target.geometry.kind === 'silhouette' ? (await pixels!).pixels : { width: 0, height: 0, data: new Uint8ClampedArray() }
        if (disposed) return
        const decoded = buildPartGeometry({ ...part, geometry: target.geometry }, data)
        const geometry = new BufferGeometry(), buffer = new InterleavedBuffer(decoded.vertices.slice(), 9)
        geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0))
        geometry.setAttribute('normal', new InterleavedBufferAttribute(buffer, 3, 3))
        geometry.computeBoundingBox()
        const center = geometry.boundingBox!.getCenter(new Vector3())
        geometry.translate(-center.x, -center.y, -center.z); geometry.computeBoundingSphere()
        models.push({ canvas: target.canvas, mesh: new Mesh(geometry, material), radius: Math.max(.001, geometry.boundingSphere!.radius) })
        refresh()
      } catch { if (!disposed) target.canvas.dataset.previewState = 'error' }
    })()
  }
  document.addEventListener('visibilitychange', refresh)
  motion.addEventListener('change', refresh)
  viewport.addEventListener('scroll', refresh)
  return () => {
    disposed = true; cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', refresh)
    motion.removeEventListener('change', refresh)
    viewport.removeEventListener('scroll', refresh)
    models.forEach(({ mesh }) => mesh.geometry.dispose())
    material.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}
