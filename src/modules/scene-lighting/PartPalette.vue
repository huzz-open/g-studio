<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import type { PartAsset } from '../../shared/parts/schema'
import { partImageUrl } from '../../shared/parts/images'
import { useI18n } from '../../shared/i18n'
defineProps<{ parts: PartAsset[]; selected: string[] }>()
const emit = defineEmits<{ select: [id: string]; edit: [id: string]; add: [part: PartAsset]; drop: [part: PartAsset, x: number, y: number] }>()
const { t } = useI18n()
const ghost = ref<{ part: PartAsset; x: number; y: number }>()
let pending: { part: PartAsset; x: number; y: number; pointer: number } | undefined
function start(e: PointerEvent, part: PartAsset) {
  if(e.button!==0)return
  e.preventDefault();pending={part,x:e.clientX,y:e.clientY,pointer:e.pointerId}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel)
}
function move(e: PointerEvent) {
  if(!pending||e.pointerId!==pending.pointer)return
  if(ghost.value||Math.hypot(e.clientX-pending.x,e.clientY-pending.y)>6)ghost.value={part:pending.part,x:e.clientX,y:e.clientY}
}
function cancel(){pending=undefined;ghost.value=undefined;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel)}
function end(e: PointerEvent){if(!pending||e.pointerId!==pending.pointer)return;const part=pending.part,drag=!!ghost.value;cancel();if(drag)emit('drop',part,e.clientX,e.clientY);else emit('select',part.id)}
onUnmounted(cancel)
</script>
<template>
  <div class="part-grid">
    <div v-for="part in parts" :key="part.id" class="part-tile" :class="{selected:selected.includes(part.id)}" :data-asset-id="part.id">
      <button class="thumbnail" :aria-label="t('parts.selectAsset',{name:part.name})" :aria-pressed="selected.includes(part.id)" :title="part.name" @pointerdown="start($event,part)" @click="$event.detail===0 && emit('select',part.id)"><img :src="partImageUrl(part)" alt="" draggable="false"/></button>
      <span v-if="selected.includes(part.id)" class="check" aria-hidden="true">✓</span>
      <div class="tile-menu"><span>{{part.name}}</span><div><button :aria-label="t('parts.addNamed',{name:part.name})" @click="emit('add',part)">{{t('parts.addShort')}}</button><button :aria-label="t('parts.editNamed',{name:part.name})" @click="emit('edit',part.id)">{{t('parts.editShort')}}</button></div></div>
    </div>
  </div>
  <Teleport to="body"><div v-if="ghost" class="part-drag-ghost" :style="{left:ghost.x+'px',top:ghost.y+'px'}"><img :src="partImageUrl(ghost.part)" alt=""/><span>{{ghost.part.name}}</span></div></Teleport>
</template>
<style scoped>
.part-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:7px;padding:3px 9px 3px 0}.part-tile{position:relative;aspect-ratio:1;border:1px solid #393d3a;border-radius:6px;background:#282b29;overflow:hidden}.part-tile.selected{border-color:#95b7a0;background:#35463c}.thumbnail{display:block;width:100%;height:100%;padding:9px;border:0;background:none;cursor:grab;touch-action:none}.thumbnail img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;pointer-events:none}.check{position:absolute;top:3px;right:5px;font-size:11px;color:#d6efd9;pointer-events:none}.tile-menu{position:absolute;bottom:0;left:0;right:0;background:#171c19ed;padding:4px;opacity:0;visibility:hidden;transition:opacity .12s;font-size:10px;text-align:center;pointer-events:none}.part-tile:hover .tile-menu,.part-tile:focus-within .tile-menu{opacity:1;visibility:visible}.tile-menu>span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-bottom:3px}.tile-menu>div{display:flex;gap:4px}.tile-menu button{pointer-events:auto;flex:1;background:#37453c;border:0;color:#dce6df;border-radius:3px;font:inherit;cursor:pointer;padding:3px 1px}.part-drag-ghost{position:fixed;transform:translate(-50%,-70%);z-index:10000;pointer-events:none;width:76px;padding:6px;background:#24352ddb;border:1px solid #9bbaa5;border-radius:6px;color:#eee;text-align:center;font-size:11px}.part-drag-ghost img{width:64px;height:64px;object-fit:contain;image-rendering:pixelated}
</style>
