import type { NextRequest } from "next/server";
import type { LoraUse } from "@/lib/loraKinds";
import { badRequest, errorResponse } from "@/lib/server/http";
import { getLoraOverrides, setLoraOverrides } from "@/lib/server/loraKinds";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ overrides: await getLoraOverrides() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT { items: [{ name, use: "image" | "video" | "both" | null }] } */
export async function PUT(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items?: { name: string; use: LoraUse | null }[] };
    if (!Array.isArray(items) || items.length > 2000) return badRequest("Ungültige Liste");
    return Response.json({ overrides: await setLoraOverrides(items) });
  } catch (err) {
    return errorResponse(err);
  }
}
