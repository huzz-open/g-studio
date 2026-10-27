<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import SvgIcon from '../../shared/icons/SvgIcon.vue'
import type { PartAsset } from '../../shared/parts/schema'
import { partImageUrl } from '../../shared/parts/images'
import { useI18n } from '../../shared/i18n'
defineProps<{ parts: PartAsset[]; disabled?: boolean; generatingIds?: Set<string> }>()
const emit = defineEmits<{ import: []; edit: [id: string]; add: [part: PartAsset]; generate: [part: PartAsset]; drop: [part: PartAsset, x: number, y: number] }>()
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
function end(e: PointerEvent){if(!pending||e.pointerId!==pending.pointer)return;const part=pending.part,drag=!!ghost.value;cancel();if(drag)emit('drop',part,e.clientX,e.clientY)}
onUnmounted(cancel)
</script>
<template>
  <div class="part-grid">
    <div v-for="part in parts" :key="part.id" class="part-tile" :class="{ 'is-submitting': generatingIds?.has(part.id) }" :data-asset-id="part.id">
      <button class="thumbnail" :aria-label="t('parts.dragNamed',{name:part.name})" :title="part.name+' · '+t('parts.dragHint')" @pointerdown="start($event,part)" @click="$event.detail===0 && emit('add',part)" @dblclick="emit('edit',part.id)"><img :src="partImageUrl(part)" alt="" draggable="false"/></button>
      <div class="tile-menu"><span>{{part.name}}</span><div class="tile-actions" @pointerdown.stop @dblclick.stop>
        <button :aria-label="t('parts.addNamed',{name:part.name})" :title="t('parts.addOne') + ' · ' + t('parts.dragHint')" :disabled="disabled" @click.stop="emit('add',part)"><SvgIcon name="plus" :size="16" aria-hidden="true" /></button>
        <button :aria-label="t('parts.editNamed',{name:part.name})" :title="t('parts.edit')" @click.stop="emit('edit',part.id)"><SvgIcon name="edit" :size="16" aria-hidden="true" /></button>
        <button :aria-label="t('parts.generateNamed',{name:part.name})" :title="t(generatingIds?.has(part.id) ? 'generation.submitting' : 'generation.generate')" :disabled="disabled || generatingIds?.has(part.id)" :aria-busy="generatingIds?.has(part.id) || false" @click.stop="emit('generate',part)">
          <svg v-if="generatingIds?.has(part.id)" class="model-submitting" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path opacity=".3" d="M9 6 2 10v8l7 4 7-4v-8z M2 10l7 4 7-4 M9 14v8" />
            <path class="model-build" d="M9 6 2 10v8l7 4 7-4v-8z M2 10l7 4 7-4 M9 14v8" />
            <path class="model-sparkle" d="m19 2 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
          </svg>
          <SvgIcon v-else name="model-generate" :size="16" aria-hidden="true" />
        </button>
      </div></div>
    </div>
    <button class="part-tile import-tile" :disabled="disabled" :aria-label="t('parts.import')" :title="t('parts.import')" @click="emit('import')"><SvgIcon name="plus" :size="30"/></button>
  </div>
  <Teleport to="body"><div v-if="ghost" class="part-drag-ghost" :style="{left:ghost.x+'px',top:ghost.y+'px'}"><img :src="partImageUrl(ghost.part)" alt=""/><span>{{ghost.part.name}}</span></div></Teleport>
</template>
<style scoped>
.part-tile.is-submitting .tile-menu { opacity:1; visibility:visible; }
.tile-menu .tile-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; width:100%; max-width:80px; margin-inline:auto; }
.tile-menu .tile-actions button { display:flex; align-items:center; justify-content:center; min-width:0; min-height:0; width:100%; aspect-ratio:1; padding:0; box-sizing:border-box; }
.tile-menu > span { line-height:20px; text-align:center; font-size:11px; }
.tile-actions button:hover:not(:disabled) { background:#50695a; color:#fff; }
.tile-actions button:focus-visible { outline:2px solid #9bc9ff; outline-offset:-2px; }
.tile-actions button:disabled { opacity:.45; cursor:default; }
.tile-actions button[aria-busy="true"] { opacity:1; color:#c5e5ff; background:#35556b; }
.model-build { stroke-dasharray:28 64; animation:model-build 1.4s linear infinite; }
.model-sparkle { transform-origin:19px 6px; animation:model-sparkle .7s ease-in-out infinite alternate; }
@keyframes model-build { from { stroke-dashoffset:92; } to { stroke-dashoffset:0; } }
@keyframes model-sparkle { from { opacity:.45; transform:scale(.7); } to { opacity:1; transform:scale(1); } }
@media(prefers-reduced-motion:reduce) { .model-build,.model-sparkle { animation:none; }.model-build { stroke-dasharray:none; } }
.part-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:7px;padding:3px 9px 3px 0}.part-tile{position:relative;aspect-ratio:1;border:1px solid #393d3a;border-radius:6px;background:#282b29;overflow:hidden}.import-tile{display:grid;place-items:center;border-style:dashed;cursor:pointer;color:#9eafa5}.import-tile:hover{background:#35463c;color:#e4eee7}.tile-menu small{display:block;font-size:9px;margin-bottom:3px;color:#abbcb1}.thumbnail{display:block;width:100%;height:100%;padding:9px;border:0;background:none;cursor:grab;touch-action:none}.thumbnail img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;pointer-events:none}.check{position:absolute;top:3px;right:5px;font-size:11px;color:#d6efd9;pointer-events:none}.tile-menu{position:absolute;bottom:0;left:0;right:0;background:#171c19ed;padding:4px;opacity:0;visibility:hidden;transition:opacity .12s;font-size:10px;text-align:center;pointer-events:none}.part-tile:hover .tile-menu,.part-tile:focus-within .tile-menu{opacity:1;visibility:visible}.tile-menu>span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-bottom:3px}.tile-menu>div{display:flex;gap:4px}.tile-menu button{pointer-events:auto;flex:1;background:#37453c;border:0;color:#dce6df;border-radius:3px;font:inherit;cursor:pointer;padding:3px 1px}.part-drag-ghost{position:fixed;transform:translate(-50%,-70%);z-index:10000;pointer-events:none;width:76px;padding:6px;background:#24352ddb;border:1px solid #9bbaa5;border-radius:6px;color:#eee;text-align:center;font-size:11px}.part-drag-ghost img{width:64px;height:64px;object-fit:contain;image-rendering:pixelated}
</style>
