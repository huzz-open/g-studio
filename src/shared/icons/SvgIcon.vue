<script setup lang="ts">
import { computed } from 'vue'
import { iconPaths } from './icon-paths'

const props = withDefaults(defineProps<{
  name: string
  size?: number
}>(), {
  size: 16,
})

const pathData = computed(() => iconPaths[props.name] ?? '')
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="svg-icon"
  >
    <path v-if="pathData" :d="pathData" />
    <template v-else>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </template>
  </svg>
</template>

<style scoped>
.svg-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
