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
export async function useDevelopmentConnection() {
  if (!import.meta.env.DEV) return false;
  const before = { baseUrl: generationSettings.baseUrl, token: generationSettings.token };
  const r = await fetch("/__generation/connection", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) return false;
  const v = await r.json();
  if (generationSettings.baseUrl !== before.baseUrl || generationSettings.token !== before.token) return false;
  if (typeof v.baseUrl !== "string" || typeof v.token !== "string")
    return false;
  if (
    ![v.baseUrl, "http://127.0.0.1:8765", "http://localhost:8765"].includes(
      generationSettings.baseUrl.replace(/\/+$/, ""),
    )
  )
    return false;
  generationSettings.baseUrl = v.baseUrl;
  generationSettings.token = v.token;
  return true;
}
