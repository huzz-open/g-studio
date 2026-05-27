<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { MapEditorInstance } from '../store'
import type { MapLocation } from '../types'

const props = defineProps<{ store: MapEditorInstance }>()
const { t } = useI18n()
const iconInput = ref<HTMLInputElement>()

const state = toRef(props.store, 'state')

const selectedLocation = computed<MapLocation | null>(() => {
  const s = state.value
  if (!s.mapData || s.selectedLocationId === null) return null
  return s.mapData.locations.find(l => l.id === s.selectedLocationId) ?? null
})

const libraryIcons = computed(() =>
  [...state.value.iconLibrary.entries()].map(([name, dataUrl]) => ({ name, dataUrl })),
)

const currentIconUrl = computed(() => {
  if (!selectedLocation.value) return null
  return state.value.iconImages.get(selectedLocation.value.id) ?? null
})

function onIconUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !selectedLocation.value) return
  const reader = new FileReader()
  reader.onload = () => props.store.updateLocationIcon(selectedLocation.value!.id, reader.result as string)
  reader.readAsDataURL(file)
}

function pickLibraryIcon(iconName: string) {
  if (!selectedLocation.value) return
  props.store.assignLibraryIcon(selectedLocation.value.id, iconName)
}

function onPositionChange(axis: 'x' | 'y', val: string) {
  if (!selectedLocation.value) return
  const num = parseInt(val)
  if (isNaN(num)) return
  const loc = selectedLocation.value
  props.store.updateLocationPosition(loc.id, axis === 'x' ? num : (loc.position.x ?? 0), axis === 'y' ? num : (loc.position.y ?? 0))
}

function beginTransaction() { props.store.beginEditTransaction() }
function endTransaction() { props.store.endEditTransaction() }
</script>

<template>
  <div class="property-panel">
    <template v-if="selectedLocation">
      <div class="section">
        <h4>{{ selectedLocation.name }}</h4>
        <div class="meta-row"><span>{{ t('mapEditor.property.level') }}</span><span>{{ selectedLocation.level }}</span></div>
        <div class="meta-row"><span>{{ t('mapEditor.property.region') }}</span><span>{{ selectedLocation.region }}</span></div>
        <div class="meta-row"><span>{{ t('mapEditor.property.iconSize') }}</span><span>{{ selectedLocation.iconSize.w }}×{{ selectedLocation.iconSize.h }}</span></div>
        <div class="meta-row"><span>{{ t('mapEditor.property.displayName') }}</span><span class="small">{{ selectedLocation.displayName }}</span></div>
      </div>
      <div class="section">
        <h4>{{ t('mapEditor.property.coords') }}</h4>
        <div class="coord-row">
          <label>X</label>
          <input type="number" :value="selectedLocation.position.x ?? ''"
            @focus="beginTransaction" @blur="endTransaction"
            @input="onPositionChange('x', ($event.target as HTMLInputElement).value)" min="0" max="1280" />
          <label>Y</label>
          <input type="number" :value="selectedLocation.position.y ?? ''"
            @focus="beginTransaction" @blur="endTransaction"
            @input="onPositionChange('y', ($event.target as HTMLInputElement).value)" min="0" max="960" />
        </div>
      </div>
      <div class="section icon-section">
        <h4>
          {{ t('mapEditor.property.icon') }}
          <button class="btn-upload" @click="iconInput?.click()">
            <SvgIcon name="upload" :size="10" />
            {{ t('mapEditor.property.iconUpload') }}
          </button>
        </h4>
        <div class="current-icon" v-if="currentIconUrl">
          <img :src="currentIconUrl" class="icon-thumb-lg" />
          <span class="icon-path" v-if="selectedLocation.iconPath">{{ selectedLocation.iconPath }}</span>
        </div>
        <input ref="iconInput" type="file" accept="image/*" style="display:none" @change="onIconUpload" />
        <div v-if="libraryIcons.length > 0" class="lib-grid">
          <div v-for="icon in libraryIcons" :key="icon.name"
            class="lib-item" :class="{ active: selectedLocation.iconPath === `icons/${icon.name}.png` }"
            @click="pickLibraryIcon(icon.name)" :title="icon.name">
            <img :src="icon.dataUrl" :alt="icon.name" />
            <span class="lib-name">{{ icon.name }}</span>
          </div>
        </div>
        <p v-else class="hint">{{ t('mapEditor.property.iconLibEmpty') }}</p>
      </div>
    </template>
    <div v-else class="empty">
      <p>{{ t('mapEditor.empty.select') }}</p>
      <p class="hint">{{ t('mapEditor.empty.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.property-panel { overflow-y: auto; padding: 12px; height: 100%; }
.section { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #333; }
.section h4 { margin: 0 0 8px; font-size: 13px; color: #eee; display: flex; align-items: center; justify-content: space-between; }
.meta-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
.meta-row span:first-child { color: #888; }
.meta-row span:last-child { color: #ccc; }
.meta-row .small { font-size: 11px; max-width: 140px; text-align: right; }
.coord-row { display: flex; align-items: center; gap: 6px; }
.coord-row label { font-size: 12px; color: #888; width: 14px; }
.coord-row input { flex: 1; background: #333; color: #eee; border: 1px solid #555; padding: 4px 6px; border-radius: 4px; font-size: 12px; width: 60px; }
.icon-section { border-bottom: none; }
.btn-upload { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: #3a5a8a; color: #ccc; border: none; border-radius: 3px; cursor: pointer; font-size: 10px; }
.btn-upload:hover { background: #4a6a9a; color: #fff; }
.current-icon { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px; background: #1e1e1e; border-radius: 4px; }
.icon-thumb-lg { width: 48px; height: 48px; object-fit: contain; image-rendering: pixelated; flex-shrink: 0; }
.icon-path { font-size: 9px; color: #6a9a6a; word-break: break-all; line-height: 1.3; }
.lib-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; max-height: 400px; overflow-y: auto; }
.lib-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; padding: 4px 2px 2px; border: 2px solid transparent; border-radius: 4px; transition: border-color 0.12s; }
.lib-item:hover { border-color: #5577aa; background: rgba(85,119,170,0.1); }
.lib-item.active { border-color: #4a8a4a; background: rgba(74,138,74,0.12); }
.lib-item img { width: 100%; aspect-ratio: 1; object-fit: contain; image-rendering: pixelated; }
.lib-name { font-size: 8px; color: #777; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; margin-top: 2px; }
.hint { font-size: 10px; color: #555; margin-top: 4px; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666; text-align: center; }
.empty p { margin: 4px 0; font-size: 13px; }
</style>
