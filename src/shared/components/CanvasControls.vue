<script setup lang="ts">
import SvgIcon from '../icons/SvgIcon.vue'
import { useI18n } from '../i18n'

withDefaults(defineProps<{
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  direction?: 'horizontal' | 'vertical'
  showActualSize?: boolean
  fullscreenToggle?: boolean
}>(), { position: 'bottom-left', direction: 'horizontal', showActualSize: true })
const emit = defineEmits<{
  actualSize: []; fit: []; zoomIn: []; zoomOut: []; fullscreen: []
}>()
const { t } = useI18n()
</script>

<template>
  <div class="pzv-controls" :class="[`pos-${position}`, { 'dir-vertical': direction === 'vertical' }]" @pointerdown.stop @mousedown.stop @mousemove.stop @wheel.stop>
    <slot />
    <button v-if="showActualSize" type="button" class="pzv-ctrl-btn" :title="t('common.zoom100')" :aria-label="t('common.zoom100')" @click="emit('actualSize')">1:1</button>
    <button type="button" class="pzv-ctrl-btn" :title="t('common.fitView')" :aria-label="t('common.fitView')" @click="emit('fit')"><SvgIcon name="fit-view" :size="12" /></button>
    <button type="button" class="pzv-ctrl-btn" :title="t('common.zoomIn')" :aria-label="t('common.zoomIn')" @click="emit('zoomIn')">+</button>
    <button type="button" class="pzv-ctrl-btn" :title="t('common.zoomOut')" :aria-label="t('common.zoomOut')" @click="emit('zoomOut')">−</button>
    <button v-if="fullscreenToggle" type="button" class="pzv-ctrl-btn" :title="t('common.fullscreen')" :aria-label="t('common.fullscreen')" @click="emit('fullscreen')"><SvgIcon name="maximize" :size="12" /></button>
    <slot name="extra" />
  </div>
</template>

<style scoped>
.pzv-controls{position:absolute;display:flex;gap:3px;padding:4px;background:rgba(30,30,30,.75);border-radius:6px;backdrop-filter:blur(6px);z-index:10;pointer-events:auto;cursor:default}
.pos-bottom-left{bottom:10px;left:10px}.pos-bottom-right{bottom:10px;right:10px}.pos-top-left{top:10px;left:10px}.pos-top-right{top:10px;right:10px}.dir-vertical{flex-direction:column}
.pzv-ctrl-btn{background:rgba(60,60,60,.6);color:#bbb;border:1px solid rgba(100,100,100,.4);border-radius:4px;padding:0;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;width:24px;height:22px;transition:all .15s}
.pzv-ctrl-btn:hover{background:rgba(80,80,80,.8);color:#fff;border-color:rgba(140,140,140,.5)}
.pzv-ctrl-btn:focus-visible{outline:2px solid #8ab4f8;outline-offset:1px}
</style>
