import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { cleanTabs, getRefTabs, saveRefTabs } from "@/lib/server/refTabs";

export const dynamic = "force-dynamic";

/** { tabs: null } = noch nie gespeichert → das Formular legt sie aus den bisherigen Referenzen an */
export async function GET() {
  try {
    const data = await getRefTabs();
    return Response.json({ tabs: data?.tabs ?? null, updatedAt: data?.updatedAt ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tabs = cleanTabs(((await req.json()) as { tabs?: unknown }).tabs);
    if (!tabs) return badRequest("Ungültige Ref-Tabs");
    return Response.json(await saveRefTabs(tabs));
  } catch (err) {
    return errorResponse(err);
  }
}
