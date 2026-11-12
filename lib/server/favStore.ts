import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { comfyFetch } from "./comfy";
import { config } from "./config";
import { serverMode } from "./podLink";
import { resolveOutputFile } from "./zip";

// Geschützter Speicher für Favoriten: Wird ein Favorit aus der Galerie gelöscht (einzeln, Ordner
// oder alles), wandert die Datei hierher und bleibt unter ⭐ erhalten – bis er dort entfernt wird.

/** Pfad im Favoriten-Speicher – gleiche Prüfung wie für den Ausgabeordner (kein „..“, nur Medien). */
export function favStorePath(subfolder: string, filename: string): string | null {
  if (!resolveOutputFile(subfolder, filename)) return null;
  const root = path.resolve(config.dataPath("favorites-files"));
  const abs = path.resolve(root, ...subfolder.split("/").filter(Boolean), filename);
  return abs.startsWith(root + path.sep) ? abs : null;
}

async function exists(p: string) {
  return fs.stat(p).then((s) => s.isFile(), () => false);
}

/**
 * Datei eines Favoriten in den Speicher retten. Liegt sie hier auf der Platte, wird sie verschoben;
 * im Server-Modus notfalls direkt vom Pod geholt. true = gesichert.
 */
export async function keepFavoriteFile(subfolder: string, filename: string): Promise<boolean> {
  const dest = favStorePath(subfolder, filename);
  const src = resolveOutputFile(subfolder, filename);
  if (!dest || !src) return false;
  if (await exists(dest)) {
    await fs.unlink(src).catch(() => {});
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (await exists(src)) {
    try {
      await fs.rename(src, dest);
    } catch {
      // anderes Dateisystem → kopieren, dann löschen
      await fs.copyFile(src, dest);
      await fs.unlink(src).catch(() => {});
    }
    return true;
  }
  if (serverMode()) {
    try {
      const res = await comfyFetch(`/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`, { timeoutMs: 10 * 60_000 });
      if (res.ok && res.body) {
        const part = `${dest}.part`;
        await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(part));
        await fs.rename(part, dest);
        return true;
      }
    } catch {}
  }
  return false;
}

/** Endgültig löschen (Favorit wurde entfernt) */
export async function dropFavoriteFile(subfolder: string, filename: string) {
  const p = favStorePath(subfolder, filename);
  if (p) await fs.unlink(p).catch(() => {});
}

export async function favoriteFileExists(subfolder: string, filename: string) {
  const p = favStorePath(subfolder, filename);
  return p ? exists(p) : false;
}
