// LoRAs für Bilder und für Videos trennen (Client + Server). Dateien bleiben, wo sie sind –
// die Zuordnung kommt aus eigener Auswahl, Unterordner, bekannten Namen oder dem Dateinamen.

import { baseName } from "./notes";

export type LoraUse = "image" | "video" | "both";

/** LoRAs aus pod/setup.sh – ein Test prüft, dass die Listen zum Skript passen */
export const SETUP_IMAGE_LORAS = ["incase_style.safetensors", "expressiveH.safetensors", "gothic_neon.safetensors", "disney_princesses.safetensors"];
export const SETUP_VIDEO_LORAS = [
  "MysticXXXV4.safetensors",
  "VideoReasoning.safetensors",
  "DoggyStyleLegUp.safetensors",
  "CowGirlBehind.safetensors",
  "AIOSEXLora.safetensors",
  "POVDoggyStyle.safetensors",
  "MalePenis.safetensors",
  "MaleAnatomy.safetensors",
  "CumOnFace.safetensors",
  "DildoMasturbation.safetensors",
  "FingeringSelf.safetensors",
  "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
];

const VIDEO_FOLDER = /^(video|videos|vid|h3|minimax)$/i;
const IMAGE_FOLDER = /^(bild|bilder|image|images|img|sdxl|pony|illustrious|wai|anima)$/i;
const VIDEO_NAME = /minimax|(^|[_\-.\s])h3([_\-.\s]|$)|ltx|wan2|wan_2|hunyuan/i;

const lower = (list: string[]) => new Set(list.map((n) => n.toLowerCase()));
const KNOWN_IMAGE = lower(SETUP_IMAGE_LORAS);
const KNOWN_VIDEO = lower(SETUP_VIDEO_LORAS);

/**
 * Zuordnung einer LoRA. `overrides` = selbst gewählt (Schlüssel: Dateiname ohne Ordner).
 * null = unbekannt → erscheint in beiden Listen, bis sie zugeordnet ist.
 */
export function classifyLora(name: string, overrides: Record<string, LoraUse> = {}): { use: LoraUse | null; auto: boolean } {
  const file = baseName(name);
  const own = overrides[file] ?? Object.entries(overrides).find(([k]) => k.toLowerCase() === file.toLowerCase())?.[1];
  if (own) return { use: own, auto: false };
  const folders = name.split(/[\\/]/).slice(0, -1);
  if (folders.some((f) => VIDEO_FOLDER.test(f))) return { use: "video", auto: true };
  if (folders.some((f) => IMAGE_FOLDER.test(f))) return { use: "image", auto: true };
  if (KNOWN_VIDEO.has(file.toLowerCase())) return { use: "video", auto: true };
  if (KNOWN_IMAGE.has(file.toLowerCase())) return { use: "image", auto: true };
  if (VIDEO_NAME.test(file)) return { use: "video", auto: true };
  return { use: null, auto: true };
}

/** Passt die LoRA in die Liste für Bilder bzw. Videos? Unbekannte passen überall. */
export function loraFits(use: LoraUse | null | undefined, target: "image" | "video") {
  return !use || use === "both" || use === target;
}

/** Vermutung beim Herunterladen aus dem Civitai-Basismodell */
export function guessUseFromBaseModel(baseModel: string | undefined, filename: string): "image" | "video" | null {
  const b = baseModel ?? "";
  if (/minimax|h3|video|ltx|wan|hunyuan|mochi|cogvideo|svd/i.test(b) || VIDEO_NAME.test(filename)) return "video";
  if (/illustrious|pony|sdxl|noob|anima|sd ?1|sd ?2|sd ?3|flux|qwen|chroma|lumina|kolors|playground/i.test(b)) return "image";
  return null;
}
