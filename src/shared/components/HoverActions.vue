<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'

export interface HoverAction {
  key: string
  icon: string
  tooltip: string
}

const props = withDefaults(defineProps<{
  actions: HoverAction[]
  anchor: { top: number; left: number; width: number; height: number } | null
  placement?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  offset?: number
}>(), {
  placement: 'top-right',
  offset: 4,
})

const emit = defineEmits<{
  (e: 'action', key: string): void
  (e: 'mouseenter'): void
  (e: 'mouseleave'): void
}>()

const style = computed(() => {
  const a = props.anchor
  if (!a) return { display: 'none' }
  const o = props.offset
  const s: Record<string, string> = { position: 'fixed' }
  if (props.placement.includes('top')) s.top = `${a.top + o}px`
  else s.top = `${a.top + a.height - o - 24}px`
  if (props.placement.includes('right')) s.left = `${a.left + a.width - o}px`
  else s.left = `${a.left + o}px`
  if (props.placement.includes('right')) s.transform = 'translateX(-100%)'
  return s
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="anchor"
      class="ha-panel"
      :style="style"
      @mouseenter="emit('mouseenter')"
      @mouseleave="emit('mouseleave')"
    >
      <button
        v-for="act in actions"
        :key="act.key"
        class="ha-btn"
        :title="act.tooltip"
        @click.stop="emit('action', act.key)"
      >
        <SvgIcon :name="act.icon" :size="14" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ha-panel {
  z-index: 9990;
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(30, 30, 30, 0.92);
  border: none;
  border-radius: 6px;
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}
.ha-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  transition: all 0.12s;
}
.ha-btn:hover {
  background: #444;
  color: #fff;
}
</style>
