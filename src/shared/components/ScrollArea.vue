<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'

const props = withDefaults(defineProps<{ label?: string }>(), { label: '滚动区域' })
const viewport = ref<HTMLElement>(), content = ref<HTMLElement>(), rail = ref<HTMLElement>()
const id = useId(), top = ref(0), height = ref(0), total = ref(0), railHeight = ref(0), dragging = ref(false)
const max = computed(() => Math.max(0, total.value - height.value))
const thumbSize = computed(() => Math.min(railHeight.value, Math.max(24, railHeight.value * height.value / Math.max(1, total.value))))
const thumbTop = computed(() => max.value ? top.value / max.value * Math.max(0, railHeight.value - thumbSize.value) : 0)
let observer: ResizeObserver | undefined, frame = 0
let dragStart = 0, scrollStart = 0
function measure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!viewport.value) return
    height.value = viewport.value.clientHeight; total.value = viewport.value.scrollHeight
    top.value = viewport.value.scrollTop; railHeight.value = rail.value?.clientHeight ?? Math.max(0, height.value - 8)
  })
}
function scrollTo(value: number) { if (viewport.value) { viewport.value.scrollTop = Math.max(0, Math.min(max.value, value)); measure() } }
function start(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault(); event.stopPropagation()
  dragging.value = true; dragStart = event.clientY; scrollStart = viewport.value!.scrollTop
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!dragging.value) return
  const travel = railHeight.value - thumbSize.value
  if (travel > 0) scrollTo(scrollStart + (event.clientY - dragStart) / travel * max.value)
}
function page(event: PointerEvent) {
  if (event.button !== 0 || event.target !== event.currentTarget) return
  event.preventDefault()
  const y = event.clientY - rail.value!.getBoundingClientRect().top
  scrollTo(top.value + (y < thumbTop.value ? -1 : 1) * height.value * .85)
}
function key(event: KeyboardEvent) {
  const actions: Record<string, number> = { ArrowDown: top.value + 40, ArrowUp: top.value - 40, PageDown: top.value + height.value * .85, PageUp: top.value - height.value * .85, Home: 0, End: max.value }
  if (event.key in actions) { event.preventDefault(); event.stopPropagation(); scrollTo(actions[event.key]) }
}
onMounted(() => { observer = new ResizeObserver(measure); observer.observe(viewport.value!); observer.observe(content.value!); observer.observe(rail.value!); measure() })
onUnmounted(() => { observer?.disconnect(); cancelAnimationFrame(frame) })
defineExpose({ scrollTo, viewport })
</script>

<template>
  <div class="scroll-area" :class="{ dragging }">
    <div :id="id" ref="viewport" class="scroll-viewport" tabindex="0" :aria-label="props.label" @scroll.passive="measure">
      <div ref="content" class="scroll-content"><slot /></div>
    </div>
    <div ref="rail" class="scroll-rail" :class="{ overflow: max > 1 }" @pointerdown="page">
      <div v-if="max > 1" class="scroll-thumb" role="scrollbar" tabindex="0" aria-orientation="vertical" :aria-label="props.label" :aria-controls="id" :aria-valuemin="0" :aria-valuemax="Math.round(max)" :aria-valuenow="Math.round(top)"
        :style="{ height: thumbSize + 'px', transform: `translateY(${thumbTop}px)` }"
        @pointerdown="start" @pointermove="move" @pointerup="dragging=false" @pointercancel="dragging=false" @lostpointercapture="dragging=false" @keydown="key" />
    </div>
  </div>
</template>

<style scoped>
.scroll-area{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
.scroll-viewport{height:100%;width:100%;overflow:auto;overflow-x:hidden;scrollbar-width:none;outline:none}
.scroll-viewport::-webkit-scrollbar{display:none;width:0;height:0}
.scroll-viewport:focus-visible{outline:1px solid #5577aa;outline-offset:-1px}
.scroll-content{display:flow-root;box-sizing:border-box;min-height:100%;padding-right:10px}
.scroll-rail{position:absolute;right:2px;top:4px;bottom:4px;width:7px;pointer-events:none;border-radius:5px}
.scroll-rail.overflow{pointer-events:auto}
.scroll-thumb{position:absolute;top:0;right:0;width:6px;min-height:24px;border-radius:5px;background:#718079;opacity:.25;cursor:default;touch-action:none;user-select:none;transition:opacity .15s,background .15s;outline:none}
.scroll-area:hover>.scroll-rail>.scroll-thumb,.scroll-area:focus-within>.scroll-rail>.scroll-thumb{opacity:.65}
.scroll-thumb:hover,.scroll-thumb:focus-visible,.dragging>.scroll-rail>.scroll-thumb{opacity:1!important;background:#91a399}
.scroll-thumb:focus-visible{box-shadow:0 0 0 1px #a9c0b2}
@media(pointer:coarse){.scroll-rail{width:14px}.scroll-thumb{width:8px}}
</style>
