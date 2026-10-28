<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "../i18n";
import { generationConnection, checkGenerationConnection } from "./connection";
import ConnectionStatus from './ConnectionStatus.vue';
import InfoHint from '../components/InfoHint.vue';
import NumberRow from '../components/editor-shell/sidebar-atoms/NumberRow.vue';
import { showToast, dismissToast } from '../components/toast';
import SegmentedControl from "../components/SegmentedControl.vue";
import {
  generationSettings as settings,
  snapshotConnection,
  generationDefaults,
} from "./settings";
import { GenerationClient, endpoint } from "./client";
import { forgetJobCredentials } from "./jobs";
import type { GenerationParameters } from './parameters';
const props = withDefaults(
  defineProps<{ section?: "connection" | "defaults"; disabled?: boolean; parameters?: GenerationParameters }>(),
  { section: "connection" },
);
const { t } = useI18n(),
  busy = ref(false),
  code = ref("");
let disposed = false;
let actionEpoch = 0;
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
    actionEpoch++;
    busy.value = false;
  },
  { flush: "sync" },
);
const modes = computed(() =>
  (["direct", "relay"] as const).map((value) => ({
    value,
    label: t("generation.mode." + value),
  })),
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
  if (/PAIR_BLOCKED|Too many invalid|Too many attempts/i.test(message)) return t('generation.pairBlocked');
  if (/Invalid or expired pairing|Invalid pairing/i.test(message)) return t('generation.pairExpired');
  return message.replace(/^(TypeError|Error):\s*/, '');
}
function feedback(message: string, success = false) {
  if (feedbackToast !== undefined) dismissToast(feedbackToast);
  feedbackToast = showToast(message, success ? 'success' : 'error', success ? 3000 : 5000);
}
async function connect(manual = true) {
  if (settings.mode === 'direct' && !settings.baseUrl.trim()) settings.baseUrl = generationDefaults.baseUrl;
  actionEpoch++;
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
async function pair() {
  const attempted = ++actionEpoch;
  const base = settings.relayUrl.trim();
  if (!base) { feedback(t('generation.relayAddressRequired')); return; }
  busy.value = true;
  try {
    const response = await fetch(endpoint(base) + '/v1/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value.trim().toUpperCase() }), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || response.statusText);
    if (disposed || attempted !== actionEpoch) return;
    if (data.state !== 'approved' || typeof data.token !== 'string' || typeof data.deviceId !== 'string') throw Error(t('generation.pairServiceOutdated'));
    settings.relayToken = data.token;
    settings.deviceId = data.deviceId;
    code.value = '';
    await connect();
  } catch (error) { if (!disposed && attempted === actionEpoch) feedback(friendlyError(error)); }
  finally { if (!disposed) busy.value = false; }
}
async function forget() {
  try {
    const connection = snapshotConnection();
    if (settings.mode === "relay" && settings.deviceId)
      await new GenerationClient(connection).call(
        "/v1/devices/" + settings.deviceId,
        { method: "DELETE" },
      );
    await forgetJobCredentials(connection);
    settings.relayToken = "";
    settings.deviceId = "";
  } catch (e) {
    feedback(friendlyError(e));
  }
}
onMounted(() => {
  if (props.section === "connection" && (settings.mode === "direct" || (settings.mode === "relay" && settings.deviceId))) void connect(false);
});
onUnmounted(() => {
  disposed = true;
  actionEpoch++;
});
</script>
<template>
  <div class="generation-settings">
    <template v-if="props.section === 'connection'">
      <div class="gs-row">
        <SegmentedControl
          v-model="settings.mode"
          :label="t('generation.connectionMode')"
          :options="modes"
          :disabled="busy"
        />

      </div>
      <template v-if="settings.mode === 'direct'">
        <div class="gs-row">
          <div class="gs-label-actions">
            <label for="generation-url">{{ t("generation.apiUrl") }}</label>
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
      </template>
      <template v-if="settings.mode === 'relay'">
        <div class="gs-row">
          <div class="gs-label-actions">
            <label for="generation-relay">{{ t("generation.relayUrl") }}</label><InfoHint :label="t('generation.relayUrl')" :text="t('generation.relayPrivacy')" />
            <ConnectionStatus />
            <span v-if="generationConnection.device" class="device-tag">{{ generationConnection.device }}</span>
            <button class="test-connection" :disabled="busy || generationConnection.checking || !settings.deviceId" @click="connect(true)">{{ t(busy ? 'common.loading' : 'generation.testConnection') }}</button>
          </div><input
            id="generation-relay"
            v-model.trim="settings.relayUrl"
            :disabled="busy"
            placeholder="https://example.com"
          />
          <p>{{ t("generation.relayPurpose") }}</p>
        </div>
        <div v-if="!settings.deviceId" class="gs-row">
          <div class="gs-label-actions"><label for="generation-pair">{{ t("generation.pairCode") }}</label><InfoHint :label="t('generation.pairCode')" :text="t('generation.pairSecurity')" /></div>
          <div class="gs-actions">
            <input
              id="generation-pair"
              v-model.trim="code"
              maxlength="10"
              @input="code = code.toUpperCase().replace(/[^A-Z0-9]/g, '')"
              autocomplete="off"
            /><button :disabled="busy || !/^[A-Z0-9]{10}$/.test(code)" @click="pair">
              {{ t("generation.pair") }}
            </button>
          </div>

        </div>
        <p v-else>
          {{ t("generation.boundDevice") }} ·
          {{ settings.deviceId.slice(0, 8) }}
        </p>
      </template>
      <template v-if="settings.mode !== 'silhouette'">
        <div v-if="settings.mode === 'relay' && settings.deviceId" class="gs-actions">
          <button :disabled="busy" :title="t('generation.forgetHint')" @click="forget">{{ t('generation.forget') }}</button>
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
    </template>
    <div v-else class="generation-parameters" role="group" :aria-label="t(props.parameters ? 'generation.parameters' : 'generation.defaults')">
      <NumberRow v-model="parameters.targetFaces" :label="t('generation.targetFaces')" :hint="t(props.parameters ? 'generation.inputParametersHint' : 'generation.newTasksOnly')" :default-value="generationDefaults.targetFaces" :min="1000" :max="40000" :step="1000" :disabled="props.disabled" />
      <NumberRow v-model="parameters.seed" :label="t('generation.seed')" :default-value="generationDefaults.seed" :min="0" :max="2147483647" :step="1" :disabled="props.disabled" />
      <NumberRow v-for="(range,key) in providerParameters" :key="key" :label="t('generation.parameter.'+key) === 'generation.parameter.'+key ? key : t('generation.parameter.'+key)" :model-value="parameters.parametersByProvider[settings.providerId]?.[key] ?? range.default" :default-value="range.default" :min="range.min" :max="range.max" :step="range.step ?? (range.integer ? 1 : 0.1)" :disabled="props.disabled" @update:model-value="updateProviderParameter(key, $event)" />
    </div>

  </div>
</template>
<style scoped>
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
