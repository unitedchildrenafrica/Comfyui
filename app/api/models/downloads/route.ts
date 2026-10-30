import type { NextRequest } from "next/server";
import type { ModelType } from "@/lib/modelLinks";
import { badRequest } from "@/lib/server/http";
import { cancelDownload, listDownloads, startDownload } from "@/lib/server/downloads";
import { setLoraOverrides } from "@/lib/server/loraKinds";
import { saveModelLinks } from "@/lib/server/modelRegistry";
import { forwardToPodApp } from "@/lib/server/podForward";
import { serverMode } from "@/lib/server/podLink";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  if (serverMode()) return forwardToPodApp(req, "/api/models/downloads");
  return Response.json({ downloads: listDownloads() });
}

/** { items: [{ url, type, filename, sizeBytes, title? }] } – jede Datei ein eigener Download */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let items: { url: string; type: ModelType; filename: string; sizeBytes?: number | null; title?: string; use?: "image" | "video" }[] | undefined;
  try {
    items = (JSON.parse(raw) as { items?: typeof items }).items;
  } catch {}
  // Link merken, damit die Datei später (neuer Pod, gelöscht) wieder geladen werden kann
  if (Array.isArray(items)) {
    await saveModelLinks(items).catch(() => {});
    // Bild- oder Video-LoRA gleich zuordnen
    const uses = items.filter((i) => i.type === "lora" && (i.use === "image" || i.use === "video")).map((i) => ({ name: i.filename, use: i.use! }));
    if (uses.length) await setLoraOverrides(uses).catch(() => {});
  }
  if (serverMode()) return forwardToPodApp(req, "/api/models/downloads", raw);
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
  if (serverMode()) return forwardToPodApp(req, "/api/models/downloads");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return badRequest("id fehlt");
  cancelDownload(id);
  return Response.json({ downloads: listDownloads() });
}
