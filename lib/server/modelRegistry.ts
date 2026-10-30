import { promises as fs } from "node:fs";
import path from "node:path";
import { MODEL_TYPES, type ModelType } from "../modelLinks";
import { baseName, stripTokens } from "../notes";
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
}

const FILE = () => config.dataPath("model-links.json");

export async function getModelLinks(): Promise<Record<string, ModelLink>> {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();

export function saveModelLinks(entries: { filename: string; type: string; url: string; title?: string }[]): Promise<void> {
  const run = async () => {
    const links = await getModelLinks();
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
    const links = await getModelLinks();
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
