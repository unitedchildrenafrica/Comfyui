import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";

const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|wav|mp3|flac)$/i;
const SEGMENT = /^[A-Za-z0-9_\-.]+$/;

/** Ordnerpfad relativ zum Ausgabeordner, ohne Ausbruch („..“, absolute Pfade). "" = alles. */
export function resolveOutputFolder(folder: string): string | null {
  const parts = folder.split("/").filter(Boolean);
  if (parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) return null;
  const root = path.resolve(config.outputDir);
  const dir = path.resolve(root, ...parts);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  return dir;
}

export interface OutputFile {
  abs: string;
  rel: string;
  size: number;
}

/** Alle Bilder/Videos unterhalb von dir (rekursiv), sortiert nach Pfad. */
export async function listMedia(dir: string): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  async function walk(d: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && MEDIA.test(e.name)) {
        const st = await fs.stat(abs).catch(() => null);
        if (st) out.push({ abs, rel: path.relative(dir, abs), size: st.size });
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Ordner im Ausgabeordner (bis zwei Ebenen tief), z. B. "wai", "video/2026-10-28". */
export async function listFolders(): Promise<string[]> {
  const root = path.resolve(config.outputDir);
  const out: string[] = [];
  async function walk(d: string, depth: number) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || !SEGMENT.test(e.name)) continue;
      const abs = path.join(d, e.name);
      out.push(path.relative(root, abs));
      if (depth < 2) await walk(abs, depth + 1);
    }
  }
  await walk(root, 1);
  return out.sort();
}
