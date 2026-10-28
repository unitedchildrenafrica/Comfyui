import type { NextRequest } from "next/server";
import { badRequest, errorResponse } from "@/lib/server/http";
import { deletePreset, getPresets, savePreset } from "@/lib/server/store";
import type { ImageSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getPresets());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, settings } = (await req.json()) as { name?: string; settings?: ImageSettings };
    if (!name?.trim() || !settings) return badRequest("Name und Einstellungen nötig");
    await savePreset(name.trim().slice(0, 60), settings);
    return Response.json(await getPresets());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name");
    if (!name) return badRequest("Name fehlt");
    await deletePreset(name);
    return Response.json(await getPresets());
  } catch (err) {
    return errorResponse(err);
  }
}
