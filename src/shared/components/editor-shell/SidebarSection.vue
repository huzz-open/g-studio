<script setup lang="ts">
import { ref } from 'vue'
import SvgIcon from '../../icons/SvgIcon.vue'

const props = withDefaults(defineProps<{
  title: string
  icon?: string
  defaultOpen?: boolean
}>(), {
  defaultOpen: true,
})

const open = ref(props.defaultOpen)

function toggle() {
  open.value = !open.value
}
</script>

<template>
  <div class="sidebar-section" :class="{ closed: !open }">
    <div class="section-header" @click="toggle">
      <SvgIcon
        name="chevron-right"
        :size="10"
        class="section-arrow"
        :class="{ rotated: open }"
      />
      <SvgIcon v-if="icon" :name="icon" :size="12" class="section-icon" />
      <span class="section-title">{{ title }}</span>
      <slot name="header-extra" />
    </div>
    <div v-show="open" class="section-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.sidebar-section {
  border-bottom: 1px solid #333;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: #aaa;
  transition: background 0.1s;
}
.section-header:hover {
  background: #2a2a2a;
  color: #ddd;
}
.section-arrow {
  transition: transform 0.15s;
  flex-shrink: 0;
  color: #666;
}
.section-arrow.rotated {
  transform: rotate(90deg);
}
.section-icon {
  flex-shrink: 0;
  color: #888;
}
.section-title {
  flex: 1;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.section-body {
  padding: 6px 10px 10px;
}
</style>
