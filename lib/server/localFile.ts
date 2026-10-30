import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "./config";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export function mimeOf(file: string) {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Datei von der Platte mit Range-Support (iOS Safari braucht 206 für Videos). */
export async function serveFile(abs: string, req: Request, extra: Record<string, string> = {}): Promise<Response> {
  const st = await fs.stat(abs);
  const total = st.size;
  const headers: Record<string, string> = {
    "content-type": mimeOf(abs),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "last-modified": st.mtime.toUTCString(),
    ...extra,
  };
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    start = Math.min(start, end);
    const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers: { ...headers, "content-length": String(total) } });
}

/** Kleines WebP-Vorschaubild (Galerie-Kacheln), zwischengespeichert in DATA_DIR/thumbs. */
export async function thumbnail(abs: string, quality: number): Promise<Buffer> {
  const st = await fs.stat(abs);
  const name = `${Buffer.from(abs).toString("base64url").slice(-80)}_${st.mtimeMs | 0}_${quality}.webp`;
  const cache = config.dataPath("thumbs", name);
  try {
    return await fs.readFile(cache);
  } catch {}
  const sharp = (await import("sharp")).default;
  const buf = await sharp(abs).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
  await fs.mkdir(path.dirname(cache), { recursive: true });
  await fs.writeFile(cache, buf).catch(() => {});
  return buf;
}
