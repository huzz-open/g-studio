<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { BufferGeometry, Color, DirectionalLight, HemisphereLight, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { decodeMesh } from '../parts/mesh'
import { useI18n } from '../i18n'
import InfoHint from '../components/InfoHint.vue'

const props = defineProps<{ uri: string; image: string; name: string }>()
const { t } = useI18n()
const host = ref<HTMLElement>(), canvas = ref<HTMLCanvasElement>()
const wireframe = ref(false), showSource = ref(false), error = ref(''), faces = ref(0)
let renderer: WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined
const scene = new Scene(), camera = new PerspectiveCamera(40, 1, .01, 1000)
const material = new MeshStandardMaterial({ color: 0xb7c4ce, roughness: .78, metalness: .05 })
let model: Mesh<BufferGeometry, MeshStandardMaterial> | undefined

function draw() { if (renderer && !error.value) renderer.render(scene, camera) }
function fit() {
  if (!model || !controls) return
  const sphere = model.geometry.boundingSphere ?? new Sphere(new Vector3(), 1)
  const radius = Math.max(sphere.radius, .001)
  const halfFov = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(camera.aspect, 1))
  const distance = radius / Math.sin(halfFov) * 1.2
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).add(new Vector3(1, .55, 1.8).normalize().multiplyScalar(distance))
  camera.near = radius / 100
  camera.far = distance + radius * 100
  camera.updateProjectionMatrix()
  controls.minDistance = radius * .15
  controls.maxDistance = radius * 40
  controls.update()
  draw()
}
function load() {
  if (!renderer) return
  error.value = ''
  if (model) { scene.remove(model); model.geometry.dispose(); model = undefined }
  try {
    const decoded = decodeMesh(props.uri)
    const buffers = new BufferGeometry(), data = new InterleavedBuffer(decoded.vertices, 9)
    buffers.setAttribute('position', new InterleavedBufferAttribute(data, 3, 0))
    buffers.setAttribute('normal', new InterleavedBufferAttribute(data, 3, 3))
    buffers.computeBoundingSphere()
    model = new Mesh(buffers, material)
    scene.add(model)
    faces.value = decoded.triangles.length
    fit()
  } catch (e) { error.value = String(e) }
}
function resize() {
  if (!host.value || !renderer) return
  const { width, height } = host.value.getBoundingClientRect()
  if (!width || !height) return
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
  draw()
}
watch(() => props.uri, load)
watch(wireframe, value => { material.wireframe = value; draw() })
onMounted(() => {
  try {
    renderer = new WebGLRenderer({ canvas: canvas.value!, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    scene.background = new Color('#202327')
    scene.add(new HemisphereLight(0xddeeff, 0x50505b, 2.4))
    const key = new DirectionalLight(0xfff0dc, 3.2)
    key.position.set(3, 5, 4); scene.add(key)
    const fill = new DirectionalLight(0xaecaff, 1.8)
    fill.position.set(-4, 1, -3); scene.add(fill)
    controls = new OrbitControls(camera, canvas.value!)
    controls.addEventListener('change', draw)
    resize(); load()
    observer = new ResizeObserver(resize); observer.observe(host.value!)
  } catch (e) { error.value = String(e) }
})
onBeforeUnmount(() => {
  observer?.disconnect(); controls?.dispose(); model?.geometry.dispose(); material.dispose(); renderer?.dispose()
})
</script>

<template>
  <div ref="host" class="model-viewer">
    <canvas ref="canvas" :aria-label="t('generation.modelView')" @dblclick="fit" />
    <div v-if="error" class="viewer-error" role="alert">{{ t('generation.previewFailed') }}<InfoHint :label="t('generation.details')" :text="error" /></div>
    <figure v-if="showSource" class="source-reference"><img :src="image" :alt="name" /><figcaption>{{ t('slicer.source') }}</figcaption></figure>
    <div class="viewer-toolbar" role="group" :aria-label="t('generation.modelView')">
      <button :aria-pressed="wireframe" @click="wireframe = !wireframe">{{ t('generation.wireframe') }}</button>
      <button :aria-pressed="showSource" @click="showSource = !showSource">{{ t('generation.compareSource') }}</button>
      <button @click="fit">{{ t('generation.resetView') }}</button>
      <span>{{ t('generation.faceCount', { count: faces.toLocaleString() }) }}</span>
      <InfoHint :label="t('generation.modelView')" :text="t('generation.orbitHelp')" />
    </div>
  </div>
</template>

<style scoped>
.model-viewer { position:relative; flex:1; width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; }
canvas { display:block; width:100%; height:100%; touch-action:none; }
.viewer-toolbar { position:absolute; bottom:16px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:6px; padding:6px; max-width:calc(100% - 24px); flex-wrap:wrap; justify-content:center; border:1px solid #4a5058; border-radius:8px; background:#25292eee; color:#bfc6d0; font-size:11px; }
button { font:inherit; color:inherit; white-space:nowrap; background:transparent; border:1px solid transparent; border-radius:4px; padding:6px 9px; cursor:pointer; }
button:hover,button[aria-pressed=true] { background:#3a4b60; color:#e5efff; }
.viewer-toolbar span { padding:0 6px; white-space:nowrap; }
.source-reference { position:absolute; right:16px; top:16px; margin:0; padding:10px; width:clamp(70px,18%,180px); background:#181b20dd; border:1px solid #48505a; border-radius:8px; text-align:center; }
.source-reference img { width:100%; max-height:220px; object-fit:contain; }
figcaption { margin-top:6px; color:#aeb7c4; font-size:11px; }
.viewer-error { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; align-items:center; gap:8px; color:#efad99; }
</style>
