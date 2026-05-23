<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from './shared/i18n'
import SvgIcon from './shared/icons/SvgIcon.vue'
import SavePromptDialog from './shared/workspace/SavePromptDialog.vue'
import { useWorkspace } from './shared/workspace'
import { useStorageMode, useSyncStatus, clearCache } from './shared/storage'
import ConfirmDialog from './shared/components/ConfirmDialog.vue'
import AppToast from './shared/components/AppToast.vue'
import { registerToast } from './shared/components/toast'
import { registerConfirm } from './shared/components/confirm'

const router = useRouter()
const route = useRoute()
const { t, locale, setLocale, availableLocales } = useI18n()
const { isOpen: wsOpen, workspaceName, openWorkspace, closeWorkspace, tryRestoreWorkspace, reconnectWorkspace, hasSavedHandle } = useWorkspace()
const { storageMode } = useStorageMode()
const { status: syncStatus } = useSyncStatus()

const isDashboard = computed(() => route.path === '/')
const showSavePrompt = ref(false)
const wsDropdownOpen = ref(false)
const showClearCacheConfirm = ref(false)
const showDisconnectConfirm = ref(false)
const toastRef = ref<InstanceType<typeof AppToast> | null>(null)
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null)

const navItems = [
  { route: '/resource-manager', labelKey: 'nav.resourceManager', icon: 'folder-open' },
  { route: '/sprite-slicer', labelKey: 'nav.spriteSlicer', icon: 'scissors' },
  { route: '/map-editor', labelKey: 'nav.mapEditor', icon: 'map' },
]

const syncDotClass = computed(() => {
  switch (syncStatus.value) {
    case 'synced': return 'dot-synced'
    case 'syncing': return 'dot-syncing'
    case 'error': return 'dot-error'
    default: return 'dot-disconnected'
  }
})

onMounted(async () => {
  if (toastRef.value) registerToast(toastRef.value)
  if (confirmDialogRef.value) registerConfirm(confirmDialogRef.value)
  await tryRestoreWorkspace()
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
    if (storageMode.value === 'browser') {
      showSavePrompt.value = true
    }
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

function toggleDropdown() {
  wsDropdownOpen.value = !wsDropdownOpen.value
}

async function handleOpenWorkspace() {
  showSavePrompt.value = false
  wsDropdownOpen.value = false
  try {
    await openWorkspace()
  } catch {
    /* user cancelled */
  }
}

async function handleSwitchWorkspace() {
  wsDropdownOpen.value = false
  try {
    await openWorkspace()
  } catch {
    /* user cancelled */
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
  } catch {
    /* permission denied or user cancelled */
  }
}

function handleSaveBrowser() {
  showSavePrompt.value = false
}

function handleClearCacheRequest() {
  wsDropdownOpen.value = false
  showClearCacheConfirm.value = true
}

async function handleClearCacheConfirm() {
  showClearCacheConfirm.value = false
  await clearCache()
  window.location.reload()
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
              <span class="sync-dot" :class="syncDotClass" />
            </button>
          </template>
          <template v-else>
            <button class="storage-badge browser" @click="toggleDropdown">
              <SvgIcon name="globe" :size="12" />
              <span>{{ t('storage.browserMode') }}</span>
              <span class="warning-dot" />
            </button>
          </template>

          <div v-if="wsDropdownOpen" class="ws-dropdown">
            <template v-if="wsOpen">
              <div class="ws-dropdown-status">
                <span class="sync-dot" :class="syncDotClass" />
                <span>{{ t(`workspace.syncStatus.${syncStatus === 'disconnected' ? 'synced' : syncStatus}`) }}</span>
              </div>
              <button class="ws-dropdown-item" @click="handleSwitchWorkspace">
                <SvgIcon name="folder-open" :size="14" />
                {{ t('workspace.switchOther') }}
              </button>
              <div class="ws-dropdown-sep" />
              <button class="ws-dropdown-item danger" @click="handleDisconnectRequest">
                <SvgIcon name="close" :size="14" />
                {{ t('workspace.disconnect') }}
              </button>
              <button class="ws-dropdown-item danger" @click="handleClearCacheRequest">
                <SvgIcon name="trash" :size="14" />
                {{ t('storage.clearCache') }}
              </button>
            </template>
            <template v-else>
              <div class="ws-dropdown-hint">{{ t('workspace.browserHint') }}</div>
              <button v-if="hasSavedHandle()" class="ws-dropdown-item" @click="handleReconnect">
                <SvgIcon name="loop" :size="14" />
                {{ t('workspace.reconnect') }} ({{ workspaceName }})
              </button>
              <button class="ws-dropdown-item" @click="handleOpenWorkspace">
                <SvgIcon name="folder-open" :size="14" />
                {{ t('storage.openWorkspace') }}
              </button>
              <div class="ws-dropdown-sep" />
              <button class="ws-dropdown-item danger" @click="handleClearCacheRequest">
                <SvgIcon name="trash" :size="14" />
                {{ t('storage.clearCache') }}
              </button>
            </template>
          </div>
        </div>

        <button class="locale-btn" @click="toggleLocale" :title="t('common.language')">
          <SvgIcon name="globe" :size="14" />
          <span>{{ availableLocales.find(l => l.code === locale)?.label }}</span>
        </button>
      </div>
    </header>
    <main class="main-content">
      <router-view />
    </main>

    <SavePromptDialog
      :visible="showSavePrompt"
      @save-browser="handleSaveBrowser"
      @open-workspace="handleOpenWorkspace"
      @cancel="showSavePrompt = false"
    />

    <AppToast ref="toastRef" />

    <ConfirmDialog
      :visible="showDisconnectConfirm"
      :title="t('workspace.disconnectTitle')"
      :message="t('workspace.disconnectMsg')"
      :confirm-text="t('workspace.disconnect')"
      :cancel-text="t('common.cancel')"
      :danger="true"
      @confirm="handleDisconnectConfirm"
      @cancel="showDisconnectConfirm = false"
    />

    <ConfirmDialog
      :visible="showClearCacheConfirm"
      :title="t('storage.clearCacheTitle')"
      :message="t('storage.clearCacheMsg')"
      :confirm-text="t('storage.clearCache')"
      :cancel-text="t('common.cancel')"
      :danger="true"
      @confirm="handleClearCacheConfirm"
      @cancel="showClearCacheConfirm = false"
    />

    <ConfirmDialog ref="confirmDialogRef" />
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
.storage-badge.browser {
  background: #3a3020;
  border-color: #5a4a2a;
  color: #c9a84c;
}
.storage-badge.browser:hover {
  border-color: #8a7a3a;
  color: #e0c060;
}
.sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-synced { background: #5a9; }
.dot-syncing { background: #5a9; animation: pulse-dot 1s ease-in-out infinite; }
.dot-error { background: #e55; }
.dot-disconnected { background: #888; }
.warning-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e8a030;
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
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
