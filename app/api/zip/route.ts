import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import type { NextRequest } from "next/server";
import { config } from "@/lib/server/config";
import { badRequest } from "@/lib/server/http";
import { listFolders, listMedia, resolveOutputFolder } from "@/lib/server/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * GET /api/zip?folder=wai            → ZIP mit allen Bildern/Videos im Ordner (rekursiv)
 * GET /api/zip?folder=wai&info=1     → { files, bytes } für die Anzeige vorab
 * GET /api/zip?list=1                → { folders } aus dem Ausgabeordner
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("list")) return Response.json({ folders: await listFolders() });
  const folder = req.nextUrl.searchParams.get("folder") ?? "";
  const dir = resolveOutputFolder(folder);
  if (!dir) return badRequest("Ungültiger Ordner");
  const files = await listMedia(dir);

  if (req.nextUrl.searchParams.get("info")) {
    return Response.json({ files: files.length, bytes: files.reduce((s, f) => s + f.size, 0), outputDir: config.outputDir });
  }
  if (!files.length) {
    return Response.json({ error: `Keine Dateien in „${folder || "output"}“ (${config.outputDir})` }, { status: 404 });
  }

  // store = ohne Kompression: PNG/MP4 sind schon komprimiert, so geht es schnell
  const zip = archiver("zip", { store: true, forceZip64: files.reduce((s, f) => s + f.size, 0) > 3.9e9 });
  const out = new PassThrough();
  zip.on("error", (err) => out.destroy(err));
  zip.pipe(out);
  for (const f of files) zip.file(f.abs, { name: f.rel });
  zip.finalize();
  req.signal.addEventListener("abort", () => zip.abort());

  const date = new Date().toISOString().slice(0, 10);
  const name = `${(folder || "output").replace(/\//g, "_")}_${date}.zip`;
  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
