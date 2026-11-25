import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { PhotoError, cleanupUploads, createFolder, deleteFiles, deleteFolder, listFiles, listFolders, renameFolder } from "@/lib/server/photos";

export const dynamic = "force-dynamic";

const fail = (err: unknown) => (err instanceof PhotoError ? badRequest(err.message) : errorResponse(err));

/** GET /api/photos → { folders }   ·   GET /api/photos?folder=X → { files } */
export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder");
    if (folder !== null) return Response.json({ files: await listFiles(folder) });
    cleanupUploads().catch(() => {});
    return Response.json({ folders: await listFolders() });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST { action: "mkdir", name }
 *      { action: "rename", folder, name }
 *      { action: "rmdir", folder }            – Ordner samt Inhalt
 *      { action: "delete", folder, files }    – einzelne Dateien
 */
export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action?: string; name?: string; folder?: string; files?: unknown };
    switch (b.action) {
      case "mkdir":
        return Response.json({ name: await createFolder(String(b.name ?? "")) });
      case "rename":
        return Response.json({ name: await renameFolder(String(b.folder ?? ""), String(b.name ?? "")) });
      case "rmdir":
        await deleteFolder(String(b.folder ?? ""));
        return Response.json({ ok: true });
      case "delete": {
        const files = Array.isArray(b.files) ? b.files.filter((f): f is string => typeof f === "string").slice(0, 5000) : [];
        return Response.json({ deleted: await deleteFiles(String(b.folder ?? ""), files) });
      }
      default:
        return badRequest("Unbekannte Aktion");
    }
  } catch (err) {
    return fail(err);
  }
}
