import { promises as fs } from "node:fs";
import path from "node:path";
import type { H3Ref } from "../types";
import { comfyFetch } from "./comfy";
import { config } from "./config";
import { serverMode } from "./podLink";

// Referenzbilder/-audio für H3 liegen im input-Ordner des Pods – auf einem neuen Pod sind sie weg.
// Im Server-Modus bewahrt der Server deshalb eine Kopie jeder hochgeladenen Datei auf
// (DATA_DIR/refs) und lädt fehlende vor jedem Video-Job selbst wieder auf den Pod.

const SEGMENT = /^[^/\\\0]+$/;

/** Pfad der Kopie, abgesichert gegen „..“ */
export function refCopyPath(filename: string): string | null {
  const parts = filename.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || !SEGMENT.test(p))) return null;
  const root = path.resolve(config.dataPath("refs"));
  const abs = path.resolve(root, ...parts);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export async function saveRefCopy(filename: string, data: Buffer) {
  if (!serverMode()) return;
  const abs = refCopyPath(filename);
  if (!abs) return;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

const split = (filename: string) => {
  const i = filename.lastIndexOf("/");
  return { name: i >= 0 ? filename.slice(i + 1) : filename, subfolder: i >= 0 ? filename.slice(0, i) : "" };
};

async function onPod(filename: string): Promise<boolean> {
  const { name, subfolder } = split(filename);
  const res = await comfyFetch(`/view?${new URLSearchParams({ filename: name, subfolder, type: "input" })}`, { timeoutMs: 30_000 });
  await res.body?.cancel().catch(() => {});
  return res.ok;
}

async function reupload(filename: string, data: Buffer) {
  const { name, subfolder } = split(filename);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(data)]), name);
  if (subfolder) form.append("subfolder", subfolder);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await comfyFetch("/upload/image", { method: "POST", body: form, timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`Referenz „${filename}“ konnte nicht auf den Pod geladen werden (HTTP ${res.status})`);
}

/**
 * Prüft vor dem Start, ob alle Referenzen auf dem Pod liegen. Fehlende werden aus der Kopie
 * wiederhergestellt; gibt es keine Kopie, kommt eine klare Meldung statt eines Abbruchs mitten im Job.
 */
export async function ensureRefsOnPod(refs: H3Ref[]): Promise<{ restored: string[] }> {
  const restored: string[] = [];
  const missing: string[] = [];
  for (const filename of [...new Set(refs.map((r) => r.filename).filter(Boolean))]) {
    if (await onPod(filename)) continue;
    const abs = refCopyPath(filename);
    const data = abs ? await fs.readFile(abs).catch(() => null) : null;
    if (!data) {
      missing.push(filename);
      continue;
    }
    await reupload(filename, data);
    restored.push(filename);
  }
  if (missing.length) {
    throw new Error(
      `Referenz ${missing.map((m) => `„${m}“`).join(", ")} fehlt auf diesem Pod (z. B. auf einem früheren Pod hochgeladen). Unter „Referenzen“ entfernen und neu hochladen.`,
    );
  }
  return { restored };
}
