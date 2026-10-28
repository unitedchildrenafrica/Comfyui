// Reine Hilfsfunktionen für „Modell per Link laden“ (Client + Server).

export const MODEL_TYPES = {
  checkpoint: { label: "Checkpoint", folder: "checkpoints" },
  lora: { label: "LoRA", folder: "loras" },
  unet: { label: "UNet / Diffusion (z. B. Anima)", folder: "diffusion_models" },
  vae: { label: "VAE", folder: "vae" },
  text_encoder: { label: "Text-Encoder", folder: "text_encoders" },
  upscaler: { label: "Upscaler", folder: "upscale_models" },
  embedding: { label: "Embedding", folder: "embeddings" },
} as const;

export type ModelType = keyof typeof MODEL_TYPES;

export type ParsedLink =
  | { kind: "civitai"; host: string; modelId?: number; versionId?: number; fileId?: number }
  | { kind: "huggingface"; url: string; filename: string }
  | { kind: "direct"; url: string; filename: string };

const CIVITAI_HOST = /(^|\.)civitai\.(com|red|green)$/i;
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i;

export function parseModelLink(input: string): ParsedLink | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  if (CIVITAI_HOST.test(u.hostname)) {
    const host = u.hostname.replace(/^www\./, "");
    const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
    let m = u.pathname.match(/^\/api\/download\/models\/(\d+)/);
    if (m) return { kind: "civitai", host, versionId: Number(m[1]), fileId: num(u.searchParams.get("fileId")) };
    m = u.pathname.match(/^\/api\/v1\/model-versions\/(\d+)/);
    if (m) return { kind: "civitai", host, versionId: Number(m[1]) };
    m = u.pathname.match(/^\/models\/(\d+)/);
    if (m) return { kind: "civitai", host, modelId: Number(m[1]), versionId: num(u.searchParams.get("modelVersionId")) };
    return null;
  }

  if (/(^|\.)huggingface\.co$/i.test(u.hostname)) {
    // /owner/repo/(resolve|blob)/rev/pfad/datei → immer resolve (Download statt HTML-Seite)
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:resolve|blob)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const url = `https://huggingface.co/${m[1]}/${m[2]}/resolve/${m[3]}/${m[4]}`;
    return { kind: "huggingface", url, filename: decodeURIComponent(m[4].split("/").pop()!) };
  }

  const filename = decodeURIComponent(u.pathname.split("/").pop() ?? "");
  return { kind: "direct", url: u.toString(), filename };
}

/** Zielordner aus Civitai-Metadaten ableiten. */
export function civitaiType(modelType: string, fileType: string, baseModel: string): ModelType {
  const f = fileType.toLowerCase();
  if (f === "vae") return "vae";
  if (f.includes("text encoder")) return "text_encoder";
  const t = modelType.toLowerCase();
  if (t === "lora" || t === "locon" || t === "dora") return "lora";
  if (t === "vae") return "vae";
  if (t === "upscaler") return "upscaler";
  if (t === "textualinversion") return "embedding";
  // Anima wird bei Civitai als „Checkpoint“ geführt, ist aber nur ein UNet
  if (/anima/i.test(baseModel)) return "unet";
  return "checkpoint";
}

/** Grobe Vermutung aus dem Pfad (Hugging Face / direkte Links). */
export function guessTypeFromPath(path: string): ModelType | null {
  const p = path.toLowerCase();
  if (/(^|\/)loras?\//.test(p) || /lora/.test(p.split("/").pop() ?? "")) return "lora";
  if (/(^|\/)vae\//.test(p) || /vae/.test(p.split("/").pop() ?? "")) return "vae";
  if (/(^|\/)text_encoders?\//.test(p)) return "text_encoder";
  if (/(^|\/)(diffusion_models|unet)\//.test(p)) return "unet";
  if (/(^|\/)upscale_models\//.test(p) || /\.pth$/.test(p)) return "upscaler";
  if (/(^|\/)checkpoints\//.test(p)) return "checkpoint";
  return null;
}

/** Dateiname ohne Pfad und ohne Sonderzeichen, mit Modell-Endung. */
export function sanitizeModelFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop()!.trim().replace(/\s+/g, "_");
  if (!/^[A-Za-z0-9._\-()+\[\]]+$/.test(base) || base.startsWith(".")) return null;
  if (!MODEL_EXT.test(base)) return null;
  return base;
}
