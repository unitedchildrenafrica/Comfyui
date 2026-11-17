import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { serveFile, thumbnail } from "@/lib/server/localFile";
import { resolveKneteFile } from "@/lib/server/knete";

export const dynamic = "force-dynamic";

/** GET ?kind=ref|jobref|in|out&job=…&name=…[&thumb=1][&download=1] */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const abs = await resolveKneteFile(p.get("kind") ?? "", p.get("job") ?? "", p.get("name") ?? "");
  if (!abs || !(await fs.stat(abs).then((s) => s.isFile(), () => false))) return new Response("Nicht gefunden", { status: 404 });
  if (p.get("thumb")) {
    const buf = await thumbnail(abs, 72).catch(() => null);
    if (buf) return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } });
  }
  const extra: Record<string, string> = p.get("download") ? { "content-disposition": `attachment; filename="${(p.get("name") ?? "bild").replace(/"/g, "")}"` } : {};
  return serveFile(abs, req, extra);
}
