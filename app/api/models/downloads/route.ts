import type { NextRequest } from "next/server";
import type { ModelType } from "@/lib/modelLinks";
import { badRequest } from "@/lib/server/http";
import { cancelDownload, listDownloads, startDownload } from "@/lib/server/downloads";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ downloads: listDownloads() });
}

/** { items: [{ url, type, filename, sizeBytes }] } – jede Datei ein eigener Download */
export async function POST(req: NextRequest) {
  const { items } = (await req.json().catch(() => ({}))) as {
    items?: { url: string; type: ModelType; filename: string; sizeBytes?: number | null }[];
  };
  if (!items?.length) return badRequest("Keine Dateien gewählt");
  const errors: string[] = [];
  for (const item of items) {
    try {
      await startDownload(item);
    } catch (err) {
      errors.push(`${item.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return Response.json({ downloads: listDownloads(), errors });
}

/** ?id=… – laufenden Download abbrechen bzw. fertigen aus der Liste entfernen */
export function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return badRequest("id fehlt");
  cancelDownload(id);
  return Response.json({ downloads: listDownloads() });
}
