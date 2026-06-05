<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from './shared/i18n'
import SvgIcon from './shared/icons/SvgIcon.vue'
import { useWorkspace } from './shared/workspace'
import type { SavedWorkspace } from './shared/workspace'
import ConfirmDialog from './shared/components/ConfirmDialog.vue'
import PromptDialog from './shared/components/PromptDialog.vue'
import SettingsDialog from './shared/components/SettingsDialog.vue'
import AppToast from './shared/components/AppToast.vue'
import { registerToast, showToast } from './shared/components/toast'
import { registerConfirm } from './shared/components/confirm'
import { registerPrompt } from './shared/components/prompt'
import { loadSettings } from './shared/settings'

const router = useRouter()
const route = useRoute()
const { t, locale, setLocale, availableLocales } = useI18n()
const { isOpen: wsOpen, workspaceName, openWorkspace, closeWorkspace, tryRestoreWorkspace, reconnectWorkspace, hasSavedHandle, listSavedWorkspaces, removeSavedWorkspace } = useWorkspace()

const recentWorkspaces = ref<SavedWorkspace[]>([])

const isDashboard = computed(() => route.path === '/')
const wsDropdownOpen = ref(false)
const showDisconnectConfirm = ref(false)
const appReady = ref(false)
const showSettings = ref(false)
const toastRef = ref<InstanceType<typeof AppToast> | null>(null)
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null)
const promptDialogRef = ref<InstanceType<typeof PromptDialog> | null>(null)

const navItems = [
  { route: '/resource-manager', labelKey: 'nav.resourceManager', icon: 'folder-open' },
  { route: '/sprite-slicer', labelKey: 'nav.spriteSlicer', icon: 'scissors' },
  { route: '/tileset-maker', labelKey: 'nav.tilesetMaker', icon: 'grid' },
  { route: '/scene-region-editor', labelKey: 'nav.sceneRegionEditor', icon: 'layers' },
]

onMounted(async () => {
  if (toastRef.value) registerToast(toastRef.value)
  if (confirmDialogRef.value) registerConfirm(confirmDialogRef.value)
  if (promptDialogRef.value) registerPrompt(promptDialogRef.value)
  await tryRestoreWorkspace()
  await loadSettings()
  appReady.value = true
  document.addEventListener('keydown', handleGlobalKeydown)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
  document.removeEventListener('click', handleClickOutside)
})

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
  }
}

function handleClickOutside(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest('.ws-dropdown-wrapper')
  if (!el) wsDropdownOpen.value = false
}

function toggleLocale() {
  const next = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  setLocale(next)
}

async function toggleDropdown() {
  wsDropdownOpen.value = !wsDropdownOpen.value
  if (wsDropdownOpen.value) {
    recentWorkspaces.value = await listSavedWorkspaces()
  }
}

async function handleOpenWorkspace() {
  wsDropdownOpen.value = false
  try {
    const ok = await openWorkspace()
    if (ok) await loadSettings()
  } catch (e: any) {
    console.error('[App] openWorkspace failed:', e)
    showToast(String(e?.message || e), 'error')
  }
}

async function handleSwitchWorkspace() {
  wsDropdownOpen.value = false
  try {
    const ok = await openWorkspace()
    if (ok) await loadSettings()
  } catch (e: any) {
    console.error('[App] switchWorkspace failed:', e)
    showToast(String(e?.message || e), 'error')
  }
}

function handleDisconnectRequest() {
  wsDropdownOpen.value = false
  showDisconnectConfirm.value = true
}

async function handleDisconnectConfirm() {
  showDisconnectConfirm.value = false
  await closeWorkspace()
}

async function handleReconnect() {
  wsDropdownOpen.value = false
  try {
    await reconnectWorkspace()
    await loadSettings()
  } catch (e: any) {
    console.error('[App] reconnect failed:', e)
    showToast(String(e?.message || e), 'error')
  }
}

async function handleSwitchToRecent(ws: SavedWorkspace) {
  wsDropdownOpen.value = false
  try {
    const ok = await openWorkspace(ws.handle)
    if (ok) await loadSettings()
  } catch (e: any) {
    console.error('[App] switchToRecent failed:', e)
    showToast(String(e?.message || e), 'error')
  }
}

async function handleRemoveRecent(e: Event, ws: SavedWorkspace) {
  e.stopPropagation()
  await removeSavedWorkspace(ws.name)
  recentWorkspaces.value = recentWorkspaces.value.filter((w) => w.name !== ws.name)
}

</script>

<template>
  <div class="app" @contextmenu.prevent>
    <header class="top-bar">
      <div class="top-left">
        <button class="brand" @click="router.push('/')">
          <SvgIcon name="layers" :size="20" />
          <span>G-Studio</span>
        </button>
        <template v-if="!isDashboard">
          <span class="breadcrumb-sep">/</span>
          <nav class="nav-links">
            <router-link
              v-for="item in navItems"
              :key="item.route"
              :to="item.route"
              class="nav-link"
              active-class="active"
            >
              <SvgIcon :name="item.icon" :size="14" />
              <span>{{ t(item.labelKey) }}</span>
            </router-link>
          </nav>
        </template>
      </div>
      <div class="top-right">
        <!-- Workspace dropdown -->
        <div class="ws-dropdown-wrapper">
          <template v-if="wsOpen">
            <button class="storage-badge workspace" @click="toggleDropdown">
              <SvgIcon name="folder-open" :size="12" />
              <span>{{ workspaceName }}</span>
            </button>
          </template>
          <template v-else>
            <button class="storage-badge no-workspace" @click="toggleDropdown">
              <SvgIcon name="globe" :size="12" />
              <span>{{ t('workspace.lightweight') }}</span>
            </button>
          </template>

          <div v-if="wsDropdownOpen" class="ws-dropdown">
            <template v-if="wsOpen">
              <button class="ws-dropdown-item" @click="handleSwitchWorkspace">
                <SvgIcon name="folder-open" :size="14" />
                {{ t('workspace.switchOther') }}
              </button>
              <template v-if="recentWorkspaces.length > 1">
                <div class="ws-dropdown-sep" />
                <div class="ws-dropdown-hint">{{ t('workspace.recentList') }}</div>
                <template v-for="ws in recentWorkspaces" :key="ws.name">
                  <div
                    v-if="ws.name !== workspaceName"
                    class="ws-dropdown-item ws-recent-item"
                    @click="handleSwitchToRecent(ws)"
                  >
                    <SvgIcon name="folder-open" :size="14" />
                    <span class="ws-recent-name">{{ ws.name }}</span>
                    <span
                      class="ws-recent-remove"
                      role="button"
                      :title="t('workspace.removeFromList')"
                      @click="handleRemoveRecent($event, ws)"
                    >
                      <SvgIcon name="close" :size="10" />
                    </span>
                  </div>
                </template>
              </template>
              <div class="ws-dropdown-sep" />
              <button class="ws-dropdown-item danger" @click="handleDisconnectRequest">
                <SvgIcon name="close" :size="14" />
                {{ t('workspace.close') }}
              </button>
            </template>
            <template v-else>
              <div class="ws-dropdown-hint">{{ t('workspace.lightweightHint') }}</div>
              <button v-if="hasSavedHandle()" class="ws-dropdown-item" @click="handleReconnect">
                <SvgIcon name="loop" :size="14" />
                {{ t('workspace.reconnect') }} ({{ workspaceName }})
              </button>
              <template v-if="recentWorkspaces.length > 0">
                <div class="ws-dropdown-sep" />
                <div class="ws-dropdown-hint">{{ t('workspace.recentList') }}</div>
                <div
                  v-for="ws in recentWorkspaces"
                  :key="ws.name"
                  class="ws-dropdown-item ws-recent-item"
                  @click="handleSwitchToRecent(ws)"
                >
                  <SvgIcon name="folder-open" :size="14" />
                  <span class="ws-recent-name">{{ ws.name }}</span>
                  <span
                    class="ws-recent-remove"
                    role="button"
                    :title="t('workspace.removeFromList')"
                    @click="handleRemoveRecent($event, ws)"
                  >
                    <SvgIcon name="close" :size="10" />
                  </span>
                </div>
              </template>
              <button class="ws-dropdown-item" @click="handleOpenWorkspace">
                <SvgIcon name="folder-open" :size="14" />
                {{ t('storage.openWorkspace') }}
              </button>
            </template>
          </div>
        </div>

        <button class="top-btn" @click="showSettings = true" :title="t('settings.title')">
          <SvgIcon name="settings" :size="14" />
        </button>

        <button class="locale-btn" @click="toggleLocale" :title="t('common.language')">
          <SvgIcon name="globe" :size="14" />
          <span>{{ availableLocales.find(l => l.code === locale)?.label }}</span>
        </button>
      </div>
    </header>
    <main class="main-content">
      <router-view v-if="appReady" />
    </main>

    <AppToast ref="toastRef" />

    <ConfirmDialog
      :visible="showDisconnectConfirm"
      :title="t('workspace.closeTitle')"
      :message="t('workspace.closeMsg')"
      :confirm-text="t('workspace.close')"
      :cancel-text="t('common.cancel')"
      :danger="true"
      @confirm="handleDisconnectConfirm"
      @cancel="showDisconnectConfirm = false"
    />

    <ConfirmDialog ref="confirmDialogRef" />
    <PromptDialog ref="promptDialogRef" />

    <SettingsDialog :visible="showSettings" @close="showSettings = false" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1e1e1e;
  color: #ddd;
}
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  height: 44px;
  background: #252525;
  border-bottom: 1px solid #3a3a3a;
  flex-shrink: 0;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: #eee;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}
.brand:hover {
  background: #333;
}
.breadcrumb-sep {
  color: #555;
  font-size: 14px;
}
.nav-links {
  display: flex;
  gap: 2px;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: #999;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.nav-link:hover {
  background: #333;
  color: #ccc;
}
.nav-link.active {
  background: #3a3a3a;
  color: #eee;
}
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}
.ws-dropdown-wrapper {
  position: relative;
}
.storage-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
  border: 1px solid;
}
.storage-badge.workspace {
  background: #2a3a30;
  border-color: #3a5a45;
  color: #8ab;
}
.storage-badge.workspace:hover {
  border-color: #5a9a6a;
  color: #acd;
}
.storage-badge.no-workspace {
  background: #333;
  border-color: #555;
  color: #aaa;
}
.storage-badge.no-workspace:hover {
  border-color: #777;
  color: #ccc;
}
.ws-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #2e2e2e;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 6px 0;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 200;
}
.ws-dropdown-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 11px;
  color: #999;
  border-bottom: 1px solid #3a3a3a;
  margin-bottom: 4px;
}
.ws-dropdown-hint {
  padding: 6px 14px;
  font-size: 11px;
  color: #888;
  border-bottom: 1px solid #3a3a3a;
  margin-bottom: 4px;
}
.ws-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 14px;
  background: none;
  border: none;
  color: #ccc;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}
.ws-dropdown-item:hover {
  background: #383838;
  color: #eee;
}
.ws-dropdown-item.danger {
  color: #e08080;
}
.ws-dropdown-item.danger:hover {
  background: #3a2828;
  color: #f0a0a0;
}
.ws-dropdown-sep {
  height: 1px;
  background: #3a3a3a;
  margin: 4px 0;
}
.ws-recent-item {
  position: relative;
}
.ws-recent-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-recent-remove {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  flex-shrink: 0;
}
.ws-recent-remove:hover {
  color: #e08080;
  background: #3a2828;
}
.ws-recent-item:hover .ws-recent-remove {
  display: flex;
}
.top-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid #444;
  color: #999;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.top-btn:hover {
  border-color: #666;
  color: #ddd;
}
.locale-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid #444;
  color: #aaa;
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.15s, color 0.15s;
}
.locale-btn:hover {
  border-color: #666;
  color: #ddd;
}
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
