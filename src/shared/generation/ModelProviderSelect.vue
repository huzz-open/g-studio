<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import type { Provider } from '../../../packages/generation-protocol/types'
import { useI18n } from '../i18n'
import { providerIsEnabled } from './connection'

const props = defineProps<{ id: string; modelValue: string; providers: Provider[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>()
const { t } = useI18n()
const listId = useId(), trigger = ref<HTMLButtonElement>(), popup = ref<HTMLElement>()
const open = ref(false), active = ref(-1), position = ref({ left: '0px', top: '0px', width: '0px' })
const selected = computed(() => props.providers.find(p => p.providerId === props.modelValue && providerIsEnabled(p)))
const enabledIndices = computed(() => props.providers.flatMap((p, i) => providerIsEnabled(p) ? [i] : []))
function close(focus = false) {
  open.value = false
  if (focus) trigger.value?.focus()
}
async function show(last = false) {
  if (props.disabled) return
  const rect = trigger.value!.getBoundingClientRect()
  const height = Math.min(props.providers.length * 44 + 8, 240)
  position.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
    top: `${rect.bottom + height + 6 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`, width: `${rect.width}px` }
  const current = props.providers.findIndex(p => p.providerId === props.modelValue && providerIsEnabled(p))
  active.value = current >= 0 ? current : (last ? enabledIndices.value.at(-1) : enabledIndices.value[0]) ?? -1
  open.value = true
  await nextTick()
  popup.value?.focus()
}
function choose(index: number) {
  if (props.disabled) return
  const provider = props.providers[index]
  if (!provider || !providerIsEnabled(provider)) return
  if (provider.providerId !== props.modelValue) {
    emit('update:modelValue', provider.providerId)
    emit('change')
  }
  close(true)
}
function navigate(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (event.key === 'Tab') { close(true); return }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active.value); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const indices = enabledIndices.value
  if (!indices.length) return
  const current = indices.indexOf(active.value)
  active.value = event.key === 'Home' ? indices[0]!
    : event.key === 'End' ? indices.at(-1)!
    : indices[(current + (event.key === 'ArrowDown' ? 1 : -1) + indices.length) % indices.length]!
  void nextTick(() => document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' }))
}
function outside(event: Event) {
  if (!trigger.value?.contains(event.target as Node) && !popup.value?.contains(event.target as Node)) close()
}
function resize() { close() }
watch(() => props.providers, () => close())
watch(() => props.disabled, value => { if (value) close() })
onMounted(() => {
  document.addEventListener('mousedown', outside)
  window.addEventListener('scroll', outside, true)
  window.addEventListener('resize', resize)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', outside)
  window.removeEventListener('scroll', outside, true)
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <button :id="id" ref="trigger" class="provider-select" type="button" role="combobox" :aria-label="t('generation.provider')"
    :disabled="disabled"
    aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? listId : undefined"
    @click="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
    <span class="model-name">{{ selected?.name || t('generation.selectEnabledModel') }}</span>
    <span v-for="tag in selected?.tags || []" :key="tag" class="model-tag">{{ t('generation.tag.' + tag) }}</span>
    <span v-if="selected" class="model-tag enabled">{{ t('generation.modelEnabled') }}</span>
    <span aria-hidden="true">⌄</span>
  </button>
  <Teleport to="body">
    <div v-if="open" :id="listId" ref="popup" class="provider-options" role="listbox" tabindex="-1"
      :aria-label="t('generation.provider')" :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
      :style="position" @keydown="navigate">
      <button v-for="(provider, index) in providers" :id="`${listId}-${index}`" :key="provider.providerId" type="button"
        role="option" tabindex="-1" class="provider-option" :class="{ active: active === index }"
        :aria-selected="provider.providerId === modelValue" :aria-disabled="!providerIsEnabled(provider)" :disabled="!providerIsEnabled(provider)"
        @mouseenter="providerIsEnabled(provider) && (active = index)" @click="choose(index)">
        <span class="model-name">{{ provider.name }}</span>
        <span v-for="tag in provider.tags || []" :key="tag" class="model-tag">{{ t('generation.tag.' + tag) }}</span>
        <span class="model-tag" :class="{ enabled: providerIsEnabled(provider) }">{{ t(providerIsEnabled(provider) ? 'generation.modelEnabled' : 'generation.providerState.disabled') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.provider-select, .provider-option { display:flex; align-items:center; gap:6px; width:100%; box-sizing:border-box; color:#ddd; font:12px system-ui; text-align:left; cursor:pointer; }
.provider-select { min-height:30px; padding:6px 8px; background:#1e1e1e; border:1px solid #555; border-radius:5px; }
.provider-select:disabled { opacity:.45; cursor:default; }
.model-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.model-tag { flex-shrink:0; padding:2px 5px; border:1px solid #494e56; border-radius:4px; color:#aeb7c4; background:#2b2e33; font-size:10px; white-space:nowrap; }
.model-tag.enabled { color:#a8c6b3; background:#26372e; border-color:#3a5445; }
.provider-options { position:fixed; z-index:20000; box-sizing:border-box; max-height:240px; overflow-y:auto; padding:4px; background:#252525; border:1px solid #555; border-radius:6px; box-shadow:0 8px 24px #0008; }
.provider-option { min-height:40px; padding:6px; border:0; border-radius:4px; background:transparent; }
.provider-option.active { background:#35455a; }
.provider-option:disabled { color:#888; cursor:default; }
.provider-option:disabled .model-tag { color:#888; background:#292929; border-color:#3a3a3a; }
.provider-select:focus-visible, .provider-options:focus-visible { outline:2px solid #8ab4f8; outline-offset:2px; }
</style>
