<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import SvgIcon from '../../icons/SvgIcon.vue'

const props = withDefaults(defineProps<{
  side: 'left' | 'right'
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  persistKey?: string
  collapsed?: boolean
}>(), {
  defaultWidth: 260,
  minWidth: 180,
  maxWidth: 480,
  collapsed: false,
})

const emit = defineEmits<{
  'update:collapsed': [val: boolean]
}>()

const storedVal = props.persistKey
  ? parseInt(localStorage.getItem(props.persistKey) ?? '', 10)
  : NaN
const width = ref(Number.isFinite(storedVal) ? clamp(storedVal) : props.defaultWidth)

let onMove: ((e: MouseEvent) => void) | null = null
let onUp: (() => void) | null = null

function clamp(v: number): number {
  return Math.min(props.maxWidth, Math.max(props.minWidth, v))
}

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  onMove = (ev: MouseEvent) => {
    const raw = props.side === 'left'
      ? ev.clientX
      : window.innerWidth - ev.clientX
    width.value = clamp(raw)
  }
  onUp = () => {
    document.removeEventListener('mousemove', onMove!)
    document.removeEventListener('mouseup', onUp!)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    onMove = null
    onUp = null
    if (props.persistKey) {
      localStorage.setItem(props.persistKey, String(width.value))
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function toggleCollapse() {
  emit('update:collapsed', !props.collapsed)
}

onUnmounted(() => {
  if (onMove) document.removeEventListener('mousemove', onMove)
  if (onUp) document.removeEventListener('mouseup', onUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

const panelStyle = computed(() => props.collapsed
  ? { width: '24px', minWidth: '24px' }
  : { width: `${width.value}px`, minWidth: `${props.minWidth}px` }
)
</script>

<template>
  <div class="side-panel" :class="[side, { collapsed }]" :style="panelStyle">
    <!-- Collapsed state -->
    <div v-if="collapsed" class="collapsed-bar" @click="toggleCollapse">
      <SvgIcon :name="side === 'left' ? 'chevron-right' : 'chevron-left'" :size="12" />
    </div>

    <!-- Expanded state -->
    <template v-else>
      <div class="panel-content">
        <slot />
      </div>
      <div
        class="resize-handle"
        :class="side"
        @mousedown="onResizeStart"
      />
    </template>
  </div>
</template>

<style scoped>
.side-panel {
  display: flex;
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.15s ease;
}
.side-panel.left {
  flex-direction: row;
  border-right: 1px solid #333;
}
.side-panel.right {
  flex-direction: row-reverse;
  border-left: 1px solid #333;
}
.side-panel.collapsed {
  overflow: visible;
}

.collapsed-bar {
  width: 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: #1e1e1e;
  color: #666;
  transition: color 0.15s, background 0.15s;
}
.collapsed-bar:hover {
  color: #ccc;
  background: #2a2a2a;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.resize-handle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 5;
  transition: background 0.1s;
}
.resize-handle:hover,
.resize-handle:active {
  background: rgba(85, 119, 170, 0.5);
}
.resize-handle.left { right: 0; }
.resize-handle.right { left: 0; }
</style>
