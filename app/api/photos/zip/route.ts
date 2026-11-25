import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import type { NextRequest } from "next/server";
import { badRequest } from "@/lib/server/http";
import { PhotoError, listFiles, photoPath } from "@/lib/server/photos";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** GET /api/photos/zip?folder=… – ganzer Ordner als ZIP (ohne Kompression, Fotos/Videos sind schon komprimiert) */
export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder") ?? "";
  let files;
  try {
    files = await listFiles(folder);
  } catch (err) {
    return badRequest(err instanceof PhotoError ? err.message : "Ordner nicht lesbar");
  }
  if (!files.length) return badRequest("Ordner ist leer");
  const total = files.reduce((s, f) => s + f.size, 0);
  const zip = archiver("zip", { store: true, forceZip64: total > 3.9e9 });
  const out = new PassThrough();
  zip.on("error", (err) => out.destroy(err));
  zip.pipe(out);
  for (const f of files) zip.file(photoPath(folder, f.name)!, { name: path.join(folder, f.name) });
  zip.finalize();
  req.signal.addEventListener("abort", () => zip.abort());
  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(folder)}.zip`,
      "cache-control": "no-store",
    },
  });
}
