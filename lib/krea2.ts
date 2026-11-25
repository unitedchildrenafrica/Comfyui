// Krea 2: Prüfungen vor dem Start (Client + Server, reine Funktionen).

import type { ImageSettings } from "./types";

/** Krea 2 rechnet in 16er-Schritten (Breite/Höhe und Hires-Zielgröße). */
export const KREA2_MULTIPLE = 16;

/**
 * Mit SageAttention bzw. „--fast“ (fp16_accumulation) liefert Krea 2 schwarze Bilder.
 * `argv` kommt aus /system_stats (system.argv). Liefert die Warnung oder null.
 */
export function krea2StartupWarning(argv: unknown): string | null {
  if (!Array.isArray(argv)) return null;
  const flags = argv.map(String).filter((a) => a === "--use-sage-attention" || a === "--fast" || a.startsWith("--fast="));
  if (!flags.length) return null;
  return (
    `ComfyUI läuft mit ${flags.join(" ")} – damit liefert Krea 2 schwarze Bilder. ` +
    "ComfyUI ohne diese Parameter neu starten: bash /workspace/start_comfy.sh bild"
  );
}

export interface Krea2Lists {
  unets: string[];
  clips: string[];
  vaes: string[];
  /** Werte von CLIPLoader.type */
  clipTypes: string[];
  /** Gibt es LoraLoaderModelOnly? */
  modelOnlyLoras: boolean;
}

/** Fehler, die einen Start sicher scheitern lassen würden (leere Liste = alles da). */
export function krea2Problems(s: Pick<ImageSettings, "unet" | "textEncoder" | "vae" | "loras">, l: Krea2Lists): string[] {
  const out: string[] = [];
  if (!l.clipTypes.includes("krea2")) out.push("ComfyUI auf dem Pod zu alt für Krea 2 (CLIPLoader kennt den Typ „krea2“ nicht) – bitte ComfyUI updaten (setup.sh bilder).");
  const missing = (label: string, name: string, list: string[]) => {
    if (!name) out.push(`${label}: keine Datei gewählt`);
    else if (!list.includes(name)) out.push(`${label}: Datei fehlt auf dem Pod: ${name}`);
  };
  missing("UNet", s.unet, l.unets);
  missing("Text-Encoder", s.textEncoder, l.clips);
  missing("VAE", s.vae, l.vaes);
  if (s.loras.some((x) => x.enabled && x.name) && !l.modelOnlyLoras) out.push("LoraLoaderModelOnly fehlt auf dem Pod – ComfyUI updaten.");
  return out;
}

/** Summe der aktiven LoRA-Stärken über 1.5 → Artefakte wahrscheinlich */
export function krea2LoraSum(loras: ImageSettings["loras"]): number {
  return loras.filter((l) => l.enabled && l.name).reduce((sum, l) => sum + l.strength, 0);
}
