import { reactive, watch } from "vue";
export interface GenerationConnection {
  mode: "silhouette" | "direct" | "relay";
  baseUrl: string;
  token: string;
  relayUrl: string;
  relayToken: string;
  deviceId: string;
  providerId: string;
  targetFaces: number;
  seed: number;
  parametersByProvider: Record<string, Record<string, number>>;
}
const defaults: GenerationConnection = {
  mode: "direct",
  baseUrl: "",
  token: "",
  relayUrl: "",
  relayToken: "",
  deviceId: "",
  providerId: "hunyuan-mini",
  targetFaces: 12000,
  seed: 12345,
  parametersByProvider: {},
};
export { defaults as generationDefaults };
function read() {
  try {
    return {
      ...defaults,
      ...JSON.parse(
        localStorage.getItem("g-studio-generation-device-v1") || "{}",
      ),
    };
  } catch {
    return { ...defaults };
  }
}
/** Device-private, deliberately outside the workspace settings/export. */
export const generationSettings = reactive<GenerationConnection>(read());
// New connections are direct only. Preserve historical job snapshots separately.
if (generationSettings.mode === 'relay') {
  generationSettings.baseUrl = '';
  generationSettings.token = '';
}
generationSettings.mode = 'direct';
generationSettings.relayUrl = '';
generationSettings.relayToken = '';
generationSettings.deviceId = '';
if (generationSettings.providerId === 'silhouette') generationSettings.providerId = 'hunyuan-mini';
// Credentials belong to one exact API base. Clear synchronously, before a
// request or persistence watcher can observe a new address with an old token.
watch(() => generationSettings.baseUrl, () => {
  generationSettings.token = '';
}, { flush: 'sync' });
watch(
  generationSettings,
  () =>
    localStorage.setItem(
      "g-studio-generation-device-v1",
      JSON.stringify(generationSettings),
    ),
  { deep: true },
);
export function resetGenerationPreferences() {
  Object.assign(generationSettings, {
    mode: "direct",
    providerId: defaults.providerId,
    targetFaces: defaults.targetFaces,
    seed: defaults.seed,
    parametersByProvider: {},
  });
}
export function snapshotConnection(): GenerationConnection {
  return JSON.parse(JSON.stringify(generationSettings));
}
