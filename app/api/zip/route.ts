import { promises as fs } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import type { NextRequest } from "next/server";
import { config } from "@/lib/server/config";
import { badRequest } from "@/lib/server/http";
import { type OutputFile, listFolders, listMedia, resolveOutputFile, resolveOutputFolder } from "@/lib/server/zip";

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

  return zipResponse(req, files, `${(folder || "output").replace(/\//g, "_")}_${new Date().toISOString().slice(0, 10)}.zip`);
}

/**
 * POST – ZIP aus ausgewählten Dateien. Body als Formular (Feld „files“ = JSON-Liste), damit der
 * Browser den Download selbst übernimmt (auch am iPhone), oder als JSON { files }.
 */
export async function POST(req: NextRequest) {
  let list: { filename?: string; subfolder?: string }[] = [];
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) list = ((await req.json()) as { files?: typeof list }).files ?? [];
    else list = JSON.parse(String((await req.formData()).get("files") ?? "[]"));
  } catch {
    return badRequest("Ungültige Auswahl");
  }
  if (!Array.isArray(list) || !list.length || list.length > 20_000) return badRequest("Keine Dateien gewählt");
  const files: OutputFile[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    const abs = resolveOutputFile(f.subfolder ?? "", f.filename ?? "");
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isFile()) files.push({ abs, rel: [f.subfolder, f.filename].filter(Boolean).join("/"), size: st.size });
  }
  if (!files.length) return badRequest("Die ausgewählten Dateien gibt es nicht mehr");
  return zipResponse(req, files, `auswahl_${files.length}_${new Date().toISOString().slice(0, 10)}.zip`);
}

function zipResponse(req: NextRequest, files: OutputFile[], name: string) {
  // store = ohne Kompression: PNG/MP4 sind schon komprimiert, so geht es schnell
  const zip = archiver("zip", { store: true, forceZip64: files.reduce((s, f) => s + f.size, 0) > 3.9e9 });
  const out = new PassThrough();
  zip.on("error", (err) => out.destroy(err));
  zip.pipe(out);
  for (const f of files) zip.file(f.abs, { name: f.rel });
  zip.finalize();
  req.signal.addEventListener("abort", () => zip.abort());

  return new Response(Readable.toWeb(out) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
