<script setup lang="ts">
/**
 * Unified action menu for any bounded area.
 *
 * Two display modes driven by the same action list:
 * - **Hover bar**: compact icon-only bar, shows items with `showOnHover: true`.
 *   Positioned relative to `hoverAnchor` at `hoverPlacement`.
 * - **Context menu**: full dropdown with icon + label, shows ALL items.
 *   Positioned at `(contextX, contextY)`.
 *
 * When the context menu is open, the hover bar hides automatically.
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'

export interface ActionItem {
  key: string
  icon: string
  label: string
  /** Show in the hover bar (default false, context menu always shows all) */
  showOnHover?: boolean
  disabled?: boolean
  /** Render a separator line before this item (context mode only) */
  separator?: boolean
}

export type Placement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const props = withDefaults(defineProps<{
  actions: ActionItem[]
  hoverAnchor: { top: number; left: number; width: number; height: number } | null
  hoverPlacement?: Placement
  hoverOffset?: number
  contextVisible: boolean
  contextX: number
  contextY: number
}>(), {
  hoverPlacement: 'top-left',
  hoverOffset: 4,
  contextX: 0,
  contextY: 0,
})

const emit = defineEmits<{
  (e: 'action', key: string): void
  (e: 'hover-enter'): void
  (e: 'hover-leave'): void
  (e: 'context-close'): void
}>()

const ctxEl = ref<HTMLElement>()

// --- Hover bar ---

const hoverItems = computed(() => props.actions.filter(a => a.showOnHover))

const showHover = computed(() =>
  props.hoverAnchor !== null && !props.contextVisible && hoverItems.value.length > 0,
)

const hoverStyle = computed(() => {
  const a = props.hoverAnchor
  if (!a) return { display: 'none' }
  const o = props.hoverOffset
  const s: Record<string, string> = { position: 'fixed' }
  if (props.hoverPlacement.includes('top')) s.top = `${a.top + o}px`
  else s.top = `${a.top + a.height - o - 24}px`
  if (props.hoverPlacement.includes('right')) {
    s.left = `${a.left + a.width - o}px`
    s.transform = 'translateX(-100%)'
  } else {
    s.left = `${a.left + o}px`
  }
  return s
})

function onHoverAction(key: string) {
  emit('action', key)
}

// --- Context menu ---

function onCtxAction(key: string) {
  emit('action', key)
  emit('context-close')
}

function onDocClick(e: MouseEvent) {
  if (!props.contextVisible) return
  if (ctxEl.value && !ctxEl.value.contains(e.target as Node)) {
    emit('context-close')
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.contextVisible) {
    emit('context-close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick, true)
  document.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <!-- Hover bar -->
    <div
      v-if="showHover"
      class="am-hover"
      :style="hoverStyle"
      @mouseenter="emit('hover-enter')"
      @mouseleave="emit('hover-leave')"
    >
      <button
        v-for="act in hoverItems"
        :key="act.key"
        class="am-hover-btn"
        :title="act.label"
        @click.stop="onHoverAction(act.key)"
      >
        <SvgIcon :name="act.icon" :size="14" />
      </button>
    </div>

    <!-- Context menu -->
    <div
      v-if="contextVisible"
      ref="ctxEl"
      class="am-ctx"
      :style="{ left: contextX + 'px', top: contextY + 'px' }"
    >
      <template v-for="act in actions" :key="act.key">
        <div v-if="act.separator" class="am-ctx-sep" />
        <button
          class="am-ctx-item"
          :disabled="act.disabled"
          @click="onCtxAction(act.key)"
        >
          <SvgIcon :name="act.icon" :size="14" class="am-ctx-icon" />
          <span>{{ act.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* Hover bar */
.am-hover {
  z-index: 9990;
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(30, 30, 30, 0.92);
  border-radius: 6px;
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}
.am-hover-btn {
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
.am-hover-btn:hover {
  background: #444;
  color: #fff;
}

/* Context menu */
.am-ctx {
  position: fixed;
  z-index: 10001;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 150px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.am-ctx-item {
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
.am-ctx-item:hover:not(:disabled) {
  background: #3a3a3a;
}
.am-ctx-item:disabled {
  color: #666;
  cursor: default;
}
.am-ctx-icon {
  flex-shrink: 0;
  opacity: 0.7;
}
.am-ctx-item:hover:not(:disabled) .am-ctx-icon {
  opacity: 1;
}
.am-ctx-sep {
  height: 1px;
  background: #3a3a3a;
  margin: 3px 0;
}
</style>
