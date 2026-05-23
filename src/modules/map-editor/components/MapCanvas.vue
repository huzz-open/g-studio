<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  state, selectLocation, updateLocationPosition,
  beginEditTransaction, endEditTransaction, placePendingLocation,
} from '../store'
import type { MapLocation, Region, WaterFeature } from '../types'

const canvasRef = ref<HTMLCanvasElement>()
const containerRef = ref<HTMLDivElement>()
let ctx: CanvasRenderingContext2D | null = null
let baseImage: HTMLImageElement | null = null
let dragTarget: MapLocation | null = null
let dragOffset = { x: 0, y: 0 }
let isPanning = false
let panStart = { x: 0, y: 0 }

const BASE_W = 1280
const BASE_H = 960

function toWorld(cx: number, cy: number) {
  return { x: (cx - state.panX) / state.zoom, y: (cy - state.panY) / state.zoom }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.substring(0,2),16)},${parseInt(h.substring(2,4),16)},${parseInt(h.substring(4,6),16)},${alpha})`
}

function draw() {
  if (!canvasRef.value || !ctx) return
  const canvas = canvasRef.value
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(state.panX, state.panY)
  ctx.scale(state.zoom, state.zoom)

  if (baseImage) {
    ctx.drawImage(baseImage, 0, 0, BASE_W, BASE_H)
  } else {
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, BASE_W, BASE_H)
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, BASE_W, BASE_H)
    ctx.fillStyle = '#666'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('Load base map from toolbar', BASE_W / 2, BASE_H / 2)
  }

  if (state.mapData?.regions?.length && state.showRegions) drawRegions(state.mapData.regions)
  if (state.mapData?.waterFeatures?.length && state.showWater) drawWaterFeatures(state.mapData.waterFeatures)
  if (state.showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5
    for (let x = 0; x <= BASE_W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BASE_H); ctx.stroke() }
    for (let y = 0; y <= BASE_H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BASE_W, y); ctx.stroke() }
  }
  if (state.mapData) {
    if (state.showRoads) drawRoads()
    for (const loc of state.mapData.locations) drawLocation(loc)
  }
  ctx.restore()
}

function drawRegions(regions: Region[]) {
  if (!ctx) return
  for (const r of regions) {
    ctx.fillStyle = hexToRgba(r.color, 0.25)
    ctx.beginPath()
    ctx.moveTo(r.vertices[0][0], r.vertices[0][1])
    for (let i = 1; i < r.vertices.length; i++) ctx.lineTo(r.vertices[i][0], r.vertices[i][1])
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = hexToRgba(r.color, 0.6); ctx.lineWidth = 1; ctx.stroke()
    const cx = r.vertices.reduce((s, v) => s + v[0], 0) / r.vertices.length
    const cy = r.vertices.reduce((s, v) => s + v[1], 0) / r.vertices.length
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(r.name, cx, cy)
  }
}

function drawWaterFeatures(features: WaterFeature[]) {
  if (!ctx) return
  for (const f of features) {
    if (f.type === 'lake' && f.vertices) {
      ctx.fillStyle = hexToRgba(f.color, 0.4)
      ctx.beginPath(); ctx.moveTo(f.vertices[0][0], f.vertices[0][1])
      for (let i = 1; i < f.vertices.length; i++) ctx.lineTo(f.vertices[i][0], f.vertices[i][1])
      ctx.closePath(); ctx.fill(); ctx.strokeStyle = f.color; ctx.lineWidth = 1; ctx.stroke()
    } else if (f.type === 'river' && f.points) {
      ctx.strokeStyle = f.color; ctx.lineWidth = f.width ?? 2
      ctx.beginPath(); ctx.moveTo(f.points[0][0], f.points[0][1])
      for (let i = 1; i < f.points.length; i++) ctx.lineTo(f.points[i][0], f.points[i][1])
      ctx.stroke()
    } else if (f.type === 'moat' && f.center) {
      ctx.strokeStyle = hexToRgba(f.color, 0.5); ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(f.center[0], f.center[1], f.radius ?? 50, 0, Math.PI * 2); ctx.stroke()
    }
  }
}

function drawRoads() {
  if (!ctx || !state.mapData?.roads?.length) return
  const locsById = new Map(state.mapData.locations.map(l => [l.id, l]))
  for (const road of state.mapData.roads) {
    const a = locsById.get(road.from), b = locsById.get(road.to)
    if (!a || !b) continue
    if (a.position.x === null || a.position.y === null || b.position.x === null || b.position.y === null) continue
    ctx.strokeStyle = road.type === 'special' ? 'rgba(160,80,160,0.7)' : road.type === 'main' ? 'rgba(139,90,43,0.85)' : 'rgba(160,120,70,0.65)'
    ctx.lineWidth = road.type === 'main' ? 2.5 : 1.5
    ctx.beginPath(); ctx.moveTo(a.position.x, a.position.y); ctx.lineTo(b.position.x!, b.position.y!); ctx.stroke()
  }
}

function drawLocation(loc: MapLocation) {
  if (!ctx || loc.position.x === null || loc.position.y === null) return
  const x = loc.position.x, y = loc.position.y
  const w = loc.iconSize.w, h = loc.iconSize.h
  const realmColors: Record<string, string> = { human: '#4a9', underground: '#a73', underworld: '#68a', celestial: '#da5' }
  const rc = realmColors[loc.realm] ?? '#888'
  ctx.fillStyle = rc; ctx.globalAlpha = 0.25
  ctx.beginPath(); ctx.ellipse(x, y, w/2, h/2, 0, 0, Math.PI*2); ctx.fill()
  ctx.globalAlpha = 0.6; ctx.strokeStyle = rc; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1

  const iconUrl = state.iconImages.get(loc.id)
  if (iconUrl) { const img = new Image(); img.src = iconUrl; if (img.complete) ctx.drawImage(img, x-w/2, y-h/2, w, h) }
  if (state.showNumbers) {
    const fs = Math.max(8, w*0.5); ctx.font = `bold ${fs}px monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.strokeText(String(loc.id), x, y)
    ctx.fillStyle = '#fff'; ctx.fillText(String(loc.id), x, y)
  }
  if (loc.id === state.selectedLocationId) {
    ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2; ctx.strokeRect(x-w/2-2, y-h/2-2, w+4, h+4)
  }
  if (state.showLabels) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2
    ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.strokeText(loc.name, x, y+h/2+2); ctx.fillText(loc.name, x, y+h/2+2)
  }
}

function hitTest(wx: number, wy: number): MapLocation | null {
  if (!state.mapData) return null
  for (let i = state.mapData.locations.length - 1; i >= 0; i--) {
    const loc = state.mapData.locations[i]
    if (loc.position.x === null || loc.position.y === null) continue
    const r = Math.max(loc.iconSize.w, loc.iconSize.h) / 2 + 4
    if (Math.abs(wx - loc.position.x) <= r && Math.abs(wy - loc.position.y) <= r) return loc
  }
  return null
}

function onMouseDown(e: MouseEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  const world = toWorld(e.clientX - rect.left, e.clientY - rect.top)
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true; panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY }; return
  }
  const hit = hitTest(world.x, world.y)
  if (hit) {
    selectLocation(hit.id); dragTarget = hit
    dragOffset = { x: world.x - (hit.position.x ?? 0), y: world.y - (hit.position.y ?? 0) }
    beginEditTransaction()
  } else if (e.button === 0) selectLocation(null)
}

function onMouseMove(e: MouseEvent) {
  if (isPanning) { state.panX = e.clientX - panStart.x; state.panY = e.clientY - panStart.y; draw(); return }
  if (dragTarget) {
    const rect = canvasRef.value!.getBoundingClientRect()
    const world = toWorld(e.clientX - rect.left, e.clientY - rect.top)
    updateLocationPosition(dragTarget.id, Math.max(0, Math.min(BASE_W, world.x - dragOffset.x)), Math.max(0, Math.min(BASE_H, world.y - dragOffset.y)))
    draw()
  }
}

function onMouseUp() {
  if (dragTarget) endEditTransaction()
  dragTarget = null; isPanning = false
}

function onWheel(e: WheelEvent) {
  const rect = canvasRef.value!.getBoundingClientRect()
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top
  const oldZoom = state.zoom
  state.zoom = Math.max(0.2, Math.min(5, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)))
  state.panX = cx - (cx - state.panX) * (state.zoom / oldZoom)
  state.panY = cy - (cy - state.panY) * (state.zoom / oldZoom)
  draw()
}

function onDblClick(e: MouseEvent) {
  if (!state.mapData) return
  const rect = canvasRef.value!.getBoundingClientRect()
  const world = toWorld(e.clientX - rect.left, e.clientY - rect.top)
  if (hitTest(world.x, world.y)) return
  const pending = state.mapData.locations.find(l => l.position.x === null || l.position.y === null)
  if (pending) { placePendingLocation(pending.id, world.x, world.y); selectLocation(pending.id); draw() }
}

function resize() {
  if (!canvasRef.value || !containerRef.value) return
  canvasRef.value.width = containerRef.value.clientWidth
  canvasRef.value.height = containerRef.value.clientHeight
  draw()
}

watch(() => [state.mapData, state.showLabels, state.showNumbers, state.showGrid, state.showRoads, state.showRegions, state.showWater, state.selectedLocationId, state.iconImages.size, state.assetsLoaded, state.zoom, state.panX, state.panY], () => nextTick(draw))
watch(() => state.mapData?.locations.map(l => `${l.id}:${l.position.x},${l.position.y}`).join('|'), () => nextTick(draw))
watch(() => state.baseMapUrl, (url) => {
  if (!url) { baseImage = null; draw(); return }
  const img = new Image(); img.onload = () => { baseImage = img; draw() }; img.src = url
})

onMounted(() => {
  ctx = canvasRef.value!.getContext('2d')!; resize()
  window.addEventListener('resize', resize)
  window.addEventListener('mousemove', (e) => { if (dragTarget || isPanning) onMouseMove(e) })
  window.addEventListener('mouseup', onMouseUp)
})
onUnmounted(() => { window.removeEventListener('resize', resize) })
</script>

<template>
  <div ref="containerRef" class="canvas-container">
    <canvas ref="canvasRef" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" @wheel.prevent="onWheel" @dblclick="onDblClick" />
  </div>
</template>

<style scoped>
.canvas-container { flex: 1; overflow: hidden; background: #1a1a1a; cursor: crosshair; }
canvas { display: block; width: 100%; height: 100%; }
</style>
