<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "../i18n";
import type { PartAsset } from "../parts/schema";
import { clonePart } from "../parts/schema";
import { portablePart } from "../parts/images";
import { createPartPreview, fitPartPreview } from "../parts/preview-state";
import LightingViewport from "../../modules/scene-lighting/LightingViewport.vue";
import { generationSettings, snapshotConnection } from "./settings";
import {
  createGenerationJob,
  cancelJob,
  loadGenerationJobs,
  generationJobs,
  submitJob,
  retryResult,
} from "./jobs";
import GenerationSettings from "./GenerationSettings.vue";
const props = defineProps<{ part: PartAsset; jobId?: string }>(),
  emit = defineEmits<{ apply: [part: PartAsset]; close: [] }>();
const { t } = useI18n(),
  busy = ref(false),
  error = ref(""),
  showConfig = ref(false),
  selectedId = ref(props.jobId || ""),
  snapshot = ref<PartAsset>(),
  sourceKey = ref("");
const job = computed(() =>
  generationJobs.find((j) => j.localId === selectedId.value),
);
const candidate = computed(() => {
  const base = clonePart(snapshot.value || props.part);
  if (job.value?.geometry) {
    base.version = 2;
    base.geometry = clonePart(job.value.geometry);
  }
  return base;
});
const state = reactive(createPartPreview(props.part));
state.mode = "geometry";
function warningText(value: string) {
  return value.startsWith("Single-view inferred")
    ? t("generation.inferredWarning")
    : value.startsWith("Silhouette approximation")
      ? t("generation.silhouetteWarning")
      : value;
}
function phaseLabel(value: string) {
  const key = "generation.phase." + value;
  return t(key) === key ? value : t(key);
}
async function generate() {
  busy.value = true;
  error.value = "";
  snapshot.value = clonePart(props.part);
  sourceKey.value = JSON.stringify(props.part);
  try {
    if (generationSettings.mode === "silhouette") {
      snapshot.value.geometry = {
        kind: "silhouette",
        size: [...props.part.geometry.size],
      };
      selectedId.value = "";
      fitPartPreview(state, snapshot.value);
      return;
    }
    const input = await portablePart(props.part),
      created = await createGenerationJob(
        props.part.name,
        input.image.uri,
        snapshotConnection(),
      );
    selectedId.value = created.localId;
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
function apply() {
  if (sourceKey.value && sourceKey.value !== JSON.stringify(props.part)) {
    error.value = t("generation.stale");
    return;
  }
  emit("apply", clonePart(candidate.value));
}
async function retry() {
  if (job.value) {
    busy.value = true;
    try {
      await submitJob(job.value);
    } catch (e) {
      error.value = String(e);
    } finally {
      busy.value = false;
    }
  }
}
async function cancel() {
  if (job.value)
    try {
      await cancelJob(job.value);
    } catch (e) {
      error.value = String(e);
    }
}
const canApply = computed(
  () =>
    !!job.value?.geometry ||
    (!!snapshot.value && generationSettings.mode === "silhouette"),
);
onMounted(async () => {
  await loadGenerationJobs();
  if (props.jobId) {
    snapshot.value = clonePart(props.part);
    sourceKey.value = JSON.stringify(props.part);
  }
  fitPartPreview(state, props.part);
});
</script>
<template>
  <section class="gen-panel">
    <header>
      <strong>{{ t("generation.title") }}</strong
      ><span>{{ part.name }}</span
      ><button @click="emit('close')">{{ t("common.close") }}</button>
    </header>
    <div class="gen-body">
      <aside>
        <div class="gen-section">
          <label>{{ t("generation.mode." + generationSettings.mode) }}</label>
          <p>{{ t("generation.previewHint") }}</p>
          <button @click="showConfig = !showConfig">
            {{ t("generation.connectionSettings") }}</button
          ><GenerationSettings v-if="showConfig" />
        </div>
        <div class="gen-section">
          <button :disabled="busy" @click="generate">
            {{ t(busy ? "common.loading" : "generation.generate") }}
          </button>
        </div>
        <div v-if="job" class="gen-section">
          <p role="status">
            {{ t("generation.status." + job.remote?.status) }} ·
            {{ phaseLabel(job.remote?.phase || "queued") }}
          </p>
          <p v-if="job.deviceType">
            {{ t("generation.device") }} {{ job.deviceType.toUpperCase() }}
          </p>
          <p
            v-if="
              !job.remote ||
              !['succeeded', 'failed', 'cancelled', 'expired'].includes(
                job.remote.status,
              )
            "
          >
            {{ t("generation.waitHint") }}
          </p>
          <button
            v-if="
              job.remote &&
              !['succeeded', 'failed', 'cancelled', 'expired'].includes(
                job.remote.status,
              )
            "
            @click="cancel"
          >
            {{ t("generation.cancel") }}</button
          ><button v-if="!job.remote" :disabled="busy" @click="retry">
            {{ t("generation.retrySubmit") }}
          </button>
          <p v-for="warning in job.geometry?.mesh?.warnings" :key="warning">
            {{ warningText(warning) }}
          </p>
        </div>
        <p
          v-if="error || job?.error || job?.remote?.error"
          class="gen-error"
          role="alert"
        >
          {{ error || job?.error || job?.remote?.error?.message }}
        </p>
        <button v-if="job?.resultRejected" @click="retryResult(job)">
          {{ t("generation.retryResult") }}
        </button>
      </aside>
      <main>
        <LightingViewport
          :state="state"
          :assets="[candidate]"
          :editable="false"
          compact
        />
        <div class="gen-actions">
          <button
            @click="
              state.mode = state.mode === 'geometry' ? 'sprites' : 'geometry'
            "
          >
            {{ t("generation.toggleView") }}</button
          ><button @click="fitPartPreview(state, candidate)">
            {{ t("common.fitView") }}
          </button>
        </div>
      </main>
    </div>
    <footer>
      <span>{{ t("generation.applyHint") }}</span
      ><button :disabled="!canApply" @click="apply">
        {{ t("generation.apply") }}
      </button>
    </footer>
  </section>
</template>
<style scoped>
.gen-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 480px;
  color: #ccc;
  background: #252525;
  font-size: 12px;
}
.gen-panel header {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
}
.gen-panel header span {
  flex: 1;
  color: #999;
}
.gen-panel button {
  font: inherit;
  background: #303030;
  border: 1px solid #555;
  border-radius: 5px;
  padding: 6px 10px;
  color: #ddd;
  cursor: pointer;
}
.gen-panel button:disabled {
  opacity: 0.4;
  cursor: default;
}
.gen-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.gen-body aside {
  width: 270px;
  flex-shrink: 0;
  overflow: auto;
  border-right: 1px solid #3a3a3a;
  padding: 0 14px;
  box-sizing: border-box;
}
.gen-section {
  padding: 14px 0;
  border-bottom: 1px solid #333;
}
.gen-section p {
  line-height: 1.6;
  color: #999;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.gen-body main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.gen-actions {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 8px;
}
.gen-error {
  color: #efad99;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.gen-panel footer {
  border-top: 1px solid #3a3a3a;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.gen-panel footer span {
  font-size: 11px;
  color: #999;
}
@media (max-width: 650px) {
  .gen-body {
    flex-direction: column;
  }
  .gen-body aside {
    width: 100%;
    max-height: 200px;
  }
  .gen-body main {
    min-height: 300px;
  }
}
</style>
