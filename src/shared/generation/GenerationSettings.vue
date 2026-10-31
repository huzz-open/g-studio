<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { TARGET_FACES_MIN, TARGET_FACES_MAX } from '../../../packages/generation-protocol/limits';
import { useI18n } from "../i18n";
import { generationConnection, checkGenerationConnection, modelProviders, providerIsEnabled } from "./connection";
import { clearGenerationFeedback, showConnectionTestFeedback } from './feedback';
import { generationReadinessMessage, selectedModelProvider as selectedProvider } from './readiness';
import ConnectionStatus from './ConnectionStatus.vue';
import ModelProviderSelect from './ModelProviderSelect.vue';
import InlineSwitch from '../components/InlineSwitch.vue';
import InfoHint from '../components/InfoHint.vue';
import NumberRow from '../components/editor-shell/sidebar-atoms/NumberRow.vue';
import { showToast, dismissToast } from '../components/toast';
import {
  generationSettings as settings,
  generationDefaults,
} from "./settings";
import { installCommand } from './deployment';
import type { GenerationParameters } from './parameters';
const props = withDefaults(
  defineProps<{ section?: "connection" | "defaults"; disabled?: boolean; parameters?: GenerationParameters }>(),
  { section: "connection" },
);
const { t } = useI18n(), busy = ref(false);
const allowRemote = ref(false);
const commandCopied = ref(false);
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
function resetCopyFeedback() {
  clearTimeout(copyResetTimer);
  commandCopied.value = false;
}
const deploymentCommand = computed(() => installCommand(new URL(import.meta.env.BASE_URL, window.location.origin).href, allowRemote.value));
watch(deploymentCommand, resetCopyFeedback);
let disposed = false;
let feedbackToast: number | undefined;
const capabilities = computed(() => generationConnection.capabilities);
const providerSelectId = useId();
const parameters = computed(() => props.parameters ?? settings);
watch(
  () => [
    settings.mode,
    settings.baseUrl,
    settings.token,
    settings.relayUrl,
    settings.relayToken,
    settings.deviceId,
    settings.providerId,
  ],
  () => {
    busy.value = false;
  },
  { flush: "sync" },
);
const providerParameters = computed(
  () =>
    capabilities.value?.providers.find(
      (p) => p.providerId === settings.providerId,
    )?.parameters || {},
);
function updateProviderParameter(key: string, value: number) {
  const provider = parameters.value.parametersByProvider[settings.providerId] ??= {};
  provider[key] = value;
}
function feedback(message: string, success = false) {
  if (feedbackToast !== undefined) dismissToast(feedbackToast);
  feedbackToast = showToast(message, success ? 'success' : 'error', success ? 3000 : 5000);
}
async function connect(manual = true) {
  if (manual) clearGenerationFeedback();
  if (!settings.baseUrl.trim()) { if (manual) feedback(t('generation.addressRequired')); return; }
  if (!settings.token.trim()) { if (manual) feedback(t('generation.tokenRequired')); return; }
  if (manual && feedbackToast !== undefined) { dismissToast(feedbackToast); feedbackToast = undefined; }
  if (manual) busy.value = true;
  try {
    await checkGenerationConnection({ background: !manual });
    if (disposed) return;
    if (manual && (generationConnection.connected || generationConnection.error)) {
      showConnectionTestFeedback();
    }
  } finally { if (manual && !disposed) busy.value = false; }
}
async function copyDeploymentCommand() {
  const command = deploymentCommand.value;
  try {
    await navigator.clipboard.writeText(command);
    if (disposed || command !== deploymentCommand.value) return;
    resetCopyFeedback();
    commandCopied.value = true;
    copyResetTimer = setTimeout(resetCopyFeedback, 2000);
  } catch { if (!disposed) { resetCopyFeedback(); feedback(t('generation.copyCommandManually')); } }
}
onMounted(() => {
  if (props.section === 'connection' && settings.baseUrl.trim()) void connect(false);
});
onUnmounted(() => {
  disposed = true;
  resetCopyFeedback();
});
</script>
<template>
  <div class="generation-settings">
    <template v-if="props.section === 'connection'">
      <details class="generation-install">
        <summary>{{ t('generation.installBackend') }}</summary>
        <div class="install-scope">
          <InlineSwitch v-model="allowRemote" :label="t('generation.allowRemote')" :info="t('generation.listenHint')" />
        </div>
        <div class="install-command-wrap">
          <pre class="install-command"><code>{{ deploymentCommand }}</code></pre>
          <button type="button" class="copy-install" :class="{ copied: commandCopied }" :aria-label="t(commandCopied ? 'generation.commandCopied' : 'generation.copyCommand')" :title="t(commandCopied ? 'generation.commandCopied' : 'generation.copyCommand')" @click="copyDeploymentCommand">
            <svg v-if="commandCopied" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" /></svg>
            <span v-if="commandCopied">{{ t('generation.commandCopied') }}</span>
          </button>
          <span class="copy-announcement" role="status">{{ commandCopied ? t('generation.commandCopied') : '' }}</span>
        </div>
        <details class="install-requirements">
          <summary><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5" /><circle cx="10" cy="6" r=".6" fill="currentColor" stroke="none" /></svg>{{ t('generation.installRequirements') }}<svg class="requirements-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg></summary>
          <p>{{ t('generation.installRequirementsHint') }}</p>
        </details>
      </details>
        <div class="gs-row">
          <div class="gs-label-actions">
            <label for="generation-url">{{ t("generation.apiUrl") }}</label>
            <InfoHint :label="t('generation.apiUrl')" :text="t('generation.directHint')" />
            <ConnectionStatus />
            <span v-if="generationConnection.device" class="device-tag">{{ generationConnection.device }}</span>
            <button class="test-connection" :disabled="busy || generationConnection.checking" @click="connect(true)">{{ t(busy ? 'common.loading' : 'generation.testConnection') }}</button>
          </div><input
            id="generation-url"
            v-model.trim="settings.baseUrl"
            placeholder="http://127.0.0.1:8765"
          />
        </div>
        <div class="gs-row">
          <div class="gs-label-actions"><label for="generation-token">{{ t("generation.token") }}</label><InfoHint :label="t('generation.token')" :text="t('generation.tokenHint')" /></div><input
            id="generation-token"
            v-model.trim="settings.token"
            type="password"
            autocomplete="off"
          />

        </div>
        <div v-if="capabilities" class="gs-row">
          <div class="gs-label-actions">
            <label for="generation-provider">{{ t("generation.provider") }}</label>
            <span v-if="selectedProvider && providerIsEnabled(selectedProvider)" class="provider-status" :class="{ failed: selectedProvider.state === 'failed', ready: selectedProvider.state === 'ready' }"
              role="status" tabindex="0" :title="generationReadinessMessage" :aria-label="generationReadinessMessage">
              {{ t('generation.providerState.' + selectedProvider.state) }}
            </span>
          </div>
          <ModelProviderSelect id="generation-provider" v-model="settings.providerId" :providers="modelProviders" @change="connect(false)" />
        </div>
    </template>
    <div v-else class="generation-parameters" role="group" :aria-label="t(props.parameters ? 'generation.parameters' : 'generation.defaults')">
      <div v-if="modelProviders.length" class="gs-row">
        <div class="gs-label-actions"><label :for="providerSelectId">{{ t('generation.provider') }}</label></div>
        <ModelProviderSelect :id="providerSelectId" v-model="settings.providerId" :providers="modelProviders" :disabled="props.disabled" />
      </div>
      <InlineSwitch :model-value="parameters.optimizeModel!==false" :disabled="props.disabled" :label="t('generation.optimizeAfterGeneration')" @update:model-value="parameters.optimizeModel=$event"/>
      <NumberRow v-model="parameters.targetFaces" :label="t('generation.targetFaces')" :hint="t(props.parameters ? 'generation.inputParametersHint' : 'generation.newTasksOnly')" :default-value="generationDefaults.targetFaces" :min="TARGET_FACES_MIN" :max="TARGET_FACES_MAX" :step="1000" :disabled="props.disabled" />
      <NumberRow v-model="parameters.seed" :label="t('generation.seed')" :default-value="generationDefaults.seed" :min="0" :max="2147483647" :step="1" :disabled="props.disabled" randomize />
      <NumberRow v-for="(range,key) in providerParameters" :key="key" :label="t('generation.parameter.'+key) === 'generation.parameter.'+key ? key : t('generation.parameter.'+key)" :model-value="parameters.parametersByProvider[settings.providerId]?.[key] ?? range.default" :default-value="range.default" :min="range.min" :max="range.max" :step="range.step ?? (range.integer ? 1 : 0.1)" :disabled="props.disabled" @update:model-value="updateProviderParameter(key, $event)" />
    </div>

  </div>
</template>
<style scoped>
.generation-install { padding:14px 0; border-bottom:1px solid #2f2f2f; }
.generation-install > summary { cursor:pointer; color:#ddd; font-weight:600; }
.install-scope { display:flex; align-items:center; gap:6px; margin:12px 0 8px; padding:9px 10px; border:1px solid #383c41; border-radius:8px; background:#27292c; color:#ddd; }
.install-command-wrap { position:relative; background:#171b21; border:1px solid #3e454e; border-radius:8px; }
.install-command { box-sizing:border-box; min-height:48px; margin:0; padding:12px 92px 12px 12px; white-space:pre-wrap; overflow-wrap:anywhere; color:#dce4ee; font:11px/1.8 monospace; user-select:text; }
.install-command code { font:inherit; }
.copy-install { position:absolute; top:8px; right:8px; display:flex; align-items:center; justify-content:center; gap:5px; min-width:28px; height:28px; padding:0 6px; border:1px solid #4b515a; border-radius:6px; background:#2b3037; color:#bdc7d4; font:inherit; cursor:pointer; transition:background .15s, border-color .15s; }
.copy-install:hover { background:#363d46; border-color:#697687; color:#eef3fa; }
.copy-install.copied { background:#20382b; border-color:#355344; color:#9be5b0; }
.copy-install:focus-visible, .install-requirements summary:focus-visible { outline:2px solid #8ab4f8; outline-offset:3px; }
.copy-announcement { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.install-requirements { margin-top:8px; color:#9ba5b3; }
.install-requirements summary { display:flex; align-items:center; gap:8px; padding:7px 2px; list-style:none; cursor:pointer; }
.install-requirements summary::-webkit-details-marker { display:none; }
.install-requirements summary:hover { color:#dce4ee; }
.requirements-chevron { margin-left:auto; transition:transform .15s; }
.install-requirements[open] .requirements-chevron { transform:rotate(90deg); }
.install-requirements p { margin:4px 0 0; padding:8px 10px; border-radius:6px; background:#27292c; }
@media (prefers-reduced-motion:reduce) { .copy-install, .requirements-chevron { transition:none; } }
.generation-parameters { display:flex; flex-direction:column; gap:12px; padding:14px 0; border-bottom:1px solid #2f2f2f; }
.generation-parameters :deep(.number-row) { margin-bottom:0; }
.generation-settings :deep(.number-label) { white-space:normal; }
.generation-settings :deep(.number-input),
.generation-settings :deep(.with-random .number-input) { width:112px; min-width:112px; }
.generation-settings :deep(.number-row) { flex-wrap:nowrap; }
.generation-settings :deep(.number-heading) { flex:1; min-width:0; }
.generation-settings :deep(.number-input-wrap) { margin-left:auto; }
.gs-label-actions { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.gs-label-actions label { color:#ddd; }
.test-connection { margin-left:auto; background:transparent; color:#bbb; border:1px solid #555; border-radius:5px; padding:4px 8px; font:inherit; cursor:pointer; }
.test-connection:disabled { opacity:.45; cursor:default; }
.device-tag { color:#b6bec9; background:#2b2e33; border:1px solid #454a52; padding:2px 6px; border-radius:4px; font-size:10px; }
.provider-status { color:#aeb7c4; font-size:11px; cursor:help; }
.provider-status.failed { color:#efad99; }
.provider-status.ready { color:#a8c6b3; }
.provider-status:focus-visible { outline:2px solid #8ab4f8; outline-offset:3px; border-radius:2px; }

.generation-settings {
  font-size: 12px;
  color: #ccc;
}
.gs-row {
  padding: 12px 0;
  border-bottom: 1px solid #2f2f2f;
}
.gs-row > label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #ddd;
}
.gs-row p,
p {
  font-size: 11px;
  color: #999;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.gs-row input,
.gs-row select {
  box-sizing: border-box;
  width: 100%;
  background: #1e1e1e;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 6px 8px;
  color: #eee;
  font-size: 12px;
  outline: none;
}
.gs-row input:focus,
.gs-row select:focus {
  border-color: #5b9cf6;
}
.gs-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  align-items: center;
}
.gs-actions input {
  flex: 1;
  min-width: 0;
}
.gs-actions button {
  white-space: nowrap;
  background: transparent;
  border: 1px solid #555;
  border-radius: 5px;
  color: #bbb;
  font-size: 11px;
  padding: 5px 9px;
  cursor: pointer;
}
.gs-actions button:hover {
  border-color: #888;
  color: #eee;
}
.gs-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
