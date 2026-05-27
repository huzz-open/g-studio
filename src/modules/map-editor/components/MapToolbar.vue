<script setup lang="ts">
import { ref, computed, toRef, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { MapEditorInstance } from '../store'
import type { WorldMapData } from '../types'

const props = defineProps<{ store: MapEditorInstance }>()
const { t } = useI18n()

const jsonInput = ref<HTMLInputElement>()
const baseMapInput = ref<HTMLInputElement>()
const state = toRef(props.store, 'state')
const canUndo = computed(() => props.store.undoStack.value.length > 0)
const canRedo = computed(() => props.store.redoStack.value.length > 0)

function onImportJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as WorldMapData
      void props.store.loadMapData(data)
    } catch (err) {
      alert('JSON parse failed: ' + (err as Error).message)
    }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}

function onLoadBaseMap(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  state.value.baseMapUrl = URL.createObjectURL(file)
  ;(e.target as HTMLInputElement).value = ''
}

function exportJson() {
  const json = JSON.stringify(state.value.mapData, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'world-map-data.json'
  a.click()
  URL.revokeObjectURL(url)
}

function doUndo() { props.store.undo() }
function doRedo() { props.store.redo() }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function onKeyDown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return
  if (isTypingTarget(e.target)) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo() }
  else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <button @click="jsonInput?.click()">
        <SvgIcon name="folder-open" :size="14" />
        {{ t('mapEditor.importJson') }}
      </button>
      <button @click="baseMapInput?.click()">
        <SvgIcon name="image" :size="14" />
        {{ t('mapEditor.loadBaseMap') }}
      </button>
      <span class="separator" />
      <button @click="doUndo" :disabled="!canUndo">
        <SvgIcon name="undo" :size="14" />
        {{ t('mapEditor.undo') }}
      </button>
      <button @click="doRedo" :disabled="!canRedo">
        <SvgIcon name="redo" :size="14" />
        {{ t('mapEditor.redo') }}
      </button>
      <span class="separator" />
      <button @click="exportJson" :disabled="!state.mapData">
        <SvgIcon name="download" :size="14" />
        {{ t('mapEditor.exportJson') }}
      </button>
    </div>
    <div class="toolbar-right">
      <label><input type="checkbox" v-model="state.showRegions" /> {{ t('mapEditor.layers.regions') }}</label>
      <label><input type="checkbox" v-model="state.showWater" /> {{ t('mapEditor.layers.water') }}</label>
      <label><input type="checkbox" v-model="state.showRoads" /> {{ t('mapEditor.layers.roads') }}</label>
      <label><input type="checkbox" v-model="state.showLabels" /> {{ t('mapEditor.layers.labels') }}</label>
      <label><input type="checkbox" v-model="state.showNumbers" /> {{ t('mapEditor.layers.numbers') }}</label>
      <label><input type="checkbox" v-model="state.showGrid" /> {{ t('mapEditor.layers.grid') }}</label>
    </div>
    <input ref="jsonInput" type="file" accept=".json" style="display:none" @change="onImportJson" />
    <input ref="baseMapInput" type="file" accept="image/*" style="display:none" @change="onLoadBaseMap" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
  gap: 8px;
  flex-shrink: 0;
}
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 6px; }
button {
  display: flex; align-items: center; gap: 5px;
  background: #3a3a4a; color: #ddd; border: 1px solid #555;
  padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;
}
button:hover:not(:disabled) { background: #4a4a5a; }
button:disabled { opacity: 0.4; cursor: default; }
label { display: flex; align-items: center; gap: 3px; font-size: 11px; color: #aaa; cursor: pointer; }
label input[type="checkbox"] { accent-color: #5577aa; }
.separator { width: 1px; height: 20px; background: #444; margin: 0 4px; }
</style>
