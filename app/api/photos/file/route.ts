import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { serveFile, thumbnail } from "@/lib/server/localFile";
import { photoPath } from "@/lib/server/photos";
import { photoKind } from "@/lib/photos";

export const dynamic = "force-dynamic";

/** GET /api/photos/file?folder=…&name=…[&thumb=1][&download=1] */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const name = p.get("name") ?? "";
  const abs = photoPath(p.get("folder") ?? "", name);
  if (!abs) return badRequest("Ungültige Datei");
  try {
    if (p.get("thumb") && photoKind(name) === "image") {
      try {
        const buf = await thumbnail(abs, 70);
        return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } });
      } catch {
        // Format, das sharp nicht kann (z. B. HEIC) → Original
      }
    }
    const extra: Record<string, string> = p.get("download") ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {};
    return await serveFile(abs, req, extra);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "Datei gibt es nicht mehr" }, { status: 404 });
    return errorResponse(err);
  }
}
