"use client";

import { api } from "./client";
import type { ModelType } from "./modelLinks";
import { baseName, type Character } from "./notes";
import type { Resolved } from "./server/downloads";

export const APPLY_KEY = "pf.applyCharacter";
export const APPLY_EVENT = "pf:apply-character";

/** Charakter ins Bild-Formular geben – sofort, wenn es offen ist, sonst beim nächsten Öffnen. */
export function sendCharacterToImageForm(c: Character) {
  try {
    sessionStorage.setItem(APPLY_KEY, JSON.stringify(c));
  } catch {}
  window.dispatchEvent(new Event(APPLY_EVENT));
}

export function takePendingCharacter(): Character | null {
  try {
    const raw = sessionStorage.getItem(APPLY_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(APPLY_KEY);
    return JSON.parse(raw) as Character;
  } catch {
    return null;
  }
}

/**
 * Datei über einen gemerkten Link neu laden – unter dem alten Dateinamen, damit Charaktere
 * und Presets weiter passen. Der Link darf eine Civitai-Seite, ein Download- oder HF-Link sein.
 */
export async function redownload(name: string, url: string, type: ModelType = "lora") {
  const filename = baseName(name);
  const r = await api<Resolved>("/api/models/resolve", { method: "POST", json: { url } });
  const f = r.files.find((x) => x.filename.toLowerCase() === filename.toLowerCase()) ?? r.files.find((x) => x.primary) ?? r.files[0];
  if (!f) throw new Error("Unter dem Link wurde keine Datei gefunden");
  const res = await api<{ errors: string[] }>("/api/models/downloads", {
    method: "POST",
    json: { items: [{ url: f.url, type, filename, sizeBytes: f.sizeBytes, title: r.title }] },
  });
  if (res.errors?.length) throw new Error(res.errors.join("; "));
}
