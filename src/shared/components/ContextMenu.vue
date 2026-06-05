<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  separator?: boolean
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  action: [id: string]
  close: []
}>()

const menuEl = ref<HTMLElement>()

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    clampToViewport()
  }
})

function clampToViewport() {
  const el = menuEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (rect.right > vw) {
    el.style.left = `${props.x - rect.width}px`
  }
  if (rect.bottom > vh) {
    el.style.top = `${props.y - rect.height}px`
  }
}

function onAction(id: string) {
  emit('action', id)
  emit('close')
}

function onDocMouseDown(e: MouseEvent) {
  if (!props.visible) return
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuEl"
      class="ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="ctx-sep" />
        <button
          v-else
          class="ctx-item"
          :disabled="item.disabled"
          @click="onAction(item.id)"
        >
          <SvgIcon v-if="item.icon" :name="item.icon" :size="14" class="ctx-icon" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 10001;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 14px;
  background: none;
  border: none;
  color: #ddd;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover:not(:disabled) {
  background: #3a3a3a;
}
.ctx-item:disabled {
  color: #666;
  cursor: default;
}
.ctx-icon {
  flex-shrink: 0;
  opacity: 0.7;
}
.ctx-item:hover:not(:disabled) .ctx-icon {
  opacity: 1;
}
.ctx-sep {
  height: 1px;
  background: #3a3a3a;
  margin: 3px 0;
}
</style>
