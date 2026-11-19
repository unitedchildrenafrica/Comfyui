import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { cleanName } from "@/lib/server/refTabGroups";
import { cleanTab, cleanTabs, getRefTabs, saveRefTabs } from "@/lib/server/refTabs";

export const dynamic = "force-dynamic";

/** { tabs: null } = noch nie gespeichert → das Formular legt sie aus den bisherigen Referenzen an */
export async function GET() {
  try {
    const data = await getRefTabs();
    return Response.json({ tabs: data?.tabs ?? null, extra: data?.extra ?? null, group: data?.group ?? null, updatedAt: data?.updatedAt ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { tabs?: unknown; extra?: unknown; group?: unknown };
    const tabs = cleanTabs(body.tabs);
    const extra = body.extra == null ? null : cleanTab(body.extra);
    if (!tabs || (body.extra != null && !extra)) return badRequest("Ungültige Ref-Tabs");
    return Response.json(await saveRefTabs(tabs, extra, cleanName(body.group) || null));
  } catch (err) {
    return errorResponse(err);
  }
}
