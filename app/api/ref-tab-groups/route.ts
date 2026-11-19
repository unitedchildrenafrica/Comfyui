import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { GroupError, deleteGroup, listGroups, saveGroup } from "@/lib/server/refTabGroups";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ groups: await listGroups() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { name, tabs } – speichern (gleicher Name überschreibt) */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: unknown; tabs?: unknown };
    const group = await saveGroup(body.name, body.tabs);
    return Response.json({ group, groups: await listGroups() });
  } catch (err) {
    if (err instanceof GroupError) return badRequest(err.message);
    return errorResponse(err);
  }
}

/** DELETE ?id=… */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!/^[\w-]{1,40}$/.test(id)) return badRequest("Ungültige Gruppe");
    await deleteGroup(id);
    return Response.json({ groups: await listGroups() });
  } catch (err) {
    return errorResponse(err);
  }
}
