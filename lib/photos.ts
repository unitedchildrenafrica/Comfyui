// Tab „Fotos“: eigene Bilder/Videos in eigenen Ordnern (Client + Server, reine Funktionen).

/**
 * Upload in Stücken: Cloudflare lässt pro Anfrage nur ~100 MB durch, und proxy.ts hält eine
 * Anfrage komplett im Speicher. 32 MB pro Stück bleiben weit darunter.
 */
export const CHUNK_BYTES = 32 * 1024 * 1024;

/** Größte erlaubte Datei (Platz auf dem Server ist begrenzt) */
export const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;

export function photoKind(name: string): "image" | "video" | null {
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  return null;
}

/** Ordnername: Buchstaben (auch äöüß), Ziffern, Leerzeichen, - _ . – keine Schrägstriche, nicht mit Punkt beginnend */
export function cleanFolderName(raw: string): string | null {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return null;
  if (name.startsWith(".") || !/^[\p{L}\p{N} _.\-()]+$/u.test(name)) return null;
  return name;
}

/** Dateiname vom Handy säubern: nur der Name, keine Pfade, keine Sonderzeichen, Endung bleibt */
export function cleanFileName(raw: string): string | null {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFC").trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot).toLowerCase();
  if (!photoKind(ext)) return null;
  const stem = base
    .slice(0, dot)
    .replace(/[^\p{L}\p{N} _.\-()]/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return `${stem || "datei"}${ext}`;
}

export interface PhotoFolder {
  name: string;
  count: number;
  bytes: number;
  /** letzte Änderung (ms) */
  updatedAt: number;
  /** Titelbild (neuestes Bild) */
  cover: string | null;
}

export interface PhotoFile {
  name: string;
  kind: "image" | "video";
  size: number;
  mtime: number;
}
