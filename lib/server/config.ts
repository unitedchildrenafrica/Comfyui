import path from "node:path";

export const config = {
  get comfyUrl() {
    return (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  },
  get dataDir() {
    return process.env.DATA_DIR || "/workspace/pod-frontend-data";
  },
  dataPath(...parts: string[]) {
    return path.join(this.dataDir, ...parts);
  },
};
