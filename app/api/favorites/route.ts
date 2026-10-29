import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { type FavoriteItem, getFavorites, saveFavorites } from "@/lib/server/store";
import { outputDirAvailable, resolveOutputFile } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

/** Favoriten in gespeicherter Reihenfolge – ohne Dateien, die es nicht mehr gibt. */
export async function GET() {
  try {
    const list = await getFavorites();
    if (!(await outputDirAvailable())) return Response.json({ items: list });
    const keep = await Promise.all(
      list.map((f) => {
        const abs = resolveOutputFile(f.subfolder, f.filename);
        return abs ? fs.access(abs).then(() => true, () => false) : false;
      }),
    );
    return Response.json({ items: list.filter((_, i) => keep[i]) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT { items } – komplette Liste in neuer Reihenfolge speichern (Hinzufügen, Entfernen, Verschieben). */
export async function PUT(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items?: FavoriteItem[] };
    if (!Array.isArray(items) || items.length > 5000) return badRequest("Ungültige Liste");
    return Response.json({ items: await saveFavorites(items) });
  } catch (err) {
    return errorResponse(err);
  }
}
