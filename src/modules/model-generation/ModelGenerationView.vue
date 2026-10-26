<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "../../shared/i18n";
import GenerationPanel from "../../shared/generation/GenerationPanel.vue";
import {
  generationJobs,
  loadGenerationJobs,
  removeJob,
  type LocalJob,
} from "../../shared/generation/jobs";
import { createPart, type PartAsset } from "../../shared/parts/schema";
import { savePart } from "../../shared/parts/library";
import { openPartEditor } from "../../shared/parts/editor-session";
import { showToast } from "../../shared/components/toast";
import { prompt } from "../../shared/components/prompt";
import {
  EditorShell,
  definePanelConfig,
} from "../../shared/components/editor-shell";
import ScrollArea from "../../shared/components/ScrollArea.vue";
const { t } = useI18n(),
  part = ref<PartAsset>(),
  jobId = ref(""),
  error = ref(""),
  upload = ref<HTMLInputElement>(),
  busy = ref(false);
const leftCollapsed = ref(false);
async function renameTab() {
  if (!part.value) return;
  const name = await prompt({
    title: t("parts.name"),
    defaultValue: part.value.name,
  });
  if (name?.trim()) part.value.name = name.trim().slice(0, 120);
}
const panel = definePanelConfig("model-generation-sidebar-width", 250);
const tabs = computed(() =>
  part.value ? [{ id: "generation", label: part.value.name }] : [],
);
async function inputFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (file) await loadFile(file);
}
async function loadFile(file: File) {
  try {
    if (file.size > 10 * 1024 * 1024) throw Error(t("generation.inputLimit"));
    const bitmap = await createImageBitmap(file);
    if (
      bitmap.width > 2048 ||
      bitmap.height > 2048 ||
      bitmap.width * bitmap.height > 4000000
    ) {
      bitmap.close();
      throw Error(t("generation.inputLimit"));
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    part.value = createPart(file.name.replace(/\.[^.]+$/, "").slice(0, 120), {
      uri: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    });
    jobId.value = "";
    error.value = "";
  } catch (e) {
    error.value = String(e);
  }
}
async function select(job: LocalJob) {
  try {
    const image = new Image();
    image.src = job.image;
    await image.decode();
    part.value = createPart(job.name, {
      uri: job.image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    jobId.value = job.localId;
  } catch (e) {
    error.value = String(e);
  }
}
async function apply(value: PartAsset) {
  busy.value = true;
  try {
    const saved = await savePart(value);
    part.value = saved;
    showToast(t("generation.saved"));
    openPartEditor({ assetId: saved.id, origin: "scene" });
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function discard(job: LocalJob) {
  try {
    await removeJob(job);
    if (jobId.value === job.localId) {
      part.value = undefined;
      jobId.value = "";
    }
  } catch (e) {
    error.value = String(e);
  }
}
onMounted(() => {
  void loadGenerationJobs().catch((e) => {
    error.value = String(e);
  });
});
</script>
<template>
  <EditorShell
    v-model:left-collapsed="leftCollapsed"
    :tabs="tabs"
    :active-tab-id="part ? 'generation' : null"
    :left-panel="panel"
    tab-accept="image/png,image/jpeg,image/webp"
    @tab-add-file="loadFile"
    @tab-load-file="loadFile"
    @tab-close="part = undefined"
    @tab-rename="renameTab"
  >
    <template #left
      ><ScrollArea class="jobs"
        ><div class="job-toolbar">
          <button @click="upload?.click()">
            {{ t("generation.chooseImage") }}</button
          ><input
            ref="upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            @change="inputFile"
          />
        </div>
        <p v-if="!generationJobs.length">{{ t("generation.noJobs") }}</p>
        <div v-for="job in generationJobs" :key="job.localId" class="job-row">
          <button @click="select(job)">
            <img :src="job.image" alt="" /><span
              >{{ job.name
              }}<small>{{
                t(
                  "generation.status." +
                    (job.geometry
                      ? "succeeded"
                      : job.remote?.status || "queued"),
                )
              }}</small></span
            ></button
          ><button
            :aria-label="t('generation.removeTask')"
            @click="discard(job)"
          >
            ×
          </button>
        </div></ScrollArea
      ></template
    >
    <template #viewport
      ><div class="generation-workspace">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <GenerationPanel
          v-if="part"
          :key="part.id + jobId"
          :part="part"
          :job-id="jobId"
          @apply="apply"
          @close="part = undefined"
        />
        <div v-else class="empty">
          <h2>{{ t("generation.title") }}</h2>
          <p>{{ t("generation.subtitle") }}</p>
          <button @click="upload?.click()">
            {{ t("generation.chooseImage") }}
          </button>
        </div>
      </div></template
    >
  </EditorShell>
</template>
<style scoped>
.generation-workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.jobs {
  height: 100%;
  background: #252525;
  padding: 12px;
  box-sizing: border-box;
}
.job-toolbar {
  margin-bottom: 16px;
}
.jobs button,
.empty button {
  background: #303030;
  border: 1px solid #555;
  border-radius: 5px;
  color: #ccc;
  padding: 6px 9px;
  font-size: 12px;
  cursor: pointer;
}
.jobs p {
  font-size: 11px;
  color: #888;
}
.job-row {
  display: flex;
  border-bottom: 1px solid #383838;
  padding: 8px 0;
  gap: 5px;
}
.job-row > button:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 0;
  background: none;
}
.job-row img {
  width: 36px;
  height: 42px;
  object-fit: contain;
}
.job-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #ccc;
}
.job-row small {
  display: block;
  color: #888;
  font-size: 10px;
  margin-top: 5px;
}
.empty {
  margin: auto;
  text-align: center;
  color: #aaa;
  padding: 30px;
}
.empty h2 {
  font-size: 18px;
}
.empty p {
  font-size: 12px;
  line-height: 1.8;
  max-width: 450px;
}
.error {
  color: #efad99;
  padding: 10px;
  font-size: 12px;
}
</style>
