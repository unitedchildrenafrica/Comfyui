import type { NextRequest } from "next/server";
import { type Character, isCollection } from "@/lib/notes";
import { badRequest, errorResponse } from "@/lib/server/http";
import { findLink, getModelLinks, saveModelLinks } from "@/lib/server/modelRegistry";
import { ConflictError, deleteNote, listNotes, putNote, reorderNotes } from "@/lib/server/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ col: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { col } = await params;
  if (!isCollection(col)) return badRequest("Unbekannte Liste");
  try {
    return Response.json({ items: await listNotes(col) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT { item, baseUpdatedAt?, force? } – anlegen/ersetzen; { order: [ids] } – Reihenfolge */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { col } = await params;
  if (!isCollection(col)) return badRequest("Unbekannte Liste");
  try {
    const body = (await req.json()) as { item?: unknown; baseUpdatedAt?: number; force?: boolean; order?: string[] };
    if (Array.isArray(body.order)) {
      await reorderNotes(col, body.order.filter((x) => typeof x === "string"));
      return Response.json({ items: await listNotes(col) });
    }
    let item = body.item;
    if (col === "characters" && item) item = await withLoraLinks(item as Character);
    const saved = await putNote(col, item, { baseUpdatedAt: body.baseUpdatedAt, force: body.force });
    return Response.json({ item: saved });
  } catch (err) {
    if (err instanceof ConflictError) return Response.json({ error: err.message, code: "conflict", current: err.current }, { status: 409 });
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { col } = await params;
  const id = req.nextUrl.searchParams.get("id");
  if (!isCollection(col) || !id) return badRequest("Liste oder id fehlt");
  try {
    await deleteNote(col, id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Fehlende LoRA-Links aus der Merkliste ergänzen, selbst eingetragene Links dort merken. */
async function withLoraLinks(c: Character): Promise<Character> {
  if (!Array.isArray(c.loras)) return c;
  const links = await getModelLinks();
  const manual = c.loras.filter((l) => l?.url && l.name && !findLink(links, l.name));
  if (manual.length) await saveModelLinks(manual.map((l) => ({ filename: l.name, type: "lora", url: l.url! }))).catch(() => {});
  return { ...c, loras: c.loras.map((l) => (l?.url || !l?.name ? l : { ...l, url: findLink(links, l.name)?.url })) };
}
