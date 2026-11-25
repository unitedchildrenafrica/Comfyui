import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { PhotoError, writeChunk } from "@/lib/server/photos";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * PUT /api/photos/upload?folder=…&name=…&id=…&offset=…&total=…&mtime=…
 * Body: ein Stück der Datei (roh). Antwort { done, received, name? }.
 */
export async function PUT(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    return Response.json(
      await writeChunk({
        folder: p.get("folder") ?? "",
        name: p.get("name") ?? "",
        uploadId: p.get("id") ?? "",
        offset: Number(p.get("offset")),
        total: Number(p.get("total")),
        lastModified: Number(p.get("mtime")) || undefined,
        body: req.body,
      }),
    );
  } catch (err) {
    return err instanceof PhotoError ? badRequest(err.message) : errorResponse(err);
  }
}
