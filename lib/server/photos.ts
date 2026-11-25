import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type PhotoFile, type PhotoFolder, MAX_FILE_BYTES, cleanFileName, cleanFolderName, photoKind } from "../photos";
import { config } from "./config";

// Eigene Bilder/Videos des Nutzers: DATA_DIR/fotos/<Ordner>/<Datei>. Liegt im Server-Modus auf dem
// Server (bleibt also, wenn Pods kommen und gehen), sonst im persistenten Speicher des Pods.

export const photosRoot = () => config.dataPath("fotos");
const TMP = ".uploads";

export class PhotoError extends Error {}

function folderPath(folder: string): string {
  const name = cleanFolderName(folder);
  if (!name || name !== folder) throw new PhotoError("Ungültiger Ordnername");
  return path.join(photosRoot(), name);
}

/** Datei im Ordner – null, wenn Name ungültig */
export function photoPath(folder: string, file: string): string | null {
  let dir: string;
  try {
    dir = folderPath(folder);
  } catch {
    return null;
  }
  if (!file || file !== path.basename(file) || file.startsWith(".") || !photoKind(file)) return null;
  return path.join(dir, file);
}

async function filesIn(dir: string): Promise<PhotoFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: PhotoFile[] = [];
  for (const name of names) {
    const kind = photoKind(name);
    if (!kind || name.startsWith(".")) continue;
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) out.push({ name, kind, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name, "de"));
}

export async function listFolders(): Promise<PhotoFolder[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(photosRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PhotoFolder[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(photosRoot(), e.name);
    const files = await filesIn(dir);
    const st = await fs.stat(dir);
    out.push({
      name: e.name,
      count: files.length,
      bytes: files.reduce((s, f) => s + f.size, 0),
      updatedAt: Math.max(st.mtimeMs, files[0]?.mtime ?? 0),
      cover: files.find((f) => f.kind === "image")?.name ?? null,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listFiles(folder: string): Promise<PhotoFile[]> {
  const dir = folderPath(folder);
  await fs.access(dir).catch(() => {
    throw new PhotoError(`Ordner „${folder}“ gibt es nicht`);
  });
  return filesIn(dir);
}

export async function createFolder(raw: string): Promise<string> {
  const name = cleanFolderName(raw);
  if (!name) throw new PhotoError("Ungültiger Name – erlaubt sind Buchstaben, Zahlen, Leerzeichen, - _ . ( )");
  const existing = (await listFolders()).find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new PhotoError(`Ordner „${existing.name}“ gibt es schon`);
  await fs.mkdir(path.join(photosRoot(), name), { recursive: true });
  return name;
}

export async function renameFolder(from: string, raw: string): Promise<string> {
  const src = folderPath(from);
  const name = cleanFolderName(raw);
  if (!name) throw new PhotoError("Ungültiger Name");
  if (name === from) return name;
  const clash = (await listFolders()).find((f) => f.name.toLowerCase() === name.toLowerCase() && f.name !== from);
  if (clash) throw new PhotoError(`Ordner „${clash.name}“ gibt es schon`);
  await fs.rename(src, path.join(photosRoot(), name));
  return name;
}

/** Ordner samt Inhalt löschen */
export async function deleteFolder(folder: string): Promise<void> {
  await fs.rm(folderPath(folder), { recursive: true, force: true });
}

export async function deleteFiles(folder: string, files: string[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    const abs = photoPath(folder, f);
    if (!abs) continue;
    await fs.unlink(abs).then(
      () => n++,
      () => {},
    );
  }
  return n;
}

/** Freien Namen im Ordner finden: bild.jpg → bild (2).jpg */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  for (let i = 1; i < 10_000; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    try {
      await fs.access(path.join(dir, candidate));
    } catch {
      return candidate;
    }
  }
  throw new PhotoError("Kein freier Dateiname");
}

/**
 * Ein Stück einer Datei schreiben. Stücke kommen der Reihe nach (offset = bisher empfangene Bytes);
 * das letzte Stück benennt die Datei um. Liefert den endgültigen Namen, sobald sie fertig ist.
 */
export async function writeChunk(opts: {
  folder: string;
  name: string;
  uploadId: string;
  offset: number;
  total: number;
  body: ReadableStream<Uint8Array> | null;
  /** Änderungszeit vom Handy (Aufnahmedatum ungefähr), ms */
  lastModified?: number;
}): Promise<{ done: boolean; received: number; name?: string }> {
  const dir = folderPath(opts.folder);
  await fs.access(dir).catch(() => {
    throw new PhotoError(`Ordner „${opts.folder}“ gibt es nicht`);
  });
  const name = cleanFileName(opts.name);
  if (!name) throw new PhotoError(`„${opts.name}“ ist kein Bild oder Video`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(opts.uploadId)) throw new PhotoError("Ungültige Upload-ID");
  if (!Number.isSafeInteger(opts.total) || opts.total <= 0 || opts.total > MAX_FILE_BYTES) throw new PhotoError("Datei zu groß");
  if (!Number.isSafeInteger(opts.offset) || opts.offset < 0 || opts.offset >= opts.total) throw new PhotoError("Ungültiger Abschnitt");
  if (!opts.body) throw new PhotoError("Leerer Abschnitt");

  const tmpDir = path.join(photosRoot(), TMP);
  await fs.mkdir(tmpDir, { recursive: true });
  const part = path.join(tmpDir, `${opts.uploadId}.part`);
  const have = (await fs.stat(part).catch(() => null))?.size ?? 0;
  if (opts.offset !== have) {
    // Stück schon da (Wiederholung nach Abbruch) oder Lücke → Client macht ab „received“ weiter
    if (opts.offset < have) return { done: false, received: have };
    throw new PhotoError(`Abschnitt fehlt (erwartet ab Byte ${have})`);
  }
  await pipeline(Readable.fromWeb(opts.body as import("node:stream/web").ReadableStream), createWriteStream(part, { flags: "a" }));
  const received = (await fs.stat(part)).size;
  if (received > opts.total) {
    await fs.unlink(part).catch(() => {});
    throw new PhotoError("Mehr Daten als angekündigt – Upload verworfen");
  }
  if (received < opts.total) return { done: false, received };

  const final = await freeName(dir, name);
  // Pfad liegt zur Laufzeit in DATA_DIR – dem Build sagen, dass er nicht das Projekt meint
  const dest = path.join(/* turbopackIgnore: true */ dir, final);
  await fs.rename(part, dest);
  if (opts.lastModified && Number.isFinite(opts.lastModified) && opts.lastModified > 0) {
    const t = new Date(Math.min(opts.lastModified, Date.now()));
    await fs.utimes(dest, t, t).catch(() => {});
  }
  return { done: true, received, name: final };
}

/** Halbe Uploads (Tab zu, Netz weg) nach einem Tag wegräumen */
export async function cleanupUploads(maxAgeMs = 24 * 3600_000): Promise<void> {
  const tmpDir = path.join(photosRoot(), TMP);
  const names = await fs.readdir(tmpDir).catch(() => [] as string[]);
  for (const n of names) {
    const abs = path.join(tmpDir, n);
    const st = await fs.stat(abs).catch(() => null);
    if (st && Date.now() - st.mtimeMs > maxAgeMs) await fs.unlink(abs).catch(() => {});
  }
}
