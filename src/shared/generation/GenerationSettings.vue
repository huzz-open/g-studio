<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "../i18n";
import SegmentedControl from "../components/SegmentedControl.vue";
import {
  generationSettings as settings,
  snapshotConnection,
  useDevelopmentConnection,
} from "./settings";
import { GenerationClient, endpoint } from "./client";
import type { Capabilities } from "../../../packages/generation-protocol/types";
import { forgetJobCredentials } from "./jobs";
const props = withDefaults(
  defineProps<{ section?: "connection" | "defaults" }>(),
  { section: "connection" },
);
const { t } = useI18n(),
  busy = ref(false),
  status = ref(""),
  error = ref(""),
  device = ref(""),
  capabilities = ref<Capabilities>(),
  code = ref(""),
  pairDisplay = ref("");
let pairTimer: ReturnType<typeof setTimeout> | undefined,
  disposed = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let connectionEpoch = 0;
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
    connectionEpoch++;
    device.value = "";
    status.value = "";
    error.value = "";
    if (pairTimer) clearTimeout(pairTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
    pairDisplay.value = "";
    busy.value = false;
  },
  { flush: "sync" },
);
const modes = computed(() =>
  (["silhouette", "direct", "relay"] as const).map((value) => ({
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
function setParameter(key: string, event: Event) {
  (settings.parametersByProvider[settings.providerId] ??= {})[key] = Number(
    (event.target as HTMLInputElement).value,
  );
}
async function connect() {
  if (refreshTimer) clearTimeout(refreshTimer);
  busy.value = true;
  error.value = "";
  status.value = "";
  device.value = "";
  let epoch = ++connectionEpoch;
  try {
    if (settings.mode === "direct" && !settings.token)
      await useDevelopmentConnection();
    epoch = ++connectionEpoch;
    busy.value = true;
    const c = new GenerationClient(snapshotConnection()),
      caps = await c.capabilities();
    if (epoch !== connectionEpoch || disposed) return;
    capabilities.value = caps;
    if (!caps.providers.some((p) => p.providerId === settings.providerId)) {
      settings.providerId = (
        caps.providers.find((p) => p.state === "ready") || caps.providers[0]!
      ).providerId;
      epoch = ++connectionEpoch;
      busy.value = true;
    }
    status.value = t("generation.connected");
    try {
      const info = await new GenerationClient(snapshotConnection()).info();
      if (epoch === connectionEpoch)
        device.value = info.deviceType.toUpperCase();
    } catch {
      if (epoch === connectionEpoch) device.value = t("generation.unknown");
    }
  } catch (e) {
    if (epoch === connectionEpoch) error.value = String(e);
  } finally {
    if (epoch === connectionEpoch) {
      busy.value = false;
      if (
        !disposed &&
        !error.value &&
        capabilities.value?.providers.some((p) => p.state === "preparing")
      )
        refreshTimer = setTimeout(() => void connect(), 5000);
    }
  }
}
async function pair() {
  busy.value = true;
  error.value = "";
  pairDisplay.value = "";
  if (pairTimer) clearTimeout(pairTimer);
  try {
    const base = endpoint(settings.relayUrl),
      r = await fetch(base + "/v1/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.value }),
        signal: AbortSignal.timeout(15000),
      }),
      data = await r.json();
    if (!r.ok) throw Error(data.error?.message || r.statusText);
    pairDisplay.value = data.display;
    const deadline = Date.now() + 300000;
    const poll = async () => {
      if (disposed) return;
      try {
        if (Date.now() > deadline) throw Error(t("generation.pairExpired"));
        const rr = await fetch(base + "/v1/pair/" + data.id, {
            headers: { Authorization: "Bearer " + data.pollToken },
            signal: AbortSignal.timeout(15000),
          }),
          v = await rr.json();
        if (!rr.ok) throw Error(v.error?.message || rr.statusText);
        if (v.state === "approved") {
          settings.relayToken = v.token;
          settings.deviceId = v.deviceId;
          pairDisplay.value = "";
          busy.value = false;
          await connect();
          return;
        }
        if (v.state === "denied") throw Error(t("generation.pairDenied"));
        pairTimer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        error.value = String(e);
        busy.value = false;
      }
    };
    void poll();
  } catch (e) {
    error.value = String(e);
    busy.value = false;
  }
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
    settings.token = "";
    settings.relayToken = "";
    settings.deviceId = "";
    device.value = "";
    status.value = "";
  } catch (e) {
    error.value = String(e);
  }
}
onMounted(() => {
  if (settings.mode === "direct" || (settings.mode === "relay" && settings.deviceId)) void connect();
});
onUnmounted(() => {
  disposed = true;
  if (pairTimer) clearTimeout(pairTimer);
  if (refreshTimer) clearTimeout(refreshTimer);
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
        <p>{{ t("generation.connectionHint") }}</p>
      </div>
      <template v-if="settings.mode === 'direct'">
        <div class="gs-row">
          <label for="generation-url">{{ t("generation.apiUrl") }}</label
          ><input
            id="generation-url"
            v-model.trim="settings.baseUrl"
            placeholder="http://127.0.0.1:8765"
          />
        </div>
        <div class="gs-row">
          <label for="generation-token">{{ t("generation.token") }}</label
          ><input
            id="generation-token"
            v-model.trim="settings.token"
            type="password"
            autocomplete="off"
          />
          <p>{{ t("generation.tokenHint") }}</p>
        </div>
      </template>
      <template v-if="settings.mode === 'relay'">
        <div class="gs-row">
          <label for="generation-relay">{{ t("generation.relayUrl") }}</label
          ><input
            id="generation-relay"
            v-model.trim="settings.relayUrl"
            :disabled="busy"
            placeholder="https://example.com"
          />
          <p>{{ t("generation.relayPrivacy") }}</p>
        </div>
        <div v-if="!settings.deviceId" class="gs-row">
          <label for="generation-pair">{{ t("generation.pairCode") }}</label>
          <div class="gs-actions">
            <input
              id="generation-pair"
              v-model.trim="code"
              maxlength="8"
              autocomplete="off"
            /><button :disabled="busy || code.length !== 8" @click="pair">
              {{ t("generation.pair") }}
            </button>
          </div>
          <p v-if="pairDisplay">
            {{ t("generation.confirmPair", { id: pairDisplay }) }}
          </p>
        </div>
        <p v-else>
          {{ t("generation.boundDevice") }} ·
          {{ settings.deviceId.slice(0, 8) }}
        </p>
      </template>
      <template v-if="settings.mode !== 'silhouette'">
        <div class="gs-actions">
          <button :disabled="busy || (settings.mode === 'relay' && !settings.deviceId)" @click="connect">
            {{
              t(busy ? "common.loading" : "generation.testConnection")
            }}</button
          ><button
            v-if="settings.token || settings.deviceId"
            :disabled="busy"
            @click="forget"
          >
            {{ t("generation.forget") }}
          </button>
        </div>
        <p role="status">{{ status }}</p>
        <div class="gs-device">
          {{ t("generation.device") }}
          <strong>{{ device || t("generation.unknown") }}</strong>
        </div>
        <div v-if="capabilities" class="gs-row">
          <label for="generation-provider">{{ t("generation.provider") }}</label
          ><select
            id="generation-provider"
            v-model="settings.providerId"
            @change="connect"
          >
            <option
              v-for="p in capabilities.providers"
              :key="p.providerId"
              :value="p.providerId"
            >
              {{ p.name }} · {{ t("generation.providerState." + p.state) }}
            </option>
          </select>
          <p
            v-for="p in capabilities.providers.filter((p) => p.error)"
            :key="p.providerId"
          >
            {{ p.error }}
          </p>
        </div>
      </template>
    </template>
    <template v-else>
      <div class="gs-row">
        <label>{{ t("generation.targetFaces") }}</label
        ><input
          v-model.number="settings.targetFaces"
          type="number"
          min="1000"
          max="40000"
          step="1000"
        />
        <p>{{ t("generation.newTasksOnly") }}</p>
      </div>
      <div class="gs-row">
        <label>{{ t("generation.seed") }}</label
        ><input
          v-model.number="settings.seed"
          type="number"
          min="0"
          max="2147483647"
          step="1"
        />
      </div>
      <details v-if="Object.keys(providerParameters).length" class="gs-row">
        <summary>{{ t("generation.advanced") }}</summary>
        <div
          v-for="(range, key) in providerParameters"
          :key="key"
          class="gs-row"
        >
          <label :for="'generation-param-' + key">{{
            t("generation.parameter." + key) === "generation.parameter." + key
              ? key
              : t("generation.parameter." + key)
          }}</label
          ><input
            :id="'generation-param-' + key"
            type="number"
            :min="range.min"
            :max="range.max"
            :step="range.step ?? (range.integer ? 1 : 'any')"
            :value="
              settings.parametersByProvider[settings.providerId]?.[key] ??
              range.default
            "
            @input="setParameter(key, $event)"
          />
        </div>
      </details>
    </template>
    <p v-if="error" class="gs-error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
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
.gs-device {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: #999;
}
.gs-device strong {
  font-weight: 500;
  color: #ddd;
}
.gs-error {
  color: #efad99;
}
</style>
