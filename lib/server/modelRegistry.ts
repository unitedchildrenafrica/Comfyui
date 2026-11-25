import { promises as fs } from "node:fs";
import path from "node:path";
import { MODEL_TYPES, type ModelType } from "../modelLinks";
import { baseName, stripTokens } from "../notes";
import { SETUP_LORA_LINKS } from "../setupLinks";
import { config } from "./config";

// Merkliste: Jede Datei, die einmal über „Modelle laden“ kam, behält ihren Download-Link.
// Ist sie auf dem nächsten Pod nicht mehr da (gelöscht, frischer Pod), lässt sie sich mit
// einem Tipp neu laden – unter demselben Dateinamen, damit Presets und Charaktere passen.

export interface ModelLink {
  filename: string;
  type: ModelType;
  /** Direkter Download-Link (ohne Token) */
  url: string;
  title?: string;
  savedAt: number;
  /** fest eingebaut (Krea 2, LoRAs aus pod/setup.sh) – lässt sich nicht löschen */
  builtin?: boolean;
}

const FILE = () => config.dataPath("model-links.json");

const HF_KREA = "https://huggingface.co/Comfy-Org/Krea-2/resolve/main";
const CIVITAI = "https://civitai.red/api/download/models";

/**
 * Immer bekannte Links (Krea 2), damit die Dateien auf jedem frischen Pod per Tipp nachladbar sind.
 * Selbst gemerkte Links mit gleichem Dateinamen gehen vor.
 */
export const BUILTIN_MODEL_LINKS: ModelLink[] = ([
  { filename: "krea2_turbo_fp8_scaled.safetensors", type: "unet", url: `${HF_KREA}/diffusion_models/krea2_turbo_fp8_scaled.safetensors`, title: "Krea 2 Turbo (fp8)", savedAt: 0 },
  { filename: "qwen3vl_4b_fp8_scaled.safetensors", type: "text_encoder", url: `${HF_KREA}/text_encoders/qwen3vl_4b_fp8_scaled.safetensors`, title: "Krea 2 Text-Encoder (Qwen3-VL 4B)", savedAt: 0 },
  { filename: "qwen_image_vae.safetensors", type: "vae", url: `${HF_KREA}/vae/qwen_image_vae.safetensors`, title: "Qwen-Image-VAE (Krea 2, Anima)", savedAt: 0 },
  { filename: "krea2_nsfw_v2.safetensors", type: "lora", url: `${CIVITAI}/3065362`, title: "Krea 2 NSFW v2", savedAt: 0 },
  { filename: "krea2_turbo_nsfw.safetensors", type: "lora", url: `${CIVITAI}/3081369`, title: "Krea 2 Turbo NSFW", savedAt: 0 },
  // LoRAs, die pod/setup.sh lädt – damit alle LoRA-Links an einer Stelle stehen
  ...SETUP_LORA_LINKS.map((l) => ({ ...l, type: "lora" as const, title: "aus dem Pod-Setup", savedAt: 0 })),
] as ModelLink[]).map((l) => ({ ...l, builtin: true }));

async function storedLinks(): Promise<Record<string, ModelLink>> {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export async function getModelLinks(): Promise<Record<string, ModelLink>> {
  return { ...Object.fromEntries(BUILTIN_MODEL_LINKS.map((l) => [l.filename, l])), ...(await storedLinks()) };
}

let queue: Promise<unknown> = Promise.resolve();

export function saveModelLinks(entries: { filename: string; type: string; url: string; title?: string }[]): Promise<void> {
  const run = async () => {
    const links = await storedLinks();
    let changed = false;
    for (const e of entries) {
      const filename = baseName(String(e.filename ?? "")).trim();
      if (!filename || !e.url || !(e.type in MODEL_TYPES)) continue;
      let url: string;
      try {
        const u = new URL(stripTokens(e.url));
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        url = u.toString();
      } catch {
        continue;
      }
      links[filename] = { filename, type: e.type as ModelType, url, ...(e.title ? { title: String(e.title).slice(0, 300) } : {}), savedAt: Date.now() };
      changed = true;
    }
    if (!changed) return;
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    const tmp = `${FILE()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(links, null, 1));
    await fs.rename(tmp, FILE());
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

export function deleteModelLink(filename: string): Promise<void> {
  const run = async () => {
    const links = await storedLinks();
    if (!links[filename]) return;
    delete links[filename];
    await fs.writeFile(FILE(), JSON.stringify(links, null, 1));
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

/** Link zu einer Datei suchen (Groß/klein und Unterordner egal) */
export function findLink(links: Record<string, ModelLink>, name: string): ModelLink | null {
  const b = baseName(name);
  if (links[b]) return links[b];
  const lower = b.toLowerCase();
  return Object.values(links).find((l) => l.filename.toLowerCase() === lower) ?? null;
}
