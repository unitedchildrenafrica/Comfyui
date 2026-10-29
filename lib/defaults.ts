import { emptyBlocks } from "./h3prompt";
import type { H3Settings, ImageGenerator, ImageSettings } from "./types";

export const DEFAULT_NEGATIVE = "lowres, bad anatomy, bad hands, watermark, text";

export const ASPECTS = [
  { id: "portrait", label: "Portrait", width: 768, height: 1152 },
  { id: "landscape", label: "Landscape", width: 1152, height: 768 },
  { id: "square", label: "Square", width: 1024, height: 1024 },
] as const;

export const UPSCALE_FACTORS = [1, 1.5, 2, 3, 4] as const;

export function defaultImageSettings(generator: ImageGenerator): ImageSettings {
  const base: ImageSettings = {
    generator,
    checkpoint: "wai_illustrious_v10.safetensors",
    vae: "auto",
    unet: "anima-base-v1.0.safetensors",
    textEncoder: "qwen_3_06b_base.safetensors",
    shiftEnabled: true,
    shift: 3,
    loras: [],
    width: 768,
    height: 1152,
    batchSize: 1,
    sampler: "euler_ancestral",
    scheduler: "normal",
    steps: 15,
    cfg: 6,
    seed: null,
    clipSkip: 2,
    upscale: { enabled: true, factor: 1.5, upscaler: "4x_foolhardy_Remacri.pth", steps: 15, denoise: 0.35 },
    adetailer: false,
    folder: "",
    promptMode: "single",
    positive: "",
    negative: DEFAULT_NEGATIVE,
    batchText: "",
  };
  if (generator === "pony") {
    return {
      ...base,
      checkpoint: "ponyDiffusionV6XL.safetensors",
      steps: 25,
      cfg: 7,
      positive: "score_9, score_8_up, score_7_up, ",
      negative: "score_4, score_5, score_6, " + DEFAULT_NEGATIVE,
    };
  }
  if (generator === "anima") {
    return { ...base, vae: "qwen_image_vae.safetensors", sampler: "euler", scheduler: "simple", steps: 25, cfg: 3.5 };
  }
  return base;
}

export function defaultH3Settings(): H3Settings {
  return {
    mode: "REF2VA",
    duration: 10,
    width: 1024,
    height: 768,
    frameRate: 24,
    steps: 10,
    scheduler: "normal",
    sampler: "euler",
    seed: null,
    ditModel: "Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors",
    textEncoder: "qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors",
    loras: [],
    interpolation: true,
    livePreview: true,
    quality: 26,
    videoCodec: "H.264",
    promptInput: "blocks",
    blocks: emptyBlocks(),
    fullPrompt: "",
    noDialogue: true,
    refs: [],
  };
}

/**
 * Wie „Native (ShortEdge 768px)“ im DaSiWa-Director: kurze Seite 768, lange Seite nach
 * Seitenverhältnis auf das 32-px-Raster von H3 gerundet (js/minimax_h3_director.js, resolveCanvas).
 */
export const H3_RESOLUTIONS = [
  { label: "16:9 quer", width: 1376, height: 768 },
  { label: "4:3 quer", width: 1024, height: 768 },
  { label: "3:2 quer", width: 1152, height: 768 },
  { label: "1:1", width: 768, height: 768 },
  { label: "9:16 hoch", width: 768, height: 1376 },
  { label: "3:4 hoch", width: 768, height: 1024 },
] as const;

/** Vordefinierte Presets (werden beim ersten Start in DATA_DIR angelegt). */
export function builtinPresets(): Record<string, ImageSettings> {
  return {
    "WAI v10": { ...defaultImageSettings("wai"), checkpoint: "wai_illustrious_v10.safetensors" },
    "WAI v17": { ...defaultImageSettings("wai"), checkpoint: "wai_illustrious_v17.safetensors" },
    "Nova 3DCG": { ...defaultImageSettings("wai"), checkpoint: "nova3DCGXL_ilV90.safetensors" },
    Pony: defaultImageSettings("pony"),
    "Aniverse Pony": { ...defaultImageSettings("pony"), checkpoint: "aniversePonyXL_v40.safetensors" },
  };
}
