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
  mode: "silhouette",
  baseUrl: "http://127.0.0.1:8765",
  token: "",
  relayUrl: "",
  relayToken: "",
  deviceId: "",
  providerId: "hunyuan-mini",
  targetFaces: 12000,
  seed: 12345,
  parametersByProvider: {},
};
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
    mode: "silhouette",
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
  const r = await fetch("/__generation/connection");
  if (!r.ok) return false;
  const v = await r.json();
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
