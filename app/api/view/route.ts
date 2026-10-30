import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { comfyFetch } from "@/lib/server/comfy";
import { errorResponse } from "@/lib/server/http";
import { serveFile, thumbnail } from "@/lib/server/localFile";
import { serverMode } from "@/lib/server/podLink";
import { resolveOutputFile } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

/** Reicht /view von ComfyUI durch (inkl. Range für Video-Seeking am iPhone). */
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const qs = new URLSearchParams({
      filename: p.get("filename") ?? "",
      subfolder: p.get("subfolder") ?? "",
      type: p.get("type") === "input" || p.get("type") === "temp" ? p.get("type")! : "output",
    });
    // preview=webp;75 → ComfyUI liefert ein komprimiertes Vorschaubild (Galerie-Kacheln)
    const preview = p.get("preview");
    if (preview && /^(webp|jpeg);\d{1,3}$/.test(preview)) qs.set("preview", preview);
    // Server-Modus: gespiegelte Ausgaben direkt von der eigenen Platte (geht auch ohne Pod)
    if (serverMode() && qs.get("type") === "output") {
      const abs = resolveOutputFile(qs.get("subfolder")!, qs.get("filename")!);
      const exists = abs ? await fs.stat(abs).then((s) => s.isFile(), () => false) : false;
      if (abs && exists) {
        const disposition: Record<string, string> = p.get("download")
          ? { "content-disposition": `attachment; filename="${qs.get("filename")!.replace(/"/g, "")}"` }
          : {};
        if (preview && /\.(png|jpe?g|webp)$/i.test(abs)) {
          const q = Math.min(100, Math.max(1, Number(preview.split(";")[1]) || 70));
          const buf = await thumbnail(abs, q).catch(() => null);
          if (buf) return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } });
        }
        return await serveFile(abs, req, disposition);
      }
    }
    const headers: Record<string, string> = {};
    const range = req.headers.get("range");
    if (range) headers.range = range;
    const res = await comfyFetch(`/view?${qs}`, { headers, timeoutMs: 120_000 });
    const out = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified"]) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    out.set("cache-control", "private, max-age=3600");
    if (p.get("download")) out.set("content-disposition", `attachment; filename="${qs.get("filename")!.replace(/"/g, "")}"`);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    return errorResponse(err);
  }
}
