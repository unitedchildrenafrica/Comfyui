import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { badRequest } from "@/lib/server/http";
import { removeFavorite } from "@/lib/server/store";
import { outputDirAvailable, resolveOutputFile } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

/** DELETE /api/files?filename=…&subfolder=… – löscht eine Ausgabe-Datei (Bild/Video) vom Pod. */
export async function DELETE(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (!(await outputDirAvailable())) return badRequest("Ausgabeordner nicht gefunden (OUTPUT_DIR)");
  const file = resolveOutputFile(p.get("subfolder") ?? "", p.get("filename") ?? "");
  if (!file) return badRequest("Ungültige Datei");
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return badRequest(`Löschen fehlgeschlagen: ${(err as Error).message}`);
  }
  await removeFavorite({ filename: p.get("filename") ?? "", subfolder: p.get("subfolder") ?? "" });
  return Response.json({ ok: true });
}
