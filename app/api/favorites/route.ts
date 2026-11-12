import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { dropFavoriteFile, favoriteFileExists } from "@/lib/server/favStore";
import { badRequest, errorResponse } from "@/lib/server/http";
import { type FavoriteItem, favKey, getFavorites, saveFavorites } from "@/lib/server/store";
import { outputDirAvailable, resolveOutputFile } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

/** Favoriten in gespeicherter Reihenfolge – ohne Dateien, die es nicht mehr gibt. */
export async function GET() {
  try {
    const list = await getFavorites();
    const outputs = await outputDirAvailable();
    const keep = await Promise.all(
      list.map((f) => {
        // aus der Galerie gelöscht, aber als Favorit gesichert
        if (f.type === "favorite") return favoriteFileExists(f.subfolder, f.filename);
        if (!outputs) return true;
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
    const before = await getFavorites();
    const saved = await saveFavorites(items);
    // Aus den Favoriten entfernt und nur noch im Favoriten-Speicher → jetzt endgültig löschen
    const still = new Set(saved.map(favKey));
    for (const f of before) if (f.type === "favorite" && !still.has(favKey(f))) await dropFavoriteFile(f.subfolder, f.filename);
    return Response.json({ items: saved });
  } catch (err) {
    return errorResponse(err);
  }
}
