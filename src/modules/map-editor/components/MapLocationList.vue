<script setup lang="ts">
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import { state, selectLocation, groupedLocations, stats } from '../store'
import { getLocationStatus, REALM_ORDER } from '../types'

const { t } = useI18n()

const statusIcons: Record<string, string> = {
  placed: 'check',
  positioned: 'location',
  pending: 'minus',
}
</script>

<template>
  <div class="location-list">
    <div class="list-header">
      <h3>{{ t('mapEditor.locations') }}</h3>
      <div class="stats">{{ t('mapEditor.locations.placed', { placed: stats.placed, total: stats.total }) }}</div>
    </div>
    <div class="filter-row">
      <select v-model="state.realmFilter">
        <option :value="null">{{ t('mapEditor.locations.all') }}</option>
        <option v-for="r in REALM_ORDER" :key="r" :value="r">{{ t(`mapEditor.realm.${r}`) }}</option>
      </select>
    </div>
    <div class="list-body">
      <template v-for="realm in REALM_ORDER" :key="realm">
        <div v-if="groupedLocations[realm]?.length && (!state.realmFilter || state.realmFilter === realm)" class="realm-group">
          <div class="realm-header">{{ t(`mapEditor.realm.${realm}`) }}</div>
          <div
            v-for="loc in groupedLocations[realm]" :key="loc.id"
            class="loc-item" :class="{ selected: loc.id === state.selectedLocationId }"
            @click="selectLocation(loc.id)"
          >
            <SvgIcon :name="statusIcons[getLocationStatus(loc)]" :size="10" />
            <span class="loc-name">{{ loc.name }}</span>
            <span class="loc-level">{{ loc.level }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.location-list { width: 220px; display: flex; flex-direction: column; background: #252525; border-right: 1px solid #3a3a3a; overflow: hidden; }
.list-header { padding: 12px; border-bottom: 1px solid #3a3a3a; }
.list-header h3 { margin: 0 0 4px; font-size: 14px; color: #eee; }
.stats { font-size: 11px; color: #aaa; }
.filter-row { padding: 8px 12px; border-bottom: 1px solid #333; }
.filter-row select { width: 100%; background: #333; color: #eee; border: 1px solid #555; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
.list-body { flex: 1; overflow-y: auto; padding: 4px 0; }
.realm-group { margin-bottom: 4px; }
.realm-header { padding: 6px 12px; font-size: 11px; font-weight: bold; color: #8af; text-transform: uppercase; letter-spacing: 1px; background: #1e1e2e; }
.loc-item { display: flex; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; color: #ccc; transition: background 0.1s; }
.loc-item:hover { background: #333; }
.loc-item.selected { background: #3a3a5a; color: #fff; }
.loc-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loc-level { font-size: 10px; color: #888; flex-shrink: 0; }
</style>
