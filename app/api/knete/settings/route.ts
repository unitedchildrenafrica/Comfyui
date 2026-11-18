import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { getKneteSettings, openaiKey, saveKneteSettings } from "@/lib/server/knete";
import { DEFAULT_KNETE_SETTINGS, type KneteSettings } from "@/lib/knete";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ settings: await getKneteSettings(), defaults: DEFAULT_KNETE_SETTINGS, keySet: !!openaiKey() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<KneteSettings>;
    return Response.json({ settings: await saveKneteSettings(body) });
  } catch (err) {
    return errorResponse(err);
  }
}
