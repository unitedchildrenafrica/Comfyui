// Gemeinsame Typen für Client und Server

export type ImageGenerator = "wai" | "pony" | "anima";

export interface LoraEntry {
  name: string;
  strength: number;
  enabled: boolean;
}

export interface UpscaleSettings {
  enabled: boolean;
  factor: number;
  /** Name des Upscale-Modells oder "lanczos" (ohne Modell) */
  upscaler: string;
  steps: number;
  denoise: number;
}

export interface ImageSettings {
  generator: ImageGenerator;
  /** WAI / Pony */
  checkpoint: string;
  /** WAI / Pony: "auto" oder VAE-Name. Anima: VAE-Name (Node 62) */
  vae: string;
  /** Anima */
  unet: string;
  textEncoder: string;
  shiftEnabled: boolean;
  shift: number;

  loras: LoraEntry[];
  width: number;
  height: number;
  batchSize: number;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  /** null = Zufall */
  seed: number | null;
  clipSkip: number;
  upscale: UpscaleSettings;
  adetailer: boolean;

  folder: string;
  promptMode: "single" | "batch";
  positive: string;
  negative: string;
  batchText: string;
}

export interface PromptItem {
  positive: string;
  negative: string;
  name: string;
}

export const H3_BLOCK_KEYS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
] as const;

export type H3BlockKey = (typeof H3_BLOCK_KEYS)[number];
export type H3Blocks = Record<H3BlockKey, string>;

export interface H3Ref {
  kind: "image" | "audio";
  /** Dateiname im ComfyUI-input-Ordner (Rückgabe von /upload/image) */
  filename: string;
  trimStart?: number;
  trimEnd?: number;
  /** Länge der Datei in Sekunden (nur für die Anzeige/Prüfung in der App) */
  duration?: number;
}

export interface H3Settings {
  mode: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  steps: number;
  scheduler: string;
  sampler: string;
  seed: number | null;
  ditModel: string;
  textEncoder: string;
  loras: LoraEntry[];
  interpolation: boolean;
  livePreview: boolean;
  quality: number;
  promptInput: "blocks" | "full";
  blocks: H3Blocks;
  /** Freitext für Nicht-REF2VA-Modi bzw. Modus „Kompletten Prompt einfügen“ */
  fullPrompt: string;
  noDialogue: boolean;
  refs: H3Ref[];
}

export interface JobRecord {
  promptId: string;
  kind: "image" | "video";
  generator: ImageGenerator | "h3";
  settings: ImageSettings | H3Settings;
  prompt?: PromptItem;
  seed: number;
  batchId?: string;
  index?: number;
  label: string;
  createdAt: number;
}

export interface BatchRecord {
  id: string;
  generator: ImageGenerator | "h3";
  promptIds: string[];
  total: number;
  createdAt: number;
}
