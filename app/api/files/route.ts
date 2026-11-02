import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { deleteFiles, deleteFolder, type FileRef } from "@/lib/server/outputs";
import { outputDirAvailable } from "@/lib/server/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** DELETE /api/files?filename=…&subfolder=… – löscht eine Ausgabe-Datei (Bild/Video). */
export async function DELETE(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (!(await outputDirAvailable())) return badRequest("Ausgabeordner nicht gefunden (OUTPUT_DIR)");
  const r = await deleteFiles([{ filename: p.get("filename") ?? "", subfolder: p.get("subfolder") ?? "" }]);
  if (r.failed.length) return badRequest(`Löschen fehlgeschlagen: ${r.failed[0]}`);
  return Response.json({ ok: true });
}

/**
 * POST { action: "delete", files: [{ filename, subfolder }] }   – ausgewählte Dateien
 * POST { action: "delete-folder", folder: "wai" }               – ganzer Ordner
 * POST { action: "delete-folder", folder: "", all: true }       – komplette Galerie
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await outputDirAvailable())) return badRequest("Ausgabeordner nicht gefunden (OUTPUT_DIR)");
    const body = (await req.json()) as { action?: string; files?: FileRef[]; folder?: string; all?: boolean };
    if (body.action === "delete") {
      if (!Array.isArray(body.files) || !body.files.length) return badRequest("Keine Dateien gewählt");
      return Response.json(await deleteFiles(body.files));
    }
    if (body.action === "delete-folder") {
      const folder = (body.folder ?? "").trim();
      // Alles löschen nur mit ausdrücklichem all: true
      if (!folder && body.all !== true) return badRequest("Ordner fehlt");
      return Response.json(await deleteFolder(folder));
    }
    return badRequest("Unbekannte Aktion");
  } catch (err) {
    return errorResponse(err);
  }
}
