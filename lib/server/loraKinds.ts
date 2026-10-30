import { promises as fs } from "node:fs";
import path from "node:path";
import type { LoraUse } from "../loraKinds";
import { baseName } from "../notes";
import { config } from "./config";

// Selbst gewählte Zuordnung Bild/Video pro LoRA (Dateiname ohne Ordner → Verwendung)

const FILE = () => config.dataPath("lora-kinds.json");

export async function getLoraOverrides(): Promise<Record<string, LoraUse>> {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** use = null entfernt die eigene Zuordnung (dann gilt wieder die automatische) */
export function setLoraOverrides(entries: { name: string; use: LoraUse | null }[]): Promise<Record<string, LoraUse>> {
  const run = async () => {
    const data = await getLoraOverrides();
    for (const { name, use } of entries) {
      const file = baseName(String(name ?? "")).trim();
      if (!file) continue;
      if (use === "image" || use === "video" || use === "both") data[file] = use;
      else delete data[file];
    }
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    const tmp = `${FILE()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 1));
    await fs.rename(tmp, FILE());
    return data;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
