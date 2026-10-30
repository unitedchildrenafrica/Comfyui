import path from "node:path";
import { getPodLink, serverMode } from "./podLink";

export const config = {
  /** Im Server-Modus die Adresse des angemeldeten Pod-Gateways, sonst COMFY_URL (lokal auf dem Pod). */
  get comfyUrl() {
    if (serverMode()) return (getPodLink()?.url ?? "http://kein-pod.invalid").replace(/\/$/, "");
    return (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  },
  get dataDir() {
    return process.env.DATA_DIR || "/workspace/pod-frontend-data";
  },
  /** ComfyUI-Modellordner (für „Modelle laden“) */
  get modelsDir() {
    return process.env.MODELS_DIR || "/workspace/ComfyUI/models";
  },
  /** ComfyUI-Ausgabeordner (für ZIP-Download ganzer Ordner) */
  get outputDir() {
    return process.env.OUTPUT_DIR || "/workspace/ComfyUI/output";
  },
  get civitaiToken() {
    return process.env.CIVITAI_TOKEN || "";
  },
  get hfToken() {
    return process.env.HF_TOKEN || "";
  },
  dataPath(...parts: string[]) {
    return path.join(this.dataDir, ...parts);
  },
};
