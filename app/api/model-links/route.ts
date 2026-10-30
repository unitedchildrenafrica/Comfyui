import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { deleteModelLink, getModelLinks, saveModelLinks } from "@/lib/server/modelRegistry";

export const dynamic = "force-dynamic";

/** Merkliste der Download-Links (liegt im Server-Modus auf dem Server, nicht auf dem Pod) */
export async function GET() {
  try {
    return Response.json({ links: Object.values(await getModelLinks()).sort((a, b) => b.savedAt - a.savedAt) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { filename, type, url, title? } – Link von Hand merken */
export async function POST(req: NextRequest) {
  try {
    const e = (await req.json()) as { filename?: string; type?: string; url?: string; title?: string };
    if (!e.filename || !e.type || !e.url) return badRequest("filename, type und url nötig");
    await saveModelLinks([{ filename: e.filename, type: e.type, url: e.url, title: e.title }]);
    return GET();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename");
  if (!filename) return badRequest("filename fehlt");
  await deleteModelLink(filename);
  return GET();
}
