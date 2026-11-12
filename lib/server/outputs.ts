import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { getHistory } from "./history";
import { forgetMirroredMany } from "./mirror";
import { serverMode } from "./podLink";
import { keepFavoriteFile } from "./favStore";
import { favKey, getFavorites, saveFavorites } from "./store";
import { listMedia, resolveOutputFile, resolveOutputFolder } from "./zip";

// Löschen in der Galerie: einzelne Dateien, ganze Ordner oder alles. Im Server-Modus bekommen
// gelöschte Dateien zusätzlich einen Vermerk, damit der Spiegel sie nicht wieder vom Pod holt.

export interface FileRef {
  filename: string;
  subfolder: string;
}

const MAX_FILES = 20_000;

export async function deleteFiles(list: FileRef[]): Promise<{ deleted: number; failed: string[]; keptFavorites: number }> {
  const failed: string[] = [];
  const done: FileRef[] = [];
  // Favoriten werden nie mitgelöscht: Datei wandert in den Favoriten-Speicher
  const favs = await getFavorites();
  const favByKey = new Map(favs.map((x) => [favKey(x), x]));
  let kept = 0;
  for (const f of list.slice(0, MAX_FILES)) {
    const abs = resolveOutputFile(f.subfolder ?? "", f.filename ?? "");
    if (!abs) {
      failed.push(`${f.subfolder}/${f.filename}: ungültig`);
      continue;
    }
    const fav = favByKey.get(favKey(f));
    if (fav && fav.type !== "favorite") {
      if (await keepFavoriteFile(f.subfolder, f.filename)) {
        fav.type = "favorite";
        kept++;
        done.push({ filename: f.filename, subfolder: f.subfolder });
      } else failed.push(`${f.subfolder}/${f.filename}: Favorit konnte nicht gesichert werden – nicht gelöscht`);
      continue;
    }
    try {
      await fs.unlink(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        failed.push(`${f.subfolder}/${f.filename}: ${(err as Error).message}`);
        continue;
      }
    }
    done.push({ filename: f.filename, subfolder: f.subfolder });
  }
  if (kept) await saveFavorites(favs);
  if (serverMode()) await forgetMirroredMany(done);
  return { deleted: done.length, failed, keptFavorites: kept };
}

/** Leere Unterordner entfernen (der Ordner selbst nur, wenn er nicht der Ausgabeordner ist). */
async function pruneEmpty(dir: string, root: string) {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) await pruneEmpty(path.join(dir, e.name), root);
  if (dir !== root && !(await fs.readdir(dir).catch(() => ["x"])).length) await fs.rmdir(dir).catch(() => {});
}

/** Alle Bilder/Videos eines Ordners löschen. folder "" = die ganze Galerie. */
export async function deleteFolder(folder: string): Promise<{ deleted: number; failed: string[]; keptFavorites: number }> {
  const dir = resolveOutputFolder(folder);
  if (!dir) throw new Error("Ungültiger Ordner");
  const root = path.resolve(config.outputDir);
  const files: FileRef[] = (await listMedia(dir)).map((m) => ({
    filename: path.basename(m.abs),
    subfolder: path.relative(root, path.dirname(m.abs)).split(path.sep).join("/"),
  }));
  // Server-Modus: auch Dateien, die nur auf dem Pod liegen (noch nicht kopiert), ausblenden
  if (serverMode()) {
    try {
      const inFolder = (s: string) => !folder || s === folder || s.startsWith(folder + "/");
      const live = (await getHistory(2000)).flatMap((e) => e.files.filter((f) => f.type === "output" && inFolder(f.subfolder)));
      await forgetMirroredMany(live.map((f) => ({ filename: f.filename, subfolder: f.subfolder })));
    } catch {
      // Pod nicht erreichbar – dann gibt es auch nichts Neues zu holen
    }
  }
  const result = await deleteFiles(files);
  await pruneEmpty(dir, root);
  return result;
}
