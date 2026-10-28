<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "../i18n";
import { generationConnection, checkGenerationConnection } from "./connection";
import ConnectionStatus from './ConnectionStatus.vue';
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
const deploymentCommand = computed(() => installCommand(new URL(import.meta.env.BASE_URL, window.location.origin).href, allowRemote.value));
let disposed = false;
let feedbackToast: number | undefined;
const capabilities = computed(() => generationConnection.capabilities);
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
function friendlyError(value: unknown) {
  const message = String(value);
  if (/Failed to fetch|NetworkError|fetch failed|TimeoutError|aborted|OFFLINE/i.test(message)) return t('generation.connectionFailedHint');
  if (/401|Access token|UNAUTHORIZED/i.test(message)) return t('generation.credentialsInvalid');
  if (/Invalid URL|Invalid service URL/i.test(message)) return t('generation.invalidAddress');
  if (/Public services require HTTPS/i.test(message)) return t('generation.httpsRequired');
  return message.replace(/^(TypeError|Error):\s*/, '');
}
function feedback(message: string, success = false) {
  if (feedbackToast !== undefined) dismissToast(feedbackToast);
  feedbackToast = showToast(message, success ? 'success' : 'error', success ? 3000 : 5000);
}
async function connect(manual = true) {
  if (!settings.baseUrl.trim()) { if (manual) feedback(t('generation.addressRequired')); return; }
  if (manual && feedbackToast !== undefined) { dismissToast(feedbackToast); feedbackToast = undefined; }
  if (manual) busy.value = true;
  try {
    await checkGenerationConnection({ background: !manual });
    if (disposed) return;
    if (manual && (generationConnection.connected || generationConnection.error)) {
      feedback(generationConnection.connected ? t('generation.connected') : friendlyError(generationConnection.error || t('generation.connectionFailed')), generationConnection.connected);
    }
  } finally { if (manual && !disposed) busy.value = false; }
}
async function copyDeploymentCommand() {
  try {
    await navigator.clipboard.writeText(deploymentCommand.value);
    feedback(t('generation.commandCopied'), true);
  } catch { feedback(t('generation.copyCommandManually')); }
}
onMounted(() => {
  if (props.section === 'connection' && settings.baseUrl.trim()) void connect(false);
});
onUnmounted(() => {
  disposed = true;
});
</script>
<template>
  <div class="generation-settings">
    <template v-if="props.section === 'connection'">
      <details class="generation-install" :open="!settings.baseUrl.trim()">
        <summary>{{ t('generation.installBackend') }}</summary>
        <p>{{ t('generation.installIntro') }}</p>
        <label class="install-scope"><input v-model="allowRemote" type="checkbox" />{{ t('generation.allowRemote') }}<InfoHint :label="t('generation.allowRemote')" :text="t('generation.listenHint')" /></label>
        <pre class="install-command">{{ deploymentCommand }}</pre>
        <button type="button" class="copy-install" @click="copyDeploymentCommand">{{ t('generation.copyCommand') }}</button>
        <p>{{ t('generation.installNext') }}</p>
        <InfoHint :label="t('generation.installRequirements')" :text="t('generation.installRequirementsHint')" /><span class="install-requirements">{{ t('generation.installRequirements') }}</span>
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
          <label for="generation-provider">{{ t("generation.provider") }}</label
          ><select
            id="generation-provider"
            v-model="settings.providerId"
            @change="connect(false)"
          >
            <option
              v-for="p in capabilities.providers.filter(p => p.providerId !== 'silhouette')"
              :key="p.providerId"
              :value="p.providerId"
            >
              {{ p.name }} · {{ t("generation.providerState." + p.state) }}
            </option>
          </select>
        </div>
    </template>
    <div v-else class="generation-parameters" role="group" :aria-label="t(props.parameters ? 'generation.parameters' : 'generation.defaults')">
      <NumberRow v-model="parameters.targetFaces" :label="t('generation.targetFaces')" :hint="t(props.parameters ? 'generation.inputParametersHint' : 'generation.newTasksOnly')" :default-value="generationDefaults.targetFaces" :min="1000" :max="40000" :step="1000" :disabled="props.disabled" />
      <NumberRow v-model="parameters.seed" :label="t('generation.seed')" :default-value="generationDefaults.seed" :min="0" :max="2147483647" :step="1" :disabled="props.disabled" />
      <NumberRow v-for="(range,key) in providerParameters" :key="key" :label="t('generation.parameter.'+key) === 'generation.parameter.'+key ? key : t('generation.parameter.'+key)" :model-value="parameters.parametersByProvider[settings.providerId]?.[key] ?? range.default" :default-value="range.default" :min="range.min" :max="range.max" :step="range.step ?? (range.integer ? 1 : 0.1)" :disabled="props.disabled" @update:model-value="updateProviderParameter(key, $event)" />
    </div>

  </div>
</template>
<style scoped>
.generation-install { padding:14px 0; border-bottom:1px solid #2f2f2f; }
.generation-install summary { cursor:pointer; color:#ddd; }
.install-scope { display:flex; align-items:center; gap:6px; color:#ccc; }
.install-command { white-space:pre-wrap; overflow-wrap:anywhere; background:#171b21; border:1px solid #444; border-radius:5px; padding:10px; color:#dce4ee; font:11px/1.7 monospace; user-select:text; }
.copy-install { padding:5px 10px; border:1px solid #555; border-radius:5px; background:#303944; color:#eee; cursor:pointer; }
.install-requirements { color:#999; margin-left:4px; }
.generation-parameters { display:flex; flex-direction:column; gap:12px; padding:14px 0; border-bottom:1px solid #2f2f2f; }
.generation-parameters :deep(.number-row) { margin-bottom:0; }
.generation-settings :deep(.number-label) { white-space:normal; }
.generation-settings :deep(.number-input) { width:104px; }
.generation-settings :deep(.number-row) { flex-wrap:wrap; }
.generation-settings :deep(.number-input-wrap) { margin-left:auto; }
.gs-label-actions { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.gs-label-actions label { color:#ddd; }
.test-connection { margin-left:auto; background:transparent; color:#bbb; border:1px solid #555; border-radius:5px; padding:4px 8px; font:inherit; cursor:pointer; }
.test-connection:disabled { opacity:.45; cursor:default; }
.device-tag { color:#a8c6b3; background:#26372e; border:1px solid #3a5445; padding:2px 6px; border-radius:4px; font-size:10px; }

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
