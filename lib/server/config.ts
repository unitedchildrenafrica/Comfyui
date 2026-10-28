import path from "node:path";

export const config = {
  get comfyUrl() {
    return (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  },
  get dataDir() {
    return process.env.DATA_DIR || "/workspace/pod-frontend-data";
  },
  /** ComfyUI-Modellordner (für „Modelle laden“) */
  get modelsDir() {
    return process.env.MODELS_DIR || "/workspace/ComfyUI/models";
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
