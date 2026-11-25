// LoRAs für Bilder, Videos und Krea 2 trennen (Client + Server). Dateien bleiben, wo sie sind –
// die Zuordnung kommt aus eigener Auswahl, Unterordner, bekannten Namen oder dem Dateinamen.
// „image“ = WAI/Pony/Anima, „krea2“ = nur Krea 2 (andere LoRAs funktionieren dort nicht).

import { baseName } from "./notes";

export type LoraUse = "image" | "video" | "both" | "krea2";
/** Liste, in der eine LoRA angeboten wird */
export type LoraTarget = "image" | "video" | "krea2";
export const LORA_USES: LoraUse[] = ["image", "video", "both", "krea2"];

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
  "FingeringSelf.safetensors",
  "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
];

/** Krea-2-LoRAs aus pod/setup.sh (Abschnitt „Bilder: Krea 2“) */
export const SETUP_KREA_LORAS = ["krea2_nsfw_v2.safetensors", "krea2_turbo_nsfw.safetensors"];

const KREA_FOLDER = /^krea2?$/i;
const KREA_NAME = /krea/i;
const VIDEO_FOLDER = /^(video|videos|vid|h3|minimax)$/i;
const IMAGE_FOLDER = /^(bild|bilder|image|images|img|sdxl|pony|illustrious|wai|anima)$/i;
const VIDEO_NAME = /minimax|(^|[_\-.\s])h3([_\-.\s]|$)|ltx|wan2|wan_2|hunyuan/i;

const lower = (list: string[]) => new Set(list.map((n) => n.toLowerCase()));
const KNOWN_IMAGE = lower(SETUP_IMAGE_LORAS);
const KNOWN_VIDEO = lower(SETUP_VIDEO_LORAS);
const KNOWN_KREA = lower(SETUP_KREA_LORAS);

/**
 * Zuordnung einer LoRA. `overrides` = selbst gewählt (Schlüssel: Dateiname ohne Ordner).
 * null = unbekannt → erscheint in beiden Listen, bis sie zugeordnet ist.
 */
export function classifyLora(name: string, overrides: Record<string, LoraUse> = {}): { use: LoraUse | null; auto: boolean } {
  const file = baseName(name);
  const own = overrides[file] ?? Object.entries(overrides).find(([k]) => k.toLowerCase() === file.toLowerCase())?.[1];
  if (own) return { use: own, auto: false };
  const folders = name.split(/[\\/]/).slice(0, -1);
  if (folders.some((f) => KREA_FOLDER.test(f))) return { use: "krea2", auto: true };
  if (folders.some((f) => VIDEO_FOLDER.test(f))) return { use: "video", auto: true };
  if (folders.some((f) => IMAGE_FOLDER.test(f))) return { use: "image", auto: true };
  if (KNOWN_KREA.has(file.toLowerCase())) return { use: "krea2", auto: true };
  if (KNOWN_VIDEO.has(file.toLowerCase())) return { use: "video", auto: true };
  if (KNOWN_IMAGE.has(file.toLowerCase())) return { use: "image", auto: true };
  if (KREA_NAME.test(file)) return { use: "krea2", auto: true };
  if (VIDEO_NAME.test(file)) return { use: "video", auto: true };
  return { use: null, auto: true };
}

/**
 * Passt die LoRA in die Liste für Bilder, Videos bzw. Krea 2? Unbekannte passen überall (bis sie
 * zugeordnet sind). „both“ = Bild + Video, nicht Krea 2.
 */
export function loraFits(use: LoraUse | null | undefined, target: LoraTarget) {
  if (!use) return true;
  if (target === "krea2" || use === "krea2") return use === target;
  return use === "both" || use === target;
}

/** Vermutung beim Herunterladen aus dem Civitai-Basismodell */
export function guessUseFromBaseModel(baseModel: string | undefined, filename: string): "image" | "video" | "krea2" | null {
  const b = baseModel ?? "";
  if (/krea/i.test(b) || KREA_NAME.test(filename)) return "krea2";
  if (/minimax|h3|video|ltx|wan|hunyuan|mochi|cogvideo|svd/i.test(b) || VIDEO_NAME.test(filename)) return "video";
  if (/illustrious|pony|sdxl|noob|anima|sd ?1|sd ?2|sd ?3|flux|qwen|chroma|lumina|kolors|playground/i.test(b)) return "image";
  return null;
}
